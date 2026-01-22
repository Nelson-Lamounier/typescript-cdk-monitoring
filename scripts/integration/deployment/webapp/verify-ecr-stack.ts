#!/usr/bin/env node
/** @format */

/**
 * ECR Repository Verification Script
 *
 * Verifies ECR repository creation and configuration for webapp infrastructure.
 * This script checks repository existence, lifecycle policies, image scanning,
 * and encryption settings.
 *
 * Verification includes:
 * 1. CloudFormation stack status
 * 2. ECR repository existence
 * 3. Repository accessibility
 * 4. Lifecycle policy configuration
 * 5. Image scanning on push
 * 6. Repository encryption
 * 7. Repository tags
 *
 * Usage:
 *   npx tsx scripts/integration/deployment/webapp/verify-ecr-stack.ts \
 *     --environment development \
 *     --region eu-west-1 \
 *     [--profile dev-account]
 */

import {
  ECRClient,
  DescribeRepositoriesCommand,
  GetLifecyclePolicyCommand,
  GetRepositoryPolicyCommand,
} from "@aws-sdk/client-ecr";
import {
  CloudFormationClient,
  DescribeStacksCommand,
} from "@aws-sdk/client-cloudformation";

import { Logger } from "../utils/logger";
import { AwsClientFactory, BaseAwsClients } from "../shared/aws-client-factory";
import {
  VerificationRunner,
  CheckBuilder,
} from "../shared/verification-framework";
import { CliBuilder } from "../shared/cli-base";

interface EcrVerificationClients extends BaseAwsClients {
  ecr: ECRClient;
  cfn: CloudFormationClient;
}

interface VerifyEcrConfig {
  profile?: string;
  region: string;
  environment: string;
}

interface EcrVerificationContext {
  config: VerifyEcrConfig;
  clients: EcrVerificationClients;
  stackName: string;
  stackStatus?: string;
  repositoryName?: string;
  repositoryUri?: string;
  repositoryExists: boolean;
  lifecyclePolicyExists: boolean;
  scanOnPush: boolean;
  encryptionType?: string;
  criticalIssues: string[];
  warnings: string[];
}

async function verifyEcrStack(
  config: VerifyEcrConfig
): Promise<{ isHealthy: boolean; criticalIssues: string[] }> {
  Logger.section(`ECR Repository Verification - ${config.environment}`);

  const clients = (await AwsClientFactory.createCommonClients(
    {
      ...config,
      sessionName: `verify-ecr-${Date.now()}`,
    },
    ["ecr", "cfn"]
  )) as EcrVerificationClients;

  const stackName = `${config.environment}-WebappEcr`;

  Logger.keyValue("Stack Name", stackName);
  Logger.keyValue("Environment", config.environment);
  Logger.keyValue("Region", config.region);
  console.log("");

  const runner = new VerificationRunner();
  const context: EcrVerificationContext = {
    config,
    clients,
    stackName,
    repositoryExists: false,
    lifecyclePolicyExists: false,
    scanOnPush: false,
    criticalIssues: [],
    warnings: [],
  };

  setupVerificationChecks(runner, context);

  await runner.run();
  runner.printSummary();

  const isHealthy = context.criticalIssues.length === 0;

  if (isHealthy) {
    Logger.success("\nECR Stack verification completed successfully");
  } else {
    Logger.error("\nECR Stack verification failed");
    context.criticalIssues.forEach((issue) => Logger.error(`  - ${issue}`));
  }

  if (context.warnings.length > 0) {
    console.log("");
    Logger.warning("Warnings:");
    context.warnings.forEach((warning) => Logger.warning(`  - ${warning}`));
  }

  return {
    isHealthy,
    criticalIssues: context.criticalIssues,
  };
}

