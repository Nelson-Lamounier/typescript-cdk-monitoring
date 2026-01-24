/** @format */

/**
 * KMS Key Helper Functions
 * 
 * Utilities for working with customer-managed KMS keys in infrastructure stacks.
 * Provides consistent patterns for:
 * - Importing existing KMS keys by ARN
 * - Applying encryption configuration from security baseline
 * - Validating KMS key ARNs
 */

import * as kms from "aws-cdk-lib/aws-kms";
import { Construct } from "constructs";

import { getEncryptionConfig, EncryptionConfig } from "../../../config/security-baseline";

/**
 * KMS Key Type - specifies which resource type the key is for
 */
export enum KmsKeyType {
  EBS = "ebs",
  EFS = "efs",
  ECR = "ecr",
  S3 = "s3",
  DYNAMODB = "dynamodb",
  LOGS = "logs",
}

/**
 * Get KMS key for a specific resource type from encryption configuration
 * 
 * Returns a CDK KMS Key object if a customer-managed key ARN is configured,
 * otherwise returns undefined (which will use AWS-managed keys).
 * 
 * @param scope - CDK construct scope
 * @param envName - Environment name
 * @param keyType - Type of KMS key (EBS, EFS, ECR, etc.)
 * @param id - Optional custom ID for the imported key (defaults to key type)
 * @returns IKey if customer-managed key is configured, undefined otherwise
 * 
 * @example
 * ```typescript
 * const ebsKey = getKmsKeyForResource(this, 'production', KmsKeyType.EBS);
 * 
 * const volume = new ec2.Volume(this, 'Volume', {
 *   encrypted: true,
 *   encryptionKey: ebsKey, // Uses customer key if configured, AWS-managed if undefined
 * });
 * ```
 */
export function getKmsKeyForResource(
  scope: Construct,
  envName: string,
  keyType: KmsKeyType,
  id?: string
): kms.IKey | undefined {
  const encConfig = getEncryptionConfig(envName);
  
  let keyArn: string | undefined;
  
  switch (keyType) {
    case KmsKeyType.EBS:
      keyArn = encConfig.ebsKmsKeyArn;
      break;
    case KmsKeyType.EFS:
      keyArn = encConfig.efsKmsKeyArn;
      break;
    case KmsKeyType.ECR:
      keyArn = encConfig.ecrKmsKeyArn;
      break;
    case KmsKeyType.S3:
      keyArn = encConfig.s3KmsKeyArn;
      break;
    case KmsKeyType.DYNAMODB:
      keyArn = encConfig.dynamoDbKmsKeyArn;
      break;
    case KmsKeyType.LOGS:
      keyArn = encConfig.logsKmsKeyArn;
      break;
  }
  
  if (!keyArn) {
    return undefined; // Use AWS-managed key
  }
  
  // Import the existing KMS key
  const constructId = id || `KmsKey-${keyType}`;
  return kms.Key.fromKeyArn(scope, constructId, keyArn);
}

/**
 * Get all configured KMS keys for an environment
 * 
 * Returns a map of resource types to KMS keys, including only those
 * that have customer-managed keys configured.
 * 
 * @param scope - CDK construct scope
 * @param envName - Environment name
 * @returns Map of KmsKeyType to IKey for all configured keys
 * 
 * @example
 * ```typescript
 * const keys = getAllKmsKeys(this, 'production');
 * 
 * if (keys.has(KmsKeyType.EBS)) {
 *   const ebsKey = keys.get(KmsKeyType.EBS);
 *   // Use EBS key...
 * }
 * ```
 */
export function getAllKmsKeys(
  scope: Construct,
  envName: string
): Map<KmsKeyType, kms.IKey> {
  const keys = new Map<KmsKeyType, kms.IKey>();
  
  for (const keyType of Object.values(KmsKeyType)) {
    const key = getKmsKeyForResource(scope, envName, keyType as KmsKeyType);
    if (key) {
      keys.set(keyType as KmsKeyType, key);
    }
  }
  
  return keys;
}

/**
 * Validate KMS key ARN format
 * 
 * @param keyArn - KMS key ARN to validate
 * @returns Object with isValid flag and optional error message
 * 
 * @example
 * ```typescript
 * const result = validateKmsKeyArn(process.env.KMS_KEY_ARN);
 * if (!result.isValid) {
 *   console.error(result.error);
 * }
 * ```
 */
export function validateKmsKeyArn(keyArn: string): {
  isValid: boolean;
  error?: string;
} {
  if (!keyArn) {
    return {
      isValid: false,
      error: "KMS key ARN is empty or undefined",
    };
  }
  
  // KMS key ARN format: arn:aws:kms:region:account-id:key/key-id
  const kmsArnPattern = /^arn:aws:kms:[a-z0-9-]+:\d{12}:key\/[a-f0-9-]+$/;
  
  if (!kmsArnPattern.test(keyArn)) {
    return {
      isValid: false,
      error: `Invalid KMS key ARN format: ${keyArn}. Expected format: arn:aws:kms:region:account-id:key/key-id`,
    };
  }
  
  return { isValid: true };
}

/**
 * Get encryption configuration with validated KMS key ARNs
 * 
 * Returns encryption configuration after validating all KMS key ARNs.
 * Logs warnings for invalid ARNs but doesn't throw errors.
 * 
 * @param envName - Environment name
 * @returns EncryptionConfig with only valid KMS key ARNs
 * 
 * @example
 * ```typescript
 * const encConfig = getValidatedEncryptionConfig('production');
 * ```
 */
export function getValidatedEncryptionConfig(envName: string): EncryptionConfig {
  const encConfig = getEncryptionConfig(envName);
  const validated: EncryptionConfig = {};
  
  const keyMappings: Array<[keyof EncryptionConfig, string]> = [
    ["ebsKmsKeyArn", "EBS"],
    ["efsKmsKeyArn", "EFS"],
    ["ecrKmsKeyArn", "ECR"],
    ["s3KmsKeyArn", "S3"],
    ["dynamoDbKmsKeyArn", "DynamoDB"],
    ["logsKmsKeyArn", "CloudWatch Logs"],
  ];
  
  for (const [key, resourceType] of keyMappings) {
    const keyArn = encConfig[key];
    if (keyArn) {
      const validation = validateKmsKeyArn(keyArn);
      if (validation.isValid) {
        validated[key] = keyArn;
      } else {
        console.warn(
          `Warning: Invalid ${resourceType} KMS key ARN for ${envName}: ${validation.error}. ` +
          `Falling back to AWS-managed encryption.`
        );
      }
    }
  }
  
  return validated;
}

/**
 * Check if environment has any customer-managed KMS keys configured
 * 
 * @param envName - Environment name
 * @returns true if any customer-managed keys are configured
 * 
 * @example
 * ```typescript
 * if (hasCustomerManagedKeys('production')) {
 *   console.log('Using customer-managed encryption keys');
 * }
 * ```
 */
export function hasCustomerManagedKeys(envName: string): boolean {
  const encConfig = getEncryptionConfig(envName);
  
  return !!(
    encConfig.ebsKmsKeyArn ||
    encConfig.efsKmsKeyArn ||
    encConfig.ecrKmsKeyArn ||
    encConfig.s3KmsKeyArn ||
    encConfig.dynamoDbKmsKeyArn ||
    encConfig.logsKmsKeyArn
  );
}
