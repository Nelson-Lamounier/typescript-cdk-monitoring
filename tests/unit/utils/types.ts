/** @format */

/**
 * Centralized Type Definitions for Test Utilities
 *
 * All interfaces and types used across security and unit tests
 */

import { Stack } from "aws-cdk-lib";

// =============================================================================
// Generic Types
// =============================================================================

/**
 * Generic type for stack collections used in tests
 */
export interface BaseTestStacks {
  [key: string]: Stack | unknown;
}

/**
 * Resource with logical ID from CloudFormation template
 */
export interface ResourceWithId {
  logicalId: string;
  resource: unknown;
}

// =============================================================================
// ALB (Application Load Balancer) Types
// =============================================================================

export interface AlbAttribute {
  Key: string;
  Value: string;
}

export interface AlbProperties {
  LoadBalancerAttributes?: AlbAttribute[];
  Scheme?: string;
  SecurityGroups?: unknown[];
  Subnets?: unknown[];
}

// =============================================================================
// Target Group Types
// =============================================================================

export interface TargetGroupAttribute {
  Key: string;
  Value: string;
}

export interface TargetGroupHealthCheck {
  HealthCheckPath?: string;
  HealthCheckProtocol?: string;
  HealthCheckIntervalSeconds?: number;
  HealthyThresholdCount?: number;
  UnhealthyThresholdCount?: number;
  HealthCheckTimeoutSeconds?: number;
}

export interface TargetGroupProperties extends TargetGroupHealthCheck {
  TargetGroupAttributes?: TargetGroupAttribute[];
  Port?: number;
  Protocol?: string;
  TargetType?: string;
  VpcId?: unknown;
}

// =============================================================================
// ECS Task Definition Types
// =============================================================================

export interface ContainerLogConfiguration {
  LogDriver: string;
  Options?: Record<string, string>;
}

export interface ContainerEnvironmentVariable {
  Name: string;
  Value: string;
}

export interface ContainerSecret {
  Name: string;
  ValueFrom: string;
}

export interface ContainerDefinition {
  Name?: string;
  Image?: string;
  Memory?: number;
  MemoryReservation?: number;
  Cpu?: number;
  Essential?: boolean;
  Privileged?: boolean;
  User?: string | number;
  LogConfiguration?: ContainerLogConfiguration;
  Environment?: ContainerEnvironmentVariable[];
  Secrets?: ContainerSecret[];
  PortMappings?: Array<{
    ContainerPort: number;
    Protocol?: string;
  }>;
  MountPoints?: Array<{
    ContainerPath: string;
    SourceVolume: string;
    ReadOnly?: boolean;
  }>;
  [key: string]: unknown;
}

export interface TaskDefinitionProperties {
  ContainerDefinitions?: ContainerDefinition[];
  NetworkMode?: string;
  Cpu?: string;
  Memory?: string;
  ExecutionRoleArn?: unknown;
  TaskRoleArn?: unknown;
  Family?: string;
  RequiresCompatibilities?: string[];
}

// =============================================================================
// Auto Scaling Group Types
// =============================================================================

export interface RollingUpdatePolicy {
  PauseTime?: string;
  MinInstancesInService?: number;
  MinSuccessfulInstancesPercent?: number;
  MaxBatchSize?: number;
  WaitOnResourceSignals?: boolean;
  SuspendProcesses?: string[];
}

export interface AsgUpdatePolicy {
  AutoScalingRollingUpdate?: RollingUpdatePolicy;
  AutoScalingReplacingUpdate?: {
    WillReplace?: boolean;
  };
  AutoScalingScheduledAction?: {
    IgnoreUnmodifiedGroupSizeProperties?: boolean;
  };
}

export interface AsgProperties {
  DesiredCapacity?: number;
  MinSize?: number;
  MaxSize?: number;
  LaunchTemplate?: unknown;
  VPCZoneIdentifier?: unknown[];
  TargetGroupARNs?: unknown[];
  Tags?: Array<{
    Key: string;
    Value: string;
    PropagateAtLaunch: boolean;
  }>;
}