function setupVerificationChecks(
  runner: VerificationRunner,
  context: EcrVerificationContext
): void {
  // 1. CloudFormation Stack Status
  runner.addCheck(
    CheckBuilder.create("CloudFormation Stack Status")
      .category("infrastructure")
      .critical(true)
      .execute(async () => {
        try {
          const response = await context.clients.cfn.send(
            new DescribeStacksCommand({
              StackName: context.stackName,
            })
          );

          const stack = response.Stacks?.[0];
          if (!stack) {
            context.criticalIssues.push(`Stack ${context.stackName} not found`);
            return {
              passed: false,
              message: "Stack not found",
            };
          }

          context.stackStatus = stack.StackStatus;

          const validStatuses = ["CREATE_COMPLETE", "UPDATE_COMPLETE"];
          if (!context.stackStatus || !validStatuses.includes(context.stackStatus)) {
            context.criticalIssues.push(
              `Stack in invalid state: ${context.stackStatus || "UNKNOWN"}`
            );
            return {
              passed: false,
              message: `Stack status: ${context.stackStatus || "UNKNOWN"}`,
              details: {
                "Stack Status": context.stackStatus || "UNKNOWN",
              },
            };
          }

          return {
            passed: true,
            message: `Stack is in stable state: ${context.stackStatus}`,
            details: {
              "Stack Status": context.stackStatus,
            },
          };
        } catch (error: any) {
          context.criticalIssues.push(
            `Failed to describe stack: ${error.message}`
          );
          throw error;
        }
      })
  );

  // 2. Get Repository Name from Stack Outputs
  runner.addCheck(
    CheckBuilder.create("Get Repository Name from Stack")
      .category("configuration")
      .critical(true)
      .execute(async () => {
        try {
          const response = await context.clients.cfn.send(
            new DescribeStacksCommand({
              StackName: context.stackName,
            })
          );

          const stack = response.Stacks?.[0];
          const outputs = stack?.Outputs || [];

          const repoNameOutput = outputs.find(
            (o) => o.OutputKey === "RepositoryName"
          );
          const repoUriOutput = outputs.find(
            (o) => o.OutputKey === "RepositoryUri"
          );

          if (!repoNameOutput?.OutputValue) {
            context.criticalIssues.push(
              "Repository name not found in stack outputs"
            );
            return {
              passed: false,
              message: "Repository name output missing",
            };
          }

          context.repositoryName = repoNameOutput.OutputValue;
          context.repositoryUri = repoUriOutput?.OutputValue;

          return {
            passed: true,
            message: "Repository information retrieved from stack",
            details: {
              "Repository Name": context.repositoryName,
              "Repository URI": context.repositoryUri || "N/A",
            },
          };
        } catch (error: any) {
          context.criticalIssues.push(
            `Failed to get repository name: ${error.message}`
          );
          throw error;
        }
      })
  );

  // 3. ECR Repository Existence and Accessibility
  runner.addCheck(
    CheckBuilder.create("ECR Repository Accessibility")
      .category("infrastructure")
      .critical(true)
      .execute(async () => {
        if (!context.repositoryName) {
          return {
            passed: false,
            message: "Repository name not available",
          };
        }

        try {
          const response = await context.clients.ecr.send(
            new DescribeRepositoriesCommand({
              repositoryNames: [context.repositoryName],
            })
          );

          const repository = response.repositories?.[0];
          if (!repository) {
            context.criticalIssues.push("Repository not found in ECR");
            return {
              passed: false,
              message: "Repository not accessible",
            };
          }

          context.repositoryExists = true;
          context.scanOnPush =
            repository.imageScanningConfiguration?.scanOnPush ?? false;
          context.encryptionType =
            repository.encryptionConfiguration?.encryptionType;

          return {
            passed: true,
            message: "Repository is accessible",
            details: {
              "Repository ARN": repository.repositoryArn || "N/A",
              "Created At": repository.createdAt?.toISOString() || "N/A",
              "Image Count": repository.imageTagMutability || "N/A",
            },
          };
        } catch (error: any) {
          if (error.name === "RepositoryNotFoundException") {
            context.criticalIssues.push(
              "Repository exists in CloudFormation but not in ECR"
            );
            return {
              passed: false,
              message: "Repository not found in ECR",
            };
          }
          context.criticalIssues.push(
            `Failed to describe repository: ${error.message}`
          );
          throw error;
        }
      })
  );

  // 4. Lifecycle Policy Configuration
  runner.addCheck(
    CheckBuilder.create("Lifecycle Policy Configuration")
      .category("cost-optimization")
      .optional(true)
      .execute(async () => {
        if (!context.repositoryName || !context.repositoryExists) {
          return {
            passed: false,
            message: "Repository not available",
          };
        }

        try {
          const response = await context.clients.ecr.send(
            new GetLifecyclePolicyCommand({
              repositoryName: context.repositoryName,
            })
          );

          if (response.lifecyclePolicyText) {
            context.lifecyclePolicyExists = true;
            
            const policy = JSON.parse(response.lifecyclePolicyText);
            const ruleCount = policy.rules?.length || 0;

            return {
              passed: true,
              message: "Lifecycle policy is configured",
              details: {
                "Rule Count": ruleCount.toString(),
                "Last Evaluated": response.lastEvaluatedAt?.toISOString() || "N/A",
              },
            };
          }

          context.warnings.push(
            "No lifecycle policy configured - images will be retained indefinitely"
          );
          return {
            passed: false,
            message: "No lifecycle policy configured",
          };
        } catch (error: any) {
          if (error.name === "LifecyclePolicyNotFoundException") {
            context.warnings.push(
              "No lifecycle policy - consider adding one to manage image retention"
            );
            return {
              passed: false,
              message: "No lifecycle policy found",
            };
          }
          throw error;
        }
      })
  );

  // 5. Image Scanning Configuration
  runner.addCheck(
    CheckBuilder.create("Image Scanning on Push")
      .category("security")
      .optional(true)
      .execute(async () => {
        if (!context.repositoryExists) {
          return {
            passed: false,
            message: "Repository not available",
          };
        }

        if (context.scanOnPush) {
          return {
            passed: true,
            message: "Scan on push is enabled",
            details: {
              "Scan On Push": "Enabled",
            },
          };
        }

        context.warnings.push(
          "Image scanning on push is disabled - consider enabling for security best practices"
        );
        return {
          passed: false,
          message: "Scan on push is disabled",
          details: {
            "Scan On Push": "Disabled",
          },
        };
      })
  );

  // 6. Repository Encryption
  runner.addCheck(
    CheckBuilder.create("Repository Encryption")
      .category("security")
      .execute(async () => {
        if (!context.repositoryExists) {
          return {
            passed: false,
            message: "Repository not available",
          };
        }

        if (!context.encryptionType) {
          context.warnings.push("Encryption configuration not found");
          return {
            passed: false,
            message: "Encryption status unknown",
          };
        }

        const isEncrypted = context.encryptionType !== "NONE";
        if (!isEncrypted) {
          context.warnings.push(
            "Repository encryption is not enabled - consider using KMS encryption"
          );
        }

        return {
          passed: isEncrypted,
          message: isEncrypted
            ? "Repository encryption is enabled"
            : "Repository encryption is not enabled",
          details: {
            "Encryption Type": context.encryptionType,
          },
        };
      })
  );

  // 7. Repository Policy (Permissions)
  runner.addCheck(
    CheckBuilder.create("Repository Access Policy")
      .category("security")
      .optional(true)
      .execute(async () => {
        if (!context.repositoryName || !context.repositoryExists) {
          return {
            passed: false,
            message: "Repository not available",
          };
        }

        try {
          const response = await context.clients.ecr.send(
            new GetRepositoryPolicyCommand({
              repositoryName: context.repositoryName,
            })
          );

          if (response.policyText) {
            const policy = JSON.parse(response.policyText);
            const statementCount = policy.Statement?.length || 0;

            return {
              passed: true,
              message: "Repository policy is configured",
              details: {
                "Policy Statements": statementCount.toString(),
              },
            };
          }

          return {
            passed: true,
            message: "No custom repository policy (using default access)",
          };
        } catch (error: any) {
          if (error.name === "RepositoryPolicyNotFoundException") {
            return {
              passed: true,
              message: "No custom repository policy (using default access)",
            };
          }
          throw error;
        }
      })
  );
}

// CLI Execution
if (require.main === module) {
  const cli = CliBuilder.create(
    "verify-ecr-stack",
    "Verify ECR repository deployment for webapp infrastructure"
  );

  cli.parse();
  const options = cli.opts() as VerifyEcrConfig;

  verifyEcrStack(options)
    .then(({ isHealthy }) => {
      if (!isHealthy) {
        Logger.error("\nVerification failed");
        process.exit(1);
      }
      Logger.success("\nVerification passed");
      process.exit(0);
    })
    .catch((error) => {
      Logger.error(`\nUnexpected error: ${error.message}`);
      if (process.env.VERBOSE) {
        console.error(error.stack);
      }
      process.exit(1);
    });
}

export { verifyEcrStack, VerifyEcrConfig };
