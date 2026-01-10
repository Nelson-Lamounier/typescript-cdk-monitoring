/** @format */

/**
 * EFS Configuration Initialization Lambda
 *
 * This Lambda function prepares EFS configuration for monitoring services:
 * 1. Reads JSON configs from SSM (created by MonitoringEfsStack)
 * 2. Converts to YAML format for Prometheus/Grafana
 * 3. Creates setup script for EC2 instances
 * 4. Stores everything in SSM for consumption
 *
 * Architecture:
 * - Runs OUTSIDE VPC (no VPC dependencies)
 * - CloudFormation Custom Resource (lifecycle management)
 * - Stateless (idempotent operations)
 *
 * Actual EFS mounting and directory creation happens on EC2 instances
 * via SSM State Manager (ApplicationSetupSsmAssociationConstruct)
 */

import * as https from "https";
import * as url from "url";

import * as yaml from "yaml";
import {
  CloudFormationCustomResourceEvent,
  CloudFormationCustomResourceResponse,
  Context,
} from "aws-lambda";
import {
  SSMClient,
  GetParameterCommand,
  PutParameterCommand,
  ParameterNotFound,
} from "@aws-sdk/client-ssm";

// Initialize SSM client
const ssmClient = new SSMClient({});

/**
 * Lambda handler for CloudFormation Custom Resource
 */
export const handler = async (
  event: CloudFormationCustomResourceEvent,
  context: Context
): Promise<CloudFormationCustomResourceResponse> => {
  console.log("EFS Configuration Lambda started");
  console.log("Event:", JSON.stringify(event, null, 2));

  try {
    const requestType = event.RequestType;
    console.log(`Request type: ${requestType}`);

    let response: CloudFormationCustomResourceResponse;

    switch (requestType) {
      case "Create":
      case "Update":
        response = await handleCreateOrUpdate(event, context);
        break;
      case "Delete":
        response = await handleDelete(event, context);
        break;
      default:
        throw new Error(`Unknown request type: ${requestType}`);
    }

    await sendCfnResponse(event, context, response);
    return response;
  } catch (error) {
    console.error("Error in handler:", error);

    const physicalResourceId =
      "PhysicalResourceId" in event
        ? event.PhysicalResourceId
        : "efs-config-failed";

    const failureResponse: CloudFormationCustomResourceResponse = {
      Status: "FAILED",
      Reason: error instanceof Error ? error.message : String(error),
      PhysicalResourceId: physicalResourceId,
      StackId: event.StackId,
      RequestId: event.RequestId,
      LogicalResourceId: event.LogicalResourceId,
      Data: {},
    };

    await sendCfnResponse(event, context, failureResponse);
    return failureResponse;
  }
};

/**
 * Properties from CloudFormation stack
 */
interface EfsConfigProperties {
  FileSystemId: string;
  AccessPointId: string;
  Environment: string;
  Region: string;
}

/**
 * Handle Create or Update events
 */
async function handleCreateOrUpdate(
  event: CloudFormationCustomResourceEvent,
  _context: Context
): Promise<CloudFormationCustomResourceResponse> {
  const props = event.ResourceProperties as unknown as EfsConfigProperties;
  const { FileSystemId, AccessPointId, Environment: envName, Region } = props;

  // Validate required properties
  validateProperties({ FileSystemId, AccessPointId, envName, Region });

  console.log(`Preparing EFS configuration for ${envName} environment`);
  console.log(`  File System: ${FileSystemId}`);
  console.log(`  Access Point: ${AccessPointId}`);
  console.log(`  Region: ${Region}`);

  // Convert JSON configs to YAML
  await convertConfigsToYaml(envName, Region);

  // Create EFS setup script for EC2 instances
  await createEfsSetupScript(envName, Region, FileSystemId);

  // Mark initialization as complete
  await markInitializationComplete(envName, Region, FileSystemId);

  console.log("EFS configuration preparation completed successfully");

  return {
    Status: "SUCCESS",
    PhysicalResourceId: `efs-config-${envName}-${FileSystemId}`,
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
    Data: {
      FileSystemId,
      AccessPointId,
      Environment: envName,
      InitializationStatus: "Complete",
      ConfigurationsCreated: [
        `/monitoring/${envName}/prometheus-config-yaml`,
        `/monitoring/${envName}/grafana-datasource-config-yaml`,
        `/monitoring/${envName}/grafana-dashboard-config-yaml`,
        `/monitoring/${envName}/efs-setup-script`,
      ],
    },
  };
}

