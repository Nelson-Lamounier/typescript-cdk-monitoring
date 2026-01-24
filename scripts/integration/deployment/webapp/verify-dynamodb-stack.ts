#!/usr/bin/env node
/** @format */

/**
 * DynamoDB Stack Verification Script
 *
 * Verifies DynamoDB table and S3 bucket creation for webapp infrastructure.
 * This script checks table existence, configuration, encryption, and associated
 * S3 bucket for assets.
 *
 * Verification includes:
 * 1. CloudFormation stack status
 * 2. DynamoDB table existence and status
 * 3. Table encryption settings
 * 4. Point-in-time recovery status
 * 5. Global Secondary Indexes
 * 6. S3 assets bucket existence
 * 7. S3 bucket encryption
 *
 * Usage:
 *   npx tsx scripts/integration/deployment/webapp/verify-dynamodb-stack.ts \
 *     --environment development \
 *     --region eu-west-1 \
 *     [--profile dev-account]
 */

import {
  DynamoDBClient,
  DescribeTableCommand,
  DescribeContinuousBackupsCommand,
} from "@aws-sdk/client-dynamodb";
import {
  S3Client,
  HeadBucketCommand,
  GetBucketEncryptionCommand,
  GetBucketVersioningCommand,
} from "@aws-sdk/client-s3";
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

interface DynamoDbVerificationClients extends BaseAwsClients {
  dynamodb: DynamoDBClient;
  s3: S3Client;
  cfn: CloudFormationClient;
}

interface VerifyDynamoDbConfig {
  profile?: string;
  region: string;
  environment: string;
}

interface DynamoDbVerificationContext {
  config: VerifyDynamoDbConfig;
  clients: DynamoDbVerificationClients;
  stackName: string;
  stackStatus?: string;
  tableName?: string;
  bucketName?: string;
  tableStatus?: string;
  tableExists: boolean;
  bucketExists: boolean;
  tableEncrypted: boolean;
  pitrEnabled: boolean;
  gsiCount: number;
  itemCount: number;
  bucketEncrypted: boolean;
  criticalIssues: string[];
  warnings: string[];
}

