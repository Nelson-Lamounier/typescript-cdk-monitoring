<!-- @format -->

# Connectivity Integration Tests

This directory contains integration tests that validate network and service connectivity across the monitoring stack infrastructure.

## Design Approach

### Testing Philosophy

The connectivity test suite follows a **layered validation approach** that mirrors the infrastructure stack hierarchy:

1. **Layer 1: Network Foundation** - Validates VPC, subnets, routing, and network isolation
2. **Layer 2: Storage Layer** - Validates EFS connectivity and security
3. **Layer 3: Compute Layer** - Validates ECS cluster, ALB, and instance networking
4. **Layer 4: Service Layer** - Validates application service connectivity and discovery

Each layer depends on the previous layer, allowing tests to catch issues early in the dependency chain.

### Why These Tests Are Critical

**Prevent Production Outages:**

- Detect misconfigured security groups before deployment
- Catch routing table errors that would break connectivity
- Validate cross-stack references to prevent deployment failures
- Ensure services can communicate before they're deployed

**Infrastructure as Code Validation:**

- CloudFormation/CDK templates are validated before synthesis
- Cross-stack dependencies are verified programmatically
- Configuration drift is caught early
- Refactoring is safe with comprehensive test coverage

**Cost Optimisation:**

- Detect unnecessary NAT Gateways or VPC Endpoints
- Validate resource placement (AZ distribution)
- Ensure efficient routing (no hairpinning)

## What Connectivity Is Tested?

### 1. Cross-Stack References

**Tested Patterns:**

- CloudFormation exports/imports between stacks
- SSM Parameter Store for configuration sharing
- Direct resource references (VPC ID, cluster ARN, etc.)
- Dependency ordering and circular dependency prevention

**Example:**

```typescript
// EFS stack references VPC from Networking stack
const efsStack = new MonitoringEfsStack(app, "EfsStack", {
  vpc: networkingStack.vpc, // Cross-stack reference
});
```

**Validated:**

- Networking → EFS (VPC ID)
- Networking → Infra (VPC ID, Subnet IDs)
- EFS → Infra (File System ID)
- Infra → Service (Cluster ARN, ALB ARN)

### 2. VPC Peering and Network Isolation

**Tested Patterns:**

- Public subnet isolation (Internet Gateway)
- Private subnet isolation (NAT Gateway)
- Subnet CIDR non-overlap
- Multi-AZ distribution

**Validated:**

- Public subnets have routes to Internet Gateway
- Private subnets have routes to NAT Gateway
- Subnets span multiple availability zones (HA)
- No cross-subnet routing without explicit rules

### 3. Service-to-Service Communication

**Tested Patterns:**

- ALB → ECS tasks (HTTP/HTTPS)
- ECS tasks → EFS (NFS port 2049)
- Prometheus → Node Exporter (metrics port 9100)
- Grafana → Prometheus (API port 9090)

**Validated:**

- Security group rules allow required traffic
- Ports match between source and destination
- Network mode compatibility (bridge/host/awsvpc)
- Health checks can reach services

### 4. Network Routing

**Tested Patterns:**

- Internet Gateway routes for public subnets
- NAT Gateway routes for private subnets
- VPC Endpoint routes (S3 gateway)
- Route table associations

**Validated:**

- Default routes point to correct gateways
- Route table associations are explicit
- No conflicting routes
- S3 VPC Endpoint bypasses NAT Gateway

## Testing Approach

### How Connectivity Is Validated

#### 1. Template Assertion Pattern

All tests use CDK's `Template` class to validate synthesised CloudFormation:

```typescript
describe("Connectivity Tests", () => {
  let stacks: ConnectivityTestStacks;

  beforeAll(() => {
    // Create all stacks once for entire test suite
    stacks = createConnectivityTestStacks();
  });

  test("validate security group rule", () => {
    const template = Template.fromStack(stacks.infraStack);

    // Assert specific resource properties
    template.hasResourceProperties("AWS::EC2::SecurityGroupIngress", {
      IpProtocol: "tcp",
      FromPort: 9090,
      ToPort: 9090,
    });
  });
});
```

#### 2. Pre-computation Pattern (beforeAll)

All filtering and conditional logic is moved to `beforeAll` blocks to comply with `jest/no-conditional-in-test` rule:

```typescript
describe("Service Port Configuration", () => {
  let prometheusContainers: Array<{
    container: ContainerDefinition;
    hasCorrectPort: boolean;
  }>;

  beforeAll(() => {
    const template = getTemplate(IAM_TEST_STACKS[3]);
    const taskDefs = getResources(template, RESOURCE_TYPES.ECS_TASK_DEFINITION);
    const allContainers = taskDefs.flatMap((taskDef) =>
      getContainersFromTaskDef(taskDef)
    );

    // Pre-compute all data in beforeAll
    prometheusContainers = allContainers
      .filter((container) =>
        container.Name?.toLowerCase().includes("prometheus")
      )
      .map((container) => ({
        container,
        hasCorrectPort: containerHasPort(container, PORT_CONFIG.PROMETHEUS),
      }));
  });

  test("Prometheus service uses correct port", () => {
    expect(prometheusContainers.length).toBeGreaterThan(0);
    prometheusContainers.forEach(({ hasCorrectPort }) => {
      expect(hasCorrectPort).toBe(true);
    });
  });
});
```

#### 3. Centralised Stack Configuration

Tests use type-safe stack constants from `test-config.ts` instead of hardcoded stack names:

```typescript
import {
  STORAGE_TEST_STACKS,
  IAM_TEST_STACKS,
  INSTANCE_TEST_STACKS,
  NETWORKING_TEST_STACKS,
} from "./test-config";

// Use constants instead of hardcoded strings
const template = getTemplate(STORAGE_TEST_STACKS[0]); // EFS stack
const template = getTemplate(IAM_TEST_STACKS[3]); // Service stack
const template = getTemplate(INSTANCE_TEST_STACKS[0]); // Infra stack
```

#### 4. Utility Function Pattern

Tests import reusable utilities from `../utils` instead of defining inline helpers:

```typescript
import {
  getResources,
  getResourceProperties,
  getContainersFromTaskDef,
  getTaskDefNetworkMode,
  getSecurityGroupIngressRules,
  getIngressRules,
  validateResourceProperties,
  isInRange,
  isValidNetworkMode,
  isNfsPortRule,
} from "../utils";
```

#### 5. Layered Validation

Tests validate from bottom-up (infrastructure → application):

1. **Network Layer** - VPC exists with correct CIDR
2. **Security Layer** - Security groups allow required ports
3. **Service Layer** - Services are configured with correct ports
4. **Integration Layer** - End-to-end connectivity works

### Assertions Used

#### Resource Existence

```typescript
template.resourceCountIs("AWS::EC2::VPC", 1);
template.hasResource("AWS::ECS::Cluster", Match.anyValue());
```

#### Property Validation

```typescript
template.hasResourceProperties("AWS::EC2::SecurityGroupIngress", {
  IpProtocol: "tcp",
  FromPort: 2049,
  ToPort: 2049,
});
```

#### Dynamic Validation

```typescript
const resources = template.findResources("AWS::EC2::Subnet");
Object.values(resources).forEach((subnet) => {
  expect(subnet.Properties.CidrBlock).toMatch(/^10\.0\.\d+\.0\/24$/);
});
```

### Dependencies Between Tests

**Independent Test Suites:**

- Each test file can run independently
- `beforeAll()` creates stack hierarchy once per file
- No shared state between test files

**Sequential Within Suite:**

- Tests within a `describe` block share stack instances
- Tests should not modify shared state
- Use `beforeEach()` for test-specific setup if needed

## Test Fixtures

### Shared Test Configuration

All tests use centralised configuration from `test-config.ts`:

```typescript
// AWS Configuration
export const AWS_CONFIG = {
  ACCOUNT: "123456789012",
  REGION: "eu-west-1",
};

// Network Configuration
export const NETWORK_CONFIG = {
  VPC_CIDR: "10.0.0.0/16",
  ALLOWED_CIDR: "10.0.0.0/8",
  EXPECTED_SUBNETS: { PUBLIC: 2, PRIVATE: 2 },
};

// Port Configuration
export const PORT_CONFIG = {
  HTTP: 80,
  NFS: 2049,
  PROMETHEUS: 9090,
  GRAFANA: 3000,
};

// Resource Types
export const RESOURCE_TYPES = {
  VPC: "AWS::EC2::VPC",
  SECURITY_GROUP: "AWS::EC2::SecurityGroup",
  // ... all CloudFormation resource types
};

// Stack Configuration Constants (Type-Safe)
export const IAM_TEST_STACKS: ReadonlyArray<
  keyof Omit<ConnectivityTestStacks, "app">
> = ["networkingStack", "efsStack", "infraStack", "serviceStack"] as const;

export const STORAGE_TEST_STACKS: ReadonlyArray<
  keyof Omit<ConnectivityTestStacks, "app">
> = ["efsStack"] as const;

export const INSTANCE_TEST_STACKS: ReadonlyArray<
  keyof Omit<ConnectivityTestStacks, "app">
> = ["infraStack"] as const;

export const NETWORKING_TEST_STACKS: ReadonlyArray<
  keyof Omit<ConnectivityTestStacks, "app">
> = ["networkingStack", "efsStack", "infraStack"] as const;
```

