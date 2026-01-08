# Subnet Configuration Helper

## Overview

The `SubnetConfigurationHelper` is a utility class that provides factory methods for creating standard subnet configurations for AWS VPCs. It simplifies VPC creation by offering pre-configured patterns that follow AWS best practices, with built-in validation and support for custom tagging.

## Why It's Needed

### Problem

When creating VPCs with CDK, you need to manually configure subnet properties:

```typescript
// Without helper - verbose and error-prone
const vpc = new ec2.Vpc(this, 'Vpc', {
  subnetConfiguration: [
    {
      name: "Public",
      subnetType: ec2.SubnetType.PUBLIC,
      cidrMask: 24,
      mapPublicIpOnLaunch: true,
    },
    {
      name: "Private",
      subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      cidrMask: 24,
    },
  ],
});
```

**Issues:**
- Repetitive boilerplate code
- Easy to make mistakes (wrong subnet types, invalid CIDR masks)
- No validation of CIDR mask ranges
- No standardised tagging
- Difficult to maintain consistency across projects

### Solution

The `SubnetConfigurationHelper` provides:

1. **Consistency**: Standard patterns used across all projects
2. **Validation**: Automatic validation of CIDR masks (16-28 range)
3. **Flexibility**: Support for custom tags and CIDR masks
4. **Best Practices**: Pre-configured patterns for common architectures
5. **Maintainability**: Single source of truth for subnet configurations

## Usage

### Basic Usage

```typescript
import { SubnetConfigurationHelper } from '../shared/helpers';
import * as ec2 from 'aws-cdk-lib/aws-ec2';

// Create a VPC with standard 2-tier architecture (public + private)
const vpc = new ec2.Vpc(this, 'Vpc', {
  subnetConfiguration: SubnetConfigurationHelper.twoTierConfiguration(),
});
```

### Custom CIDR Masks

```typescript
// Use custom CIDR mask for larger subnets
const vpc = new ec2.Vpc(this, 'Vpc', {
  subnetConfiguration: SubnetConfigurationHelper.twoTierConfiguration(20), // /20 = ~4091 IPs
});
```

### Individual Subnet Types

```typescript
// Create individual subnet configurations
const publicSubnet = SubnetConfigurationHelper.publicSubnet(24);
const privateSubnet = SubnetConfigurationHelper.privateSubnet(24);
const isolatedSubnet = SubnetConfigurationHelper.isolatedSubnet(24);

const vpc = new ec2.Vpc(this, 'Vpc', {
  subnetConfiguration: [publicSubnet, privateSubnet, isolatedSubnet],
});
```

### Custom Tags

```typescript
// Add custom tags for subnet discovery and organisation
const publicSubnet = SubnetConfigurationHelper.publicSubnet(24, {
  'Purpose': 'LoadBalancers',
  'Environment': 'production',
});

const privateSubnet = SubnetConfigurationHelper.privateSubnet(24, {
  'Purpose': 'ApplicationServers',
  'Tier': 'Application',
});
```

### EKS-Optimised Configuration

```typescript
// Create EKS-optimised subnets with Kubernetes tags
const eksSubnets = SubnetConfigurationHelper.eksConfiguration(
  'my-eks-cluster',
  24,  // Public /24 for load balancers
  20   // Private /20 for nodes + pods
);

const vpc = new ec2.Vpc(this, 'EksVpc', {
  subnetConfiguration: eksSubnets,
});
```

**Tags Applied:**
- `kubernetes.io/role/elb: 1` (public subnets)
- `kubernetes.io/role/internal-elb: 1` (private subnets)
- `kubernetes.io/cluster/<cluster-name>: shared` (both tiers)

### Cost-Optimised Configuration

```typescript
// Use smaller CIDR blocks (/28) for development environments
const devSubnets = SubnetConfigurationHelper.costOptimizedConfiguration();

const vpc = new ec2.Vpc(this, 'DevVpc', {
  subnetConfiguration: devSubnets,
});
```

### High-Density Configuration

```typescript
// Use larger CIDR blocks (/20) for large ECS/EKS clusters
const prodSubnets = SubnetConfigurationHelper.highDensityConfiguration();

const vpc = new ec2.Vpc(this, 'ProdVpc', {
  subnetConfiguration: prodSubnets,
});
```

### Three-Tier Architecture

```typescript
// Public, Private, and Isolated subnets
const threeTierSubnets = SubnetConfigurationHelper.threeTierConfiguration();

const vpc = new ec2.Vpc(this, 'SecureVpc', {
  subnetConfiguration: threeTierSubnets,
});
```

## Architecture Patterns

### Two-Tier (Most Common)

**Use Case**: Standard web applications

```
Public Subnets    → Load balancers, NAT gateways, bastion hosts
Private Subnets   → Application servers, ECS/EKS workloads
```

```typescript
SubnetConfigurationHelper.twoTierConfiguration()
```

### Three-Tier (Enhanced Security)

**Use Case**: Applications requiring database isolation

```
Public Subnets    → Load balancers, NAT gateways
Private Subnets   → Application servers
Isolated Subnets  → Databases, sensitive data stores
```

```typescript
SubnetConfigurationHelper.threeTierConfiguration()
```

### EKS-Optimised

**Use Case**: Kubernetes clusters with AWS Load Balancer Controller

