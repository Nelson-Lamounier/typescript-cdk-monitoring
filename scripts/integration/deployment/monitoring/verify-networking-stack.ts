#!/usr/bin/env node
/** @format */

// scripts/deployment/monitoring/verify-networking-stack.ts

import { program } from "commander";
import {
  CloudFormationClient,
  DescribeStacksCommand,
} from "@aws-sdk/client-cloudformation";
import {
  EC2Client,
  DescribeVpcsCommand,
  DescribeSubnetsCommand,
} from "@aws-sdk/client-ec2";
import {
  STSClient,
  GetCallerIdentityCommand,
} from "@aws-sdk/client-sts";
import * as fs from "fs";
import * as path from "path";

import { Logger } from "../utils/logger.js";

interface VerifyNetworkingStackConfig {
  profile?: string;
  region: string;
  environment: string;
  outputsFile?: string;
  verbose?: boolean;
  reportFile?: string;
}

interface StackOutputs {
  vpcId?: string;
  privateSubnetIds?: string[];
  publicSubnetIds?: string[];
  securityGroupId?: string;
}

interface VerificationSummary {
  checksPassed: number;
  totalChecks: number;
  stackStatus?: string;
  vpcExists: boolean;
  subnetsExist: boolean;
  stackName?: string;
  environment?: string;
  region?: string;
  accountId?: string;
  vpcId?: string;
  privateSubnetIds?: string[];
  publicSubnetIds?: string[];
  securityGroupId?: string;
  timestamp?: string;
  verificationMethod?: string;
}

const VALID_ENVIRONMENTS = ["development", "staging", "production", "pipeline"];

/**
 * Reads stack outputs from a CDK outputs file
 * This avoids the need to query CloudFormation API, which is faster and works
 * better in cross-account scenarios where the runner may not have CFN permissions
 */
async function getStackOutputsFromFile(
  stackName: string,
  outputsFile: string
): Promise<{ status: string; outputs: StackOutputs } | null> {
  try {
    if (!fs.existsSync(outputsFile)) {
      Logger.warning(`Outputs file not found: ${outputsFile}`);
      return null;
    }

    const fileContents = fs.readFileSync(outputsFile, "utf8");
    const allOutputs = JSON.parse(fileContents);

    // CDK outputs file format: { "stackName": { "OutputKey": "OutputValue" } }
    const stackOutputs = allOutputs[stackName];

    if (!stackOutputs) {
      Logger.warning(`Stack "${stackName}" not found in outputs file`);
      Logger.info(`Available stacks: ${Object.keys(allOutputs).join(", ")}`);
      return null;
    }

    const outputs: StackOutputs = {};

    // Map CDK output keys to our interface
    if (stackOutputs.VpcId) {
      outputs.vpcId = stackOutputs.VpcId;
    }
    if (stackOutputs.PrivateSubnetIds) {
      outputs.privateSubnetIds = stackOutputs.PrivateSubnetIds.split(",").map(
        (id: string) => id.trim()
      );
    }
    if (stackOutputs.PublicSubnetIds) {
      outputs.publicSubnetIds = stackOutputs.PublicSubnetIds.split(",").map(
        (id: string) => id.trim()
      );
    }
    if (stackOutputs.SecurityGroupId) {
      outputs.securityGroupId = stackOutputs.SecurityGroupId;
    }

    return {
      status: "ASSUMED_COMPLETE", // File exists, so we assume deployment completed
      outputs,
    };
  } catch (error: any) {
    Logger.error(`Failed to read outputs file: ${error.message}`);
    return null;
  }
}