/**
 * Handle Delete events
 */
async function handleDelete(
  event: CloudFormationCustomResourceEvent,
  _context: Context
): Promise<CloudFormationCustomResourceResponse> {
  console.log("EFS configuration cleanup - preserving data");
  console.log("  SSM parameters will be cleaned up by stack deletion");
  console.log("  EFS data preserved (RETAIN policy)");

  const physicalResourceId =
    "PhysicalResourceId" in event
      ? event.PhysicalResourceId
      : "efs-config-cleanup";

  return {
    Status: "SUCCESS",
    PhysicalResourceId: physicalResourceId,
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
    Data: {},
  };
}

/**
 * Validate required properties
 */
function validateProperties(props: {
  FileSystemId?: string;
  AccessPointId?: string;
  envName?: string;
  Region?: string;
}): void {
  const missing: string[] = [];

  if (!props.FileSystemId) missing.push("FileSystemId");
  if (!props.AccessPointId) missing.push("AccessPointId");
  if (!props.envName) missing.push("Environment");
  if (!props.Region) missing.push("Region");

  if (missing.length > 0) {
    throw new Error(
      `Missing required properties: ${missing.join(", ")}\n\n` +
        "These properties must be passed from MonitoringEfsStack:\n" +
        `  FileSystemId: EFS file system ID\n` +
        `  AccessPointId: EFS access point ID\n` +
        `  Environment: Environment name (e.g., 'pipeline')\n` +
        `  Region: AWS region (e.g., 'eu-west-1')`
    );
  }
}

/**
 * Convert JSON configs to YAML format
 */
async function convertConfigsToYaml(
  envName: string,
  region: string
): Promise<void> {
  console.log("Converting JSON configs to YAML...");

  // Get JSON configs from SSM (created by MonitoringEfsStack)
  const prometheusJson = await getParameter(
    `/monitoring/${envName}/prometheus-config`,
    region
  );
  const grafanaDatasourceJson = await getParameter(
    `/monitoring/${envName}/grafana-datasource-config`,
    region
  );
  const grafanaDashboardJson = await getParameter(
    `/monitoring/${envName}/grafana-dashboard-config`,
    region
  );

  // Validate we got values
  validateParameterValue(prometheusJson, "prometheus-config");
  validateParameterValue(grafanaDatasourceJson, "grafana-datasource-config");
  validateParameterValue(grafanaDashboardJson, "grafana-dashboard-config");

  // Convert to YAML using yaml library (not custom function)
  const prometheusYaml = jsonToYaml(prometheusJson, "Prometheus");
  const grafanaDatasourceYaml = jsonToYaml(
    grafanaDatasourceJson,
    "Grafana Datasource"
  );
  const grafanaDashboardYaml = jsonToYaml(
    grafanaDashboardJson,
    "Grafana Dashboard"
  );

  // Store YAML configs in SSM for EC2 instances
  await putParameter(
    `/monitoring/${envName}/prometheus-config-yaml`,
    prometheusYaml,
    region,
    "Prometheus configuration in YAML format"
  );

  await putParameter(
    `/monitoring/${envName}/grafana-datasource-config-yaml`,
    grafanaDatasourceYaml,
    region,
    "Grafana datasource configuration in YAML format"
  );

  await putParameter(
    `/monitoring/${envName}/grafana-dashboard-config-yaml`,
    grafanaDashboardYaml,
    region,
    "Grafana dashboard configuration in YAML format"
  );

  console.log("✅ YAML configs created successfully");
}

/**
 * Create EFS setup script for EC2 instances
 */
