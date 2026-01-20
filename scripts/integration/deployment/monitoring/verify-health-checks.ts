#!/usr/bin/env node
/** @format */

// infrastructure/scripts/deployment/monitoring/verify-health-checks.ts

/**
 * Automated Health Check Verification Script
 * 
 * This script automates health check verification for the monitoring infrastructure,
 * specifically addressing common failure scenarios:
 * 
 * 1. SSM Agent connectivity issues
 * 2. ECS container instance registration delays
 * 3. ALB target health check configuration
 * 4. Service discovery and container networking
 * 
 * The script has a non-blocking mode to allow ServiceStack deployment even when
 * health checks fail, enabling better troubleshooting of deployment issues.
 */

import { program } from "commander";
import {
  ECSClient,

  ListContainerInstancesCommand,
  DescribeContainerInstancesCommand,
  ListTasksCommand,
  DescribeTasksCommand,
} from "@aws-sdk/client-ecs";
import {
  ElasticLoadBalancingV2Client,
  DescribeTargetHealthCommand,
  DescribeTargetGroupsCommand,
  DescribeLoadBalancersCommand,
} from "@aws-sdk/client-elastic-load-balancing-v2";
import {
  SSMClient,
  DescribeInstanceInformationCommand,

} from "@aws-sdk/client-ssm";
import {
  CloudFormationClient,
  DescribeStacksCommand,
} from "@aws-sdk/client-cloudformation";
import { STSClient,  } from "@aws-sdk/client-sts";

import { Logger } from "../utils/logger";

interface VerifyHealthChecksConfig {
  profile?: string;
  region: string;
  environment: string;
  verbose?: boolean;
  blocking?: boolean;  // If true, script exits with error on failures
  maxWaitMinutes?: number;  // Maximum time to wait for health checks
}

interface HealthCheckState {
  ssmAgentConnectivity: {
    total: number;
    reachable: number;
    unreachable: number;
    details: Array<{ instanceId: string; status: string; reason?: string }>;
  };
  ecsContainerInstances: {
    total: number;
    active: number;
    draining: number;
    inactive: number;
    details: Array<{ arn: string; status: string; runningTasks: number }>;
  };
  albTargetHealth: {
    targetGroups: Array<{
      name: string;
      arn: string;
      port: number;
      healthCheckPath: string;
      healthyTargets: number;
      unhealthyTargets: number;
      drainingTargets: number;
      details: Array<{
        targetId: string;
        port: number;
        health: string;
        reason?: string;
      }>;
    }>;
  };
  ecsTasks: {
    total: number;
    running: number;
    pending: number;
    stopped: number;
    details: Array<{
      taskArn: string;
      status: string;
      healthStatus?: string;
      containers: Array<{ name: string; status: string; healthStatus?: string }>;
    }>;
  };
  readinessScore: number;  // 0-100, indicates overall health
  criticalIssues: string[];
  warnings: string[];
}

async function createClients(config: VerifyHealthChecksConfig): Promise<{
  ecs: ECSClient;
  elbv2: ElasticLoadBalancingV2Client;
  ssm: SSMClient;
  cfn: CloudFormationClient;
  sts: STSClient;
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
    ssm: new SSMClient(clientConfig),
    cfn: new CloudFormationClient(clientConfig),
    sts: new STSClient(clientConfig),
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
    Logger.warning(`Could not retrieve stack outputs: ${error.message}`);
    return {};
  }
}

