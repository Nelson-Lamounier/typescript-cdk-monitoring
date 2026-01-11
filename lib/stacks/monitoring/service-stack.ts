/** @format */

import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { Construct } from "constructs";

import { GrafanaServiceConstruct } from "../../constructs/services/monitoring/grafana/grafana-construct";
import { PrometheusConstruct } from "../../constructs/services/monitoring/prometheus/prometheus-construct";
import { NodeExporterConstruct } from "../../constructs/services/monitoring/node-exporter-construct";
import { SsmParametersConstruct } from "../../constructs/config";
import { applyStackTags } from "../../shared/helpers/stack-tagging-helper";
import { MonitoringServiceStackProps } from "../../shared/types/stack-types";
import {
  MONITORING_MOUNT_PATHS,
  MONITORING_PORTS,
  MONITORING_ROUTES,
  MONITORING_LOG_RETENTION,
  BRIDGE_NETWORK_DYNAMIC_PORT_RANGE,
  MONITORING_HEALTH_CHECK,
} from "../../shared/constants/monitoring-constants";
import { validateEnvName } from "../../shared/utils/validation";
import { isProductionEnvironment } from "../../shared/utils/environment";

/**
 * MonitoringServiceStack - Layer 2: ECS Service Definitions
 *
 * This stack contains ECS service definitions and load balancer routing.
 * It depends on MonitoringInfraStack (Layer 1) for infrastructure.
 *
 * Components:
 * - Prometheus ECS service with EC2 service discovery
 * - Grafana ECS service with CloudWatch integration
 * - Node Exporter ECS service for host metrics
 * - ALB target groups and routing rules
 * - Security group connections between services and ALB
 *
 * Dependencies:
 * - MonitoringInfraStack (for cluster, ASG, ALB, listener)
 *
 * Features:
 * - Path-based routing (/grafana, /prometheus)
 * - Health checks with redirect support (200, 301, 302)
 * - Bridge networking with dynamic port support
 * - ECS Exec for debugging
 * - SSM parameters for service discovery
 *
 * Configuration Storage:
 * - Prometheus config (prometheus.yml) stored on EFS at /mnt/prometheus-config
 * - Grafana provisioning stored on EFS at /mnt/grafana-provisioning
 * - Grafana dashboards stored on EFS at /mnt/grafana-dashboards
 * - Can be updated without redeploying this stack
 *
 * Deployment Triggers:
 * - Container image changes
 * - Resource allocation changes (CPU, memory)
 * - Port mapping changes
 * - Service configuration changes
 *
 * @example
 * ```typescript
 * const serviceStack = new MonitoringServiceStack(app, 'MonitoringService', {
 *   envName: 'production',
 *   cluster: infraStack.cluster,
 *   loadBalancer: infraStack.loadBalancer,
 *   listener: infraStack.listener,
 * });
 * ```
 */
export class MonitoringServiceStack extends cdk.Stack {
  /**
   * Prometheus ECS service
   */
  public readonly prometheusService: ecs.Ec2Service;

  /**
   * Grafana ECS service
   */
  public readonly grafanaService: ecs.Ec2Service;

  /**
   * Node Exporter ECS service
   */
  public readonly nodeExporterService: ecs.Ec2Service;

  /**
   * Prometheus target group
   */
  public prometheusTargetGroup!: elbv2.ApplicationTargetGroup;

  /**
   * Grafana target group
   */
  public grafanaTargetGroup!: elbv2.ApplicationTargetGroup;

  /**
   * SSM Parameters construct (if enabled)
   */
  public readonly ssmParameters?: SsmParametersConstruct;

