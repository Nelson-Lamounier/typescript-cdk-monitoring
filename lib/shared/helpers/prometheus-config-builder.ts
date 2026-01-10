/** @format */

import { CrossAccountTarget } from "../types/monitoring-types";
import { PROMETHEUS_CONFIG_DEFAULTS } from "../constants/monitoring-constants";

/**
 * Prometheus scrape configuration type
 */
export interface ScrapeConfig {
  job_name: string;
  static_configs?: Array<{
    targets: string[];
    labels?: Record<string, string>;
  }>;
  ec2_sd_configs?: Array<{
    region: string;
    role_arn?: string;
    port: number;
    filters: Array<{ name: string; values: string[] }>;
  }>;
  relabel_configs?: Array<{
    source_labels: string[];
    target_label: string;
    replacement?: string;
  }>;
  metrics_path?: string;
}

/**
 * Build Prometheus configuration for monitoring stack
 */
export function buildPrometheusConfig(
  envName: string,
  region: string,
  crossAccountTargets?: CrossAccountTarget[]
): object {
  const scrapeConfigs: ScrapeConfig[] = [];

  // Add local Prometheus self-scraping
  scrapeConfigs.push({
    job_name: "prometheus",
    static_configs: [{ targets: ["localhost:9090"] }],
    metrics_path: "/prometheus/metrics",
  });

  // Add local node exporter
  scrapeConfigs.push({
    job_name: "node-exporter",
    static_configs: [{ targets: ["localhost:9100"] }],
  });

  // Add same-account EC2 service discovery
  scrapeConfigs.push({
    job_name: "node-exporter-pipeline",
    ec2_sd_configs: [
      {
        region,
        port: 9100,
        filters: [
          { name: "tag:Environment", values: [envName] },
          { name: "tag:Service", values: ["NodeExporter", "monitoring"] },
          { name: "instance-state-name", values: ["running"] },
        ],
      },
    ],
    relabel_configs: [
      {
        source_labels: ["__meta_ec2_private_ip"],
        target_label: "__address__",
        replacement: "${1}:9100",
      },
      {
        source_labels: ["__meta_ec2_tag_Environment"],
        target_label: "environment",
      },
      {
        source_labels: ["__meta_ec2_tag_Service"],
        target_label: "service",
      },
      {
        source_labels: ["__meta_ec2_instance_id"],
        target_label: "instance_id",
      },
      {
        source_labels: ["__meta_ec2_tag_Name"],
        target_label: "instance_name",
      },
    ],
  });

  // Add cross-account targets
  if (crossAccountTargets && crossAccountTargets.length > 0) {
    addCrossAccountTargets(scrapeConfigs, crossAccountTargets, region);
  }

  return {
    global: {
      scrape_interval: PROMETHEUS_CONFIG_DEFAULTS.SCRAPE_INTERVAL,
      evaluation_interval: PROMETHEUS_CONFIG_DEFAULTS.EVALUATION_INTERVAL,
      external_labels: {
        environment: envName,
        cluster: `${envName}-monitoring`,
      },
    },
    rule_files: PROMETHEUS_CONFIG_DEFAULTS.RULE_FILES,
    scrape_configs: scrapeConfigs,
  };
}

/**
 * Add cross-account targets to scrape configs
 */
function addCrossAccountTargets(
  scrapeConfigs: ScrapeConfig[],
  crossAccountTargets: CrossAccountTarget[],
  region: string
): void {
  // Group targets by environment and type
  const targetsByEnv = crossAccountTargets.reduce((acc, target) => {
    const key = `${target.envName}-${target.targetType}`;
    if (!acc[key]) {
      acc[key] = [];
    }
    acc[key].push(target);
    return acc;
  }, {} as Record<string, CrossAccountTarget[]>);

  // Generate scrape configs for each environment/type combination
  for (const targets of Object.values(targetsByEnv) as CrossAccountTarget[][]) {
    const firstTarget = targets[0];
    const useEc2Sd =
      firstTarget.useEc2ServiceDiscovery !== false &&
      firstTarget.accountId &&
      firstTarget.roleArn;

    if (useEc2Sd) {
      // Use EC2 service discovery for cross-account scraping
      scrapeConfigs.push({
        job_name: `${firstTarget.targetType}-${firstTarget.envName}`,
        ec2_sd_configs: [
          {
            region,
            role_arn: firstTarget.roleArn,
            port: firstTarget.port,
            filters: [
              {
                name: "tag:Environment",
                values: [firstTarget.envName],
              },
              {
                name: "instance-state-name",
                values: ["running"],
              },
              ...(firstTarget.targetType === "node-exporter"
                ? [
                    {
                      name: "tag:Service",
                      values: ["NodeExporter", "monitoring"],
                    },
                  ]
                : []),
            ],
          },
        ],
        relabel_configs: [
          {
            source_labels: ["__meta_ec2_private_ip"],
            target_label: "__address__",
            replacement: `\${1}:${firstTarget.port}`,
          },
          {
            source_labels: ["__meta_ec2_tag_Environment"],
            target_label: "environment",
          },
          {
            source_labels: ["__meta_ec2_instance_id"],
            target_label: "instance_id",
          },
          {
            source_labels: ["__meta_ec2_tag_Name"],
            target_label: "instance_name",
          },
          {
            source_labels: ["__meta_ec2_tag_Service"],
            target_label: "service",
          },
        ],
        metrics_path: firstTarget.metricsPath || "/metrics",
      });
    } else if (firstTarget.privateIp) {
      // Fallback to static configs
      scrapeConfigs.push({
        job_name: `${firstTarget.targetType}-${firstTarget.envName}`,
        static_configs: [
          {
            targets: targets.map(
              (t: CrossAccountTarget) => `${t.privateIp}:${t.port}`
            ),
            labels: {
              environment: firstTarget.envName,
              service: firstTarget.targetType,
              account: firstTarget.accountId || firstTarget.envName,
            },
          },
        ],
        metrics_path: firstTarget.metricsPath || "/metrics",
      });
    }
  }
}
