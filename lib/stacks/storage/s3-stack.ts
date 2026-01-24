/** @format */

import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as ssm from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";

import { S3BucketConstruct } from "../../constructs/storage/s3";
import { applyStackTags } from "../../shared/helpers/stack-tagging-helper";
import { MonitoringS3StackProps } from "../../shared/types/stack-types";
import { validateEnvName } from "../../shared/utils/validation";
import { isProductionEnvironment } from "../../shared/utils/environment";

/**
 * MonitoringS3Stack - Layer 0: S3 Storage for Monitoring
 *
 * This stack manages S3 buckets for monitoring services, including
 * dashboard storage, configuration backups, and monitoring data.
 *
 * Components:
 * - Dashboard Bucket: Grafana dashboard JSON files
 * - SSM Parameters: Bucket names and ARNs for cross-stack references
 * - S3 Deployment: Automatic dashboard deployment from config/
 *
 * Design Principles:
 * - Reusable S3 constructs for easy expansion
 * - Encryption at rest for all buckets
 * - Public access blocked by default
 * - Lifecycle rules for cost optimisation
 * - Environment-specific retention policies
 *
 * Dependencies:
 * - None (foundational stack)
 *
 * SSM Parameters Created:
 * - `/monitoring/{envName}/s3/dashboard-bucket-name` - Dashboard bucket name
 * - `/monitoring/{envName}/s3/dashboard-bucket-arn` - Dashboard bucket ARN
 *
 * Future Expansion:
 * - Configuration backup bucket
 * - Prometheus snapshot backup bucket
 * - CloudWatch logs archive bucket
 * - ALB access logs bucket
 *
 * Production Recommendations:
 * - removalPolicy: RETAIN (prevent accidental deletion)
 * - versioning: true (track changes to dashboards)
 * - enableAccessLogs: true (audit bucket access)
 * - lifecyclePolicy: Retain dashboards for 90+ days
 *
 * @example
 * ```typescript
 * // Development
 * const s3Stack = new MonitoringS3Stack(app, 'MonitoringS3', {
 *   envName: 'dev',
 *   removalPolicy: cdk.RemovalPolicy.DESTROY,
 * });
 *
 * // Production
 * const s3Stack = new MonitoringS3Stack(app, 'MonitoringS3', {
 *   envName: 'production',
 *   removalPolicy: cdk.RemovalPolicy.RETAIN,
 *   enableAccessLogs: true,
 *   dashboardRetentionDays: 365,
 * });
 * ```
 */
export class MonitoringS3Stack extends cdk.Stack {
  // ========================================================================
  // PUBLIC PROPERTIES
  // ========================================================================

  /**
   * Dashboard storage bucket
   */
  public readonly dashboardBucket: s3.IBucket;

  /**
   * Dashboard bucket name
   */
  public readonly dashboardBucketName: string;

  /**
   * Dashboard bucket ARN
   */
  public readonly dashboardBucketArn: string;

  // ========================================================================
  // PRIVATE PROPERTIES
  // ========================================================================

  private readonly props: MonitoringS3StackProps;
  private readonly isProduction: boolean;

  // ========================================================================
  // CONSTRUCTOR
  // ========================================================================

  constructor(scope: Construct, id: string, props: MonitoringS3StackProps) {
    super(scope, id, props);

    this.props = props;
    const { envName, projectName = "monitoring" } = props;

    // Validate environment name
    validateEnvName(envName);

    this.isProduction = isProductionEnvironment(envName);

    // ========================================================================
    // 1. DASHBOARD BUCKET
    // ========================================================================
    const dashboardBucketConstruct = this.createDashboardBucket(props);
    this.dashboardBucket = dashboardBucketConstruct.bucket;
    this.dashboardBucketName = dashboardBucketConstruct.bucketName;
    this.dashboardBucketArn = dashboardBucketConstruct.bucketArn;

    // ========================================================================
    // 2. DEPLOY DASHBOARDS TO S3
    // ========================================================================
    this.deployDashboardsToS3(props);

    // ========================================================================
    // 3. SSM PARAMETERS
    // ========================================================================
    if (props.createSsmParameters !== false) {
      this.createSsmParameters(props);
    }

    // ========================================================================
    // 4. CLOUDFORMATION OUTPUTS
    // ========================================================================
    if (props.createOutputs !== false) {
      this.createOutputs(props);
    }

    // ========================================================================
    // 5. CDK-NAG SUPPRESSIONS
    // ========================================================================
    this.applyCdkNagSuppressions();

    // ========================================================================
    // 6. STACK TAGS
    // ========================================================================
    applyStackTags(this, envName, projectName, {
      StackPurpose: "S3 Storage",
    });
  }

  // ========================================================================
  // DASHBOARD BUCKET CREATION
  // ========================================================================

