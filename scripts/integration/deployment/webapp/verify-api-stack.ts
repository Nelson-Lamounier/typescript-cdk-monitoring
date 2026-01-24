#!/usr/bin/env node
/** @format */

/**
 * API Stack Verification Script
 *
 * Verifies API Gateway and Lambda function deployment for webapp infrastructure.
 * This script checks API Gateway configuration, Lambda function states,
 * and performs smoke tests on API endpoints.
 *
 * Verification includes:
 * 1. CloudFormation stack status
 * 2. API Gateway deployment
 * 3. Lambda function states and configurations
 * 4. API Gateway stages and deployment
 * 5. Lambda function permissions
 * 6. API endpoint smoke tests (optional)
 *
 * Usage:
 *   npx tsx scripts/integration/deployment/webapp/verify-api-stack.ts \
 *     --environment development \
 *     --region eu-west-1 \
 *     [--profile dev-account] \
 *     [--skip-smoke-tests]
 */

import {
  LambdaClient,
  GetFunctionConfigurationCommand,
} from "@aws-sdk/client-lambda";
import {
  APIGatewayClient,
  GetRestApiCommand,
  GetStageCommand,
} from "@aws-sdk/client-api-gateway";
import {
  CloudFormationClient,
  DescribeStacksCommand,
  DescribeStackResourcesCommand,
} from "@aws-sdk/client-cloudformation";

import { Logger } from "../utils/logger";
import { AwsClientFactory, BaseAwsClients } from "../shared/aws-client-factory";
import {
  VerificationRunner,
  CheckBuilder,
} from "../shared/verification-framework";
import { CliBuilder } from "../shared/cli-base";

interface ApiVerificationClients extends BaseAwsClients {
  lambda: LambdaClient;
  apigateway: APIGatewayClient;
  cfn: CloudFormationClient;
}

interface VerifyApiConfig {
  profile?: string;
  region: string;
  environment: string;
  skipSmokeTests?: boolean;
}

interface ApiVerificationContext {
  config: VerifyApiConfig;
  clients: ApiVerificationClients;
  stackName: string;
  stackStatus?: string;
  apiId?: string;
  apiEndpoint?: string;
  stageName?: string;
  lambdaFunctions: Array<{
    name: string;
    arn?: string;
    state?: string;
    runtime?: string;
    handler?: string;
  }>;
  tableExists: boolean;
  criticalIssues: string[];
  warnings: string[];
}