  constructor(
    scope: Construct,
    id: string,
    props: MonitoringServiceStackProps
  ) {
    super(scope, id, props);

    // ========================================================================
    // VALIDATION
    // ========================================================================
    validateEnvName(props.envName);

    if (!props.cluster) {
      throw new Error(
        "ECS cluster is required for MonitoringServiceStack.\n\n" +
          "The cluster should be created in MonitoringInfraStack (Layer 1) " +
          "and passed to this stack via props."
      );
    }

    if (!props.loadBalancer) {
      throw new Error(
        "Load balancer is required for MonitoringServiceStack.\n\n" +
          "The load balancer should be created in MonitoringInfraStack (Layer 1) " +
          "and passed to this stack via props."
      );
    }

    if (!props.listener) {
      throw new Error(
        "ALB listener is required for MonitoringServiceStack.\n\n" +
          "The listener should be created in MonitoringInfraStack (Layer 1) " +
          "and passed to this stack via props."
      );
    }

    // ========================================================================
    // PRODUCTION WARNINGS
    // ========================================================================
    if (
      props.enableProductionWarnings !== false &&
      isProductionEnvironment(props.envName)
    ) {
      this.logProductionWarnings(props);
    }

    // ========================================================================
    // DEFAULTS
    // ========================================================================
    const prometheusDataPath =
      props.prometheusDataPath ?? MONITORING_MOUNT_PATHS.PROMETHEUS_DATA;
    const prometheusConfigPath =
      props.prometheusConfigPath ?? MONITORING_MOUNT_PATHS.PROMETHEUS_CONFIG;
    const grafanaDataPath =
      props.grafanaDataPath ?? MONITORING_MOUNT_PATHS.GRAFANA_DATA;
    const grafanaProvisioningPath =
      props.grafanaProvisioningPath ??
      MONITORING_MOUNT_PATHS.GRAFANA_PROVISIONING;
    const grafanaDashboardsPath =
      props.grafanaDashboardsPath ?? MONITORING_MOUNT_PATHS.GRAFANA_DASHBOARDS;
    const grafanaRootUrl = props.grafanaRootUrl ?? MONITORING_ROUTES.GRAFANA;
    const logRetention = props.logRetention ?? MONITORING_LOG_RETENTION;
    const enableExecuteCommand = props.enableExecuteCommand ?? true;

    // ========================================================================
    // 1. CREATE PROMETHEUS SERVICE
    // ========================================================================
    const prometheusConstruct = new PrometheusConstruct(this, "Prometheus", {
      cluster: props.cluster as ecs.Cluster,
      envName: props.envName,
      dataVolume: {
        hostPath: prometheusDataPath,
      },
      configVolume: {
        hostPath: prometheusConfigPath,
      },
      enableExecuteCommand,
      logRetention,
      // Apply memory/CPU overrides if provided
      ...(props.prometheusProps?.cpu && { cpu: props.prometheusProps.cpu }),
      ...(props.prometheusProps?.memoryMiB && {
        memoryMiB: props.prometheusProps.memoryMiB,
      }),
      ...(props.prometheusProps?.containerPort && {
        containerPort: props.prometheusProps.containerPort,
      }),
      ...(props.prometheusProps?.logRetention && {
        logRetention: props.prometheusProps.logRetention,
      }),
    });

    this.prometheusService = prometheusConstruct.service as ecs.Ec2Service;

    // ========================================================================
    // 2. CREATE GRAFANA SERVICE
    // ========================================================================
    // Grafana admin password secret name
    // The secret must exist in AWS Secrets Manager before deployment
    // Create it with: aws secretsmanager create-secret --name grafana-admin-password --secret-string "your-password"
    const grafanaSecretName =
      process.env.GRAFANA_ADMIN_PASSWORD_SECRET_NAME ||
      "grafana-admin-password";

    const grafanaConstruct = new GrafanaServiceConstruct(this, "Grafana", {
      cluster: props.cluster as ecs.Cluster,
      envName: props.envName,
      dataVolume: {
        hostPath: grafanaDataPath,
      },
      provisioningVolume: {
        hostPath: grafanaProvisioningPath,
      },
      dashboardsVolume: {
        hostPath: grafanaDashboardsPath,
      },
      adminPasswordSecretArn: grafanaSecretName,
      rootUrl: grafanaRootUrl,
      enableExecuteCommand,
      logRetention,
      // Apply memory/CPU overrides if provided
      ...(props.grafanaProps?.cpu && { cpu: props.grafanaProps.cpu }),
      ...(props.grafanaProps?.memoryMiB && {
        memoryMiB: props.grafanaProps.memoryMiB,
      }),
      ...(props.grafanaProps?.containerPort && {
        containerPort: props.grafanaProps.containerPort,
      }),
      ...(props.grafanaProps?.logRetention && {
        logRetention: props.grafanaProps.logRetention,
      }),
    });

    this.grafanaService = grafanaConstruct.service as ecs.Ec2Service;

    // ========================================================================
    // 3. CREATE NODE EXPORTER SERVICE
    // ========================================================================
    const nodeExporterConstruct = new NodeExporterConstruct(
      this,
      "NodeExporter",
      {
        cluster: props.cluster as ecs.Cluster,
        envName: `${props.envName}-monitoring`,
        serviceName: `${props.envName}-monitoring-node-exporter`,
        memoryReservationMiB: 64,
        logRetention,
        enableExecuteCommand,
      }
    );

    this.nodeExporterService = nodeExporterConstruct.service;

    // ========================================================================
    // 4. CONFIGURE LOAD BALANCER ROUTING
    // ========================================================================
    this.configureLoadBalancerRouting(props);

    // ========================================================================
    // 5. SSM PARAMETERS (for service discovery)
    // ========================================================================
    if (props.createSsmParameters !== false) {
      this.ssmParameters = new SsmParametersConstruct(this, "Parameters", {
        envName: props.envName,
        projectName: props.projectName,
        pathPrefix: `/monitoring/${props.envName}`,
        customParameters: [
          {
            name: "prometheus-service-arn",
            value: this.prometheusService.serviceArn,
            description: `Prometheus ECS service ARN for ${props.envName}`,
          },
          {
            name: "grafana-service-arn",
            value: this.grafanaService.serviceArn,
            description: `Grafana ECS service ARN for ${props.envName}`,
          },
          {
            name: "node-exporter-service-arn",
            value: this.nodeExporterService.serviceArn,
            description: `Node Exporter ECS service ARN for ${props.envName}`,
          },
          {
            name: "prometheus-target-group-arn",
            value: this.prometheusTargetGroup.targetGroupArn,
            description: `Prometheus ALB target group ARN for ${props.envName}`,
          },
          {
            name: "grafana-target-group-arn",
            value: this.grafanaTargetGroup.targetGroupArn,
            description: `Grafana ALB target group ARN for ${props.envName}`,
          },
        ],
      });
    }

    // ========================================================================
    // 6. CLOUDFORMATION OUTPUTS
    // ========================================================================
    if (props.createOutputs !== false) {
      this.createOutputs(props);
    }

    // ========================================================================
    // 7. RESOURCE TAGGING
    // ========================================================================
    applyStackTags(this, props.envName, props.projectName, {
      ...props.customTags,
      StackName: "MonitoringService",
      Layer: "Service",
    });
  }

