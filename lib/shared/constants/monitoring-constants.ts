/** @format */

import * as cdk from "aws-cdk-lib";
import * as efs from "aws-cdk-lib/aws-efs";

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
