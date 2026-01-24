# WebappApiStack Tests

Comprehensive test suite for `WebappApiStack` validating API Gateway, Lambda functions, IAM permissions, integrations, and CloudFormation outputs.

## Design Approach

This test suite follows a **modular, concern-based** structure where tests are split into focused files based on AWS resource types and configuration areas. Each test file validates a specific aspect of the API stack infrastructure.

**Key Principles:**
- **Separation of Concerns**: Each test file focuses on one infrastructure component
- **No Code Duplication**: Shared fixtures and helpers centralized in dedicated files
- **No Conditionals**: All filtering and logic moved to `beforeAll` blocks
- **Guard Assertions**: Every `forEach` loop has assertions to handle empty arrays
- **Reusable Validators**: Common validation patterns extracted to helper functions

## What is Tested?

### 1. API Gateway Configuration (`api-gateway.test.ts`)
**Validates:**
- REST API creation with regional endpoints
- CloudWatch logging (INFO level, metrics enabled)
- Log retention policies (7 days dev, 30 days prod)
- CORS configuration (headers, methods, max-age)
- Throttling limits (100/200 dev, 1000/2000 prod)
- API deployment and staging
- X-Ray tracing enablement

**Why Critical:**
- API Gateway is the entry point for all client requests
- Incorrect CORS breaks frontend integration
- Insufficient throttling causes service overload
- Missing logging prevents debugging production issues

### 2. Lambda Functions (`lambda-functions.test.ts`)
**Validates:**
- Function creation (Get Article, List Articles, List by Tag)
- Runtime configuration (Node.js, 30s timeout, 256MB memory)
- Environment variables (table name, bucket name, GSI names)
- LOG_LEVEL configuration (DEBUG dev, INFO prod)
- CloudWatch log groups with retention policies
- Consistent handler naming (`index.handler`)

**Why Critical:**
- Lambda functions execute business logic
- Incorrect env vars break database/S3 connectivity
- Missing timeout causes hanging requests
- Inadequate memory triggers OOM errors

### 3. IAM Permissions (`iam-permissions.test.ts`)
**Validates:**
- IAM role creation (one per Lambda function)
- DynamoDB read permissions (Query, Scan, GetItem, DescribeTable)
- S3 read permissions (GetObject, List, GetBucket)
- Lambda trust policies (sts:AssumeRole)
- CloudWatch Logs permissions
- **No write permissions** (read-only API)

**Why Critical:**
- Over-permissive IAM = security vulnerability
- Missing permissions = runtime failures
- Write permissions on read-only API = data corruption risk
- Incorrect trust policy prevents Lambda execution

### 4. API Gateway Integrations (`integrations.test.ts`)
**Validates:**
- REST API resources (`/articles`, `/{slug}`, `/tag/{tag}`)
- HTTP methods (GET for data, OPTIONS for CORS)
- Lambda proxy integrations (AWS_PROXY type)
- Lambda invoke permissions (apigateway.amazonaws.com)
- Request validation (parameters and body)
- Integration responses (CORS headers, status codes)
- Path parameter naming (`{slug}`, `{tag}`)

**Why Critical:**
- Incorrect resource paths break routing
- Missing OPTIONS breaks CORS preflight
- Wrong integration type causes request/response issues
- Missing invoke permissions = 403 errors

### 5. Stack Outputs & Tagging (`stack-outputs.test.ts`)
**Validates:**
- CloudFormation outputs (API URL, API ID, Lambda ARNs)
- Export naming conventions (kebab-case, env prefixes)
- Pipeline environment handling (no exports to prevent circular dependencies)
- Resource tagging (environment, project metadata)
- Output value references (Fn::GetAtt for ARNs)
- Stack metadata (CDK version, description)

**Why Critical:**
- Exports enable cross-stack references
- Incorrect export names break dependent stacks
- Pipeline exports create circular dependencies
- Missing tags prevent cost tracking

## Testing Approach

### How Functionality is Validated

**Template-Based Assertions:**
```typescript
// 1. Create CDK app and stack
const app = createTestApp();
const stack = createTestApiStack(app);

// 2. Synthesize to CloudFormation template
const template = Template.fromStack(stack);

// 3. Assert resource properties
template.hasResourceProperties("AWS::Lambda::Function", {
  Runtime: Match.stringLikeRegexp("nodejs"),
  Timeout: 30,
  MemorySize: 256,
});

// 4. Assert resource counts
template.resourceCountIs("AWS::Lambda::Function", 3);
```

### What Assertions are Used

