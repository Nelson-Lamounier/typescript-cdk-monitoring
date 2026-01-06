/**
 * EFS Initialisation Lambda Function
 *
 * This Lambda function initializes EFS configuration by storing setup commands
 * and enhanced configuration files in SSM parameters for EC2 instances to use.
 *
 * Features:
 * - Creates enhanced YAML configuration files in SSM
 * - Stores directory structure and permission commands
 * - Provides setup scripts for EC2 instances
 * - No VPC dependencies (runs outside VPC)
 *
 * @format
 */

import * as https from "https";
import * as url from "url";

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

const ssmClient = new SSMClient({ region: process.env.AWS_REGION });

export const handler = async (
  event: CloudFormationCustomResourceEvent,
  context: Context
): Promise<CloudFormationCustomResourceResponse> => {
  console.log(
    "EFS Initialization Lambda started",
    JSON.stringify(event, null, 2)
  );

  try {
    const requestType = event.RequestType;
    console.log(`Request type: ${requestType}`);

    let response: CloudFormationCustomResourceResponse;

    if (requestType === "Create" || requestType === "Update") {
      response = await initializeEfs(event, context);
    } else if (requestType === "Delete") {
      response = await cleanupEfs(event, context);
    } else {
      throw new Error(`Unknown request type: ${requestType}`);
    }

    await sendResponse(event, context, response);
    return response;
  } catch (error) {
    console.error("Error in handler:", error);
    // PhysicalResourceId only exists on Update/Delete events, not Create
    const physicalResourceId =
      "PhysicalResourceId" in event
        ? event.PhysicalResourceId
        : "efs-init-failed";

    const failureResponse: CloudFormationCustomResourceResponse = {
      Status: "FAILED",
      Reason: error instanceof Error ? error.message : String(error),
      PhysicalResourceId: physicalResourceId,
      StackId: event.StackId,
      RequestId: event.RequestId,
      LogicalResourceId: event.LogicalResourceId,
      Data: {},
    };
    await sendResponse(event, context, failureResponse);
    return failureResponse;
  }
};

interface EfsInitializationProperties {
  FileSystemId: string;
  AccessPointId: string;
  Environment: string;
}

async function initializeEfs(
  event: CloudFormationCustomResourceEvent,
  _context: Context
): Promise<CloudFormationCustomResourceResponse> {
  // Align with properties sent by the stack (FileSystemId, AccessPointId, Environment)
  const props =
    event.ResourceProperties as unknown as EfsInitializationProperties;
  const { FileSystemId, AccessPointId, Environment: envName } = props;
  const region = process.env.AWS_REGION;

  // Validate required properties
  if (!FileSystemId || !AccessPointId || !envName) {
    throw new Error(
      `Missing required properties: FileSystemId=${FileSystemId}, AccessPointId=${AccessPointId}, Environment=${envName}`
    );
  }

  if (!region) {
    throw new Error("AWS_REGION environment variable is not set");
  }

  console.log(
    `Initializing EFS configuration for ${FileSystemId} with access point ${AccessPointId} in env ${envName}`
  );

  // Create enhanced configuration files in SSM
  await createEnhancedConfigurationFiles(envName, region);

  // Store directory structure and permissions in SSM for EC2 instances to use
  await storeDirectoryStructureInSSM(envName, region);

  console.log("EFS configuration initialization completed successfully");

  return {
    Status: "SUCCESS",
    PhysicalResourceId: `efs-init-${FileSystemId}`,
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
    Data: {
      FileSystemId,
      AccessPointId,
      InitializationStatus: "Complete",
    },
  };
}

async function cleanupEfs(
  event: CloudFormationCustomResourceEvent,
  _context: Context
): Promise<CloudFormationCustomResourceResponse> {
  console.log("EFS cleanup - no action needed (data preserved)");

  // PhysicalResourceId exists on Delete events
  const physicalResourceId =
    "PhysicalResourceId" in event
      ? event.PhysicalResourceId
      : "efs-init-cleanup";

  return {
    Status: "SUCCESS",
    PhysicalResourceId: physicalResourceId,
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
    Data: {},
  };
}

