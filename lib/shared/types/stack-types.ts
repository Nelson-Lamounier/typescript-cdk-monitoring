/** @format */

import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as efs from "aws-cdk-lib/aws-efs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as kms from "aws-cdk-lib/aws-kms";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as autoscaling from "aws-cdk-lib/aws-autoscaling";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as ssm from "aws-cdk-lib/aws-ssm";

import { SubnetConfiguration } from "./networking-types";
import { CrossAccountTarget } from "./monitoring-types";
import { EcsAgentSsmConfig, CloudWatchAgentSsmConfig } from "./compute-types";

export interface BaseStackProps extends cdk.StackProps {
  envName: string;
  projectName?: string;
  enableProductionWarnings?: boolean;
  customTags?: Record<string, string>;
}

/**
 * Properties for Networking Stack (Foundation Layer)
 */
export interface NetworkingStackProps extends BaseStackProps {
  vpcCidr?: string;
  vpcName?: string;
  maxAzs?: number;
  natGateways?: number;
  enableVpcFlowLogs?: boolean;
  enableVpcEndpoints?: boolean;
  enableDnsHostnames?: boolean;
  enableDnsSupport?: boolean;
  /** Subnet configuration using custom SubnetConfiguration type */
  subnetConfiguration?: SubnetConfiguration[];
  flowLogTrafficType?: ec2.FlowLogTrafficType;
  flowLogRetention?: logs.RetentionDays;
  createSsmParameters?: boolean;
  createOutputs?: boolean;
  enableExports?: boolean;
  flowLogRemovalPolicy?: cdk.RemovalPolicy;
  flowLogEncryptionKey?: kms.IKey;
}
// ... existing types

/**
 * Properties for Monitoring EFS Stack (Layer 0)
 */
export interface MonitoringEfsStackProps extends BaseStackProps {
  vpc: ec2.IVpc;
  crossAccountTargets?: CrossAccountTarget[];
  enableEncryption?: boolean;
  lifecyclePolicy?: efs.LifecyclePolicy;
  removalPolicy?: cdk.RemovalPolicy;
  initializationTimeout?: cdk.Duration;
  posixUser?: { uid: string; gid: string };
  creationAcl?: { ownerUid: string; ownerGid: string; permissions: string };
  usePublicSubnets?: boolean;
  mountTargetSubnetSelection?: ec2.SubnetSelection;
  createSsmParameters?: boolean;
  createOutputs?: boolean;
  enableExports?: boolean;
}

/**
 * Properties for Monitoring Infrastructure Stack (Layer 1)
 */
export interface MonitoringInfraStackProps extends BaseStackProps {
  vpc: ec2.IVpc;
  efsStackName: string;
  fileSystem: efs.IFileSystem;
  efsAccessPoint: efs.IAccessPoint;
  efsAvailabilityZone: string;
  efsSecurityGroup: ec2.ISecurityGroup;
  /**
   * EFS initialization complete resource
   * This is the SSM Association execution that runs the automation document
   */
  efsInitializationComplete: ssm.CfnAssociation;
  allowedIpRanges?: string[];
  enableHttps?: boolean;
  certificateArn?: string;
  enableAccessLogs?: boolean;
  accessLogsBucket?: s3.IBucket;
  clusterName?: string;
  instanceType?: ec2.InstanceType;
  minCapacity?: number;
  maxCapacity?: number;
  desiredCapacity?: number;
  enableContainerInsights?: boolean;
  enableExecuteCommand?: boolean;
  usePublicSubnets?: boolean;
  taskLogRetention?: logs.RetentionDays;
  eventLogRetention?: logs.RetentionDays;
  albIdleTimeout?: cdk.Duration;
  enableDeletionProtection?: boolean;
  ssmScheduleExpression?: string;
  createSsmParameters?: boolean;
  createOutputs?: boolean;
  enableExports?: boolean;

  // ========================================================================
  // ENHANCED USERDATA CONFIGURATION
  // ========================================================================

  /**
   * Enable system package updates during instance bootstrap
   *
   * When true:
   * - Updates all system packages to latest versions during boot
   * - Increases boot time by 1-3 minutes
   * - Ensures latest security patches are applied
   *
   * When false:
   * - Faster boot time
   * - Relies on AMI being up-to-date
   *
   * @default true for production, false for non-production
   */
  enableSystemUpdates?: boolean;

  /**
   * Enable bootstrap metadata tracking in SSM Parameter Store
   *
   * Stores bootstrap information for auditing and troubleshooting:
   * - Bootstrap version and timestamp
   * - Environment and cluster configuration
   * - Instance metadata (ID, type, AMI, AZ)
   * - SSM agent version
   *
   * Metadata stored at: /bootstrap/{envName}/instances/{instanceId}
   *
   * @default true
   */
  enableMetadataTracking?: boolean;

