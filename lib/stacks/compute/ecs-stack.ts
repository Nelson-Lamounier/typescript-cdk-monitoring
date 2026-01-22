/** @format */

import * as cdk from "aws-cdk-lib";
import * as autoscaling from "aws-cdk-lib/aws-autoscaling";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as cw from "aws-cdk-lib/aws-cloudwatch";
import { Tags } from "aws-cdk-lib";
import { NagSuppressions } from "cdk-nag";
import { Construct } from "constructs";

import { EcsTaskExecutionRole } from "../../constructs/iam/ecs-task-execution-role";
import { SuppressionManager } from "../../cdk-nag/suppression-manager";
import { CrossAccountTarget } from "../../types";
import { EcsApplicationConfig } from "../../types/ecs-service-config";
import { getInstanceTypeFromConfig } from "../../shared/helpers/instance-type-helper";
import { getProjectConfig } from "../../../config/projects";

import { LaunchTemplateConstruct } from "./launch-template-stack";

/**
 * Generates a valid AWS ECS capacity provider name
 *
 * AWS ECS capacity provider names must:
 * - Not start with "aws", "ecs", or "fargate" (case-insensitive)
 * - Only contain letters, numbers, underscores, and hyphens
 * - Be between 1 and 255 characters
 *
 * @param envName - Environment name (e.g., "development", "production")
 * @param applicationName - Application name (e.g., "monitoring", "api")
 * @returns Validated capacity provider name
 * @throws Error if the generated name is invalid after all transformations
 */
function generateCapacityProviderName(
  envName: string,
  applicationName: string
): string {
  // Generate base name: envName-applicationName-capacity-provider
  let capacityProviderName = `${envName}-${applicationName}-capacity-provider`
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-") // Replace invalid characters with hyphens
    .replace(/^-+|-+$/g, "") // Remove leading/trailing hyphens
    .substring(0, 255); // Enforce maximum length

  // Ensure name doesn't start with forbidden prefixes
  // AWS rejects names that START with "aws", "ecs", or "fargate" (case-insensitive)
  const forbiddenPrefixes = ["aws", "ecs", "fargate"];
  const lowerName = capacityProviderName.toLowerCase();

  // Check if name starts with any forbidden prefix (with or without hyphen/underscore)
  let needsPrefix = false;
  for (const prefix of forbiddenPrefixes) {
    if (
      lowerName === prefix ||
      lowerName.startsWith(`${prefix}-`) ||
      lowerName.startsWith(`${prefix}_`) ||
      lowerName.startsWith(prefix) // Catches "ecsmonitoring", "aws123", etc.
    ) {
      needsPrefix = true;
      break;
    }
  }

  // Add "cp-" prefix if name starts with forbidden prefix
  if (needsPrefix) {
    capacityProviderName = `cp-${capacityProviderName}`;
  }

  // Final validation: ensure the name is valid after all transformations
  if (!capacityProviderName || capacityProviderName.length === 0) {
    throw new Error(
      `Invalid capacity provider name: empty after transformations. ` +
        `envName: "${envName}", applicationName: "${applicationName}"`
    );
  }

  // Double-check: ensure final name doesn't start with forbidden prefix
  const finalLowerName = capacityProviderName.toLowerCase();
  for (const prefix of forbiddenPrefixes) {
    if (finalLowerName.startsWith(prefix)) {
      throw new Error(
        `Capacity provider name "${capacityProviderName}" still starts with forbidden prefix "${prefix}" after transformations. ` +
          `This should not happen - please report this as a bug.`
      );
    }
  }

  // Ensure name only contains valid characters
  if (!/^[a-zA-Z0-9_-]+$/.test(capacityProviderName)) {
    throw new Error(
      `Capacity provider name "${capacityProviderName}" contains invalid characters. ` +
        `Only letters, numbers, underscores, and hyphens are allowed.`
    );
  }

  return capacityProviderName;
}

export interface LoadBalancerTargetConfig {
  targetGroup: elbv2.IApplicationTargetGroup;
  containerName: string;
  containerPort: number;
}

export interface ServiceAlarmConfig {
  enabled: boolean;
  cpuThreshold?: number;
  memoryThreshold?: number;
  alarmBehavior?: ecs.AlarmBehavior;
}

