<!-- @format -->

# Lambda Constructs

This directory contains reusable AWS CDK constructs for creating and managing AWS Lambda functions with TypeScript support, automatic bundling, and best practices built-in.

## Overview

The `LambdaFunctionConstruct` provides a standardised way to create Lambda functions with:

- TypeScript support via esbuild bundling
- Automatic CloudWatch Log Group creation
- IAM role with least privilege principles
- CDK Nag compliance out of the box
- Consistent naming and tagging conventions

## Design Choices

### 1. NodejsFunction with esbuild

The construct uses `NodejsFunction` from `aws-cdk-lib/aws-lambda-nodejs` which provides:

- Native TypeScript compilation without manual build steps
- Tree-shaking to reduce bundle size
- Source map support for debugging
- Automatic handling of node_modules

**Rationale:** Using esbuild for bundling provides fast compilation times and optimised output without requiring a separate build pipeline.

### 2. Externalised AWS SDK

By default, the construct externalises `@aws-sdk/*` modules:

```typescript
externalModules: ["@aws-sdk/*"];
```

**Rationale:** Lambda runtime includes AWS SDK v3, so bundling it increases deployment size unnecessarily. The SDK is excluded from the bundle and uses the runtime-provided version.

### 3. Automatic Log Group Management

The construct creates a dedicated CloudWatch Log Group before the Lambda function:

```typescript
this.logGroup = new logs.LogGroup(this, "LogGroup", {
  logGroupName: `/aws/lambda/${props.envName}-${props.functionName}`,
  retention: props.logRetention || logs.RetentionDays.ONE_WEEK,
  removalPolicy: cdk.RemovalPolicy.DESTROY,
});
```

**Rationale:**

- Explicit log retention control (avoids indefinite retention)
- Log group is created before function deployment
- Clean deletion when stack is destroyed (non-production default)

### 4. CDK Nag Compliance

The construct includes suppressions for common CDK Nag rules:

| Rule | Reason |
| ---- | ------ |
| `AwsSolutions-IAM4` | AWSLambdaBasicExecutionRole is the standard pattern for CloudWatch Logs access |
| `AwsSolutions-L1` | Node.js 20.x is the latest LTS runtime |

## Construct Reference

### LambdaFunctionConstruct

Creates a Lambda function with TypeScript support and automatic bundling.

```typescript
import { LambdaFunctionConstruct } from "../constructs/compute/lambda";

const myFunction = new LambdaFunctionConstruct(this, "MyFunction", {
  envName: "production",
  functionName: "process-orders",
  entry: "lambda/handlers/process-orders.ts",

  // Optional configuration
  handler: "handler",
  timeout: cdk.Duration.minutes(5),
  memorySize: 512,
  logRetention: logs.RetentionDays.TWO_WEEKS,

  // Environment variables
  environment: {
    TABLE_NAME: ordersTable.tableName,
    QUEUE_URL: orderQueue.queueUrl,
  },

  // IAM permissions
  initialPolicy: [
    new iam.PolicyStatement({
      actions: ["dynamodb:PutItem", "dynamodb:GetItem"],
      resources: [ordersTable.tableArn],
    }),
    new iam.PolicyStatement({
      actions: ["sqs:SendMessage"],
      resources: [orderQueue.queueArn],
    }),
  ],

  // Bundling options
  bundling: {
    minify: true,
    sourceMap: true,
    externalModules: ["@aws-sdk/*"],
  },
});
```

### Properties

| Property | Type | Required | Default | Description |
| -------- | ---- | -------- | ------- | ----------- |
| `envName` | `string` | Yes | - | Environment name for naming and tagging |
| `functionName` | `string` | Yes | - | Function name (combined with envName) |
| `entry` | `string` | Yes | - | Path to TypeScript handler file |
| `handler` | `string` | No | `'handler'` | Export name of handler function |
| `environment` | `Record<string, string>` | No | - | Environment variables |
| `timeout` | `Duration` | No | `5 minutes` | Function timeout |
| `memorySize` | `number` | No | `256` | Memory allocation in MB |
| `logRetention` | `RetentionDays` | No | `ONE_WEEK` | CloudWatch Logs retention |
| `initialPolicy` | `PolicyStatement[]` | No | - | IAM policy statements |
| `runtime` | `Runtime` | No | `NODEJS_20_X` | Lambda runtime |
| `bundling` | `object` | No | See below | esbuild bundling options |

### Bundling Options