async function getStackStatus(
  cfnClient: CloudFormationClient,
  stackName: string
): Promise<{ status: string; outputs: StackOutputs } | null> {
  try {
    const command = new DescribeStacksCommand({
      StackName: stackName,
    });

    const response = await cfnClient.send(command);
    const stack = (response as any).Stacks?.[0];

    if (!stack) {
      return null;
    }

    const outputs: StackOutputs = {};
    stack.Outputs?.forEach((output: { OutputKey?: string; OutputValue?: string }) => {
      if (output.OutputKey === "VpcId") {
        outputs.vpcId = output.OutputValue;
      } else if (output.OutputKey === "PrivateSubnetIds") {
        outputs.privateSubnetIds =
          output.OutputValue?.split(",").map((value: string) => value.trim()) || [];
      } else if (output.OutputKey === "PublicSubnetIds") {
        outputs.publicSubnetIds =
          output.OutputValue?.split(",").map((value: string) => value.trim()) || [];
      } else if (output.OutputKey === "SecurityGroupId") {
        outputs.securityGroupId = output.OutputValue;
      }
    });

    return {
      status: stack.StackStatus || "UNKNOWN",
      outputs,
    };
  } catch (error: any) {
    if (
      error.name === "ValidationError" ||
      error.name === "DoesNotExistException"
    ) {
      return null;
    }

    // Handle permission errors specifically
    if (error.name === "AccessDeniedException") {
      Logger.error(`Access denied when describing stack: ${stackName}`);
      Logger.error(
        "The OIDC role may not have CloudFormation read permissions."
      );
      Logger.info("Required permissions:");
      Logger.info("  - cloudformation:DescribeStacks");
      Logger.info("  - cloudformation:ListStacks");
      throw error;
    }

    // Log other errors for debugging
    Logger.error(`Error describing stack ${stackName}: ${error.message}`);
    if (error.name) {
      Logger.error(`Error type: ${error.name}`);
    }
    throw error;
  }
}

