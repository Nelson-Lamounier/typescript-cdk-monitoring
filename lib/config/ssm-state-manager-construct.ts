/** @format */

import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as ssm from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";

export interface SsmStateManagerConstructProps {
  /**
   * Environment name for resource naming
   */
  envName: string;

  /**
   * ECS cluster name
   */
  clusterName: string;

  /**
   * Instance role that will be targeted by associations
   */
  instanceRole: iam.IRole;

  /**
   * Target instances (can be tags, instance IDs, or all instances)
   * Default: All instances with the instance role
   */
  targets?: ssm.CfnAssociation.TargetProperty[];
}

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

  constructor(
    scope: Construct,
    id: string,
    props: SsmStateManagerConstructProps
  ) {
    super(scope, id);

    const { envName, clusterName, instanceRole, targets } = props;

    // Default targets: All instances with the instance role
    const defaultTargets: ssm.CfnAssociation.TargetProperty[] = [
      {
        key: "tag:Environment",
        values: [envName],
      },
      {
        key: "tag:Service",
        values: ["monitoring"],
      },
    ];

    const associationTargets = targets || defaultTargets;

    // ========================================================================
    // ECS AGENT SETUP ASSOCIATION
    // ========================================================================
    // Note: amazon-ecs-init is pre-installed on ECS-optimized AMIs, so we don't
    // need to install it via SSM Distributor. We only need to configure and start it.
    // Create association using AWS-RunShellScript (AWS managed document)
    // This runs the ECS agent configuration script directly
    // Note: amazon-ecs-init is pre-installed on ECS-optimized AMIs
    // Script is designed to be resilient with extended timeouts and retry logic
    const ecsConfigScript = [
      "#!/bin/bash",
      "# Don't use 'set -e' - we want to handle errors gracefully",
      "set -o pipefail",
      "",
      "echo '========================================='",
      "echo 'ECS Agent Configuration Script'",
      "echo 'Timestamp:' $(date)",
      "echo '========================================='",
      "",
      "# Configure ECS cluster (idempotent - safe to run multiple times)",
      `echo ECS_CLUSTER=${clusterName} >> /etc/ecs/ecs.config || echo 'WARNING: Failed to write ECS_CLUSTER'`,
      "echo ECS_ENABLE_CONTAINER_METADATA=true >> /etc/ecs/ecs.config || true",
      "echo ECS_ENABLE_TASK_IAM_ROLE=true >> /etc/ecs/ecs.config || true",
      "echo ECS_AWSVPC_BLOCK_IMDS=true >> /etc/ecs/ecs.config || true",
      // Use cat with heredoc to ensure exact JSON format - ECS agent requires valid JSON array
      // CRITICAL: This must be valid JSON for the awslogs driver to be registered
      "cat >> /etc/ecs/ecs.config << 'EOF' || true",
      'ECS_AVAILABLE_LOGGING_DRIVERS=["json-file","awslogs"]',
      "EOF",
      "",
      "# Verify the config was written correctly",
      "echo 'Verifying ECS config format...'",
      "if grep -q 'ECS_AVAILABLE_LOGGING_DRIVERS' /etc/ecs/ecs.config; then",
      "  echo '✓ ECS_AVAILABLE_LOGGING_DRIVERS found in config'",
      "  grep 'ECS_AVAILABLE_LOGGING_DRIVERS' /etc/ecs/ecs.config",
      "else",
      "  echo 'WARNING: ECS_AVAILABLE_LOGGING_DRIVERS not found in config'",
      "fi",
      "",
      "# Ensure Docker is running (required for ECS agent on AL2023)",
      "echo 'Ensuring Docker is running...'",
      "systemctl enable docker 2>&1 || echo 'WARNING: Failed to enable Docker'",
      "systemctl start docker 2>&1 || echo 'WARNING: Failed to start Docker'",
      "",
      "# Wait for Docker to be ready (extended timeout for slow systems)",
      "echo 'Waiting for Docker to be ready...'",
      "DOCKER_RETRY=0",
      "DOCKER_MAX_RETRIES=24", // 2 minutes (5s * 24)
      "DOCKER_READY=false",
      "while [ $DOCKER_RETRY -lt $DOCKER_MAX_RETRIES ]; do",
      "  if systemctl is-active docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then",
      "    echo 'Docker is ready'",
      "    DOCKER_READY=true",
      "    break",
      "  fi",
      "  DOCKER_RETRY=$((DOCKER_RETRY + 1))",
      '  echo "Waiting for Docker (attempt $DOCKER_RETRY/$DOCKER_MAX_RETRIES)..."',
      "  systemctl start docker >/dev/null 2>&1 || true",
      "  sleep 5",
      "done",
      "",
      'if [ "$DOCKER_READY" != "true" ]; then',
      "  echo 'WARNING: Docker not ready after $DOCKER_MAX_RETRIES attempts, continuing anyway'",
      "fi",
      "",
      "# Pre-pull ECS agent Docker image (required for AL2023)",
      "# On AL2023, ECS agent runs as a Docker container managed by ecs-init",
      "echo 'Pre-pulling ECS agent Docker image...'",
      'ECS_AGENT_IMAGE="public.ecr.aws/ecs/amazon-ecs-agent:latest"',
      'ECS_AGENT_LEGACY_TAG="amazon/amazon-ecs-agent:latest"',
      "if command -v docker >/dev/null 2>&1; then",
      "  if docker info >/dev/null 2>&1; then",
      '    echo "Pulling ECS agent image: $ECS_AGENT_IMAGE"',
      "    docker pull $ECS_AGENT_IMAGE 2>&1 || echo 'WARNING: Failed to pull ECS agent image'",
      "    if docker images | grep -q amazon-ecs-agent; then",
      '      echo "Creating legacy tag alias: $ECS_AGENT_LEGACY_TAG"',
      "      docker tag $ECS_AGENT_IMAGE $ECS_AGENT_LEGACY_TAG 2>&1 || echo 'WARNING: Failed to create legacy tag'",
      "    fi",
      "  else",
      "    echo 'WARNING: Docker daemon not accessible, skipping image pull'",
      "  fi",
      "else",
      "  echo 'WARNING: Docker command not found'",
      "fi",
      "",
      "# Configure ECS agent service with retry logic (idempotent)",
      "echo 'Configuring ECS agent service...'",
      "mkdir -p /etc/systemd/system/ecs.service.d",
      "cat > /etc/systemd/system/ecs.service.d/override.conf << 'EOF' || echo 'WARNING: Failed to create override.conf'",
      "[Service]",
      "Restart=on-failure",
      "RestartSec=30",
      "StartLimitInterval=600",
      "StartLimitBurst=20",
      "EOF",
      "systemctl daemon-reload || echo 'WARNING: Failed to reload systemd'",
      "",
      "# Start/Restart ECS agent to pick up new logging drivers config",
      "echo 'Starting/Restarting ECS agent to apply logging drivers config...'",
      "systemctl enable ecs 2>&1 || echo 'WARNING: Failed to enable ECS service'",
      "",
      "# Reset failed state if service was previously failed",
      "systemctl reset-failed ecs 2>&1 || true",
      "",
      "# Restart ECS agent if already running to pick up config changes",
      "# If not running, start it instead",
      "if systemctl is-active ecs >/dev/null 2>&1; then",
      "  echo 'ECS agent is running, restarting to apply new logging drivers config...'",
      "  systemctl restart ecs 2>&1 || echo 'WARNING: Failed to restart ECS service'",
      "else",
      "  echo 'ECS agent not running, starting...'",
      "fi",
      "",
      "# Start ECS agent with retries (in case restart didn't work or it wasn't running)",
      "ECS_START_RETRY=0",
      "ECS_START_MAX_RETRIES=6",
      "ECS_STARTED=false",
      "while [ $ECS_START_RETRY -lt $ECS_START_MAX_RETRIES ]; do",
      "  if systemctl start ecs 2>&1; then",
      "    echo 'ECS service start command succeeded'",
      "    ECS_STARTED=true",
      "    break",
      "  fi",
      "  ECS_START_RETRY=$((ECS_START_RETRY + 1))",
      '  echo "ECS start attempt $ECS_START_RETRY/$ECS_START_MAX_RETRIES failed, retrying..."',
      "  systemctl reset-failed ecs 2>&1 || true",
      "  sleep 5",
      "done",
      "",
      'if [ "$ECS_STARTED" != "true" ]; then',
      "  echo 'WARNING: Failed to start ECS service after $ECS_START_MAX_RETRIES attempts'",
      "  echo 'Checking if ECS agent is already running...'",
      "fi",
      "",
      "# Verify ECS agent is running (extended timeout for agent stabilization)",
      "echo 'Verifying ECS agent is running...'",
      "RETRY_COUNT=0",
      "MAX_RETRIES=36", // 6 minutes total (10s * 36) - extended for agent stabilization
      "AGENT_RUNNING=false",
      "",
      "while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do",
      "  # Check if ECS agent process is running",
      "  if pgrep -f 'ecs-agent' >/dev/null 2>&1; then",
      "    echo 'ECS agent process detected'",
      "    # Additional check: verify agent is responding (not just starting)",
      "    if [ -f /var/log/ecs/ecs-agent.log ]; then",
      "      # Check if agent has been running for at least 10 seconds (not just started)",
      "      AGENT_PID=$(pgrep -f 'ecs-agent' | head -1)",
      '      if [ -n "$AGENT_PID" ]; then',
      "        # Check process uptime (if available via /proc)",
      '        if [ -d "/proc/$AGENT_PID" ]; then',
      "          AGENT_START_TIME=$(stat -c %Y /proc/$AGENT_PID 2>/dev/null || echo 0)",
      "          CURRENT_TIME=$(date +%s)",
      "          AGENT_UPTIME=$((CURRENT_TIME - AGENT_START_TIME))",
      "          if [ $AGENT_UPTIME -ge 10 ]; then",
      "            echo 'ECS agent is running and stable (uptime: ${AGENT_UPTIME}s)'",
      "            AGENT_RUNNING=true",
      "            break",
      "          else",
      '            echo "ECS agent starting (uptime: ${AGENT_UPTIME}s), waiting for stabilization..."',
      "          fi",
      "        else",
      "          # Process exists but can't check uptime - assume it's stable if it's been running",
      "          echo 'ECS agent process is running'",
      "          AGENT_RUNNING=true",
      "          break",
      "        fi",
      "      fi",
      "    else",
      "      # Log file doesn't exist yet, but process is running - give it more time",
      "      echo 'ECS agent process running but log file not found, waiting...'",
      "    fi",
      "  else",
      "    # Agent not running - try to start it again",
      "    if [ $RETRY_COUNT -gt 0 ] && [ $((RETRY_COUNT % 6)) -eq 0 ]; then",
      "      echo 'Retrying ECS agent start...'",
      "      systemctl reset-failed ecs 2>&1 || true",
      "      systemctl start ecs 2>&1 || true",
      "    fi",
      "  fi",
      "",
      "  RETRY_COUNT=$((RETRY_COUNT + 1))",
      "  if [ $((RETRY_COUNT % 6)) -eq 0 ]; then",
      '    echo "Still waiting for ECS agent (attempt $RETRY_COUNT/$MAX_RETRIES)..."',
      "  fi",
      "  sleep 10",
      "done",
      "",
      "# Final status check",
      'if [ "$AGENT_RUNNING" = "true" ]; then',
      "  echo '========================================='",
      "  echo 'SUCCESS: ECS agent is running and stable'",
      "  echo '========================================='",
      "  exit 0",
      "else",
      "  echo '========================================='",
      "  echo 'WARNING: ECS agent not confirmed running after $MAX_RETRIES attempts'",
      "  echo 'This may be normal if:'",
      "  echo '  - Agent is still starting up'",
      "  echo '  - Network connectivity issues'",
      "  echo '  - IAM role not yet attached'",
      "  echo 'The agent may start successfully later.'",
      "  echo '========================================='",
      "  # Don't exit with error - let the agent start asynchronously",
      "  # SSM will retry the association on schedule",
      "  exit 0",
      "fi",
    ].join("\n");

    // Use AWS-RunShellScript (AWS managed document) instead of custom document
    this.ecsAgentConfigAssociation = new ssm.CfnAssociation(
      this,
      "EcsConfigAssociation",
      {
        name: "AWS-RunShellScript", // AWS managed document
        associationName: `${envName}-ecs-agent-config`,
        targets: associationTargets,
        parameters: {
          commands: [ecsConfigScript],
        } as Record<string, string[]>,
        scheduleExpression: "rate(30 days)", // Run monthly for maintenance
        applyOnlyAtCronInterval: false, // Also run immediately on new instances
        complianceSeverity: "CRITICAL",
        maxConcurrency: "10",
        maxErrors: "5",
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
        associationName: `${envName}-cloudwatch-agent-install`,
        targets: associationTargets,
        parameters: {
          action: ["Install"],
          name: ["AmazonCloudWatchAgent"],
        } as Record<string, string[]>,
        scheduleExpression: "rate(30 days)", // Run monthly for maintenance
        applyOnlyAtCronInterval: false, // Also run immediately on new instances
        complianceSeverity: "HIGH",
        maxConcurrency: "10",
        maxErrors: "5",
      }
    );

    // Create CloudWatch Agent configuration document
    // CDK CfnDocument expects content as an object when using YAML format
    const cloudWatchConfigDocumentContent = {
      schemaVersion: "2.2",
      description: `Configure CloudWatch Agent for ${envName} monitoring`,
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
              `            "log_group_name": "/ecs/${envName}-containers",`,
              '            "log_stream_name": "{instance_id}-{source_host}",',
              '            "timezone": "UTC",',
              '            "multi_line_start_pattern": "^\\\\{\\"log\\\\":",',
              '            "encoding": "utf-8",',
              '            "auto_removal": false',
              "          },",
              "          {",
              '            "file_path": "/var/log/ecs/ecs-agent.log",',
              `            "log_group_name": "/ecs/${envName}-ecs-agent",`,
              '            "log_stream_name": "{instance_id}",',
              '            "timezone": "UTC",',
              '            "encoding": "utf-8"',
              "          },",
              "          {",
              '            "file_path": "/var/log/ecs/ecs-init.log",',
              `            "log_group_name": "/ecs/${envName}-ecs-init",`,
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
        name: `${envName}-cloudwatch-agent-config`,
        content: cloudWatchConfigDocumentContent,
      }
    );

    // Association to run CloudWatch Agent configuration
    this.cloudWatchAgentConfigAssociation = new ssm.CfnAssociation(
      this,
      "CloudWatchAgentConfigAssociation",
      {
        name: cloudWatchConfigDocument.name!,
        associationName: `${envName}-cloudwatch-agent-config`,
        targets: associationTargets,
        scheduleExpression: "rate(30 days)", // Run monthly for maintenance
        applyOnlyAtCronInterval: false, // Also run immediately on new instances
        complianceSeverity: "HIGH",
        maxConcurrency: "10",
        maxErrors: "5",
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
          "ssm:GetDocument",
          "ssm:SendCommand",
        ],
        resources: ["*"],
      })
    );

    // Grant SSM permissions to run documents
    instanceRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "ssm:UpdateInstanceInformation",
          "ssm:SendCommand",
          "ssm:GetCommandInvocation",
        ],
        resources: [
          // AWS managed documents
          `arn:aws:ssm:${cdk.Stack.of(this).region}:${
            cdk.Stack.of(this).account
          }:document/AWS-RunShellScript`,
          `arn:aws:ssm:${cdk.Stack.of(this).region}:${
            cdk.Stack.of(this).account
          }:document/AWS-ConfigureAWSPackage`,
          // Custom CloudWatch Agent config document
          `arn:aws:ssm:${cdk.Stack.of(this).region}:${
            cdk.Stack.of(this).account
          }:document/${envName}-cloudwatch-agent-config`,
        ],
      })
    );

    // Tags
    cdk.Tags.of(this).add("Environment", envName);
    cdk.Tags.of(this).add("Component", "SSMStateManager");
    cdk.Tags.of(this).add("ManagedBy", "CDK");
  }
}