async function createEnhancedConfigurationFiles(
  envName: string,
  region: string
): Promise<void> {
  try {
    // Get existing configurations and enhance them
    const prometheusConfig = await getSSMParameter(
      `/monitoring/${envName}/prometheus-config`,
      region
    );
    const grafanaDsConfig = await getSSMParameter(
      `/monitoring/${envName}/grafana-datasource-config`,
      region
    );
    const grafanaDbConfig = await getSSMParameter(
      `/monitoring/${envName}/grafana-dashboard-config`,
      region
    );

    // Validate that we got valid JSON
    if (!prometheusConfig || !grafanaDsConfig || !grafanaDbConfig) {
      throw new Error(
        "One or more SSM parameters are missing or empty. Ensure MonitoringEfsStack creates these parameters before EFS initialization runs."
      );
    }

    // Parse and convert to YAML
    let prometheusYaml: string;
    let grafanaDsYaml: string;
    let grafanaDbYaml: string;

    try {
      const parsedConfig = JSON.parse(prometheusConfig);
      prometheusYaml = dictToYaml(parsedConfig);
      // Validate YAML is not empty
      if (!prometheusYaml || prometheusYaml.trim().length === 0) {
        throw new Error("Generated Prometheus YAML is empty");
      }
      console.log(`Generated Prometheus YAML (${prometheusYaml.length} chars)`);
    } catch (error) {
      console.error("Error generating Prometheus YAML:", error);
      throw new Error(
        `Failed to parse Prometheus config JSON: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    try {
      const parsedConfig = JSON.parse(grafanaDsConfig);
      grafanaDsYaml = dictToYaml(parsedConfig);
      if (!grafanaDsYaml || grafanaDsYaml.trim().length === 0) {
        throw new Error("Generated Grafana datasource YAML is empty");
      }
      console.log(
        `Generated Grafana datasource YAML (${grafanaDsYaml.length} chars)`
      );
    } catch (error) {
      console.error("Error generating Grafana datasource YAML:", error);
      throw new Error(
        `Failed to parse Grafana datasource config JSON: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    try {
      const parsedConfig = JSON.parse(grafanaDbConfig);
      grafanaDbYaml = dictToYaml(parsedConfig);
      if (!grafanaDbYaml || grafanaDbYaml.trim().length === 0) {
        throw new Error("Generated Grafana dashboard YAML is empty");
      }
      console.log(
        `Generated Grafana dashboard YAML (${grafanaDbYaml.length} chars)`
      );
    } catch (error) {
      console.error("Error generating Grafana dashboard YAML:", error);
      throw new Error(
        `Failed to parse Grafana dashboard config JSON: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    // Store enhanced YAML configurations for EC2 instances to use
    await putSSMParameter(
      `/monitoring/${envName}/prometheus-config-yaml`,
      prometheusYaml,
      region
    );

    await putSSMParameter(
      `/monitoring/${envName}/grafana-datasource-config-yaml`,
      grafanaDsYaml,
      region
    );

    await putSSMParameter(
      `/monitoring/${envName}/grafana-dashboard-config-yaml`,
      grafanaDbYaml,
      region
    );

    console.log("Enhanced configuration files stored in SSM");
  } catch (error) {
    console.error("Error creating enhanced configuration files:", error);
    throw error;
  }
}

async function storeDirectoryStructureInSSM(
  envName: string,
  region: string
): Promise<void> {
  const setupScript = `#!/bin/bash
set -e

echo "Setting up EFS directory structure and permissions..."

# Create directory structure with proper ownership from the start
mkdir -p /mnt/efs/prometheus-data
mkdir -p /mnt/efs/grafana-data/plugins
mkdir -p /mnt/efs/grafana-data/logs
mkdir -p /mnt/efs/grafana-data/csv
mkdir -p /mnt/efs/grafana-data/png
mkdir -p /mnt/efs/config/prometheus
mkdir -p /mnt/efs/config/grafana/provisioning/datasources
mkdir -p /mnt/efs/config/grafana/provisioning/dashboards
mkdir -p /mnt/efs/config/grafana/dashboards
mkdir -p /mnt/efs/config/alertmanager

# Set ownership and permissions for Prometheus (UID 65534)
chown -R 65534:65534 /mnt/efs/prometheus-data /mnt/efs/config/prometheus
chmod -R 755 /mnt/efs/prometheus-data /mnt/efs/config/prometheus

# Set ownership and permissions for Grafana (UID 472, GID 0)
chown -R 472:0 /mnt/efs/grafana-data /mnt/efs/config/grafana
chmod -R 755 /mnt/efs/grafana-data /mnt/efs/config/grafana

# Ensure Grafana can write to its data directories
chmod -R 777 /mnt/efs/grafana-data/plugins
chmod -R 777 /mnt/efs/grafana-data/logs
chmod -R 777 /mnt/efs/grafana-data/csv
chmod -R 777 /mnt/efs/grafana-data/png

# Create configuration files from SSM
echo "Creating configuration files from SSM parameters..."
echo "NOTE: HOST_IP_PLACEHOLDER in Grafana datasource config will be replaced at runtime on EC2 instance"

# Download Prometheus config
aws ssm get-parameter --region ${region} --name "/monitoring/${envName}/prometheus-config-yaml" --query "Parameter.Value" --output text > /mnt/efs/config/prometheus/prometheus.yml

# Download Grafana datasource config (HOST_IP_PLACEHOLDER will be replaced by application-setup script on EC2)
aws ssm get-parameter --region ${region} --name "/monitoring/${envName}/grafana-datasource-config-yaml" --query "Parameter.Value" --output text > /mnt/efs/config/grafana/provisioning/datasources/prometheus.yml

# Download Grafana dashboard config
aws ssm get-parameter --region ${region} --name "/monitoring/${envName}/grafana-dashboard-config-yaml" --query "Parameter.Value" --output text > /mnt/efs/config/grafana/provisioning/dashboards/dashboards.yml

# Set proper ownership for config files
chown 65534:65534 /mnt/efs/config/prometheus/prometheus.yml
chown 472:0 /mnt/efs/config/grafana/provisioning/datasources/prometheus.yml
chown 472:0 /mnt/efs/config/grafana/provisioning/dashboards/dashboards.yml

# Verify directory structure and permissions
echo "Verifying directory structure:"
ls -la /mnt/efs/
ls -la /mnt/efs/grafana-data/
ls -la /mnt/efs/config/grafana/

echo "EFS setup completed successfully"
`;

  await putSSMParameter(
    `/monitoring/${envName}/efs-setup-script`,
    setupScript,
    region
  );

  console.log("EFS setup script stored in SSM");
}

async function getSSMParameter(
  parameterName: string,
  _region: string
): Promise<string> {
  try {
    const command = new GetParameterCommand({ Name: parameterName });
    const response = await ssmClient.send(command);
    const value = response.Parameter?.Value;

    if (!value) {
      throw new Error(`SSM parameter ${parameterName} exists but has no value`);
    }

    return value;
  } catch (error) {
    if (
      error instanceof ParameterNotFound ||
      (error as any).name === "ParameterNotFound"
    ) {
      throw new Error(
        `SSM parameter ${parameterName} not found. Ensure MonitoringEfsStack creates this parameter before EFS initialization runs.`
      );
    }
    console.error(`Failed to get SSM parameter ${parameterName}:`, error);
    throw error;
  }
}

async function putSSMParameter(
  parameterName: string,
  value: string,
  _region: string
): Promise<void> {
  try {
    const command = new PutParameterCommand({
      Name: parameterName,
      Value: value,
      Type: "String",
      Overwrite: true,
      Description: "EFS configuration generated by Lambda",
    });
    await ssmClient.send(command);
    console.log(`Stored SSM parameter: ${parameterName}`);
  } catch (error) {
    console.error(`Failed to put SSM parameter ${parameterName}:`, error);
    throw error;
  }
}

function dictToYaml(data: any, indent: number = 0): string {
  const yamlLines: string[] = [];
  const indentStr = "  ".repeat(indent);

  if (data === null || data === undefined) {
    return `${indentStr}null`;
  }

  if (typeof data === "string") {
    // Escape special characters and quote if needed
    if (
      data.includes(":") ||
      data.includes("\n") ||
      data.includes("'") ||
      data.includes('"')
    ) {
      return `"${data.replace(/"/g, '\\"')}"`;
    }
    return data;
  }

  if (typeof data === "number") {
    return String(data);
  }

  if (typeof data === "boolean") {
    return data ? "true" : "false";
  }

  if (Array.isArray(data)) {
    for (const item of data) {
      if (typeof item === "object" && item !== null) {
        // For objects in arrays, process keys directly to ensure proper formatting
        const itemKeys = Object.keys(item);
        if (itemKeys.length === 0) {
          yamlLines.push(`${indentStr}- {}`);
        } else {
          // Process first key on same line as dash
          const firstKey = itemKeys[0];
          const firstValue = item[firstKey];

          if (firstValue === null || firstValue === undefined) {
            yamlLines.push(`${indentStr}- ${firstKey}: null`);
          } else if (
            typeof firstValue === "object" &&
            !Array.isArray(firstValue)
          ) {
            yamlLines.push(`${indentStr}- ${firstKey}:`);
            // For nested objects, use indent + 1 (relative to current level)
            const nestedYaml = dictToYaml(firstValue, indent + 1);
            const nestedLines = nestedYaml.split("\n");
            for (const line of nestedLines) {
              if (line.trim()) {
                // Adjust indentation: remove the base indent and add proper relative indent
                const lineIndent = line.match(/^(\s*)/)?.[1]?.length || 0;
                const baseIndent = (indent + 1) * 2; // Base indent from recursive call
                const targetIndent = indentStr.length + 2; // 2 spaces after dash
                const adjustedIndent = Math.max(
                  0,
                  targetIndent + (lineIndent - baseIndent)
                );
                yamlLines.push(" ".repeat(adjustedIndent) + line.trimStart());
              }
            }
          } else if (Array.isArray(firstValue)) {
            yamlLines.push(`${indentStr}- ${firstKey}:`);
            const arrayYaml = dictToYaml(firstValue, indent + 1);
            const arrayLines = arrayYaml.split("\n");
            for (const line of arrayLines) {
              if (line.trim()) {
                const lineIndent = line.match(/^(\s*)/)?.[1]?.length || 0;
                const baseIndent = (indent + 1) * 2;
                const targetIndent = indentStr.length + 2;
                const adjustedIndent = Math.max(
                  0,
                  targetIndent + (lineIndent - baseIndent)
                );
                yamlLines.push(" ".repeat(adjustedIndent) + line.trimStart());
              }
            }
          } else {
            const formattedValue = formatYamlValue(firstValue);
            yamlLines.push(`${indentStr}- ${firstKey}: ${formattedValue}`);
          }

          // Process remaining keys with proper indentation (2 spaces after dash)
          for (let i = 1; i < itemKeys.length; i++) {
            const key = itemKeys[i];
            const value = item[key];

            if (value === null || value === undefined) {
              yamlLines.push(`${indentStr}  ${key}: null`);
            } else if (typeof value === "object" && !Array.isArray(value)) {
              yamlLines.push(`${indentStr}  ${key}:`);
              const nestedYaml = dictToYaml(value, indent + 1);
              const nestedLines = nestedYaml.split("\n");
              for (const line of nestedLines) {
                if (line.trim()) {
                  const lineIndent = line.match(/^(\s*)/)?.[1]?.length || 0;
                  const baseIndent = (indent + 1) * 2;
                  const targetIndent = indentStr.length + 2; // 2 spaces for key after dash
                  const adjustedIndent = Math.max(
                    0,
                    targetIndent + (lineIndent - baseIndent)
                  );
                  yamlLines.push(" ".repeat(adjustedIndent) + line.trimStart());
                }
              }
            } else if (Array.isArray(value)) {
              yamlLines.push(`${indentStr}  ${key}:`);
              const arrayYaml = dictToYaml(value, indent + 1);
              const arrayLines = arrayYaml.split("\n");
              for (const line of arrayLines) {
                if (line.trim()) {
                  const lineIndent = line.match(/^(\s*)/)?.[1]?.length || 0;
                  const baseIndent = (indent + 1) * 2;
                  const targetIndent = indentStr.length + 2;
                  const adjustedIndent = Math.max(
                    0,
                    targetIndent + (lineIndent - baseIndent)
                  );
                  yamlLines.push(" ".repeat(adjustedIndent) + line.trimStart());
                }
              }
            } else {
              const formattedValue = formatYamlValue(value);
              yamlLines.push(`${indentStr}  ${key}: ${formattedValue}`);
            }
          }
        }
      } else {
        const value = formatYamlValue(item);
        yamlLines.push(`${indentStr}- ${value}`);
      }
    }
    return yamlLines.join("\n");
  }

  if (typeof data === "object" && data !== null) {
    for (const [key, value] of Object.entries(data)) {
      if (value === null || value === undefined) {
        yamlLines.push(`${indentStr}${key}: null`);
      } else if (typeof value === "object" && !Array.isArray(value)) {
        yamlLines.push(`${indentStr}${key}:`);
        yamlLines.push(dictToYaml(value, indent + 1));
      } else if (Array.isArray(value)) {
        if (value.length === 0) {
          yamlLines.push(`${indentStr}${key}: []`);
        } else {
          yamlLines.push(`${indentStr}${key}:`);
          const arrayYaml = dictToYaml(value, indent + 1);
          yamlLines.push(arrayYaml);
        }
      } else {
        const formattedValue = formatYamlValue(value);
        yamlLines.push(`${indentStr}${key}: ${formattedValue}`);
      }
    }
  }

  return yamlLines.join("\n");
}

function formatYamlValue(value: any): string {
  if (value === null || value === undefined) {
    return "null";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "number") {
    return String(value);
  }
  if (typeof value === "string") {
    // Quote strings that contain special characters
    if (
      value.includes(":") ||
      value.includes("\n") ||
      value.includes("'") ||
      value.includes('"') ||
      value.includes("#")
    ) {
      return `"${value.replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
    }
    return value;
  }
  return String(value);
}

async function sendResponse(
  event: CloudFormationCustomResourceEvent,
  context: Context,
  response: CloudFormationCustomResourceResponse
): Promise<void> {
  const responseBody = JSON.stringify({
    Status: response.Status,
    Reason:
      response.Reason ||
      `See CloudWatch Logs for requestId: ${context.awsRequestId}`,
    PhysicalResourceId: response.PhysicalResourceId || context.logStreamName,
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
    Data: response.Data || {},
  });

  const parsedUrl = url.parse(event.ResponseURL);
  const options = {
    hostname: parsedUrl.hostname,
    port: 443,
    path: parsedUrl.path,
    method: "PUT",
    headers: {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(responseBody),
    },
  };

  await new Promise<void>((resolve, reject) => {
    const req = https.request(options, (res) => {
      res.on("data", () => undefined);
      res.on("end", resolve);
    });

    req.on("error", (err) => {
      console.error("sendResponse error:", err);
      reject(err);
    });

    req.write(responseBody);
    req.end();
  });
}
