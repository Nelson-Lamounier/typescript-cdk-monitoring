/** @format */

import * as logs from "aws-cdk-lib/aws-logs";

import { PRODUCTION_ENV_NAMES } from "./storage-constants";

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

/**
 * Auto Scaling Group defaults for ECS capacity
 */
export const DEFAULT_ASG_MIN_CAPACITY = 1;
export const DEFAULT_ASG_MAX_CAPACITY = 2;
export const DEFAULT_ASG_DESIRED_CAPACITY = 1;
export const DEFAULT_ASG_INSTANCE_TYPE = "t3.micro";
export const DEFAULT_ASG_HEALTH_GRACE_SECONDS = 300;
export const DEFAULT_ASG_UPDATE_MAX_BATCH_SIZE = 1;
export const DEFAULT_ASG_UPDATE_MIN_IN_SERVICE = 0;
export const DEFAULT_ASG_UPDATE_PAUSE_TIME_SECONDS = 300;
export const DEFAULT_ASG_BLOCK_DEVICE_NAME = "/dev/xvda";
export const DEFAULT_ASG_BLOCK_DEVICE_SIZE_GB = 30;

/**
 * ECS task definition defaults
 */
export const DEFAULT_ECS_TASK_MEMORY_RESERVATION_MIB = 512;
export const DEFAULT_ECS_TASK_NETWORK_MODE_EC2 = "bridge";
export const DEFAULT_ECS_TASK_LOG_STREAM_PREFIX = "ecs";
export const DEFAULT_ECS_TASK_HEALTHCHECK_INTERVAL_SECONDS = 30;
export const DEFAULT_ECS_TASK_HEALTHCHECK_TIMEOUT_SECONDS = 5;
export const DEFAULT_ECS_TASK_HEALTHCHECK_RETRIES = 3;
export const DEFAULT_ECS_TASK_HEALTHCHECK_START_PERIOD_SECONDS = 0;

export const DEFAULT_SSM_SCHEDULE_EXPRESSION_DEV = "rate(30 days)";
export const DEFAULT_SSM_SCHEDULE_EXPRESSION_PROD = "rate(7 days)";
export const DEFAULT_SSM_COMPLIANCE_SEVERITY = "HIGH";
export const DEFAULT_SSM_COMPLIANCE_SEVERITY_PROD = "CRITICAL";
export const DEFAULT_SSM_MAX_CONCURRENCY = "10";
export const DEFAULT_SSM_MAX_ERRORS = "5";
export const DEFAULT_SSM_DOCKER_MAX_RETRIES = 24;
export const DEFAULT_SSM_DOCKER_RETRY_DELAY_SECONDS = 5;
export const DEFAULT_SSM_ECS_START_MAX_RETRIES = 6;
export const DEFAULT_SSM_ECS_START_RETRY_DELAY_SECONDS = 5;
export const DEFAULT_SSM_AGENT_CHECK_MAX_RETRIES = 36;
export const DEFAULT_SSM_AGENT_CHECK_DELAY_SECONDS = 10;
export const DEFAULT_SSM_LOG_RETENTION_DEV = logs.RetentionDays.TWO_WEEKS;
export const DEFAULT_SSM_LOG_RETENTION_PROD = logs.RetentionDays.ONE_MONTH;
// applyOnlyAtCronInterval is NOT supported with rate() schedules (only cron() schedules)
// AWS SSM returns: "ApplyOnlyAtCronInterval is not supported for Rate Schedule associations"
// Setting to false ensures associations run immediately on new instances AND at scheduled intervals
export const DEFAULT_SSM_APPLY_ONLY_AT_CRON_INTERVAL = false;

export function resolveSsmSchedule(envName: string): string {
  return PRODUCTION_ENV_NAMES.includes(envName)
    ? DEFAULT_SSM_SCHEDULE_EXPRESSION_PROD
    : DEFAULT_SSM_SCHEDULE_EXPRESSION_DEV;
}

/**
 * ECS service defaults
 */
export const DEFAULT_ECS_SERVICE_DESIRED_COUNT = 2;
export const DEFAULT_ECS_SERVICE_MIN_HEALTHY_PERCENT = 100;
export const DEFAULT_ECS_SERVICE_MAX_HEALTHY_PERCENT = 200;
export const DEFAULT_ECS_SERVICE_HEALTH_GRACE_SECONDS = 120;
export const DEFAULT_ECS_SERVICE_AUTOSCALE_MIN_CAPACITY = 1;
export const DEFAULT_ECS_SERVICE_AUTOSCALE_MAX_CAPACITY = 10;