| Option | Type | Default | Description |
| ------ | ---- | ------- | ----------- |
| `minify` | `boolean` | `true` | Minify output code |
| `sourceMap` | `boolean` | `true` | Generate source maps |
| `externalModules` | `string[]` | `['@aws-sdk/*']` | Modules to exclude from bundle |

### Exposed Properties

| Property | Type | Description |
| -------- | ---- | ----------- |
| `function` | `NodejsFunction` | The Lambda function |
| `role` | `iam.Role` | The function's execution role |
| `logGroup` | `logs.LogGroup` | The CloudWatch Log Group |

### CloudFormation Outputs

The construct automatically creates the following exports:

| Export Name | Value |
| ----------- | ----- |
| `{envName}-{functionName}-arn` | Function ARN |
| `{envName}-{functionName}-name` | Function name |

## Usage Patterns

### Pattern 1: Simple API Handler

```typescript
const apiHandler = new LambdaFunctionConstruct(this, "ApiHandler", {
  envName: "production",
  functionName: "api-handler",
  entry: "lambda/handlers/api.ts",
  memorySize: 256,
  timeout: cdk.Duration.seconds(30),
});

// Grant permissions to other resources
myTable.grantReadWriteData(apiHandler.function);
myBucket.grantRead(apiHandler.function);

// Add as API Gateway target
api.addRoutes({
  path: "/items",
  methods: [HttpMethod.GET, HttpMethod.POST],
  integration: new HttpLambdaIntegration("ApiIntegration", apiHandler.function),
});
```

### Pattern 2: Event-Driven Function with Custom Policies

