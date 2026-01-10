/** @format */

import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as logs from "aws-cdk-lib/aws-logs";

import { SubnetConfiguration } from "./networking-types";

export interface BaseStackProps extends cdk.StackProps {
  envName: string;
  projectName?: string;
  enableProductionWarnings?: boolean;
  customTags?: Record<string, string>;
}

/**
 * Properties for Networking Stack (Foundation Layer)
 */
export interface NetworkingStackProps extends BaseStackProps {
  vpcCidr?: string;
  vpcName?: string;
  maxAzs?: number;
  natGateways?: number;
  enableVpcFlowLogs?: boolean;
  enableVpcEndpoints?: boolean;
  enableDnsHostnames?: boolean;
  enableDnsSupport?: boolean;
  /** Subnet configuration using custom SubnetConfiguration type */
  subnetConfiguration?: SubnetConfiguration[];
  flowLogTrafficType?: ec2.FlowLogTrafficType;
  flowLogRetention?: logs.RetentionDays;
  createSsmParameters?: boolean;
  createOutputs?: boolean;
  enableExports?: boolean;
}
