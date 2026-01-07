/** @format */

import * as cdk from "aws-cdk-lib";
import * as autoscaling from "aws-cdk-lib/aws-autoscaling";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as logs from "aws-cdk-lib/aws-logs";
import { Tags } from "aws-cdk-lib";
import { Construct } from "constructs";

import { EcsTaskExecutionRole } from "../../iam/ecs-task-execution-role";
import {
  EcsServiceConfig,
  VolumeMountConfig,
} from "../../types/ecs-service-config";

import { EcsTaskDefinitionConstruct } from "./ecs-stack";

/**
 * Properties for EcsServicesStack
 */
export interface EcsServicesStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
  cluster: ecs.Cluster;
  autoScalingGroup: autoscaling.AutoScalingGroup;
  envName: string;
  projectName?: string;
  applicationName: string;
  /**
   * Services to create in this stack
   */
  services: EcsServiceConfig[];
  /**
   * Load balancer configuration (optional)
   * If provided, a load balancer will be created in this stack
   * and services with loadBalancer config will be attached
   */
  loadBalancerConfig?: {
    internetFacing?: boolean;
    allowedIpRanges?: string[];
    name?: string;
  };
  /**
   * Default log retention for service log groups
   * @default TWO_WEEKS
   */
  defaultLogRetention?: logs.RetentionDays;
  /**
   * Enable public ECR access for all services
   * Set to true if services use public Docker Hub images
   * @default false
   */
  enablePublicEcr?: boolean;
}

/**
 * EcsServicesStack - Creates ECS services dynamically from configuration
 *
 * This stack creates ECS services based on the provided service configurations.
 * It depends on EcsStack which provides the cluster and capacity providers.
 *
 * Features:
 * - Dynamically creates services from configuration
 * - Automatic CloudWatch Log Groups for each service
 * - Load balancer routing configuration (if provided)
 * - Task execution roles with proper permissions
 * - Volume mounting support
 * - Circuit breaker configuration
 * - Health check grace periods
 *
 * Usage:
 * ```typescript
 * const servicesStack = new EcsServicesStack(app, "ServicesStack", {
 *   vpc,
 *   cluster: ecsStack.cluster,
 *   autoScalingGroup: ecsStack.autoScalingGroup,
 *   envName: "development",
 *   applicationName: "monitoring",
 *   services: [
 *     {
 *       name: "prometheus",
 *       container: {
 *         name: "prometheus",
 *         image: "prom/prometheus:latest",
 *         containerPort: 9090,
 *       },
 *       loadBalancer: { path: "/prometheus/*" },
 *     },
 *   ],
 *   loadBalancer: ecsStack.loadBalancer,
 * });
 * ```
 */
export class EcsServicesStack extends cdk.Stack {
  public readonly services: Map<string, ecs.Ec2Service>;
  public readonly serviceUrls: Map<string, string>;
  public readonly loadBalancer?: elbv2.ApplicationLoadBalancer;

  constructor(scope: Construct, id: string, props: EcsServicesStackProps) {
    super(scope, id, props);

    const {
      vpc,
      cluster,
      autoScalingGroup,
      envName,
      projectName,
      applicationName,
      services,
      loadBalancerConfig,
      defaultLogRetention = logs.RetentionDays.TWO_WEEKS,
      enablePublicEcr = false,
    } = props;

    // Initialize services map
    this.services = new Map();
    this.serviceUrls = new Map();

    // Create load balancer if configured
    // Load balancer, listener, and target groups must all be in this stack to avoid cyclic dependencies
    let listener: elbv2.ApplicationListener | undefined;
    if (loadBalancerConfig) {
      this.loadBalancer = this.createLoadBalancer(
        vpc,
        envName,
        applicationName,
        loadBalancerConfig.allowedIpRanges,
        loadBalancerConfig.internetFacing ?? true,
        loadBalancerConfig.name
      );
      listener = this.createLoadBalancerListener(this.loadBalancer);
    }

    // Create services dynamically from configuration
    let rulePriority = 100;
    for (const serviceConfig of services) {
      const service = this.createServiceFromConfig(
        cluster,
        envName,
        serviceConfig,
        defaultLogRetention,
        enablePublicEcr
      );
      this.services.set(serviceConfig.name, service);

      // Configure load balancer routing if configured
      if (serviceConfig.loadBalancer && listener) {
        const targetGroup = this.createTargetGroup(
          vpc,
          serviceConfig,
          envName,
          applicationName
        );
        service.attachToApplicationTargetGroup(targetGroup);

        const targetGroupId = `${serviceConfig.name}TargetGroup`;
        listener.addTargetGroups(targetGroupId, {
          targetGroups: [targetGroup],
          conditions: [
            elbv2.ListenerCondition.pathPatterns([
              serviceConfig.loadBalancer.path,
            ]),
          ],
          priority: serviceConfig.loadBalancer.priority ?? rulePriority++,
        });

        // Store service URL
        if (this.loadBalancer) {
          const servicePath = serviceConfig.loadBalancer.path.replace("/*", "");
          this.serviceUrls.set(
            serviceConfig.name,
            `http://${this.loadBalancer.loadBalancerDnsName}${servicePath}`
          );
        }

        // Allow ALB to reach service port
        if (
          serviceConfig.albPort &&
          this.loadBalancer &&
          this.loadBalancer instanceof elbv2.ApplicationLoadBalancer
        ) {
          autoScalingGroup.connections.allowFrom(
            this.loadBalancer,
            ec2.Port.tcp(serviceConfig.albPort),
            `Allow ALB to reach ${serviceConfig.name}`
          );
        }
      }
    }

    // Create outputs
    this.createOutputs(envName, applicationName);

    // ========================================================================
    // RESOURCE TAGGING
    // ========================================================================
    Tags.of(this).add("Stack", "EcsServices");
    Tags.of(this).add("Application", applicationName);
    if (projectName) {
      Tags.of(this).add("Project", projectName);
    }
    Tags.of(this).add("Environment", envName);
    Tags.of(this).add("ManagedBy", "CDK");
  }

