/** @format */

// infrastructure/scripts/deployment/utils/error-messages.ts
import { Logger } from "./logger.js";

export class ErrorMessages {
  static missingAwsAccountId(): void {
    Logger.error("AWS Account ID is not set");
    console.log("");
    console.log("Troubleshooting Steps:");
    console.log("  1. Check if validate-setup job completed successfully");
    console.log(
      "  2. Verify AWS OIDC role configuration in repository secrets"
    );
    console.log("  3. Ensure AWS credentials are properly configured");
    console.log("  4. Check if determine-jobs enabled validate-setup job");
  }

  static missingEnvironment(): void {
    Logger.error("Environment is not set");
    console.log("");
    console.log("Expected Values: pipeline, development, staging, production");
    console.log("Check: Composite action input parameters");
  }

  static missingStackName(projectName?: string): void {
    Logger.error("Stack name is not set");
    console.log("");
    if (projectName && projectName !== "monitoring") {
      console.log("Expected Format: [StackName]-[project]-[environment]");
      console.log("Example: NetworkingStack-monitoring-development");
    } else {
      console.log("Expected Format: [StackName]-[environment]");
      console.log("Example: NetworkingStack-development");
    }
  }

  static bootstrapNotFound(
    accountId: string,
    region: string,
    environment: string,
    projectName?: string
  ): void {
    Logger.error("Bootstrap stack not found");
    console.log("");
    console.log(
      "The CDK bootstrap stack does not exist in this account/region."
    );
    console.log("Run the following command to bootstrap:");
    console.log("");

    const contextArgs =
      projectName && projectName !== "monitoring"
        ? `--context environment=${environment} --context project=${projectName}`
        : `--context environment=${environment}`;

    Logger.code(
      `npx cdk bootstrap aws://${accountId}/${region} ${contextArgs}`
    );
    console.log("");
    console.log("Bootstrap creates the CDKToolkit stack with:");
    console.log("  - S3 bucket for staging assets");
    console.log("  - IAM roles for deployment");
    console.log("  - ECR repository for Docker images (if needed)");
  }

  static bootstrapOutdated(
    currentVersion: number,
    requiredVersion: number,
    accountId: string,
    region: string,
    environment: string,
    projectName?: string
  ): void {
    Logger.error(
      `Bootstrap version ${currentVersion} is older than required ${requiredVersion}`
    );
    console.log("");
    console.log("SOLUTION: Re-bootstrap the environment");
    console.log("");

    const contextArgs =
      projectName && projectName !== "monitoring"
        ? `--context environment=${environment} --context project=${projectName}`
        : `--context environment=${environment}`;

    Logger.code(
      `npx cdk bootstrap aws://${accountId}/${region} ${contextArgs}`
    );
  }

  static stackNotFound(stackName: string, availableStacks: string[]): void {
    Logger.error(`Stack '${stackName}' not found in CDK application`);
    console.log("");
    console.log("Available Stacks:");
    availableStacks.forEach((stack) => console.log(`  - ${stack}`));
    console.log("");
    console.log("Possible Issues:");
    console.log("  1. Stack name mismatch (check environment suffix)");
    console.log("  2. Stack not properly exported in CDK app");
    console.log("  3. Environment configuration issues");
  }

  static exportDependencyError(): void {
    Logger.error("CloudFormation export dependency detected");
    console.log("");
    console.log(
      "Cannot delete an export that is still imported by another stack."
    );
    console.log("");
    console.log(
      "SOLUTION: Update dependent stacks first, then update this stack."
    );
    console.log("");
    console.log("Deployment Order:");
    console.log("  1. Update stacks that import the exports");
    console.log("  2. Then update the stack that exports them");
  }

  static deploymentFailed(exitCode: number): void {
    Logger.error(`Deployment failed with exit code ${exitCode}`);
    console.log("");
    console.log("Common Causes:");
    console.log("");
    console.log("RESOURCE CONFLICTS:");
    console.log("  - Duplicate resource names");
    console.log("  - CloudFormation export conflicts");
    console.log("  - Resource limits exceeded");
    console.log("");
    console.log("PERMISSION ISSUES:");
    console.log("  - Insufficient IAM permissions");
    console.log("  - Cross-account access problems");
    console.log("  - Service-linked role missing");
    console.log("");
    console.log("DEBUGGING COMMANDS:");
    Logger.code("npx cdk diff [stack-name]");
    Logger.code(
      "aws cloudformation describe-stack-events --stack-name [stack-name]"
    );
  }
}
