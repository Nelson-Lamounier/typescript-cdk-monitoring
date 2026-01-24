/** @format */

/**
 * Shared Type Definitions for All Test Suites
 *
 * This module provides common type definitions used across all test suites
 * to eliminate code duplication and ensure type consistency.
 *
 * **Organization:**
 * - CloudFormation Resource Types
 * - AWS Resource Properties
 * - Test Configuration Types
 * - Helper Function Types
 * - Assertion Types
 *
 * @module tests/unit/types/test-types
 */

// ============================================================================
// CLOUDFORMATION RESOURCE PROPERTIES
// ============================================================================

/**
 * Generic CloudFormation resource structure
 */
export interface CloudFormationResource {
  Type: string;
  Properties: Record<string, unknown>;
  DependsOn?: string | string[];
  DeletionPolicy?: string;
  UpdateReplacePolicy?: string;
  Metadata?: Record<string, unknown>;
}

/**
 * Resource with properties (type-safe wrapper)
 */
export interface ResourceWithProperties {
  Properties: Record<string, unknown>;
  Type?: string;
  DependsOn?: string | string[];
}

/**
 * Generic CloudFormation properties type
 */
export type ResourceProperties = Record<string, Record<string, unknown>>;

// ============================================================================
// AWS VPC/NETWORKING RESOURCE PROPERTIES
// ============================================================================

/**
 * Tag structure used across AWS resources
 */
export interface ResourceTag {
  Key: string;
  Value: string;
}

/**
 * VPC Properties
 */
export interface VpcProperties {
  CidrBlock: string;
  EnableDnsHostnames?: boolean;
  EnableDnsSupport?: boolean;
  Tags?: ResourceTag[];
}

/**
 * Subnet Properties
 */
export interface SubnetProperties {
  CidrBlock: string;
  AvailabilityZone: string;
  VpcId: unknown;
  MapPublicIpOnLaunch?: boolean;
  Tags: ResourceTag[];
}

/**
 * Route Table Properties
 */
export interface RouteTableProperties {
  VpcId: unknown;
  Tags?: ResourceTag[];
}

/**
 * Route Properties
 */
export interface RouteProperties {
  DestinationCidrBlock: string;
  RouteTableId: unknown;
  GatewayId?: unknown;
  NatGatewayId?: unknown;
  VpcPeeringConnectionId?: unknown;
  NetworkInterfaceId?: unknown;
}

/**
 * Internet Gateway Properties
 */
export interface InternetGatewayProperties {
  Tags?: ResourceTag[];
}

/**
 * NAT Gateway Properties
 */
export interface NatGatewayProperties {
  SubnetId: unknown;
  AllocationId: unknown;
  Tags?: ResourceTag[];
}

/**
 * Security Group Properties
 */
export interface SecurityGroupProperties {
  GroupDescription: string;
  GroupName?: string;
  VpcId: unknown;
  SecurityGroupIngress?: SecurityGroupRule[];
  SecurityGroupEgress?: SecurityGroupRule[];
  Tags?: ResourceTag[];
}

/**
 * Security Group Rule
 */
export interface SecurityGroupRule {
  IpProtocol: string;
  FromPort?: number;
  ToPort?: number;
  CidrIp?: string;
  CidrIpv6?: string;
  SourceSecurityGroupId?: unknown;
  DestinationSecurityGroupId?: unknown;
  Description?: string;
}

/**
 * VPC Endpoint Properties
 */
export interface VpcEndpointProperties {
  VpcId: unknown;
  ServiceName: string;
  VpcEndpointType?: string;
  RouteTableIds?: unknown[];
  SubnetIds?: unknown[];
  SecurityGroupIds?: unknown[];
  PrivateDnsEnabled?: boolean;
}

/**
 * Flow Log Properties
 */
export interface FlowLogProperties {
  ResourceId: unknown;
  ResourceType: string;
  TrafficType: string;
  LogDestinationType?: string;
  LogGroupName?: string;
  DeliverLogsPermissionArn?: unknown;
  Tags?: ResourceTag[];
}

// ============================================================================
// AWS ECS/COMPUTE RESOURCE PROPERTIES
// ============================================================================

/**
 * ECS Cluster Properties
 */
export interface EcsClusterProperties {
  ClusterName?: string;
  ClusterSettings?: Array<{
    Name: string;
    Value: string;
  }>;
  Tags?: ResourceTag[];
}

/**
 * ECS Task Definition Properties
 */
