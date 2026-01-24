#!/usr/bin/env node
/** @format */

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
 *
 * Usage:
 *   npx ts-node scripts/integration/deployment/monitoring/verify-health-checks.ts \
 *     --environment development \
 *     --region eu-west-1 \
 *     [--profile dev-account] \
 *     [--verbose] \
 *     [--blocking] \
 *     [--max-wait 10]
 */

import {
  ECSClient,
  DescribeContainerInstancesCommand,
} from "@aws-sdk/client-ecs";
import { SSMClient } from "@aws-sdk/client-ssm";
import { EC2Client } from "@aws-sdk/client-ec2";

import { Logger } from "../utils/logger";
import { AwsClientFactory, BaseAwsClients } from "../shared/aws-client-factory";
import {
  CloudFormationUtility,
  ECSUtility,
  ELBUtility,
  SSMUtility,
} from "../shared/aws-utilities";
import {
  VerificationRunner,
  CheckBuilder,
  ReadinessChecker,
} from "../shared/verification-framework";
import { TableFormatter } from "../shared/formatters";
import { CliBuilder } from "../shared/cli-base";

interface HealthCheckClients extends BaseAwsClients {
  cfn: any;
  ecs: ECSClient;
  elbv2: any;
  ssm: SSMClient;
  ec2: EC2Client;
}

interface VerifyHealthChecksConfig {
  profile?: string;
  region: string;
  environment: string;
  verbose?: boolean;
  blocking?: boolean;
  maxWaitMinutes?: number;
}

interface HealthCheckContext {
  config: VerifyHealthChecksConfig;
  clients: HealthCheckClients;
  clusterName: string;
  albArn?: string;
  instanceIds: string[];
  ssmConnectivity: {
    total: number;
    reachable: number;
    unreachable: number;
    details: Array<{ instanceId: string; status: string; reason?: string }>;
  };
  containerInstances: {
    total: number;
    active: number;
    draining: number;
    inactive: number;
    details: any[];
  };
  targetHealth: {
    targetGroups: Array<{
      name: string;
      healthyTargets: number;
      totalTargets: number;
      details: any[];
    }>;
  };
  tasks: {
    total: number;
    running: number;
    pending: number;
    unhealthyContainers: number;
  };
  readinessScore: number;
  criticalIssues: string[];
  warnings: string[];
}

function calculateReadinessScore(context: HealthCheckContext): number {
  let score = 0;
  let maxScore = 0;

  // SSM Agent connectivity (20 points)
  maxScore += 20;
  if (context.ssmConnectivity.total > 0) {
    score += 20 * (context.ssmConnectivity.reachable / context.ssmConnectivity.total);
  } else {
    score += 20; // No instances yet is not a failure
  }

  // ECS container instances (30 points)
  maxScore += 30;
  if (context.containerInstances.total > 0) {
    score += 30 * (context.containerInstances.active / context.containerInstances.total);
  } else {
    score += 15; // Half points if no instances yet
  }

  // ALB target health (30 points)
  maxScore += 30;
  const totalTargets = context.targetHealth.targetGroups.reduce(
    (sum, tg) => sum + tg.totalTargets,
    0
  );
  const healthyTargets = context.targetHealth.targetGroups.reduce(
    (sum, tg) => sum + tg.healthyTargets,
    0
  );
  if (totalTargets > 0) {
    score += 30 * (healthyTargets / totalTargets);
  } else {
    score += 30; // No targets yet (service not deployed) is not a failure
  }

  // ECS tasks (20 points)
  maxScore += 20;
  if (context.tasks.total > 0) {
    const healthyTasks = context.tasks.running - context.tasks.unhealthyContainers;
    score += 20 * (healthyTasks / context.tasks.total);
  } else {
    score += 20; // No tasks yet (service not deployed) is not a failure
  }

  return Math.round((score / maxScore) * 100);
}

