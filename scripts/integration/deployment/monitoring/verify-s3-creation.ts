#!/usr/bin/env node
/** @format */

/**
 * S3 Bucket Verification Script
 *
 * Verifies S3 bucket creation and configuration for monitoring infrastructure.
 * This script checks bucket existence, encryption, versioning, and lifecycle policies.
 *
 * Verification includes:
 * 1. S3 bucket existence
 * 2. Bucket encryption settings
 * 3. Versioning configuration
 * 4. Lifecycle policies
 * 5. Public access block settings
 * 6. Bucket tags
 *
 * Usage:
 *   npx ts-node scripts/integration/deployment/monitoring/verify-s3-creation.ts \
 *     --environment development \
 *     --region eu-west-1 \
 *     [--profile dev-account] \
 *     [--bucket-name custom-bucket-name]
 */

import {
  S3Client,
  HeadBucketCommand,
  GetBucketEncryptionCommand,
  GetBucketVersioningCommand,
  GetBucketLifecycleConfigurationCommand,
  GetBucketTaggingCommand,
  GetPublicAccessBlockCommand,
} from "@aws-sdk/client-s3";

import { Logger } from "../utils/logger";
import { AwsClientFactory, BaseAwsClients } from "../shared/aws-client-factory";
import {
  VerificationRunner,
  CheckBuilder,
  ReadinessChecker,
} from "../shared/verification-framework";
import { CliBuilder } from "../shared/cli-base";

interface S3VerificationClients extends BaseAwsClients {
  s3: S3Client;
}

interface VerifyS3Config {
  profile?: string;
  region: string;
  environment: string;
  bucketName?: string;
}

interface S3VerificationContext {
  config: VerifyS3Config;
  clients: S3VerificationClients;
  bucketName: string;
  bucketExists: boolean;
  encryption?: {
    enabled: boolean;
    algorithm?: string;
  };
  versioning?: {
    enabled: boolean;
    status?: string;
  };
  lifecycleEnabled: boolean;
  publicAccessBlocked: boolean;
  tags: Record<string, string>;
  criticalIssues: string[];
  warnings: string[];
}

async function verifyS3Creation(
  config: VerifyS3Config
): Promise<{ isHealthy: boolean; criticalIssues: string[] }> {
  Logger.section(`S3 Bucket Verification - ${config.environment}`);

  const clients = (await AwsClientFactory.createCommonClients(
    {
      ...config,
      sessionName: `verify-s3-${Date.now()}`,
    },
    ["s3"]
  )) as S3VerificationClients;

  const bucketName =
    config.bucketName ||
    `monitoring-${config.environment}-${config.region}-bucket`;

  Logger.keyValue("Bucket Name", bucketName);
  Logger.keyValue("Environment", config.environment);
  Logger.keyValue("Region", config.region);
  console.log("");

  const runner = new VerificationRunner();
  const context: Partial<S3VerificationContext> = {
    config,
    clients,
    bucketName,
    bucketExists: false,
    lifecycleEnabled: false,
    publicAccessBlocked: false,
    tags: {},
    criticalIssues: [],
    warnings: [],
  };

  setupVerificationChecks(runner, context as S3VerificationContext);

  await runner.run();
  runner.printSummary();

  const isHealthy = (context as S3VerificationContext).criticalIssues.length === 0;

  return {
    isHealthy,
    criticalIssues: (context as S3VerificationContext).criticalIssues,
  };
}

