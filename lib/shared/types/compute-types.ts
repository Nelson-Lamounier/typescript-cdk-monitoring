/** @format */

import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as kms from "aws-cdk-lib/aws-kms";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as ssm from "aws-cdk-lib/aws-ssm";

export interface EcsExecuteCommandConfig {
  enable?: boolean;
  kmsKey?: kms.IKey;
  logBucket?: s3.IBucket;
  logging?: ecs.ExecuteCommandLogging;
}

export interface EcsCapacityProviderManagedScaling {
  enableManagedScaling?: boolean;
  targetCapacityPercent?: number;
  minimumScalingStepSize?: number;
  maximumScalingStepSize?: number;
}

export interface EcsSpotOptions {
  spotPrice?: string;
}

export interface EcsClusterConstructProps {
  vpc: ec2.IVpc;
  envName: string;
  projectName?: string;
  clusterName?: string;
  instanceType?: ec2.InstanceType;
  minCapacity?: number;
  maxCapacity?: number;
  desiredCapacity?: number;
  usePublicSubnets?: boolean;
  additionalSecurityGroups?: ec2.ISecurityGroup[];
  customLaunchTemplate?: ec2.ILaunchTemplate;
  customUserData?: ec2.UserData;
  enableContainerInsights?: boolean;
  enableFargateCapacityProviders?: boolean;
  enableExecuteCommand?: boolean;
  executeCommandConfig?: EcsExecuteCommandConfig;
  logRetention?: logs.RetentionDays;
  logGroupKmsKey?: kms.IKey;
  logRemovalPolicy?: cdk.RemovalPolicy;
  capacityProviderManagedScaling?: EcsCapacityProviderManagedScaling;
  spotOptions?: EcsSpotOptions;
  detailedMonitoring?: boolean;
  launchTemplateRole?: iam.IRole;
  /**
   * Availability zones to deploy instances in
   * Useful for aligning with EFS mount targets for optimal performance
   */
  availabilityZones?: string[];
}

export interface AutoScalingGroupConstructProps {
  vpc: ec2.IVpc;
  cluster: ecs.ICluster;
  envName: string;
  projectName?: string;
  launchTemplate: ec2.ILaunchTemplate;
  minCapacity?: number;
  maxCapacity?: number;
  desiredCapacity?: number;
  subnetSelection?: ec2.SubnetSelection;
  enableManagedScaling?: boolean;
  enableManagedTerminationProtection?: boolean;
  healthCheckGraceSeconds?: number;
  updateMaxBatchSize?: number;
  updateMinInstancesInService?: number;
  updatePauseTimeSeconds?: number;
}

/**
 * User data strategy for launch template
 */
export type UserDataStrategy = "minimal" | "comprehensive";
export interface EcsConfig {
  clusterName: string;
  enableContainerMetadata?: boolean;
  enableTaskIamRole?: boolean;
}

export interface MonitoringConfig {
  installNodeExporter?: boolean;
  installCloudWatchAgent?: boolean;
}

export interface LaunchTemplateConstructProps {
  vpc: ec2.IVpc;
  envName: string;
  projectName?: string;
  launchTemplateName?: string;
  userDataStrategy?: UserDataStrategy;
  userData?: ec2.UserData;
  ecsConfig?: EcsConfig;
  monitoring?: MonitoringConfig;
  instanceType?: ec2.InstanceType;
  machineImage?: ec2.IMachineImage;
  securityGroup?: ec2.ISecurityGroup;
  additionalSecurityGroups?: ec2.ISecurityGroup[];
  role?: iam.IRole;
  keyPair?: ec2.IKeyPair;
  blockDevices?: ec2.BlockDevice[];
  enableDetailedMonitoring?: boolean;
  associatePublicIpAddress?: boolean;
  customTags?: Record<string, string>;
}

/**
 * Configuration options for UserData construct
 */