  /**
   * Create a service from configuration
   */
  private createServiceFromConfig(
    cluster: ecs.Cluster,
    envName: string,
    serviceConfig: EcsServiceConfig,
    defaultLogRetention: logs.RetentionDays,
    enablePublicEcr: boolean
  ): ecs.Ec2Service {
    // Create CloudWatch Log Group for service
    const logGroup =
      serviceConfig.container.logGroup ||
      new logs.LogGroup(this, `${serviceConfig.name}LogGroup`, {
        logGroupName: `/ecs/${envName}/${serviceConfig.name}`,
        retention: defaultLogRetention,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });

    // Create execution role for CloudWatch Logs
    const executionRole = new EcsTaskExecutionRole(
      this,
      `${serviceConfig.name}ExecutionRole`,
      {
        envName,
        logGroupArn: logGroup.logGroupArn,
        enablePublicEcr: enablePublicEcr,
      }
    ).role;

    // Convert volumes from service config to ECS volumes
    const volumes: ecs.Volume[] | undefined = serviceConfig.volumes?.map(
      (vol: VolumeMountConfig) => ({
        name: vol.name,
        host: { sourcePath: vol.hostPath },
      })
    );

    // Create task definition
    const taskDef = new EcsTaskDefinitionConstruct(
      this,
      `${serviceConfig.name}TaskDef`,
      {
        envName,
        networkMode: serviceConfig.networkMode || ecs.NetworkMode.BRIDGE,
        executionRole,
        containers: [
          {
            name: serviceConfig.container.name,
            image: ecs.ContainerImage.fromRegistry(
              serviceConfig.container.image
            ),
            containerPort: serviceConfig.container.containerPort,
            hostPort: serviceConfig.container.hostPort,
            memoryReservationMiB:
              serviceConfig.container.memoryReservationMiB || 512,
            memoryLimitMiB: serviceConfig.container.memoryLimitMiB,
            cpu: serviceConfig.container.cpu,
            user: serviceConfig.container.user,
            command: serviceConfig.container.command,
            environment: serviceConfig.container.environment,
            logGroup: logGroup,
            logStreamPrefix:
              serviceConfig.container.logStreamPrefix || serviceConfig.name,
          },
        ],
        volumes: volumes,
      }
    );

    // Add mount points if volumes are configured
    if (serviceConfig.volumes) {
      for (const volume of serviceConfig.volumes) {
        taskDef.addMountPoints(serviceConfig.container.name, {
          sourceVolume: volume.name,
          containerPath: volume.containerPath,
          readOnly: volume.readOnly ?? false,
        });
      }
    }

    // Determine circuit breaker configuration
    // Disable for HOST network mode services (like Node Exporter) to avoid false positives
    const enableCircuitBreaker =
      serviceConfig.networkMode !== ecs.NetworkMode.HOST;

    // Create service
    const service = new ecs.Ec2Service(this, `${serviceConfig.name}Service`, {
      cluster,
      taskDefinition: taskDef.taskDefinition as ecs.Ec2TaskDefinition,
      serviceName: `${envName}-${serviceConfig.name}`,
      desiredCount: serviceConfig.desiredCount || 1,
      enableExecuteCommand: serviceConfig.enableExecuteCommand ?? true,
      circuitBreaker: {
        enable: enableCircuitBreaker,
        rollback: enableCircuitBreaker,
      },
      minHealthyPercent: 0,
      maxHealthyPercent: 200,
      // Extended health check grace period for HOST network mode services
      healthCheckGracePeriod:
        serviceConfig.networkMode === ecs.NetworkMode.HOST
          ? cdk.Duration.seconds(300)
          : cdk.Duration.seconds(120),
      // Placement constraints for HOST network mode to avoid port conflicts
      placementConstraints:
        serviceConfig.networkMode === ecs.NetworkMode.HOST
          ? [ecs.PlacementConstraint.distinctInstances()]
          : undefined,
    });

    // Tag service
    Tags.of(service).add("Environment", envName);
    Tags.of(service).add("ManagedBy", "CDK");
    Tags.of(service).add("Service", serviceConfig.name);

    return service;
  }

