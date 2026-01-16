<!-- @format -->

# Connectivity Integration Tests

This directory contains integration tests that validate network and service connectivity across the monitoring stack infrastructure.

## Test Files

### 1. Network Connectivity Tests (`network-connectivity.test.ts`)

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

## Running Tests

### Run All Connectivity Tests

```bash
# Via npm
npm test -- tests/integration/connectivity/

# Via yarn
yarn test tests/integration/connectivity/

# Via Make
make test-integration
```

### Run Specific Test File

```bash
# Network connectivity tests
npm test -- tests/integration/connectivity/network-connectivity.test.ts

# Service connectivity tests
npm test -- tests/integration/connectivity/service-connectivity.test.ts

# Cross-stack connectivity tests
npm test -- tests/integration/connectivity/cross-stack-connectivity.test.ts
```

### Run Specific Test Suite

```bash
# Run only VPC Configuration tests
npm test -- tests/integration/connectivity/network-connectivity.test.ts -t "VPC Configuration"

# Run only ALB connectivity tests
npm test -- tests/integration/connectivity/service-connectivity.test.ts -t "ALB to ECS Connectivity"

# Run only CloudFormation Outputs tests
npm test -- tests/integration/connectivity/cross-stack-connectivity.test.ts -t "CloudFormation Outputs"
```

## Test Architecture

### Stack Creation Pattern

All connectivity tests use a consistent pattern for creating test stacks:

```typescript
function createServiceStacks(): ServiceStacks {
  const app = new cdk.App();

  // Layer 1: Networking
  const networkingStack = new NetworkingStack(app, "TestNetworkingStack", {
    // ... config
  });

  // Layer 2: EFS
  const efsStack = new MonitoringEfsStack(app, "TestEfsStack", {
    vpc: networkingStack.vpc, // Cross-stack reference
  });

  // Layer 3: Infrastructure
  const infraStack = new MonitoringInfraStack(app, "TestInfraStack", {
    vpc: networkingStack.vpc,
    fileSystem: efsStack.fileSystem, // Cross-stack reference
  });

  // Layer 4: Services
  const serviceStack = new MonitoringServiceStack(app, "TestServiceStack", {
    cluster: infraStack.cluster, // Cross-stack reference
  });

  return { app, networkingStack, efsStack, infraStack, serviceStack };
}
```

### Validation Patterns

#### 1. Resource Existence

```typescript
test("VPC exists with correct CIDR block", () => {
  template.hasResourceProperties("AWS::EC2::VPC", {
    CidrBlock: "10.0.0.0/16",
  });
});
```

#### 2. Security Group Rules

```typescript
test("EFS security group allows NFS from ECS", () => {
  template.hasResourceProperties("AWS::EC2::SecurityGroupIngress", {
    IpProtocol: "tcp",
    FromPort: 2049,
    ToPort: 2049,
    SourceSecurityGroupId: Match.anyValue(),
  });
});
```

#### 3. Cross-Stack References

```typescript
test("Service stack references cluster from Infra stack", () => {
  const services = template.findResources("AWS::ECS::Service");

  Object.values(services).forEach((service) => {
    const properties = service.Properties;
    expect(properties.Cluster).toBeDefined();
  });
});
```

## What These Tests Catch

### Network Connectivity Issues

- **Missing Internet Gateway**: Public subnets cannot reach internet
- **Incorrect Route Tables**: Traffic not routed properly
- **NAT Gateway Misconfiguration**: Private subnets cannot access internet
- **Subnet CIDR Conflicts**: Overlapping IP ranges
- **Missing VPC Flow Logs**: No network traffic visibility

### Service Connectivity Issues

- **Security Group Misconfiguration**: Services cannot communicate
- **Wrong Ports**: Services listening on unexpected ports
- **Missing Health Checks**: Unhealthy instances not detected
- **EFS Mount Failures**: ECS tasks cannot mount EFS
- **ALB Routing Issues**: Traffic not reaching correct targets

### Cross-Stack Issues

- **Missing Exports**: Dependent stacks cannot find required resources
- **Circular Dependencies**: Stacks reference each other incorrectly
- **Parameter Mismatches**: Configuration not propagating correctly
- **Wrong Stack Order**: Stacks deployed in incorrect sequence

