/** @format */

import * as cdk from "aws-cdk-lib";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as efs from "aws-cdk-lib/aws-efs";

export const DEFAULT_ECR_LIFECYCLE_MAX_IMAGE_COUNT = 10;
export const MIN_ECR_LIFECYCLE_MAX_IMAGE_COUNT = 1;
export const MAX_ECR_LIFECYCLE_MAX_IMAGE_COUNT = 1000;
export const DEFAULT_ECR_LIFECYCLE_RULE_PRIORITY = 1;

export const DEFAULT_ECR_IMAGE_TAG_MUTABILITY = ecr.TagMutability.IMMUTABLE;
export const DEFAULT_ECR_IMAGE_SCAN_ON_PUSH = true;
export const DEFAULT_ECR_ENCRYPTION = ecr.RepositoryEncryption.KMS;

export const PRODUCTION_ENV_NAMES = ["prod", "production"];

export const DEFAULT_ECR_REMOVAL_POLICY_NON_PROD = cdk.RemovalPolicy.DESTROY;
export const DEFAULT_ECR_REMOVAL_POLICY_PROD = cdk.RemovalPolicy.RETAIN;

export const DEFAULT_EFS_PERFORMANCE_MODE = efs.PerformanceMode.GENERAL_PURPOSE;
export const DEFAULT_EFS_THROUGHPUT_MODE = efs.ThroughputMode.PROVISIONED;
export const DEFAULT_EFS_PROVISIONED_THROUGHPUT = cdk.Size.mebibytes(10);
export const EFS_MIN_PROVISIONED_THROUGHPUT_MIBPS = 1;
export const EFS_MAX_PROVISIONED_THROUGHPUT_MIBPS = 1024;
export const DEFAULT_EFS_LIFECYCLE_TO_IA = efs.LifecyclePolicy.AFTER_30_DAYS;
export const ALLOWED_EFS_ARCHIVE_TRANSITIONS = [
  "AFTER_1_DAY",
  "AFTER_7_DAYS",
  "AFTER_14_DAYS",
  "AFTER_30_DAYS",
  "AFTER_60_DAYS",
  "AFTER_90_DAYS",
];
export const DEFAULT_EFS_BACKUP_ENABLED = true;
export const DEFAULT_EFS_PURPOSE = "shared-storage";
export const DEFAULT_EFS_REMOVAL_POLICY_NON_PROD = cdk.RemovalPolicy.DESTROY;
export const DEFAULT_EFS_REMOVAL_POLICY_PROD = cdk.RemovalPolicy.RETAIN;

export const DEFAULT_EFS_ACCESS_POINT_PATH = "/";
export const DEFAULT_EFS_ACCESS_POINT_UID = "1000";
export const DEFAULT_EFS_ACCESS_POINT_GID = "1000";
export const DEFAULT_EFS_ACCESS_POINT_PERMISSIONS = "750";
export const MIN_POSIX_ID = 0;
export const MAX_POSIX_ID = 2147483647;