  /**
   * Custom SSM parameter path prefix for bootstrap metadata
   *
   * Full path will be: /{prefix}/{envName}/instances/{instanceId}
   *
   * @default /bootstrap
   */
  metadataParameterPrefix?: string;

  /**
   * Custom bootstrap version identifier
   *
   * Used to track configuration changes across deployments.
   * Stored in metadata for version tracking and auditing.
   *
   * @default Generated ISO timestamp
   */
  bootstrapVersion?: string;

  // ========================================================================
  // PROMETHEUS STORAGE CONFIGURATION
  // ========================================================================

  /**
   * Size of the dedicated EBS volume for Prometheus TSDB data in GB
   *
   * IMPORTANT: Prometheus requires local block storage (EBS), NOT NFS/EFS.
   * This volume is formatted as ext4 and mounted to /mnt/prometheus-data.
   * EFS is used only for configuration files.
   *
   * Sizing guidelines:
   * - Development: 20 GB (small metrics dataset)
   * - Staging: 50 GB (medium metrics, 30-day retention)
   * - Production: 100+ GB (large metrics, longer retention)
   *
   * @default 20 (for development)
   */
  prometheusDataVolumeSizeGB?: number;

  // ========================================================================
  // SSM STATE MANAGER CONFIGURATION
  // ========================================================================

  /**
   * ECS agent SSM State Manager configuration
   *
   * Configures the schedule and behaviour for ECS agent installation
   * and configuration via SSM State Manager.
   *
   * Defaults:
   * - Production: Every 7 days, CRITICAL compliance severity
   * - Non-production: Every 30 days, HIGH compliance severity
   */
  ssmEcsAgentConfig?: EcsAgentSsmConfig;

  /**
   * CloudWatch Agent SSM State Manager configuration
   *
   * Configures the schedule and behaviour for CloudWatch agent installation
   * and log collection setup via SSM State Manager.
   *
   * Defaults:
   * - Production: Every 7 days, CRITICAL compliance severity
   * - Non-production: Every 30 days, HIGH compliance severity
   */
  ssmCloudWatchAgentConfig?: CloudWatchAgentSsmConfig;

  /**
   * Custom SSM association targets
   *
   * Specifies which EC2 instances the SSM associations will apply to.
   * If not provided, targets all instances with matching Environment tag.
   *
   * @default [{ key: "tag:Environment", values: [envName] }]
   *
   * @example
   * ```typescript
   * // Target specific instance IDs
   * ssmTargets: [
   *   { key: "InstanceIds", values: ["i-1234567890abcdef0"] }
   * ]
   *
   * // Target by multiple tags
   * ssmTargets: [
   *   {
   *     key: "tag:Project",
   *     values: ["monitoring"]
   *   }
   * ]
   * ```
   */
  ssmTargets?: ssm.CfnAssociation.TargetProperty[];
}

/**
 * Properties for Monitoring Service Stack (Layer 2)
 */
export interface MonitoringServiceStackProps extends BaseStackProps {
  cluster: ecs.ICluster;
  autoScalingGroup?: autoscaling.AutoScalingGroup;
  loadBalancer: elbv2.IApplicationLoadBalancer;
  listener: elbv2.IApplicationListener;
  prometheusDataPath?: string;
  prometheusConfigPath?: string;
  grafanaDataPath?: string;
  grafanaProvisioningPath?: string;
  grafanaDashboardsPath?: string;
  prometheusRoutePrefix?: string;
  grafanaRootUrl?: string;
  enableEc2ServiceDiscovery?: boolean;
  enableGrafanaCloudWatch?: boolean;
  enableExecuteCommand?: boolean;
  enableCircuitBreaker?: boolean;
  logRetention?: logs.RetentionDays;
  createSsmParameters?: boolean;
  createOutputs?: boolean;
  enableExports?: boolean;

  /**
   * Prometheus service configuration overrides
   * Used to customise CPU, memory, and other Prometheus-specific settings
   *
   * @example
   * ```typescript
   * prometheusProps: {
   *   memoryMiB: 384,  // Reduce from default 1024 for t3.micro
   *   cpu: 256,
   * }
   * ```
   */
  prometheusProps?: {
    cpu?: number;
    memoryMiB?: number;
    containerPort?: number;
    logRetention?: logs.RetentionDays;
  };

  /**
   * Grafana service configuration overrides
   * Used to customise CPU, memory, and other Grafana-specific settings
   *
   * @example
   * ```typescript
   * grafanaProps: {
   *   memoryMiB: 384,  // Reduce from default 1024 for t3.micro
   *   cpu: 256,
   * }
   * ```
   */
  grafanaProps?: {
    cpu?: number;
    memoryMiB?: number;
    containerPort?: number;
    logRetention?: logs.RetentionDays;
  };
}