  /**
   * Create load balancer
   * Must be created in this stack (same as listener and target groups) to avoid cyclic dependencies
   */
  private createLoadBalancer(
    vpc: ec2.IVpc,
    envName: string,
    applicationName: string,
    allowedIpRanges?: string[],
    internetFacing: boolean = true,
    name?: string
  ): elbv2.ApplicationLoadBalancer {
    const albSecurityGroup = new ec2.SecurityGroup(this, "ApplicationAlbSg", {
      vpc,
      description: `Security group for ${applicationName} ALB`,
      allowAllOutbound: true,
    });

    const ipRanges = allowedIpRanges || ["0.0.0.0/0"];
    ipRanges.forEach((ipRange) => {
      albSecurityGroup.addIngressRule(
        ec2.Peer.ipv4(ipRange),
        ec2.Port.tcp(80),
        `Allow HTTP access from ${ipRange}`
      );
    });

    const loadBalancer = new elbv2.ApplicationLoadBalancer(
      this,
      "ApplicationAlb",
      {
        vpc,
        internetFacing,
        loadBalancerName: name || `${envName}-${applicationName}-alb`,
        securityGroup: albSecurityGroup,
      }
    );

    Tags.of(loadBalancer).add(
      "Name",
      name || `${envName}-${applicationName}-alb`
    );
    Tags.of(loadBalancer).add("Environment", envName);
    Tags.of(loadBalancer).add("Application", applicationName);

    return loadBalancer;
  }

  /**
   * Create load balancer listener
   * Must be created in this stack (same as target groups) to avoid cyclic dependencies
   */
  private createLoadBalancerListener(
    alb: elbv2.ApplicationLoadBalancer
  ): elbv2.ApplicationListener {
    const listener = alb.addListener("ApplicationListener", {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
    });

    // Add default action for unmatched routes
    listener.addAction("DefaultAction", {
      action: elbv2.ListenerAction.fixedResponse(404, {
        contentType: "text/plain",
        messageBody: "Not Found - No matching service route",
      }),
    });

    return listener;
  }

  /**
   * Create target group for a service
   */
  private createTargetGroup(
    vpc: ec2.IVpc,
    serviceConfig: EcsServiceConfig,
    _envName: string,
    _applicationName: string
  ): elbv2.ApplicationTargetGroup {
    const containerPort =
      serviceConfig.container.hostPort || serviceConfig.container.containerPort;
    const healthCheckPath = serviceConfig.loadBalancer?.healthCheckPath || "/";

    return new elbv2.ApplicationTargetGroup(
      this,
      `${serviceConfig.name}TargetGroup`,
      {
        vpc,
        port: containerPort,
        protocol: elbv2.ApplicationProtocol.HTTP,
        targetType: elbv2.TargetType.INSTANCE,
        healthCheck: {
          path: healthCheckPath,
          interval: cdk.Duration.seconds(30),
          timeout: cdk.Duration.seconds(5),
          healthyThresholdCount: 2,
          unhealthyThresholdCount: 3,
        },
      }
    );
  }

  /**
   * Create CloudFormation outputs
   */
  private createOutputs(envName: string, applicationName: string): void {
    // Output service names
    for (const [serviceName, service] of this.services.entries()) {
      new cdk.CfnOutput(this, `${serviceName}ServiceName`, {
        value: service.serviceName,
        description: `${serviceName} ECS Service Name`,
        exportName: `${envName}-${applicationName}-${serviceName}-service-name`,
      });
    }

    // Output service URLs if load balancer exists
    if (
      this.loadBalancer &&
      this.loadBalancer instanceof elbv2.ApplicationLoadBalancer
    ) {
      const alb = this.loadBalancer as elbv2.ApplicationLoadBalancer;

      new cdk.CfnOutput(this, "LoadBalancerDns", {
        value: alb.loadBalancerDnsName,
        description: "Application Load Balancer DNS Name",
        exportName: `${envName}-${applicationName}-alb-dns`,
      });

      new cdk.CfnOutput(this, "ApplicationAlbArn", {
        value: alb.loadBalancerArn,
        description: `${applicationName} ALB ARN`,
        exportName: `${envName}-${applicationName}-alb-arn`,
      });

      // Output service URLs
      for (const [serviceName, url] of this.serviceUrls.entries()) {
        new cdk.CfnOutput(this, `${serviceName}Url`, {
          value: url,
          description: `${serviceName} service URL`,
        });
      }
    }
  }
}
