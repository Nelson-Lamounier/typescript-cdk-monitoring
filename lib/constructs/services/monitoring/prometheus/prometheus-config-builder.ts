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

  const command = [
    "/bin/sh",
    "-c",
    [
      "cat <<'EOF' >/etc/prometheus/prometheus.yml",
      config,
      "EOF",
      "exec /bin/prometheus \\",
      "  --config.file=/etc/prometheus/prometheus.yml \\",
      "  --storage.tsdb.path=/prometheus \\",
      `  --storage.tsdb.retention.time=${retention} \\`,
      "  --web.console.libraries=/usr/share/prometheus/console_libraries \\",
      "  --web.console.templates=/usr/share/prometheus/consoles",
    ].join("\n"),
  ];

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