export interface EcsTaskDefinitionProperties {
  Family: string;
  Cpu?: string;
  Memory?: string;
  NetworkMode?: string;
  RequiresCompatibilities?: string[];
  ExecutionRoleArn?: unknown;
  TaskRoleArn?: unknown;
  ContainerDefinitions: ContainerDefinition[];
  Tags?: ResourceTag[];
}

/**
 * Container Definition
 */
export interface ContainerDefinition {
  Name: string;
  Image: string;
  Cpu?: number;
  Memory?: number;
  MemoryReservation?: number;
  Essential?: boolean;
  PortMappings?: PortMapping[];
  Environment?: Array<{ Name: string; Value: string }>;
  Secrets?: Array<{ Name: string; ValueFrom: string }>;
  MountPoints?: Array<{
    SourceVolume: string;
    ContainerPath: string;
    ReadOnly?: boolean;
  }>;
  LogConfiguration?: {
    LogDriver: string;
    Options?: Record<string, string>;
  };
  Privileged?: boolean;
  ReadonlyRootFilesystem?: boolean;
  User?: string;
}

/**
 * Port Mapping
 */
export interface PortMapping {
  ContainerPort: number;
  HostPort?: number;
  Protocol?: string;
}

/**
 * ECS Service Properties
 */
export interface EcsServiceProperties {
  ServiceName?: string;
  Cluster: unknown;
  TaskDefinition: unknown;
  DesiredCount: number;
  LaunchType?: string;
  NetworkConfiguration?: {
    AwsvpcConfiguration: {
      Subnets: unknown[];
      SecurityGroups?: unknown[];
      AssignPublicIp?: string;
    };
  };
  LoadBalancers?: Array<{
    TargetGroupArn: unknown;
    ContainerName: string;
    ContainerPort: number;
  }>;
  HealthCheckGracePeriodSeconds?: number;
  Tags?: ResourceTag[];
}

// ============================================================================
// AWS LOAD BALANCER RESOURCE PROPERTIES
// ============================================================================

/**
 * Application Load Balancer Properties
 */
export interface AlbProperties {
  Name?: string;
  Scheme?: string;
  Type?: string;
  IpAddressType?: string;
  Subnets?: unknown[];
  SecurityGroups?: unknown[];
  Tags?: ResourceTag[];
}

/**
 * Target Group Properties
 */
export interface TargetGroupProperties {
  Name?: string;
  Port: number;
  Protocol: string;
  VpcId: unknown;
  TargetType?: string;
  HealthCheckEnabled?: boolean;
  HealthCheckPath?: string;
  HealthCheckProtocol?: string;
  HealthCheckIntervalSeconds?: number;
  HealthCheckTimeoutSeconds?: number;
  HealthyThresholdCount?: number;
  UnhealthyThresholdCount?: number;
  Matcher?: {
    HttpCode?: string;
  };
  Tags?: ResourceTag[];
}

/**
 * Listener Properties
 */
export interface ListenerProperties {
  LoadBalancerArn: unknown;
  Port: number;
  Protocol: string;
  Certificates?: Array<{
    CertificateArn: string;
  }>;
  DefaultActions: ListenerAction[];
  SslPolicy?: string;
}

/**
 * Listener Action
 */
export interface ListenerAction {
  Type: string;
  TargetGroupArn?: unknown;
  RedirectConfig?: {
    Protocol?: string;
    Port?: string;
    StatusCode: string;
  };
  FixedResponseConfig?: {
    StatusCode: string;
    ContentType?: string;
    MessageBody?: string;
  };
}

// ============================================================================
// AWS STORAGE RESOURCE PROPERTIES
// ============================================================================

/**
 * EFS File System Properties
 */
export interface EfsFileSystemProperties {
  Encrypted?: boolean;
  KmsKeyId?: unknown;
  PerformanceMode?: string;
  ThroughputMode?: string;
  ProvisionedThroughputInMibps?: number;
  LifecyclePolicies?: Array<{
    TransitionToIA?: string;
    TransitionToPrimaryStorageClass?: string;
  }>;
  FileSystemTags?: ResourceTag[];
}

/**
 * EFS Mount Target Properties
 */
export interface EfsMountTargetProperties {
  FileSystemId: unknown;
  SubnetId: unknown;
  SecurityGroups: unknown[];
}

/**
 * EFS Access Point Properties
 */