**CDK Assertions Library:**
- `template.hasResourceProperties()` - Validates resource configuration
- `template.resourceCountIs()` - Validates resource counts
- `template.hasOutput()` - Validates CloudFormation outputs
- `template.findResources()` - Extracts resources for iteration
- `Match.objectLike()` - Partial object matching
- `Match.stringLikeRegexp()` - Pattern matching
- `Match.arrayWith()` - Array contains validation

**Guard Assertions:**
```typescript
beforeAll(() => {
  // Pre-compute data
  functions = template.findResources("AWS::Lambda::Function");
});

test("should validate all functions", () => {
  // Guard assertion - ensures test passes even with empty array
  expect(functions.length).toBe(3);
  
  // Safe to iterate
  functions.forEach(fn => {
    expect(fn.Properties.Runtime).toMatch(/^nodejs/);
  });
});
```

### Dependencies Between Tests

**Independent Test Files:**
- Each test file creates its own CDK app and stack
- No shared state between files
- Tests can run in parallel
- No execution order dependencies

**Shared Fixtures:**
- `api-stack-fixtures.ts` - Mock resources cached per app instance
- `webapp-test-helpers.ts` - Validation functions used across tests
- `stack-test-utils.ts` - Base test utilities (createTestApp, etc.)

## Test Files & Folders

### Directory Structure
```
tests/unit/stacks/webapp/
├── fixtures/
│   └── api-stack-fixtures.ts        # Mock resources and test data
├── utils/
│   └── webapp-test-helpers.ts       # Validation helpers
└── api-stack/
    ├── README.md                     # This file
    ├── api-gateway.test.ts           # API Gateway tests
    ├── lambda-functions.test.ts     # Lambda function tests
    ├── iam-permissions.test.ts      # IAM role & policy tests
    ├── integrations.test.ts         # API integrations tests
    └── stack-outputs.test.ts        # CloudFormation outputs tests
```

### Shared Test Configuration

**`api-stack-fixtures.ts`** (281 lines)
- **Purpose**: Centralized mock resources and test fixtures
- **Provides**:
  - `API_TEST_CONSTANTS` - Test constants (function names, resource counts, etc.)
  - `createMockTable()` - Mock DynamoDB table creation
  - `createMockBucket()` - Mock S3 bucket creation
  - `ApiStackTestFixtures` - Cached fixtures class
  - `createTestApiStack()` - Stack creation helper

**Key Feature: Caching**
```typescript
export class ApiStackTestFixtures {
  private _mockTable: dynamodb.ITable | null = null;
  
  getMockTable(): dynamodb.ITable {
    if (!this._mockTable) {
      this._mockTable = createMockTable(this.mockStack, TABLE_NAME);
    }
    return this._mockTable; // Cached for performance
  }
}
```

**`webapp-test-helpers.ts`** (210 lines)
- **Purpose**: Reusable validation functions
- **Provides**:
  - `validateLambdaEnvironment()` - Lambda env vars validation
  - `validateDynamoDbReadPermissions()` - DynamoDB IAM validation
  - `validateS3ReadPermissions()` - S3 IAM validation
  - `validateLambdaProxyIntegration()` - API Gateway integration validation
  - `validateCorsPreflightIntegration()` - CORS validation
  - `getLogRetentionDays()` - Environment-based retention

**Benefits:**
- **Performance**: Mock resources created once per app instance
- **Consistency**: Same test data across all tests
- **Maintainability**: Update constants in one place
- **Type Safety**: Full TypeScript support with IntelliSense

## Common Patterns

### 1. Pre-computation in beforeAll
```typescript
describe("Lambda Functions", () => {
  let template: Template;
  let functions: Array<{ name: string; runtime: string }>;

  beforeAll(() => {
    const app = createTestApp();
    const stack = createTestApiStack(app);
    template = Template.fromStack(stack);

    // Pre-compute function data (NO conditionals in tests)
    const fns = template.findResources("AWS::Lambda::Function");
    functions = Object.values(fns).map(fn => ({
      name: fn.Properties.FunctionName,
      runtime: fn.Properties.Runtime,
    }));
  });

  test("should use Node.js runtime", () => {
    // Guard assertion
    expect(functions.length).toBe(3);
    
    // Safe iteration with pre-computed data
    functions.forEach(fn => {
      expect(fn.runtime).toMatch(/^nodejs/);
    });
  });
});
```

