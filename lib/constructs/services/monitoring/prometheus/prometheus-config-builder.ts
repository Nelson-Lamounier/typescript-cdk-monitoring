/** @format */

import {
  DEFAULT_PROMETHEUS_EVAL_INTERVAL,
  DEFAULT_PROMETHEUS_RETENTION,
  DEFAULT_PROMETHEUS_SCRAPE_INTERVAL,
} from "../../../../shared/constants/service-constants";
import {
  PrometheusServiceConstructProps,
  PrometheusStaticTarget,
} from "../../../../shared/types/service-types";

export interface PrometheusConfigArtifacts {
  command: string[];
  configContent: string;
}

export function buildPrometheusConfig(
  props: PrometheusServiceConstructProps
): PrometheusConfigArtifacts {
  const retention = props.retentionTime ?? DEFAULT_PROMETHEUS_RETENTION;
  const scrapeInterval =
    props.scrapeInterval ?? DEFAULT_PROMETHEUS_SCRAPE_INTERVAL;
  const evaluationInterval =
    props.evaluationInterval ?? DEFAULT_PROMETHEUS_EVAL_INTERVAL;

  const staticScrapes =
    props.staticTargets?.map((st) => renderStaticTarget(st)).join("\n") ?? "";

  const config = [
    "global:",
    `  scrape_interval: ${scrapeInterval}`,
    `  evaluation_interval: ${evaluationInterval}`,
    "",
    "scrape_configs:",
    staticScrapes || "  # add scrape jobs",
  ].join("\n");

  // Prometheus command using CONTAINER paths (not host paths)
  // These paths are where volumes are mounted INSIDE the container:
  // - /etc/prometheus → maps to host: /mnt/efs/config/prometheus
  // - /prometheus → maps to host: /mnt/efs/prometheus-data
  const command = [
    "--config.file=/etc/prometheus/prometheus.yml",
    "--storage.tsdb.path=/prometheus",
    `--storage.tsdb.retention.time=${retention}`,
    "--web.console.libraries=/usr/share/prometheus/console_libraries",
    "--web.console.templates=/usr/share/prometheus/consoles",
  ];

  // Add external URL if provided (required for subpath serving behind ALB)
  if (props.externalUrl) {
    command.push(`--web.external-url=${props.externalUrl}`);
    
    // Extract route prefix from external URL (e.g., /prometheus from http://alb/prometheus)
    // The route prefix configures Prometheus to serve all endpoints under this prefix.
    // ALB forwards the FULL path including the prefix to the container.
    // Container receives: /prometheus/-/healthy, /prometheus/-/ready, /prometheus/api/*, etc.
    // Prometheus serves these at the specified route prefix.
    const urlMatch = props.externalUrl.match(/https?:\/\/[^/]+(\/[^?#]*)?/);
    if (urlMatch && urlMatch[1]) {
      const routePrefix = urlMatch[1];
      command.push(`--web.route-prefix=${routePrefix}`);
    }
  }

  return { command, configContent: config };
}

function renderStaticTarget(target: PrometheusStaticTarget): string {
  const lines = [
    `  - job_name: "${target.jobName}"`,
    "    static_configs:",
    "    - targets:",
  ];
  target.targets.forEach((t) => lines.push(`        - "${t}"`));
  return lines.join("\n");
}
