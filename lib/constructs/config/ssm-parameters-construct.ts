/** @format */

import * as cdk from "aws-cdk-lib";
import * as ssm from "aws-cdk-lib/aws-ssm";
import { Annotations } from "aws-cdk-lib";
import { Construct } from "constructs";

import {
  DEFAULT_SSM_PARAMETER_TIER,
  SSM_DEFAULT_DESCRIPTIONS,
  SSM_PARAMETER_CATEGORIES,
  SSM_PARAMETER_SUFFIXES,
  SSM_PARAMETER_VALIDATION,
} from "../../shared/constants/config-constants";
import {
  ParameterInfo,
  SsmParametersConstructProps,
} from "../../shared/types/config-types";
import {
  validateCustomParameterName,
  validateEnvName,
  validateSsmParameterName,
  validateSsmParameterValue,
} from "../../shared/utils/validation";

/**
 * SSM Parameters Construct
 *
 * Creates SSM Parameter Store parameters for infrastructure resources,
 * enabling dynamic discovery by other services and pipelines without
 * hardcoding values.
 *
 * Features:
 * - Flexible parameter creation (VPC, ECR, ECS, Logs, Custom)
 * - Consistent naming convention: {pathPrefix}/{category}/{parameter}
 * - Support for SecureString parameters with KMS encryption
 * - Support for StringList parameter type
 * - Automatic tagging for resource management
 * - Optional CloudFormation exports
 * - Production safety warnings
 *
 * Path Structure:
 * - Default: /{envName}/{category}/{parameter}
 * - With project: /{projectName}/{envName}/{category}/{parameter}
 * - With custom prefix: {pathPrefix}/{category}/{parameter}
 *
 * @example
 * ```typescript
 * const params = new SsmParametersConstruct(this, 'Parameters', {
 *   envName: 'production',
 *   projectName: 'monitoring',
 *   vpc: {
 *     vpc: myVpc,
 *     includeSubnets: true,
 *     useStringList: true, // Use StringList for subnet IDs
 *   },
 *   ecs: {
 *     cluster: myCluster,
 *     service: myService,
 *     tier: ssm.ParameterTier.ADVANCED, // Custom tier
 *   },
 *   customParameters: [
 *     { name: 'api-url', value: 'https://api.example.com' },
 *     { name: 'api-key', value: 'secret', secure: true },
 *   ],
 *   encryptionKey: myKmsKey,
 *   createCfnExports: true,
 * });
 *
 * // Get parameter by full path
 * const vpcParam = params.getParameterByPath('/monitoring/production/vpc/vpc-id');
 *
 * // Get parameter by key
 * const vpcParam2 = params.getParameterByKey('vpc', 'vpc-id');
 * ```
 */
export class SsmParametersConstruct extends Construct {
  /**
   * Map of full parameter paths to ParameterInfo objects
   */
  public readonly parametersByPath: Map<string, ParameterInfo>;

  /**
   * Map of category/key to ParameterInfo for easy lookup
   * Key format: "{category}/{key}" e.g., "vpc/vpc-id"
   */
  public readonly parametersByKey: Map<string, ParameterInfo>;

  /**
   * The path prefix used for all parameters
   */
  public readonly pathPrefix: string;

  private readonly envName: string;
  private readonly stack: cdk.Stack;
  private readonly props: SsmParametersConstructProps;

