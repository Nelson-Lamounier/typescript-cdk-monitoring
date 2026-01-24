<!-- @format -->

# Launch Template Constructs

This directory contains reusable AWS CDK constructs for creating EC2 Launch Templates with flexible user data strategies, security best practices, and ECS integration.

## Overview

The `LaunchTemplateConstruct` provides a standardised way to create EC2 launch templates with:

- Multiple user data strategies (minimal, comprehensive, custom)
- Security-hardened defaults (IMDSv2, encrypted volumes)
- ECS cluster integration
- Monitoring agent installation options
- IAM role management with least privilege

## Architecture

```
+---------------------------+
| LaunchTemplateConstruct   |
+---------------------------+
         |
         +---> Security Group (auto-created or custom)
         |
         +---> IAM Role (Ec2InstanceRole)
         |
         +---> User Data
         |     +---> Minimal (SSM Bootstrap)
         |     +---> Comprehensive (All-in-One)
         |     +---> Custom
         |
         +---> Launch Template
               +---> Instance Type
               +---> Machine Image
               +---> Block Devices
               +---> Network Config
```

## Design Choices

### 1. User Data Strategies

The construct supports three distinct user data strategies:

| Strategy | Boot Time | Use Case | SSM Required |
| -------- | --------- | -------- | ------------ |
| **Minimal** | ~30 seconds | Production with SSM State Manager | Yes |
| **Comprehensive** | 3-5 minutes | Standalone instances, development | No |
| **Custom** | Varies | Full control over setup | Depends |

**Rationale:** Different deployment scenarios require different approaches. Production environments benefit from fast boot times with SSM-managed configuration, while development may prefer all-in-one setup.

### 2. Minimal Strategy (Recommended for Production)

The minimal strategy only installs and starts the SSM agent:

```
Boot Sequence:
1. Install SSM agent (~10s)
2. Start SSM agent (~5s)
3. Verify agent running (~15s)
4. DONE - Instance ready for SSM State Manager
```

**Benefits:**

- Fast instance launch (critical for auto-scaling)
- Idempotent configuration (SSM retries on failure)
- Easy updates (modify State Manager, not AMI)
- Better visibility (SSM console shows status)

### 3. Security Defaults

The construct enforces security best practices:

| Security Feature | Default | Description |
| ---------------- | ------- | ----------- |
| IMDSv2 | Required | Prevents SSRF attacks on metadata service |
| HTTP Tokens | Required | Enforces token-based metadata access |
| EBS Encryption | Enabled | All volumes encrypted by default |
| Outbound Traffic | Restricted | Only HTTPS (443) and NTP (123) allowed |

### 4. ECS Integration

When `ecsConfig` is provided, the construct automatically:

- Attaches ECS instance policies to the IAM role
- Configures ECS agent in user data
- Adds appropriate tags for ECS service discovery

## Construct Reference

### LaunchTemplateConstruct

Creates an EC2 launch template with configurable user data and security settings.

```typescript
import { LaunchTemplateConstruct } from "../constructs/compute/launch-template";

const launchTemplate = new LaunchTemplateConstruct(this, "MyLaunchTemplate", {
  vpc: myVpc,
  envName: "production",
  projectName: "monitoring",

  // User data strategy
  userDataStrategy: "minimal",

  // ECS configuration
  ecsConfig: {
    clusterName: "my-ecs-cluster",
    enableContainerMetadata: true,
    enableTaskIamRole: true,
  },

  // Instance configuration
  instanceType: new ec2.InstanceType("t3.medium"),
  machineImage: ecs.EcsOptimizedImage.amazonLinux2023(),

  // Monitoring
  monitoring: {
    installNodeExporter: false,
    installCloudWatchAgent: false,
  },

  // Optional overrides
  launchTemplateName: "my-custom-template",
  enableDetailedMonitoring: true,
  associatePublicIpAddress: false,
});

// Add custom security rules
launchTemplate.addIngressRule(
  ec2.Peer.ipv4("10.0.0.0/8"),
  ec2.Port.tcp(9100),
  "Allow Prometheus scraping"
);
```

### Properties

| Property | Type | Required | Default | Description |
| -------- | ---- | -------- | ------- | ----------- |
| `vpc` | `IVpc` | Yes | - | VPC for security group |
| `envName` | `string` | Yes | - | Environment name |
| `projectName` | `string` | No | - | Project name for tagging |
| `userDataStrategy` | `'minimal' \| 'comprehensive'` | No | `'minimal'` | User data strategy |
| `userData` | `UserData` | No | - | Custom user data (overrides strategy) |
| `ecsConfig` | `EcsConfig` | No | - | ECS cluster configuration |
| `monitoring` | `MonitoringConfig` | No | - | Monitoring agents to install |
| `instanceType` | `InstanceType` | No | `t3.micro` | EC2 instance type |
| `machineImage` | `IMachineImage` | No | ECS AL2023 | AMI to use |
| `securityGroup` | `ISecurityGroup` | No | Auto-created | Custom security group |
| `additionalSecurityGroups` | `ISecurityGroup[]` | No | - | Additional security groups |
| `role` | `IRole` | No | Auto-created | Custom IAM role |
| `keyPair` | `IKeyPair` | No | - | SSH key pair |
| `blockDevices` | `BlockDevice[]` | No | 30GB GP3 | Block device configuration |
| `enableDetailedMonitoring` | `boolean` | No | `false` | CloudWatch detailed monitoring |
| `associatePublicIpAddress` | `boolean` | No | `false` | Assign public IP |
| `launchTemplateName` | `string` | No | Stack-based | Custom template name |
| `customTags` | `Record<string, string>` | No | - | Additional tags |

