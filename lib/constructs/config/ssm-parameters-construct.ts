/** @format */

import * as cdk from "aws-cdk-lib";
import * as ssm from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";

import {
  DEFAULT_SSM_PARAMETER_TIER,
  SSM_PARAMETER_PATH_PREFIXES,
  SSM_PARAMETER_SUFFIXES,
} from "../../shared/constants/config-constants";
import { SsmParametersConstructProps } from "../../shared/types/config-types";
import { validateEnvName } from "../../shared/utils/validation";

/**
 * SSM Parameters Construct
 *
 * Creates SSM Parameter Store parameters for infrastructure resources,
 * enabling dynamic discovery by other services and pipelines without
 * hardcoding values.
 *
 * Features:
 * - Flexible parameter creation (VPC, ECR, ECS, Logs, Custom)
 * - Consistent naming convention: /{service}/{envName}/{parameter}
 * - Support for SecureString parameters with KMS encryption
 * - Automatic tagging for resource management
 *
 * Benefits over CloudFormation Exports:
 * - Can be updated without stack updates
 * - Can be queried programmatically at runtime
 * - Better for cross-account access patterns
 * - No circular dependency limitations
 *
 * @example
 * ```typescript
 * const params = new SsmParametersConstruct(this, 'Parameters', {
 *   envName: 'production',
 *   projectName: 'monitoring',
 *   vpc: {
 *     vpc: myVpc,
 *     includeSubnets: true,
 *   },
 *   ecs: {
 *     cluster: myCluster,
 *     service: myService,
 *   },
 *   customParameters: [
 *     { name: 'api-url', value: 'https://api.example.com' },
 *   ],
 * });
 *
 * // Access created parameters
 * const vpcIdParam = params.getParameter('vpc-id');
 * ```
 */
export class SsmParametersConstruct extends Construct {
  public readonly parameters: Map<string, ssm.StringParameter>;
  private readonly envName: string;
  private readonly pathPrefix: string;
  private readonly stack = cdk.Stack.of(this);

  constructor(
    scope: Construct,
    id: string,
    props: SsmParametersConstructProps
  ) {
    super(scope, id);

    this.parameters = new Map();
    this.envName = props.envName;

    // Validate inputs
    this.validateInputs(props);

    // Build path prefix
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

    // Apply tags
    this.applyTags(props);

    // Create outputs
    this.createOutputs();
  }

  /**
   * Validate inputs
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

    // Validate custom parameters have required fields
    if (props.customParameters) {
      props.customParameters.forEach((param, index) => {
        if (!param.name || param.name.trim().length === 0) {
          throw new Error(
            `Custom parameter at index ${index} is missing 'name' field`
          );
        }
        if (param.value === undefined || param.value === null) {
          throw new Error(
            `Custom parameter '${param.name}' is missing 'value' field`
          );
        }
      });
    }
  }

  /**
   * Build path prefix for parameters
   */
  private buildPathPrefix(props: SsmParametersConstructProps): string {
    if (props.pathPrefix) {
      return props.pathPrefix.startsWith("/")
        ? props.pathPrefix
        : `/${props.pathPrefix}`;
    }

    return props.projectName
      ? `/${props.projectName}/${props.envName}`
      : `/${props.envName}`;
  }