```typescript
const eventProcessor = new LambdaFunctionConstruct(this, "EventProcessor", {
  envName: "production",
  functionName: "event-processor",
  entry: "lambda/handlers/event-processor.ts",
  memorySize: 1024,
  timeout: cdk.Duration.minutes(15),
  environment: {
    DESTINATION_BUCKET: destinationBucket.bucketName,
    SNS_TOPIC_ARN: notificationTopic.topicArn,
  },
  initialPolicy: [
    new iam.PolicyStatement({
      actions: ["s3:GetObject", "s3:PutObject"],
      resources: [
        `${sourceBucket.bucketArn}/*`,
        `${destinationBucket.bucketArn}/*`,
      ],
    }),
    new iam.PolicyStatement({
      actions: ["sns:Publish"],
      resources: [notificationTopic.topicArn],
    }),
  ],
});

// Add S3 event trigger
sourceBucket.addEventNotification(
  s3.EventType.OBJECT_CREATED,
  new s3n.LambdaDestination(eventProcessor.function)
);
```

### Pattern 3: Scheduled Function (CloudWatch Events)

```typescript
const scheduledTask = new LambdaFunctionConstruct(this, "ScheduledTask", {
  envName: "production",
  functionName: "daily-cleanup",
  entry: "lambda/handlers/cleanup.ts",
  memorySize: 512,
  timeout: cdk.Duration.minutes(10),
  logRetention: logs.RetentionDays.ONE_MONTH,
  environment: {
    RETENTION_DAYS: "30",
  },
  initialPolicy: [
    new iam.PolicyStatement({
      actions: ["dynamodb:Scan", "dynamodb:DeleteItem"],
      resources: [cleanupTable.tableArn],
    }),
  ],
});

// Schedule to run daily at midnight UTC
new events.Rule(this, "DailyCleanupRule", {
  schedule: events.Schedule.cron({ minute: "0", hour: "0" }),
  targets: [new targets.LambdaFunction(scheduledTask.function)],
});
```

### Pattern 4: VPC-Connected Function

For functions that need to access VPC resources (RDS, ElastiCache, etc.), use the underlying `NodejsFunction` properties:

```typescript
const vpcFunction = new LambdaFunctionConstruct(this, "VpcFunction", {
  envName: "production",
  functionName: "vpc-processor",
  entry: "lambda/handlers/vpc-processor.ts",
  memorySize: 512,
  environment: {
    DB_HOST: rdsInstance.instanceEndpoint.hostname,
    DB_SECRET_ARN: dbSecret.secretArn,
  },
  initialPolicy: [
    new iam.PolicyStatement({
      actions: ["secretsmanager:GetSecretValue"],
      resources: [dbSecret.secretArn],
    }),
  ],
});

// Note: For VPC configuration, modify the underlying function
// or extend the construct to support VPC props
```

### Pattern 5: Cross-Account Function

```typescript
const crossAccountFunction = new LambdaFunctionConstruct(
  this,
  "CrossAccountFunction",
  {
    envName: "production",
    functionName: "cross-account-handler",
    entry: "lambda/handlers/cross-account.ts",
    environment: {
      TARGET_ACCOUNT_ID: "123456789012",
      TARGET_ROLE_ARN: "arn:aws:iam::123456789012:role/TargetRole",
    },
    initialPolicy: [
      new iam.PolicyStatement({
        actions: ["sts:AssumeRole"],
        resources: ["arn:aws:iam::123456789012:role/TargetRole"],
      }),
    ],
  }
);
```

## Handler File Structure

The construct expects TypeScript handler files with the following structure:

```typescript
// lambda/handlers/my-handler.ts

import { Handler } from "aws-lambda";

interface MyEvent {
  // Event type definition
}

interface MyResult {
  // Result type definition
}

export const handler: Handler<MyEvent, MyResult> = async (event, context) => {
  console.log("Event:", JSON.stringify(event, null, 2));

  // Your logic here

  return {
    statusCode: 200,
    body: JSON.stringify({ message: "Success" }),
  };
};
```

## Best Practices

### 1. Environment-Specific Configuration

```typescript
const isProduction = props.envName === "production";

const myFunction = new LambdaFunctionConstruct(this, "MyFunction", {
  envName: props.envName,
  functionName: "my-function",
  entry: "lambda/handlers/my-handler.ts",

  // Production settings
  memorySize: isProduction ? 1024 : 256,
  timeout: isProduction ? cdk.Duration.minutes(5) : cdk.Duration.seconds(30),
  logRetention: isProduction
    ? logs.RetentionDays.THREE_MONTHS
    : logs.RetentionDays.ONE_WEEK,
});
```

### 2. Least Privilege IAM Policies

Always specify the minimum required permissions:

```typescript
// Good: Specific resource ARNs
initialPolicy: [
  new iam.PolicyStatement({
    actions: ["dynamodb:GetItem", "dynamodb:PutItem"],
    resources: [myTable.tableArn],
  }),
];

// Avoid: Wildcard resources
initialPolicy: [
  new iam.PolicyStatement({
    actions: ["dynamodb:*"],
    resources: ["*"], // Too permissive
  }),
];
```

### 3. Use Environment Variables for Configuration

```typescript
environment: {
  TABLE_NAME: myTable.tableName,  // Dynamic value
  API_ENDPOINT: api.url,          // Dynamic value
  LOG_LEVEL: 'INFO',              // Configuration
  ENVIRONMENT: props.envName,     // Context
},
```

### 4. Memory and Timeout Tuning

| Use Case | Memory | Timeout |
| -------- | ------ | ------- |
| API handlers | 256-512 MB | 10-30 seconds |
| Data processing | 512-1024 MB | 5-15 minutes |
| Simple tasks | 128-256 MB | 5-30 seconds |
| Heavy computation | 1024-3008 MB | 5-15 minutes |

## Troubleshooting

### Function Deployment Fails with esbuild Error

**Cause:** Missing or incompatible dependencies in package.json.

**Solution:** Ensure esbuild is installed:

```bash
npm install --save-dev esbuild
```

### Function Cannot Find Module at Runtime

**Cause:** Module is in externalModules but not available in Lambda runtime.

**Solution:** Remove the module from externalModules or bundle it:

```typescript
bundling: {
  externalModules: []; // Bundle all dependencies
}
```

### CloudWatch Logs Not Appearing

**Cause:** Log group naming conflict or IAM permissions.

**Solution:**

1. Check if log group already exists with different retention
2. Verify function has `logs:CreateLogStream` and `logs:PutLogEvents` permissions

### Cold Start Performance

**Recommendations:**

1. Increase memory (also increases CPU allocation)
2. Use Provisioned Concurrency for critical functions
3. Minimise dependencies and bundle size
4. Use minification (`minify: true`)

## Related Constructs

- `LambdaLayerConstruct` - Shared code layers (not yet implemented)
- `ApiGatewayConstruct` - API Gateway integration
- `EventBridgeConstruct` - Event-driven triggers

## Additional Resources

- [AWS Lambda Best Practices](https://docs.aws.amazon.com/lambda/latest/dg/best-practices.html)
- [NodejsFunction CDK Docs](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_lambda_nodejs-readme.html)
- [Lambda Power Tuning](https://github.com/alexcasalboni/aws-lambda-power-tuning)