  /**
   * Log production warnings
   */
  private logProductionWarnings(props: MonitoringServiceStackProps): void {
    // Warn about HTTP-only configuration (can't check listener protocol directly on IApplicationListener)
    // Users should configure HTTPS in MonitoringInfraStack for production
    cdk.Annotations.of(this).addInfo(
      "PRODUCTION: Ensure HTTPS is configured in MonitoringInfraStack. " +
        "HTTP-only configurations will transmit Grafana credentials and metrics in plaintext."
    );

    // Warn about execute command in production
    if (props.enableExecuteCommand !== false) {
      cdk.Annotations.of(this).addInfo(
        "PRODUCTION: ECS Exec enabled for all services. " +
          "This allows interactive debugging but provides shell access to containers. " +
          "Ensure IAM policies restrict exec permissions appropriately."
      );
    }
  }

  /**
   * Configure load balancer routing
   */
  private configureLoadBalancerRouting(
    props: MonitoringServiceStackProps
  ): void {
    // ========================================================================
    // GRAFANA TARGET GROUP
    // ========================================================================
    // Note: When using TargetType.INSTANCE with bridge networking, containers
    // use dynamic ports (32768-65535). ECS automatically registers the instance
    // with the dynamic port via loadBalancerTarget(). The target group's port
    // property (3000) is just a hint - ECS uses the actual dynamic port.
    this.grafanaTargetGroup = new elbv2.ApplicationTargetGroup(
      this,
      "GrafanaTargetGroup",
      {
        port: MONITORING_PORTS.GRAFANA,
        protocol: elbv2.ApplicationProtocol.HTTP,
        vpc: props.cluster.vpc,
        targetType: elbv2.TargetType.INSTANCE,
        targetGroupName: props.projectName
          ? `${props.envName}-${props.projectName}-grafana`
          : `${props.envName}-grafana`,
        healthCheck: {
          path: "/", // Root path - Grafana redirects to /login
          port: "traffic-port", // Use the port the target is registered on (dynamic port)
          healthyHttpCodes: MONITORING_HEALTH_CHECK.HEALTHY_HTTP_CODES,
          interval: cdk.Duration.seconds(
            MONITORING_HEALTH_CHECK.INTERVAL_SECONDS
          ),
          timeout: cdk.Duration.seconds(
            MONITORING_HEALTH_CHECK.TIMEOUT_SECONDS
          ),
          healthyThresholdCount: MONITORING_HEALTH_CHECK.HEALTHY_THRESHOLD,
          unhealthyThresholdCount: MONITORING_HEALTH_CHECK.UNHEALTHY_THRESHOLD,
        },
        deregistrationDelay: cdk.Duration.seconds(30),
      }
    );

    // ========================================================================
    // PROMETHEUS TARGET GROUP
    // ========================================================================
    this.prometheusTargetGroup = new elbv2.ApplicationTargetGroup(
      this,
      "PrometheusTargetGroup",
      {
        port: MONITORING_PORTS.PROMETHEUS,
        protocol: elbv2.ApplicationProtocol.HTTP,
        vpc: props.cluster.vpc,
        targetType: elbv2.TargetType.INSTANCE,
        targetGroupName: props.projectName
          ? `${props.envName}-${props.projectName}-prom`
          : `${props.envName}-prometheus`,
        healthCheck: {
          path: "/", // Root path - Prometheus redirects to /-/healthy
          healthyHttpCodes: MONITORING_HEALTH_CHECK.HEALTHY_HTTP_CODES,
          interval: cdk.Duration.seconds(
            MONITORING_HEALTH_CHECK.INTERVAL_SECONDS
          ),
          timeout: cdk.Duration.seconds(
            MONITORING_HEALTH_CHECK.TIMEOUT_SECONDS
          ),
          healthyThresholdCount: MONITORING_HEALTH_CHECK.HEALTHY_THRESHOLD,
          unhealthyThresholdCount: MONITORING_HEALTH_CHECK.UNHEALTHY_THRESHOLD,
        },
        deregistrationDelay: cdk.Duration.seconds(30),
      }
    );

    // ========================================================================
    // SECURITY GROUP CONNECTIONS
    // ========================================================================
    // Allow ALB to reach Prometheus on fixed port 9090
    this.prometheusService.connections.allowFrom(
      props.loadBalancer,
      ec2.Port.tcp(MONITORING_PORTS.PROMETHEUS),
      "Allow ALB to reach Prometheus on port 9090"
    );

    // Allow ALB to reach Grafana on dynamic port range (bridge networking)
    // ECS automatically registers the dynamic port with the target group
    this.grafanaService.connections.allowFrom(
      props.loadBalancer,
      ec2.Port.tcpRange(
        BRIDGE_NETWORK_DYNAMIC_PORT_RANGE.MIN,
        BRIDGE_NETWORK_DYNAMIC_PORT_RANGE.MAX
      ),
      "Allow ALB to reach Grafana on dynamic ports (bridge networking)"
    );

    // ========================================================================
    // ALB ROUTING RULES
    // ========================================================================
    // Priority 100: Grafana paths
    new elbv2.ApplicationListenerRule(this, "GrafanaRule", {
      listener: props.listener,
      priority: 100,
      conditions: [
        elbv2.ListenerCondition.pathPatterns([
          `${props.grafanaRootUrl ?? MONITORING_ROUTES.GRAFANA}*`,
        ]),
      ],
      targetGroups: [this.grafanaTargetGroup],
    });

    // Priority 200: Prometheus paths
    new elbv2.ApplicationListenerRule(this, "PrometheusRule", {
      listener: props.listener,
      priority: 200,
      conditions: [
        elbv2.ListenerCondition.pathPatterns([
          `${props.prometheusRoutePrefix ?? MONITORING_ROUTES.PROMETHEUS}*`,
        ]),
      ],
      targetGroups: [this.prometheusTargetGroup],
    });

    // ========================================================================
    // ATTACH SERVICES TO TARGET GROUPS
    // ========================================================================
    // Grafana: ECS will register instance with dynamic port
    this.grafanaTargetGroup.addTarget(
      this.grafanaService.loadBalancerTarget({
        containerName: "grafana",
        containerPort: MONITORING_PORTS.GRAFANA,
      })
    );

    // Prometheus: Uses fixed port 9090
    this.prometheusTargetGroup.addTarget(
      this.prometheusService.loadBalancerTarget({
        containerName: "prometheus",
        containerPort: MONITORING_PORTS.PROMETHEUS,
      })
    );
  }