async function checkSsmAgentConnectivity(
  ssmClient: SSMClient,
  instanceIds: string[]
): Promise<HealthCheckState["ssmAgentConnectivity"]> {
  const result: HealthCheckState["ssmAgentConnectivity"] = {
    total: instanceIds.length,
    reachable: 0,
    unreachable: 0,
    details: [],
  };

  if (instanceIds.length === 0) {
    return result;
  }

  try {
    const command = new DescribeInstanceInformationCommand({
      Filters: [
        {
          Key: "InstanceIds",
          Values: instanceIds,
        },
      ],
    });

    const response = await ssmClient.send(command);
    const managedInstances = response.InstanceInformationList || [];

    instanceIds.forEach((instanceId) => {
      const managed = managedInstances.find(
        (info) => info.InstanceId === instanceId
      );

      if (managed && managed.PingStatus === "Online") {
        result.reachable++;
        result.details.push({
          instanceId,
          status: "Online",
        });
      } else if (managed) {
        result.unreachable++;
        result.details.push({
          instanceId,
          status: managed.PingStatus || "Unknown",
          reason: `Last ping: ${managed.LastPingDateTime?.toISOString()}`,
        });
      } else {
        result.unreachable++;
        result.details.push({
          instanceId,
          status: "Not Managed",
          reason: "Instance not registered with Systems Manager",
        });
      }
    });
  } catch (error: any) {
    Logger.warning(`SSM connectivity check failed: ${error.message}`);
    instanceIds.forEach((instanceId) => {
      result.unreachable++;
      result.details.push({
        instanceId,
        status: "Error",
        reason: error.message,
      });
    });
  }

  return result;
}

async function checkEcsContainerInstances(
  ecsClient: ECSClient,
  clusterName: string
): Promise<HealthCheckState["ecsContainerInstances"]> {
  const result: HealthCheckState["ecsContainerInstances"] = {
    total: 0,
    active: 0,
    draining: 0,
    inactive: 0,
    details: [],
  };

  try {
    const listCommand = new ListContainerInstancesCommand({
      cluster: clusterName,
    });
    const listResponse = await ecsClient.send(listCommand);

    const instanceArns = listResponse.containerInstanceArns || [];
    result.total = instanceArns.length;

    if (instanceArns.length === 0) {
      return result;
    }

    const describeCommand = new DescribeContainerInstancesCommand({
      cluster: clusterName,
      containerInstances: instanceArns,
    });
    const describeResponse = await ecsClient.send(describeCommand);

    const instances = describeResponse.containerInstances || [];

    instances.forEach((instance) => {
      const status = instance.status || "UNKNOWN";
      const runningTasks = instance.runningTasksCount || 0;

      if (status === "ACTIVE") {
        result.active++;
      } else if (status === "DRAINING") {
        result.draining++;
      } else {
        result.inactive++;
      }

      result.details.push({
        arn: instance.containerInstanceArn || "unknown",
        status,
        runningTasks,
      });
    });
  } catch (error: any) {
    Logger.warning(`ECS container instance check failed: ${error.message}`);
  }

  return result;
}

async function checkAlbTargetHealth(
  elbv2Client: ElasticLoadBalancingV2Client,
  albArn: string
): Promise<HealthCheckState["albTargetHealth"]> {
  const result: HealthCheckState["albTargetHealth"] = {
    targetGroups: [],
  };

  try {
    // Get all target groups for the ALB
    const tgCommand = new DescribeTargetGroupsCommand({
      LoadBalancerArn: albArn,
    });
    const tgResponse = await elbv2Client.send(tgCommand);

    const targetGroups = tgResponse.TargetGroups || [];

    for (const tg of targetGroups) {
      const healthCommand = new DescribeTargetHealthCommand({
        TargetGroupArn: tg.TargetGroupArn,
      });

      const healthResponse = await elbv2Client.send(healthCommand);
      const healthDescriptions = healthResponse.TargetHealthDescriptions || [];

      let healthy = 0;
      let unhealthy = 0;
      let draining = 0;

      const details = healthDescriptions.map((desc) => {
        const health = desc.TargetHealth?.State || "unknown";
        const reason = desc.TargetHealth?.Reason;

        if (health === "healthy") {
          healthy++;
        } else if (health === "draining") {
          draining++;
        } else {
          unhealthy++;
        }

        return {
          targetId: desc.Target?.Id || "unknown",
          port: desc.Target?.Port || 0,
          health,
          reason,
        };
      });

      result.targetGroups.push({
        name: tg.TargetGroupName || "unknown",
        arn: tg.TargetGroupArn || "unknown",
        port: tg.Port || 0,
        healthCheckPath: tg.HealthCheckPath || "/",
        healthyTargets: healthy,
        unhealthyTargets: unhealthy,
        drainingTargets: draining,
        details,
      });
    }
  } catch (error: any) {
    Logger.warning(`ALB target health check failed: ${error.message}`);
  }

  return result;
}