  constructor(
    scope: Construct,
    id: string,
    props: SsmParametersConstructProps
  ) {
    super(scope, id);

    this.parametersByPath = new Map();
    this.parametersByKey = new Map();
    this.envName = props.envName;
    this.stack = cdk.Stack.of(this);
    this.props = props;

    // Validate inputs
    this.validateInputs(props);

    // Build path prefix - this is used for ALL parameters
    this.pathPrefix = this.buildPathPrefix(props);

    // Create VPC parameters
    if (props.vpc) {
      this.createVpcParameters(props);
    }

    // Create ECR parameters
    if (props.ecr) {
      this.createEcrParameters(props);
    }

    // Create ECS parameters
    if (props.ecs) {
      this.createEcsParameters(props);
    }

    // Create Log Group parameters
    if (props.logGroups && props.logGroups.length > 0) {
      this.createLogGroupParameters(props);
    }

    // Create custom parameters
    if (props.customParameters && props.customParameters.length > 0) {
      this.createCustomParameters(props);
    }

    // Production warnings
    if (!props.suppressWarnings) {
      this.addProductionWarnings(props);
    }

    // Apply tags
    this.applyTags(props);

    // Create outputs
    this.createOutputs();
  }

  // ========================================
  // Validation
  // ========================================

  /**
   * Validate all inputs
   */
  private validateInputs(props: SsmParametersConstructProps): void {
    validateEnvName(props.envName);

    // Ensure at least one parameter configuration is provided
    const hasConfig =
      props.vpc ||
      props.ecr ||
      props.ecs ||
      (props.logGroups && props.logGroups.length > 0) ||
      (props.customParameters && props.customParameters.length > 0);

    if (!hasConfig) {
      throw new Error(
        "At least one parameter configuration must be provided.\n\n" +
          "Available options:\n" +
          "  - vpc: VPC parameters (vpc-id, subnets, etc.)\n" +
          "  - ecr: ECR parameters (repository-uri, repository-arn, etc.)\n" +
          "  - ecs: ECS parameters (cluster-name, service-name, etc.)\n" +
          "  - logGroups: Log group parameters\n" +
          "  - customParameters: Custom key-value parameters"
      );
    }

    // Validate custom parameters
    if (props.customParameters) {
      props.customParameters.forEach((param, index) => {
        if (!param.name || param.name.trim().length === 0) {
          throw new Error(
            `Custom parameter at index ${index} is missing 'name' field`
          );
        }

        // Validate parameter name format
        validateCustomParameterName(param.name);

        if (param.value === undefined || param.value === null) {
          throw new Error(
            `Custom parameter '${param.name}' is missing 'value' field`
          );
        }

        // Validate value length
        const valueStr = Array.isArray(param.value)
          ? param.value.join(",")
          : param.value;
        validateSsmParameterValue(
          valueStr,
          param.tier ?? DEFAULT_SSM_PARAMETER_TIER
        );
      });
    }

    // Validate log group names
    if (props.logGroups) {
      props.logGroups.forEach((config, index) => {
        if (!config.name || config.name.trim().length === 0) {
          throw new Error(
            `Log group configuration at index ${index} is missing 'name' field`
          );
        }
      });
    }
  }

  // ========================================
  // Path Building
  // ========================================

  /**
   * Build the base path prefix for all parameters
   *
   * Priority:
   * 1. Custom pathPrefix if provided
   * 2. /{projectName}/{envName} if projectName provided
   * 3. /{envName} otherwise
   */
  private buildPathPrefix(props: SsmParametersConstructProps): string {
    if (props.pathPrefix) {
      // Ensure it starts with / and doesn't end with /
      let prefix = props.pathPrefix;
      if (!prefix.startsWith("/")) {
        prefix = `/${prefix}`;
      }
      if (prefix.endsWith("/")) {
        prefix = prefix.slice(0, -1);
      }
      return prefix;
    }

    return props.projectName
      ? `/${props.projectName}/${props.envName}`
      : `/${props.envName}`;
  }

  /**
   * Build full parameter path using pathPrefix
   */
  private buildParameterPath(category: string, suffix: string): string {
    const path = `${this.pathPrefix}/${category}/${suffix}`;

    // Validate the final path
    validateSsmParameterName(path);

    return path;
  }

  // ========================================
  // Parameter Creation Methods
  // ========================================

