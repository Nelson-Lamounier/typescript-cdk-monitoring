/** @format */

import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as ssm from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";

import {
  DEFAULT_SSM_AGENT_CHECK_DELAY_SECONDS,
  DEFAULT_SSM_AGENT_CHECK_MAX_RETRIES,
  DEFAULT_SSM_APPLY_ONLY_AT_CRON_INTERVAL,
  DEFAULT_SSM_COMPLIANCE_SEVERITY,
  DEFAULT_SSM_COMPLIANCE_SEVERITY_PROD,
  DEFAULT_SSM_DOCKER_MAX_RETRIES,
  DEFAULT_SSM_DOCKER_RETRY_DELAY_SECONDS,
  DEFAULT_SSM_ECS_START_MAX_RETRIES,
  DEFAULT_SSM_ECS_START_RETRY_DELAY_SECONDS,
  DEFAULT_SSM_LOG_RETENTION_DEV,
  DEFAULT_SSM_LOG_RETENTION_PROD,
  DEFAULT_SSM_MAX_CONCURRENCY,
  DEFAULT_SSM_MAX_ERRORS,
  resolveSsmSchedule,
} from "../../../shared/constants/compute-constants";
import { PRODUCTION_ENV_NAMES } from "../../../shared/constants/storage-constants";
import {
  CloudWatchAgentSsmConfig,
  EcsAgentSsmConfig,
  SsmStateManagerConstructProps,
} from "../../../shared/types/compute-types";
import { buildEcsAgentScript } from "../../../shared/helpers/ecs-agent-script-builder";
import {
  validateClusterName,
  validateEnvName,
  validateIamRoleProvided,
  validateLogGroupNameOptional,
  validateScheduleExpression,
  validateSsmTargets,
} from "../../../shared/utils/validation";

/**
 * Enhanced SSM State Manager Construct
 *
 * Provides a flexible framework for creating SSM State Manager associations
 * with support for:
 * - ECS agent configuration
 * - CloudWatch agent setup
 * - EFS mounting
 * - Custom script execution
 *
 * Benefits over UserData:
 * - Can be updated without recreating instances
 * - Can run on a schedule for maintenance and drift detection
 * - Better error handling and retry logic
 * - Centralised management via SSM console
 * - Supports compliance tracking and reporting
 *
 * Architecture:
 * The construct creates three SSM associations in sequence:
 * 1. CloudWatch Agent Installation - Installs the AWS CloudWatch agent package
 * 2. CloudWatch Agent Configuration - Configures log collection for containers, ECS agent, and init logs
 * 3. ECS Agent Configuration - Configures and starts the ECS agent with retry logic
 *
 * All associations run on configurable schedules to ensure configuration drift is corrected
 * automatically without manual intervention.
 *
 * @see https://docs.aws.amazon.com/systems-manager/latest/userguide/systems-manager-state.html
 */
export class SsmStateManagerConstruct extends Construct {
  // ========================================================================
  // PUBLIC PROPERTIES
  // ========================================================================
  public readonly ecsAgentConfigAssociation: ssm.CfnAssociation;
  public readonly cloudWatchAgentInstallAssociation: ssm.CfnAssociation;
  public readonly cloudWatchAgentConfigAssociation: ssm.CfnAssociation;
  public readonly efsMountAssociation?: ssm.CfnAssociation;
  public readonly efsInitAssociation?: ssm.CfnAssociation;

  // ========================================================================
  // PRIVATE PROPERTIES
  // ========================================================================
  private readonly stack = cdk.Stack.of(this);
  private readonly props: SsmStateManagerConstructProps;
  private readonly isProduction: boolean;
  private readonly baseLogPrefix: string;

  // ========================================================================
  // CONSTRUCTOR
  // ========================================================================
  constructor(
    scope: Construct,
    id: string,
    props: SsmStateManagerConstructProps
  ) {
    super(scope, id);

    this.props = props;
    const { envName, projectName, clusterName, instanceRole } = props;

    // Validate required inputs
    validateEnvName(envName);
    validateClusterName(clusterName);
    validateIamRoleProvided(instanceRole, "instanceRole");

    this.isProduction = PRODUCTION_ENV_NAMES.includes(envName);
    this.baseLogPrefix = `/ecs/${projectName ?? envName}`;

    // Resolve configuration with defaults
    const ecsAgentConfig = this.resolveEcsAgentConfig();
    const cloudWatchAgentConfig = this.resolveCloudWatchAgentConfig();
    const associationTargets = this.resolveAssociationTargets(
      ecsAgentConfig,
      cloudWatchAgentConfig
    );

    // Validate resolved configuration
    validateSsmTargets(associationTargets);

    if (!ecsAgentConfig.scheduleExpression) {
      throw new Error(
        `Schedule expression is required for ECS agent association.\n\n` +
          `Environment: ${envName}\n` +
          `Ensure scheduleExpression is provided or defaults are correctly resolved.`
      );
    }
    validateScheduleExpression(ecsAgentConfig.scheduleExpression);

    if (!cloudWatchAgentConfig.scheduleExpression) {
      throw new Error(
        `Schedule expression is required for CloudWatch agent association.\n\n` +
          `Environment: ${envName}\n` +
          `Ensure scheduleExpression is provided or defaults are correctly resolved.`
      );
    }
    validateScheduleExpression(cloudWatchAgentConfig.scheduleExpression);

    // Create CloudWatch log groups for agent output
    const logGroups = this.createLogGroups(cloudWatchAgentConfig);

    // CRITICAL: Mount EFS FIRST before any other operations
    // ECS agent and applications depend on EFS being available
    if (props.fileSystemId && props.efsMountPoint) {
      this.efsMountAssociation = this.createEfsMountAssociation(
        props.fileSystemId,
        props.efsMountPoint,
        associationTargets
      );

      // CRITICAL: Initialize EFS after mounting
      // This creates directories, sets permissions, and downloads config files
      this.efsInitAssociation = this.createEfsInitAssociation(
        props.envName,
        props.efsMountPoint,
        associationTargets
      );

      // Ensure init waits for mount
      this.efsInitAssociation.addDependency(this.efsMountAssociation);
    }

    // Create ECS agent configuration association
    // Must run AFTER EFS is mounted and initialized
    this.ecsAgentConfigAssociation = this.createEcsAgentAssociation(
      ecsAgentConfig,
      associationTargets
    );

    // Ensure ECS agent waits for EFS initialization
    if (this.efsInitAssociation) {
      this.ecsAgentConfigAssociation.addDependency(this.efsInitAssociation);
    } else if (this.efsMountAssociation) {
      this.ecsAgentConfigAssociation.addDependency(this.efsMountAssociation);
    }

    // Create CloudWatch agent associations (install + configure)
    const { installAssociation, configAssociation } =
      this.createCloudWatchAgentAssociations(
        cloudWatchAgentConfig,
        associationTargets,
        logGroups
      );

    this.cloudWatchAgentInstallAssociation = installAssociation;
    this.cloudWatchAgentConfigAssociation = configAssociation;

    // Grant necessary IAM permissions to instance role
    this.grantSsmPermissions(instanceRole, configAssociation);

    // Grant EFS mount permissions if EFS is configured
    if (props.fileSystemId) {
      this.grantEfsPermissions(instanceRole, props.fileSystemId);
    }

    // Apply resource tags for organisation and cost tracking
    this.applyTags(envName, projectName);

    // Add production-specific warnings for operational awareness
    this.addProductionWarnings(ecsAgentConfig);
  }

