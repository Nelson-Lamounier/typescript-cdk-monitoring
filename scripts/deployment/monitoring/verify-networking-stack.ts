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
  AssumeRoleCommand,
} from "@aws-sdk/client-sts";

import { Logger } from "../utils/logger.js";

interface VerifyNetworkingStackConfig {
  profile?: string;
  region: string;
  environment: string;
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
}

const VALID_ENVIRONMENTS = ["development", "staging", "production", "pipeline"];

async function getStackStatus(
  cfnClient: CloudFormationClient,
  stackName: string
): Promise<{ status: string; outputs: StackOutputs } | null> {
  try {
    const command = new DescribeStacksCommand({
      StackName: stackName,
    });

    const response = await cfnClient.send(command);
    const stack = response.Stacks?.[0];

    if (!stack) {
      return null;
    }

    const outputs: StackOutputs = {};
    stack.Outputs?.forEach((output) => {
      if (output.OutputKey === "VpcId") {
        outputs.vpcId = output.OutputValue;
      } else if (output.OutputKey === "PrivateSubnetIds") {
        outputs.privateSubnetIds =
          output.OutputValue?.split(",").map((value) => value.trim()) || [];
      } else if (output.OutputKey === "PublicSubnetIds") {
        outputs.publicSubnetIds =
          output.OutputValue?.split(",").map((value) => value.trim()) || [];
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
    return (response.Subnets?.length ?? 0) === subnetIds.length;
  } catch {
    return false;
  }
}

function getEnvironmentAccountId(environment: string): string | undefined {
  const envKeyMap: Record<string, string> = {
    development: "AWS_ACCOUNT_ID_DEV",
    staging: "AWS_ACCOUNT_ID_STAGING",
    production: "AWS_ACCOUNT_ID_PROD",
  };
  const envVarName = envKeyMap[environment];
  if (!envVarName) {
    return undefined;
  }
  return process.env[envVarName];
}

function getAssumeRoleArn(
  environment: string,
  baseAccountId: string | null
): { roleArn?: string; targetAccountId?: string } {
  const explicitRoleArn = process.env.AWS_ASSUME_ROLE_ARN;
  if (explicitRoleArn) {
    return { roleArn: explicitRoleArn };
  }

  const targetAccountId =
    process.env.AWS_TARGET_ACCOUNT_ID || getEnvironmentAccountId(environment);
  if (!targetAccountId) {
    return {};
  }

  if (baseAccountId && targetAccountId === baseAccountId) {
    return {};
  }

  const roleName = process.env.AWS_ASSUME_ROLE_NAME || "GitHubDeploymentRole";
  return {
    roleArn: `arn:aws:iam::${targetAccountId}:role/${roleName}`,
    targetAccountId,
  };
}

async function createClients(config: VerifyNetworkingStackConfig): Promise<{
  cfn: CloudFormationClient;
  ec2: EC2Client;
  sts: STSClient;
  accountId: string | null;
  baseAccountId: string | null;
  assumedRoleArn?: string;
}> {
  const clientConfig: { region: string } = {
    region: config.region,
  };

  // In CI/CD (OIDC), use environment variables, not profiles
  // If AWS_SESSION_TOKEN is set, we're using OIDC credentials
  const isOidcAuth = !!process.env.AWS_SESSION_TOKEN;

  if (config.profile && !isOidcAuth) {
    // Only use profile for local development when not using OIDC
    process.env.AWS_PROFILE = config.profile;
    Logger.info(`Using AWS profile: ${config.profile}`);
  } else if (isOidcAuth) {
    // Clear AWS_PROFILE if set to ensure SDK uses OIDC credentials
    delete process.env.AWS_PROFILE;
    Logger.info("Using OIDC credentials from environment variables");
  }

  const baseSts = new STSClient(clientConfig);
  const baseAccountId = await getAccountId(baseSts);
  const { roleArn, targetAccountId } = getAssumeRoleArn(
    config.environment,
    baseAccountId
  );

  if (roleArn) {
    Logger.info(
      `Assuming role for verification: ${roleArn}${
        targetAccountId ? ` (target account: ${targetAccountId})` : ""
      }`
    );

    const assumeCommand = new AssumeRoleCommand({
      RoleArn: roleArn,
      RoleSessionName: `verify-networking-${Date.now()}`,
    });

    const assumeResponse = await baseSts.send(assumeCommand);
    const assumedCredentials = assumeResponse.Credentials;

    if (!assumedCredentials) {
      throw new Error(
        "Failed to assume role: no credentials returned from STS"
      );
    }

    const assumedClientConfig = {
      region: config.region,
      credentials: {
        accessKeyId: assumedCredentials.AccessKeyId ?? "",
        secretAccessKey: assumedCredentials.SecretAccessKey ?? "",
        sessionToken: assumedCredentials.SessionToken,
      },
    };

    const assumedSts = new STSClient(assumedClientConfig);
    const accountId = await getAccountId(assumedSts);

    return {
      cfn: new CloudFormationClient(assumedClientConfig),
      ec2: new EC2Client(assumedClientConfig),
      sts: assumedSts,
      accountId,
      baseAccountId,
      assumedRoleArn: roleArn,
    };
  }

  return {
    cfn: new CloudFormationClient(clientConfig),
    ec2: new EC2Client(clientConfig),
    sts: baseSts,
    accountId: baseAccountId,
    baseAccountId,
  };
}

async function getAccountId(stsClient: STSClient): Promise<string | null> {
  try {
    const command = new GetCallerIdentityCommand({});
    const response = await stsClient.send(command);
    return response.Account ?? null;
  } catch (error: any) {
    Logger.warning(`Unable to determine AWS account ID: ${error.message}`);
    return null;
  }
}

async function verifyNetworkingStack(
  config: VerifyNetworkingStackConfig
): Promise<VerificationSummary> {
  Logger.section("Verifying Networking Stack");

  const stackName = `${config.environment}-Networking`;
  const summary: VerificationSummary = {
    checksPassed: 0,
    totalChecks: 0,
    vpcExists: false,
    subnetsExist: false,
  };

  Logger.subsection("Configuration");
  Logger.keyValue("Stack Name", stackName);
  Logger.keyValue("Environment", config.environment);
  Logger.keyValue("Region", config.region);

  // Detect authentication method
  const isOidcAuth = !!process.env.AWS_SESSION_TOKEN;
  if (isOidcAuth) {
    Logger.keyValue("Auth Method", "OIDC (environment variables)");
  } else if (config.profile) {
    Logger.keyValue("Auth Method", `AWS Profile: ${config.profile}`);
  } else {
    Logger.keyValue("Auth Method", "Default credentials");
  }
  console.log("");

  const { cfn, ec2, accountId, baseAccountId, assumedRoleArn } =
    await createClients(config);
  if (assumedRoleArn) {
    Logger.keyValue("Assumed Role ARN", assumedRoleArn);
  }
  if (baseAccountId && baseAccountId !== accountId) {
    Logger.keyValue("Base Account ID", baseAccountId);
  }
  if (accountId) {
    Logger.keyValue("AWS Account ID", accountId);
  }
  console.log("");

  // Check 1: Stack exists and is in valid state
  summary.totalChecks++;
  Logger.subsection("Stack Status");
  const stackInfo = await getStackStatus(cfn, stackName);

  if (!stackInfo) {
    Logger.error(`Stack ${stackName} not found`);
    Logger.info("Troubleshooting steps:");
    Logger.info("  1. Verify the stack name matches exactly (case-sensitive)");
    Logger.info(`  2. Check AWS region: ${config.region}`);
    Logger.info(
      "  3. Verify AWS credentials have CloudFormation read permissions"
    );
    Logger.info("  4. Check if stack exists in a different region or account");

    // Try to list stacks to help debug
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
      const stackSummaries = listResponse.StackSummaries || [];
      const stackNames = stackSummaries
        .map((s) => s.StackName)
        .filter((name): name is string => !!name);

      Logger.info("");
      Logger.info(`Debug: Found ${stackSummaries.length} stack summary(ies)`);
      Logger.info(`Debug: Extracted ${stackNames.length} stack name(s)`);

      if (stackNames.length > 0) {
        Logger.info("");
        Logger.info(
          `Found ${stackNames.length} stack(s) in region ${config.region}:`
        );

        // Always show ALL stacks (up to 10) for debugging
        stackNames.slice(0, 10).forEach((name) => {
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
        const foundExact = stackNames.find((n) => n === expectedName);
        const foundCaseInsensitive = stackNames.find(
          (n) => n?.toLowerCase() === expectedName.toLowerCase()
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

    return summary;
  }

  summary.stackStatus = stackInfo.status;
  const validStatuses = [
    "CREATE_COMPLETE",
    "UPDATE_COMPLETE",
    "UPDATE_ROLLBACK_COMPLETE",
  ];

  if (validStatuses.includes(stackInfo.status)) {
    Logger.success(`Stack status: ${stackInfo.status}`);
    summary.checksPassed++;
  } else {
    Logger.error(`Stack status: ${stackInfo.status}`);
    Logger.info(
      "Expected: CREATE_COMPLETE, UPDATE_COMPLETE, or UPDATE_ROLLBACK_COMPLETE"
    );
    return summary;
  }

  console.log("");

  // Check 2: VPC exists
  summary.totalChecks++;
  Logger.subsection("VPC Verification");
  if (stackInfo.outputs.vpcId) {
    Logger.info(`VPC ID from stack outputs: ${stackInfo.outputs.vpcId}`);
    const vpcExists = await verifyVpc(ec2, stackInfo.outputs.vpcId);
    if (vpcExists) {
      Logger.success("VPC exists and is accessible");
      summary.vpcExists = true;
      summary.checksPassed++;
    } else {
      Logger.error("VPC not found or not accessible");
    }
  } else {
    Logger.warning("VPC ID not found in stack outputs");
  }

  console.log("");

  // Check 3: Subnets exist
  summary.totalChecks++;
  Logger.subsection("Subnet Verification");
  const allSubnetIds = [
    ...(stackInfo.outputs.privateSubnetIds || []),
    ...(stackInfo.outputs.publicSubnetIds || []),
  ];

  if (allSubnetIds.length > 0) {
    Logger.info(`Found ${allSubnetIds.length} subnet(s) in stack outputs`);
    const subnetsExist = await verifySubnets(ec2, allSubnetIds);
    if (subnetsExist) {
      Logger.success("All subnets exist and are accessible");
      summary.subnetsExist = true;
      summary.checksPassed++;
    } else {
      Logger.error("One or more subnets not found or not accessible");
    }
  } else {
    Logger.warning("No subnets found in stack outputs");
  }

  console.log("");

  // Summary
  Logger.subsection("Verification Summary");
  Logger.keyValue(
    "Checks Passed",
    `${summary.checksPassed}/${summary.totalChecks}`
  );
  Logger.keyValue("Stack Status", summary.stackStatus || "UNKNOWN");
  Logger.keyValue("VPC Verified", summary.vpcExists ? "Yes" : "No");
  Logger.keyValue("Subnets Verified", summary.subnetsExist ? "Yes" : "No");

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
  .parse();

const options = program.opts();

if (!VALID_ENVIRONMENTS.includes(options.environment)) {
  Logger.error(`Invalid environment: ${options.environment}`);
  Logger.info(`Valid environments: ${VALID_ENVIRONMENTS.join(", ")}`);
  process.exit(1);
}

const config: VerifyNetworkingStackConfig = {
  environment: options.environment,
  region: options.awsRegion,
  profile: options.profile,
};

verifyNetworkingStack(config)
  .then((summary) => {
    console.log("");

    if (summary.checksPassed === summary.totalChecks) {
      Logger.success("NETWORKING STACK VERIFICATION PASSED");
      Logger.info("Stack is ready for dependent deployments");
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
