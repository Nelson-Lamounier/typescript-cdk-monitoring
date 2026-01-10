/** @format */

import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as efs from "aws-cdk-lib/aws-efs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as kms from "aws-cdk-lib/aws-kms";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as autoscaling from "aws-cdk-lib/aws-autoscaling";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";

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
  flowLogRemovalPolicy?: cdk.RemovalPolicy;
  flowLogEncryptionKey?: kms.IKey;
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

/**
 * Properties for Monitoring Infrastructure Stack (Layer 1)
 */
export interface MonitoringInfraStackProps extends BaseStackProps {
  vpc: ec2.IVpc;
  efsStackName: string;
  fileSystem: efs.IFileSystem;
  efsAccessPoint: efs.IAccessPoint;
  efsAvailabilityZone: string;
  efsSecurityGroup: ec2.ISecurityGroup;
  efsInitializationComplete: cdk.CustomResource;
  allowedIpRanges?: string[];
  enableHttps?: boolean;
  certificateArn?: string;
  enableAccessLogs?: boolean;
  accessLogsBucket?: s3.IBucket;
  clusterName?: string;
  instanceType?: ec2.InstanceType;
  minCapacity?: number;
  maxCapacity?: number;
  desiredCapacity?: number;
  enableContainerInsights?: boolean;
  enableExecuteCommand?: boolean;
  usePublicSubnets?: boolean;
  taskLogRetention?: logs.RetentionDays;
  eventLogRetention?: logs.RetentionDays;
  albIdleTimeout?: cdk.Duration;
  enableDeletionProtection?: boolean;
  ssmScheduleExpression?: string;
  createSsmParameters?: boolean;
  createOutputs?: boolean;
  enableExports?: boolean;
}

/**
 * Properties for Monitoring Service Stack (Layer 2)
 */
export interface MonitoringServiceStackProps extends BaseStackProps {
  cluster: ecs.ICluster;
  autoScalingGroup?: autoscaling.AutoScalingGroup;
  loadBalancer: elbv2.IApplicationLoadBalancer;
  listener: elbv2.IApplicationListener;
  prometheusDataPath?: string;
  prometheusConfigPath?: string;
  grafanaDataPath?: string;
  grafanaProvisioningPath?: string;
  grafanaDashboardsPath?: string;
  prometheusRoutePrefix?: string;
  grafanaRootUrl?: string;
  enableEc2ServiceDiscovery?: boolean;
  enableGrafanaCloudWatch?: boolean;
  enableExecuteCommand?: boolean;
  logRetention?: logs.RetentionDays;
  createSsmParameters?: boolean;
  createOutputs?: boolean;
  enableExports?: boolean;
}
