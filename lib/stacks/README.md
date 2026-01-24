# Infrastructure Stacks

This directory contains AWS CDK stack definitions for the monitoring infrastructure. Each stack provisions a specific set of AWS resources following infrastructure-as-code best practices.

## Table of Contents

- [Overview](#overview)
- [NetworkingStack](#networkingstack)
  - [Features](#features)
  - [Configuration](#configuration)
  - [Usage](#usage)
  - [Components](#components)
  - [Outputs and Exports](#outputs-and-exports)
  - [SSM Parameters](#ssm-parameters)
  - [Cost Optimisation](#cost-optimisation)
  - [Deployment](#deployment)
- [Other Stacks](#other-stacks)

## Overview

The stacks in this directory are designed to be deployed in a specific order, with foundational infrastructure (networking) deployed first, followed by application-specific stacks that depend on it.

### Stack Dependencies

```
NetworkingStack (foundational)
    ↓
MonitoringInfraStack (depends on VPC)
    ↓
MonitoringServicesStack (depends on VPC and infrastructure)
```

## NetworkingStack

The `NetworkingStack` provisions core networking infrastructure including VPC, subnets, NAT gateways, VPC Flow Logs, and VPC endpoints. This is a foundational stack that should be deployed first as other stacks depend on its outputs.

### Features

- **VPC Creation**: Configurable CIDR, availability zones, and subnet architecture
- **Subnet Configuration**: Support for public, private, and isolated subnets
- **NAT Gateway**: Optional NAT gateways for private subnet internet access
- **VPC Flow Logs**: Optional network traffic monitoring with configurable retention
- **VPC Endpoints**: Gateway endpoints for S3 and DynamoDB (free), with optional interface endpoints
- **Cross-Stack References**: CloudFormation exports and SSM parameters for resource discovery
- **Resource Tagging**: Consistent tagging for cost allocation and resource management

### Configuration

The `NetworkingStack` accepts the following properties:

```typescript
interface NetworkingStackProps extends cdk.StackProps {
  envName: string;                    // Required: Environment name (e.g., 'development', 'production')
  vpcCidr?: string;                   // Optional: VPC CIDR block (default: '10.0.0.0/16')
  maxAzs?: number;                    // Optional: Maximum availability zones (default: 2)
  natGateways?: number;                // Optional: Number of NAT gateways (default: 0)
  enableVpcFlowLogs?: boolean;        // Optional: Enable VPC Flow Logs (default: true)
  enableVpcEndpoints?: boolean;       // Optional: Enable VPC endpoints (default: true)
}
```

#### Property Details

- **`envName`** (required): Environment identifier used for resource naming, tagging, and exports. Examples: `'development'`, `'staging'`, `'production'`, `'pipeline'`.

- **`vpcCidr`** (optional): IPv4 CIDR block for the VPC. Default: `'10.0.0.0/16'`. Ensure this does not overlap with other VPCs if peering is planned.

- **`maxAzs`** (optional): Maximum number of availability zones to use. Default: `2`. The stack will create subnets across this many AZs for high availability.

- **`natGateways`** (optional): Number of NAT gateways to provision. Default: `0`. 
  - `0`: No NAT gateways (private subnets have no internet access)
  - `1`: Single NAT gateway (cost-optimised for non-production)
  - `2+`: High availability NAT gateways (recommended for production)

- **`enableVpcFlowLogs`** (optional): Enable VPC Flow Logs for network traffic monitoring. Default: `true`. Required for compliance in many environments.

- **`enableVpcEndpoints`** (optional): Enable VPC endpoints for AWS services. Default: `true`. Creates gateway endpoints for S3 and DynamoDB (free).

### Usage

#### Basic Usage

```typescript
import { NetworkingStack } from './lib/stacks/foundation/networking-stack';
import { VpcConstruct, VpcFlowLogsConstruct } from './lib/constructs/networking/vpc';
import { SubnetConfigurationHelper } from './lib/shared/helpers';
import * as cdk from 'aws-cdk-lib';

const app = new cdk.App();

new NetworkingStack(app, 'NetworkingStack-development', {
  envName: 'development',
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});
```

#### Production Configuration

```typescript
new NetworkingStack(app, 'NetworkingStack-production', {
  envName: 'production',
  vpcCidr: '10.0.0.0/16',
  maxAzs: 3,                    // Use 3 AZs for high availability
  natGateways: 2,               // HA NAT gateways across AZs
  enableVpcFlowLogs: true,      // Required for compliance
  enableVpcEndpoints: true,
  env: {
    account: '123456789012',
    region: 'eu-west-1',
  },
});
```

#### Cost-Optimised Configuration (Non-Production)

```typescript
new NetworkingStack(app, 'NetworkingStack-development', {
  envName: 'development',
  vpcCidr: '10.0.0.0/16',
  maxAzs: 2,
  natGateways: 1,               // Single NAT gateway saves ~£30/month
  enableVpcFlowLogs: true,
  enableVpcEndpoints: true,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});
```

#### Minimal Configuration (No Internet Access)

```typescript
new NetworkingStack(app, 'NetworkingStack-isolated', {
  envName: 'isolated',
  vpcCidr: '10.192.0.0/16',
  maxAzs: 2,
  natGateways: 0,                // No NAT gateways - no internet access
  enableVpcFlowLogs: true,
  enableVpcEndpoints: true,     // VPC endpoints still work without NAT
});
```

### Components

The `NetworkingStack` uses several internal constructs that can also be used independently:

#### SubnetConfigurationHelper

Factory class for creating standard subnet configurations:

```typescript
import { SubnetConfigurationHelper } from './lib/shared/helpers';

// Create individual subnet configurations
const publicSubnet = SubnetConfigurationHelper.publicSubnet(24);
const privateSubnet = SubnetConfigurationHelper.privateSubnet(24);
const isolatedSubnet = SubnetConfigurationHelper.isolatedSubnet(24);

// Use pre-configured architectures
const twoTier = SubnetConfigurationHelper.twoTierConfiguration();      // Public + Private
const threeTier = SubnetConfigurationHelper.threeTierConfiguration();    // Public + Private + Isolated
```

#### VpcConstruct

Enhanced VPC construct with additional features:

```typescript
import { VpcConstruct } from './lib/constructs/networking/vpc';

const vpcConstruct = new VpcConstruct(this, 'Vpc', {
  envName: 'development',
  vpcName: 'monitoring-vpc',
  cidr: '10.0.0.0/16',
  maxAzs: 2,
  natGateways: 1,
  subnetConfiguration: SubnetConfigurationHelper.twoTierConfiguration(),
  enableDnsHostnames: true,
  enableDnsSupport: true,
});

// Access the VPC
const vpc = vpcConstruct.vpc;

// Add VPC endpoints
vpcConstruct.addInterfaceEndpoint(
  'EcrApiEndpoint',
  ec2.InterfaceVpcEndpointAwsService.ECR
);

vpcConstruct.addGatewayEndpoint('S3Endpoint', {
  service: ec2.GatewayVpcEndpointAwsService.S3,
});
```

#### VpcFlowLogsConstruct

VPC Flow Logs construct for network traffic monitoring:

```typescript
import { VpcFlowLogsConstruct } from './lib/constructs/networking/vpc';

const flowLogs = new VpcFlowLogsConstruct(this, 'FlowLogs', {
  vpc: vpc,
  envName: 'development',
  trafficType: ec2.FlowLogTrafficType.ALL,    // ALL, ACCEPT, or REJECT
  logGroupName: '/aws/vpc/flowlogs/development',
  retentionDays: 7,                            // Configurable retention
});

// Access the log group
const logGroup = flowLogs.logGroup;
const logGroupName = flowLogs.logGroupName;
```

### Outputs and Exports

The `NetworkingStack` exports the following CloudFormation outputs for cross-stack references:

| Export Name | Description | Example Value |
|------------|-------------|---------------|
| `${envName}-vpc-id` | VPC ID | `vpc-0123456789abcdef0` |
| `${envName}-vpc-cidr` | VPC CIDR block | `10.0.0.0/16` |
| `${envName}-azs` | Availability zones (comma-separated) | `eu-west-1a,eu-west-1b` |
| `${envName}-public-subnet-{n}-id` | Public subnet IDs | `subnet-0123456789abcdef0` |
| `${envName}-private-subnet-{n}-id` | Private subnet IDs | `subnet-0123456789abcdef1` |
| `${envName}-flow-logs-log-group` | Flow logs log group name | `/aws/vpc/flowlogs/development` |

#### Using Exports in Other Stacks

```typescript
import * as cdk from 'aws-cdk-lib';

// Import VPC ID from NetworkingStack
const vpcId = cdk.Fn.importValue('development-vpc-id');

// Or use SSM Parameter Store (recommended for cross-account)
import * as ssm from 'aws-cdk-lib/aws-ssm';
const vpcId = ssm.StringParameter.valueFromLookup(
  this,
  '/networking/development/vpc-id'
);
```

### SSM Parameters

The stack creates SSM parameters for cross-account and cross-stack resource discovery:

| Parameter Path | Description | Example Value |
|---------------|-------------|---------------|
| `/networking/${envName}/vpc-id` | VPC ID | `vpc-0123456789abcdef0` |
| `/networking/${envName}/vpc-cidr` | VPC CIDR block | `10.0.0.0/16` |

#### Why SSM Parameters?

SSM Parameter Store is used instead of CloudFormation exports when:
- Cross-account VPC peering is required
- Avoiding circular dependencies between stacks
- Enabling resource discovery across AWS accounts
- Supporting infrastructure in multiple regions

#### Accessing SSM Parameters

```typescript
import * as ssm from 'aws-cdk-lib/aws-ssm';

// Read parameter value
const vpcId = ssm.StringParameter.valueFromLookup(
  this,
  '/networking/development/vpc-id'
);

// Or use StringParameter.fromStringParameterName for runtime lookups
const vpcCidrParam = ssm.StringParameter.fromStringParameterName(
  this,
  'VpcCidrParam',
  '/networking/development/vpc-cidr'
);
const vpcCidr = vpcCidrParam.stringValue;
```

### Cost Optimisation

The `NetworkingStack` includes several cost-optimisation features:

#### NAT Gateway Configuration

- **Single NAT Gateway**: Saves approximately £30/month in non-production environments
- **High Availability**: Use 2+ NAT gateways for production (one per AZ)
- **No NAT Gateway**: Use `natGateways: 0` for isolated environments (saves ~£30/month per gateway)

#### VPC Endpoints

- **Gateway Endpoints**: S3 and DynamoDB endpoints are free (no hourly charges)
- **Interface Endpoints**: Cost approximately £7/month per endpoint (only enable if required)
- **Default Configuration**: Only gateway endpoints are enabled by default

#### VPC Flow Logs

- **Retention**: Default 7-day retention balances compliance with cost
- **Traffic Type**: Use `ACCEPT` or `REJECT` instead of `ALL` to reduce log volume
- **Log Group**: CloudWatch Logs charges apply based on ingestion and storage

#### Estimated Monthly Costs

| Configuration | NAT Gateways | Estimated Monthly Cost |
|--------------|--------------|------------------------|
| Development (1 NAT) | 1 | ~£30 (NAT Gateway) |
| Production (2 NAT) | 2 | ~£60 (NAT Gateways) |
| Isolated (0 NAT) | 0 | ~£0 (VPC only) |

Note: Costs exclude data transfer, CloudWatch Logs, and any interface endpoints.

### Deployment

#### Prerequisites

- AWS CDK CLI installed (`npm install -g aws-cdk`)
- AWS credentials configured
- Node.js and Yarn installed
- Dependencies installed (`yarn install`)

#### Deploy NetworkingStack

```bash
# Synthesise CloudFormation template
cdk synth NetworkingStack-development

# Deploy the stack
cdk deploy NetworkingStack-development

# Deploy with specific parameters
cdk deploy NetworkingStack-development \
  --parameters envName=development \
  --parameters vpcCidr=10.0.0.0/16
```

#### Verify Deployment

```bash
# List stack outputs
aws cloudformation describe-stacks \
  --stack-name NetworkingStack-development \
  --query 'Stacks[0].Outputs'

# Verify SSM parameters
aws ssm get-parameter --name /networking/development/vpc-id
aws ssm get-parameter --name /networking/development/vpc-cidr

# Check VPC Flow Logs
aws ec2 describe-flow-logs --filter "Name=resource-id,Values=vpc-*"
```

#### Update Stack

```bash
# Update stack configuration
cdk deploy NetworkingStack-development

# Or use CDK diff to preview changes
cdk diff NetworkingStack-development
```

#### Destroy Stack

```bash
# Destroy the stack (removes all resources)
cdk destroy NetworkingStack-development
```

**Warning**: Destroying the stack will delete the VPC and all associated resources. Ensure no other stacks or resources depend on this VPC before destruction.

## Other Stacks

### MonitoringStack

The `MonitoringStack` is a placeholder stack defined in `lib/index.ts`. This stack will be implemented to provision monitoring infrastructure such as:

- CloudWatch dashboards
- CloudWatch alarms
- Log groups and log streams
- SNS topics for notifications
- S3 buckets for log archival

**Status**: Placeholder - implementation pending

### Future Stacks

Additional stacks may be added to this directory as the infrastructure evolves:

- **MonitoringInfraStack**: ECS clusters, EFS file systems, and other monitoring infrastructure
- **MonitoringServicesStack**: ECS services, task definitions, and application deployments
- **SecurityStack**: Security groups, IAM roles, and compliance resources

## Best Practices

### Stack Organisation

1. **Deploy Order**: Always deploy `NetworkingStack` first as it's foundational
2. **Environment Isolation**: Use separate stacks per environment (e.g., `NetworkingStack-development`, `NetworkingStack-production`)
3. **Resource Naming**: Use consistent naming with environment prefixes
4. **Tagging**: All resources are automatically tagged with environment and stack information

### Security

1. **VPC Flow Logs**: Enable in all environments for security monitoring
2. **Private Subnets**: Deploy application resources in private subnets
3. **NAT Gateways**: Use NAT gateways for outbound internet access from private subnets
4. **VPC Endpoints**: Use VPC endpoints to avoid internet exposure for AWS service access

### Cost Management

1. **NAT Gateways**: Use single NAT gateway for non-production environments
2. **VPC Endpoints**: Only enable interface endpoints when specifically required
3. **Flow Logs Retention**: Adjust retention based on compliance requirements
4. **Resource Cleanup**: Destroy stacks in non-production environments when not in use

### Troubleshooting

#### Common Issues

**Issue**: Stack deployment fails with "VPC CIDR conflicts with existing VPC"

**Solution**: Choose a different CIDR block that doesn't overlap with existing VPCs in the region.

**Issue**: Cannot import VPC ID in another stack

**Solution**: Ensure the `NetworkingStack` is deployed first, or use SSM parameters for cross-account access.

**Issue**: Private subnets cannot reach the internet

**Solution**: Ensure `natGateways` is set to at least `1` and NAT gateway is in a public subnet.

**Issue**: VPC Flow Logs not appearing in CloudWatch

**Solution**: Verify the IAM role has permissions to write to CloudWatch Logs and check the log group exists.

## References

- [AWS CDK Documentation](https://docs.aws.amazon.com/cdk/)
- [AWS VPC User Guide](https://docs.aws.amazon.com/vpc/latest/userguide/)
- [VPC Flow Logs Documentation](https://docs.aws.amazon.com/vpc/latest/userguide/flow-logs.html)
- [VPC Endpoints Documentation](https://docs.aws.amazon.com/vpc/latest/privatelink/vpc-endpoints.html)

## Support

For issues or questions regarding the stacks:

1. Check the stack's CloudFormation events in the AWS Console
2. Review CloudWatch Logs for VPC Flow Logs and application logs
3. Consult the [NETWORKING_STACK_CONSOLIDATION.md](./NETWORKING_STACK_CONSOLIDATION.md) for implementation details