### ECS Configuration Options

```typescript
interface EcsConfig {
  clusterName: string; // Required: ECS cluster name
  enableContainerMetadata?: boolean; // Default: true
  enableTaskIamRole?: boolean; // Default: true
}
```

### Monitoring Configuration Options

```typescript
interface MonitoringConfig {
  installNodeExporter?: boolean; // Install Prometheus Node Exporter
  installCloudWatchAgent?: boolean; // Install CloudWatch Agent
}
```

### Exposed Properties

| Property | Type | Description |
| -------- | ---- | ----------- |
| `launchTemplate` | `ec2.LaunchTemplate` | The EC2 launch template |
| `securityGroup` | `ec2.SecurityGroup` | The security group |
| `role` | `iam.IRole` | The IAM instance role |

### Methods

| Method | Parameters | Description |
| ------ | ---------- | ----------- |
| `addIngressRule` | `peer, connection, description?` | Add inbound security rule |
| `addEgressRule` | `peer, connection, description?` | Add outbound security rule |
| `grantPermissions` | `policyStatement` | Add IAM permissions to role |

## Usage Patterns

### Pattern 1: Minimal User Data with SSM State Manager

Recommended for production environments:

```typescript
// Launch template with minimal user data
const launchTemplate = new LaunchTemplateConstruct(this, "EcsLaunchTemplate", {
  vpc,
  envName: "production",
  userDataStrategy: "minimal",
  ecsConfig: {
    clusterName: cluster.clusterName,
  },
  instanceType: new ec2.InstanceType("t3.medium"),
});

// SSM State Manager handles the rest
new SsmStateManagerConstruct(this, "StateManager", {
  envName: "production",
  clusterName: cluster.clusterName,
  instanceRole: launchTemplate.role,
  ecsAgent: {
    scheduleExpression: "rate(30 minutes)",
  },
  cloudWatchAgent: {
    logConfig: {
      containerLogGroupName: "/ecs/production/containers",
    },
  },
});
```

### Pattern 2: Comprehensive User Data (Standalone)

For development or environments without SSM State Manager:

```typescript
const launchTemplate = new LaunchTemplateConstruct(this, "DevLaunchTemplate", {
  vpc,
  envName: "development",
  userDataStrategy: "comprehensive",
  ecsConfig: {
    clusterName: "dev-cluster",
  },
  monitoring: {
    installNodeExporter: true,
    installCloudWatchAgent: true,
  },
  instanceType: new ec2.InstanceType("t3.small"),
  enableDetailedMonitoring: false,
});
```

### Pattern 3: Custom User Data

For complete control over instance configuration:

```typescript
const customUserData = ec2.UserData.forLinux();
customUserData.addCommands(
  "#!/bin/bash",
  "set -e",
  "",
  "# Custom setup",
  "yum update -y",
  "yum install -y docker",
  "",
  "# Configure ECS",
  "echo ECS_CLUSTER=my-cluster >> /etc/ecs/ecs.config",
  "",
  "# Start services",
  "systemctl enable docker ecs",
  "systemctl start docker ecs"
);

const launchTemplate = new LaunchTemplateConstruct(this, "CustomLaunchTemplate", {
  vpc,
  envName: "custom",
  userData: customUserData, // Overrides strategy
});
```

### Pattern 4: Integration with ECS Cluster

```typescript
// Create launch template
const launchTemplate = new LaunchTemplateConstruct(this, "EcsLaunchTemplate", {
  vpc,
  envName: "production",
  userDataStrategy: "minimal",
  ecsConfig: {
    clusterName: "production-cluster",
  },
  instanceType: new ec2.InstanceType("t3.large"),
});

// Create Auto Scaling Group
const asg = new autoscaling.AutoScalingGroup(this, "EcsAsg", {
  vpc,
  launchTemplate: launchTemplate.launchTemplate,
  minCapacity: 2,
  maxCapacity: 10,
  desiredCapacity: 2,
  vpcSubnets: {
    subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
  },
});

// Add capacity provider to cluster
const capacityProvider = new ecs.AsgCapacityProvider(this, "CapacityProvider", {
  autoScalingGroup: asg,
  enableManagedScaling: true,
});

cluster.addAsgCapacityProvider(capacityProvider);
```