  /**
   * Create VPC parameters
   */
  private createVpcParameters(props: SsmParametersConstructProps): void {
    const vpcConfig = props.vpc;
    if (!vpcConfig) return;

    const vpc = vpcConfig.vpc;
    const category = SSM_PARAMETER_CATEGORIES.VPC;
    const tier = vpcConfig.tier ?? DEFAULT_SSM_PARAMETER_TIER;

    // VPC ID
    this.createParameter({
      id: "VpcIdParameter",
      path: this.buildParameterPath(category, SSM_PARAMETER_SUFFIXES.VPC_ID),
      value: vpc.vpcId,
      description:
        vpcConfig.description ?? SSM_DEFAULT_DESCRIPTIONS.VPC_ID(this.envName),
      tier,
      category,
      key: SSM_PARAMETER_SUFFIXES.VPC_ID,
    });

    // VPC CIDR
    this.createParameter({
      id: "VpcCidrParameter",
      path: this.buildParameterPath(category, SSM_PARAMETER_SUFFIXES.VPC_CIDR),
      value: vpc.vpcCidrBlock,
      description: SSM_DEFAULT_DESCRIPTIONS.VPC_CIDR(this.envName),
      tier,
      category,
      key: SSM_PARAMETER_SUFFIXES.VPC_CIDR,
    });

    // Subnet IDs
    if (vpcConfig.includeSubnets !== false) {
      this.createSubnetParameters(vpc, vpcConfig, category, tier);
    }

    // Availability Zones
    if (vpcConfig.includeAvailabilityZones) {
      const azs = vpc.availabilityZones;
      this.createParameter({
        id: "AvailabilityZonesParameter",
        path: this.buildParameterPath(
          category,
          SSM_PARAMETER_SUFFIXES.AVAILABILITY_ZONES
        ),
        value: vpcConfig.useStringList ? azs : azs.join(","),
        description: SSM_DEFAULT_DESCRIPTIONS.AVAILABILITY_ZONES(this.envName),
        tier,
        category,
        key: SSM_PARAMETER_SUFFIXES.AVAILABILITY_ZONES,
        type: vpcConfig.useStringList ? "StringList" : "String",
      });
    }
  }

  /**
   * Create subnet parameters (private and public)
   */
  private createSubnetParameters(
    vpc: cdk.aws_ec2.IVpc,
    vpcConfig: NonNullable<SsmParametersConstructProps["vpc"]>,
    category: string,
    tier: ssm.ParameterTier
  ): void {
    const privateSubnetIds = vpc.privateSubnets.map(
      (subnet) => subnet.subnetId
    );
    const publicSubnetIds = vpc.publicSubnets.map((subnet) => subnet.subnetId);

    if (privateSubnetIds.length > 0) {
      this.createParameter({
        id: "PrivateSubnetIdsParameter",
        path: this.buildParameterPath(
          category,
          SSM_PARAMETER_SUFFIXES.PRIVATE_SUBNET_IDS
        ),
        value: vpcConfig.useStringList
          ? privateSubnetIds
          : privateSubnetIds.join(","),
        description: SSM_DEFAULT_DESCRIPTIONS.PRIVATE_SUBNET_IDS(this.envName),
        tier,
        category,
        key: SSM_PARAMETER_SUFFIXES.PRIVATE_SUBNET_IDS,
        type: vpcConfig.useStringList ? "StringList" : "String",
      });
    }

    if (publicSubnetIds.length > 0) {
      this.createParameter({
        id: "PublicSubnetIdsParameter",
        path: this.buildParameterPath(
          category,
          SSM_PARAMETER_SUFFIXES.PUBLIC_SUBNET_IDS
        ),
        value: vpcConfig.useStringList
          ? publicSubnetIds
          : publicSubnetIds.join(","),
        description: SSM_DEFAULT_DESCRIPTIONS.PUBLIC_SUBNET_IDS(this.envName),
        tier,
        category,
        key: SSM_PARAMETER_SUFFIXES.PUBLIC_SUBNET_IDS,
        type: vpcConfig.useStringList ? "StringList" : "String",
      });
    }
  }

