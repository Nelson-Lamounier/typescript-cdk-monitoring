#!/usr/bin/env node
/** @format */

// infrastructure/scripts/deployment/monitoring/verify-efs-stack.ts

import { program } from "commander";
import {
  CloudFormationClient,
  DescribeStacksCommand,
} from "@aws-sdk/client-cloudformation";
import { EC2Client, DescribeSecurityGroupsCommand } from "@aws-sdk/client-ec2";
import {
  EFSClient,
  DescribeFileSystemsCommand,
  DescribeMountTargetsCommand,
  DescribeAccessPointsCommand,
} from "@aws-sdk/client-efs";
import {
  STSClient,
  GetCallerIdentityCommand,
  AssumeRoleCommand,
} from "@aws-sdk/client-sts";
import {
  SSMClient,
  DescribeDocumentCommand,
  GetParameterCommand,
  DescribeAutomationExecutionsCommand,
} from "@aws-sdk/client-ssm";

import { Logger } from "../utils/logger";

interface VerifyEfsStackConfig {
  profile?: string;
  region: string;
  environment: string;
}

interface StackOutputs {
  fileSystemId?: string;
  accessPointId?: string;
  securityGroupId?: string;
}

interface VerificationSummary {
  checksPassed: number;
  totalChecks: number;
  stackStatus?: string;
  documentStatus?: string;
  missingParams: number;
  mountTargetCount: number;
  infraReady: boolean;
  serviceReady: boolean;
}

const VALID_ENVIRONMENTS = ["development", "staging", "production", "pipeline"];

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
      if (output.OutputKey === "FileSystemId") {
        outputs.fileSystemId = output.OutputValue;
      } else if (output.OutputKey === "AccessPointId") {
        outputs.accessPointId = output.OutputValue;
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

async function getSsmDocumentStatus(
  ssmClient: SSMClient,
  documentName: string
): Promise<{
  status: string;
  documentType?: string;
  documentVersion?: string;
} | null> {
  try {
    const command = new DescribeDocumentCommand({
      Name: documentName,
    });

    const response = await ssmClient.send(command);
    const document = response.Document;

    if (!document) {
      return null;
    }

    return {
      status: document.Status || "UNKNOWN",
      documentType: document.DocumentType,
      documentVersion: document.DocumentVersion,
    };
  } catch (error: any) {
    if (error.name === "InvalidDocument") {
      return null;
    }
    throw error;
  }
}

async function getAutomationExecutions(
  ssmClient: SSMClient,
  documentName: string
): Promise<
  Array<{
    id: string;
    status: string;
    startTime?: Date;
  }>
> {
  try {
    const command = new DescribeAutomationExecutionsCommand({
      Filters: [
        {
          Key: "DocumentNamePrefix",
          Values: [documentName],
        },
      ],
      MaxResults: 5,
    });

    const response = await ssmClient.send(command);
    const executions = response.AutomationExecutionMetadataList || [];

    return executions.map((exec) => ({
      id: exec.AutomationExecutionId || "",
      status: exec.AutomationExecutionStatus || "UNKNOWN",
      startTime: exec.ExecutionStartTime,
    }));
  } catch {
    return [];
  }
}

async function checkSsmParameter(
  ssmClient: SSMClient,
  paramName: string
): Promise<{ exists: boolean; valueSize?: number; value?: string }> {
  try {
    const command = new GetParameterCommand({
      Name: paramName,
    });

    const response = await ssmClient.send(command);
    const param = response.Parameter;

    if (!param) {
      return { exists: false };
    }

    return {
      exists: true,
      valueSize: param.Value?.length,
      value: param.Value,
    };
  } catch (error: any) {
    if (error.name === "ParameterNotFound") {
      return { exists: false };
    }
    throw error;
  }
}

async function getEfsFileSystem(
  efsClient: EFSClient,
  fileSystemId: string
): Promise<any> {
  try {
    const command = new DescribeFileSystemsCommand({
      FileSystemId: fileSystemId,
    });

    const response = await efsClient.send(command);
    if (!response.FileSystems || response.FileSystems.length === 0) {
      Logger.warning(
        `DescribeFileSystems returned no results for ${fileSystemId}`
      );
    }
    return response.FileSystems?.[0];
  } catch (error: any) {
    Logger.warning(
      `DescribeFileSystems failed for ${fileSystemId}: ${error.message}`
    );
    return null;
  }
}

async function getMountTargets(
  efsClient: EFSClient,
  fileSystemId: string
): Promise<any[]> {
  try {
    const command = new DescribeMountTargetsCommand({
      FileSystemId: fileSystemId,
    });

    const response = await efsClient.send(command);
    return response.MountTargets || [];
  } catch (error: any) {
    Logger.warning(
      `DescribeMountTargets failed for ${fileSystemId}: ${error.message}`
    );
    return [];
  }
}

async function getAccessPoint(
  efsClient: EFSClient,
  accessPointId: string
): Promise<any> {
  try {
    const command = new DescribeAccessPointsCommand({
      AccessPointId: accessPointId,
    });

    const response = await efsClient.send(command);
    return response.AccessPoints?.[0];
  } catch (error: any) {
    Logger.warning(
      `DescribeAccessPoints failed for ${accessPointId}: ${error.message}`
    );
    return null;
  }
}

async function getSecurityGroup(
  ec2Client: EC2Client,
  securityGroupId: string
): Promise<any> {
  try {
    const command = new DescribeSecurityGroupsCommand({
      GroupIds: [securityGroupId],
    });

    const response = await ec2Client.send(command);
    return response.SecurityGroups?.[0];
  } catch (error: any) {
    Logger.warning(
      `DescribeSecurityGroups failed for ${securityGroupId}: ${error.message}`
    );
    return null;
  }
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

async function createClients(config: VerifyEfsStackConfig): Promise<{
  cfn: CloudFormationClient;
  ssm: SSMClient;
  efs: EFSClient;
  ec2: EC2Client;
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
      RoleSessionName: `verify-efs-${Date.now()}`,
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
      ssm: new SSMClient(assumedClientConfig),
      efs: new EFSClient(assumedClientConfig),
      ec2: new EC2Client(assumedClientConfig),
      accountId,
      baseAccountId,
      assumedRoleArn: roleArn,
    };
  }

  return {
    cfn: new CloudFormationClient(clientConfig),
    ssm: new SSMClient(clientConfig),
    efs: new EFSClient(clientConfig),
    ec2: new EC2Client(clientConfig),
    accountId: baseAccountId,
    baseAccountId,
  };
}