## Best Practices

### 1. Test Complete Stack Hierarchy

Always test the full stack dependency chain:

```typescript
beforeAll(() => {
  // Create all stacks together to validate dependencies
  stacks = createServiceStacks();
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

### 4. Validate Port Consistency

Ensure ports match across configurations:

```typescript
// Task definition
test("Prometheus uses port 9090", () => {
  expect(container.portMappings).toContain(9090);
});

// Target group
test("Target group forwards to port 9090", () => {
  expect(targetGroup.port).toBe(9090);
});
```

## Common Issues and Solutions

### Issue: "SecurityGroup not found"

**Cause**: Security group not created or wrong stack reference

**Solution**: Verify security group is created before it's referenced

```typescript
// Check security group exists
const securityGroups = template.findResources("AWS::EC2::SecurityGroup");
expect(Object.keys(securityGroups).length).toBeGreaterThan(0);
```

### Issue: "VPC not accessible across stacks"

**Cause**: VPC not passed correctly between stacks

**Solution**: Verify VPC reference in stack props

```typescript
const efsStack = new MonitoringEfsStack(app, "EfsStack", {
  vpc: networkingStack.vpc, // Correct reference
});
```

### Issue: "Route table not associated with subnet"

**Cause**: Missing subnet route table association

**Solution**: Verify associations exist

```typescript
const associations = template.findResources(
  "AWS::EC2::SubnetRouteTableAssociation"
);
expect(Object.keys(associations).length).toBeGreaterThan(0);
```

### Issue: "Health checks failing"

**Cause**: Incorrect health check path or port

**Solution**: Verify health check configuration

```typescript
template.hasResourceProperties("AWS::ElasticLoadBalancingV2::TargetGroup", {
  HealthCheckPath: "/health",
  HealthCheckPort: "traffic-port", // Use same port as target
});
```

## Integration with CI/CD

### Pre-Deployment Validation

Run connectivity tests before deploying to ensure:

1. Network paths are correctly configured
2. Security groups allow required traffic
3. Cross-stack dependencies are resolved

```yaml
# GitHub Actions example
- name: Validate Connectivity
  run: |
    npm test -- tests/integration/connectivity/

- name: Deploy if Tests Pass
  if: success()
  run: |
    make deploy-all
```

### Post-Deployment Verification

After deployment, run tests against synthesised templates to verify:

1. Configuration matches expectations
2. No drift from tested configuration

## Performance Considerations

### Test Execution Time

Connectivity tests synthesise multiple stacks, which can be slow:

- **Network tests**: ~5-10 seconds
- **Service tests**: ~10-15 seconds (full stack)
- **Cross-stack tests**: ~10-15 seconds (full stack)

### Optimisation Strategies

1. **Share stack instances** across tests using `beforeAll()`
2. **Group related tests** in the same describe block
3. **Use specific test patterns** with `-t` flag during development
4. **Run in parallel** when possible (be careful with shared resources)

## Troubleshooting

### Enable Verbose Output

```bash
VERBOSE_TESTS=1 npm test -- tests/integration/connectivity/ --verbose
```

### Debug Stack Synthesis

```typescript
test("debug stack output", () => {
  const template = Template.fromStack(stack);
  console.log(JSON.stringify(template.toJSON(), null, 2));
});
```

### Check Specific Resources

```typescript
const resources = template.findResources("AWS::EC2::SecurityGroup");
console.log(JSON.stringify(resources, null, 2));
```

## Related Documentation

- [Integration Tests Overview](../README.md)
- [Security Posture Tests](../security-posture.test.ts)
- [AWS VPC Documentation](https://docs.aws.amazon.com/vpc/latest/userguide/what-is-amazon-vpc.html)
- [AWS ECS Networking](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/networking.html)
- [CDK Testing Guide](https://docs.aws.amazon.com/cdk/v2/guide/testing.html)

## Contributing

When adding new connectivity tests:

1. Follow the existing pattern and structure
2. Test both positive (works) and negative (doesn't work) cases
3. Include descriptive test names that explain what is being validated
4. Add documentation for complex connectivity patterns
5. Update this README with new test categories