  /**
   * Create S3 bucket for Grafana dashboards
   *
   * Stores pre-built Grafana dashboard JSON files that are deployed
   * to EFS during instance initialization.
   *
   * Benefits of S3 for dashboards:
   * - Centralized storage separate from EFS
   * - Easy dashboard updates via S3 deployment
   * - Version control via S3 versioning
   * - Lower cost than EFS for infrequent access
   * - Simpler backup and disaster recovery
   */
  private createDashboardBucket(
    props: MonitoringS3StackProps
  ): S3BucketConstruct {
    const { envName } = props;
    const removalPolicy = props.removalPolicy ?? cdk.RemovalPolicy.RETAIN;
    const retentionDays = props.dashboardRetentionDays ?? 90;

    return new S3BucketConstruct(this, "DashboardBucket", {
      envName,
      config: {
        bucketName: `monitoring-dashboards-${envName}-${this.account}`,
        purpose: "Grafana Dashboard Storage",
        encryption: s3.BucketEncryption.S3_MANAGED,
        versioned: props.enableVersioning ?? this.isProduction, // CKV_AWS_21 fix - enable in production by default
        removalPolicy,
        autoDeleteObjects:
          removalPolicy === cdk.RemovalPolicy.DESTROY && !this.isProduction,
        lifecycleRules: [
          {
            id: "DeleteOldDashboards",
            enabled: !this.isProduction,
            expiration: cdk.Duration.days(retentionDays),
          },
        ],
        enableAccessLogs: props.enableAccessLogs ?? false, // CKV_AWS_18 - make explicit
        accessLogsBucket: props.accessLogsBucket,
      },
    });
  }

  // ========================================================================
  // DASHBOARD DEPLOYMENT
  // ========================================================================

  /**
   * Deploy dashboard JSON files from config/grafana/dashboards to S3
   *
   * Uses CDK BucketDeployment to sync dashboard files from the local
   * config directory to S3. Files are deployed during stack deployment.
   */
  private deployDashboardsToS3(
    props: MonitoringS3StackProps
  ): s3deploy.BucketDeployment {
    const dashboardsPath =
      props.dashboardsPath ?? "./config/grafana/dashboards";

    return new s3deploy.BucketDeployment(this, "DashboardDeployment", {
      sources: [s3deploy.Source.asset(dashboardsPath)],
      destinationBucket: this.dashboardBucket,
      destinationKeyPrefix: "dashboards/",
      prune: true, // Remove old dashboards not in current deployment
      retainOnDelete: props.removalPolicy === cdk.RemovalPolicy.RETAIN,
      memoryLimit: 512,
    });
  }

  // ========================================================================
  // SSM PARAMETERS
  // ========================================================================

  /**
   * Create SSM parameters for cross-stack references
   */
  private createSsmParameters(props: MonitoringS3StackProps): void {
    const { envName } = props;
    const basePrefix = `/monitoring/${envName}/s3`;

    new ssm.StringParameter(this, "DashboardBucketNameParam", {
      parameterName: `${basePrefix}/dashboard-bucket-name`,
      stringValue: this.dashboardBucketName,
      description: `Dashboard bucket name for ${envName} monitoring`,
      tier: ssm.ParameterTier.STANDARD,
    });

    new ssm.StringParameter(this, "DashboardBucketArnParam", {
      parameterName: `${basePrefix}/dashboard-bucket-arn`,
      stringValue: this.dashboardBucketArn,
      description: `Dashboard bucket ARN for ${envName} monitoring`,
      tier: ssm.ParameterTier.STANDARD,
    });
  }

  // ========================================================================
  // CLOUDFORMATION OUTPUTS
  // ========================================================================

  /**
   * Create CloudFormation outputs
   */
  private createOutputs(props: MonitoringS3StackProps): void {
    const { envName } = props;
    const enableExports = props.enableExports ?? false;

    new cdk.CfnOutput(this, "DashboardBucketNameOutput", {
      value: this.dashboardBucketName,
      description: "Dashboard bucket name",
      exportName: enableExports
        ? `${envName}-monitoring-dashboard-bucket-name`
        : undefined,
    });

    new cdk.CfnOutput(this, "DashboardBucketArnOutput", {
      value: this.dashboardBucketArn,
      description: "Dashboard bucket ARN",
      exportName: enableExports
        ? `${envName}-monitoring-dashboard-bucket-arn`
        : undefined,
    });
  }

  // ========================================================================
  // CDK-NAG SUPPRESSIONS
  // ========================================================================

  /**
   * Apply CDK-Nag suppressions for known false positives
   */
  private applyCdkNagSuppressions(): void {
    // Suppress props variable
    void this.props;

    // Currently no other suppressions needed
    // Add suppressions here as needed for specific resources
  }
}
