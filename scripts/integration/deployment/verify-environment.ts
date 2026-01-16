#!/usr/bin/env node
/** @format */

// infrastructure/scripts/deployment/verify-environment.ts

import { program } from "commander";

import { EnvironmentChecker } from "./utils/environment-checker.js";
import { Logger } from "./utils/logger.js";
import type { EnvironmentVerification } from "./utils/types.js";

async function verifyEnvironment(
  environment: string,
  awsRegion: string,
  autoBuildOnFailure: boolean = false
): Promise<EnvironmentVerification> {
  Logger.section("Verifying CDK Deployment Environment");

  const checks = EnvironmentChecker.runAllChecks();
  const errors: string[] = [];
  const warnings: string[] = [];

  // Display check results
  Logger.subsection("Component Availability");
  for (const check of checks) {
    if (check.available) {
      const versionInfo = check.version ? ` (${check.version})` : "";
      Logger.success(`${check.component}${versionInfo}`);
    } else {
      Logger.error(`${check.component}: Not available`);
      if (check.message) {
        console.log(`  ${check.message}`);
      }
      errors.push(`${check.component} not available`);
    }
  }

  // Check build artifacts
  Logger.subsection("Build Artifacts");
  const artifacts = EnvironmentChecker.checkBuildArtifacts("./dist");

  if (artifacts.exists) {
    Logger.success(`Found ${artifacts.fileCount} compiled JavaScript files`);
    console.log("");
    console.log("Sample files:");
    artifacts.paths.forEach((p) => console.log(`  - ${p}`));
  } else {
    Logger.warning("No compiled JavaScript files found in dist/");

    if (autoBuildOnFailure) {
      Logger.info("Attempting to build...");
      console.log("");

      const buildSuccess = await EnvironmentChecker.attemptBuild();

      if (buildSuccess) {
        const newArtifacts = EnvironmentChecker.checkBuildArtifacts("./dist");
        if (newArtifacts.exists) {
          Logger.success(
            `Build successful: ${newArtifacts.fileCount} files created`
          );
          console.log("");
          console.log("Sample files:");
          newArtifacts.paths.forEach((p) => console.log(`  - ${p}`));
        } else {
          Logger.warning("Build completed but no artifacts found");
          Logger.info("CDK may use ts-node for just-in-time compilation");
          warnings.push("No build artifacts, relying on ts-node");
        }
      } else {
        Logger.error("Build failed");
        errors.push("Build artifacts missing and build failed");
      }
    } else {
      Logger.info("Note: CDK may use ts-node for just-in-time compilation");
      warnings.push("No build artifacts found");
    }
  }

  // Environment summary
  Logger.subsection("Environment Summary");
  Logger.keyValue("Environment", environment);
  Logger.keyValue("AWS Region", awsRegion);
  Logger.keyValue(
    "Checks Passed",
    `${checks.filter((c) => c.available).length}/${checks.length}`
  );
  Logger.keyValue("Errors", errors.length.toString());
  Logger.keyValue("Warnings", warnings.length.toString());

  const passed = errors.length === 0;

  if (passed) {
    console.log("");
    Logger.success("ENVIRONMENT SETUP COMPLETE");
    Logger.info("Ready for CDK deployment operations");
  } else {
    console.log("");
    Logger.error("ENVIRONMENT SETUP FAILED");
    console.log("");
    displayTroubleshootingGuide(errors);
  }

  return {
    passed,
    checks,
    errors,
    warnings,
  };
}

function displayTroubleshootingGuide(errors: string[]): void {
  console.log(
    `${errors.length} critical issue(s) detected that will prevent deployment`
  );
  console.log("");
  console.log("TROUBLESHOOTING STEPS:");
  console.log("");

  if (errors.some((e) => e.includes("Node.js") || e.includes("Yarn"))) {
    console.log("CHECK PREVIOUS JOBS:");
    console.log("  - Verify setup-infrastructure action succeeded");
    console.log("  - Check Node.js setup step completed");
    console.log("  - Ensure yarn installation worked");
    console.log("");
  }

  if (errors.some((e) => e.includes("AWS"))) {
    console.log("CHECK AWS CREDENTIALS:");
    console.log("  - AWS OIDC role configuration");
    console.log("  - Repository secrets (AWS_OIDC_ROLE)");
    console.log("  - IAM permissions for deployment");
    console.log("  - Role trust policy allows GitHub Actions");
    console.log("");
  }

  if (errors.some((e) => e.includes("CDK"))) {
    console.log("CHECK CDK INSTALLATION:");
    console.log("  - CDK listed in package.json dependencies");
    console.log("  - node_modules directory exists");
    console.log("  - yarn install completed successfully");
    console.log("");
  }

  if (errors.some((e) => e.includes("Build"))) {
    console.log("CHECK BUILD ARTIFACTS:");
    console.log("  - Build job completed successfully");
    console.log("  - Cache restoration worked properly");
    console.log("  - TypeScript compilation succeeded");
    console.log("  - Check build job logs for errors");
    console.log("");
  }

  console.log("VALIDATION COMMANDS:");
  Logger.code("node --version");
  Logger.code("yarn --version");
  Logger.code("aws sts get-caller-identity");
  Logger.code("npx cdk --version");
  Logger.code("yarn build");
  console.log("");
}

// CLI
program
  .requiredOption("--environment <env>", "Environment name")
  .requiredOption("--aws-region <region>", "AWS region")
  .option(
    "--auto-build-on-failure",
    "Automatically build if artifacts missing",
    false
  )
  .parse();

const options = program.opts();

verifyEnvironment(
  options.environment,
  options.awsRegion,
  options.autoBuildOnFailure
)
  .then((result) => {
    if (!result.passed) {
      process.exit(1);
    }

    if (result.warnings.length > 0) {
      console.log("");
      Logger.warning(
        `Verification completed with ${result.warnings.length} warning(s)`
      );
    }
  })
  .catch((error) => {
    Logger.error(`Environment verification failed: ${error.message}`);
    process.exit(1);
  });
