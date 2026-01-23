# Stack Development Guide

This guide provides a comprehensive reference for creating new CDK stacks in this repository. Stacks orchestrate constructs and define deployment boundaries.

## Table of Contents

1. [Stacks vs Constructs](#stacks-vs-constructs)
2. [Repository Structure](#repository-structure)
3. [Stack Anatomy](#stack-anatomy)
4. [Stack Layers](#stack-layers)
5. [Props Definitions](#props-definitions)
6. [Cross-Stack References](#cross-stack-references)
7. [SSM Parameters](#ssm-parameters)
8. [Best Practices Checklist](#best-practices-checklist)

---

## Stacks vs Constructs

| Aspect | Construct | Stack |
|--------|-----------|-------|
| Purpose | Reusable resource patterns | Deployment unit |
| Extends | `Construct` | `cdk.Stack` |
| Location | `lib/constructs/` | `lib/stacks/` |
| Deploys | No (nested in stack) | Yes (CloudFormation) |
| Cross-stack | Cannot reference other stacks | Can import/export values |
| Contains | AWS resources | Constructs + resources |

### When to Create a Stack

Create a new stack when:
- Resources have **different deployment lifecycles**
- You need **deployment isolation** (fail independently)
- Resources belong to **different teams/ownership**
- You need **cross-account deployment**
- CloudFormation resource limits are approached

### Stack Layer Pattern

```
Layer 1: Foundation (VPC, Security Groups, IAM Roles)
    ↓ rarely changes
Layer 2: Infrastructure (ECS Cluster, ALB, EFS)
    ↓ occasional changes
Layer 3: Services (ECS Services, Lambda, Applications)
    ↓ frequent changes
```

---

## Repository Structure

```
lib/stacks/
├── compute/                 # Compute-related stacks
│   ├── ecs-stack.ts
│   ├── ecs-services-stack.ts
│   └── launch-template-stack.ts
├── foundation/              # Foundational infrastructure
│   ├── networking-stack.ts
│   ├── elb-stack.ts
│   └── DEPLOYMENT.md
├── monitoring/              # Monitoring-specific stacks
│   ├── infra-stack.ts
│   ├── service-stack.ts
│   └── efs-stack.ts
├── networking/              # Networking stacks
│   └── security/
│       └── acm-stack.ts
├── security/                # Security stacks
│   ├── prowler-stack.ts
│   └── index.ts
├── storage/                 # Storage stacks
│   ├── s3-stack.ts
│   ├── efs-file-system-stack.ts
│   └── ebs-storage-stack.ts
├── webapp/                  # Web application stacks
│   ├── api-stack.ts
│   ├── dynamodb-stack.ts
│   └── ecr-stack.ts
├── README.md
└── stack-template.ts        # Template for new stacks
```

### File Naming Convention

```
{category}/{resource-type}-stack.ts

Examples:
- foundation/networking-stack.ts
- monitoring/infra-stack.ts
- storage/s3-stack.ts
```

---

## Stack Anatomy

A well-structured stack follows this pattern:

### 1. File Header and Imports

```typescript
/** @format */

// AWS CDK core imports
import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import { NagSuppressions } from "cdk-nag";
import { Construct } from "constructs";

// Internal constructs
import { VpcConstruct } from "../../constructs/networking/vpc";
import { EcsClusterConstruct } from "../../constructs/compute/ecs";

// Internal shared utilities
import { applyStackTags } from "../../shared/helpers/stack-tagging-helper";
import { MyStackProps } from "../../shared/types/stack-types";
import { CONSTANTS } from "../../shared/constants/my-constants";
import { validateEnvName } from "../../shared/utils/validation";
import { isProductionEnvironment } from "../../shared/utils/environment";
```

### 2. Stack Class with Documentation

```typescript
/**
 * MyStack - Layer X: Brief description
 *
 * This stack provisions:
 * - Resource 1 with description
 * - Resource 2 with description
 *
 * Dependencies:
 * - FoundationStack (for VPC)
 * - OtherStack (for specific resource)
 *
 * Architecture Pattern:
 * - Pattern description
 *
 * SSM Parameters Created:
 * - `/prefix/${envName}/param1` - Description
 * - `/prefix/${envName}/param2` - Description
 *
 * Production Recommendations:
 * - Recommendation 1
 * - Recommendation 2
 *
 * @example
 * ```typescript
 * const stack = new MyStack(app, 'MyStack', {
 *   envName: 'production',
 *   vpc: networkingStack.vpc,
 * });
 * ```
 */
export class MyStack extends cdk.Stack {
  // ========================================
  // PUBLIC PROPERTIES
  // ========================================
  public readonly primaryResource: ResourceType;
  public readonly ssmParameters?: SsmParametersConstruct;

  constructor(scope: Construct, id: string, props: MyStackProps) {
    super(scope, id, props);

    // ========================================================================
    // VALIDATION
    // ========================================================================
    validateEnvName(props.envName);
    this.validateDependencies(props);

    // Environment-aware defaults
    const isProduction = isProductionEnvironment(props.envName);

    // ========================================================================
    // PRODUCTION WARNINGS
    // ========================================================================
    if (props.enableProductionWarnings !== false && isProduction) {
      this.logProductionWarnings(props);
    }

    // ========================================================================
    // 1. FIRST RESOURCE GROUP
    // ========================================================================
    // Implementation...

    // ========================================================================
    // 2. SECOND RESOURCE GROUP
    // ========================================================================
    // Implementation...

    // ========================================================================
    // N. SSM PARAMETERS (Cross-Stack Discovery)
    // ========================================================================
    if (props.createSsmParameters !== false) {
      this.ssmParameters = new SsmParametersConstruct(this, "Parameters", {
        envName: props.envName,
        projectName: props.projectName,
        pathPrefix: `/mystack/${props.envName}`,
        customParameters: [
          {
            name: "resource-id",
            value: this.primaryResource.resourceId,
            description: `Resource ID for ${props.envName}`,
          },
        ],
      });
    }

    // ========================================================================
    // CLOUDFORMATION OUTPUTS
    // ========================================================================
    if (props.createOutputs !== false) {
      this.createOutputs(props);
    }

    // ========================================================================
    // RESOURCE TAGGING
    // ========================================================================
    applyStackTags(this, props.envName, props.projectName, {
      ...props.customTags,
      StackName: "MyStack",
      Layer: "Infrastructure",
    });

    // ========================================================================
    // CDK NAG SUPPRESSIONS
    // ========================================================================
    SuppressionManager.applyToStack(this, "MyStack", props.envName);
  }

  // ========================================
  // PRIVATE METHODS
  // ========================================
  private validateDependencies(props: MyStackProps): void {
    if (!props.vpc) {
      throw new Error(
        "VPC is required for MyStack.\n\n" +
          "Pass the VPC from NetworkingStack via props."
      );
    }
  }

  private logProductionWarnings(props: MyStackProps): void {
    if (!props.enableHttps) {
      cdk.Annotations.of(this).addWarning(
        "PRODUCTION: HTTPS not enabled..."
      );
    }
  }

  private createOutputs(props: MyStackProps): void {
    const enableExports = props.enableExports ?? false;
    const exportPrefix = props.projectName
      ? `${props.envName}-${props.projectName}`
      : `${props.envName}`;

    new cdk.CfnOutput(this, "ResourceId", {
      value: this.primaryResource.resourceId,
      description: `Resource ID for ${props.envName}`,
      exportName: enableExports ? `${exportPrefix}-resource-id` : undefined,
    });
  }

  // ========================================
  // PUBLIC GETTERS
  // ========================================
  public get resourceId(): string {
    return this.primaryResource.resourceId;
  }
}
```

---

## Stack Layers

### Layer 1: Foundation

**Purpose**: Long-lived infrastructure that rarely changes

**Examples**:
- `NetworkingStack` - VPC, subnets, NAT gateways
- `IamStack` - Shared IAM roles
- `KmsStack` - Encryption keys

**Characteristics**:
- Deploy first
- Other stacks depend on these
- Changes require careful planning
- Use `RemovalPolicy.RETAIN` for production

### Layer 2: Infrastructure

**Purpose**: Supporting infrastructure for applications

**Examples**:
- `MonitoringInfraStack` - ECS cluster, ALB, EFS
- `StorageStack` - S3 buckets, DynamoDB tables
- `ElbStack` - Load balancers

**Characteristics**:
- Depends on Foundation layer
- Occasional changes
- Services depend on these
- Contains compute and storage resources

### Layer 3: Services

**Purpose**: Application deployments that change frequently

**Examples**:
- `MonitoringServiceStack` - Prometheus, Grafana services
- `ApiStack` - API Gateway, Lambda
- `WebappStack` - ECS services

**Characteristics**:
- Most frequent deployments
- Can be updated independently
- Contains application code references
- Health checks and scaling policies

---

## Props Definitions

Stack props are defined in `lib/shared/types/stack-types.ts`.

### Standard Stack Props Pattern

```typescript
/**
 * Base props for all stacks
 */
export interface BaseStackProps extends cdk.StackProps {
  /**
   * Environment name (e.g., development, staging, production)
   */
  envName: string;

  /**
   * Project name for resource naming and tagging
   */
  projectName?: string;

  /**
   * Create SSM parameters for cross-stack discovery
   * @default true
   */
  createSsmParameters?: boolean;

  /**
   * Create CloudFormation outputs
   * @default true
   */
  createOutputs?: boolean;

  /**
   * Enable CloudFormation exports
   * @default false
   */
  enableExports?: boolean;

  /**
   * Enable production warnings
   * @default true
   */
  enableProductionWarnings?: boolean;

  /**
   * Custom tags to apply to all resources
   */
  customTags?: Record<string, string>;
}

/**
 * Props for MyStack
 */
export interface MyStackProps extends BaseStackProps {
  // ========================================
  // REQUIRED DEPENDENCIES
  // ========================================
  /**
   * VPC from NetworkingStack
   */
  vpc: ec2.IVpc;

  // ========================================
  // OPTIONAL CONFIGURATION
  // ========================================
  /**
   * Instance type for compute resources
   * @default t3.small for dev, t3.medium for production
   */
  instanceType?: ec2.InstanceType;
}
```

---

## Cross-Stack References

### Pattern 1: Direct Props Passing

```typescript
// In bin/app.ts
const networkingStack = new NetworkingStack(app, "Networking", {
  envName: "production",
});

const infraStack = new InfraStack(app, "Infra", {
  envName: "production",
  vpc: networkingStack.vpc,  // Direct reference
});

// Explicit dependency
infraStack.addDependency(networkingStack);
```

### Pattern 2: CloudFormation Exports

```typescript
// Exporting stack
new cdk.CfnOutput(this, "VpcId", {
  value: this.vpc.vpcId,
  exportName: `${props.envName}-vpc-id`,
});

// Importing stack
const vpcId = cdk.Fn.importValue(`${props.envName}-vpc-id`);
const vpc = ec2.Vpc.fromVpcAttributes(this, "ImportedVpc", {
  vpcId,
  availabilityZones: ["us-east-1a", "us-east-1b"],
});
```

### Pattern 3: SSM Parameter Store (Recommended)

```typescript
// Exporting stack - create parameter
new SsmParametersConstruct(this, "Parameters", {
  envName: props.envName,
  pathPrefix: `/networking/${props.envName}`,
  customParameters: [
    { name: "vpc-id", value: this.vpc.vpcId },
  ],
});

// Importing stack - lookup parameter
const vpcId = ssm.StringParameter.valueFromLookup(
  this,
  `/networking/${props.envName}/vpc-id`
);
```

---

## SSM Parameters

### Why Use SSM Parameters?

| Feature | CloudFormation Exports | SSM Parameters |
|---------|----------------------|----------------|
| Cross-account | No | Yes |
| Runtime updates | No | Yes |
| Circular deps | Problematic | Safe |
| Delete stack | Must remove importers first | Independent |

### Standard Parameter Paths

```
/{category}/{envName}/{resource}

Examples:
/networking/production/vpc-id
/monitoring/development/cluster-arn
/storage/staging/bucket-name
```

### Creating Parameters

```typescript
this.ssmParameters = new SsmParametersConstruct(this, "Parameters", {
  envName: props.envName,
  projectName: props.projectName,
  pathPrefix: `/monitoring/${props.envName}/infra`,
  customParameters: [
    {
      name: "cluster-name",
      value: this.cluster.clusterName,
      description: `ECS cluster name for ${props.envName}`,
    },
    {
      name: "cluster-arn",
      value: this.cluster.clusterArn,
      description: `ECS cluster ARN for ${props.envName}`,
    },
  ],
});
```

---

## Best Practices Checklist

### Before Creating a Stack

- [ ] Determine which layer the stack belongs to
- [ ] Identify dependencies on other stacks
- [ ] Plan SSM parameter paths
- [ ] Decide on CloudFormation export strategy
- [ ] Review resource limits per stack (~500 resources)

### Stack Development

- [ ] Extend `cdk.Stack` and use proper props interface
- [ ] Validate all required dependencies at start
- [ ] Use environment-aware defaults
- [ ] Add production warnings for risky configurations
- [ ] Use numbered sections for resource groups
- [ ] Create SSM parameters for cross-stack discovery
- [ ] Add CloudFormation outputs with optional exports
- [ ] Apply standard tags using `applyStackTags()`
- [ ] Add CDK Nag suppressions with justifications

### Outputs and Exports

- [ ] Create outputs for resources referenced by other stacks
- [ ] Make exports optional via `enableExports` prop
- [ ] Use consistent naming: `${envName}-${projectName}-${resource}`
- [ ] Include SSM parameter prefix in outputs

### Documentation

- [ ] Class-level JSDoc with layer, description, dependencies
- [ ] List SSM parameters created
- [ ] Include production recommendations
- [ ] Add usage examples for dev and production

### Testing

- [ ] Stack synthesises without errors
- [ ] All validations throw appropriate errors
- [ ] Cross-stack references resolve correctly
- [ ] CDK Nag passes without unexpected warnings

---

## Quick Reference: Stack Sections

Every stack should have these sections in order:

1. **VALIDATION** - Fail fast on invalid inputs
2. **PRODUCTION WARNINGS** - Environment-specific warnings
3. **RESOURCE GROUPS (numbered)** - Logical groupings
4. **SSM PARAMETERS** - Cross-stack discovery
5. **CLOUDFORMATION OUTPUTS** - Export values
6. **RESOURCE TAGGING** - Apply standard tags
7. **CDK NAG SUPPRESSIONS** - Security exemptions

---

## Template

See `lib/stacks/stack-template.ts` for a complete template with all patterns pre-configured.
