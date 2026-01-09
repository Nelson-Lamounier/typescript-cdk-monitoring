/** @format */

import * as logs from "aws-cdk-lib/aws-logs";

export const DEFAULT_ECS_CLUSTER_NAME_SUFFIX = "cluster";
export const DEFAULT_ECS_INSTANCE_TYPE = "t3.small";
export const DEFAULT_ECS_MIN_CAPACITY = 1;
export const DEFAULT_ECS_MAX_CAPACITY = 2;
export const DEFAULT_ECS_DESIRED_CAPACITY = 1;
export const DEFAULT_ECS_HEALTH_GRACE_PERIOD_SECONDS = 300;
export const DEFAULT_ECS_LOG_GROUP_PREFIX = "/aws/ecs/cluster/";
export const DEFAULT_ECS_LOG_RETENTION = logs.RetentionDays.ONE_MONTH;
export const DEFAULT_ECS_LOG_RETENTION_DEV = logs.RetentionDays.TWO_WEEKS;
export const DEFAULT_ECS_VOLUME_SIZE_GB = 30;
export const DEFAULT_ECS_BLOCK_DEVICE = "/dev/xvda";
export const DEFAULT_ECS_ALLOW_INTERNAL_PORT_CIDR_FALLBACK = "10.0.0.0/16";
export const DEFAULT_ECS_SLOW_START_SECONDS = 0;
export const DEFAULT_ECS_STICKINESS_SECONDS = 3600;
export const DEFAULT_ECS_TARGET_CAPACITY_PERCENT = 100;
export const DEFAULT_ECS_CAPACITY_STEP_SIZE = 1;
export const DEFAULT_ECS_ENABLE_CONTAINER_INSIGHTS = true;
export const DEFAULT_ECS_ENABLE_EXECUTE_COMMAND = true;
export const DEFAULT_ECS_FARGATE_CAPACITY_PROVIDERS = false;
export const MIN_CLUSTER_NAME_LENGTH = 1;
export const MAX_CLUSTER_NAME_LENGTH = 255;
