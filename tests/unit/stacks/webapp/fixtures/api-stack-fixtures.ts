/** @format */

/**
 * API Stack Test Fixtures
 *
 * Provides reusable test fixtures for WebappApiStack tests:
 * - Mock DynamoDB tables
 * - Mock S3 buckets
 * - Stack creation helpers
 * - Environment configurations
 *
 * Pattern: Follows EfsTestFixtures pattern with caching for performance
 *
 * @see tests/unit/stacks/monitoring/monitoring-efs-stack.test.ts
 */

import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as s3 from "aws-cdk-lib/aws-s3";

import { WebappApiStack, WebappApiStackProps } from "../../../../../lib/stacks/webapp/api-stack";
import { EnvironmentConfig } from "../../../../../config/environments";
import {
  TEST_CONFIG,
  BASE_TEST_CONSTANTS,
  createTestEnv,
} from "../../../utils/stack-test-utils";

// ============================================================================
// STACK-SPECIFIC CONSTANTS
// ============================================================================

/**
 * Test constants specific to API stack testing
 * Extends base constants with API-specific values
 */
export const API_TEST_CONSTANTS = {
  ...BASE_TEST_CONSTANTS,
  PROJECT_NAMES: {
    WEBAPP: "webapp",
    CUSTOM: "custom-project",
  },
  TABLE_NAMES: {
    ARTICLES: "test-articles-table",
  },
  BUCKET_NAMES: {
    ASSETS: "test-assets-bucket",
  },
  FUNCTION_NAMES: {
    GET_ARTICLE: "webapp-get-article",
    LIST_ARTICLES: "webapp-list-articles",
    LIST_BY_TAG: "webapp-list-articles-by-tag",
  },
  API_NAMES: {
    ARTICLES: "articles-api",
    FULL_DEV: "development-webapp-articles-api",
    FULL_PROD: "production-webapp-articles-api",
  },
  RESOURCE_COUNTS: {
    API: 1,
    LAMBDA: 3,
    LOG_GROUP: 4, // 3 Lambda log groups + 1 API Gateway log group
    IAM_ROLE: 3, // 1 role per Lambda function
    IAM_POLICY: 6, // 2 policies per Lambda (DynamoDB + S3)
  },
  STACK_IDS: {
    ...BASE_TEST_CONSTANTS.STACK_IDS,
    API: "TestApiStack",
    API_DEV: "DevApiStack",
    API_PROD: "ProdApiStack",
  },
  OUTPUT_KEYS: {
    API_URL: "ApiUrl",
    API_ID: "ApiId",
    API_ENDPOINT: "ApiEndpoint",
    GET_ARTICLE_ARN: "GetArticleFunctionArn",
    LIST_ARTICLES_ARN: "ListArticlesFunctionArn",
    LIST_BY_TAG_ARN: "ListArticlesByTagFunctionArn",
  },
  EXPORT_NAMES: {
    DEV_API_URL: "development-webapp-api-url",
    DEV_API_ID: "development-webapp-api-id",
    DEV_API_ENDPOINT: "development-webapp-api-endpoint",
  },
  HTTP_METHODS: {
    GET: "GET",
    POST: "POST",
    PUT: "PUT",
    DELETE: "DELETE",
    OPTIONS: "OPTIONS",
  },
  CORS: {
    HEADERS: ["Content-Type", "Authorization", "X-Api-Key"],
    METHODS: ["GET", "OPTIONS"],
    MAX_AGE: 3600,
  },
  THROTTLE: {
    DEV_RATE: 100,
    DEV_BURST: 200,
    PROD_RATE: 1000,
    PROD_BURST: 2000,
  },
  TIMEOUT: {
    SECONDS: 30,
  },
  MEMORY: {
    MB: 256,
  },
} as const;

// ============================================================================
// MOCK RESOURCE CREATION
// ============================================================================

/**
 * Create mock DynamoDB table for testing
 *
 * Creates an ITable interface without provisioning actual infrastructure.
 * Uses fromTableAttributes to reference a table that doesn't exist.
 *
 * @param stack - CDK stack to create the mock in
 * @param tableName - Name of the mock table
 * @returns ITable instance for testing
 */
export function createMockTable(
  stack: cdk.Stack,
  tableName: string
): dynamodb.ITable {
  // Only provide tableArn - CDK extracts tableName from ARN automatically
  // Providing both causes "Only one of tableArn or tableName can be provided" error
  return dynamodb.Table.fromTableAttributes(stack, "MockTable", {
    tableArn: `arn:aws:dynamodb:${TEST_CONFIG.region}:${TEST_CONFIG.account}:table/${tableName}`,
    tableStreamArn: `arn:aws:dynamodb:${TEST_CONFIG.region}:${TEST_CONFIG.account}:table/${tableName}/stream/2024-01-01T00:00:00.000`,
  });
}

/**
 * Create mock S3 bucket for testing
 *
 * Creates an IBucket interface without provisioning actual infrastructure.
 * Uses fromBucketAttributes to reference a bucket that doesn't exist.
 *
 * @param stack - CDK stack to create the mock in
 * @param bucketName - Name of the mock bucket
 * @returns IBucket instance for testing
 */
