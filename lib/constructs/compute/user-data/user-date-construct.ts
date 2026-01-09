/** @format */

import * as ec2 from "aws-cdk-lib/aws-ec2";
import { Construct } from "constructs";

export interface MinimalUserDataProps {
  envName: string;
  clusterName: string;
}

/**
 * Minimal UserData for SSM Bootstrap
 *
 * This construct creates a minimal user data script that ONLY handles:
 * 1. SSM agent installation and startup (required for Session Manager and State Manager)
 *
 * Goal: Get SSM agent running ASAP so State Manager can take over
 *
 * All other setup is handled by SSM State Manager Associations:
 * - ECS agent setup and configuration
 * - CloudWatch Agent installation and configuration
 *
 * Application setup (EFS, Prometheus, Grafana) is handled separately via:
 * - Lambda function triggered by ECS instance registration event
 * - SSM Run Command for application setup
 */
export class MinimalUserDataConstruct extends Construct {
  public readonly userData: ec2.UserData;

  constructor(scope: Construct, id: string, props: MinimalUserDataProps) {
    super(scope, id);

    // Create UserData object
    this.userData = ec2.UserData.forLinux();

    // Build minimal user data script
    this.userData.addCommands(
      "#!/bin/bash",
      "# ==========================================================================",
      `# MINIMAL USER DATA - ${props.envName.toUpperCase()}`,
      "# Purpose: Infrastructure Registration Only (SSM + ECS)",
      "# Application setup handled by Lambda + SSM Run Command",
      "# ==========================================================================",
      "",
      "# Enable logging",
      "exec > >(tee /var/log/user-data.log|logger -t user-data -s 2>/dev/console) 2>&1",
      "",
      "echo '========================================='",
      `echo 'SSM Bootstrap - ${props.envName}'`,
      "echo 'Timestamp:' $(date)",
      "echo '========================================='",
      "",
      "# ==========================================================================",
      "# SSM AGENT INSTALLATION AND STARTUP",
      "# ==========================================================================",
      "# This is the ONLY thing UserData does - get SSM agent running",
      "# All other setup (ECS agent, CloudWatch Agent) is handled by SSM State Manager",
      "",
      "echo 'Installing and starting SSM agent...'",
      "",
      "# Choose package manager (AL2023 uses dnf, AL2 uses yum)",
      "PKG_MGR=yum",
      "command -v dnf >/dev/null 2>&1 && PKG_MGR=dnf",
      "",
      "# Install SSM agent",
      "$PKG_MGR -y install amazon-ssm-agent || echo 'WARNING: SSM agent installation failed'",
      "",
      "# Enable and start SSM agent",
      "systemctl enable amazon-ssm-agent || true",
      "systemctl start amazon-ssm-agent || true",
      "",
      "# Verify SSM agent is running (with retries)",
      "SSM_RETRY_COUNT=0",
      "SSM_MAX_RETRIES=12", // 2 minutes total (10s * 12)
      "while [ $SSM_RETRY_COUNT -lt $SSM_MAX_RETRIES ]; do",
      "  if systemctl is-active amazon-ssm-agent >/dev/null 2>&1; then",
      "    echo '✓ SSM agent is running'",
      "    break",
      "  else",
      "    SSM_RETRY_COUNT=$((SSM_RETRY_COUNT + 1))",
      '    echo "SSM agent not active yet (attempt $SSM_RETRY_COUNT/$SSM_MAX_RETRIES), waiting 10s..."',
      "    systemctl start amazon-ssm-agent >/dev/null 2>&1 || true",
      "    sleep 10",
      "  fi",
      "done",
      "",
      "if ! systemctl is-active amazon-ssm-agent >/dev/null 2>&1; then",
      "  echo 'WARNING: SSM agent not active after $SSM_MAX_RETRIES attempts'",
      "  echo 'SSM State Manager associations will not run until SSM agent is active'",
      "else",
      "  echo '✓ SSM agent is running and ready for State Manager'",
      "  echo 'SSM State Manager will now handle:'",
      "  echo '  - ECS agent setup and configuration'",
      "  echo '  - CloudWatch Agent installation and configuration'",
      "fi",
      "",
      "echo '========================================='",
      "echo '✓ SSM bootstrap completed!'",
      "echo 'SSM State Manager will handle remaining setup'",
      "echo 'Timestamp:' $(date)",
      "echo 'Log file: /var/log/user-data.log'",
      "echo '========================================='"
    );
  }
}
