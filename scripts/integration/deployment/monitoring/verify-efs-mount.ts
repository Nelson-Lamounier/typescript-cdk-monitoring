#!/usr/bin/env node
/** @format */

import { program } from "commander";
import {
  EC2Client,
  DescribeInstancesCommand,
  Filter,
} from "@aws-sdk/client-ec2";
import {
  SSMClient,
  SendCommandCommand,
  GetCommandInvocationCommand,
} from "@aws-sdk/client-ssm";

import { Logger } from "../utils/logger.js";

interface VerifyEfsMountConfig {
  profile?: string;
  region: string;
  environment: string;
  waitTimeSeconds?: number;
}

interface VerificationResult {
  success: boolean;
  instanceId?: string;
  commandId?: string;
  output?: string;
  errors?: string;
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

async function findInstance(
  ec2Client: EC2Client,
  environment: string
): Promise<string | null> {
  const filters: Filter[] = [
    {
      Name: "tag:Environment",
      Values: [environment],
    },
    {
      Name: "instance-state-name",
      Values: ["running"],
    },
  ];

  try {
    const command = new DescribeInstancesCommand({
      Filters: filters,
    });

    const response = await ec2Client.send(command);
    const instanceId = response.Reservations?.[0]?.Instances?.[0]?.InstanceId;

    if (!instanceId || instanceId === "None") {
      return null;
    }

    return instanceId;
  } catch (error: any) {
    Logger.error(`Failed to find instance: ${error.message}`);
    throw error;
  }
}

async function sendVerificationCommand(
  ssmClient: SSMClient,
  instanceId: string
): Promise<string> {
  try {
    const command = new SendCommandCommand({
      InstanceIds: [instanceId],
      DocumentName: "AWS-RunShellScript",
      Comment: "EFS Mount Verification",
      Parameters: {
        commands: EFS_VERIFICATION_COMMANDS,
      },
    });

    const response = await ssmClient.send(command);
    const commandId = response.Command?.CommandId;

    if (!commandId) {
      throw new Error("Failed to get command ID from SSM response");
    }

    return commandId;
  } catch (error: any) {
    Logger.error(`Failed to send SSM command: ${error.message}`);
    throw error;
  }
}

async function getCommandResults(
  ssmClient: SSMClient,
  commandId: string,
  instanceId: string
): Promise<{ output: string; errors: string }> {
  try {
    const command = new GetCommandInvocationCommand({
      CommandId: commandId,
      InstanceId: instanceId,
    });

    const response = await ssmClient.send(command);
    const output = response.StandardOutputContent || "";
    const errors = response.StandardErrorContent || "";

    return { output, errors };
  } catch (error: any) {
    Logger.error(`Failed to get command results: ${error.message}`);
    throw error;
  }
}

function sleep(seconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

async function verifyEfsMount(
  config: VerifyEfsMountConfig
): Promise<VerificationResult> {
  Logger.section("EFS Mount Verification");

  // Configure AWS clients
  const clientConfig: { region: string; profile?: string } = {
    region: config.region,
  };

  if (config.profile) {
    // Note: AWS SDK v3 doesn't support profile directly in client config
    // Profile should be set via AWS_PROFILE environment variable or credentials file
    Logger.info(`Using AWS profile: ${config.profile}`);
  }

  const ec2Client = new EC2Client(clientConfig);
  const ssmClient = new SSMClient(clientConfig);

  // Find instance
  Logger.subsection("Finding EC2 Instance");
  Logger.info(`Environment: ${config.environment}`);
  Logger.info(`Region: ${config.region}`);

  const instanceId = await findInstance(ec2Client, config.environment);

  if (!instanceId) {
    Logger.error("No running instances found");
    return {
      success: false,
    };
  }

  Logger.success(`Found instance: ${instanceId}`);
  Logger.keyValue("Instance ID", instanceId);

  // Send verification command
  Logger.subsection("Sending Verification Command");
  const commandId = await sendVerificationCommand(ssmClient, instanceId);
  Logger.success(`Command sent successfully`);
  Logger.keyValue("Command ID", commandId);

  // Wait for execution
  const waitTime = config.waitTimeSeconds || 8;
  Logger.info(`Waiting ${waitTime} seconds for command execution...`);
  await sleep(waitTime);

  // Get results
  Logger.subsection("Results");
  const { output, errors } = await getCommandResults(
    ssmClient,
    commandId,
    instanceId
  );

  if (output) {
    console.log(output);
  }

  if (errors && errors !== "None") {
    Logger.subsection("Errors");
    console.log(errors);
  }

  Logger.section("Verification Complete");

  return {
    success: true,
    instanceId,
    commandId,
    output,
    errors: errors && errors !== "None" ? errors : undefined,
  };
}

// CLI
program
  .name("verify-efs-mount")
  .description("Verify EFS mount status on EC2 instances")
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
  .option(
    "-w, --wait <seconds>",
    "Wait time for command execution in seconds (default: 8)",
    "8"
  )
  .parse();

const options = program.opts();

const config: VerifyEfsMountConfig = {
  environment: options.environment,
  region: options.region,
  profile: options.profile,
  waitTimeSeconds: parseInt(options.wait, 10) || 8,
};

// Set AWS profile if provided
if (config.profile) {
  process.env.AWS_PROFILE = config.profile;
}

verifyEfsMount(config)
  .then((result) => {
    if (!result.success) {
      process.exit(1);
    }
  })
  .catch((error) => {
    Logger.error(`Verification failed: ${error.message}`);
    process.exit(1);
  });