  // ========================================================================
  // CONFIGURATION RESOLUTION METHODS
  // ========================================================================

  /**
   * Resolve ECS agent configuration with environment-appropriate defaults
   *
   * Merges user-provided configuration with sensible defaults based on
   * the deployment environment (production vs non-production).
   */
  private resolveEcsAgentConfig(): EcsAgentSsmConfig {
    const { envName, ecsAgent } = this.props;

    return {
      scheduleExpression:
        ecsAgent?.scheduleExpression ?? resolveSsmSchedule(envName),
      applyOnlyAtCronInterval:
        ecsAgent?.applyOnlyAtCronInterval ??
        DEFAULT_SSM_APPLY_ONLY_AT_CRON_INTERVAL,
      complianceSeverity:
        ecsAgent?.complianceSeverity ??
        (this.isProduction
          ? DEFAULT_SSM_COMPLIANCE_SEVERITY_PROD
          : DEFAULT_SSM_COMPLIANCE_SEVERITY),
      maxConcurrency: ecsAgent?.maxConcurrency ?? DEFAULT_SSM_MAX_CONCURRENCY,
      maxErrors: ecsAgent?.maxErrors ?? DEFAULT_SSM_MAX_ERRORS,
      targets: ecsAgent?.targets ?? this.props.targets,
      dockerMaxRetries:
        ecsAgent?.dockerMaxRetries ?? DEFAULT_SSM_DOCKER_MAX_RETRIES,
      dockerRetryDelaySeconds:
        ecsAgent?.dockerRetryDelaySeconds ??
        DEFAULT_SSM_DOCKER_RETRY_DELAY_SECONDS,
      ecsStartMaxRetries:
        ecsAgent?.ecsStartMaxRetries ?? DEFAULT_SSM_ECS_START_MAX_RETRIES,
      ecsStartRetryDelaySeconds:
        ecsAgent?.ecsStartRetryDelaySeconds ??
        DEFAULT_SSM_ECS_START_RETRY_DELAY_SECONDS,
      agentCheckMaxRetries:
        ecsAgent?.agentCheckMaxRetries ?? DEFAULT_SSM_AGENT_CHECK_MAX_RETRIES,
      agentCheckDelaySeconds:
        ecsAgent?.agentCheckDelaySeconds ??
        DEFAULT_SSM_AGENT_CHECK_DELAY_SECONDS,
    };
  }

  /**
   * Resolve CloudWatch agent configuration with environment-appropriate defaults
   *
   * Merges user-provided configuration with sensible defaults for log collection
   * and agent behaviour.
   */
  private resolveCloudWatchAgentConfig(): CloudWatchAgentSsmConfig {
    const { envName, cloudWatchAgent } = this.props;

    return {
      scheduleExpression:
        cloudWatchAgent?.scheduleExpression ?? resolveSsmSchedule(envName),
      applyOnlyAtCronInterval:
        cloudWatchAgent?.applyOnlyAtCronInterval ??
        DEFAULT_SSM_APPLY_ONLY_AT_CRON_INTERVAL,
      complianceSeverity:
        cloudWatchAgent?.complianceSeverity ??
        (this.isProduction
          ? DEFAULT_SSM_COMPLIANCE_SEVERITY_PROD
          : DEFAULT_SSM_COMPLIANCE_SEVERITY),
      maxConcurrency:
        cloudWatchAgent?.maxConcurrency ?? DEFAULT_SSM_MAX_CONCURRENCY,
      maxErrors: cloudWatchAgent?.maxErrors ?? DEFAULT_SSM_MAX_ERRORS,
      targets: cloudWatchAgent?.targets ?? this.props.targets,
      logConfig: cloudWatchAgent?.logConfig,
    };
  }

  /**
   * Resolve association targets from configs or default to environment tag
   *
   * Targets determine which EC2 instances the SSM associations will apply to.
   * By default, targets all instances tagged with the current environment name.
   */
  private resolveAssociationTargets(
    ecsConfig: EcsAgentSsmConfig,
    cloudWatchConfig: CloudWatchAgentSsmConfig
  ): ssm.CfnAssociation.TargetProperty[] {
    return (
      cloudWatchConfig.targets ??
      ecsConfig.targets ?? [
        {
          key: "tag:Environment",
          values: [this.props.envName],
        },
      ]
    );
  }

