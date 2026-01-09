/** @format */

import type * as cdk from "aws-cdk-lib";
import type * as ecr from "aws-cdk-lib/aws-ecr";
import type * as iam from "aws-cdk-lib/aws-iam";

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

