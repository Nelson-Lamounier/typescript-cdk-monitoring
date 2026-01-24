# Test Utilities

Shared utilities for CDK infrastructure testing. Eliminates code duplication and provides type-safe resource extraction.

## Structure

```
tests/unit/utils/
├── types.ts              # All TypeScript interfaces and types
├── template-helpers.ts   # Generic CDK template utilities
├── resource-extractors.ts # AWS resource-specific extractors
├── security-validators.ts # Security validation + pre-computation helpers
└── index.ts              # Re-exports everything
```

## Usage

### Importing Functions

```typescript
import {
  getResources,
  findAlbAttribute,
  prepareContainerData,
  isValidNetworkMode,
} from "../utils";
```

### Importing Types

```typescript
import type {
  ContainerDefinition,
  PreparedContainerData,
  AlbAttribute,
} from "../utils";
```

## Key Patterns

### 1. Pre-computation for Lint Compliance

Use `prepare*` functions in `beforeAll` to avoid conditionals in tests:

```typescript
describe("Container Security", () => {
  let preparedContainers: PreparedContainerData[];

  beforeAll(() => {
    const template = getTemplate("serviceStack");
    const taskDefs = getResources(template, RESOURCE_TYPES.ECS_TASK_DEFINITION);

    // Pre-compute all flags here - no conditionals in tests
    preparedContainers = taskDefs.flatMap((taskDef) => {
      const containers = getContainersFromTaskDef(taskDef);
      return containers.map(prepareContainerData);
    });
  });

  test("containers are not privileged", () => {
    preparedContainers.forEach(({ isPrivileged }) => {
      expect(isPrivileged).toBe(false);  // No conditional!
    });
  });
});
```

### 2. Type-safe Resource Extraction

```typescript
// Generic extraction
const properties = getResourceProperties<TaskDefinitionProperties>(taskDef);

// Specific extractors
const containers = getContainersFromTaskDef(taskDef);
const albAttr = findAlbAttribute(alb, "deletion_protection.enabled");
const clusterSetting = getContainerInsightsSetting(cluster);
```

### 3. Validation Helpers

```typescript
// Range validation
expect(isInRange(healthyThreshold, 2, 10)).toBe(true);

// Type guards
expect(isValidNetworkMode(networkMode)).toBe(true);
expect(isValidDeletionPolicy(policy)).toBe(true);

// Property validation
const validation = validateResourceProperties(resource, ["Targets", "Name"]);
expect(validation.valid).toBe(true);
```

## Available Types

### Resource Types
- `AlbAttribute`, `AlbProperties`
- `TargetGroupAttribute`, `TargetGroupHealthCheck`
- `ContainerDefinition`, `TaskDefinitionProperties`
- `ClusterSetting`, `ClusterProperties`
- `DeploymentConfiguration`, `DeploymentCircuitBreaker`
- `LaunchTemplateData`, `BlockDeviceMapping`
- `SecurityGroupIngress`, `SecurityGroupEgress`
- `ResourceTag`
- `SsmTarget`, `SsmAssociationProperties`
- And many more...

### Pre-computed Types (for beforeAll)
- `PreparedContainerData`
- `PreparedTargetGroupData`
- `PreparedSecretData`
- `PreparedAsgRollingUpdateData`
- `PreparedResourceWithContext`
- `PreparedExportData`

### Constants
- `VALID_NETWORK_MODES`
- `VALID_DELETION_POLICIES`
- `VALID_COMPLIANCE_SEVERITIES`
- `VALID_LOG_DRIVERS`

## Adding New Utilities

1. **Types**: Add to `types.ts`
2. **Extractors**: Add to `resource-extractors.ts` (import types from `./types`)
3. **Validators**: Add to `security-validators.ts`
4. **Re-export**: Ensure `index.ts` exports everything

# CDK Test Migration Guide

## Architecture Overview

This guide documents the test architecture, patterns, and migration process for CDK infrastructure tests.

### Directory Structure