async function createEfsSetupScript(
  envName: string,
  region: string,
  fileSystemId: string
): Promise<void> {
  console.log("Creating EFS setup script...");

  const setupScript = `#!/bin/bash
# EFS Setup Script for ${envName} Environment
# Generated by EFS Configuration Lambda
# File System: ${fileSystemId}
# Region: ${region}

set -euo pipefail

echo "================================================================"
echo "EFS Setup for ${envName} - $(date)"
echo "================================================================"

# Verify EFS is mounted
if ! mountpoint -q /mnt/efs; then
  echo "ERROR: EFS not mounted at /mnt/efs"
  echo "This script expects EFS to be already mounted by SSM State Manager"
  exit 1
fi

echo "EFS mounted at /mnt/efs"

# ============================================================================
# CREATE DIRECTORY STRUCTURE
# ============================================================================
echo ""
echo "Creating directory structure..."

# Prometheus directories
mkdir -p /mnt/efs/prometheus-data
mkdir -p /mnt/efs/config/prometheus

# Grafana directories
mkdir -p /mnt/efs/grafana-data/plugins
mkdir -p /mnt/efs/grafana-data/logs
mkdir -p /mnt/efs/grafana-data/csv
mkdir -p /mnt/efs/grafana-data/png
mkdir -p /mnt/efs/config/grafana/provisioning/datasources
mkdir -p /mnt/efs/config/grafana/provisioning/dashboards
mkdir -p /mnt/efs/config/grafana/dashboards

# Alertmanager directory (future use)
mkdir -p /mnt/efs/config/alertmanager

echo "Directories created"

# ============================================================================
# SET PERMISSIONS
# ============================================================================
echo ""
echo "Setting ownership and permissions..."

# Prometheus (runs as UID 65534:65534 - 'nobody' user)
chown -R 65534:65534 /mnt/efs/prometheus-data
chown -R 65534:65534 /mnt/efs/config/prometheus
chmod -R 755 /mnt/efs/prometheus-data
chmod -R 755 /mnt/efs/config/prometheus

# Grafana (runs as UID 472:0 - 'grafana' user, group 'root')
chown -R 472:0 /mnt/efs/grafana-data
chown -R 472:0 /mnt/efs/config/grafana
chmod -R 755 /mnt/efs/grafana-data
chmod -R 755 /mnt/efs/config/grafana

# Grafana needs write access to these directories
chmod 777 /mnt/efs/grafana-data/plugins
chmod 777 /mnt/efs/grafana-data/logs
chmod 777 /mnt/efs/grafana-data/csv
chmod 777 /mnt/efs/grafana-data/png

echo "Permissions set"

# ============================================================================
# DOWNLOAD CONFIGURATION FILES
# ============================================================================
echo ""
echo "Downloading configuration files from SSM..."

# Prometheus config
echo "  - Prometheus config..."
aws ssm get-parameter \
  --region ${region} \
  --name "/monitoring/${envName}/prometheus-config-yaml" \
  --query "Parameter.Value" \
  --output text \
  > /mnt/efs/config/prometheus/prometheus.yml

# Grafana datasource config
# NOTE: Contains HOST_IP_PLACEHOLDER which will be replaced at runtime
echo "  - Grafana datasource config..."
aws ssm get-parameter \
  --region ${region} \
  --name "/monitoring/${envName}/grafana-datasource-config-yaml" \
  --query "Parameter.Value" \
  --output text \
  > /mnt/efs/config/grafana/provisioning/datasources/prometheus.yml

# Grafana dashboard config
echo "  - Grafana dashboard config..."
aws ssm get-parameter \
  --region ${region} \
  --name "/monitoring/${envName}/grafana-dashboard-config-yaml" \
  --query "Parameter.Value" \
  --output text \
  > /mnt/efs/config/grafana/provisioning/dashboards/dashboards.yml

echo "Configuration files downloaded"

# ============================================================================
# SET CONFIG FILE PERMISSIONS
# ============================================================================
echo ""
echo "Setting config file permissions..."

chown 65534:65534 /mnt/efs/config/prometheus/prometheus.yml
chmod 644 /mnt/efs/config/prometheus/prometheus.yml

chown 472:0 /mnt/efs/config/grafana/provisioning/datasources/prometheus.yml
chown 472:0 /mnt/efs/config/grafana/provisioning/dashboards/dashboards.yml
chmod 644 /mnt/efs/config/grafana/provisioning/datasources/prometheus.yml
chmod 644 /mnt/efs/config/grafana/provisioning/dashboards/dashboards.yml

echo "✅ Config file permissions set"

# ============================================================================
# VERIFY SETUP
# ============================================================================
echo ""
echo "Verifying setup..."

echo ""
echo "Directory structure:"
ls -la /mnt/efs/

echo ""
echo "Prometheus directories:"
ls -la /mnt/efs/prometheus-data/
ls -la /mnt/efs/config/prometheus/

echo ""
echo "Grafana directories:"
ls -la /mnt/efs/grafana-data/
ls -la /mnt/efs/config/grafana/

echo ""
echo "Configuration files:"
ls -lh /mnt/efs/config/prometheus/prometheus.yml
ls -lh /mnt/efs/config/grafana/provisioning/datasources/prometheus.yml
ls -lh /mnt/efs/config/grafana/provisioning/dashboards/dashboards.yml

echo ""
echo "================================================================"
echo "EFS setup completed successfully - $(date)"
echo "================================================================"
`;

  await putParameter(
    `/monitoring/${envName}/efs-setup-script`,
    setupScript,
    region,
    "EFS directory setup script for EC2 instances"
  );

  console.log("✅ EFS setup script created");
}

