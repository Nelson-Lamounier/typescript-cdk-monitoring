<!-- @format -->

# Configuration Constructs

This directory contains reusable AWS CDK constructs for managing configuration and outputs in your infrastructure. These constructs provide standardised ways to store and expose infrastructure resource identifiers.

## Overview

| Construct | Purpose | Use Case |
| --------- | ------- | -------- |
| `SsmParametersConstruct` | SSM Parameter Store | Runtime discovery, cross-account access |
| `StackOutputsConstruct` | CloudFormation Outputs | Cross-stack references, console visibility |

## Architecture

```
+---------------------------+     +---------------------------+
|  SsmParametersConstruct   |     |  StackOutputsConstruct    |
+---------------------------+     +---------------------------+
         |                                   |
         v                                   v
  SSM Parameter Store               CloudFormation Exports
         |                                   |
         +--- {prefix}/vpc/vpc-id            +--- {env}-vpc-id
         +--- {prefix}/ecr/repo-uri          +--- {env}-ecr-repository-uri
         +--- {prefix}/ecs/cluster-name      +--- {env}-ecs-cluster-name
         +--- {prefix}/config/custom         +--- {env}-custom-output
```

## When to Use Which

| Feature | SSM Parameters | CloudFormation Outputs |
| ------- | -------------- | ---------------------- |
| **Update without stack update** | Yes | No |
| **Cross-stack references** | Manual lookup | Fn::ImportValue |
| **Cross-account access** | Easy with IAM | Requires sharing |
| **Runtime discovery** | AWS SDK | AWS CLI/SDK |
| **Console visibility** | Parameter Store | CloudFormation |
| **Circular dependencies** | No issues | Can cause issues |

**Recommendation:** Use SSM Parameters for dynamic discovery and CloudFormation Outputs for static cross-stack references.

## SsmParametersConstruct

Creates SSM Parameter Store parameters for infrastructure resources.

### Features

- Flexible parameter creation (VPC, ECR, ECS, Logs, Custom)
- **Consistent path prefix**: All parameters use the same prefix
- Support for SecureString parameters with warnings for KMS
- Support for StringList parameter type
- Automatic tagging for resource management
- Helper methods for IAM grants
- Optional CloudFormation exports
- Production safety warnings

### Path Structure

```
/{pathPrefix}/{category}/{parameter-name}

Examples:
/monitoring/production/vpc/vpc-id
/monitoring/production/ecr/repository-uri
/monitoring/production/ecs/cluster-name
/monitoring/production/logs/application/log-group-name
/monitoring/production/config/api-url
```

**Path Prefix Priority:**
1. Custom `pathPrefix` if provided
2. `/{projectName}/{envName}` if projectName provided
3. `/{envName}` otherwise

### Usage

```typescript
import { SsmParametersConstruct } from "../constructs/config";

const params = new SsmParametersConstruct(this, "Parameters", {
  envName: "production",
  projectName: "monitoring",

  // VPC parameters
  vpc: {
    vpc: myVpc,
    includeSubnets: true,
    includeAvailabilityZones: true,
    useStringList: true, // Use StringList for subnet IDs
    tier: ssm.ParameterTier.STANDARD, // Custom tier for VPC params
  },

  // ECR parameters
  ecr: {
    repository: myRepository,
    description: "Custom ECR description",
  },

  // ECS parameters
  ecs: {
    cluster: myCluster,
    service: myService,
    tier: ssm.ParameterTier.ADVANCED,
  },

  // Log group parameters
  logGroups: [
    { name: "application", logGroup: appLogGroup },
    { name: "access", logGroup: accessLogGroup },
  ],

  // Custom parameters
  customParameters: [
    { name: "api-url", value: "https://api.example.com" },
    { name: "feature-flags", value: ["enabled", "beta"], type: "StringList" },
    {
      name: "api-key",
      value: "secret-value",
      secure: true, // Creates SecureString
    },
  ],

  // Optional: KMS key for SecureString (warning if not provided)
  encryptionKey: myKmsKey,

  // Optional: Also create CloudFormation exports
  createCfnExports: true,
});

// Get parameter by full path (no collision risk)
const vpcInfo = params.getParameterByPath("/monitoring/production/vpc/vpc-id");

// Get parameter by category and key
const vpcInfo2 = params.getParameterByKey("vpc", "vpc-id");

// Get all parameters in a category
const vpcParams = params.getParametersByCategory("vpc");

// Grant read access to a Lambda function
params.grantRead(myLambdaFunction);

// Get ARN pattern for IAM policies
const arnPattern = params.getParameterArnPattern();
```

