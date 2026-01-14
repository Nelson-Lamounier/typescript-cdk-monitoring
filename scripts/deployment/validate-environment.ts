#!/usr/bin/env node
/** @format */

// infrastructure/scripts/deployment/validate-environment.ts

import { program } from "commander";

import { ErrorMessages } from "./utils/error-messages.js";
import { Logger } from "./utils/logger.js";
import type { DeploymentConfig, ValidationResult } from "./utils/types.js";

function validateEnvironment(config: DeploymentConfig): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  Logger.section("Validating Deployment Environment");

  // Validate required fields
  if (!config.awsAccountId) {
    ErrorMessages.missingAwsAccountId();
    errors.push("AWS Account ID is required");
  }

  if (!config.environment) {
    ErrorMessages.missingEnvironment();
    errors.push("Environment is required");
  }

  if (!config.stackName) {
    ErrorMessages.missingStackName(config.projectName);
    errors.push("Stack name is required");
  }

  if (!config.awsRegion) {
    Logger.error("AWS Region is not set");
    errors.push("AWS Region is required");
  }

  // Validate environment values
  const validEnvironments = [
    "pipeline",
    "development",
    "staging",
    "production",
  ];
  if (config.environment && !validEnvironments.includes(config.environment)) {
    Logger.warning(`Unusual environment: ${config.environment}`);
    Logger.info(`Valid environments: ${validEnvironments.join(", ")}`);
    warnings.push(`Unusual environment: ${config.environment}`);
  }

  if (errors.length > 0) {
    Logger.error(`Validation failed with ${errors.length} error(s)`);
    return { valid: false, errors, warnings };
  }

  // Display configuration
  Logger.subsection("Deployment Configuration");
  Logger.keyValue("Stack Name", config.stackName);
  Logger.keyValue("Environment", config.environment);
  Logger.keyValue("Project Name", config.projectName);
  Logger.keyValue("AWS Region", config.awsRegion);
  Logger.keyValue("AWS Account ID", config.awsAccountId, true);

  if (config.devVpcId) {
    Logger.keyValue("Dev VPC ID", config.devVpcId, true);
  }

  if (config.devAccountId) {
    Logger.keyValue("Dev Account ID", config.devAccountId, true);
  }

  Logger.success("Environment validation passed");
  return { valid: true, errors: [], warnings };
}

// Export for testing
export { validateEnvironment };

// CLI
program
  .requiredOption("--stack-name <name>", "Stack name")
  .requiredOption("--environment <env>", "Environment")
  .requiredOption("--aws-account-id <id>", "AWS Account ID")
  .requiredOption("--aws-region <region>", "AWS Region")
  .option("--project-name <name>", "Project name", "monitoring")
  .option("--dev-vpc-id <id>", "Dev VPC ID")
  .option("--dev-account-id <id>", "Dev Account ID")
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
};

const result = validateEnvironment(config);

if (!result.valid) {
  process.exit(1);
}

if (result.warnings.length > 0) {
  Logger.warning(
    `Validation completed with ${result.warnings.length} warning(s)`
  );
}
