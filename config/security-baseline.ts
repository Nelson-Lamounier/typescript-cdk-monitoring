/** @format */

/**
 * Security Baseline Configuration for Production Environments
 *
 * This file defines secure defaults and validation for production deployments.
 * All production stacks should import and apply these configurations.
 *
 * Security Principles:
 * - Principle of least privilege
 * - Defence in depth
 * - Encryption in transit and at rest
 * - Network segmentation
 * - Audit logging enabled
 */

import * as cdk from "aws-cdk-lib";
import * as logs from "aws-cdk-lib/aws-logs";

// ============================================================================
// SECURITY CONFIGURATION TYPES
// ============================================================================

export interface NetworkSecurityConfig {
  /** Restrict ALB access to specific CIDR ranges */
  allowedIpRanges: string[];
  /** Use private subnets for compute resources */
  usePrivateSubnets: boolean;
  /** Number of NAT Gateways (1 for cost, 2+ for HA) */
  natGateways: number;
  /** Disable public IP assignment on EC2 instances */
  disablePublicIps: boolean;
}

export interface TransportSecurityConfig {
  /** Enable HTTPS with valid certificate */
  enableHttps: boolean;
  /** ACM certificate ARN (required when enableHttps is true) */
  certificateArn?: string;
  /** Redirect HTTP to HTTPS */
  redirectHttpToHttps: boolean;
  /** Minimum TLS version */
  minimumTlsVersion: "TLS_1_2" | "TLS_1_3";
}

export interface AuditSecurityConfig {
  /** Enable ALB access logs */
  enableAccessLogs: boolean;
  /** Access log retention in days */
  accessLogRetentionDays: number;
  /** Enable VPC flow logs */
  enableVpcFlowLogs: boolean;
  /** CloudWatch log retention */
  logRetention: logs.RetentionDays;
}

export interface ResourceProtectionConfig {
  /** Enable deletion protection on ALB */
  enableDeletionProtection: boolean;
  /** EFS removal policy */
  efsRemovalPolicy: cdk.RemovalPolicy;
  /** Enable system updates during bootstrap */
  enableSystemUpdates: boolean;
}

/**
 * Encryption Configuration
 * 
 * Centralised KMS key configuration for all encrypted resources.
 * Use customer-managed keys for production environments to:
 * - Enable key rotation policies
 * - Implement fine-grained access controls
 * - Meet compliance requirements
 * - Audit key usage via CloudTrail
 * 
 * Development environments use AWS-managed keys by default (no additional cost).
 */
export interface EncryptionConfig {
  /** Customer-managed KMS key ARN for EBS volumes */
  ebsKmsKeyArn?: string;
  /** Customer-managed KMS key ARN for EFS file systems */
  efsKmsKeyArn?: string;
  /** Customer-managed KMS key ARN for ECR repositories */
  ecrKmsKeyArn?: string;
  /** Customer-managed KMS key ARN for S3 buckets */
  s3KmsKeyArn?: string;
  /** Customer-managed KMS key ARN for DynamoDB tables */
  dynamoDbKmsKeyArn?: string;
  /** Customer-managed KMS key ARN for CloudWatch Logs */
  logsKmsKeyArn?: string;
}

export interface SecurityBaseline {
  network: NetworkSecurityConfig;
  transport: TransportSecurityConfig;
  audit: AuditSecurityConfig;
  protection: ResourceProtectionConfig;
  encryption?: EncryptionConfig;
}

// ============================================================================
// ENVIRONMENT-SPECIFIC SECURITY BASELINES
// ============================================================================

/**
 * Development Security Baseline
 *
 * Relaxed security for rapid development:
 * - Open access from anywhere (development only)
 * - HTTP allowed (no certificate required)
 * - Minimal logging for cost savings
 * - AWS-managed encryption keys (no additional cost)
 */
export const developmentSecurityBaseline: SecurityBaseline = {
  network: {
    allowedIpRanges: ["0.0.0.0/0"], // Open for development
    usePrivateSubnets: false,
    natGateways: 0,
    disablePublicIps: false,
  },
  transport: {
    enableHttps: false,
    redirectHttpToHttps: false,
    minimumTlsVersion: "TLS_1_2",
  },
  audit: {
    enableAccessLogs: false,
    accessLogRetentionDays: 30,
    enableVpcFlowLogs: true,
    logRetention: logs.RetentionDays.ONE_WEEK,
  },
  protection: {
    enableDeletionProtection: false,
    efsRemovalPolicy: cdk.RemovalPolicy.DESTROY,
    enableSystemUpdates: false,
  },
  encryption: {
    // Uses AWS-managed keys by default (no ARNs specified)
    // No additional cost, automatic key rotation
  },
};

