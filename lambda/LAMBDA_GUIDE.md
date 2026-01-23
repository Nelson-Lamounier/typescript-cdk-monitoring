# Lambda Handlers Guide

This guide documents the structure, patterns, and best practices for creating and maintaining Lambda function handlers in this repository.

## Directory Structure

```
lambda/
├── LAMBDA_GUIDE.md              # This file
├── handlers/                    # Lambda function handlers
│   ├── index.ts                 # Barrel export for all handlers
│   ├── api/                     # API Gateway handlers
│   │   ├── index.ts             # Barrel export for API handlers
│   │   └── articles/            # Domain-specific handlers
│   │       ├── index.ts         # Barrel export
│   │       ├── get-article.ts
│   │       ├── list-articles.ts
│   │       └── list-articles-by-tag.ts
│   └── custom-resources/        # CloudFormation Custom Resource handlers
│       ├── index.ts             # Barrel export
│       ├── vpc-peering-create-accept.ts
│       ├── vpc-peering-routes.ts
│       └── efs-initialisation.ts
└── shared/                      # Shared utilities across handlers
    ├── index.ts                 # Barrel export
    ├── api-response.ts          # API Gateway response utilities
    └── cfn-response.ts          # CloudFormation response utilities
```

## Handler Categories

### 1. API Gateway Handlers (`handlers/api/`)

Lambda functions triggered by API Gateway events. These handlers:
- Process HTTP requests from API Gateway
- Interact with backend services (DynamoDB, S3, etc.)
- Return structured HTTP responses

**Location**: `lambda/handlers/api/{domain}/{operation}.ts`

**Naming Convention**: `{verb}-{resource}.ts`
- `get-article.ts` - GET single article
- `list-articles.ts` - GET list of articles
- `create-article.ts` - POST new article

### 2. Custom Resource Handlers (`handlers/custom-resources/`)

Lambda functions used as CloudFormation Custom Resources. These handlers:
- Respond to CloudFormation lifecycle events (Create, Update, Delete)
- Perform operations not natively supported by CloudFormation
- Must send responses back to CloudFormation

**Location**: `lambda/handlers/custom-resources/{resource-operation}.ts`

**Naming Convention**: `{resource}-{operation}.ts`
- `vpc-peering-create-accept.ts` - Create and accept VPC peering
- `efs-initialisation.ts` - Initialize EFS configuration

## Handler Anatomy

### API Gateway Handler

```typescript
/** @format */

import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from "aws-lambda";
import { createCachedResponse, createNotFoundResponse } from "../../shared/api-response";

// ========================================================================
// ENVIRONMENT VARIABLES
// ========================================================================

const TABLE_NAME = process.env.TABLE_NAME || "";
const REGION = process.env.AWS_REGION || "eu-west-1";

// ========================================================================
// AWS SDK CLIENTS
// ========================================================================

// Initialize clients outside handler for connection reuse
const dynamoClient = new DynamoDBClient({ region: REGION });

// ========================================================================
// TYPES
// ========================================================================

interface MyResource {
  id: string;
  name: string;
  // ...
}

// ========================================================================
// HELPER FUNCTIONS
// ========================================================================

function validateEnvironment(): string | null {
  if (!TABLE_NAME) {
    return "TABLE_NAME environment variable is not set";
  }
  return null;
}

// ========================================================================
// LAMBDA HANDLER
// ========================================================================

/**
 * Handler description - what it does
 *
 * @method GET /resources/{id}
 *
 * @param event - API Gateway event
 * @param context - Lambda context
 */
export async function handler(
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> {
  console.log("Event:", JSON.stringify(event, null, 2));

  // Validate environment
  const envError = validateEnvironment();
  if (envError) {
    return createInternalServerErrorResponse(envError);
  }

  try {
    // Business logic here
    const result = await fetchData();
    return createCachedResponse(result);
  } catch (error) {
    console.error("Error:", error);
    return createInternalServerErrorResponse(error);
  }
}
```