### Mock Resources

Tests use real CDK stack synthesis (no mocks):

```typescript
export function createConnectivityTestStacks(): ConnectivityTestStacks {
  const app = new cdk.App();
  const env = { account: AWS_CONFIG.ACCOUNT, region: AWS_CONFIG.REGION };

  // Create real stack instances
  const networkingStack = new NetworkingStack(app, "TestNetworking", { env });
  const efsStack = new MonitoringEfsStack(app, "TestEfs", {
    env,
    vpc: networkingStack.vpc,
  });
  // ... more stacks

  return { app, networkingStack, efsStack, infraStack, serviceStack };
}
```

### Test Data

**Static Test Data:**

- Defined in `test-config.ts` constants
- Used for expected values (ports, CIDRs, counts)

**Dynamic Test Data:**

- Generated from synthesised templates
- Extracted using `template.findResources()`

## Common Patterns

### How to Test Cross-Stack Exports

```typescript
test("Networking stack exports VPC ID", () => {
  const template = Template.fromStack(stacks.networkingStack);

  // Find all outputs
  const outputs = template.findOutputs("*");

  // Check for VPC export
  const hasVpcExport = Object.values(outputs).some((output) => {
    return JSON.stringify(output).toLowerCase().includes("vpc");
  });

  expect(hasVpcExport).toBe(true);
});
```

### How to Validate Security Group Rules

```typescript
describe("EFS Security Group Configuration", () => {
  let securityGroups: unknown[];
  let nfsRules: Array<Record<string, unknown>>;

  beforeAll(() => {
    const template = getTemplate(STORAGE_TEST_STACKS[0]);
    securityGroups = getResources(template, RESOURCE_TYPES.SECURITY_GROUP);

    // Get all ingress rules from SecurityGroupIngress resources
    const standaloneRules = getSecurityGroupIngressRules(template);
    const standaloneNfsRules = standaloneRules
      .map((rule) => getResourceProperties(rule))
      .filter((properties) => isNfsPortRule(properties));

    // Also get ingress rules from security groups' SecurityGroupIngress property
    const securityGroupNfsRules = securityGroups.flatMap((sg) => {
      try {
        const ingressRules = getIngressRules(sg);
        return ingressRules.filter((rule) => isNfsPortRule(rule));
      } catch {
        return [];
      }
    });

    nfsRules = [...standaloneNfsRules, ...securityGroupNfsRules];
  });

  test("EFS security group allows NFS from ECS", () => {
    expect(securityGroups.length).toBeGreaterThan(0);
    expect(nfsRules.length).toBeGreaterThan(0);
    nfsRules.forEach((rule) => {
      expect(rule.IpProtocol).toBe("tcp");
    });
  });
});
```

### How to Test Route Table Configurations

```typescript
test("public subnets route to Internet Gateway", () => {
  const template = Template.fromStack(stacks.networkingStack);

  // Get all routes
  const routes = template.findResources("AWS::EC2::Route");

  // Find Internet Gateway route
  const hasIgwRoute = Object.values(routes).some((route) => {
    const props = route.Properties;
    return props.GatewayId?.Ref?.includes("InternetGateway");
  });

  expect(hasIgwRoute).toBe(true);
});
```

## How to Add New Connectivity Tests

### Which File to Add To

**File Selection Guide:**

| Test Type                       | File                               | When to Use                    |
| ------------------------------- | ---------------------------------- | ------------------------------ |
| VPC, subnets, routing, gateways | `networking-connectivity.test.ts`  | Network infrastructure changes |
| ALB, ECS, EFS, security groups  | `service-connectivity.test.ts`     | Application service changes    |
| Stack exports, SSM parameters   | `cross-stack-connectivity.test.ts` | Cross-stack dependency changes |