async function checkEcsTasks(
  ecsClient: ECSClient,
  clusterName: string
): Promise<HealthCheckState["ecsTasks"]> {
  const result: HealthCheckState["ecsTasks"] = {
    total: 0,
    running: 0,
    pending: 0,
    stopped: 0,
    details: [],
  };

  try {
    const listCommand = new ListTasksCommand({
      cluster: clusterName,
      desiredStatus: "RUNNING",
    });
    const listResponse = await ecsClient.send(listCommand);

    const taskArns = listResponse.taskArns || [];
    result.total = taskArns.length;

    if (taskArns.length === 0) {
      return result;
    }

    const describeCommand = new DescribeTasksCommand({
      cluster: clusterName,
      tasks: taskArns,
    });
    const describeResponse = await ecsClient.send(describeCommand);

    const tasks = describeResponse.tasks || [];

    tasks.forEach((task) => {
      const status = task.lastStatus || "UNKNOWN";
      const healthStatus = task.healthStatus;

      if (status === "RUNNING") {
        result.running++;
      } else if (status === "PENDING") {
        result.pending++;
      } else {
        result.stopped++;
      }

      result.details.push({
        taskArn: task.taskArn || "unknown",
        status,
        healthStatus,
        containers:
          task.containers?.map((container) => ({
            name: container.name || "unknown",
            status: container.lastStatus || "UNKNOWN",
            healthStatus: container.healthStatus,
          })) || [],
      });
    });
  } catch (error: any) {
    Logger.warning(`ECS task check failed: ${error.message}`);
  }

  return result;
}

function calculateReadinessScore(state: HealthCheckState): number {
  let score = 0;
  let maxScore = 0;

  // SSM Agent connectivity (20 points)
  maxScore += 20;
  if (state.ssmAgentConnectivity.total > 0) {
    score +=
      20 *
      (state.ssmAgentConnectivity.reachable / state.ssmAgentConnectivity.total);
  }

  // ECS container instances (30 points)
  maxScore += 30;
  if (state.ecsContainerInstances.total > 0) {
    score +=
      30 *
      (state.ecsContainerInstances.active / state.ecsContainerInstances.total);
  }

  // ALB target health (30 points)
  maxScore += 30;
  const totalTargets = state.albTargetHealth.targetGroups.reduce(
    (sum, tg) => sum + tg.healthyTargets + tg.unhealthyTargets + tg.drainingTargets,
    0
  );
  const healthyTargets = state.albTargetHealth.targetGroups.reduce(
    (sum, tg) => sum + tg.healthyTargets,
    0
  );
  if (totalTargets > 0) {
    score += 30 * (healthyTargets / totalTargets);
  }

  // ECS tasks (20 points)
  maxScore += 20;
  if (state.ecsTasks.total > 0) {
    score += 20 * (state.ecsTasks.running / state.ecsTasks.total);
  } else {
    // If no tasks expected yet (ServiceStack not deployed), give full points
    score += 20;
  }

  return Math.round((score / maxScore) * 100);
}

