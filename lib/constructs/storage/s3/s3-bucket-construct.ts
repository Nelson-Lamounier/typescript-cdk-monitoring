/** @format */

import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as kms from "aws-cdk-lib/aws-kms";
import { Construct } from "constructs";

import { isProductionEnvironment } from "../../../shared/utils/environment";

/**
 * S3 Bucket Configuration
 *
 * Defines bucket settings with environment-appropriate defaults
 */
export interface S3BucketConfig {
  /**
   * Unique bucket name
   * Must be globally unique across AWS
   * Format: {purpose}-{envName}-{accountId}
   */
  bucketName: string;

  /**
   * Bucket purpose/description
   * Used for tagging and CloudFormation logical ID
   */
  purpose: string;

  /**
   * Encryption type
   * @default S3_MANAGED (SSE-S3)
   */
  encryption?: s3.BucketEncryption;

  /**
   * KMS key for encryption (only used if encryption is KMS)
   */
  encryptionKey?: kms.IKey;

  /**
   * Enable versioning
   * @default false for non-production, true for production
   */
  versioned?: boolean;

  /**
   * Lifecycle rules for automatic object expiration
   */
  lifecycleRules?: s3.LifecycleRule[];

  /**
   * Removal policy
   * @default RETAIN for production, DESTROY for non-production
   */
  removalPolicy?: cdk.RemovalPolicy;

  /**
   * Enable auto-delete objects on stack deletion
   * Only works when removalPolicy is DESTROY
   * @default false
   */
  autoDeleteObjects?: boolean;

  /**
   * Block all public access
   * @default true (always block public access)
   */
  blockPublicAccess?: s3.BlockPublicAccess;

  /**
   * Enable access logging
   * @default false
   */
  enableAccessLogs?: boolean;

  /**
   * Access logs bucket (required if enableAccessLogs is true)
   */
  accessLogsBucket?: s3.IBucket;

  /**
   * Access logs prefix
   * @default {bucketName}/
   */
  accessLogsPrefix?: string;

  /**
   * CORS rules for cross-origin access
   */
  cors?: s3.CorsRule[];

  /**
   * Enable intelligent tiering
   * Automatically moves objects to lower-cost storage tiers
   * @default false
   */
  enableIntelligentTiering?: boolean;
}

/**
 * Props for S3BucketConstruct
 */
export interface S3BucketConstructProps {
  envName: string;
  config: S3BucketConfig;
}

/**
 * S3BucketConstruct - Reusable S3 Bucket with Best Practices
 *
 * Creates an S3 bucket with security best practices and environment-appropriate
 * defaults. Designed for reuse across multiple bucket types.
 *
 * Features:
 * - Encryption at rest (SSE-S3 or SSE-KMS)
 * - Block all public access by default
 * - Versioning (configurable)
 * - Lifecycle rules for cost optimisation
 * - Access logging (optional)
 * - CORS configuration (optional)
 * - Intelligent tiering (optional)
 * - Automatic tagging
 *
 * Security Best Practices:
 * - Public access blocked by default
 * - Encryption enabled by default
 * - Secure transport enforced via bucket policy
 * - Versioning enabled in production
 * - Deletion protection via RETAIN policy in production
 *
 * Cost Optimisation:
 * - Lifecycle rules for automatic cleanup
 * - Intelligent tiering for infrequent access
 * - Auto-delete objects in non-production
 *
 * @example
 * ```typescript
 * // Dashboard storage bucket
 * const dashboardBucket = new S3BucketConstruct(this, 'DashboardBucket', {
 *   envName: 'development',
 *   config: {
 *     bucketName: `dashboards-${envName}-${account}`,
 *     purpose: 'Grafana Dashboard Storage',
 *     versioned: false,
 *     lifecycleRules: [{
 *       id: 'CleanupOldDashboards',
 *       enabled: true,
 *       expiration: cdk.Duration.days(90),
 *     }],
 *   },
 * });
 * ```
 *
 * @example
 * ```typescript
 * // Application logs bucket with KMS encryption
 * const logsBucket = new S3BucketConstruct(this, 'LogsBucket', {
 *   envName: 'production',
 *   config: {
 *     bucketName: `logs-${envName}-${account}`,
 *     purpose: 'Application Logs',
 *     encryption: s3.BucketEncryption.KMS,
 *     encryptionKey: kmsKey,
 *     versioned: true,
 *     lifecycleRules: [{
 *       id: 'ArchiveOldLogs',
 *       enabled: true,
 *       transitions: [{
 *         storageClass: s3.StorageClass.GLACIER,
 *         transitionAfter: cdk.Duration.days(90),
 *       }],
 *       expiration: cdk.Duration.days(365),
 *     }],
 *   },
 * });
 * ```
 */
