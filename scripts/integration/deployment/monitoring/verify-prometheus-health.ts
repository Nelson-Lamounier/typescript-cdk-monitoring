#!/usr/bin/env node
/** @format */

/**
 * Prometheus Health Check Verification Script
 *
 * Verifies Prometheus health check configuration and connectivity during
 * pipeline deployments. Performs comprehensive checks to identify common
 * failure scenarios.
 *
 * Checks:
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

import {
  ECSClient,
  ListTasksCommand,
  DescribeTasksCommand,
  DescribeContainerInstancesCommand,
} from "@aws-sdk/client-ecs";
import {
  SSMClient,
  SendCommandCommand,
  GetCommandInvocationCommand,
  DescribeInstanceInformationCommand,
} from "@aws-sdk/client-ssm";
import { EC2Client } from "@aws-sdk/client-ec2";

import { Logger } from "../utils/logger";
import { AwsClientFactory, BaseAwsClients } from "../shared/aws-client-factory";
import {
  CloudFormationUtility,
  ECSUtility,
  ELBUtility,
  EC2Utility,
} from "../shared/aws-utilities";
import {
  VerificationRunner,
  CheckBuilder,
  ReadinessChecker,
} from "../shared/verification-framework";
import { TableFormatter } from "../shared/formatters";
import { CliBuilder } from "../shared/cli-base";

interface PrometheusHealthClients extends BaseAwsClients {
  cfn: any;
  ecs: ECSClient;
  elbv2: any;
  ec2: EC2Client;
  ssm: SSMClient;
}

interface VerifyPrometheusHealthConfig {
  profile?: string;
  region: string;
  environment: string;
  verbose?: boolean;
  blocking?: boolean;
  maxRetries?: number;
  retryIntervalSeconds?: number;
}

interface PrometheusHealthContext {
  config: VerifyPrometheusHealthConfig;
  clients: PrometheusHealthClients;
  clusterName: string;
  serviceName: string;
  taskStatus?: {
    desiredCount: number;
    runningCount: number;
    pendingCount: number;
    tasks: any[];
  };
  targetGroup?: any;
  loadBalancer?: any;
  healthyTargets: number;
  totalTargets: number;
  criticalErrors: string[];
  warnings: string[];
}

const PROMETHEUS_PORT = 9090;
const EXPECTED_HEALTH_CHECK_PATH = "/prometheus/-/healthy";
const HEALTH_CHECK_TIMEOUT_SECONDS = 10;

function sleep(seconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

async function testHealthEndpointViaSSM(
  ssmClient: SSMClient,
  ecsClient: ECSClient,
  clusterName: string,
  healthCheckPath: string,
  verbose: boolean
): Promise<{ tested: boolean; success: boolean; httpCode?: string; error?: string }> {
  const result = { tested: false, success: false, httpCode: undefined, error: undefined } as {
    tested: boolean;
    success: boolean;
    httpCode?: string;
    error?: string;
  };

  try {
    const tasksResponse = await ecsClient.send(
      new ListTasksCommand({
        cluster: clusterName,
        desiredStatus: "RUNNING",
      })
    );

    if (!tasksResponse.taskArns?.length) {
      result.error = "No running tasks found";
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
      result.error = "No container instance found";
      return result;
    }

    const containerInstanceResponse = await ecsClient.send(
      new DescribeContainerInstancesCommand({
        cluster: clusterName,
        containerInstances: [task.containerInstanceArn],
      })
    );

    const instanceId =
      containerInstanceResponse.containerInstances?.[0]?.ec2InstanceId;
    if (!instanceId) {
      result.error = "Could not get EC2 instance ID";
      return result;
    }

    const ssmInfoResponse = await ssmClient.send(
      new DescribeInstanceInformationCommand({
        Filters: [{ Key: "InstanceIds", Values: [instanceId] }],
      })
    );

    const isOnline = ssmInfoResponse.InstanceInformationList?.some(
      (info) => info.PingStatus === "Online"
    );

    if (!isOnline) {
      result.error = `Instance ${instanceId} not reachable via SSM`;
      return result;
    }

    if (verbose) {
      Logger.info(`Testing health endpoint on instance ${instanceId}`);
    }

    result.tested = true;
    const cmd = await ssmClient.send(
      new SendCommandCommand({
        InstanceIds: [instanceId],
        DocumentName: "AWS-RunShellScript",
        Parameters: {
          commands: [
            `curl -s -o /dev/null -w "%{http_code}" --max-time ${HEALTH_CHECK_TIMEOUT_SECONDS} http://localhost:${PROMETHEUS_PORT}${healthCheckPath}`,
          ],
        },
      })
    );

    await sleep(3);

    const cmdResult = await ssmClient.send(
      new GetCommandInvocationCommand({
        CommandId: cmd.Command?.CommandId || "",
        InstanceId: instanceId,
      })
    );

    result.httpCode = cmdResult.StandardOutputContent?.trim();
    result.success = result.httpCode === "200";

    return result;
  } catch (error: any) {
    result.error = error.message;
    return result;
  }
}

async function verifyPrometheusHealth(
  config: VerifyPrometheusHealthConfig
): Promise<{ isHealthy: boolean; criticalErrors: string[]; warnings: string[] }> {
  Logger.section(`Prometheus Health Check Verification - ${config.environment}`);

  const clients = (await AwsClientFactory.createCommonClients(
    {
      ...config,
      sessionName: `verify-prometheus-health-${Date.now()}`,
    },
    ["cfn", "ecs", "elbv2", "ec2", "ssm"]
  )) as PrometheusHealthClients;

  const infraStackName = `${config.environment}-MonitoringInfra`;
  const serviceStackName = `${config.environment}-MonitoringService`;

  const infraStack = await CloudFormationUtility.getStackStatus(
    clients.cfn,
    infraStackName
  );
  const serviceStack = await CloudFormationUtility.getStackStatus(
    clients.cfn,
    serviceStackName
  );

  const clusterName = (infraStack?.outputs as any)?.ClusterName;
  const prometheusServiceArn = (serviceStack?.outputs as any)?.PrometheusServiceArn;

  if (!clusterName) {
    throw new Error(
      `Cluster name not found in stack ${infraStackName}. Ensure MonitoringInfra stack has been deployed.`
    );
  }

  const serviceName = prometheusServiceArn
    ? prometheusServiceArn.split("/").pop()
    : `${config.environment}-prometheus`;

  Logger.keyValue("Cluster Name", clusterName);
  Logger.keyValue("Service Name", serviceName || "unknown");
  console.log("");

  const runner = new VerificationRunner();
  const context: Partial<PrometheusHealthContext> = {
    config,
    clients,
    clusterName,
    serviceName: serviceName || `${config.environment}-prometheus`,
    healthyTargets: 0,
    totalTargets: 0,
    criticalErrors: [],
    warnings: [],
  };

  setupVerificationChecks(runner, context as PrometheusHealthContext);

  const summary = await runner.run();
  runner.printSummary();

  const isHealthy =
    summary.checksPassed === summary.totalChecks &&
    (context as PrometheusHealthContext).criticalErrors.length === 0;

  if (!isHealthy && config.verbose) {
    printTroubleshootingSteps(config, clusterName, serviceName || "");
  }

  return {
    isHealthy,
    criticalErrors: (context as PrometheusHealthContext).criticalErrors,
    warnings: (context as PrometheusHealthContext).warnings,
  };
}

function setupVerificationChecks(
  runner: VerificationRunner,
  context: PrometheusHealthContext
): void {
  // 1. ECS Task Status
  runner.addCheck(
    CheckBuilder.create("ECS Task Status")
      .category("compute")
      .critical(true)
      .execute(async () => {
        const service = await ECSUtility.getService(
          context.clients.ecs,
          context.clusterName,
          context.serviceName
        );

        if (!service) {
          context.criticalErrors.push(
            `Service ${context.serviceName} not found in cluster ${context.clusterName}`
          );
          return {
            passed: false,
            message: "Prometheus service not found",
          };
        }

        context.taskStatus = {
          desiredCount: service.desiredCount ?? 0,
          runningCount: service.runningCount ?? 0,
          pendingCount: service.pendingCount ?? 0,
          tasks: [],
        };

        const taskArns = await ECSUtility.listTasks(
          context.clients.ecs,
          context.clusterName,
          context.serviceName
        );

        if (taskArns.length > 0) {
          const tasks = await ECSUtility.describeTasks(
            context.clients.ecs,
            context.clusterName,
            taskArns
          );
          context.taskStatus.tasks = tasks;

          if (context.config.verbose) {
            console.log("");
            TableFormatter.formatTasks(tasks);
          }

          const stoppedTasks = tasks.filter(
            (t) => t.lastStatus === "STOPPED" && t.stoppedReason
          );

          for (const task of stoppedTasks) {
            if (task.stoppedReason?.includes("Essential container")) {
              context.criticalErrors.push(
                "Essential container exited. Check CloudWatch Logs for Prometheus startup errors."
              );
            }
            if (task.stoppedReason?.includes("OutOfMemory")) {
              context.criticalErrors.push(
                "Container ran out of memory. Increase memoryMiB in configuration."
              );
            }
          }
        }

        if (context.taskStatus.runningCount === 0) {
          context.criticalErrors.push(
            `No Prometheus tasks running (desired: ${context.taskStatus.desiredCount})`
          );
        } else if (context.taskStatus.runningCount < context.taskStatus.desiredCount) {
          context.warnings.push(
            `Only ${context.taskStatus.runningCount}/${context.taskStatus.desiredCount} tasks running`
          );
        }

        return {
          passed: context.taskStatus.runningCount > 0,
          message: `${context.taskStatus.runningCount}/${context.taskStatus.desiredCount} tasks running`,
        };
      })
  );

  // 2. ALB Target Group Health
  runner.addCheck(
    CheckBuilder.create("ALB Target Group Health")
      .category("networking")
      .execute(async () => {
        const tgPatterns = [
          `${context.config.environment}-monitoring-prom`,
          `${context.config.environment}-prometheus`,
        ];

        let targetGroup: any = null;
        for (const pattern of tgPatterns) {
          targetGroup = await ELBUtility.getTargetGroup(
            context.clients.elbv2,
            pattern
          ).catch(() => null);
          if (targetGroup) break;
        }

        if (!targetGroup) {
          const allTgs = await context.clients.elbv2.send(
            new (await import("@aws-sdk/client-elastic-load-balancing-v2"))
              .DescribeTargetGroupsCommand({})
          );
          targetGroup = allTgs.TargetGroups?.find(
            (tg: any) =>
              tg.TargetGroupName?.includes("prom") ||
              tg.TargetGroupName?.includes("prometheus")
          );
        }

        if (!targetGroup) {
          context.warnings.push("Prometheus target group not found");
          return {
            passed: false,
            message: "Target group not found",
          };
        }

        context.targetGroup = targetGroup;

        const targetHealth = await ELBUtility.getTargetHealth(
          context.clients.elbv2,
          targetGroup.TargetGroupArn
        );

        context.totalTargets = targetHealth.length;
        context.healthyTargets = ELBUtility.countHealthyTargets(targetHealth);

        if (context.config.verbose) {
          console.log("");
          Logger.keyValue("Target Group", targetGroup.TargetGroupName);
          Logger.keyValue("Health Check Path", targetGroup.HealthCheckPath);
          Logger.keyValue("Health Check Port", targetGroup.HealthCheckPort);
          TableFormatter.formatTargetHealth(targetHealth);
        }

        // Validate health check path
        if (targetGroup.HealthCheckPath !== EXPECTED_HEALTH_CHECK_PATH) {
          context.criticalErrors.push(
            `Health check path mismatch: Expected "${EXPECTED_HEALTH_CHECK_PATH}", got "${targetGroup.HealthCheckPath}". ` +
              `ALB forwards the FULL path. Prometheus expects health checks at ${EXPECTED_HEALTH_CHECK_PATH}.`
          );
        }

        // Check unhealthy targets
        const unhealthyTargets = targetHealth.filter(
          (t: any) => t.TargetHealth?.State !== "healthy"
        );

        for (const target of unhealthyTargets) {
          const reason = target.TargetHealth?.Reason;
          if (reason === "Target.FailedHealthChecks") {
            context.criticalErrors.push(
              `Target ${target.Target?.Id}:${target.Target?.Port} failed health checks. ` +
                `Prometheus may not be running or path is incorrect.`
            );
          } else if (reason === "Target.Timeout") {
            context.criticalErrors.push(
              `Target ${target.Target?.Id}:${target.Target?.Port} timed out. ` +
                `Check if Prometheus is responding on port ${PROMETHEUS_PORT}.`
            );
          } else if (reason !== "Target.NotRegistered") {
            context.warnings.push(
              `Target ${target.Target?.Id}:${target.Target?.Port} is ${target.TargetHealth?.State}: ${reason}`
            );
          }
        }

        return {
          passed:
            context.healthyTargets === context.totalTargets &&
            context.totalTargets > 0,
          message: `${context.healthyTargets}/${context.totalTargets} targets healthy`,
        };
      })
  );

  // 3. Health Endpoint Testing via SSM
  runner.addCheck(
    CheckBuilder.create("Health Endpoint Testing")
      .category("connectivity")
      .optional(true)
      .execute(async () => {
        if (!context.taskStatus || context.taskStatus.runningCount === 0) {
          return {
            passed: false,
            message: "No running tasks to test",
          };
        }

        const localTest = await testHealthEndpointViaSSM(
          context.clients.ssm,
          context.clients.ecs,
          context.clusterName,
          "/-/healthy",
          context.config.verbose || false
        );

        const prefixTest = await testHealthEndpointViaSSM(
          context.clients.ssm,
          context.clients.ecs,
          context.clusterName,
          EXPECTED_HEALTH_CHECK_PATH,
          context.config.verbose || false
        );

        if (context.config.verbose) {
          console.log("");
          Logger.keyValue(
            "Local Health (/-/healthy)",
            localTest.tested
              ? `${localTest.httpCode} - ${localTest.success ? "SUCCESS" : "FAILED"}`
              : "Not tested"
          );
          Logger.keyValue(
            `Route Prefix (${EXPECTED_HEALTH_CHECK_PATH})`,
            prefixTest.tested
              ? `${prefixTest.httpCode} - ${prefixTest.success ? "SUCCESS" : "FAILED"}`
              : "Not tested"
          );
        }

        if (prefixTest.tested && !prefixTest.success) {
          if (prefixTest.httpCode === "404") {
            context.criticalErrors.push(
              `${EXPECTED_HEALTH_CHECK_PATH} returns 404. Prometheus may not be configured with --web.route-prefix=/prometheus.`
            );
          } else if (prefixTest.httpCode === "000") {
            context.criticalErrors.push(
              "Prometheus is not responding. Container may not be running."
            );
          }
        }

        return {
          passed: prefixTest.success,
          message: prefixTest.tested
            ? `Health endpoint returns ${prefixTest.httpCode}`
            : "Could not test health endpoint",
        };
      })
  );

  // 4. Security Group Analysis
  runner.addCheck(
    CheckBuilder.create("Security Group Analysis")
      .category("security")
      .optional(true)
      .execute(async () => {
        if (!context.targetGroup?.LoadBalancerArns?.[0]) {
          return {
            passed: true,
            message: "No load balancer to analyse",
          };
        }

        const lbArn = context.targetGroup.LoadBalancerArns[0];
        const loadBalancer = await ELBUtility.getLoadBalancer(
          context.clients.elbv2,
          lbArn
        );

        if (!loadBalancer?.SecurityGroups) {
          return {
            passed: true,
            message: "No security groups to analyse",
          };
        }

        const securityGroups = await Promise.all(
          loadBalancer.SecurityGroups.map((sgId: string) =>
            EC2Utility.getSecurityGroup(context.clients.ec2, sgId)
          )
        );

        let hasEgressToPrometheus = false;
        for (const sg of securityGroups.filter(Boolean)) {
          const egressRules = sg?.IpPermissionsEgress || [];
          hasEgressToPrometheus = egressRules.some((rule: any) => {
            if (rule.IpProtocol === "-1") return true;
            if (!rule.FromPort || !rule.ToPort) return false;
            return rule.FromPort <= PROMETHEUS_PORT && rule.ToPort >= PROMETHEUS_PORT;
          });

          if (!hasEgressToPrometheus) {
            context.warnings.push(
              `ALB security group ${sg?.GroupId} may not allow egress to port ${PROMETHEUS_PORT}`
            );
          }
        }

        return {
          passed: hasEgressToPrometheus,
          message: hasEgressToPrometheus
            ? "Security groups allow traffic to Prometheus"
            : "Security groups may block Prometheus traffic",
        };
      })
  );

  // 5. Overall Health Assessment
  runner.addCheck(
    CheckBuilder.create("Overall Health Assessment")
      .category("readiness")
      .execute(async () => {
        const checker = new ReadinessChecker();

        if (context.criticalErrors.length > 0) {
          context.criticalErrors.forEach((error) => checker.addBlocker(error));
        }

        if (context.warnings.length > 0) {
          context.warnings.forEach((warning) => checker.addWarning(warning));
        }

        if (checker.isReady()) {
          checker.addNextStep("Prometheus is healthy and ready");
        } else {
          checker.addNextStep("Review critical errors above");
          checker.addNextStep("Check CloudWatch Logs for Prometheus");
          checker.addNextStep("Verify ECS service events");
        }

        console.log("");
        checker.printAssessment("Prometheus Service");

        return {
          passed: checker.isReady(),
          message: checker.isReady()
            ? "Prometheus is healthy"
            : "Prometheus has health issues",
        };
      })
  );
}

function printTroubleshootingSteps(
  config: VerifyPrometheusHealthConfig,
  clusterName: string,
  serviceName: string
): void {
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
  Logger.code(
    `curl -v http://localhost:${PROMETHEUS_PORT}${EXPECTED_HEALTH_CHECK_PATH}`
  );
  console.log("");
}

async function runWithRetries(config: VerifyPrometheusHealthConfig): Promise<void> {
  let attempts = 0;
  const maxAttempts = config.blocking ? config.maxRetries! : 1;

  while (attempts < maxAttempts) {
    attempts++;

    if (attempts > 1) {
      Logger.info(`Retry attempt ${attempts}/${maxAttempts}...`);
      await sleep(config.retryIntervalSeconds!);
    }

    const result = await verifyPrometheusHealth(config);

    if (result.isHealthy) {
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

const cli = CliBuilder.create(
  "verify-prometheus-health",
  "Verify Prometheus health check configuration and connectivity"
);

cli
  .option("-v, --verbose", "Enable verbose output", false)
  .option(
    "--blocking",
    "Exit with error if health checks fail (default: false)",
    false
  )
  .option("--max-retries <retries>", "Maximum retries for health checks", "3")
  .option("--retry-interval <seconds>", "Seconds between retries", "30");

cli.parse();

const options = cli.opts();

CliBuilder.validateEnvironment(options.environment);

const config: VerifyPrometheusHealthConfig = {
  environment: options.environment,
  region: options.region,
  profile: options.profile,
  verbose: options.verbose || false,
  blocking: options.blocking || false,
  maxRetries: parseInt(options.maxRetries, 10) || 3,
  retryIntervalSeconds: parseInt(options.retryInterval, 10) || 30,
};

runWithRetries(config).catch((error) => {
  Logger.error(`Verification failed: ${error.message}`);
  if (config.blocking) {
    process.exit(1);
  } else {
    Logger.warning("Ignoring error in non-blocking mode");
    process.exit(0);
  }
});