export interface EcsServiceConstructProps {
  cluster: ecs.ICluster;
  taskDefinition: ecs.TaskDefinition;
  envName: string;
  serviceName?: string;
  desiredCount?: number;
  minHealthyPercent?: number;
  maxHealthyPercent?: number;
  healthCheckGracePeriod?: cdk.Duration;
  enableCircuitBreaker?: boolean;
  enableExecuteCommand?: boolean;
  loadBalancerTarget?: LoadBalancerTargetConfig;
  alarmConfig?: ServiceAlarmConfig;
  placementStrategies?: ecs.PlacementStrategy[];
}

/**
 * Reusable construct for creating ECS Services
 * Handles service configuration, load balancer attachment, and alarms
 */
export class EcsServiceConstruct extends Construct {
  public readonly service: ecs.Ec2Service;
  public cpuAlarm?: cw.Alarm;
  public memoryAlarm?: cw.Alarm;

  constructor(scope: Construct, id: string, props: EcsServiceConstructProps) {
    super(scope, id);

    // Create ECS Service
    this.service = new ecs.Ec2Service(this, "Service", {
      cluster: props.cluster,
      taskDefinition: props.taskDefinition as ecs.Ec2TaskDefinition,
      desiredCount: props.desiredCount || 1,
      serviceName: props.serviceName || `ecs-service-${props.envName}`,

      // Placement strategy for better distribution
      placementStrategies: props.placementStrategies || [
        ecs.PlacementStrategy.spreadAcrossInstances(),
        ecs.PlacementStrategy.packedByCpu(),
      ],

      // Circuit breaker configuration
      circuitBreaker: {
        enable: props.enableCircuitBreaker !== false,
        rollback: props.enableCircuitBreaker !== false,
      },

      // Deployment configuration
      minHealthyPercent: props.minHealthyPercent ?? 0,
      maxHealthyPercent: props.maxHealthyPercent ?? 200,

      // Health check grace period
      healthCheckGracePeriod:
        props.healthCheckGracePeriod || cdk.Duration.seconds(120),

      // Enable ECS Exec
      enableExecuteCommand: props.enableExecuteCommand,
    });

    // Attach to load balancer if configured
    if (props.loadBalancerTarget) {
      this.attachToLoadBalancer(props.loadBalancerTarget);
    }

    // Create alarms if configured
    if (props.alarmConfig?.enabled) {
      this.createAlarms(props.alarmConfig, props.envName);
    }

    // Tag service
    Tags.of(this.service).add("Environment", props.envName);
    Tags.of(this.service).add("ManagedBy", "CDK");
    Tags.of(this.service).add("Service", "ECS");
  }

  /**
   * Attach service to load balancer target group
   */
  private attachToLoadBalancer(config: LoadBalancerTargetConfig): void {
    config.targetGroup.addTarget(
      this.service.loadBalancerTarget({
        containerName: config.containerName,
        containerPort: config.containerPort,
      })
    );
  }

  /**
   * Create CloudWatch alarms for the service
   */
  private createAlarms(config: ServiceAlarmConfig, envName: string): void {
    const alarmNames: string[] = [];

    // CPU Alarm
    if (config.cpuThreshold !== undefined) {
      const cpuAlarmName = `${envName}-ECS-CPU-Alarm`;
      this.cpuAlarm = new cw.Alarm(this, "CPUAlarm", {
        alarmName: cpuAlarmName,
        metric: this.service.metricCpuUtilization(),
        threshold: config.cpuThreshold,
        evaluationPeriods: 2,
        comparisonOperator: cw.ComparisonOperator.GREATER_THAN_THRESHOLD,
      });
      alarmNames.push(cpuAlarmName);
    }

    // Memory Alarm
    if (config.memoryThreshold !== undefined) {
      const memoryAlarmName = `${envName}-ECS-Memory-Alarm`;
      this.memoryAlarm = new cw.Alarm(this, "MemoryAlarm", {
        alarmName: memoryAlarmName,
        metric: this.service.metricMemoryUtilization(),
        threshold: config.memoryThreshold,
        evaluationPeriods: 2,
        comparisonOperator: cw.ComparisonOperator.GREATER_THAN_THRESHOLD,
      });
      alarmNames.push(memoryAlarmName);
    }

    // Enable deployment alarms if any alarms were created
    if (alarmNames.length > 0) {
      this.service.enableDeploymentAlarms(alarmNames, {
        behavior: config.alarmBehavior ?? ecs.AlarmBehavior.ROLLBACK_ON_ALARM,
      });
    }
  }

