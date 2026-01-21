#!/usr/bin/env node
/** @format */

/**
 * EFS Mount Verification Script
 *
 * This script verifies EFS mount status and configuration on EC2 instances
 * using AWS Systems Manager (SSM) to execute remote commands.
 *
 * Verification includes:
 * 1. EFS mount status (/mnt/efs)
 * 2. Directory structure validation
 * 3. Configuration files existence
 * 4. Prometheus and Grafana data directories
 * 5. Write permissions testing
 * 6. Mount details and fstab entries
 *
 * Usage:
 *   npx ts-node scripts/integration/deployment/monitoring/verify-efs-mount.ts \
 *     --environment development \
 *     --region eu-west-1 \
 *     [--profile dev-account] \
 *     [--wait 8]
 */

import { EC2Client, DescribeInstancesCommand } from "@aws-sdk/client-ec2";
import {
  SSMClient,
  SendCommandCommand,
  GetCommandInvocationCommand,
} from "@aws-sdk/client-ssm";

import { Logger } from "../utils/logger";
import { AwsClientFactory, BaseAwsClients } from "../shared/aws-client-factory";
import {
  VerificationRunner,
  CheckBuilder,
  ReadinessChecker,
} from "../shared/verification-framework";
import { CliBuilder } from "../shared/cli-base";

interface EfsMountClients extends BaseAwsClients {
  ec2: EC2Client;
  ssm: SSMClient;
}

interface VerifyEfsMountConfig {
  profile?: string;
  region: string;
  environment: string;
  waitTimeSeconds?: number;
}

interface EfsMountContext {
  config: VerifyEfsMountConfig;
  clients: EfsMountClients;
  instanceId?: string;
  commandId?: string;
  commandOutput?: string;
  commandErrors?: string;
  mountStatus: {
    isMounted: boolean;
    isWritable: boolean;
    hasPrometheusConfig: boolean;
    hasGrafanaConfig: boolean;
    hasFstabEntry: boolean;
  };
  criticalIssues: string[];
  warnings: string[];
}

const EFS_VERIFICATION_COMMANDS = [
  'echo "=== 1. EFS MOUNT STATUS ==="',
  'df -h | grep -E "(Filesystem|efs)"',
  'echo ""',
  'mountpoint -q /mnt/efs && echo "✅ /mnt/efs is MOUNTED" || echo "❌ /mnt/efs is NOT MOUNTED"',
  'echo ""',
  'echo "=== 2. DIRECTORY STRUCTURE ==="',
  'ls -la /mnt/efs/ 2>/dev/null || echo "Directory empty or inaccessible"',
  'echo ""',
  'echo "=== 3. CONFIG FILES ==="',
  'ls -la /mnt/efs/config/ 2>/dev/null || echo "Config directory not found"',
  'echo ""',
  'echo "=== 4. PROMETHEUS DATA ==="',
  'ls -la /mnt/efs/prometheus-data/ 2>/dev/null | head -10 || echo "Prometheus data directory not found"',
  'echo ""',
  'echo "=== 5. GRAFANA DATA ==="',
  'ls -la /mnt/efs/grafana-data/ 2>/dev/null | head -10 || echo "Grafana data directory not found"',
  'echo ""',
  'echo "=== 6. PROMETHEUS CONFIG FILE ==="',
  'test -f /mnt/efs/config/prometheus/prometheus.yml && echo "✅ prometheus.yml EXISTS" || echo "❌ prometheus.yml NOT FOUND"',
  'echo ""',
  'echo "=== 7. GRAFANA CONFIG FILES ==="',
  'test -f /mnt/efs/config/grafana/provisioning/datasources/prometheus.yml && echo "✅ datasource config EXISTS" || echo "❌ datasource config NOT FOUND"',
  'test -f /mnt/efs/config/grafana/provisioning/dashboards/dashboards.yml && echo "✅ dashboard config EXISTS" || echo "❌ dashboard config NOT FOUND"',
  'echo ""',
  'echo "=== 8. WRITE TEST ==="',
  'touch /mnt/efs/.write-test 2>/dev/null && echo "✅ EFS is WRITABLE" && rm /mnt/efs/.write-test || echo "❌ EFS is READ-ONLY or write failed"',
  'echo ""',
  'echo "=== 9. MOUNT DETAILS ==="',
  'mount | grep efs || echo "No EFS mounts found"',
  'echo ""',
  'echo "=== 10. FSTAB ENTRY ==="',
  'grep efs /etc/fstab || echo "No EFS entry in fstab"',
];