### Required Setup

1. **Import dependencies:**

```typescript
import { Template, Match } from "aws-cdk-lib/assertions";
import { createConnectivityTestStacks } from "../utils/test-utils";
import {
  getResources,
  getResourceProperties,
  validateResourceProperties,
} from "../utils";
import {
  ConnectivityTestStacks,
  RESOURCE_TYPES,
  PORT_CONFIG,
  STORAGE_TEST_STACKS,
  IAM_TEST_STACKS,
  INSTANCE_TEST_STACKS,
} from "./test-config";
```

2. **Initialize stacks:**

```typescript
describe("New Connectivity Tests", () => {
  let stacks: ConnectivityTestStacks;

  beforeAll(() => {
    stacks = createConnectivityTestStacks();
  });

  // Helper function (arrow function)
  const getTemplate = (stackName: keyof ConnectivityTestStacks) => {
    if (stackName === "app") {
      throw new Error("Cannot get template for app");
    }
    return Template.fromStack(stacks[stackName]);
  };
});
```

### Example Test

```typescript
describe("New Service Connectivity", () => {
  let stacks: ConnectivityTestStacks;
  let serviceContainers: Array<{
    container: ContainerDefinition;
    hasCorrectPort: boolean;
  }>;

  beforeAll(() => {
    stacks = createConnectivityTestStacks();
    const template = getTemplate(IAM_TEST_STACKS[3]);
    const taskDefs = getResources(template, RESOURCE_TYPES.ECS_TASK_DEFINITION);

    // Pre-compute all data in beforeAll (no conditionals in tests)
    const allContainers = taskDefs.flatMap((taskDef) =>
      getContainersFromTaskDef(taskDef)
    );

    serviceContainers = allContainers
      .filter((container) =>
        container.Name?.toLowerCase().includes("my-service")
      )
      .map((container) => ({
        container,
        hasCorrectPort: containerHasPort(container, 8080),
      }));
  });

  test("new service uses correct port", () => {
    expect(serviceContainers.length).toBeGreaterThan(0);
    serviceContainers.forEach(({ hasCorrectPort }) => {
      expect(hasCorrectPort).toBe(true);
    });
  });
});
```

## Test Files

### 1. Network Connectivity Tests (`networking-connectivity.test.ts`)

**Lines:** 1,079 | **Test Cases:** 50+

Validates core networking infrastructure and connectivity patterns.

**Test Coverage:**

- VPC Configuration (DNS, CIDR, multi-AZ)
- Subnet Configuration (public/private segregation)
- Internet Gateway (public internet access)
- NAT Gateway (private subnet outbound)
- Route Tables (routing rules and associations)
- VPC Endpoints (S3 gateway endpoint)
- Network Isolation (subnet segregation)
- VPC Flow Logs (traffic capture)
- High Availability (multi-AZ distribution)
- DHCP Configuration

**Key Validations:**

- Public subnets have Internet Gateway routes
- Private subnets have NAT Gateway routes
- Subnets span multiple availability zones
- VPC Flow Logs capture all traffic
- Route tables are properly associated with subnets

### 2. Service Connectivity Tests (`service-connectivity.test.ts`)

**Lines:** 814 | **Test Cases:** 30+

Validates connectivity between application services and infrastructure components.

**Test Coverage:**

- ALB to ECS Connectivity (load balancing)
- ECS to EFS Connectivity (persistent storage)
- Security Group Rules (least privilege)
- Port Configuration (expected ports/protocols)
- Network Mode (bridge, host, awsvpc)
- Health Check Connectivity (ALB health checks)
- Service Discovery (DNS-based discovery)
- Cross-Stack Connectivity (resource sharing)

**Key Validations:**

- ALB security group allows traffic from allowed CIDRs
- ECS instances accept traffic from ALB
- EFS mount targets allow NFS from ECS
- Services use correct ports (Prometheus: 9090, Grafana: 3000)
- Health checks are properly configured
- All services are in the same VPC

### 3. Cross-Stack Connectivity Tests (`cross-stack-connectivity.test.ts`)

**Lines:** 568 | **Test Cases:** 25+

Validates dependencies and data flow between CloudFormation stacks.

**Test Coverage:**

- CloudFormation Outputs (stack exports)
- SSM Parameters (cross-stack parameter sharing)
- Stack Dependencies (dependency chains)
- Resource References (cross-stack resource sharing)
- Configuration Propagation (environment config flow)
- Parameter Store Connectivity (hierarchical parameters)
- Dependency Validation (no circular dependencies)