// =============================================================================
// ECS Cluster Types
// =============================================================================

export interface ClusterSetting {
  Name: string;
  Value: string;
}

export interface ClusterProperties {
  ClusterName?: string;
  ClusterSettings?: ClusterSetting[];
  Tags?: ResourceTag[];
}

// =============================================================================
// ECS Service Types
// =============================================================================

export interface DeploymentCircuitBreaker {
  Enable: boolean;
  Rollback?: boolean;
}

export interface DeploymentConfiguration {
  DeploymentCircuitBreaker?: DeploymentCircuitBreaker;
  MaximumPercent?: number;
  MinimumHealthyPercent?: number;
}

export interface EcsServiceProperties {
  Cluster?: unknown;
  TaskDefinition?: unknown;
  DesiredCount?: number;
  DeploymentConfiguration?: DeploymentConfiguration;
  LoadBalancers?: Array<{
    ContainerName: string;
    ContainerPort: number;
    TargetGroupArn: unknown;
  }>;
  NetworkConfiguration?: {
    AwsvpcConfiguration?: {
      Subnets: unknown[];
      SecurityGroups?: unknown[];
      AssignPublicIp?: string;
    };
  };
}

// =============================================================================
// Launch Template Types
// =============================================================================

export interface BlockDeviceMapping {
  DeviceName?: string;
  Ebs?: {
    VolumeType?: string;
    VolumeSize?: number;
    Encrypted?: boolean;
    DeleteOnTermination?: boolean;
    Iops?: number;
    Throughput?: number;
  };
}

export interface LaunchTemplateData {
  InstanceType?: string;
  ImageId?: unknown;
  BlockDeviceMappings?: BlockDeviceMapping[];
  SecurityGroupIds?: unknown[];
  UserData?: string;
  IamInstanceProfile?: {
    Arn?: unknown;
  };
  MetadataOptions?: {
    HttpTokens?: string;
    HttpEndpoint?: string;
  };
  [key: string]: unknown;
}

export interface LaunchTemplateProperties {
  LaunchTemplateData: LaunchTemplateData;
  LaunchTemplateName?: string;
}

// =============================================================================
// Resource Tags Types
// =============================================================================

export interface ResourceTag {
  Key: string;
  Value: string;
}

// =============================================================================
// SSM Types
// =============================================================================

export interface SsmTarget {
  Key: string;
  Values: string[];
}

export interface SsmAssociationProperties {
  Name?: string;
  Targets?: SsmTarget[];
  ComplianceSeverity?: string;
  ScheduleExpression?: string;
  Parameters?: Record<string, string[]>;
}

export interface SsmDocumentProperties {
  DocumentType?: string;
  Content?: unknown;
  Name?: string;
}

// =============================================================================
// Secrets Manager Types
// =============================================================================

export interface SecretProperties {
  Name?: string;
  Description?: string;
  GenerateSecretString?: {
    SecretStringTemplate?: string;
    GenerateStringKey?: string;
    PasswordLength?: number;
    ExcludeCharacters?: string;
  };
  SecretString?: string;
  KmsKeyId?: unknown;
}

// =============================================================================
// Security Group Types
// =============================================================================

export interface SecurityGroupIngress {
  IpProtocol: string;
  FromPort?: number;
  ToPort?: number;
  CidrIp?: string;
  SourceSecurityGroupId?: unknown;
  Description?: string;
}

export interface SecurityGroupEgress {
  IpProtocol: string;
  FromPort?: number;
  ToPort?: number;
  CidrIp?: string;
  DestinationSecurityGroupId?: unknown;
  Description?: string;
}

export interface SecurityGroupProperties {
  GroupDescription: string;
  GroupName?: string;
  VpcId?: unknown;
  SecurityGroupIngress?: SecurityGroupIngress[];
  SecurityGroupEgress?: SecurityGroupEgress[];
  Tags?: ResourceTag[];
}

// =============================================================================
// EFS Types
// =============================================================================

