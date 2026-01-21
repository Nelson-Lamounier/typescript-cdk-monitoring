/** @format */

import * as logs from "aws-cdk-lib/aws-logs";

/**
 * Prowler Security Scanner Constants
 *
 * Cost-optimised configuration for continuous security compliance monitoring.
 * Prowler scans AWS infrastructure against CIS, PCI-DSS, HIPAA, and other frameworks.
 */

/**
 * Prowler Docker image configuration
 * Using official Prowler image from Docker Hub
 */
export const PROWLER_IMAGE = {
  REPOSITORY: "toniblyx/prowler",
  TAG: "latest",
  FULL: "toniblyx/prowler:latest",
} as const;

/**
 * Prowler resource allocation
 *
 * Memory/CPU requirements depend on AWS account complexity:
 * - Small accounts (< 100 resources): 512 MiB / 256 CPU
 * - Medium accounts (100-1000 resources): 1024 MiB / 512 CPU
 * - Large accounts (> 1000 resources): 2048 MiB / 1024 CPU
 *
 * Development environment uses smaller allocation for cost optimisation.
 */
export const PROWLER_RESOURCES = {
  DEVELOPMENT: {
    CPU: 256,
    MEMORY_MIB: 512,
  },
  STAGING: {
    CPU: 512,
    MEMORY_MIB: 1024,
  },
  PRODUCTION: {
    CPU: 512,
    MEMORY_MIB: 1024,
  },
} as const;

/**
 * Prowler compliance frameworks
 *
 * Available frameworks for scanning:
 * - cis_aws: CIS Amazon Web Services Foundations Benchmark
 * - pci_dss_3_2_1: Payment Card Industry Data Security Standard
 * - hipaa: Health Insurance Portability and Accountability Act
 * - gdpr: General Data Protection Regulation
 * - aws_foundational_security: AWS Foundational Security Best Practices
 * - soc2: Service Organisation Control 2
 */
export const PROWLER_FRAMEWORKS = {
  CIS: "cis_aws",
  PCI_DSS: "pci_dss_3_2_1",
  HIPAA: "hipaa",
  GDPR: "gdpr",
  AWS_FOUNDATIONAL: "aws_foundational_security",
  SOC2: "soc2",
} as const;

/**
 * Default frameworks for each environment
 * Development: Minimal set for faster scans and lower cost
 * Production: Full compliance coverage
 */
export const PROWLER_DEFAULT_FRAMEWORKS = {
  DEVELOPMENT: [PROWLER_FRAMEWORKS.CIS],
  STAGING: [PROWLER_FRAMEWORKS.CIS, PROWLER_FRAMEWORKS.AWS_FOUNDATIONAL],
  PRODUCTION: [
    PROWLER_FRAMEWORKS.CIS,
    PROWLER_FRAMEWORKS.PCI_DSS,
    PROWLER_FRAMEWORKS.AWS_FOUNDATIONAL,
  ],
} as const;

/**
 * Prowler output configuration
 */
export const PROWLER_OUTPUT = {
  FORMAT: "json-ocsf", // OCSF format for Grafana compatibility
  FORMATS_ALL: ["json-ocsf", "csv", "html"],
  S3_PREFIX: "prowler-results",
  LOCAL_OUTPUT_DIR: "/output",
} as const;

/**
 * Prowler scheduling configuration
 *
 * Cost optimisation: Daily scans provide good coverage without excessive API costs.
 * Weekly scans for development to minimise costs.
 */
export const PROWLER_SCHEDULE = {
  // Development: Weekly scan (Sunday at 2 AM UTC)
  DEVELOPMENT: "cron(0 2 ? * SUN *)",
  // Staging: Twice weekly (Wednesday and Sunday at 2 AM UTC)
  STAGING: "cron(0 2 ? * WED,SUN *)",
  // Production: Daily at 2 AM UTC (off-peak hours)
  PRODUCTION: "cron(0 2 * * ? *)",
} as const;

/**
 * Prowler scan timeout configuration (in seconds)
 *
 * Scan duration depends on:
 * - Number of AWS resources
 * - Number of enabled checks
 * - API rate limits
 *
 * Development: 30 minutes (smaller scope)
 * Production: 2 hours (full scan)
 */
export const PROWLER_TIMEOUT = {
  DEVELOPMENT: 1800, // 30 minutes
  STAGING: 3600, // 1 hour
  PRODUCTION: 7200, // 2 hours
} as const;

/**
 * Prowler log retention
 */
export const PROWLER_LOG_RETENTION = {
  DEVELOPMENT: logs.RetentionDays.ONE_WEEK,
  STAGING: logs.RetentionDays.TWO_WEEKS,
  PRODUCTION: logs.RetentionDays.ONE_MONTH,
} as const;