async function verifyApiStack(
  config: VerifyApiConfig
): Promise<{ isHealthy: boolean; criticalIssues: string[] }> {
  Logger.section(`API Stack Verification - ${config.environment}`);

  const clients = (await AwsClientFactory.createCommonClients(
    {
      ...config,
      sessionName: `verify-api-${Date.now()}`,
    },
    ["lambda", "apigateway", "cfn"]
  )) as ApiVerificationClients;

  const stackName = `${config.environment}-WebappApi`;

  Logger.keyValue("Stack Name", stackName);
  Logger.keyValue("Environment", config.environment);
  Logger.keyValue("Region", config.region);
  Logger.keyValue("Skip Smoke Tests", config.skipSmokeTests ? "Yes" : "No");
  console.log("");

  const runner = new VerificationRunner();
  const context: ApiVerificationContext = {
    config,
    clients,
    stackName,
    lambdaFunctions: [],
    tableExists: false,
    criticalIssues: [],
    warnings: [],
  };

  setupVerificationChecks(runner, context);

  await runner.run();
  runner.printSummary();

  const isHealthy = context.criticalIssues.length === 0;

  if (isHealthy) {
    Logger.success("\nAPI Stack verification completed successfully");
    if (context.apiEndpoint) {
      console.log("");
      Logger.info(`API Endpoint: ${context.apiEndpoint}`);
    }
  } else {
    Logger.error("\nAPI Stack verification failed");
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
  context: ApiVerificationContext
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

  // 2. Get API Gateway ID from Stack Outputs
  runner.addCheck(
    CheckBuilder.create("Get API Gateway ID from Stack")
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

          const apiIdOutput = outputs.find((o) => o.OutputKey === "ApiId");
          const apiEndpointOutput = outputs.find(
            (o) => o.OutputKey === "ApiEndpoint"
          );

          if (!apiIdOutput?.OutputValue) {
            context.criticalIssues.push(
              "API Gateway ID not found in stack outputs"
            );
            return {
              passed: false,
              message: "API Gateway ID output missing",
            };
          }

          context.apiId = apiIdOutput.OutputValue;
          context.apiEndpoint = apiEndpointOutput?.OutputValue;

          return {
            passed: true,
            message: "API Gateway information retrieved from stack",
            details: {
              "API Gateway ID": context.apiId,
              "API Endpoint": context.apiEndpoint || "Not configured",
            },
          };
        } catch (error: any) {
          context.criticalIssues.push(
            `Failed to get API Gateway ID: ${error.message}`
          );
          throw error;
        }
      })
  );

  // 3. API Gateway Configuration
  runner.addCheck(
    CheckBuilder.create("API Gateway Configuration")
      .category("api-gateway")
      .critical(true)
      .execute(async () => {
        if (!context.apiId) {
          return {
            passed: false,
            message: "API Gateway ID not available",
          };
        }

        try {
          const response = await context.clients.apigateway.send(
            new GetRestApiCommand({
              restApiId: context.apiId,
            })
          );

          if (!response.id) {
            context.criticalIssues.push("API Gateway not found");
            return {
              passed: false,
              message: "API Gateway not found",
            };
          }

          return {
            passed: true,
            message: "API Gateway is configured",
            details: {
              "API Name": response.name || "N/A",
              "Created Date": response.createdDate?.toISOString() || "N/A",
              "API Key Source": response.apiKeySource || "HEADER",
            },
          };
        } catch (error: any) {
          if (error.name === "NotFoundException") {
            context.criticalIssues.push(
              "API Gateway exists in CloudFormation but not in API Gateway"
            );
            return {
              passed: false,
              message: "API Gateway not found",
            };
          }
          context.criticalIssues.push(
            `Failed to describe API Gateway: ${error.message}`
          );
          throw error;
        }
      })
  );

  // 4. API Gateway Stage
  runner.addCheck(
    CheckBuilder.create("API Gateway Stage Deployment")
      .category("api-gateway")
      .execute(async () => {
        if (!context.apiId) {
          return {
            passed: false,
            message: "API Gateway ID not available",
          };
        }

        // Extract stage from endpoint or use default
        const stageName = context.apiEndpoint?.split("/").pop() || "prod";
        context.stageName = stageName;

        try {
          const response = await context.clients.apigateway.send(
            new GetStageCommand({
              restApiId: context.apiId,
              stageName,
            })
          );

          if (!response.stageName) {
            context.warnings.push(`Stage ${stageName} not found`);
            return {
              passed: false,
              message: `Stage ${stageName} not deployed`,
            };
          }

          return {
            passed: true,
            message: `Stage ${stageName} is deployed`,
            details: {
              "Stage Name": response.stageName,
              "Deployment ID": response.deploymentId || "N/A",
              "Last Updated": response.lastUpdatedDate?.toISOString() || "N/A",
              "Cache Enabled": response.cacheClusterEnabled ? "Yes" : "No",
            },
          };
        } catch (error: any) {
          if (error.name === "NotFoundException") {
            context.warnings.push(`Stage ${stageName} not found`);
            return {
              passed: false,
              message: `Stage ${stageName} not deployed`,
            };
          }
          throw error;
        }
      })
  );

  // 5. Lambda Functions Discovery
  runner.addCheck(
    CheckBuilder.create("Discover Lambda Functions")
      .category("compute")
      .critical(true)
      .execute(async () => {
        try {
          const response = await context.clients.cfn.send(
            new DescribeStackResourcesCommand({
              StackName: context.stackName,
            })
          );

          const lambdaResources =
            response.StackResources?.filter(
              (r) => r.ResourceType === "AWS::Lambda::Function"
            ) || [];

          if (lambdaResources.length === 0) {
            context.warnings.push("No Lambda functions found in stack");
            return {
              passed: false,
              message: "No Lambda functions deployed",
            };
          }

          context.lambdaFunctions = lambdaResources.map((r) => ({
            name: r.PhysicalResourceId || "Unknown",
            arn: r.PhysicalResourceId,
          }));

          return {
            passed: true,
            message: `Discovered ${context.lambdaFunctions.length} Lambda function(s)`,
            details: {
              "Function Count": context.lambdaFunctions.length.toString(),
            },
          };
        } catch (error: any) {
          context.criticalIssues.push(
            `Failed to discover Lambda functions: ${error.message}`
          );
          throw error;
        }
      })
  );

  // 6. Lambda Function States
  runner.addCheck(
    CheckBuilder.create("Lambda Function States")
      .category("compute")
      .critical(true)
      .execute(async () => {
        if (context.lambdaFunctions.length === 0) {
          return {
            passed: false,
            message: "No Lambda functions to check",
          };
        }

        const functionDetails = await Promise.all(
          context.lambdaFunctions.map(async (func) => {
            try {
              const response = await context.clients.lambda.send(
                new GetFunctionConfigurationCommand({
                  FunctionName: func.name,
                })
              );

              func.state = response.State;
              func.runtime = response.Runtime;
              func.handler = response.Handler;

              return {
                name: func.name,
                state: response.State,
                runtime: response.Runtime,
              };
            } catch (error: any) {
              return {
                name: func.name,
                state: "ERROR",
                runtime: "Unknown",
                error: error.message,
              };
            }
          })
        );

        const activeFunctions = functionDetails.filter(
          (f) => f.state === "Active"
        );
        const inactiveFunctions = functionDetails.filter(
          (f) => f.state !== "Active"
        );

        if (inactiveFunctions.length > 0) {
          const inactiveList = inactiveFunctions
            .map((f) => `${f.name}: ${f.state}`)
            .join(", ");
          context.criticalIssues.push(
            `Some functions are not Active: ${inactiveList}`
          );
          return {
            passed: false,
            message: `${inactiveFunctions.length} function(s) not Active`,
            details: {
              "Active Functions": activeFunctions.length.toString(),
              "Total Functions": functionDetails.length.toString(),
            },
          };
        }

        return {
          passed: true,
          message: "All Lambda functions are Active",
          details: {
            "Active Functions": activeFunctions.length.toString(),
            "Function Names": functionDetails
              .map((f) => `${f.name} (${f.runtime})`)
              .join(", "),
          },
        };
      })
  );

  // 7. API Endpoint Smoke Test (Optional)
  if (!context.config.skipSmokeTests) {
    runner.addCheck(
      CheckBuilder.create("API Endpoint Smoke Test")
        .category("integration")
        .optional(true)
        .execute(async () => {
          if (!context.apiEndpoint) {
            return {
              passed: false,
              message: "API endpoint not available for testing",
            };
          }

          try {
            // Test health endpoint
            const healthUrl = `${context.apiEndpoint}/health`;
            const healthResponse = await fetch(healthUrl, {
              method: "GET",
              signal: AbortSignal.timeout(10000),
            });

            if (healthResponse.ok) {
              return {
                passed: true,
                message: "Health endpoint responding",
                details: {
                  "Health Endpoint": healthUrl,
                  "HTTP Status": healthResponse.status.toString(),
                },
              };
            }

            // Try articles endpoint
            const articlesUrl = `${context.apiEndpoint}/articles`;
            const articlesResponse = await fetch(articlesUrl, {
              method: "GET",
              signal: AbortSignal.timeout(10000),
            });

            if (articlesResponse.ok) {
              return {
                passed: true,
                message: "Articles endpoint responding",
                details: {
                  "Articles Endpoint": articlesUrl,
                  "HTTP Status": articlesResponse.status.toString(),
                },
              };
            }

            context.warnings.push(
              `API endpoints returned non-200 status: health=${healthResponse.status}, articles=${articlesResponse.status}`
            );
            return {
              passed: false,
              message: "API endpoints not responding with 200",
              details: {
                "Health Status": healthResponse.status.toString(),
                "Articles Status": articlesResponse.status.toString(),
              },
            };
          } catch (error: any) {
            context.warnings.push(
              `Failed to test API endpoints: ${error.message}`
            );
            return {
              passed: false,
              message: `API smoke test failed: ${error.message}`,
            };
          }
        })
    );
  }
}

// CLI Execution
if (require.main === module) {
  const cli = CliBuilder.create(
    "verify-api-stack",
    "Verify API Gateway and Lambda deployment for webapp infrastructure"
  ).option(
    "--skip-smoke-tests",
    "Skip HTTP smoke tests (default: false)",
    false
  );

  cli.parse();
  const options = cli.opts() as VerifyApiConfig;

  verifyApiStack(options)
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

export { verifyApiStack, VerifyApiConfig };