export interface EfsAccessPointProperties {
  FileSystemId: unknown;
  PosixUser?: {
    Uid: string;
    Gid: string;
    SecondaryGids?: string[];
  };
  RootDirectory?: {
    Path: string;
    CreationInfo?: {
      OwnerUid: string;
      OwnerGid: string;
      Permissions: string;
    };
  };
  AccessPointTags?: ResourceTag[];
}

// ============================================================================
// AWS IAM RESOURCE PROPERTIES
// ============================================================================

/**
 * IAM Role Properties
 */
export interface IamRoleProperties {
  RoleName?: string;
  AssumeRolePolicyDocument: unknown;
  ManagedPolicyArns?: string[];
  Policies?: Array<{
    PolicyName: string;
    PolicyDocument: unknown;
  }>;
  Tags?: ResourceTag[];
}

/**
 * IAM Policy Properties
 */
export interface IamPolicyProperties {
  PolicyName: string;
  PolicyDocument: unknown;
  Roles?: unknown[];
}

// ============================================================================
// AWS CLOUDWATCH RESOURCE PROPERTIES
// ============================================================================

/**
 * CloudWatch Log Group Properties
 */
export interface LogGroupProperties {
  LogGroupName?: string;
  RetentionInDays?: number;
  KmsKeyId?: unknown;
}

// ============================================================================
// TEST HELPER TYPES
// ============================================================================

/**
 * Categorised subnets by type
 */
export interface SubnetsByType {
  publicSubnets: SubnetProperties[];
  privateSubnets: SubnetProperties[];
  isolatedSubnets: SubnetProperties[];
}

/**
 * Categorised routes by type
 */
export interface RoutesByType {
  igwRoutes: RouteProperties[];
  natRoutes: RouteProperties[];
  localRoutes: RouteProperties[];
  otherRoutes: RouteProperties[];
}

/**
 * Availability zone information
 */
export interface AvailabilityZoneInfo {
  zones: string[];
  count: number;
}

/**
 * CIDR validation result
 */
export interface CidrValidationResult {
  isValid: boolean;
  hasOverlap: boolean;
  overlappingCidrs?: string[];
  message?: string;
}

/**
 * Resource count summary
 */
export interface ResourceCountSummary {
  resourceType: string;
  count: number;
  expected?: number;
  status: "pass" | "fail" | "warning";
}

/**
 * Network connectivity validation result
 */
export interface ConnectivityValidationResult {
  sourceResource: string;
  targetResource: string;
  connectionType: "route" | "security-group" | "peering";
  isConnected: boolean;
  blockingReason?: string;
}

/**
 * Security posture assessment result
 */
export interface SecurityPostureResult {
  resource: string;
  checks: Array<{
    checkName: string;
    passed: boolean;
    severity: "critical" | "high" | "medium" | "low" | "info";
    message?: string;
  }>;
}

// ============================================================================
// PARAMETERISED TEST TYPES
// ============================================================================

/**
 * Test case for parameterised tests
 */
export interface TestCase<T = unknown> {
  description: string;
  input: T;
  expected: unknown;
  shouldThrow?: boolean;
  errorMessage?: string | RegExp;
}

/**
 * Environment-specific test case
 */
export interface EnvironmentTestCase<T = unknown> {
  environment: string;
  config: T;
  expectations: Record<string, unknown>;
}

/**
 * Resource validation test case
 */
export interface ResourceValidationTestCase {
  resourceType: string;
  expectedCount?: number;
  expectedProperties?: Record<string, unknown>;
  customValidation?: (resource: ResourceWithProperties) => boolean;
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Type guard to check if object has Tags property
 */
export function hasTagsProperty(
  obj: unknown
): obj is { Tags: ResourceTag[] } {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "Tags" in obj &&
    Array.isArray((obj as { Tags: unknown }).Tags)
  );
}

/**
 * Type guard to check if resource is a security group rule
 */
export function isSecurityGroupRule(
  obj: unknown
): obj is SecurityGroupRule {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "IpProtocol" in obj &&
    typeof (obj as { IpProtocol: unknown }).IpProtocol === "string"
  );
}

/**
 * Type guard to check if resource has subnet properties
 */
export function hasSubnetProperties(
  obj: unknown
): obj is SubnetProperties {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "CidrBlock" in obj &&
    "AvailabilityZone" in obj &&
    "Tags" in obj
  );
}

/**
 * Type guard to check if resource has route properties
 */
export function hasRouteProperties(
  obj: unknown
): obj is RouteProperties {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "DestinationCidrBlock" in obj &&
    "RouteTableId" in obj
  );
}