async function verifyVpc(
  ec2Client: EC2Client,
  vpcId: string | undefined
): Promise<boolean> {
  if (!vpcId) {
    return false;
  }

  try {
    const command = new DescribeVpcsCommand({
      VpcIds: [vpcId],
    });

    const response = await ec2Client.send(command);
    return (response.Vpcs?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

async function verifySubnets(
  ec2Client: EC2Client,
  subnetIds: string[] | undefined
): Promise<boolean> {
  if (!subnetIds || subnetIds.length === 0) {
    return false;
  }

  try {
    const command = new DescribeSubnetsCommand({
      SubnetIds: subnetIds,
    });

    const response = await ec2Client.send(command);
    const returnedSubnets = response.Subnets || [];
    if (returnedSubnets.length === subnetIds.length) {
      return true;
    }

    const returnedIds = new Set(
      returnedSubnets.map((subnet) => subnet.SubnetId).filter(Boolean)
    );
    const missingIds = subnetIds.filter((id) => !returnedIds.has(id));

    if (missingIds.length > 0) {
      Logger.warning(
        `Missing subnet IDs in DescribeSubnets response: ${missingIds.join(
          ", "
        )}`
      );
    }

    return false;
  } catch (error: any) {
    Logger.warning(`DescribeSubnets failed: ${error.message}`);
    return false;
  }
}

async function createClients(config: VerifyNetworkingStackConfig): Promise<{
  cfn: CloudFormationClient;
  ec2: EC2Client;
  sts: STSClient;
  accountId: string | null;
}> {
  const clientConfig: { region: string; credentials?: any } = {
    region: config.region,
  };

  // In CI/CD (OIDC), use environment variables, not profiles
  // If AWS_SESSION_TOKEN is set, we're using OIDC credentials
  const isOidcAuth = !!process.env.AWS_SESSION_TOKEN;

  if (config.profile && !isOidcAuth) {
    // Only use profile for local development when not using OIDC
    process.env.AWS_PROFILE = config.profile;
    if (config.verbose) {
      Logger.info(`Using AWS profile: ${config.profile}`);
    }
  } else if (isOidcAuth && config.verbose) {
    Logger.info("Using OIDC credentials from environment variables");
  }

  const sts = new STSClient(clientConfig);
  const accountId = await getAccountId(sts);

  return {
    cfn: new CloudFormationClient(clientConfig),
    ec2: new EC2Client(clientConfig),
    sts,
    accountId,
  };
}

async function getAccountId(stsClient: STSClient): Promise<string | null> {
  try {
    const command = new GetCallerIdentityCommand({});
    const response = await stsClient.send(command);
    // Account property exists on GetCallerIdentityCommandOutput
    return (response as any).Account ?? null;
  } catch (error: any) {
    Logger.warning(`Unable to determine AWS account ID: ${error.message}`);
    return null;
  }
}

async function verifyNetworkingStack(
  config: VerifyNetworkingStackConfig
): Promise<VerificationSummary> {
  if (config.verbose) {
    Logger.section("Verifying Networking Stack");
  }

  const stackName = `${config.environment}-Networking`;
  const summary: VerificationSummary = {
    checksPassed: 0,
    totalChecks: 0,
    vpcExists: false,
    subnetsExist: false,
    stackName,
    environment: config.environment,
    region: config.region,
    timestamp: new Date().toISOString(),
  };

  if (config.verbose) {
    Logger.subsection("Configuration");
    Logger.keyValue("Stack Name", stackName);
    Logger.keyValue("Environment", config.environment);
    Logger.keyValue("Region", config.region);
    console.log("");
  }

  // Create AWS clients
  const { cfn, ec2, accountId } = await createClients(config);
  summary.accountId = accountId || undefined;

  if (config.verbose && accountId) {
    Logger.keyValue("AWS Account ID", accountId);
    console.log("");
  }

  // Check 1: Stack outputs exist
  summary.totalChecks++;
  if (config.verbose) {
    Logger.subsection("Stack Outputs");
  }

  // Read from outputs file (preferred) or CloudFormation
  let stackInfo = null;
  if (config.outputsFile) {
    if (config.verbose) {
      Logger.info(`Reading from: ${config.outputsFile}`);
    }
    stackInfo = await getStackOutputsFromFile(stackName, config.outputsFile);
    if (stackInfo) {
      summary.verificationMethod = "cdk-outputs-file";
      if (config.verbose) {
        Logger.success("✓ Outputs loaded from file");
      }
    }
  }

  // Fallback to CloudFormation API if file not available
  if (!stackInfo) {
    if (config.verbose) {
      Logger.info("Querying CloudFormation API for stack status");
    }
    stackInfo = await getStackStatus(cfn, stackName);
    summary.verificationMethod = "cloudformation-api";
  }

  if (!stackInfo) {
    Logger.error(`Stack ${stackName} not found`);
    if (config.verbose) {
      Logger.info("Troubleshooting steps:");
      Logger.info("  1. Verify the stack name matches exactly (case-sensitive)");
      Logger.info(`  2. Check AWS region: ${config.region}`);
      Logger.info(
        "  3. Verify AWS credentials have CloudFormation read permissions"
      );
      Logger.info("  4. Check if stack exists in a different region or account");

      // Try to list stacks to help debug (only in verbose mode)
      try {
        const { CloudFormationClient, ListStacksCommand } = await import(
          "@aws-sdk/client-cloudformation"
        );
        const listClient = new CloudFormationClient({ region: config.region });
        const listCommand = new ListStacksCommand({
          StackStatusFilter: [
            "CREATE_COMPLETE",
            "UPDATE_COMPLETE",
            "UPDATE_ROLLBACK_COMPLETE",
          ],
        });
        const listResponse = await listClient.send(listCommand);
        const stackSummaries = (listResponse as any).StackSummaries || [];
        const stackNames = stackSummaries
          .map((s: any) => s.StackName)
          .filter((name: any): name is string => !!name);

        Logger.info("");
        Logger.info(`Debug: Found ${stackSummaries.length} stack summary(ies)`);
        Logger.info(`Debug: Extracted ${stackNames.length} stack name(s)`);

        if (stackNames.length > 0) {
          Logger.info("");
          Logger.info(
            `Found ${stackNames.length} stack(s) in region ${config.region}:`
          );

          stackNames.slice(0, 10).forEach((name: string) => {
            const isNetworking = name.toLowerCase().includes("networking");
            const matchesExpected =
              name.toLowerCase() === stackName.toLowerCase();

            if (matchesExpected) {
              Logger.info(
                `  ⚠️  ${name} (matches expected name but case may differ)`
              );
            } else if (isNetworking) {
              Logger.info(`  ✓ ${name} (contains "networking")`);
            } else {
              Logger.info(`  - ${name}`);
            }
          });

          if (stackNames.length > 10) {
            Logger.info(`  ... and ${stackNames.length - 10} more stack(s)`);
          }

          // Check if expected stack name exists with different casing
          const expectedName = stackName;
          const foundExact = stackNames.find((n: string) => n === expectedName);
          const foundCaseInsensitive = stackNames.find(
            (n: string) => n?.toLowerCase() === expectedName.toLowerCase()
          );

          if (!foundExact && foundCaseInsensitive) {
            Logger.warning("");
            Logger.warning(`Stack name case mismatch detected!`);
            Logger.warning(`  Expected: "${expectedName}"`);
            Logger.warning(`  Found:    "${foundCaseInsensitive}"`);
            Logger.info("");
            Logger.info(
              "The stack exists but with different casing. Update the stack name or environment variable."
            );
          } else if (!foundExact && !foundCaseInsensitive) {
            Logger.warning("");
            Logger.warning(
              `Expected stack "${expectedName}" not found in the list above.`
            );
            Logger.info("Please verify:");
            Logger.info(`  1. Stack name matches exactly: ${expectedName}`);
            Logger.info(`  2. Region is correct: ${config.region}`);
            Logger.info(`  3. AWS account is correct`);
          }
        }
      } catch (listError: any) {
        Logger.warning(
          `Could not list stacks for debugging: ${listError.message}`
        );
      }
    }

    return summary;
  }

  summary.stackStatus = stackInfo.status;
  const validStatuses = [
    "CREATE_COMPLETE",
    "UPDATE_COMPLETE",
    "UPDATE_ROLLBACK_COMPLETE",
    "ASSUMED_COMPLETE", // From outputs file
  ];

  if (validStatuses.includes(stackInfo.status)) {
    if (config.verbose) {
      Logger.success(`Stack status: ${stackInfo.status}`);
    }
    summary.checksPassed++;
  } else {
    Logger.error(`Stack status: ${stackInfo.status}`);
    if (config.verbose) {
      Logger.info(
        "Expected: CREATE_COMPLETE, UPDATE_COMPLETE, or UPDATE_ROLLBACK_COMPLETE"
      );
    }
    return summary;
  }

  if (config.verbose) {
    console.log("");
  }

  // Store outputs in summary
  summary.vpcId = stackInfo.outputs.vpcId;
  summary.privateSubnetIds = stackInfo.outputs.privateSubnetIds;
  summary.publicSubnetIds = stackInfo.outputs.publicSubnetIds;
  summary.securityGroupId = stackInfo.outputs.securityGroupId;

  // Check 2: VPC exists
  summary.totalChecks++;
  if (config.verbose) {
    Logger.subsection("VPC Verification");
  }
  if (stackInfo.outputs.vpcId) {
    if (config.verbose) {
      Logger.info(`VPC ID from stack outputs: ${stackInfo.outputs.vpcId}`);
    }
    const vpcExists = await verifyVpc(ec2, stackInfo.outputs.vpcId);
    if (vpcExists) {
      if (config.verbose) {
        Logger.success("VPC exists and is accessible");
      }
      summary.vpcExists = true;
      summary.checksPassed++;
    } else {
      Logger.error("VPC not found or not accessible");
    }
  } else {
    Logger.warning("VPC ID not found in stack outputs");
  }

  if (config.verbose) {
    console.log("");
  }

  // Check 3: Subnets exist
  summary.totalChecks++;
  if (config.verbose) {
    Logger.subsection("Subnet Verification");
  }
  const allSubnetIds = [
    ...(stackInfo.outputs.privateSubnetIds || []),
    ...(stackInfo.outputs.publicSubnetIds || []),
  ];

  if (allSubnetIds.length > 0) {
    if (config.verbose) {
      Logger.info(`Found ${allSubnetIds.length} subnet(s) in stack outputs`);
    }
    const subnetsExist = await verifySubnets(ec2, allSubnetIds);
    if (subnetsExist) {
      if (config.verbose) {
        Logger.success("All subnets exist and are accessible");
      }
      summary.subnetsExist = true;
      summary.checksPassed++;
    } else {
      Logger.error("One or more subnets not found or not accessible");
    }
  } else {
    Logger.warning("No subnets found in stack outputs");
  }

  if (config.verbose) {
    console.log("");
  }

  // Summary
  if (config.verbose) {
    Logger.subsection("Verification Summary");
    Logger.keyValue(
      "Checks Passed",
      `${summary.checksPassed}/${summary.totalChecks}`
    );
    Logger.keyValue("Stack Status", summary.stackStatus || "UNKNOWN");
    Logger.keyValue("VPC Verified", summary.vpcExists ? "Yes" : "No");
    Logger.keyValue("Subnets Verified", summary.subnetsExist ? "Yes" : "No");
  }

  return summary;
}

// CLI
program
  .requiredOption("-e, --environment <env>", "Environment name")
  .requiredOption("-r, --aws-region <region>", "AWS region")
  .option(
    "-p, --profile <profile>",
    "AWS profile (optional, uses default credentials if not provided)"
  )
  .option(
    "-o, --outputs-file <path>",
    "Path to CDK stack outputs file (optimised: avoids CloudFormation API calls)"
  )
  .option(
    "--report-file <path>",
    "Path to write verification report JSON (default: verification-reports/<env>-networking-verification.json)"
  )
  .option(
    "-v, --verbose",
    "Enable verbose output (default: false for CI/CD)"
  )
  .parse();

const options = program.opts();

if (!VALID_ENVIRONMENTS.includes(options.environment)) {
  Logger.error(`Invalid environment: ${options.environment}`);
  Logger.info(`Valid environments: ${VALID_ENVIRONMENTS.join(", ")}`);
  process.exit(1);
}

// Default report file path
const defaultReportFile = path.join(
  "verification-reports",
  `${options.environment}-networking-verification.json`
);

const config: VerifyNetworkingStackConfig = {
  environment: options.environment,
  region: options.awsRegion,
  profile: options.profile,
  outputsFile: options.outputsFile,
  verbose: options.verbose ?? false,
  reportFile: options.reportFile || defaultReportFile,
};

verifyNetworkingStack(config)
  .then((summary) => {
    console.log("");

    // Write verification report to file
    if (config.reportFile) {
      const reportDir = path.dirname(config.reportFile);
      if (!fs.existsSync(reportDir)) {
        fs.mkdirSync(reportDir, { recursive: true });
      }

      const report = {
        ...summary,
        success: summary.checksPassed === summary.totalChecks,
        generatedBy: "verify-networking-stack.ts",
      };

      fs.writeFileSync(
        config.reportFile,
        JSON.stringify(report, null, 2),
        "utf8"
      );

      Logger.success(`Verification report saved: ${config.reportFile}`);
    }

    if (summary.checksPassed === summary.totalChecks) {
      Logger.success("NETWORKING STACK VERIFICATION PASSED");
      if (config.verbose) {
        Logger.info("Stack is ready for dependent deployments");
      }
      process.exit(0);
    } else {
      Logger.error("NETWORKING STACK VERIFICATION FAILED");
      Logger.info(
        `Only ${summary.checksPassed} of ${summary.totalChecks} checks passed`
      );
      process.exit(1);
    }
  })
  .catch((error: any) => {
    Logger.error(`Verification failed: ${error.message}`);
    if (error.stack) {
      console.log("");
      console.log(error.stack);
    }
    process.exit(1);
  });
