#!/usr/bin/env node
/** @format */

// infrastructure/scripts/deployment/monitoring/verify-efs-stack.ts

import { EFSClient } from "@aws-sdk/client-efs";
import { EC2Client } from "@aws-sdk/client-ec2";

import { Logger } from "../utils/logger";
import { AwsClientFactory, BaseAwsClients } from "../shared/aws-client-factory";
import {
  CloudFormationUtility,
  SSMUtility,
  EFSUtility,
  EC2Utility,
} from "../shared/aws-utilities";
import {
  VerificationRunner,
  CheckBuilder,
  ReadinessChecker,
} from "../shared/verification-framework";
import { TableFormatter } from "../shared/formatters";
import { CliBuilder } from "../shared/cli-base";

interface EfsStackClients extends BaseAwsClients {
  cfn: any;
  ssm: any;
  efs: EFSClient;
  ec2: EC2Client;
}

interface VerifyEfsStackConfig {
  profile?: string;
  region: string;
  environment: string;
}

interface EfsStackContext {
  config: VerifyEfsStackConfig;
  clients: EfsStackClients;
  stackName: string;
  documentName: string;
  paramPrefix: string;
  outputs: {
    fileSystemId?: string;
    accessPointId?: string;
    securityGroupId?: string;
  };
}

const JSON_PARAMS = [
  "prometheus-config",
  "grafana-datasource-config",
  "grafana-dashboard-config",
];

const YAML_PARAMS = [
  "prometheus-config-yaml",
  "grafana-datasource-config-yaml",
  "grafana-dashboard-config-yaml",
  "efs-setup-script",
];

const DISCOVERY_PARAMS_OLD = [
  "file-system-id",
  "access-point-id",
  "security-group-id",
  "availability-zone",
];

const DISCOVERY_PARAMS_NEW = [
  "efs-id",
  "access-point-id",
  "efs-sg-id",
  "efs-az",
];

async function verifyEfsStack(config: VerifyEfsStackConfig): Promise<void> {
  Logger.section(`EFS Stack Verification - ${config.environment}`);

  const stackName = `${config.environment}-MonitoringEfs`;
  const documentName = `${stackName}-${config.environment}-efs-init`;
  const paramPrefix = `/monitoring/${config.environment}`;

  printConfiguration(config, stackName);

  const clients = await AwsClientFactory.createCommonClients(
    {
      ...config,
      sessionName: `verify-efs-${Date.now()}`,
    },
    ["cfn", "ssm", "efs", "ec2"]
  ) as EfsStackClients;

  printAccountInformation(clients);

  const runner = new VerificationRunner();
  const context: Partial<EfsStackContext> = {
    config,
    clients,
    stackName,
    documentName,
    paramPrefix,
    outputs: {},
  };

  setupVerificationChecks(runner, context as EfsStackContext);

  const summary = await runner.run();
  runner.printSummary();

  const exitCode = summary.checksPassed === summary.totalChecks ? 0 : 1;
  process.exit(exitCode);
}

function printConfiguration(
  config: VerifyEfsStackConfig,
  stackName: string
): void {
  Logger.subsection("Configuration");
  Logger.keyValue("Stack Name", stackName);
  Logger.keyValue("Environment", config.environment);
  Logger.keyValue("Region", config.region);

  const isOidcAuth = !!process.env.AWS_SESSION_TOKEN;
  if (isOidcAuth) {
    Logger.keyValue("Auth Method", "OIDC (environment variables)");
  } else if (config.profile) {
    Logger.keyValue("Auth Method", `AWS Profile: ${config.profile}`);
  } else {
    Logger.keyValue("Auth Method", "Default credentials");
  }
  console.log("");
}

function printAccountInformation(clients: EfsStackClients): void {
  if (clients.assumedRoleArn) {
    Logger.keyValue("Assumed Role ARN", clients.assumedRoleArn);
  }
  if (clients.baseAccountId && clients.baseAccountId !== clients.accountId) {
    Logger.keyValue("Base Account ID", clients.baseAccountId);
  }
  if (clients.accountId) {
    Logger.keyValue("AWS Account ID", clients.accountId);
  }
  Logger.keyValue("Timestamp", new Date().toISOString());
  console.log("");
}