  /**
   * Enable auto scaling for the service
   */
  public enableAutoScaling(
    minCapacity: number,
    maxCapacity: number
  ): ecs.ScalableTaskCount {
    return this.service.autoScaleTaskCount({
      minCapacity,
      maxCapacity,
    });
  }

  /**
   * Add target tracking scaling policy based on CPU
   */
  public addCpuScaling(targetUtilizationPercent: number): void {
    const scaling = this.enableAutoScaling(1, 10);
    scaling.scaleOnCpuUtilization("CpuScaling", {
      targetUtilizationPercent,
    });
  }

  /**
   * Add target tracking scaling policy based on memory
   */
  public addMemoryScaling(targetUtilizationPercent: number): void {
    const scaling = this.enableAutoScaling(1, 10);
    scaling.scaleOnMemoryUtilization("MemoryScaling", {
      targetUtilizationPercent,
    });
  }
}

export interface ContainerConfig {
  name: string;
  image: ecs.ContainerImage;
  containerPort?: number; // Optional - not needed for HOST mode without explicit port mapping
  hostPort?: number; // Optional - if set, uses static host port mapping (required for metrics scraping)
  cpu?: number;
  memoryLimitMiB?: number;
  memoryReservationMiB?: number;
  environment?: { [key: string]: string };
  secrets?: { [key: string]: ecs.Secret };
  command?: string[];
  logStreamPrefix?: string;
  logGroup?: logs.ILogGroup; // Optional - specific log group to use (if not provided, ECS will auto-create)
  user?: string; // Optional - run container as specific user (e.g., "472" for Grafana)
}

export interface EcsTaskDefinitionConstructProps {
  envName: string;
  networkMode?: ecs.NetworkMode;
  containers: ContainerConfig[];
  grantEcrReadAccess?: boolean;
  taskRole?: iam.IRole;
  executionRole?: iam.IRole;
  volumes?: ecs.Volume[];
}

/**
 * Reusable construct for creating ECS Task Definitions with containers
 * Supports multiple containers and flexible configuration
 */
export class EcsTaskDefinitionConstruct extends Construct {
  public readonly taskDefinition: ecs.Ec2TaskDefinition;
  public readonly containers: Map<string, ecs.ContainerDefinition>;

  constructor(
    scope: Construct,
    id: string,
    props: EcsTaskDefinitionConstructProps
  ) {
    super(scope, id);

    this.containers = new Map();

    // Create or use provided execution role
    let executionRole = props.executionRole;
    if (!executionRole && props.grantEcrReadAccess !== false) {
      // Collect all log group ARNs from containers that specify them
      const logGroupArns = props.containers
        .map((c) => c.logGroup?.logGroupArn)
        .filter((arn): arn is string => arn !== undefined);

      // Use centralized ECS task execution role construct
      const executionRoleConstruct = new EcsTaskExecutionRole(
        this,
        "ExecutionRole",
        {
          envName: props.envName,
          enablePublicEcr: false, // Only enable if needed
          // If all containers use the same log group, pass it for more specific permissions
          // Otherwise, use the default pattern matching
          logGroupArn: logGroupArns.length === 1 ? logGroupArns[0] : undefined,
        }
      );
      executionRole = executionRoleConstruct.role;
    }

    // Create Task Definition
    this.taskDefinition = new ecs.Ec2TaskDefinition(this, "TaskDef", {
      networkMode: props.networkMode || ecs.NetworkMode.BRIDGE,
      taskRole: props.taskRole,
      executionRole: executionRole,
    });

    // Add volumes if provided
    if (props.volumes) {
      props.volumes.forEach((volume) => {
        this.taskDefinition.addVolume(volume);
      });
    }

    // Add containers
    props.containers.forEach((containerConfig) => {
      this.addContainer(containerConfig, props.envName);
    });

    // Tag task definition
    Tags.of(this.taskDefinition).add("Environment", props.envName);
    Tags.of(this.taskDefinition).add("ManagedBy", "CDK");

    // CDK Nag suppressions for task definition
    if (this.taskDefinition.taskRole) {
      NagSuppressions.addResourceSuppressions(
        this.taskDefinition.taskRole,
        [
          {
            id: "AwsSolutions-IAM5",
            reason:
              "CloudWatch Logs permissions use wildcard for log streams within log groups. This allows ECS to create log streams dynamically for containers.",
            appliesTo: [
              "Resource::arn:aws:logs:*:*:log-group:*:*",
              "Resource::arn:aws:logs:*:*:log-group:<*>:*",
            ],
          },
        ],
        true
      );
    }
  }

