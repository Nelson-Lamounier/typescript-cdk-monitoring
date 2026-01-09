/** @format */

import { GrafanaDatasourceConfig } from "../types/service-types";

/**
 * Build Grafana provisioning datasource YAML content.
 * Returns an object keyed by file name for ease of writing to assets if needed.
 */
export function buildDatasourceProvisioning(
  datasources: GrafanaDatasourceConfig[] | undefined
): Record<string, string> {
  if (!datasources || datasources.length === 0) {
    return {};
  }

  const content = {
    apiVersion: 1,
    datasources: datasources.map((ds) => {
      if (ds.type === "prometheus") {
        return {
          name: ds.name,
          type: "prometheus",
          access: "proxy",
          url: ds.url ?? "http://prometheus:9090",
          isDefault: false,
        };
      }

      return {
        name: ds.name,
        type: "cloudwatch",
        access: "proxy",
        jsonData: {
          authType: "default",
          defaultRegion: ds.region ?? "us-east-1",
        },
      };
    }),
  };

  return {
    "datasource.yaml": YAMLStringify(content),
  };
}

function YAMLStringify(obj: unknown): string {
  // Minimal YAML writer for the simple structure above
  // This avoids adding a new dependency for tests.
  return [
    "apiVersion: 1",
    "datasources:",
    ...(Array.isArray((obj as any).datasources)
      ? (obj as any).datasources.map((ds: any) => {
          const lines: string[] = [];
          lines.push("  - name: " + ds.name);
          lines.push("    type: " + ds.type);
          lines.push("    access: " + ds.access);
          if (ds.url) {
            lines.push("    url: " + ds.url);
          }
          if (ds.isDefault) {
            lines.push("    isDefault: true");
          }
          if (ds.jsonData) {
            lines.push("    jsonData:");
            Object.entries(ds.jsonData).forEach(([k, v]) => {
              lines.push(`      ${k}: ${v}`);
            });
          }
          return lines.join("\n");
        })
      : []),
  ].join("\n");
}