```
tests/
├── unit/
│   ├── utils/                          # Shared test utilities
│   │   ├── types.ts                    # All TypeScript interfaces
│   │   ├── template-helpers.ts         # Generic CDK template utilities
│   │   ├── resource-extractors.ts      # AWS resource-specific extractors
│   │   ├── security-validators.ts      # Validation functions + constants
│   │   └── index.ts                    # Re-exports everything
│   ├── security/                       # Security posture tests
│   │   ├── application-security.test.ts
│   │   ├── compliance-governance.test.ts
│   │   ├── network-security.test.ts
│   │   └── ...
│   ├── stacks/                         # Stack-specific tests
│   ├── constructs/                     # Construct tests
│   └── connectivity/                   # Test configuration
│       └── test-config.ts              # Stack types and resource constants
```

---

## Core Principles

### 1. No Code Duplication
All helper functions, types, and extractors live in `utils/`. Test files import what they need.

### 2. No Conditionals in Tests
ESLint rule `jest/no-conditional-in-test` prohibits:
- `if` statements
- Ternary operators
- `||` / `&&` in expects
- `.filter()` inside test bodies

### 3. Pre-computation in beforeAll
Move ALL filtering and conditional logic to `beforeAll` blocks.

### 4. Guard Assertions First
Every test with `forEach` must have a guard assertion that passes even with empty arrays.

### 5. Optional vs Required Features
- **Required**: Use `expect(array.length).toBeGreaterThan(0)`
- **Optional**: Use `expect(array).toBeDefined()` + validate if items exist

---

## Test Categories

### Category 1: Required Resource Tests
Resources that MUST exist in infrastructure.

```typescript
describe("ECS Cluster Configuration", () => {
  test("ECS clusters exist and have required tags", () => {
    const template = getTemplate("infraStack");
    const clusters = getResources(template, RESOURCE_TYPES.ECS_CLUSTER);

    // REQUIRED: clusters must exist
    expect(clusters.length).toBeGreaterThan(0);

    // Validate each cluster
    clusters.forEach((cluster) => {
      expect(hasTag(cluster, "Environment")).toBe(true);
    });
  });
});
```

### Category 2: Optional Feature Tests
Features that MAY be configured.

```typescript
describe("ALB Access Logs Configuration", () => {
  let albsWithAccessLogs: Array<{ alb: unknown; enabled: string }>;

  beforeAll(() => {
    const template = getTemplate("infraStack");
    const albs = getResources(template, RESOURCE_TYPES.ALB);

    // Pre-filter in beforeAll
    albsWithAccessLogs = albs
      .map((alb) => ({
        alb,
        enabled: findAlbAttribute(alb, "access_logs.s3.enabled")?.Value,
      }))
      .filter((item): item is { alb: unknown; enabled: string } => 
        item.enabled !== undefined
      );
  });

  test("access logs have valid configuration if enabled", () => {
    // OPTIONAL: array can be empty
    expect(albsWithAccessLogs).toBeDefined();
    expect(Array.isArray(albsWithAccessLogs)).toBe(true);

    // Validate only if configured
    albsWithAccessLogs.forEach(({ enabled }) => {
      expect(["true", "false"]).toContain(enabled);
    });
  });
});
```

### Category 3: Pre-computed Data Tests
Complex validation requiring pre-computation.

```typescript
describe("Container Security", () => {
  let preparedContainers: PreparedContainerData[];

  beforeAll(() => {
    const template = getTemplate("serviceStack");
    const taskDefs = getResources(template, RESOURCE_TYPES.ECS_TASK_DEFINITION);

    // Pre-compute ALL flags in beforeAll
    preparedContainers = taskDefs.flatMap((taskDef) => {
      const containers = getContainersFromTaskDef(taskDef);
      return containers.map((container) =>
        prepareContainerData(container as ContainerDefinition)
      );
    });
  });

  test("containers exist", () => {
    expect(preparedContainers.length).toBeGreaterThan(0);
  });

  test("no containers run as privileged", () => {
    preparedContainers.forEach(({ isPrivileged }) => {
      expect(isPrivileged).toBe(false);
    });
  });

  test("all containers have memory limits", () => {
    preparedContainers.forEach(({ hasMemoryLimits }) => {
      expect(hasMemoryLimits).toBe(true);
    });
  });
});
```

