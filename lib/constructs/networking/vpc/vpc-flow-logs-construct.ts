/** @format */

import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as logs from "aws-cdk-lib/aws-logs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as cdk from "aws-cdk-lib";
import { Annotations } from "aws-cdk-lib";
import { Construct } from "constructs";

import { VpcFlowLogsConstructProps } from "../../../shared/types/networking-types";
import {
  DEFAULT_FLOW_LOGS_RETENTION_DAYS,
  MIN_PRODUCTION_FLOW_LOGS_RETENTION_DAYS,
} from "../../../shared/constants/networking-constants";
import {
  getRetentionDays,
  validateRetentionDays,
} from "../../../shared/utils/retention";

/**
 * VPC Flow Logs Construct
 *
 * Creates VPC Flow Logs for network traffic monitoring and security analysis.
 * Flow logs capture information about IP traffic going to and from network
 * interfaces in the VPC.
 *
 * Features:
 * - Configurable traffic type (ALL, ACCEPT, REJECT)
 * - CloudWatch Logs integration with KMS encryption support
 * - Configurable log retention with validation
 * - Custom log format for cost optimisation
 * - Aggregation interval configuration (1min vs 10min)
 * - Configurable removal policy
 * - Production environment warnings
 * - Least-privilege IAM permissions
 *
 * Security:
 * - KMS encryption support for sensitive network logs
 * - Explicit IAM permissions (not generic grantWrite)
 * - Automatic IAM role creation with minimal required permissions
 *
 * Cost Optimisation:
 * - Custom log format to reduce log volume and costs
 * - Configurable retention periods
 * - Aggregation interval control (10min reduces costs vs 1min)
 *
 * CDK Nag Compliance:
 * - AwsSolutions-VPC7: VPC Flow Logs enabled for security monitoring
 * - AwsSolutions-LOG1: CloudWatch Logs encryption with KMS
 */
export class VpcFlowLogsConstruct extends Construct {
  public readonly logGroup: logs.LogGroup;
  public readonly logGroupName: string;

  constructor(scope: Construct, id: string, props: VpcFlowLogsConstructProps) {
    super(scope, id);

    const {
      vpc,
      envName,
      projectName,
      trafficType = ec2.FlowLogTrafficType.ALL,
      logGroupName,
      retentionDays = DEFAULT_FLOW_LOGS_RETENTION_DAYS,
      encryptionKey,
      logFormat,
      maxAggregationInterval,
      removalPolicy = cdk.RemovalPolicy.RETAIN,
    } = props;

    // Validate retention days
    validateRetentionDays(retentionDays);

    // Warn about short retention in production environments
    const isProduction = ["production", "prod"].includes(envName.toLowerCase());
    if (isProduction && retentionDays < MIN_PRODUCTION_FLOW_LOGS_RETENTION_DAYS) {
      Annotations.of(this).addWarning(
        `VPC Flow Logs retention is set to ${retentionDays} days in production. ` +
          `Consider increasing to at least ${MIN_PRODUCTION_FLOW_LOGS_RETENTION_DAYS} days for compliance and security analysis. ` +
          `Common production retention: 90-365 days.`
      );
    }

    // Project-agnostic log group naming: includes project name if provided
    const finalLogGroupName =
      logGroupName ||
      (projectName
        ? `/aws/vpc/flowlogs/${envName}-${projectName}`
        : `/aws/vpc/flowlogs/${envName}`);

    // Create CloudWatch Log Group for flow logs
    // Cost Optimisation: Configurable retention balances cost with compliance requirements
    // Default 7-day retention for non-production, increase for production environments
    // Security: KMS encryption for sensitive network traffic logs
    this.logGroup = new logs.LogGroup(this, "FlowLogsLogGroup", {
      logGroupName: finalLogGroupName,
      retention: getRetentionDays(retentionDays),
      removalPolicy,
      // Encryption: Use provided KMS key or AWS managed key (default)
      encryptionKey,
    });

    this.logGroupName = this.logGroup.logGroupName;

    // Create IAM role for VPC Flow Logs
    // Flow logs service needs permissions to write to CloudWatch Logs
    // Security: Use explicit permissions instead of generic grantWrite for least privilege
    const flowLogsRole = new iam.Role(this, "FlowLogsRole", {
      assumedBy: new iam.ServicePrincipal("vpc-flow-logs.amazonaws.com"),
      description: `Role for VPC Flow Logs in ${envName} environment`,
    });

    // Grant explicit permissions for CloudWatch Logs write operations
    // Least privilege: Only the permissions required for flow logs
    flowLogsRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "logs:CreateLogStream",
          "logs:PutLogEvents",
          "logs:DescribeLogStreams", // Required for log stream discovery
        ],
        resources: [
          this.logGroup.logGroupArn,
          `${this.logGroup.logGroupArn}:*`, // Log streams
        ],
      })
    );

    // Grant KMS permissions if encryption key is provided
    if (encryptionKey) {
      encryptionKey.grantEncryptDecrypt(flowLogsRole);
    }

    // Create VPC Flow Log with enhanced configuration
    // Custom log format and aggregation interval for cost optimisation
    new ec2.FlowLog(this, "VpcFlowLog", {
      resourceType: ec2.FlowLogResourceType.fromVpc(vpc),
      destination: ec2.FlowLogDestination.toCloudWatchLogs(
        this.logGroup,
        flowLogsRole
      ),
      trafficType,
      // Custom log format: Select only needed fields to reduce log volume and costs
      // Example: ["${version}", "${account-id}", "${srcaddr}", "${dstaddr}", "${action}"]
      logFormat,
      // Aggregation interval: 10-minute reduces log volume and costs vs 1-minute
      // Default: 1-minute (most granular, higher cost)
      maxAggregationInterval,
    });

    // Add tags for resource management (project-agnostic)
    cdk.Tags.of(this).add("Environment", envName);
    if (projectName) {
      cdk.Tags.of(this).add("Project", projectName);
    }
    cdk.Tags.of(this).add("ManagedBy", "CDK");
  }
}
