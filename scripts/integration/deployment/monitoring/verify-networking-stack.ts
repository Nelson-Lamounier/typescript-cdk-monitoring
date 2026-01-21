#!/usr/bin/env node
/** @format */

// infrastructure/scripts/deployment/monitoring/verify-networking-stack.ts

import * as fs from "fs";
import * as path from "path";

import { program } from "commander";
import { EC2Client } from "@aws-sdk/client-ec2";

import { Logger } from "../utils/logger";
import { AwsClientFactory, BaseAwsClients } from "../shared/aws-client-factory";
import {
  CloudFormationUtility,
  EC2Utility,
} from "../shared/aws-utilities";
import {
  VerificationRunner,
  CheckBuilder,
} from "../shared/verification-framework";
import { TableFormatter } from "../shared/formatters";

interface NetworkingStackClients extends BaseAwsClients {
  cfn: any;
  ec2: EC2Client;
}

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

interface NetworkingStackContext {
  config: VerifyNetworkingStackConfig;
  clients: NetworkingStackClients;
  stackName: string;
  outputs: StackOutputs;
}

const VALID_ENVIRONMENTS = ["development", "staging", "production", "pipeline"];

async function verifyNetworkingStack(
  config: VerifyNetworkingStackConfig
): Promise<void> {
  if (config.verbose) {
    Logger.section("Verifying Networking Stack");
  }

  const stackName = `${config.environment}-Networking`;
  
  if (config.verbose) {
    printConfiguration(config, stackName);
  }

  const clients = await AwsClientFactory.createCommonClients(
    {
      ...config,
      sessionName: `verify-networking-${Date.now()}`,
    },
    ["cfn", "ec2"]
  ) as NetworkingStackClients;

  if (config.verbose) {
    printAccountInformation(clients);
  }

  const runner = new VerificationRunner();
  const context: Partial<NetworkingStackContext> = {
    config,
    clients,
    stackName,
    outputs: {},
  };

  setupVerificationChecks(runner, context as NetworkingStackContext);

  runner.setMetadata({
    stackName,
    environment: config.environment,
    region: config.region,
    timestamp: new Date().toISOString(),
    accountId: clients.accountId || "unknown",
  });

  const summary = await runner.run();

  if (config.verbose) {
    runner.printSummary();
  }

  await writeVerificationReport(config, summary, context.outputs!);

  const allPassed = runner.allChecksPassed();
  
  console.log("");
  if (allPassed) {
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
}

function printConfiguration(
  config: VerifyNetworkingStackConfig,
  stackName: string
): void {
  Logger.subsection("Configuration");
  Logger.keyValue("Stack Name", stackName);
  Logger.keyValue("Environment", config.environment);
  Logger.keyValue("Region", config.region);
  
  if (config.outputsFile) {
    Logger.keyValue("Outputs File", config.outputsFile);
  }
  
  console.log("");
}

function printAccountInformation(clients: NetworkingStackClients): void {
  if (clients.accountId) {
    Logger.keyValue("AWS Account ID", clients.accountId);
  }
  console.log("");
}

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
    const stackOutputs = allOutputs[stackName];

    if (!stackOutputs) {
      Logger.warning(`Stack "${stackName}" not found in outputs file`);
      Logger.info(`Available stacks: ${Object.keys(allOutputs).join(", ")}`);
      return null;
    }

    const outputs: StackOutputs = {};

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
      status: "ASSUMED_COMPLETE",
      outputs,
    };
  } catch (error: any) {
    Logger.error(`Failed to read outputs file: ${error.message}`);
    return null;
  }
}

