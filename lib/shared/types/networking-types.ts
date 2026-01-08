/** @format */

import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as kms from "aws-cdk-lib/aws-kms";
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