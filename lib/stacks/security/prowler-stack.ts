/** @format */

import * as cdk from "aws-cdk-lib";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as ssm from "aws-cdk-lib/aws-ssm";
import { NagSuppressions } from "cdk-nag";
import { Construct } from "constructs";

import { S3BucketConstruct } from "../../constructs/storage/s3";
import { ProwlerConstruct } from "../../constructs/services/security/prowler-construct";
import { applyStackTags } from "../../shared/helpers/stack-tagging-helper";
import {
  getProwlerS3LifecycleDays,
  PROWLER_S3_LIFECYCLE,
} from "../../shared/constants/security-constants";
import { ProwlerStackProps } from "../../shared/types/security-types";
import { validateEnvName } from "../../shared/utils/validation";
import { isProductionEnvironment } from "../../shared/utils/environment";

/**
 * ProwlerStack - Security Compliance Scanning Infrastructure
 *
 * This stack provisions infrastructure for continuous security compliance
 * monitoring using Prowler, an open-source AWS security scanner.
 *
 * Architecture:
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │                          ProwlerStack                               │
 * │                                                                      │
 * │  ┌─────────────────┐     ┌─────────────────┐     ┌──────────────┐  │
 * │  │  EventBridge    │────▶│  ECS Fargate    │────▶│  S3 Bucket   │  │
 * │  │  Schedule       │     │  (Prowler)      │     │  (Results)   │  │
 * │  └─────────────────┘     └─────────────────┘     └──────────────┘  │
 * │                                 │                       │          │
 * │                                 ▼                       ▼          │
 * │                          ┌─────────────────┐     ┌──────────────┐  │
 * │                          │  CloudWatch     │     │  Grafana     │  │
 * │                          │  Logs           │     │  Dashboard   │  │
 * │                          └─────────────────┘     └──────────────┘  │
 * └─────────────────────────────────────────────────────────────────────┘
 *
 * Components:
 * - S3 Bucket: Stores Prowler scan results in JSON-OCSF format
 * - ECS Fargate Task: Runs Prowler container on schedule
 * - EventBridge Rule: Triggers scheduled scans
 * - CloudWatch Logs: Stores Prowler execution logs
 * - SSM Parameters: Exposes bucket details for cross-stack reference
 *
 * Cost Optimisation:
 * - Uses Fargate Spot for non-production (up to 70% savings)
 * - Scheduled execution (not continuous)
 * - S3 lifecycle policies for result retention
 * - Weekly scans in development, daily in production
 *
 * Compliance Frameworks:
 * - CIS AWS Foundations Benchmark (default for all environments)
 * - AWS Foundational Security Best Practices
 * - PCI-DSS 3.2.1 (production only)
 * - HIPAA, GDPR, SOC2 (optional)
 *
 * Dependencies:
 * - VPC (for Fargate networking)
 * - Optional: Existing ECS cluster
 *
 * @example
 * ```typescript
 * const prowlerStack = new ProwlerStack(app, 'ProwlerStack', {
 *   envName: 'development',
 *   vpc: networkingStack.vpc,
 * });
 * ```
 */
export class ProwlerStack extends cdk.Stack {
  /**
   * S3 bucket for Prowler results
   */
  public readonly resultsBucket: s3.IBucket;

  /**
   * ECS cluster used for Prowler tasks
   */
  public readonly cluster: ecs.ICluster;

  /**
   * Prowler construct
   */
  public readonly prowler: ProwlerConstruct;