function identifyIssues(state: HealthCheckState): {
  critical: string[];
  warnings: string[];
} {
  const critical: string[] = [];
  const warnings: string[] = [];

  // SSM Agent issues
  if (state.ssmAgentConnectivity.unreachable > 0) {
    if (state.ssmAgentConnectivity.reachable === 0) {
      critical.push(
        `All instances (${state.ssmAgentConnectivity.total}) unreachable via SSM Agent`
      );
    } else {
      warnings.push(
        `${state.ssmAgentConnectivity.unreachable}/${state.ssmAgentConnectivity.total} instances unreachable via SSM Agent`
      );
    }
  }

  // ECS container instance issues
  if (state.ecsContainerInstances.total === 0) {
    critical.push("No ECS container instances registered");
  } else if (state.ecsContainerInstances.active === 0) {
    critical.push(
      `No active container instances (${state.ecsContainerInstances.total} total, all non-active)`
    );
  } else if (state.ecsContainerInstances.active < state.ecsContainerInstances.total) {
    warnings.push(
      `Only ${state.ecsContainerInstances.active}/${state.ecsContainerInstances.total} container instances are active`
    );
  }

  // ALB target health issues
  state.albTargetHealth.targetGroups.forEach((tg) => {
    const totalTargets =
      tg.healthyTargets + tg.unhealthyTargets + tg.drainingTargets;

    if (totalTargets === 0) {
      warnings.push(`Target group ${tg.name} has no registered targets`);
    } else if (tg.healthyTargets === 0) {
      critical.push(
        `Target group ${tg.name} has no healthy targets (${tg.unhealthyTargets} unhealthy)`
      );

      // Provide specific failure reasons
      tg.details.forEach((detail) => {
        if (detail.health !== "healthy" && detail.reason) {
          warnings.push(
            `  └─ Target ${detail.targetId}:${detail.port} - ${detail.health}: ${detail.reason}`
          );
        }
      });
    } else if (tg.unhealthyTargets > 0) {
      warnings.push(
        `Target group ${tg.name}: ${tg.healthyTargets}/${totalTargets} healthy`
      );
    }
  });

  // ECS task issues
  if (state.ecsTasks.total > 0) {
    if (state.ecsTasks.running === 0) {
      critical.push(
        `No running ECS tasks (${state.ecsTasks.pending} pending, ${state.ecsTasks.stopped} stopped)`
      );
    } else if (state.ecsTasks.pending > 0) {
      warnings.push(
        `${state.ecsTasks.pending} ECS tasks still pending (${state.ecsTasks.running} running)`
      );
    }

    // Check for unhealthy containers
    state.ecsTasks.details.forEach((task) => {
      task.containers.forEach((container) => {
        if (container.healthStatus === "UNHEALTHY") {
          warnings.push(
            `Container ${container.name} in task ${task.taskArn.split("/").pop()} is UNHEALTHY`
          );
        }
      });
    });
  }

  return { critical, warnings };
}

