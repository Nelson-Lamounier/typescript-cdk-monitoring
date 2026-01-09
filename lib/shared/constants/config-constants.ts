/** @format */

import * as ssm from "aws-cdk-lib/aws-ssm";

/**
 * Default SSM parameter tier
 */
export const DEFAULT_SSM_PARAMETER_TIER = ssm.ParameterTier.STANDARD;

/**
 * SSM parameter path category names
 * Used to organise parameters under the path prefix
 */
export const SSM_PARAMETER_CATEGORIES = {
  VPC: "vpc",
  ECR: "ecr",
  ECS: "ecs",
  LOGS: "logs",
  CUSTOM: "config",
} as const;

/**
 * SSM parameter name suffixes
 */
export const SSM_PARAMETER_SUFFIXES = {
  // VPC
  VPC_ID: "vpc-id",
  VPC_CIDR: "vpc-cidr",
  PRIVATE_SUBNET_IDS: "private-subnet-ids",
  PUBLIC_SUBNET_IDS: "public-subnet-ids",
  AVAILABILITY_ZONES: "availability-zones",

  // ECR
  REPOSITORY_URI: "repository-uri",
  REPOSITORY_ARN: "repository-arn",
  REPOSITORY_NAME: "repository-name",

  // ECS
  CLUSTER_NAME: "cluster-name",
  CLUSTER_ARN: "cluster-arn",
  SERVICE_NAME: "service-name",
  SERVICE_ARN: "service-arn",

  // Logs
  LOG_GROUP_NAME: "log-group-name",
  LOG_GROUP_ARN: "log-group-arn",
} as const;

/**
 * CloudFormation export name pattern
 * Format: {envName}-{projectName}-{resourceType}-{property}
 */
export const CFN_EXPORT_PATTERN = {
  VPC_ID: "vpc-id",
  VPC_CIDR: "vpc-cidr",
  PRIVATE_SUBNET_IDS: "private-subnet-ids",
  PUBLIC_SUBNET_IDS: "public-subnet-ids",
  ECR_URI: "ecr-repository-uri",
  ECR_ARN: "ecr-repository-arn",
  ECR_NAME: "ecr-repository-name",
  ECS_CLUSTER_NAME: "ecs-cluster-name",
  ECS_CLUSTER_ARN: "ecs-cluster-arn",
  ECS_SERVICE_NAME: "ecs-service-name",
} as const;

/**
 * SSM Parameter name validation constants
 */
export const SSM_PARAMETER_VALIDATION = {
  /** Maximum parameter name length */
  MAX_NAME_LENGTH: 1024,
  /** Maximum parameter value length for Standard tier */
  MAX_VALUE_LENGTH_STANDARD: 4096,
  /** Maximum parameter value length for Advanced tier */
  MAX_VALUE_LENGTH_ADVANCED: 8192,
  /** Maximum parameters per region */
  MAX_PARAMETERS_PER_REGION: 10000,
  /**
   * Valid characters for parameter names:
   * - Must start with /
   * - Can contain: a-z, A-Z, 0-9, . (period), - (hyphen), _ (underscore), /
   */
  NAME_REGEX: /^\/[A-Za-z0-9._\-/]+$/,
  /** Invalid patterns in parameter names */
  INVALID_PATTERNS: [
    /\/\//, // Double slashes
    /\/$/, // Trailing slash
  ],
} as const;

/**
 * Default descriptions for auto-generated parameters
 */
export const SSM_DEFAULT_DESCRIPTIONS = {
  VPC_ID: (env: string) => `VPC ID for ${env} environment`,
  VPC_CIDR: (env: string) => `VPC CIDR Block for ${env} environment`,
  PRIVATE_SUBNET_IDS: (env: string) =>
    `Private Subnet IDs for ${env} environment`,
  PUBLIC_SUBNET_IDS: (env: string) =>
    `Public Subnet IDs for ${env} environment`,
  AVAILABILITY_ZONES: (env: string) =>
    `Availability Zones for ${env} environment`,
  REPOSITORY_URI: (env: string) => `ECR Repository URI for ${env} environment`,
  REPOSITORY_ARN: (env: string) => `ECR Repository ARN for ${env} environment`,
  REPOSITORY_NAME: (env: string) =>
    `ECR Repository Name for ${env} environment`,
  CLUSTER_NAME: (env: string) => `ECS Cluster Name for ${env} environment`,
  CLUSTER_ARN: (env: string) => `ECS Cluster ARN for ${env} environment`,
  SERVICE_NAME: (env: string) => `ECS Service Name for ${env} environment`,
  LOG_GROUP_NAME: (name: string, env: string) =>
    `Log Group Name for ${name} in ${env} environment`,
  LOG_GROUP_ARN: (name: string, env: string) =>
    `Log Group ARN for ${name} in ${env} environment`,
} as const;
