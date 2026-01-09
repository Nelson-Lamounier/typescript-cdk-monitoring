/** @format */

import * as autoscaling from "aws-cdk-lib/aws-autoscaling";
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
  capacityType?: autoscaling.CapacityRebalance;
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