export interface EfsFileSystemProperties {
  Encrypted?: boolean;
  PerformanceMode?: string;
  ThroughputMode?: string;
  FileSystemTags?: ResourceTag[];
  LifecyclePolicies?: Array<{
    TransitionToIA?: string;
  }>;
}

export interface EfsAccessPointProperties {
  FileSystemId?: unknown;
  PosixUser?: {
    Uid: string;
    Gid: string;
  };
  RootDirectory?: {
    Path?: string;
    CreationInfo?: {
      OwnerUid: string;
      OwnerGid: string;
      Permissions: string;
    };
  };
}

// =============================================================================
// CloudWatch Log Group Types
// =============================================================================

export interface LogGroupProperties {
  LogGroupName?: string;
  RetentionInDays?: number;
  KmsKeyId?: unknown;
}

// =============================================================================
// Listener Rule Types
// =============================================================================

export interface ListenerRuleCondition {
  Field?: string;
  PathPatternConfig?: {
    Values: string[];
  };
  HostHeaderConfig?: {
    Values: string[];
  };
  HttpHeaderConfig?: {
    HttpHeaderName: string;
    Values: string[];
  };
}

export interface ListenerRuleAction {
  Type: string;
  TargetGroupArn?: unknown;
  Order?: number;
}

export interface ListenerRuleProperties {
  Priority: number;
  Conditions?: ListenerRuleCondition[];
  Actions?: ListenerRuleAction[];
  ListenerArn?: unknown;
}

// =============================================================================
// CloudFormation Output Types
// =============================================================================

export interface CloudFormationOutput {
  Value: unknown;
  Description?: string;
  Export?: {
    Name: unknown;
  };
}

// =============================================================================
// Pre-computed Test Data Types
// =============================================================================

/**
 * Pre-computed container data for tests
 * Use prepareContainerData() to generate
 */
export interface PreparedContainerData {
  container: ContainerDefinition;
  hasMemoryLimits: boolean;
  isPrivileged: boolean;
  runsAsRoot: boolean;
  hasUser: boolean;
  hasLogConfiguration: boolean;
}

/**
 * Pre-computed target group data for tests
 * Use prepareTargetGroupData() to generate
 */
export interface PreparedTargetGroupData {
  targetGroup: unknown;
  hasHealthCheckPath: boolean;
  hasHealthCheckProtocol: boolean;
  hasHealthCheck: boolean;
  healthyThreshold: number | undefined;
  unhealthyThreshold: number | undefined;
}

/**
 * Pre-computed secret data for tests
 * Use prepareSecretData() to generate
 */
export interface PreparedSecretData {
  secret: unknown;
  hasGenerateSecretString: boolean;
  hasSecretString: boolean;
  hasSecretConfiguration: boolean;
}

/**
 * Pre-computed ASG rolling update data for tests
 */
export interface PreparedAsgRollingUpdateData {
  name: string;
  rollingUpdate: RollingUpdatePolicy;
  hasMinInstanceRequirement: boolean;
}

/**
 * Pre-computed resource with environment context
 */
export interface PreparedResourceWithContext {
  resource: unknown;
  resourceLength: number;
  hasContext: boolean;
}

/**
 * Pre-computed CloudFormation export data
 */
export interface PreparedExportData {
  outputKey: string;
  exportConfig: {
    Name: unknown;
  };
}

// =============================================================================
// Validation Result Types
// =============================================================================

export interface ValidationResult {
  valid: boolean;
  missing: string[];
}

// =============================================================================
// Valid Value Types (string literals)
// =============================================================================

export type ValidNetworkMode = "awsvpc" | "bridge" | "host" | "none";

export type ValidDeletionPolicy = "Retain" | "Delete" | "Snapshot";

export type ValidComplianceSeverity =
  | "CRITICAL"
  | "HIGH"
  | "MEDIUM"
  | "LOW"
  | "UNSPECIFIED";

export type ValidLogDriver =
  | "awslogs"
  | "fluentd"
  | "gelf"
  | "journald"
  | "json-file"
  | "splunk"
  | "syslog";