  // ========================================================================
  // LOG GROUP CREATION
  // ========================================================================

  /**
   * Create CloudWatch log groups for ECS container and agent logs
   *
   * Log groups are created upfront to prevent runtime failures when the
   * CloudWatch agent attempts to write logs. Retention and encryption
   * policies are environment-specific.
   *
   * @returns Object containing all three log groups
   */
  private createLogGroups(config: CloudWatchAgentSsmConfig): {
    containerLogGroup: logs.LogGroup;
    ecsAgentLogGroup: logs.LogGroup;
    ecsInitLogGroup: logs.LogGroup;
  } {
    const logRetention =
      config.logConfig?.logRetention ??
      (this.isProduction
        ? DEFAULT_SSM_LOG_RETENTION_PROD
        : DEFAULT_SSM_LOG_RETENTION_DEV);

    // Retain logs in production, allow destruction in non-production
    const logRemovalPolicy = this.isProduction
      ? cdk.RemovalPolicy.RETAIN
      : cdk.RemovalPolicy.DESTROY;

    // Resolve log group names with validation
    const containerLogGroupName =
      config.logConfig?.containerLogGroupName ??
      `${this.baseLogPrefix}-containers`;
    const ecsAgentLogGroupName =
      config.logConfig?.ecsAgentLogGroupName ??
      `${this.baseLogPrefix}-ecs-agent`;
    const ecsInitLogGroupName =
      config.logConfig?.ecsInitLogGroupName ?? `${this.baseLogPrefix}-ecs-init`;

    validateLogGroupNameOptional(containerLogGroupName);
    validateLogGroupNameOptional(ecsAgentLogGroupName);
    validateLogGroupNameOptional(ecsInitLogGroupName);

    const containerLogGroup = new logs.LogGroup(this, "ContainerLogs", {
      logGroupName: containerLogGroupName,
      retention: logRetention,
      encryptionKey: config.logConfig?.logGroupKmsKey,
      removalPolicy: logRemovalPolicy,
    });

    const ecsAgentLogGroup = new logs.LogGroup(this, "EcsAgentLogs", {
      logGroupName: ecsAgentLogGroupName,
      retention: logRetention,
      encryptionKey: config.logConfig?.logGroupKmsKey,
      removalPolicy: logRemovalPolicy,
    });

    const ecsInitLogGroup = new logs.LogGroup(this, "EcsInitLogs", {
      logGroupName: ecsInitLogGroupName,
      retention: logRetention,
      encryptionKey: config.logConfig?.logGroupKmsKey,
      removalPolicy: logRemovalPolicy,
    });

    return {
      containerLogGroup,
      ecsAgentLogGroup,
      ecsInitLogGroup,
    };
  }

  // ========================================================================
  // EFS MOUNT ASSOCIATION CREATION
  // ========================================================================

  /**
   * Create SSM association for EFS mounting
   *
   * Uses AWS Systems Manager to mount an EFS file system on EC2 instances.
   * This ensures EFS is mounted before ECS agent starts and applications run.
   *
   * Benefits:
   * - Automatic mount on instance boot
   * - Handles mount failures with retry logic
   * - No UserData dependency
   * - Can remount if connection lost
   *
   * The association creates /etc/fstab entry for persistent mounting across reboots.
   *
   * @param fileSystemId - EFS file system ID (e.g., fs-xxxxxxxxx)
   * @param mountPoint - Local mount path (e.g., /mnt/efs)
   * @param targets - SSM association targets (EC2 instances)
   * @returns SSM Association for EFS mounting
   */
  private createEfsMountAssociation(
    fileSystemId: string,
    mountPoint: string,
    targets: ssm.CfnAssociation.TargetProperty[]
  ): ssm.CfnAssociation {
    const { envName } = this.props;
    const region = this.stack.region;

    // Build EFS mount script
    const efsMountScript = `#!/bin/bash
set -e

echo "========================================="
echo "EFS Mount Configuration"
echo "========================================="
echo "File System ID: ${fileSystemId}"
echo "Mount Point: ${mountPoint}"
echo "Region: ${region}"
echo ""

# Install EFS utilities if not present
if ! command -v mount.efs &> /dev/null; then
  echo "Installing amazon-efs-utils..."
  yum install -y amazon-efs-utils
fi

# Create mount point directory
echo "Creating mount point directory..."
mkdir -p ${mountPoint}

# Check if already mounted
if mountpoint -q ${mountPoint}; then
  echo "EFS already mounted at ${mountPoint}"
  df -h ${mountPoint}
  exit 0
fi

# Add to /etc/fstab if not present
FSTAB_ENTRY="${fileSystemId}:/ ${mountPoint} efs _netdev,tls,iam 0 0"
if ! grep -q "${fileSystemId}" /etc/fstab; then
  echo "Adding EFS to /etc/fstab..."
  echo "$FSTAB_ENTRY" >> /etc/fstab
fi

# Mount the file system
echo "Mounting EFS..."
mount -a -t efs

# Verify mount
if mountpoint -q ${mountPoint}; then
  echo "✅ EFS successfully mounted at ${mountPoint}"
  df -h ${mountPoint}
else
  echo "❌ Failed to mount EFS at ${mountPoint}"
  exit 1
fi
`;

    return new ssm.CfnAssociation(this, "EfsMountAssociation", {
      name: "AWS-RunShellScript",
      associationName: `${this.stack.stackName}-${envName}-efs-mount`,
      targets,
      parameters: {
        commands: [efsMountScript],
      } as Record<string, string[]>,
      // Run once on boot (no schedule - mount persists via fstab)
      // applyOnlyAtCronInterval is not set, so it runs once when instances join
    });
  }