export interface UserDataConstructProps {
  /**
   * Environment name (e.g., development, production)
   * Used for tagging and logging context
   */
  envName: string;

  /**
   * ECS cluster name that instances will join
   * Stored in bootstrap metadata for tracking
   */
  clusterName: string;

  /**
   * CloudFormation stack name for signalling completion
   * If provided, UserData will signal CloudFormation on success/failure
   * This ensures the stack doesn't show CREATE_COMPLETE until bootstrap succeeds
   */
  stackName?: string;

  /**
   * CloudFormation logical resource ID for signalling
   * Required if stackName is provided
   * Typically the Auto Scaling Group or Launch Template logical ID
   */
  logicalResourceId?: string;

  /**
   * AWS region for CloudFormation signalling
   * Required if stackName is provided
   */
  region?: string;

  /**
   * Enable system package updates during bootstrap
   *
   * When true:
   * - Updates all system packages to latest versions
   * - Increases boot time by 1-3 minutes
   * - Ensures latest security patches are applied
   *
   * When false:
   * - Relies on AMI being up-to-date
   * - Faster boot time
   * - Recommended for non-production or when using fresh AMIs
   *
   * @default false for non-production, true for production
   */
  enableSystemUpdates?: boolean;

  /**
   * Enable storage of bootstrap metadata in SSM Parameter Store
   *
   * Metadata includes:
   * - Bootstrap timestamp
   * - Environment name
   * - Cluster name
   * - Instance ID
   * - AMI ID
   * - Instance type
   *
   * Useful for:
   * - Tracking which instances have been bootstrapped
   * - Auditing bootstrap configurations
   * - Debugging bootstrap issues
   *
   * @default true
   */
  enableMetadataTracking?: boolean;

  /**
   * SSM parameter path prefix for metadata storage
   * Full path will be: /{prefix}/{envName}/instances/{instanceId}
   *
   * @default /bootstrap
   */
  metadataParameterPrefix?: string;

  /**
   * Custom bootstrap version identifier
   * Stored in metadata for tracking configuration changes
   *
   * @default Generated from current timestamp
   */
  bootstrapVersion?: string;
}

export type EcsLaunchType = "EC2" | "FARGATE";

export type EcsLogDriverType =
  | "awslogs"
  | "fluentd"
  | "splunk"
  | "json-file"
  | "syslog";

export interface ContainerLogConfig {
  driver?: EcsLogDriverType;
  options?: { [key: string]: string };
  splunk?: {
    url: string;
    token: ecs.Secret;
    index?: string;
    source?: string;
    sourceType?: string;
  };
}

export interface ContainerHealthCheckConfig {
  command: string[];
  intervalSeconds?: number;
  timeoutSeconds?: number;
  retries?: number;
  startPeriodSeconds?: number;
}

export interface ContainerDependencyConfig {
  containerName: string;
  condition?: ecs.ContainerDependencyCondition;
}

export interface ContainerLinuxParametersConfig {
  capabilities?: {
    add?: ecs.Capability[];
    drop?: ecs.Capability[];
  };
  devices?: ecs.Device[];
  tmpfs?: ecs.Tmpfs[];
  sharedMemorySize?: number;
  maxSwap?: number;
  swappiness?: number;
  initProcessEnabled?: boolean;
  ulimits?: ecs.Ulimit[];
}

export interface ContainerConfig {
  name: string;
  image: ecs.ContainerImage;
  containerPort?: number;
  hostPort?: number;
  cpu?: number;
  memoryLimitMiB?: number;
  memoryReservationMiB?: number;
  environment?: { [key: string]: string };
  environmentFiles?: ecs.EnvironmentFile[];
  secrets?: { [key: string]: ecs.Secret };
  command?: string[];
  entryPoint?: string[];
  logStreamPrefix?: string;
  logGroup?: logs.ILogGroup;
  logConfiguration?: ContainerLogConfig;
  user?: string;
  healthCheck?: ContainerHealthCheckConfig;
  dependencies?: ContainerDependencyConfig[];
  linuxParameters?: ContainerLinuxParametersConfig;
  portProtocol?: ecs.Protocol;
}

