<!-- @format -->

# Security Posture Unit Tests

Comprehensive security validation tests for the monitoring infrastructure, organised by security domain and following strict architectural principles.

## Overview

These tests validate security configurations across all stack layers to catch misconfigurations that could lead to vulnerabilities. Each test file focuses on a specific security domain, making it easy to maintain and extend.

**Total: 85 security tests across 7 domains**

## Design Approach

### Core Principles

1. **No Code Duplication**: All helper functions, types, and extractors live in `../utils/`. Test files import what they need.
2. **No Conditionals in Tests**: ESLint rule `jest/no-conditional-in-test` prohibits conditionals, ternary operators, and `.filter()` inside test bodies.
3. **Pre-computation in `beforeAll`**: All filtering and conditional logic moved to `beforeAll` blocks.
4. **Guard Assertions First**: Every test with `forEach` must have a guard assertion that passes even with empty arrays.
5. **Centralized Stack Configuration**: Stack names are defined in `../connectivity/test-config.ts` for single source of truth.

### Architecture Benefits

- **Type Safety**: TypeScript catches invalid stack names and resource types at compile time
- **Maintainability**: Update stack lists in one place (`test-config.ts`)
- **Extensibility**: Easy to add new stacks or create new test categories
- **Consistency**: All tests follow the same patterns and principles
- **Lint Compliance**: Tests pass strict ESLint rules without exceptions

## What Security Is Tested?

### Test Domains

| File                            | Tests | Focus Area                                        |
| ------------------------------- | ----- | ------------------------------------------------- |
| `networking-security.test.ts`   | 11    | VPC, Security Groups, Network Isolation           |
| `instance-security.test.ts`     | 11    | IMDSv2, EBS Encryption, User Data                 |
| `storage-security.test.ts`      | 9     | EFS Encryption, Access Controls, Lifecycle        |
| `iam-security.test.ts`          | 12    | Least Privilege, Trust Relationships, Permissions |
| `monitoring-logging.test.ts`    | 13    | CloudWatch, VPC Flow Logs, Container Insights     |
| `application-security.test.ts`  | 15    | ALB, Container Security, Secrets Management       |
| `compliance-governance.test.ts` | 14    | Tagging, Deletion Protection, Update Policies     |

### Security Coverage

#### 1. Network Security (`networking-security.test.ts`)

**Validates**:
- VPC DNS configuration (hostnames, support)
- VPC Flow Logs (all traffic types, retention)
- Security group rules (no unrestricted SSH/RDP/NFS)
- Network isolation (private subnets, NAT gateways)
- Internet Gateway configuration

**Key Assertions**:
- No security groups allow unrestricted SSH (port 22) or RDP (port 3389)
- EFS NFS port (2049) only accessible from security groups (not CIDR blocks)
- VPC Flow Logs capture all traffic types with retention configured
- Private subnets exist for workload isolation

#### 2. Instance Security (`instance-security.test.ts`)

**Validates**:
- IMDSv2 enforcement on launch templates
- IMDSv2 usage in SSM automation scripts
- EBS volume encryption (at rest)
- GP3 volume types (cost optimization)
- User data security (no hardcoded credentials)
- Instance placement (private subnets)

**Key Assertions**:
- Launch templates enforce IMDSv2 with `HttpTokens: required`
- No IMDSv1 (token-less) usage in automation scripts
- EBS volumes encrypted with GP3 type
- No hardcoded credentials or API keys in user data

#### 3. Storage Security (`storage-security.test.ts`)

**Validates**:
- EFS encryption at rest (AWS managed keys)
- EFS access point POSIX permissions
- EFS security group restrictions
- EFS lifecycle policies (IA transition)
- EFS deletion protection (production: Retain)

**Key Assertions**:
- EFS encrypted with AWS managed encryption keys
- Access points enforce restrictive POSIX permissions (not 777)
- NFS port (2049) only accessible from security groups (not CIDRs)
- Lifecycle policies configured for Infrequent Access transition

#### 4. IAM Security (`iam-security.test.ts`)

**Validates**:
- Least privilege principle adherence
- No AdministratorAccess or PowerUserAccess policies
- Role trust relationships (EC2, ECS, Lambda)
- SSM parameter access (scoped paths, not wildcards)
- EFS mount permissions (scoped to specific file systems)
- No wildcard permissions on sensitive resources

