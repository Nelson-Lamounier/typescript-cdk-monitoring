/** @format */

import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as kms from "aws-cdk-lib/aws-kms";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";

export interface EcsExecuteCommandConfig {
  enable?: boolean;
  kmsKey?: kms.IKey;
  logBucket?: s3.IBucket;
  logging?: ecs.ExecuteCommandLogging;
}

export interface EcsCapacityProviderManagedScaling {
  enableManagedScaling?: boolean;
  targetCapacityPercent?: number;
  minimumScalingStepSize?: number;
  maximumScalingStepSize?: number;
}

export interface EcsSpotOptions {
  spotPrice?: string;
}

export interface EcsClusterConstructProps {
  vpc: ec2.IVpc;
  envName: string;
  projectName?: string;
  clusterName?: string;
  instanceType?: ec2.InstanceType;
  minCapacity?: number;
  maxCapacity?: number;
  desiredCapacity?: number;
  usePublicSubnets?: boolean;
  additionalSecurityGroups?: ec2.ISecurityGroup[];
  customLaunchTemplate?: ec2.ILaunchTemplate;
  customUserData?: ec2.UserData;
  enableContainerInsights?: boolean;
  enableFargateCapacityProviders?: boolean;
  enableExecuteCommand?: boolean;
  executeCommandConfig?: EcsExecuteCommandConfig;
  logRetention?: logs.RetentionDays;
  logGroupKmsKey?: kms.IKey;
  logRemovalPolicy?: cdk.RemovalPolicy;
  capacityProviderManagedScaling?: EcsCapacityProviderManagedScaling;
  spotOptions?: EcsSpotOptions;
  detailedMonitoring?: boolean;
  launchTemplateRole?: iam.IRole;
}

export interface AutoScalingGroupConstructProps {
  vpc: ec2.IVpc;
  cluster: ecs.ICluster;
  envName: string;
  projectName?: string;
  launchTemplate: ec2.ILaunchTemplate;
  minCapacity?: number;
  maxCapacity?: number;
  desiredCapacity?: number;
  subnetSelection?: ec2.SubnetSelection;
  enableManagedScaling?: boolean;
  enableManagedTerminationProtection?: boolean;
  healthCheckGraceSeconds?: number;
  updateMaxBatchSize?: number;
  updateMinInstancesInService?: number;
  updatePauseTimeSeconds?: number;
}

/**
 * User data strategy for launch template
 */
export type UserDataStrategy = "minimal" | "comprehensive";
export interface EcsConfig {
  clusterName: string;
  enableContainerMetadata?: boolean;
  enableTaskIamRole?: boolean;
}

export interface MonitoringConfig {
  installNodeExporter?: boolean;
  installCloudWatchAgent?: boolean;
}


export interface LaunchTemplateConstructProps {
  vpc: ec2.IVpc;
  envName: string;
  projectName?: string;
  launchTemplateName?: string;
  userDataStrategy?: UserDataStrategy;
  userData?: ec2.UserData;
  ecsConfig?: EcsConfig;
  monitoring?: MonitoringConfig;
  instanceType?: ec2.InstanceType;
  machineImage?: ec2.IMachineImage;
  securityGroup?: ec2.ISecurityGroup;
  additionalSecurityGroups?: ec2.ISecurityGroup[];
  role?: iam.IRole;
  keyPair?: ec2.IKeyPair;
  blockDevices?: ec2.BlockDevice[];
  enableDetailedMonitoring?: boolean;
  associatePublicIpAddress?: boolean;
  customTags?: Record<string, string>;
}