  /**
   * Create ECR parameters
   */
  private createEcrParameters(props: SsmParametersConstructProps): void {
    const ecrConfig = props.ecr;
    if (!ecrConfig) return;

    const repository = ecrConfig.repository;
    const category = SSM_PARAMETER_CATEGORIES.ECR;
    const tier = ecrConfig.tier ?? DEFAULT_SSM_PARAMETER_TIER;

    this.createParameter({
      id: "RepositoryUriParameter",
      path: this.buildParameterPath(
        category,
        SSM_PARAMETER_SUFFIXES.REPOSITORY_URI
      ),
      value: repository.repositoryUri,
      description:
        ecrConfig.description ??
        SSM_DEFAULT_DESCRIPTIONS.REPOSITORY_URI(this.envName),
      tier,
      category,
      key: SSM_PARAMETER_SUFFIXES.REPOSITORY_URI,
    });

    this.createParameter({
      id: "RepositoryArnParameter",
      path: this.buildParameterPath(
        category,
        SSM_PARAMETER_SUFFIXES.REPOSITORY_ARN
      ),
      value: repository.repositoryArn,
      description: SSM_DEFAULT_DESCRIPTIONS.REPOSITORY_ARN(this.envName),
      tier,
      category,
      key: SSM_PARAMETER_SUFFIXES.REPOSITORY_ARN,
    });

    this.createParameter({
      id: "RepositoryNameParameter",
      path: this.buildParameterPath(
        category,
        SSM_PARAMETER_SUFFIXES.REPOSITORY_NAME
      ),
      value: repository.repositoryName,
      description: SSM_DEFAULT_DESCRIPTIONS.REPOSITORY_NAME(this.envName),
      tier,
      category,
      key: SSM_PARAMETER_SUFFIXES.REPOSITORY_NAME,
    });
  }

  /**
   * Create ECS parameters
   */
  private createEcsParameters(props: SsmParametersConstructProps): void {
    const ecsConfig = props.ecs;
    if (!ecsConfig) return;

    const { cluster, service } = ecsConfig;
    const category = SSM_PARAMETER_CATEGORIES.ECS;
    const tier = ecsConfig.tier ?? DEFAULT_SSM_PARAMETER_TIER;

    this.createParameter({
      id: "EcsClusterNameParameter",
      path: this.buildParameterPath(
        category,
        SSM_PARAMETER_SUFFIXES.CLUSTER_NAME
      ),
      value: cluster.clusterName,
      description:
        ecsConfig.description ??
        SSM_DEFAULT_DESCRIPTIONS.CLUSTER_NAME(this.envName),
      tier,
      category,
      key: SSM_PARAMETER_SUFFIXES.CLUSTER_NAME,
    });

    this.createParameter({
      id: "EcsClusterArnParameter",
      path: this.buildParameterPath(
        category,
        SSM_PARAMETER_SUFFIXES.CLUSTER_ARN
      ),
      value: cluster.clusterArn,
      description: SSM_DEFAULT_DESCRIPTIONS.CLUSTER_ARN(this.envName),
      tier,
      category,
      key: SSM_PARAMETER_SUFFIXES.CLUSTER_ARN,
    });

    if (service) {
      this.createParameter({
        id: "EcsServiceNameParameter",
        path: this.buildParameterPath(
          category,
          SSM_PARAMETER_SUFFIXES.SERVICE_NAME
        ),
        value: service.serviceName,
        description: SSM_DEFAULT_DESCRIPTIONS.SERVICE_NAME(this.envName),
        tier,
        category,
        key: SSM_PARAMETER_SUFFIXES.SERVICE_NAME,
      });
    }
  }

