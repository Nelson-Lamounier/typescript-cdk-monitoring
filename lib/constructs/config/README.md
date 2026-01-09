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
         +--- /vpc/{env}/vpc-id              +--- {env}-vpc-id
         +--- /ecr/{env}/repo-uri            +--- {env}-ecr-repository-uri
         +--- /ecs/{env}/cluster-name        +--- {env}-ecs-cluster-name
         +--- /config/{env}/custom           +--- {env}-custom-output
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
- Consistent naming convention: `/{service}/{envName}/{parameter}`
- Support for SecureString parameters with KMS encryption
- Automatic tagging for resource management
- Helper methods for IAM grants

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
  },

  // ECR parameters
  ecr: {
    repository: myRepository,
  },

  // ECS parameters
  ecs: {
    cluster: myCluster,
    service: myService,
  },

  // Log group parameters
  logGroups: [
    { name: "application", logGroup: appLogGroup },
    { name: "access", logGroup: accessLogGroup },
  ],

  // Custom parameters
  customParameters: [
    { name: "api-url", value: "https://api.example.com" },
    { name: "feature-flag", value: "enabled" },
    {
      name: "api-key",
      value: "secret-value",
      secure: true, // Creates SecureString
    },
  ],

  // Optional: KMS key for SecureString parameters
  encryptionKey: myKmsKey,
});

// Grant read access to a Lambda function
params.grantRead(myLambdaFunction);

// Get a specific parameter
const vpcIdParam = params.getParameter("vpc-id");

// Get ARN pattern for IAM policies
const arnPattern = params.getParameterArnPattern();
```

### Parameters Created

| Configuration | Parameters Created |
| ------------- | ------------------ |
| `vpc` | `vpc-id`, `vpc-cidr`, `private-subnet-ids`, `public-subnet-ids`, `availability-zones` |
| `ecr` | `repository-uri`, `repository-arn`, `repository-name` |
| `ecs` | `cluster-name`, `cluster-arn`, `service-name` |
| `logGroups` | `{name}/log-group-name`, `{name}/log-group-arn` |
| `customParameters` | Custom key-value pairs |

### Parameter Naming Convention

```
/{service}/{envName}/{parameter-name}

Examples:
/vpc/production/vpc-id
/ecr/production/repository-uri
/ecs/production/cluster-name
/logs/production/application/log-group-name
/config/production/api-url
```

### Properties

| Property | Type | Required | Default | Description |
| -------- | ---- | -------- | ------- | ----------- |
| `envName` | `string` | Yes | - | Environment name |
| `projectName` | `string` | No | - | Project name for path prefix |
| `pathPrefix` | `string` | No | Auto | Custom path prefix |
| `vpc` | `VpcParameterConfig` | No | - | VPC parameters |
| `ecr` | `EcrParameterConfig` | No | - | ECR parameters |
| `ecs` | `EcsParameterConfig` | No | - | ECS parameters |
| `logGroups` | `LogGroupParameterConfig[]` | No | - | Log group parameters |
| `customParameters` | `CustomParameterConfig[]` | No | - | Custom parameters |
| `encryptionKey` | `kms.IKey` | No | - | KMS key for SecureString |
| `customTags` | `Record<string, string>` | No | - | Additional tags |

### Exposed Properties

| Property | Type | Description |
| -------- | ---- | ----------- |
| `parameters` | `Map<string, StringParameter>` | All created parameters |

### Methods

| Method | Parameters | Returns | Description |
| ------ | ---------- | ------- | ----------- |
| `getParameter` | `key: string` | `StringParameter \| undefined` | Get parameter by key |
| `getParameterNames` | - | `string[]` | Get all parameter names |
| `grantRead` | `grantee: IGrantable` | `void` | Grant read access |
| `getParameterArnPattern` | - | `string` | ARN pattern for IAM |

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

### Outputs Created

| Configuration | Outputs Created | Export Name Pattern |
| ------------- | --------------- | ------------------- |
| `vpc` | VpcId, VpcCidr | `{env}-{project}-vpc-id` |
| `repository` | RepositoryUri, RepositoryArn, RepositoryName | `{env}-{project}-ecr-*` |
| `cluster` | EcsClusterName, EcsClusterArn | `{env}-{project}-ecs-cluster-*` |
| `service` | EcsServiceName | `{env}-{project}-ecs-service-name` |
| `customOutputs` | Custom outputs | `{env}-{project}-{name}` |

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

### Exposed Properties

| Property | Type | Description |
| -------- | ---- | ----------- |
| `outputs` | `Map<string, CfnOutput>` | All created outputs |

### Methods

| Method | Parameters | Returns | Description |
| ------ | ---------- | ------- | ----------- |
| `getOutput` | `id: string` | `CfnOutput \| undefined` | Get output by ID |
| `getOutputIds` | - | `string[]` | Get all output IDs |

## Usage Patterns

### Pattern 1: Both SSM Parameters and CloudFormation Outputs

For maximum flexibility, use both:

```typescript
// SSM Parameters for runtime discovery
const params = new SsmParametersConstruct(this, "Parameters", {
  envName: "production",
  vpc: { vpc: myVpc },
  ecs: { cluster: myCluster },
});

