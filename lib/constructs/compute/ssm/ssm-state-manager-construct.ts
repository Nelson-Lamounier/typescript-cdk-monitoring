/** @format */

import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as ssm from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";

import {
  DEFAULT_SSM_AGENT_CHECK_DELAY_SECONDS,
  DEFAULT_SSM_AGENT_CHECK_MAX_RETRIES,
  DEFAULT_SSM_APPLY_ONLY_AT_CRON_INTERVAL,
  DEFAULT_SSM_COMPLIANCE_SEVERITY,
  DEFAULT_SSM_COMPLIANCE_SEVERITY_PROD,
  DEFAULT_SSM_DOCKER_MAX_RETRIES,
  DEFAULT_SSM_DOCKER_RETRY_DELAY_SECONDS,
  DEFAULT_SSM_ECS_START_MAX_RETRIES,
  DEFAULT_SSM_ECS_START_RETRY_DELAY_SECONDS,
  DEFAULT_SSM_LOG_RETENTION_DEV,
  DEFAULT_SSM_LOG_RETENTION_PROD,
  DEFAULT_SSM_MAX_CONCURRENCY,
  DEFAULT_SSM_MAX_ERRORS,
  resolveSsmSchedule,
} from "../../../shared/constants/compute-constants";
import { PRODUCTION_ENV_NAMES } from "../../../shared/constants/storage-constants";
import {
  CloudWatchAgentSsmConfig,
  EcsAgentSsmConfig,
  SsmStateManagerConstructProps,
} from "../../../shared/types/compute-types";
import { buildEcsAgentScript } from "../../../shared/helpers/ecs-agent-script-builder";
import {
  validateClusterName,
  validateEnvName,
  validateIamRoleProvided,
  validateLogGroupNameOptional,
  validateScheduleExpression,
  validateSsmTargets,
} from "../../../shared/utils/validation";

/**
 * SSM State Manager Construct
 *
 * Creates SSM State Manager associations to handle:
 * - ECS agent setup and configuration
 * - CloudWatch Agent installation and configuration
 *
 * Benefits over UserData:
 * - Can be updated without recreating instances
 * - Can run on a schedule for maintenance
 * - Better error handling and retry logic
 * - Centralized management via SSM console
 */
export class SsmStateManagerConstruct extends Construct {
  public readonly ecsAgentConfigAssociation: ssm.CfnAssociation;
  public readonly cloudWatchAgentInstallAssociation: ssm.CfnAssociation;
  public readonly cloudWatchAgentConfigAssociation: ssm.CfnAssociation;
  private readonly stack = cdk.Stack.of(this);

