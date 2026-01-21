/** @format */

import * as cdk from "aws-cdk-lib";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";

/**
 * Prowler compliance frameworks
 */
export type ProwlerFramework =
  | "cis_aws"
  | "pci_dss_3_2_1"
  | "hipaa"
  | "gdpr"
  | "aws_foundational_security"
  | "soc2";

/**
 * Prowler severity levels
 */
export type ProwlerSeverity =
  | "critical"
  | "high"
  | "medium"
  | "low"
  | "informational";

/**
 * Prowler output formats
 */
export type ProwlerOutputFormat = "json-ocsf" | "csv" | "html" | "json-asff";

/**
 * Prowler construct properties
 */
export interface ProwlerConstructProps {
  /**
   * ECS cluster to run Prowler task
   */
  cluster: ecs.ICluster;

  /**
   * Environment name (development, staging, production)
   */
  envName: string;

  /**
   * Project name for resource naming
   */
  projectName?: string;

  /**
   * S3 bucket for storing Prowler results
   */
  resultsBucket: s3.IBucket;

  /**
   * Compliance frameworks to scan
   * @default CIS for development, CIS + AWS Foundational for production
   */
  frameworks?: ProwlerFramework[];

  /**
   * AWS regions to scan
   * @default Current region only
   */
  regions?: string[];

  /**
   * Specific services to scan (e.g., 's3', 'ec2', 'iam')
   * If not specified, scans all services
   */
  services?: string[];

  /**
   * Specific checks to exclude
   * Use check IDs like 'ec2_instance_public_ip'
   */
  excludeChecks?: string[];

  /**
   * Minimum severity level to report
   * @default 'low' (reports everything except informational)
   */
  minSeverity?: ProwlerSeverity;

  /**
   * Output formats for results
   * @default ['json-ocsf'] for Grafana compatibility
   */
  outputFormats?: ProwlerOutputFormat[];

  /**
   * CPU allocation for Prowler task
   * @default Environment-specific (256 for dev, 512 for prod)
   */
  cpu?: number;

  /**
   * Memory allocation for Prowler task in MiB
   * @default Environment-specific (512 for dev, 1024 for prod)
   */
  memoryMiB?: number;

  /**
   * Task timeout in seconds
   * @default Environment-specific (1800 for dev, 7200 for prod)
   */
  timeoutSeconds?: number;

  /**
   * Log retention for Prowler logs
   * @default Environment-specific
   */
  logRetention?: logs.RetentionDays;

  /**
   * Enable scheduled execution
   * @default true
   */
  enableSchedule?: boolean;

  /**
   * Schedule expression (cron or rate)
   * @default Environment-specific (weekly for dev, daily for prod)
   */
  scheduleExpression?: string;

  /**
   * Enable ECS Exec for debugging
   * @default true for development
   */
  enableExecuteCommand?: boolean;

  /**
   * Custom environment variables for Prowler container
   */
  environmentVariables?: Record<string, string>;

  /**
   * Cross-account role ARNs to assume for scanning other accounts
   * The role must have SecurityAudit permissions
   */
  crossAccountRoleArns?: string[];

  /**
   * Enable sending results to AWS Security Hub
   * @default false
   */
  enableSecurityHub?: boolean;

  /**
   * Additional tags for resources
   */
  tags?: Record<string, string>;
}

/**
 * Prowler stack properties
 */
export interface ProwlerStackProps extends cdk.StackProps {
  /**
   * Environment name
   */
  envName: string;

  /**
   * Project name
   */
  projectName?: string;

  /**
   * VPC (optional, used for security group lookups)
   */
  vpc?: cdk.aws_ec2.IVpc;

  /**
   * Existing EC2-based ECS cluster to use
   * Required - Prowler runs as an EC2 task on your existing cluster
   * This avoids additional Fargate costs
   */
  cluster: ecs.ICluster;

  /**
   * Existing S3 bucket for results
   * If not provided, creates a new bucket
   */
  resultsBucket?: s3.IBucket;

  /**
   * Prowler configuration
   */
  prowlerConfig?: Partial<ProwlerConstructProps>;

  /**
   * Enable CloudFormation exports
   * @default false
   */
  enableExports?: boolean;

  /**
   * Create CloudFormation outputs
   * @default true
   */
  createOutputs?: boolean;
}

/**
 * Security compliance scan result summary
 */
export interface SecurityScanSummary {
  /**
   * Timestamp of the scan
   */
  timestamp: string;

  /**
   * Total number of checks performed
   */
  totalChecks: number;

  /**
   * Number of passed checks
   */
  passed: number;

  /**
   * Number of failed checks
   */
  failed: number;

  /**
   * Number of checks with manual review required
   */
  manual: number;

  /**
   * Breakdown by severity
   */
  bySeverity: Record<ProwlerSeverity, number>;

  /**
   * Breakdown by framework
   */
  byFramework: Record<string, { passed: number; failed: number }>;

  /**
   * Compliance score percentage
   */
  complianceScore: number;
}
