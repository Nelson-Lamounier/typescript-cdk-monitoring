#!/usr/bin/env node
/** @format */

/**
 * Prometheus Health Check Verification Script
 *
 * This script verifies Prometheus health check configuration and connectivity
 * during pipeline deployments. It performs comprehensive checks to identify
 * common failure scenarios:
 *
 * 1. ECS Task Status - Verifies tasks are running and healthy
 * 2. Container Health - Checks container-level health status
 * 3. ALB Target Health - Validates target group health check configuration
 * 4. Health Check Path - Confirms correct path configuration (/prometheus/-/healthy)
 * 5. Security Group Rules - Verifies ALB can reach the container
 * 6. Direct Endpoint Testing - Tests health endpoints via SSM
 *
 * Usage:
 *   npx ts-node scripts/integration/deployment/monitoring/verify-prometheus-health.ts \
 *     --environment development \
 *     --region eu-west-1 \
 *     [--profile dev-account] \
 *     [--verbose] \
 *     [--blocking]
 */

import { program } from "commander";
import {
  ECSClient,
  ListTasksCommand,
  DescribeTasksCommand,
  DescribeServicesCommand,
  DescribeContainerInstancesCommand,
} from "@aws-sdk/client-ecs";
import {
  ElasticLoadBalancingV2Client,
  DescribeTargetHealthCommand,
  DescribeTargetGroupsCommand,
  DescribeLoadBalancersCommand,
} from "@aws-sdk/client-elastic-load-balancing-v2";
import {
  EC2Client,
  DescribeSecurityGroupsCommand,
} from "@aws-sdk/client-ec2";
import {
  SSMClient,
  SendCommandCommand,
  GetCommandInvocationCommand,
  DescribeInstanceInformationCommand,
} from "@aws-sdk/client-ssm";
import {
  CloudFormationClient,
  DescribeStacksCommand,
} from "@aws-sdk/client-cloudformation";
import { Logger } from "../utils/logger";

// Constants
const PROMETHEUS_PORT = 9090;
const EXPECTED_HEALTH_CHECK_PATH = "/prometheus/-/healthy";
const HEALTH_CHECK_TIMEOUT_SECONDS = 10;

interface VerifyPrometheusHealthConfig {
  profile?: string;
  region: string;
  environment: string;
  verbose?: boolean;
  blocking?: boolean;
  maxRetries?: number;
  retryIntervalSeconds?: number;
}

interface PrometheusHealthState {
  taskStatus: {
    serviceName: string;
    desiredCount: number;
    runningCount: number;
    pendingCount: number;
    tasks: Array<{
      taskArn: string;
      lastStatus: string;
      healthStatus?: string;
      stoppedReason?: string;
      containerStatuses: Array<{
        name: string;
        lastStatus: string;
        healthStatus?: string;
        exitCode?: number;
        reason?: string;
      }>;
    }>;
  };
  targetGroupHealth: {
    name: string;
    arn: string;
    healthCheckPath: string;
    healthCheckPort: string;
    healthCheckProtocol: string;
    targets: Array<{
      id: string;
      port: number;
      health: string;
      reason?: string;
      description?: string;
    }>;
  } | null;
  securityGroupAnalysis: {
    albSecurityGroups: string[];
    instanceSecurityGroups: string[];
    prometheusPortAllowed: boolean;
    issues: string[];
  };
  endpointTests: {
    localHealthCheck: {
      tested: boolean;
      success: boolean;
      httpCode?: string;
      error?: string;
    };
    routePrefixHealthCheck: {
      tested: boolean;
      success: boolean;
      httpCode?: string;
      error?: string;
    };
  };
  configurationIssues: string[];
  criticalErrors: string[];
  warnings: string[];
  isHealthy: boolean;
}