### Pattern 5: With Custom Security Groups

```typescript
// Create custom security group
const customSg = new ec2.SecurityGroup(this, "CustomSg", {
  vpc,
  description: "Custom rules for application",
});

customSg.addIngressRule(
  ec2.Peer.ipv4(vpc.vpcCidrBlock),
  ec2.Port.tcp(8080),
  "Application port"
);

// Use with launch template
const launchTemplate = new LaunchTemplateConstruct(this, "AppLaunchTemplate", {
  vpc,
  envName: "production",
  securityGroup: customSg, // Use custom SG instead of auto-created
  additionalSecurityGroups: [albSecurityGroup], // Add more SGs
});
```

## User Data Strategy Comparison

### Minimal Strategy

```bash
# What happens at boot:
1. Install SSM agent
2. Start SSM agent
3. Verify agent is running
# Total: ~30 seconds

# SSM State Manager then handles:
- ECS agent configuration
- CloudWatch agent installation
- Security hardening
- Any custom configuration
```

### Comprehensive Strategy

```bash
# What happens at boot:
1. Update system packages
2. Install SSM agent
3. Configure ECS agent (if ecsConfig)
4. Install CloudWatch agent (if monitoring.installCloudWatchAgent)
5. Install Node Exporter (if monitoring.installNodeExporter)
# Total: 3-5 minutes
```

## Best Practices

### 1. Use Minimal Strategy for Production

```typescript
// Production: Fast boot, SSM-managed
const prodTemplate = new LaunchTemplateConstruct(this, "ProdTemplate", {
  vpc,
  envName: "production",
  userDataStrategy: "minimal",
  // ...
});

// Development: All-in-one, no SSM dependency
const devTemplate = new LaunchTemplateConstruct(this, "DevTemplate", {
  vpc,
  envName: "development",
  userDataStrategy: "comprehensive",
  // ...
});
```

### 2. Right-Size Instance Types

| Workload | Instance Type | Memory | vCPU |
| -------- | ------------- | ------ | ---- |
| Light (dev) | t3.micro | 1 GB | 2 |
| Standard | t3.small | 2 GB | 2 |
| Medium | t3.medium | 4 GB | 2 |
| Heavy | t3.large | 8 GB | 2 |
| Compute | c6i.xlarge | 8 GB | 4 |

### 3. Security Group Rules

```typescript
// Allow only necessary traffic
launchTemplate.addIngressRule(
  ec2.Peer.ipv4(vpc.vpcCidrBlock),
  ec2.Port.tcp(9100),
  "Node Exporter metrics"
);

// Avoid overly permissive rules
// BAD: launchTemplate.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.allTraffic());
```

### 4. Use Encrypted Volumes

The construct uses encrypted GP3 volumes by default. For custom block devices:

```typescript
blockDevices: [
  {
    deviceName: "/dev/xvda",
    volume: ec2.BlockDeviceVolume.ebs(50, {
      volumeType: ec2.EbsDeviceVolumeType.GP3,
      encrypted: true, // Always encrypt
      iops: 3000,
      throughput: 125,
    }),
  },
];
```

## Troubleshooting

### SSM Agent Not Starting

**Symptoms:** Instance not appearing in SSM console.

**Solutions:**

1. Check instance has outbound access to port 443
2. Verify IAM role has `AmazonSSMManagedInstanceCore` policy
3. Check user data logs: `/var/log/user-data.log`

### ECS Agent Not Registering

**Symptoms:** Instance running but not in ECS cluster.

**Solutions:**

1. Verify `ECS_CLUSTER` in `/etc/ecs/ecs.config`
2. Check ECS agent logs: `/var/log/ecs/ecs-agent.log`
3. Ensure security group allows outbound HTTPS
4. Confirm instance role has ECS permissions

### Slow Boot Times

**Symptoms:** Auto-scaling too slow to respond to demand.

**Solutions:**

1. Switch from `comprehensive` to `minimal` strategy
2. Use custom AMI with pre-installed software
3. Reduce user data script complexity

### Security Group Blocking Traffic

**Symptoms:** Connections failing between instances.

**Solutions:**

1. Check default egress rules (only 443, 123 by default)
2. Add specific ingress rules for application ports
3. Verify VPC CIDR for internal communication rules

## Related Constructs

- `EcsClusterConstruct` - Creates ECS cluster with this launch template
- `AutoScalingGroupConstruct` - Creates ASG using this launch template
- `SsmStateManagerConstruct` - Configures instances via SSM (for minimal strategy)
- `Ec2InstanceRole` - IAM role for EC2 instances

## Additional Resources

- [EC2 Launch Templates](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-launch-templates.html)
- [ECS Container Instance AMIs](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ecs-optimized_AMI.html)
- [SSM State Manager](https://docs.aws.amazon.com/systems-manager/latest/userguide/systems-manager-state.html)
- [IMDSv2 Best Practices](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/configuring-instance-metadata-service.html)