### CloudFormation Custom Resource Handler

```typescript
/** @format */

import {
  CloudFormationCustomResourceEvent,
  CloudFormationCustomResourceResponse,
  Context,
} from "aws-lambda";
import { sendCfnResponse, createSuccessResponse, createFailureResponse } from "../../shared/cfn-response";

// ========================================================================
// LAMBDA HANDLER
// ========================================================================

export const handler = async (
  event: CloudFormationCustomResourceEvent,
  context: Context
): Promise<CloudFormationCustomResourceResponse> => {
  console.log("Custom Resource event:", JSON.stringify(event, null, 2));

  try {
    const requestType = event.RequestType;
    let response: CloudFormationCustomResourceResponse;

    switch (requestType) {
      case "Create":
      case "Update":
        response = await handleCreateOrUpdate(event, context);
        break;
      case "Delete":
        response = await handleDelete(event, context);
        break;
      default:
        throw new Error(`Unknown request type: ${requestType}`);
    }

    await sendCfnResponse(event, context, response);
    return response;
  } catch (error) {
    console.error("Error:", error);
    const physicalResourceId =
      "PhysicalResourceId" in event
        ? event.PhysicalResourceId
        : "resource-failed";

    const response = createFailureResponse(
      event,
      physicalResourceId,
      error instanceof Error ? error.message : String(error)
    );
    await sendCfnResponse(event, context, response);
    return response;
  }
};

async function handleCreateOrUpdate(
  event: CloudFormationCustomResourceEvent,
  _context: Context
): Promise<CloudFormationCustomResourceResponse> {
  const props = event.ResourceProperties;
  
  // Perform operation
  const result = await createResource(props);
  
  return createSuccessResponse(event, result.id, { ResourceId: result.id });
}

async function handleDelete(
  event: CloudFormationCustomResourceEvent,
  _context: Context
): Promise<CloudFormationCustomResourceResponse> {
  const physicalResourceId =
    "PhysicalResourceId" in event
      ? event.PhysicalResourceId
      : "resource-cleanup";

  // Cleanup logic (if needed)
  
  return createSuccessResponse(event, physicalResourceId);
}
```

## Shared Utilities

### API Response Utilities (`shared/api-response.ts`)

Provides consistent API Gateway response formatting:

```typescript
import { createResponse, createCachedResponse, createNotFoundResponse } from "./shared";

// Success responses
return createResponse(200, { data });
return createCachedResponse({ data });  // With Cache-Control headers

// Error responses
return createBadRequestResponse("Invalid input", "Field X is required");
return createNotFoundResponse("Article", slug);
return createInternalServerErrorResponse(error);
```

### CloudFormation Response Utilities (`shared/cfn-response.ts`)

Handles CloudFormation Custom Resource responses:

```typescript
import { sendCfnResponse, createSuccessResponse, createFailureResponse } from "./shared";

// Send success
const response = createSuccessResponse(event, physicalId, { Key: "value" });
await sendCfnResponse(event, context, response);

// Send failure
const response = createFailureResponse(event, physicalId, "Error message");
await sendCfnResponse(event, context, response);
```

## CDK Integration

Lambda handlers should be deployed using CDK constructs. The handlers themselves do not contain CDK code - they are pure Lambda functions.

### Lambda Function Construct

Create Lambda functions in `lib/constructs/compute/lambda/`:

```typescript
// lib/constructs/compute/lambda/api-lambda-construct.ts

import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";

export class ApiLambdaConstruct extends Construct {
  public readonly handler: lambda.Function;

  constructor(scope: Construct, id: string, props: ApiLambdaProps) {
    super(scope, id);

    this.handler = new nodejs.NodejsFunction(this, "Handler", {
      entry: "lambda/handlers/api/articles/get-article.ts",
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_20_X,
      environment: {
        TABLE_NAME: props.table.tableName,
      },
    });

    props.table.grantReadData(this.handler);
  }
}
```

