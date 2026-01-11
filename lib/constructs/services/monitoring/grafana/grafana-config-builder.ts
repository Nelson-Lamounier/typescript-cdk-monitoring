/** @format */

import * as ecs from "aws-cdk-lib/aws-ecs";

import {
  DEFAULT_GRAFANA_PLUGINS,
  DEFAULT_GRAFANA_ROOT_URL,
} from "../../../../shared/constants/service-constants";
import {
  GrafanaDatasourceConfig,
  GrafanaOAuthConfig,
  GrafanaServiceConstructProps,
  GrafanaSmtpConfig,
} from "../../../../shared/types/service-types";

export function buildGrafanaEnvironment(
  props: GrafanaServiceConstructProps,
  adminSecret: ecs.Secret,
  smtpPasswordSecret?: ecs.Secret
): {
  environment: Record<string, string>;
  secrets: Record<string, ecs.Secret>;
} {
  const environment: Record<string, string> = {
    GF_SECURITY_ADMIN_USER: props.adminUser ?? "admin",
    GF_SERVER_ROOT_URL: props.rootUrl ?? DEFAULT_GRAFANA_ROOT_URL,
    GF_SERVER_SERVE_FROM_SUB_PATH: "true",
    GF_USERS_ALLOW_SIGN_UP: "false",
    // CRITICAL: Point Grafana to EFS mounts, not default container paths
    // This ensures data persists and permissions match EFS setup (UID 472, GID 0)
    GF_PATHS_PROVISIONING: "/mnt/efs/config/grafana/provisioning",
    GF_PATHS_DATA: "/mnt/efs/grafana-data",
    GF_PATHS_PLUGINS: "/mnt/efs/grafana-data/plugins",
    GF_PATHS_LOGS: "/mnt/efs/grafana-data/logs",
    GF_LOG_MODE: "console",
    GF_LOG_LEVEL: "info",
    GF_INSTALL_PLUGINS: props.installPlugins ?? DEFAULT_GRAFANA_PLUGINS,
  };

  const secrets: Record<string, ecs.Secret> = {
    GF_SECURITY_ADMIN_PASSWORD: adminSecret,
  };

  buildOAuthEnvironment(props.oauth, environment);
  buildSmtpEnvironment(props.smtp, environment, secrets, smtpPasswordSecret);

  return { environment, secrets };
}

export function buildCloudWatchDatasource(
  name: string,
  region: string
): GrafanaDatasourceConfig {
  return {
    name,
    type: "cloudwatch",
    region,
  };
}

export function buildPrometheusDatasource(
  name: string,
  url: string
): GrafanaDatasourceConfig {
  return {
    name,
    type: "prometheus",
    url,
  };
}

export function generateDatasourceProvisioningYaml(
  datasources: GrafanaDatasourceConfig[] | undefined
): string | undefined {
  if (!datasources || datasources.length === 0) {
    return undefined;
  }
  const yaml = [
    "apiVersion: 1",
    "datasources:",
    ...datasources.map((ds) => {
      const lines = [
        "- name: " + ds.name,
        "  type: " + ds.type,
        "  access: proxy",
      ];
      if (ds.url) {
        lines.push("  url: " + ds.url);
      }
      if (ds.type === "cloudwatch") {
        lines.push("  jsonData:");
        lines.push("    authType: default");
        lines.push("    defaultRegion: " + (ds.region ?? "us-east-1"));
      }
      return lines.join("\n");
    }),
  ];
  return yaml.join("\n");
}

export function generateDashboardProvisioningYaml(
  dashboards: { name: string; path: string }[] | undefined
): string | undefined {
  if (!dashboards || dashboards.length === 0) {
    return undefined;
  }
  const yaml = [
    "apiVersion: 1",
    "providers:",
    ...dashboards.map((dash) => {
      return [
        "- name: " + dash.name,
        "  orgId: 1",
        "  type: file",
        "  disableDeletion: true",
        "  editable: false",
        "  options:",
        "    path: " + dash.path,
      ].join("\n");
    }),
  ];
  return yaml.join("\n");
}

export function buildOAuthEnvironment(
  oauth: GrafanaOAuthConfig | undefined,
  env: Record<string, string> = {}
): Record<string, string> {
  if (!oauth?.enabled) {
    return env;
  }
  if (oauth.clientId) env.GF_AUTH_GENERIC_OAUTH_CLIENT_ID = oauth.clientId;
  if (oauth.clientSecretArn)
    env.GF_AUTH_GENERIC_OAUTH_CLIENT_SECRET = oauth.clientSecretArn;
  if (oauth.authUrl) env.GF_AUTH_GENERIC_OAUTH_AUTH_URL = oauth.authUrl;
  if (oauth.tokenUrl) env.GF_AUTH_GENERIC_OAUTH_TOKEN_URL = oauth.tokenUrl;
  if (oauth.apiUrl) env.GF_AUTH_GENERIC_OAUTH_API_URL = oauth.apiUrl;
  if (oauth.scopes) env.GF_AUTH_GENERIC_OAUTH_SCOPES = oauth.scopes;
  if (oauth.allowedDomains)
    env.GF_AUTH_GENERIC_OAUTH_ALLOWED_DOMAINS = oauth.allowedDomains;
  env.GF_AUTH_GENERIC_OAUTH_ENABLED = "true";
  env.GF_AUTH_DISABLE_LOGIN_FORM = "true";
  return env;
}

export function buildSmtpEnvironment(
  smtp: GrafanaSmtpConfig | undefined,
  env: Record<string, string> = {},
  secrets: Record<string, ecs.Secret> = {},
  smtpPasswordSecret?: ecs.Secret
): Record<string, string> {
  if (!smtp?.enabled) {
    return env;
  }
  if (smtp.host) env.GF_SMTP_HOST = smtp.host;
  if (smtp.user) env.GF_SMTP_USER = smtp.user;
  if (smtpPasswordSecret) {
    secrets.GF_SMTP_PASSWORD = smtpPasswordSecret;
  }
  if (smtp.fromAddress) env.GF_SMTP_FROM_ADDRESS = smtp.fromAddress;
  if (smtp.fromName) env.GF_SMTP_FROM_NAME = smtp.fromName;
  if (smtp.startTlsPolicy) env.GF_SMTP_STARTTLS_POLICY = smtp.startTlsPolicy;
  env.GF_SMTP_ENABLED = "true";
  return env;
}
