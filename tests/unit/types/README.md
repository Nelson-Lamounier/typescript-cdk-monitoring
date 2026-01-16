<!-- @format -->

# Shared Test Types

This directory contains shared TypeScript type definitions used across all test suites in the project. By centralising type definitions, we eliminate code duplication, ensure type consistency, and make tests easier to maintain.

## Purpose

Before this refactoring, type definitions were scattered across individual test files, leading to:

- **Code duplication**: Same interfaces defined multiple times
- **Inconsistency**: Subtle differences in type definitions across tests
- **Maintenance burden**: Changes required updates in multiple files
- **Poor discoverability**: Hard to find which types were available

The `test-types.ts` module solves these problems by providing a single source of truth for all test-related types.

## File Structure

```
tests/unit/types/
├── README.md           # This file
└── test-types.ts       # Shared type definitions
```

## Organisation

The `test-types.ts` file is organised into the following sections:

### 1. CloudFormation Resource Properties

Generic CloudFormation resource structures used across all tests:

- `CloudFormationResource` - Complete CF resource structure
- `ResourceWithProperties` - Type-safe wrapper for resources with properties
- `ResourceProperties` - Generic properties type

### 2. AWS VPC/Networking Resource Properties

Networking-specific types for VPC, subnets, routing, and security:

- `VpcProperties` - VPC configuration
- `SubnetProperties` - Subnet configuration
- `RouteProperties` - Route configuration
- `RouteTableProperties` - Route table configuration
- `SecurityGroupProperties` - Security group configuration
- `SecurityGroupRule` - Security group rule structure
- `InternetGatewayProperties` - IGW configuration
- `NatGatewayProperties` - NAT gateway configuration
- `VpcEndpointProperties` - VPC endpoint configuration
- `FlowLogProperties` - VPC flow log configuration

### 3. AWS ECS/Compute Resource Properties

Container and compute-related types:

- `EcsClusterProperties` - ECS cluster configuration
- `EcsTaskDefinitionProperties` - Task definition structure
- `ContainerDefinition` - Container configuration
- `PortMapping` - Container port mapping
- `EcsServiceProperties` - ECS service configuration

### 4. AWS Load Balancer Resource Properties

Application Load Balancer types:

- `AlbProperties` - ALB configuration
- `TargetGroupProperties` - Target group configuration
- `ListenerProperties` - Listener configuration
- `ListenerAction` - Listener action structure

### 5. AWS Storage Resource Properties

EFS and storage-related types:

- `EfsFileSystemProperties` - EFS file system configuration
- `EfsMountTargetProperties` - Mount target configuration
- `EfsAccessPointProperties` - Access point configuration

### 6. AWS IAM Resource Properties

IAM role and policy types:

- `IamRoleProperties` - IAM role configuration
- `IamPolicyProperties` - IAM policy structure

### 7. AWS CloudWatch Resource Properties

CloudWatch logging types:

- `LogGroupProperties` - Log group configuration

### 8. Test Helper Types

Specialised types for test assertions and validations:

- `SubnetsByType` - Categorised subnets (public/private/isolated)
- `RoutesByType` - Categorised routes (IGW/NAT/local/other)
- `AvailabilityZoneInfo` - AZ distribution information
- `CidrValidationResult` - CIDR validation results
- `ResourceCountSummary` - Resource count validation
- `ConnectivityValidationResult` - Network connectivity validation
- `SecurityPostureResult` - Security posture assessment

### 9. Parameterised Test Types

Types for data-driven testing:

- `TestCase<T>` - Generic test case structure
- `EnvironmentTestCase<T>` - Environment-specific test cases
- `ResourceValidationTestCase` - Resource validation test cases

### 10. Type Guards

Runtime type checking functions:

- `hasTagsProperty()` - Check if object has Tags
- `isSecurityGroupRule()` - Check if object is a security group rule
- `hasSubnetProperties()` - Check if object has subnet properties
- `hasRouteProperties()` - Check if object has route properties

## Usage Examples

### Basic Usage

```typescript
import type {
  SubnetProperties,
  RouteProperties,
  SecurityGroupProperties,
} from "../types/test-types";

describe("Networking Tests", () => {
  it("should create subnets with correct properties", () => {
    const template = Template.fromStack(stack);
    const subnets = template.findResources("AWS::EC2::Subnet");

    Object.values(subnets).forEach((subnet) => {
      const props = subnet.Properties as SubnetProperties;
      expect(props.CidrBlock).toBeDefined();
      expect(props.AvailabilityZone).toBeDefined();
    });
  });
});
```

### Using Helper Types

```typescript
import type { SubnetsByType, RoutesByType } from "../types/test-types";

function categorizeSubnets(template: Template): SubnetsByType {
  const subnets = template.findResources("AWS::EC2::Subnet");
  const publicSubnets: SubnetProperties[] = [];
  const privateSubnets: SubnetProperties[] = [];
  const isolatedSubnets: SubnetProperties[] = [];

  // Categorisation logic...

  return { publicSubnets, privateSubnets, isolatedSubnets };
}
```

### Using Type Guards

