/** @format */

import { Construct } from "constructs";
import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ssm from "aws-cdk-lib/aws-ssm";

import { SuppressionManager } from "../../cdk-nag";
import { CrossAccountTarget } from "../../shared/types/monitoring-types";

// ============================================================================
// EBS STORAGE STACK
// ============================================================================

export interface EbsStorageStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
  envName: string;
  projectName?: string; // Project name for resource naming and SSM parameter paths
  projectType?: string; // Project type (e.g., "monitoring", "webapp") for conditional configuration
  crossAccountTargets?: CrossAccountTarget[];
  /**
   * Size of Prometheus data volume in GB (for monitoring projects)
   * @default 100
   */
  prometheusVolumeSize?: number;
  /**
   * Size of Grafana data volume in GB (for monitoring projects)
   * @default 50
   */
  grafanaVolumeSize?: number;
  /**
   * Volume type for data volumes
   * @default gp3
   */
  volumeType?: ec2.EbsDeviceVolumeType;
  /**
   * Generic EBS volume configurations (project-agnostic)
   * If provided, these will be used instead of prometheusVolumeSize/grafanaVolumeSize
   */
  volumes?: Array<{
    name: string; // Volume name/identifier (e.g., "prometheus", "grafana", "app-data")
    sizeGB: number;
    volumeType?: ec2.EbsDeviceVolumeType;
  }>;
}

/**
 * EbsStorageStack - Provisions EBS volume configuration and application-specific parameters
 *
 * This stack creates:
 * - SSM parameters for EBS volume configuration
 * - Application-specific configuration parameters (e.g., Prometheus/Grafana for monitoring projects)
 * - Configuration for EBS volume setup (volumes are created via launch template)
 *
 * Note: EBS volumes are attached to EC2 instances via the launch template,
 * not created directly in this stack. This stack provides configuration and
 * SSM parameters needed for volume initialization.
 *
 * Dependencies:
 * - NetworkingStack (for VPC)
 *
 * Exported Resources:
 * - SSM parameters for storage and application configuration
 */
export class EbsStorageStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: EbsStorageStackProps) {
    super(scope, id, props);

    const {
      envName,
      projectName,
      projectType,
      crossAccountTargets,
      prometheusVolumeSize = 100,
      grafanaVolumeSize = 50,
      volumeType = ec2.EbsDeviceVolumeType.GP3,
      volumes,
    } = props;

    // Determine SSM parameter path prefix (project-agnostic)
    const ssmPrefix = projectName
      ? `/${projectName}/${envName}`
      : `/monitoring/${envName}`;

    // ========================================================================
    // SSM PARAMETERS FOR CONFIGURATION
    // ========================================================================
    // Create application-specific configuration (e.g., Prometheus/Grafana for monitoring)
    if (projectType === "monitoring") {
      this.createMonitoringConfigurationParameters(
        envName,
        projectName,
        ssmPrefix,
        crossAccountTargets
      );
    }

    // ========================================================================
    // EBS VOLUME CONFIGURATION PARAMETERS
    // ========================================================================
    // Store EBS volume configuration for launch template and user data scripts
    // Project-agnostic: supports both legacy (prometheusVolumeSize/grafanaVolumeSize)
    // and new generic volumes array
    if (volumes && volumes.length > 0) {
      // Generic volume configuration (project-agnostic)
      volumes.forEach((vol, index) => {
        new ssm.StringParameter(this, `Volume${index}SizeParam`, {
          parameterName: `${ssmPrefix}/ebs/${vol.name}-volume-size`,
          stringValue: vol.sizeGB.toString(),
          description: `${vol.name} EBS volume size in GB`,
        });

        new ssm.StringParameter(this, `Volume${index}TypeParam`, {
          parameterName: `${ssmPrefix}/ebs/${vol.name}-volume-type`,
          stringValue: vol.volumeType || volumeType,
          description: `${vol.name} EBS volume type`,
        });
      });
    } else {
      // Legacy: Prometheus/Grafana-specific volumes (for backward compatibility)
      new ssm.StringParameter(this, "PrometheusVolumeSizeParam", {
        parameterName: `${ssmPrefix}/ebs/prometheus-volume-size`,
        stringValue: prometheusVolumeSize.toString(),
        description: "Prometheus EBS volume size in GB",
      });

      new ssm.StringParameter(this, "GrafanaVolumeSizeParam", {
        parameterName: `${ssmPrefix}/ebs/grafana-volume-size`,
        stringValue: grafanaVolumeSize.toString(),
        description: "Grafana EBS volume size in GB",
      });

      new ssm.StringParameter(this, "VolumeTypeParam", {
        parameterName: `${ssmPrefix}/ebs/volume-type`,
        stringValue: volumeType,
        description: "EBS volume type for data volumes",
      });
    }

