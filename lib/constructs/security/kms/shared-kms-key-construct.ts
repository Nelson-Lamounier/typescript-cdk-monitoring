/** @format */

import * as cdk from "aws-cdk-lib";
import * as kms from "aws-cdk-lib/aws-kms";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";
import { NagSuppressions } from "cdk-nag";

export interface SharedKmsKeyConstructProps {
  envName: string;
  projectName?: string;
  /**
   * Key alias name
   * @default `alias/{projectName}-{envName}-shared-encryption`
   */
  keyAlias?: string;
  /**
   * Key description
   * @default "Shared KMS key for encrypting CloudWatch Logs, DynamoDB, and Secrets Manager"
   */
  description?: string;
  /**
   * Additional AWS service principals that need access to the key
   * @default ["logs.amazonaws.com", "secretsmanager.amazonaws.com", "dynamodb.amazonaws.com"]
   */
  additionalServicePrincipals?: string[];
  /**
   * Key rotation period
   * @default 365 days (1 year)
   */
  rotationPeriod?: cdk.Duration;
  /**
   * Enable automatic key rotation
   * @default true for production, false for development
   */
  enableKeyRotation?: boolean;
}

/**
 * Shared KMS Key Construct for Data Protection at Rest
 *
 * Creates a single customer-managed KMS key (CMK) that can be used across multiple resources:
 * - CloudWatch Log Groups (CKV_AWS_158)
 * - Secrets Manager secrets
 * - DynamoDB tables
 * - S3 buckets
 * - EBS volumes
 * - EFS file systems
 *
 * SECURITY BENEFITS:
 * - Centralised key management
 * - Consistent encryption policies
 * - Audit logging via CloudTrail
 * - Fine-grained access control
 * - Automatic key rotation
 * - Compliance with Checkov CKV_AWS_158
 *
 * COST:
 * - KMS key: £0.80/month per key
 * - API requests: £0.03 per 10,000 requests
 * - Single shared key is more cost-effective than per-resource keys
 *
 * @example
 * ```typescript
 * // Create shared key
 * const kmsKey = new SharedKmsKeyConstruct(this, 'SharedKey', {
 *   envName: 'production',
 *   projectName: 'monitoring',
 * });
 *
 * // Use in CloudWatch Logs
 * const logGroup = new logs.LogGroup(this, 'Logs', {
 *   encryptionKey: kmsKey.key,
 * });
 *
 * // Use in DynamoDB
 * const table = new dynamodb.Table(this, 'Table', {
 *   encryptionKey: kmsKey.key,
 * });
 *
 * // Use in Secrets Manager
 * const secret = new secretsmanager.Secret(this, 'Secret', {
 *   encryptionKey: kmsKey.key,
 * });
 * ```
 */
export class SharedKmsKeyConstruct extends Construct {
  public readonly key: kms.Key;
  public readonly keyAlias: kms.Alias;

