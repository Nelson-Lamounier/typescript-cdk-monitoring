#!/usr/bin/env node
/** @format */

// infrastructure/scripts/deployment/deploy-stack.ts

import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

import { program } from "commander";
import {
  CloudFormationClient,
  DescribeStacksCommand,
} from "@aws-sdk/client-cloudformation";

import { AWSHelpers } from "./utils/aws-helpers.js";
import { ErrorMessages } from "./utils/error-messages.js";
import { Logger } from "./utils/logger.js";
import type { DeploymentConfig, DeploymentResult } from "./utils/types.js";

/**
 * Mask sensitive values in output for GitHub Actions logs
 */
function maskSensitiveValue(value: string): void {
  if (process.env.GITHUB_ACTIONS === "true" && value) {
    // GitHub Actions automatically masks values written to stderr with ::
    console.error(`::add-mask::${value}`);
  }
}

/**
 * Get stack outputs from CloudFormation
 */
async function getStackOutputs(
  stackName: string,
  region: string
): Promise<Record<string, string>> {
  const cfnClient = new CloudFormationClient({ region });

  try {
    const command = new DescribeStacksCommand({
      StackName: stackName,
    });

    const response = await cfnClient.send(command);
    const stack = response.Stacks?.[0];

    if (!stack || !stack.Outputs) {
      return {};
    }

    const outputs: Record<string, string> = {};
    stack.Outputs.forEach((output) => {
      if (output.OutputKey && output.OutputValue) {
        outputs[output.OutputKey] = output.OutputValue;
      }
    });

    return outputs;
  } catch (error: any) {
    Logger.warning(`Failed to retrieve stack outputs: ${error.message}`);
    return {};
  }
}

/**
 * Save outputs to a secure file
 */
function saveOutputsSecurely(
  stackName: string,
  outputs: Record<string, string>,
  environment: string
): string {
  const outputDir = path.join(process.cwd(), ".deployment-outputs");
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `${stackName}-${timestamp}.json`;
  const filepath = path.join(outputDir, filename);

  const outputData = {
    stackName,
    environment,
    timestamp: new Date().toISOString(),
    outputs,
  };

  fs.writeFileSync(filepath, JSON.stringify(outputData, null, 2));
  return filepath;
}

/**
 * Mask all sensitive values in outputs
 */
function maskOutputs(outputs: Record<string, string>): void {
  // List of output keys that contain sensitive information
  const sensitiveKeys = [
    "VpcId",
    "SubnetId",
    "SubnetIds",
    "PrivateSubnetIds",
    "PublicSubnetIds",
    "SecurityGroupId",
    "FileSystemId",
    "AccessPointId",
    "LoadBalancerDns",
    "LoadBalancerArn",
    "ListenerArn",
    "TargetGroupArn",
    "ServiceArn",
    "TaskDefinitionArn",
    "ClusterArn",
    "AutoScalingGroupName",
    "RoleArn",
    "CertificateArn",
    "HostedZoneId",
  ];

  Object.entries(outputs).forEach(([key, value]) => {
    // Mask if key matches sensitive pattern or contains IDs/ARNs
    if (
      sensitiveKeys.some((sensitive) =>
        key.toLowerCase().includes(sensitive.toLowerCase())
      ) ||
      value.match(/^(arn:|vpc-|subnet-|sg-|fs-|fsap-|i-[0-9a-f]+)/i)
    ) {
      maskSensitiveValue(value);
      // Also mask comma-separated values
      if (value.includes(",")) {
        value.split(",").forEach((v) => maskSensitiveValue(v.trim()));
      }
    }
  });
}