async function verifyDynamoDbStack(
  config: VerifyDynamoDbConfig
): Promise<{ isHealthy: boolean; criticalIssues: string[] }> {
  Logger.section(`DynamoDB Stack Verification - ${config.environment}`);

  const clients = (await AwsClientFactory.createCommonClients(
    {
      ...config,
      sessionName: `verify-dynamodb-${Date.now()}`,
    },
    ["dynamodb", "s3", "cfn"]
  )) as DynamoDbVerificationClients;

  const stackName = `${config.environment}-WebappDynamoDb`;

  Logger.keyValue("Stack Name", stackName);
  Logger.keyValue("Environment", config.environment);
  Logger.keyValue("Region", config.region);
  console.log("");

  const runner = new VerificationRunner();
  const context: DynamoDbVerificationContext = {
    config,
    clients,
    stackName,
    tableExists: false,
    bucketExists: false,
    tableEncrypted: false,
    pitrEnabled: false,
    gsiCount: 0,
    itemCount: 0,
    bucketEncrypted: false,
    criticalIssues: [],
    warnings: [],
  };

  setupVerificationChecks(runner, context);

  await runner.run();
  runner.printSummary();

  const isHealthy = context.criticalIssues.length === 0;

  if (isHealthy) {
    Logger.success("\nDynamoDB Stack verification completed successfully");
  } else {
    Logger.error("\nDynamoDB Stack verification failed");
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
  context: DynamoDbVerificationContext
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

  // 2. Get Table and Bucket Names from Stack Outputs
  runner.addCheck(
    CheckBuilder.create("Get Resource Names from Stack")
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

          const tableNameOutput = outputs.find(
            (o) => o.OutputKey === "ArticlesTableName"
          );
          const bucketNameOutput = outputs.find(
            (o) => o.OutputKey === "AssetsS3BucketName"
          );

          if (!tableNameOutput?.OutputValue) {
            context.criticalIssues.push(
              "Articles table name not found in stack outputs"
            );
            return {
              passed: false,
              message: "Table name output missing",
            };
          }

          context.tableName = tableNameOutput.OutputValue;
          context.bucketName = bucketNameOutput?.OutputValue;

          return {
            passed: true,
            message: "Resource information retrieved from stack",
            details: {
              "Articles Table": context.tableName,
              "Assets Bucket": context.bucketName || "Not configured",
            },
          };
        } catch (error: any) {
          context.criticalIssues.push(
            `Failed to get resource names: ${error.message}`
          );
          throw error;
        }
      })
  );

  // 3. DynamoDB Table Status
  runner.addCheck(
    CheckBuilder.create("DynamoDB Table Status")
      .category("database")
      .critical(true)
      .execute(async () => {
        if (!context.tableName) {
          return {
            passed: false,
            message: "Table name not available",
          };
        }

        try {
          const response = await context.clients.dynamodb.send(
            new DescribeTableCommand({
              TableName: context.tableName,
            })
          );

          const table = response.Table;
          if (!table) {
            context.criticalIssues.push("Table not found in DynamoDB");
            return {
              passed: false,
              message: "Table not found",
            };
          }

          context.tableStatus = table.TableStatus;
          context.tableExists = true;
          context.itemCount = table.ItemCount || 0;
          context.gsiCount = table.GlobalSecondaryIndexes?.length || 0;

          if (context.tableStatus !== "ACTIVE") {
            context.criticalIssues.push(
              `Table status is ${context.tableStatus} (expected ACTIVE)`
            );
            return {
              passed: false,
              message: `Table status: ${context.tableStatus}`,
              details: {
                "Table Status": context.tableStatus,
              },
            };
          }

          return {
            passed: true,
            message: "Table is ACTIVE",
            details: {
              "Table Status": context.tableStatus,
              "Item Count": context.itemCount.toString(),
              "GSI Count": context.gsiCount.toString(),
              "Billing Mode": table.BillingModeSummary?.BillingMode || "PROVISIONED",
            },
          };
        } catch (error: any) {
          if (error.name === "ResourceNotFoundException") {
            context.criticalIssues.push(
              "Table exists in CloudFormation but not in DynamoDB"
            );
            return {
              passed: false,
              message: "Table not found in DynamoDB",
            };
          }
          context.criticalIssues.push(
            `Failed to describe table: ${error.message}`
          );
          throw error;
        }
      })
  );

  // 4. Table Encryption
  runner.addCheck(
    CheckBuilder.create("Table Encryption at Rest")
      .category("security")
      .execute(async () => {
        if (!context.tableName || !context.tableExists) {
          return {
            passed: false,
            message: "Table not available",
          };
        }

        try {
          const response = await context.clients.dynamodb.send(
            new DescribeTableCommand({
              TableName: context.tableName,
            })
          );

          const encryptionType =
            response.Table?.SSEDescription?.SSEType || "NONE";
          context.tableEncrypted = encryptionType !== "NONE";

          if (!context.tableEncrypted) {
            context.warnings.push(
              "Table encryption is not enabled - consider enabling SSE for security"
            );
            return {
              passed: false,
              message: "Table encryption is not enabled",
              details: {
                "Encryption Type": "None",
              },
            };
          }

          return {
            passed: true,
            message: "Table encryption is enabled",
            details: {
              "Encryption Type": encryptionType,
              "KMS Key": response.Table?.SSEDescription?.KMSMasterKeyArn || "AWS Managed",
            },
          };
        } catch (error: any) {
          throw error;
        }
      })
  );

  // 5. Point-in-Time Recovery
  runner.addCheck(
    CheckBuilder.create("Point-in-Time Recovery (PITR)")
      .category("backup")
      .optional(true)
      .execute(async () => {
        if (!context.tableName || !context.tableExists) {
          return {
            passed: false,
            message: "Table not available",
          };
        }

        try {
          const response = await context.clients.dynamodb.send(
            new DescribeContinuousBackupsCommand({
              TableName: context.tableName,
            })
          );

          const pitrStatus =
            response.ContinuousBackupsDescription?.PointInTimeRecoveryDescription
              ?.PointInTimeRecoveryStatus;
          context.pitrEnabled = pitrStatus === "ENABLED";

          if (!context.pitrEnabled) {
            const envWarning =
              context.config.environment === "production"
                ? "CRITICAL: "
                : "";
            context.warnings.push(
              `${envWarning}Point-in-time recovery is disabled - consider enabling for production`
            );
            return {
              passed: false,
              message: "PITR is disabled",
              details: {
                "PITR Status": pitrStatus || "DISABLED",
              },
            };
          }

          return {
            passed: true,
            message: "PITR is enabled",
            details: {
              "PITR Status": "ENABLED",
              "Earliest Restore Time":
                response.ContinuousBackupsDescription?.PointInTimeRecoveryDescription
                  ?.EarliestRestorableDateTime?.toISOString() || "N/A",
            },
          };
        } catch (error: any) {
          throw error;
        }
      })
  );

  // 6. Global Secondary Indexes Status
  runner.addCheck(
    CheckBuilder.create("Global Secondary Indexes")
      .category("database")
      .optional(true)
      .execute(async () => {
        if (!context.tableName || !context.tableExists) {
          return {
            passed: false,
            message: "Table not available",
          };
        }

        if (context.gsiCount === 0) {
          return {
            passed: true,
            message: "No Global Secondary Indexes configured",
          };
        }

        try {
          const response = await context.clients.dynamodb.send(
            new DescribeTableCommand({
              TableName: context.tableName,
            })
          );

          const gsis = response.Table?.GlobalSecondaryIndexes || [];
          const allActive = gsis.every((gsi) => gsi.IndexStatus === "ACTIVE");

          if (!allActive) {
            const inactiveGsis = gsis
              .filter((gsi) => gsi.IndexStatus !== "ACTIVE")
              .map((gsi) => `${gsi.IndexName}: ${gsi.IndexStatus}`)
              .join(", ");
            context.warnings.push(
              `Some GSIs are not ACTIVE: ${inactiveGsis}`
            );
            return {
              passed: false,
              message: "Not all GSIs are ACTIVE",
              details: {
                "Total GSIs": gsis.length.toString(),
                "Active GSIs": gsis.filter((g) => g.IndexStatus === "ACTIVE")
                  .length.toString(),
              },
            };
          }

          return {
            passed: true,
            message: "All GSIs are ACTIVE",
            details: {
              "Total GSIs": gsis.length.toString(),
              "GSI Names": gsis.map((g) => g.IndexName).join(", "),
            },
          };
        } catch (error: any) {
          throw error;
        }
      })
  );

  // 7. S3 Assets Bucket Existence
  runner.addCheck(
    CheckBuilder.create("S3 Assets Bucket Existence")
      .category("storage")
      .optional(true)
      .execute(async () => {
        if (!context.bucketName) {
          context.warnings.push("No assets bucket configured");
          return {
            passed: true,
            message: "No assets bucket configured (optional)",
          };
        }

        try {
          await context.clients.s3.send(
            new HeadBucketCommand({
              Bucket: context.bucketName,
            })
          );

          context.bucketExists = true;
          return {
            passed: true,
            message: `Assets bucket ${context.bucketName} exists`,
          };
        } catch (error: any) {
          if (error.name === "NotFound" || error.$metadata?.httpStatusCode === 404) {
            context.warnings.push(`Assets bucket ${context.bucketName} not found`);
            return {
              passed: false,
              message: "Assets bucket not found",
            };
          }
          if (error.name === "Forbidden" || error.$metadata?.httpStatusCode === 403) {
            context.warnings.push("Access denied to assets bucket");
            return {
              passed: false,
              message: "Access denied to assets bucket",
            };
          }
          throw error;
        }
      })
  );

  // 8. S3 Bucket Encryption
  runner.addCheck(
    CheckBuilder.create("S3 Bucket Encryption")
      .category("security")
      .optional(true)
      .execute(async () => {
        if (!context.bucketName || !context.bucketExists) {
          return {
            passed: false,
            message: "Bucket not available",
          };
        }

        try {
          const response = await context.clients.s3.send(
            new GetBucketEncryptionCommand({
              Bucket: context.bucketName,
            })
          );

          const rule = response.ServerSideEncryptionConfiguration?.Rules?.[0];
          const algorithm =
            rule?.ApplyServerSideEncryptionByDefault?.SSEAlgorithm;

          if (!algorithm) {
            context.warnings.push("Bucket encryption configuration not found");
            return {
              passed: false,
              message: "Bucket encryption not configured",
            };
          }

          context.bucketEncrypted = true;
          return {
            passed: true,
            message: "Bucket encryption is enabled",
            details: {
              "Encryption Algorithm": algorithm,
            },
          };
        } catch (error: any) {
          if (error.name === "ServerSideEncryptionConfigurationNotFoundError") {
            context.warnings.push(
              "Bucket encryption not configured - consider enabling SSE"
            );
            return {
              passed: false,
              message: "Bucket encryption not configured",
            };
          }
          throw error;
        }
      })
  );

  // 9. S3 Bucket Versioning
  runner.addCheck(
    CheckBuilder.create("S3 Bucket Versioning")
      .category("backup")
      .optional(true)
      .execute(async () => {
        if (!context.bucketName || !context.bucketExists) {
          return {
            passed: false,
            message: "Bucket not available",
          };
        }

        try {
          const response = await context.clients.s3.send(
            new GetBucketVersioningCommand({
              Bucket: context.bucketName,
            })
          );

          const versioningStatus = response.Status;
          const isVersioned = versioningStatus === "Enabled";

          if (!isVersioned && context.config.environment === "production") {
            context.warnings.push(
              "Bucket versioning is disabled - consider enabling for production"
            );
          }

          return {
            passed: isVersioned,
            message: isVersioned
              ? "Bucket versioning is enabled"
              : "Bucket versioning is disabled",
            details: {
              "Versioning Status": versioningStatus || "Disabled",
            },
          };
        } catch (error: any) {
          throw error;
        }
      })
  );
}

// CLI Execution
if (require.main === module) {
  const cli = CliBuilder.create(
    "verify-dynamodb-stack",
    "Verify DynamoDB table and S3 bucket deployment for webapp infrastructure"
  );

  cli.parse();
  const options = cli.opts() as VerifyDynamoDbConfig;

  verifyDynamoDbStack(options)
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

export { verifyDynamoDbStack, VerifyDynamoDbConfig };