/**
 * Mark initialization as complete
 */
async function markInitializationComplete(
  envName: string,
  region: string,
  fileSystemId: string
): Promise<void> {
  const timestamp = new Date().toISOString();
  const status = {
    status: "complete",
    fileSystemId,
    environment: envName,
    completedAt: timestamp,
    configurationsCreated: [
      "prometheus-config-yaml",
      "grafana-datasource-config-yaml",
      "grafana-dashboard-config-yaml",
      "efs-setup-script",
    ],
  };

  await putParameter(
    `/monitoring/${envName}/efs-initialization-status`,
    JSON.stringify(status, null, 2),
    region,
    "EFS initialization status"
  );

  console.log(`Initialization marked complete at ${timestamp}`);
}

/**
 * Convert JSON to YAML with validation
 */
function jsonToYaml(jsonString: string, configName: string): string {
  try {
    // Parse JSON
    const config = JSON.parse(jsonString);

    // Convert to YAML using yaml library
    // lineWidth is a valid runtime option but not in type definitions
    const yamlOptions = {
      indent: 2,
      lineWidth: 0, // Don't wrap lines
      minContentWidth: 0,
    } as Record<string, unknown>;
    const yamlString = yaml.stringify(config, yamlOptions);

    // Validate YAML is not empty
    if (!yamlString || yamlString.trim().length === 0) {
      throw new Error(`Generated YAML is empty`);
    }

    // Validate YAML can be parsed back (round-trip test)
    const parsed = yaml.parse(yamlString);
    if (!parsed) {
      throw new Error(`Generated YAML cannot be parsed back`);
    }

    console.log(` ${configName}: ${yamlString.length} chars`);
    return yamlString;
  } catch (error) {
    console.error(`Failed to convert ${configName} to YAML:`, error);
    throw new Error(
      `Failed to convert ${configName} to YAML: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

/**
 * Validate parameter value is not empty
 */
function validateParameterValue(value: string, paramName: string): void {
  if (!value || value.trim().length === 0) {
    throw new Error(
      `SSM parameter ${paramName} exists but has no value.\n\n` +
        `Ensure MonitoringEfsStack creates this parameter before Lambda runs.`
    );
  }
}

/**
 * Get SSM parameter value
 * @param _region - Region parameter (unused, SSM client uses Lambda execution region)
 */
async function getParameter(name: string, _region: string): Promise<string> {
  try {
    const command = new GetParameterCommand({
      Name: name,
    });

    const response = await ssmClient.send(command);
    const value = response.Parameter?.Value;

    if (!value) {
      throw new Error(`Parameter ${name} exists but has no value`);
    }

    console.log(`  Retrieved ${name}`);
    return value;
  } catch (error) {
    if (
      error instanceof ParameterNotFound ||
      (error as any).name === "ParameterNotFound"
    ) {
      throw new Error(
        `SSM parameter ${name} not found.\n\n` +
          `Ensure MonitoringEfsStack creates this parameter first:\n` +
          `  - Prometheus config: /monitoring/{env}/prometheus-config\n` +
          `  - Grafana datasource: /monitoring/{env}/grafana-datasource-config\n` +
          `  - Grafana dashboard: /monitoring/{env}/grafana-dashboard-config`
      );
    }

    console.error(`Failed to get parameter ${name}:`, error);
    throw error;
  }
}

/**
 * Put SSM parameter value
 * @param _region - Region parameter (unused, SSM client uses Lambda execution region)
 */
async function putParameter(
  name: string,
  value: string,
  _region: string,
  description: string
): Promise<void> {
  const MAX_STANDARD_TIER_SIZE = 4096;

  // Determine tier based on value size
  // Standard: FREE, max 4096 characters
  // Advanced: $0.05/month, max 8192 characters

  const tier = value.length > MAX_STANDARD_TIER_SIZE ? "Advanced" : "Standard";
  try {
    console.log(`  Storing ${name}:`);
    console.log(`    - Size: ${value.length} characters`);
    console.log(
      `    - Tier: ${tier}${
        tier === "Advanced" ? " (+$0.05/month)" : " (FREE)"
      }`
    );

    const command = new PutParameterCommand({
      Name: name,
      Value: value,
      Type: "String",
      Tier: tier,
      Overwrite: true,
      Description: description,
    });

    await ssmClient.send(command);
    console.log(`  Stored ${name} successfully`);
  } catch (error) {
    console.error(`Failed to put parameter ${name}:`, error);
    // Provide actionable error message
    if (error instanceof Error) {
      if (error.name === "ParameterMaxVersionLimitExceeded") {
        throw new Error(
          `Parameter ${name} has too many versions. ` +
            `Delete old versions or use a new parameter name.`
        );
      }

      if (error.message.includes("ParameterLimitExceeded")) {
        throw new Error(
          `Parameter ${name} exceeds size limit. ` +
            `Standard tier: 4096 chars max. Advanced tier: 8192 chars max. ` +
            `Current size: ${value.length} chars`
        );
      }
    }
    throw error;
  }
}

/**
 * Send CloudFormation response
 */
async function sendCfnResponse(
  event: CloudFormationCustomResourceEvent,
  context: Context,
  response: CloudFormationCustomResourceResponse
): Promise<void> {
  const responseBody = JSON.stringify({
    Status: response.Status,
    Reason:
      response.Reason ||
      `See CloudWatch Logs: ${context.logGroupName} / ${context.logStreamName}`,
    PhysicalResourceId: response.PhysicalResourceId || context.logStreamName,
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
    Data: response.Data || {},
  });

  console.log("Sending CloudFormation response:", responseBody);

  const parsedUrl = url.parse(event.ResponseURL);
  const options = {
    hostname: parsedUrl.hostname,
    port: 443,
    path: parsedUrl.path,
    method: "PUT",
    headers: {
      "content-type": "",
      "content-length": Buffer.byteLength(responseBody),
    },
  };

  await new Promise<void>((resolve, reject) => {
    const req = https.request(options, (res) => {
      console.log(`CloudFormation response status: ${res.statusCode}`);
      res.on("data", () => undefined);
      res.on("end", () => {
        console.log("CloudFormation response sent successfully");
        resolve();
      });
    });

    req.on("error", (err) => {
      console.error("Failed to send CloudFormation response:", err);
      reject(err);
    });

    req.write(responseBody);
    req.end();
  });
}