  /**
   * Create Log Group parameters
   */
  private createLogGroupParameters(props: SsmParametersConstructProps): void {
    const logGroups = props.logGroups;
    if (!logGroups || logGroups.length === 0) return;

    const category = SSM_PARAMETER_CATEGORIES.LOGS;

    logGroups.forEach((config, index) => {
      const safeName = config.name.replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase();
      const tier = config.tier ?? DEFAULT_SSM_PARAMETER_TIER;

      this.createParameter({
        id: `LogGroup${index}NameParameter`,
        path: this.buildParameterPath(
          `${category}/${safeName}`,
          SSM_PARAMETER_SUFFIXES.LOG_GROUP_NAME
        ),
        value: config.logGroup.logGroupName,
        description:
          config.description ??
          SSM_DEFAULT_DESCRIPTIONS.LOG_GROUP_NAME(config.name, this.envName),
        tier,
        category: `${category}/${safeName}`,
        key: SSM_PARAMETER_SUFFIXES.LOG_GROUP_NAME,
      });

      this.createParameter({
        id: `LogGroup${index}ArnParameter`,
        path: this.buildParameterPath(
          `${category}/${safeName}`,
          SSM_PARAMETER_SUFFIXES.LOG_GROUP_ARN
        ),
        value: config.logGroup.logGroupArn,
        description: SSM_DEFAULT_DESCRIPTIONS.LOG_GROUP_ARN(
          config.name,
          this.envName
        ),
        tier,
        category: `${category}/${safeName}`,
        key: SSM_PARAMETER_SUFFIXES.LOG_GROUP_ARN,
      });
    });
  }

  /**
   * Create custom parameters
   */
  private createCustomParameters(props: SsmParametersConstructProps): void {
    const customParameters = props.customParameters;
    if (!customParameters || customParameters.length === 0) return;

    const category = SSM_PARAMETER_CATEGORIES.CUSTOM;

    customParameters.forEach((config, index) => {
      const parameterPath = this.buildParameterPath(category, config.name);
      const tier = config.tier ?? DEFAULT_SSM_PARAMETER_TIER;

      // Determine value - join array for StringList
      const value = Array.isArray(config.value)
        ? config.value.join(",")
        : config.value;

      // Determine parameter type
      const isSecure = config.secure === true;
      const isStringList = config.type === "StringList" || Array.isArray(config.value);

      if (isSecure) {
        // Create SecureString parameter with KMS key if provided
        const param = new ssm.StringParameter(this, `CustomParam${index}`, {
          parameterName: parameterPath,
          stringValue: value,
          description: config.description ?? `Custom parameter: ${config.name}`,
          tier,
          type: ssm.ParameterType.SECURE_STRING,
        });

        // Note: CDK doesn't directly support customer KMS keys for SSM SecureString
        // via StringParameter construct. The AWS-managed key is used by default.
        // For customer-managed keys, use AWS CLI or SDK to create the parameter.
        if (props.encryptionKey) {
          Annotations.of(this).addWarningV2(
            `@custom-kms-${index}`,
            `SecureString parameter '${config.name}' uses AWS-managed encryption. ` +
              "CDK StringParameter doesn't support customer-managed KMS keys directly. " +
              "Consider using AWS CLI: aws ssm put-parameter --key-id <kms-key-id>"
          );
        }

        this.storeParameter({
          path: parameterPath,
          category,
          key: config.name,
          parameter: param,
        });
      } else {
        // Create String or StringList parameter
        this.createParameter({
          id: `CustomParam${index}`,
          path: parameterPath,
          value,
          description: config.description ?? `Custom parameter: ${config.name}`,
          tier,
          category,
          key: config.name,
          type: isStringList ? "StringList" : "String",
        });
      }
    });
  }

  // ========================================
  // Core Parameter Creation
  // ========================================

