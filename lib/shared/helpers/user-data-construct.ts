/** @format */

import * as ec2 from "aws-cdk-lib/aws-ec2";
import { Construct } from "constructs";

import { UserDataConstructProps } from "../types/compute-types";

/**
 * Enhanced UserData Construct for SSM-Managed Bootstrap
 *
 * Creates minimal user data that focuses on SSM agent installation with
 * optional enhancements for production reliability:
 *
 * Core Functionality:
 * - SSM agent installation and verification
 * - CloudFormation signalling for stack completion tracking
 * - Bootstrap metadata storage in SSM Parameter Store
 * - Optional system package updates
 *
 * Architecture Philosophy:
 * This construct follows the "SSM-First" bootstrap pattern where UserData
 * is kept minimal and all complex configuration is handled by SSM State
 * Manager associations. This provides:
 * - Faster boot times (30-60 seconds vs 3-5 minutes)
 * - Better debuggability (SSM console visibility)
 * - Easier updates (modify associations, not instances)
 * - Improved reliability (built-in retry logic)
 *
 * CloudFormation Signalling:
 * When stackName and logicalResourceId are provided, UserData will signal
 * CloudFormation on completion. This ensures the stack doesn't report
 * CREATE_COMPLETE until instances are actually ready, preventing premature
 * deployment of dependent resources.
 *
 * Metadata Tracking:
 * Bootstrap metadata is stored in SSM Parameter Store at:
 * /{prefix}/{envName}/instances/{instanceId}
 *
 * This enables:
 * - Querying which instances have been bootstrapped successfully
 * - Tracking bootstrap configuration versions
 * - Auditing for compliance and troubleshooting
 *
 * @example
 * ```typescript
 * const userData = new UserDataConstruct(this, 'UserData', {
 *   envName: 'production',
 *   clusterName: 'my-ecs-cluster',
 *   stackName: Stack.of(this).stackName,
 *   logicalResourceId: 'EcsAutoScalingGroup',
 *   region: Stack.of(this).region,
 *   enableSystemUpdates: true,
 *   enableMetadataTracking: true,
 * });
 * ```
 */
export class UserDataConstruct extends Construct {
  public readonly userData: ec2.UserData;
  private readonly props: UserDataConstructProps;

  constructor(scope: Construct, id: string, props: UserDataConstructProps) {
    super(scope, id);

    this.props = props;
    this.userData = ec2.UserData.forLinux();

    // Build the complete bootstrap script
    this.buildUserData();
  }

  // ========================================================================
  // USER DATA CONSTRUCTION
  // ========================================================================

  /**
   * Build the complete user data script
   *
   * Orchestrates the construction of all user data sections in the correct order:
   * 1. Header and logging setup
   * 2. Helper functions
   * 3. Metadata collection
   * 4. Optional system updates
   * 5. SSM agent installation
   * 6. Optional metadata storage
   * 7. CloudFormation signal
   */
  private buildUserData(): void {
    this.addHeader();
    this.addHelperFunctions();
    this.addMetadataCollection();

    if (this.shouldEnableSystemUpdates()) {
      this.addSystemUpdates();
    }

    this.addSsmAgentInstallation();

    if (this.shouldEnableMetadataTracking()) {
      this.addMetadataStorage();
    }

    if (this.shouldSendCfnSignal()) {
      this.addCloudFormationSignal();
    }

    this.addFooter();
  }

  // ========================================================================
  // CONFIGURATION HELPERS
  // ========================================================================

  /**
   * Determine if system updates should be enabled
   * Defaults to false for faster boot times in non-production
   */
  private shouldEnableSystemUpdates(): boolean {
    if (this.props.enableSystemUpdates !== undefined) {
      return this.props.enableSystemUpdates;
    }
    // Default to true for production environments
    return this.props.envName.toLowerCase().includes("prod");
  }

  /**
   * Determine if metadata tracking should be enabled
   * Defaults to true for auditing and troubleshooting
   */
  private shouldEnableMetadataTracking(): boolean {
    return this.props.enableMetadataTracking !== false;
  }