async function verifyHealthChecks(
  config: VerifyHealthChecksConfig
): Promise<HealthCheckState> {
  Logger.section(`Health Check Verification - ${config.environment}`);

  const clients = await createClients(config);

  // Get stack outputs
  const infraStackName = `${config.environment}-MonitoringInfra`;
  const infraOutputs = await getStackOutputs(clients.cfn, infraStackName);

  const clusterName = infraOutputs.ClusterName;
  const albDns = infraOutputs.LoadBalancerDns;

  if (!clusterName) {
    throw new Error(`Cluster name not found in stack ${infraStackName}`);
  }

  Logger.keyValue("Cluster Name", clusterName);
  Logger.keyValue("ALB DNS", albDns || "Not configured");
  console.log("");

  // Get ALB ARN
  let albArn: string | undefined;
  if (albDns) {
    try {
      const lbCommand = new DescribeLoadBalancersCommand({});
      const lbResponse = await clients.elbv2.send(lbCommand);
      const alb = lbResponse.LoadBalancers?.find((lb) => lb.DNSName === albDns);
      albArn = alb?.LoadBalancerArn;
    } catch (error: any) {
      Logger.warning(`Could not retrieve ALB ARN: ${error.message}`);
    }
  }

  // Initialize state
  const state: HealthCheckState = {
    ssmAgentConnectivity: {
      total: 0,
      reachable: 0,
      unreachable: 0,
      details: [],
    },
    ecsContainerInstances: {
      total: 0,
      active: 0,
      draining: 0,
      inactive: 0,
      details: [],
    },
    albTargetHealth: {
      targetGroups: [],
    },
    ecsTasks: {
      total: 0,
      running: 0,
      pending: 0,
      stopped: 0,
      details: [],
    },
    readinessScore: 0,
    criticalIssues: [],
    warnings: [],
  };

  // Step 1: Check ECS Container Instances
  Logger.subsection("1. ECS Container Instances");
  state.ecsContainerInstances = await checkEcsContainerInstances(
    clients.ecs,
    clusterName
  );

  if (state.ecsContainerInstances.total === 0) {
    Logger.error("No container instances found");
  } else {
    Logger.success(
      `Container Instances: ${state.ecsContainerInstances.active} active, ${state.ecsContainerInstances.draining} draining, ${state.ecsContainerInstances.inactive} inactive`
    );

    if (config.verbose) {
      state.ecsContainerInstances.details.forEach((instance) => {
        Logger.info(
          `  ${instance.arn.split("/").pop()}: ${instance.status} (${instance.runningTasks} tasks)`
        );
      });
    }
  }
  console.log("");

  // Extract instance IDs from container instances
  const instanceIds: string[] = [];
  for (const detail of state.ecsContainerInstances.details) {
    try {
      const describeCommand = new DescribeContainerInstancesCommand({
        cluster: clusterName,
        containerInstances: [detail.arn],
      });
      const describeResponse = await clients.ecs.send(describeCommand);
      const ec2InstanceId =
        describeResponse.containerInstances?.[0]?.ec2InstanceId;
      if (ec2InstanceId) {
        instanceIds.push(ec2InstanceId);
      }
    } catch (error: any) {
      Logger.warning(`Could not get EC2 instance ID: ${error.message}`);
    }
  }

  // Step 2: Check SSM Agent Connectivity
  Logger.subsection("2. SSM Agent Connectivity");
  state.ssmAgentConnectivity = await checkSsmAgentConnectivity(
    clients.ssm,
    instanceIds
  );

  if (state.ssmAgentConnectivity.reachable === state.ssmAgentConnectivity.total) {
    Logger.success(
      `All instances reachable (${state.ssmAgentConnectivity.reachable}/${state.ssmAgentConnectivity.total})`
    );
  } else if (state.ssmAgentConnectivity.reachable > 0) {
    Logger.warning(
      `Partial connectivity: ${state.ssmAgentConnectivity.reachable}/${state.ssmAgentConnectivity.total} reachable`
    );
  } else {
    Logger.error(
      `No instances reachable (${state.ssmAgentConnectivity.unreachable} unreachable)`
    );
  }

  if (config.verbose) {
    state.ssmAgentConnectivity.details.forEach((detail) => {
      const icon = detail.status === "Online" ? "✓" : "✗";
      Logger.info(
        `  ${icon} ${detail.instanceId}: ${detail.status}${detail.reason ? ` - ${detail.reason}` : ""}`
      );
    });
  }
  console.log("");

  // Step 3: Check ALB Target Health
  Logger.subsection("3. ALB Target Health");
  if (albArn) {
    state.albTargetHealth = await checkAlbTargetHealth(clients.elbv2, albArn);

    if (state.albTargetHealth.targetGroups.length === 0) {
      Logger.info("No target groups found (ServiceStack not deployed yet)");
    } else {
      state.albTargetHealth.targetGroups.forEach((tg) => {
        const totalTargets =
          tg.healthyTargets + tg.unhealthyTargets + tg.drainingTargets;

        if (totalTargets === 0) {
          Logger.warning(`${tg.name}: No targets registered`);
        } else if (tg.healthyTargets === 0) {
          Logger.error(
            `${tg.name}: 0/${totalTargets} healthy (health check path: ${tg.healthCheckPath})`
          );

          if (config.verbose) {
            tg.details.forEach((detail) => {
              Logger.info(
                `    ${detail.targetId}:${detail.port} - ${detail.health}${detail.reason ? `: ${detail.reason}` : ""}`
              );
            });
          }
        } else if (tg.unhealthyTargets > 0) {
          Logger.warning(
            `${tg.name}: ${tg.healthyTargets}/${totalTargets} healthy (health check path: ${tg.healthCheckPath})`
          );
        } else {
          Logger.success(
            `${tg.name}: All targets healthy (${tg.healthyTargets}/${totalTargets})`
          );
        }
      });
    }
  } else {
    Logger.info("ALB not configured yet");
  }
  console.log("");

  // Step 4: Check ECS Tasks
  Logger.subsection("4. ECS Tasks");
  state.ecsTasks = await checkEcsTasks(clients.ecs, clusterName);

  if (state.ecsTasks.total === 0) {
    Logger.info("No ECS tasks found (ServiceStack not deployed yet)");
  } else {
    Logger.success(
      `Tasks: ${state.ecsTasks.running} running, ${state.ecsTasks.pending} pending, ${state.ecsTasks.stopped} stopped`
    );

    if (config.verbose) {
      state.ecsTasks.details.forEach((task) => {
        Logger.info(
          `  ${task.taskArn.split("/").pop()}: ${task.status}${task.healthStatus ? ` (health: ${task.healthStatus})` : ""}`
        );
        task.containers.forEach((container) => {
          Logger.info(
            `    └─ ${container.name}: ${container.status}${container.healthStatus ? ` (health: ${container.healthStatus})` : ""}`
          );
        });
      });
    }
  }
  console.log("");

  // Calculate readiness score and identify issues
  state.readinessScore = calculateReadinessScore(state);
  const issues = identifyIssues(state);
  state.criticalIssues = issues.critical;
  state.warnings = issues.warnings;

  // Summary
  Logger.section("Health Check Summary");
  Logger.keyValue("Readiness Score", `${state.readinessScore}/100`);
  console.log("");

  if (state.criticalIssues.length > 0) {
    Logger.error(`Critical Issues (${state.criticalIssues.length}):`);
    state.criticalIssues.forEach((issue) => {
      Logger.error(`  ${issue}`);
    });
    console.log("");
  }

  if (state.warnings.length > 0) {
    Logger.warning(`Warnings (${state.warnings.length}):`);
    state.warnings.forEach((warning) => {
      Logger.warning(`  ${warning}`);
    });
    console.log("");
  }

  if (state.criticalIssues.length === 0 && state.warnings.length === 0) {
    Logger.success("All health checks passed!");
  }

  return state;
}