  /**
   * Add a container to the task definition
   */
  private addContainer(config: ContainerConfig, _envName: string): void {
    // Configure logging: Use awslogs driver for ECS console integration
    // The awslogs driver automatically captures stdout/stderr from container processes
    // and sends them to CloudWatch Logs, enabling the ECS console "Logs" tab
    let logging: ecs.LogDriver | undefined;
    if (config.logStreamPrefix && config.logGroup) {
      // Use awslogs driver with explicit log group - enables ECS console "Logs" tab
      // Logs are sent directly to CloudWatch Logs via the awslogs driver
      // This captures stdout/stderr from the container process
      logging = ecs.LogDrivers.awsLogs({
        logGroup: config.logGroup,
        streamPrefix: config.logStreamPrefix,
      });
    } else if (config.logStreamPrefix) {
      // Fallback: Use awslogs with auto-created log group if logGroup not provided
      // Still captures stdout/stderr and enables ECS console integration
      logging = ecs.LogDrivers.awsLogs({
        streamPrefix: config.logStreamPrefix,
      });
    } else if (config.logGroup) {
      // If logGroup is provided but no prefix, use container name as prefix
      logging = ecs.LogDrivers.awsLogs({
        logGroup: config.logGroup,
        streamPrefix: config.name,
      });
    } else {
      // Default: Auto-create log group with container name as prefix
      // Ensures all containers have logging configured to capture stdout/stderr
      logging = ecs.LogDrivers.awsLogs({
        streamPrefix: config.name,
      });
    }

    const container = this.taskDefinition.addContainer(config.name, {
      image: config.image,
      logging: logging,
      memoryReservationMiB: config.memoryReservationMiB || 512,
      memoryLimitMiB: config.memoryLimitMiB,
      cpu: config.cpu,
      environment: config.environment,
      secrets: config.secrets,
      command: config.command,
      user: config.user, // Run container as specific user if specified
    });

    // Add port mapping only if containerPort is specified
    // For HOST mode, port mapping is optional as container uses host network directly
    if (config.containerPort !== undefined) {
      let hostPort: number;

      if (this.taskDefinition.networkMode === ecs.NetworkMode.HOST) {
        // HOST mode: container uses host network directly
        hostPort = config.containerPort;
      } else if (config.hostPort !== undefined) {
        // BRIDGE mode with static host port (for metrics scraping)
        hostPort = config.hostPort;
      } else {
        // BRIDGE mode with dynamic port (default)
        hostPort = 0;
      }

      container.addPortMappings({
        containerPort: config.containerPort,
        hostPort: hostPort,
        protocol: ecs.Protocol.TCP,
      });
    }

    this.containers.set(config.name, container);
  }

  /**
   * Get a specific container by name
   */
  public getContainer(name: string): ecs.ContainerDefinition | undefined {
    return this.containers.get(name);
  }

  /**
   * Add mount points to a specific container
   */
  public addMountPoints(
    containerName: string,
    ...mountPoints: ecs.MountPoint[]
  ): void {
    const container = this.containers.get(containerName);
    if (!container) {
      throw new Error(`Container ${containerName} not found`);
    }
    container.addMountPoints(...mountPoints);
  }
}

/** @format */

export interface EcsStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
  envName: string;
  /**
   * Application configuration defining services, volumes, and load balancer
   */
  applicationConfig: EcsApplicationConfig;
  /**
   * Cross-account targets for monitoring (optional, used for Prometheus scrape config)
   */
  crossAccountTargets?: CrossAccountTarget[];
  /**
   * Custom user data script (optional, will use default if not provided)
   */
  customUserData?: string[];
}

export class EcsStack extends cdk.Stack {
  public readonly cluster: ecs.Cluster;
  public readonly services: Map<string, ecs.Ec2Service>; // Empty - services created in separate stack
  public readonly serviceUrls: Map<string, string>; // Empty - services created in separate stack
  public readonly autoScalingGroup: autoscaling.AutoScalingGroup; // Exposed for use by services stack
  private readonly applicationConfig: EcsApplicationConfig;