**Key Validations:**

- Stacks export required resources
- SSM parameters follow naming conventions
- Stack dependency order is correct
- No circular dependencies exist
- Configuration propagates across all stacks

## Vulnerabilities and Limitations

### Known Design Vulnerabilities

**1. Template-Only Validation**

- **Risk:** Tests validate CloudFormation templates, not deployed infrastructure
- **Impact:** Runtime issues (AWS service limits, actual network latency) not caught
- **Mitigation:** Supplement with post-deployment smoke tests

**2. Shared Test State**

- **Risk:** Stack instances shared across tests in `beforeAll()`
- **Impact:** One test failure might affect others (though tests are read-only)
- **Mitigation:** Tests are designed to be read-only; no state mutation

**3. No Actual Network Traffic Testing**

- **Risk:** Security group rules validated but not actual packet flow
- **Impact:** Subtle routing issues or firewall rules not detected
- **Mitigation:** Add integration tests that make actual HTTP requests post-deployment

**4. AWS Service Limit Blind Spots**

- **Risk:** Tests don't validate against AWS account limits
- **Impact:** Deployment may fail due to VPC limit, EIP limit, etc.
- **Mitigation:** Use AWS Service Quotas API in separate validation

**5. Timing and Eventual Consistency**

- **Risk:** Tests assume synchronous stack creation
- **Impact:** Cross-stack references may not reflect deployment realities
- **Mitigation:** Add retry logic in actual deployment scripts

### Testing Limitations

**What These Tests DON'T Catch:**

1. **Runtime Configuration:**

   - Environment variables in running containers
   - Secrets Manager values
   - Dynamic service discovery registration

2. **Performance Issues:**

   - Network latency between services
   - NAT Gateway bandwidth constraints
   - ALB connection limits

3. **DNS Resolution:**

   - Route53 record creation
   - Service discovery DNS propagation
   - External DNS resolution

4. **IAM Permissions:**
   - Task role permissions
   - Instance profile permissions
   - Cross-account access

## Best Practices

### 1. Test Complete Stack Hierarchy

Always test the full stack dependency chain:

```typescript
beforeAll(() => {
  // Create all stacks together to validate dependencies
  stacks = createConnectivityTestStacks();
});
```

### 2. Validate Security Group Directions

Test both ingress and egress rules:

```typescript
// Ingress: Allow traffic IN
test("ALB accepts traffic from allowed CIDR", () => {
  // ... validate ingress rule
});

// Egress: Allow traffic OUT
test("ECS instances can reach EFS", () => {
  // ... validate egress rule
});
```

### 3. Test Multi-AZ Distribution

Ensure resources are properly distributed:

```typescript
test("subnets span multiple availability zones", () => {
  const azs = new Set();
  subnets.forEach((subnet) => azs.add(subnet.az));
  expect(azs.size).toBeGreaterThanOrEqual(2);
});
```

### 4. Use Utility Functions from `../utils`

Import and use shared utilities instead of defining inline helpers:

```typescript
import {
  getResources,
  getResourceProperties,
  getContainersFromTaskDef,
  validateResourceProperties,
  isInRange,
  isValidNetworkMode,
} from "../utils";

// Use in tests
test("Prometheus uses correct port", () => {
  const template = getTemplate(IAM_TEST_STACKS[3]);
  const taskDefs = getResources(template, RESOURCE_TYPES.ECS_TASK_DEFINITION);
  const containers = taskDefs.flatMap((td) =>
    getContainersFromTaskDef(td)
  );
  // ... validation logic
});
```

### 5. Pre-compute Data in beforeAll (No Conditionals in Tests)

**❌ Bad (Conditional in test):**

```typescript
test("validate NFS rules", () => {
  const rules = getIngressRules(template);
  const nfsRules = rules.filter((rule) => {
    if (rule.FromPort === 2049) { // Conditional in test!
      return true;
    }
    return false;
  });
  expect(nfsRules.length).toBeGreaterThan(0);
});
```

**✅ Good (Pre-compute in beforeAll):**

```typescript
describe("NFS Rules", () => {
  let nfsRules: Array<Record<string, unknown>>;

  beforeAll(() => {
    const rules = getIngressRules(template);
    nfsRules = rules.filter((rule) => isNfsPortRule(rule));
  });

  test("NFS rules exist", () => {
    expect(nfsRules.length).toBeGreaterThan(0);
  });
});
```

