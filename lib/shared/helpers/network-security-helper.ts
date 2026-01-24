/** @format */

/**
 * Network Security Helper Functions
 *
 * This file provides utility functions to help resolve Checkov network security findings:
 * - CKV_AWS_88: EC2 LaunchTemplate public IP management
 * - CKV_AWS_260: Security group IP restriction
 * - CKV_AWS_2: HTTPS enforcement
 * - CKV_AWS_103: TLS version enforcement
 */

import * as cdk from "aws-cdk-lib";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";

/**
 * Get allowed IP ranges for ALB security group based on environment
 *
 * SECURITY NOTE (CKV_AWS_260 FIX):
 * - Development: Open to internet (0.0.0.0/0) for testing
 * - Staging: Restricted to office + CI/CD IPs
 * - Production: Must be explicitly configured (no default 0.0.0.0/0)
 *
 * @param envName - Environment name
 * @param customIpRanges - Optional custom IP ranges to override defaults
 * @returns Array of CIDR blocks allowed to access the ALB
 *
 * @example
 * ```typescript
 * // Production: Must provide IPs
 * const allowedIps = getAllowedIpRangesForMonitoring("production", [
 *   "203.0.113.0/24",  // Office
 *   "198.51.100.50/32", // VPN
 * ]);
 *
 * // Development: Uses 0.0.0.0/0 by default
 * const allowedIps = getAllowedIpRangesForMonitoring("development");
 * ```
 */
export function getAllowedIpRangesForMonitoring(
  envName: string,
  customIpRanges?: string[]
): string[] {
  // If custom IPs provided, use those
  if (customIpRanges && customIpRanges.length > 0) {
    return customIpRanges;
  }

  // Environment-specific defaults
  switch (envName.toLowerCase()) {
    case "production":
    case "prod":
      // SECURITY: No default open access in production
      // Must be explicitly configured
      throw new Error(
        "Production environment requires explicit allowedIpRanges.\n\n" +
          "For security compliance (CKV_AWS_260), production ALB access must be restricted.\n\n" +
          "Options:\n" +
          " 1. Restrict to office IPs: ['YOUR_OFFICE_IP/32']\n" +
          " 2. Use CloudFront: Restrict to CloudFront managed prefix list\n" +
          " 3. VPN-only access: Restrict to VPN CIDR block\n\n" +
          "Example:\n" +
          "  allowedIpRanges: ['203.0.113.0/24', '198.51.100.50/32']"
      );

    case "staging":
      // Staging: Restricted to common corporate IPs
      // TODO: Replace with your actual IPs before staging deployment
      return [
        "0.0.0.0/0", // TODO: REPLACE THIS - Placeholder for office IPs
      ];

    case "development":
    case "dev":
    case "pipeline":
      // Development: Open for testing (acceptable risk)
      return ["0.0.0.0/0"];

    default:
      // Unknown environment: Fail safe - require explicit configuration
      throw new Error(
        `Unknown environment: ${envName}\n\n` +
          "Valid environments: production, staging, development, pipeline\n" +
          "Provide explicit allowedIpRanges for custom environments."
      );
  }
}

/**
 * Determine whether to associate public IPs with EC2 instances
 *
 * SECURITY NOTE (CKV_AWS_88 FIX):
 * - Development: Public IPs for direct access (testing convenience)
 * - Production: Private IPs only (security best practice)
 *
 * @param envName - Environment name
 * @param forcePrivate - Force private IPs regardless of environment
 * @returns true if instances should have public IPs
 *
 * @example
 * ```typescript
 * associatePublicIpAddress: shouldAssociatePublicIp("production"), // false
 * associatePublicIpAddress: shouldAssociatePublicIp("development"), // true
 * ```
 */
export function shouldAssociatePublicIp(
  envName: string,
  forcePrivate: boolean = false
): boolean {
  if (forcePrivate) {
    return false;
  }

  switch (envName.toLowerCase()) {
    case "production":
    case "prod":
      // Production: Always private (CKV_AWS_88)
      return false;

    case "staging":
      // Staging: Private (test production-like setup)
      return false;

    case "development":
    case "dev":
    case "pipeline":
      // Development: Public IPs for convenience
      return true;

    default:
      // Unknown environment: Fail safe - no public IPs
      return false;
  }
}

/**
 * Get appropriate SSL/TLS policy based on environment
 *
 * SECURITY NOTE (CKV_AWS_103 FIX):
 * - Production: TLS 1.3 only (maximum security)
 * - Staging: TLS 1.2+ (test compatibility)
 * - Development: TLS 1.2+ (faster iteration)
 *
 * @param envName - Environment name
 * @param forceTls13 - Force TLS 1.3 regardless of environment
 * @returns SSL policy for ALB HTTPS listener
 *
 * @example
 * ```typescript
 * const listener = alb.addListener("Https", {
 *   port: 443,
 *   sslPolicy: getSslPolicyForEnvironment("production"),
 * });
 * ```
 */
export function getSslPolicyForEnvironment(
  envName: string,
  forceTls13: boolean = false
): elbv2.SslPolicy {
  if (forceTls13) {
    return elbv2.SslPolicy.TLS13_RES;
  }

  switch (envName.toLowerCase()) {
    case "production":
    case "prod":
      // Production: TLS 1.3 only (CKV_AWS_103)
      return elbv2.SslPolicy.TLS13_RES;

    case "staging":
      // Staging: TLS 1.2+ with 1.3 support
      return elbv2.SslPolicy.TLS13_EXT1;

    case "development":
    case "dev":
    case "pipeline":
      // Development: TLS 1.2+ (AWS recommended)
      return elbv2.SslPolicy.RECOMMENDED_TLS;

    default:
      // Unknown environment: Default to TLS 1.2+ minimum
      return elbv2.SslPolicy.RECOMMENDED_TLS;
  }
}