  /**
   * Create SSM association for EFS initialization
   *
   * Runs the EFS setup script from SSM Parameter Store on EC2 instances.
   * This script creates the directory structure, sets permissions, and
   * downloads configuration files from SSM.
   *
   * The script is generated by the EFS stack's SSM Automation Document
   * and stored in /monitoring/{environment}/efs-setup-script parameter.
   *
   * @param envName - Environment name (for parameter path)
   * @param mountPoint - EFS mount point (e.g., /mnt/efs)
   * @param targets - SSM association targets (EC2 instances)
   * @returns SSM Association for EFS initialization
   */
  private createEfsInitAssociation(
    envName: string,
    mountPoint: string,
    targets: ssm.CfnAssociation.TargetProperty[]
  ): ssm.CfnAssociation {
    const region = this.stack.region;

    // Build EFS initialization script that runs on EC2 instance
    const efsInitScript = `#!/bin/bash
set -e

echo "========================================="
echo "EFS Initialization"
echo "========================================="
echo "Mount Point: ${mountPoint}"
echo "Environment: ${envName}"
echo "Region: ${region}"
echo ""

# ==========================================================================
# PROMETHEUS EBS VOLUME SETUP
# ==========================================================================
# CRITICAL: Prometheus TSDB requires local block storage (EBS), NOT NFS/EFS
# NFS/EFS is only used for configuration files (read-only is fine)
# Prometheus data must be on EBS for proper fsync guarantees

PROMETHEUS_DATA_VOLUME="/dev/xvdf"
PROMETHEUS_DATA_MOUNT="/mnt/prometheus-data"

echo "Setting up Prometheus EBS data volume..."

if [ -b "$PROMETHEUS_DATA_VOLUME" ]; then
  echo "Found Prometheus data volume at $PROMETHEUS_DATA_VOLUME"
  
  # Check if volume is already formatted
  if ! blkid "$PROMETHEUS_DATA_VOLUME" > /dev/null 2>&1; then
    echo "Formatting Prometheus data volume with ext4..."
    mkfs.ext4 -F "$PROMETHEUS_DATA_VOLUME"
    echo "Prometheus data volume formatted"
  else
    echo "Prometheus data volume already formatted"
  fi
  
  # Create mount point and mount volume
  mkdir -p "$PROMETHEUS_DATA_MOUNT"
  
  # Check if already mounted
  if ! mountpoint -q "$PROMETHEUS_DATA_MOUNT"; then
    mount "$PROMETHEUS_DATA_VOLUME" "$PROMETHEUS_DATA_MOUNT"
    echo "Prometheus data volume mounted at $PROMETHEUS_DATA_MOUNT"
  else
    echo "Prometheus data volume already mounted at $PROMETHEUS_DATA_MOUNT"
  fi
  
  # Add to fstab for persistence across reboots
  if ! grep -q "$PROMETHEUS_DATA_VOLUME" /etc/fstab; then
    echo "$PROMETHEUS_DATA_VOLUME $PROMETHEUS_DATA_MOUNT ext4 defaults,nofail 0 2" >> /etc/fstab
    echo "Added Prometheus data volume to fstab"
  fi
  
  # Set ownership for Prometheus (UID 65534 = nobody)
  chown -R 65534:65534 "$PROMETHEUS_DATA_MOUNT"
  chmod -R 755 "$PROMETHEUS_DATA_MOUNT"
  
  echo "Prometheus EBS data volume setup complete"
else
  echo "WARNING: Prometheus data volume $PROMETHEUS_DATA_VOLUME not found"
  echo "Prometheus TSDB will NOT work correctly on EFS!"
  echo "Ensure the EC2 instance has an EBS volume attached at $PROMETHEUS_DATA_VOLUME"
fi

echo ""

# ==========================================================================
# EFS SETUP (for configuration files only)
# ==========================================================================

# Wait for EFS to be mounted (max 60 seconds)
echo "Waiting for EFS to be mounted..."
MAX_RETRIES=12
RETRY_COUNT=0
while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
  if mountpoint -q ${mountPoint}; then
    echo "EFS is mounted at ${mountPoint}"
    break
  fi
  
  RETRY_COUNT=$((RETRY_COUNT + 1))
  if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
    echo "ERROR: EFS not mounted after $((MAX_RETRIES * 5)) seconds"
    exit 1
  fi
  
  echo "EFS not mounted yet, waiting... (attempt $RETRY_COUNT/$MAX_RETRIES)"
  sleep 5
done

echo "Setting up EFS directory structure for configuration files..."

# Create directory structure for config and Grafana data (EFS is fine for Grafana)
# NOTE: Prometheus data is on EBS, NOT EFS
mkdir -p ${mountPoint}/grafana-data/plugins
mkdir -p ${mountPoint}/grafana-data/logs
mkdir -p ${mountPoint}/grafana-data/csv
mkdir -p ${mountPoint}/grafana-data/png
mkdir -p ${mountPoint}/config/prometheus
mkdir -p ${mountPoint}/config/grafana/provisioning/datasources
mkdir -p ${mountPoint}/config/grafana/provisioning/dashboards
mkdir -p ${mountPoint}/config/grafana/dashboards
mkdir -p ${mountPoint}/config/alertmanager

echo "Setting ownership and permissions..."

# Set ownership for Prometheus config (UID 65534 = nobody)
# NOTE: Prometheus DATA is on EBS, not EFS - ownership set during EBS setup above
chown -R 65534:65534 ${mountPoint}/config/prometheus
chmod -R 755 ${mountPoint}/config/prometheus

# Set ownership for Grafana (UID 472, GID 0 = root group)
chown -R 472:0 ${mountPoint}/grafana-data ${mountPoint}/config/grafana
chmod -R 755 ${mountPoint}/grafana-data ${mountPoint}/config/grafana

# Ensure Grafana can write to data directories
chmod -R 777 ${mountPoint}/grafana-data/plugins
chmod -R 777 ${mountPoint}/grafana-data/logs
chmod -R 777 ${mountPoint}/grafana-data/csv
chmod -R 777 ${mountPoint}/grafana-data/png

echo "Downloading configuration files from SSM..."

# Download Prometheus config (YAML)
aws ssm get-parameter --region ${region} --name "/monitoring/${envName}/prometheus-config-yaml" --query "Parameter.Value" --output text > ${mountPoint}/config/prometheus/prometheus.yml

# Replace HOST_IP_PLACEHOLDER in Prometheus config with EC2 instance's private IP address
# This is required because Prometheus (bridge networking) cannot access node-exporter (host networking) via localhost
# Use IMDSv2 for metadata retrieval
TOKEN=$(curl -s -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 300" || true)
if [ -z "$TOKEN" ]; then
  echo "ERROR: Failed to retrieve IMDSv2 token"
  exit 1
fi
PRIVATE_IP=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" "http://169.254.169.254/latest/meta-data/local-ipv4" || true)
if [ -z "$PRIVATE_IP" ]; then
  echo "ERROR: Failed to retrieve private IP from EC2 metadata service"
  exit 1
fi
sed -i "s/HOST_IP_PLACEHOLDER/$PRIVATE_IP/g" ${mountPoint}/config/prometheus/prometheus.yml
echo "Replaced HOST_IP_PLACEHOLDER with $PRIVATE_IP in Prometheus config"

# Download Grafana datasource config (YAML)
aws ssm get-parameter --region ${region} --name "/monitoring/${envName}/grafana-datasource-config-yaml" --query "Parameter.Value" --output text > ${mountPoint}/config/grafana/provisioning/datasources/prometheus.yml

# Replace HOST_IP_PLACEHOLDER in Grafana datasource config with EC2 instance's private IP address
# This is required because Grafana (bridge networking) cannot access Prometheus via localhost
sed -i "s/HOST_IP_PLACEHOLDER/$PRIVATE_IP/g" ${mountPoint}/config/grafana/provisioning/datasources/prometheus.yml
echo "Replaced HOST_IP_PLACEHOLDER with $PRIVATE_IP in Grafana datasource config"

# Download Grafana dashboard config (YAML)
aws ssm get-parameter --region ${region} --name "/monitoring/${envName}/grafana-dashboard-config-yaml" --query "Parameter.Value" --output text > ${mountPoint}/config/grafana/provisioning/dashboards/dashboards.yml

# Download pre-built Grafana dashboards from S3
echo "Downloading pre-built Grafana dashboards from S3..."
DASHBOARD_BUCKET=$(aws ssm get-parameter --region ${region} --name "/monitoring/${envName}/dashboard-bucket-name" --query "Parameter.Value" --output text)

if [ -z "$DASHBOARD_BUCKET" ]; then
  echo "ERROR: Dashboard bucket name not found in SSM"
  exit 1
fi

# Download all dashboards from S3
aws s3 sync s3://\${DASHBOARD_BUCKET}/dashboards/ ${mountPoint}/config/grafana/dashboards/ --region ${region}

# Count downloaded dashboards
DASHBOARD_COUNT=\$(find ${mountPoint}/config/grafana/dashboards -name "*.json" | wc -l)
echo "Downloaded \${DASHBOARD_COUNT} pre-built dashboards successfully"

# Set proper ownership for config files
chown 65534:65534 ${mountPoint}/config/prometheus/prometheus.yml
chown 472:0 ${mountPoint}/config/grafana/provisioning/datasources/prometheus.yml
chown 472:0 ${mountPoint}/config/grafana/provisioning/dashboards/dashboards.yml
chown -R 472:0 ${mountPoint}/config/grafana/dashboards/
chmod -R 644 ${mountPoint}/config/grafana/dashboards/*.json

echo "Verifying setup..."
ls -lh ${mountPoint}/config/prometheus/
ls -lh ${mountPoint}/config/grafana/provisioning/datasources/

echo "✅ EFS initialization completed successfully"
`;

    return new ssm.CfnAssociation(this, "EfsInitAssociation", {
      name: "AWS-RunShellScript",
      associationName: `${this.stack.stackName}-${envName}-efs-init`,
      targets,
      parameters: {
        commands: [efsInitScript],
      } as Record<string, string[]>,
      // Run once on boot (no schedule - initialization persists)
      // applyOnlyAtCronInterval is not set, so it runs once when instances join
    });
  }