  constructor(
    scope: Construct,
    id: string,
    props: SsmStateManagerConstructProps
  ) {
    super(scope, id);

    const { envName, projectName, clusterName, instanceRole, targets } = props;

    validateEnvName(envName);
    validateClusterName(clusterName);
    validateIamRoleProvided(instanceRole, "instanceRole");

    const isProduction = PRODUCTION_ENV_NAMES.includes(envName);
    const baseLogPrefix = `/ecs/${projectName ?? envName}`;

    const ecsAgentConfig: EcsAgentSsmConfig = {
      scheduleExpression:
        props.ecsAgent?.scheduleExpression ?? resolveSsmSchedule(envName),
      applyOnlyAtCronInterval:
        props.ecsAgent?.applyOnlyAtCronInterval ??
        DEFAULT_SSM_APPLY_ONLY_AT_CRON_INTERVAL,
      complianceSeverity:
        props.ecsAgent?.complianceSeverity ??
        (isProduction
          ? DEFAULT_SSM_COMPLIANCE_SEVERITY_PROD
          : DEFAULT_SSM_COMPLIANCE_SEVERITY),
      maxConcurrency:
        props.ecsAgent?.maxConcurrency ?? DEFAULT_SSM_MAX_CONCURRENCY,
      maxErrors: props.ecsAgent?.maxErrors ?? DEFAULT_SSM_MAX_ERRORS,
      targets: props.ecsAgent?.targets ?? targets,
      dockerMaxRetries:
        props.ecsAgent?.dockerMaxRetries ?? DEFAULT_SSM_DOCKER_MAX_RETRIES,
      dockerRetryDelaySeconds:
        props.ecsAgent?.dockerRetryDelaySeconds ??
        DEFAULT_SSM_DOCKER_RETRY_DELAY_SECONDS,
      ecsStartMaxRetries:
        props.ecsAgent?.ecsStartMaxRetries ?? DEFAULT_SSM_ECS_START_MAX_RETRIES,
      ecsStartRetryDelaySeconds:
        props.ecsAgent?.ecsStartRetryDelaySeconds ??
        DEFAULT_SSM_ECS_START_RETRY_DELAY_SECONDS,
      agentCheckMaxRetries:
        props.ecsAgent?.agentCheckMaxRetries ??
        DEFAULT_SSM_AGENT_CHECK_MAX_RETRIES,
      agentCheckDelaySeconds:
        props.ecsAgent?.agentCheckDelaySeconds ??
        DEFAULT_SSM_AGENT_CHECK_DELAY_SECONDS,
    };

    const cloudWatchAgentConfig: CloudWatchAgentSsmConfig = {
      scheduleExpression:
        props.cloudWatchAgent?.scheduleExpression ??
        resolveSsmSchedule(envName),
      applyOnlyAtCronInterval:
        props.cloudWatchAgent?.applyOnlyAtCronInterval ??
        DEFAULT_SSM_APPLY_ONLY_AT_CRON_INTERVAL,
      complianceSeverity:
        props.cloudWatchAgent?.complianceSeverity ??
        (isProduction
          ? DEFAULT_SSM_COMPLIANCE_SEVERITY_PROD
          : DEFAULT_SSM_COMPLIANCE_SEVERITY),
      maxConcurrency:
        props.cloudWatchAgent?.maxConcurrency ?? DEFAULT_SSM_MAX_CONCURRENCY,
      maxErrors: props.cloudWatchAgent?.maxErrors ?? DEFAULT_SSM_MAX_ERRORS,
      targets:
        props.cloudWatchAgent?.targets ?? ecsAgentConfig.targets ?? targets,
      logConfig: props.cloudWatchAgent?.logConfig,
    };

    const ecsScheduleExpression =
      ecsAgentConfig.scheduleExpression ?? resolveSsmSchedule(envName);
    const cloudWatchScheduleExpression =
      cloudWatchAgentConfig.scheduleExpression ?? resolveSsmSchedule(envName);

    const associationTargets = cloudWatchAgentConfig.targets ??
      ecsAgentConfig.targets ?? [
        {
          key: "tag:Environment",
          values: [envName],
        },
      ];

    validateSsmTargets(associationTargets);
    validateScheduleExpression(ecsScheduleExpression);
    validateScheduleExpression(cloudWatchScheduleExpression);

    // Log groups (created to avoid runtime failures)
    const logRetention =
      cloudWatchAgentConfig.logConfig?.logRetention ??
      (isProduction
        ? DEFAULT_SSM_LOG_RETENTION_PROD
        : DEFAULT_SSM_LOG_RETENTION_DEV);
    const logRemovalPolicy = isProduction
      ? cdk.RemovalPolicy.RETAIN
      : cdk.RemovalPolicy.DESTROY;

    const containerLogGroupName =
      cloudWatchAgentConfig.logConfig?.containerLogGroupName ??
      `${baseLogPrefix}-containers`;
    const ecsAgentLogGroupName =
      cloudWatchAgentConfig.logConfig?.ecsAgentLogGroupName ??
      `${baseLogPrefix}-ecs-agent`;
    const ecsInitLogGroupName =
      cloudWatchAgentConfig.logConfig?.ecsInitLogGroupName ??
      `${baseLogPrefix}-ecs-init`;

    validateLogGroupNameOptional(containerLogGroupName);
    validateLogGroupNameOptional(ecsAgentLogGroupName);
    validateLogGroupNameOptional(ecsInitLogGroupName);

    const containerLogGroup = new logs.LogGroup(this, "ContainerLogs", {
      logGroupName: containerLogGroupName,
      retention: logRetention,
      encryptionKey: cloudWatchAgentConfig.logConfig?.logGroupKmsKey,
      removalPolicy: logRemovalPolicy,
    });

    const ecsAgentLogGroup = new logs.LogGroup(this, "EcsAgentLogs", {
      logGroupName: ecsAgentLogGroupName,
      retention: logRetention,
      encryptionKey: cloudWatchAgentConfig.logConfig?.logGroupKmsKey,
      removalPolicy: logRemovalPolicy,
    });

    const ecsInitLogGroup = new logs.LogGroup(this, "EcsInitLogs", {
      logGroupName: ecsInitLogGroupName,
      retention: logRetention,
      encryptionKey: cloudWatchAgentConfig.logConfig?.logGroupKmsKey,
      removalPolicy: logRemovalPolicy,
    });

    const ecsConfigScript = buildEcsAgentScript({
      clusterName,
      dockerMaxRetries:
        ecsAgentConfig.dockerMaxRetries ?? DEFAULT_SSM_DOCKER_MAX_RETRIES,
      dockerRetryDelaySeconds:
        ecsAgentConfig.dockerRetryDelaySeconds ??
        DEFAULT_SSM_DOCKER_RETRY_DELAY_SECONDS,
      ecsStartMaxRetries:
        ecsAgentConfig.ecsStartMaxRetries ?? DEFAULT_SSM_ECS_START_MAX_RETRIES,
      ecsStartRetryDelaySeconds:
        ecsAgentConfig.ecsStartRetryDelaySeconds ??
        DEFAULT_SSM_ECS_START_RETRY_DELAY_SECONDS,
      agentCheckMaxRetries:
        ecsAgentConfig.agentCheckMaxRetries ??
        DEFAULT_SSM_AGENT_CHECK_MAX_RETRIES,
      agentCheckDelaySeconds:
        ecsAgentConfig.agentCheckDelaySeconds ??
        DEFAULT_SSM_AGENT_CHECK_DELAY_SECONDS,
    });

    // Use AWS-RunShellScript (AWS managed document) instead of custom document
    this.ecsAgentConfigAssociation = new ssm.CfnAssociation(
      this,
      "EcsConfigAssociation",
      {
        name: "AWS-RunShellScript", // AWS managed document
        associationName: `${this.stack.stackName}-${envName}-ecs-agent-config`,
        targets: associationTargets,
        parameters: {
          commands: [ecsConfigScript],
        } as Record<string, string[]>,
        scheduleExpression: ecsScheduleExpression,
        applyOnlyAtCronInterval: ecsAgentConfig.applyOnlyAtCronInterval,
        complianceSeverity: ecsAgentConfig.complianceSeverity,
        maxConcurrency: ecsAgentConfig.maxConcurrency,
        maxErrors: ecsAgentConfig.maxErrors,
      }
    );

    // ========================================================================
    // CLOUDWATCH AGENT SETUP ASSOCIATION
    // ========================================================================
    // First, install CloudWatch Agent
    this.cloudWatchAgentInstallAssociation = new ssm.CfnAssociation(
      this,
      "CloudWatchAgentInstallAssociation",
      {
        name: "AWS-ConfigureAWSPackage", // AWS managed document
        associationName: `${this.stack.stackName}-${envName}-cloudwatch-agent-install`,
        targets: associationTargets,
        parameters: {
          action: ["Install"],
          name: ["AmazonCloudWatchAgent"],
        } as Record<string, string[]>,
        scheduleExpression: cloudWatchScheduleExpression,
        applyOnlyAtCronInterval: cloudWatchAgentConfig.applyOnlyAtCronInterval,
        complianceSeverity: cloudWatchAgentConfig.complianceSeverity,
        maxConcurrency: cloudWatchAgentConfig.maxConcurrency,
        maxErrors: cloudWatchAgentConfig.maxErrors,
      }
    );

    // Create CloudWatch Agent configuration document
    // CDK CfnDocument expects content as an object when using YAML format
    const cloudWatchConfigDocumentContent = {
      schemaVersion: "2.2",
      description: `Configure CloudWatch Agent for ${envName}`,
      mainSteps: [
        {
          action: "aws:runShellScript",
          name: "configureCloudWatchAgent",
          inputs: {
            runCommand: [
              "#!/bin/bash",
              "INSTANCE_ID=$(curl -s http://169.254.169.254/latest/meta-data/instance-id || echo 'unknown')",
              "",
              "# Create CloudWatch Agent configuration",
              "mkdir -p /opt/aws/amazon-cloudwatch-agent/etc",
              "cat > /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json << 'CWAGENT_CONFIG_EOF'",
              "{",
              '  "logs": {',
              '    "logs_collected": {',
              '      "files": {',
              '        "collect_list": [',
              "          {",
              '            "file_path": "/var/lib/docker/containers/*/*-json.log",',
              `            "log_group_name": "${containerLogGroup.logGroupName}",`,
              '            "log_stream_name": "{instance_id}-{source_host}",',
              '            "timezone": "UTC",',
              '            "multi_line_start_pattern": "^\\\\{\\"log\\\\":",',
              '            "encoding": "utf-8",',
              '            "auto_removal": false',
              "          },",
              "          {",
              '            "file_path": "/var/log/ecs/ecs-agent.log",',
              `            "log_group_name": "${ecsAgentLogGroup.logGroupName}",`,
              '            "log_stream_name": "{instance_id}",',
              '            "timezone": "UTC",',
              '            "encoding": "utf-8"',
              "          },",
              "          {",
              '            "file_path": "/var/log/ecs/ecs-init.log",',
              `            "log_group_name": "${ecsInitLogGroup.logGroupName}",`,
              '            "log_stream_name": "{instance_id}",',
              '            "timezone": "UTC",',
              '            "encoding": "utf-8"',
              "          }",
              "        ]",
              "      }",
              "    }",
              "  }",
              "}",
              "CWAGENT_CONFIG_EOF",
              "",
              "# Start CloudWatch Agent",
              "systemctl enable amazon-cloudwatch-agent || true",
              "systemctl start amazon-cloudwatch-agent || true",
            ],
          },
        },
      ],
    };

    const cloudWatchConfigDocument = new ssm.CfnDocument(
      this,
      "CloudWatchAgentConfigDocument",
      {
        documentType: "Command",
        documentFormat: "YAML",
        name: `${this.stack.stackName}-${envName}-cloudwatch-agent-config`,
        content: cloudWatchConfigDocumentContent,
      }
    );

    // Association to run CloudWatch Agent configuration
    this.cloudWatchAgentConfigAssociation = new ssm.CfnAssociation(
      this,
      "CloudWatchAgentConfigAssociation",
      {
        name: cloudWatchConfigDocument.name ?? cloudWatchConfigDocument.ref,
        associationName: `${this.stack.stackName}-${envName}-cloudwatch-agent-config`,
        targets: associationTargets,
        scheduleExpression: cloudWatchScheduleExpression,
        applyOnlyAtCronInterval: cloudWatchAgentConfig.applyOnlyAtCronInterval,
        complianceSeverity: cloudWatchAgentConfig.complianceSeverity,
        maxConcurrency: cloudWatchAgentConfig.maxConcurrency,
        maxErrors: cloudWatchAgentConfig.maxErrors,
      }
    );
    this.cloudWatchAgentConfigAssociation.addDependency(
      cloudWatchConfigDocument
    );
    this.cloudWatchAgentConfigAssociation.addDependency(
      this.cloudWatchAgentInstallAssociation
    );

    // Grant SSM permissions to instance role
    instanceRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "ssm:DescribeInstanceInformation",
          "ssm:ListAssociations",
          "ssm:ListInstanceAssociations",
          "ssm:DescribeAssociation",
        ],
        resources: ["*"],
      })
    );

    const documentArns = [
      `arn:aws:ssm:${this.stack.region}:${this.stack.account}:document/AWS-RunShellScript`,
      `arn:aws:ssm:${this.stack.region}:${this.stack.account}:document/AWS-ConfigureAWSPackage`,
      `arn:aws:ssm:${this.stack.region}:${this.stack.account}:document/${cloudWatchConfigDocument.name}`,
    ];

    instanceRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["ssm:UpdateInstanceInformation"],
        resources: ["*"],
      })
    );

    instanceRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "ssm:GetDocument",
          "ssm:SendCommand",
          "ssm:GetCommandInvocation",
        ],
        resources: documentArns,
      })
    );

    // Tags
    cdk.Tags.of(this).add("Environment", envName);
    if (projectName) {
      cdk.Tags.of(this).add("Project", projectName);
    }
    cdk.Tags.of(this).add("Component", "SSMStateManager");
    cdk.Tags.of(this).add("ManagedBy", "CDK");

    if (
      isProduction &&
      ecsAgentConfig.scheduleExpression &&
      ecsAgentConfig.scheduleExpression.includes("30 days")
    ) {
      cdk.Annotations.of(this).addWarning(
        "Production State Manager associations are scheduled every 30 days. Consider a tighter cadence (e.g., 7 days) for faster remediation."
      );
    }

    if (isProduction && ecsAgentConfig.maxErrors === "5") {
      cdk.Annotations.of(this).addWarning(
        "Max errors is set to 5 in production. Consider lowering or adding alarms for SSM association failures."
      );
    }

    if (isProduction && documentArns.length === 0) {
      cdk.Annotations.of(this).addWarning(
        "No document ARNs were added to SSM permissions; verify access before deployment."
      );
    }
  }

  /**
   * Return the association ARN for the given association.
   */
  public getAssociationArn(association: ssm.CfnAssociation): string {
    return `arn:aws:ssm:${this.stack.region}:${this.stack.account}:association/${association.ref}`;
  }

  /**
   * Update the schedule expression for an association.
   */
  public updateAssociationSchedule(
    association: ssm.CfnAssociation,
    scheduleExpression: string
  ): void {
    validateScheduleExpression(scheduleExpression);
    association.scheduleExpression = scheduleExpression;
  }

  /**
   * Create a refresh association to retrigger an existing association.
   */
  public retriggerAssociation(
    association: ssm.CfnAssociation,
    id?: string
  ): ssm.CfnAssociation {
    return new ssm.CfnAssociation(this, id ?? `Refresh${association.node.id}`, {
      name: "AWS-RefreshAssociation",
      parameters: {
        AssociationIds: [association.ref],
      } as Record<string, string[]>,
      targets: association.targets,
      maxErrors: "1",
      maxConcurrency: "1",
    });
  }
}