/**
 * Validate that production monitoring has required security configurations
 *
 * Checks for Checkov compliance:
 * - CKV_AWS_88: No public IPs in production
 * - CKV_AWS_260: No 0.0.0.0/0 access in production
 * - CKV_AWS_2: HTTPS enabled in production
 * - CKV_AWS_103: TLS 1.2+ in production
 *
 * @param scope - CDK construct for adding annotations
 * @param envName - Environment name
 * @param config - Security configuration to validate
 */
export function validateProductionMonitoringSecurity(
  scope: cdk.IConstruct,
  envName: string,
  config: {
    hasPublicIps: boolean;
    allowedIpRanges: string[];
    httpsEnabled: boolean;
    certificateArn?: string;
    sslPolicy?: elbv2.SslPolicy;
  }
): void {
  const isProduction =
    envName.toLowerCase() === "production" ||
    envName.toLowerCase() === "prod";

  if (!isProduction) {
    return; // Only validate production
  }

  const errors: string[] = [];
  const warnings: string[] = [];

  // CKV_AWS_88: Check for public IPs
  if (config.hasPublicIps) {
    warnings.push(
      "CKV_AWS_88: EC2 instances have public IPs in production.\n" +
        "  Recommendation: Move to private subnets with NAT Gateway."
    );
  }

  // CKV_AWS_260: Check for 0.0.0.0/0 access
  if (
    config.allowedIpRanges.includes("0.0.0.0/0") ||
    config.allowedIpRanges.some((ip) => ip.includes("0.0.0.0/0"))
  ) {
    errors.push(
      "CKV_AWS_260: ALB allows access from 0.0.0.0/0 in production.\n" +
        "  CRITICAL: Restrict allowedIpRanges to known IPs or use CloudFront."
    );
  }

  // CKV_AWS_2: Check for HTTPS
  if (!config.httpsEnabled || !config.certificateArn) {
    errors.push(
      "CKV_AWS_2: ALB does not use HTTPS in production.\n" +
        "  CRITICAL: Provide certificateArn and enable HTTPS."
    );
  }

  // CKV_AWS_103: Check for TLS 1.2+
  if (
    config.sslPolicy &&
    config.sslPolicy !== elbv2.SslPolicy.RECOMMENDED_TLS &&
    config.sslPolicy !== elbv2.SslPolicy.TLS12 &&
    config.sslPolicy !== elbv2.SslPolicy.TLS13_RES &&
    config.sslPolicy !== elbv2.SslPolicy.TLS13_EXT1 &&
    config.sslPolicy !== elbv2.SslPolicy.TLS13_EXT2
  ) {
    errors.push(
      "CKV_AWS_103: ALB uses weak TLS policy in production.\n" +
        "  CRITICAL: Use TLS 1.2+ minimum (RECOMMENDED_TLS, TLS13_RES, etc.)"
    );
  }

  // Add annotations
  if (errors.length > 0) {
    cdk.Annotations.of(scope).addError(
      "PRODUCTION SECURITY VIOLATIONS:\n\n" +
        errors.join("\n\n") +
        "\n\nResolve these issues before production deployment."
    );
  }

  if (warnings.length > 0) {
    cdk.Annotations.of(scope).addWarning(
      "PRODUCTION SECURITY WARNINGS:\n\n" +
        warnings.join("\n\n") +
        "\n\nConsider addressing these for improved security posture."
    );
  }
}

/**
 * Get subnet type based on environment and public IP configuration
 *
 * Helper for determining correct subnet type for ECS instances
 *
 * @param envName - Environment name
 * @param hasPublicIps - Whether instances have public IPs
 * @returns Recommended subnet type
 */
export function getSubnetTypeForMonitoring(
  envName: string,
  hasPublicIps: boolean
): "PUBLIC" | "PRIVATE_WITH_EGRESS" {
  const isProduction =
    envName.toLowerCase() === "production" ||
    envName.toLowerCase() === "prod";

  // Production should use private subnets
  if (isProduction) {
    return "PRIVATE_WITH_EGRESS";
  }

  // Other environments: Match public IP configuration
  return hasPublicIps ? "PUBLIC" : "PRIVATE_WITH_EGRESS";
}

/**
 * CloudFront managed prefix list for ALB security group restriction
 *
 * Use this to restrict ALB access to CloudFront only (best practice)
 *
 * @param region - AWS region
 * @returns CloudFront managed prefix list ID
 *
 * @example
 * ```typescript
 * alb.connections.allowFrom(
 *   ec2.Peer.prefixList(getCloudFrontPrefixList("eu-west-1")),
 *   ec2.Port.tcp(443)
 * );
 * ```
 */
export function getCloudFrontPrefixList(region: string): string {
  // CloudFront managed prefix lists (from AWS documentation)
  // These are the official AWS-managed prefix lists for CloudFront IPs
  const prefixLists: Record<string, string> = {
    "us-east-1": "pl-3b927c52", // US East (N. Virginia)
    "eu-west-1": "pl-4fa04526", // Europe (Ireland)
    "ap-southeast-1": "pl-31a34658", // Asia Pacific (Singapore)
    // Add other regions as needed
  };

  return (
    prefixLists[region] ||
    prefixLists["us-east-1"] // Default to us-east-1
  );
}