// CLI
program
  .name("verify-health-checks")
  .description("Verify infrastructure health checks with non-blocking option")
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
    "--max-wait <minutes>",
    "Maximum minutes to wait for health checks",
    "10"
  )
  .parse();

const options = program.opts();

const config: VerifyHealthChecksConfig = {
  environment: options.environment,
  region: options.region,
  profile: options.profile,
  verbose: options.verbose || false,
  blocking: options.blocking || false,
  maxWaitMinutes: parseInt(options.maxWait, 10) || 10,
};

verifyHealthChecks(config)
  .then((state) => {
    console.log("");

    if (state.criticalIssues.length === 0) {
      Logger.success("Health checks passed");
      Logger.info("Infrastructure is ready for service deployment");
      process.exit(0);
    } else if (config.blocking) {
      Logger.error("Health checks failed in blocking mode");
      Logger.info("Fix critical issues before proceeding");
      process.exit(1);
    } else {
      Logger.warning("Health checks failed but running in non-blocking mode");
      Logger.info("ServiceStack deployment will proceed despite health check failures");
      Logger.info("Use --blocking flag to prevent deployment on health check failures");
      console.log("");
      Logger.info("Deployment will continue for troubleshooting purposes");
      process.exit(0);  // Exit successfully to allow ServiceStack deployment
    }
  })
  .catch((error) => {
    Logger.error(`Health check verification failed: ${error.message}`);

    if (config.blocking) {
      process.exit(1);
    } else {
      Logger.warning("Ignoring error in non-blocking mode");
      process.exit(0);
    }
  });