### 6. Never Access Template During Initialization

**❌ Bad:**

```typescript
describe("Tests", () => {
  const count = countResourcesOfType(template, "AWS::EC2::VPC"); // Undefined!
});
```

**✅ Good:**

```typescript
describe("Tests", () => {
  let vpcCount: number;

  beforeAll(() => {
    const template = getTemplate(NETWORKING_TEST_STACKS[0]);
    vpcCount = getResources(template, RESOURCE_TYPES.VPC).length;
  });

  test("should have VPC", () => {
    expect(vpcCount).toBe(1);
  });
});
```

## Running Tests

### Run All Connectivity Tests

```bash
# Via yarn
yarn test tests/unit/connectivity/

# Via Make
make test:connectivity
```

### Run Specific Test File

```bash
# Network connectivity tests
yarn test tests/unit/connectivity/networking-connectivity.test.ts

# Service connectivity tests
yarn test tests/unit/connectivity/service-connectivity.test.ts

# Cross-stack connectivity tests
yarn test tests/unit/connectivity/cross-stack-connectivity.test.ts
```

### Run Specific Test Suite

```bash
# Run only VPC Configuration tests
yarn test tests/unit/connectivity/networking-connectivity.test.ts -t "VPC Configuration"

# Run only ALB connectivity tests
yarn test tests/unit/connectivity/service-connectivity.test.ts -t "ALB to ECS Connectivity"
```

### Watch Mode (Development)

```bash
# Run tests in watch mode
yarn test:watch tests/unit/connectivity/

# Run specific file in watch mode
yarn test:watch tests/unit/connectivity/service-connectivity.test.ts
```

## Performance Considerations

### Test Execution Time

Connectivity tests synthesise multiple stacks, which can be slow:

- **Network tests**: ~5-10 seconds
- **Service tests**: ~10-15 seconds (full stack)
- **Cross-stack tests**: ~10-15 seconds (full stack)
- **Total suite**: ~30-40 seconds

### Optimisation Strategies

1. **Share stack instances** across tests using `beforeAll()`
2. **Group related tests** in the same describe block
3. **Use specific test patterns** with `-t` flag during development
4. **Run in parallel** when possible (tests are independent)

```bash
# Run tests in parallel (Jest default)
yarn test tests/unit/connectivity/ --maxWorkers=4

# Run specific pattern during development
yarn test tests/unit/connectivity/ -t "Security Group"
```

## Integration with CI/CD

### Pre-Deployment Validation

```yaml
# GitHub Actions example
- name: Validate Connectivity
  run: yarn test tests/unit/connectivity/

- name: Deploy if Tests Pass
  if: success()
  run: make deploy-all
```

### Post-Deployment Verification

```bash
# Verify deployed infrastructure matches tests
yarn test:integration:deployed
```

## Troubleshooting

### Enable Verbose Output

```bash
VERBOSE_TESTS=1 yarn test tests/unit/connectivity/ --verbose
```

### Debug Stack Synthesis

```typescript
test("debug stack output", () => {
  const template = Template.fromStack(stack);
  console.log(JSON.stringify(template.toJSON(), null, 2));
});
```

### Common Test Failures

See [TROUBLESHOOTING_CONSOLIDATED.md](../../docs/TROUBLESHOOTING_CONSOLIDATED.md) for comprehensive error resolution.

## Related Documentation

- [AWS VPC Documentation](https://docs.aws.amazon.com/vpc/latest/userguide/what-is-amazon-vpc.html)
- [AWS ECS Networking](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/networking.html)
- [CDK Testing Guide](https://docs.aws.amazon.com/cdk/v2/guide/testing.html)

## Contributing

When adding new connectivity tests:

1. Follow the existing pattern and structure
2. Use utility functions from `../utils` to eliminate duplication
3. Use stack constants from `test-config.ts` (e.g., `STORAGE_TEST_STACKS[0]`) instead of hardcoded stack names
4. Pre-compute all data in `beforeAll` blocks (no conditionals in tests)
5. Add guard assertions before `forEach` loops
6. Test both positive (works) and negative (doesn't work) cases
7. Include descriptive test names that explain what is being validated
8. Add documentation for complex connectivity patterns
9. Update this README with new test categories
10. Ensure tests follow [unit test best practices](../../prompts/tests/unit-test.txt)
