<!-- @format -->

# Integration Tests

This directory contains integration tests that validate the complete monitoring stack deployment and security posture.

## Quick Start

### Run All Integration Tests

```bash
# Using yarn
yarn test:integration

# Using Make
make test-integration

# Using the helper script
./scripts/tests/test-integration-local.sh run
```

### Run Local Integration Tests (Synthesise Stacks)

```bash
# Basic synthesis
yarn test:integration:local

# Save templates for inspection
yarn test:integration:local:save

# Debug mode with detailed output
yarn test:integration:local:debug
```

See [Local Testing Guide](./LOCAL_TESTING_GUIDE.md) for comprehensive local testing documentation.

## Test Categories

### Security Posture Tests (`security/`)

Comprehensive security validation organized into focused test modules by security domain.

Comprehensive security validation to catch misconfigurations across the entire monitoring stack.

### Connectivity Tests (`connectivity/`)

Comprehensive connectivity validation across network layers, service-to-service communication, and cross-stack dependencies.

#### Network Connectivity (`connectivity/network-connectivity.test.ts`)

- VPC configuration and DNS
- Subnet configuration and isolation
- Internet Gateway for public access
- NAT Gateway for private outbound
- Route tables and associations
- VPC endpoints
- VPC Flow Logs
- High availability across AZs

**40 tests** validating core networking infrastructure.

#### Service Connectivity (`connectivity/service-connectivity.test.ts`)

- ALB to ECS connectivity
- ECS to EFS connectivity
- Security group rules
- Port and protocol configuration
- Network modes (bridge/host/awsvpc)
- Health check connectivity
- Service discovery
- Cross-stack resource sharing

**45 tests** validating service-to-service communication.

#### Cross-Stack Connectivity (`connectivity/cross-stack-connectivity.test.ts`)

- CloudFormation exports and imports
- SSM Parameter Store sharing
- Stack dependency chains
- Resource references across stacks
- Configuration propagation
- No circular dependencies

**28 tests** validating cross-stack dependencies.

**Total: 113 connectivity tests** | See [Connectivity Tests README](./connectivity/README.md) for details.

#### Test Coverage

1. **Network Security**

   - VPC configuration (DNS, subnets)
   - Security group rules and restrictions
   - Network isolation (public vs private subnets)
   - VPC Flow Logs configuration

2. **Instance Security**

   - IMDSv2 enforcement on launch templates
   - IMDSv2 usage in SSM scripts
   - EBS encryption at rest
   - Instance profile permissions
   - User data security (no hardcoded credentials)

3. **Storage Security**

   - EFS encryption at rest and in transit
   - EFS access point POSIX permissions
   - Lifecycle policies
   - Backup configuration (production)

4. **IAM Security**

   - Least privilege principle validation
   - No wildcard permissions on sensitive actions
   - Proper role trust relationships
   - Scoped SSM parameter access
   - No AdministratorAccess policies

5. **Monitoring & Logging**

   - CloudWatch Logs retention and encryption
   - VPC Flow Logs capturing all traffic
   - Container Insights (production)
   - EventBridge rules for ECS state changes

6. **Application Security**

   - ALB security (drop invalid headers, deletion protection)
   - Target group health checks
   - Container security (non-root, read-only filesystem)
   - Secrets management (Secrets Manager)
   - SSM State Manager targeting

7. **Compliance & Governance**
   - Resource tagging (Environment, Project)
   - Deletion protection (production)
   - Update policies for Auto Scaling Groups

**Total: 84 security tests across 7 domains** | See [Security Tests README](./security/README.md) for details.

> **Note**: Security tests have been refactored into focused modules by domain. See [SECURITY_TESTS_REFACTORING.md](./SECURITY_TESTS_REFACTORING.md) for details.

## Running Tests

### Run All Integration Tests

```bash
# Run all integration tests
npm test -- tests/integration/

# Or with yarn
yarn test tests/integration/

# Or with make
make test-integration
```

### Run Security Posture Tests

```bash
# Run all security tests
yarn test:security

# Or run specific security domain
yarn test:security:network        # Network security only
yarn test:security:instance       # Instance security only
yarn test:security:storage        # Storage security only
yarn test:security:iam            # IAM security only
yarn test:security:monitoring     # Monitoring & logging only
yarn test:security:application    # Application security only
yarn test:security:compliance     # Compliance & governance only

# Legacy single-file test (deprecated)
npm test -- tests/integration/security-posture.test.ts

# With verbose output
npm test -- tests/integration/security-posture.test.ts --verbose

# Run specific test suite
npm test -- tests/integration/security-posture.test.ts -t "Network Security"

# Run specific test
npm test -- tests/integration/security-posture.test.ts -t "VPC has DNS hostnames"
```

### Run Connectivity Tests

