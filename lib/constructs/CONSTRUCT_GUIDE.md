# Construct Development Guide

This guide provides a comprehensive reference for creating new CDK constructs in this repository. Follow these patterns to ensure consistency, maintainability, and adherence to AWS best practices.

## Table of Contents

1. [Repository Structure](#repository-structure)
2. [File Organisation](#file-organisation)
3. [Construct Anatomy](#construct-anatomy)
4. [Type Definitions](#type-definitions)
5. [Constants and Defaults](#constants-and-defaults)
6. [Validation Patterns](#validation-patterns)
7. [Export Structure](#export-structure)
8. [Integration with Stacks](#integration-with-stacks)
9. [Best Practices Checklist](#best-practices-checklist)

---

## Repository Structure

```
lib/
├── constructs/              # Reusable CDK constructs (L2/L3)
│   ├── compute/             # Compute-related constructs
│   │   ├── ec2/             # EC2-specific constructs
│   │   ├── ecs/             # ECS cluster, service, task constructs
│   │   ├── lambda/          # Lambda function constructs
│   │   ├── launch-template/ # EC2 launch template constructs
│   │   ├── ssm/             # SSM State Manager constructs
│   │   └── index.ts         # Barrel export for compute
│   ├── config/              # Configuration constructs (SSM Parameters)
│   ├── iam/                 # IAM role constructs
│   ├── networking/          # Networking constructs
│   │   ├── alb/             # Application Load Balancer constructs
│   │   ├── api/             # API Gateway constructs
│   │   ├── security/        # Security groups, ACM certificates
│   │   └── vpc/             # VPC, flow logs, peering
│   ├── services/            # Higher-level service constructs
│   │   ├── monitoring/      # Prometheus, Grafana, CloudWatch
│   │   └── security/        # Prowler, security scanning
│   └── storage/             # Storage constructs
│       ├── dynamodb/        # DynamoDB table constructs
│       ├── ecr/             # ECR repository constructs
│       ├── efs/             # EFS file system constructs
│       └── s3/              # S3 bucket constructs
│
├── shared/                  # Shared utilities and types
│   ├── constants/           # Default values and magic numbers
│   │   ├── compute-constants.ts
│   │   ├── networking-constants.ts
│   │   ├── storage-constants.ts
│   │   └── index.ts
│   ├── helpers/             # Helper functions
│   │   ├── security-group-helper.ts
│   │   ├── stack-tagging-helper.ts
│   │   └── index.ts
│   ├── types/               # TypeScript interfaces and types
│   │   ├── compute-types.ts
│   │   ├── networking-types.ts
│   │   ├── storage-types.ts
│   │   └── index.ts
│   └── utils/               # Utility functions
│       ├── validation.ts    # Input validation functions
│       ├── environment.ts   # Environment detection
│       └── index.ts
│
└── stacks/                  # CDK Stack definitions
    ├── compute/             # Compute-related stacks
    ├── foundation/          # Foundational infrastructure stacks
    ├── monitoring/          # Monitoring stacks
    ├── networking/          # Networking stacks
    ├── security/            # Security stacks
    ├── storage/             # Storage stacks
    └── webapp/              # Web application stacks
```

---

## File Organisation

### When to Create a New Construct

Create a separate construct file when:

1. The construct is **reused across 3+ stacks**
2. The construct logic **exceeds 200 lines**
3. Building a **published construct library**
4. The construct represents a **distinct AWS resource pattern**

For simpler cases, prefer **private methods within stack files**.

### File Naming Convention

```
{resource-type}-construct.ts

Examples:
- vpc-construct.ts
- ecs-cluster-construct.ts
- security-group-construct.ts
- alb-listener-construct.ts
```

### Directory Structure for a New Construct Category

```
lib/constructs/{category}/
├── {resource}-construct.ts   # Main construct file
├── index.ts                  # Barrel export file
└── README.md                 # Optional documentation (complex constructs only)
```

---

## Construct Anatomy

A well-structured construct follows this pattern:

### 1. File Header and Imports

```typescript
/** @format */

// AWS CDK core imports (alphabetical order)
import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import { Construct } from "constructs";

// Internal imports: constants first, then types, then utils
import {
  DEFAULT_RESOURCE_VALUE,
  ANOTHER_CONSTANT,
} from "../../../shared/constants/{category}-constants";
import { MyConstructProps } from "../../../shared/types/{category}-types";
import {
  validateEnvName,
  validateSomeInput,
} from "../../../shared/utils/validation";
```

### 2. Props Interface (if defined locally)

```typescript
// Only define locally if the construct is self-contained
// Prefer centralised types in shared/types/ for reusability
export interface LocalConstructProps {
  envName: string;
  projectName?: string;
  // ... other properties
}
```

### 3. Construct Class with Documentation

```typescript
/**
 * MyConstruct - Brief description of what it creates
 *
 * This construct creates:
 * - Resource 1 with configuration
 * - Resource 2 with dependencies
 * - Related security settings
 *
 * Features:
 * - Feature 1 description
 * - Feature 2 description
 *
 * Dependencies:
 * - List any required external resources
 *
 * @example
 * ```typescript
 * const myResource = new MyConstruct(this, 'MyResource', {
 *   envName: 'production',
 *   vpc: myVpc,
 * });
 * ```
 */
export class MyConstruct extends Construct {
  // ========================================
  // PUBLIC PROPERTIES (exposed to consumers)
  // ========================================
  public readonly primaryResource: SomeResource;
  public readonly secondaryResource: AnotherResource;

  // ========================================
  // CONSTRUCTOR
  // ========================================
  constructor(scope: Construct, id: string, props: MyConstructProps) {
    super(scope, id);

    // ========================================
    // VALIDATION (fail fast)
    // ========================================
    validateEnvName(props.envName);
    this.validateCustomRequirements(props);

    // ========================================
    // DEFAULTS (destructure with defaults)
    // ========================================
    const {
      envName,
      projectName,
      someValue = DEFAULT_SOME_VALUE,
      anotherValue = this.resolveDefault(envName),
    } = props;

    // ========================================
    // RESOURCE CREATION (L2/L3 constructs preferred)
    // ========================================
    this.primaryResource = new SomeResource(this, "PrimaryResource", {
      resourceName: `${envName}-${projectName ?? "default"}-resource`,
      // ... configuration
    });

    // ========================================
    // SECURITY CONFIGURATION
    // ========================================
    this.configureSecuritySettings();

    // ========================================
    // TAGGING
    // ========================================
    cdk.Tags.of(this.primaryResource).add("Name", `${envName}-resource`);
    cdk.Tags.of(this.primaryResource).add("Environment", envName);
    cdk.Tags.of(this.primaryResource).add("ManagedBy", "CDK");
    if (projectName) {
      cdk.Tags.of(this.primaryResource).add("Project", projectName);
    }

    // ========================================
    // CLOUDFORMATION OUTPUTS (optional)
    // ========================================
    new cdk.CfnOutput(this, "ResourceId", {
      value: this.primaryResource.resourceId,
      description: `Resource ID for ${envName}`,
      exportName: `${cdk.Stack.of(this).stackName}-resource-id`,
    });
  }

  // ========================================
  // PUBLIC METHODS (for consumer use)
  // ========================================
  /**
   * Get the resource identifier
   */
  public get resourceId(): string {
    return this.primaryResource.resourceId;
  }

  /**
   * Add a connection to another resource
   */
  public addConnection(target: ITarget, port: number): void {
    // Implementation
  }

  // ========================================
  // PRIVATE METHODS (internal logic)
  // ========================================
  private validateCustomRequirements(props: MyConstructProps): void {
    if (!props.requiredField) {
      throw new Error(
        "requiredField is required for MyConstruct.\n\n" +
          "Troubleshooting Steps:\n" +
          " 1. Ensure requiredField is provided in props\n" +
          " 2. Check that the value is not undefined or null"
      );
    }
  }

  private resolveDefault(envName: string): string {
    return envName === "production" ? "prod-value" : "dev-value";
  }

  private configureSecuritySettings(): void {
    // Security configuration logic
  }
}
```

---

## Type Definitions

Types belong in `lib/shared/types/{category}-types.ts`.

### Props Interface Pattern

```typescript
/** @format */

import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as kms from "aws-cdk-lib/aws-kms";
import * as logs from "aws-cdk-lib/aws-logs";

/**
 * Configuration for optional features
 */
export interface FeatureConfig {
  enabled?: boolean;
  setting1?: string;
  setting2?: number;
}

/**
 * Props for MyConstruct
 */
export interface MyConstructProps {
  // ========================================
  // REQUIRED PROPERTIES
  // ========================================
  /**
   * VPC to deploy resources into
   */
  vpc: ec2.IVpc;

  /**
   * Environment name (e.g., development, staging, production)
   * Used for resource naming and environment-specific configuration
   */
  envName: string;

  // ========================================
  // OPTIONAL PROPERTIES - Naming
  // ========================================
  /**
   * Project name for resource naming and tagging
   * @default undefined
   */
  projectName?: string;

  /**
   * Custom resource name (overrides generated name)
   * @default {envName}-{projectName}-resource
   */
  resourceName?: string;

  // ========================================
  // OPTIONAL PROPERTIES - Configuration
  // ========================================
  /**
   * Instance type for compute resources
   * @default ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.SMALL)
   */
  instanceType?: ec2.InstanceType;

  /**
   * Minimum capacity
   * @default 1
   */
  minCapacity?: number;

  /**
   * Maximum capacity
   * @default 2
   */
  maxCapacity?: number;

  // ========================================
  // OPTIONAL PROPERTIES - Security
  // ========================================
  /**
   * IAM role for the resource
   * @default A new role is created with minimal permissions
   */
  role?: iam.IRole;

  /**
   * KMS key for encryption
   * @default AWS managed key
   */
  kmsKey?: kms.IKey;

  // ========================================
  // OPTIONAL PROPERTIES - Logging
  // ========================================
  /**
   * Log retention period
   * @default logs.RetentionDays.ONE_MONTH
   */
  logRetention?: logs.RetentionDays;

  // ========================================
  // OPTIONAL PROPERTIES - Features
  // ========================================
  /**
   * Feature configuration
   * @default { enabled: false }
   */
  featureConfig?: FeatureConfig;
}
```

---

## Constants and Defaults

Constants belong in `lib/shared/constants/{category}-constants.ts`.

### Constants Pattern

```typescript
/** @format */

import * as logs from "aws-cdk-lib/aws-logs";

// ========================================
// RESOURCE DEFAULTS
// ========================================
export const DEFAULT_RESOURCE_NAME_SUFFIX = "resource";
export const DEFAULT_INSTANCE_TYPE = "t3.small";
export const DEFAULT_MIN_CAPACITY = 1;
export const DEFAULT_MAX_CAPACITY = 2;
export const DEFAULT_DESIRED_CAPACITY = 1;

// ========================================
// ENVIRONMENT-SPECIFIC DEFAULTS
// ========================================
export const DEFAULT_LOG_RETENTION_DEV = logs.RetentionDays.TWO_WEEKS;
export const DEFAULT_LOG_RETENTION_PROD = logs.RetentionDays.ONE_MONTH;

// ========================================
// VALIDATION LIMITS
// ========================================
export const MIN_NAME_LENGTH = 1;
export const MAX_NAME_LENGTH = 255;
export const MIN_PORT = 1;
export const MAX_PORT = 65535;

// ========================================
// PRODUCTION ENVIRONMENT NAMES
// ========================================
export const PRODUCTION_ENV_NAMES = ["production", "prod"];

// ========================================
// HELPER FUNCTIONS
// ========================================
/**
 * Resolve log retention based on environment
 */
export function resolveLogRetention(envName: string): logs.RetentionDays {
  return PRODUCTION_ENV_NAMES.includes(envName)
    ? DEFAULT_LOG_RETENTION_PROD
    : DEFAULT_LOG_RETENTION_DEV;
}
```

---

## Validation Patterns

Validation functions belong in `lib/shared/utils/validation.ts`.

### Validation Function Pattern

```typescript
/** @format */

import { MIN_NAME_LENGTH, MAX_NAME_LENGTH } from "../constants/resource-constants";

/**
 * Validate resource name format
 *
 * Resource names must:
 * - Be 1-255 characters long
 * - Contain only alphanumeric characters and hyphens
 * - Not start or end with a hyphen
 *
 * @param name - Resource name to validate
 * @throws Error if name format is invalid
 *
 * @example
 * ```typescript
 * validateResourceName("my-resource");  // Valid
 * validateResourceName("");             // Throws error
 * validateResourceName("-invalid-");    // Throws error
 * ```
 */
export function validateResourceName(name: string): void {
  if (!name || typeof name !== "string") {
    throw new Error(
      "Resource name is required and must be a non-empty string.\n\n" +
        "Troubleshooting Steps:\n" +
        " 1. Ensure name is provided in construct props\n" +
        " 2. Verify the name is not undefined or null\n" +
        " 3. Check that the name follows naming conventions"
    );
  }

  const trimmed = name.trim();
  if (trimmed.length < MIN_NAME_LENGTH || trimmed.length > MAX_NAME_LENGTH) {
    throw new Error(
      `Resource name must be between ${MIN_NAME_LENGTH} and ${MAX_NAME_LENGTH} characters.\n` +
        `Received: ${trimmed.length} characters.`
    );
  }

  const validNameRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$/;
  if (!validNameRegex.test(trimmed)) {
    throw new Error(
      `Resource name contains invalid characters: "${trimmed}"\n\n` +
        "Allowed characters: alphanumeric and hyphens\n" +
        "Cannot start or end with a hyphen\n" +
        "Example valid names: 'my-resource', 'resource-01', 'prod-service'"
    );
  }
}

/**
 * Validate environment name
 */
export function validateEnvName(envName: string): void {
  if (!envName || typeof envName !== "string" || envName.trim().length === 0) {
    throw new Error(
      "Environment name (envName) is required and must be a non-empty string.\n\n" +
        "Troubleshooting Steps:\n" +
        " 1. Provide envName in construct props\n" +
        " 2. Use standard values such as 'development', 'staging', 'production', or 'pipeline'\n" +
        " 3. Ensure the value is not undefined or null"
    );
  }
}

/**
 * Validate capacity ordering: min <= desired <= max
 */
export function validateCapacityOrder(
  min: number,
  desired: number,
  max: number
): void {
  if (min > desired) {
    throw new Error("Minimum capacity cannot exceed desired capacity.");
  }
  if (desired > max) {
    throw new Error("Desired capacity cannot exceed maximum capacity.");
  }
}
```

---

## Export Structure

### Index File Pattern (Barrel Exports)

Each construct directory must have an `index.ts` that re-exports all constructs.

**`lib/constructs/{category}/index.ts`**

```typescript
/** @format */

// {Category} constructs
export * from "./resource-construct";
export * from "./another-construct";
```

**`lib/constructs/{category}/{subcategory}/index.ts`**

```typescript
/** @format */

// {Subcategory} constructs
export * from "./specific-construct";
export * from "./related-construct";
```

**Parent category `index.ts`**

```typescript
/** @format */

// {Category} constructs organised by service

// Subcategory 1
export * from "./subcategory1";

// Subcategory 2
export * from "./subcategory2";
```

---

## Integration with Stacks

### How Stacks Consume Constructs

```typescript
/** @format */

import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";

// Import from barrel export
import { VpcConstruct } from "../../constructs/networking";
import { EcsClusterConstruct } from "../../constructs/compute";
import { MyStackProps } from "../../shared/types/stack-types";
import { applyStackTags } from "../../shared/helpers/stack-tagging-helper";
import { validateEnvName } from "../../shared/utils/validation";

export class MyStack extends cdk.Stack {
  public readonly vpc: VpcConstruct;
  public readonly cluster: EcsClusterConstruct;

  constructor(scope: Construct, id: string, props: MyStackProps) {
    super(scope, id, props);

    // Validation first
    validateEnvName(props.envName);

    // Create resources using constructs
    this.vpc = new VpcConstruct(this, "Vpc", {
      envName: props.envName,
      projectName: props.projectName,
      cidr: props.vpcCidr,
    });

    this.cluster = new EcsClusterConstruct(this, "Cluster", {
      vpc: this.vpc.vpc,
      envName: props.envName,
      projectName: props.projectName,
    });

    // Apply standard tags
    applyStackTags(this, props.envName, props.projectName, {
      ...props.customTags,
      StackName: "MyStack",
    });
  }
}
```

---

## Best Practices Checklist

### Before Creating a Construct

- [ ] Check if similar construct already exists
- [ ] Determine if construct warrants separate file (3+ reuses, 200+ lines)
- [ ] Identify which category the construct belongs to
- [ ] Plan the props interface with required vs optional properties

### Construct Development

- [ ] Use L2/L3 CDK constructs over L1 (Cfn) where possible
- [ ] Implement input validation at the start of the constructor
- [ ] Provide helpful error messages with troubleshooting steps
- [ ] Use constants from `shared/constants` for default values
- [ ] Apply environment-specific logic for production vs non-production
- [ ] Add comprehensive JSDoc documentation with examples
- [ ] Use section dividers (`// ========`) for code organisation

### Resource Configuration

- [ ] Include resource tagging (Name, Environment, Project, ManagedBy)
- [ ] Consider encryption (KMS) for sensitive resources
- [ ] Set appropriate removal policies (RETAIN for production, DESTROY otherwise)
- [ ] Configure logging with appropriate retention periods
- [ ] Add security warnings using `cdk.Annotations.of(this).addWarning()`

### Outputs and Exports

- [ ] Create CfnOutput for resources that may be referenced by other stacks
- [ ] Use consistent export naming: `${stackName}-${resource}-${property}`
- [ ] Expose necessary properties via public readonly fields
- [ ] Provide getter methods for derived values

### Testing Considerations

- [ ] Construct validates inputs correctly (throw on invalid input)
- [ ] All required resources are created with expected properties
- [ ] Tags are applied correctly
- [ ] Environment-specific logic works for all environments

### Documentation

- [ ] Class-level JSDoc with description, features, and example
- [ ] Method-level JSDoc for public methods
- [ ] Update category README.md if adding significant functionality
- [ ] Update barrel exports (index.ts) in construct directory

---

## Quick Reference: Construct Levels

| Level | Description | When to Use | Example |
|-------|-------------|-------------|---------|
| L1 | Raw CloudFormation | Rarely - only when L2/L3 not available | `CfnBucket` |
| L2 | CDK constructs with sensible defaults | Most common - provides good abstractions | `Bucket` |
| L3 | Patterns combining multiple resources | Complex use cases with multiple resources | `ApplicationLoadBalancedFargateService` |
| Custom | Your own construct extending L2/L3 | Reusable patterns specific to your organisation | `VpcConstruct` |

---

## Template

See `lib/constructs/construct-template.ts` for a complete template with all patterns pre-configured.