function setupVerificationChecks(
  runner: VerificationRunner,
  context: EfsStackContext
): void {
  runner.addCheck(
    CheckBuilder.create("CloudFormation Stack Status")
      .category("infrastructure")
      .critical(true)
      .execute(async () => {
        const stackInfo = await CloudFormationUtility.getStackStatus(
          context.clients.cfn,
          context.stackName,
          ["FileSystemId", "AccessPointId", "SecurityGroupId"]
        );

        if (!stackInfo) {
          return {
            passed: false,
            message: "Stack not found",
          };
        }

        context.outputs = {
          fileSystemId: stackInfo.outputs.FileSystemId,
          accessPointId: stackInfo.outputs.AccessPointId,
          securityGroupId: stackInfo.outputs.SecurityGroupId,
        };

        console.log("");
        console.log("Stack Outputs:");
        TableFormatter.formatStackOutputs(stackInfo.outputs);

        const isReady = CloudFormationUtility.isStackReady(stackInfo.status);
        return {
          passed: isReady,
          message: `Stack Status: ${stackInfo.status}`,
        };
      })
  );

  runner.addCheck(
    CheckBuilder.create("SSM Automation Document")
      .category("configuration")
      .execute(async () => {
        const docInfo = await SSMUtility.getDocumentStatus(
          context.clients.ssm,
          context.documentName
        );

        if (!docInfo || docInfo.status !== "Active") {
          return {
            passed: false,
            message: `Document Status: ${docInfo?.status || "NOT_FOUND"}`,
          };
        }

        console.log("");
        Logger.keyValue("Document Name", context.documentName);
        Logger.keyValue("Document Type", docInfo.documentType || "N/A");
        Logger.keyValue("Document Version", docInfo.documentVersion || "N/A");

        console.log("");
        console.log("SSM Automation Executions:");
        const executions = await SSMUtility.getAutomationExecutions(
          context.clients.ssm,
          context.documentName
        );
        TableFormatter.formatAutomationExecutions(executions);

        return {
          passed: true,
          message: `Document Status: ${docInfo.status}`,
        };
      })
  );

  runner.addCheck(
    CheckBuilder.create("SSM Parameters")
      .category("configuration")
      .execute(async () => {
        const allParams = [
          ...JSON_PARAMS.map((p) => `${context.paramPrefix}/${p}`),
          ...YAML_PARAMS.map((p) => `${context.paramPrefix}/${p}`),
        ];

        const discoveryParams: string[] = [];
        for (let i = 0; i < DISCOVERY_PARAMS_OLD.length; i++) {
          discoveryParams.push(
            `${context.paramPrefix}/efs/config/${DISCOVERY_PARAMS_OLD[i]}`
          );
          discoveryParams.push(
            `${context.paramPrefix}/storage/${DISCOVERY_PARAMS_NEW[i]}`
          );
        }

        const results = new Map<
          string,
          { exists: boolean; value?: string; valueSize?: number }
        >();

        for (const param of [...allParams, ...discoveryParams]) {
          const result = await SSMUtility.getParameter(
            context.clients.ssm,
            param
          );
          results.set(param, result);
        }

        console.log("");
        const { totalMissing } = TableFormatter.formatParameterResults(
          [
            {
              name: "JSON Configuration Parameters (created by EFS Stack)",
              params: JSON_PARAMS,
              prefix: context.paramPrefix,
            },
            {
              name: "YAML Configuration Parameters (created by SSM Automation)",
              params: YAML_PARAMS,
              prefix: context.paramPrefix,
            },
          ],
          results
        );

        console.log("EFS Discovery Parameters (created by EFS Stack):");
        let missingDiscoveryParams = 0;
        for (let i = 0; i < DISCOVERY_PARAMS_OLD.length; i++) {
          const paramOld = `${context.paramPrefix}/efs/config/${DISCOVERY_PARAMS_OLD[i]}`;
          const paramNew = `${context.paramPrefix}/storage/${DISCOVERY_PARAMS_NEW[i]}`;

          const resultOld = results.get(paramOld);
          const resultNew = results.get(paramNew);

          if (resultOld?.exists) {
            Logger.success(`${paramOld}: ${resultOld.value || "N/A"}`);
          } else if (resultNew?.exists) {
            Logger.success(`${paramNew}: ${resultNew.value || "N/A"}`);
          } else {
            Logger.error(`${paramOld} or ${paramNew}`);
            missingDiscoveryParams++;
          }
        }

        const allMissing = totalMissing + missingDiscoveryParams;

        console.log("");
        console.log("Summary:");
        TableFormatter.formatCheckSummary(
          JSON_PARAMS.length - totalMissing,
          JSON_PARAMS.length,
          "JSON Parameters"
        );
        TableFormatter.formatCheckSummary(
          YAML_PARAMS.length - totalMissing,
          YAML_PARAMS.length,
          "YAML Parameters"
        );
        TableFormatter.formatCheckSummary(
          DISCOVERY_PARAMS_OLD.length - missingDiscoveryParams,
          DISCOVERY_PARAMS_OLD.length,
          "Discovery Parameters"
        );

        if (totalMissing > 0) {
          console.log("");
          Logger.warning("YAML parameters are created by SSM Automation Document.");
          Logger.info("If they're missing, the automation may not have executed yet.");
        }

        return {
          passed: allMissing === 0,
          message:
            allMissing === 0
              ? "All SSM parameters exist"
              : `${allMissing} parameters missing`,
        };
      })
  );

  runner.addCheck(
    CheckBuilder.create("EFS File System")
      .category("storage")
      .critical(true)
      .execute(async () => {
        if (!context.outputs.fileSystemId) {
          return {
            passed: false,
            message: "File System ID not found in stack outputs",
          };
        }

        const fileSystem = await EFSUtility.getFileSystem(
          context.clients.efs,
          context.outputs.fileSystemId
        );

        if (!fileSystem) {
          return {
            passed: false,
            message: "EFS File System not found",
          };
        }

        console.log("");
        TableFormatter.formatResourceInfo(fileSystem, [
          "FileSystemId",
          "Name",
          "LifeCycleState",
          "PerformanceMode",
          "ThroughputMode",
          "Encrypted",
        ]);

        return {
          passed: fileSystem.LifeCycleState === "available",
          message: `File System State: ${fileSystem.LifeCycleState}`,
        };
      })
  );

  runner.addCheck(
    CheckBuilder.create("EFS Mount Targets")
      .category("storage")
      .execute(async () => {
        if (!context.outputs.fileSystemId) {
          return { passed: false, message: "File System ID not available" };
        }

        const mountTargets = await EFSUtility.getMountTargets(
          context.clients.efs,
          context.outputs.fileSystemId
        );

        if (mountTargets.length === 0) {
          return { passed: false, message: "No mount targets found" };
        }

        console.log("");
        TableFormatter.formatMountTargets(mountTargets);

        const availableMounts = mountTargets.filter(
          (mt) => mt.LifeCycleState === "available"
        ).length;

        return {
          passed: availableMounts === mountTargets.length,
          message: `${availableMounts}/${mountTargets.length} mount targets available`,
        };
      })
  );

  runner.addCheck(
    CheckBuilder.create("EFS Access Point")
      .category("storage")
      .execute(async () => {
        if (!context.outputs.accessPointId) {
          return {
            passed: false,
            message: "Access Point ID not found in stack outputs",
          };
        }

        const accessPoint = await EFSUtility.getAccessPoint(
          context.clients.efs,
          context.outputs.accessPointId
        );

        if (!accessPoint) {
          return { passed: false, message: "Access Point not found" };
        }

        console.log("");
        TableFormatter.formatResourceInfo(accessPoint, [
          "AccessPointId",
          "Name",
          "LifeCycleState",
        ]);

        return {
          passed: accessPoint.LifeCycleState === "available",
          message: `Access Point State: ${accessPoint.LifeCycleState}`,
        };
      })
  );

  runner.addCheck(
    CheckBuilder.create("EFS Security Group")
      .category("security")
      .execute(async () => {
        if (!context.outputs.securityGroupId) {
          return {
            passed: false,
            message: "Security Group ID not found in stack outputs",
          };
        }

        const securityGroup = await EC2Utility.getSecurityGroup(
          context.clients.ec2,
          context.outputs.securityGroupId
        );

        if (!securityGroup) {
          return { passed: false, message: "Security Group not found" };
        }

        console.log("");
        TableFormatter.formatSecurityGroupRules(
          securityGroup.IpPermissions,
          "inbound"
        );
        console.log("");
        TableFormatter.formatSecurityGroupRules(
          securityGroup.IpPermissionsEgress,
          "outbound"
        );

        const hasNfsRule = EC2Utility.hasInboundRule(securityGroup, 2049, "tcp");

        return {
          passed: hasNfsRule,
          message: hasNfsRule
            ? "Security Group has NFS inbound rule (TCP 2049)"
            : "Security Group missing NFS inbound rule (TCP 2049)",
        };
      })
  );

  runner.addCheck(
    CheckBuilder.create("Infrastructure Stack Readiness")
      .category("readiness")
      .execute(async () => {
        const checker = new ReadinessChecker();

        const fileSystem = await EFSUtility.getFileSystem(
          context.clients.efs,
          context.outputs.fileSystemId!
        );
        const mountTargets = await EFSUtility.getMountTargets(
          context.clients.efs,
          context.outputs.fileSystemId!
        );
        const accessPoint = await EFSUtility.getAccessPoint(
          context.clients.efs,
          context.outputs.accessPointId!
        );

        if (fileSystem?.LifeCycleState !== "available") {
          checker.addBlocker(
            `EFS file system state: ${fileSystem?.LifeCycleState || "unknown"} (expected: available)`
          );
        }

        const availableMounts = mountTargets.filter(
          (mt) => mt.LifeCycleState === "available"
        ).length;

        if (mountTargets.length === 0 || availableMounts !== mountTargets.length) {
          checker.addBlocker(
            `Not all mount targets available (${availableMounts}/${mountTargets.length})`
          );
        }

        if (accessPoint?.LifeCycleState !== "available") {
          checker.addBlocker(
            `EFS access point state: ${accessPoint?.LifeCycleState || "unknown"} (expected: available)`
          );
        }

        const securityGroup = await EC2Utility.getSecurityGroup(
          context.clients.ec2,
          context.outputs.securityGroupId!
        );

        if (!EC2Utility.hasInboundRule(securityGroup, 2049, "tcp")) {
          checker.addBlocker("Security group missing NFS inbound rule (TCP 2049)");
        }

        if (checker.isReady()) {
          checker.addNextStep(
            `Deploy MonitoringInfraStack: cdk deploy ${context.config.environment}-MonitoringInfra`
          );
        }

        console.log("");
        checker.printAssessment("MonitoringInfraStack");

        return {
          passed: checker.isReady(),
          message: checker.isReady()
            ? "EFS Stack ready for InfraStack deployment"
            : "EFS Stack not ready for InfraStack deployment",
        };
      })
  );

  runner.addCheck(
    CheckBuilder.create("Service Stack Readiness")
      .category("readiness")
      .execute(async () => {
        const checker = new ReadinessChecker();

        const requiredYamlConfigs = [
          "prometheus-config-yaml",
          "grafana-datasource-config-yaml",
          "grafana-dashboard-config-yaml",
        ];

        for (const config of requiredYamlConfigs) {
          const result = await SSMUtility.getParameter(
            context.clients.ssm,
            `${context.paramPrefix}/${config}`
          );

          if (!result.exists) {
            checker.addBlocker(`Missing YAML configuration: ${config}`);
          }
        }

        const setupScriptResult = await SSMUtility.getParameter(
          context.clients.ssm,
          `${context.paramPrefix}/efs-setup-script`
        );

        if (!setupScriptResult.exists) {
          checker.addBlocker("Missing EFS setup script");
        }

        if (checker.isReady()) {
          checker.addNextStep("Deploy MonitoringInfraStack (if not already deployed)");
          checker.addNextStep("Verify MonitoringInfraStack deployment");
          checker.addNextStep(
            `Deploy MonitoringServiceStack: cdk deploy ${context.config.environment}-MonitoringService`
          );
        } else {
          checker.addWarning(
            "YAML configurations are created by SSM Automation Document"
          );
          checker.addNextStep("Check SSM Automation execution status");
          checker.addNextStep("Manually trigger automation if needed");
        }

        console.log("");
        checker.printAssessment("MonitoringServiceStack");

        return {
          passed: checker.isReady(),
          message: checker.isReady()
            ? "EFS Stack ready for ServiceStack deployment"
            : "EFS Stack not ready for ServiceStack deployment",
        };
      })
  );
}

const cli = CliBuilder.create(
  "verify-efs-stack",
  "Verify EFS stack deployment and readiness"
);

cli.parse();

const options = cli.opts();

CliBuilder.validateEnvironment(options.environment);

const config: VerifyEfsStackConfig = {
  environment: options.environment,
  region: options.region,
  profile: options.profile,
};

verifyEfsStack(config).catch((error) => {
  Logger.error(`Verification failed: ${error.message}`);
  process.exit(1);
});