export class S3BucketConstruct extends Construct {
  // ========================================================================
  // PUBLIC PROPERTIES
  // ========================================================================

  /**
   * The S3 bucket
   */
  public readonly bucket: s3.Bucket;

  /**
   * Bucket name
   */
  public readonly bucketName: string;

  /**
   * Bucket ARN
   */
  public readonly bucketArn: string;

  // ========================================================================
  // PRIVATE PROPERTIES
  // ========================================================================

  private readonly isProduction: boolean;

  // ========================================================================
  // CONSTRUCTOR
  // ========================================================================

  constructor(scope: Construct, id: string, props: S3BucketConstructProps) {
    super(scope, id);

    const { envName, config } = props;
    this.isProduction = isProductionEnvironment(envName);

    // Validate bucket name
    this.validateBucketName(config.bucketName);

    // Resolve configuration with environment-appropriate defaults
    const resolvedConfig = this.resolveConfiguration(config);

    // Create bucket
    this.bucket = this.createBucket(resolvedConfig);
    // Use the configured bucket name directly instead of the bucket's bucketName property
    // which may return a CDK token if not explicitly set
    this.bucketName = config.bucketName;
    this.bucketArn = this.bucket.bucketArn;

    // Apply tags
    this.applyTags(envName, config.purpose);

    // Add production warnings if applicable
    this.addProductionWarnings(resolvedConfig);
  }

  // ========================================================================
  // BUCKET CREATION
  // ========================================================================

  /**
   * Create S3 bucket with resolved configuration
   */
  private createBucket(config: S3BucketConfig): s3.Bucket {
    // Build base bucket properties
    const bucketProps: s3.BucketProps = {
      bucketName: config.bucketName,
      encryption: config.encryption,
      encryptionKey: config.encryptionKey,
      versioned: config.versioned,
      removalPolicy: config.removalPolicy,
      autoDeleteObjects: config.autoDeleteObjects,
      blockPublicAccess: config.blockPublicAccess,
      cors: config.cors,
      enforceSSL: true, // Always enforce secure transport
      minimumTLSVersion: 1.2, // Require TLS 1.2+
    };

    // Build final props object with conditional properties
    const finalProps: s3.BucketProps = {
      ...bucketProps,
      // Add lifecycle rules if provided or intelligent tiering
      ...(config.lifecycleRules && { lifecycleRules: config.lifecycleRules }),
      // Add access logging if enabled
      ...(config.enableAccessLogs &&
        config.accessLogsBucket && {
          serverAccessLogsBucket: config.accessLogsBucket,
          serverAccessLogsPrefix:
            config.accessLogsPrefix ?? `${config.bucketName}/`,
        }),
      // Add intelligent tiering if enabled and no lifecycle rules
      ...(config.enableIntelligentTiering &&
        !config.lifecycleRules && {
          lifecycleRules: [
            {
              id: "IntelligentTiering",
              enabled: true,
              transitions: [
                {
                  storageClass: s3.StorageClass.INTELLIGENT_TIERING,
                  transitionAfter: cdk.Duration.days(0),
                },
              ],
            },
          ],
        }),
    };

    return new s3.Bucket(this, "Bucket", finalProps);
  }

  // ========================================================================
  // CONFIGURATION RESOLUTION
  // ========================================================================

  /**
   * Resolve configuration with environment-appropriate defaults
   */
  private resolveConfiguration(config: S3BucketConfig): S3BucketConfig {
    return {
      ...config,
      encryption: config.encryption ?? s3.BucketEncryption.S3_MANAGED,
      versioned: config.versioned ?? this.isProduction,
      removalPolicy:
        config.removalPolicy ??
        (this.isProduction
          ? cdk.RemovalPolicy.RETAIN
          : cdk.RemovalPolicy.DESTROY),
      autoDeleteObjects:
        config.autoDeleteObjects ??
        (!this.isProduction &&
          config.removalPolicy === cdk.RemovalPolicy.DESTROY),
      blockPublicAccess:
        config.blockPublicAccess ?? s3.BlockPublicAccess.BLOCK_ALL,
    };
  }

