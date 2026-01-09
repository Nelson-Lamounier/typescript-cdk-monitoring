/** @format */

import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as kms from "aws-cdk-lib/aws-kms";
import * as logs from "aws-cdk-lib/aws-logs";
import * as ssm from "aws-cdk-lib/aws-ssm";

/**
 * Base configuration for parameter categories
 */
export interface BaseParameterConfig {
  /** Custom description override */
  description?: string;
  /** Parameter tier (STANDARD, ADVANCED, INTELLIGENT_TIERING) */
  tier?: ssm.ParameterTier;
}

/**
 * Configuration for VPC-related SSM parameters
 */
export interface VpcParameterConfig extends BaseParameterConfig {
  /** VPC to store parameters for */
  vpc: ec2.IVpc;
  /** Whether to store subnet IDs (default: true) */
  includeSubnets?: boolean;
  /** Whether to store availability zones (default: false) */
  includeAvailabilityZones?: boolean;
  /** Whether to use StringList for subnet IDs (default: false, uses comma-separated String) */
  useStringList?: boolean;
}

/**
 * Configuration for ECR-related SSM parameters
 */
export interface EcrParameterConfig extends BaseParameterConfig {
  /** ECR repository to store parameters for */
  repository: ecr.IRepository;
}

/**
 * Configuration for ECS-related SSM parameters
 */
export interface EcsParameterConfig extends BaseParameterConfig {
  /** ECS cluster to store parameters for */
  cluster: ecs.ICluster;
  /** ECS service to store parameters for (optional) */
  service?: ecs.IService;
}

/**
 * Configuration for Log Group-related SSM parameters
 */
export interface LogGroupParameterConfig extends BaseParameterConfig {
  /** Log group to store parameters for */
  logGroup: logs.ILogGroup;
  /** Friendly name for the log group (used in parameter path) */
  name: string;
}

/**
 * Custom parameter configuration
 */
export interface CustomParameterConfig {
  /** Parameter name (without prefix) - must follow SSM naming rules */
  name: string;
  /** Parameter value or array of values for StringList */
  value: string | string[];
  /** Parameter description */
  description?: string;
  /** Parameter tier */
  tier?: ssm.ParameterTier;
  /** Whether this is a secure string (default: false) */
  secure?: boolean;
  /** Parameter type: String (default) or StringList */
  type?: "String" | "StringList";
}

/**
 * Props for SsmParametersConstruct
 */
export interface SsmParametersConstructProps {
  /** Environment name (e.g., 'development', 'production') */
  envName: string;
  /** Project name for parameter path prefix */
  projectName?: string;
  /**
   * Custom path prefix for ALL parameters.
   * If provided, all parameters will be created under this prefix.
   * Format: /prefix/category/parameter-name
   * Default: /{envName} or /{projectName}/{envName} if projectName provided
   */
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

  /**
   * Whether to also create CloudFormation exports for cross-stack references.
   * Default: false
   */
  createCfnExports?: boolean;

  /**
   * Whether to suppress production warnings (not recommended).
   * Default: false
   */
  suppressWarnings?: boolean;
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

/**
 * Result of parameter creation with full details
 */
export interface ParameterInfo {
  /** Full parameter path */
  path: string;
  /** Parameter category (vpc, ecr, ecs, logs, custom) */
  category: string;
  /** Short key (last segment) */
  key: string;
  /** The CDK parameter construct */
  parameter: ssm.IStringParameter;
}
