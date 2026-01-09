/** @format */

import * as logs from "aws-cdk-lib/aws-logs";

export const DEFAULT_GRAFANA_SERVICE_NAME_SUFFIX = "grafana";
export const DEFAULT_GRAFANA_DESIRED_COUNT = 1;
export const DEFAULT_GRAFANA_MIN_HEALTHY_PERCENT = 50;
export const DEFAULT_GRAFANA_MAX_HEALTHY_PERCENT = 200;
export const DEFAULT_GRAFANA_HEALTH_GRACE_SECONDS = 180;
export const DEFAULT_GRAFANA_CPU_MIB = 512;
export const DEFAULT_GRAFANA_MEMORY_MIB = 1024;
export const DEFAULT_GRAFANA_CONTAINER_PORT = 3000;
export const DEFAULT_GRAFANA_IMAGE = "grafana/grafana:latest";
export const DEFAULT_GRAFANA_LOG_RETENTION = logs.RetentionDays.ONE_MONTH;
export const DEFAULT_GRAFANA_ROOT_URL = "/grafana";
export const DEFAULT_GRAFANA_PLUGINS = "";
export const DEFAULT_GRAFANA_ADMIN_USER = "admin";
export const DEFAULT_GRAFANA_DATASOURCE_NAME = "cloudwatch";