**Key Assertions**:
- Instance roles use `AmazonSSMManagedInstanceCore` managed policy
- No roles have admin or power user access
- Write actions with wildcard resources are service-specific
- EFS access scoped to specific file system ARNs

#### 5. Monitoring & Logging (`monitoring-logging.test.ts`)

**Validates**:
- CloudWatch Logs retention and encryption
- VPC Flow Logs configuration
- Container Insights (production enabled, dev disabled)
- EventBridge rules for ECS state change events
- Container logging to CloudWatch (awslogs driver)
- Log group deletion policies (production: Retain)

**Key Assertions**:
- All log groups have retention configured (prevents indefinite storage)
- VPC Flow Logs capture all traffic types with IAM role delivery
- Container Insights enabled only in production environments
- ECS containers log to CloudWatch with stream prefix configured

#### 6. Application Security (`application-security.test.ts`)

**Validates**:
- ALB security settings (drop invalid headers)
- ALB deletion protection (production enabled)
- Target group health checks (thresholds, deregistration delay)
- Container security (no privileged, no root user, memory limits)
- Secrets management (Secrets Manager, not hardcoded)
- SSM State Manager security (specific targets, document types)

**Key Assertions**:
- ALB drops invalid header fields to prevent header injection
- Target groups have appropriate health check thresholds (2-10)
- No privileged containers or root user execution
- Grafana password stored in Secrets Manager (not hardcoded)
- SSM associations target specific resources (not wildcards)

#### 7. Compliance & Governance (`compliance-governance.test.ts`)

**Validates**:
- Resource tagging (Environment, Project tags)
- Deletion protection policies (production: Retain)
- Update policies (ASG rolling updates with pause time)
- Environment-specific configurations (capacity, instance types)
- Resource naming conventions (environment context)
- Cost management (GP3 volumes, t3/t2 instance types)

**Key Assertions**:
- ECS clusters have Environment and Project tags
- Production resources have deletion protection (Retain policy)
- ASGs have rolling update policies with minimum instance requirements
- Production uses higher capacity than development
- Development uses cost-optimized instance types (t3/t2)

## What's the Testing Approach?

### How Security Is Validated

1. **CDK Template Assertions**: Uses `aws-cdk-lib/assertions` to validate CloudFormation resource properties
2. **Resource Extraction**: Extracts resources from templates using type-safe utilities
3. **Property Validation**: Validates specific security properties (encryption, permissions, policies)
4. **Anti-Pattern Detection**: Tests for prohibited configurations (unrestricted access, hardcoded secrets)

### Assertions Used

#### CDK Template Assertions

```typescript
// Direct property validation
template.hasResourceProperties("AWS::EC2::LaunchTemplate", {
  LaunchTemplateData: {
    MetadataOptions: {
      HttpTokens: "required",
    },
  },
});
```

#### Resource Iteration with Guards

```typescript
describe("Security Group Rules", () => {
  let sshRules: Array<{ rule: unknown; properties: Record<string, unknown> }>;

  beforeAll(() => {
    // Pre-filter in beforeAll - no conditionals in tests
    const template = getTemplate(NETWORKING_TEST_STACKS[2]);
    const rules = getSecurityGroupIngressRules(template);
    sshRules = rules
      .map((rule) => ({
        rule,
        properties: getResourceProperties(rule),
      }))
      .filter((item) => isPortRule(item.properties, 22));
  });

  test("no unrestricted SSH access", () => {
    // Guard assertion first
    expect(sshRules).toBeDefined();
    expect(Array.isArray(sshRules)).toBe(true);

    // Then validate
    sshRules.forEach(({ properties }) => {
      expect(properties.CidrIp).not.toBe("0.0.0.0/0");
    });
  });
});
```

#### Pre-computed Data Structures

```typescript
describe("Container Security", () => {
  let preparedContainers: PreparedContainerData[];

  beforeAll(() => {
    const template = getTemplate(IAM_TEST_STACKS[3]);
    const taskDefs = getTaskDefinitions(template);

    // Pre-compute all flags - no conditionals in tests
    preparedContainers = taskDefs.flatMap((taskDef) => {
      const containers = getContainersFromTaskDef(taskDef);
      return containers.map(prepareContainerData);
    });
  });

  test("containers are not privileged", () => {
    expect(preparedContainers.length).toBeGreaterThan(0);
    preparedContainers.forEach(({ isPrivileged }) => {
      expect(isPrivileged).toBe(false);
    });
  });
});
```