function setupVerificationChecks(
  runner: VerificationRunner,
  context: S3VerificationContext
): void {
  // 1. Bucket Existence
  runner.addCheck(
    CheckBuilder.create("S3 Bucket Existence")
      .category("storage")
      .critical(true)
      .execute(async () => {
        try {
          await context.clients.s3.send(
            new HeadBucketCommand({
              Bucket: context.bucketName,
            })
          );

          context.bucketExists = true;
          return {
            passed: true,
            message: `Bucket ${context.bucketName} exists`,
          };
        } catch (error: any) {
          if (error.name === "NotFound" || error.$metadata?.httpStatusCode === 404) {
            context.criticalIssues.push(`Bucket ${context.bucketName} does not exist`);
            return {
              passed: false,
              message: "Bucket not found",
            };
          }

          if (error.name === "Forbidden" || error.$metadata?.httpStatusCode === 403) {
            context.criticalIssues.push(
              "Access denied - check IAM permissions for S3:HeadBucket"
            );
            return {
              passed: false,
              message: "Access denied to bucket",
            };
          }

          throw error;
        }
      })
  );

  // 2. Bucket Encryption
  runner.addCheck(
    CheckBuilder.create("Bucket Encryption")
      .category("security")
      .execute(async () => {
        if (!context.bucketExists) {
          return {
            passed: false,
            message: "Bucket does not exist",
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

          context.encryption = {
            enabled: true,
            algorithm,
          };

          Logger.keyValue("  Encryption Algorithm", algorithm || "Unknown");

          return {
            passed: true,
            message: `Encryption enabled (${algorithm})`,
          };
        } catch (error: any) {
          if (
            error.name === "ServerSideEncryptionConfigurationNotFoundError" ||
            error.$metadata?.httpStatusCode === 404
          ) {
            context.warnings.push("Bucket encryption is not enabled");
            return {
              passed: false,
              message: "Encryption not configured",
            };
          }

          Logger.warning(`Failed to check encryption: ${error.message}`);
          return {
            passed: false,
            message: "Could not verify encryption",
          };
        }
      })
  );

  // 3. Bucket Versioning
  runner.addCheck(
    CheckBuilder.create("Bucket Versioning")
      .category("data-protection")
      .optional(true)
      .execute(async () => {
        if (!context.bucketExists) {
          return {
            passed: false,
            message: "Bucket does not exist",
          };
        }

        try {
          const response = await context.clients.s3.send(
            new GetBucketVersioningCommand({
              Bucket: context.bucketName,
            })
          );

          const status = response.Status || "Not configured";
          const enabled = status === "Enabled";

          context.versioning = {
            enabled,
            status,
          };

          Logger.keyValue("  Versioning Status", status);

          if (!enabled) {
            context.warnings.push("Bucket versioning is not enabled");
          }

          return {
            passed: enabled,
            message: `Versioning: ${status}`,
          };
        } catch (error: any) {
          Logger.warning(`Failed to check versioning: ${error.message}`);
          return {
            passed: false,
            message: "Could not verify versioning",
          };
        }
      })
  );

  // 4. Lifecycle Configuration
  runner.addCheck(
    CheckBuilder.create("Lifecycle Configuration")
      .category("cost-optimization")
      .optional(true)
      .execute(async () => {
        if (!context.bucketExists) {
          return {
            passed: false,
            message: "Bucket does not exist",
          };
        }

        try {
          const response = await context.clients.s3.send(
            new GetBucketLifecycleConfigurationCommand({
              Bucket: context.bucketName,
            })
          );

          const ruleCount = response.Rules?.length || 0;
          context.lifecycleEnabled = ruleCount > 0;

          if (ruleCount > 0) {
            Logger.keyValue("  Lifecycle Rules", `${ruleCount} configured`);
            response.Rules?.forEach((rule) => {
              Logger.info(`    - ${rule.ID || "Unnamed"}: ${rule.Status}`);
            });
          }

          return {
            passed: context.lifecycleEnabled,
            message: context.lifecycleEnabled
              ? `${ruleCount} lifecycle rules configured`
              : "No lifecycle rules configured",
          };
        } catch (error: any) {
          if (
            error.name === "NoSuchLifecycleConfiguration" ||
            error.$metadata?.httpStatusCode === 404
          ) {
            context.warnings.push("No lifecycle configuration found");
            return {
              passed: false,
              message: "No lifecycle rules configured",
            };
          }

          Logger.warning(`Failed to check lifecycle: ${error.message}`);
          return {
            passed: false,
            message: "Could not verify lifecycle",
          };
        }
      })
  );

  // 5. Public Access Block
  runner.addCheck(
    CheckBuilder.create("Public Access Block")
      .category("security")
      .execute(async () => {
        if (!context.bucketExists) {
          return {
            passed: false,
            message: "Bucket does not exist",
          };
        }

        try {
          const response = await context.clients.s3.send(
            new GetPublicAccessBlockCommand({
              Bucket: context.bucketName,
            })
          );

          const config = response.PublicAccessBlockConfiguration;
          const allBlocked =
            (config?.BlockPublicAcls ?? false) &&
            (config?.BlockPublicPolicy ?? false) &&
            (config?.IgnorePublicAcls ?? false) &&
            (config?.RestrictPublicBuckets ?? false);

          context.publicAccessBlocked = allBlocked;

          if (config) {
            console.log("");
            Logger.keyValue("  Block Public ACLs", String(config.BlockPublicAcls));
            Logger.keyValue(
              "  Block Public Policy",
              String(config.BlockPublicPolicy)
            );
            Logger.keyValue("  Ignore Public ACLs", String(config.IgnorePublicAcls));
            Logger.keyValue(
              "  Restrict Public Buckets",
              String(config.RestrictPublicBuckets)
            );
          }

          if (!allBlocked) {
            context.criticalIssues.push(
              "Public access is not fully blocked - security risk"
            );
          }

          return {
            passed: allBlocked,
            message: allBlocked
              ? "All public access blocked"
              : "Public access not fully blocked",
          };
        } catch (error: any) {
          if (
            error.name === "NoSuchPublicAccessBlockConfiguration" ||
            error.$metadata?.httpStatusCode === 404
          ) {
            context.criticalIssues.push(
              "No public access block configuration - security risk"
            );
            return {
              passed: false,
              message: "Public access block not configured",
            };
          }

          Logger.warning(`Failed to check public access block: ${error.message}`);
          return {
            passed: false,
            message: "Could not verify public access block",
          };
        }
      })
  );

  // 6. Bucket Tags
  runner.addCheck(
    CheckBuilder.create("Bucket Tags")
      .category("management")
      .optional(true)
      .execute(async () => {
        if (!context.bucketExists) {
          return {
            passed: false,
            message: "Bucket does not exist",
          };
        }

        try {
          const response = await context.clients.s3.send(
            new GetBucketTaggingCommand({
              Bucket: context.bucketName,
            })
          );

          const tagSet = response.TagSet || [];
          tagSet.forEach((tag) => {
            if (tag.Key && tag.Value) {
              context.tags[tag.Key] = tag.Value;
            }
          });

          if (tagSet.length > 0) {
            console.log("");
            Logger.info("  Tags:");
            tagSet.forEach((tag) => {
              Logger.keyValue(`    ${tag.Key}`, tag.Value || "");
            });
          }

          const hasEnvironmentTag = tagSet.some(
            (tag) => tag.Key === "Environment"
          );
          const hasProjectTag = tagSet.some((tag) => tag.Key === "Project");

          if (!hasEnvironmentTag) {
            context.warnings.push("Environment tag not found");
          }
          if (!hasProjectTag) {
            context.warnings.push("Project tag not found");
          }

          return {
            passed: hasEnvironmentTag && hasProjectTag,
            message: `${tagSet.length} tags configured`,
          };
        } catch (error: any) {
          if (
            error.name === "NoSuchTagSet" ||
            error.$metadata?.httpStatusCode === 404
          ) {
            context.warnings.push("No tags configured on bucket");
            return {
              passed: false,
              message: "No tags configured",
            };
          }

          Logger.warning(`Failed to check tags: ${error.message}`);
          return {
            passed: false,
            message: "Could not verify tags",
          };
        }
      })
  );

  // 7. Overall Assessment
  runner.addCheck(
    CheckBuilder.create("Overall Assessment")
      .category("readiness")
      .execute(async () => {
        const checker = new ReadinessChecker();

        if (context.criticalIssues.length > 0) {
          context.criticalIssues.forEach((issue) => checker.addBlocker(issue));
        }

        if (context.warnings.length > 0) {
          context.warnings.forEach((warning) => checker.addWarning(warning));
        }

        if (checker.isReady()) {
          checker.addNextStep("S3 bucket is properly configured");
          checker.addNextStep("Bucket is ready for use by monitoring services");
        } else {
          checker.addNextStep("Review critical issues above");
          checker.addNextStep("Enable bucket encryption for security");
          checker.addNextStep("Configure public access block settings");
          checker.addNextStep("Add Environment and Project tags");
        }

        console.log("");
        checker.printAssessment("S3 Bucket");

        return {
          passed: checker.isReady(),
          message: checker.isReady()
            ? "S3 bucket properly configured"
            : "S3 bucket has configuration issues",
        };
      })
  );
}

const cli = CliBuilder.create(
  "verify-s3-creation",
  "Verify S3 bucket creation and configuration"
);

cli.option(
  "-b, --bucket-name <name>",
  "S3 bucket name (default: monitoring-<env>-<region>-bucket)"
);

cli.parse();

const options = cli.opts();

CliBuilder.validateEnvironment(options.environment);

const config: VerifyS3Config = {
  environment: options.environment,
  region: options.region,
  profile: options.profile,
  bucketName: options.bucketName,
};

verifyS3Creation(config)
  .then((result) => {
    console.log("");

    if (result.isHealthy) {
      Logger.success("S3 bucket verification passed");
      Logger.info("Bucket is properly configured and ready for use");
      process.exit(0);
    } else {
      Logger.error("S3 bucket verification failed");
      Logger.info("Fix critical issues before proceeding");
      process.exit(1);
    }
  })
  .catch((error) => {
    Logger.error(`Verification failed: ${error.message}`);
    process.exit(1);
  });
