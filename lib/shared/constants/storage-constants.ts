/** @format */

import * as ecr from "aws-cdk-lib/aws-ecr";
import * as cdk from "aws-cdk-lib";

export const DEFAULT_ECR_LIFECYCLE_MAX_IMAGE_COUNT = 10;
export const MIN_ECR_LIFECYCLE_MAX_IMAGE_COUNT = 1;
export const MAX_ECR_LIFECYCLE_MAX_IMAGE_COUNT = 1000;
export const DEFAULT_ECR_LIFECYCLE_RULE_PRIORITY = 1;

export const DEFAULT_ECR_IMAGE_TAG_MUTABILITY = ecr.TagMutability.IMMUTABLE;
export const DEFAULT_ECR_IMAGE_SCAN_ON_PUSH = true;
export const DEFAULT_ECR_ENCRYPTION = ecr.RepositoryEncryption.KMS_MANAGED;

export const PRODUCTION_ENV_NAMES = ["prod", "production"];

export const DEFAULT_ECR_REMOVAL_POLICY_NON_PROD = cdk.RemovalPolicy.DESTROY;
export const DEFAULT_ECR_REMOVAL_POLICY_PROD = cdk.RemovalPolicy.RETAIN;