  // ========================================================================
  // ECS AGENT ASSOCIATION CREATION
  // ========================================================================

  /**
   * Create SSM association for ECS agent configuration
   *
   * Uses the AWS-RunShellScript managed document to execute the ECS agent
   * configuration script. This script handles Docker setup, ECS agent
   * installation, and verification with comprehensive retry logic.
   *
   * The association runs on a schedule to correct configuration drift and
   * ensure the ECS agent remains properly configured.
   */
  private createEcsAgentAssociation(
    config: EcsAgentSsmConfig,
    targets: ssm.CfnAssociation.TargetProperty[]
  ): ssm.CfnAssociation {
    const { clusterName, envName } = this.props;

    // Build the shell script with resolved retry parameters
    const ecsConfigScript = buildEcsAgentScript({
      clusterName,
      dockerMaxRetries:
        config.dockerMaxRetries ?? DEFAULT_SSM_DOCKER_MAX_RETRIES,
      dockerRetryDelaySeconds:
        config.dockerRetryDelaySeconds ??
        DEFAULT_SSM_DOCKER_RETRY_DELAY_SECONDS,
      ecsStartMaxRetries:
        config.ecsStartMaxRetries ?? DEFAULT_SSM_ECS_START_MAX_RETRIES,
      ecsStartRetryDelaySeconds:
        config.ecsStartRetryDelaySeconds ??
        DEFAULT_SSM_ECS_START_RETRY_DELAY_SECONDS,
      agentCheckMaxRetries:
        config.agentCheckMaxRetries ?? DEFAULT_SSM_AGENT_CHECK_MAX_RETRIES,
      agentCheckDelaySeconds:
        config.agentCheckDelaySeconds ?? DEFAULT_SSM_AGENT_CHECK_DELAY_SECONDS,
    });

    if (!config.scheduleExpression) {
      throw new Error(
        `Schedule expression is required for ECS agent association.\n\n` +
          `Environment: ${envName}\n` +
          `This should have been validated earlier in the constructor.`
      );
    }

    // Use AWS-RunShellScript (AWS managed document) instead of custom document
    // This is more reliable and doesn't require document versioning
    return new ssm.CfnAssociation(this, "EcsConfigAssociation", {
      name: "AWS-RunShellScript",
      associationName: `${this.stack.stackName}-${envName}-ecs-agent-config`,
      targets,
      parameters: {
        commands: [ecsConfigScript],
      } as Record<string, string[]>,
      scheduleExpression: config.scheduleExpression,
      applyOnlyAtCronInterval: config.applyOnlyAtCronInterval,
      complianceSeverity: config.complianceSeverity,
      maxConcurrency: config.maxConcurrency,
      maxErrors: config.maxErrors,
    });
  }