/**
 * Staging Security Baseline
 *
 * Production-like security for pre-release testing:
 * - Restricted IP access (VPN/office only)
 * - HTTPS required
 * - Full audit logging
 */
export const stagingSecurityBaseline: SecurityBaseline = {
  network: {
    // IMPORTANT: Replace with your VPN/office CIDR ranges
    allowedIpRanges: [
      // Example corporate ranges - replace with actual values
      // "10.0.0.0/8",       // Internal network
      // "192.168.0.0/16",   // Office network
      // "YOUR_VPN_CIDR/32", // VPN exit IP
      "0.0.0.0/0", // TODO: Replace before staging deployment
    ],
    usePrivateSubnets: false, // Can be true if NAT Gateway is enabled
    natGateways: 0, // Set to 1 for private subnet usage
    disablePublicIps: false,
  },
  transport: {
    enableHttps: true,
    // certificateArn: "arn:aws:acm:...", // Set via SSM or environment variable
    redirectHttpToHttps: true,
    minimumTlsVersion: "TLS_1_2",
  },
  audit: {
    enableAccessLogs: true,
    accessLogRetentionDays: 60,
    enableVpcFlowLogs: true,
    logRetention: logs.RetentionDays.ONE_MONTH,
  },
  protection: {
    enableDeletionProtection: false, // Allow teardown in staging
    efsRemovalPolicy: cdk.RemovalPolicy.RETAIN,
    enableSystemUpdates: true,
  },
  encryption: {
    // Optional: Use customer-managed KMS keys for staging
    // Uncomment and set environment variables if required:
    // ebsKmsKeyArn: process.env.STAGING_EBS_KMS_KEY_ARN,
    // efsKmsKeyArn: process.env.STAGING_EFS_KMS_KEY_ARN,
    // ecrKmsKeyArn: process.env.STAGING_ECR_KMS_KEY_ARN,
    // s3KmsKeyArn: process.env.STAGING_S3_KMS_KEY_ARN,
  },
};

/**
 * Production Security Baseline
 *
 * Maximum security for production workloads:
 * - Strictly restricted IP access
 * - HTTPS with TLS 1.2+ required
 * - Full audit logging with extended retention
 * - Deletion protection enabled
 * - Private subnets with NAT Gateway
 */
