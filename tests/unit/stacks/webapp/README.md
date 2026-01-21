<!-- @format -->

# Webapp Stack Unit Tests

This document describes the unit tests created for the webapp DynamoDB and ECR stacks.

## Test Files Created

1. **`tests/unit/stacks/webapp/ecr-stack.test.ts`** - WebappEcrStack tests
2. **`tests/unit/stacks/webapp/dynamodb-stack.test.ts`** - WebappDynamoDbStack tests

## Test Coverage

### WebappEcrStack Tests (ecr-stack.test.ts)

**Total Test Cases: 20+**

#### Repository Creation (4 tests)
- ✅ Creates ECR repository with default configuration
- ✅ Uses custom repository name when provided
- ✅ Enables image scanning on push
- ✅ Configures lifecycle policies

#### Environment-Specific Configuration (6 tests)
- ✅ Uses MUTABLE tags in development
- ✅ Uses IMMUTABLE tags in production
- ✅ Keeps 10 images in development
- ✅ Keeps 20 images in production
- ✅ Uses DESTROY removal policy in development
- ✅ Uses RETAIN removal policy in production

#### Lifecycle Policies (3 tests)
- ✅ Configures lifecycle policy with correct priority
- ✅ Applies lifecycle policy to all tags
- ✅ Accepts custom lifecycle rules

#### Cross-Account Access (2 tests)
- ✅ Grants pipeline account access when provided
- ✅ Does not add repository policy when pipeline account not provided

#### Tagging (1 test)
- ✅ Applies standard tags to repository

#### Stack Outputs (3 tests)
- ✅ Creates all required stack outputs (URI, ARN, Name)
- ✅ Exports outputs in non-pipeline environments
- ✅ Does not export outputs in pipeline environment

#### Public Interface (1 test)
- ✅ Exposes repository property

---

### WebappDynamoDbStack Tests (dynamodb-stack.test.ts)

**Total Test Cases: 25+**

#### DynamoDB Table Creation (4 tests)
- ✅ Creates DynamoDB articles table with correct configuration
- ✅ Defines all required attribute definitions (pk, sk, gsi1pk, gsi1sk, gsi2pk, gsi2sk)
- ✅ Uses on-demand billing mode
- ✅ Enables DynamoDB Streams with NEW_AND_OLD_IMAGES

#### Global Secondary Indexes (2 tests)
- ✅ Creates GSI1 for querying by status and date
- ✅ Creates GSI2 for querying by tag

#### Environment-Specific Configuration (6 tests)
- ✅ Disables point-in-time recovery in development
- ✅ Enables point-in-time recovery in production
- ✅ Disables deletion protection in development
- ✅ Enables deletion protection in production
- ✅ Uses DESTROY removal policy in development
- ✅ Uses RETAIN removal policy in production

#### S3 Assets Bucket (5 tests)
- ✅ Creates S3 bucket for article assets
- ✅ Enables versioning on assets bucket
- ✅ Blocks all public access
- ✅ Configures CORS for Next.js uploads
- ✅ Configures lifecycle rules for old versions

#### Tagging (2 tests)
- ✅ Applies standard tags to DynamoDB table
- ✅ Applies custom tags (Purpose, DataClassification, Application)

#### Stack Outputs (4 tests)
- ✅ Creates all required DynamoDB outputs (table name, ARN, GSI names)
- ✅ Creates all required S3 outputs (bucket name, ARN, domain)
- ✅ Exports outputs in non-pipeline environments
- ✅ Outputs stream ARN when streams are enabled

#### Public Interface (2 tests)
- ✅ Exposes articlesTable property
- ✅ Exposes assetsBucket property

---

## Running the Tests

### Run All Webapp Tests

```bash
# From repository root
yarn test tests/unit/stacks/webapp/

# Or with npm
npm test tests/unit/stacks/webapp/
```

### Run Specific Test File

```bash
# ECR stack tests only
yarn test tests/unit/stacks/webapp/ecr-stack.test.ts

# DynamoDB stack tests only
yarn test tests/unit/stacks/webapp/dynamodb-stack.test.ts
```

### Run with Coverage

```bash
yarn test --coverage tests/unit/stacks/webapp/
```

### Run in Watch Mode

```bash
yarn test --watch tests/unit/stacks/webapp/
```

---

## Test Structure

Both test files follow the same consistent structure:

```typescript
describe("StackName", () => {
  let app: cdk.App;

  beforeEach(() => {
    app = createTestApp();
  });

  describe("Feature Category", () => {
    test("should do something specific", () => {
      // Arrange
      const envConfig = createTestEnvConfig("development");

      // Act
      const stack = new Stack(app, "TestStack", { ...props });
      const template = Template.fromStack(stack);

      // Assert
      template.hasResourceProperties("AWS::Service::Resource", {
        Property: "ExpectedValue",
      });
    });
  });
});
```

