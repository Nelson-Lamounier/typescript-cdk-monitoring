/** @format */

import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";

import { CFN_EXPORT_PATTERN } from "../../shared/constants/config-constants";
import { StackOutputsConstructProps } from "../../shared/types/config-types";
import { validateEnvName } from "../../shared/utils/validation";

/**
 * Stack Outputs Construct
 *
 * Creates CloudFormation Outputs for infrastructure resources.
 * These outputs are visible in the CloudFormation console and can be
 * referenced by other stacks or external tools.
 *
 * Benefits:
 * - Cross-stack references via Fn::ImportValue
 * - Visible in CloudFormation console
 * - Can be queried via AWS CLI/SDK
 *
 * Limitations vs SSM Parameters:
 * - Cannot be updated without stack update
 * - Circular dependency limitations
 * - Cross-account access requires additional setup
 *
 * @example
 * ```typescript
 * const outputs = new StackOutputsConstruct(this, 'Outputs', {
 *   envName: 'production',
 *   projectName: 'monitoring',
 *   vpc: myVpc,
 *   cluster: myCluster,
 *   customOutputs: [
 *     { name: 'ApiUrl', value: api.url, description: 'API Gateway URL' },
 *   ],
 * });
 *
 * // Access created outputs
 * const vpcIdOutput = outputs.getOutput('VpcId');
 * ```
 */
export class StackOutputsConstruct extends Construct {
  public readonly outputs: Map<string, cdk.CfnOutput>;
  private readonly envName: string;
  private readonly projectName?: string;

  constructor(
    scope: Construct,
    id: string,
    props: StackOutputsConstructProps
  ) {
    super(scope, id);

    this.outputs = new Map();
    this.envName = props.envName;
    this.projectName = props.projectName;

    // Validate inputs
    this.validateInputs(props);

    // Create VPC outputs
    if (props.vpc) {
      this.createVpcOutputs(props);
    }

    // Create ECR outputs
    if (props.repository) {
      this.createEcrOutputs(props);
    }

    // Create ECS outputs
    if (props.cluster || props.service) {
      this.createEcsOutputs(props);
    }

    // Create custom outputs
    if (props.customOutputs && props.customOutputs.length > 0) {
      this.createCustomOutputs(props);
    }
  }

  /**
   * Validate inputs
   */
  private validateInputs(props: StackOutputsConstructProps): void {
    validateEnvName(props.envName);

    // Ensure at least one output configuration is provided
    const hasConfig =
      props.vpc ||
      props.repository ||
      props.cluster ||
      props.service ||
      (props.customOutputs && props.customOutputs.length > 0);

    if (!hasConfig) {
      throw new Error(
        "At least one output configuration must be provided.\n\n" +
          "Available options:\n" +
          "  - vpc: VPC outputs (vpc-id, vpc-cidr)\n" +
          "  - repository: ECR outputs (repository-uri, repository-arn)\n" +
          "  - cluster: ECS cluster outputs\n" +
          "  - service: ECS service outputs\n" +
          "  - customOutputs: Custom outputs"
      );
    }

    // Validate custom outputs have required fields
    if (props.customOutputs) {
      props.customOutputs.forEach((output, index) => {
        if (!output.name || output.name.trim().length === 0) {
          throw new Error(
            `Custom output at index ${index} is missing 'name' field`
          );
        }
        if (output.value === undefined || output.value === null) {
          throw new Error(
            `Custom output '${output.name}' is missing 'value' field`
          );
        }
      });
    }
  }

  /**
   * Build export name with consistent pattern
   */
  private buildExportName(suffix: string): string {
    return this.projectName
      ? `${this.envName}-${this.projectName}-${suffix}`
      : `${this.envName}-${suffix}`;
  }

  /**
   * Create VPC outputs
   */
  private createVpcOutputs(props: StackOutputsConstructProps): void {
    const vpc = props.vpc!;

    this.createOutput(
      "VpcId",
      vpc.vpcId,
      "VPC ID",
      this.buildExportName(CFN_EXPORT_PATTERN.VPC_ID)
    );

    this.createOutput(
      "VpcCidr",
      vpc.vpcCidrBlock,
      "VPC CIDR Block",
      this.buildExportName(CFN_EXPORT_PATTERN.VPC_CIDR)
    );
  }

  /**
   * Create ECR outputs
   */
  private createEcrOutputs(props: StackOutputsConstructProps): void {
    const repository = props.repository!;

    this.createOutput(
      "RepositoryUri",
      repository.repositoryUri,
      "ECR Repository URI",
      this.buildExportName(CFN_EXPORT_PATTERN.ECR_URI)
    );

    this.createOutput(
      "RepositoryArn",
      repository.repositoryArn,
      "ECR Repository ARN",
      this.buildExportName(CFN_EXPORT_PATTERN.ECR_ARN)
    );

    this.createOutput(
      "RepositoryName",
      repository.repositoryName,
      "ECR Repository Name",
      this.buildExportName(CFN_EXPORT_PATTERN.ECR_NAME)
    );
  }

  /**
   * Create ECS outputs
   */
  private createEcsOutputs(props: StackOutputsConstructProps): void {
    if (props.cluster) {
      this.createOutput(
        "EcsClusterName",
        props.cluster.clusterName,
        "ECS Cluster Name",
        this.buildExportName(CFN_EXPORT_PATTERN.ECS_CLUSTER_NAME)
      );

      this.createOutput(
        "EcsClusterArn",
        props.cluster.clusterArn,
        "ECS Cluster ARN",
        this.buildExportName(CFN_EXPORT_PATTERN.ECS_CLUSTER_ARN)
      );
    }

    if (props.service) {
      this.createOutput(
        "EcsServiceName",
        props.service.serviceName,
        "ECS Service Name",
        this.buildExportName(CFN_EXPORT_PATTERN.ECS_SERVICE_NAME)
      );
    }
  }

  /**
   * Create custom outputs
   */
  private createCustomOutputs(props: StackOutputsConstructProps): void {
    props.customOutputs!.forEach((config, index) => {
      const id = config.name.replace(/[^a-zA-Z0-9]/g, "");
      const exportName = this.buildExportName(
        config.name.toLowerCase().replace(/[^a-z0-9]/g, "-")
      );

      this.createOutput(
        `Custom${id}${index}`,
        config.value,
        config.description ?? `Custom output: ${config.name}`,
        exportName
      );
    });
  }

  /**
   * Create a single CloudFormation output
   */
  private createOutput(
    id: string,
    value: string,
    description: string,
    exportName: string
  ): cdk.CfnOutput {
    const output = new cdk.CfnOutput(this, id, {
      value,
      description,
      exportName,
    });

    this.outputs.set(id, output);
    return output;
  }

  /**
   * Get an output by its ID
   */
  public getOutput(id: string): cdk.CfnOutput | undefined {
    return this.outputs.get(id);
  }

  /**
   * Get all output IDs
   */
  public getOutputIds(): string[] {
    return Array.from(this.outputs.keys());
  }
}
