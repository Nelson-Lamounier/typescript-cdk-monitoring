#!/usr/bin/env node
/** @format */

// infrastructure/scripts/deployment/verify-bootstrap.ts

import { program } from "commander";

import { AWSHelpers } from "./utils/aws-helpers.js";
import { ErrorMessages } from "./utils/error-messages.js";
import { Logger } from "./utils/logger.js";

async function verifyBootstrap(
  accountId: string,
  region: string,
  environment: string,
  projectName?: string
): Promise<void> {
  Logger.section("Verifying CDK Bootstrap");

  const aws = new AWSHelpers(region);
  const bootstrapInfo = await aws.getBootstrapInfo(accountId);

  if (!bootstrapInfo.exists) {
    ErrorMessages.bootstrapNotFound(
      accountId,
      region,
      environment,
      projectName
    );
    process.exit(1);
  }

  if (bootstrapInfo.version) {
    Logger.info(`Current bootstrap version: ${bootstrapInfo.version}`);
    Logger.info(`Required version: 30 or later`);

    if (bootstrapInfo.needsUpgrade) {
      ErrorMessages.bootstrapOutdated(
        bootstrapInfo.version,
        30,
        accountId,
        region,
        environment,
        projectName
      );
      process.exit(1);
    }

    Logger.success(
      `Bootstrap version is up to date (v${bootstrapInfo.version})`
    );
  } else {
    Logger.warning("Could not determine bootstrap version");
    Logger.info(
      "Deployment will proceed, but may fail if bootstrap is outdated"
    );
  }
}

// CLI
program
  .requiredOption("--aws-account-id <id>", "AWS Account ID")
  .requiredOption("--aws-region <region>", "AWS Region")
  .requiredOption("--environment <env>", "Environment")
  .option("--project-name <name>", "Project name")
  .parse();

const options = program.opts();

verifyBootstrap(
  options.awsAccountId,
  options.awsRegion,
  options.environment,
  options.projectName
).catch((error) => {
  Logger.error(`Bootstrap verification failed: ${error.message}`);
  process.exit(1);
});
