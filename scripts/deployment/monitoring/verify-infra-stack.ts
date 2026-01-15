#!/usr/bin/env node
/** @format */

// infrastructure/scripts/deployment/monitoring/verify-infra-stack.ts

import * as http from "http";

import { program } from "commander";
import {
  CloudFormationClient,
  DescribeStacksCommand,
  ListStackResourcesCommand,
} from "@aws-sdk/client-cloudformation";
import {
  AutoScalingClient,
  DescribeAutoScalingGroupsCommand,
} from "@aws-sdk/client-auto-scaling";
import {
  EC2Client,
  DescribeInstanceStatusCommand,
  DescribeSecurityGroupsCommand,
} from "@aws-sdk/client-ec2";
import { ECSClient, DescribeClustersCommand } from "@aws-sdk/client-ecs";
import { EFSClient, DescribeMountTargetsCommand } from "@aws-sdk/client-efs";
import {
  ElasticLoadBalancingV2Client,
  DescribeLoadBalancersCommand,
  DescribeListenersCommand,
  DescribeTargetGroupsCommand,
} from "@aws-sdk/client-elastic-load-balancing-v2";
import {
  STSClient,
  GetCallerIdentityCommand,
  AssumeRoleCommand,
} from "@aws-sdk/client-sts";
import {
  CloudWatchLogsClient,
  DescribeLogGroupsCommand,
} from "@aws-sdk/client-cloudwatch-logs";
import {
  EventBridgeClient,
  ListRulesCommand,
} from "@aws-sdk/client-eventbridge";
import {
  SSMClient,
  GetParameterCommand,
  GetParametersByPathCommand,
  ListAssociationsCommand,
  DescribeAssociationExecutionsCommand,
  SendCommandCommand,
  GetCommandInvocationCommand,
} from "@aws-sdk/client-ssm";

import { Logger } from "../utils/logger.js";

interface VerifyInfraStackConfig {
  profile?: string;
  region: string;
  environment: string;
  verbose?: boolean;
}

interface StackOutputs {
  clusterName?: string;
  autoScalingGroupName?: string;
  loadBalancerDns?: string;
  listenerArn?: string;
  prometheusUrl?: string;
  grafanaUrl?: string;
  taskLogGroupName?: string;
}

interface CheckCounts {
  total: number;
  passed: number;
  failed: number;
  warnings: number;
}

interface VerificationState {
  stackStatus?: string;
  clusterName?: string;
  clusterStatus?: string;
  registeredInstances: number;
  asgName?: string;
  instanceIds: string[];
  healthyInstances: number;
  albDns?: string;
  albArn?: string;
  albState?: string;
  listenerArn?: string;
  efsFileSystemId?: string;
  efsAz?: string;
  mountTargetCount: number;
  efsMountAssocId?: string;
  efsMountStatus?: string;
  efsInitAssocId?: string;
  efsInitStatus?: string;
  efsMountedOnAllInstances: boolean;
  efsDirectoryStructureVerified: boolean;
  totalParamsFound: number;
  totalParamsExpected: number;
  readinessIssues: number;
}

const VALID_ENVIRONMENTS = ["development", "staging", "production", "pipeline"];

const INFRA_PARAMS = [
  "cluster-name",
  "cluster-arn",
  "alb-dns",
  "listener-arn",
  "asg-name",
];

const STORAGE_PARAMS_EFS = [
  "file-system-id",
  "access-point-id",
  "security-group-id",
  "availability-zone",
];

const STORAGE_PARAMS_LEGACY = [
  "efs-id",
  "access-point-id",
  "efs-sg-id",
  "efs-az",
];