### Dependencies Between Tests

- **No Test Dependencies**: Each test is independent and can run in isolation
- **Shared Fixtures**: All tests use `SecurityTestFixtures` for stack creation (cached singleton)
- **Shared Utilities**: All tests import from `../utils/` for consistent resource extraction
- **Stack Configuration**: All tests use centralized stack constants from `test-config.ts`

## What Are the Test Files/Folders Used For?

### Shared Test Configuration (`../connectivity/test-config.ts`)

**Purpose**: Centralized stack name configuration for type-safe, maintainable tests.

**Constants**:
- `IAM_TEST_STACKS` - Stacks with IAM roles (`["networkingStack", "efsStack", "infraStack", "serviceStack"]`)
- `NETWORKING_TEST_STACKS` - Stacks with networking resources
- `MONITORING_TEST_STACKS` - Stacks with monitoring/logging resources
- `EXPORT_TEST_STACKS` - Stacks with CloudFormation exports
- `INSTANCE_TEST_STACKS` - Stacks with EC2 instances (`["infraStack"]`)
- `STORAGE_TEST_STACKS` - Stacks with storage resources (`["efsStack"]`)

**Benefits**:
- Single source of truth: update stack lists in one place
- Type safety: invalid stack names caught at compile time
- Extensible: easy to add new stacks or create new test categories

**Usage**:
```typescript
import { INSTANCE_TEST_STACKS, IAM_TEST_STACKS } from "../connectivity/test-config";

const template = getTemplate(INSTANCE_TEST_STACKS[0]); // "infraStack"
const templates = getTemplates(IAM_TEST_STACKS); // All IAM stacks
```

### Shared Utilities (`../utils/`)

**Purpose**: Eliminates code duplication and provides type-safe resource extraction.

**Structure**:
- `template-helpers.ts` - Generic CDK template utilities (`getResources`, `getResourceProperties`)
- `resource-extractors.ts` - AWS resource-specific extractors (`getContainersFromTaskDef`, `getIngressRules`)
- `security-validators.ts` - Security validation helpers (`isPortRule`, `hasManagedPolicy`, `isValidNetworkMode`)
- `types.ts` - TypeScript interfaces and types
- `index.ts` - Re-exports everything

**Key Functions**:
```typescript
// Resource extraction
getResources(template, "AWS::IAM::Role")
getSecurityGroups(template)
getFileSystems(template)

// Property extraction
getResourceProperties(resource)
getIngressRules(securityGroup)
getContainersFromTaskDef(taskDef)

// Validation
isPortRule(rule, 22)
hasManagedPolicy(role, "AdministratorAccess")
isValidNetworkMode(networkMode)
```

See [Test Utilities README](../utils/README.md) for complete documentation.

### Test Fixtures (`test-fixtures.ts`)

**Purpose**: Provides stack creation and caching for test execution.

**Components**:
- `SecurityTestFixtures` - Singleton cache for stack reuse
- `getDevelopmentStacks()` - Creates development environment stacks
- `getProductionStacks()` - Creates production environment stacks
- `TEST_CONSTANTS` - Shared configuration values

**Usage**:
```typescript
import { SecurityTestFixtures } from "../utils/test-utils";

let stacks = SecurityTestFixtures.getDevelopmentStacks();
let prodStacks = SecurityTestFixtures.getProductionStacks();
```

## Common Patterns

### Pattern 1: Pre-computation in `beforeAll`

**Why**: Avoids conditionals in test bodies (ESLint compliance).

```typescript
describe("Feature", () => {
  let filteredResources: Array<{ resource: unknown; flag: boolean }>;

  beforeAll(() => {
    const template = getTemplate(INSTANCE_TEST_STACKS[0]);
    const resources = getResources(template, "AWS::Resource::Type");

    // Pre-filter and pre-compute in beforeAll
    filteredResources = resources
      .map((resource) => ({
        resource,
        flag: computeFlag(resource),
      }))
      .filter((item) => item.flag === true);
  });

  test("validates filtered resources", () => {
    expect(filteredResources).toBeDefined();
    expect(Array.isArray(filteredResources)).toBe(true);
    filteredResources.forEach(({ resource }) => {
      // No conditionals here!
      expect(validate(resource)).toBe(true);
    });
  });
});
```