```typescript
import { hasTagsProperty, isSecurityGroupRule } from "../types/test-types";

function validateResourceTags(resource: unknown): boolean {
  if (hasTagsProperty(resource)) {
    return resource.Tags.some((tag) => tag.Key === "Environment");
  }
  return false;
}
```

### Parameterised Tests

```typescript
import type { TestCase } from "../types/test-types";

describe("CIDR Validation", () => {
  const testCases: TestCase<string>[] = [
    {
      description: "valid CIDR block",
      input: "10.0.0.0/16",
      expected: true,
    },
    {
      description: "invalid CIDR format",
      input: "invalid",
      expected: false,
    },
  ];

  testCases.forEach(({ description, input, expected }) => {
    it(`should handle ${description}`, () => {
      expect(validateCidr(input)).toBe(expected);
    });
  });
});
```

## Migration Guide

### Before: Duplicated Types

```typescript
// networking-connectivity.test.ts
interface SubnetProperties {
  CidrBlock: string;
  AvailabilityZone: string;
  Tags: Array<{ Key: string; Value: string }>;
}

// service-connectivity.test.ts
interface SubnetProperties {
  // Same definition duplicated
  CidrBlock: string;
  AvailabilityZone: string;
  Tags: Array<{ Key: string; Value: string }>;
}
```

### After: Shared Types

```typescript
// test-types.ts (shared)
export interface SubnetProperties {
  CidrBlock: string;
  AvailabilityZone: string;
  Tags: ResourceTag[];
}

// networking-connectivity.test.ts
import type { SubnetProperties } from "../types/test-types";

// service-connectivity.test.ts
import type { SubnetProperties } from "../types/test-types";
```

## Best Practices

### 1. Import Only What You Need

Use named imports to keep your imports clean:

```typescript
// Good
import type { SubnetProperties, RouteProperties } from "../types/test-types";

// Avoid
import type * as TestTypes from "../types/test-types";
```

### 2. Use Type Imports

Use TypeScript's `type` keyword for type-only imports:

```typescript
// Good - Type-only import
import type { SubnetProperties } from "../types/test-types";

// Avoid - Value import for types
import { SubnetProperties } from "../types/test-types";
```

### 3. Extend Types When Needed

If you need additional properties specific to a test, extend the shared type:

```typescript
import type { SubnetProperties } from "../types/test-types";

interface ExtendedSubnetProperties extends SubnetProperties {
  customProperty: string;
}
```

### 4. Add New Types to test-types.ts

When you create a new reusable type, add it to `test-types.ts` rather than duplicating it:

```typescript
// Add to test-types.ts
export interface NewResourceProperties {
  // Properties...
}

// Then import in your test
import type { NewResourceProperties } from "../types/test-types";
```

## Integration with Existing Tests

The shared types are currently used in:

1. **Connectivity Tests**

   - `networking-connectivity.refactored.test.ts`
   - `test-config.ts`
   - `cross-stack-connectivity.test.ts`
   - `service-connectivity.test.ts`

2. **Security Tests**

   - All security posture tests import from shared types

3. **Stack Tests**
   - Foundation stack tests
   - Monitoring stack tests

## Adding New Types

When adding a new type to `test-types.ts`:

1. **Determine the category** - Place it in the appropriate section
2. **Add JSDoc documentation** - Explain the purpose and usage
3. **Use consistent naming** - Follow AWS resource naming conventions
4. **Include all CloudFormation properties** - Even optional ones
5. **Add to this README** - Update the documentation

### Example

```typescript
/**
 * Lambda Function Properties
 *
 * CloudFormation properties for AWS::Lambda::Function resource
 *
 * @see https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-lambda-function.html
 */
export interface LambdaFunctionProperties {
  FunctionName?: string;
  Runtime: string;
  Handler: string;
  Code: {
    S3Bucket?: string;
    S3Key?: string;
    ZipFile?: string;
  };
  Role: unknown;
  Environment?: {
    Variables?: Record<string, string>;
  };
  MemorySize?: number;
  Timeout?: number;
  Tags?: ResourceTag[];
}
```

## Maintenance

### Regular Updates

- **Add new AWS resource types** as they're introduced in tests
- **Update existing types** when AWS changes CloudFormation schemas
- **Remove unused types** to keep the file manageable
- **Refactor related types** to share common patterns

### Version Control

- All changes to `test-types.ts` should be reviewed carefully
- Breaking changes should be communicated to the team
- Consider backwards compatibility when modifying existing types

## Benefits

By using shared types from `test-types.ts`, we achieve:

- **Consistency** - Same types used across all tests
- **Maintainability** - Single place to update type definitions
- **Type Safety** - Strong TypeScript typing throughout tests
- **Discoverability** - Easy to find available types
- **Documentation** - Centralised reference for all test types
- **Reduced Bundle Size** - No duplicate type definitions

## Related Files

- `tests/unit/connectivity/test-config.ts` - Test configuration and constants
- `tests/unit/utils/test-utils.ts` - Test utility functions
- `tests/unit/security/test-fixtures.ts` - Security test fixtures

## Questions or Issues

If you have questions about:

- Which type to use
- Whether to add a new type
- How to extend existing types

Review the existing code in `test-types.ts` or consult with the team.
