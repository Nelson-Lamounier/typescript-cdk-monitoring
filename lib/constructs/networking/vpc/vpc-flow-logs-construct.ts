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
import { isProductionEnvironment } from "../../../shared/utils"; // ✅ ADD

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
 * - Environment-aware removal policy (RETAIN for production, DESTROY for dev)
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
 * - Environment-aware retention defaults
 *
 * Lifecycle Management:
 * - Development: Log group DESTROYED with stack (cost optimization)
 * - Production: Log group RETAINED (compliance, auditing)
 * - Override via removalPolicy prop if needed
 *
 * CDK Nag Compliance:
 * - AwsSolutions-VPC7: VPC Flow Logs enabled for security monitoring
 * - AwsSolutions-LOG1: CloudWatch Logs encryption with KMS
 *
 * @example
 * ```typescript
 * // Development (destroy logs with stack)
 * const flowLogs = new VpcFlowLogsConstruct(this, "FlowLogs", {
 *   vpc: devVpc,
 *   envName: "development",
 *   retentionDays: logs.RetentionDays.THREE_DAYS,
 *   removalPolicy: cdk.RemovalPolicy.DESTROY,
 * });
 *
 * // Production (retain logs for compliance)
 * const flowLogs = new VpcFlowLogsConstruct(this, "FlowLogs", {
 *   vpc: prodVpc,
 *   envName: "production",
 *   retentionDays: logs.RetentionDays.SIX_MONTHS,
 *   encryptionKey: kmsKey,
 *   removalPolicy: cdk.RemovalPolicy.RETAIN,
 * });
 * ```
 */
export class VpcFlowLogsConstruct extends Construct {
  public readonly logGroup: logs.LogGroup;
  public readonly logGroupName: string;
  public readonly flowLog: ec2.FlowLog;

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
    } = props;

    // Environment-aware removal policy
    // Production: RETAIN (compliance, auditing)
    // Development: DESTROY (cost optimization)
    const removalPolicy =
      props.removalPolicy ??
      (isProductionEnvironment(envName)
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY);

    // Validate retention days
    validateRetentionDays(retentionDays);

    // Warn about short retention in production environments
    const isProduction = isProductionEnvironment(envName);
    if (
      isProduction &&
      retentionDays < MIN_PRODUCTION_FLOW_LOGS_RETENTION_DAYS
    ) {
      Annotations.of(this).addWarning(
        `VPC Flow Logs retention is set to ${retentionDays} days in production. ` +
          `Consider increasing to at least ${MIN_PRODUCTION_FLOW_LOGS_RETENTION_DAYS} days for compliance and security analysis. ` +
          `Common production retention: 90-365 days.`
      );
    }

    // Production retention notice
    if (removalPolicy === cdk.RemovalPolicy.RETAIN) {
      Annotations.of(this).addInfo(
        `🔒 VPC Flow Logs configured with RETAIN policy - ` +
          `log group will persist after stack deletion for compliance/auditing`
      );
    }

    // Project-agnostic log group naming
    const finalLogGroupName =
      logGroupName ||
      (projectName
        ? `/aws/vpc/flowlogs/${envName}-${projectName}`
        : `/aws/vpc/flowlogs/${envName}`);

    // Create CloudWatch Log Group for flow logs
    // Cost Optimisation: Configurable retention balances cost with compliance
    // Security: KMS encryption for sensitive network traffic logs
    // Lifecycle: Environment-aware removal policy
    this.logGroup = new logs.LogGroup(this, "FlowLogsLogGroup", {
      logGroupName: finalLogGroupName,
      retention: getRetentionDays(retentionDays),
      removalPolicy,
      encryptionKey,
    });

    this.logGroupName = this.logGroup.logGroupName;

    // Create IAM role for VPC Flow Logs
    // Security: Use explicit permissions for least privilege
    const flowLogsRole = new iam.Role(this, "FlowLogsRole", {
      assumedBy: new iam.ServicePrincipal("vpc-flow-logs.amazonaws.com"),
      description: `VPC Flow Logs role for ${envName} environment${
        projectName ? ` (${projectName})` : ""
      }`,
    });

    // Grant explicit CloudWatch Logs permissions (least privilege)
    flowLogsRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "logs:CreateLogStream",
          "logs:PutLogEvents",
          "logs:DescribeLogStreams",
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
    this.flowLog = new ec2.FlowLog(this, "VpcFlowLog", {
      resourceType: ec2.FlowLogResourceType.fromVpc(vpc),
      destination: ec2.FlowLogDestination.toCloudWatchLogs(
        this.logGroup,
        flowLogsRole
      ),
      trafficType,
      logFormat, // Custom format for cost optimization
      maxAggregationInterval, // 10-min vs 1-min for cost control
    });

    // Resource tagging (project-agnostic)
    cdk.Tags.of(this).add("Environment", envName);
    if (projectName) {
      cdk.Tags.of(this).add("Project", projectName);
    }
    cdk.Tags.of(this).add("ManagedBy", "CDK");
    cdk.Tags.of(this).add("Component", "VpcFlowLogs");
  }
}
