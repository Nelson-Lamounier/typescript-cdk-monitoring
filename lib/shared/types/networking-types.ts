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