### Custom Resource Construct

For Custom Resources, use `AwsCustomResource` or `Provider`:

```typescript
// lib/constructs/custom-resources/vpc-peering-construct.ts

import { Construct } from "constructs";
import * as cr from "aws-cdk-lib/custom-resources";
import * as lambda from "aws-cdk-lib/aws-lambda";

export class VpcPeeringConstruct extends Construct {
  constructor(scope: Construct, id: string, props: VpcPeeringProps) {
    super(scope, id);

    const handler = new nodejs.NodejsFunction(this, "Handler", {
      entry: "lambda/handlers/custom-resources/vpc-peering-create-accept.ts",
      handler: "handler",
      timeout: Duration.minutes(5),
    });

    const provider = new cr.Provider(this, "Provider", {
      onEventHandler: handler,
    });

    new CustomResource(this, "Resource", {
      serviceToken: provider.serviceToken,
      properties: {
        VpcId: props.vpcId,
        PeerVpcId: props.peerVpcId,
        // ...
      },
    });
  }
}
```

## Best Practices

### 1. Handler Organization

- **Single Responsibility**: Each handler does one thing
- **Domain Grouping**: Group related handlers by domain (articles, users, etc.)
- **Clear Naming**: Handler names reflect the operation

### 2. Error Handling

- **Consistent Responses**: Use shared utilities for response formatting
- **Detailed Logging**: Log events, errors, and important operations
- **Graceful Failures**: Handle all expected error cases

### 3. Environment Variables

- **Validation**: Validate required env vars at startup
- **Defaults**: Provide sensible defaults where appropriate
- **Documentation**: Document required env vars in handler comments

### 4. AWS SDK Best Practices

- **Client Reuse**: Initialize SDK clients outside handler
- **Region Handling**: Use environment region with fallback
- **Error Types**: Handle specific SDK error types

### 5. Custom Resources

- **Idempotency**: Operations should be idempotent
- **Physical Resource ID**: Return consistent physical IDs
- **Delete Handling**: Handle missing resources gracefully on delete
- **Timeouts**: Set appropriate timeouts (max 15 min)

### 6. Testing

- **Unit Tests**: Test handler logic with mocked AWS services
- **Integration Tests**: Test with actual AWS services in test environment
- **Event Mocking**: Use sample events for local testing

## Quick Reference

### Handler Types

| Type | Location | Event Type | Response Type |
|------|----------|------------|---------------|
| API Gateway | `handlers/api/` | `APIGatewayProxyEvent` | `APIGatewayProxyResult` |
| Custom Resource | `handlers/custom-resources/` | `CloudFormationCustomResourceEvent` | `CloudFormationCustomResourceResponse` |

### Shared Utilities

| Utility | Purpose |
|---------|---------|
| `createResponse()` | Create API Gateway response |
| `createCachedResponse()` | Response with cache headers |
| `createNotFoundResponse()` | 404 response |
| `createInternalServerErrorResponse()` | 500 response |
| `sendCfnResponse()` | Send CFN response |
| `createSuccessResponse()` | CFN success response |
| `createFailureResponse()` | CFN failure response |

### Adding a New Handler

1. Create handler file in appropriate directory
2. Use shared utilities for responses
3. Add to barrel export (`index.ts`)
4. Create CDK construct for deployment
5. Add unit tests

## Checklist

When creating a new Lambda handler:

- [ ] Handler placed in correct directory (`api/` or `custom-resources/`)
- [ ] Uses shared response utilities
- [ ] Environment variables validated
- [ ] AWS SDK clients initialized outside handler
- [ ] Comprehensive error handling
- [ ] Logging for debugging
- [ ] JSDoc comments for handler function
- [ ] Added to barrel export (`index.ts`)
- [ ] CDK construct created for deployment
- [ ] Unit tests written