function setupVerificationChecks(
  runner: VerificationRunner,
  context: NetworkingStackContext
): void {
  runner.addCheck(
    CheckBuilder.create("CloudFormation Stack Status")
      .category("infrastructure")
      .critical(true)
      .execute(async () => {
        let stackInfo = null;

        if (context.config.outputsFile) {
          if (context.config.verbose) {
            Logger.info(`Reading from: ${context.config.outputsFile}`);
          }
          stackInfo = await getStackOutputsFromFile(
            context.stackName,
            context.config.outputsFile
          );
          
          if (stackInfo && context.config.verbose) {
            Logger.success("Outputs loaded from file");
          }
        }

        if (!stackInfo) {
          if (context.config.verbose) {
            Logger.info("Querying CloudFormation API for stack status");
          }
          stackInfo = await CloudFormationUtility.getStackStatus(
            context.clients.cfn,
            context.stackName
          );
        }

        if (!stackInfo) {
          return {
            passed: false,
            message: `Stack ${context.stackName} not found`,
          };
        }

        context.outputs = {
          vpcId: (stackInfo.outputs as any).VpcId || stackInfo.outputs["vpcId"],
          privateSubnetIds: (
            (stackInfo.outputs as any).PrivateSubnetIds ||
            stackInfo.outputs["privateSubnetIds"]
          )?.split(",").map((id: string) => id.trim()),
          publicSubnetIds: (
            (stackInfo.outputs as any).PublicSubnetIds ||
            stackInfo.outputs["publicSubnetIds"]
          )?.split(",").map((id: string) => id.trim()),
          securityGroupId:
            (stackInfo.outputs as any).SecurityGroupId ||
            stackInfo.outputs["securityGroupId"],
        };

        const validStatuses = [
          "CREATE_COMPLETE",
          "UPDATE_COMPLETE",
          "UPDATE_ROLLBACK_COMPLETE",
          "ASSUMED_COMPLETE",
        ];

        if (context.config.verbose) {
          console.log("");
          console.log("Stack Outputs:");
          const outputsForDisplay: Record<string, string | undefined> = {
            VpcId: context.outputs.vpcId,
            PrivateSubnetIds: context.outputs.privateSubnetIds?.join(", "),
            PublicSubnetIds: context.outputs.publicSubnetIds?.join(", "),
            SecurityGroupId: context.outputs.securityGroupId,
          };
          TableFormatter.formatStackOutputs(outputsForDisplay);
        }

        return {
          passed: validStatuses.includes(stackInfo.status),
          message: `Stack Status: ${stackInfo.status}`,
        };
      })
  );

  runner.addCheck(
    CheckBuilder.create("VPC Verification")
      .category("networking")
      .execute(async () => {
        if (!context.outputs.vpcId) {
          return {
            passed: false,
            message: "VPC ID not found in stack outputs",
          };
        }

        if (context.config.verbose) {
          Logger.info(`VPC ID: ${context.outputs.vpcId}`);
        }

        const vpcExists = await EC2Utility.verifyVpc(
          context.clients.ec2,
          context.outputs.vpcId
        );

        return {
          passed: vpcExists,
          message: vpcExists
            ? "VPC exists and is accessible"
            : "VPC not found or not accessible",
        };
      })
  );

  runner.addCheck(
    CheckBuilder.create("Subnet Verification")
      .category("networking")
      .execute(async () => {
        const allSubnetIds = [
          ...(context.outputs.privateSubnetIds || []),
          ...(context.outputs.publicSubnetIds || []),
        ];

        if (allSubnetIds.length === 0) {
          return {
            passed: false,
            message: "No subnets found in stack outputs",
          };
        }

        if (context.config.verbose) {
          Logger.info(`Found ${allSubnetIds.length} subnet(s)`);
        }

        const result = await EC2Utility.verifySubnets(
          context.clients.ec2,
          allSubnetIds
        );

        if (result.missing.length > 0 && context.config.verbose) {
          Logger.warning(`Missing subnets: ${result.missing.join(", ")}`);
        }

        return {
          passed: result.valid,
          message: result.valid
            ? "All subnets exist and are accessible"
            : `${result.missing.length} subnet(s) not found or not accessible`,
        };
      })
  );
}

async function writeVerificationReport(
  config: VerifyNetworkingStackConfig,
  summary: any,
  outputs: StackOutputs
): Promise<void> {
  if (!config.reportFile) {
    return;
  }

  const reportDir = path.dirname(config.reportFile);
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true });
  }

  const report = {
    ...summary.metadata,
    checksPassed: summary.checksPassed,
    totalChecks: summary.totalChecks,
    success: summary.checksPassed === summary.totalChecks,
    vpcId: outputs.vpcId,
    privateSubnetIds: outputs.privateSubnetIds,
    publicSubnetIds: outputs.publicSubnetIds,
    securityGroupId: outputs.securityGroupId || undefined,
    generatedBy: "verify-networking-stack.ts",
  };

  fs.writeFileSync(
    config.reportFile,
    JSON.stringify(report, null, 2),
    "utf8"
  );

  if (config.verbose) {
    Logger.success(`Verification report saved: ${config.reportFile}`);
  }
}

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
    "Path to write verification report JSON"
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

verifyNetworkingStack(config).catch((error: any) => {
  Logger.error(`Verification failed: ${error.message}`);
  if (error.stack && config.verbose) {
    console.log("");
    console.log(error.stack);
  }
  process.exit(1);
});