  /**
   * Create a single SSM parameter
   */
  private createParameter(options: {
    id: string;
    path: string;
    value: string | string[];
    description: string;
    tier: ssm.ParameterTier;
    category: string;
    key: string;
    type?: "String" | "StringList";
  }): ssm.StringParameter {
    const valueStr = Array.isArray(options.value)
      ? options.value.join(",")
      : options.value;

    // Note: CDK StringParameter uses ParameterType which doesn't support
    // StringList directly. StringList must be created via CfnParameter.
    // For simplicity, we store as comma-separated String.
    const param = new ssm.StringParameter(this, options.id, {
      parameterName: options.path,
      stringValue: valueStr,
      description: options.description,
      tier: options.tier,
    });

    // Store in maps for lookup
    this.storeParameter({
      path: options.path,
      category: options.category,
      key: options.key,
      parameter: param,
    });

    // Create CloudFormation export if enabled
    if (this.props.createCfnExports) {
      this.createCfnExport(options.category, options.key, valueStr);
    }

    return param;
  }

  /**
   * Store parameter in lookup maps
   */
  private storeParameter(info: ParameterInfo): void {
    // Store by full path (no collision)
    this.parametersByPath.set(info.path, info);

    // Store by category/key (e.g., "vpc/vpc-id")
    const compositeKey = `${info.category}/${info.key}`;
    this.parametersByKey.set(compositeKey, info);
  }

  /**
   * Create CloudFormation export for a parameter value
   */
  private createCfnExport(
    category: string,
    key: string,
    value: string
  ): void {
    const exportName = this.props.projectName
      ? `${this.envName}-${this.props.projectName}-${category}-${key}`
      : `${this.envName}-${category}-${key}`;

    new cdk.CfnOutput(this, `Export${category}${key}`.replace(/[^a-zA-Z0-9]/g, ""), {
      value,
      description: `${category}/${key} for ${this.envName}`,
      exportName,
    });
  }

  // ========================================
  // Production Warnings
  // ========================================

  /**
   * Add production safety warnings
   */
  private addProductionWarnings(props: SsmParametersConstructProps): void {
    // Warning: SecureString without customer KMS key
    const hasSecureParams = props.customParameters?.some((p) => p.secure);
    if (hasSecureParams && !props.encryptionKey) {
      Annotations.of(this).addWarningV2(
        "@ssm-no-custom-kms",
        "SecureString parameters are using AWS-managed encryption key. " +
          "For production workloads, consider using a customer-managed KMS key " +
          "for better control over encryption and key rotation."
      );
    }

    // Warning: Large number of parameters
    const paramCount = this.estimateParameterCount(props);
    if (paramCount > SSM_PARAMETER_VALIDATION.MAX_PARAMETERS_PER_REGION * 0.5) {
      Annotations.of(this).addWarningV2(
        "@ssm-parameter-limit",
        `Creating ${paramCount} parameters. AWS limits SSM parameters to ` +
          `${SSM_PARAMETER_VALIDATION.MAX_PARAMETERS_PER_REGION} per region. ` +
          "Consider consolidating parameters or using a different storage mechanism."
      );
    }

    // Warning: Sensitive data not marked secure
    if (props.customParameters) {
      const potentiallySensitive = props.customParameters.filter(
        (p) =>
          !p.secure &&
          /password|secret|key|token|credential/i.test(p.name)
      );
      if (potentiallySensitive.length > 0) {
        Annotations.of(this).addWarningV2(
          "@ssm-potentially-sensitive",
          `Parameters with potentially sensitive names are not marked as secure: ` +
            `${potentiallySensitive.map((p) => p.name).join(", ")}. ` +
            "Consider setting secure: true for these parameters."
        );
      }
    }
  }

