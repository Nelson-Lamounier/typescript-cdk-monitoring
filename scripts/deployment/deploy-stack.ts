#!/usr/bin/env node
/** @format */

// infrastructure/scripts/deployment/deploy-stack.ts

import { execSync } from "child_process";
import * as fs from "fs";

import { program } from "commander";

import { AWSHelpers } from "./utils/aws-helpers.js";
import { ErrorMessages } from "./utils/error-messages.js";
import { Logger } from "./utils/logger.js";
import type { DeploymentConfig, DeploymentResult } from "./utils/types.js";

async function deployStack(
  config: DeploymentConfig
): Promise<DeploymentResult> {
  Logger.section(`Deploying ${config.stackName}`);

  // Set environment variables
  process.env.ENVIRONMENT = config.environment;
  process.env.CDK_ENVIRONMENT = config.environment;
  process.env.PROJECT_NAME = config.projectName;
  process.env.AWS_REGION = config.awsRegion;
  process.env.AWS_PIPELINE_ACCOUNT_ID = config.awsAccountId;

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
    // Execute deployment
    execSync(deployCommand, {
      stdio: "inherit",
      cwd: process.cwd(),
    });

    const endTime = new Date();
    const duration = Math.round(
      (endTime.getTime() - startTime.getTime()) / 1000
    );

    Logger.success("DEPLOYMENT SUCCESSFUL");
    Logger.info(`Completed at: ${endTime.toISOString()}`);
    Logger.info(`Duration: ${duration} seconds`);

    // Set GitHub Actions output
    if (process.env.GITHUB_OUTPUT) {
      fs.appendFileSync(process.env.GITHUB_OUTPUT, "status=success\n");
    }

    return { success: true };
  } catch (error: any) {
    const endTime = new Date();
    Logger.error("DEPLOYMENT FAILED");
    Logger.info(`Failed at: ${endTime.toISOString()}`);
    Logger.info(`Exit code: ${error.status || 1}`);

    // Check for specific errors
    const errorOutput = error.stdout?.toString() || error.message || "";

    if (
      errorOutput.includes("Cannot delete export") ||
      errorOutput.includes("is in use")
    ) {
      ErrorMessages.exportDependencyError();
    } else {
      ErrorMessages.deploymentFailed(error.status || 1);
    }

    // Set GitHub Actions output
    if (process.env.GITHUB_OUTPUT) {
      fs.appendFileSync(process.env.GITHUB_OUTPUT, "status=failure\n");
    }

    return { success: false, error: error.message };
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