  /**
   * Determine if CloudFormation signal should be sent
   * Requires both stackName and logicalResourceId
   */
  private shouldSendCfnSignal(): boolean {
    return !!(
      this.props.stackName &&
      this.props.logicalResourceId &&
      this.props.region
    );
  }

  /**
   * Get the metadata parameter path for this instance
   */
  private getMetadataParameterPath(): string {
    const prefix = this.props.metadataParameterPrefix ?? "/bootstrap";
    return `${prefix}/${this.props.envName}/instances/\${INSTANCE_ID}`;
  }

  /**
   * Get the bootstrap version identifier
   */
  private getBootstrapVersion(): string {
    return this.props.bootstrapVersion ?? new Date().toISOString();
  }

  // ========================================================================
  // USER DATA SECTIONS
  // ========================================================================

  /**
   * Add script header and logging setup
   * Configures output redirection to both log file and console
   */
  private addHeader(): void {
    this.userData.addCommands(
      "#!/bin/bash",
      "set -e",
      "set -o pipefail",
      "",
      "# ==========================================================================",
      `# ENHANCED USER DATA - ${this.props.envName.toUpperCase()}`,
      "# Purpose: SSM Agent Bootstrap with CloudFormation Signalling",
      "# All complex configuration handled by SSM State Manager",
      `# Bootstrap Version: ${this.getBootstrapVersion()}`,
      "# ==========================================================================",
      "",
      "# Enable comprehensive logging",
      "exec > >(tee /var/log/user-data.log|logger -t user-data -s 2>/dev/console) 2>&1",
      "",
      "echo '========================================='",
      `echo 'Bootstrap Started - ${this.props.envName}'`,
      "echo 'Timestamp:' $(date)",
      "echo '========================================='",
      ""
    );
  }

  /**
   * Add helper functions for error handling and CloudFormation signalling
   * These functions are used throughout the bootstrap process
   */
  private addHelperFunctions(): void {
    this.userData.addCommands(
      "# ==========================================================================",
      "# HELPER FUNCTIONS",
      "# ==========================================================================",
      "",
      "# Error handler - called when script encounters an error",
      "handle_error() {",
      "  local exit_code=$?",
      "  local line_number=$1",
      "  echo 'ERROR: Bootstrap failed at line $line_number with exit code $exit_code'",
      "  echo 'Check /var/log/user-data.log for details'",
      "  ",
      "  # Send failure signal to CloudFormation if configured",
      this.shouldSendCfnSignal()
        ? "  send_cfn_signal 'FAILURE' 'Bootstrap failed at line $line_number'"
        : "  echo 'CloudFormation signalling not configured'",
      "  ",
      "  exit $exit_code",
      "}",
      "",
      "# Set error trap",
      "trap 'handle_error ${LINENO}' ERR",
      ""
    );

    if (this.shouldSendCfnSignal()) {
      this.userData.addCommands(
        "# CloudFormation signal helper",
        "send_cfn_signal() {",
        "  local status=$1",
        "  local reason=$2",
        `  local stack_name='${this.props.stackName}'`,
        `  local logical_id='${this.props.logicalResourceId}'`,
        `  local region='${this.props.region}'`,
        "  ",
        "  echo 'Sending CloudFormation signal: $status'",
        "  ",
        "  /opt/aws/bin/cfn-signal \\",
        '    --success "$status" \\',
        '    --reason "$reason" \\',
        '    --stack "$stack_name" \\',
        '    --resource "$logical_id" \\',
        '    --region "$region" || {',
        "      echo 'WARNING: Failed to send CloudFormation signal'",
        "      return 1",
        "    }",
        "  ",
        "  echo 'CloudFormation signal sent successfully'",
        "}",
        ""
      );
    }
  }

