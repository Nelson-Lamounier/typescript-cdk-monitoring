/** @format */

import type * as cdk from "aws-cdk-lib";
import type * as ec2 from "aws-cdk-lib/aws-ec2";
import type * as ecr from "aws-cdk-lib/aws-ecr";
import type * as efs from "aws-cdk-lib/aws-efs";
import type * as iam from "aws-cdk-lib/aws-iam";
import type * as kms from "aws-cdk-lib/aws-kms";

export interface EcrLifecycleRuleConfig {
  description?: string;
  rulePriority?: number;
  maxImageCount?: number;
  maxImageAgeDays?: number;
  tagStatus?: ecr.TagStatus;
  tagPrefixList?: string[];
}

export interface EcrReplicationDestination {
  region: string;
  registryId?: string;
}

export interface EcrConstructProps {
  envName: string;
  projectName?: string;
  repositoryName: string;
  imageTagMutability?: ecr.TagMutability;
  imageScanOnPush?: boolean;
  lifecycleRules?: EcrLifecycleRuleConfig[];
  replicationDestinations?: EcrReplicationDestination[];
  encryption?: ecr.RepositoryEncryption;
  kmsKeyArn?: string;
  removalPolicy?: cdk.RemovalPolicy;
  pipelineAccounts?: string[];
  additionalPrincipals?: iam.IPrincipal[];
  customPolicyStatements?: iam.PolicyStatement[];
  customTags?: Record<string, string>;
}

export interface EfsLifecycleConfig {
  /**
   * Transition primary storage to Infrequent Access.
   */
  transitionToIa?: efs.LifecyclePolicy;
  /**
   * Transition IA data to Archive. Uses raw string as archive values are only supported via L1.
   * Valid values: AFTER_1_DAY | AFTER_7_DAYS | AFTER_14_DAYS | AFTER_30_DAYS | AFTER_60_DAYS | AFTER_90_DAYS
   */
  transitionToArchive?: string;
  /**
   * When to move archived/IA data back to primary.
   */
  outOfInfrequentAccessPolicy?: efs.OutOfInfrequentAccessPolicy;
}

export interface EfsMountTargetConfig {
  subnetSelection?: ec2.SubnetSelection;
  /**
   * Only the first entry is applied because EFS L2 accepts a single security group.
   */
  securityGroups?: ec2.ISecurityGroup[];
  oneZone?: boolean;
  availabilityZoneName?: string;
}

export interface EfsBackupConfig {
  /**
   * Enable AWS Backup policy at the file system level.
   */
  enabled?: boolean;
}

export interface EfsReplicationDestination {
  region: string;
  kmsKeyId?: string;
  availabilityZoneName?: string;
}

export interface EfsReplicationConfig {
  destinations: EfsReplicationDestination[];
}

export interface EfsFileSystemConstructProps {
  vpc: ec2.IVpc;
  envName: string;
  /**
   * Optional purpose suffix used in names and tagging.
   */
  purpose?: string;
  fileSystemName?: string;
  enableEncryption?: boolean;
  kmsKey?: kms.IKey;
  lifecycle?: EfsLifecycleConfig;
  performanceMode?: efs.PerformanceMode;
  throughputMode?: efs.ThroughputMode;
  provisionedThroughputPerSecond?: cdk.Size;
  removalPolicy?: cdk.RemovalPolicy;
  securityGroup?: ec2.ISecurityGroup;
  mountTargets?: EfsMountTargetConfig;
  backup?: EfsBackupConfig;
  replication?: EfsReplicationConfig;
  fileSystemPolicy?:
    | iam.PolicyDocument
    | iam.PolicyStatement[]
    | Record<string, unknown>;
  additionalTags?: Record<string, string>;
}