  constructor(scope: Construct, id: string, props: ProwlerStackProps) {
    super(scope, id, props);

    // ========================================================================
    // VALIDATION
    // ========================================================================
    validateEnvName(props.envName);

    if (!props.cluster) {
      throw new Error(
        "ECS cluster is required for ProwlerStack.\n\n" +
          "Pass the existing monitoring cluster from MonitoringInfraStack:\n" +
          "  cluster: monitoringInfraStack.cluster"
      );
    }

    const { envName, projectName = "security" } = props;
    const isProduction = isProductionEnvironment(envName);

    // ========================================================================
    // 1. S3 BUCKET FOR RESULTS
    // ========================================================================
    if (props.resultsBucket) {
      this.resultsBucket = props.resultsBucket;
    } else {
      const lifecycleDays = getProwlerS3LifecycleDays(envName);
      const removalPolicy = isProduction
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY;

      const bucketConstruct = new S3BucketConstruct(this, "ResultsBucket", {
        envName,
        config: {
          bucketName: `prowler-results-${envName}-${this.account}`,
          purpose: "Prowler Security Scan Results",
          encryption: s3.BucketEncryption.S3_MANAGED,
          versioned: isProduction,
          removalPolicy,
          autoDeleteObjects: removalPolicy === cdk.RemovalPolicy.DESTROY,
          lifecycleRules: [
            {
              id: "ExpireOldResults",
              enabled: true,
              expiration: cdk.Duration.days(lifecycleDays),
            },
            // Transition to Glacier for production (cost savings)
            ...(isProduction
              ? [
                  {
                    id: "GlacierTransition",
                    enabled: true,
                    transitions: [
                      {
                        storageClass: s3.StorageClass.GLACIER,
                        transitionAfter: cdk.Duration.days(
                          PROWLER_S3_LIFECYCLE.GLACIER_TRANSITION_DAYS
                        ),
                      },
                    ],
                  },
                ]
              : []),
          ],
        },
      });

      this.resultsBucket = bucketConstruct.bucket;

      // CDK Nag suppression for S3 bucket
      NagSuppressions.addResourceSuppressions(
        bucketConstruct.bucket,
        [
          {
            id: "AwsSolutions-S1",
            reason:
              "Access logging is optional for Prowler results bucket. " +
              "The bucket contains security scan results, not sensitive data. " +
              "Enable via accessLogsBucket prop if audit logging is required.",
          },
        ],
        true
      );
    }

    // ========================================================================
    // 2. ECS CLUSTER (Use existing EC2-based cluster)
    // ========================================================================
    // Cluster is required and validated above
    // Prowler runs as an EC2 task on the existing cluster to avoid additional Fargate costs
    this.cluster = props.cluster;

    // ========================================================================
    // 3. PROWLER CONSTRUCT
    // ========================================================================
    this.prowler = new ProwlerConstruct(this, "Prowler", {
      cluster: this.cluster,
      envName,
      projectName,
      resultsBucket: this.resultsBucket,
      // Apply any custom configuration from props
      ...props.prowlerConfig,
    });

    // ========================================================================
    // 4. SSM PARAMETERS
    // ========================================================================
    const basePrefix = `/security/${envName}/prowler`;

    new ssm.StringParameter(this, "ResultsBucketNameParam", {
      parameterName: `${basePrefix}/results-bucket-name`,
      stringValue: this.resultsBucket.bucketName,
      description: `Prowler results bucket name for ${envName}`,
      tier: ssm.ParameterTier.STANDARD,
    });

    new ssm.StringParameter(this, "ResultsBucketArnParam", {
      parameterName: `${basePrefix}/results-bucket-arn`,
      stringValue: this.resultsBucket.bucketArn,
      description: `Prowler results bucket ARN for ${envName}`,
      tier: ssm.ParameterTier.STANDARD,
    });

    new ssm.StringParameter(this, "TaskDefinitionArnParam", {
      parameterName: `${basePrefix}/task-definition-arn`,
      stringValue: this.prowler.taskDefinition.taskDefinitionArn,
      description: `Prowler task definition ARN for ${envName}`,
      tier: ssm.ParameterTier.STANDARD,
    });

    if (this.prowler.scheduleRule) {
      new ssm.StringParameter(this, "ScheduleRuleArnParam", {
        parameterName: `${basePrefix}/schedule-rule-arn`,
        stringValue: this.prowler.scheduleRule.ruleArn,
        description: `Prowler schedule rule ARN for ${envName}`,
        tier: ssm.ParameterTier.STANDARD,
      });
    }

    // ========================================================================
    // 5. CLOUDFORMATION OUTPUTS
    // ========================================================================
    if (props.createOutputs !== false) {
      this.createOutputs(props);
    }

    // ========================================================================
    // 6. STACK TAGS
    // ========================================================================
    applyStackTags(this, envName, projectName, {
      StackPurpose: "Security Compliance",
      Service: "Prowler",
    });
  }

  /**
   * Create CloudFormation outputs
   */
  private createOutputs(props: ProwlerStackProps): void {
    const { envName } = props;
    const enableExports = props.enableExports ?? false;

    new cdk.CfnOutput(this, "ResultsBucketName", {
      value: this.resultsBucket.bucketName,
      description: "Prowler results S3 bucket name",
      exportName: enableExports
        ? `${envName}-prowler-results-bucket-name`
        : undefined,
    });

    new cdk.CfnOutput(this, "ResultsBucketArn", {
      value: this.resultsBucket.bucketArn,
      description: "Prowler results S3 bucket ARN",
      exportName: enableExports
        ? `${envName}-prowler-results-bucket-arn`
        : undefined,
    });

    new cdk.CfnOutput(this, "ClusterArn", {
      value: this.cluster.clusterArn,
      description: "ECS cluster ARN for Prowler tasks",
      exportName: enableExports
        ? `${envName}-prowler-cluster-arn`
        : undefined,
    });

    new cdk.CfnOutput(this, "TaskDefinitionArn", {
      value: this.prowler.taskDefinition.taskDefinitionArn,
      description: "Prowler ECS task definition ARN",
      exportName: enableExports
        ? `${envName}-prowler-task-definition-arn`
        : undefined,
    });

    new cdk.CfnOutput(this, "LogGroupName", {
      value: this.prowler.logGroup.logGroupName,
      description: "Prowler CloudWatch log group name",
    });

    if (this.prowler.scheduleRule) {
      new cdk.CfnOutput(this, "ScheduleRuleArn", {
        value: this.prowler.scheduleRule.ruleArn,
        description: "EventBridge schedule rule ARN",
      });

      new cdk.CfnOutput(this, "NextScheduledScan", {
        value: `Check EventBridge rule: ${this.prowler.scheduleRule.ruleName}`,
        description: "View scheduled scan timing in EventBridge console",
      });
    }

    // Manual run command for ad-hoc scans
    new cdk.CfnOutput(this, "ManualRunInfo", {
      value: `aws ecs run-task --cluster ${this.cluster.clusterName} --task-definition ${this.prowler.taskDefinition.family} --launch-type FARGATE --network-configuration "awsvpcConfiguration={subnets=[SUBNET_ID],assignPublicIp=ENABLED}"`,
      description: "Command template for manual Prowler scan (replace SUBNET_ID)",
    });
  }
}
