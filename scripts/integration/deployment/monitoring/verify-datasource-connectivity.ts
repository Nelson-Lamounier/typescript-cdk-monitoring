#!/usr/bin/env node
/** @format */

/**
 * Grafana-Prometheus Connectivity Verification
 *
 * This script diagnoses connectivity issues between Grafana and Prometheus
 * in the monitoring infrastructure. It verifies:
 *
 * 1. Prometheus service is running on the EC2 instance
 * 2. Network mode configuration (bridge/host) for both containers
 * 3. Port mapping (9090) is properly exposed
 * 4. Security group rules allow internal traffic
 * 5. Grafana datasource configuration has correct IP address
 * 6. HOST_IP_PLACEHOLDER was replaced with actual IP
 * 7. Container startup order (Prometheus before Grafana)
 *
 * Usage:
 *   ts-node scripts/integration/deployment/monitoring/verify-grafana-prometheus-connectivity.ts \
 *     --environment development \
 *     --profile dev-account \
 *     --region eu-west-1
 *
 * Environment Variables:
 *   AWS_PROFILE - AWS CLI profile to use
 *   AWS_REGION - AWS region (default: eu-west-1)
 *   ENVIRONMENT - Environment name (development|staging|production)
 */

import { program } from "commander";
import {
  ECSClient,
  ListTasksCommand,
  DescribeTasksCommand,
  ListContainerInstancesCommand,
  DescribeContainerInstancesCommand,
} from "@aws-sdk/client-ecs";
import {
  EC2Client,
  DescribeInstancesCommand,
  DescribeSecurityGroupsCommand,
} from "@aws-sdk/client-ec2";
import {
  SSMClient,
  GetParameterCommand,
  SendCommandCommand,
  GetCommandInvocationCommand,
} from "@aws-sdk/client-ssm";
import {
  CloudWatchLogsClient,
  FilterLogEventsCommand,
} from "@aws-sdk/client-cloudwatch-logs";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";

import { Logger } from "../utils/logger";

// ============================================================================
// TYPES
// ============================================================================

interface ConnectivityVerificationConfig {
  environment: string;
  region: string;
  profile?: string;
  verbose?: boolean;
}

interface CheckResult {
  name: string;
  status: "passed" | "failed" | "warning";
  message: string;
  details?: string;
  remediation?: string;
}

interface PrometheusServiceInfo {
  containerRunning: boolean;
  networkMode?: string;
  portMappings?: Array<{ hostPort: number; containerPort: number }>;
  privateIp?: string;
  taskArn?: string;
  lastStatus?: string;
}

interface GrafanaServiceInfo {
  containerRunning: boolean;
  networkMode?: string;
  datasourceConfig?: string;
  privateIp?: string;
  taskArn?: string;
  lastStatus?: string;
}

interface VerificationResults {
  checks: CheckResult[];
  prometheusInfo: PrometheusServiceInfo;
  grafanaInfo: GrafanaServiceInfo;
  overallStatus: "healthy" | "degraded" | "unhealthy";
}