  /**
   * Create CloudFormation outputs
   */
  private createOutputs(props: MonitoringServiceStackProps): void {
    const enableExports = props.enableExports ?? false;
    const exportPrefix = props.projectName
      ? `${props.envName}-${props.projectName}`
      : `${props.envName}`;

    new cdk.CfnOutput(this, "PrometheusServiceArn", {
      value: this.prometheusService.serviceArn,
      description: `Prometheus ECS service ARN for ${props.envName}`,
      exportName: enableExports
        ? `${exportPrefix}-prometheus-service-arn`
        : undefined,
    });

    new cdk.CfnOutput(this, "GrafanaServiceArn", {
      value: this.grafanaService.serviceArn,
      description: `Grafana ECS service ARN for ${props.envName}`,
      exportName: enableExports
        ? `${exportPrefix}-grafana-service-arn`
        : undefined,
    });

    new cdk.CfnOutput(this, "NodeExporterServiceArn", {
      value: this.nodeExporterService.serviceArn,
      description: `Node Exporter ECS service ARN for ${props.envName}`,
      exportName: enableExports
        ? `${exportPrefix}-node-exporter-service-arn`
        : undefined,
    });

    new cdk.CfnOutput(this, "PrometheusTargetGroupArn", {
      value: this.prometheusTargetGroup.targetGroupArn,
      description: "Prometheus ALB target group ARN",
    });

    new cdk.CfnOutput(this, "GrafanaTargetGroupArn", {
      value: this.grafanaTargetGroup.targetGroupArn,
      description: "Grafana ALB target group ARN",
    });

    // SSM parameters info
    if (this.ssmParameters) {
      new cdk.CfnOutput(this, "SsmParameterPrefix", {
        value: this.ssmParameters.pathPrefix,
        description: "SSM Parameter Store path prefix for monitoring services",
      });
    }
  }
}
