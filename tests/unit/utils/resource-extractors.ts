/** @format */

/**
 * Resource Property Extractors
 *
 * Type-safe extraction utilities for specific AWS resource properties
 * Used across security and infrastructure test files
 */

import { getResourceProperties, stringifyResource } from "./template-helpers";
import type {
  AlbAttribute,
  TargetGroupAttribute,
  TargetGroupHealthCheck,
  ContainerDefinition,
  RollingUpdatePolicy,
  ClusterSetting,
  LaunchTemplateData,
  DeploymentConfiguration,
  DeploymentCircuitBreaker,
  ResourceTag,
  SsmTarget,
} from "./types";

// =============================================================================
// ALB (Application Load Balancer) Extractors
// =============================================================================

/**
 * Extract ALB attributes array
 */
export const getAlbAttributes = (alb: unknown): AlbAttribute[] => {
  const properties = getResourceProperties<{ LoadBalancerAttributes?: AlbAttribute[] }>(alb);
  return properties.LoadBalancerAttributes || [];
};

/**
 * Find specific ALB attribute by key
 */
export const findAlbAttribute = (
  alb: unknown,
  key: string
): AlbAttribute | undefined => {
  const attributes = getAlbAttributes(alb);
  return attributes.find((attr) => attr.Key === key);
};

/**
 * Check if ALB has specific attribute with expected value
 */
export const albHasAttribute = (
  alb: unknown,
  key: string,
  expectedValue: string
): boolean => {
  const attr = findAlbAttribute(alb, key);
  return attr?.Value === expectedValue;
};

// =============================================================================
// Target Group Extractors
// =============================================================================

/**
 * Extract target group attributes
 */
export const getTargetGroupAttributes = (
  targetGroup: unknown
): TargetGroupAttribute[] => {
  const properties = getResourceProperties<{ TargetGroupAttributes?: TargetGroupAttribute[] }>(targetGroup);
  return properties.TargetGroupAttributes || [];
};

/**
 * Find specific target group attribute by key
 */
export const findTargetGroupAttribute = (
  targetGroup: unknown,
  key: string
): TargetGroupAttribute | undefined => {
  const attributes = getTargetGroupAttributes(targetGroup);
  return attributes.find((attr) => attr.Key === key);
};

/**
 * Extract health check configuration from target group
 */
export const getTargetGroupHealthCheck = (
  targetGroup: unknown
): TargetGroupHealthCheck => {
  const properties = getResourceProperties<TargetGroupHealthCheck>(targetGroup);
  return {
    HealthCheckPath: properties.HealthCheckPath,
    HealthCheckProtocol: properties.HealthCheckProtocol,
    HealthCheckIntervalSeconds: properties.HealthCheckIntervalSeconds,
    HealthyThresholdCount: properties.HealthyThresholdCount,
    UnhealthyThresholdCount: properties.UnhealthyThresholdCount,
  };
};

// =============================================================================
// ECS Task Definition Extractors
// =============================================================================

/**
 * Extract container definitions from task definition
 */
export const getContainersFromTaskDef = (
  taskDef: unknown
): ContainerDefinition[] => {
  const properties = getResourceProperties<{ ContainerDefinitions?: ContainerDefinition[] }>(taskDef);
  return properties.ContainerDefinitions || [];
};

/**
 * Extract network mode from task definition
 */
export const getTaskDefNetworkMode = (taskDef: unknown): string | undefined => {
  const properties = getResourceProperties<{ NetworkMode?: string }>(taskDef);
  return properties.NetworkMode;
};

/**
 * Check if container has memory limits configured
 */
export const containerHasMemoryLimits = (container: ContainerDefinition): boolean => {
  return container.Memory !== undefined || container.MemoryReservation !== undefined;
};

/**
 * Check if container runs as privileged
 */
export const isPrivilegedContainer = (container: ContainerDefinition): boolean => {
  return container.Privileged === true;
};

/**
 * Check if container runs as root
 */
export const containerRunsAsRoot = (container: ContainerDefinition): boolean => {
  const user = container.User;
  if (user === undefined) return false;
  const userStr = String(user);
  return userStr === "0" || userStr === "root";
};

// =============================================================================
// Auto Scaling Group Extractors
// =============================================================================

/**
 * Extract rolling update policy from ASG update policy
 */
export const getRollingUpdate = (
  updatePolicy: Record<string, unknown>
): RollingUpdatePolicy | undefined => {
  return updatePolicy.AutoScalingRollingUpdate as RollingUpdatePolicy | undefined;
};

/**
 * Extract desired capacity from ASG
 */
export const getAsgCapacity = (asg: unknown): number => {
  const properties = getResourceProperties<{ DesiredCapacity?: number }>(asg);
  return properties.DesiredCapacity || 1;
};

// =============================================================================
// ECS Cluster Extractors
// =============================================================================