function formatTable(data: Array<{ Key: string; Value: string }>): void {
  if (data.length === 0) {
    console.log("  (no outputs)");
    return;
  }

  const maxKeyLength = Math.max(
    ...data.map((item) => item.Key.length),
    "Key".length
  );
  const maxValueLength = Math.max(
    ...data.map((item) => item.Value.length),
    "Value".length
  );

  const header = `| ${"Key".padEnd(maxKeyLength)} | ${"Value".padEnd(
    maxValueLength
  )} |`;
  const separator = `|${"-".repeat(maxKeyLength + 2)}|${"-".repeat(
    maxValueLength + 2
  )}|`;

  console.log(separator);
  console.log(header);
  console.log(separator);

  data.forEach((item) => {
    console.log(
      `| ${item.Key.padEnd(maxKeyLength)} | ${item.Value.padEnd(
        maxValueLength
      )} |`
    );
  });

  console.log(separator);
}

async function verifyEfsStack(
  config: VerifyEfsStackConfig
): Promise<VerificationSummary> {
  Logger.section(`EFS Stack Verification - ${config.environment}`);

  const stackName = `${config.environment}-MonitoringEfs`;
  const documentName = `${stackName}-${config.environment}-efs-init`;
  const paramPrefix = `/monitoring/${config.environment}`;

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

  const {
    cfn: cfnClient,
    ssm: ssmClient,
    efs: efsClient,
    ec2: ec2Client,
    accountId,
    baseAccountId,
    assumedRoleArn,
  } = await createClients(config);

  if (assumedRoleArn) {
    Logger.keyValue("Assumed Role ARN", assumedRoleArn);
  }
  if (baseAccountId && baseAccountId !== accountId) {
    Logger.keyValue("Base Account ID", baseAccountId);
  }
  if (accountId) {
    Logger.keyValue("AWS Account ID", accountId);
  }
  Logger.keyValue("Timestamp", new Date().toISOString());
  console.log("");

  const summary: VerificationSummary = {
    checksPassed: 0,
    totalChecks: 9,
    missingParams: 0,
    mountTargetCount: 0,
    infraReady: true,
    serviceReady: true,
  };

  // 1. CloudFormation Stack
  Logger.subsection("1. CloudFormation Stack Status");
  const stackInfo = await getStackStatus(cfnClient, stackName);

  if (!stackInfo) {
    Logger.error("Stack Status: NOT_FOUND");
    return summary;
  }

  summary.stackStatus = stackInfo.status;

  if (
    stackInfo.status === "CREATE_COMPLETE" ||
    stackInfo.status === "UPDATE_COMPLETE"
  ) {
    Logger.success(`Stack Status: ${stackInfo.status}`);
    summary.checksPassed++;
  } else {
    Logger.error(`Stack Status: ${stackInfo.status}`);
    return summary;
  }

  console.log("");
  console.log("Stack Outputs:");
  const outputs = stackInfo.outputs;
  const outputTable = [];
  if (outputs.fileSystemId) {
    outputTable.push({ Key: "FileSystemId", Value: outputs.fileSystemId });
  }
  if (outputs.accessPointId) {
    outputTable.push({ Key: "AccessPointId", Value: outputs.accessPointId });
  }
  if (outputs.securityGroupId) {
    outputTable.push({
      Key: "SecurityGroupId",
      Value: outputs.securityGroupId,
    });
  }
  formatTable(outputTable);

  console.log("");
  console.log("Resource IDs:");
  if (outputs.fileSystemId) {
    Logger.keyValue("File System ID", outputs.fileSystemId);
  }
  if (outputs.accessPointId) {
    Logger.keyValue("Access Point ID", outputs.accessPointId);
  }
  if (outputs.securityGroupId) {
    Logger.keyValue("Security Group ID", outputs.securityGroupId);
  }

  // 2. SSM Automation Document
  Logger.subsection("2. SSM Automation Document");
  const docInfo = await getSsmDocumentStatus(ssmClient, documentName);

  if (!docInfo || docInfo.status !== "Active") {
    Logger.error(`SSM Automation Document: ${docInfo?.status || "NOT_FOUND"}`);
    Logger.info(`Expected: ${documentName}`);
  } else {
    Logger.success(`SSM Automation Document: ${docInfo.status}`);
    Logger.keyValue("Document Name", documentName);
    Logger.keyValue("Document Type", docInfo.documentType || "N/A");
    Logger.keyValue("Document Version", docInfo.documentVersion || "N/A");
    summary.checksPassed++;
    summary.documentStatus = docInfo.status;
  }

  console.log("");
  console.log("SSM Automation Executions:");
  const executions = await getAutomationExecutions(ssmClient, documentName);

  if (executions.length > 0) {
    executions.forEach((exec) => {
      const shortId = exec.id.substring(0, 8);
      if (exec.status === "Success") {
        Logger.success(`Execution: ${shortId}... (${exec.id})`);
      } else if (exec.status === "Failed") {
        Logger.error(`Execution: ${shortId}... (${exec.id})`);
      } else {
        Logger.warning(`Execution: ${shortId}... (${exec.id})`);
      }
      Logger.keyValue("Status", exec.status);
      if (exec.startTime) {
        Logger.keyValue("Started", exec.startTime.toISOString());
      }
      console.log("");
    });
  } else {
    Logger.warning("No automation executions found");
    Logger.info(
      "Note: Document may not have been executed yet, or executions have expired."
    );
  }

  // 3. SSM Parameters
  Logger.subsection("3. SSM Parameters");

  console.log("JSON Configuration Parameters (created by EFS Stack):");
  let missingJsonParams = 0;
  for (const param of JSON_PARAMS) {
    const paramName = `${paramPrefix}/${param}`;
    const result = await checkSsmParameter(ssmClient, paramName);

    if (result.exists) {
      Logger.success(`${paramName} (${result.valueSize || 0} chars)`);
    } else {
      Logger.error(paramName);
      missingJsonParams++;
    }
  }

  console.log("");
  console.log(
    "YAML Configuration Parameters (created by SSM Automation Document):"
  );
  let missingYamlParams = 0;
  for (const param of YAML_PARAMS) {
    const paramName = `${paramPrefix}/${param}`;
    const result = await checkSsmParameter(ssmClient, paramName);

    if (result.exists) {
      Logger.success(`${paramName} (${result.valueSize || 0} chars)`);
    } else {
      Logger.error(paramName);
      missingYamlParams++;
    }
  }

  console.log("");
  console.log("EFS Discovery Parameters (created by EFS Stack):");
  let missingDiscoveryParams = 0;

  for (let i = 0; i < DISCOVERY_PARAMS_OLD.length; i++) {
    const paramOld = `${paramPrefix}/efs/config/${DISCOVERY_PARAMS_OLD[i]}`;
    const paramNew = `${paramPrefix}/storage/${DISCOVERY_PARAMS_NEW[i]}`;

    let result = await checkSsmParameter(ssmClient, paramOld);
    if (!result.exists) {
      result = await checkSsmParameter(ssmClient, paramNew);
      if (result.exists) {
        Logger.success(`${paramNew}: ${result.value || "N/A"}`);
      } else {
        Logger.error(`${paramOld} or ${paramNew}`);
        missingDiscoveryParams++;
      }
    } else {
      Logger.success(`${paramOld}: ${result.value || "N/A"}`);
    }
  }

  summary.missingParams =
    missingJsonParams + missingYamlParams + missingDiscoveryParams;

  console.log("");
  console.log("Summary:");
  Logger.keyValue(
    "JSON Parameters",
    `${JSON_PARAMS.length - missingJsonParams}/${JSON_PARAMS.length}`
  );
  Logger.keyValue(
    "YAML Parameters",
    `${YAML_PARAMS.length - missingYamlParams}/${YAML_PARAMS.length}`
  );
  Logger.keyValue(
    "Discovery Parameters",
    `${DISCOVERY_PARAMS_OLD.length - missingDiscoveryParams}/${
      DISCOVERY_PARAMS_OLD.length
    }`
  );

  if (summary.missingParams === 0) {
    Logger.success("All SSM parameters created successfully");
    summary.checksPassed++;
  } else {
    Logger.warning(`${summary.missingParams} parameters missing`);
    if (missingYamlParams > 0) {
      console.log("");
      Logger.warning(
        "Note: YAML parameters are created by SSM Automation Document."
      );
      Logger.info(
        "      If they're missing, the automation may not have executed yet."
      );
      Logger.info("      Check SSM Automation executions above.");
    }
  }

  // 4. EFS File System
  if (!outputs.fileSystemId) {
    Logger.error("File System ID not found in stack outputs");
    return summary;
  }

  Logger.subsection("4. EFS File System");
  const fileSystem = await getEfsFileSystem(efsClient, outputs.fileSystemId);

  if (!fileSystem) {
    Logger.error("EFS File System not found");
    return summary;
  }

  Logger.success("EFS File System exists");
  console.log("");
  Logger.keyValue("File System ID", fileSystem.FileSystemId || "N/A");
  Logger.keyValue("Name", fileSystem.Name || "N/A");
  Logger.keyValue("State", fileSystem.LifeCycleState || "N/A");
  Logger.keyValue("Performance Mode", fileSystem.PerformanceMode || "N/A");
  Logger.keyValue("Throughput Mode", fileSystem.ThroughputMode || "N/A");
  Logger.keyValue("Encrypted", String(fileSystem.Encrypted || false));
  Logger.keyValue("Size in Bytes", String(fileSystem.SizeInBytes?.Value || 0));
  if (fileSystem.CreationTime) {
    Logger.keyValue("Creation Time", fileSystem.CreationTime.toISOString());
  }

  if (fileSystem.LifeCycleState === "available") {
    summary.checksPassed++;
  }

  // 5. EFS Mount Targets
  Logger.subsection("5. EFS Mount Targets");
  const mountTargets = await getMountTargets(efsClient, outputs.fileSystemId);
  summary.mountTargetCount = mountTargets.length;

  if (mountTargets.length > 0) {
    Logger.success(`Mount Targets: ${mountTargets.length}`);
    console.log("");

    mountTargets.forEach((mt) => {
      Logger.keyValue("Mount Target ID", mt.MountTargetId || "N/A");
      Logger.keyValue("Subnet ID", mt.SubnetId || "N/A");
      Logger.keyValue("IP Address", mt.IpAddress || "N/A");
      Logger.keyValue("Availability Zone", mt.AvailabilityZoneName || "N/A");
      Logger.keyValue("State", mt.LifeCycleState || "N/A");
      Logger.keyValue(
        "Security Groups",
        mt.SecurityGroups?.join(", ") || "N/A"
      );
      console.log("---");
    });

    const availableMounts = mountTargets.filter(
      (mt) => mt.LifeCycleState === "available"
    ).length;

    if (availableMounts === mountTargets.length) {
      summary.checksPassed++;
    }
  } else {
    Logger.error("No mount targets found");
  }

  // 6. EFS Access Point
  if (!outputs.accessPointId) {
    Logger.error("Access Point ID not found in stack outputs");
    return summary;
  }

  Logger.subsection("6. EFS Access Point");
  const accessPoint = await getAccessPoint(efsClient, outputs.accessPointId);

  if (!accessPoint) {
    Logger.error("Access Point not found");
  } else {
    Logger.success("Access Point exists");
    console.log("");
    Logger.keyValue("Access Point ID", accessPoint.AccessPointId || "N/A");
    Logger.keyValue("Name", accessPoint.Name || "N/A");
    Logger.keyValue("State", accessPoint.LifeCycleState || "N/A");
    Logger.keyValue("Root Directory", accessPoint.RootDirectory?.Path || "N/A");
    Logger.keyValue(
      "POSIX User - UID",
      String(accessPoint.PosixUser?.Uid || "N/A")
    );
    Logger.keyValue(
      "POSIX User - GID",
      String(accessPoint.PosixUser?.Gid || "N/A")
    );
    Logger.keyValue(
      "Owner - UID",
      String(accessPoint.RootDirectory?.CreationInfo?.OwnerUid || "N/A")
    );
    Logger.keyValue(
      "Owner - GID",
      String(accessPoint.RootDirectory?.CreationInfo?.OwnerGid || "N/A")
    );
    Logger.keyValue(
      "Permissions",
      accessPoint.RootDirectory?.CreationInfo?.Permissions || "N/A"
    );

    if (accessPoint.LifeCycleState === "available") {
      summary.checksPassed++;
    }
  }

  // 7. Security Group
  if (!outputs.securityGroupId) {
    Logger.error("Security Group ID not found in stack outputs");
    return summary;
  }

  Logger.subsection("7. EFS Security Group");
  const securityGroup = await getSecurityGroup(
    ec2Client,
    outputs.securityGroupId
  );

  if (!securityGroup) {
    Logger.error("Security Group not found");
  } else {
    Logger.success("Security Group exists");
    console.log("");
    console.log("Inbound Rules:");
    securityGroup.IpPermissions?.forEach((rule: any) => {
      const source =
        rule.IpRanges?.[0]?.CidrIp ||
        rule.UserIdGroupPairs?.[0]?.GroupId ||
        "N/A";
      Logger.info(
        `Protocol: ${rule.IpProtocol}, Ports: ${rule.FromPort}-${rule.ToPort}, Source: ${source}`
      );
    });

    console.log("");
    console.log("Outbound Rules:");
    securityGroup.IpPermissionsEgress?.forEach((rule: any) => {
      const dest = rule.IpRanges?.[0]?.CidrIp || "N/A";
      Logger.info(
        `Protocol: ${rule.IpProtocol}, Ports: ${rule.FromPort || "All"}-${
          rule.ToPort || "All"
        }, Destination: ${dest}`
      );
    });

    const hasNfsRule = securityGroup.IpPermissions?.some(
      (rule: any) =>
        rule.FromPort === 2049 &&
        rule.ToPort === 2049 &&
        rule.IpProtocol === "tcp"
    );

    if (hasNfsRule) {
      summary.checksPassed++;
    }
  }

  // 8. Sample Configs
  Logger.subsection("8. Sample Configuration Files");

  console.log("Prometheus Config (first 500 chars):");
  const prometheusConfig = await checkSsmParameter(
    ssmClient,
    `${paramPrefix}/prometheus-config-yaml`
  );
  if (prometheusConfig.exists && prometheusConfig.value) {
    console.log(prometheusConfig.value.substring(0, 500));
    console.log("...");
  } else {
    Logger.warning("Prometheus config not found");
  }

  console.log("");
  console.log("EFS Setup Script (first 500 chars):");
  const setupScript = await checkSsmParameter(
    ssmClient,
    `${paramPrefix}/efs-setup-script`
  );
  if (setupScript.exists && setupScript.value) {
    console.log(setupScript.value.substring(0, 500));
    console.log("...");
  } else {
    Logger.warning("EFS setup script not found");
  }

  // 9. Infrastructure Stack Readiness
  Logger.subsection("9. Infrastructure Stack Deployment Readiness");
  console.log("Checking prerequisites for MonitoringInfraStack deployment...");
  console.log("");

  if (fileSystem?.LifeCycleState !== "available") {
    Logger.error(
      `EFS file system state: ${
        fileSystem?.LifeCycleState || "unknown"
      } (expected: available)`
    );
    summary.infraReady = false;
  } else {
    Logger.success("EFS file system is available");
  }

  const availableMounts = mountTargets.filter(
    (mt) => mt.LifeCycleState === "available"
  ).length;

  if (mountTargets.length > 0) {
    if (availableMounts === mountTargets.length) {
      Logger.success(
        `All mount targets available (${availableMounts}/${mountTargets.length})`
      );
    } else {
      Logger.error(
        `Not all mount targets available (${availableMounts}/${mountTargets.length})`
      );
      summary.infraReady = false;
    }
  } else {
    Logger.error("No mount targets found");
    summary.infraReady = false;
  }

  if (accessPoint?.LifeCycleState === "available") {
    Logger.success("EFS access point is available");
  } else {
    Logger.error(
      `EFS access point state: ${
        accessPoint?.LifeCycleState || "unknown"
      } (expected: available)`
    );
    summary.infraReady = false;
  }

  const hasNfsRule = securityGroup?.IpPermissions?.some(
    (rule: any) =>
      rule.FromPort === 2049 &&
      rule.ToPort === 2049 &&
      rule.IpProtocol === "tcp"
  );

  if (hasNfsRule) {
    Logger.success("Security group has NFS inbound rule (TCP 2049)");
  } else {
    Logger.error("Security group missing NFS inbound rule (TCP 2049)");
    summary.infraReady = false;
  }

  if (summary.missingParams === 0) {
    Logger.success("All required SSM parameters exist");
  } else {
    Logger.error(`Missing ${summary.missingParams} SSM parameters`);
    summary.infraReady = false;
  }

  console.log("");

  if (summary.infraReady) {
    Logger.success("EFS STACK READY FOR INFRA DEPLOYMENT");
    console.log("");
    Logger.info("Next step: Deploy MonitoringInfraStack");
    Logger.code(
      `cdk deploy ${config.environment}-MonitoringInfra --profile ${
        config.profile || "default"
      }`
    );
    summary.checksPassed++;
  } else {
    Logger.error("EFS STACK NOT READY FOR INFRA DEPLOYMENT");
    console.log("");
    Logger.info("Resolve issues above before deploying MonitoringInfraStack");
  }

  // 10. Service Stack Readiness
  Logger.subsection("10. Service Stack Deployment Readiness");
  console.log(
    "Checking prerequisites for MonitoringServiceStack deployment..."
  );
  console.log("");

  const requiredYamlConfigs = [
    "prometheus-config-yaml",
    "grafana-datasource-config-yaml",
    "grafana-dashboard-config-yaml",
  ];

  let yamlConfigMissing = 0;
  for (const config of requiredYamlConfigs) {
    const result = await checkSsmParameter(
      ssmClient,
      `${paramPrefix}/${config}`
    );
    if (result.exists) {
      Logger.success(`${paramPrefix}/${config} exists`);
    } else {
      Logger.error(`${paramPrefix}/${config} missing`);
      yamlConfigMissing++;
      summary.serviceReady = false;
    }
  }

  const setupScriptResult = await checkSsmParameter(
    ssmClient,
    `${paramPrefix}/efs-setup-script`
  );

  if (setupScriptResult.exists) {
    Logger.success("EFS setup script exists");
  } else {
    Logger.error("EFS setup script missing");
    summary.serviceReady = false;
  }

  console.log("");

  if (summary.serviceReady) {
    Logger.success("EFS STACK READY FOR SERVICE DEPLOYMENT");
    console.log("");
    Logger.info("Prerequisites satisfied:");
    Logger.info("  ✅ YAML configuration files available for services");
    Logger.info("  ✅ EFS setup script available for EC2 initialization");
    console.log("");
    Logger.info("Required deployment order:");
    Logger.info("  1. MonitoringEfsStack ✅ (completed)");
    Logger.info("  2. MonitoringInfraStack (deploy next)");
    Logger.info(
      "  3. MonitoringServiceStack (deploy after InfraStack verification)"
    );
    summary.checksPassed++;
  } else {
    Logger.error("EFS STACK NOT READY FOR SERVICE DEPLOYMENT");
    console.log("");
    Logger.warning(`Missing ${yamlConfigMissing} configuration files`);
    Logger.info(
      "This usually indicates SSM Automation Document hasn't executed yet."
    );
  }

  return summary;
}

