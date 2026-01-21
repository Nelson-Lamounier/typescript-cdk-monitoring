#!/usr/bin/env node
/** @format */

// infrastructure/scripts/deployment/monitoring/verify-infra-stack.ts

import * as http from "http";

import { AutoScalingClient } from "@aws-sdk/client-auto-scaling";
import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
import { EC2Client } from "@aws-sdk/client-ec2";
import { ECSClient } from "@aws-sdk/client-ecs";
import { EFSClient } from "@aws-sdk/client-efs";
import { ElasticLoadBalancingV2Client } from "@aws-sdk/client-elastic-load-balancing-v2";
import { EventBridgeClient} from "@aws-sdk/client-eventbridge";
import {
  SSMClient,

  ListAssociationsCommand,
  SendCommandCommand,
  GetCommandInvocationCommand,
} from "@aws-sdk/client-ssm";
import { paginateListStackResources } from "@aws-sdk/client-cloudformation";
import { DescribeSecurityGroupsCommand } from "@aws-sdk/client-ec2";

import { Logger } from "../utils/logger";
import { AwsClientFactory, BaseAwsClients } from "../shared/aws-client-factory";
import {
  CloudFormationUtility,
  SSMUtility,
  EFSUtility,
  EC2Utility,
  ECSUtility,
  ELBUtility,

} from "../shared/aws-utilities";
import {
  VerificationRunner,
  CheckBuilder,
  ReadinessChecker,
} from "../shared/verification-framework";
import { TableFormatter } from "../shared/formatters";
import { CliBuilder } from "../shared/cli-base";

interface InfraStackClients extends BaseAwsClients {
  cfn: any;
  ecs: ECSClient;
  asg: AutoScalingClient;
  ec2: EC2Client;
  elbv2: ElasticLoadBalancingV2Client;
  logs: CloudWatchLogsClient;
  efs: EFSClient;
  ssm: SSMClient;
  eventBridge: EventBridgeClient;
}