### 2. Environment-Specific Testing
```typescript
describe("Log Retention", () => {
  let devTemplate: Template;
  let prodTemplate: Template;

  beforeAll(() => {
    // Development stack
    const devApp = createTestApp();
    const devStack = createTestApiStack(devApp);
    devTemplate = Template.fromStack(devStack);

    // Production stack
    const prodApp = createTestApp();
    const prodStack = createTestApiStack(
      prodApp,
      API_TEST_CONSTANTS.STACK_IDS.API_PROD
    );
    prodTemplate = Template.fromStack(prodStack);
  });

  test("should use 7 days retention in dev", () => {
    devTemplate.hasResourceProperties("AWS::Logs::LogGroup", {
      RetentionInDays: 7,
    });
  });

  test("should use 30 days retention in prod", () => {
    prodTemplate.hasResourceProperties("AWS::Logs::LogGroup", {
      RetentionInDays: 30,
    });
  });
});
```

### 3. Shared Validators
```typescript
// Instead of repeating validation logic
test("should configure Lambda environment", () => {
  const expectedEnv = validateLambdaEnvironment(
    tableName,
    bucketName,
    envName,
    isProduction
  );

  template.hasResourceProperties("AWS::Lambda::Function", {
    Environment: expectedEnv,
  });
});
```

### 4. Guard Assertions for forEach
```typescript
test("should validate IAM policies", () => {
  // Guard assertion - prevents false positives
  expect(policies.length).toBeGreaterThan(0);
  
  // Safe to iterate
  policies.forEach(policy => {
    expect(policy.Effect).toBe("Allow");
  });
});
```

## How to Add New Tests

### 1. Choose Appropriate Test File

- **API Gateway config?** → `api-gateway.test.ts`
- **Lambda function?** → `lambda-functions.test.ts`
- **IAM permissions?** → `iam-permissions.test.ts`
- **API routing/integration?** → `integrations.test.ts`
- **CloudFormation outputs?** → `stack-outputs.test.ts`
- **New concern?** → Create new test file

### 2. Update Test Constants

**Add to `api-stack-fixtures.ts`:**
```typescript
export const API_TEST_CONSTANTS = {
  // ... existing constants
  NEW_RESOURCE_COUNTS: {
    MY_NEW_RESOURCE: 5,
  },
};
```

### 3. Create Helper Function (if needed)

**Add to `webapp-test-helpers.ts`:**
```typescript
export function validateMyNewResource(config: Config) {
  return Match.objectLike({
    Property1: config.value1,
    Property2: config.value2,
  });
}
```

### 4. Write Test Following Pattern

```typescript
describe("My New Feature", () => {
  let template: Template;
  let resources: Array<{ id: string; config: Config }>;

  beforeAll(() => {
    // 1. Create stack
    const app = createTestApp();
    const stack = createTestApiStack(app);
    template = Template.fromStack(stack);

    // 2. Pre-compute data (NO conditionals)
    const rawResources = template.findResources("AWS::MyResource");
    resources = Object.entries(rawResources).map(([id, resource]) => ({
      id,
      config: resource.Properties.Config,
    }));
  });

  test("should create expected number of resources", () => {
    template.resourceCountIs(
      "AWS::MyResource",
      API_TEST_CONSTANTS.NEW_RESOURCE_COUNTS.MY_NEW_RESOURCE
    );
  });

  test("should configure resources correctly", () => {
    // Guard assertion
    expect(resources.length).toBe(5);

    // Validate each resource
    resources.forEach(resource => {
      expect(resource.config).toHaveProperty("RequiredProperty");
    });
  });
});
```

### 5. Add ESLint Disable Comments

For tests using CDK assertion methods that throw on failure:
```typescript
// eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
test("should validate resource", () => {
  template.hasResourceProperties("AWS::MyResource", {
    Property: "value",
  });
});
```

## Security Considerations & Vulnerabilities

### Known Security Patterns

**1. Read-Only IAM Permissions** ✅
- API Lambda functions have **only read permissions**
- No PutItem, UpdateItem, or DeleteItem on DynamoDB
- No PutObject or DeleteObject on S3
- **Why**: Prevents data corruption via public API

**2. Lambda Service Principal Trust Policy** ✅
- Only `lambda.amazonaws.com` can assume roles
- **Why**: Prevents unauthorized role assumption

**3. API Gateway Invoke Permissions** ✅
- Only `apigateway.amazonaws.com` can invoke Lambda
- **Why**: Prevents direct Lambda invocation bypassing API Gateway

### Potential Vulnerabilities

**1. Missing WAF Integration** ⚠️
- **Risk**: No protection against SQL injection, XSS, DDoS
- **Mitigation**: Enable WAF in production (configured via stack props)
- **Test Coverage**: Validates WAF can be enabled via props

**2. Wildcard CORS Origins in Dev** ⚠️
- **Risk**: Development uses `["*"]` allowing any origin
- **Mitigation**: Production requires explicit origin list
- **Test Coverage**: Validates custom CORS origins work