---

## Migration Steps

### Step 1: Remove Inline Helper Functions

**Before (old pattern):**
```typescript
describe("My Tests", () => {
  // ❌ Inline helper - duplicated across files
  const getResources = (template: Template, type: string) => {
    return Object.values(template.findResources(type));
  };

  // ❌ Inline helper
  const findAlbAttribute = (alb: unknown, key: string) => {
    // ...
  };
});
```

**After (new pattern):**
```typescript
import {
  getResources,
  findAlbAttribute,
  prepareContainerData,
} from "../utils";

describe("My Tests", () => {
  // No inline helpers - all imported from utils
});
```

### Step 2: Replace Conditional Expects

**Before (lint error):**
```typescript
test("resources have valid config", () => {
  resources.forEach((resource) => {
    const config = getConfig(resource);
    if (config) {                              // ❌ Conditional
      expect(config.enabled).toBe(true);       // ❌ Conditional expect
    }
  });
});
```

**After (clean):**
```typescript
describe("Resource Configuration", () => {
  let resourcesWithConfig: Array<{ resource: unknown; config: Config }>;

  beforeAll(() => {
    // Move filtering to beforeAll
    resourcesWithConfig = resources
      .map((resource) => ({ resource, config: getConfig(resource) }))
      .filter((item): item is { resource: unknown; config: Config } => 
        item.config !== undefined
      );
  });

  test("configured resources have valid settings", () => {
    expect(resourcesWithConfig).toBeDefined();
    
    resourcesWithConfig.forEach(({ config }) => {
      expect(config.enabled).toBe(true);       // ✅ No conditional
    });
  });
});
```

### Step 3: Replace OR Conditions in Expects

**Before (lint error):**
```typescript
test("has memory config", () => {
  containers.forEach((container) => {
    // ❌ OR operator flagged as conditional
    expect(container.Memory !== undefined || 
           container.MemoryReservation !== undefined).toBe(true);
  });
});
```

**After (clean):**
```typescript
describe("Container Memory", () => {
  let preparedContainers: PreparedContainerData[];

  beforeAll(() => {
    preparedContainers = containers.map((container) =>
      prepareContainerData(container)  // Pre-computes hasMemoryLimits
    );
  });

  test("all containers have memory limits", () => {
    preparedContainers.forEach(({ hasMemoryLimits }) => {
      expect(hasMemoryLimits).toBe(true);      // ✅ Simple boolean check
    });
  });
});
```

### Step 4: Add Guard Assertions

**Before (potential "no assertions" warning):**
```typescript
test("validates items", () => {
  items.forEach((item) => {                    // If empty, no assertions run
    expect(item.valid).toBe(true);
  });
});
```

**After (always has assertion):**
```typescript
test("validates items", () => {
  // Guard: ensures test has assertion even if array is empty
  expect(items).toBeDefined();
  expect(Array.isArray(items)).toBe(true);
  
  items.forEach((item) => {
    expect(item.valid).toBe(true);
  });
});
```

### Step 5: Handle CDK Assertions

CDK's `template.hasResourceProperties()` throws on failure but ESLint doesn't recognize it as an assertion.

**Solution:**
```typescript
// eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
test("ALB has correct configuration", () => {
  const template = getTemplate("infraStack");

  template.hasResourceProperties(RESOURCE_TYPES.ALB, {
    Scheme: "internet-facing",
  });
});
```

---

## Common Patterns

### Pattern 1: Filtering Resources by Property

```typescript
describe("Resources with Feature X", () => {
  let resourcesWithFeatureX: Array<{ resource: unknown; featureValue: string }>;

  beforeAll(() => {
    const template = getTemplate("infraStack");
    const allResources = getResources(template, RESOURCE_TYPES.SOME_TYPE);

    resourcesWithFeatureX = allResources
      .map((resource) => {
        const props = getResourceProperties<SomeProperties>(resource);
        return {
          resource,
          featureValue: props.FeatureX,
        };
      })
      .filter((item): item is { resource: unknown; featureValue: string } =>
        item.featureValue !== undefined
      );
  });

  test("feature X has valid values", () => {
    expect(resourcesWithFeatureX).toBeDefined();
    
    resourcesWithFeatureX.forEach(({ featureValue }) => {
      expect(["value1", "value2"]).toContain(featureValue);
    });
  });
});
```