    // ========================================================================
    // CDK NAG SUPPRESSIONS & TAGS
    // ========================================================================
    // Project-agnostic tagging: includes project name if provided
    SuppressionManager.applyToStack(this, "MonitoringEfsStack", envName);
    cdk.Tags.of(this).add("Stack", "EbsStorage");
    if (projectName) {
      cdk.Tags.of(this).add("Project", projectName);
    }
    if (projectType) {
      cdk.Tags.of(this).add("ProjectType", projectType);
    }
    cdk.Tags.of(this).add("Environment", envName);
    cdk.Tags.of(this).add("Layer", "Storage");
    cdk.Tags.of(this).add("ManagedBy", "CDK");

    // ========================================================================
    // STACK OUTPUTS
    // ========================================================================
    // Project-agnostic export naming: includes project name if provided
    const shouldExport = !envName.includes("pipeline");
    const exportPrefix = projectName
      ? `${envName}-${projectName}`
      : `${envName}`;

    if (volumes && volumes.length > 0) {
      // Generic volume outputs
      volumes.forEach((vol, index) => {
        new cdk.CfnOutput(this, `Volume${index}Size`, {
          value: vol.sizeGB.toString(),
          description: `${vol.name} EBS volume size in GB`,
          ...(shouldExport && {
            exportName: `${exportPrefix}-${vol.name}-volume-size`,
          }),
        });
      });
    } else {
      // Legacy: Prometheus/Grafana-specific outputs (for backward compatibility)
      new cdk.CfnOutput(this, "PrometheusVolumeSize", {
        value: prometheusVolumeSize.toString(),
        description: "Prometheus EBS volume size in GB",
        ...(shouldExport && {
          exportName: `${exportPrefix}-prometheus-volume-size`,
        }),
      });

      new cdk.CfnOutput(this, "GrafanaVolumeSize", {
        value: grafanaVolumeSize.toString(),
        description: "Grafana EBS volume size in GB",
        ...(shouldExport && {
          exportName: `${exportPrefix}-grafana-volume-size`,
        }),
      });

      new cdk.CfnOutput(this, "VolumeType", {
        value: volumeType,
        description: "EBS volume type for data volumes",
        ...(shouldExport && { exportName: `${exportPrefix}-ebs-volume-type` }),
      });
    }
  }

  /**
   * Create monitoring-specific configuration parameters (Prometheus, Grafana)
   * Only called for monitoring project types
   */
  private createMonitoringConfigurationParameters(
    envName: string,
    projectName: string | undefined,
    ssmPrefix: string,
    crossAccountTargets?: CrossAccountTarget[]
  ): void {
    const region = cdk.Stack.of(this).region;

    // Prometheus scrape configuration type
    type ScrapeConfig = {
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
    };

    // Prometheus configuration
    const scrapeConfigs: ScrapeConfig[] = [
      {
        job_name: "prometheus",
        static_configs: [{ targets: ["localhost:9090"] }],
        metrics_path: "/prometheus/metrics",
      },
      {
        job_name: "node-exporter",
        // Note: Node Exporter uses HOST network mode, Prometheus uses BRIDGE mode
        // Use HOST_IP_PLACEHOLDER which will be replaced at runtime with EC2 instance's private IP
        static_configs: [
          { targets: ["HOST_IP_PLACEHOLDER:9100"] },
        ],
      },
    ];

    // Add pipeline account EC2 service discovery (same account - no role_arn needed)
    // Project-agnostic: uses project name in Service tag if provided, otherwise "monitoring"
    const serviceTagValue = projectName || "monitoring";
    scrapeConfigs.push({
      job_name: "node-exporter-pipeline",
      ec2_sd_configs: [
        {
          region: region,
          port: 9100,
          filters: [
            { name: "tag:Service", values: [serviceTagValue] },
            { name: "tag:Environment", values: [envName] },
            { name: "instance-state-name", values: ["running"] },
          ],
        },
      ],
    });

    // Add cross-account targets if provided
    if (crossAccountTargets && crossAccountTargets.length > 0) {
      const targetsByEnv = crossAccountTargets.reduce((acc, target) => {
        if (!acc[target.envName]) {
          acc[target.envName] = [];
        }
        acc[target.envName].push(target);
        return acc;
      }, {} as Record<string, CrossAccountTarget[]>);

      for (const [targetEnv, targets] of Object.entries(targetsByEnv)) {
        const nodeExporterTargets = targets.filter(
          (t) => !t.targetType || t.targetType === "node-exporter"
        );
        const applicationTargets = targets.filter(
          (t) => t.targetType === "application"
        );

        if (nodeExporterTargets.length > 0) {
          scrapeConfigs.push({
            job_name: `node-exporter-${targetEnv}`,
            static_configs: [
              {
                targets: nodeExporterTargets.map(
                  (t) => `${t.privateIp}:${t.port}`
                ),
                labels: {
                  environment: targetEnv,
                  service: "node-exporter",
                  account: targetEnv,
                  source: "cross-account",
                },
              },
            ],
          });
        }

        if (applicationTargets.length > 0) {
          scrapeConfigs.push({
            job_name: `nextjs-${targetEnv}`,
            metrics_path: "/api/metrics",
            static_configs: [
              {
                targets: applicationTargets.map(
                  (t) => `${t.privateIp}:${t.port}`
                ),
                labels: {
                  environment: targetEnv,
                  service: "nextjs",
                  app: "portfolio",
                  account: targetEnv,
                  source: "cross-account",
                },
              },
            ],
          });
        }
      }
    }

    const prometheusConfig = {
      global: {
        scrape_interval: "15s",
        evaluation_interval: "15s",
      },
      scrape_configs: scrapeConfigs,
    };

    // Grafana datasource configuration
    const grafanaDatasourceConfig = {
      apiVersion: 1,
      datasources: [
        {
          name: "Prometheus",
          type: "prometheus",
          uid: "prometheus",
          access: "proxy",
          url: "http://HOST_IP_PLACEHOLDER:9090/prometheus",
          isDefault: true,
          editable: true,
        },
      ],
    };

    // Grafana dashboard provisioning configuration
    const grafanaDashboardConfig = {
      apiVersion: 1,
      providers: [
        {
          name: "Default",
          orgId: 1,
          folder: "",
          type: "file",
          disableDeletion: false,
          updateIntervalSeconds: 10,
          allowUiUpdates: true,
          options: {
            path: "/var/lib/grafana/dashboards",
          },
        },
      ],
    };

    // Create SSM parameters with project-agnostic paths
    new ssm.StringParameter(this, "PrometheusConfig", {
      parameterName: `${ssmPrefix}/prometheus-config`,
      stringValue: JSON.stringify(prometheusConfig, null, 2),
      description: "Prometheus scrape configuration (JSON)",
      tier: ssm.ParameterTier.STANDARD,
    });

    new ssm.StringParameter(this, "GrafanaDatasourceConfig", {
      parameterName: `${ssmPrefix}/grafana-datasource-config`,
      stringValue: JSON.stringify(grafanaDatasourceConfig, null, 2),
      description: "Grafana datasource configuration (JSON)",
      tier: ssm.ParameterTier.STANDARD,
    });

    new ssm.StringParameter(this, "GrafanaDashboardConfig", {
      parameterName: `${ssmPrefix}/grafana-dashboard-config`,
      stringValue: JSON.stringify(grafanaDashboardConfig, null, 2),
      description: "Grafana dashboard provisioning configuration (JSON)",
      tier: ssm.ParameterTier.STANDARD,
    });
  }
}
