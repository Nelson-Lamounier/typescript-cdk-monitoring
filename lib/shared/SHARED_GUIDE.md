# Shared Module Development Guide

This guide provides a comprehensive reference for creating and maintaining shared modules in this repository. The `lib/shared/` directory contains reusable types, constants, utilities, and helpers used across constructs and stacks.

## Table of Contents

1. [Directory Structure](#directory-structure)
2. [Module Categories](#module-categories)
3. [Types Module](#types-module)
4. [Constants Module](#constants-module)
5. [Utils Module](#utils-module)
6. [Helpers Module](#helpers-module)
7. [Barrel Exports](#barrel-exports)
8. [Best Practices Checklist](#best-practices-checklist)

---

## Directory Structure

```
lib/shared/
├── constants/                 # Static values and defaults
│   ├── compute-constants.ts
│   ├── config-constants.ts
│   ├── monitoring-constants.ts
│   ├── networking-constants.ts
│   ├── security-constants.ts
│   ├── service-constants.ts
│   ├── storage-constants.ts
│   └── index.ts              # Barrel export
├── helpers/                   # Complex helper classes and functions
│   ├── cost-helper.ts
│   ├── ecs-agent-script-builder.ts
│   ├── grafana-datasource-builder.ts
│   ├── instance-type-helper.ts
│   ├── kms-key-helper.ts
│   ├── prometheus-config-builder.ts
│   ├── security-group-helper.ts
│   ├── stack-tagging-helper.ts
│   ├── subnet-configuration-helper.ts
│   ├── README.md
│   └── index.ts              # Barrel export
├── types/                     # TypeScript interfaces and types
│   ├── compute-types.ts
│   ├── config-types.ts
│   ├── monitoring-types.ts
│   ├── networking-types.ts
│   ├── security-types.ts
│   ├── service-types.ts
│   ├── stack-types.ts
│   ├── storage-types.ts
│   └── index.ts              # Barrel export
└── utils/                     # Pure utility functions
    ├── environment.ts
    ├── lambda-helpers.ts
    ├── retention.ts
    ├── route-table-helpers.ts
    ├── validation.ts
    ├── yaml-converter.ts
    └── index.ts              # Barrel export
```

### File Naming Convention

```
{category}-{type}.ts

Examples:
- compute-types.ts      (types for compute constructs)
- networking-constants.ts (constants for networking)
- validation.ts         (validation utilities)
```

---

## Module Categories

| Category | Purpose | Examples |
|----------|---------|----------|
| **types/** | TypeScript interfaces and type definitions | Props interfaces, config types |
| **constants/** | Static values, defaults, limits | Ports, CIDR blocks, retention days |
| **utils/** | Pure functions, stateless utilities | Validation, environment checks |
| **helpers/** | Complex classes, builders, stateful helpers | Script builders, tagging helpers |

### When to Use Each

```
constants/  → Static values that never change at runtime
types/      → TypeScript interfaces for type safety
utils/      → Pure functions (input → output, no side effects)
helpers/    → Complex logic, builders, may have state
```

---

## Types Module

Types define the shape of data used throughout the codebase.

### File Organisation

- **One file per domain**: `compute-types.ts`, `networking-types.ts`
- **Stack props in**: `stack-types.ts`
- **Construct props in**: Domain-specific file (e.g., `compute-types.ts`)

### Type Definition Pattern

```typescript
/** @format */

import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as logs from "aws-cdk-lib/aws-logs";

// ========================================
// BASE INTERFACES
// ========================================

/**
 * Base props shared across multiple constructs/stacks
 */
export interface BaseProps {
  /**
   * Environment name (e.g., development, staging, production)
   */
  envName: string;

  /**
   * Project name for resource naming and tagging
   */
  projectName?: string;
}

// ========================================
// CONSTRUCT PROPS
// ========================================

/**
 * Props for MyConstruct
 *
 * @example
 * ```typescript
 * const construct = new MyConstruct(this, 'My', {
 *   envName: 'production',
 *   vpc: networkingStack.vpc,
 *   minCapacity: 2,
 * });
 * ```
 */
export interface MyConstructProps extends BaseProps {
  // ========================================
  // REQUIRED PROPERTIES
  // ========================================

  /**
   * VPC for resource placement
   */
  vpc: ec2.IVpc;

  // ========================================
  // OPTIONAL PROPERTIES
  // ========================================

  /**
   * Minimum capacity for scaling
   * @default 1 for dev, 2 for production
   */
  minCapacity?: number;

  /**
   * Log retention period
   * @default TWO_WEEKS for dev, THREE_MONTHS for production
   */
  logRetention?: logs.RetentionDays;
}

// ========================================
// CONFIGURATION TYPES
// ========================================

/**
 * Configuration for service deployment
 */
export interface ServiceConfig {
  cpu: number;
  memoryMiB: number;
  containerPort: number;
}

// ========================================
// UNION TYPES AND ENUMS
// ========================================

/**
 * ECS launch type
 */
export type EcsLaunchType = "EC2" | "FARGATE" | "EXTERNAL";

/**
 * Environment tier for resource sizing
 */
export type EnvironmentTier = "development" | "staging" | "production" | "pipeline";
```

### Key Patterns

1. **Group by purpose**: Base → Required → Optional → Config → Unions
2. **Document with JSDoc**: Include `@example` for complex props
3. **Use `@default`**: Document default values in comments
4. **Extend base interfaces**: Avoid duplication
5. **Import AWS types**: Use CDK types directly (`ec2.IVpc`, `logs.RetentionDays`)

---

## Constants Module

Constants define static values, defaults, and limits.

### File Organisation

- **One file per domain**: `compute-constants.ts`, `networking-constants.ts`
- **Group related constants**: Use section dividers
- **Use `as const`**: For immutable objects

### Constants Pattern

```typescript
/** @format */

import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as logs from "aws-cdk-lib/aws-logs";

// ========================================
// DEFAULT VALUES
// ========================================

/**
 * Default CIDR mask for subnets
 * /24 provides 251 usable IP addresses per subnet
 */
export const DEFAULT_SUBNET_CIDR_MASK = 24;

/**
 * Default VPC CIDR block
 * /16 provides 65,536 IP addresses
 */
export const DEFAULT_VPC_CIDR = "10.0.0.0/16";

// ========================================
// LIMITS AND BOUNDARIES
// ========================================

/**
 * Minimum allowed CIDR mask for subnets
 */
export const MIN_SUBNET_CIDR_MASK = 16;

/**
 * Maximum allowed CIDR mask for subnets
 */
export const MAX_SUBNET_CIDR_MASK = 28;

// ========================================
// ENVIRONMENT-SPECIFIC DEFAULTS
// ========================================

/**
 * VPC CIDR blocks by environment
 * Prevents accidental overlap between environments
 */
export const VPC_CIDR_BLOCKS = {
  DEV: "10.0.0.0/16",
  STAGING: "10.1.0.0/16",
  PRODUCTION: "10.2.0.0/16",
  PIPELINE: "10.3.0.0/16",
} as const;

/**
 * NAT Gateway defaults by environment
 * Production uses HA, dev saves costs
 */
export const VPC_NAT_GATEWAYS = {
  DEV: 0,           // No NAT = lower cost
  STAGING: 1,       // Single NAT = cost optimised
  PRODUCTION: 2,    // NAT per AZ = high availability
} as const;

// ========================================
// PORT DEFINITIONS
// ========================================

/**
 * Common network ports for security group rules
 */
export const COMMON_PORTS = {
  HTTP: 80,
  HTTPS: 443,
  SSH: 22,
  MYSQL: 3306,
  POSTGRESQL: 5432,
  PROMETHEUS: 9090,
  GRAFANA: 3000,
  NODE_EXPORTER: 9100,
} as const;

// ========================================
// RECOMMENDATIONS
// ========================================

/**
 * Recommended CIDR masks for different use cases
 */
export const SUBNET_CIDR_RECOMMENDATIONS = {
  SMALL: 28,        // ~11 usable IPs
  STANDARD: 24,     // ~251 usable IPs
  LARGE: 20,        // ~4091 usable IPs
  EXTRA_LARGE: 18,  // ~16,379 usable IPs
} as const;

// ========================================
// VALIDATION PATTERNS
// ========================================

/**
 * SSM Parameter validation rules
 */
export const SSM_PARAMETER_VALIDATION = {
  MAX_NAME_LENGTH: 1024,
  MAX_VALUE_LENGTH_STANDARD: 4096,
  MAX_VALUE_LENGTH_ADVANCED: 8192,
  NAME_REGEX: /^\/[A-Za-z0-9._\-/]+$/,
  INVALID_PATTERNS: [/\/\//,  /\/$/],
} as const;
```

### Key Patterns

1. **Descriptive names**: `DEFAULT_`, `MIN_`, `MAX_`, `_RECOMMENDATIONS`
2. **JSDoc comments**: Explain what and why
3. **Use `as const`**: Makes object properties readonly and literal types
4. **Group logically**: Use section dividers
5. **Environment-aware**: Provide per-environment values where applicable

---

## Utils Module

Utilities are pure functions that transform data or perform checks.

### File Organisation

- **Group by function**: `validation.ts`, `environment.ts`
- **Pure functions only**: No side effects
- **Single responsibility**: One purpose per function

### Utility Function Pattern

```typescript
/** @format */

import { MIN_SUBNET_CIDR_MASK, MAX_SUBNET_CIDR_MASK } from "../constants/networking-constants";

// ========================================
// ENVIRONMENT UTILITIES
// ========================================

/**
 * Production environment names
 */
const PRODUCTION_ENVIRONMENTS = ["production", "prod"];

/**
 * Check if the environment is a production environment
 *
 * Production environments have stricter validation, warnings,
 * and different default configurations (e.g., multi-AZ, HA settings).
 *
 * @param envName - Environment name to check
 * @returns true if this is a production environment
 *
 * @example
 * ```typescript
 * if (isProductionEnvironment(props.envName)) {
 *   natGateways = 2; // HA NAT gateways
 * }
 * ```
 */
export function isProductionEnvironment(envName: string): boolean {
  if (!envName) return false;
  return PRODUCTION_ENVIRONMENTS.includes(envName.toLowerCase());
}

// ========================================
// VALIDATION UTILITIES
// ========================================

/**
 * Validate subnet CIDR mask is within acceptable range
 *
 * @param cidrMask - CIDR mask to validate (16-28)
 * @throws Error if CIDR mask is out of range
 *
 * @example
 * ```typescript
 * validateSubnetCidrMask(24); // Valid
 * validateSubnetCidrMask(8);  // Throws error
 * ```
 */
export function validateSubnetCidrMask(cidrMask: number): void {
  if (cidrMask < MIN_SUBNET_CIDR_MASK || cidrMask > MAX_SUBNET_CIDR_MASK) {
    throw new Error(
      `Subnet CIDR mask must be between ${MIN_SUBNET_CIDR_MASK} and ${MAX_SUBNET_CIDR_MASK}. ` +
        `Received: ${cidrMask}. ` +
        `Common values: /24 (251 IPs), /20 (4091 IPs), /28 (11 IPs)`
    );
  }

  if (!Number.isInteger(cidrMask)) {
    throw new Error(
      `Subnet CIDR mask must be an integer. Received: ${cidrMask}`
    );
  }
}

/**
 * Validate environment name presence and formatting
 *
 * @param envName - Environment name to validate
 * @throws Error if envName is missing or invalid
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
```

### Validation Error Message Pattern

```typescript
throw new Error(
  `Brief description of what went wrong.\n\n` +
    `Troubleshooting Steps:\n` +
    ` 1. First thing to check\n` +
    ` 2. Second thing to check\n` +
    ` 3. Third thing to check\n\n` +
    `Example:\n` +
    `  const validValue = ...;`
);
```

### Key Patterns

1. **Pure functions**: No side effects, same input → same output
2. **Single responsibility**: One purpose per function
3. **Descriptive JSDoc**: Include `@param`, `@returns`, `@throws`, `@example`
4. **Helpful error messages**: Include context, troubleshooting steps, examples
5. **Use constants**: Import limits from constants module

---

## Helpers Module

Helpers contain complex logic, builders, or stateful operations.

### File Organisation

- **One file per helper class/domain**: `stack-tagging-helper.ts`
- **Classes for complex builders**: `ecs-agent-script-builder.ts`
- **Functions for simpler operations**: `stack-tagging-helper.ts`

### Helper Class Pattern (Builder)

```typescript
/** @format */

import * as ec2 from "aws-cdk-lib/aws-ec2";

/**
 * Helper class for creating standard subnet configurations
 *
 * Provides factory methods for common subnet patterns
 * following AWS best practices.
 *
 * @example
 * ```typescript
 * // Create two-tier architecture (public + private)
 * const subnets = SubnetConfigurationHelper.twoTierConfiguration();
 *
 * // Create custom public subnet
 * const publicSubnet = SubnetConfigurationHelper.publicSubnet(24);
 * ```
 */
export class SubnetConfigurationHelper {
  // ========================================
  // FACTORY METHODS - Individual Subnets
  // ========================================

  /**
   * Create a public subnet configuration
   *
   * @param cidrMask - CIDR mask for the subnet (default: 24)
   * @returns Subnet configuration for public subnet
   */
  public static publicSubnet(cidrMask: number = 24): ec2.SubnetConfiguration {
    return {
      name: "Public",
      subnetType: ec2.SubnetType.PUBLIC,
      cidrMask,
    };
  }

  /**
   * Create a private subnet configuration (with NAT egress)
   *
   * @param cidrMask - CIDR mask for the subnet (default: 24)
   * @returns Subnet configuration for private subnet
   */
  public static privateSubnet(cidrMask: number = 24): ec2.SubnetConfiguration {
    return {
      name: "Private",
      subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      cidrMask,
    };
  }

  // ========================================
  // FACTORY METHODS - Common Architectures
  // ========================================

  /**
   * Create standard two-tier subnet configuration
   *
   * Public subnets for internet-facing resources (ALB, NAT)
   * Private subnets for application resources (ECS, RDS)
   *
   * @returns Array of subnet configurations
   */
  public static twoTierConfiguration(): ec2.SubnetConfiguration[] {
    return [
      this.publicSubnet(),
      this.privateSubnet(),
    ];
  }

  /**
   * Create three-tier subnet configuration
   *
   * Public for ALB, Private for apps, Isolated for databases
   *
   * @returns Array of subnet configurations
   */
  public static threeTierConfiguration(): ec2.SubnetConfiguration[] {
    return [
      this.publicSubnet(),
      this.privateSubnet(),
      this.isolatedSubnet(),
    ];
  }

  // ========================================
  // PRIVATE METHODS
  // ========================================

  private static isolatedSubnet(cidrMask: number = 24): ec2.SubnetConfiguration {
    return {
      name: "Isolated",
      subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      cidrMask,
    };
  }
}
```

### Helper Function Pattern

```typescript
/** @format */

import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { getDefaultTags, toTagsRecord } from "../../../config/tagging";

/**
 * Apply standard tags to a stack using centralised configuration
 *
 * Adds consistent tagging across all resources in the stack:
 * - Environment: The deployment environment
 * - ManagedBy: CDK
 * - Project: Optional project name
 * - Custom tags: Any additional tags provided
 *
 * @param scope - The construct scope (typically `this` in a stack)
 * @param envName - Environment name for tagging
 * @param projectName - Optional project name
 * @param customTags - Optional additional tags (overrides defaults)
 *
 * @example
 * ```typescript
 * export class MyStack extends cdk.Stack {
 *   constructor(scope: Construct, id: string, props: MyStackProps) {
 *     super(scope, id, props);
 *
 *     applyStackTags(this, props.envName, props.projectName, {
 *       Application: 'api-gateway'
 *     });
 *   }
 * }
 * ```
 */
export function applyStackTags(
  scope: Construct,
  envName: string,
  projectName?: string,
  customTags?: Record<string, string>
): void {
  const tags = getDefaultTags(envName, projectName, customTags);
  const tagsRecord = toTagsRecord(tags);

  Object.entries(tagsRecord).forEach(([key, value]) => {
    cdk.Tags.of(scope).add(key, value);
  });
}
```

### Key Patterns

1. **Classes for builders**: When you need multiple related factory methods
2. **Functions for operations**: When you need a single operation
3. **Static methods**: For stateless factory patterns
4. **JSDoc with examples**: Show common usage patterns
5. **Section dividers**: Group related methods

---

## Barrel Exports

Each module has an `index.ts` that re-exports all public members.

### Pattern

```typescript
/** @format */

// Re-export all public members
export * from "./compute-types";
export * from "./config-types";
export * from "./monitoring-types";
export * from "./networking-types";
export * from "./security-types";
export * from "./stack-types";
export * from "./storage-types";
export * from "./service-types";
```

### For Helpers with Classes

```typescript
/** @format */

// Named export for classes
export { SubnetConfigurationHelper } from "./subnet-configuration-helper";

// Star export for functions
export * from "./security-group-helper";
export * from "./ecs-agent-script-builder";
export * from "./stack-tagging-helper";
export * from "./instance-type-helper";
export * from "./kms-key-helper";
export * from "./cost-helper";
```

### Importing from Shared

```typescript
// From constructs or stacks
import { MyConstructProps, BaseStackProps } from "../../shared/types";
import { DEFAULT_VPC_CIDR, COMMON_PORTS } from "../../shared/constants";
import { validateEnvName, isProductionEnvironment } from "../../shared/utils";
import { SubnetConfigurationHelper, applyStackTags } from "../../shared/helpers";

// Or more specifically
import { validateEnvName } from "../../shared/utils/validation";
```

---

## Best Practices Checklist

### Before Creating a Shared Module

- [ ] Determine the correct category (types/constants/utils/helpers)
- [ ] Check if similar functionality already exists
- [ ] Plan the file organisation within the category
- [ ] Identify if it will be used by 3+ constructs/stacks

### Types Development

- [ ] Group interfaces logically (Base → Required → Optional)
- [ ] Document all properties with JSDoc
- [ ] Include `@default` for optional properties
- [ ] Add `@example` for complex types
- [ ] Extend base interfaces to avoid duplication
- [ ] Export from `index.ts`

### Constants Development

- [ ] Use descriptive naming (`DEFAULT_`, `MIN_`, `MAX_`)
- [ ] Document what each constant represents
- [ ] Use `as const` for immutable objects
- [ ] Group related constants with section dividers
- [ ] Provide environment-specific values where applicable
- [ ] Export from `index.ts`

### Utils Development

- [ ] Write pure functions only (no side effects)
- [ ] Include comprehensive JSDoc with `@param`, `@returns`, `@throws`
- [ ] Add `@example` for each function
- [ ] Use constants for limits and boundaries
- [ ] Write helpful error messages with troubleshooting steps
- [ ] Export from `index.ts`

### Helpers Development

- [ ] Use classes for complex builders
- [ ] Use functions for simpler operations
- [ ] Document with JSDoc and examples
- [ ] Follow single responsibility principle
- [ ] Export appropriately from `index.ts`

### General

- [ ] Add file header `/** @format */`
- [ ] Use consistent section dividers
- [ ] Follow import order (AWS CDK → third-party → internal)
- [ ] Check for circular dependencies
- [ ] Update barrel exports
- [ ] Verify no linter errors

---

## Quick Reference

### When to Create Where

| Need | Location | Example |
|------|----------|---------|
| Interface for props | `types/{category}-types.ts` | `EcsClusterConstructProps` |
| Stack props | `types/stack-types.ts` | `MonitoringInfraStackProps` |
| Default value | `constants/{category}-constants.ts` | `DEFAULT_VPC_CIDR` |
| Port number | `constants/networking-constants.ts` | `COMMON_PORTS.HTTP` |
| Validation function | `utils/validation.ts` | `validateEnvName()` |
| Environment check | `utils/environment.ts` | `isProductionEnvironment()` |
| Builder class | `helpers/{name}-helper.ts` | `SubnetConfigurationHelper` |
| Tagging function | `helpers/stack-tagging-helper.ts` | `applyStackTags()` |

### Import Paths

```typescript
// Full module import
import { MyType } from "../../shared/types";
import { MY_CONSTANT } from "../../shared/constants";
import { myUtil } from "../../shared/utils";
import { MyHelper } from "../../shared/helpers";

// Specific file import (for large modules)
import { validateEnvName } from "../../shared/utils/validation";
import { COMMON_PORTS } from "../../shared/constants/networking-constants";
```
