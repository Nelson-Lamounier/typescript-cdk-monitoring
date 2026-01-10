/** @format */

import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as efs from "aws-cdk-lib/aws-efs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as ssm from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";

import { SuppressionManager } from "../../cdk-nag";
import { LambdaFunctionConstruct } from "../../constructs/compute/lambda";
import {
  EfsFileSystemConstruct,
  EfsAccessPointConstruct,
} from "../../constructs/storage/efs";
import { EfsSecurityGroupConstruct } from "../storage/efs-file-system-stack";
import { SsmParametersConstruct } from "../../constructs/config";
import { applyStackTags } from "../../shared/helpers/stack-tagging-helper";
import { buildPrometheusConfig } from "../../shared/helpers/prometheus-config-builder";
import { MonitoringEfsStackProps } from "../../shared/types/stack-types";
import {
  MONITORING_EFS_LIFECYCLE_POLICY,
  MONITORING_EFS_INIT_TIMEOUT,
  MONITORING_EFS_POSIX_USER,
  MONITORING_EFS_CREATION_ACL,
  GRAFANA_HOST_IP_PLACEHOLDER,
} from "../../shared/constants/monitoring-constants";
import { validateEnvName } from "../../shared/utils/validation";
import { isProductionEnvironment } from "../../shared/utils/environment";

/**
 * MonitoringEfsStack - Layer 0: Persistent Storage for Monitoring
 *
 * This stack manages persistent storage and configuration for Prometheus and Grafana.
 * It should only be deployed when storage configuration changes.
 *
 * Components:
 * - EFS FileSystem with encryption at rest
 * - EFS Access Point with POSIX permissions
 * - EFS Security Group allowing VPC CIDR access
 * - Lambda function for one-time EFS initialization
 * - SSM Parameters for Prometheus and Grafana configuration
 *
 * EFS Directory Structure (created by Lambda):
 * ```
 * /monitoring/
 * ├── prometheus-data/      # Prometheus time-series database
 * ├── prometheus-config/    # Prometheus configuration files
 * ├── grafana-data/         # Grafana database (dashboards, users, etc.)
 * ├── grafana-provisioning/ # Grafana datasource provisioning
 * └── grafana-dashboards/   # Grafana dashboard JSON files
 * ```
 *
 * Dependencies:
 * - NetworkingStack (for VPC)
 *
 * Configuration Strategy:
 * - Prometheus config stored in SSM Parameter Store
 * - Grafana datasource/dashboard configs stored in SSM Parameter Store
 * - Lambda function creates directory structure on EFS
 * - Services mount EFS and read configs from SSM at startup
 *
 * Cross-Account Scraping:
 * - Supports EC2 service discovery with IAM role assumption
 * - Supports static targets with private IP addresses
 * - Automatically generates Prometheus scrape configs
 *
 * Production Recommendations:
 * - enableEncryption: true (PCI/HIPAA compliance)
 * - lifecyclePolicy: AFTER_30_DAYS (cost optimization)
 * - removalPolicy: RETAIN (prevent data loss)
 * - Backup EFS with AWS Backup service
 *
 * @example
 * ```typescript
 * // Development
 * const efsStack = new MonitoringEfsStack(app, 'MonitoringEfs', {
 *   envName: 'dev',
 *   vpc: networkingStack.vpc,
 *   removalPolicy: cdk.RemovalPolicy.DESTROY, // Easier cleanup
 * });
 *
 * // Production
 * const efsStack = new MonitoringEfsStack(app, 'MonitoringEfs', {
 *   envName: 'production',
 *   vpc: networkingStack.vpc,
 *   enableEncryption: true,
 *   lifecyclePolicy: efs.LifecyclePolicy.AFTER_30_DAYS,
 *   removalPolicy: cdk.RemovalPolicy.RETAIN,
 *   crossAccountTargets: [
 *     {
 *       envName: 'staging',
 *       targetType: 'node-exporter',
 *       port: 9100,
 *       accountId: '123456789012',
 *       roleArn: 'arn:aws:iam::123456789012:role/prometheus-scraper',
 *     },
 *   ],
 * });
 * ```
 */
export class MonitoringEfsStack extends cdk.Stack {
  /**
   * EFS file system
   */
  public readonly fileSystem: efs.FileSystem;

  /**
   * EFS access point
   */
  public readonly accessPoint: efs.AccessPoint;

  /**
   * EFS mount target security group
   */
  public readonly mountTargetSecurityGroup: ec2.SecurityGroup;

  /**
   * EFS availability zone (first mount target)
   */
  public readonly efsAvailabilityZone: string;

  /**
   * EFS initialization complete custom resource
   */
  public readonly efsInitializationComplete: cdk.CustomResource;