async function deployStack(
  config: DeploymentConfig
): Promise<DeploymentResult> {
  Logger.section(`Deploying ${config.stackName}`);

  // Set environment variables
  process.env.ENVIRONMENT = config.environment;
  process.env.CDK_ENVIRONMENT = config.environment;
  process.env.PROJECT_NAME = config.projectName;
  process.env.AWS_REGION = config.awsRegion;
  process.env.AWS_ACCOUNT_ID_DEV = config.awsAccountId;

  if (config.devVpcId) {
    process.env.DEV_VPC_ID = config.devVpcId;
    Logger.info("Cross-account VPC configured");
  }

  // Set environment-specific account ID
  switch (config.environment) {
    case "pipeline":
      process.env.AWS_PIPELINE_ACCOUNT_ID = config.awsAccountId;
      break;
    case "development":
      if (config.devAccountId) {
        process.env.AWS_ACCOUNT_ID_DEV = config.devAccountId;
      }
      break;
  }

  // Cleanup change sets
  const aws = new AWSHelpers(config.awsRegion);
  await aws.cleanupChangeSets(config.stackName);

  // Build deploy command
  const contextArgs =
    config.projectName && config.projectName !== "monitoring"
      ? `--context environment=${config.environment} --context project=${config.projectName}`
      : `--context environment=${config.environment}`;

  const deployCommand = `npx cdk deploy "${config.stackName}" ${contextArgs} ${
    config.additionalArgs || "--require-approval never"
  }`;

  Logger.subsection("Deployment Command");
  Logger.code(deployCommand);
  console.log("");

  const startTime = new Date();
  Logger.info(`Started at: ${startTime.toISOString()}`);

  try {
    // Execute deployment - CDK deploy handles both create and update automatically
    // CDK output is displayed directly via stdio: inherit for better visibility
    execSync(deployCommand, {
      stdio: "inherit", // Let CDK display output directly for better visibility
      cwd: process.cwd(),
      encoding: "utf-8",
    });

    const endTime = new Date();
    const duration = Math.round(
      (endTime.getTime() - startTime.getTime()) / 1000
    );

    Logger.success("DEPLOYMENT SUCCESSFUL");
    Logger.info(`Completed at: ${endTime.toISOString()}`);
    Logger.info(`Duration: ${duration} seconds`);

    // Retrieve and process stack outputs
    Logger.subsection("Retrieving Stack Outputs");
    const stackOutputs = await getStackOutputs(
      config.stackName,
      config.awsRegion
    );

    if (Object.keys(stackOutputs).length > 0) {
      // Mask sensitive values before logging
      maskOutputs(stackOutputs);

      // Save outputs securely
      const outputFile = saveOutputsSecurely(
        config.stackName,
        stackOutputs,
        config.environment
      );
      Logger.info(`Stack outputs saved to: ${outputFile}`);

      // Log summary (without sensitive values)
      Logger.subsection("Stack Outputs Summary");
      Logger.info(
        `Retrieved ${
          Object.keys(stackOutputs).length
        } output(s) (sensitive values masked)`
      );
      Logger.info("Full outputs saved to deployment artifacts");

      // Set GitHub Actions outputs
      if (process.env.GITHUB_OUTPUT) {
        fs.appendFileSync(process.env.GITHUB_OUTPUT, "status=success\n");
        fs.appendFileSync(
          process.env.GITHUB_OUTPUT,
          `stack_outputs=${JSON.stringify(stackOutputs)}\n`
        );
        fs.appendFileSync(
          process.env.GITHUB_OUTPUT,
          `output_file=${outputFile}\n`
        );
      }

      return { success: true, stackOutputs };
    } else {
      Logger.warning("No stack outputs found");
      if (process.env.GITHUB_OUTPUT) {
        fs.appendFileSync(process.env.GITHUB_OUTPUT, "status=success\n");
      }
      return { success: true };
    }
  } catch (error: any) {
    const endTime = new Date();
    Logger.error("DEPLOYMENT FAILED");
    Logger.info(`Failed at: ${endTime.toISOString()}`);
    Logger.info(`Exit code: ${error.status || 1}`);

    // Extract error details - CDK output was displayed via stdio: inherit
    const errorMessage = error.message || "";

    // Note: With stdio: inherit, CDK errors are already displayed to the user
    // We provide additional context and troubleshooting here

    Logger.subsection("Troubleshooting");
    Logger.info(
      "CDK deploy automatically handles both stack creation and updates"
    );
    Logger.info(
      "If the stack already exists, CDK will update it automatically"
    );
    Logger.info("");

    // Check for common error patterns in the error message
    if (
      errorMessage.includes("Cannot delete export") ||
      errorMessage.includes("is in use")
    ) {
      ErrorMessages.exportDependencyError();
    } else if (
      errorMessage.includes("does not exist") &&
      errorMessage.includes("Stack")
    ) {
      Logger.error("Stack not found in CDK application");
      Logger.info("This may indicate:");
      Logger.info("  1. Stack name mismatch (check environment suffix)");
      Logger.info("  2. Stack not exported in CDK app");
      Logger.info("  3. CDK context configuration issue");
    } else if (
      errorMessage.includes("AccessDenied") ||
      errorMessage.includes("UnauthorizedOperation")
    ) {
      Logger.error("Permission denied");
      Logger.info("Check IAM role permissions for:");
      Logger.info("  - cloudformation:*");
      Logger.info("  - iam:* (for role creation)");
      Logger.info("  - s3:* (for asset uploads)");
      Logger.info("  - ecr:* (for Docker images, if used)");
    } else {
      ErrorMessages.deploymentFailed(error.status || 1);
      Logger.info("");
      Logger.info(
        "The CDK error output above shows the specific failure reason"
      );
      Logger.info("Common issues:");
      Logger.info("  - Resource conflicts (duplicate names)");
      Logger.info("  - Insufficient permissions");
      Logger.info("  - Resource limits exceeded");
      Logger.info("  - Invalid configuration");
    }

    // Set GitHub Actions output
    if (process.env.GITHUB_OUTPUT) {
      fs.appendFileSync(process.env.GITHUB_OUTPUT, "status=failure\n");
    }

    return { success: false, error: errorMessage || "Deployment failed" };
  }
}

// CLI
program
  .requiredOption("--stack-name <name>", "Stack name")
  .requiredOption("--environment <env>", "Environment")
  .requiredOption("--aws-account-id <id>", "AWS Account ID")
  .requiredOption("--aws-region <region>", "AWS Region")
  .option("--project-name <name>", "Project name", "monitoring")
  .option("--dev-vpc-id <id>", "Dev VPC ID")
  .option("--dev-account-id <id>", "Dev Account ID")
  .option(
    "--additional-args <args>",
    "Additional CDK arguments",
    "--require-approval never"
  )
  .parse();

const options = program.opts();

const config: DeploymentConfig = {
  stackName: options.stackName,
  environment: options.environment,
  projectName: options.projectName,
  awsAccountId: options.awsAccountId,
  awsRegion: options.awsRegion,
  devVpcId: options.devVpcId,
  devAccountId: options.devAccountId,
  additionalArgs: options.additionalArgs,
};

deployStack(config)
  .then((result) => {
    if (!result.success) {
      process.exit(1);
    }
  })
  .catch((error) => {
    Logger.error(`Deployment failed: ${error.message}`);
    process.exit(1);
  });
