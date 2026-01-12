/** @format */

import * as cdk from "aws-cdk-lib";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as efs from "aws-cdk-lib/aws-efs";
import * as logs from "aws-cdk-lib/aws-logs";

import {
  LoadBalancerTargetConfig,
  EcsLaunchType,
  AwsvpcConfigurationLite,
} from "./compute-types";

export interface GrafanaEfsVolumeConfig {
  fileSystem: efs.IFileSystem;
  accessPoint?: efs.IAccessPoint;
  readOnly?: boolean;
}

export interface GrafanaVolumeConfig {
  efs?: GrafanaEfsVolumeConfig;
  /**
   * Host path is only supported for EC2 launch type. Prefer EFS for persistence.
   */
  hostPath?: string;
}

export interface GrafanaDatasourceConfig {
  name: string;
  type: "prometheus" | "cloudwatch";
  url?: string;
  region?: string;
}

export interface GrafanaOAuthConfig {
  enabled?: boolean;
  clientId?: string;
  clientSecretArn?: string;
  authUrl?: string;
  tokenUrl?: string;
  apiUrl?: string;
  scopes?: string;
  allowedDomains?: string;
}

export interface GrafanaSmtpConfig {
  enabled?: boolean;
  host?: string;
  user?: string;
  passwordArn?: string;
  fromAddress?: string;
  fromName?: string;
  startTlsPolicy?: "OpportunisticStartTLS" | "MandatoryStartTLS" | "NoStartTLS";
}

export interface GrafanaServiceConstructProps {
  cluster: ecs.ICluster;
  envName: string;
  projectName?: string;
  launchType?: EcsLaunchType;
  serviceName?: string;
  desiredCount?: number;
  minHealthyPercent?: number;
  maxHealthyPercent?: number;
  healthCheckGracePeriod?: cdk.Duration;
  enableExecuteCommand?: boolean;
  enableCircuitBreaker?: boolean;
  cpu?: number;
  memoryMiB?: number;
  containerPort?: number;
  logRetention?: logs.RetentionDays;
  logGroupKmsKey?: cdk.aws_kms.IKey;
  dataVolume?: GrafanaVolumeConfig;
  provisioningVolume?: GrafanaVolumeConfig;
  dashboardsVolume?: GrafanaVolumeConfig;
  adminUser?: string;
  adminPasswordSecretArn: string;
  rootUrl?: string;
  installPlugins?: string;
  datasources?: GrafanaDatasourceConfig[];
  oauth?: GrafanaOAuthConfig;
  smtp?: GrafanaSmtpConfig;
  loadBalancerTarget?: LoadBalancerTargetConfig;
  scalingConfig?: {
    minCapacity?: number;
    maxCapacity?: number;
    cpuTargetUtilizationPercent?: number;
    memoryTargetUtilizationPercent?: number;
  };
  networkConfiguration?: { awsvpcConfiguration?: AwsvpcConfigurationLite };
}

export interface PrometheusEfsVolumeConfig {
  fileSystem: efs.IFileSystem;
  accessPoint?: efs.IAccessPoint;
  readOnly?: boolean;
}

export interface PrometheusVolumeConfig {
  efs?: PrometheusEfsVolumeConfig;
  hostPath?: string;
}

export interface PrometheusStaticTarget {
  jobName: string;
  targets: string[];
}

export interface PrometheusRemoteWriteConfig {
  url: string;
  bearerTokenSecretArn?: string;
}

export interface PrometheusAlertmanagerConfig {
  image?: string;
  configContent?: string;
  port?: number;
}

export interface PrometheusServiceConstructProps {
  cluster: ecs.ICluster;
  envName: string;
  projectName?: string;
  launchType?: EcsLaunchType;
  serviceName?: string;
  desiredCount?: number;
  minHealthyPercent?: number;
  maxHealthyPercent?: number;
  healthCheckGracePeriod?: cdk.Duration;
  enableExecuteCommand?: boolean;
  enableCircuitBreaker?: boolean;
  cpu?: number;
  memoryMiB?: number;
  containerPort?: number;
  logRetention?: logs.RetentionDays;
  logGroupKmsKey?: cdk.aws_kms.IKey;
  dataVolume: PrometheusVolumeConfig;
  configVolume?: PrometheusVolumeConfig;
  retentionTime?: string;
  scrapeInterval?: string;
  evaluationInterval?: string;
  staticTargets?: PrometheusStaticTarget[];
  remoteWrite?: PrometheusRemoteWriteConfig[];
  alertmanager?: PrometheusAlertmanagerConfig;
  loadBalancerTarget?: LoadBalancerTargetConfig;
  networkConfiguration?: { awsvpcConfiguration?: AwsvpcConfigurationLite };
}
