<!-- @format -->

# SSM State Manager Constructs

This directory contains reusable AWS CDK constructs for managing EC2 instance configuration using AWS Systems Manager (SSM) State Manager. These constructs provide a robust alternative to user data scripts with better error handling, retry logic, and centralised management.

## Overview

The `SsmStateManagerConstruct` creates SSM State Manager associations to handle:

- ECS agent configuration and startup
- CloudWatch Agent installation and configuration
- Scheduled configuration compliance checks

## Why SSM State Manager Over User Data?

| Feature | User Data | SSM State Manager |
| ------- | --------- | ----------------- |
| **Update without recreating** | No | Yes |
| **Scheduled execution** | No | Yes |
| **Retry on failure** | Manual | Automatic |
| **Centralised management** | No | SSM Console |
| **Error visibility** | CloudWatch Logs | SSM Dashboard |
| **Compliance tracking** | No | Built-in |
| **Idempotent execution** | Manual | By design |

## Architecture

```
+--------------------------------+
|   SsmStateManagerConstruct     |
+--------------------------------+
         |
         +---> ECS Agent Config Association
         |     +---> AWS-RunShellScript
         |     +---> ECS cluster config
         |     +---> Docker/ECS service management
         |
         +---> CloudWatch Agent Install Association
         |     +---> AWS-ConfigureAWSPackage
         |     +---> Installs AmazonCloudWatchAgent
         |
         +---> CloudWatch Agent Config Association
         |     +---> Custom SSM Document
         |     +---> Log collection configuration
         |
         +---> Log Groups (auto-created)
               +---> Container logs
               +---> ECS agent logs
               +---> ECS init logs
```

## Design Choices

### 1. AWS Managed Documents Where Possible

The construct uses AWS-managed SSM documents when available:

| Task | Document | Reason |
| ---- | -------- | ------ |
| ECS configuration | `AWS-RunShellScript` | Flexible, no custom document needed |
| CloudWatch install | `AWS-ConfigureAWSPackage` | Official AWS installation method |
| CloudWatch config | Custom document | Specific log collection requirements |

**Rationale:** AWS-managed documents are maintained by AWS, reducing maintenance burden and ensuring compatibility with new AMIs.

### 2. Robust Retry Logic

The ECS agent configuration script includes configurable retry settings:

```typescript
ecsAgent: {
  dockerMaxRetries: 10,        // Retries for Docker startup
  dockerRetryDelaySeconds: 5,  // Delay between Docker retries
  ecsStartMaxRetries: 5,       // Retries for ECS service start
  ecsStartRetryDelaySeconds: 10,
  agentCheckMaxRetries: 30,    // Retries for agent verification
  agentCheckDelaySeconds: 5,
}
```

**Rationale:** ECS agents on EC2 instances can fail to start due to timing issues with Docker, networking, or IAM. Retry logic ensures eventual success without manual intervention.

### 3. Environment-Aware Defaults

The construct automatically adjusts settings based on environment:

| Setting | Development | Production |
| ------- | ----------- | ---------- |
| Schedule | Every 30 minutes | Every 30 days |
| Compliance severity | MEDIUM | CRITICAL |
| Log retention | 7 days | 30 days |
| Log removal policy | DESTROY | RETAIN |

### 4. Pre-Created Log Groups

Log groups are created before the CloudWatch Agent starts to prevent runtime failures:

```typescript
// These are created by the construct:
/ecs/{project}-containers    // Docker container logs
/ecs/{project}-ecs-agent     // ECS agent logs
/ecs/{project}-ecs-init      // ECS init logs
```

**Rationale:** CloudWatch Agent can fail if log groups don't exist and it lacks `logs:CreateLogGroup` permission.

## Construct Reference

### SsmStateManagerConstruct

Creates SSM State Manager associations for ECS and CloudWatch configuration.