// CLI
program
  .name("verify-efs-stack")
  .description("Verify EFS stack deployment and readiness")
  .option(
    "-e, --environment <env>",
    "Environment name (default: development)",
    "development"
  )
  .option(
    "-r, --region <region>",
    "AWS region (default: eu-west-1)",
    "eu-west-1"
  )
  .option("-p, --profile <profile>", "AWS CLI profile")
  .parse();

const options = program.opts();

// Validate environment
if (!VALID_ENVIRONMENTS.includes(options.environment)) {
  Logger.error(`Invalid environment: ${options.environment}`);
  Logger.info(`Valid environments: ${VALID_ENVIRONMENTS.join(", ")}`);
  process.exit(1);
}

const config: VerifyEfsStackConfig = {
  environment: options.environment,
  region: options.region,
  profile: options.profile,
};

verifyEfsStack(config)
  .then((summary) => {
    Logger.section("VERIFICATION SUMMARY");

    Logger.keyValue(
      "Checks Passed",
      `${summary.checksPassed}/${summary.totalChecks}`
    );
    console.log("");

    if (summary.checksPassed === summary.totalChecks) {
      Logger.success("ALL CHECKS PASSED - EFS STACK READY");
      console.log("");
      Logger.info("Architecture Verification:");
      Logger.info("  ✅ EFS resources created and available");
      Logger.info("  ✅ SSM Automation Document deployed");
      Logger.info("  ✅ JSON configurations stored in SSM");
      Logger.info("  ✅ YAML configurations generated");
      Logger.info("  ✅ EFS setup script created");
      Logger.info("  ✅ Mount targets ready in correct AZs");
      Logger.info("  ✅ Security group configured for NFS access");
      Logger.info("  ✅ Prerequisites for InfraStack satisfied");
      Logger.info("  ✅ Prerequisites for ServiceStack satisfied");
      console.log("");
      Logger.info("Next steps:");
      Logger.info("  1. Deploy MonitoringInfraStack:");
      Logger.code(
        `cdk deploy ${config.environment}-MonitoringInfra --profile ${
          config.profile || "default"
        }`
      );
      console.log("");
      Logger.info("  2. Verify InfraStack deployment:");
      Logger.code(
        `./scripts/tests/verify-infra-stack.sh -e ${config.environment} -p ${
          config.profile || "default"
        }`
      );
      console.log("");
      Logger.info(
        "  3. After InfraStack verification passes, deploy ServiceStack:"
      );
      Logger.code(
        `cdk deploy ${config.environment}-MonitoringService --profile ${
          config.profile || "default"
        }`
      );
      console.log("");
      Logger.info("Architecture Flow:");
      Logger.info(
        "  EFS Stack → SSM State Manager mounts EFS on EC2 → Services use EFS storage"
      );
      console.log("");
      process.exit(0);
    } else {
      Logger.warning(
        `${
          summary.totalChecks - summary.checksPassed
        } checks failed. Review output above.`
      );
      console.log("");

      if (!summary.infraReady) {
        Logger.warning("Infrastructure Stack Readiness: NOT READY");
        Logger.info(
          "  Resolve EFS resource issues before deploying MonitoringInfraStack"
        );
      }

      if (!summary.serviceReady) {
        Logger.warning("Service Stack Readiness: NOT READY");
        Logger.info(
          "  YAML configurations missing - check SSM Automation execution"
        );
      }

      console.log("");
      Logger.info("Troubleshooting:");
      Logger.info("  1. Check CloudFormation stack events for errors");
      Logger.info("  2. Check SSM Automation Document status");
      Logger.info("  3. Check SSM Automation execution logs");
      Logger.info(
        "  4. If YAML parameters are missing, manually execute automation"
      );
      Logger.info("  5. Verify EFS mount targets are in correct AZs");
      Logger.info("  6. Check security group NFS rule (TCP 2049)");
      process.exit(1);
    }
  })
  .catch((error) => {
    Logger.error(`Verification failed: ${error.message}`);
    process.exit(1);
  });
