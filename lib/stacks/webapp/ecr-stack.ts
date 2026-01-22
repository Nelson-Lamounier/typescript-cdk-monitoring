/** @format */

import * as cdk from "aws-cdk-lib";
import * as ecr from "aws-cdk-lib/aws-ecr";
import { Construct } from "constructs";

import { EcrConstruct } from "../../constructs/storage/ecr/ecr-construct";
import { EnvironmentConfig } from "../../../config/environments";
import { SuppressionManager } from "../../cdk-nag";

/**
 * Properties for WebappEcrStack
 */
export interface WebappEcrStackProps extends cdk.StackProps {
  envName: string;
  projectName: string;
  envConfig: EnvironmentConfig;
  /**
   * Repository name for the webapp container images
   * @default `${projectName}-webapp`
   */
  repositoryName?: string;
  /**
   * Pipeline account ID for cross-account ECR access
   * Used to grant CI/CD pipeline permissions to push images
   */
  pipelineAccount?: string;
  /**
   * Custom lifecycle rules for image retention
   * If not provided, uses default: keep last 10 images
   */
  lifecycleRules?: Array<{
    description?: string;
    rulePriority?: number;
    maxImageCount?: number;
    maxImageAgeDays?: number;
    tagStatus?: ecr.TagStatus;
    tagPrefixList?: string[];
  }>;
  /**
   * Enable image replication to other regions
   */
  replicationDestinations?: Array<{
    region: string;
    registryId?: string;
  }>;
}

/**
 * WebappEcrStack - Provisions ECR repository for webapp container images
 *
 * This stack creates:
 * - ECR repository for webapp container images
 * - Lifecycle policies to manage image retention
 * - Cross-account access for CI/CD pipeline
 * - CloudFormation exports for repository URI
 *
 * Dependencies:
 * - None (standalone stack)
 *
 * Exported Resources:
 * - Repository URI (export: `${environment}-${projectName}-ecr-repository-uri`)
 * - Repository ARN (export: `${environment}-${projectName}-ecr-repository-arn`)
 *
 * Cost Optimisation:
 * - Lifecycle policies automatically clean up old images
 * - Default retention: 10 images (configurable)
 * - Image scanning enabled for security
 *
 * @see lib/constructs/storage/ecr/ecr-construct.ts
 */
export class WebappEcrStack extends cdk.Stack {
  public readonly repository: ecr.Repository;

  constructor(scope: Construct, id: string, props: WebappEcrStackProps) {
    super(scope, id, props);

    const {
      envName,
      projectName,
      envConfig,
      repositoryName = `${projectName}-webapp`,
      pipelineAccount,
      lifecycleRules,
      replicationDestinations,
    } = props;

    // ========================================================================
    // ECR REPOSITORY
    // ========================================================================

    const ecrConstruct = new EcrConstruct(this, "EcrRepository", {
      envName,
      projectName,
      repositoryName,
      imageScanOnPush: true, // Enable vulnerability scanning
      imageTagMutability: envConfig.isProduction
        ? ecr.TagMutability.IMMUTABLE // Production: prevent overwrites
        : ecr.TagMutability.MUTABLE, // Non-production: allow overwrites for testing
      lifecycleRules: lifecycleRules || [
        {
          description: "Keep recent images to control storage costs",
          maxImageCount: envConfig.isProduction ? 20 : 10, // Production: keep more images
          rulePriority: 1,
          tagStatus: ecr.TagStatus.ANY,
        },
      ],
      replicationDestinations,
      pipelineAccounts: pipelineAccount ? [pipelineAccount] : undefined,
      removalPolicy: envConfig.isProduction
        ? cdk.RemovalPolicy.RETAIN // Production: retain images on stack deletion
        : cdk.RemovalPolicy.DESTROY, // Non-production: allow cleanup
    });

    this.repository = ecrConstruct.repository;

    // ========================================================================
    // CDK NAG SUPPRESSIONS & TAGS
    // ========================================================================

    SuppressionManager.applyToStack(this, "WebappEcrStack", envName);
    cdk.Tags.of(this).add("Stack", "WebappEcr");
    cdk.Tags.of(this).add("Project", projectName);
    cdk.Tags.of(this).add("Environment", envName);
    cdk.Tags.of(this).add("Layer", "Storage");
    cdk.Tags.of(this).add("ManagedBy", "CDK");

    // ========================================================================
    // STACK OUTPUTS
    // ========================================================================

    const shouldExport = !envName.includes("pipeline");
    const exportPrefix = `${envName}-${projectName}`;

    new cdk.CfnOutput(this, "RepositoryUri", {
      value: this.repository.repositoryUri,
      description: "ECR repository URI for webapp container images",
      ...(shouldExport && {
        exportName: `${exportPrefix}-ecr-repository-uri`,
      }),
    });

    new cdk.CfnOutput(this, "RepositoryArn", {
      value: this.repository.repositoryArn,
      description: "ECR repository ARN for IAM policies",
      ...(shouldExport && {
        exportName: `${exportPrefix}-ecr-repository-arn`,
      }),
    });

    new cdk.CfnOutput(this, "RepositoryName", {
      value: this.repository.repositoryName,
      description: "ECR repository name",
      ...(shouldExport && {
        exportName: `${exportPrefix}-ecr-repository-name`,
      }),
    });
  }
}