function sleep(seconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

async function findInstance(
  ec2Client: EC2Client,
  environment: string
): Promise<string | null> {
  try {
    const response = await ec2Client.send(
      new DescribeInstancesCommand({
        Filters: [
          {
            Name: "tag:Environment",
            Values: [environment],
          },
          {
            Name: "instance-state-name",
            Values: ["running"],
          },
        ],
      })
    );

    const instanceId = response.Reservations?.[0]?.Instances?.[0]?.InstanceId;
    return instanceId && instanceId !== "None" ? instanceId : null;
  } catch (error: any) {
    Logger.warning(`Failed to find instance: ${error.message}`);
    return null;
  }
}

async function sendVerificationCommand(
  ssmClient: SSMClient,
  instanceId: string
): Promise<string | null> {
  try {
    const response = await ssmClient.send(
      new SendCommandCommand({
        InstanceIds: [instanceId],
        DocumentName: "AWS-RunShellScript",
        Comment: "EFS Mount Verification",
        Parameters: {
          commands: EFS_VERIFICATION_COMMANDS,
        },
      })
    );

    return response.Command?.CommandId || null;
  } catch (error: any) {
    Logger.error(`Failed to send SSM command: ${error.message}`);
    return null;
  }
}

async function getCommandResults(
  ssmClient: SSMClient,
  commandId: string,
  instanceId: string,
  maxRetries: number = 3
): Promise<{ output: string; errors: string; status: string } | null> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await ssmClient.send(
        new GetCommandInvocationCommand({
          CommandId: commandId,
          InstanceId: instanceId,
        })
      );

      const status = response.Status || "Unknown";

      // If command is still in progress, wait and retry
      if (status === "InProgress" || status === "Pending") {
        if (attempt < maxRetries) {
          Logger.info(`Command status: ${status}. Waiting before retry...`);
          await sleep(3);
          continue;
        }
      }

      return {
        output: response.StandardOutputContent || "",
        errors: response.StandardErrorContent || "",
        status,
      };
    } catch (error: any) {
      if (attempt < maxRetries) {
        Logger.warning(
          `Failed to get command results (attempt ${attempt}/${maxRetries}): ${error.message}`
        );
        await sleep(2);
      } else {
        Logger.error(`Failed to get command results: ${error.message}`);
        return null;
      }
    }
  }

  return null;
}

function parseCommandOutput(output: string, context: EfsMountContext): void {
  // Parse mount status
  context.mountStatus.isMounted = output.includes("✅ /mnt/efs is MOUNTED");

  // Parse write test
  context.mountStatus.isWritable = output.includes("✅ EFS is WRITABLE");

  // Parse config file existence
  context.mountStatus.hasPrometheusConfig = output.includes(
    "✅ prometheus.yml EXISTS"
  );
  context.mountStatus.hasGrafanaConfig =
    output.includes("✅ datasource config EXISTS") &&
    output.includes("✅ dashboard config EXISTS");

  // Parse fstab entry
  context.mountStatus.hasFstabEntry =
    !output.includes("No EFS entry in fstab") && output.includes("/etc/fstab");

  // Identify issues
  if (!context.mountStatus.isMounted) {
    context.criticalIssues.push("EFS is not mounted at /mnt/efs");
  }

  if (context.mountStatus.isMounted && !context.mountStatus.isWritable) {
    context.criticalIssues.push("EFS is mounted but not writable");
  }

  if (!context.mountStatus.hasPrometheusConfig) {
    context.warnings.push("Prometheus configuration file not found");
  }

  if (!context.mountStatus.hasGrafanaConfig) {
    context.warnings.push("Grafana configuration files not found");
  }

  if (!context.mountStatus.hasFstabEntry) {
    context.warnings.push(
      "No EFS entry in /etc/fstab - mount may not persist across reboots"
    );
  }
}