async function extractInstanceIds(
  context: HealthCheckContext
): Promise<string[]> {
  const instanceIds: string[] = [];

  for (const detail of context.containerInstances.details) {
    try {
      const describeCommand = new DescribeContainerInstancesCommand({
        cluster: context.clusterName,
        containerInstances: [detail.containerInstanceArn],
      });
      const describeResponse = await context.clients.ecs.send(describeCommand);
      const ec2InstanceId =
        describeResponse.containerInstances?.[0]?.ec2InstanceId;
      if (ec2InstanceId) {
        instanceIds.push(ec2InstanceId);
      }
    } catch (error: any) {
      if (context.config.verbose) {
        Logger.warning(`Could not get EC2 instance ID: ${error.message}`);
      }
    }
  }

  return instanceIds;
}

async function verifyHealthChecks(
  config: VerifyHealthChecksConfig
): Promise<{ isHealthy: boolean; readinessScore: number; criticalIssues: string[] }> {
  Logger.section(`Health Check Verification - ${config.environment}`);

  const clients = (await AwsClientFactory.createCommonClients(
    {
      ...config,
      sessionName: `verify-health-checks-${Date.now()}`,
    },
    ["cfn", "ecs", "elbv2", "ssm", "ec2"]
  )) as HealthCheckClients;

  const infraStackName = `${config.environment}-MonitoringInfra`;
  const infraStack = await CloudFormationUtility.getStackStatus(
    clients.cfn,
    infraStackName
  );

  const clusterName = (infraStack?.outputs as any)?.ClusterName;
  const albDns = (infraStack?.outputs as any)?.LoadBalancerDns;

  if (!clusterName) {
    throw new Error(
      `Cluster name not found in stack ${infraStackName}. Ensure MonitoringInfra stack has been deployed.`
    );
  }

  Logger.keyValue("Cluster Name", clusterName);
  Logger.keyValue("ALB DNS", albDns || "Not configured");
  console.log("");

  // Get ALB ARN
  let albArn: string | undefined;
  if (albDns) {
    const alb = await ELBUtility.getLoadBalancerByDns(clients.elbv2, albDns);
    albArn = alb?.LoadBalancerArn;
  }

  const runner = new VerificationRunner();
  const context: Partial<HealthCheckContext> = {
    config,
    clients,
    clusterName,
    albArn,
    instanceIds: [],
    ssmConnectivity: {
      total: 0,
      reachable: 0,
      unreachable: 0,
      details: [],
    },
    containerInstances: {
      total: 0,
      active: 0,
      draining: 0,
      inactive: 0,
      details: [],
    },
    targetHealth: {
      targetGroups: [],
    },
    tasks: {
      total: 0,
      running: 0,
      pending: 0,
      unhealthyContainers: 0,
    },
    readinessScore: 0,
    criticalIssues: [],
    warnings: [],
  };

  setupVerificationChecks(runner, context as HealthCheckContext);

  runner.run();
  runner.printSummary();


  // Calculate readiness score
  (context as HealthCheckContext).readinessScore = calculateReadinessScore(
    context as HealthCheckContext
  );

  runner.printSummary();

  // Print readiness assessment
  console.log("");
  Logger.section("Readiness Assessment");
  Logger.keyValue(
    "Readiness Score",
    `${(context as HealthCheckContext).readinessScore}/100`
  );
  console.log("");

  if ((context as HealthCheckContext).criticalIssues.length > 0) {
    Logger.error(
      `Critical Issues (${(context as HealthCheckContext).criticalIssues.length}):`
    );
    (context as HealthCheckContext).criticalIssues.forEach((issue) => {
      Logger.error(`  ${issue}`);
    });
    console.log("");
  }

  if ((context as HealthCheckContext).warnings.length > 0) {
    Logger.warning(
      `Warnings (${(context as HealthCheckContext).warnings.length}):`
    );
    (context as HealthCheckContext).warnings.forEach((warning) => {
      Logger.warning(`  ${warning}`);
    });
    console.log("");
  }

  if (
    (context as HealthCheckContext).criticalIssues.length === 0 &&
    (context as HealthCheckContext).warnings.length === 0
  ) {
    Logger.success("All health checks passed!");
  }

  const isHealthy = (context as HealthCheckContext).criticalIssues.length === 0;

  return {
    isHealthy,
    readinessScore: (context as HealthCheckContext).readinessScore,
    criticalIssues: (context as HealthCheckContext).criticalIssues,
  };
}