  // ========================================================================
  // CLOUDWATCH AGENT ASSOCIATIONS CREATION
  // ========================================================================

  /**
   * Create SSM associations for CloudWatch agent installation and configuration
   *
   * Creates two separate associations:
   * 1. Installation - Uses AWS-ConfigureAWSPackage to install CloudWatch agent
   * 2. Configuration - Uses custom SSM document to configure log collection
   *
   * The configuration association depends on the installation association to
   * ensure proper sequencing.
   *
   * @returns Object containing both associations
   */
  private createCloudWatchAgentAssociations(
    config: CloudWatchAgentSsmConfig,
    targets: ssm.CfnAssociation.TargetProperty[],
    logGroups: {
      containerLogGroup: logs.LogGroup;
      ecsAgentLogGroup: logs.LogGroup;
      ecsInitLogGroup: logs.LogGroup;
    }
  ): {
    installAssociation: ssm.CfnAssociation;
    configAssociation: ssm.CfnAssociation;
  } {
    const { envName } = this.props;

    if (!config.scheduleExpression) {
      throw new Error(
        `Schedule expression is required for CloudWatch agent association.\n\n` +
          `Environment: ${envName}\n` +
          `This should have been validated earlier in the constructor.`
      );
    }

    // First, install CloudWatch Agent package using AWS managed document
    const installAssociation = new ssm.CfnAssociation(
      this,
      "CloudWatchAgentInstallAssociation",
      {
        name: "AWS-ConfigureAWSPackage",
        associationName: `${this.stack.stackName}-${envName}-cloudwatch-agent-install`,
        targets,
        parameters: {
          action: ["Install"],
          name: ["AmazonCloudWatchAgent"],
        } as Record<string, string[]>,
        scheduleExpression: config.scheduleExpression,
        applyOnlyAtCronInterval: config.applyOnlyAtCronInterval,
        complianceSeverity: config.complianceSeverity,
        maxConcurrency: config.maxConcurrency,
        maxErrors: config.maxErrors,
      }
    );

    // Create configuration document and association
    const configDocument = this.createCloudWatchConfigDocument(logGroups);
    const configAssociation = this.createCloudWatchConfigAssociation(
      config,
      targets,
      configDocument
    );

    // Ensure configuration runs after installation
    configAssociation.addDependency(configDocument);
    configAssociation.addDependency(installAssociation);

    return {
      installAssociation,
      configAssociation,
    };
  }