/**
 * S3 lifecycle configuration for Prowler results
 */
export const PROWLER_S3_LIFECYCLE = {
  // Days to keep detailed results
  DEVELOPMENT: 30,
  STAGING: 60,
  PRODUCTION: 365,
  // Transition to Glacier after (production only)
  GLACIER_TRANSITION_DAYS: 90,
} as const;

/**
 * Prowler severity levels for filtering
 */
export const PROWLER_SEVERITY = {
  CRITICAL: "critical",
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
  INFORMATIONAL: "informational",
} as const;

/**
 * Prowler container configuration
 */
export const PROWLER_CONTAINER = {
  NAME: "prowler",
  WORKING_DIR: "/prowler",
} as const;

/**
 * Prowler IAM permission sets
 *
 * SecurityAudit is the AWS managed policy that provides read-only access
 * to most AWS services for security auditing.
 */
export const PROWLER_IAM = {
  MANAGED_POLICY: "arn:aws:iam::aws:policy/SecurityAudit",
  ADDITIONAL_ACTIONS: [
    // Additional read-only permissions not covered by SecurityAudit
    "account:GetAlternateContact",
    "appstream:Describe*",
    "codeartifact:List*",
    "codebuild:BatchGetProjects",
    "ds:Describe*",
    "ds:Get*",
    "ds:List*",
    "ec2:GetEbsEncryptionByDefault",
    "ecr:Describe*",
    "elasticfilesystem:DescribeBackupPolicy",
    "glue:GetConnections",
    "glue:GetSecurityConfiguration*",
    "glue:SearchTables",
    "lambda:GetFunction*",
    "macie2:GetMacieSession",
    "s3:GetAccountPublicAccessBlock",
    "shield:DescribeProtection",
    "shield:GetSubscriptionState",
    "ssm:GetDocument",
    "ssm-incidents:List*",
    "support:Describe*",
    "tag:GetTagKeys",
  ],
} as const;

/**
 * Prowler resource configuration type
 */
export interface ProwlerResourceConfig {
  CPU: number;
  MEMORY_MIB: number;
}

/**
 * Get Prowler resources for environment
 */
export function getProwlerResources(envName: string): ProwlerResourceConfig {
  switch (envName) {
    case "production":
      return { ...PROWLER_RESOURCES.PRODUCTION };
    case "staging":
      return { ...PROWLER_RESOURCES.STAGING };
    default:
      return { ...PROWLER_RESOURCES.DEVELOPMENT };
  }
}

/**
 * Get Prowler schedule for environment
 */
export function getProwlerSchedule(envName: string): string {
  switch (envName) {
    case "production":
      return PROWLER_SCHEDULE.PRODUCTION;
    case "staging":
      return PROWLER_SCHEDULE.STAGING;
    default:
      return PROWLER_SCHEDULE.DEVELOPMENT;
  }
}

/**
 * Get Prowler timeout for environment
 */
export function getProwlerTimeout(envName: string): number {
  switch (envName) {
    case "production":
      return PROWLER_TIMEOUT.PRODUCTION;
    case "staging":
      return PROWLER_TIMEOUT.STAGING;
    default:
      return PROWLER_TIMEOUT.DEVELOPMENT;
  }
}

/**
 * Get Prowler log retention for environment
 */
export function getProwlerLogRetention(envName: string): logs.RetentionDays {
  switch (envName) {
    case "production":
      return PROWLER_LOG_RETENTION.PRODUCTION;
    case "staging":
      return PROWLER_LOG_RETENTION.STAGING;
    default:
      return PROWLER_LOG_RETENTION.DEVELOPMENT;
  }
}

/**
 * Get default frameworks for environment
 */
export function getProwlerDefaultFrameworks(envName: string): string[] {
  switch (envName) {
    case "production":
      return [...PROWLER_DEFAULT_FRAMEWORKS.PRODUCTION];
    case "staging":
      return [...PROWLER_DEFAULT_FRAMEWORKS.STAGING];
    default:
      return [...PROWLER_DEFAULT_FRAMEWORKS.DEVELOPMENT];
  }
}

/**
 * Get S3 lifecycle days for environment
 */
export function getProwlerS3LifecycleDays(envName: string): number {
  switch (envName) {
    case "production":
      return PROWLER_S3_LIFECYCLE.PRODUCTION;
    case "staging":
      return PROWLER_S3_LIFECYCLE.STAGING;
    default:
      return PROWLER_S3_LIFECYCLE.DEVELOPMENT;
  }
}