function sleep(seconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

async function createClients(config: VerifyPrometheusHealthConfig): Promise<{
  ecs: ECSClient;
  elbv2: ElasticLoadBalancingV2Client;
  ec2: EC2Client;
  ssm: SSMClient;
  cfn: CloudFormationClient;
}> {
  const clientConfig: { region: string } = { region: config.region };

  const isOidcAuth = !!process.env.AWS_SESSION_TOKEN;

  if (config.profile && !isOidcAuth) {
    process.env.AWS_PROFILE = config.profile;
    Logger.info(`Using AWS profile: ${config.profile}`);
  } else if (isOidcAuth) {
    delete process.env.AWS_PROFILE;
    Logger.info("Using OIDC credentials from environment");
  }

  return {
    ecs: new ECSClient(clientConfig),
    elbv2: new ElasticLoadBalancingV2Client(clientConfig),
    ec2: new EC2Client(clientConfig),
    ssm: new SSMClient(clientConfig),
    cfn: new CloudFormationClient(clientConfig),
  };
}

async function getStackOutputs(
  cfnClient: CloudFormationClient,
  stackName: string
): Promise<Record<string, string>> {
  try {
    const command = new DescribeStacksCommand({ StackName: stackName });
    const response = await cfnClient.send(command);
    const stack = response.Stacks?.[0];

    if (!stack) {
      return {};
    }

    const outputs: Record<string, string> = {};
    stack.Outputs?.forEach((output) => {
      if (output.OutputKey && output.OutputValue) {
        outputs[output.OutputKey] = output.OutputValue;
      }
    });

    return outputs;
  } catch (error: any) {
    if (error.name === "ValidationError" || error.message?.includes("does not exist")) {
      Logger.warning(`Stack ${stackName} not found`);
      return {};
    }
    throw error;
  }
}

async function checkEcsTaskStatus(
  ecsClient: ECSClient,
  clusterName: string,
  serviceName: string,
  config: VerifyPrometheusHealthConfig
): Promise<PrometheusHealthState["taskStatus"]> {
  const result: PrometheusHealthState["taskStatus"] = {
    serviceName,
    desiredCount: 0,
    runningCount: 0,
    pendingCount: 0,
    tasks: [],
  };

  try {
    // Get service details
    const serviceResponse = await ecsClient.send(
      new DescribeServicesCommand({
        cluster: clusterName,
        services: [serviceName],
      })
    );

    const service = serviceResponse.services?.[0];
    if (!service) {
      Logger.warning(`Service ${serviceName} not found in cluster ${clusterName}`);
      return result;
    }

    result.desiredCount = service.desiredCount ?? 0;
    result.runningCount = service.runningCount ?? 0;
    result.pendingCount = service.pendingCount ?? 0;

    // List tasks for the service
    const tasksResponse = await ecsClient.send(
      new ListTasksCommand({
        cluster: clusterName,
        serviceName,
      })
    );

    const taskArns = tasksResponse.taskArns ?? [];
    if (taskArns.length === 0) {
      Logger.warning("No tasks found for Prometheus service");
      return result;
    }

    // Describe tasks
    const describeResponse = await ecsClient.send(
      new DescribeTasksCommand({
        cluster: clusterName,
        tasks: taskArns,
      })
    );

    for (const task of describeResponse.tasks ?? []) {
      const taskInfo = {
        taskArn: task.taskArn ?? "unknown",
        lastStatus: task.lastStatus ?? "UNKNOWN",
        healthStatus: task.healthStatus,
        stoppedReason: task.stoppedReason,
        containerStatuses:
          task.containers?.map((container) => ({
            name: container.name ?? "unknown",
            lastStatus: container.lastStatus ?? "UNKNOWN",
            healthStatus: container.healthStatus,
            exitCode: container.exitCode,
            reason: container.reason,
          })) ?? [],
      };

      result.tasks.push(taskInfo);

      if (config.verbose) {
        Logger.info(`Task ${task.taskArn?.split("/").pop()}: ${task.lastStatus}`);
        task.containers?.forEach((container) => {
          Logger.info(
            `  Container ${container.name}: ${container.lastStatus}` +
              (container.healthStatus ? ` (health: ${container.healthStatus})` : "") +
              (container.exitCode !== undefined ? ` (exit: ${container.exitCode})` : "") +
              (container.reason ? ` - ${container.reason}` : "")
          );
        });
      }
    }

    // Also check for stopped tasks to understand failure reasons
    const stoppedTasksResponse = await ecsClient.send(
      new ListTasksCommand({
        cluster: clusterName,
        serviceName,
        desiredStatus: "STOPPED",
      })
    );

    if ((stoppedTasksResponse.taskArns?.length ?? 0) > 0) {
      const stoppedDescribe = await ecsClient.send(
        new DescribeTasksCommand({
          cluster: clusterName,
          tasks: stoppedTasksResponse.taskArns?.slice(0, 5) ?? [],
        })
      );

      for (const task of stoppedDescribe.tasks ?? []) {
        if (task.stoppedReason) {
          Logger.warning(`Stopped task reason: ${task.stoppedReason}`);
          result.tasks.push({
            taskArn: task.taskArn ?? "unknown",
            lastStatus: "STOPPED",
            stoppedReason: task.stoppedReason,
            containerStatuses:
              task.containers?.map((container) => ({
                name: container.name ?? "unknown",
                lastStatus: container.lastStatus ?? "STOPPED",
                exitCode: container.exitCode,
                reason: container.reason,
              })) ?? [],
          });
        }
      }
    }
  } catch (error: any) {
    Logger.error(`Failed to check ECS task status: ${error.message}`);
  }

  return result;
}

async function checkTargetGroupHealth(
  elbv2Client: ElasticLoadBalancingV2Client,
  environment: string,
  config: VerifyPrometheusHealthConfig
): Promise<PrometheusHealthState["targetGroupHealth"]> {
  try {
    // Find Prometheus target group
    const tgPatterns = [
      `${environment}-monitoring-prom`,
      `${environment}-prometheus`,
    ];

    let targetGroup: any = null;
    for (const pattern of tgPatterns) {
      const response = await elbv2Client.send(
        new DescribeTargetGroupsCommand({
          Names: [pattern],
        })
      ).catch(() => null);

      if (response?.TargetGroups?.[0]) {
        targetGroup = response.TargetGroups[0];
        break;
      }
    }

    if (!targetGroup) {
      // Try searching by tag or listing all
      const allTgs = await elbv2Client.send(new DescribeTargetGroupsCommand({}));
      targetGroup = allTgs.TargetGroups?.find((tg) =>
        tg.TargetGroupName?.includes("prom") || tg.TargetGroupName?.includes("prometheus")
      );
    }

    if (!targetGroup) {
      Logger.warning("Prometheus target group not found");
      return null;
    }

    Logger.info(`Found target group: ${targetGroup.TargetGroupName}`);

    // Get target health
    const healthResponse = await elbv2Client.send(
      new DescribeTargetHealthCommand({
        TargetGroupArn: targetGroup.TargetGroupArn,
      })
    );

    const result: PrometheusHealthState["targetGroupHealth"] = {
      name: targetGroup.TargetGroupName ?? "unknown",
      arn: targetGroup.TargetGroupArn ?? "unknown",
      healthCheckPath: targetGroup.HealthCheckPath ?? "/",
      healthCheckPort: targetGroup.HealthCheckPort ?? "traffic-port",
      healthCheckProtocol: targetGroup.HealthCheckProtocol ?? "HTTP",
      targets:
        healthResponse.TargetHealthDescriptions?.map((desc) => ({
          id: desc.Target?.Id ?? "unknown",
          port: desc.Target?.Port ?? 0,
          health: desc.TargetHealth?.State ?? "unknown",
          reason: desc.TargetHealth?.Reason,
          description: desc.TargetHealth?.Description,
        })) ?? [],
    };

    if (config.verbose) {
      Logger.keyValue("Health Check Path", result.healthCheckPath);
      Logger.keyValue("Health Check Port", result.healthCheckPort);
      result.targets.forEach((target) => {
        const status = target.health === "healthy" ? "HEALTHY" : target.health.toUpperCase();
        Logger.info(
          `  Target ${target.id}:${target.port} - ${status}` +
            (target.reason ? ` (${target.reason})` : "") +
            (target.description ? ` - ${target.description}` : "")
        );
      });
    }

    return result;
  } catch (error: any) {
    Logger.error(`Failed to check target group health: ${error.message}`);
    return null;
  }
}

async function checkSecurityGroups(
  ec2Client: EC2Client,
  elbv2Client: ElasticLoadBalancingV2Client,
  environment: string,
  config: VerifyPrometheusHealthConfig
): Promise<PrometheusHealthState["securityGroupAnalysis"]> {
  const result: PrometheusHealthState["securityGroupAnalysis"] = {
    albSecurityGroups: [],
    instanceSecurityGroups: [],
    prometheusPortAllowed: false,
    issues: [],
  };

  try {
    // Find ALB
    const lbPatterns = [
      `${environment}-monitoring-alb`,
      `${environment}-alb`,
    ];

    let loadBalancer: any = null;
    for (const pattern of lbPatterns) {
      const response = await elbv2Client.send(
        new DescribeLoadBalancersCommand({
          Names: [pattern],
        })
      ).catch(() => null);

      if (response?.LoadBalancers?.[0]) {
        loadBalancer = response.LoadBalancers[0];
        break;
      }
    }

    if (!loadBalancer) {
      const allLbs = await elbv2Client.send(new DescribeLoadBalancersCommand({}));
      loadBalancer = allLbs.LoadBalancers?.find((lb) =>
        lb.LoadBalancerName?.includes(environment)
      );
    }

    if (loadBalancer?.SecurityGroups) {
      result.albSecurityGroups = loadBalancer.SecurityGroups;

      // Check ALB security group rules
      const sgResponse = await ec2Client.send(
        new DescribeSecurityGroupsCommand({
          GroupIds: loadBalancer.SecurityGroups,
        })
      );

      for (const sg of sgResponse.SecurityGroups ?? []) {
        // Check egress rules for port 9090
        const hasEgressToPrometheus = sg.IpPermissionsEgress?.some((rule) => {
          if (rule.IpProtocol === "-1") return true; // All traffic
          if (rule.FromPort === undefined || rule.ToPort === undefined) return false;
          return rule.FromPort <= PROMETHEUS_PORT && rule.ToPort >= PROMETHEUS_PORT;
        });

        if (!hasEgressToPrometheus) {
          result.issues.push(
            `ALB security group ${sg.GroupId} may not allow egress to port ${PROMETHEUS_PORT}`
          );
        }
      }
    }

    if (config.verbose && result.issues.length > 0) {
      result.issues.forEach((issue) => Logger.warning(issue));
    }
  } catch (error: any) {
    Logger.warning(`Failed to analyse security groups: ${error.message}`);
  }

  return result;
}

async function testHealthEndpointsViaSSM(
  ssmClient: SSMClient,
  _ec2Client: EC2Client,
  ecsClient: ECSClient,
  clusterName: string,
  config: VerifyPrometheusHealthConfig
): Promise<PrometheusHealthState["endpointTests"]> {
  const result: PrometheusHealthState["endpointTests"] = {
    localHealthCheck: { tested: false, success: false },
    routePrefixHealthCheck: { tested: false, success: false },
  };

  try {
    // Get container instance
    const tasksResponse = await ecsClient.send(
      new ListTasksCommand({
        cluster: clusterName,
        desiredStatus: "RUNNING",
      })
    );

    if (!tasksResponse.taskArns?.length) {
      Logger.warning("No running tasks found - cannot test endpoints");
      return result;
    }

    const describeResponse = await ecsClient.send(
      new DescribeTasksCommand({
        cluster: clusterName,
        tasks: [tasksResponse.taskArns[0]],
      })
    );

    const task = describeResponse.tasks?.[0];
    if (!task?.containerInstanceArn) {
      Logger.warning("No container instance found for task");
      return result;
    }

    // Get EC2 instance ID from container instance
    const containerInstanceResponse = await ecsClient.send(
      new DescribeContainerInstancesCommand({
        cluster: clusterName,
        containerInstances: [task.containerInstanceArn],
      })
    );

    const instanceId = containerInstanceResponse.containerInstances?.[0]?.ec2InstanceId;
    if (!instanceId) {
      Logger.warning("Could not get EC2 instance ID from container instance");
      return result;
    }

    // Check if instance is reachable via SSM
    const ssmInfoResponse = await ssmClient.send(
      new DescribeInstanceInformationCommand({
        Filters: [{ Key: "InstanceIds", Values: [instanceId] }],
      })
    );

    const isOnline = ssmInfoResponse.InstanceInformationList?.some(
      (info) => info.PingStatus === "Online"
    );

    if (!isOnline) {
      Logger.warning(`Instance ${instanceId} is not reachable via SSM`);
      return result;
    }

    Logger.info(`Testing health endpoints on instance ${instanceId}`);

    // Test local health check (/-/healthy on localhost:9090)
    try {
      result.localHealthCheck.tested = true;
      const localCmd = await ssmClient.send(
        new SendCommandCommand({
          InstanceIds: [instanceId],
          DocumentName: "AWS-RunShellScript",
          Parameters: {
            commands: [
              `curl -s -o /dev/null -w "%{http_code}" --max-time ${HEALTH_CHECK_TIMEOUT_SECONDS} http://localhost:${PROMETHEUS_PORT}/-/healthy`,
            ],
          },
        })
      );

      await sleep(3);

      const localResult = await ssmClient.send(
        new GetCommandInvocationCommand({
          CommandId: localCmd.Command?.CommandId!,
          InstanceId: instanceId,
        })
      );

      result.localHealthCheck.httpCode = localResult.StandardOutputContent?.trim();
      result.localHealthCheck.success = result.localHealthCheck.httpCode === "200";

      if (config.verbose) {
        Logger.info(
          `Local health check (/-/healthy): ${result.localHealthCheck.httpCode} - ` +
            (result.localHealthCheck.success ? "SUCCESS" : "FAILED")
        );
      }
    } catch (error: any) {
      result.localHealthCheck.error = error.message;
      Logger.warning(`Local health check failed: ${error.message}`);
    }

    // Test route-prefix health check (/prometheus/-/healthy on localhost:9090)
    try {
      result.routePrefixHealthCheck.tested = true;
      const prefixCmd = await ssmClient.send(
        new SendCommandCommand({
          InstanceIds: [instanceId],
          DocumentName: "AWS-RunShellScript",
          Parameters: {
            commands: [
              `curl -s -o /dev/null -w "%{http_code}" --max-time ${HEALTH_CHECK_TIMEOUT_SECONDS} http://localhost:${PROMETHEUS_PORT}${EXPECTED_HEALTH_CHECK_PATH}`,
            ],
          },
        })
      );

      await sleep(3);

      const prefixResult = await ssmClient.send(
        new GetCommandInvocationCommand({
          CommandId: prefixCmd.Command?.CommandId!,
          InstanceId: instanceId,
        })
      );

      result.routePrefixHealthCheck.httpCode = prefixResult.StandardOutputContent?.trim();
      result.routePrefixHealthCheck.success = result.routePrefixHealthCheck.httpCode === "200";

      if (config.verbose) {
        Logger.info(
          `Route prefix health check (${EXPECTED_HEALTH_CHECK_PATH}): ` +
            `${result.routePrefixHealthCheck.httpCode} - ` +
            (result.routePrefixHealthCheck.success ? "SUCCESS" : "FAILED")
        );
      }
    } catch (error: any) {
      result.routePrefixHealthCheck.error = error.message;
      Logger.warning(`Route prefix health check failed: ${error.message}`);
    }
  } catch (error: any) {
    Logger.warning(`Endpoint testing failed: ${error.message}`);
  }

  return result;
}

function analyseConfiguration(
  state: PrometheusHealthState
): { issues: string[]; criticalErrors: string[]; warnings: string[] } {
  const issues: string[] = [];
  const criticalErrors: string[] = [];
  const warnings: string[] = [];

  // Check target group health check path
  if (state.targetGroupHealth) {
    const actualPath = state.targetGroupHealth.healthCheckPath;
    if (actualPath !== EXPECTED_HEALTH_CHECK_PATH) {
      criticalErrors.push(
        `Health check path mismatch: Expected "${EXPECTED_HEALTH_CHECK_PATH}", got "${actualPath}". ` +
          `ALB forwards the FULL path to the target. Prometheus is configured with --web.route-prefix=/prometheus, ` +
          `so it expects health checks at ${EXPECTED_HEALTH_CHECK_PATH}.`
      );
    }

    // Check if targets are unhealthy
    const unhealthyTargets = state.targetGroupHealth.targets.filter(
      (t) => t.health !== "healthy"
    );
    if (unhealthyTargets.length > 0) {
      for (const target of unhealthyTargets) {
        if (target.reason === "Target.FailedHealthChecks") {
          criticalErrors.push(
            `Target ${target.id}:${target.port} failed health checks. ` +
              `This usually means either: 1) Prometheus is not running, ` +
              `2) Health check path is incorrect, or 3) Security groups block port ${PROMETHEUS_PORT}.`
          );
        } else if (target.reason === "Target.NotRegistered") {
          warnings.push(
            `Target ${target.id} is not registered. ECS service may still be starting.`
          );
        } else if (target.reason === "Target.Timeout") {
          criticalErrors.push(
            `Target ${target.id}:${target.port} timed out. Check if Prometheus is responding on port ${PROMETHEUS_PORT}.`
          );
        } else {
          warnings.push(
            `Target ${target.id}:${target.port} is ${target.health}: ${target.reason ?? "unknown reason"}`
          );
        }
      }
    }
  }

  // Check ECS task status
  if (state.taskStatus.runningCount === 0) {
    criticalErrors.push(
      `No Prometheus tasks are running (desired: ${state.taskStatus.desiredCount}). ` +
        "Check ECS service events and task stopped reasons."
    );
  } else if (state.taskStatus.runningCount < state.taskStatus.desiredCount) {
    warnings.push(
      `Only ${state.taskStatus.runningCount}/${state.taskStatus.desiredCount} Prometheus tasks are running.`
    );
  }

  // Check for stopped tasks with reasons
  const stoppedTasks = state.taskStatus.tasks.filter(
    (t) => t.lastStatus === "STOPPED" && t.stoppedReason
  );
  for (const task of stoppedTasks) {
    issues.push(`Task stopped: ${task.stoppedReason}`);

    // Common failure reasons
    if (task.stoppedReason?.includes("Essential container")) {
      criticalErrors.push(
        "Essential container exited. Check CloudWatch Logs for Prometheus startup errors. " +
          "Common causes: missing prometheus.yml config file, invalid configuration, or missing EFS mount."
      );
    }
    if (task.stoppedReason?.includes("OutOfMemory")) {
      criticalErrors.push(
        "Container ran out of memory. Consider increasing memoryMiB in Prometheus configuration."
      );
    }
  }

  // Check container exit codes
  for (const task of state.taskStatus.tasks) {
    for (const container of task.containerStatuses) {
      if (container.exitCode !== undefined && container.exitCode !== 0) {
        criticalErrors.push(
          `Container ${container.name} exited with code ${container.exitCode}. ` +
            (container.reason ? `Reason: ${container.reason}` : "Check CloudWatch Logs for details.")
        );
      }
    }
  }

  // Check endpoint test results
  if (state.endpointTests.localHealthCheck.tested) {
    if (!state.endpointTests.localHealthCheck.success) {
      if (state.endpointTests.routePrefixHealthCheck.success) {
        // This is actually expected when route prefix is configured
        issues.push(
          `Local /-/healthy returns ${state.endpointTests.localHealthCheck.httpCode} ` +
            `but ${EXPECTED_HEALTH_CHECK_PATH} returns 200. This is correct when using --web.route-prefix=/prometheus.`
        );
      } else if (state.endpointTests.localHealthCheck.httpCode === "000") {
        criticalErrors.push(
          "Prometheus is not responding on port 9090. Container may not be running or is still starting."
        );
      }
    }
  }

  if (
    state.endpointTests.routePrefixHealthCheck.tested &&
    !state.endpointTests.routePrefixHealthCheck.success
  ) {
    if (state.endpointTests.routePrefixHealthCheck.httpCode === "404") {
      criticalErrors.push(
        `${EXPECTED_HEALTH_CHECK_PATH} returns 404. Prometheus may not be configured with --web.route-prefix=/prometheus. ` +
          "Check the Prometheus command arguments in the task definition."
      );
    } else if (state.endpointTests.routePrefixHealthCheck.httpCode === "000") {
      criticalErrors.push(
        "Prometheus is not responding. Container may not be running."
      );
    }
  }

  // Check security group issues
  if (state.securityGroupAnalysis.issues.length > 0) {
    warnings.push(...state.securityGroupAnalysis.issues);
  }

  return { issues, criticalErrors, warnings };
}

async function verifyPrometheusHealth(
  config: VerifyPrometheusHealthConfig
): Promise<PrometheusHealthState> {
  Logger.section(`Prometheus Health Check Verification - ${config.environment}`);

  const clients = await createClients(config);

  // Get stack outputs
  const infraStackName = `${config.environment}-MonitoringInfra`;
  const serviceStackName = `${config.environment}-MonitoringService`;

  const infraOutputs = await getStackOutputs(clients.cfn, infraStackName);
  const serviceOutputs = await getStackOutputs(clients.cfn, serviceStackName);

  const clusterName = infraOutputs.ClusterName;
  const prometheusServiceArn = serviceOutputs.PrometheusServiceArn;

  if (!clusterName) {
    throw new Error(
      `Cluster name not found in stack ${infraStackName}. ` +
        "Ensure MonitoringInfra stack has been deployed successfully."
    );
  }

  // Extract service name from ARN or use default
  const serviceName = prometheusServiceArn
    ? prometheusServiceArn.split("/").pop()
    : `${config.environment}-prometheus`;

  Logger.keyValue("Cluster Name", clusterName);
  Logger.keyValue("Service Name", serviceName ?? "unknown");
  console.log("");

  // Initialize state
  const state: PrometheusHealthState = {
    taskStatus: {
      serviceName: serviceName ?? "unknown",
      desiredCount: 0,
      runningCount: 0,
      pendingCount: 0,
      tasks: [],
    },
    targetGroupHealth: null,
    securityGroupAnalysis: {
      albSecurityGroups: [],
      instanceSecurityGroups: [],
      prometheusPortAllowed: false,
      issues: [],
    },
    endpointTests: {
      localHealthCheck: { tested: false, success: false },
      routePrefixHealthCheck: { tested: false, success: false },
    },
    configurationIssues: [],
    criticalErrors: [],
    warnings: [],
    isHealthy: false,
  };

  // Step 1: Check ECS Task Status
  Logger.subsection("1. ECS Task Status");
  state.taskStatus = await checkEcsTaskStatus(
    clients.ecs,
    clusterName,
    serviceName ?? `${config.environment}-prometheus`,
    config
  );

  if (state.taskStatus.runningCount > 0) {
    Logger.success(
      `${state.taskStatus.runningCount}/${state.taskStatus.desiredCount} tasks running`
    );
  } else {
    Logger.error(
      `No tasks running (desired: ${state.taskStatus.desiredCount}, pending: ${state.taskStatus.pendingCount})`
    );
  }
  console.log("");

  // Step 2: Check Target Group Health
  Logger.subsection("2. ALB Target Group Health");
  state.targetGroupHealth = await checkTargetGroupHealth(
    clients.elbv2,
    config.environment,
    config
  );

  if (state.targetGroupHealth) {
    const healthyTargets = state.targetGroupHealth.targets.filter(
      (t) => t.health === "healthy"
    ).length;
    const totalTargets = state.targetGroupHealth.targets.length;

    if (healthyTargets === totalTargets && totalTargets > 0) {
      Logger.success(`All targets healthy (${healthyTargets}/${totalTargets})`);
    } else if (healthyTargets > 0) {
      Logger.warning(`Partial health: ${healthyTargets}/${totalTargets} targets healthy`);
    } else if (totalTargets > 0) {
      Logger.error(`No healthy targets (${totalTargets} registered)`);
    } else {
      Logger.warning("No targets registered yet");
    }

    // Validate health check path
    if (state.targetGroupHealth.healthCheckPath !== EXPECTED_HEALTH_CHECK_PATH) {
      Logger.error(
        `Health check path: ${state.targetGroupHealth.healthCheckPath} (expected: ${EXPECTED_HEALTH_CHECK_PATH})`
      );
    } else {
      Logger.success(`Health check path: ${state.targetGroupHealth.healthCheckPath}`);
    }
  } else {
    Logger.warning("Target group not found");
  }
  console.log("");

  // Step 3: Test Health Endpoints via SSM
  Logger.subsection("3. Health Endpoint Testing");
  if (state.taskStatus.runningCount > 0) {
    state.endpointTests = await testHealthEndpointsViaSSM(
      clients.ssm,
      clients.ec2,
      clients.ecs,
      clusterName,
      config
    );

    if (state.endpointTests.routePrefixHealthCheck.tested) {
      if (state.endpointTests.routePrefixHealthCheck.success) {
        Logger.success(`${EXPECTED_HEALTH_CHECK_PATH} returns 200`);
      } else {
        Logger.error(
          `${EXPECTED_HEALTH_CHECK_PATH} returns ${state.endpointTests.routePrefixHealthCheck.httpCode ?? "error"}`
        );
      }
    } else {
      Logger.warning("Could not test health endpoints via SSM");
    }
  } else {
    Logger.warning("Skipping endpoint tests - no running tasks");
  }
  console.log("");

  // Step 4: Security Group Analysis
  Logger.subsection("4. Security Group Analysis");
  state.securityGroupAnalysis = await checkSecurityGroups(
    clients.ec2,
    clients.elbv2,
    config.environment,
    config
  );

  if (state.securityGroupAnalysis.issues.length === 0) {
    Logger.success("No security group issues detected");
  } else {
    state.securityGroupAnalysis.issues.forEach((issue) => {
      Logger.warning(issue);
    });
  }
  console.log("");

  // Step 5: Configuration Analysis
  Logger.subsection("5. Configuration Analysis");
  const analysis = analyseConfiguration(state);
  state.configurationIssues = analysis.issues;
  state.criticalErrors = analysis.criticalErrors;
  state.warnings = analysis.warnings;

  // Determine overall health
  state.isHealthy =
    state.criticalErrors.length === 0 &&
    state.taskStatus.runningCount > 0 &&
    (state.targetGroupHealth?.targets.some((t) => t.health === "healthy") ?? false);

  // Summary
  Logger.section("Verification Summary");

  if (state.isHealthy) {
    Logger.success("Prometheus is healthy");
  } else {
    Logger.error("Prometheus is NOT healthy");
  }
  console.log("");

  if (state.criticalErrors.length > 0) {
    Logger.error(`Critical Errors (${state.criticalErrors.length}):`);
    state.criticalErrors.forEach((error, index) => {
      console.log(`  ${index + 1}. ${error}`);
    });
    console.log("");
  }

  if (state.warnings.length > 0) {
    Logger.warning(`Warnings (${state.warnings.length}):`);
    state.warnings.forEach((warning, index) => {
      console.log(`  ${index + 1}. ${warning}`);
    });
    console.log("");
  }

  if (state.configurationIssues.length > 0 && config.verbose) {
    Logger.info(`Configuration Notes (${state.configurationIssues.length}):`);
    state.configurationIssues.forEach((issue, index) => {
      console.log(`  ${index + 1}. ${issue}`);
    });
    console.log("");
  }

  // Troubleshooting guidance
  if (!state.isHealthy) {
    Logger.section("Troubleshooting Steps");

    console.log("1. Check CloudWatch Logs for Prometheus startup errors:");
    Logger.code(
      `aws logs tail /ecs/${config.environment}-prometheus --follow --profile ${config.profile ?? "default"}`
    );
    console.log("");

    console.log("2. Check ECS service events:");
    Logger.code(
      `aws ecs describe-services --cluster ${clusterName} --services ${serviceName} ` +
        `--query 'services[0].events[:5]' --profile ${config.profile ?? "default"}`
    );
    console.log("");

    console.log("3. Verify Prometheus config exists on EFS:");
    Logger.code("# Connect via SSM Session Manager and check:");
    Logger.code("cat /mnt/efs/config/prometheus/prometheus.yml");
    console.log("");

    console.log("4. Test health endpoint directly on instance:");
    Logger.code(`curl -v http://localhost:${PROMETHEUS_PORT}${EXPECTED_HEALTH_CHECK_PATH}`);
    console.log("");
  }

  return state;
}

// CLI
program
  .name("verify-prometheus-health")
  .description("Verify Prometheus health check configuration and connectivity")
  .option(
    "-e, --environment <env>",
    "Environment name (default: development)",
    "development"
  )
  .option(
    "-r, --region <region>",
    "AWS region (default: eu-west-1)",
    "eu-west-1"
  )
  .option("-p, --profile <profile>", "AWS CLI profile")
  .option("-v, --verbose", "Enable verbose output", false)
  .option(
    "--blocking",
    "Exit with error if health checks fail (default: false)",
    false
  )
  .option(
    "--max-retries <retries>",
    "Maximum retries for health checks",
    "3"
  )
  .option(
    "--retry-interval <seconds>",
    "Seconds between retries",
    "30"
  )
  .parse();

const options = program.opts();

const config: VerifyPrometheusHealthConfig = {
  environment: options.environment,
  region: options.region,
  profile: options.profile,
  verbose: options.verbose || false,
  blocking: options.blocking || false,
  maxRetries: parseInt(options.maxRetries, 10) || 3,
  retryIntervalSeconds: parseInt(options.retryInterval, 10) || 30,
};

async function runWithRetries(): Promise<void> {
  let lastState: PrometheusHealthState | null = null;
  let attempts = 0;
  const maxAttempts = config.blocking ? config.maxRetries! : 1;

  while (attempts < maxAttempts) {
    attempts++;

    if (attempts > 1) {
      Logger.info(`Retry attempt ${attempts}/${maxAttempts}...`);
      await sleep(config.retryIntervalSeconds!);
    }

    lastState = await verifyPrometheusHealth(config);

    if (lastState.isHealthy) {
      Logger.success("Prometheus health verification passed");
      process.exit(0);
    }

    if (attempts < maxAttempts) {
      Logger.warning(
        `Health check failed. Retrying in ${config.retryIntervalSeconds} seconds...`
      );
    }
  }

  console.log("");

  if (config.blocking) {
    Logger.error("Prometheus health verification failed in blocking mode");
    process.exit(1);
  } else {
    Logger.warning("Prometheus health verification failed (non-blocking mode)");
    Logger.info("Pipeline will continue despite health check failures");
    Logger.info("Use --blocking flag to fail the pipeline on health check failures");
    process.exit(0);
  }
}

runWithRetries().catch((error) => {
  Logger.error(`Verification failed: ${error.message}`);
  if (config.blocking) {
    process.exit(1);
  } else {
    Logger.warning("Ignoring error in non-blocking mode");
    process.exit(0);
  }
});