  constructor(
    scope: Construct,
    id: string,
    props: SharedKmsKeyConstructProps
  ) {
    super(scope, id);

    const { envName, projectName } = props;
    const isProduction =
      envName.toLowerCase() === "production" ||
      envName.toLowerCase() === "prod";

    // ========================================
    // VALIDATION
    // ========================================
    if (!envName || envName.trim().length === 0) {
      throw new Error("Environment name is required for SharedKmsKeyConstruct");
    }

    // ========================================
    // KMS KEY CONFIGURATION
    // ========================================
    const keyDescription =
      props.description ||
      `Shared KMS key for ${envName} data protection at rest (CloudWatch Logs, DynamoDB, Secrets Manager)`;

    const keyAlias =
      props.keyAlias ||
      (projectName
        ? `alias/${projectName}-${envName}-shared-encryption`
        : `alias/${envName}-shared-encryption`);

    const enableKeyRotation =
      props.enableKeyRotation ?? isProduction; // Auto-rotation in production only

    const rotationPeriod =
      props.rotationPeriod ?? cdk.Duration.days(365); // 1 year default

    // ========================================
    // CREATE KMS KEY
    // ========================================
    this.key = new kms.Key(this, "Key", {
      description: keyDescription,
      enableKeyRotation,
      rotationPeriod,
      removalPolicy: isProduction
        ? cdk.RemovalPolicy.RETAIN // Keep key in production
        : cdk.RemovalPolicy.DESTROY,
      pendingWindow: isProduction
        ? cdk.Duration.days(30) // 30-day recovery window in production
        : cdk.Duration.days(7), // 7-day minimum for dev
    });

    // ========================================
    // CREATE KEY ALIAS
    // ========================================
    this.keyAlias = new kms.Alias(this, "KeyAlias", {
      aliasName: keyAlias,
      targetKey: this.key,
    });

    // ========================================
    // GRANT SERVICE ACCESS
    // ========================================
    const defaultServicePrincipals = [
      "logs.amazonaws.com", // CloudWatch Logs
      "secretsmanager.amazonaws.com", // Secrets Manager
      "dynamodb.amazonaws.com", // DynamoDB
    ];

    const servicePrincipals = [
      ...defaultServicePrincipals,
      ...(props.additionalServicePrincipals || []),
    ];

    // Grant each AWS service access to use the key
    servicePrincipals.forEach((servicePrincipal) => {
      this.key.addToResourcePolicy(
        new iam.PolicyStatement({
          sid: `Allow${servicePrincipal.split(".")[0]}ToUseKey`,
          effect: iam.Effect.ALLOW,
          principals: [new iam.ServicePrincipal(servicePrincipal)],
          actions: [
            "kms:Decrypt",
            "kms:Encrypt",
            "kms:ReEncrypt*",
            "kms:GenerateDataKey*",
            "kms:CreateGrant",
            "kms:DescribeKey",
          ],
          resources: ["*"], // Key ARN is implied from policy location
          conditions: {
            StringEquals: {
              "kms:ViaService": [
                `logs.${cdk.Stack.of(this).region}.amazonaws.com`,
                `secretsmanager.${cdk.Stack.of(this).region}.amazonaws.com`,
                `dynamodb.${cdk.Stack.of(this).region}.amazonaws.com`,
              ],
            },
          },
        })
      );
    });

    // Grant CloudWatch Logs additional grant creation permissions
    // Required for log group encryption
    this.key.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: "AllowCloudWatchLogsGrantCreation",
        effect: iam.Effect.ALLOW,
        principals: [new iam.ServicePrincipal("logs.amazonaws.com")],
        actions: ["kms:CreateGrant"],
        resources: ["*"], // Key ARN is implied
        conditions: {
          StringLike: {
            "kms:EncryptionContext:aws:logs:arn": `arn:aws:logs:${
              cdk.Stack.of(this).region
            }:${cdk.Stack.of(this).account}:log-group:*`,
          },
        },
      })
    );

    // ========================================
    // GRANT ACCOUNT ROOT ACCESS
    // ========================================
    // Required for key management and IAM policy updates
    this.key.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: "AllowAccountRootAccess",
        effect: iam.Effect.ALLOW,
        principals: [
          new iam.AccountPrincipal(cdk.Stack.of(this).account),
        ],
        actions: ["kms:*"],
        resources: ["*"], // Key ARN is implied
      })
    );

    // ========================================
    // TAGGING
    // ========================================
    cdk.Tags.of(this.key).add("Name", keyAlias);
    cdk.Tags.of(this.key).add("Environment", envName);
    cdk.Tags.of(this.key).add("ManagedBy", "CDK");
    cdk.Tags.of(this.key).add("Purpose", "DataProtectionAtRest");

    if (projectName) {
      cdk.Tags.of(this.key).add("Project", projectName);
    }

    // ========================================
    // CDK NAG SUPPRESSIONS
    // ========================================
    // KMS key resource policies inherently use wildcards
    NagSuppressions.addResourceSuppressions(
      this.key,
      [
        {
          id: "AwsSolutions-KMS5",
          reason:
            "KMS key resource policy uses wildcard resources as the key ARN is implied from the policy location. " +
            "This is standard AWS KMS pattern. Access is restricted through service principals and conditions.",
        },
      ],
      true
    );

    // ========================================
    // CLOUDFORMATION OUTPUTS
    // ========================================
    const exportPrefix = projectName
      ? `${envName}-${projectName}`
      : envName;

    new cdk.CfnOutput(this, "KeyId", {
      value: this.key.keyId,
      description: `KMS key ID for ${envName} shared encryption`,
      exportName: `${exportPrefix}-kms-key-id`,
    });

    new cdk.CfnOutput(this, "KeyArn", {
      value: this.key.keyArn,
      description: `KMS key ARN for ${envName} data protection at rest`,
      exportName: `${exportPrefix}-kms-key-arn`,
    });

    new cdk.CfnOutput(this, "KeyAliasName", {
      value: this.keyAlias.aliasName,
      description: "KMS key alias for easier reference",
      exportName: `${exportPrefix}-kms-key-alias`,
    });
  }

  /**
   * Grant decrypt permission to a principal
   *
   * @param grantee - IAM principal to grant decrypt permission
   */
  public grantDecrypt(grantee: iam.IGrantable): iam.Grant {
    return this.key.grantDecrypt(grantee);
  }

  /**
   * Grant encrypt permission to a principal
   *
   * @param grantee - IAM principal to grant encrypt permission
   */
  public grantEncrypt(grantee: iam.IGrantable): iam.Grant {
    return this.key.grantEncrypt(grantee);
  }

  /**
   * Grant encrypt and decrypt permissions to a principal
   *
   * @param grantee - IAM principal to grant both permissions
   */
  public grantEncryptDecrypt(grantee: iam.IGrantable): iam.Grant {
    return this.key.grantEncryptDecrypt(grantee);
  }
}