  /**
   * Create VPC parameters
   */
  private createVpcParameters(props: SsmParametersConstructProps): void {
    const vpcConfig = props.vpc;
    if (!vpcConfig) return;

    const vpc = vpcConfig.vpc;
    const basePath = `${SSM_PARAMETER_PATH_PREFIXES.VPC}/${this.envName}`;

    // VPC ID
    this.createParameter(
      "VpcIdParameter",
      `${basePath}/${SSM_PARAMETER_SUFFIXES.VPC_ID}`,
      vpc.vpcId,
      `VPC ID for ${this.envName} environment`
    );

    // VPC CIDR
    this.createParameter(
      "VpcCidrParameter",
      `${basePath}/${SSM_PARAMETER_SUFFIXES.VPC_CIDR}`,
      vpc.vpcCidrBlock,
      `VPC CIDR Block for ${this.envName} environment`
    );

    // Private Subnet IDs
    if (vpcConfig.includeSubnets !== false) {
      const privateSubnetIds = vpc.privateSubnets
        .map((subnet) => subnet.subnetId)
        .join(",");

      if (privateSubnetIds) {
        this.createParameter(
          "PrivateSubnetIdsParameter",
          `${basePath}/${SSM_PARAMETER_SUFFIXES.PRIVATE_SUBNET_IDS}`,
          privateSubnetIds,
          `Private Subnet IDs for ${this.envName} environment (comma-separated)`
        );
      }

      const publicSubnetIds = vpc.publicSubnets
        .map((subnet) => subnet.subnetId)
        .join(",");

      if (publicSubnetIds) {
        this.createParameter(
          "PublicSubnetIdsParameter",
          `${basePath}/${SSM_PARAMETER_SUFFIXES.PUBLIC_SUBNET_IDS}`,
          publicSubnetIds,
          `Public Subnet IDs for ${this.envName} environment (comma-separated)`
        );
      }
    }

    // Availability Zones
    if (vpcConfig.includeAvailabilityZones) {
      const azs = vpc.availabilityZones.join(",");
      this.createParameter(
        "AvailabilityZonesParameter",
        `${basePath}/${SSM_PARAMETER_SUFFIXES.AVAILABILITY_ZONES}`,
        azs,
        `Availability Zones for ${this.envName} environment (comma-separated)`
      );
    }
  }

  /**
   * Create ECR parameters
   */
  private createEcrParameters(props: SsmParametersConstructProps): void {
    const ecrConfig = props.ecr;
    if (!ecrConfig) return;

    const repository = ecrConfig.repository;
    const basePath = `${SSM_PARAMETER_PATH_PREFIXES.ECR}/${this.envName}`;

    this.createParameter(
      "RepositoryUriParameter",
      `${basePath}/${SSM_PARAMETER_SUFFIXES.REPOSITORY_URI}`,
      repository.repositoryUri,
      `ECR Repository URI for ${this.envName} environment`
    );

    this.createParameter(
      "RepositoryArnParameter",
      `${basePath}/${SSM_PARAMETER_SUFFIXES.REPOSITORY_ARN}`,
      repository.repositoryArn,
      `ECR Repository ARN for ${this.envName} environment`
    );

    this.createParameter(
      "RepositoryNameParameter",
      `${basePath}/${SSM_PARAMETER_SUFFIXES.REPOSITORY_NAME}`,
      repository.repositoryName,
      `ECR Repository Name for ${this.envName} environment`
    );
  }

  /**
   * Create ECS parameters
   */
  private createEcsParameters(props: SsmParametersConstructProps): void {
    const ecsConfig = props.ecs;
    if (!ecsConfig) return;

    const { cluster, service } = ecsConfig;
    const basePath = `${SSM_PARAMETER_PATH_PREFIXES.ECS}/${this.envName}`;

    this.createParameter(
      "EcsClusterNameParameter",
      `${basePath}/${SSM_PARAMETER_SUFFIXES.CLUSTER_NAME}`,
      cluster.clusterName,
      `ECS Cluster Name for ${this.envName} environment`
    );

    this.createParameter(
      "EcsClusterArnParameter",
      `${basePath}/${SSM_PARAMETER_SUFFIXES.CLUSTER_ARN}`,
      cluster.clusterArn,
      `ECS Cluster ARN for ${this.envName} environment`
    );

    if (service) {
      this.createParameter(
        "EcsServiceNameParameter",
        `${basePath}/${SSM_PARAMETER_SUFFIXES.SERVICE_NAME}`,
        service.serviceName,
        `ECS Service Name for ${this.envName} environment`
      );
    }
  }