```typescript
import { SsmStateManagerConstruct } from "../constructs/compute/ssm";

const stateManager = new SsmStateManagerConstruct(this, "StateManager", {
  envName: "production",
  projectName: "monitoring",
  clusterName: cluster.clusterName,
  instanceRole: launchTemplate.role,

  // Optional: Target specific instances
  targets: [
    {
      key: "tag:Environment",
      values: ["production"],
    },
  ],

  // ECS agent configuration
  ecsAgent: {
    scheduleExpression: "rate(7 days)",
    complianceSeverity: "CRITICAL",
    maxConcurrency: "10%",
    maxErrors: "2",
    // Retry settings
    dockerMaxRetries: 10,
    dockerRetryDelaySeconds: 5,
    ecsStartMaxRetries: 5,
    agentCheckMaxRetries: 30,
  },

  // CloudWatch Agent configuration
  cloudWatchAgent: {
    scheduleExpression: "rate(7 days)",
    logConfig: {
      containerLogGroupName: "/ecs/production/containers",
      ecsAgentLogGroupName: "/ecs/production/ecs-agent",
      ecsInitLogGroupName: "/ecs/production/ecs-init",
      logRetention: logs.RetentionDays.ONE_MONTH,
      logGroupKmsKey: myKmsKey,
    },
  },
});
```

### Properties

| Property | Type | Required | Default | Description |
| -------- | ---- | -------- | ------- | ----------- |
| `envName` | `string` | Yes | - | Environment name |
| `projectName` | `string` | No | - | Project name for log group prefixes |
| `clusterName` | `string` | Yes | - | ECS cluster name |
| `instanceRole` | `IRole` | Yes | - | IAM role for EC2 instances |
| `targets` | `TargetProperty[]` | No | Environment tag | SSM association targets |
| `ecsAgent` | `EcsAgentSsmConfig` | No | See below | ECS agent configuration |
| `cloudWatchAgent` | `CloudWatchAgentSsmConfig` | No | See below | CloudWatch configuration |

### ECS Agent Configuration

```typescript
interface EcsAgentSsmConfig {
  // Schedule settings
  scheduleExpression?: string; // Default: rate(30 minutes) dev, rate(30 days) prod
  applyOnlyAtCronInterval?: boolean; // Default: false

  // Compliance settings
  complianceSeverity?: string; // Default: MEDIUM dev, CRITICAL prod
  maxConcurrency?: string; // Default: "50%"
  maxErrors?: string; // Default: "5"

  // Target override
  targets?: TargetProperty[];

  // Retry settings
  dockerMaxRetries?: number; // Default: 10
  dockerRetryDelaySeconds?: number; // Default: 5
  ecsStartMaxRetries?: number; // Default: 5
  ecsStartRetryDelaySeconds?: number; // Default: 10
  agentCheckMaxRetries?: number; // Default: 30
  agentCheckDelaySeconds?: number; // Default: 5
}
```

### CloudWatch Agent Configuration

```typescript
interface CloudWatchAgentSsmConfig {
  // Schedule settings
  scheduleExpression?: string;
  applyOnlyAtCronInterval?: boolean;

  // Compliance settings
  complianceSeverity?: string;
  maxConcurrency?: string;
  maxErrors?: string;

  // Target override
  targets?: TargetProperty[];

  // Log configuration
  logConfig?: {
    containerLogGroupName?: string;
    ecsAgentLogGroupName?: string;
    ecsInitLogGroupName?: string;
    logRetention?: logs.RetentionDays;
    logGroupKmsKey?: kms.IKey;
  };
}
```

### Exposed Properties

| Property | Type | Description |
| -------- | ---- | ----------- |
| `ecsAgentConfigAssociation` | `ssm.CfnAssociation` | ECS agent configuration association |
| `cloudWatchAgentInstallAssociation` | `ssm.CfnAssociation` | CloudWatch Agent install association |
| `cloudWatchAgentConfigAssociation` | `ssm.CfnAssociation` | CloudWatch Agent config association |

### Methods

| Method | Parameters | Description |
| ------ | ---------- | ----------- |
| `getAssociationArn` | `association` | Get ARN for an association |
| `updateAssociationSchedule` | `association, scheduleExpression` | Update schedule for an association |
| `retriggerAssociation` | `association, id?` | Force re-execution of an association |

## Usage Patterns

### Pattern 1: Minimal Setup with Launch Template

Recommended pattern using minimal user data + SSM State Manager:

```typescript
// 1. Create launch template with minimal user data
const launchTemplate = new LaunchTemplateConstruct(this, "LaunchTemplate", {
  vpc,
  envName: "production",
  userDataStrategy: "minimal", // Only installs SSM agent
  ecsConfig: {
    clusterName: cluster.clusterName,
  },
});

// 2. SSM State Manager handles the rest
const stateManager = new SsmStateManagerConstruct(this, "StateManager", {
  envName: "production",
  clusterName: cluster.clusterName,
  instanceRole: launchTemplate.role,
  targets: [
    {
      key: "tag:Environment",
      values: ["production"],
    },
  ],
});
```