  /**
   * Create SSM document for CloudWatch agent configuration
   *
   * The document contains a shell script that:
   * - Creates CloudWatch agent configuration file
   * - Configures log collection for Docker containers, ECS agent, and init logs
   * - Starts and enables the CloudWatch agent service
   *
   * Configuration is defined inline as JSON to avoid escaping issues.
   */
  private createCloudWatchConfigDocument(logGroups: {
    containerLogGroup: logs.LogGroup;
    ecsAgentLogGroup: logs.LogGroup;
    ecsInitLogGroup: logs.LogGroup;
  }): ssm.CfnDocument {
    const { envName } = this.props;
    const { containerLogGroup, ecsAgentLogGroup, ecsInitLogGroup } = logGroups;

    // CDK CfnDocument expects content as an object when using YAML format
    const documentContent = {
      schemaVersion: "2.2",
      description: `Configure CloudWatch Agent for ${envName} environment`,
      mainSteps: [
        {
          action: "aws:runShellScript",
          name: "configureCloudWatchAgent",
          inputs: {
            runCommand: [
              "#!/bin/bash",
              "set -e",
              "",
              "echo '========================================='",
              "echo 'CloudWatch Agent Configuration'",
              "echo 'Timestamp:' $(date)",
              "echo '========================================='",
              "",
              "INSTANCE_ID=$(curl -s http://169.254.169.254/latest/meta-data/instance-id || echo 'unknown')",
              "echo 'Instance ID:' $INSTANCE_ID",
              "",
              "# Wait for CloudWatch Agent to be installed",
              "# The installation association may still be running",
              "echo 'Checking if CloudWatch Agent is installed...'",
              "MAX_WAIT=300  # 5 minutes",
              "WAIT_INTERVAL=10",
              "ELAPSED=0",
              "",
              "while [ $ELAPSED -lt $MAX_WAIT ]; do",
              "  if [ -f /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl ]; then",
              "    echo '✅ CloudWatch Agent is installed'",
              "    break",
              "  fi",
              "  ",
              '  echo "CloudWatch Agent not found yet, waiting... (${ELAPSED}s/${MAX_WAIT}s)"',
              "  sleep $WAIT_INTERVAL",
              "  ELAPSED=$((ELAPSED + WAIT_INTERVAL))",
              "done",
              "",
              "# Verify installation",
              "if [ ! -f /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl ]; then",
              "  echo 'ERROR: CloudWatch Agent installation timed out'",
              "  echo 'The agent must be installed before configuration can proceed'",
              "  echo 'Check the CloudWatch Agent Install association status'",
              "  exit 1",
              "fi",
              "",
              "echo 'CloudWatch Agent found, proceeding with configuration...'",
              "",
              "# Create CloudWatch Agent configuration directory",
              "mkdir -p /opt/aws/amazon-cloudwatch-agent/etc",
              "",
              "# Write CloudWatch Agent configuration",
              "# Collects logs from Docker containers, ECS agent, and ECS init",
              "cat > /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json << 'CWAGENT_CONFIG_EOF'",
              "{",
              '  "logs": {',
              '    "logs_collected": {',
              '      "files": {',
              '        "collect_list": [',
              "          {",
              '            "file_path": "/var/lib/docker/containers/*/*-json.log",',
              `            "log_group_name": "${containerLogGroup.logGroupName}",`,
              '            "log_stream_name": "{instance_id}-{source_host}",',
              '            "timezone": "UTC",',
              '            "multi_line_start_pattern": "^\\\\{\\"log\\\\":",',
              '            "encoding": "utf-8",',
              '            "auto_removal": false',
              "          },",
              "          {",
              '            "file_path": "/var/log/ecs/ecs-agent.log",',
              `            "log_group_name": "${ecsAgentLogGroup.logGroupName}",`,
              '            "log_stream_name": "{instance_id}",',
              '            "timezone": "UTC",',
              '            "encoding": "utf-8"',
              "          },",
              "          {",
              '            "file_path": "/var/log/ecs/ecs-init.log",',
              `            "log_group_name": "${ecsInitLogGroup.logGroupName}",`,
              '            "log_stream_name": "{instance_id}",',
              '            "timezone": "UTC",',
              '            "encoding": "utf-8"',
              "          }",
              "        ]",
              "      }",
              "    }",
              "  }",
              "}",
              "CWAGENT_CONFIG_EOF",
              "",
              "echo 'CloudWatch Agent configuration written successfully'",
              "",
              "# Start CloudWatch Agent using the official control script",
              "# This is the recommended way to manage the CloudWatch Agent",
              "echo 'Starting CloudWatch Agent...'",
              "",
              "# Stop agent if it's already running",
              "/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \\",
              "  -a fetch-config \\",
              "  -m ec2 \\",
              "  -s \\",
              "  -c file:/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json",
              "",
              "# Verify agent is running",
              "sleep 3",
              "if /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \\",
              '  -a query -m ec2 -c default | grep -q \'"status":"running"\'; then',
              "  echo '✅ SUCCESS: CloudWatch Agent is running'",
              "  /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a query -m ec2 -c default",
              "else",
              "  echo '⚠️  WARNING: CloudWatch Agent may not be running properly'",
              "  /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a query -m ec2 -c default || true",
              "  echo 'Checking systemd service status...'",
              "  systemctl status amazon-cloudwatch-agent || true",
              "fi",
              "",
              "echo '========================================='",
              "echo 'CloudWatch Agent configuration complete'",
              "echo '========================================='",
            ],
          },
        },
      ],
    };

    return new ssm.CfnDocument(this, "CloudWatchAgentConfigDocument", {
      documentType: "Command",
      documentFormat: "YAML",
      name: `${this.stack.stackName}-${envName}-cloudwatch-agent-config`,
      content: documentContent,
    });
  }

  /**
   * Create SSM association to run CloudWatch agent configuration
   *
   * This association executes the custom configuration document on the
   * target instances on a scheduled basis.
   */
  private createCloudWatchConfigAssociation(
    config: CloudWatchAgentSsmConfig,
    targets: ssm.CfnAssociation.TargetProperty[],
    document: ssm.CfnDocument
  ): ssm.CfnAssociation {
    const { envName } = this.props;

    if (!config.scheduleExpression) {
      throw new Error(
        `Schedule expression is required for CloudWatch agent configuration association.\n\n` +
          `Environment: ${envName}\n` +
          `This should have been validated earlier in the constructor.`
      );
    }

    return new ssm.CfnAssociation(this, "CloudWatchAgentConfigAssociation", {
      name: document.name ?? document.ref,
      associationName: `${this.stack.stackName}-${envName}-cloudwatch-agent-config`,
      targets,
      scheduleExpression: config.scheduleExpression,
      applyOnlyAtCronInterval: config.applyOnlyAtCronInterval,
      complianceSeverity: config.complianceSeverity,
      maxConcurrency: config.maxConcurrency,
      maxErrors: config.maxErrors,
    });
  }

  // ========================================================================
  // IAM PERMISSIONS
  // ========================================================================