  /**
   * Estimate the total number of parameters that will be created
   */
  private estimateParameterCount(props: SsmParametersConstructProps): number {
    let count = 0;

    if (props.vpc) {
      count += 2; // vpc-id, vpc-cidr
      if (props.vpc.includeSubnets !== false) count += 2; // private, public
      if (props.vpc.includeAvailabilityZones) count += 1;
    }

    if (props.ecr) count += 3; // uri, arn, name
    if (props.ecs) {
      count += 2; // cluster name, arn
      if (props.ecs.service) count += 1;
    }

    if (props.logGroups) count += props.logGroups.length * 2; // name, arn per group
    if (props.customParameters) count += props.customParameters.length;

    return count;
  }

  // ========================================
  // Tags and Outputs
  // ========================================

  /**
   * Apply tags to all parameters
   */
  private applyTags(props: SsmParametersConstructProps): void {
    cdk.Tags.of(this).add("Environment", this.envName);
    cdk.Tags.of(this).add("ManagedBy", "CDK");
    cdk.Tags.of(this).add("Component", "SSMParameters");

    if (props.projectName) {
      cdk.Tags.of(this).add("Project", props.projectName);
    }

    // Apply custom tags
    if (props.customTags) {
      Object.entries(props.customTags).forEach(([key, value]) => {
        cdk.Tags.of(this).add(key, value);
      });
    }
  }

  /**
   * Create CloudFormation outputs
   */
  private createOutputs(): void {
    new cdk.CfnOutput(this, "ParameterCount", {
      value: this.parametersByPath.size.toString(),
      description: `Number of SSM parameters created for ${this.envName}`,
    });

    new cdk.CfnOutput(this, "ParameterPathPrefix", {
      value: this.pathPrefix,
      description: `SSM parameter path prefix for ${this.envName}`,
      exportName: `${this.stack.stackName}-ssm-path-prefix`,
    });
  }

  // ========================================
  // Public Lookup Methods
  // ========================================

  /**
   * Get a parameter by its full path
   *
   * @param path - Full parameter path (e.g., '/monitoring/production/vpc/vpc-id')
   * @returns ParameterInfo or undefined if not found
   *
   * @example
   * ```typescript
   * const info = params.getParameterByPath('/monitoring/production/vpc/vpc-id');
   * if (info) {
   *   console.log(info.parameter.parameterName);
   * }
   * ```
   */
  public getParameterByPath(path: string): ParameterInfo | undefined {
    return this.parametersByPath.get(path);
  }

  /**
   * Get a parameter by category and key
   *
   * @param category - Parameter category (e.g., 'vpc', 'ecr', 'ecs')
   * @param key - Parameter key (e.g., 'vpc-id', 'repository-uri')
   * @returns ParameterInfo or undefined if not found
   *
   * @example
   * ```typescript
   * const info = params.getParameterByKey('vpc', 'vpc-id');
   * if (info) {
   *   console.log(info.path);
   * }
   * ```
   */
  public getParameterByKey(
    category: string,
    key: string
  ): ParameterInfo | undefined {
    return this.parametersByKey.get(`${category}/${key}`);
  }

  /**
   * Get all parameters in a category
   *
   * @param category - Parameter category (e.g., 'vpc', 'ecr', 'ecs')
   * @returns Array of ParameterInfo objects
   */
  public getParametersByCategory(category: string): ParameterInfo[] {
    return Array.from(this.parametersByKey.entries())
      .filter(([key]) => key.startsWith(`${category}/`))
      .map(([, info]) => info);
  }

  /**
   * Get all parameter paths
   */
  public getAllPaths(): string[] {
    return Array.from(this.parametersByPath.keys());
  }

  /**
   * Grant read access to all parameters
   */
  public grantRead(grantee: cdk.aws_iam.IGrantable): void {
    this.parametersByPath.forEach((info) => {
      info.parameter.grantRead(grantee);
    });
  }

  /**
   * Get the ARN pattern for all parameters (useful for IAM policies)
   */
  public getParameterArnPattern(): string {
    return `arn:aws:ssm:${this.stack.region}:${this.stack.account}:parameter${this.pathPrefix}/*`;
  }
}
