/** @format */

import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as kms from "aws-cdk-lib/aws-kms";
import * as logs from "aws-cdk-lib/aws-logs";
import * as ssm from "aws-cdk-lib/aws-ssm";

/**
 * Configuration for VPC-related SSM parameters
 */
export interface VpcParameterConfig {
  /** VPC to store parameters for */
  vpc: ec2.IVpc;
  /** Whether to store subnet IDs */
  includeSubnets?: boolean;
  /** Whether to store availability zones */
  includeAvailabilityZones?: boolean;
}

/**
 * Configuration for ECR-related SSM parameters
 */
export interface EcrParameterConfig {
  /** ECR repository to store parameters for */
  repository: ecr.IRepository;
}

/**
 * Configuration for ECS-related SSM parameters
 */
export interface EcsParameterConfig {
  /** ECS cluster to store parameters for */
  cluster: ecs.ICluster;
  /** ECS service to store parameters for (optional) */
  service?: ecs.IService;
}

/**
 * Configuration for Log Group-related SSM parameters
 */
export interface LogGroupParameterConfig {
  /** Log group to store parameters for */
  logGroup: logs.ILogGroup;
  /** Friendly name for the log group */
  name: string;
}

/**
 * Custom parameter configuration
 */
export interface CustomParameterConfig {
  /** Parameter name (without prefix) */
  name: string;
  /** Parameter value */
  value: string;
  /** Parameter description */
  description?: string;
  /** Parameter tier */
  tier?: ssm.ParameterTier;
  /** Whether this is a secure string */
  secure?: boolean;
}

/**
 * Props for SsmParametersConstruct
 */
export interface SsmParametersConstructProps {
  /** Environment name (e.g., 'development', 'production') */
  envName: string;
  /** Project name for parameter path prefix */
  projectName?: string;
  /** Custom path prefix (overrides default /{service}/{envName} pattern) */
  pathPrefix?: string;

  /** VPC parameter configuration */
  vpc?: VpcParameterConfig;
  /** ECR parameter configuration */
  ecr?: EcrParameterConfig;
  /** ECS parameter configuration */
  ecs?: EcsParameterConfig;
  /** Log group parameter configurations */
  logGroups?: LogGroupParameterConfig[];
  /** Custom parameters to create */
  customParameters?: CustomParameterConfig[];

  /** KMS key for encrypting SecureString parameters */
  encryptionKey?: kms.IKey;
  /** Additional tags to apply to parameters */
  customTags?: Record<string, string>;
}

/**
 * Props for StackOutputsConstruct
 */
export interface StackOutputsConstructProps {
  /** Environment name */
  envName: string;
  /** Project name for export name prefix */
  projectName?: string;
  /** VPC to create outputs for */
  vpc?: ec2.IVpc;
  /** ECR repository to create outputs for */
  repository?: ecr.IRepository;
  /** ECS cluster to create outputs for */
  cluster?: ecs.ICluster;
  /** ECS service to create outputs for */
  service?: ecs.IService;
  /** Custom outputs to create */
  customOutputs?: {
    name: string;
    value: string;
    description?: string;
  }[];
}
