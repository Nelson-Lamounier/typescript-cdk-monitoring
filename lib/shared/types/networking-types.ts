/** @format */

import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as kms from "aws-cdk-lib/aws-kms";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as cdk from "aws-cdk-lib";

/**
 * Subnet configuration interface for VPC subnet creation
 */
export interface SubnetConfiguration {
  name: string;
  subnetType: ec2.SubnetType;
  cidrMask: number;
  mapPublicIpOnLaunch?: boolean;
  tags?: Record<string, string>;
}

/**
 * VPC Flow Logs configuration properties
 */
export interface VpcFlowLogsConstructProps {
  vpc: ec2.IVpc;
  envName: string;
  projectName?: string; // Project name for log group naming
  trafficType?: ec2.FlowLogTrafficType;
  logGroupName?: string;
  retentionDays?: number;
  encryptionKey?: kms.IKey; // KMS key for log encryption
  logFormat?: ec2.LogFormat[]; // Custom log format fields for cost optimisation (e.g., [ec2.LogFormat.VERSION, ec2.LogFormat.SRC_ADDR])
  maxAggregationInterval?: ec2.FlowLogMaxAggregationInterval; // 1min vs 10min granularity
  removalPolicy?: cdk.RemovalPolicy; // Configurable removal policy
}

/**
 * VPC Peering configuration properties
 */
export interface VpcPeeringConstructProps {
  /**
   * The VPC in the current account (requester)
   */
  vpc: ec2.IVpc;

  /**
   * The VPC ID in the peer account (accepter)
   */
  peerVpcId: string;

  /**
   * The AWS account ID of the peer VPC (12-digit number)
   */
  peerAccountId: string;

  /**
   * The region of the peer VPC
   * @default - same region as requester VPC
   */
  peerRegion?: string;

  /**
   * The CIDR block of the peer VPC (for route table updates)
   * Must not overlap with the requester VPC CIDR
   */
  peerVpcCidr: string;

  /**
   * Environment name for tagging and resource naming
   */
  envName: string;

  /**
   * Name for the peering connection
   */
  peeringName: string;

  /**
   * IAM role ARN in peer account that allows accepting peering connections
   * This role must exist in the peer account with trust relationship to this account
   */
  peerRoleArn: string;

  /**
   * Project name for resource naming and tagging (optional)
   */
  projectName?: string;

  /**
   * Custom SSM parameter path for storing peering connection ID
   * @default `/vpc-peering/${envName}/connection-id`
   */
  ssmParameterPath?: string;

  /**
   * Lambda timeout for peering operations (seconds)
   * @default 60 seconds
   */
  lambdaTimeoutSeconds?: number;

  /**
   * Enable DNS resolution for peered VPC
   * @default true
   */
  enableDnsResolution?: boolean;
}

/**
 * Security Group rule configuration
 */
export interface SecurityGroupRule {
  peer: ec2.IPeer;
  port: ec2.Port;
  description?: string;
}

/**
 * Security Group construct properties
 */
export interface SecurityGroupConstructProps {
  /**
   * VPC where the security group will be created
   * Required - cannot be undefined
   */
  vpc: ec2.IVpc;

  /**
   * Name for the security group
   * Must be non-empty and follow AWS naming conventions
   */
  groupName: string;

  /**
   * Description for the security group
   * Must be at least 10 characters and provide meaningful context
   */
  description: string;

  /**
   * Environment name for tagging and resource naming
   * Used for standard tagging (Environment tag)
   */
  envName: string;

  /**
   * Project name for resource naming and tagging (optional)
   * Used for project-specific tagging when provided
   */
  projectName?: string;

  /**
   * Allow all outbound traffic
   * @default false (security best practice - requires explicit egress rules)
   *
   * WARNING: Setting to true allows unrestricted outbound access.
   * In production environments, prefer explicit egress rules for better security.
   */
  allowAllOutbound?: boolean;

  /**
   * Ingress rules to add to the security group
   * @default []
   */
  ingressRules?: SecurityGroupRule[];

  /**
   * Egress rules to add to the security group
   * Note: These are always respected, even if allowAllOutbound=true
   * @default []
   */
  egressRules?: SecurityGroupRule[];
}

/**
 * Application Load Balancer construct properties
 */
export interface AlbConstructProps {
  /**
   * VPC where the ALB will be created
   * Required - cannot be undefined
   */
  vpc: ec2.IVpc;

  /**
   * Environment name for tagging and resource naming
   * Used for standard tagging (Environment tag)
   */
  envName: string;

  /**
   * Name for the load balancer
   * Must be non-empty and follow AWS naming conventions
   */
  loadBalancerName: string;

  /**
   * Project name for resource naming and tagging (optional)
   * Used for project-specific tagging when provided
   */
  projectName?: string;

  /**
   * Whether the load balancer is internet-facing
   * @default true
   *
   * WARNING: Internet-facing ALBs are exposed to the public internet.
   * Ensure proper security group rules and WAF protection are configured.
   */
  internetFacing?: boolean;

  /**
   * Security group for the load balancer
   * If not provided, a default security group will be created
   */
  securityGroup?: ec2.ISecurityGroup;

  /**
   * Enable deletion protection
   * @default false
   *
   * WARNING: Deletion protection should be enabled in production environments
   * to prevent accidental deletion of load balancers.
   */
  deletionProtection?: boolean;

  /**
   * Enable access logs
   * @default false
   *
   * WARNING: Access logs should be enabled in production environments
   * for security auditing and troubleshooting.
   */
  accessLogEnabled?: boolean;

  /**
   * S3 bucket for access logs
   * If not provided and accessLogEnabled is true, a bucket will be created
   */
  accessLogBucket?: s3.IBucket;

  /**
   * Prefix for access logs in S3 bucket
   * @default "alb-logs"
   */
  accessLogPrefix?: string;

  /**
   * KMS key for S3 bucket encryption (if bucket is created)
   * If not provided, SSE-S3 encryption will be used
   */
  accessLogBucketEncryptionKey?: kms.IKey;

  /**
   * Lifecycle rule expiration days for access logs
   * @default 90 days
   */
  accessLogRetentionDays?: number;

  /**
   * Lifecycle rule transition to Infrequent Access after days
   * @default 30 days
   */
  accessLogTransitionToIADays?: number;

  /**
   * Separate S3 bucket for server access logs (to avoid circular logging)
   * If not provided and bucket is created, server access logs will be disabled
   */
  serverAccessLogsBucket?: s3.IBucket;

  /**
   * Idle timeout for connections (seconds)
   * @default 60 seconds
   */
  idleTimeout?: cdk.Duration;

  /**
   * Enable cross-zone load balancing
   * @default true
   *
   * Note: For Application Load Balancers, cross-zone load balancing is always enabled
   * and cannot be disabled (unlike Network Load Balancers). This property is kept
   * for API compatibility but has no effect on ALB behavior.
   */
  crossZoneLoadBalancing?: boolean;

  /**
   * Enable HTTP/2
   * @default true
   */
  http2Enabled?: boolean;

  /**
   * Enable dropping invalid header fields
   * @default true (security best practice)
   */
  dropInvalidHeaderFields?: boolean;

  /**
   * Desync mitigation mode
   * @default "defensive" (security best practice)
   */
  desyncMitigationMode?: elbv2.DesyncMitigationMode;

  /**
   * Subnet selection for the load balancer
   * If not provided, will use PUBLIC for internet-facing or PRIVATE_WITH_EGRESS for internal
   */
  vpcSubnets?: ec2.SubnetSelection;
}