export const productionSecurityBaseline: SecurityBaseline = {
  network: {
    // CRITICAL: Must be configured with actual corporate/VPN CIDR ranges
    allowedIpRanges: [
      // Examples - REPLACE WITH ACTUAL VALUES:
      // "10.0.0.0/8",           // Corporate internal network
      // "172.16.0.0/12",        // AWS VPC peering
      // "192.168.1.0/24",       // Office network
      // "203.0.113.50/32",      // VPN exit IP (single IP)
      "0.0.0.0/0", // TODO: CRITICAL - Replace before production deployment
    ],
    usePrivateSubnets: true, // RECOMMENDED: Use private subnets
    natGateways: 1, // Minimum 1, recommend 2 for HA in multi-AZ
    disablePublicIps: true, // No public IPs on EC2 instances
  },
  transport: {
    enableHttps: true, // REQUIRED
    // certificateArn must be provided via props or SSM
    redirectHttpToHttps: true,
    minimumTlsVersion: "TLS_1_2",
  },
  audit: {
    enableAccessLogs: true, // REQUIRED for compliance
    accessLogRetentionDays: 90, // Minimum 90 days for compliance
    enableVpcFlowLogs: true, // REQUIRED for security monitoring
    logRetention: logs.RetentionDays.THREE_MONTHS,
  },
  protection: {
    enableDeletionProtection: true, // Prevent accidental deletion
    efsRemovalPolicy: cdk.RemovalPolicy.RETAIN,
    enableSystemUpdates: true, // Apply security patches
  },
  encryption: {
    // RECOMMENDED: Use customer-managed KMS keys for production
    // Provides key rotation, audit logging, and fine-grained access control
    // Set via environment variables or AWS Systems Manager Parameter Store
    ebsKmsKeyArn: process.env.PROD_EBS_KMS_KEY_ARN,
    efsKmsKeyArn: process.env.PROD_EFS_KMS_KEY_ARN,
    ecrKmsKeyArn: process.env.PROD_ECR_KMS_KEY_ARN,
    s3KmsKeyArn: process.env.PROD_S3_KMS_KEY_ARN,
    dynamoDbKmsKeyArn: process.env.PROD_DYNAMODB_KMS_KEY_ARN,
    logsKmsKeyArn: process.env.PROD_LOGS_KMS_KEY_ARN,
  },
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get security baseline for environment
 */
export function getSecurityBaseline(envName: string): SecurityBaseline {
  switch (envName.toLowerCase()) {
    case "production":
    case "prod":
      return productionSecurityBaseline;
    case "staging":
    case "stg":
      return stagingSecurityBaseline;
    case "development":
    case "dev":
    case "pipeline":
    default:
      return developmentSecurityBaseline;
  }
}

/**
 * Get encryption configuration for environment
 * 
 * Returns customer-managed KMS key ARNs if configured for the environment.
 * Falls back to AWS-managed keys (undefined) for development or when not configured.
 * 
 * @param envName - Environment name (development, staging, production)
 * @returns EncryptionConfig with KMS key ARNs or empty object for AWS-managed keys
 * 
 * @example
 * ```typescript
 * const encConfig = getEncryptionConfig('production');
 * if (encConfig.ebsKmsKeyArn) {
 *   // Use customer-managed key
 * } else {
 *   // Use AWS-managed key (default)
 * }
 * ```
 */
export function getEncryptionConfig(envName: string): EncryptionConfig {
  const baseline = getSecurityBaseline(envName);
  return baseline.encryption ?? {};
}

/**
 * Validate production security requirements
 *
 * Throws error if production deployment doesn't meet security baseline
 */
export function validateProductionSecurity(
  envName: string,
  config: Partial<{
    allowedIpRanges: string[];
    enableHttps: boolean;
    certificateArn: string;
    enableAccessLogs: boolean;
    enableDeletionProtection: boolean;
  }>
): void {
  if (envName !== "production" && envName !== "prod") {
    return; // Only validate production
  }

  const errors: string[] = [];

  // Validate IP restrictions
  if (
    config.allowedIpRanges?.includes("0.0.0.0/0") ||
    config.allowedIpRanges?.includes("::/0")
  ) {
    errors.push(
      "SECURITY VIOLATION: Production ALB allows access from 0.0.0.0/0. " +
        "Restrict allowedIpRanges to corporate/VPN CIDR ranges."
    );
  }

  // Validate HTTPS
  if (config.enableHttps === false) {
    errors.push(
      "SECURITY VIOLATION: Production must use HTTPS. " +
        "Set enableHttps: true and provide certificateArn."
    );
  }

  if (config.enableHttps === true && !config.certificateArn) {
    errors.push(
      "SECURITY VIOLATION: HTTPS enabled without certificate. " +
        "Provide certificateArn for production HTTPS."
    );
  }

  // Validate audit logging
  if (config.enableAccessLogs === false) {
    errors.push(
      "SECURITY VIOLATION: Production must have access logs enabled. " +
        "Set enableAccessLogs: true for compliance."
    );
  }

  // Validate deletion protection
  if (config.enableDeletionProtection === false) {
    errors.push(
      "SECURITY WARNING: Deletion protection disabled in production. " +
        "Consider enabling to prevent accidental ALB deletion."
    );
  }

  if (errors.length > 0) {
    throw new Error(
      "Production Security Validation Failed\n\n" +
        errors.map((e, i) => `${i + 1}. ${e}`).join("\n\n") +
        "\n\nReview config/security-baseline.ts for required settings."
    );
  }
}

/**
 * Corporate IP ranges placeholder
 *
 * IMPORTANT: Replace these with your actual corporate/VPN CIDR ranges
 * before deploying to staging or production.
 */
export const CORPORATE_IP_RANGES = {
  // Example structure - replace with actual values
  VPN_EXIT_IPS: [
    // "203.0.113.50/32",  // Primary VPN
    // "203.0.113.51/32",  // Backup VPN
  ],
  OFFICE_NETWORKS: [
    // "192.168.1.0/24",   // London office
    // "192.168.2.0/24",   // Remote office
  ],
  INTERNAL_NETWORKS: [
    // "10.0.0.0/8",       // AWS internal
    // "172.16.0.0/12",    // VPC peering
  ],

  /**
   * Get all allowed CIDR ranges for production
   */
  getAllRanges(): string[] {
    const ranges = [
      ...this.VPN_EXIT_IPS,
      ...this.OFFICE_NETWORKS,
      ...this.INTERNAL_NETWORKS,
    ];

    if (ranges.length === 0) {
      console.warn(
        "WARNING: No corporate IP ranges configured. " +
          "Update CORPORATE_IP_RANGES in config/security-baseline.ts"
      );
      // Return placeholder that will fail validation
      return ["0.0.0.0/0"];
    }

    return ranges;
  },
};