## Test Patterns Used

### 1. Arrange-Act-Assert (AAA) Pattern

All tests follow the AAA pattern for clarity:

```typescript
test("should create repository with defaults", () => {
  // Arrange - Set up test data
  const envConfig = createTestEnvConfig("development");

  // Act - Execute the code under test
  const stack = new WebappEcrStack(app, "TestStack", { envConfig });

  // Assert - Verify the results
  template.hasResourceProperties("AWS::ECR::Repository", {
    RepositoryName: "webapp-webapp",
  });
});
```

### 2. Test Fixtures and Helpers

```typescript
// Helper function to create test environment config
function createTestEnvConfig(
  envName: string,
  isProduction: boolean = false
): EnvironmentConfig {
  return {
    envName,
    account: TEST_CONFIG.account,
    region: TEST_CONFIG.region,
    vpcCidr: "10.0.0.0/16",
    natGateways: 1,
    isProduction,
  };
}
```

### 3. Constants for Magic Values

```typescript
const TEST_CONSTANTS = {
  PROJECT_NAMES: {
    WEBAPP: "webapp",
  },
  REPOSITORY_NAMES: {
    DEFAULT: "webapp-webapp",
  },
  LIFECYCLE: {
    DEV_MAX_IMAGES: 10,
    PROD_MAX_IMAGES: 20,
  },
} as const;
```

### 4. Template Assertions

```typescript
// Resource count
template.resourceCountIs("AWS::DynamoDB::Table", 1);

// Resource properties
template.hasResourceProperties("AWS::DynamoDB::Table", {
  TableName: "webapp-articles-development",
  BillingMode: "PAY_PER_REQUEST",
});

// Nested properties with Match
template.hasResourceProperties("AWS::DynamoDB::Table", {
  GlobalSecondaryIndexes: Match.arrayWith([
    Match.objectLike({
      IndexName: "gsi1-status-date",
    }),
  ]),
});

// Stack outputs
template.hasOutput("TableName", {
  Description: "DynamoDB table name",
  Export: {
    Name: "development-webapp-articles-table-name",
  },
});

// Removal policy
const resources = template.findResources("AWS::DynamoDB::Table");
expect(resources[0].DeletionPolicy).toBe("Retain");
```

---

## Test Categories

### Unit Tests

- Test individual stack behavior
- Mock/stub external dependencies
- Fast execution
- No AWS API calls

### Integration Tests

Future: Create integration tests that:
- Deploy actual stacks to test accounts
- Verify resource creation
- Test cross-stack dependencies
- Clean up after tests

---

## Troubleshooting

### Issue: Jest Module Not Found

If you see `Cannot find module '@jest/test-sequencer'`:

```bash
# Remove node_modules and reinstall
rm -rf node_modules
yarn install

# Or with npm
npm install
```

### Issue: Tests Timeout

If tests timeout:

```bash
# Increase timeout
jest --testTimeout=30000 tests/unit/stacks/webapp/
```

### Issue: CDK Construct Name Conflicts

Tests use `createTestApp()` which ensures each test gets a fresh CDK app instance to avoid construct name conflicts.

---

## Coverage Goals

| Category | Target | Current |
|----------|--------|---------|
| Statements | 90% | TBD |
| Branches | 85% | TBD |
| Functions | 90% | TBD |
| Lines | 90% | TBD |

Generate coverage report:

```bash
yarn test --coverage tests/unit/stacks/webapp/
open coverage/lcov-report/index.html
```

---

## Adding New Tests

### Template for New Stack Test

```typescript
/** @format */
/// <reference types="jest" />

import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { YourStack } from "../../../../lib/stacks/your-stack";
import { TEST_CONFIG, BASE_TEST_CONSTANTS, createTestApp } from "../../utils/stack-test-utils";

describe("YourStack", () => {
  let app: cdk.App;

  beforeEach(() => {
    app = createTestApp();
  });

  describe("Resource Creation", () => {
    test("should create resource with defaults", () => {
      // Arrange
      const stack = new YourStack(app, "TestStack", { ...props });
      const template = Template.fromStack(stack);

      // Assert
      template.resourceCountIs("AWS::Service::Resource", 1);
    });
  });
});
```

---

## Related Documentation

- [CDK Testing Documentation](https://docs.aws.amazon.com/cdk/v2/guide/testing.html)
- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [CDK Assertions API](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.assertions-readme.html)
- [Project Test Guidelines](../../README.md)

---

*Last Updated: January 2026*