### Custom Path Prefix

```typescript
// Override default path structure
const params = new SsmParametersConstruct(this, "Parameters", {
  envName: "production",
  pathPrefix: "/my-company/apps/monitoring", // Custom prefix

  vpc: { vpc: myVpc },
});

// Creates: /my-company/apps/monitoring/vpc/vpc-id
```

### Parameters Created

| Configuration | Parameters Created |
| ------------- | ------------------ |
| `vpc` | `vpc-id`, `vpc-cidr`, `private-subnet-ids`, `public-subnet-ids`, `availability-zones` |
| `ecr` | `repository-uri`, `repository-arn`, `repository-name` |
| `ecs` | `cluster-name`, `cluster-arn`, `service-name` |
| `logGroups` | `{name}/log-group-name`, `{name}/log-group-arn` |
| `customParameters` | Custom key-value pairs |

### Properties

| Property | Type | Required | Default | Description |
| -------- | ---- | -------- | ------- | ----------- |
| `envName` | `string` | Yes | - | Environment name |
| `projectName` | `string` | No | - | Project name for path prefix |
| `pathPrefix` | `string` | No | Auto | Custom path prefix for ALL params |
| `vpc` | `VpcParameterConfig` | No | - | VPC parameters |
| `ecr` | `EcrParameterConfig` | No | - | ECR parameters |
| `ecs` | `EcsParameterConfig` | No | - | ECS parameters |
| `logGroups` | `LogGroupParameterConfig[]` | No | - | Log group parameters |
| `customParameters` | `CustomParameterConfig[]` | No | - | Custom parameters |
| `encryptionKey` | `kms.IKey` | No | - | KMS key for SecureString |
| `customTags` | `Record<string, string>` | No | - | Additional tags |
| `createCfnExports` | `boolean` | No | false | Also create CFN exports |
| `suppressWarnings` | `boolean` | No | false | Suppress production warnings |

### VpcParameterConfig

| Property | Type | Default | Description |
| -------- | ---- | ------- | ----------- |
| `vpc` | `ec2.IVpc` | Required | VPC to create parameters for |
| `includeSubnets` | `boolean` | true | Include subnet ID parameters |
| `includeAvailabilityZones` | `boolean` | false | Include AZ parameters |
| `useStringList` | `boolean` | false | Use StringList type for arrays |
| `tier` | `ParameterTier` | STANDARD | Parameter tier for all VPC params |
| `description` | `string` | Auto | Custom description for VPC ID |

### CustomParameterConfig

| Property | Type | Default | Description |
| -------- | ---- | ------- | ----------- |
| `name` | `string` | Required | Parameter name (without prefix) |
| `value` | `string \| string[]` | Required | Parameter value(s) |
| `description` | `string` | Auto | Parameter description |
| `tier` | `ParameterTier` | STANDARD | Parameter tier |
| `secure` | `boolean` | false | Create SecureString |
| `type` | `'String' \| 'StringList'` | Auto | Parameter type |

### Exposed Properties

| Property | Type | Description |
| -------- | ---- | ----------- |
| `parametersByPath` | `Map<string, ParameterInfo>` | Parameters by full path |
| `parametersByKey` | `Map<string, ParameterInfo>` | Parameters by category/key |
| `pathPrefix` | `string` | The resolved path prefix |

### Methods