  /**
   * Create Log Group parameters
   */
  private createLogGroupParameters(props: SsmParametersConstructProps): void {
    const logGroups = props.logGroups;
    if (!logGroups || logGroups.length === 0) return;

    const basePath = `${SSM_PARAMETER_PATH_PREFIXES.LOGS}/${this.envName}`;

    logGroups.forEach((config, index) => {
      const safeName = config.name.replace(/[^a-zA-Z0-9-]/g, "-");

      this.createParameter(
        `LogGroup${index}NameParameter`,
        `${basePath}/${safeName}/${SSM_PARAMETER_SUFFIXES.LOG_GROUP_NAME}`,
        config.logGroup.logGroupName,
        `Log Group Name for ${config.name} in ${this.envName} environment`
      );

      this.createParameter(
        `LogGroup${index}ArnParameter`,
        `${basePath}/${safeName}/${SSM_PARAMETER_SUFFIXES.LOG_GROUP_ARN}`,
        config.logGroup.logGroupArn,
        `Log Group ARN for ${config.name} in ${this.envName} environment`
      );
    });
  }

  /**
   * Create custom parameters
   */
  private createCustomParameters(props: SsmParametersConstructProps): void {
    const customParameters = props.customParameters;
    if (!customParameters || customParameters.length === 0) return;

    const basePath = `${SSM_PARAMETER_PATH_PREFIXES.CUSTOM}/${this.envName}`;

    customParameters.forEach((config, index) => {
      const parameterName = `${basePath}/${config.name}`;

      if (config.secure && props.encryptionKey) {
        // Create SecureString parameter
        const param = new ssm.StringParameter(this, `CustomParam${index}`, {
          parameterName,
          stringValue: config.value,
          description: config.description ?? `Custom parameter: ${config.name}`,
          tier: config.tier ?? DEFAULT_SSM_PARAMETER_TIER,
          type: ssm.ParameterType.SECURE_STRING,
        });
        this.parameters.set(config.name, param);
      } else {
        this.createParameter(
          `CustomParam${index}`,
          parameterName,
          config.value,
          config.description ?? `Custom parameter: ${config.name}`,
          config.tier
        );
      }
    });
  }

  /**
   * Create a single SSM parameter
   */
  private createParameter(
    id: string,
    parameterName: string,
    value: string,
    description: string,
    tier?: ssm.ParameterTier
  ): ssm.StringParameter {
    const param = new ssm.StringParameter(this, id, {
      parameterName,
      stringValue: value,
      description,
      tier: tier ?? DEFAULT_SSM_PARAMETER_TIER,
    });

    // Store reference by a simplified key (last part of the path)
    const key = parameterName.split("/").pop() ?? parameterName;
    this.parameters.set(key, param);

    return param;
  }

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
      value: this.parameters.size.toString(),
      description: `Number of SSM parameters created for ${this.envName}`,
    });

    new cdk.CfnOutput(this, "ParameterPathPrefix", {
      value: this.pathPrefix,
      description: `SSM parameter path prefix for ${this.envName}`,
      exportName: `${this.stack.stackName}-ssm-path-prefix`,
    });
  }

  /**
   * Get a parameter by its key (last part of the path)
   */
  public getParameter(key: string): ssm.StringParameter | undefined {
    return this.parameters.get(key);
  }

  /**
   * Get all parameter names
   */
  public getParameterNames(): string[] {
    return Array.from(this.parameters.values()).map(
      (p) => p.parameterName
    );
  }

  /**
   * Grant read access to the parameters
   */
  public grantRead(grantee: cdk.aws_iam.IGrantable): void {
    this.parameters.forEach((param) => {
      param.grantRead(grantee);
    });
  }

  /**
   * Get the ARN pattern for all parameters (useful for IAM policies)
   */
  public getParameterArnPattern(): string {
    return `arn:aws:ssm:${this.stack.region}:${this.stack.account}:parameter${this.pathPrefix}/*`;
  }
}