const CONFIG_PARAMS = [
  "prometheus-config-yaml",
  "grafana-datasource-config-yaml",
  "grafana-dashboard-config-yaml",
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

function sleep(seconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
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

async function createClients(config: VerifyInfraStackConfig): Promise<{
  cfn: CloudFormationClient;
  ecs: ECSClient;
  asg: AutoScalingClient;
  ec2: EC2Client;
  elbv2: ElasticLoadBalancingV2Client;
  logs: CloudWatchLogsClient;
  efs: EFSClient;
  ssm: SSMClient;
  eventBridge: EventBridgeClient;
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
      RoleSessionName: `verify-infra-${Date.now()}`,
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
      ecs: new ECSClient(assumedClientConfig),
      asg: new AutoScalingClient(assumedClientConfig),
      ec2: new EC2Client(assumedClientConfig),
      elbv2: new ElasticLoadBalancingV2Client(assumedClientConfig),
      logs: new CloudWatchLogsClient(assumedClientConfig),
      efs: new EFSClient(assumedClientConfig),
      ssm: new SSMClient(assumedClientConfig),
      eventBridge: new EventBridgeClient(assumedClientConfig),
      accountId,
      baseAccountId,
      assumedRoleArn: roleArn,
    };
  }

  return {
    cfn: new CloudFormationClient(clientConfig),
    ecs: new ECSClient(clientConfig),
    asg: new AutoScalingClient(clientConfig),
    ec2: new EC2Client(clientConfig),
    elbv2: new ElasticLoadBalancingV2Client(clientConfig),
    logs: new CloudWatchLogsClient(clientConfig),
    efs: new EFSClient(clientConfig),
    ssm: new SSMClient(clientConfig),
    eventBridge: new EventBridgeClient(clientConfig),
    accountId: baseAccountId,
    baseAccountId,
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
      switch (output.OutputKey) {
        case "ClusterName":
          outputs.clusterName = output.OutputValue;
          break;
        case "AutoScalingGroupName":
          outputs.autoScalingGroupName = output.OutputValue;
          break;
        case "LoadBalancerDns":
          outputs.loadBalancerDns = output.OutputValue;
          break;
        case "ListenerArn":
          outputs.listenerArn = output.OutputValue;
          break;
        case "PrometheusUrl":
          outputs.prometheusUrl = output.OutputValue;
          break;
        case "GrafanaUrl":
          outputs.grafanaUrl = output.OutputValue;
          break;
        case "TaskLogGroupName":
          outputs.taskLogGroupName = output.OutputValue;
          break;
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

async function getEcsCluster(
  ecsClient: ECSClient,
  clusterName: string
): Promise<any> {
  try {
    const command = new DescribeClustersCommand({
      clusters: [clusterName],
    });

    const response = await ecsClient.send(command);
    return response.clusters?.[0];
  } catch {
    return null;
  }
}

async function getAutoScalingGroup(
  asgClient: AutoScalingClient,
  asgName: string
): Promise<any> {
  try {
    const command = new DescribeAutoScalingGroupsCommand({
      AutoScalingGroupNames: [asgName],
    });

    const response = await asgClient.send(command);
    return response.AutoScalingGroups?.[0];
  } catch {
    return null;
  }
}

async function getInstanceHealth(
  ec2Client: EC2Client,
  instanceIds: string[]
): Promise<{ healthy: number; unhealthy: number }> {
  if (instanceIds.length === 0) {
    return { healthy: 0, unhealthy: 0 };
  }

  try {
    const command = new DescribeInstanceStatusCommand({
      InstanceIds: instanceIds,
    });

    const response = await ec2Client.send(command);
    const statuses = response.InstanceStatuses || [];

    let healthy = 0;
    let unhealthy = 0;

    statuses.forEach((status) => {
      if (status.InstanceStatus?.Status === "ok") {
        healthy++;
      } else {
        unhealthy++;
      }
    });

    return { healthy, unhealthy };
  } catch {
    return { healthy: 0, unhealthy: instanceIds.length };
  }
}

async function getLoadBalancer(
  elbv2Client: ElasticLoadBalancingV2Client,
  dnsName: string | undefined
): Promise<any> {
  if (!dnsName) {
    return null;
  }

  try {
    const command = new DescribeLoadBalancersCommand({});

    const response = await elbv2Client.send(command);
    return response.LoadBalancers?.find((lb: any) => lb.DNSName === dnsName);
  } catch {
    return null;
  }
}

async function getListener(
  elbv2Client: ElasticLoadBalancingV2Client,
  listenerArn: string
): Promise<any> {
  try {
    const command = new DescribeListenersCommand({
      ListenerArns: [listenerArn],
    });

    const response = await elbv2Client.send(command);
    return response.Listeners?.[0];
  } catch {
    return null;
  }
}

async function getTargetGroups(
  elbv2Client: ElasticLoadBalancingV2Client,
  loadBalancerArn: string
): Promise<any[]> {
  try {
    const command = new DescribeTargetGroupsCommand({
      LoadBalancerArn: loadBalancerArn,
    });

    const response = await elbv2Client.send(command);
    return response.TargetGroups || [];
  } catch {
    return [];
  }
}

async function getSecurityGroups(
  cfnClient: CloudFormationClient,
  ec2Client: EC2Client,
  stackName: string
): Promise<any[]> {
  try {
    const command = new ListStackResourcesCommand({
      StackName: stackName,
    });

    const response = await cfnClient.send(command);
    const sgResources =
      response.StackResourceSummaries?.filter(
        (r) => r.ResourceType === "AWS::EC2::SecurityGroup"
      ) || [];

    if (sgResources.length === 0) {
      return [];
    }

    const sgIds = sgResources
      .map((r) => r.PhysicalResourceId)
      .filter((id): id is string => !!id);

    if (sgIds.length === 0) {
      return [];
    }

    const describeCommand = new DescribeSecurityGroupsCommand({
      GroupIds: sgIds,
    });

    const sgResponse = await ec2Client.send(describeCommand);
    return sgResponse.SecurityGroups || [];
  } catch {
    return [];
  }
}

async function getLogGroup(
  logsClient: CloudWatchLogsClient,
  logGroupNamePrefix: string
): Promise<any> {
  try {
    const command = new DescribeLogGroupsCommand({
      logGroupNamePrefix,
    });

    const response = await logsClient.send(command);
    return response.logGroups?.[0];
  } catch {
    return null;
  }
}

async function getEfsFileSystemId(
  ssmClient: SSMClient,
  environment: string
): Promise<string | undefined> {
  const paths = [
    `/monitoring/${environment}/storage/efs-id`,
    `/monitoring/${environment}/efs/config/file-system-id`,
  ];

  for (const path of paths) {
    try {
      const command = new GetParameterCommand({
        Name: path,
      });

      const response = await ssmClient.send(command);
      if (response.Parameter?.Value) {
        return response.Parameter.Value;
      }
    } catch {
      // Try next path
    }
  }

  return undefined;
}

async function getEfsAvailabilityZone(
  ssmClient: SSMClient,
  environment: string
): Promise<string | undefined> {
  const paths = [
    `/monitoring/${environment}/storage/efs-az`,
    `/monitoring/${environment}/efs/config/availability-zone`,
  ];

  for (const path of paths) {
    try {
      const command = new GetParameterCommand({
        Name: path,
      });

      const response = await ssmClient.send(command);
      if (response.Parameter?.Value) {
        return response.Parameter.Value;
      }
    } catch {
      // Try next path
    }
  }

  return undefined;
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
  } catch {
    return [];
  }
}

async function getSsmAssociations(
  ssmClient: SSMClient,
  stackName: string,
  environment: string
): Promise<any[]> {
  try {
    const command = new ListAssociationsCommand({});

    const response = await ssmClient.send(command);
    const associations = response.Associations || [];

    return associations.filter(
      (assoc) =>
        assoc.AssociationName?.includes(stackName) ||
        assoc.AssociationName?.includes(environment)
    );
  } catch {
    return [];
  }
}

async function getAssociationExecutions(
  ssmClient: SSMClient,
  associationId: string,
  instanceId?: string
): Promise<any[]> {
  try {
    const filters: any[] = [];
    if (instanceId) {
      filters.push({
        Key: "ResourceId",
        Values: [instanceId],
      });
    }

    const command = new DescribeAssociationExecutionsCommand({
      AssociationId: associationId,
      Filters: filters.length > 0 ? filters : undefined,
      MaxResults: 5,
    });

    const response = await ssmClient.send(command);
    return response.AssociationExecutions || [];
  } catch {
    return [];
  }
}

async function checkSsmParameter(
  ssmClient: SSMClient,
  paramName: string
): Promise<{ exists: boolean; value?: string }> {
  try {
    const command = new GetParameterCommand({
      Name: paramName,
    });

    const response = await ssmClient.send(command);
    return {
      exists: true,
      value: response.Parameter?.Value,
    };
  } catch (error: any) {
    if (error.name === "ParameterNotFound") {
      return { exists: false };
    }
    throw error;
  }
}

async function verifyEfsMount(
  ssmClient: SSMClient,
  instanceId: string
): Promise<{
  mounted: boolean;
  directoryStructureOk: boolean;
  output?: string;
}> {
  const commands = [
    'echo "=== Checking EFS Mount ==="',
    'df -h /mnt/efs 2>/dev/null || echo "❌ /mnt/efs not found in df"',
    'echo ""',
    'echo "=== Mount Status ==="',
    'mountpoint -q /mnt/efs && echo "✅ /mnt/efs is a valid mount point" || echo "❌ /mnt/efs is NOT mounted"',
    'echo ""',
    'echo "=== Directory Contents ==="',
    'ls -la /mnt/efs 2>/dev/null || echo "❌ Cannot list /mnt/efs"',
  ];

  try {
    const sendCommand = new SendCommandCommand({
      DocumentName: "AWS-RunShellScript",
      InstanceIds: [instanceId],
      Parameters: {
        commands,
      },
      TimeoutSeconds: 30,
    });

    const sendResponse = await ssmClient.send(sendCommand);
    const commandId = sendResponse.Command?.CommandId;

    if (!commandId) {
      return { mounted: false, directoryStructureOk: false };
    }

    await sleep(5);

    const getCommand = new GetCommandInvocationCommand({
      CommandId: commandId,
      InstanceId: instanceId,
    });

    let getResponse = await ssmClient.send(getCommand);

    if (getResponse.Status === "InProgress") {
      await sleep(3);
      getResponse = await ssmClient.send(getCommand);
    }

    const output = getResponse.StandardOutputContent || "";
    const mounted = output.includes("✅ /mnt/efs is a valid mount point");
    const directoryStructureOk =
      mounted &&
      output.includes("prometheus-data") &&
      output.includes("grafana-data") &&
      output.includes("config");

    return {
      mounted,
      directoryStructureOk,
      output,
    };
  } catch {
    return { mounted: false, directoryStructureOk: false };
  }
}

async function checkAlbHealth(dnsName: string): Promise<{
  reachable: boolean;
  httpCode?: number;
}> {
  return new Promise((resolve) => {
    const url = `http://${dnsName}`;
    const req = http.get(url, { timeout: 5000 }, (res: any) => {
      resolve({
        reachable: true,
        httpCode: res.statusCode,
      });
    });

    req.on("error", () => {
      resolve({ reachable: false });
    });

    req.on("timeout", () => {
      req.destroy();
      resolve({ reachable: false });
    });
  });
}

async function verifyInfraStack(config: VerifyInfraStackConfig): Promise<{
  checks: CheckCounts;
  state: VerificationState;
}> {
  Logger.section(`MonitoringInfra Stack Verification - ${config.environment}`);

  const checks: CheckCounts = {
    total: 0,
    passed: 0,
    failed: 0,
    warnings: 0,
  };

  const state: VerificationState = {
    registeredInstances: 0,
    instanceIds: [],
    healthyInstances: 0,
    mountTargetCount: 0,
    efsMountedOnAllInstances: false,
    efsDirectoryStructureVerified: false,
    totalParamsFound: 0,
    totalParamsExpected: 12,
    readinessIssues: 0,
  };

  const stackName = `${config.environment}-MonitoringInfra`;
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
    ecs: ecsClient,
    asg: asgClient,
    ec2: ec2Client,
    elbv2: elbv2Client,
    logs: logsClient,
    efs: efsClient,
    ssm: ssmClient,
    eventBridge: eventBridgeClient,
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

  // 1. CloudFormation Stack
  Logger.subsection("1. CloudFormation Stack Status");
  const stackInfo = await getStackStatus(cfnClient, stackName);

  if (!stackInfo) {
    Logger.error("Stack does not exist");
    checks.total++;
    checks.failed++;
    return { checks, state };
  }

  state.stackStatus = stackInfo.status;
  checks.total++;

  if (
    stackInfo.status === "CREATE_COMPLETE" ||
    stackInfo.status === "UPDATE_COMPLETE"
  ) {
    Logger.success(`Stack Status: ${stackInfo.status}`);
    checks.passed++;
  } else {
    Logger.warning(
      `Stack Status: ${stackInfo.status} (deployment may be in progress)`
    );
    checks.warnings++;
  }

  if (config.verbose) {
    Logger.info("Retrieving stack outputs...");
  }

  const outputTable = [];
  if (stackInfo.outputs.clusterName) {
    outputTable.push({
      Key: "ClusterName",
      Value: stackInfo.outputs.clusterName,
    });
  }
  if (stackInfo.outputs.autoScalingGroupName) {
    outputTable.push({
      Key: "AutoScalingGroupName",
      Value: stackInfo.outputs.autoScalingGroupName,
    });
  }
  if (stackInfo.outputs.loadBalancerDns) {
    outputTable.push({
      Key: "LoadBalancerDns",
      Value: stackInfo.outputs.loadBalancerDns,
    });
  }
  if (stackInfo.outputs.listenerArn) {
    outputTable.push({
      Key: "ListenerArn",
      Value: stackInfo.outputs.listenerArn,
    });
  }

  formatTable(outputTable);
  console.log("");

  // 2. ECS Cluster
  Logger.subsection("2. ECS Cluster");
  if (!stackInfo.outputs.clusterName) {
    Logger.error("Cluster not found in stack outputs");
    checks.total++;
    checks.failed++;
  } else {
    state.clusterName = stackInfo.outputs.clusterName;
    checks.total++;
    Logger.success(`Cluster Name: ${stackInfo.outputs.clusterName}`);

    const cluster = await getEcsCluster(
      ecsClient,
      stackInfo.outputs.clusterName
    );

    if (!cluster) {
      Logger.error("Cluster not found");
      checks.total++;
      checks.failed++;
    } else {
      state.clusterStatus = cluster.status;
      checks.total++;

      if (cluster.status === "ACTIVE") {
        Logger.success(`Cluster Status: ${cluster.status}`);
        checks.passed++;
      } else {
        Logger.error(`Cluster Status: ${cluster.status}`);
        checks.failed++;
      }

      state.registeredInstances =
        cluster.registeredContainerInstancesCount || 0;
      checks.total++;

      if (state.registeredInstances > 0) {
        Logger.success(
          `Registered Container Instances: ${state.registeredInstances}`
        );
        checks.passed++;
      } else {
        Logger.warning(
          "Registered Container Instances: 0 (instances may still be bootstrapping)"
        );
        checks.warnings++;
      }

      const runningTasks = cluster.runningTasksCount || 0;
      Logger.info(
        `Running Tasks: ${runningTasks} (tasks deployed in ServiceStack)`
      );

      const containerInsights =
        cluster.settings?.find((s: any) => s.name === "containerInsights")
          ?.value || "disabled";
      checks.total++;

      if (containerInsights === "enabled") {
        Logger.success("Container Insights: enabled");
        checks.passed++;
      } else {
        Logger.warning("Container Insights: disabled");
        checks.warnings++;
      }
    }
  }

  console.log("");

  // 3. Auto Scaling Group & EC2 Instances
  Logger.subsection("3. Auto Scaling Group & EC2 Instances");
  if (!stackInfo.outputs.autoScalingGroupName) {
    Logger.error("ASG not found in stack outputs");
    checks.total++;
    checks.failed++;
  } else {
    state.asgName = stackInfo.outputs.autoScalingGroupName;
    checks.total++;
    Logger.success(`ASG Name: ${stackInfo.outputs.autoScalingGroupName}`);

    const asg = await getAutoScalingGroup(
      asgClient,
      stackInfo.outputs.autoScalingGroupName
    );

    if (!asg) {
      Logger.error("ASG not found");
      checks.total++;
      checks.failed++;
    } else {
      const minSize = asg.MinSize || 0;
      const maxSize = asg.MaxSize || 0;
      const desiredCapacity = asg.DesiredCapacity || 0;

      checks.total++;
      Logger.success(
        `Capacity: Min=${minSize}, Max=${maxSize}, Desired=${desiredCapacity}`
      );
      checks.passed++;

      state.instanceIds =
        asg.Instances?.map((inst: any) => inst.InstanceId || "").filter(
          (id: string) => id !== ""
        ) || [];

      checks.total++;

      if (state.instanceIds.length > 0) {
        Logger.success(`EC2 Instances: ${state.instanceIds.length}`);
        checks.passed++;

        const health = await getInstanceHealth(ec2Client, state.instanceIds);
        state.healthyInstances = health.healthy;

        checks.total++;

        if (health.unhealthy === 0) {
          Logger.success(
            `Instance Health: ${health.healthy}/${state.instanceIds.length} healthy`
          );
          checks.passed++;
        } else {
          Logger.warning(
            `Instance Health: ${health.healthy}/${state.instanceIds.length} healthy, ${health.unhealthy} unhealthy`
          );
          checks.warnings++;
        }

        if (config.verbose) {
          state.instanceIds.forEach((id) => {
            Logger.info(`Instance ${id}: health checked`);
          });
        }
      } else {
        Logger.warning("No EC2 instances found (ASG may be scaling up)");
        checks.warnings++;
      }
    }
  }

  console.log("");

  // 4. Application Load Balancer
  Logger.subsection("4. Application Load Balancer");
  if (!stackInfo.outputs.loadBalancerDns) {
    Logger.error("ALB DNS not found in stack outputs");
    checks.total++;
    checks.failed++;
  } else {
    state.albDns = stackInfo.outputs.loadBalancerDns;
    checks.total++;
    Logger.success(`ALB DNS: ${stackInfo.outputs.loadBalancerDns}`);

    const alb = await getLoadBalancer(
      elbv2Client,
      stackInfo.outputs.loadBalancerDns
    );

    if (alb) {
      state.albArn = alb.LoadBalancerArn;
      state.albState = alb.State?.Code;

      checks.total++;

      if (alb.State?.Code === "active") {
        Logger.success(`ALB State: ${alb.State.Code}`);
        checks.passed++;
      } else {
        Logger.warning(`ALB State: ${alb.State?.Code || "unknown"}`);
        checks.warnings++;
      }

      Logger.info(`ALB Scheme: ${alb.Scheme || "unknown"}`);
    }

    if (stackInfo.outputs.prometheusUrl) {
      Logger.info(`Prometheus URL: ${stackInfo.outputs.prometheusUrl}`);
    }

    if (stackInfo.outputs.grafanaUrl) {
      Logger.info(`Grafana URL: ${stackInfo.outputs.grafanaUrl}`);
    }
  }

  console.log("");

  // 5. ALB Listener & Target Groups
  Logger.subsection("5. ALB Listener & Target Groups");
  if (!stackInfo.outputs.listenerArn) {
    Logger.error("Listener ARN not found in stack outputs");
    checks.total++;
    checks.failed++;
  } else {
    state.listenerArn = stackInfo.outputs.listenerArn;
    checks.total++;
    Logger.success("Listener ARN exists");

    const listener = await getListener(
      elbv2Client,
      stackInfo.outputs.listenerArn
    );

    if (listener) {
      Logger.info(`Listener Protocol: ${listener.Protocol || "unknown"}`);
    }

    if (state.albArn) {
      const targetGroups = await getTargetGroups(elbv2Client, state.albArn);

      if (targetGroups.length > 0) {
        checks.total++;
        Logger.success(
          `Target Groups: ${targetGroups.length} (created by ServiceStack)`
        );
        checks.passed++;

        if (config.verbose) {
          targetGroups.forEach((tg) => {
            Logger.info(`Target Group: ${tg.TargetGroupName}`);
          });
        }
      } else {
        Logger.info("Target Groups: 0 (created when ServiceStack is deployed)");
      }
    }
  }

  console.log("");

  // 6. Security Groups
  Logger.subsection("6. Security Groups");
  const securityGroups = await getSecurityGroups(
    cfnClient,
    ec2Client,
    stackName
  );

  checks.total++;

  if (securityGroups.length > 0) {
    Logger.success(`Security Groups: ${securityGroups.length}`);
    checks.passed++;

    if (config.verbose) {
      securityGroups.forEach((sg) => {
        const ingressRules = sg.IpPermissions?.length || 0;
        Logger.info(
          `Security Group: ${sg.GroupName} (${sg.GroupId}) - ${ingressRules} ingress rules`
        );
      });
    }
  } else {
    Logger.warning("No security groups found in stack");
    checks.warnings++;
  }

  console.log("");

  // 7. CloudWatch Log Groups
  Logger.subsection("7. CloudWatch Log Groups");
  if (stackInfo.outputs.taskLogGroupName) {
    const taskLogGroup = await getLogGroup(
      logsClient,
      stackInfo.outputs.taskLogGroupName
    );

    if (taskLogGroup) {
      checks.total++;
      Logger.success(`Task Log Group: ${stackInfo.outputs.taskLogGroupName}`);
      checks.passed++;

      const retention = taskLogGroup.retentionInDays
        ? `${taskLogGroup.retentionInDays} days`
        : "Never";
      Logger.info(`Retention: ${retention}`);
    } else {
      checks.total++;
      Logger.error(
        `Task Log Group not found: ${stackInfo.outputs.taskLogGroupName}`
      );
      checks.failed++;
    }
  } else {
    Logger.warning("Task Log Group name not in stack outputs");
    checks.warnings++;
  }

  const eventLogGroupName = `/ecs/${stackName}/events`;
  const eventLogGroup = await getLogGroup(logsClient, eventLogGroupName);

  checks.total++;

  if (eventLogGroup) {
    Logger.success(`Event Log Group: ${eventLogGroupName}`);
    checks.passed++;
  } else {
    Logger.warning(`Event Log Group not found: ${eventLogGroupName}`);
    checks.warnings++;
  }

  console.log("");

  // 8. EFS Mount Target & Subnet Verification
  Logger.subsection("8. EFS Mount Target & Subnet Verification");
  state.efsFileSystemId = await getEfsFileSystemId(
    ssmClient,
    config.environment
  );

  if (!state.efsFileSystemId) {
    Logger.warning("EFS File System ID not found in SSM parameters");
    checks.warnings++;
  } else {
    checks.total++;
    Logger.success(`EFS File System ID: ${state.efsFileSystemId}`);
    checks.passed++;

    state.efsAz = await getEfsAvailabilityZone(ssmClient, config.environment);

    if (state.efsAz) {
      checks.total++;
      Logger.success(`EFS Availability Zone: ${state.efsAz}`);
      checks.passed++;
    }

    const mountTargets = await getMountTargets(
      efsClient,
      state.efsFileSystemId
    );
    state.mountTargetCount = mountTargets.length;

    checks.total++;

    if (mountTargets.length > 0) {
      Logger.success(`EFS Mount Targets: ${mountTargets.length}`);
      checks.passed++;

      if (state.asgName && state.instanceIds.length > 0) {
        const asg = await getAutoScalingGroup(asgClient, state.asgName);
        const instanceAzs = new Set(
          asg?.Instances?.map((inst: any) => inst.AvailabilityZone).filter(
            (az: any): az is string => !!az
          ) || []
        );

        instanceAzs.forEach((az) => {
          const mtInAz = mountTargets.find(
            (mt) => mt.AvailabilityZoneName === az
          );

          checks.total++;

          if (mtInAz) {
            Logger.success(`EFS mount target exists in instance AZ: ${az}`);
            checks.passed++;

            if (config.verbose) {
              Logger.info(`Mount target ${mtInAz.MountTargetId} in ${az}`);
            }
          } else {
            Logger.warning(
              `No EFS mount target in instance AZ: ${az} (cross-AZ data transfer charges may apply)`
            );
            checks.warnings++;
          }
        });

        const activeMountTargets = mountTargets.filter(
          (mt) => mt.LifeCycleState === "available"
        ).length;

        checks.total++;

        if (activeMountTargets === mountTargets.length) {
          Logger.success(
            `All mount targets are available (${activeMountTargets}/${mountTargets.length})`
          );
          checks.passed++;
        } else {
          Logger.warning(
            `Not all mount targets are available (${activeMountTargets}/${mountTargets.length} active)`
          );
          checks.warnings++;
        }
      }
    } else {
      Logger.error(`No EFS mount targets found for ${state.efsFileSystemId}`);
      checks.failed++;
    }
  }

  console.log("");

  // 9. SSM State Manager Associations
  Logger.subsection("9. SSM State Manager Associations");
  const associations = await getSsmAssociations(
    ssmClient,
    stackName,
    config.environment
  );

  checks.total++;

  if (associations.length > 0) {
    Logger.success(`SSM Associations found: ${associations.length}`);
    checks.passed++;

    associations.forEach((assoc) => {
      Logger.info(
        `   - ${assoc.AssociationName} (${assoc.Name}): ${
          assoc.Overview?.Status || "Unknown"
        }`
      );
    });

    console.log("");

    // Find critical associations
    const efsMountAssoc = associations.find((a) =>
      a.AssociationName?.includes("efs-mount")
    );
    const efsInitAssoc = associations.find((a) =>
      a.AssociationName?.includes("efs-init")
    );
    const ecsAgentAssoc = associations.find((a) =>
      a.AssociationName?.includes("ecs-agent-config")
    );
    const cloudwatchInstallAssoc = associations.find((a) =>
      a.AssociationName?.includes("cloudwatch-agent-install")
    );
    const cloudwatchConfigAssoc = associations.find((a) =>
      a.AssociationName?.includes("cloudwatch-agent-config")
    );

    // EFS Mount Association
    if (efsMountAssoc) {
      state.efsMountAssocId = efsMountAssoc.AssociationId;
      state.efsMountStatus = efsMountAssoc.Overview?.Status;

      checks.total++;

      if (state.efsMountStatus === "Success") {
        Logger.success(`EFS Mount Association: ${state.efsMountStatus}`);
        checks.passed++;

        if (state.instanceIds.length > 0) {
          let successfulMounts = 0;

          for (const instanceId of state.instanceIds) {
            if (!efsMountAssoc.AssociationId) continue;
            const executions = await getAssociationExecutions(
              ssmClient,
              efsMountAssoc.AssociationId,
              instanceId
            );

            const latestExecution = executions[0];
            if (latestExecution?.Status === "Success") {
              successfulMounts++;
            }

            if (config.verbose) {
              Logger.info(
                `EFS mount on ${instanceId}: ${
                  latestExecution?.Status || "Unknown"
                }`
              );
            }
          }

          checks.total++;

          if (successfulMounts === state.instanceIds.length) {
            Logger.success(
              `EFS mounted on all instances (${successfulMounts}/${state.instanceIds.length})`
            );
            state.efsMountedOnAllInstances = true;
            checks.passed++;
          } else {
            Logger.warning(
              `EFS mounted on ${successfulMounts}/${state.instanceIds.length} instances`
            );
            checks.warnings++;
          }
        }
      } else {
        Logger.error(
          `EFS Mount Association: ${state.efsMountStatus} (CRITICAL for service deployment)`
        );
        checks.failed++;
      }
    } else {
      Logger.error(
        "EFS Mount Association not found (REQUIRED for service stack)"
      );
      checks.total++;
      checks.failed++;
    }

    // EFS Initialization Association
    if (efsInitAssoc) {
      state.efsInitAssocId = efsInitAssoc.AssociationId;
      state.efsInitStatus = efsInitAssoc.Overview?.Status;

      checks.total++;

      if (state.efsInitStatus === "Success") {
        Logger.success(
          `EFS Initialization Association: ${state.efsInitStatus}`
        );
        checks.passed++;

        if (state.instanceIds.length > 0) {
          const firstInstance = state.instanceIds[0];
          const mountCheck = await verifyEfsMount(ssmClient, firstInstance);

          if (mountCheck.mounted && mountCheck.directoryStructureOk) {
            checks.total++;
            Logger.success(
              `EFS directory structure verified on instance ${firstInstance}`
            );
            state.efsDirectoryStructureVerified = true;
            checks.passed++;

            if (mountCheck.output) {
              if (mountCheck.output.includes("prometheus-data")) {
                Logger.info("      ├─ prometheus-data/ exists");
              } else {
                Logger.warning("prometheus-data/ directory not found");
              }

              if (mountCheck.output.includes("grafana-data")) {
                Logger.info("      ├─ grafana-data/ exists");
              } else {
                Logger.warning("grafana-data/ directory not found");
              }

              if (mountCheck.output.includes("config")) {
                Logger.info("      └─ config/ exists");
              } else {
                Logger.warning("config/ directory not found");
              }
            }
          } else {
            Logger.warning(
              "EFS directory structure verification failed (run initialization manually if needed)"
            );
            checks.warnings++;
          }
        }
      } else {
        Logger.error(
          `EFS Initialization Association: ${state.efsInitStatus} (CRITICAL for service deployment)`
        );
        checks.failed++;
      }
    } else {
      Logger.error(
        "EFS Initialization Association not found (REQUIRED for service stack)"
      );
      checks.total++;
      checks.failed++;
    }

    // ECS Agent Configuration
    if (ecsAgentAssoc) {
      const ecsAgentStatus = ecsAgentAssoc.Overview?.Status;
      checks.total++;

      if (ecsAgentStatus === "Success") {
        Logger.success(`ECS Agent Configuration: ${ecsAgentStatus}`);
        checks.passed++;
      } else {
        Logger.warning(
          `ECS Agent Configuration: ${ecsAgentStatus} (may still be running first time)`
        );
        checks.warnings++;
      }
    } else {
      Logger.warning("ECS Agent Configuration association not found");
      checks.warnings++;
    }

    // CloudWatch Agent Installation
    if (cloudwatchInstallAssoc) {
      const cloudwatchInstallStatus = cloudwatchInstallAssoc.Overview?.Status;
      checks.total++;

      if (cloudwatchInstallStatus === "Success") {
        Logger.success(
          `CloudWatch Agent Installation: ${cloudwatchInstallStatus}`
        );
        checks.passed++;
      } else {
        Logger.warning(
          `CloudWatch Agent Installation: ${cloudwatchInstallStatus}`
        );
        checks.warnings++;
      }
    } else {
      Logger.warning("CloudWatch Agent Installation association not found");
      checks.warnings++;
    }

    // CloudWatch Agent Configuration
    if (cloudwatchConfigAssoc) {
      const cloudwatchConfigStatus = cloudwatchConfigAssoc.Overview?.Status;
      checks.total++;

      if (cloudwatchConfigStatus === "Success") {
        Logger.success(
          `CloudWatch Agent Configuration: ${cloudwatchConfigStatus}`
        );
        checks.passed++;
      } else {
        Logger.warning(
          `CloudWatch Agent Configuration: ${cloudwatchConfigStatus}`
        );
        checks.warnings++;
      }
    } else {
      Logger.warning("CloudWatch Agent Configuration association not found");
      checks.warnings++;
    }

    if (config.verbose) {
      const criticalAssocs = [
        efsMountAssoc,
        efsInitAssoc,
        ecsAgentAssoc,
      ].filter((a) => !!a);

      for (const assoc of criticalAssocs) {
        if (!assoc?.AssociationId) continue;

        const failures = await getAssociationExecutions(
          ssmClient,
          assoc.AssociationId
        );

        const failedExecutions = failures.filter(
          (exec) => exec.Status === "Failed"
        );

        if (failedExecutions.length > 0) {
          console.log("");
          Logger.info(`Recent failures for ${assoc.AssociationName}:`);
          failedExecutions.slice(0, 3).forEach((exec) => {
            Logger.info(
              `     - ${exec.ExecutionId}: ${exec.ResourceId} - ${exec.Status}`
            );
          });
        }
      }
    }
  } else {
    Logger.warning(
      "No SSM State Manager associations found (instances may be bootstrapping)"
    );
    checks.warnings++;
  }

  console.log("");

  // 10. SSM Parameters
  Logger.subsection("10. SSM Parameters (Infrastructure Discovery)");

  const infraParamPrefix = `${paramPrefix}/infra/config`;
  let infraFound = 0;

  console.log("Infrastructure Parameters:");
  for (const param of INFRA_PARAMS) {
    const paramName = `${infraParamPrefix}/${param}`;
    const result = await checkSsmParameter(ssmClient, paramName);

    checks.total++;

    if (result.exists) {
      Logger.success(`${paramName}: ${result.value || "N/A"}`);
      infraFound++;
      checks.passed++;
    } else {
      Logger.error(`${paramName}: NOT FOUND (REQUIRED)`);
      checks.failed++;
    }
  }

  console.log("");
  console.log("Storage Parameters (from EFS Stack):");

  let storageFound = 0;

  for (let i = 0; i < STORAGE_PARAMS_EFS.length; i++) {
    const efsParam = `${paramPrefix}/efs/config/${STORAGE_PARAMS_EFS[i]}`;
    const legacyParam = `${paramPrefix}/storage/${STORAGE_PARAMS_LEGACY[i]}`;

    let result = await checkSsmParameter(ssmClient, efsParam);

    if (!result.exists) {
      result = await checkSsmParameter(ssmClient, legacyParam);
      if (result.exists) {
        checks.total++;
        Logger.success(
          `${legacyParam}: ${result.value || "N/A"} (legacy path)`
        );
        storageFound++;
        checks.passed++;
      } else {
        checks.total++;
        Logger.error(`${efsParam} or ${legacyParam}: NOT FOUND (REQUIRED)`);
        checks.failed++;
      }
    } else {
      checks.total++;
      Logger.success(`${efsParam}: ${result.value || "N/A"}`);
      storageFound++;
      checks.passed++;
    }
  }

  console.log("");
  console.log("Configuration Parameters:");

  let configFound = 0;

  for (const param of CONFIG_PARAMS) {
    const paramName = `${paramPrefix}/${param}`;
    const result = await checkSsmParameter(ssmClient, paramName);

    checks.total++;

    if (result.exists) {
      Logger.success(`${paramName}: EXISTS`);
      configFound++;
      checks.passed++;
    } else {
      Logger.error(`${paramName}: NOT FOUND (REQUIRED)`);
      checks.failed++;
    }
  }

  console.log("");

  state.totalParamsFound = infraFound + storageFound + configFound;
  state.totalParamsExpected =
    INFRA_PARAMS.length + STORAGE_PARAMS_EFS.length + CONFIG_PARAMS.length;

  checks.total++;

  if (state.totalParamsFound === state.totalParamsExpected) {
    Logger.success(
      `All SSM parameters found (${state.totalParamsFound}/${state.totalParamsExpected})`
    );
    checks.passed++;
  } else {
    Logger.warning(
      `SSM parameters: ${state.totalParamsFound}/${state.totalParamsExpected} found`
    );
    checks.warnings++;
  }

  console.log("");

  // 11. EventBridge Rules
  Logger.subsection("11. EventBridge Rules");

  try {
    const command = new ListRulesCommand({});

    const response = await eventBridgeClient.send(command);
    const rules =
      response.Rules?.filter((rule: any) =>
        rule.Description?.includes(config.environment)
      ) || [];

    checks.total++;

    if (rules.length > 0) {
      Logger.success(`EventBridge Rules: ${rules.length}`);
      checks.passed++;

      rules.forEach((rule: any) => {
        Logger.info(`   - ${rule.Name}: ${rule.State || "UNKNOWN"}`);
      });
    } else {
      Logger.warning(`No EventBridge rules found for ${config.environment}`);
      checks.warnings++;
    }
  } catch {
    Logger.warning("Could not retrieve EventBridge rules");
    checks.warnings++;
  }

  console.log("");

  // 12. Bootstrap Metadata
  Logger.subsection("12. Bootstrap Metadata");

  const metadataPrefix = `/bootstrap/${config.environment}/instances`;

  try {
    const command = new GetParametersByPathCommand({
      Path: metadataPrefix,
    });

    const response = await ssmClient.send(command);
    const metadataParams = response.Parameters || [];

    checks.total++;

    if (metadataParams.length > 0) {
      Logger.success(
        `Bootstrap Metadata: ${metadataParams.length} instances tracked`
      );
      checks.passed++;

      if (config.verbose && metadataParams.length > 0) {
        const sampleParam = metadataParams[0];
        Logger.info(`Sample metadata from: ${sampleParam.Name}`);
        if (sampleParam.Value) {
          try {
            const metadata = JSON.parse(sampleParam.Value);
            console.log(JSON.stringify(metadata, null, 2));
          } catch {
            console.log(sampleParam.Value);
          }
        }
      }
    } else {
      Logger.info("Bootstrap Metadata: None found (feature may be disabled)");
    }
  } catch {
    Logger.info("Bootstrap Metadata: None found (feature may be disabled)");
  }

  console.log("");

  // 13. Actual EFS Mount Verification
  Logger.subsection("13. Actual EFS Mount Verification");
  Logger.info(
    "This section runs actual SSM commands to verify EFS is mounted."
  );
  console.log("");

  if (state.asgName && state.instanceIds.length > 0) {
    const asg = await getAutoScalingGroup(asgClient, state.asgName);
    const inServiceInstances =
      asg?.Instances?.filter(
        (inst: any) => inst.LifecycleState === "InService"
      ) || [];

    if (inServiceInstances.length > 0) {
      const firstInstance = inServiceInstances[0].InstanceId;

      if (firstInstance) {
        Logger.info(`Testing EFS mount on instance: ${firstInstance}`);
        console.log("");

        const mountCheck = await verifyEfsMount(ssmClient, firstInstance);

        if (mountCheck.output) {
          console.log("   Command Output:");
          console.log("   ────────────────────────────────────────");
          mountCheck.output
            .split("\n")
            .forEach((line) => console.log(`   ${line}`));
          console.log("   ────────────────────────────────────────");
          console.log("");

          checks.total++;

          if (mountCheck.mounted) {
            Logger.success("EFS is mounted at /mnt/efs");
            checks.passed++;

            if (mountCheck.output.includes("prometheus-data")) {
              Logger.info("      ├─ prometheus-data/ exists");
            } else {
              Logger.warning("prometheus-data/ directory not found");
            }

            if (mountCheck.output.includes("grafana-data")) {
              Logger.info("      ├─ grafana-data/ exists");
            } else {
              Logger.warning("grafana-data/ directory not found");
            }

            if (mountCheck.output.includes("config")) {
              Logger.info("      └─ config/ exists");
            } else {
              Logger.warning("config/ directory not found");
            }
          } else {
            Logger.error("EFS is NOT mounted at /mnt/efs");
            checks.failed++;
          }
        } else {
          Logger.warning("Could not get command output");
          checks.warnings++;
        }

        console.log("");
        Logger.info("To manually verify EFS mount on any instance, run:");
        Logger.code(
          `aws ssm send-command --instance-ids "${firstInstance}" --document-name "AWS-RunShellScript" --parameters 'commands=["df -h /mnt/efs && ls -la /mnt/efs"]' --profile ${
            config.profile || "default"
          } --region ${config.region}`
        );
      } else {
        Logger.warning("No running instances found in Auto Scaling Group");
        Logger.info("Cannot verify EFS mount without running instances");
      }
    } else {
      Logger.warning("No InService instances found");
    }
  } else {
    Logger.warning("Auto Scaling Group name not available");
    Logger.info("Skipping actual EFS mount verification");
  }

  console.log("");

  // 14. ALB Health Check
  Logger.subsection("14. ALB Health Check");

  if (state.albDns) {
    const healthCheck = await checkAlbHealth(state.albDns);

    checks.total++;

    if (
      healthCheck.reachable &&
      healthCheck.httpCode &&
      [200, 404, 503].includes(healthCheck.httpCode)
    ) {
      Logger.success(`ALB HTTP Reachable (HTTP ${healthCheck.httpCode})`);
      checks.passed++;

      if (healthCheck.httpCode === 503) {
        Logger.info(
          "Note: HTTP 503 is normal when no services are deployed yet"
        );
      }
    } else {
      Logger.warning(
        `ALB HTTP Response: ${
          healthCheck.httpCode || "unknown"
        } (may be behind firewall)`
      );
      checks.warnings++;
    }
  } else {
    Logger.info("Skipping health check (ALB DNS not available)");
  }

  console.log("");

  // 15. Service Stack Deployment Readiness
  Logger.subsection("15. Service Stack Deployment Readiness");
  console.log(
    "Checking prerequisites for MonitoringServiceStack deployment..."
  );
  console.log("");

  // Critical: EFS must be mounted and initialized
  if (state.asgName && state.registeredInstances > 0) {
    if (state.efsMountStatus === "Success") {
      Logger.success("EFS mount verified (via SSM Association)");
      checks.passed++;
    } else if (!state.efsMountAssocId) {
      Logger.warning("EFS mount association not found (may still be mounted)");
      Logger.info(
        "Run manual verification: aws ssm send-command to check /mnt/efs"
      );
      checks.warnings++;
    } else {
      Logger.warning(
        `EFS mount association status: ${state.efsMountStatus || "Pending"}`
      );
      Logger.info(
        "This may be normal - check actual mount status in section 13 above"
      );
      checks.warnings++;
    }

    if (state.efsInitStatus === "Success") {
      Logger.success("EFS initialization verified (via SSM Association)");
      checks.passed++;
    } else if (!state.efsInitAssocId) {
      Logger.warning(
        "EFS initialization association not found (may still be initialized)"
      );
      Logger.info("Check if config/ directories exist in section 13 above");
      checks.warnings++;
    } else {
      Logger.warning(
        `EFS initialization association status: ${
          state.efsInitStatus || "Pending"
        }`
      );
      Logger.info(
        "This may be normal - check directory structure in section 13 above"
      );
      checks.warnings++;
    }
  } else {
    Logger.error("CRITICAL: No instances available to verify EFS mount");
    state.readinessIssues++;
    checks.failed++;
  }

  // Critical: ECS cluster must be active with registered instances
  if (state.clusterStatus !== "ACTIVE") {
    Logger.error("CRITICAL: ECS cluster not active");
    state.readinessIssues++;
    checks.failed++;
  } else if (state.registeredInstances === 0) {
    Logger.error("CRITICAL: No container instances registered in ECS cluster");
    state.readinessIssues++;
    checks.failed++;
  } else {
    Logger.success(
      `ECS cluster active with ${state.registeredInstances} registered instances`
    );
    checks.passed++;
  }

  // Critical: ALB must be active
  if (state.albState !== "active") {
    Logger.error("CRITICAL: ALB not active");
    state.readinessIssues++;
    checks.failed++;
  } else {
    Logger.success("Application Load Balancer is active");
    checks.passed++;
  }

  // Critical: ALB listener must exist
  if (!state.listenerArn) {
    Logger.error("CRITICAL: ALB listener not configured");
    state.readinessIssues++;
    checks.failed++;
  } else {
    Logger.success("ALB listener configured");
    checks.passed++;
  }

  // Critical: All required SSM parameters must exist
  if (state.totalParamsFound < state.totalParamsExpected) {
    Logger.error(
      `CRITICAL: Missing required SSM parameters (${state.totalParamsFound}/${state.totalParamsExpected})`
    );
    state.readinessIssues++;
    checks.failed++;
  } else {
    Logger.success("All required SSM parameters present");
    checks.passed++;
  }

  // Important: ECS agent should be configured
  const ecsAgentAssoc = associations.find((a) =>
    a.AssociationName?.includes("ecs-agent-config")
  );
  const ecsAgentStatus = ecsAgentAssoc?.Overview?.Status;

  if (ecsAgentAssoc && ecsAgentStatus === "Success") {
    Logger.success("ECS agent configured on instances");
    checks.passed++;
  } else if (state.registeredInstances > 0) {
    Logger.warning(
      "ECS agent configuration pending (instances registered but association not completed)"
    );
    checks.warnings++;
  } else {
    Logger.warning("ECS agent configuration not yet run");
    checks.warnings++;
  }

  // Optional: CloudWatch agent
  const cloudwatchConfigAssoc = associations.find((a) =>
    a.AssociationName?.includes("cloudwatch-agent-config")
  );
  const cloudwatchConfigStatus = cloudwatchConfigAssoc?.Overview?.Status;

  if (cloudwatchConfigAssoc && cloudwatchConfigStatus === "Success") {
    Logger.info("CloudWatch agent configured (optional)");
  } else {
    Logger.info("CloudWatch agent not configured (optional for logging)");
  }

  console.log("");

  if (state.readinessIssues === 0) {
    Logger.success("INFRASTRUCTURE READY FOR SERVICE DEPLOYMENT");
    console.log("");
    Logger.info(
      "All critical prerequisites are satisfied. You can now deploy the MonitoringServiceStack."
    );
    console.log("");
    Logger.info("Next steps:");
    Logger.info("  1. Deploy service stack:");
    Logger.code(
      `cdk deploy ${config.environment}-MonitoringService --profile ${
        config.profile || "default"
      }`
    );
    console.log("");
    Logger.info("  2. Monitor deployment:");
    if (state.clusterName) {
      Logger.code(
        `aws ecs list-tasks --cluster ${state.clusterName} --profile ${
          config.profile || "default"
        }`
      );
    }
    console.log("");
    Logger.info("  3. Access services:");
    if (state.albDns) {
      Logger.info(`     Grafana:    http://${state.albDns}/grafana`);
      Logger.info(`     Prometheus: http://${state.albDns}/prometheus`);
    }
  } else {
    Logger.error(
      `INFRASTRUCTURE NOT READY (${state.readinessIssues} critical issues)`
    );
    console.log("");
    Logger.info(
      "Resolve the following before deploying MonitoringServiceStack:"
    );
    console.log("");

    if (
      !state.efsMountAssocId &&
      !state.efsInitAssocId &&
      state.totalParamsFound < 4
    ) {
      Logger.warning("EFS Stack Not Detected");
      console.log("");
      Logger.info(
        "It appears the MonitoringEfsStack (storage layer) has not been deployed."
      );
      Logger.info(
        "The MonitoringInfraStack requires the EFS stack to be deployed first."
      );
      console.log("");
      Logger.info("Required deployment order:");
      Logger.info("  1. NetworkingStack (foundation)");
      Logger.info("  2. MonitoringEfsStack (storage) ← DEPLOY THIS FIRST");
      Logger.info("  3. MonitoringInfraStack (compute/networking)");
      Logger.info("  4. MonitoringServiceStack (Prometheus/Grafana)");
      console.log("");
      Logger.info("Deploy the EFS stack with:");
      Logger.code(
        `cdk deploy ${config.environment}-MonitoringEfs --profile ${
          config.profile || "default"
        }`
      );
    } else {
      if (!state.efsMountAssocId || state.efsMountStatus !== "Success") {
        Logger.info("  1. EFS mounting failed or not completed");
        Logger.info("     - Check SSM association execution logs");
        Logger.info(
          "     - Verify EFS security group allows NFS (port 2049) from ECS instances"
        );
        Logger.info("     - Ensure mount targets exist in instance AZs");
        console.log("");
      }

      if (!state.efsInitAssocId || state.efsInitStatus !== "Success") {
        Logger.info("  2. EFS initialization failed");
        Logger.info("     - Check if EFS is mounted: mountpoint -q /mnt/efs");
        Logger.info("     - Verify SSM parameters exist for config files");
        Logger.info("     - Check IAM permissions for SSM parameter access");
        console.log("");
      }

      if (state.registeredInstances === 0) {
        Logger.info("  3. No ECS container instances registered");
        Logger.info("     - Check Auto Scaling Group health");
        Logger.info("     - Review bootstrap logs: /var/log/ecs/ecs-init.log");
        Logger.info(
          "     - Verify ECS agent configuration: systemctl status ecs"
        );
        console.log("");
      }

      if (state.totalParamsFound < state.totalParamsExpected) {
        Logger.info(
          `  4. Missing required SSM parameters (${state.totalParamsFound}/${state.totalParamsExpected})`
        );
        Logger.info(
          "     - Verify MonitoringEfsStack was deployed successfully"
        );
        Logger.info("     - Check CloudFormation exports are present");
        Logger.info("     - Ensure stack didn't partially rollback");
        console.log("");
      }
    }
  }

  return { checks, state };
}

// CLI
program
  .name("verify-infra-stack")
  .description("Verify infrastructure stack deployment and readiness")
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
  .option("-v, --verbose", "Enable verbose output", false)
  .parse();

const options = program.opts();

// Validate environment
if (!VALID_ENVIRONMENTS.includes(options.environment)) {
  Logger.error(`Invalid environment: ${options.environment}`);
  Logger.info(`Valid environments: ${VALID_ENVIRONMENTS.join(", ")}`);
  process.exit(2);
}

const config: VerifyInfraStackConfig = {
  environment: options.environment,
  region: options.region,
  profile: options.profile,
  verbose: options.verbose || false,
};

verifyInfraStack(config)
  .then(({ checks, state }) => {
    Logger.section("VERIFICATION SUMMARY");

    Logger.keyValue("Total Checks", checks.total.toString());
    Logger.keyValue("Passed", checks.passed.toString());

    if (checks.warnings > 0) {
      Logger.warning(`Warnings: ${checks.warnings}`);
    }

    if (checks.failed > 0) {
      Logger.error(`Failed: ${checks.failed}`);
    }

    console.log("");

    if (checks.failed === 0 && state.readinessIssues === 0) {
      Logger.success("ALL CHECKS PASSED - INFRASTRUCTURE READY");
      console.log("");
      Logger.info("Verification Summary:");
      Logger.info("  ✅ CloudFormation stack deployed successfully");
      Logger.info("  ✅ ECS cluster active with container instances");
      Logger.info("  ✅ Auto Scaling Group operational");
      Logger.info("  ✅ Application Load Balancer configured");
      Logger.info("  ✅ EFS mounted and initialized on all instances");
      Logger.info("  ✅ SSM State Manager associations successful");
      Logger.info("  ✅ All required SSM parameters present");
      Logger.info("  ✅ CloudWatch Log Groups created");
      console.log("");
      Logger.info(
        "Infrastructure is ready for MonitoringServiceStack deployment."
      );
      console.log("");
      Logger.info("Deploy services with:");
      Logger.code(
        `cdk deploy ${config.environment}-MonitoringService --profile ${
          config.profile || "default"
        }`
      );
      console.log("");
      process.exit(0);
    } else {
      Logger.error("VERIFICATION FAILED");
      console.log("");

      if (checks.failed > 0) {
        Logger.info(`Infrastructure has ${checks.failed} failed check(s).`);
      }

      if (state.readinessIssues > 0) {
        Logger.info(
          `Infrastructure has ${state.readinessIssues} critical issue(s) preventing service deployment.`
        );
      }

      console.log("");
      Logger.info("Review the output above for detailed diagnostics.");
      console.log("");
      Logger.info("Common troubleshooting steps:");
      console.log("");
      Logger.info("1. Check CloudFormation stack status");
      Logger.info("2. View CloudFormation events for errors");
      Logger.info("3. Check SSM association execution history");
      Logger.info("4. View SSM command output on specific instance");
      Logger.info("5. Check ECS cluster container instances");
      Logger.info("6. Verify EFS mount on instance (via SSM)");
      Logger.info("7. Check Auto Scaling Group health");
      Logger.info("8. Review instance bootstrap logs");
      console.log("");
      Logger.info("For detailed troubleshooting guidance, see:");
      Logger.info("  - docs/TROUBLESHOOTING.md");
      Logger.info("  - bin/README.md (deployment architecture)");
      console.log("");
      process.exit(1);
    }
  })
  .catch((error) => {
    Logger.error(`Verification failed: ${error.message}`);
    process.exit(1);
  });