| Method | Parameters | Returns | Description |
| ------ | ---------- | ------- | ----------- |
| `getParameterByPath` | `path: string` | `ParameterInfo \| undefined` | Get by full path |
| `getParameterByKey` | `category, key` | `ParameterInfo \| undefined` | Get by category/key |
| `getParametersByCategory` | `category: string` | `ParameterInfo[]` | Get all in category |
| `getAllPaths` | - | `string[]` | Get all parameter paths |
| `grantRead` | `grantee: IGrantable` | `void` | Grant read access |
| `getParameterArnPattern` | - | `string` | ARN pattern for IAM |

### Production Warnings

The construct automatically adds warnings for:

1. **SecureString without customer KMS key** - Using AWS-managed encryption
2. **Large parameter count** - Approaching region limit (10,000)
3. **Potentially sensitive data** - Parameters with names containing 'password', 'secret', 'key', etc. not marked as secure

Suppress warnings (not recommended):

```typescript
new SsmParametersConstruct(this, "Params", {
  envName: "development",
  suppressWarnings: true, // Suppress all warnings
  // ...
});
```

## StackOutputsConstruct

Creates CloudFormation Outputs for infrastructure resources.

### Features

- Standard CloudFormation exports
- Cross-stack references via Fn::ImportValue
- Console visibility
- Consistent export naming

### Usage

```typescript
import { StackOutputsConstruct } from "../constructs/config";

const outputs = new StackOutputsConstruct(this, "Outputs", {
  envName: "production",
  projectName: "monitoring",

  // VPC outputs
  vpc: myVpc,

  // ECR outputs
  repository: myRepository,

  // ECS outputs
  cluster: myCluster,
  service: myService,

  // Custom outputs
  customOutputs: [
    {
      name: "ApiEndpoint",
      value: api.url,
      description: "API Gateway endpoint URL",
    },
  ],
});

// Get a specific output
const vpcIdOutput = outputs.getOutput("VpcId");
```

### Properties

| Property | Type | Required | Default | Description |
| -------- | ---- | -------- | ------- | ----------- |
| `envName` | `string` | Yes | - | Environment name |
| `projectName` | `string` | No | - | Project name for exports |
| `vpc` | `ec2.IVpc` | No | - | VPC for outputs |
| `repository` | `ecr.IRepository` | No | - | ECR repository |
| `cluster` | `ecs.ICluster` | No | - | ECS cluster |
| `service` | `ecs.IService` | No | - | ECS service |
| `customOutputs` | `array` | No | - | Custom outputs |

## Usage Patterns

### Pattern 1: Both SSM Parameters and CloudFormation Exports

```typescript
const params = new SsmParametersConstruct(this, "Parameters", {
  envName: "production",
  projectName: "monitoring",
  vpc: { vpc: myVpc },
  createCfnExports: true, // Enable both!
});
```

### Pattern 2: Cross-Stack References

Using CloudFormation Outputs:

```typescript
// Stack A: Create outputs
new StackOutputsConstruct(this, "Outputs", {
  envName: "production",
  vpc: myVpc,
});

// Stack B: Import values
const vpcId = cdk.Fn.importValue("production-vpc-id");
```

Using SSM Parameters:

```typescript
// Stack A: Create parameters
new SsmParametersConstruct(this, "Parameters", {
  envName: "production",
  projectName: "monitoring",
  vpc: { vpc: myVpc },
});

// Stack B: Lookup at runtime
const vpcId = ssm.StringParameter.valueFromLookup(
  this,
  "/monitoring/production/vpc/vpc-id"
);
```

### Pattern 3: Lambda Function Discovery

```typescript
// Infrastructure stack
const params = new SsmParametersConstruct(this, "Parameters", {
  envName: "production",
  projectName: "monitoring",
  ecs: { cluster: myCluster, service: myService },
});

// Lambda stack
const discoveryFunction = new LambdaFunctionConstruct(this, "DiscoveryFn", {
  envName: "production",
  functionName: "service-discovery",
  entry: "lambda/handlers/discovery.ts",
  environment: {
    SSM_PATH_PREFIX: params.pathPrefix,
  },
  initialPolicy: [
    new iam.PolicyStatement({
      actions: ["ssm:GetParametersByPath"],
      resources: [params.getParameterArnPattern()],
    }),
  ],
});
```

