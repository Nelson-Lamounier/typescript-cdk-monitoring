# CDK Application Entry Point Guide

This guide provides a comprehensive reference for the `bin/` directory, the entry point for CDK deployments. It covers the application architecture, stack orchestration, and how to add new projects.

## Table of Contents

1. [Directory Structure](#directory-structure)
2. [File Organisation](#file-organisation)
3. [App.ts Anatomy](#appts-anatomy)
4. [Stack Factory Functions](#stack-factory-functions)
5. [Helper Functions](#helper-functions)
6. [Type Definitions](#type-definitions)
7. [Integration with lib/ Stacks](#integration-with-lib-stacks)
8. [Best Practices Checklist](#best-practices-checklist)

---

## Directory Structure

```
bin/
├── app.ts                      # Main CDK application entry point
├── README.md                   # Deployment guide and architecture docs
├── stacks/                     # Stack factory functions by project
│   ├── foundation-stack.ts     # Foundation (VPC) stack orchestration
│   ├── monitoring-stack.ts     # Monitoring project stack orchestration
│   ├── security-stack.ts       # Security project stack orchestration
│   └── webapp-stack.ts         # Webapp project stack orchestration
└── helpers/                    # Deployment helper functions
    ├── certificate-helper.ts   # ACM certificate resolution
    └── vpc-peering-helper.ts   # VPC peering configuration
```

### Relationship to Other Directories

```
bin/                            # Entry point - orchestrates stacks
  └── imports from ↓
lib/stacks/                     # Stack definitions (CloudFormation)
  └── imports from ↓
lib/constructs/                 # Reusable constructs (L2/L3)
  └── imports from ↓
lib/shared/                     # Shared types, constants, utils
  └── imports from ↓
config/                         # Environment and project configuration
```

---

## File Organisation

### When to Create New Files

| Location | Create When |
|----------|-------------|
| `bin/stacks/{project}-stack.ts` | Adding a new project with multiple stacks |
| `bin/helpers/{helper-name}.ts` | Reusable deployment logic across projects |
| `bin/app.ts` | Never create new - single entry point |

### Naming Conventions

| Type | Pattern | Example |
|------|---------|---------|
| Stack factory | `{project}-stack.ts` | `monitoring-stack.ts` |
| Helper | `{domain}-helper.ts` | `certificate-helper.ts` |
| Function | `create{Project}Stacks` | `createMonitoringStacks` |
| Function | `deploy{Domain}Stacks` | `deployFoundationStacks` |

---

## App.ts Anatomy

The main entry point follows a structured pattern:

### File Header and Imports

```typescript
#!/usr/bin/env node
/** @format */

import "source-map-support/register";
import * as cdk from "aws-cdk-lib";

// Configuration imports
import { environments } from "../config/environments";
import { getDefaultTags, toTagsRecord } from "../config/tagging";
import {
  validateConfiguration,
  validateAllProjects,
  formatValidationResult,
} from "../config/validation";

// Cost estimation imports
import {
  calculateProjectCost,
  formatCostBreakdown,
  compareCosts,
} from "../lib/shared/helpers/cost-helper";

// Stack factory imports
import { deployFoundationStacks } from "./stacks/foundation-stack";
import { createMonitoringStacks } from "./stacks/monitoring-stack";
import { createSecurityStacks } from "./stacks/security-stack";
import { createWebappStacks } from "./stacks/webapp-stack";
```

### CDK App Initialisation

```typescript
const app = new cdk.App();

// Get environment from context or use default
const envName = app.node.tryGetContext("environment") || "development";
const envConfig = environments[envName];

if (!envConfig) {
  throw new Error(
    `Environment '${envName}' not found in configuration.\n\n` +
      `Available environments: ${Object.keys(environments).join(", ")}\n` +
      `Usage: cdk deploy --context environment=development`
  );
}
```

### Context Override Support

```typescript
// Allow context override for CI/CD deployments
const contextAccount = app.node.tryGetContext("accountId");
const contextRegion = app.node.tryGetContext("awsRegion");

const targetAccount = contextAccount || envConfig.account;
const targetRegion = contextRegion || envConfig.region;

console.log(`Deploying to environment: ${envName}`);
console.log(`Region: ${targetRegion || "auto-detect"}`);
console.log(`Account: ${targetAccount || "auto-detect"}`);

if (contextAccount) {
  console.log(`  (Account overridden via context)`);
}
```

### Configuration Validation

```typescript
// ============================================================================
// CONFIGURATION VALIDATION (Pre-Deployment Checks)
// ============================================================================

console.log(`\n${"=".repeat(80)}`);
console.log("CONFIGURATION VALIDATION");
console.log("=".repeat(80));

// Validate environment configuration
const envValidation = validateConfiguration(envName);
console.log(formatValidationResult(envValidation, `Environment: ${envName}`));

if (!envValidation.valid) {
  throw new Error(
    `\n❌ Environment configuration validation failed for '${envName}'.\n` +
    `Please fix the errors above before deploying.`
  );
}

// Validate all projects
const projectsToValidate = ["monitoring", "webapp"];
const projectValidations = validateAllProjects(envName, projectsToValidate);

let hasProjectErrors = false;
projectValidations.forEach((validation, projectName) => {
  console.log(formatValidationResult(validation, `Project: ${projectName}`));
  if (!validation.valid) {
    hasProjectErrors = true;
  }
});

if (hasProjectErrors) {
  throw new Error(
    `\n❌ Project configuration validation failed.\n` +
    `Please fix the errors above before deploying.`
  );
}

console.log(`\n✅ All configuration validation checks passed!`);
```

### Cost Estimation

```typescript
// ============================================================================
// COST ESTIMATION (Budget Planning)
// ============================================================================

console.log(`${"=".repeat(80)}`);
console.log("ESTIMATED MONTHLY COSTS");
console.log("=".repeat(80));

const projectsForCost = ["monitoring", "webapp"];

projectsForCost.forEach((projectName) => {
  const costBreakdown = calculateProjectCost(projectName, envName, targetRegion);
  console.log(formatCostBreakdown(projectName, envName, costBreakdown, targetRegion));
});

// Show cost comparison if not in production
if (envName !== "production") {
  console.log(compareCosts("monitoring", ["development", "production"], targetRegion));
}
```

### Stack Props Setup

```typescript
// Stack props applied to all stacks
const stackProps: cdk.StackProps = {
  env: {
    account: targetAccount,
    region: targetRegion,
  },
};
```

### Stack Orchestration

```typescript
// ============================================================================
// FOUNDATION STACKS
// ============================================================================

const { networkingStack } = deployFoundationStacks(app, envConfig, stackProps);

// ============================================================================
// MONITORING STACKS
// ============================================================================

const { infraStack: monitoringInfraStack } = createMonitoringStacks(
  app,
  envName,
  envConfig,
  networkingStack,
  stackProps
);

// ============================================================================
// SECURITY STACKS
// ============================================================================

createSecurityStacks(
  app,
  envName,
  envConfig,
  networkingStack,
  monitoringInfraStack.cluster,
  stackProps
);

// ============================================================================
// WEBAPP STACKS
// ============================================================================

createWebappStacks(app, envName, envConfig, networkingStack, stackProps);
```

### Centralised Tagging

```typescript
// ============================================================================
// STACK TAGGING (Centralised Configuration)
// ============================================================================

const appTags = getDefaultTags(envName);
const tagsRecord = toTagsRecord(appTags);

// Apply all tags to the app
Object.entries(tagsRecord).forEach(([key, value]) => {
  cdk.Tags.of(app).add(key, value);
});

console.log(`\nApplied tags:`, JSON.stringify(tagsRecord, null, 2));
```

### Synthesis

```typescript
app.synth();
```

---

## Stack Factory Functions

Stack factory functions orchestrate multiple stacks for a project.

### File Structure

```typescript
/** @format */

import * as cdk from "aws-cdk-lib";

// Stack imports
import { NetworkingStack } from "../../lib/stacks/foundation/networking-stack";
import { MyProjectStack1 } from "../../lib/stacks/myproject/stack1";
import { MyProjectStack2 } from "../../lib/stacks/myproject/stack2";
import { EnvironmentConfig } from "../../config/environments";
import { getProjectConfig } from "../../config/projects";

/**
 * Create all stacks for MyProject
 *
 * Architecture:
 * 1. Stack1 - Description (e.g., storage layer)
 * 2. Stack2 - Description (e.g., compute layer)
 *
 * Dependencies:
 * - Requires NetworkingStack (VPC, subnets)
 * - Each stack depends on the previous
 *
 * @param app CDK app
 * @param envName Environment name
 * @param envConfig Environment configuration
 * @param networkingStack The networking stack
 * @param stackProps Stack properties
 */
export function createMyProjectStacks(
  app: cdk.App,
  envName: string,
  envConfig: EnvironmentConfig,
  networkingStack: NetworkingStack,
  stackProps: cdk.StackProps
): {
  stack1: MyProjectStack1;
  stack2: MyProjectStack2;
} {
  const stackNamePrefix = `${envName}-MyProject`;
  const projectName = "myproject";
  
  // Get project configuration with environment-specific overrides
  const projectConfig = getProjectConfig(projectName, envName);

  // ============================================================================
  // 1. FIRST STACK (e.g., Storage Layer)
  // ============================================================================

  const stack1 = new MyProjectStack1(app, `${stackNamePrefix}Storage`, {
    ...stackProps,
    envName,
    projectName,
    
    // Configuration
    removalPolicy: envConfig.isProduction
      ? cdk.RemovalPolicy.RETAIN
      : cdk.RemovalPolicy.DESTROY,
  });

  // ============================================================================
  // 2. SECOND STACK (e.g., Compute Layer)
  // ============================================================================

  const stack2 = new MyProjectStack2(app, `${stackNamePrefix}Compute`, {
    ...stackProps,
    envName,
    projectName,
    
    // Cross-stack references
    vpc: networkingStack.vpc,
    storage: stack1.storage,
    
    // Environment-aware configuration
    minCapacity: envConfig.isProduction ? 2 : 1,
    maxCapacity: envConfig.isProduction ? 4 : 1,
  });

  // Add dependencies
  stack1.addDependency(networkingStack);
  stack2.addDependency(stack1);

  return {
    stack1,
    stack2,
  };
}
```

### Key Patterns

#### Stack Naming Convention

```typescript
const stackNamePrefix = `${envName}-MyProject`;

// Results in: development-MyProjectStorage, development-MyProjectCompute
new Stack(app, `${stackNamePrefix}Storage`, { ... });
new Stack(app, `${stackNamePrefix}Compute`, { ... });
```

#### Explicit Dependencies

```typescript
// Storage doesn't depend on networking directly but adds for deployment order
stack1.addDependency(networkingStack);

// Compute depends on storage
stack2.addDependency(stack1);
```

#### Environment-Aware Configuration

```typescript
// RemovalPolicy
removalPolicy: envConfig.isProduction
  ? cdk.RemovalPolicy.RETAIN
  : cdk.RemovalPolicy.DESTROY,

// Capacity
minCapacity: envConfig.isProduction ? 2 : 1,
maxCapacity: envConfig.isProduction ? 4 : 1,

// Features
enableDeletionProtection: envConfig.isProduction,
enableAccessLogs: envConfig.isProduction,
```

#### Cross-Stack References

```typescript
// Pass resources from one stack to another
vpc: networkingStack.vpc,
storage: stack1.storage,
cluster: infraStack.cluster,
```

#### Return Created Stacks

```typescript
return {
  stack1,
  stack2,
  // Allows other projects to reference these stacks
};
```

---

## Helper Functions

Helpers encapsulate reusable deployment logic.

### Certificate Helper Example

```typescript
/** @format */

import * as cdk from "aws-cdk-lib";

import { CertificateStack } from "../../lib/stacks/networking/security/acm-stack";

export interface CertificateConfig {
  certificateArn?: string;
  certificateStack?: CertificateStack;
  isConfigured: boolean;
}

/**
 * Resolve ACM certificate for HTTPS
 * Priority: Environment variable > Create new > SSM lookup
 */
export function resolveCertificate(
  app: cdk.App,
  envName: string,
  stackProps: cdk.StackProps,
  rootDomainName?: string,
  hostedZoneId?: string
): CertificateConfig {
  // 1. Check environment variable (from CI/CD)
  if (process.env.CERTIFICATE_ARN) {
    return {
      certificateArn: process.env.CERTIFICATE_ARN,
      isConfigured: true,
    };
  }

  // 2. Create new certificate (if domain configured)
  if (rootDomainName && hostedZoneId) {
    const certificateStack = new CertificateStack(app, `${envName}-Certificate`, {
      ...stackProps,
      envName,
      DomainName: rootDomainName,
      subjectAlternativeNames: [`*.${rootDomainName}`],
      hostedZoneId,
      storeCertificateArnInSsm: true,
    });

    return {
      certificateArn: certificateStack.certificateArn,
      certificateStack,
      isConfigured: true,
    };
  }

  // 3. Try SSM lookup (fallback)
  if (process.env.SKIP_DOMAIN_LOOKUP !== "true") {
    try {
      const certificateArn = cdk.aws_ssm.StringParameter.valueFromLookup(
        app,
        "/portfolio/domain/acm-arn"
      );

      if (!certificateArn?.includes("dummy-value")) {
        return {
          certificateArn,
          isConfigured: true,
        };
      }
    } catch {
      // Parameter doesn't exist
    }
  }

  // No certificate configured
  return { isConfigured: false };
}
```

### Helper Patterns

1. **Priority-based resolution**: Environment variable → Create → SSM lookup
2. **Return configuration objects**: Include both the value and metadata
3. **Handle missing configuration gracefully**: Return `isConfigured: false`
4. **Support CI/CD overrides**: Check `process.env` first

---

## Type Definitions

### Environment Configuration

```typescript
// From config/environments.ts
export interface EnvironmentConfig {
  account: string;
  region: string;
  envName: string;
  vpcCidr: string;
  natGateways?: number;
  isProduction: boolean;
  pipelineAccount?: string;
}
```

### Stack Factory Return Types

```typescript
// Explicit return types for stack factories
export function createMonitoringStacks(
  ...
): {
  s3Stack: MonitoringS3Stack;
  efsStack: MonitoringEfsStack;
  infraStack: MonitoringInfraStack;
  serviceStack: MonitoringServiceStack;
}
```

---

## Integration with lib/ Stacks

### Stack Import Pattern

```typescript
// Import stack classes from lib/stacks
import { NetworkingStack } from "../../lib/stacks/foundation/networking-stack";
import { MonitoringInfraStack } from "../../lib/stacks/monitoring/infra-stack";
```

### Instantiation Pattern

```typescript
// Instantiate with envName prefix
const stack = new MyStack(app, `${envName}-MyStack`, {
  ...stackProps,          // Account/region
  envName,                // Environment name
  projectName,            // Project name
  
  // Stack-specific props
  vpc: networkingStack.vpc,
  ...otherProps,
});
```

### Cross-Project Dependencies

```typescript
// Monitoring infrastructure can be used by Security
const { infraStack: monitoringInfraStack } = createMonitoringStacks(...);

createSecurityStacks(
  app,
  envName,
  envConfig,
  networkingStack,
  monitoringInfraStack.cluster,  // Pass ECS cluster
  stackProps
);
```

---

## Adding a New Project

### Step 1: Create Stack Factory

Create `bin/stacks/{project}-stack.ts`:

```typescript
/** @format */

import * as cdk from "aws-cdk-lib";

import { NetworkingStack } from "../../lib/stacks/foundation/networking-stack";
import { MyNewStack } from "../../lib/stacks/myproject/my-stack";
import { EnvironmentConfig } from "../../config/environments";

/**
 * Create stacks for MyProject
 *
 * Architecture:
 * 1. MyStack - Description
 *
 * @param app CDK app
 * @param envName Environment name
 * @param envConfig Environment configuration
 * @param networkingStack The networking stack
 * @param stackProps Stack properties
 */
export function createMyProjectStacks(
  app: cdk.App,
  envName: string,
  envConfig: EnvironmentConfig,
  networkingStack: NetworkingStack,
  stackProps: cdk.StackProps
): {
  myStack: MyNewStack;
} {
  const stackNamePrefix = `${envName}-MyProject`;
  const projectName = "myproject";

  const myStack = new MyNewStack(app, `${stackNamePrefix}Main`, {
    ...stackProps,
    envName,
    projectName,
    vpc: networkingStack.vpc,
  });

  myStack.addDependency(networkingStack);

  return { myStack };
}
```

### Step 2: Add to app.ts

```typescript
// Add import
import { createMyProjectStacks } from "./stacks/myproject-stack";

// Add stack creation after foundation
// ============================================================================
// MYPROJECT STACKS
// ============================================================================

createMyProjectStacks(app, envName, envConfig, networkingStack, stackProps);
```

### Step 3: Update Validation (optional)

```typescript
// Add to projectsToValidate array
const projectsToValidate = ["monitoring", "webapp", "myproject"];

// Add to cost estimation
const projectsForCost = ["monitoring", "webapp", "myproject"];
```

---

## Best Practices Checklist

### App.ts Structure

- [ ] Shebang `#!/usr/bin/env node` at top
- [ ] Format pragma `/** @format */`
- [ ] Source map support import
- [ ] Environment context with default
- [ ] Environment validation before deployment
- [ ] Cost estimation output
- [ ] Centralised tagging
- [ ] `app.synth()` at end

### Stack Factory Functions

- [ ] JSDoc with architecture description
- [ ] Explicit parameter documentation
- [ ] Typed return value listing all stacks
- [ ] Stack name prefix pattern `${envName}-{Project}`
- [ ] Project config lookup
- [ ] Numbered section comments
- [ ] Explicit `addDependency()` calls
- [ ] Environment-aware configuration
- [ ] Cross-stack references passed via props

### Helper Functions

- [ ] Priority-based resolution (env var → create → lookup)
- [ ] Return configuration objects with metadata
- [ ] Handle missing configuration gracefully
- [ ] Support CI/CD overrides via `process.env`
- [ ] JSDoc documentation

### Deployment Order

- [ ] Foundation stacks first (VPC)
- [ ] Storage stacks before compute
- [ ] Infrastructure stacks before services
- [ ] Dependencies explicitly declared

### Cross-Project Dependencies

- [ ] Pass resources via function parameters
- [ ] Document dependencies in JSDoc
- [ ] Return stacks for other projects to consume

---

## Quick Reference

### File Locations

| File | Purpose |
|------|---------|
| `bin/app.ts` | CDK entry point |
| `bin/stacks/{project}-stack.ts` | Project stack orchestration |
| `bin/helpers/{domain}-helper.ts` | Reusable deployment logic |
| `bin/README.md` | Deployment documentation |

### Common Commands

```bash
# List all stacks
cdk list

# Deploy single project
cdk deploy 'development-Monitoring*'

# Deploy all stacks
cdk deploy --all

# Diff before deploy
cdk diff development-MonitoringService

# Destroy project
cdk destroy 'development-Monitoring*'
```

### Context Parameters

```bash
# Environment
cdk deploy --context environment=production

# Account/Region override (CI/CD)
cdk deploy --context accountId=123456789012 --context awsRegion=eu-west-1

# Combined
cdk deploy --context environment=production --context accountId=123456789012
```