  // ========================================================================
  // VALIDATION
  // ========================================================================

  /**
   * Validate bucket name meets S3 requirements
   *
   * Rules:
   * - 3-63 characters
   * - Lowercase letters, numbers, hyphens
   * - Start/end with letter or number
   * - No consecutive periods
   * - No IP address format
   * 
   * Note: Skips validation for CDK tokens which are resolved during synthesis
   */
  private validateBucketName(bucketName: string): void {
    // Skip validation if bucket name contains CDK tokens
    // Tokens are resolved during synthesis and will be validated by CloudFormation
    if (cdk.Token.isUnresolved(bucketName)) {
      return;
    }

    if (!bucketName || bucketName.length < 3 || bucketName.length > 63) {
      throw new Error(
        `Invalid bucket name: ${bucketName}\n\n` +
          `Bucket name must be between 3 and 63 characters.\n` +
          `Current length: ${bucketName?.length ?? 0}`
      );
    }

    const bucketNameRegex = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;
    if (!bucketNameRegex.test(bucketName)) {
      throw new Error(
        `Invalid bucket name: ${bucketName}\n\n` +
          `Bucket name must:\n` +
          `  - Use only lowercase letters, numbers, and hyphens\n` +
          `  - Start and end with a letter or number\n` +
          `  - Not contain consecutive periods or IP address format`
      );
    }

    if (bucketName.includes("..")) {
      throw new Error(
        `Invalid bucket name: ${bucketName}\n\n` +
          `Bucket name cannot contain consecutive periods.`
      );
    }
  }

  // ========================================================================
  // TAGGING AND WARNINGS
  // ========================================================================

  /**
   * Apply standard tags to bucket
   */
  private applyTags(envName: string, purpose: string): void {
    // Apply tags to the construct so they propagate to all child resources
    cdk.Tags.of(this).add("Environment", envName);
    cdk.Tags.of(this).add("Purpose", purpose);
    cdk.Tags.of(this).add("ManagedBy", "CDK");
  }

  /**
   * Add production-specific warnings
   */
  private addProductionWarnings(config: S3BucketConfig): void {
    if (!this.isProduction) {
      return;
    }

    // Warn about deletion policy
    if (config.removalPolicy === cdk.RemovalPolicy.DESTROY) {
      cdk.Annotations.of(this).addWarning(
        `Production bucket ${config.bucketName} has DESTROY removal policy. ` +
          `Consider using RETAIN to prevent accidental data loss.`
      );
    }

    // Warn about versioning
    if (!config.versioned) {
      cdk.Annotations.of(this).addWarning(
        `Production bucket ${config.bucketName} has versioning disabled. ` +
          `Enable versioning to protect against accidental deletions and overwrites.`
      );
    }

    // Warn about encryption
    if (config.encryption === s3.BucketEncryption.UNENCRYPTED) {
      cdk.Annotations.of(this).addError(
        `Production bucket ${config.bucketName} is unencrypted. ` +
          `Encryption is required for production buckets.`
      );
    }
  }

  // ========================================================================
  // PUBLIC HELPER METHODS
  // ========================================================================

  /**
   * Grant read permissions to a principal
   */
  public grantRead(identity: cdk.aws_iam.IGrantable): cdk.aws_iam.Grant {
    return this.bucket.grantRead(identity);
  }

  /**
   * Grant write permissions to a principal
   */
  public grantWrite(identity: cdk.aws_iam.IGrantable): cdk.aws_iam.Grant {
    return this.bucket.grantWrite(identity);
  }

  /**
   * Grant read/write permissions to a principal
   */
  public grantReadWrite(identity: cdk.aws_iam.IGrantable): cdk.aws_iam.Grant {
    return this.bucket.grantReadWrite(identity);
  }

  /**
   * Grant delete permissions to a principal
   */
  public grantDelete(identity: cdk.aws_iam.IGrantable): cdk.aws_iam.Grant {
    return this.bucket.grantDelete(identity);
  }
}