```
Public Subnets    → Internet-facing load balancers
Private Subnets   → EKS nodes and pods (larger CIDR for pod IPs)
```

```typescript
SubnetConfigurationHelper.eksConfiguration('cluster-name', 24, 20)
```

## CIDR Mask Guidelines

| CIDR Mask | Usable IPs | Use Case |
|-----------|------------|----------|
| /28       | ~11        | Development, minimal resources |
| /24       | ~251       | Standard workloads (default) |
| /20       | ~4,091     | Large EKS clusters, high-density workloads |
| /18       | ~16,379    | Very large deployments |

**Validation**: CIDR masks are automatically validated to be between 16-28.

## Subnet Types

### Public Subnets
- **Access**: Direct internet access via Internet Gateway
- **IP Assignment**: Automatic public IP assignment
- **Use Cases**: Load balancers, NAT gateways, bastion hosts
- **Method**: `SubnetConfigurationHelper.publicSubnet()`

### Private Subnets (with Egress)
- **Access**: Internet access via NAT Gateway
- **IP Assignment**: No public IPs
- **Use Cases**: Application servers, ECS/EKS workloads
- **Method**: `SubnetConfigurationHelper.privateSubnet()`

### Isolated Subnets
- **Access**: No internet access
- **IP Assignment**: No public IPs
- **Use Cases**: Databases, sensitive data stores
- **Method**: `SubnetConfigurationHelper.isolatedSubnet()`

## Integration with VPC Construct

The helper works seamlessly with the `VpcConstruct`:

```typescript
import { VpcConstruct } from '../constructs/networking/vpc';
import { SubnetConfigurationHelper } from '../shared/helpers';

const vpcConstruct = new VpcConstruct(this, 'Vpc', {
  envName: 'production',
  subnetConfiguration: SubnetConfigurationHelper.twoTierConfiguration(24),
  maxAzs: 3,
  natGateways: 2,
});
```

## Error Handling

The helper includes built-in validation:

```typescript
// ❌ Invalid CIDR mask - throws error
SubnetConfigurationHelper.publicSubnet(8);  // Error: CIDR mask must be between 16-28

// ❌ Invalid EKS cluster name - throws error
SubnetConfigurationHelper.eksConfiguration('');  // Error: EKS cluster name is required

// ✅ Valid usage
SubnetConfigurationHelper.publicSubnet(24);  // Success
```

## Best Practices

1. **Use Standard Patterns**: Prefer `twoTierConfiguration()` or `threeTierConfiguration()` over manual configuration
2. **Right-Size CIDR Blocks**: Use `/24` for most cases, `/20` for large clusters, `/28` for development
3. **Add Custom Tags**: Use custom tags for subnet discovery and organisation
4. **Validate Early**: The helper validates CIDR masks automatically - trust the validation
5. **Document Custom Configurations**: If using custom CIDR masks, document why in code comments

## Examples

### Development Environment

```typescript
const devVpc = new ec2.Vpc(this, 'DevVpc', {
  subnetConfiguration: SubnetConfigurationHelper.costOptimizedConfiguration(),
  maxAzs: 2,
  natGateways: 1, // Single NAT gateway for cost savings
});
```

### Production Environment

```typescript
const prodVpc = new ec2.Vpc(this, 'ProdVpc', {
  subnetConfiguration: SubnetConfigurationHelper.twoTierConfiguration(24),
  maxAzs: 3,
  natGateways: 3, // HA NAT gateways across all AZs
});
```

### EKS Cluster

```typescript
const eksVpc = new ec2.Vpc(this, 'EksVpc', {
  subnetConfiguration: SubnetConfigurationHelper.eksConfiguration(
    'production-cluster',
    24,  // Public subnets for load balancers
    20   // Private subnets for nodes + pods
  ),
  maxAzs: 3,
  natGateways: 3,
});
```

### High-Security Application

```typescript
const secureVpc = new ec2.Vpc(this, 'SecureVpc', {
  subnetConfiguration: SubnetConfigurationHelper.threeTierConfiguration(24),
  maxAzs: 3,
  natGateways: 2, // No NAT needed for isolated subnets
});
```

## Type Definitions

```typescript
interface SubnetConfiguration {
  name: string;
  subnetType: ec2.SubnetType;
  cidrMask: number;
  mapPublicIpOnLaunch?: boolean;
  tags?: Record<string, string>;
}
```

## Related Files

- **Type Definitions**: `lib/shared/types/networking-types.ts`
- **Validation**: `lib/shared/utils/validation.ts`
- **VPC Construct**: `lib/constructs/networking/vpc/vpc-construct.ts`
- **Tests**: `tests/unit/helpers/subnet-configuration-helper.test.ts`

## Migration Guide

If you're using the old implementation from `lib/constructs/networking/vpc/subnet-construct.ts`:

**Old Import:**
```typescript
import { SubnetConfigurationHelper } from '../constructs/networking/vpc';
```

**New Import (Recommended):**
```typescript
import { SubnetConfigurationHelper } from '../shared/helpers';
```

**Or use re-export (backward compatible):**
```typescript
import { SubnetConfigurationHelper } from '../constructs/networking/vpc';
```

The old file is maintained for backward compatibility but is deprecated. All new code should use the shared helper directly.