  /**
   * Collect instance metadata from EC2 metadata service
   * This information is used for logging and metadata storage
   */
  private addMetadataCollection(): void {
    this.userData.addCommands(
      "# ==========================================================================",
      "# COLLECT INSTANCE METADATA",
      "# ==========================================================================",
      "",
      "echo 'Collecting instance metadata...'",
      "",
      "# EC2 metadata service endpoint",
      "METADATA_URL='http://169.254.169.254/latest/meta-data'",
      "INSTANCE_ID=$(curl -s $METADATA_URL/instance-id || echo 'unknown')",
      "INSTANCE_TYPE=$(curl -s $METADATA_URL/instance-type || echo 'unknown')",
      "AMI_ID=$(curl -s $METADATA_URL/ami-id || echo 'unknown')",
      "AVAILABILITY_ZONE=$(curl -s $METADATA_URL/placement/availability-zone || echo 'unknown')",
      "PRIVATE_IP=$(curl -s $METADATA_URL/local-ipv4 || echo 'unknown')",
      "",
      "echo 'Instance ID: '$INSTANCE_ID",
      "echo 'Instance Type: '$INSTANCE_TYPE",
      "echo 'AMI ID: '$AMI_ID",
      "echo 'Availability Zone: '$AVAILABILITY_ZONE",
      "echo 'Private IP: '$PRIVATE_IP",
      ""
    );
  }

  /**
   * Add optional system package updates
   * Updates all system packages to latest versions for security
   * Note: This increases boot time by 1-3 minutes
   */
  private addSystemUpdates(): void {
    this.userData.addCommands(
      "# ==========================================================================",
      "# SYSTEM UPDATES",
      "# ==========================================================================",
      "",
      "echo 'Performing system updates...'",
      "echo 'NOTE: This may take 1-3 minutes depending on available updates'",
      "",
      "# Detect package manager",
      "PKG_MGR=yum",
      "command -v dnf >/dev/null 2>&1 && PKG_MGR=dnf",
      "",
      "# Update system packages",
      "echo 'Running $PKG_MGR update...'",
      "$PKG_MGR update -y --security || {",
      "  echo 'WARNING: Security updates failed, attempting full update'",
      "  $PKG_MGR update -y || echo 'WARNING: Full update failed'",
      "}",
      "",
      "echo 'System updates completed'",
      ""
    );
  }

  /**
   * Add SSM agent installation and verification
   * Core bootstrap functionality - installs and verifies SSM agent
   */
  private addSsmAgentInstallation(): void {
    this.userData.addCommands(
      "# ==========================================================================",
      "# SSM AGENT INSTALLATION",
      "# ==========================================================================",
      "",
      "echo 'Installing SSM agent...'",
      "",
      "# Detect package manager",
      "PKG_MGR=yum",
      "command -v dnf >/dev/null 2>&1 && PKG_MGR=dnf",
      "",
      "# Install SSM agent",
      "$PKG_MGR install -y amazon-ssm-agent || {",
      "  echo 'ERROR: SSM agent installation failed'",
      "  exit 1",
      "}",
      "",
      "# Enable and start SSM agent",
      "systemctl enable amazon-ssm-agent",
      "systemctl start amazon-ssm-agent",
      "",
      "# Verify SSM agent with retries",
      "echo 'Verifying SSM agent...'",
      "SSM_RETRY_COUNT=0",
      "SSM_MAX_RETRIES=12",
      "SSM_AGENT_RUNNING=false",
      "",
      "while [ $SSM_RETRY_COUNT -lt $SSM_MAX_RETRIES ]; do",
      "  if systemctl is-active amazon-ssm-agent >/dev/null 2>&1; then",
      "    echo 'SSM agent is running'",
      "    SSM_AGENT_RUNNING=true",
      "    break",
      "  else",
      "    SSM_RETRY_COUNT=$((SSM_RETRY_COUNT + 1))",
      '    echo "Verification attempt $SSM_RETRY_COUNT/$SSM_MAX_RETRIES..."',
      "    systemctl start amazon-ssm-agent >/dev/null 2>&1 || true",
      "    sleep 10",
      "  fi",
      "done",
      "",
      'if [ "$SSM_AGENT_RUNNING" != "true" ]; then',
      "  echo 'ERROR: SSM agent not running after $SSM_MAX_RETRIES attempts'",
      "  systemctl status amazon-ssm-agent || true",
      "  exit 1",
      "fi",
      "",
      "echo 'SSM agent verified successfully'",
      "echo ''",
      "echo 'SSM State Manager will handle:'",
      "echo '  - ECS agent configuration'",
      "echo '  - CloudWatch Agent installation'",
      "echo '  - Log collection setup'",
      "echo '  - Security hardening'",
      ""
    );
  }