### Pattern 4: StringList for Subnet IDs

```typescript
const params = new SsmParametersConstruct(this, "Parameters", {
  envName: "production",
  vpc: {
    vpc: myVpc,
    useStringList: true, // Store as StringList instead of comma-separated
  },
});

// Retrieval in code
// Returns: ["subnet-abc123", "subnet-def456"]
const subnets = await ssm.getParameter({
  Name: "/production/vpc/private-subnet-ids",
}).promise();
// subnets.Parameter.Value contains comma-separated values
```

## Validation

The construct validates:

1. **Environment name** - Must be non-empty string
2. **Parameter names** - Must follow SSM naming rules:
   - Start with `/`
   - Only contain: a-z, A-Z, 0-9, `.`, `-`, `_`, `/`
   - No double slashes (`//`)
   - No trailing slash
   - Max 1024 characters

3. **Parameter values** - Length limits:
   - Standard tier: 4,096 characters
   - Advanced tier: 8,192 characters

4. **Custom parameter names** - Must not start with `/`

## Best Practices

### 1. Use Consistent Path Prefix

```typescript
// Good: Consistent prefix across stacks
new SsmParametersConstruct(this, "Params", {
  envName: "production",
  projectName: "monitoring", // Always include project name
  // ...
});
```

### 2. Use StringList for Arrays

```typescript
// Good: Native array support
vpc: {
  vpc: myVpc,
  useStringList: true,
}
```

### 3. Mark Sensitive Data as Secure

```typescript
// Good: Explicit secure flag
customParameters: [
  {
    name: "database-password",
    value: dbPassword,
    secure: true, // Encrypted
  },
],
```

### 4. Use Category-Based Lookup

```typescript
// Good: Clear category/key lookup
const vpcId = params.getParameterByKey("vpc", "vpc-id");

// Also good: Full path for precision
const vpcId = params.getParameterByPath("/monitoring/prod/vpc/vpc-id");
```

## Troubleshooting

### Parameter Not Found

**Cause:** Using wrong lookup method or key format.

**Solution:**

```typescript
// List all paths to find the correct one
console.log(params.getAllPaths());

// Use getParameterByKey with category and key
const param = params.getParameterByKey("vpc", "vpc-id");

// Or use full path
const param = params.getParameterByPath("/monitoring/production/vpc/vpc-id");
```

### SecureString KMS Warning

**Cause:** CDK StringParameter doesn't directly support customer-managed KMS keys.

**Solution:**

```typescript
// Option 1: Accept AWS-managed key (adequate for most cases)
customParameters: [
  { name: "api-key", value: "secret", secure: true },
],

// Option 2: Use AWS CLI for customer KMS key
// aws ssm put-parameter --name "/path/to/param" --value "secret" \
//   --type SecureString --key-id alias/my-key
```

### Parameter Name Invalid

**Cause:** Name doesn't follow SSM naming rules.

**Solution:**

```typescript
// Bad: Spaces, special characters
{ name: "my parameter!", value: "test" }

// Good: Only allowed characters
{ name: "my-parameter", value: "test" }
{ name: "nested/parameter/name", value: "test" }
```

## Related Constructs

- `SsmStateManagerConstruct` - SSM State Manager for instance configuration
- `LambdaFunctionConstruct` - Lambda functions that can discover parameters

## Additional Resources

- [AWS Systems Manager Parameter Store](https://docs.aws.amazon.com/systems-manager/latest/userguide/systems-manager-parameter-store.html)
- [CloudFormation Outputs](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/outputs-section-structure.html)
- [Parameter Store Naming Conventions](https://docs.aws.amazon.com/systems-manager/latest/userguide/sysman-paramstore-su-create.html)