export interface EcsTaskDefinitionConstructProps {
  envName: string;
  projectName?: string;
  launchType?: EcsLaunchType;
  networkMode?: ecs.NetworkMode;
  containers: ContainerConfig[];
  grantEcrReadAccess?: boolean;
  taskRole?: iam.IRole;
  executionRole?: iam.IRole;
  volumes?: ecs.Volume[];
  enableExecuteCommand?: boolean;
  cpu?: number; // Required for Fargate
  memoryMiB?: number; // Required for Fargate
  ephemeralStorageGiB?: number; // Fargate only
  placementConstraints?: ecs.PlacementConstraint[];
  runtimePlatform?: ecs.RuntimePlatform;
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

export interface AwsvpcConfigurationLite {
  assignPublicIp?: boolean | "ENABLED" | "DISABLED";
  securityGroups?: string[];
  subnets?: string[];
}

export interface EcsServiceConstructProps {
  cluster: ecs.ICluster;
  taskDefinition: ecs.TaskDefinition;
  envName: string;
  projectName?: string;
  serviceName?: string;
  desiredCount?: number;
  minHealthyPercent?: number;
  maxHealthyPercent?: number;
  healthCheckGracePeriod?: cdk.Duration;
  enableCircuitBreaker?: boolean;
  enableExecuteCommand?: boolean;
  loadBalancerTargets?: LoadBalancerTargetConfig[];
  alarmConfig?: ServiceAlarmConfig;
  placementStrategies?: ecs.PlacementStrategy[];
  capacityProviderStrategies?: ecs.CapacityProviderStrategy[];
  networkConfiguration?: { awsvpcConfiguration?: AwsvpcConfigurationLite };
  cloudMapOptions?: ecs.CloudMapOptions;
  deploymentController?: ecs.DeploymentController;
  deploymentAlarms?: ecs.DeploymentAlarmConfig;
  scalingConfig?: {
    minCapacity?: number;
    maxCapacity?: number;
    cpuTargetUtilizationPercent?: number;
    memoryTargetUtilizationPercent?: number;
  };
  launchType?: EcsLaunchType;
}

export interface SsmAssociationConfig {
  scheduleExpression?: string;
  applyOnlyAtCronInterval?: boolean;
  complianceSeverity?: string;
  maxConcurrency?: string;
  maxErrors?: string;
  targets?: ssm.CfnAssociation.TargetProperty[];
}

export interface EcsAgentSsmConfig extends SsmAssociationConfig {
  dockerMaxRetries?: number;
  dockerRetryDelaySeconds?: number;
  ecsStartMaxRetries?: number;
  ecsStartRetryDelaySeconds?: number;
  agentCheckMaxRetries?: number;
  agentCheckDelaySeconds?: number;
}

export interface CloudWatchAgentSsmLogConfig {
  containerLogGroupName?: string;
  ecsAgentLogGroupName?: string;
  ecsInitLogGroupName?: string;
  logRetention?: logs.RetentionDays;
  logGroupKmsKey?: kms.IKey;
}

export interface CloudWatchAgentSsmConfig extends SsmAssociationConfig {
  logConfig?: CloudWatchAgentSsmLogConfig;
}

export interface SsmStateManagerConstructProps {
  envName: string;
  projectName?: string;
  clusterName: string;
  instanceRole: iam.IRole;
  targets?: ssm.CfnAssociation.TargetProperty[];
  ecsAgent?: EcsAgentSsmConfig;
  cloudWatchAgent?: CloudWatchAgentSsmConfig;
  /**
   * EFS file system ID for mounting
   * Required for ECS instances to access EFS storage
   */
  fileSystemId?: string;
  /**
   * EFS mount point on EC2 instances
   * @default /mnt/efs
   */
  efsMountPoint?: string;
}