  constructor(scope: Construct, id: string, props: EcsStackProps) {
    super(scope, id, props);

    const {
      vpc,
      envName,
      applicationConfig,
      crossAccountTargets,
      customUserData,
    } = props;

    this.applicationConfig = applicationConfig;

    // Extract EBS volume configuration
    const ebsVolumes = applicationConfig.ebsVolumes || [];
    const volumeConfigs = ebsVolumes.map(
      (vol: {
        deviceName: string;
        sizeGB: number;
        mountPath: string;
        volumeType?: "gp3" | "gp2" | "io1" | "io2";
        deleteOnTermination?: boolean;
      }) => ({
        deviceName: vol.deviceName,
        sizeGB: vol.sizeGB,
        mountPath: vol.mountPath,
        volumeType:
          vol.volumeType === "gp3"
            ? ec2.EbsDeviceVolumeType.GP3
            : vol.volumeType === "gp2"
            ? ec2.EbsDeviceVolumeType.GP2
            : vol.volumeType === "io1"
            ? ec2.EbsDeviceVolumeType.IO1
            : ec2.EbsDeviceVolumeType.GP3,
        deleteOnTermination: vol.deleteOnTermination ?? false,
      })
    );

    // Create ECS Cluster with dynamic EBS volumes
    const { cluster, autoScalingGroup } = this.createEcsCluster(
      vpc,
      envName,
      applicationConfig.applicationName,
      crossAccountTargets,
      volumeConfigs,
      customUserData
    );
    this.cluster = cluster;
    this.autoScalingGroup = autoScalingGroup;

    // Create CloudWatch Log Groups for application services
    const taskLogGroup = new logs.LogGroup(this, "TaskLogs", {
      logGroupName: `/ecs/${this.stackName}/tasks`,
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const eventLogGroup = new logs.LogGroup(this, "EcsEvents", {
      logGroupName: `/ecs/${this.stackName}/events`,
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Configure ECS to send events to CloudWatch Logs
    new cdk.aws_events.Rule(this, "EcsEventRule", {
      description: `Capture ECS events for ${envName} ${applicationConfig.applicationName} cluster`,
      eventPattern: {
        source: ["aws.ecs"],
        detailType: [
          "ECS Task State Change",
          "ECS Container Instance State Change",
          "ECS Service Action",
        ],
        detail: {
          clusterArn: [this.cluster.clusterArn],
        },
      },
      targets: [new cdk.aws_events_targets.CloudWatchLogGroup(eventLogGroup)],
    });

    // Note: Load balancer is now created in EcsServicesStack to avoid cyclic dependencies
    // This stack only creates infrastructure (cluster, capacity)

    // Initialize services map (empty - services created in separate stack)
    this.services = new Map();
    this.serviceUrls = new Map();

    // Create outputs (cluster and load balancer for use by services stack)
    this.createOutputs(taskLogGroup, eventLogGroup, envName);

    // ========================================================================
    // CDK NAG SUPPRESSIONS
    // ========================================================================
    SuppressionManager.applyToStack(this, "ComputeStack", envName);

    // ========================================================================
    // RESOURCE TAGGING
    // ========================================================================
    cdk.Tags.of(this).add("Stack", "EcsStack");
    cdk.Tags.of(this).add("Application", applicationConfig.applicationName);
    cdk.Tags.of(this).add("Environment", envName);
    cdk.Tags.of(this).add("ManagedBy", "CDK");
  }

  /**
   * Create ECS cluster with EC2 capacity and dynamic EBS volumes
   * Uses LaunchTemplateConstruct for consistent, secure launch template configuration
   * EBS volumes are attached via launch template for persistent storage
   */
  private createEcsCluster(
    vpc: ec2.IVpc,
    envName: string,
    applicationName: string,
    crossAccountTargets?: CrossAccountTarget[],
    ebsVolumes?: Array<{
      deviceName: string;
      sizeGB: number;
      volumeType: ec2.EbsDeviceVolumeType;
      deleteOnTermination: boolean;
    }>,
    customUserData?: string[]
  ): { cluster: ecs.Cluster; autoScalingGroup: autoscaling.AutoScalingGroup } {
    // Constrain ECS capacity to the first public AZ
    const publicAz0Subnets = vpc.selectSubnets({
      subnetType: ec2.SubnetType.PUBLIC,
      availabilityZones: [vpc.availabilityZones[0]],
      onePerAz: true,
    });

    const clusterName = `${envName}-${applicationName}-cluster`;
    const cluster = new ecs.Cluster(this, "ApplicationCluster", {
      vpc,
      clusterName,
    });

    // Enable Container Insights if configured
    const enableContainerInsights =
      this.applicationConfig.cluster?.enableContainerInsights ?? false;
    if (enableContainerInsights) {
      const cfnCluster = cluster.node.defaultChild as ecs.CfnCluster;
      cfnCluster.clusterSettings = [
        {
          name: "containerInsights",
          value: "enabled",
        },
      ];
    }

    // Create ECS-compatible user data for the launch template
    const ecsUserData = ec2.UserData.forLinux();
    if (customUserData && customUserData.length > 0) {
      ecsUserData.addCommands(...customUserData);
    } else {
      ecsUserData.addCommands(
        "#!/bin/bash",
        // ECS configuration - CRITICAL for ECS cluster integration
        `echo ECS_CLUSTER=${clusterName} >> /etc/ecs/ecs.config`,
        "echo ECS_ENABLE_CONTAINER_METADATA=true >> /etc/ecs/ecs.config",
        "echo ECS_ENABLE_TASK_IAM_ROLE=true >> /etc/ecs/ecs.config",
        "echo ECS_AWSVPC_BLOCK_IMDS=true >> /etc/ecs/ecs.config",
        // System updates and ECS agent
        "yum update -y",
        "yum install -y amazon-cloudwatch-agent",
        "systemctl enable ecs",
        "systemctl start ecs",
        // Security: Block container access to IMDS
        "iptables --insert FORWARD 1 --in-interface docker+ --destination 169.254.169.254/32 --jump DROP",
        "service iptables save"
      );
    }

    // Create launch template using LaunchTemplateConstruct
    // This ensures IMDSv2 is required and follows security best practices
    // Instance type is read from centralised configuration (config/projects.ts)
    const projectConfig = getProjectConfig(
      props.applicationName || "webapp",
      envName
    );
    const instanceType = getInstanceTypeFromConfig(projectConfig, "t3.small");

    const launchTemplateConstruct = new LaunchTemplateConstruct(
      this,
      "EcsLaunchTemplate",
      {
        vpc,
        envName,
        instanceType,
        // Using Amazon Linux 2023 ECS-optimized AMI (Amazon Linux 2 reaches EOL June 30, 2026)
        machineImage: ecs.EcsOptimizedImage.amazonLinux2023(),
        userData: ecsUserData,
        enableMonitoring: true,
        associatePublicIpAddress: true,
        blockDevices: [
          {
            deviceName: "/dev/xvda",
            // ECS-optimized AMI snapshots require at least 30GB minimum
            volume: ec2.BlockDeviceVolume.ebs(30, {
              volumeType: ec2.EbsDeviceVolumeType.GP3,
              encrypted: true,
              deleteOnTermination: true,
            }),
          },
          // Add dynamic EBS volumes from configuration
          ...(ebsVolumes?.map((vol) => ({
            deviceName: vol.deviceName,
            volume: ec2.BlockDeviceVolume.ebs(vol.sizeGB, {
              volumeType: vol.volumeType,
              encrypted: true,
              deleteOnTermination: vol.deleteOnTermination,
            }),
          })) || []),
        ],
      }
    );

    // IMDSv2 is already configured by LaunchTemplateConstruct - no need for redundant overrides

    // Add ECS managed policy to the launch template's IAM role
    launchTemplateConstruct.role.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName(
        "service-role/AmazonEC2ContainerServiceforEC2Role"
      )
    );

    // Create Auto Scaling Group using the launch template from LaunchTemplateConstruct
    const autoScalingGroup = new autoscaling.AutoScalingGroup(
      this,
      "MonitoringCapacity",
      {
        vpc,
        launchTemplate: launchTemplateConstruct.launchTemplate,
        minCapacity: 1,
        maxCapacity: 1,
        desiredCapacity: 1,
        vpcSubnets: { subnets: publicAz0Subnets.subnets },
        healthChecks: autoscaling.HealthChecks.ec2({
          gracePeriod: cdk.Duration.seconds(300),
        }),
      }
    );

    // Add the Auto Scaling Group as a capacity provider to the cluster
    // Generate valid capacity provider name using shared helper function
    const capacityProviderName = generateCapacityProviderName(
      envName,
      applicationName
    );

    // Create capacity provider using low-level CFN construct to ensure name control
    // WHY: AWS ECS capacity provider names cannot start with "aws", "ecs", or "fargate".
    // The high-level AsgCapacityProvider construct doesn't reliably allow name overrides.
    const cfnCapacityProvider = new ecs.CfnCapacityProvider(
      this,
      "AsgCapacityProvider",
      {
        name: capacityProviderName,
        autoScalingGroupProvider: {
          autoScalingGroupArn: autoScalingGroup.autoScalingGroupArn,
          managedTerminationProtection: "DISABLED",
        },
        tags: [
          { key: "Environment", value: envName },
          { key: "Application", value: applicationName },
        ],
      }
    );

    // Add capacity provider association directly using CFN
    // This ensures the capacity provider is associated with the cluster in CloudFormation
    // Use the capacity provider name (string) as required by CfnClusterCapacityProviderAssociations
    new ecs.CfnClusterCapacityProviderAssociations(
      this,
      "ClusterCapacityProviderAssociation",
      {
        cluster: cluster.clusterName,
        capacityProviders: [capacityProviderName],
        defaultCapacityProviderStrategy: [],
      }
    );

    // Reference the capacity provider to ensure it's created (prevents unused variable warning)
    cfnCapacityProvider.node.addDependency(autoScalingGroup);

    // Build and apply UserData with dynamic EBS volume configuration
    const userDataCommands = this.buildUserData(
      envName,
      applicationName,
      (this.applicationConfig.ebsVolumes || []).map((vol) => ({
        deviceName: vol.deviceName,
        sizeGB: vol.sizeGB,
        mountPath: vol.mountPath,
      })),
      crossAccountTargets
    );
    autoScalingGroup.addUserData(...userDataCommands);

    // Security group rules
    autoScalingGroup.connections.allowToAnyIpv4(
      ec2.Port.tcp(443),
      "Allow HTTPS outbound for ECS agent and S3"
    );

    // Allow internal communication between services (if needed)
    // This is application-specific and can be configured per service

    cdk.Tags.of(cluster).add("Environment", envName);
    cdk.Tags.of(cluster).add("Application", applicationName);

    return { cluster, autoScalingGroup };
  }

  /**
   * Build UserData script that:
   * 1. Formats and mounts EBS volumes dynamically from configuration
   * 2. Creates necessary directories
   * 3. Starts ECS agent after setup completes
   */
  private buildUserData(
    envName: string,
    applicationName: string,
    ebsVolumes: Array<{
      deviceName: string;
      sizeGB: number;
      mountPath: string;
    }>,
    _crossAccountTargets?: CrossAccountTarget[]
  ): string[] {
    const region = cdk.Stack.of(this).region;

    // EBS volume setup commands (dynamic based on configuration)
    const ebsCommands = this.buildEbsVolumeCommands(ebsVolumes);

    return [
      "#!/bin/bash",
      "set -ex",
      "",
      "# ==========================================================================",
      "# APPLICATION STACK PROVISIONING SCRIPT",
      "# This script is generated by CDK and runs on EC2 instance startup",
      "# ==========================================================================",
      "",
      `exec > >(tee -a /var/log/${applicationName}-setup.log) 2>&1`,
      "",
      "echo '========================================='",
      `echo '${applicationName} Setup Started'`,
      `echo 'Environment: ${envName}'`,
      `echo 'Region: ${region}'`,
      "date",
      "echo '========================================='",
      "",
      "# Stop ECS agent until setup completes to prevent task scheduling",
      "echo 'Stopping ECS agent...'",
      "systemctl stop ecs || true",
      "",
      "# Add ec2-user to docker group",
      "usermod -a -G docker ec2-user",
      "",
      "# ==========================================================================",
      "# EBS VOLUME SETUP",
      "# ==========================================================================",
      ...ebsCommands,
      "",
      "# ==========================================================================",
      "# CREATE REQUIRED DIRECTORIES",
      "# ==========================================================================",
      "echo 'Creating required directories...'",
      // Create directories for all EBS volume mount points
      ...ebsVolumes.map((vol) => `mkdir -p ${vol.mountPath}`),
      "",
      "# ==========================================================================",
      "# VERIFICATION",
      "# ==========================================================================",
      "echo '=== Verifying setup ==='",
      "",
      "echo '--- Directory Structure ---'",
      "ls -la /mnt/",
      "",
      "echo '--- EBS Volume Status ---'",
      "df -h | grep -E '(xvdf|xvdg|xvdh|xvdi)' || echo 'No EBS volumes found'",
      "",
      "# Create completion marker",
      `touch /var/lib/cloud/instance/${applicationName}-setup-complete`,
      "",
      "echo '========================================='",
      `echo '✓ ${applicationName} setup completed successfully!'`,
      "date",
      "echo '========================================='",
      "",
      "# ==========================================================================",
      "# START ECS AGENT",
      "# ==========================================================================",
      "echo 'Starting ECS agent...'",
      "systemctl start ecs",
      "systemctl enable ecs",
      "",
      "echo '✓ ECS agent started - ready for task scheduling'",
      "echo ''",
      `echo 'Setup log available at: /var/log/${applicationName}-setup.log'`,
    ];
  }

  /**
   * Build EBS volume setup commands for persistent storage
   * Formats and mounts EBS volumes attached via launch template
   * Dynamic based on volume configuration
   */
  private buildEbsVolumeCommands(
    ebsVolumes: Array<{
      deviceName: string;
      sizeGB: number;
      mountPath: string;
    }>
  ): string[] {
    if (ebsVolumes.length === 0) {
      return [
        "echo '=== No EBS volumes configured ==='",
        "echo 'Skipping EBS volume setup'",
      ];
    }

    const commands: string[] = [
      "echo '=== Setting up EBS volumes for persistent storage ==='",
      "",
      "# Wait for EBS volumes to be attached (volumes are attached via launch template)",
      "echo 'Waiting for EBS volumes to be available...'",
      "sleep 5",
      "",
    ];

    // Generate commands for each volume
    for (const volume of ebsVolumes) {
      const deviceName = volume.deviceName;
      const mountPath = volume.mountPath;
      const volumeName = mountPath.split("/").pop() || "volume";

      commands.push(
        `# Check if ${volumeName} volume (${deviceName}) exists and format if needed`,
        `if [ -b ${deviceName} ]; then`,
        `  echo 'Found ${volumeName} volume at ${deviceName}'`,
        "  # Check if volume is already formatted",
        `  if ! blkid ${deviceName} > /dev/null 2>&1; then`,
        `    echo 'Formatting ${volumeName} volume with ext4...'`,
        `    mkfs.ext4 -F ${deviceName}`,
        `    echo '✓ ${volumeName} volume formatted'`,
        "  else",
        `    echo '${volumeName} volume already formatted'`,
        "  fi",
        "  ",
        "  # Create mount point and mount volume",
        `  mkdir -p ${mountPath}`,
        `  mount ${deviceName} ${mountPath}`,
        "  ",
        "  # Add to fstab for persistence across reboots",
        `  if ! grep -q '${deviceName}' /etc/fstab; then`,
        `    echo '${deviceName} ${mountPath} ext4 defaults,nofail 0 2' >> /etc/fstab`,
        "  fi",
        "  ",
        `  echo '✓ ${volumeName} volume mounted at ${mountPath}'`,
        "else",
        `  echo 'WARNING: ${volumeName} volume ${deviceName} not found'`,
        `  mkdir -p ${mountPath}`,
        "fi",
        ""
      );
    }

    commands.push(
      "# Verify volumes are mounted",
      "echo '=== Verifying EBS volume mounts ==='",
      "df -h | grep -E '(xvdf|xvdg|xvdh|xvdi)' || echo 'No EBS volumes mounted'",
      "echo '✓ EBS volume setup completed'"
    );

    return commands;
  }

  private createOutputs(
    taskLogGroup: logs.LogGroup,
    eventLogGroup: logs.LogGroup,
    envName: string
  ): void {
    const appName = this.applicationConfig.applicationName;
    const exportPrefix = `${envName}-${appName}`;

    // Output cluster information (exported for use by services stack)
    new cdk.CfnOutput(this, "ClusterName", {
      value: this.cluster.clusterName,
      description: "ECS Cluster Name",
      exportName: `${exportPrefix}-cluster-name`,
    });

    new cdk.CfnOutput(this, "ClusterArn", {
      value: this.cluster.clusterArn,
      description: "ECS Cluster ARN",
      exportName: `${exportPrefix}-cluster-arn`,
    });

    // Note: Load balancer outputs are now in EcsServicesStack

    // Output log groups for reference
    new cdk.CfnOutput(this, "TaskLogGroupName", {
      value: taskLogGroup.logGroupName,
      description: "CloudWatch Log Group for Task Logs",
    });

    new cdk.CfnOutput(this, "EventLogGroupName", {
      value: eventLogGroup.logGroupName,
      description: "CloudWatch Log Group for ECS Events",
    });
  }
}