function setupVerificationChecks(
  runner: VerificationRunner,
  context: HealthCheckContext
): void {
  // 1. ECS Container Instances
  runner.addCheck(
    CheckBuilder.create("ECS Container Instances")
      .category("compute")
      .critical(true)
      .execute(async () => {
        const containerInstances = await ECSUtility.listContainerInstances(
          context.clients.ecs,
          context.clusterName
        );

        context.containerInstances.total = containerInstances.length;

        if (containerInstances.length === 0) {
          context.criticalIssues.push("No ECS container instances registered");
          return {
            passed: false,
            message: "No container instances found",
          };
        }

        const instances = await ECSUtility.describeContainerInstances(
          context.clients.ecs,
          context.clusterName,
          containerInstances
        );

        context.containerInstances.details = instances;

        instances.forEach((instance) => {
          const status = instance.status || "UNKNOWN";
          if (status === "ACTIVE") {
            context.containerInstances.active++;
          } else if (status === "DRAINING") {
            context.containerInstances.draining++;
          } else {
            context.containerInstances.inactive++;
          }
        });

        if (context.config.verbose) {
          console.log("");
          Logger.info("Container Instance Details:");
          instances.forEach((instance) => {
            const shortArn = instance.containerInstanceArn?.split("/").pop() || "unknown";
            Logger.info(
              `  ${shortArn}: ${instance.status} (${instance.runningTasksCount || 0} tasks)`
            );
          });
        }

        if (context.containerInstances.active === 0) {
          context.criticalIssues.push(
            `No active container instances (${context.containerInstances.total} total, all non-active)`
          );
          return {
            passed: false,
            message: "No active container instances",
          };
        }

        if (context.containerInstances.active < context.containerInstances.total) {
          context.warnings.push(
            `Only ${context.containerInstances.active}/${context.containerInstances.total} container instances are active`
          );
        }

        return {
          passed: true,
          message: `${context.containerInstances.active} active, ${context.containerInstances.draining} draining, ${context.containerInstances.inactive} inactive`,
        };
      })
  );

  // 2. SSM Agent Connectivity
  runner.addCheck(
    CheckBuilder.create("SSM Agent Connectivity")
      .category("connectivity")
      .execute(async () => {
        // Extract instance IDs from container instances
        context.instanceIds = await extractInstanceIds(context);

        if (context.instanceIds.length === 0) {
          return {
            passed: true,
            message: "No instances to check",
          };
        }

        context.ssmConnectivity.total = context.instanceIds.length;

        const managedInstances = await SSMUtility.describeInstanceInformation(
          context.clients.ssm,
          context.instanceIds
        );

        context.instanceIds.forEach((instanceId) => {
          const managed = managedInstances.find(
            (info) => info.InstanceId === instanceId
          );

          if (managed && managed.PingStatus === "Online") {
            context.ssmConnectivity.reachable++;
            context.ssmConnectivity.details.push({
              instanceId,
              status: "Online",
            });
          } else if (managed) {
            context.ssmConnectivity.unreachable++;
            context.ssmConnectivity.details.push({
              instanceId,
              status: managed.PingStatus || "Unknown",
              reason: `Last ping: ${managed.LastPingDateTime?.toISOString()}`,
            });
          } else {
            context.ssmConnectivity.unreachable++;
            context.ssmConnectivity.details.push({
              instanceId,
              status: "Not Managed",
              reason: "Instance not registered with Systems Manager",
            });
          }
        });

        if (context.config.verbose) {
          console.log("");
          Logger.info("SSM Agent Details:");
          context.ssmConnectivity.details.forEach((detail) => {
            const icon = detail.status === "Online" ? "✓" : "✗";
            Logger.info(
              `  ${icon} ${detail.instanceId}: ${detail.status}${detail.reason ? ` - ${detail.reason}` : ""}`
            );
          });
        }

        if (context.ssmConnectivity.unreachable > 0) {
          if (context.ssmConnectivity.reachable === 0) {
            context.criticalIssues.push(
              `All instances (${context.ssmConnectivity.total}) unreachable via SSM Agent`
            );
            return {
              passed: false,
              message: "All instances unreachable",
            };
          } else {
            context.warnings.push(
              `${context.ssmConnectivity.unreachable}/${context.ssmConnectivity.total} instances unreachable via SSM Agent`
            );
          }
        }

        return {
          passed: context.ssmConnectivity.reachable > 0,
          message: `${context.ssmConnectivity.reachable}/${context.ssmConnectivity.total} instances reachable`,
        };
      })
  );

  // 3. ALB Target Health
  runner.addCheck(
    CheckBuilder.create("ALB Target Health")
      .category("networking")
      .optional(true)
      .execute(async () => {
        if (!context.albArn) {
          return {
            passed: true,
            message: "ALB not configured yet",
          };
        }

        const targetGroups = await ELBUtility.getTargetGroupsByLoadBalancer(
          context.clients.elbv2,
          context.albArn
        );

        if (targetGroups.length === 0) {
          return {
            passed: true,
            message: "No target groups found (ServiceStack not deployed yet)",
          };
        }

        for (const tg of targetGroups) {
          if (!tg.TargetGroupArn) {
            continue;
          }

          const targetHealth = await ELBUtility.getTargetHealth(
            context.clients.elbv2,
            tg.TargetGroupArn
          );

          const totalTargets = targetHealth.length;
          const healthyTargets = ELBUtility.countHealthyTargets(targetHealth);

          context.targetHealth.targetGroups.push({
            name: tg.TargetGroupName || "unknown",
            healthyTargets,
            totalTargets,
            details: targetHealth,
          });

          if (context.config.verbose) {
            console.log("");
            Logger.info(`Target Group: ${tg.TargetGroupName}`);
            Logger.keyValue("  Health Check Path", tg.HealthCheckPath || "/");
            Logger.keyValue("  Healthy Targets", `${healthyTargets}/${totalTargets}`);

            if (totalTargets > 0) {
              TableFormatter.formatTargetHealth(targetHealth);
            }
          }

          if (totalTargets === 0) {
            context.warnings.push(
              `Target group ${tg.TargetGroupName} has no registered targets`
            );
          } else if (healthyTargets === 0) {
            context.criticalIssues.push(
              `Target group ${tg.TargetGroupName} has no healthy targets (${totalTargets - healthyTargets} unhealthy)`
            );

            // Provide specific failure reasons
            targetHealth.forEach((target) => {
              if (
                target.TargetHealth?.State !== "healthy" &&
                target.TargetHealth?.Reason
              ) {
                context.warnings.push(
                  `  └─ Target ${target.Target?.Id}:${target.Target?.Port} - ${target.TargetHealth.State}: ${target.TargetHealth.Reason}`
                );
              }
            });
          } else if (healthyTargets < totalTargets) {
            context.warnings.push(
              `Target group ${tg.TargetGroupName}: ${healthyTargets}/${totalTargets} healthy`
            );
          }
        }

        const allHealthy = context.targetHealth.targetGroups.every(
          (tg) => tg.healthyTargets === tg.totalTargets && tg.totalTargets > 0
        );

        const totalHealthy = context.targetHealth.targetGroups.reduce(
          (sum, tg) => sum + tg.healthyTargets,
          0
        );
        const totalTargets = context.targetHealth.targetGroups.reduce(
          (sum, tg) => sum + tg.totalTargets,
          0
        );

        return {
          passed: allHealthy || totalTargets === 0,
          message:
            totalTargets === 0
              ? "No targets registered yet"
              : `${totalHealthy}/${totalTargets} targets healthy across ${targetGroups.length} target groups`,
        };
      })
  );

  // 4. ECS Tasks
  runner.addCheck(
    CheckBuilder.create("ECS Tasks")
      .category("compute")
      .optional(true)
      .execute(async () => {
        const taskArns = await ECSUtility.listTasks(
          context.clients.ecs,
          context.clusterName
        );

        context.tasks.total = taskArns.length;

        if (taskArns.length === 0) {
          return {
            passed: true,
            message: "No ECS tasks found (ServiceStack not deployed yet)",
          };
        }

        const tasks = await ECSUtility.describeTasks(
          context.clients.ecs,
          context.clusterName,
          taskArns
        );

        tasks.forEach((task) => {
          const status = task.lastStatus || "UNKNOWN";

          if (status === "RUNNING") {
            context.tasks.running++;
          } else if (status === "PENDING") {
            context.tasks.pending++;
          }

          // Check for unhealthy containers
          task.containers?.forEach((container: any) => {
            if (container.healthStatus === "UNHEALTHY") {
              context.tasks.unhealthyContainers++;
              context.warnings.push(
                `Container ${container.name} in task ${task.taskArn?.split("/").pop()} is UNHEALTHY`
              );
            }
          });
        });

        if (context.config.verbose) {
          console.log("");
          TableFormatter.formatTasks(tasks);
        }

        if (context.tasks.running === 0) {
          context.criticalIssues.push(
            `No running ECS tasks (${context.tasks.pending} pending)`
          );
          return {
            passed: false,
            message: "No running tasks",
          };
        }

        if (context.tasks.pending > 0) {
          context.warnings.push(
            `${context.tasks.pending} ECS tasks still pending (${context.tasks.running} running)`
          );
        }

        return {
          passed: context.tasks.running > 0,
          message: `${context.tasks.running} running, ${context.tasks.pending} pending`,
        };
      })
  );

  // 5. Overall Readiness
  runner.addCheck(
    CheckBuilder.create("Overall Readiness")
      .category("readiness")
      .execute(async () => {
        const checker = new ReadinessChecker();

        if (context.criticalIssues.length > 0) {
          context.criticalIssues.forEach((issue) => checker.addBlocker(issue));
        }

        if (context.warnings.length > 0) {
          context.warnings.forEach((warning) => checker.addWarning(warning));
        }

        if (checker.isReady()) {
          checker.addNextStep("Infrastructure is ready for service deployment");
        } else {
          checker.addNextStep("Review critical issues above");
          checker.addNextStep("Check CloudWatch Logs for detailed error messages");
          checker.addNextStep("Verify EC2 instance health in AWS Console");
          checker.addNextStep("Consider using --verbose flag for detailed output");
        }

        console.log("");
        checker.printAssessment("Monitoring Infrastructure");

        return {
          passed: checker.isReady(),
          message: checker.isReady()
            ? "Infrastructure ready"
            : "Infrastructure has issues",
        };
      })
  );
}

const cli = CliBuilder.create(
  "verify-health-checks",
  "Verify infrastructure health checks with non-blocking option"
);

cli
  .option("-v, --verbose", "Enable verbose output", false)
  .option(
    "--blocking",
    "Exit with error if health checks fail (default: false)",
    false
  )
  .option("--max-wait <minutes>", "Maximum minutes to wait for health checks", "10");

cli.parse();

const options = cli.opts();

CliBuilder.validateEnvironment(options.environment);

const config: VerifyHealthChecksConfig = {
  environment: options.environment,
  region: options.region,
  profile: options.profile,
  verbose: options.verbose || false,
  blocking: options.blocking || false,
  maxWaitMinutes: parseInt(options.maxWait, 10) || 10,
};

verifyHealthChecks(config)
  .then((result) => {
    console.log("");

    if (result.isHealthy) {
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
      process.exit(0); // Exit successfully to allow ServiceStack deployment
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