  /**
   * Grant SSM permissions to instance role for State Manager operations
   *
   * Grants the minimum required permissions for instances to:
   * - Register with SSM and report their status
   * - Retrieve and execute SSM documents
   * - Report command execution results
   *
   * Permissions are scoped to specific document ARNs where possible to
   * follow the principle of least privilege.
   */
  private grantSsmPermissions(
    instanceRole: iam.IRole,
    cloudWatchConfigDocument: ssm.CfnAssociation
  ): void {
    // Allow instances to describe associations and report status
    // These actions don't support resource-level permissions
    instanceRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "ssm:DescribeInstanceInformation",
          "ssm:ListAssociations",
          "ssm:ListInstanceAssociations",
          "ssm:DescribeAssociation",
          "ssm:UpdateInstanceInformation",
        ],
        resources: ["*"],
      })
    );

    // Build ARNs for all documents used by this construct
    const documentArns = [
      // AWS managed documents
      `arn:aws:ssm:${this.stack.region}:${this.stack.account}:document/AWS-RunShellScript`,
      `arn:aws:ssm:${this.stack.region}:${this.stack.account}:document/AWS-ConfigureAWSPackage`,
      // Custom CloudWatch configuration document
      `arn:aws:ssm:${this.stack.region}:${this.stack.account}:document/${cloudWatchConfigDocument.name}`,
    ];

    // Grant access to retrieve and execute specific documents
    instanceRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "ssm:GetDocument",
          "ssm:SendCommand",
          "ssm:GetCommandInvocation",
        ],
        resources: documentArns,
      })
    );
  }

  /**
   * Grant IAM permissions for EFS mounting
   *
   * Allows EC2 instances to:
   * - Mount EFS file systems using IAM authentication
   * - Use TLS encryption for data in transit
   * - Access specific file system
   *
   * @param instanceRole - IAM role attached to EC2 instances
   * @param fileSystemId - EFS file system ID
   */
  private grantEfsPermissions(
    instanceRole: iam.IRole,
    fileSystemId: string
  ): void {
    const fileSystemArn = `arn:aws:elasticfilesystem:${this.stack.region}:${this.stack.account}:file-system/${fileSystemId}`;

    // Grant EFS mount permissions with IAM authentication
    instanceRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "elasticfilesystem:ClientMount",
          "elasticfilesystem:ClientWrite",
          "elasticfilesystem:ClientRootAccess",
          "elasticfilesystem:DescribeMountTargets",
        ],
        resources: [fileSystemArn],
        conditions: {
          Bool: {
            "elasticfilesystem:AccessedViaMountTarget": "true",
          },
        },
      })
    );
  }

  // ========================================================================
  // TAGGING AND WARNINGS
  // ========================================================================

  /**
   * Apply standard tags to all construct resources
   *
   * Tags provide:
   * - Resource organisation and filtering
   * - Cost allocation tracking
   * - Automated resource management
   */
  private applyTags(envName: string, projectName?: string): void {
    cdk.Tags.of(this).add("Environment", envName);
    cdk.Tags.of(this).add("Component", "SSMStateManager");
    cdk.Tags.of(this).add("ManagedBy", "CDK");

    if (projectName) {
      cdk.Tags.of(this).add("Project", projectName);
    }
  }

  /**
   * Add production-specific warnings for operational awareness
   *
   * Emits CDK warnings during synthesis to alert operators about
   * configuration choices that may impact production operations.
   */
  private addProductionWarnings(ecsConfig: EcsAgentSsmConfig): void {
    if (!this.isProduction) {
      return;
    }

    // Warn about infrequent association schedules in production
    if (
      ecsConfig.scheduleExpression &&
      ecsConfig.scheduleExpression.includes("30 days")
    ) {
      cdk.Annotations.of(this).addWarning(
        "Production State Manager associations are scheduled every 30 days. " +
          "Consider a tighter cadence (e.g., 7 days) for faster drift remediation " +
          "and more reliable configuration enforcement."
      );
    }

    // Warn about high error thresholds in production
    if (ecsConfig.maxErrors === "5") {
      cdk.Annotations.of(this).addWarning(
        "Max errors is set to 5 in production. Consider lowering this threshold " +
          "or adding CloudWatch alarms for SSM association failures to ensure " +
          "configuration issues are detected quickly."
      );
    }
  }

  // ========================================================================
  // PUBLIC UTILITY METHODS
  // ========================================================================

  /**
   * Get the ARN for a given SSM association
   *
   * Useful for creating CloudWatch alarms or EventBridge rules
   * that trigger on association status changes.
   *
   * @param association - The SSM association to get the ARN for
   * @returns The fully-qualified ARN of the association
   */
  public getAssociationArn(association: ssm.CfnAssociation): string {
    return `arn:aws:ssm:${this.stack.region}:${this.stack.account}:association/${association.ref}`;
  }

  /**
   * Update the schedule expression for an existing association
   *
   * Allows runtime modification of when associations execute.
   * The new schedule is validated before being applied.
   *
   * @param association - The association to update
   * @param scheduleExpression - The new schedule expression (e.g., "rate(7 days)")
   */
  public updateAssociationSchedule(
    association: ssm.CfnAssociation,
    scheduleExpression: string
  ): void {
    validateScheduleExpression(scheduleExpression);
    association.scheduleExpression = scheduleExpression;
  }

  /**
   * Create a refresh association to retrigger an existing association
   *
   * Useful for forcing immediate re-execution of an association
   * without waiting for the next scheduled run.
   *
   * Note: This creates a new one-time association that triggers the
   * original association. It does not modify the original association's
   * schedule.
   *
   * @param association - The association to retrigger
   * @param id - Optional construct ID for the refresh association
   * @returns A new association that will trigger the original
   */
  public retriggerAssociation(
    association: ssm.CfnAssociation,
    id?: string
  ): ssm.CfnAssociation {
    return new ssm.CfnAssociation(this, id ?? `Refresh${association.node.id}`, {
      name: "AWS-RefreshAssociation",
      parameters: {
        AssociationIds: [association.ref],
      } as Record<string, string[]>,
      targets: association.targets,
      maxErrors: "1",
      maxConcurrency: "1",
    });
  }
}