  /**
   * SSM Parameters construct (if enabled)
   */
  public readonly ssmParameters?: SsmParametersConstruct;

  constructor(scope: Construct, id: string, props: MonitoringEfsStackProps) {
    super(scope, id, props);

    // ========================================================================
    // VALIDATION
    // ========================================================================
    validateEnvName(props.envName);

    if (!props.vpc) {
      throw new Error(
        "VPC is required for MonitoringEfsStack.\n\n" +
          "Pass the VPC from NetworkingStack via props."
      );
    }

    // Cross-account targets validation is handled by buildPrometheusConfig

    // ========================================================================
    // DEFAULTS
    // ========================================================================
    const isProduction = isProductionEnvironment(props.envName);

    const enableEncryption = props.enableEncryption ?? true;
    const lifecyclePolicy =
      props.lifecyclePolicy ?? MONITORING_EFS_LIFECYCLE_POLICY;
    const removalPolicy =
      props.removalPolicy ??
      (isProduction ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY);
    const initializationTimeout =
      props.initializationTimeout ?? MONITORING_EFS_INIT_TIMEOUT;
    const posixUser = props.posixUser ?? MONITORING_EFS_POSIX_USER;
    const creationAcl = props.creationAcl ?? MONITORING_EFS_CREATION_ACL;
    const usePublicSubnets = props.usePublicSubnets ?? true;

    // ========================================================================
    // PRODUCTION WARNINGS
    // ========================================================================
    if (props.enableProductionWarnings !== false && isProduction) {
      this.logProductionWarnings(props, removalPolicy, enableEncryption);
    }

    // ========================================================================
    // 1. SUBNET SELECTION
    // ========================================================================
    const mountTargetSubnetSelection =
      props.mountTargetSubnetSelection ??
      props.vpc.selectSubnets({
        subnetType: usePublicSubnets
          ? ec2.SubnetType.PUBLIC
          : ec2.SubnetType.PRIVATE_WITH_EGRESS,
        onePerAz: true,
      });

    // ========================================================================
    // 2. EFS SECURITY GROUP
    // ========================================================================
    const efsSecurityGroupConstruct = new EfsSecurityGroupConstruct(
      this,
      "EfsSecurityGroup",
      {
        vpc: props.vpc,
        envName: props.envName,
        allowedCidrs: [props.vpc.vpcCidrBlock],
        allowAllOutbound: false,
      }
    );

    this.mountTargetSecurityGroup = efsSecurityGroupConstruct.securityGroup;

    // ========================================================================
    // 3. EFS FILE SYSTEM
    // ========================================================================
    const efsFileSystemConstruct = new EfsFileSystemConstruct(
      this,
      "EfsFileSystem",
      {
        vpc: props.vpc,
        envName: props.envName,
        enableEncryption,
        lifecycle: {
          transitionToIa: lifecyclePolicy,
        },
        securityGroup: this.mountTargetSecurityGroup,
        removalPolicy,
        mountTargets: {
          subnetSelection: mountTargetSubnetSelection,
          securityGroups: [this.mountTargetSecurityGroup],
        },
      }
    );

    this.fileSystem = efsFileSystemConstruct.fileSystem;
    // Get availability zone from first mount target subnet
    const firstSubnet = mountTargetSubnetSelection.subnets?.[0];
    this.efsAvailabilityZone =
      firstSubnet?.availabilityZone || props.vpc.availabilityZones[0];

    // ========================================================================
    // 4. EFS ACCESS POINT
    // ========================================================================
    const efsAccessPointConstruct = new EfsAccessPointConstruct(
      this,
      "EfsAccessPoint",
      {
        fileSystem: this.fileSystem,
        envName: props.envName,
        path: "/monitoring",
        posixUser,
        creationAcl,
      }
    );

    this.accessPoint = efsAccessPointConstruct.accessPoint;

    // ========================================================================
    // 5. EFS INITIALIZATION LAMBDA
    // ========================================================================
    const efsInitLambda = new LambdaFunctionConstruct(this, "EfsInitLambda", {
      envName: props.envName,
      functionName: props.projectName
        ? `${props.projectName}-efs-init`
        : "efs-initialization",
      entry: "lambda/handlers/efs-initialisation.ts",
      handler: "handler",
      timeout: initializationTimeout,
      environment: {
        EFS_FILE_SYSTEM_ID: this.fileSystem.fileSystemId,
        EFS_ACCESS_POINT_ID: this.accessPoint.accessPointId,
        ENVIRONMENT: props.envName,
      },
    });

    // Grant EFS permissions
    this.fileSystem.grant(
      efsInitLambda.function,
      "elasticfilesystem:ClientWrite"
    );

    efsInitLambda.function.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "elasticfilesystem:ClientMount",
          "elasticfilesystem:ClientWrite",
          "elasticfilesystem:AccessedViaMountTarget",
          "ssm:GetParameter",
          "ssm:PutParameter",
        ],
        resources: [
          this.fileSystem.fileSystemArn,
          this.accessPoint.accessPointArn,
          `arn:aws:ssm:${this.region}:${this.account}:parameter/monitoring/${props.envName}/*`,
        ],
      })
    );

    // ========================================================================
    // 6. EFS INITIALIZATION CUSTOM RESOURCE
    // ========================================================================
    this.efsInitializationComplete = new cdk.CustomResource(
      this,
      "EfsInitialization",
      {
        serviceToken: efsInitLambda.function.functionArn,
        properties: {
          FileSystemId: this.fileSystem.fileSystemId,
          AccessPointId: this.accessPoint.accessPointId,
          Environment: props.envName,
          Region: this.region,
          Timestamp: Date.now().toString(),
        },
      }
    );

    // ========================================================================
    // 7. SSM PARAMETERS - MONITORING CONFIGS
    // ========================================================================
    this.createMonitoringConfigs(props);

    // ========================================================================
    // 8. SSM PARAMETERS - EFS DISCOVERY
    // ========================================================================
    if (props.createSsmParameters !== false) {
      this.ssmParameters = new SsmParametersConstruct(this, "Parameters", {
        envName: props.envName,
        projectName: props.projectName,
        pathPrefix: `/monitoring/${props.envName}/efs`,
        customParameters: [
          {
            name: "file-system-id",
            value: this.fileSystem.fileSystemId,
            description: `EFS file system ID for ${props.envName} monitoring`,
          },
          {
            name: "access-point-id",
            value: this.accessPoint.accessPointId,
            description: `EFS access point ID for ${props.envName} monitoring`,
          },
          {
            name: "security-group-id",
            value: this.mountTargetSecurityGroup.securityGroupId,
            description: `EFS security group ID for ${props.envName} monitoring`,
          },
          {
            name: "availability-zone",
            value: this.efsAvailabilityZone,
            description: `EFS availability zone for ${props.envName} monitoring`,
          },
        ],
      });
    }

    // ========================================================================
    // 9. CLOUDFORMATION OUTPUTS
    // ========================================================================
    if (props.createOutputs !== false) {
      this.createOutputs(props);
    }

    // ========================================================================
    // 10. RESOURCE TAGGING
    // ========================================================================
    applyStackTags(this, props.envName, props.projectName, {
      ...props.customTags,
      Layer: "Storage",
    });

    // ========================================================================
    // 11. CDK NAG SUPPRESSIONS
    // ========================================================================
    SuppressionManager.applyToStack(this, "MonitoringEfsStack", props.envName);
  }

  /**
   * Log production warnings
   */
  private logProductionWarnings(
    props: MonitoringEfsStackProps,
    removalPolicy: cdk.RemovalPolicy,
    enableEncryption: boolean
  ): void {
    // Warn about DESTROY removal policy
    if (removalPolicy === cdk.RemovalPolicy.DESTROY) {
      cdk.Annotations.of(this).addWarning(
        "PRODUCTION: EFS removal policy set to DESTROY. " +
          "All monitoring data (Prometheus metrics, Grafana dashboards) will be permanently deleted when stack is destroyed. " +
          "Set removalPolicy to RETAIN for production to prevent data loss."
      );
    }

    // Warn about encryption
    if (!enableEncryption) {
      cdk.Annotations.of(this).addWarning(
        "PRODUCTION: EFS encryption disabled. " +
          "Monitoring data will be stored unencrypted at rest. " +
          "Enable encryption for compliance (PCI-DSS, HIPAA) and security best practices."
      );
    }

    // Warn about lifecycle policy
    if (props.lifecyclePolicy === efs.LifecyclePolicy.AFTER_7_DAYS) {
      cdk.Annotations.of(this).addInfo(
        "PRODUCTION: EFS lifecycle policy set to 7 days. " +
          "Frequently accessed monitoring data will be moved to IA storage quickly. " +
          "Consider AFTER_30_DAYS for better performance with active metrics."
      );
    }

    // Warn about cross-account targets without role ARN
    if (props.crossAccountTargets && props.crossAccountTargets.length > 0) {
      // Import CrossAccountTarget type for proper typing
      type CrossAccountTarget = {
        roleArn?: string;
        useEc2ServiceDiscovery?: boolean;
      };
      const targetsWithoutRole = props.crossAccountTargets.filter(
        (t: CrossAccountTarget) =>
          !t.roleArn && t.useEc2ServiceDiscovery !== false
      );

      if (targetsWithoutRole.length > 0) {
        cdk.Annotations.of(this).addWarning(
          `PRODUCTION: ${targetsWithoutRole.length} cross-account target(s) missing roleArn. ` +
            "EC2 service discovery requires IAM role for cross-account access. " +
            "These targets will fall back to static IP configuration."
        );
      }
    }

    // Warn about Lambda timeout
    if (
      props.initializationTimeout &&
      props.initializationTimeout.toMinutes() < 5
    ) {
      cdk.Annotations.of(this).addWarning(
        `PRODUCTION: EFS initialization timeout set to ${props.initializationTimeout.toMinutes()} minutes. ` +
          "Lambda may timeout if EFS mount takes longer than expected. " +
          "Consider increasing to 5+ minutes for production."
      );
    }
  }

  /**
   * Create monitoring configuration SSM parameters
   */
  private createMonitoringConfigs(props: MonitoringEfsStackProps): void {
    const region = cdk.Stack.of(this).region;

    // ========================================================================
    // PROMETHEUS CONFIGURATION
    // ========================================================================
    const prometheusConfig = buildPrometheusConfig(
      props.envName,
      region,
      props.crossAccountTargets
    );

    new ssm.StringParameter(this, "PrometheusConfig", {
      parameterName: `/monitoring/${props.envName}/prometheus-config`,
      stringValue: JSON.stringify(prometheusConfig, null, 2),
      description: `Prometheus configuration for ${props.envName} monitoring`,
      tier: ssm.ParameterTier.STANDARD,
    });

    // ========================================================================
    // GRAFANA DATASOURCE CONFIGURATION
    // ========================================================================
    // Note: HOST_IP_PLACEHOLDER is replaced at runtime with EC2 instance's private IP
    // This is required because Grafana (bridge mode) cannot access Prometheus (host mode) via localhost
    const grafanaDatasourceConfig = {
      apiVersion: 1,
      datasources: [
        {
          name: "Prometheus",
          type: "prometheus",
          access: "proxy",
          url: `http://${GRAFANA_HOST_IP_PLACEHOLDER}:9090/prometheus`,
          isDefault: true,
        },
      ],
    };

    new ssm.StringParameter(this, "GrafanaDatasourceConfig", {
      parameterName: `/monitoring/${props.envName}/grafana-datasource-config`,
      stringValue: JSON.stringify(grafanaDatasourceConfig, null, 2),
      description: `Grafana datasource configuration for ${props.envName}`,
      tier: ssm.ParameterTier.STANDARD,
    });

    // ========================================================================
    // GRAFANA DASHBOARD CONFIGURATION
    // ========================================================================
    const grafanaDashboardConfig = {
      apiVersion: 1,
      providers: [
        {
          name: "default",
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

    new ssm.StringParameter(this, "GrafanaDashboardConfig", {
      parameterName: `/monitoring/${props.envName}/grafana-dashboard-config`,
      stringValue: JSON.stringify(grafanaDashboardConfig, null, 2),
      description: `Grafana dashboard provider configuration for ${props.envName}`,
      tier: ssm.ParameterTier.STANDARD,
    });
  }

  /**
   * Create CloudFormation outputs
   */
  private createOutputs(props: MonitoringEfsStackProps): void {
    const enableExports = props.enableExports ?? false;
    const exportPrefix = props.projectName
      ? `${props.envName}-${props.projectName}`
      : `${props.envName}`;

    new cdk.CfnOutput(this, "FileSystemId", {
      value: this.fileSystem.fileSystemId,
      description: `EFS file system ID for ${props.envName} monitoring`,
      exportName: enableExports
        ? `${exportPrefix}-monitoring-efs-id`
        : undefined,
    });

    new cdk.CfnOutput(this, "AccessPointId", {
      value: this.accessPoint.accessPointId,
      description: `EFS access point ID for ${props.envName} monitoring`,
      exportName: enableExports
        ? `${exportPrefix}-monitoring-ap-id`
        : undefined,
    });

    new cdk.CfnOutput(this, "SecurityGroupId", {
      value: this.mountTargetSecurityGroup.securityGroupId,
      description: "EFS mount target security group ID",
      exportName: enableExports
        ? `${exportPrefix}-monitoring-efs-sg-id`
        : undefined,
    });

    new cdk.CfnOutput(this, "AvailabilityZone", {
      value: this.efsAvailabilityZone,
      description: "EFS availability zone (first mount target)",
    });

    // SSM parameters info
    if (this.ssmParameters) {
      new cdk.CfnOutput(this, "SsmParameterPrefix", {
        value: this.ssmParameters.pathPrefix,
        description: "SSM Parameter Store path prefix for EFS resources",
      });
    }
  }
}