```bash
# All connectivity tests
yarn test:connectivity

# With coverage
yarn test:connectivity:coverage

# Network connectivity only
yarn test:network-connectivity

# Service connectivity only
yarn test:service-connectivity

# Cross-stack connectivity only
yarn test:cross-stack-connectivity

# Specific test suite
npm test -- tests/integration/connectivity/network-connectivity.test.ts -t "VPC Configuration"
```

### Run with Coverage

```bash
npm test -- --coverage tests/integration/

# Generate HTML report
npm test -- --coverage --coverageReporters=html tests/integration/
```

## Test Structure

Each test file follows this pattern:

```typescript
describe("Integration: <Feature Name>", () => {
  // Shared fixtures created once for all tests
  let stacks: ReturnType<typeof createMonitoringStack>;

  beforeAll(() => {
    stacks = createMonitoringStack();
  });

  describe("<Category>", () => {
    describe("<Subcategory>", () => {
      test("<specific validation>", () => {
        // Arrange
        const template = Template.fromStack(stacks.infraStack);

        // Act & Assert
        template.hasResourceProperties("AWS::Resource::Type", {
          Property: expectedValue,
        });
      });
    });
  });
});
```

## Adding New Tests

### 1. Create Test Helper Functions

```typescript
/**
 * Extract security group IDs from template
 */
function extractSecurityGroupIds(template: Template): string[] {
  const securityGroups = template.findResources("AWS::EC2::SecurityGroup");
  return Object.keys(securityGroups);
}
```

### 2. Write Descriptive Test Names

Good test names answer: **What is being tested?**

```typescript
// Good: Specific and descriptive
test("ALB security group only allows traffic from allowed IP ranges", () => {});

// Bad: Too vague
test("security group works", () => {});
```

### 3. Use Template Matchers

```typescript
// Exact match
template.hasResourceProperties("AWS::EC2::VPC", {
  EnableDnsHostnames: true,
});

// Pattern matching
template.hasResourceProperties("AWS::IAM::Role", {
  ManagedPolicyArns: Match.arrayWith([
    Match.objectLike({
      "Fn::Join": Match.arrayWith([
        Match.stringLikeRegexp("AmazonSSMManagedInstanceCore"),
      ]),
    }),
  ]),
});

// Capture values for advanced assertions
const capture = new Capture();
template.hasResourceProperties("AWS::EC2::SecurityGroup", {
  GroupDescription: capture,
});
expect(capture.asString()).toMatch(/monitoring/i);
```

### 4. Test Both Positive and Negative Cases

```typescript
// Positive: Verify correct configuration exists
test("EFS has encryption enabled", () => {
  template.hasResourceProperties("AWS::EFS::FileSystem", {
    Encrypted: true,
  });
});

// Negative: Verify insecure configuration does NOT exist
test("no security groups allow unrestricted SSH access", () => {
  const rules = template.findResources("AWS::EC2::SecurityGroupIngress");

  for (const [id, rule] of Object.entries(rules)) {
    const props = (rule as any).Properties;
    if (props.FromPort === 22 && props.ToPort === 22) {
      expect(props.CidrIp).not.toBe("0.0.0.0/0");
    }
  }
});
```

## Environment-Specific Testing

Test both development and production configurations:

```typescript
describe("Production-Specific Configuration", () => {
  test("ALB has deletion protection enabled for production", () => {
    const prodStacks = createMonitoringStack("production");
    const template = Template.fromStack(prodStacks.infraStack);

    template.hasResourceProperties(
      "AWS::ElasticLoadBalancingV2::LoadBalancer",
      {
        LoadBalancerAttributes: Match.arrayWith([
          Match.objectLike({
            Key: "deletion_protection.enabled",
            Value: "true",
          }),
        ]),
      }
    );
  });
});
```

## Best Practices

### 1. Test Security Defaults

Verify that secure defaults are enforced:

```typescript
test("launch template enforces IMDSv2 by default", () => {
  template.hasResourceProperties("AWS::EC2::LaunchTemplate", {
    LaunchTemplateData: {
      MetadataOptions: {
        HttpTokens: "required",
      },
    },
  });
});
```

### 2. Test for Common Misconfigurations

```typescript
test("no security groups allow unrestricted access on sensitive ports", () => {
  const sensitivePortsRegex = /(22|3389|3306|5432|1433|27017|6379)/;
  // ... validation logic
});
```

### 3. Test IAM Least Privilege

```typescript
test("instance role does not have wildcard permissions on resources", () => {
  const policies = template.findResources("AWS::IAM::Policy");

  for (const [id, policy] of Object.entries(policies)) {
    const statements =
      (policy as any).Properties.PolicyDocument?.Statement || [];

    for (const statement of statements) {
      if (statement.Resource === "*") {
        // Wildcard should only be for read-only actions
        const actions = Array.isArray(statement.Action)
          ? statement.Action
          : [statement.Action];

        const unsafeActions = actions.filter(
          (action: string) => !action.match(/^(Describe|Get|List)/)
        );

        expect(unsafeActions).toHaveLength(0);
      }
    }
  }
});
```

