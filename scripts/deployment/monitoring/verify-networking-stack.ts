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
        outputs.privateSubnetIds = output.OutputValue?.split(",") || [];
      } else if (output.OutputKey === "PublicSubnetIds") {
        outputs.publicSubnetIds = output.OutputValue?.split(",") || [];
      } else if (output.OutputKey === "SecurityGroupId") {
        outputs.securityGroupId = output.OutputValue;
      }
    });

    return {
      status: stack.StackStatus || "UNKNOWN",
      outputs,
    };
  } catch (error: any) {
    if (error.name === "ValidationError") {
      return null;
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

function createClients(config: VerifyNetworkingStackConfig): {
  cfn: CloudFormationClient;
  ec2: EC2Client;
} {
  const clientConfig = {
    region: config.region,
  };

  return {
    cfn: new CloudFormationClient(clientConfig),
    ec2: new EC2Client(clientConfig),
  };
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
  console.log("");

  const { cfn, ec2 } = createClients(config);

  // Check 1: Stack exists and is in valid state
  summary.totalChecks++;
  Logger.subsection("Stack Status");
  const stackInfo = await getStackStatus(cfn, stackName);

  if (!stackInfo) {
    Logger.error(`Stack ${stackName} not found`);
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