  /**
   * Add metadata storage to SSM Parameter Store
   * Stores bootstrap information for tracking and auditing
   */
  private addMetadataStorage(): void {
    const parameterPath = this.getMetadataParameterPath();
    const bootstrapVersion = this.getBootstrapVersion();

    this.userData.addCommands(
      "# ==========================================================================",
      "# STORE BOOTSTRAP METADATA",
      "# ==========================================================================",
      "",
      "echo 'Storing bootstrap metadata in SSM Parameter Store...'",
      "",
      "# Build metadata JSON",
      "METADATA_JSON=$(cat <<EOF",
      "{",
      '  "bootstrapVersion": "' + bootstrapVersion + '",',
      '  "bootstrapTimestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",',
      '  "environment": "' + this.props.envName + '",',
      '  "clusterName": "' + this.props.clusterName + '",',
      '  "instanceId": "$INSTANCE_ID",',
      '  "instanceType": "$INSTANCE_TYPE",',
      '  "amiId": "$AMI_ID",',
      '  "availabilityZone": "$AVAILABILITY_ZONE",',
      '  "privateIp": "$PRIVATE_IP",',
      '  "ssmAgentVersion": "$(rpm -q amazon-ssm-agent --queryformat %{VERSION} 2>/dev/null || echo unknown)"',
      "}",
      "EOF",
      ")",
      "",
      `# Store metadata in SSM Parameter Store at ${parameterPath}`,
      "aws ssm put-parameter \\",
      `  --name '${parameterPath}' \\`,
      '  --value "$METADATA_JSON" \\',
      "  --type String \\",
      "  --overwrite \\",
      `  --tags Key=Environment,Value=${this.props.envName} Key=ClusterName,Value=${this.props.clusterName} Key=ManagedBy,Value=UserData \\`,
      `  --region ${this.props.region ?? "eu-west-2"} || {`,
      "    echo 'WARNING: Failed to store bootstrap metadata'",
      "    echo 'Instance will continue but metadata will not be tracked'",
      "  }",
      "",
      "echo 'Bootstrap metadata stored successfully'",
      ""
    );
  }

  /**
   * Add CloudFormation signal for stack completion tracking
   * Signals CloudFormation that bootstrap completed successfully
   */
  private addCloudFormationSignal(): void {
    this.userData.addCommands(
      "# ==========================================================================",
      "# CLOUDFORMATION SIGNAL",
      "# ==========================================================================",
      "",
      "echo 'Sending CloudFormation completion signal...'",
      "",
      "send_cfn_signal 'SUCCESS' 'Bootstrap completed successfully' || {",
      "  echo 'WARNING: Failed to send CloudFormation signal'",
      "  echo 'Instance is ready but stack may show incomplete'",
      "}",
      ""
    );
  }

  /**
   * Add script footer with completion message
   */
  private addFooter(): void {
    this.userData.addCommands(
      "# ==========================================================================",
      "# BOOTSTRAP COMPLETE",
      "# ==========================================================================",
      "",
      "echo '========================================='",
      "echo 'Bootstrap Completed Successfully'",
      "echo 'Timestamp: '$(date)",
      "echo 'Instance ID: '$INSTANCE_ID",
      "echo 'SSM Agent: Running'",
      this.shouldSendCfnSignal()
        ? "echo 'CloudFormation: Signalled'"
        : "echo 'CloudFormation: Not configured'",
      this.shouldEnableMetadataTracking()
        ? "echo 'Metadata: Stored in SSM Parameter Store'"
        : "echo 'Metadata: Not tracked'",
      "echo ''",
      "echo 'Instance is ready for SSM State Manager associations'",
      "echo '========================================='",
      ""
    );
  }
}