/**
 * Extract cluster settings
 */
export const getClusterSettings = (cluster: unknown): ClusterSetting[] => {
  const properties = getResourceProperties<{ ClusterSettings?: ClusterSetting[] }>(cluster);
  return properties.ClusterSettings || [];
};

/**
 * Get Container Insights setting from cluster
 */
export const getContainerInsightsSetting = (
  cluster: unknown
): ClusterSetting | undefined => {
  const settings = getClusterSettings(cluster);
  return settings.find((setting) => setting.Name === "containerInsights");
};

// =============================================================================
// Launch Template Extractors
// =============================================================================

/**
 * Extract launch template data
 */
export const getLaunchTemplateData = (
  launchTemplate: unknown
): LaunchTemplateData => {
  const properties = getResourceProperties<{ LaunchTemplateData: LaunchTemplateData }>(launchTemplate);
  return properties.LaunchTemplateData;
};

/**
 * Extract instance type from launch template
 */
export const getInstanceType = (launchTemplate: unknown): string | undefined => {
  const ltData = getLaunchTemplateData(launchTemplate);
  return ltData.InstanceType;
};

// =============================================================================
// ECS Service Extractors
// =============================================================================

/**
 * Extract deployment configuration from ECS service
 */
export const getDeploymentConfiguration = (
  service: unknown
): DeploymentConfiguration | undefined => {
  const properties = getResourceProperties<{ DeploymentConfiguration?: DeploymentConfiguration }>(service);
  return properties.DeploymentConfiguration;
};

/**
 * Extract circuit breaker from deployment configuration
 */
export const getCircuitBreaker = (
  deployConfig: DeploymentConfiguration
): DeploymentCircuitBreaker | undefined => {
  return deployConfig.DeploymentCircuitBreaker;
};

// =============================================================================
// Resource Tags Extractors
// =============================================================================

/**
 * Extract tags from a resource
 */
export const getResourceTags = (resource: unknown): ResourceTag[] => {
  const properties = getResourceProperties<{ Tags?: ResourceTag[] }>(resource);
  return properties.Tags || [];
};

/**
 * Check if resource has a specific tag
 */
export const hasTag = (resource: unknown, tagKey: string): boolean => {
  const tags = getResourceTags(resource);
  return tags.some((tag) => tag.Key === tagKey);
};

/**
 * Get tag value by key
 */
export const getTagValue = (
  resource: unknown,
  tagKey: string
): string | undefined => {
  const tags = getResourceTags(resource);
  const tag = tags.find((t) => t.Key === tagKey);
  return tag?.Value;
};

// =============================================================================
// SSM Extractors
// =============================================================================

/**
 * Extract targets from SSM association
 */
export const getSsmTargets = (association: unknown): SsmTarget[] => {
  const properties = getResourceProperties<{ Targets?: SsmTarget[] }>(association);
  return properties.Targets || [];
};

/**
 * Extract parameters from SSM association
 */
export const getAssociationParameters = (
  association: unknown
): Record<string, unknown[]> | undefined => {
  const properties = getResourceProperties<{ Parameters?: Record<string, unknown[]> }>(association);
  return properties.Parameters;
};

/**
 * Extract commands from SSM association parameters
 */
export const getAssociationCommands = (association: unknown): string | undefined => {
  const parameters = getAssociationParameters(association);
  if (parameters?.commands) {
    return JSON.stringify(parameters.commands);
  }
  return undefined;
};

/**
 * Extract ASG properties
 */
export const getAsgProperties = (asg: unknown): Record<string, unknown> => {
  return getResourceProperties<Record<string, unknown>>(asg);
};

/**
 * Extract user data string from launch template
 */
export const getUserDataString = (launchTemplate: unknown): string => {
  return stringifyResource(launchTemplate);
};

// =============================================================================
// CloudWatch Logs Extractors
// =============================================================================

/**
 * Extract log group properties
 */
export const getLogGroupProperties = (
  logGroup: unknown
): Record<string, unknown> => {
  return getResourceProperties<Record<string, unknown>>(logGroup);
};

// =============================================================================
// Container Logging Extractors
// =============================================================================

/**
 * Extract log configuration from container
 */
export const getLogConfiguration = (
  container: ContainerDefinition
): Record<string, unknown> | undefined => {
  return container.LogConfiguration as Record<string, unknown> | undefined;
};

/**
 * Extract log configuration options
 */
export const getLogOptions = (
  container: ContainerDefinition
): Record<string, string> | undefined => {
  const logConfig = getLogConfiguration(container);
  return logConfig?.Options as Record<string, string> | undefined;
};

// =============================================================================
// EventBridge Extractors
// =============================================================================

/**
 * Extract rule properties from EventBridge rule
 */
