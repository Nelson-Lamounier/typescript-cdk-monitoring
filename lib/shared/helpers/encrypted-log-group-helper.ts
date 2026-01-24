/** @format */

import * as cdk from "aws-cdk-lib";
import * as logs from "aws-cdk-lib/aws-logs";
import * as kms from "aws-cdk-lib/aws-kms";
import { Construct } from "constructs";

export interface EncryptedLogGroupProps {
  /**
   * Log group name
   */
  logGroupName: string;

  /**
   * Environment name
   */
  envName: string;

  /**
   * KMS encryption key
   * If not provided, uses AWS-managed encryption for development,
   * and should use customer-managed key for production (Checkov CKV_AWS_158)
   */
  encryptionKey?: kms.IKey;

  /**
   * Log retention period
   * @default logs.RetentionDays.ONE_WEEK for dev, ONE_MONTH for prod
   */
  retention?: logs.RetentionDays;

  /**
   * Removal policy
   * @default RETAIN for production, DESTROY for dev
   */
  removalPolicy?: cdk.RemovalPolicy;
}

/**
 * Encrypted CloudWatch Log Group Construct
 *
 * Creates CloudWatch Log Groups with customer-managed KMS encryption to comply with:
 * - CKV_AWS_158: CloudWatch Log Groups should be encrypted with KMS CMK
 *
 * SECURITY IMPROVEMENTS:
 * - Uses customer-managed KMS keys (CMK) instead of AWS-managed keys
 * - Provides audit trail via CloudTrail
 * - Enables fine-grained access control
 * - Supports key rotation
 *
 * COST:
 * - KMS API calls: ~£0.03 per 10,000 log write operations
 * - Shared KMS key amortises cost across all log groups
 *
 * @example
 * ```typescript
 * // With customer-managed key (production)
 * const logGroup = createEncryptedLogGroup(this, 'Logs', {
 *   logGroupName: '/ecs/production-app',
 *   envName: 'production',
 *   encryptionKey: kmsKey.key,
 * });
 *
 * // Without key (development - AWS-managed encryption)
 * const logGroup = createEncryptedLogGroup(this, 'Logs', {
 *   logGroupName: '/ecs/dev-app',
 *   envName: 'development',
 * });
 * ```
 */
export function createEncryptedLogGroup(
  scope: Construct,
  id: string,
  props: EncryptedLogGroupProps
): logs.LogGroup {
  const isProduction =
    props.envName.toLowerCase() === "production" ||
    props.envName.toLowerCase() === "prod";

  // Default retention based on environment
  const defaultRetention = isProduction
    ? logs.RetentionDays.ONE_MONTH
    : logs.RetentionDays.ONE_WEEK;

  const retention = props.retention ?? defaultRetention;

  // Default removal policy based on environment
  const removalPolicy =
    props.removalPolicy ??
    (isProduction ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY);

  // Warn if production doesn't have customer-managed key
  if (isProduction && !props.encryptionKey) {
    cdk.Annotations.of(scope).addWarning(
      `CKV_AWS_158: CloudWatch Log Group "${props.logGroupName}" in production uses AWS-managed encryption. ` +
        `Consider providing a customer-managed KMS key for better security and compliance.`
    );
  }

  // Create log group with KMS encryption
  const logGroup = new logs.LogGroup(scope, id, {
    logGroupName: props.logGroupName,
    retention,
    removalPolicy,
    encryptionKey: props.encryptionKey, // Uses CMK if provided, AWS-managed if undefined
  });

  // Tag the log group
  cdk.Tags.of(logGroup).add("Environment", props.envName);
  cdk.Tags.of(logGroup).add("ManagedBy", "CDK");
  if (props.encryptionKey) {
    cdk.Tags.of(logGroup).add("Encryption", "CustomerManaged");
  } else {
    cdk.Tags.of(logGroup).add("Encryption", "AWSManaged");
  }

  return logGroup;
}

/**
 * Helper function to get encryption key for environment
 *
 * Returns undefined for development (uses AWS-managed encryption)
 * Returns provided key for production (uses customer-managed encryption)
 *
 * @param envName - Environment name
 * @param productionKey - KMS key to use in production
 * @returns KMS key for production, undefined for dev
 */
export function getEncryptionKeyForEnvironment(
  envName: string,
  productionKey?: kms.IKey
): kms.IKey | undefined {
  const isProduction =
    envName.toLowerCase() === "production" ||
    envName.toLowerCase() === "prod" ||
    envName.toLowerCase() === "staging";

  return isProduction ? productionKey : undefined;
}

/**
 * Batch create multiple encrypted log groups with shared KMS key
 *
 * Convenience function for creating multiple log groups with the same encryption key
 *
 * @param scope - CDK construct scope
 * @param logGroupConfigs - Array of log group configurations
 * @param sharedEncryptionKey - Shared KMS key to use for all log groups
 * @returns Map of log group IDs to LogGroup constructs
 *
 * @example
 * ```typescript
 * const logGroups = createEncryptedLogGroups(this, [
 *   { id: 'TaskLogs', logGroupName: '/ecs/tasks', envName: 'production' },
 *   { id: 'EventLogs', logGroupName: '/ecs/events', envName: 'production' },
 * ], kmsKey.key);
 * ```
 */
export function createEncryptedLogGroups(
  scope: Construct,
  logGroupConfigs: Array<{
    id: string;
    logGroupName: string;
    envName: string;
    retention?: logs.RetentionDays;
  }>,
  sharedEncryptionKey?: kms.IKey
): Map<string, logs.LogGroup> {
  const logGroups = new Map<string, logs.LogGroup>();

  logGroupConfigs.forEach((config) => {
    const logGroup = createEncryptedLogGroup(scope, config.id, {
      logGroupName: config.logGroupName,
      envName: config.envName,
      retention: config.retention,
      encryptionKey: sharedEncryptionKey,
    });

    logGroups.set(config.id, logGroup);
  });

  return logGroups;
}