interface VerifyInfraStackConfig {
  profile?: string;
  region: string;
  environment: string;
  verbose?: boolean;
  nonBlocking?: boolean;
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

interface InfraStackContext {
  config: VerifyInfraStackConfig;
  clients: InfraStackClients;
  stackName: string;
  paramPrefix: string;
  outputs: StackOutputs;
  cluster?: any;
  asg?: any;
  loadBalancer?: any;
  instanceIds: string[];
  efsFileSystemId?: string;
  efsAz?: string;
}

const INFRA_PARAMS = [
  "cluster-name",
  "cluster-arn",
  "alb-dns",
  "listener-arn",
  "asg-name",
];





const CONFIG_PARAMS = [
  "prometheus-config-yaml",
  "grafana-datasource-config-yaml",
  "grafana-dashboard-config-yaml",
];

function sleep(seconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
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

async function getAutoScalingGroup(
  asgClient: AutoScalingClient,
  asgName: string
): Promise<any> {
  try {
    const { DescribeAutoScalingGroupsCommand } = await import("@aws-sdk/client-auto-scaling");
    const response = await asgClient.send(
      new DescribeAutoScalingGroupsCommand({
        AutoScalingGroupNames: [asgName],
      })
    );
    return response.AutoScalingGroups?.[0];
  } catch {
    return null;
  }
}

async function getSecurityGroups(
  cfnClient: any,
  ec2Client: EC2Client,
  stackName: string
): Promise<any[]> {
  try {
    const allResources: any[] = [];
    for await (const page of paginateListStackResources(
      { client: cfnClient },
      { StackName: stackName }
    )) {
      if (page.StackResourceSummaries) {
        allResources.push(...page.StackResourceSummaries);
      }
    }

    const sgResources = allResources.filter(
      (r: any) => r.ResourceType === "AWS::EC2::SecurityGroup"
    );

    if (sgResources.length === 0) {
      return [];
    }

    const sgIds = sgResources
      .map((r: any) => r.PhysicalResourceId)
      .filter((id: any): id is string => !!id);

    if (sgIds.length === 0) {
      return [];
    }

    const sgResponse = await ec2Client.send(
      new DescribeSecurityGroupsCommand({
        GroupIds: sgIds,
      })
    );

    return sgResponse.SecurityGroups || [];
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
    const response = await ssmClient.send(new ListAssociationsCommand({}));
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

async function verifyEfsMount(
  ssmClient: SSMClient,
  instanceId: string
): Promise<{
  mounted: boolean;
  directoryStructureOk: boolean;
  output?: string;
}> {
  const commands = [
    'mountpoint -q /mnt/efs && echo "MOUNTED" || echo "NOT_MOUNTED"',
    'ls -la /mnt/efs 2>/dev/null || echo "NOT_ACCESSIBLE"',
  ];

  try {
    const sendResponse = await ssmClient.send(
      new SendCommandCommand({
        DocumentName: "AWS-RunShellScript",
        InstanceIds: [instanceId],
        Parameters: { commands },
        TimeoutSeconds: 30,
      })
    );

    const commandId = sendResponse.Command?.CommandId;
    if (!commandId) {
      return { mounted: false, directoryStructureOk: false };
    }

    await sleep(5);

    let getResponse = await ssmClient.send(
      new GetCommandInvocationCommand({
        CommandId: commandId,
        InstanceId: instanceId,
      })
    );

    if (getResponse.Status === "InProgress") {
      await sleep(3);
      getResponse = await ssmClient.send(
        new GetCommandInvocationCommand({
          CommandId: commandId,
          InstanceId: instanceId,
        })
      );
    }

    const output = getResponse.StandardOutputContent || "";
    const mounted = output.includes("MOUNTED");
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

async function verifyInfraStack(
  config: VerifyInfraStackConfig
): Promise<void> {
  Logger.section(`MonitoringInfra Stack Verification - ${config.environment}`);

  const stackName = `${config.environment}-MonitoringInfra`;
  const paramPrefix = `/monitoring/${config.environment}`;

  printConfiguration(config, stackName);

  const clients = (await AwsClientFactory.createCommonClients(
    {
      ...config,
      sessionName: `verify-infra-${Date.now()}`,
    },
    ["cfn", "ecs", "asg", "ec2", "elbv2", "logs", "efs", "ssm", "eventBridge"]
  )) as InfraStackClients;

  printAccountInformation(clients);

  const runner = new VerificationRunner();
  const context: Partial<InfraStackContext> = {
    config,
    clients,
    stackName,
    paramPrefix,
    outputs: {},
    instanceIds: [],
  };

  setupVerificationChecks(runner, context as InfraStackContext);

  const summary = await runner.run();
  runner.printSummary();

  const exitCode = summary.checksPassed === summary.totalChecks ? 0 : 1;
  process.exit(exitCode);
}

function printConfiguration(
  config: VerifyInfraStackConfig,
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

function printAccountInformation(clients: InfraStackClients): void {
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
  context: InfraStackContext
): void {
  // 1. CloudFormation Stack Status
  runner.addCheck(
    CheckBuilder.create("CloudFormation Stack Status")
      .category("infrastructure")
      .critical(true)
      .execute(async () => {
        const stackInfo = await CloudFormationUtility.getStackStatus(
          context.clients.cfn,
          context.stackName,
          [
            "ClusterName",
            "AutoScalingGroupName",
            "LoadBalancerDns",
            "ListenerArn",
            "PrometheusUrl",
            "GrafanaUrl",
            "TaskLogGroupName",
          ]
        );

        if (!stackInfo) {
          return {
            passed: false,
            message: "Stack does not exist",
          };
        }

        context.outputs = {
          clusterName: (stackInfo.outputs as any).ClusterName,
          autoScalingGroupName: (stackInfo.outputs as any).AutoScalingGroupName,
          loadBalancerDns: (stackInfo.outputs as any).LoadBalancerDns,
          listenerArn: (stackInfo.outputs as any).ListenerArn,
          prometheusUrl: (stackInfo.outputs as any).PrometheusUrl,
          grafanaUrl: (stackInfo.outputs as any).GrafanaUrl,
          taskLogGroupName: (stackInfo.outputs as any).TaskLogGroupName,
        };

        if (context.config.verbose) {
          console.log("");
          console.log("Stack Outputs:");
          TableFormatter.formatStackOutputs(stackInfo.outputs);
        }

        const isReady = CloudFormationUtility.isStackReady(stackInfo.status);
        return {
          passed: isReady,
          message: `Stack Status: ${stackInfo.status}`,
        };
      })
  );

  // 2. ECS Cluster
  runner.addCheck(
    CheckBuilder.create("ECS Cluster")
      .category("compute")
      .execute(async () => {
        if (!context.outputs.clusterName) {
          return {
            passed: false,
            message: "Cluster name not found in stack outputs",
          };
        }

        const cluster = await ECSUtility.getCluster(
          context.clients.ecs,
          context.outputs.clusterName
        );

        if (!cluster) {
          return { passed: false, message: "ECS Cluster not found" };
        }

        context.cluster = cluster;

        if (context.config.verbose) {
          console.log("");
          TableFormatter.formatResourceInfo(cluster, [
            "clusterName",
            "status",
            "registeredContainerInstancesCount",
            "runningTasksCount",
            "pendingTasksCount",
          ]);
        }

        return {
          passed: ECSUtility.isClusterActive(cluster),
          message: `Cluster Status: ${cluster.status}, Registered Instances: ${cluster.registeredContainerInstancesCount || 0}`,
        };
      })
  );

  // 3. Auto Scaling Group & EC2 Instances
  runner.addCheck(
    CheckBuilder.create("Auto Scaling Group & EC2 Instances")
      .category("compute")
      .execute(async () => {
        if (!context.outputs.autoScalingGroupName) {
          return {
            passed: false,
            message: "ASG name not found in stack outputs",
          };
        }

        const asg = await getAutoScalingGroup(
          context.clients.asg,
          context.outputs.autoScalingGroupName
        );

        if (!asg) {
          return { passed: false, message: "Auto Scaling Group not found" };
        }

        context.asg = asg;
        context.instanceIds = (asg.Instances || [])
          .map((i: any) => i.InstanceId)
          .filter(Boolean);

        if (context.config.verbose) {
          console.log("");
          Logger.keyValue("ASG Name", asg.AutoScalingGroupName || "N/A");
          Logger.keyValue("Min Size", String(asg.MinSize || 0));
          Logger.keyValue("Max Size", String(asg.MaxSize || 0));
          Logger.keyValue("Desired Capacity", String(asg.DesiredCapacity || 0));
          Logger.keyValue(
            "Current Instances",
            String(context.instanceIds.length)
          );
        }

        const instanceStatuses = await EC2Utility.getInstanceStatus(
          context.clients.ec2,
          context.instanceIds
        );

        const healthyCount = instanceStatuses.filter(
          (s) =>
            s.InstanceStatus?.Status === "ok" &&
            s.SystemStatus?.Status === "ok"
        ).length;

        if (context.config.verbose && instanceStatuses.length > 0) {
          console.log("");
          Logger.info("Instance Health:");
          instanceStatuses.forEach((status) => {
            const shortId =
              status.InstanceId?.split("-").pop()?.substring(0, 8) || "unknown";
            const instanceOk = status.InstanceStatus?.Status === "ok";
            const systemOk = status.SystemStatus?.Status === "ok";

            if (instanceOk && systemOk) {
              Logger.success(`  ${shortId}: Healthy`);
            } else {
              Logger.warning(
                `  ${shortId}: Instance=${status.InstanceStatus?.Status}, System=${status.SystemStatus?.Status}`
              );
            }
          });
        }

        return {
          passed:
            context.instanceIds.length > 0 &&
            healthyCount === context.instanceIds.length,
          message: `${healthyCount}/${context.instanceIds.length} instances healthy`,
        };
      })
  );

  // 4. Application Load Balancer
  runner.addCheck(
    CheckBuilder.create("Application Load Balancer")
      .category("networking")
      .execute(async () => {
        if (!context.outputs.loadBalancerDns) {
          return {
            passed: false,
            message: "Load balancer DNS not found in stack outputs",
          };
        }

        const loadBalancers = await context.clients.elbv2.send(
          new (await import("@aws-sdk/client-elastic-load-balancing-v2")).DescribeLoadBalancersCommand({})
        );

        const loadBalancer = loadBalancers.LoadBalancers?.find(
          (lb: any) => lb.DNSName === context.outputs.loadBalancerDns
        );

        if (!loadBalancer) {
          return {
            passed: false,
            message: "Load Balancer not found",
          };
        }

        context.loadBalancer = loadBalancer;

        if (context.config.verbose) {
          console.log("");
          TableFormatter.formatResourceInfo(loadBalancer, [
            "LoadBalancerName",
            "DNSName",
            "State",
            "Type",
            "Scheme",
          ]);
        }

        const isActive = ELBUtility.isLoadBalancerActive(loadBalancer);

        return {
          passed: isActive,
          message: `ALB State: ${loadBalancer.State?.Code || "unknown"}`,
        };
      })
  );

  // 5. ALB Listener & Target Groups
  runner.addCheck(
    CheckBuilder.create("ALB Listener & Target Groups")
      .category("networking")
      .execute(async () => {
        if (!context.outputs.listenerArn) {
          return {
            passed: false,
            message: "Listener ARN not found in stack outputs",
          };
        }

        const listeners = await ELBUtility.getListeners(
          context.clients.elbv2,
          context.loadBalancer?.LoadBalancerArn || ""
        );

        if (listeners.length === 0) {
          return {
            passed: false,
            message: "No listeners configured on ALB",
          };
        }

        const targetGroups = await context.clients.elbv2.send(
          new (await import("@aws-sdk/client-elastic-load-balancing-v2")).DescribeTargetGroupsCommand({
            LoadBalancerArn: context.loadBalancer?.LoadBalancerArn,
          })
        );

        const tgCount = targetGroups.TargetGroups?.length || 0;

        if (context.config.verbose) {
          console.log("");
          Logger.keyValue("Listeners", String(listeners.length));
          Logger.keyValue("Target Groups", String(tgCount));
        }

        return {
          passed: listeners.length > 0 && tgCount > 0,
          message: `${listeners.length} listener(s), ${tgCount} target group(s)`,
        };
      })
  );

  // 6. Security Groups
  runner.addCheck(
    CheckBuilder.create("Security Groups")
      .category("security")
      .execute(async () => {
        const securityGroups = await getSecurityGroups(
          context.clients.cfn,
          context.clients.ec2,
          context.stackName
        );

        if (securityGroups.length === 0) {
          return {
            passed: false,
            message: "No security groups found in stack",
          };
        }

        if (context.config.verbose) {
          console.log("");
          Logger.info(`Found ${securityGroups.length} security group(s)`);
          securityGroups.forEach((sg) => {
            console.log("");
            Logger.keyValue("  Group ID", sg.GroupId || "N/A");
            Logger.keyValue("  Group Name", sg.GroupName || "N/A");
            Logger.keyValue(
              "  Inbound Rules",
              String(sg.IpPermissions?.length || 0)
            );
            Logger.keyValue(
              "  Outbound Rules",
              String(sg.IpPermissionsEgress?.length || 0)
            );
          });
        }

        return {
          passed: true,
          message: `${securityGroups.length} security group(s) configured`,
        };
      })
  );

  // 7. EFS Mount Target & Subnet Verification
  runner.addCheck(
    CheckBuilder.create("EFS Mount Target & Subnet Verification")
      .category("storage")
      .execute(async () => {
        const efsId = await SSMUtility.getParameter(
          context.clients.ssm,
          `${context.paramPrefix}/storage/efs-id`
        );

        if (!efsId.exists || !efsId.value) {
          const legacyEfsId = await SSMUtility.getParameter(
            context.clients.ssm,
            `${context.paramPrefix}/efs/config/file-system-id`
          );

          if (!legacyEfsId.exists || !legacyEfsId.value) {
            return {
              passed: false,
              message: "EFS File System ID not found in SSM parameters",
            };
          }

          context.efsFileSystemId = legacyEfsId.value;
        } else {
          context.efsFileSystemId = efsId.value;
        }

        const mountTargets = await EFSUtility.getMountTargets(
          context.clients.efs,
          context.efsFileSystemId
        );

        if (context.config.verbose) {
          console.log("");
          TableFormatter.formatMountTargets(mountTargets);
        }

        const availableCount = mountTargets.filter(
          (mt) => mt.LifeCycleState === "available"
        ).length;

        return {
          passed: mountTargets.length > 0 && availableCount === mountTargets.length,
          message: `${availableCount}/${mountTargets.length} mount targets available`,
        };
      })
  );

  // 8. SSM State Manager Associations
  runner.addCheck(
    CheckBuilder.create("SSM State Manager Associations")
      .category("configuration")
      .execute(async () => {
        const associations = await getSsmAssociations(
          context.clients.ssm,
          context.stackName,
          context.config.environment
        );

        if (context.config.verbose) {
          console.log("");
          if (associations.length > 0) {
            Logger.info(`Found ${associations.length} association(s)`);
            associations.forEach((assoc) => {
              Logger.keyValue("  Association ID", assoc.AssociationId || "N/A");
              Logger.keyValue("  Name", assoc.AssociationName || "N/A");
              Logger.keyValue(
                "  Last Execution",
                assoc.LastExecutionDate?.toISOString() || "Never"
              );
            });
          } else {
            Logger.warning("No SSM associations found");
          }
        }

        return {
          passed: associations.length > 0,
          message: `${associations.length} SSM association(s) configured`,
        };
      })
  );

  // 9. SSM Parameters (Infrastructure Discovery)
  runner.addCheck(
    CheckBuilder.create("SSM Parameters (Infrastructure Discovery)")
      .category("configuration")
      .execute(async () => {
        const allParams = [
          ...INFRA_PARAMS.map((p) => `${context.paramPrefix}/infra/${p}`),
          ...CONFIG_PARAMS.map((p) => `${context.paramPrefix}/${p}`),
        ];

        const validation = await SSMUtility.validateParameters(
          context.clients.ssm,
          allParams,
          context.config.verbose || false
        );

        if (context.config.verbose) {
          console.log("");
          Logger.keyValue("Total Parameters", String(allParams.length));
          Logger.keyValue("Found", String(validation.existing.length));
          Logger.keyValue("Missing", String(validation.missing.length));
        }

        return {
          passed: validation.allExist,
          message: `${validation.existing.length}/${allParams.length} parameters exist`,
        };
      })
  );

  // 10. EFS Mount Verification on Instances
  runner.addCheck(
    CheckBuilder.create("EFS Mount Verification on Instances")
      .category("storage")
      .optional(true)
      .execute(async () => {
        if (context.instanceIds.length === 0) {
          return {
            passed: false,
            message: "No instances available to check EFS mounts",
          };
        }

        const firstInstanceId = context.instanceIds[0];
        const mountResult = await verifyEfsMount(
          context.clients.ssm,
          firstInstanceId
        );

        if (context.config.verbose && mountResult.output) {
          console.log("");
          Logger.info("EFS Mount Check Output:");
          console.log(mountResult.output);
        }

        return {
          passed: mountResult.mounted && mountResult.directoryStructureOk,
          message: mountResult.mounted
            ? mountResult.directoryStructureOk
              ? "EFS mounted with correct directory structure"
              : "EFS mounted but directory structure not verified"
            : "EFS not mounted on instance",
        };
      })
  );

  // 11. ALB Health Check
  runner.addCheck(
    CheckBuilder.create("ALB Health Check")
      .category("networking")
      .optional(true)
      .execute(async () => {
        if (!context.outputs.loadBalancerDns) {
          return {
            passed: false,
            message: "Load Balancer DNS not available",
          };
        }

        const healthCheck = await checkAlbHealth(context.outputs.loadBalancerDns);

        if (context.config.verbose) {
          console.log("");
          Logger.keyValue("ALB DNS", context.outputs.loadBalancerDns);
          Logger.keyValue("Reachable", String(healthCheck.reachable));
          if (healthCheck.httpCode) {
            Logger.keyValue("HTTP Code", String(healthCheck.httpCode));
          }
        }

        return {
          passed: healthCheck.reachable,
          message: healthCheck.reachable
            ? `ALB reachable (HTTP ${healthCheck.httpCode || "200"})`
            : "ALB not reachable",
        };
      })
  );

  // 12. Service Stack Deployment Readiness
  runner.addCheck(
    CheckBuilder.create("Service Stack Deployment Readiness")
      .category("readiness")
      .execute(async () => {
        const checker = new ReadinessChecker();

        if (!context.cluster || !ECSUtility.isClusterActive(context.cluster)) {
          checker.addBlocker("ECS Cluster not active");
        }

        if (context.instanceIds.length === 0) {
          checker.addBlocker("No EC2 instances in Auto Scaling Group");
        }

        if (!context.loadBalancer || !ELBUtility.isLoadBalancerActive(context.loadBalancer)) {
          checker.addBlocker("Load Balancer not active");
        }

        if (checker.isReady()) {
          checker.addNextStep(
            `Deploy MonitoringServiceStack: cdk deploy ${context.config.environment}-MonitoringService`
          );
        }

        console.log("");
        checker.printAssessment("MonitoringServiceStack");

        return {
          passed: checker.isReady(),
          message: checker.isReady()
            ? "Infrastructure ready for service deployment"
            : "Infrastructure not ready for service deployment",
        };
      })
  );
}

const cli = CliBuilder.create(
  "verify-infra-stack",
  "Verify MonitoringInfra stack deployment and readiness"
);

cli
  .option(
    "--non-blocking",
    "Allow ServiceStack deployment even if health checks fail"
  )
  .option("-v, --verbose", "Enable verbose output");

cli.parse();

const options = cli.opts();

CliBuilder.validateEnvironment(options.environment);

const config: VerifyInfraStackConfig = {
  environment: options.environment,
  region: options.region,
  profile: options.profile,
  verbose: options.verbose || false,
  nonBlocking: options.nonBlocking || false,
};

verifyInfraStack(config).catch((error) => {
  Logger.error(`Verification failed: ${error.message}`);
  if (config.verbose && error.stack) {
    console.log("");
    console.log(error.stack);
  }
  process.exit(1);
});