// CloudFormation Outputs for cross-stack references
const outputs = new StackOutputsConstruct(this, "Outputs", {
  envName: "production",
  vpc: myVpc,
  cluster: myCluster,
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
  vpc: { vpc: myVpc },
});

// Stack B: Lookup at runtime
const vpcId = ssm.StringParameter.valueFromLookup(
  this,
  "/vpc/production/vpc-id"
);
```

### Pattern 3: Lambda Function Discovery

```typescript
// Infrastructure stack
const params = new SsmParametersConstruct(this, "Parameters", {
  envName: "production",
  ecs: { cluster: myCluster, service: myService },
});

// Lambda stack
const discoveryFunction = new LambdaFunctionConstruct(this, "DiscoveryFn", {
  envName: "production",
  functionName: "service-discovery",
  entry: "lambda/handlers/discovery.ts",
  environment: {
    SSM_PATH_PREFIX: "/ecs/production",
  },
  initialPolicy: [
    new iam.PolicyStatement({
      actions: ["ssm:GetParametersByPath"],
      resources: [params.getParameterArnPattern()],
    }),
  ],
});
```

### Pattern 4: Pipeline Integration

```typescript
// Create parameters for pipeline to discover
const params = new SsmParametersConstruct(this, "Parameters", {
  envName: "production",
  ecr: { repository: myRepository },
  ecs: { cluster: myCluster, service: myService },
  customParameters: [
    { name: "deploy-target", value: "ecs" },
  ],
});

// Pipeline can query:
// - /ecr/production/repository-uri -> Where to push images
// - /ecs/production/cluster-name -> Where to deploy
// - /ecs/production/service-name -> Which service to update
// - /config/production/deploy-target -> Deployment strategy
```

## Best Practices

### 1. Use Consistent Naming

```typescript
// Good: Consistent pattern
const params = new SsmParametersConstruct(this, "Parameters", {
  envName: props.envName,
  projectName: props.projectName,
  // ...
});

// Avoid: Inconsistent naming
customParameters: [
  { name: "MyApiUrl" }, // PascalCase
  { name: "my-api-url" }, // kebab-case
  { name: "my_api_url" }, // snake_case
];
```

### 2. Group Related Parameters

```typescript
// Good: Logical grouping
customParameters: [
  { name: "database/host", value: dbHost },
  { name: "database/port", value: dbPort },
  { name: "database/name", value: dbName },
];
```

### 3. Use SecureString for Sensitive Data

```typescript
customParameters: [
  {
    name: "api-key",
    value: apiKey,
    secure: true, // Encrypted at rest
  },
],
encryptionKey: myKmsKey,
```

### 4. Grant Minimal Permissions

```typescript
// Good: Grant to specific function
params.grantRead(myFunction);

// Avoid: Broad permissions
params.grantRead(new iam.AccountPrincipal(account));
```

## Troubleshooting

### Parameter Not Found

**Cause:** Parameter path doesn't match expected pattern.

**Solution:**

```typescript
// Check the actual parameter name
console.log(params.getParameterNames());

// Or use getParameter with the correct key
const param = params.getParameter("vpc-id"); // Not "/vpc/production/vpc-id"
```

### Export Name Conflict

**Cause:** CloudFormation export names must be unique per region/account.

**Solution:**

```typescript
// Include project name to avoid conflicts
new StackOutputsConstruct(this, "Outputs", {
  envName: "production",
  projectName: "monitoring", // Creates: production-monitoring-vpc-id
  // ...
});
```

### Cross-Account Access Denied

**Cause:** SSM parameters require explicit cross-account permissions.

**Solution:**

```typescript
// In the source account, grant access
params.grantRead(
  new iam.AccountPrincipal("123456789012") // Target account
);

// In the target account, assume a role with access
```

## Related Constructs

- `SsmStateManagerConstruct` - SSM State Manager for instance configuration
- `LambdaFunctionConstruct` - Lambda functions that can discover parameters

## Additional Resources

- [AWS Systems Manager Parameter Store](https://docs.aws.amazon.com/systems-manager/latest/userguide/systems-manager-parameter-store.html)
- [CloudFormation Outputs](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/outputs-section-structure.html)
- [Cross-Stack References](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/walkthrough-crossstackref.html)
