/** @format */

import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as efs from "aws-cdk-lib/aws-efs";
import * as logs from "aws-cdk-lib/aws-logs";

import { SubnetConfiguration } from "./networking-types";
import { CrossAccountTarget } from "./monitoring-types";

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
// ... existing types

/**
 * Properties for Monitoring EFS Stack (Layer 0)
 */
export interface MonitoringEfsStackProps extends BaseStackProps {
  vpc: ec2.IVpc;
  crossAccountTargets?: CrossAccountTarget[];
  enableEncryption?: boolean;
  lifecyclePolicy?: efs.LifecyclePolicy;
  removalPolicy?: cdk.RemovalPolicy;
  initializationTimeout?: cdk.Duration;
  posixUser?: { uid: string; gid: string };
  creationAcl?: { ownerUid: string; ownerGid: string; permissions: string };
  usePublicSubnets?: boolean;
  mountTargetSubnetSelection?: ec2.SubnetSelection;
  createSsmParameters?: boolean;
  createOutputs?: boolean;
  enableExports?: boolean;
}