### Pattern 2: Production Configuration

Full production setup with stricter compliance:

```typescript
const stateManager = new SsmStateManagerConstruct(this, "StateManager", {
  envName: "production",
  projectName: "monitoring",
  clusterName: cluster.clusterName,
  instanceRole: instanceRole,

  ecsAgent: {
    scheduleExpression: "rate(7 days)",
    complianceSeverity: "CRITICAL",
    maxConcurrency: "10%", // Conservative for production
    maxErrors: "1", // Strict error tolerance
    // Aggressive retry settings
    dockerMaxRetries: 15,
    agentCheckMaxRetries: 60,
  },

  cloudWatchAgent: {
    scheduleExpression: "rate(7 days)",
    complianceSeverity: "CRITICAL",
    logConfig: {
      containerLogGroupName: "/ecs/production/containers",
      logRetention: logs.RetentionDays.THREE_MONTHS,
      logGroupKmsKey: productionKmsKey,
    },
  },
});
```

### Pattern 3: Development Configuration

Faster iteration with frequent updates:

```typescript
const stateManager = new SsmStateManagerConstruct(this, "StateManager", {
  envName: "development",
  clusterName: "dev-cluster",
  instanceRole: devRole,

  ecsAgent: {
    scheduleExpression: "rate(30 minutes)",
    complianceSeverity: "LOW",
    maxConcurrency: "100%", // All at once for dev
    maxErrors: "10", // More lenient
  },

  cloudWatchAgent: {
    logConfig: {
      logRetention: logs.RetentionDays.ONE_WEEK,
      // No KMS for cost savings in dev
    },
  },
});
```

### Pattern 4: Custom Targets

Target specific instance groups:

```typescript
const stateManager = new SsmStateManagerConstruct(this, "StateManager", {
  envName: "production",
  clusterName: cluster.clusterName,
  instanceRole: instanceRole,

  // Target by multiple criteria
  targets: [
    {
      key: "tag:Cluster",
      values: [cluster.clusterName],
    },
  ],

  // Different targets for each association
  ecsAgent: {
    targets: [
      {
        key: "tag:Service",
        values: ["ecs-worker"],
      },
    ],
  },

  cloudWatchAgent: {
    targets: [
      {
        key: "tag:Monitoring",
        values: ["enabled"],
      },
    ],
  },
});
```

### Pattern 5: Manual Trigger After Deployment

Force immediate execution after deployment:

```typescript
const stateManager = new SsmStateManagerConstruct(this, "StateManager", {
  envName: "production",
  clusterName: cluster.clusterName,
  instanceRole: instanceRole,
});

// Force ECS configuration to run immediately
stateManager.retriggerAssociation(
  stateManager.ecsAgentConfigAssociation,
  "ImmediateEcsConfig"
);
```

## Schedule Expression Examples

| Expression | Description |
| ---------- | ----------- |
| `rate(30 minutes)` | Every 30 minutes |
| `rate(1 hour)` | Every hour |
| `rate(1 day)` | Daily |
| `rate(7 days)` | Weekly |
| `rate(30 days)` | Monthly |
| `cron(0 2 ? * SUN *)` | Every Sunday at 2 AM |
| `cron(0 0 1 * ? *)` | First day of each month |

## What the Construct Creates

### 1. ECS Agent Configuration Script

The construct generates a shell script that:

```bash
# 1. Configures ECS cluster settings
ECS_CLUSTER=my-cluster
ECS_ENABLE_CONTAINER_METADATA=true
ECS_ENABLE_TASK_IAM_ROLE=true
ECS_AWSVPC_BLOCK_IMDS=true
ECS_AVAILABLE_LOGGING_DRIVERS=["json-file","awslogs"]

# 2. Ensures Docker is running (with retries)
# 3. Pre-pulls ECS agent Docker image
# 4. Configures ECS systemd service with restart policy
# 5. Starts/restarts ECS agent
# 6. Verifies agent is running and stable
```

### 2. CloudWatch Agent Configuration

The CloudWatch Agent is configured to collect:

| Log Source | Log Group | Description |
| ---------- | --------- | ----------- |
| `/var/lib/docker/containers/*/*-json.log` | `{project}-containers` | Container stdout/stderr |
| `/var/log/ecs/ecs-agent.log` | `{project}-ecs-agent` | ECS agent logs |
| `/var/log/ecs/ecs-init.log` | `{project}-ecs-init` | ECS init logs |

### 3. IAM Permissions

The construct adds these permissions to the instance role:

```typescript
// SSM association management
"ssm:DescribeInstanceInformation";
"ssm:ListAssociations";
"ssm:ListInstanceAssociations";
"ssm:DescribeAssociation";
"ssm:UpdateInstanceInformation";

// Document execution
"ssm:GetDocument";
"ssm:SendCommand";
"ssm:GetCommandInvocation";
```

## Best Practices

### 1. Use Tags for Targeting

```typescript
// Good: Target by specific tags
targets: [
  {
    key: "tag:Environment",
    values: ["production"],
  },
  {
    key: "tag:Cluster",
    values: ["monitoring-cluster"],
  },
];

// Avoid: Targeting all instances
targets: [
  {
    key: "InstanceIds",
    values: ["*"],
  },
];
```

### 2. Set Appropriate Schedules

```typescript
// Production: Weekly to monthly
scheduleExpression: "rate(7 days)";

// Development: Frequent for rapid iteration
scheduleExpression: "rate(30 minutes)";

// Critical infrastructure: Daily
scheduleExpression: "cron(0 3 * * ? *)"; // 3 AM daily
```

### 3. Monitor Association Compliance

Check SSM console for:

- Association execution status
- Compliance summary
- Failed executions and error messages

### 4. Use KMS for Production Logs

```typescript
cloudWatchAgent: {
  logConfig: {
    logGroupKmsKey: productionKmsKey, // Always encrypt production logs
  },
},
```

## Troubleshooting

### Association Not Running

**Symptoms:** Instances not being configured.

**Solutions:**

1. Verify targets match instance tags
2. Check IAM role has SSM permissions
3. Ensure SSM agent is running on instances
4. Review SSM console for association errors

### ECS Agent Not Starting

**Symptoms:** Instances not appearing in ECS cluster.

**Solutions:**

1. Check association execution in SSM console
2. Review `/var/log/ecs/ecs-agent.log`
3. Verify Docker is running: `systemctl status docker`
4. Check ECS config: `cat /etc/ecs/ecs.config`

### CloudWatch Logs Not Appearing

**Symptoms:** Log groups exist but no log streams.

**Solutions:**

1. Verify CloudWatch Agent is running
2. Check agent config: `/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json`
3. Review agent logs: `/opt/aws/amazon-cloudwatch-agent/logs/amazon-cloudwatch-agent.log`
4. Ensure IAM role has `logs:PutLogEvents` permission

### Association Failing with Access Denied

**Symptoms:** Association shows "Access Denied" errors.

**Solutions:**

1. Verify instance role has SSM document permissions
2. Check document ARN in IAM policy
3. Ensure instance can reach SSM endpoints (check VPC endpoints or internet access)

## Viewing Association Status

### AWS Console

1. Navigate to **Systems Manager** > **State Manager**
2. Find association by name (e.g., `{stack}-production-ecs-agent-config`)
3. View **Execution history** for run details

### AWS CLI

```bash
# List associations
aws ssm list-associations --association-filter-list \
  "key=AssociationName,value=my-stack-production-ecs-agent-config"

# Get association details
aws ssm describe-association --association-id <association-id>

# View execution history
aws ssm list-association-versions --association-id <association-id>
```

## Related Constructs

- `LaunchTemplateConstruct` - Creates launch templates with minimal user data
- `EcsClusterConstruct` - Creates ECS cluster for SSM-managed instances
- `Ec2InstanceRole` - IAM role with SSM permissions

## Additional Resources

- [SSM State Manager](https://docs.aws.amazon.com/systems-manager/latest/userguide/systems-manager-state.html)
- [SSM Documents](https://docs.aws.amazon.com/systems-manager/latest/userguide/sysman-doc-syntax.html)
- [CloudWatch Agent Configuration](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-Agent-Configuration-File-Details.html)
- [ECS Container Instance Configuration](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ecs-agent-config.html)