### 4. Test Compliance Requirements

```typescript
test("all major resources have Environment tag", () => {
  const resources = template.findResources("AWS::ECS::Cluster");

  for (const [id, resource] of Object.entries(resources)) {
    const tags = (resource as any).Properties.Tags || [];
    const hasEnvironmentTag = tags.some(
      (tag: any) => tag.Key === "Environment"
    );
    expect(hasEnvironmentTag).toBe(true);
  }
});
```

## Troubleshooting

### Test Failures

1. **Resource Not Found**

   ```
   Error: Template has X AWS::Resource::Type, expected at least 1
   ```

   **Solution**: Verify the stack synthesises correctly and the resource exists:

   ```typescript
   const resources = template.findResources("AWS::Resource::Type");
   console.log(JSON.stringify(resources, null, 2));
   ```

2. **Property Mismatch**

   ```
   Error: Expected property X to be Y, but was Z
   ```

   **Solution**: Check the actual CloudFormation template:

   ```typescript
   const template = Template.fromStack(stack);
   console.log(JSON.stringify(template.toJSON(), null, 2));
   ```

3. **CDK Synthesis Errors**

   ```
   Error: Stack failed to synthesise
   ```

   **Solution**: Check for missing required props or invalid configurations.

### Performance Issues

If tests are slow:

1. Reuse fixtures across tests using `beforeAll()`
2. Use `TestFixtures` caching pattern
3. Run tests in parallel (but be careful with shared resources)

### Debugging Tips

```typescript
// Log the entire template
console.log(JSON.stringify(template.toJSON(), null, 2));

// Log specific resources
const securityGroups = template.findResources("AWS::EC2::SecurityGroup");
console.log(JSON.stringify(securityGroups, null, 2));

// Capture values for inspection
const capture = new Capture();
template.hasResourceProperties("AWS::EC2::SecurityGroup", {
  GroupDescription: capture,
});
console.log("Captured:", capture.asString());
```

## CI/CD Integration

Integration tests should run:

1. On every pull request
2. Before deployment to any environment
3. Nightly (comprehensive suite)

### GitHub Actions Example

```yaml
- name: Run Integration Tests
  run: |
    npm test -- tests/integration/ --coverage

- name: Upload Coverage
  uses: codecov/codecov-action@v3
  with:
    files: ./coverage/lcov.info
    flags: integration
```

## Local Testing Infrastructure

### Setup Module (`setup.ts`)

Provides reusable utilities for integration testing:

- Stack synthesis utilities
- Template management (save/load/compare)
- Validation helpers
- Resource extraction utilities
- Cleanup functions
- Debugging tools

See [Integration Test Setup Summary](./INTEGRATION_TEST_SETUP_SUMMARY.md) for complete API reference.

### Helper Scripts

**Bash Script**: `scripts/tests/test-integration-local.sh`

- Convenient wrapper for common testing tasks
- Commands: `run`, `synthesise`, `debug`, `prod`, `security`, `connectivity`, `clean`

**TypeScript Script**: `scripts/tests/local-integration-test.ts`

- Flexible CLI tool with granular options
- Options: `--save-templates`, `--environment`, `--stack`, `--summary`, `--details`, `--compare`, `--clean`

See [Local Testing Guide](./LOCAL_TESTING_GUIDE.md) for comprehensive usage documentation.

### Generated Templates

Templates are saved to: `tests/integration/.generated-templates/`

**Naming Pattern**: `{environment}-{stack}-template.json`

These templates are excluded from version control (see `.gitignore`).

## Related Documentation

- [Local Testing Guide](./LOCAL_TESTING_GUIDE.md) - Comprehensive local testing documentation
- [Integration Test Setup Summary](./INTEGRATION_TEST_SETUP_SUMMARY.md) - Setup utilities API reference
- [Security Posture Tests Summary](./INTEGRATION_TESTS_SUMMARY.md) - Security test coverage
- [Connectivity Tests Summary](./CONNECTIVITY_TESTS_SUMMARY.md) - Connectivity test coverage
- [Unit Tests](../unit/README.md)
- [AWS CDK Testing](https://docs.aws.amazon.com/cdk/v2/guide/testing.html)
- [CDK Assertions](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.assertions-readme.html)
- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [AWS Well-Architected Security Pillar](https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/welcome.html)

## Maintenance

- Review and update tests when AWS best practices change
- Add new tests for newly discovered security vulnerabilities
- Keep test dependencies up to date (`npm update`)
- Regenerate snapshots when intentional changes are made

## Contributing

When adding new integration tests:

1. Follow the existing patterns and conventions
2. Write clear, descriptive test names
3. Add documentation for complex test logic
4. Update this README with new test categories
5. Ensure tests are deterministic (no flaky tests)
