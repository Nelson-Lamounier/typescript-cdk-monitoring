<!-- @format -->

# Security Posture Integration Tests

Comprehensive security validation tests for the monitoring infrastructure, organized by security domain.

## Overview

These tests validate security configurations across all stack layers to catch misconfigurations that could lead to vulnerabilities. Each test file focuses on a specific security domain, making it easy to maintain and extend.

## Test Organization

### Test Files

| File                            | Tests | Focus Area                                        |
| ------------------------------- | ----- | ------------------------------------------------- |
| `network-security.test.ts`      | 11    | VPC, Security Groups, Network Isolation           |
| `instance-security.test.ts`     | 11    | IMDSv2, EBS Encryption, User Data                 |
| `storage-security.test.ts`      | 9     | EFS Encryption, Access Controls, Lifecycle        |
| `iam-security.test.ts`          | 12    | Least Privilege, Trust Relationships, Permissions |
| `monitoring-logging.test.ts`    | 13    | CloudWatch, VPC Flow Logs, Container Insights     |
| `application-security.test.ts`  | 15    | ALB, Container Security, Secrets Management       |
| `compliance-governance.test.ts` | 14    | Tagging, Deletion Protection, Update Policies     |

**Total: 85 security tests across 7 domains**

## Running Tests

### Run All Security Tests

```bash
# Using yarn
yarn test:security

# Using Make
make test-security

# Using npm directly
npm test -- tests/integration/security/
```

### Run Specific Security Domain

```bash
# Network security only
npm test -- tests/integration/security/network-security.test.ts

# IAM security only
npm test -- tests/integration/security/iam-security.test.ts

# Application security only
npm test -- tests/integration/security/application-security.test.ts
```

### Run with Coverage

```bash
npm test -- tests/integration/security/ --coverage
```

## Test Domains

### 1. Network Security

**File**: `network-security.test.ts`

**Validates**:

- VPC DNS configuration
- VPC Flow Logs (all traffic, retention)
- Security group rules (no unrestricted SSH/RDP)
- EFS security group (NFS port restrictions)
- Network isolation (private subnets, NAT gateways)
- Internet Gateway configuration

**Key Tests**:

- No security groups allow unrestricted SSH/RDP access
- EFS only accessible from instance security group
- VPC Flow Logs capture all traffic types
- Private subnets exist for workload isolation

### 2. Instance Security

**File**: `instance-security.test.ts`

**Validates**:

- IMDSv2 enforcement on launch templates
- IMDSv2 usage in SSM automation scripts
- EBS volume encryption (at rest)
- GP3 volume types (cost optimization)
- User data security (no hardcoded credentials)
- Instance placement (private subnets)

**Key Tests**:

- Launch templates enforce IMDSv2 with `HttpTokens: required`
- No IMDSv1 usage in automation scripts
- EBS volumes encrypted with GP3 type
- No hardcoded credentials or API keys in user data

### 3. Storage Security

**File**: `storage-security.test.ts`

**Validates**:

- EFS encryption at rest
- EFS access point POSIX permissions
- EFS security group restrictions
- EFS lifecycle policies
- EFS deletion protection (production)

**Key Tests**:

- EFS encrypted with AWS managed keys
- Access points enforce restrictive POSIX permissions (not 777)
- NFS port (2049) only accessible from security groups (not CIDRs)
- Lifecycle policies configured for IA transition

### 4. IAM Security

**File**: `iam-security.test.ts`

**Validates**:

- Least privilege principle adherence
- No AdministratorAccess or PowerUserAccess policies
- Role trust relationships (EC2, ECS, Lambda)
- SSM parameter access (scoped paths)
- EFS mount permissions
- No wildcard permissions on sensitive resources

**Key Tests**:

- Instance roles use AmazonSSMManagedInstanceCore
- No roles have admin access
- Write actions with wildcard resources are limited
- EFS access scoped to specific file systems

### 5. Monitoring & Logging

**File**: `monitoring-logging.test.ts`

**Validates**:

- CloudWatch Logs retention and encryption
- VPC Flow Logs configuration
- Container Insights (production enabled, dev disabled)
- EventBridge rules for ECS events
- Container logging to CloudWatch
- Log group deletion policies (production: Retain)

**Key Tests**:

- All log groups have retention configured
- VPC Flow Logs capture all traffic types
- Container Insights enabled only in production
- ECS containers log to CloudWatch with awslogs driver

### 6. Application Security

**File**: `application-security.test.ts`

**Validates**:

- ALB security settings (drop invalid headers)
- ALB deletion protection (production)
- Target group health checks
- Container security (no privileged, no root user)
- Secrets management (Secrets Manager)
- SSM State Manager security

**Key Tests**:

- ALB drops invalid header fields
- Target groups have appropriate health check thresholds
- No privileged containers
- Grafana password in Secrets Manager (not hardcoded)
- SSM associations target specific resources

### 7. Compliance & Governance

**File**: `compliance-governance.test.ts`

**Validates**:

- Resource tagging (Environment, Project)
- Deletion protection policies (production)
- Update policies (ASG rolling updates)
- Environment-specific configurations
- Resource naming conventions
- Cost management (instance types, volume types)

**Key Tests**:

- ECS clusters have Environment and Project tags
- Production resources have deletion protection
- ASGs have rolling update policies configured
- Production uses higher capacity than development
- Development uses smaller instance types

## Test Fixtures

### Shared Test Utilities

**File**: `test-fixtures.ts`

Provides:

- `createSecurityTestStacks()` - Creates complete stack hierarchy
- `SecurityTestFixtures` - Singleton cache for stack reuse
- `TEST_CONSTANTS` - Shared configuration values

**Usage**:

```typescript
import { SecurityTestFixtures, TEST_CONSTANTS } from "./test-fixtures";

let stacks = SecurityTestFixtures.getDevelopmentStacks();
let prodStacks = SecurityTestFixtures.getProductionStacks();
```

## Best Practices

### Writing New Security Tests

1. **Use Descriptive Test Names**

   ```typescript
   test("launch template enforces IMDSv2", () => { ... });
   // NOT: test("imds config", () => { ... });
   ```

2. **Group Related Tests**

   ```typescript
   describe("EBS Encryption", () => {
     test("encryption at rest enabled", () => { ... });
     test("uses GP3 volume type", () => { ... });
   });
   ```

3. **Test Both Positive and Negative Cases**

   ```typescript
   test("no security groups allow unrestricted SSH", () => {
     // Ensure misconfiguration is caught
   });
   ```

4. **Use Environment-Specific Tests When Needed**

   ```typescript
   test("production has deletion protection enabled", () => {
     const prodStacks = SecurityTestFixtures.getProductionStacks();
     // ...
   });
   ```

5. **Document Security Rationale**
   ```typescript
   test("EFS access point has restrictive permissions", () => {
     // Permissions should not be 777 (world writable)
     expect(permissions).not.toBe("777");
   });
   ```

### Test Maintenance

1. **Update tests when security requirements change**
2. **Add tests for new security controls**
3. **Remove tests for deprecated controls**
4. **Keep test fixtures in sync with stack changes**

### Common Patterns

#### Testing CloudFormation Properties

```typescript
template.hasResourceProperties("AWS::EC2::LaunchTemplate", {
  LaunchTemplateData: {
    MetadataOptions: {
      HttpTokens: "required",
    },
  },
});
```

#### Finding and Iterating Resources

```typescript
const resources = template.findResources("AWS::IAM::Role");

Object.values(resources).forEach((resource) => {
  const properties = (resource as Record<string, Record<string, unknown>>)
    .Properties;
  // assertions...
});
```

#### Checking for Anti-Patterns

```typescript
Object.entries(rules).forEach(([_logicalId, resource]) => {
  const properties = resource.Properties;
  if (properties.FromPort === 22) {
    expect(properties.CidrIp).not.toBe("0.0.0.0/0");
  }
});
```

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

   **Solution**: Verify the resource exists in the correct stack layer

3. **Property Mismatch**
   ```
   Error: Expected HttpTokens to be "required", but was "optional"
   ```
   **Solution**: Check the actual CDK construct configuration

### Performance Issues

If tests are slow:

1. Use cached fixtures (`SecurityTestFixtures`)
2. Run specific test files instead of entire suite
3. Use `--maxWorkers=1` to reduce memory usage

### Debugging Tests

```typescript
// Log the entire template
const template = Template.fromStack(stacks.infraStack);
console.log(JSON.stringify(template.toJSON(), null, 2));

// Log specific resources
const securityGroups = template.findResources("AWS::EC2::SecurityGroup");
console.log(JSON.stringify(securityGroups, null, 2));
```

## CI/CD Integration

### GitHub Actions Example

```yaml
- name: Run Security Tests
  run: |
    npm test -- tests/integration/security/ --coverage

- name: Upload Security Test Results
  if: always()
  uses: actions/upload-artifact@v4
  with:
    name: security-test-results
    path: coverage/
```

### Pre-Deployment Gate

```yaml
- name: Security Validation
  run: |
    npm test -- tests/integration/security/
    if [ $? -ne 0 ]; then
      echo "Security tests failed. Deployment blocked."
      exit 1
    fi
```

## Related Documentation

- [Integration Tests Overview](../README.md)
- [Security Posture Summary](../INTEGRATION_TESTS_SUMMARY.md)
- [AWS Security Best Practices](https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/welcome.html)
- [CDK Security Best Practices](https://docs.aws.amazon.com/cdk/v2/guide/best-practices.html#best-practices-security)

## Contributing

When adding new security tests:

1. Choose the appropriate domain file
2. Follow existing test patterns
3. Add test description to this README
4. Update test counts in the overview table
5. Document any new test utilities in `test-fixtures.ts`

## Security Resources

- [AWS Well-Architected Security Pillar](https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/)
- [AWS Security Best Practices](https://aws.amazon.com/security/best-practices/)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [CIS AWS Foundations Benchmark](https://www.cisecurity.org/benchmark/amazon_web_services)
