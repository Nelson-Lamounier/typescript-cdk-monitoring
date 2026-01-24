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

export const DEFAULT_PROMETHEUS_IMAGE = "prom/prometheus:latest";
export const DEFAULT_PROMETHEUS_SERVICE_NAME_SUFFIX = "prometheus";
export const DEFAULT_PROMETHEUS_DESIRED_COUNT = 1;
// minHealthyPercent: 0 allows complete task replacement (stop old, start new)
// This is necessary when using static hostPort (9090) with single instance
// With 50%, ECS would need to keep 1 task running = can't stop to release port
export const DEFAULT_PROMETHEUS_MIN_HEALTHY_PERCENT = 0;
// maxHealthyPercent: 100 prevents running 2 tasks simultaneously
// Critical for single-instance deployments with static hostPort
// With 200%, ECS would try to start new task before stopping old = port conflict
export const DEFAULT_PROMETHEUS_MAX_HEALTHY_PERCENT = 100;
export const DEFAULT_PROMETHEUS_HEALTH_GRACE_SECONDS = 180;
export const DEFAULT_PROMETHEUS_PORT = 9090;
export const DEFAULT_PROMETHEUS_CPU_MIB = 512;
export const DEFAULT_PROMETHEUS_MEMORY_MIB = 1024;
export const DEFAULT_PROMETHEUS_LOG_RETENTION = logs.RetentionDays.ONE_MONTH;
export const DEFAULT_PROMETHEUS_RETENTION = "7d";
export const DEFAULT_PROMETHEUS_SCRAPE_INTERVAL = "30s";
export const DEFAULT_PROMETHEUS_EVAL_INTERVAL = "30s";
export const DEFAULT_ALERTMANAGER_IMAGE = "prom/alertmanager:latest";
export const DEFAULT_ALERTMANAGER_PORT = 9093;

/**
 * Environment-aware memory allocation for Prometheus
 * 
 * Memory requirements:
 * - Production: 1024 MiB (full capacity for higher data retention and query load)
 * - Non-production: 512 MiB (cost-optimised for lower traffic and data volume)
 * 
 * This allows t3.small instances (2 GiB) to run all tasks in dev/staging,
 * while production uses t3.medium (4 GiB) for full resource allocation.
 * 
 * See docs/CAPACITY_ANALYSIS.md for capacity planning details.
 * 
 * @param envName - Environment name (development, staging, production, pipeline)
 * @returns Memory allocation in MiB
 */
export const getPrometheusMemory = (envName: string): number => {
  return envName === "production" ? 1024 : 512;
};

/**
 * Environment-aware memory allocation for Grafana
 * 
 * Memory requirements:
 * - Production: 1024 MiB (full capacity for dashboard rendering and query proxying)
 * - Non-production: 512 MiB (cost-optimised for lower user load)
 * 
 * This allows t3.small instances (2 GiB) to run all tasks in dev/staging,
 * while production uses t3.medium (4 GiB) for full resource allocation.
 * 
 * See docs/CAPACITY_ANALYSIS.md for capacity planning details.
 * 
 * @param envName - Environment name (development, staging, production, pipeline)
 * @returns Memory allocation in MiB
 */
export const getGrafanaMemory = (envName: string): number => {
  return envName === "production" ? 1024 : 512;
};
