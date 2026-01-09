/** @format */

import * as ssm from "aws-cdk-lib/aws-ssm";

/**
 * Default SSM parameter tier
 */
export const DEFAULT_SSM_PARAMETER_TIER = ssm.ParameterTier.STANDARD;

/**
 * SSM parameter path prefixes by service
 */
export const SSM_PARAMETER_PATH_PREFIXES = {
  VPC: "/vpc",
  ECR: "/ecr",
  ECS: "/ecs",
  LOGS: "/logs",
  CUSTOM: "/config",
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
  ECR_URI: "ecr-repository-uri",
  ECR_ARN: "ecr-repository-arn",
  ECR_NAME: "ecr-repository-name",
  ECS_CLUSTER_NAME: "ecs-cluster-name",
  ECS_CLUSTER_ARN: "ecs-cluster-arn",
  ECS_SERVICE_NAME: "ecs-service-name",
} as const;