### Pattern 2: Pre-computing Multiple Flags

```typescript
// In utils/security-validators.ts
export interface PreparedResourceData {
  resource: unknown;
  hasFeatureA: boolean;
  hasFeatureB: boolean;
  isValid: boolean;
}

export const prepareResourceData = (resource: unknown): PreparedResourceData => {
  const props = getResourceProperties<ResourceProps>(resource);
  
  return {
    resource,
    hasFeatureA: props.FeatureA !== undefined,
    hasFeatureB: props.FeatureB !== undefined,
    isValid: props.Status === "active",
  };
};
```

### Pattern 3: Environment-Specific Tests

```typescript
describe("Production Security", () => {
  let prodTemplate: Template;

  beforeAll(() => {
    const prodStacks = SecurityTestFixtures.getProductionStacks();
    prodTemplate = Template.fromStack(prodStacks.infraStack);
  });

  test("deletion protection enabled in production", () => {
    const albs = getResources(prodTemplate, RESOURCE_TYPES.ALB);

    expect(albs.length).toBeGreaterThan(0);

    albs.forEach((alb) => {
      const deletionProtection = findAlbAttribute(alb, "deletion_protection.enabled");
      expect(deletionProtection?.Value).toBe("true");
    });
  });
});
```

### Pattern 4: Validating Nested Configurations

```typescript
describe("Nested Configuration Validation", () => {
  let servicesWithCircuitBreaker: Array<{
    service: unknown;
    circuitBreaker: DeploymentCircuitBreaker;
  }>;

  beforeAll(() => {
    const template = getTemplate("serviceStack");
    const services = getResources(template, RESOURCE_TYPES.ECS_SERVICE);

    servicesWithCircuitBreaker = services
      .map((service) => {
        const deployConfig = getDeploymentConfiguration(service);
        const circuitBreaker = deployConfig 
          ? getCircuitBreaker(deployConfig) 
          : undefined;
        return { service, circuitBreaker };
      })
      .filter((item): item is { 
        service: unknown; 
        circuitBreaker: DeploymentCircuitBreaker;
      } => item.circuitBreaker !== undefined);
  });

  test("circuit breakers are properly configured", () => {
    expect(servicesWithCircuitBreaker).toBeDefined();

    servicesWithCircuitBreaker.forEach(({ circuitBreaker }) => {
      expect(circuitBreaker.Enable).toBeDefined();
      expect(typeof circuitBreaker.Enable).toBe("boolean");
    });
  });
});
```

---

## Import Cheatsheet

### Importing Functions

```typescript
import {
  // Template helpers
  getResources,
  getResourcesWithIds,
  getResourceProperties,
  getResourceProperty,
  getOutputs,
  getDeletionPolicy,
  getUpdatePolicy,
  stringifyResource,

  // ALB extractors
  getAlbAttributes,
  findAlbAttribute,
  albHasAttribute,

  // Target group extractors
  getTargetGroupAttributes,
  findTargetGroupAttribute,
  getTargetGroupHealthCheck,

  // ECS extractors
  getContainersFromTaskDef,
  getTaskDefNetworkMode,
  getDeploymentConfiguration,
  getCircuitBreaker,
  getClusterSettings,
  getContainerInsightsSetting,

  // ASG extractors
  getRollingUpdate,
  getAsgCapacity,

  // Launch template extractors
  getLaunchTemplateData,
  getInstanceType,

  // Tag extractors
  getResourceTags,
  hasTag,
  getTagValue,

  // SSM extractors
  getSsmTargets,

  // Secrets extractors
  secretNameMatches,

  // Security validators
  hasHardcodedSecrets,
  usesSecretsManager,
  usesParameterStore,
  hasEnvironmentContext,
  resourceHasEnvironmentContext,
  validateResourceProperties,
  isInRange,

  // Type guards
  isValidNetworkMode,
  isValidDeletionPolicy,
  isValidComplianceSeverity,
  isValidLogDriver,

  // Pre-computation helpers
  prepareContainerData,
  prepareTargetGroupData,
  prepareSecretData,

  // Constants
  VALID_NETWORK_MODES,
  VALID_DELETION_POLICIES,
  VALID_COMPLIANCE_SEVERITIES,
  VALID_LOG_DRIVERS,
} from "../utils";
```