export function createMockBucket(
  stack: cdk.Stack,
  bucketName: string
): s3.IBucket {
  return s3.Bucket.fromBucketAttributes(stack, "MockBucket", {
    bucketName,
    bucketArn: `arn:aws:s3:::${bucketName}`,
  });
}

// ============================================================================
// ENVIRONMENT CONFIGURATION
// ============================================================================

/**
 * Create minimal environment config for testing
 *
 * @param envName - Environment name (e.g., 'development', 'production')
 * @param isProduction - Whether this is production environment
 * @returns EnvironmentConfig for testing
 */
export function createTestEnvConfig(
  envName: string,
  isProduction: boolean = false
): EnvironmentConfig {
  return {
    envName,
    account: TEST_CONFIG.account,
    region: TEST_CONFIG.region,
    vpcCidr: BASE_TEST_CONSTANTS.VPC.CIDR,
    natGateways: BASE_TEST_CONSTANTS.VPC.NAT_GATEWAYS,
    isProduction,
    pipelineAccount: "999888777666",
  };
}

// ============================================================================
// TEST FIXTURES CLASS
// ============================================================================

/**
 * API Stack Test Fixtures
 *
 * Provides cached mock resources for WebappApiStack testing.
 * Each app instance gets its own cached fixtures for performance.
 *
 * Pattern: Follows EfsTestFixtures pattern
 */
export class ApiStackTestFixtures {
  private mockStack: cdk.Stack;
  private _mockTable: dynamodb.ITable | null = null;
  private _mockBucket: s3.IBucket | null = null;

  constructor(_app: cdk.App) {
    // Create a temporary stack for mock resources
    this.mockStack = new cdk.Stack(_app, "MockResourceStack", {
      env: createTestEnv(),
    });
  }

  /**
   * Get or create mock DynamoDB table
   *
   * Cached for performance - created once per app instance
   *
   * @returns ITable instance for testing
   */
  getMockTable(): dynamodb.ITable {
    if (!this._mockTable) {
      this._mockTable = createMockTable(
        this.mockStack,
        API_TEST_CONSTANTS.TABLE_NAMES.ARTICLES
      );
    }
    return this._mockTable;
  }

  /**
   * Get or create mock S3 bucket
   *
   * Cached for performance - created once per app instance
   *
   * @returns IBucket instance for testing
   */
  getMockBucket(): s3.IBucket {
    if (!this._mockBucket) {
      this._mockBucket = createMockBucket(
        this.mockStack,
        API_TEST_CONSTANTS.BUCKET_NAMES.ASSETS
      );
    }
    return this._mockBucket;
  }

  /**
   * Create minimal stack props using cached fixtures
   *
   * @param envName - Environment name (default: development)
   * @param isProduction - Whether this is production (default: false)
   * @returns Minimal stack properties for testing
   */
  getMinimalProps(
    envName: string = BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
    isProduction: boolean = false
  ): WebappApiStackProps {
    return {
      env: createTestEnv(),
      envName,
      projectName: API_TEST_CONSTANTS.PROJECT_NAMES.WEBAPP,
      envConfig: createTestEnvConfig(envName, isProduction),
      articlesTable: this.getMockTable(),
      assetsS3Bucket: this.getMockBucket(),
      // For production tests, provide test CORS origin; for development, allow wildcard
      corsOrigins: isProduction ? ["https://test-example.com"] : ["*"],
    };
  }
}

// ============================================================================
// STACK CREATION HELPERS
// ============================================================================

/**
 * Create test API stack with default configuration
 *
 * Uses ApiStackTestFixtures caching to improve performance.
 * Each app instance gets its own cached mock resources.
 *
 * @param app - CDK app instance
 * @param id - Stack ID (default: "TestApiStack")
 * @param props - Optional stack properties to override defaults
 * @returns WebappApiStack instance for testing
 *
 * @example
 * ```typescript
 * const app = createTestApp();
 * const stack = createTestApiStack(app);
 * const template = Template.fromStack(stack);
 * ```
 */
export function createTestApiStack(
  app: cdk.App,
  id: string = API_TEST_CONSTANTS.STACK_IDS.API,
  props?: Partial<WebappApiStackProps>
): WebappApiStack {
  if (!app) {
    throw new Error("CDK App instance is required to create test stack");
  }

  if (!id) {
    throw new Error("Stack ID is required to create test stack");
  }

  const fixtures = new ApiStackTestFixtures(app);
  
  // Determine environment based on stack ID
  const isProduction = id.toLowerCase().includes("prod");
  const envName = isProduction 
    ? BASE_TEST_CONSTANTS.ENVIRONMENTS.PRODUCTION 
    : BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT;
  
  const minimalProps = fixtures.getMinimalProps(envName, isProduction);

  return new WebappApiStack(app, id, {
    ...minimalProps,
    ...props,
  });
}