const VALID_ENVIRONMENTS = ["development", "staging", "production", "pipeline"];

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function sleep(seconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

async function createClients(region: string, profile?: string) {
  const clientConfig: { region: string } = { region };

  const isOidcAuth = !!process.env.AWS_SESSION_TOKEN;

  if (profile && !isOidcAuth) {
    process.env.AWS_PROFILE = profile;
    Logger.info(`Using AWS profile: ${profile}`);
  } else if (isOidcAuth) {
    delete process.env.AWS_PROFILE;
    Logger.info("Using OIDC credentials from environment variables");
  }

  return {
    ecs: new ECSClient(clientConfig),
    ec2: new EC2Client(clientConfig),
    ssm: new SSMClient(clientConfig),
    logs: new CloudWatchLogsClient(clientConfig),
    sts: new STSClient(clientConfig),
  };
}

// ============================================================================
// VERIFICATION FUNCTIONS
// ============================================================================

async function getClusterName(
  ssmClient: SSMClient,
  environment: string
): Promise<string | null> {
  try {
    const command = new GetParameterCommand({
      Name: `/monitoring/${environment}/infra/config/cluster-name`,
    });

    const response = await ssmClient.send(command);
    return response.Parameter?.Value || null;
  } catch (error: any) {
    Logger.warning(
      `Could not retrieve cluster name from SSM: ${error.message}`
    );
    return null;
  }
}

async function getEC2InstanceInfo(
  ecsClient: ECSClient,
  ec2Client: EC2Client,
  clusterName: string
): Promise<{
  instanceId: string;
  privateIp: string;
  securityGroupIds: string[];
} | null> {
  try {
    // Get container instance ARN
    const listCommand = new ListContainerInstancesCommand({
      cluster: clusterName,
    });

    const listResponse = await ecsClient.send(listCommand);
    const containerInstanceArn =
      listResponse.containerInstanceArns?.[0] || null;

    if (!containerInstanceArn) {
      Logger.error("No container instances found in cluster");
      return null;
    }

    // Get EC2 instance ID
    const describeCommand = new DescribeContainerInstancesCommand({
      cluster: clusterName,
      containerInstances: [containerInstanceArn],
    });

    const describeResponse = await ecsClient.send(describeCommand);
    const instanceId =
      describeResponse.containerInstances?.[0]?.ec2InstanceId || null;

    if (!instanceId) {
      Logger.error("Could not retrieve EC2 instance ID");
      return null;
    }

    // Get EC2 instance details
    const ec2Command = new DescribeInstancesCommand({
      InstanceIds: [instanceId],
    });

    const ec2Response = await ec2Client.send(ec2Command);
    const instance = ec2Response.Reservations?.[0]?.Instances?.[0];

    if (!instance) {
      Logger.error("Could not retrieve EC2 instance details");
      return null;
    }

    return {
      instanceId,
      privateIp: instance.PrivateIpAddress || "",
      securityGroupIds:
        instance.SecurityGroups?.map((sg) => sg.GroupId || "").filter(
          (id) => id !== ""
        ) || [],
    };
  } catch (error: any) {
    Logger.error(`Failed to get EC2 instance info: ${error.message}`);
    return null;
  }
}

async function getPrometheusServiceInfo(
  ecsClient: ECSClient,
  clusterName: string,
  environment: string
): Promise<PrometheusServiceInfo> {
  const info: PrometheusServiceInfo = {
    containerRunning: false,
  };

  try {
    // List tasks for Prometheus service
    const serviceName = `${environment}-prometheus`;
    const listCommand = new ListTasksCommand({
      cluster: clusterName,
      serviceName,
      desiredStatus: "RUNNING",
    });

    const listResponse = await ecsClient.send(listCommand);
    const taskArns = listResponse.taskArns || [];

    if (taskArns.length === 0) {
      Logger.warning(`No running tasks found for service: ${serviceName}`);
      return info;
    }

    info.taskArn = taskArns[0];

    // Describe task
    const describeCommand = new DescribeTasksCommand({
      cluster: clusterName,
      tasks: [taskArns[0]],
    });

    const describeResponse = await ecsClient.send(describeCommand);
    const task = describeResponse.tasks?.[0];

    if (!task) {
      return info;
    }

    info.lastStatus = task.lastStatus;
    info.containerRunning = task.lastStatus === "RUNNING";

    // Get container details
    const prometheusContainer = task.containers?.find((c) =>
      c.name?.includes("prometheus")
    );

    if (prometheusContainer) {
      info.networkMode = task.taskDefinitionArn?.includes("bridge")
        ? "bridge"
        : task.taskDefinitionArn?.includes("host")
        ? "host"
        : "unknown";

      info.portMappings =
        prometheusContainer.networkBindings?.map((nb) => ({
          hostPort: nb.hostPort || 0,
          containerPort: nb.containerPort || 0,
        })) || [];
    }

    return info;
  } catch (error: any) {
    Logger.error(`Failed to get Prometheus service info: ${error.message}`);
    return info;
  }
}

async function getGrafanaServiceInfo(
  ecsClient: ECSClient,
  clusterName: string,
  environment: string
): Promise<GrafanaServiceInfo> {
  const info: GrafanaServiceInfo = {
    containerRunning: false,
  };

  try {
    // List tasks for Grafana service
    const serviceName = `${environment}-grafana`;
    const listCommand = new ListTasksCommand({
      cluster: clusterName,
      serviceName,
      desiredStatus: "RUNNING",
    });

    const listResponse = await ecsClient.send(listCommand);
    const taskArns = listResponse.taskArns || [];

    if (taskArns.length === 0) {
      Logger.warning(`No running tasks found for service: ${serviceName}`);
      return info;
    }

    info.taskArn = taskArns[0];

    // Describe task
    const describeCommand = new DescribeTasksCommand({
      cluster: clusterName,
      tasks: [taskArns[0]],
    });

    const describeResponse = await ecsClient.send(describeCommand);
    const task = describeResponse.tasks?.[0];

    if (!task) {
      return info;
    }

    info.lastStatus = task.lastStatus;
    info.containerRunning = task.lastStatus === "RUNNING";

    // Get container details
    const grafanaContainer = task.containers?.find((c) =>
      c.name?.includes("grafana")
    );

    if (grafanaContainer) {
      info.networkMode = task.taskDefinitionArn?.includes("bridge")
        ? "bridge"
        : task.taskDefinitionArn?.includes("host")
        ? "host"
        : "unknown";
    }

    return info;
  } catch (error: any) {
    Logger.error(`Failed to get Grafana service info: ${error.message}`);
    return info;
  }
}

async function checkDatasourceConfiguration(
  ssmClient: SSMClient,
  instanceId: string,
  privateIp: string,
  _environment: string
): Promise<CheckResult> {
  try {
    // Read datasource config from EFS
    const commands = [
      'echo "=== Grafana Datasource Configuration ==="',
      "cat /mnt/efs/config/grafana/provisioning/datasources/prometheus.yml 2>/dev/null || echo 'Config file not found'",
    ];

    const sendCommand = new SendCommandCommand({
      DocumentName: "AWS-RunShellScript",
      InstanceIds: [instanceId],
      Parameters: {
        commands,
      },
      TimeoutSeconds: 30,
    });

    const sendResponse = await ssmClient.send(sendCommand);
    const commandId = sendResponse.Command?.CommandId;

    if (!commandId) {
      return {
        name: "Datasource Configuration",
        status: "warning",
        message: "Could not send SSM command to retrieve datasource config",
      };
    }

    await sleep(5);

    const getCommand = new GetCommandInvocationCommand({
      CommandId: commandId,
      InstanceId: instanceId,
    });

    const getResponse = await ssmClient.send(getCommand);
    const output = getResponse.StandardOutputContent || "";

    // Check if HOST_IP_PLACEHOLDER was replaced
    if (output.includes("HOST_IP_PLACEHOLDER")) {
      return {
        name: "Datasource Configuration",
        status: "failed",
        message:
          "HOST_IP_PLACEHOLDER was NOT replaced with actual EC2 private IP",
        details: output,
        remediation:
          "The EFS initialization script should replace HOST_IP_PLACEHOLDER with the EC2 instance's private IP. " +
          "Check if the EFS init association executed successfully. " +
          `\n\nRun manually: PRIVATE_IP=$(curl -s http://169.254.169.254/latest/meta-data/local-ipv4) && ` +
          `sed -i "s/HOST_IP_PLACEHOLDER/$PRIVATE_IP/g" /mnt/efs/config/grafana/provisioning/datasources/prometheus.yml`,
      };
    }

    // Check if it has the correct IP
    if (output.includes(privateIp)) {
      return {
        name: "Datasource Configuration",
        status: "passed",
        message: `Datasource correctly configured with IP: ${privateIp}`,
        details: output,
      };
    }

    // Check if it has a different IP
    const ipMatch = output.match(/http:\/\/([\d.]+):9090/);
    if (ipMatch) {
      const configuredIp = ipMatch[1];
      return {
        name: "Datasource Configuration",
        status: "warning",
        message: `Datasource configured with IP ${configuredIp}, but EC2 instance has ${privateIp}`,
        details: output,
        remediation:
          "The configured IP doesn't match the current instance IP. " +
          "This may occur if the instance was replaced. " +
          "Re-run the EFS initialization association or manually update the config.",
      };
    }

    return {
      name: "Datasource Configuration",
      status: "warning",
      message: "Could not parse datasource configuration",
      details: output,
    };
  } catch (error: any) {
    return {
      name: "Datasource Configuration",
      status: "failed",
      message: `Failed to check datasource configuration: ${error.message}`,
    };
  }
}

async function checkPrometheusAccessibility(
  ssmClient: SSMClient,
  instanceId: string,
  privateIp: string
): Promise<CheckResult> {
  try {
    // Try to access Prometheus from the instance
    const commands = [
      'echo "=== Testing Prometheus Accessibility ==="',
      'echo "1. Check localhost:9090"',
      "curl -s -o /dev/null -w 'HTTP %{http_code}' http://localhost:9090/prometheus/metrics 2>&1 || echo 'Failed'",
      'echo ""',
      `echo "2. Check ${privateIp}:9090"`,
      `curl -s -o /dev/null -w 'HTTP %{http_code}' http://${privateIp}:9090/prometheus/metrics 2>&1 || echo 'Failed'`,
      'echo ""',
      'echo "3. Check Docker containers"',
      "docker ps --filter name=prometheus --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'",
      'echo ""',
      'echo "4. Check port bindings"',
      "netstat -tulpn | grep ':9090' || echo 'Port 9090 not bound'",
    ];

    const sendCommand = new SendCommandCommand({
      DocumentName: "AWS-RunShellScript",
      InstanceIds: [instanceId],
      Parameters: {
        commands,
      },
      TimeoutSeconds: 30,
    });

    const sendResponse = await ssmClient.send(sendCommand);
    const commandId = sendResponse.Command?.CommandId;

    if (!commandId) {
      return {
        name: "Prometheus Accessibility",
        status: "warning",
        message: "Could not send SSM command to check Prometheus",
      };
    }

    await sleep(5);

    const getCommand = new GetCommandInvocationCommand({
      CommandId: commandId,
      InstanceId: instanceId,
    });

    const getResponse = await ssmClient.send(getCommand);
    const output = getResponse.StandardOutputContent || "";

    // Parse results
    const localhostAccessible = output.includes("HTTP 200");
    const privateIpAccessible = output.match(/HTTP 200/g)?.length === 2;
    const containerRunning = output.includes("Up");
    const portBound = output.includes(":9090") || output.includes("9090");

    if (localhostAccessible && privateIpAccessible && containerRunning) {
      return {
        name: "Prometheus Accessibility",
        status: "passed",
        message:
          "Prometheus is accessible on both localhost and private IP (port 9090)",
        details: output,
      };
    }

    // Diagnose specific issues
    const issues: string[] = [];
    if (!containerRunning) {
      issues.push("Prometheus container is not running");
    }
    if (!portBound) {
      issues.push("Port 9090 is not bound");
    }
    if (!localhostAccessible) {
      issues.push("Prometheus not accessible on localhost:9090");
    }
    if (!privateIpAccessible && localhostAccessible) {
      issues.push(`Prometheus not accessible on ${privateIp}:9090`);
    }

    return {
      name: "Prometheus Accessibility",
      status: "failed",
      message: `Prometheus accessibility issues: ${issues.join(", ")}`,
      details: output,
      remediation:
        "Check:\n" +
        "1. Prometheus container is running: docker ps | grep prometheus\n" +
        "2. Port mapping is correct: docker inspect <container-id> | grep HostPort\n" +
        "3. Network mode is bridge (not host)\n" +
        "4. Check Prometheus logs: aws logs tail /aws/ecs/development-prometheus --follow",
    };
  } catch (error: any) {
    return {
      name: "Prometheus Accessibility",
      status: "failed",
      message: `Failed to check Prometheus accessibility: ${error.message}`,
    };
  }
}

async function checkSecurityGroupRules(
  ec2Client: EC2Client,
  securityGroupIds: string[],
  privateIp: string
): Promise<CheckResult> {
  try {
    const command = new DescribeSecurityGroupsCommand({
      GroupIds: securityGroupIds,
    });

    const response = await ec2Client.send(command);
    const securityGroups = response.SecurityGroups || [];

    // Check for rule allowing port 9090 from VPC CIDR or self-reference
    let hasPrometheusRule = false;
    const vpcCidr = privateIp.split(".").slice(0, 2).join(".") + ".0.0/16"; // Approximate VPC CIDR

    for (const sg of securityGroups) {
      const prometheusRules = sg.IpPermissions?.filter((rule) => {
        const fromPort = rule.FromPort || 0;
        const toPort = rule.ToPort || 0;
        return fromPort <= 9090 && toPort >= 9090;
      });

      if (prometheusRules && prometheusRules.length > 0) {
        for (const rule of prometheusRules) {
          const hasVpcAccess = rule.IpRanges?.some(
            (range) =>
              range.CidrIp === vpcCidr ||
              range.CidrIp?.startsWith(
                privateIp.split(".").slice(0, 2).join(".")
              )
          );

          const hasSelfReference = rule.UserIdGroupPairs?.some(
            (pair) => pair.GroupId === sg.GroupId
          );

          if (hasVpcAccess || hasSelfReference) {
            hasPrometheusRule = true;
            break;
          }
        }
      }
    }

    if (hasPrometheusRule) {
      return {
        name: "Security Group Rules",
        status: "passed",
        message: "Security group allows traffic on port 9090 from VPC",
      };
    }

    return {
      name: "Security Group Rules",
      status: "warning",
      message: "No explicit rule found allowing port 9090 within VPC",
      details: `Checked security groups: ${securityGroupIds.join(", ")}`,
      remediation:
        "Add ingress rule to the ECS instance security group:\n" +
        "- Type: Custom TCP\n" +
        "- Port: 9090\n" +
        "- Source: VPC CIDR or security group self-reference",
    };
  } catch (error: any) {
    return {
      name: "Security Group Rules",
      status: "warning",
      message: `Could not verify security group rules: ${error.message}`,
    };
  }
}

async function checkContainerNetworkMode(
  prometheusInfo: PrometheusServiceInfo,
  grafanaInfo: GrafanaServiceInfo
): Promise<CheckResult> {
  const issues: string[] = [];

  // Both should be in bridge mode for container-to-container communication via private IP
  if (prometheusInfo.networkMode === "host") {
    issues.push(
      "Prometheus is using HOST network mode (should be BRIDGE for port mapping)"
    );
  }

  if (grafanaInfo.networkMode === "host") {
    issues.push(
      "Grafana is using HOST network mode (should be BRIDGE for isolation)"
    );
  }

  if (issues.length > 0) {
    return {
      name: "Container Network Mode",
      status: "failed",
      message: issues.join(", "),
      remediation:
        "Update ECS task definitions to use bridge network mode. " +
        "This allows proper port mapping and inter-container communication via the EC2 instance's private IP.",
    };
  }

  return {
    name: "Container Network Mode",
    status: "passed",
    message: `Prometheus (${prometheusInfo.networkMode}) and Grafana (${grafanaInfo.networkMode}) network modes configured correctly`,
  };
}

async function checkPortMappings(
  prometheusInfo: PrometheusServiceInfo
): Promise<CheckResult> {
  if (
    !prometheusInfo.portMappings ||
    prometheusInfo.portMappings.length === 0
  ) {
    return {
      name: "Port Mappings",
      status: "failed",
      message: "No port mappings found for Prometheus container",
      remediation:
        "Ensure Prometheus task definition maps container port 9090 to host port 9090",
    };
  }

  const prometheusMapping = prometheusInfo.portMappings.find(
    (pm) => pm.containerPort === 9090
  );

  if (!prometheusMapping) {
    return {
      name: "Port Mappings",
      status: "failed",
      message: "Prometheus port 9090 is not mapped",
      details: JSON.stringify(prometheusInfo.portMappings, null, 2),
      remediation:
        "Update Prometheus task definition to include port mapping: containerPort: 9090 -> hostPort: 9090",
    };
  }

  if (prometheusMapping.hostPort !== 9090) {
    return {
      name: "Port Mappings",
      status: "warning",
      message: `Prometheus container port 9090 is mapped to host port ${prometheusMapping.hostPort}`,
      details: `Expected host port: 9090, Actual: ${prometheusMapping.hostPort}`,
      remediation:
        "Update Grafana datasource URL to use the correct host port, or update port mapping to use 9090",
    };
  }

  return {
    name: "Port Mappings",
    status: "passed",
    message: "Prometheus port 9090 correctly mapped to host port 9090",
  };
}

async function checkServiceStartupOrder(
  logsClient: CloudWatchLogsClient,
  environment: string
): Promise<CheckResult> {
  try {
    const prometheusLogGroup = `/aws/ecs/${environment}-prometheus`;
    const grafanaLogGroup = `/aws/ecs/${environment}-grafana`;

    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;

    // Get recent Prometheus logs
    const prometheusCommand = new FilterLogEventsCommand({
      logGroupName: prometheusLogGroup,
      startTime: oneHourAgo,
      limit: 10,
    });

    const prometheusResponse = await logsClient.send(prometheusCommand);
    const prometheusEvents = prometheusResponse.events || [];

    // Get recent Grafana logs
    const grafanaCommand = new FilterLogEventsCommand({
      logGroupName: grafanaLogGroup,
      startTime: oneHourAgo,
      limit: 10,
    });

    const grafanaResponse = await logsClient.send(grafanaCommand);
    const grafanaEvents = grafanaResponse.events || [];

    if (prometheusEvents.length === 0) {
      return {
        name: "Service Startup Order",
        status: "warning",
        message: "No recent Prometheus logs found in the last hour",
        remediation:
          "Prometheus may not have started yet. Check ECS service deployment status.",
      };
    }

    if (grafanaEvents.length === 0) {
      return {
        name: "Service Startup Order",
        status: "warning",
        message: "No recent Grafana logs found in the last hour",
        remediation:
          "Grafana may not have started yet. Check ECS service deployment status.",
      };
    }

    const prometheusStartTime =
      prometheusEvents[0]?.timestamp || Number.MAX_SAFE_INTEGER;
    const grafanaStartTime =
      grafanaEvents[0]?.timestamp || Number.MAX_SAFE_INTEGER;

    if (grafanaStartTime < prometheusStartTime) {
      return {
        name: "Service Startup Order",
        status: "warning",
        message:
          "Grafana may have started before Prometheus, causing initial connection failures",
        details: `Grafana started: ${new Date(
          grafanaStartTime
        ).toISOString()}\nPrometheus started: ${new Date(
          prometheusStartTime
        ).toISOString()}`,
        remediation:
          "Restart Grafana service to re-establish connection: aws ecs update-service --cluster <cluster> --service grafana --force-new-deployment",
      };
    }

    return {
      name: "Service Startup Order",
      status: "passed",
      message:
        "Prometheus started before Grafana (or at similar time), which is correct",
    };
  } catch (error: any) {
    return {
      name: "Service Startup Order",
      status: "warning",
      message: `Could not verify startup order: ${error.message}`,
    };
  }
}

// ============================================================================
// MAIN VERIFICATION
// ============================================================================

async function verifyGrafanaPrometheusConnectivity(
  config: ConnectivityVerificationConfig
): Promise<VerificationResults> {
  Logger.section(
    `Grafana-Prometheus Connectivity Verification - ${config.environment}`
  );

  const results: VerificationResults = {
    checks: [],
    prometheusInfo: { containerRunning: false },
    grafanaInfo: { containerRunning: false },
    overallStatus: "unhealthy",
  };

  // Create AWS clients
  Logger.subsection("Initialising AWS clients...");
  const clients = await createClients(config.region, config.profile);

  // Get account info
  try {
    const identityCommand = new GetCallerIdentityCommand({});
    const identity = await clients.sts.send(identityCommand);
    Logger.info(`AWS Account: ${identity.Account}`);
    Logger.info(`Region: ${config.region}`);
    Logger.info(`Environment: ${config.environment}`);
    console.log("");
  } catch (error: any) {
    Logger.warning(`Could not get account identity: ${error.message}`);
  }

  // Get cluster name
  Logger.subsection("Step 1: Retrieving cluster information...");
  const clusterName = await getClusterName(clients.ssm, config.environment);

  if (!clusterName) {
    results.checks.push({
      name: "Cluster Discovery",
      status: "failed",
      message: "Could not retrieve ECS cluster name from SSM",
      remediation:
        "Ensure MonitoringInfraStack is deployed and SSM parameter exists: " +
        `/monitoring/${config.environment}/infra/config/cluster-name`,
    });
    return results;
  }

  Logger.success(`Cluster: ${clusterName}`);
  console.log("");

  // Get EC2 instance info
  Logger.subsection("Step 2: Retrieving EC2 instance information...");
  const instanceInfo = await getEC2InstanceInfo(
    clients.ecs,
    clients.ec2,
    clusterName
  );

  if (!instanceInfo) {
    results.checks.push({
      name: "EC2 Instance Discovery",
      status: "failed",
      message: "Could not retrieve EC2 instance information",
      remediation:
        "Ensure ECS cluster has registered container instances. " +
        "Check Auto Scaling Group and EC2 instance health.",
    });
    return results;
  }

  Logger.success(`Instance ID: ${instanceInfo.instanceId}`);
  Logger.info(`Private IP: ${instanceInfo.privateIp}`);
  Logger.info(`Security Groups: ${instanceInfo.securityGroupIds.join(", ")}`);
  console.log("");

  // Check Prometheus service
  Logger.subsection("Step 3: Checking Prometheus service...");
  results.prometheusInfo = await getPrometheusServiceInfo(
    clients.ecs,
    clusterName,
    config.environment
  );

  if (!results.prometheusInfo.containerRunning) {
    results.checks.push({
      name: "Prometheus Service",
      status: "failed",
      message: `Prometheus service is not running (status: ${
        results.prometheusInfo.lastStatus || "unknown"
      })`,
      remediation:
        "Check Prometheus ECS service deployment status. " +
        "View CloudWatch logs: /aws/ecs/development-prometheus",
    });
    Logger.error(
      `Prometheus not running (status: ${
        results.prometheusInfo.lastStatus || "unknown"
      })`
    );
  } else {
    Logger.success("Prometheus container is running");
    Logger.info(`Network Mode: ${results.prometheusInfo.networkMode}`);
    Logger.info(
      `Port Mappings: ${JSON.stringify(results.prometheusInfo.portMappings)}`
    );
  }
  console.log("");

  // Check Grafana service
  Logger.subsection("Step 4: Checking Grafana service...");
  results.grafanaInfo = await getGrafanaServiceInfo(
    clients.ecs,
    clusterName,
    config.environment
  );

  if (!results.grafanaInfo.containerRunning) {
    results.checks.push({
      name: "Grafana Service",
      status: "failed",
      message: `Grafana service is not running (status: ${
        results.grafanaInfo.lastStatus || "unknown"
      })`,
      remediation:
        "Check Grafana ECS service deployment status. " +
        "View CloudWatch logs: /aws/ecs/development-grafana",
    });
    Logger.error(
      `Grafana not running (status: ${
        results.grafanaInfo.lastStatus || "unknown"
      })`
    );
  } else {
    Logger.success("Grafana container is running");
    Logger.info(`Network Mode: ${results.grafanaInfo.networkMode}`);
  }
  console.log("");

  // Check network mode configuration
  Logger.subsection("Step 5: Verifying network mode configuration...");
  const networkModeCheck = await checkContainerNetworkMode(
    results.prometheusInfo,
    results.grafanaInfo
  );
  results.checks.push(networkModeCheck);
  logCheckResult(networkModeCheck);
  console.log("");

  // Check port mappings
  Logger.subsection("Step 6: Verifying port mappings...");
  const portMappingCheck = await checkPortMappings(results.prometheusInfo);
  results.checks.push(portMappingCheck);
  logCheckResult(portMappingCheck);
  console.log("");

  // Check security group rules
  Logger.subsection("Step 7: Checking security group rules...");
  const sgCheck = await checkSecurityGroupRules(
    clients.ec2,
    instanceInfo.securityGroupIds,
    instanceInfo.privateIp
  );
  results.checks.push(sgCheck);
  logCheckResult(sgCheck);
  console.log("");

  // Check datasource configuration
  Logger.subsection("Step 8: Verifying Grafana datasource configuration...");
  const datasourceCheck = await checkDatasourceConfiguration(
    clients.ssm,
    instanceInfo.instanceId,
    instanceInfo.privateIp,
    config.environment
  );
  results.checks.push(datasourceCheck);
  logCheckResult(datasourceCheck);
  console.log("");

  // Check Prometheus accessibility
  Logger.subsection("Step 9: Testing Prometheus accessibility...");
  const accessibilityCheck = await checkPrometheusAccessibility(
    clients.ssm,
    instanceInfo.instanceId,
    instanceInfo.privateIp
  );
  results.checks.push(accessibilityCheck);
  logCheckResult(accessibilityCheck);
  console.log("");

  // Check service startup order
  Logger.subsection("Step 10: Checking service startup order...");
  const startupOrderCheck = await checkServiceStartupOrder(
    clients.logs,
    config.environment
  );
  results.checks.push(startupOrderCheck);
  logCheckResult(startupOrderCheck);
  console.log("");

  // Determine overall status
  const failedChecks = results.checks.filter((c) => c.status === "failed");
  const warningChecks = results.checks.filter((c) => c.status === "warning");

  if (failedChecks.length === 0 && warningChecks.length === 0) {
    results.overallStatus = "healthy";
  } else if (failedChecks.length === 0) {
    results.overallStatus = "degraded";
  } else {
    results.overallStatus = "unhealthy";
  }

  return results;
}

function logCheckResult(check: CheckResult): void {
  switch (check.status) {
    case "passed":
      Logger.success(`✓ ${check.name}: ${check.message}`);
      break;
    case "failed":
      Logger.error(`✗ ${check.name}: ${check.message}`);
      break;
    case "warning":
      Logger.warning(`⚠ ${check.name}: ${check.message}`);
      break;
  }

  if (check.details && check.details.length > 0) {
    console.log("");
    console.log("Details:");
    console.log("─".repeat(60));
    console.log(check.details);
    console.log("─".repeat(60));
  }

  if (check.remediation) {
    console.log("");
    Logger.info("Remediation:");
    console.log(check.remediation);
  }
}

// ============================================================================
// CLI
// ============================================================================

program
  .name("verify-grafana-prometheus-connectivity")
  .description(
    "Verify Grafana-Prometheus connectivity and diagnose connection issues"
  )
  .option(
    "-e, --environment <env>",
    "Environment name (development|staging|production|pipeline)",
    "development"
  )
  .option(
    "-r, --region <region>",
    "AWS region (default: eu-west-1)",
    "eu-west-1"
  )
  .option("-p, --profile <profile>", "AWS CLI profile")
  .option("-v, --verbose", "Enable verbose output", false)
  .parse();

const options = program.opts();

// Validate environment
if (!VALID_ENVIRONMENTS.includes(options.environment)) {
  Logger.error(`Invalid environment: ${options.environment}`);
  Logger.info(`Valid environments: ${VALID_ENVIRONMENTS.join(", ")}`);
  process.exit(2);
}

const config: ConnectivityVerificationConfig = {
  environment: options.environment,
  region: options.region,
  profile: options.profile,
  verbose: options.verbose || false,
};

verifyGrafanaPrometheusConnectivity(config)
  .then((results) => {
    // Print summary
    Logger.section("VERIFICATION SUMMARY");

    const passedCount = results.checks.filter(
      (c) => c.status === "passed"
    ).length;
    const failedCount = results.checks.filter(
      (c) => c.status === "failed"
    ).length;
    const warningCount = results.checks.filter(
      (c) => c.status === "warning"
    ).length;

    console.log(`Total Checks: ${results.checks.length}`);
    console.log(`✅ Passed: ${passedCount}`);
    if (warningCount > 0) {
      console.log(`⚠️  Warnings: ${warningCount}`);
    }
    if (failedCount > 0) {
      console.log(`❌ Failed: ${failedCount}`);
    }
    console.log("");

    console.log(`Overall Status: ${results.overallStatus.toUpperCase()}`);
    console.log("");

    // Print failed checks with remediation
    if (failedCount > 0) {
      Logger.subsection("Failed Checks - Action Required:");
      results.checks
        .filter((c) => c.status === "failed")
        .forEach((check, index) => {
          console.log(`\n${index + 1}. ${check.name}`);
          console.log(`   Issue: ${check.message}`);
          if (check.remediation) {
            console.log(
              `   Action: ${check.remediation.replace(/\n/g, "\n           ")}`
            );
          }
        });
      console.log("");
    }

    // Print warning checks
    if (warningCount > 0) {
      Logger.subsection("Warnings - Review Recommended:");
      results.checks
        .filter((c) => c.status === "warning")
        .forEach((check, index) => {
          console.log(`\n${index + 1}. ${check.name}`);
          console.log(`   Warning: ${check.message}`);
          if (check.remediation) {
            console.log(
              `   Suggestion: ${check.remediation.replace(
                /\n/g,
                "\n               "
              )}`
            );
          }
        });
      console.log("");
    }

    // Exit with appropriate code
    if (results.overallStatus === "unhealthy") {
      Logger.error(
        "CONNECTIVITY VERIFICATION FAILED - Critical issues detected"
      );
      process.exit(1);
    } else if (results.overallStatus === "degraded") {
      Logger.warning(
        "CONNECTIVITY VERIFICATION PASSED WITH WARNINGS - Review recommended"
      );
      process.exit(0);
    } else {
      Logger.success(
        "CONNECTIVITY VERIFICATION PASSED - All checks successful"
      );
      process.exit(0);
    }
  })
  .catch((error) => {
    Logger.error(`Verification failed: ${error.message}`);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  });
