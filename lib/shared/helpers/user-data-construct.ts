/** @format */

import * as ec2 from "aws-cdk-lib/aws-ec2";
import { Construct } from "constructs";

export interface UserDataProps {
  envName: string;
  clusterName: string;
}

/**
 * Minimal UserData for SSM Bootstrap
 *
 * Creates user data that ONLY installs and starts SSM agent.
 * All other setup handled by SSM State Manager.
 *
 * Benefits:
 * - Fast boot time (~30 seconds)
 * - Idempotent (SSM State Manager retries)
 * - Easy to update (modify State Manager associations)
 * - Better debugging (SSM console visibility)
 */
export class UserDataConstruct extends Construct {
  public readonly userData: ec2.UserData;

  constructor(scope: Construct, id: string, props: UserDataProps) {
    super(scope, id);

    this.userData = ec2.UserData.forLinux();

    this.userData.addCommands(
      "#!/bin/bash",
      "# ==========================================================================",
      `# MINIMAL USER DATA - ${props.envName.toUpperCase()}`,
      "# Purpose: SSM Agent Bootstrap Only",
      "# All other setup handled by SSM State Manager",
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
      "# Choose package manager",
      "PKG_MGR=yum",
      "command -v dnf >/dev/null 2>&1 && PKG_MGR=dnf",
      "",
      "# Install SSM agent",
      "echo 'Installing SSM agent...'",
      "$PKG_MGR -y install amazon-ssm-agent || echo 'WARNING: SSM agent installation failed'",
      "",
      "# Enable and start SSM agent",
      "systemctl enable amazon-ssm-agent || true",
      "systemctl start amazon-ssm-agent || true",
      "",
      "# Verify SSM agent with retries",
      "SSM_RETRY_COUNT=0",
      "SSM_MAX_RETRIES=12",
      "while [ $SSM_RETRY_COUNT -lt $SSM_MAX_RETRIES ]; do",
      "  if systemctl is-active amazon-ssm-agent >/dev/null 2>&1; then",
      "    echo '✓ SSM agent is running'",
      "    break",
      "  else",
      "    SSM_RETRY_COUNT=$((SSM_RETRY_COUNT + 1))",
      '    echo "Attempt $SSM_RETRY_COUNT/$SSM_MAX_RETRIES, waiting 10s..."',
      "    systemctl start amazon-ssm-agent >/dev/null 2>&1 || true",
      "    sleep 10",
      "  fi",
      "done",
      "",
      "if systemctl is-active amazon-ssm-agent >/dev/null 2>&1; then",
      "  echo '✓ SSM agent is running and ready'",
      "  echo 'SSM State Manager will handle:'",
      "  echo '  - ECS agent configuration'",
      "  echo '  - CloudWatch Agent installation'",
      "  echo '  - Security hardening'",
      "else",
      "  echo 'WARNING: SSM agent not active'",
      "fi",
      "",
      "echo '========================================='",
      "echo '✓ SSM bootstrap completed'",
      "echo 'Timestamp:' $(date)",
      "echo '========================================='"
    );
  }
}