### Pattern 2: Guard Assertions

**Why**: Ensures tests pass even with empty arrays (optional features).

```typescript
test("feature is configured (if feature exists)", () => {
  // Guard: empty array is valid for optional features
  expect(filteredResources).toBeDefined();
  expect(Array.isArray(filteredResources)).toBe(true);

  // Only validate if items exist
  filteredResources.forEach(({ resource }) => {
    expect(validate(resource)).toBe(true);
  });
});
```

### Pattern 3: Type-Safe Resource Extraction

**Why**: Provides compile-time type safety and consistent extraction.

```typescript
// Generic extraction
const properties = getResourceProperties<{ Encrypted: boolean }>(fileSystem);
expect(properties.Encrypted).toBe(true);

// Specific extractors
const containers = getContainersFromTaskDef(taskDef);
const ingressRules = getIngressRules(securityGroup);
const lifecyclePolicies = getLifecyclePolicies(fileSystem);
```

### Pattern 4: Centralized Stack Configuration

**Why**: Single source of truth for stack names, type-safe, extensible.

```typescript
// Import centralized constants
import { INSTANCE_TEST_STACKS, IAM_TEST_STACKS } from "../connectivity/test-config";

// Use instead of hardcoded strings
const template = getTemplate(INSTANCE_TEST_STACKS[0]); // Not "infraStack"
const templates = getTemplates(IAM_TEST_STACKS); // Not ["networkingStack", "efsStack", ...]
```

### Pattern 5: Optional vs Required Features

**Why**: Clear distinction between required and optional security controls.

```typescript
// Required feature: must exist
test("feature exists", () => {
  expect(resources.length).toBeGreaterThan(0);
});

// Optional feature: may not exist
test("feature is configured (if feature exists)", () => {
  expect(resources).toBeDefined(); // Empty array is valid
  resources.forEach((resource) => {
    expect(validate(resource)).toBe(true);
  });
});
```

## How Do I Add New Security Tests?

### Which File to Add To

Choose the appropriate domain file based on the security control:

- **Network Security** → `networking-security.test.ts`
- **EC2 Instance Security** → `instance-security.test.ts`
- **Storage Security** → `storage-security.test.ts`
- **IAM Security** → `iam-security.test.ts`
- **Monitoring/Logging** → `monitoring-logging.test.ts`
- **Application Security** → `application-security.test.ts`
- **Compliance/Governance** → `compliance-governance.test.ts`

### Required Setup

1. **Import Required Utilities**:
   ```typescript
   import { Template, Match } from "aws-cdk-lib/assertions";
   import { INSTANCE_TEST_STACKS, IAM_TEST_STACKS } from "../connectivity/test-config";
   import { SecurityTestFixtures } from "../utils/test-utils";
   import { getResources, getResourceProperties, ... } from "../utils";
   ```

2. **Use Centralized Stack Configuration**:
   ```typescript
   const template = getTemplate(INSTANCE_TEST_STACKS[0]); // Not "infraStack"
   ```

3. **Follow Architectural Principles**:
   - No conditionals in test bodies
   - Pre-compute in `beforeAll`
   - Guard assertions before `forEach`
   - Use shared utilities from `../utils/`

### Example Test

```typescript
describe("New Security Control", () => {
  let resourcesWithControl: Array<{
    resource: unknown;
    hasControl: boolean;
  }>;

  beforeAll(() => {
    const template = getTemplate(INSTANCE_TEST_STACKS[0]);
    const resources = getResources(template, "AWS::Resource::Type");

    // Pre-compute in beforeAll
    resourcesWithControl = resources.map((resource) => {
      const properties = getResourceProperties(resource);
      return {
        resource,
        hasControl: properties.SecurityControl === "enabled",
      };
    });
  });

  test("resources exist", () => {
    expect(resourcesWithControl.length).toBeGreaterThan(0);
  });

  test("security control is enabled", () => {
    expect(resourcesWithControl).toBeDefined();
    expect(Array.isArray(resourcesWithControl)).toBe(true);

    resourcesWithControl.forEach(({ hasControl }) => {
      expect(hasControl).toBe(true);
    });
  });
});
```

### Adding New Utilities

If you need new helper functions:

1. **Add to `../utils/resource-extractors.ts`** for resource property extraction
2. **Add to `../utils/security-validators.ts`** for validation logic
3. **Add to `../utils/template-helpers.ts`** for generic template utilities
4. **Export from `../utils/index.ts`**

## Running Tests

### Run All Security Tests

```bash
# Using yarn
yarn test:security

# Using npm directly
npm test -- tests/unit/security/
```

### Run Specific Security Domain

```bash
# Network security only
npm test -- tests/unit/security/networking-security.test.ts

# IAM security only
npm test -- tests/unit/security/iam-security.test.ts
```

### Run with Coverage

```bash
npm test -- tests/unit/security/ --coverage
```

## Known Limitations & Vulnerabilities

### Design Limitations

1. **Static Analysis Only**: Tests validate CloudFormation templates, not runtime behavior
   - **Mitigation**: Combine with integration tests for runtime validation

2. **Template-Based Validation**: Cannot test dynamic configurations or runtime policies
   - **Mitigation**: Use AWS Config rules for runtime compliance

3. **Environment-Specific**: Some tests require separate development/production fixtures
   - **Mitigation**: `SecurityTestFixtures` provides both environments

4. **Stack Dependencies**: Tests assume specific stack structure
   - **Mitigation**: Centralized stack configuration in `test-config.ts` makes updates easy

### Security Gaps Not Covered

1. **Runtime Security**: Tests don't validate actual runtime security (e.g., actual network traffic)
2. **Secret Rotation**: Tests validate secrets are in Secrets Manager but not rotation policies
3. **Compliance Frameworks**: Tests don't validate against specific compliance frameworks (CIS, SOC2)
4. **Threat Modeling**: Tests don't perform threat modeling or attack simulation

### Why This Testing Approach Is Needed

1. **Catch Misconfigurations Early**: Validates security configurations before deployment
2. **Prevent Security Regressions**: Ensures security controls aren't accidentally removed
3. **Documentation**: Tests serve as living documentation of security requirements
4. **Compliance**: Provides evidence of security controls for audits
5. **Developer Feedback**: Fast feedback loop for security issues during development

## Troubleshooting

### Test Failures

1. **Stack Synthesis Errors**
   ```
   Error: Stack failed to synthesise
   ```
   **Solution**: Check `test-fixtures.ts` for correct stack configuration

2. **Resource Not Found**
   ```
   Error: Template has 0 AWS::Resource::Type, expected at least 1
   ```
   **Solution**: Verify the resource exists in the correct stack (check `test-config.ts`)

3. **Property Mismatch**
   ```
   Error: Expected HttpTokens to be "required", but was "optional"
   ```
   **Solution**: Check the actual CDK construct configuration

4. **Lint Errors (Conditionals in Tests)**
   ```
   Error: Avoid having conditionals in tests
   ```
   **Solution**: Move conditional logic to `beforeAll` block

### Performance Issues

If tests are slow:

1. Use cached fixtures (`SecurityTestFixtures`)
2. Run specific test files instead of entire suite
3. Use `--maxWorkers=1` to reduce memory usage

### Debugging Tests

```typescript
// Log the entire template
const template = Template.fromStack(stacks[INSTANCE_TEST_STACKS[0]]);
console.log(JSON.stringify(template.toJSON(), null, 2));

// Log specific resources
const securityGroups = getSecurityGroups(template);
console.log(JSON.stringify(securityGroups, null, 2));
```

## Related Documentation

- [Test Utilities](../utils/README.md) - Complete documentation of shared utilities
- [Unit Test Guidelines](../../prompts/tests/unit-test.txt) - Core principles and patterns
- [AWS Security Best Practices](https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/welcome.html)
- [CDK Security Best Practices](https://docs.aws.amazon.com/cdk/v2/guide/best-practices.html#best-practices-security)

## Contributing

When adding new security tests:

1. Choose the appropriate domain file
2. Follow existing test patterns (pre-computation, guard assertions)
3. Use centralized stack configuration (`test-config.ts`)
4. Import utilities from `../utils/` (no inline helpers)
5. Add test description to this README
6. Update test counts in the overview table

## Security Resources

- [AWS Well-Architected Security Pillar](https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/)
- [AWS Security Best Practices](https://aws.amazon.com/security/best-practices/)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [CIS AWS Foundations Benchmark](https://www.cisecurity.org/benchmark/amazon_web_services)