async function verifyEfsMount(
  config: VerifyEfsMountConfig
): Promise<{ isHealthy: boolean; criticalIssues: string[] }> {
  Logger.section(`EFS Mount Verification - ${config.environment}`);

  const clients = (await AwsClientFactory.createCommonClients(
    {
      ...config,
      sessionName: `verify-efs-mount-${Date.now()}`,
    },
    ["ec2", "ssm"]
  )) as EfsMountClients;

  const runner = new VerificationRunner();
  const context: Partial<EfsMountContext> = {
    config,
    clients,
    mountStatus: {
      isMounted: false,
      isWritable: false,
      hasPrometheusConfig: false,
      hasGrafanaConfig: false,
      hasFstabEntry: false,
    },
    criticalIssues: [],
    warnings: [],
  };

  setupVerificationChecks(runner, context as EfsMountContext);

 await runner.run();
  runner.printSummary();

  const isHealthy = (context as EfsMountContext).criticalIssues.length === 0;

  return {
    isHealthy,
    criticalIssues: (context as EfsMountContext).criticalIssues,
  };
}

function setupVerificationChecks(
  runner: VerificationRunner,
  context: EfsMountContext
): void {
  // 1. Find EC2 Instance
  runner.addCheck(
    CheckBuilder.create("Find EC2 Instance")
      .category("discovery")
      .critical(true)
      .execute(async () => {
        Logger.keyValue("Environment", context.config.environment);
        Logger.keyValue("Region", context.config.region);
        console.log("");

        const instanceId = await findInstance(
          context.clients.ec2,
          context.config.environment
        );

        if (!instanceId) {
          context.criticalIssues.push("No running instances found");
          return {
            passed: false,
            message: "No running instances found with Environment tag",
          };
        }

        context.instanceId = instanceId;
        Logger.keyValue("Instance ID", instanceId);

        return {
          passed: true,
          message: `Found instance: ${instanceId}`,
        };
      })
  );

  // 2. Send Verification Command
  runner.addCheck(
    CheckBuilder.create("Send Verification Command")
      .category("connectivity")
      .critical(true)
      .execute(async () => {
        if (!context.instanceId) {
          return {
            passed: false,
            message: "No instance ID available",
          };
        }

        const commandId = await sendVerificationCommand(
          context.clients.ssm,
          context.instanceId
        );

        if (!commandId) {
          context.criticalIssues.push("Failed to send SSM command");
          return {
            passed: false,
            message: "Failed to send verification command via SSM",
          };
        }

        context.commandId = commandId;
        Logger.keyValue("Command ID", commandId);

        // Wait for command execution
        const waitTime = context.config.waitTimeSeconds || 8;
        Logger.info(`Waiting ${waitTime} seconds for command execution...`);
        await sleep(waitTime);

        return {
          passed: true,
          message: `Command sent successfully: ${commandId}`,
        };
      })
  );

  // 3. Retrieve Command Results
  runner.addCheck(
    CheckBuilder.create("Retrieve Command Results")
      .category("verification")
      .critical(true)
      .execute(async () => {
        if (!context.commandId || !context.instanceId) {
          return {
            passed: false,
            message: "No command ID or instance ID available",
          };
        }

        const results = await getCommandResults(
          context.clients.ssm,
          context.commandId,
          context.instanceId
        );

        if (!results) {
          context.criticalIssues.push("Failed to retrieve command results");
          return {
            passed: false,
            message: "Failed to retrieve command results from SSM",
          };
        }

        context.commandOutput = results.output;
        context.commandErrors = results.errors;

        Logger.keyValue("Command Status", results.status);
        console.log("");

        if (results.output) {
          Logger.subsection("Command Output");
          console.log(results.output);
          console.log("");
        }

        if (results.errors && results.errors !== "None" && results.errors.trim()) {
          Logger.subsection("Command Errors");
          console.log(results.errors);
          console.log("");
        }

        // Parse output to extract mount status
        parseCommandOutput(results.output, context);

        return {
          passed: results.status === "Success",
          message: `Command execution: ${results.status}`,
        };
      })
  );

  // 4. Validate Mount Status
  runner.addCheck(
    CheckBuilder.create("Validate Mount Status")
      .category("validation")
      .critical(true)
      .execute(async () => {
        if (!context.mountStatus.isMounted) {
          context.criticalIssues.push("EFS is not mounted");
          return {
            passed: false,
            message: "EFS is not mounted at /mnt/efs",
          };
        }

        if (!context.mountStatus.isWritable) {
          context.criticalIssues.push("EFS is not writable");
          return {
            passed: false,
            message: "EFS is mounted but not writable",
          };
        }

        return {
          passed: true,
          message: "EFS is mounted and writable",
        };
      })
  );

  // 5. Validate Configuration Files
  runner.addCheck(
    CheckBuilder.create("Validate Configuration Files")
      .category("validation")
      .optional(true)
      .execute(async () => {
        const issues: string[] = [];

        if (!context.mountStatus.hasPrometheusConfig) {
          issues.push("Prometheus configuration file not found");
          context.warnings.push("Prometheus configuration missing");
        }

        if (!context.mountStatus.hasGrafanaConfig) {
          issues.push("Grafana configuration files not found");
          context.warnings.push("Grafana configuration missing");
        }

        if (!context.mountStatus.hasFstabEntry) {
          issues.push("No fstab entry - mount may not persist");
          context.warnings.push("fstab entry missing");
        }

        if (issues.length === 0) {
          return {
            passed: true,
            message: "All configuration files present and fstab configured",
          };
        }

        return {
          passed: false,
          message: issues.join("; "),
        };
      })
  );

  // 6. Overall Assessment
  runner.addCheck(
    CheckBuilder.create("Overall Assessment")
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
          checker.addNextStep("EFS is properly mounted and configured");
          checker.addNextStep("All configuration files are in place");
          checker.addNextStep("Services can safely use EFS storage");
        } else {
          checker.addNextStep("Review critical issues above");
          checker.addNextStep("Check EFS mount configuration in user data");
          checker.addNextStep("Verify EFS file system is accessible");
          checker.addNextStep("Check security group rules for NFS traffic");
        }

        console.log("");
        checker.printAssessment("EFS Mount");

        return {
          passed: checker.isReady(),
          message: checker.isReady() ? "EFS mount healthy" : "EFS mount has issues",
        };
      })
  );
}

const cli = CliBuilder.create(
  "verify-efs-mount",
  "Verify EFS mount status on EC2 instances"
);

cli.option(
  "-w, --wait <seconds>",
  "Wait time for command execution in seconds (default: 8)",
  "8"
);

cli.parse();

const options = cli.opts();

CliBuilder.validateEnvironment(options.environment);

const config: VerifyEfsMountConfig = {
  environment: options.environment,
  region: options.region,
  profile: options.profile,
  waitTimeSeconds: parseInt(options.wait, 10) || 8,
};

verifyEfsMount(config)
  .then((result) => {
    console.log("");

    if (result.isHealthy) {
      Logger.success("EFS mount verification passed");
      Logger.info("EFS is properly mounted and configured");
      process.exit(0);
    } else {
      Logger.error("EFS mount verification failed");
      Logger.info("Fix critical issues before proceeding");
      process.exit(1);
    }
  })
  .catch((error) => {
    Logger.error(`Verification failed: ${error.message}`);
    process.exit(1);
  });
