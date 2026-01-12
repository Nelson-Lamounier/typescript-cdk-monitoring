/** @format */

import * as cdk from "aws-cdk-lib";
import * as efs from "aws-cdk-lib/aws-efs";
import * as logs from "aws-cdk-lib/aws-logs";

/**
 * EFS settings
 */
export const MONITORING_EFS_LIFECYCLE_POLICY =
  efs.LifecyclePolicy.AFTER_30_DAYS;
export const MONITORING_EFS_INIT_TIMEOUT = cdk.Duration.minutes(5);

/**
 * EFS POSIX settings
 */
export const MONITORING_EFS_POSIX_USER = {
  uid: "0",
  gid: "0",
} as const;

export const MONITORING_EFS_CREATION_ACL = {
  ownerUid: "0",
  ownerGid: "0",
  permissions: "755",
} as const;

/**
 * Grafana datasource placeholder
 */
export const GRAFANA_HOST_IP_PLACEHOLDER = "HOST_IP_PLACEHOLDER";

/**
 * Prometheus config defaults
 */
export const PROMETHEUS_CONFIG_DEFAULTS = {
  SCRAPE_INTERVAL: "15s",
  EVALUATION_INTERVAL: "15s",
  RULE_FILES: ["/etc/prometheus/alerts.yml"],
} as const;

/**
 * Default log retention
 */
export const MONITORING_TASK_LOG_RETENTION = logs.RetentionDays.TWO_WEEKS;
export const MONITORING_EVENT_LOG_RETENTION = logs.RetentionDays.TWO_WEEKS;

/**
 * ALB settings
 */
export const MONITORING_ALB_IDLE_TIMEOUT = cdk.Duration.seconds(60);

/**
 * SSM association schedule
 */
export const MONITORING_SSM_SCHEDULE = "rate(1 hour)";

/**
 * Default capacity by environment
 */
export const MONITORING_CAPACITY_DEFAULTS = {
  DEV: {
    minCapacity: 1,
    maxCapacity: 1,
    desiredCapacity: 1,
  },
  STAGING: {
    minCapacity: 1,
    maxCapacity: 2,
    desiredCapacity: 1,
  },
  PRODUCTION: {
    minCapacity: 2,
    maxCapacity: 3,
    desiredCapacity: 2,
  },
} as const;

/**
 * Monitoring Service Constants
 */

export const MONITORING_MOUNT_PATHS = {
  PROMETHEUS_DATA: "/mnt/efs/prometheus-data",
  PROMETHEUS_CONFIG: "/mnt/efs/config/prometheus",
  GRAFANA_DATA: "/mnt/efs/grafana-data",
  GRAFANA_PROVISIONING: "/mnt/efs/config/grafana/provisioning",
  GRAFANA_DASHBOARDS: "/mnt/efs/grafana-dashboards",
} as const;

/**
 * Default ports for monitoring services
 */
export const MONITORING_PORTS = {
  PROMETHEUS: 9090,
  GRAFANA: 3000,
  NODE_EXPORTER: 9100,
  ALERTMANAGER: 9093,
} as const;

/**
 * Default route prefixes
 */
export const MONITORING_ROUTES = {
  PROMETHEUS: "/prometheus",
  GRAFANA: "/grafana",
} as const;

/**
 * Default log retention
 */
export const MONITORING_LOG_RETENTION = logs.RetentionDays.ONE_WEEK;

/**
 * Dynamic port range for bridge networking
 */
export const BRIDGE_NETWORK_DYNAMIC_PORT_RANGE = {
  MIN: 32768,
  MAX: 65535,
} as const;

/**
 * Health check settings
 */
export const MONITORING_HEALTH_CHECK = {
  INTERVAL_SECONDS: 60,
  TIMEOUT_SECONDS: 30,
  HEALTHY_THRESHOLD: 2,
  UNHEALTHY_THRESHOLD: 3,
  HEALTHY_HTTP_CODES: "200,301,302",
  PATHS: {
    PROMETHEUS: "/-/healthy",
    GRAFANA: "/api/health",
  },
} as const;

/**
 * Container names
 */
export const MONITORING_CONTAINER_NAMES = {
  PROMETHEUS: "prometheus",
  GRAFANA: "grafana",
  NODE_EXPORTER: "node-exporter",
} as const;

/**
 * ALB routing priorities
 */
export const MONITORING_ALB_PRIORITIES = {
  GRAFANA: 100,
  PROMETHEUS: 200,
} as const;

/**
 * Target group settings
 */
export const MONITORING_TARGET_GROUP = {
  DEREGISTRATION_DELAY_SECONDS: 30,
} as const;

/**
 * Grafana admin secret settings
 */
export const GRAFANA_ADMIN_SECRET = {
  USERNAME: "admin",
  PASSWORD_LENGTH: 32,
  EXCLUDE_PUNCTUATION: true,
} as const;

/**
 * Node Exporter settings
 */
export const NODE_EXPORTER = {
  MEMORY_RESERVATION_MIB: 64,
} as const;