### Importing Types

```typescript
import type {
  // Resource types
  AlbAttribute,
  TargetGroupAttribute,
  TargetGroupHealthCheck,
  ContainerDefinition,
  ContainerLogConfiguration,
  TaskDefinitionProperties,
  RollingUpdatePolicy,
  ClusterSetting,
  DeploymentConfiguration,
  DeploymentCircuitBreaker,
  LaunchTemplateData,
  ResourceTag,
  SsmTarget,
  SecurityGroupIngress,
  SecurityGroupEgress,
  
  // Pre-computed types
  PreparedContainerData,
  PreparedTargetGroupData,
  PreparedSecretData,
  PreparedAsgRollingUpdateData,
  PreparedResourceWithContext,
  PreparedExportData,
  
  // Validation types
  ValidationResult,
  ValidNetworkMode,
  ValidDeletionPolicy,
  ValidComplianceSeverity,
  ValidLogDriver,
} from "../utils";
```

---

## Checklist for New Tests

Before submitting a new test file, verify:

- [ ] All helper functions imported from `../utils` (no inline definitions)
- [ ] No `if` statements inside `test()` blocks
- [ ] No `.filter()` calls inside `test()` blocks
- [ ] No `||` or `&&` operators inside `expect()` calls
- [ ] All `forEach` loops have guard assertions above them
- [ ] Optional features use `expect(array).toBeDefined()` pattern
- [ ] Required features use `expect(array.length).toBeGreaterThan(0)`
- [ ] CDK assertions have eslint-disable comment
- [ ] Types imported separately from functions
- [ ] Pre-computation done in `beforeAll` blocks

---

## Adding New Utilities

### Adding a New Type

1. Add interface to `utils/types.ts`
2. Export from `types.ts`
3. Import in files that need it

### Adding a New Extractor

1. Add function to `utils/resource-extractors.ts`
2. Import types from `./types`
3. Function is automatically exported via `index.ts`

### Adding a New Validator

1. Add function to `utils/security-validators.ts`
2. Import types from `./types`
3. Function is automatically exported via `index.ts`

### Adding a New Pre-computation Helper

1. Add interface to `utils/types.ts` (e.g., `PreparedXxxData`)
2. Add function to `utils/security-validators.ts`
3. Import the interface in the function

---

## Troubleshooting

### "Cannot read properties of undefined (reading 'includes')"
- Constants being imported from `types.ts` instead of defined in `security-validators.ts`
- Solution: Constants must be defined in the file where they're used

### "Test has no assertions"
- `forEach` on empty array produces no assertions
- Solution: Add guard assertion before `forEach`

### "Avoid having conditionals in tests"
- `.filter()`, `if`, `||`, `&&` inside test body
- Solution: Move to `beforeAll`

### "Do not access template in describe blocks"
- `template.xxx()` called at describe level
- Solution: Move to `beforeAll` or inside `test()`

Additional Options
Show only errors (no warnings):
yarn eslint tests/unit/security/iam-security.test.ts --quiet
yarn eslint tests/unit/security/iam-security.test.ts --quiet
Format output:
yarn eslint tests/unit/security/iam-security.test.ts --format=stylish
yarn eslint tests/unit/security/iam-security.test.ts --format=stylish
Check specific rules:
yarn eslint tests/unit/security/iam-security.test.ts --rule 'jest/no-conditional-in-test: error'
yarn eslint tests/unit/security/iam-security.test.ts --rule 'jest/no-conditional-in-test: error'
The most common command is:
yarn eslint tests/unit/security/iam-security.test.ts
yarn eslint tests/unit/security/iam-security.test.ts
This will show all linting errors and warnings for that specific file.