export const getRuleProperties = (rule: unknown): Record<string, unknown> => {
  return getResourceProperties<Record<string, unknown>>(rule);
};

// =============================================================================
// SSM Association Extractors
// =============================================================================

/**
 * Extract association properties from SSM association
 */
export const getAssociationProperties = (
  association: unknown
): Record<string, unknown> => {
  return getResourceProperties<Record<string, unknown>>(association);
};

// =============================================================================
// Secrets Manager Extractors
// =============================================================================

/**
 * Check if secret name matches pattern
 */
export const secretNameMatches = (
  secret: unknown,
  pattern: string
): boolean => {
  const properties = getResourceProperties<{ Name?: string }>(secret);
  return properties.Name?.includes(pattern) || false;
};

// =============================================================================
// IAM Extractors
// =============================================================================

/**
 * Extract managed policy ARNs from IAM role
 */
export const getManagedPolicyArns = (role: unknown): unknown[] => {
  const properties = getResourceProperties<{ ManagedPolicyArns?: unknown[] }>(role);
  return properties.ManagedPolicyArns || [];
};

/**
 * Extract assume role policy document from IAM role
 */
export const getAssumeRolePolicy = (
  role: unknown
): Record<string, Array<Record<string, unknown>>> => {
  const properties = getResourceProperties<{ AssumeRolePolicyDocument?: Record<string, Array<Record<string, unknown>>> }>(role);
  return properties.AssumeRolePolicyDocument || { Statement: [] };
};

/**
 * Extract assume role statements
 */
export const getAssumeRoleStatements = (
  role: unknown
): Array<Record<string, unknown>> => {
  const assumePolicy = getAssumeRolePolicy(role);
  return assumePolicy.Statement || [];
};

/**
 * Extract policy document from IAM policy
 */
export const getPolicyDocument = (
  policy: unknown
): Record<string, Array<Record<string, unknown>>> => {
  const properties = getResourceProperties<{ PolicyDocument?: Record<string, Array<Record<string, unknown>>> }>(policy);
  return properties.PolicyDocument || { Statement: [] };
};

/**
 * Extract policy statements from IAM policy
 */
export const getPolicyStatements = (
  policy: unknown
): Array<Record<string, unknown>> => {
  const policyDocument = getPolicyDocument(policy);
  return policyDocument.Statement || [];
};

// =============================================================================
// Security Group Extractors
// =============================================================================

/**
 * Extract security group properties
 */
export const getSecurityGroupProperties = (
  sg: unknown
): Record<string, unknown> => {
  return getResourceProperties<Record<string, unknown>>(sg);
};

/**
 * Extract ingress rules from security group
 */
export const getIngressRules = (
  sg: unknown
): Array<Record<string, unknown>> => {
  const properties = getSecurityGroupProperties(sg);
  return (properties.SecurityGroupIngress || []) as Array<
    Record<string, unknown>
  >;
};

// =============================================================================
// Subnet Extractors
// =============================================================================

/**
 * Extract subnet tags
 */
export const getSubnetTags = (subnet: unknown): ResourceTag[] => {
  const properties = getResourceProperties<{ Tags?: ResourceTag[] }>(subnet);
  return properties.Tags || [];
};

// =============================================================================
// NAT Gateway Extractors
// =============================================================================

/**
 * Extract NAT gateway properties
 */
export const getNatGatewayProperties = (
  natGw: unknown
): Record<string, unknown> => {
  return getResourceProperties<Record<string, unknown>>(natGw);
};

// =============================================================================
// EFS Extractors
// =============================================================================

/**
 * Extract lifecycle policies from EFS file system
 */
export const getLifecyclePolicies = (
  fileSystem: unknown
): Array<Record<string, string>> => {
  const properties = getResourceProperties<{
    LifecyclePolicies?: Array<Record<string, string>>;
  }>(fileSystem);
  return properties.LifecyclePolicies || [];
};

/**
 * Extract root directory from EFS access point
 */
export const getRootDirectory = (
  accessPoint: unknown
): Record<string, Record<string, string>> | undefined => {
  const properties = getResourceProperties<{
    RootDirectory?: Record<string, Record<string, string>>;
  }>(accessPoint);
  return properties.RootDirectory;
};

/**
 * Extract creation info from root directory
 */
export const getCreationInfo = (
  rootDir: Record<string, Record<string, string>>
): Record<string, string> => {
  return rootDir.CreationInfo;
};

/**
 * Extract permissions from creation info
 */
export const getPermissions = (
  creationInfo: Record<string, string>
): string | undefined => {
  return creationInfo.Permissions;
};

// =============================================================================
// SSM Parameter Extractors
// =============================================================================

/**
 * Extract SSM parameter properties
 */
export const getSsmParameterProperties = (
  parameter: unknown
): Record<string, string> => {
  return getResourceProperties<Record<string, string>>(parameter);
};