**3. Public API Endpoints** ⚠️
- **Risk**: No authentication on GET endpoints
- **Mitigation**: Read-only operations, rate limiting via throttling
- **Test Coverage**: Validates throttling limits configured

**4. CloudWatch Logs Exposure** ⚠️
- **Risk**: Logs may contain sensitive request data
- **Mitigation**: Log retention limits, IAM-controlled access
- **Test Coverage**: Validates retention policies

**5. Lambda Cold Starts** ⚠️
- **Risk**: Initial requests may timeout (30s limit)
- **Mitigation**: Appropriate timeout configuration, warming strategies
- **Test Coverage**: Validates timeout set to 30s

### Compliance Testing Gaps

**Not Currently Tested:**
- API Gateway request throttling enforcement (runtime behavior)
- Lambda function cold start performance
- CORS preflight cache duration effectiveness
- CloudWatch Log encryption at rest
- S3 bucket encryption for assets
- DynamoDB encryption at rest

**Reason**: These are runtime behaviors or AWS-managed features, not infrastructure configuration. Would require integration tests or AWS Config rules.

## Why This Testing Approach?

### Benefits

**1. Catch Configuration Errors Early**
- Invalid IAM permissions detected before deployment
- Missing environment variables caught in CI
- CORS misconfiguration identified immediately

**2. Prevent Regressions**
- Infrastructure changes validated automatically
- Breaking changes to API structure detected
- Environment-specific configs (dev vs prod) verified

**3. Documentation Through Tests**
- Tests document expected infrastructure
- New team members understand stack structure
- Configuration decisions captured in assertions

**4. Fast Feedback Loop**
- Tests run in <10 seconds (no AWS calls)
- Local validation before deployment
- CI pipeline catches issues pre-production

**5. Cost Savings**
- No AWS resources provisioned for testing
- Mock resources eliminate AWS charges
- Failed deployments prevented

### Limitations

**What Tests Don't Cover:**
- **Runtime Behavior**: Actual Lambda execution, API response times
- **Integration**: Real DynamoDB/S3 connectivity
- **Performance**: Cold start times, throughput limits
- **Security**: Actual WAF rules, penetration testing
- **End-to-End**: Client → API Gateway → Lambda → DynamoDB flow

**For These, Use:**
- Integration tests (deploy to dev environment)
- Load testing (Artillery, k6)
- Security scanning (Prowler, AWS Security Hub)
- E2E tests (Playwright, Cypress)

## Running Tests

```bash
# All API stack tests
yarn test api-stack

# Specific test file
yarn test api-gateway.test.ts
yarn test lambda-functions.test.ts
yarn test iam-permissions.test.ts
yarn test integrations.test.ts
yarn test stack-outputs.test.ts

# With coverage
yarn test:coverage api-stack

# Watch mode
yarn test --watch api-stack
```

## Related Documentation

- [Unit Test Standards](../../../../../prompts/tests/unit-test.txt) - Testing patterns and rules
- [Monitoring EFS Stack Tests](../../monitoring/monitoring-efs-stack.test.ts) - Reference implementation
- [Application Security Tests](../../security/application-security.test.ts) - Security testing patterns
- [WebappApiStack Implementation](../../../../../lib/stacks/webapp/api-stack.ts) - Stack source code
- [API Gateway Construct](../../../../../lib/constructs/networking/api/api-gateway-construct.ts) - API Gateway implementation

## Troubleshooting

### Common Issues

**1. "Cannot find module" errors**
```bash
# Reinstall dependencies
rm -rf node_modules yarn.lock
yarn install
```

**2. "Template synthesis failed"**
- Check mock resources are properly created
- Verify fixtures are cached correctly
- Ensure stack props are valid

**3. "Assertion failed" on resource count**
- Verify `API_TEST_CONSTANTS` matches actual stack
- Check if stack configuration changed
- Update resource counts if intentional

**4. ESLint warnings about "no assertions"**
- Add `// eslint-disable-next-line jest/expect-expect` comment
- CDK assertion methods throw on failure (implicit assertion)

**5. TypeScript errors on Jest globals**
- Verify `"types": ["node", "jest"]` in tsconfig.json
- Check `/// <reference types="jest" />` at top of test file

## Summary

This test suite provides comprehensive coverage of WebappApiStack infrastructure configuration through:

- ✅ **301 lines** of API Gateway tests
- ✅ **382 lines** of Lambda function tests  
- ✅ **386 lines** of IAM permission tests
- ✅ **418 lines** of integration tests
- ✅ **352 lines** of output/tagging tests

**Total: 1,839 lines** validating critical infrastructure before deployment, preventing misconfigurations, security vulnerabilities, and integration failures. 🚀
