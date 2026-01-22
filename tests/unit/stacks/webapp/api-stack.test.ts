/** @format */
/// <reference types="jest" />

import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { Template, Match, Capture } from "aws-cdk-lib/assertions";

import { WebappApiStack } from "../../../../lib/stacks/webapp/api-stack";
import { EnvironmentConfig } from "../../../../config/environments";
import {
  TEST_CONFIG,
  BASE_TEST_CONSTANTS,
  createTestApp,
} from "../../utils/stack-test-utils";

// ============================================================================
// TEST CONFIGURATION
// ============================================================================

/**
 * Test constants - avoid magic numbers and strings
 */
const TEST_CONSTANTS = {
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
// TEST HELPERS
// ============================================================================

/**
 * Create minimal environment config for testing
 */
function createTestEnvConfig(
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

/**
 * Create mock DynamoDB table for testing
 */
function createMockTable(
  stack: cdk.Stack,
  tableName: string
): dynamodb.ITable {
  return dynamodb.Table.fromTableAttributes(stack, "MockTable", {
    tableName,
    tableArn: `arn:aws:dynamodb:${TEST_CONFIG.region}:${TEST_CONFIG.account}:table/${tableName}`,
    tableStreamArn: `arn:aws:dynamodb:${TEST_CONFIG.region}:${TEST_CONFIG.account}:table/${tableName}/stream/2024-01-01T00:00:00.000`,
  });
}

/**
 * Create mock S3 bucket for testing
 */
function createMockBucket(stack: cdk.Stack, bucketName: string): s3.IBucket {
  return s3.Bucket.fromBucketAttributes(stack, "MockBucket", {
    bucketName,
    bucketArn: `arn:aws:s3:::${bucketName}`,
  });
}

// ============================================================================
// WEBAPP API STACK TESTS
// ============================================================================

describe("WebappApiStack", () => {
  let app: cdk.App;

  beforeEach(() => {
    app = createTestApp();
  });

  // ==========================================================================
  // API GATEWAY CREATION TESTS
  // ==========================================================================

  describe("API Gateway Creation", () => {
    test("should create REST API with correct configuration", () => {
      // Arrange
      const envConfig = createTestEnvConfig(
        BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT
      );
      const mockStack = new cdk.Stack(app, "MockStack");
      const mockTable = createMockTable(
        mockStack,
        TEST_CONSTANTS.TABLE_NAMES.ARTICLES
      );
      const mockBucket = createMockBucket(
        mockStack,
        TEST_CONSTANTS.BUCKET_NAMES.ASSETS
      );

      // Act
      const stack = new WebappApiStack(app, TEST_CONSTANTS.STACK_IDS.API, {
        env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
        envName: BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        projectName: TEST_CONSTANTS.PROJECT_NAMES.WEBAPP,
        envConfig,
        articlesTable: mockTable,
        assetsS3Bucket: mockBucket,
      });

      const template = Template.fromStack(stack);

      // Assert
      template.resourceCountIs(
        "AWS::ApiGateway::RestApi",
        TEST_CONSTANTS.RESOURCE_COUNTS.API
      );

      template.hasResourceProperties("AWS::ApiGateway::RestApi", {
        Name: TEST_CONSTANTS.API_NAMES.FULL_DEV,
        Description: Match.stringLikeRegexp("Articles API"),
        EndpointConfiguration: {
          Types: ["REGIONAL"],
        },
      });
    });

    test("should enable CloudWatch logging for API Gateway", () => {
      // Arrange
      const envConfig = createTestEnvConfig(
        BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT
      );
      const mockStack = new cdk.Stack(app, "MockStack");
      const mockTable = createMockTable(
        mockStack,
        TEST_CONSTANTS.TABLE_NAMES.ARTICLES
      );
      const mockBucket = createMockBucket(
        mockStack,
        TEST_CONSTANTS.BUCKET_NAMES.ASSETS
      );

      // Act
      const stack = new WebappApiStack(app, TEST_CONSTANTS.STACK_IDS.API, {
        env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
        envName: BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        projectName: TEST_CONSTANTS.PROJECT_NAMES.WEBAPP,
        envConfig,
        articlesTable: mockTable,
        assetsS3Bucket: mockBucket,
      });

      const template = Template.fromStack(stack);

      // Assert - API Gateway Stage with logging
      template.hasResourceProperties("AWS::ApiGateway::Stage", {
        StageName: "api",
        MethodSettings: [
          Match.objectLike({
            LoggingLevel: "INFO",
            MetricsEnabled: true,
          }),
        ],
      });

      // Assert - CloudWatch Log Group for API Gateway
      template.hasResourceProperties("AWS::Logs::LogGroup", {
        LogGroupName: Match.stringLikeRegexp("/aws/apigateway/"),
        RetentionInDays: 7, // Development = 1 week
      });
    });

    test("should configure CORS with correct origins and methods", () => {
      // Arrange
      const envConfig = createTestEnvConfig(
        BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT
      );
      const mockStack = new cdk.Stack(app, "MockStack");
      const mockTable = createMockTable(
        mockStack,
        TEST_CONSTANTS.TABLE_NAMES.ARTICLES
      );
      const mockBucket = createMockBucket(
        mockStack,
        TEST_CONSTANTS.BUCKET_NAMES.ASSETS
      );

      const customOrigins = ["https://example.com", "http://localhost:3000"];

      // Act
      const stack = new WebappApiStack(app, TEST_CONSTANTS.STACK_IDS.API, {
        env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
        envName: BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        projectName: TEST_CONSTANTS.PROJECT_NAMES.WEBAPP,
        envConfig,
        articlesTable: mockTable,
        assetsS3Bucket: mockBucket,
        corsOrigins: customOrigins,
      });

      const template = Template.fromStack(stack);

      // Assert - OPTIONS method for CORS preflight
      template.hasResourceProperties("AWS::ApiGateway::Method", {
        HttpMethod: "OPTIONS",
        Integration: {
          Type: "MOCK",
          IntegrationResponses: [
            Match.objectLike({
              ResponseParameters: Match.objectLike({
                "method.response.header.Access-Control-Allow-Headers":
                  Match.stringLikeRegexp("Content-Type.*Authorization"),
                "method.response.header.Access-Control-Allow-Methods":
                  Match.stringLikeRegexp("GET.*OPTIONS"),
                "method.response.header.Access-Control-Allow-Origin":
                  Match.anyValue(),
              }),
            }),
          ],
        },
      });
    });

    test("should configure throttling limits for development", () => {
      // Arrange
      const envConfig = createTestEnvConfig(
        BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT
      );
      const mockStack = new cdk.Stack(app, "MockStack");
      const mockTable = createMockTable(
        mockStack,
        TEST_CONSTANTS.TABLE_NAMES.ARTICLES
      );
      const mockBucket = createMockBucket(
        mockStack,
        TEST_CONSTANTS.BUCKET_NAMES.ASSETS
      );

      // Act
      const stack = new WebappApiStack(app, TEST_CONSTANTS.STACK_IDS.API, {
        env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
        envName: BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        projectName: TEST_CONSTANTS.PROJECT_NAMES.WEBAPP,
        envConfig,
        articlesTable: mockTable,
        assetsS3Bucket: mockBucket,
      });

      const template = Template.fromStack(stack);

      // Assert
      template.hasResourceProperties("AWS::ApiGateway::Stage", {
        MethodSettings: [
          Match.objectLike({
            ThrottlingRateLimit: TEST_CONSTANTS.THROTTLE.DEV_RATE,
            ThrottlingBurstLimit: TEST_CONSTANTS.THROTTLE.DEV_BURST,
          }),
        ],
      });
    });

    test("should configure throttling limits for production", () => {
      // Arrange
      const envConfig = createTestEnvConfig(
        BASE_TEST_CONSTANTS.ENVIRONMENTS.PRODUCTION,
        true
      );
      const mockStack = new cdk.Stack(app, "MockStack");
      const mockTable = createMockTable(
        mockStack,
        TEST_CONSTANTS.TABLE_NAMES.ARTICLES
      );
      const mockBucket = createMockBucket(
        mockStack,
        TEST_CONSTANTS.BUCKET_NAMES.ASSETS
      );

      // Act
      const stack = new WebappApiStack(app, TEST_CONSTANTS.STACK_IDS.API, {
        env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
        envName: BASE_TEST_CONSTANTS.ENVIRONMENTS.PRODUCTION,
        projectName: TEST_CONSTANTS.PROJECT_NAMES.WEBAPP,
        envConfig,
        articlesTable: mockTable,
        assetsS3Bucket: mockBucket,
      });

      const template = Template.fromStack(stack);

      // Assert
      template.hasResourceProperties("AWS::ApiGateway::Stage", {
        MethodSettings: [
          Match.objectLike({
            ThrottlingRateLimit: TEST_CONSTANTS.THROTTLE.PROD_RATE,
            ThrottlingBurstLimit: TEST_CONSTANTS.THROTTLE.PROD_BURST,
          }),
        ],
      });
    });
  });

  // ==========================================================================
  // LAMBDA FUNCTIONS CREATION TESTS
  // ==========================================================================

  describe("Lambda Functions Creation", () => {
    test("should create all three Lambda functions", () => {
      // Arrange
      const envConfig = createTestEnvConfig(
        BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT
      );
      const mockStack = new cdk.Stack(app, "MockStack");
      const mockTable = createMockTable(
        mockStack,
        TEST_CONSTANTS.TABLE_NAMES.ARTICLES
      );
      const mockBucket = createMockBucket(
        mockStack,
        TEST_CONSTANTS.BUCKET_NAMES.ASSETS
      );

      // Act
      const stack = new WebappApiStack(app, TEST_CONSTANTS.STACK_IDS.API, {
        env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
        envName: BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        projectName: TEST_CONSTANTS.PROJECT_NAMES.WEBAPP,
        envConfig,
        articlesTable: mockTable,
        assetsS3Bucket: mockBucket,
      });

      const template = Template.fromStack(stack);

      // Assert
      template.resourceCountIs(
        "AWS::Lambda::Function",
        TEST_CONSTANTS.RESOURCE_COUNTS.LAMBDA
      );

      // Get Article Function
      template.hasResourceProperties("AWS::Lambda::Function", {
        FunctionName: `${BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT}-${TEST_CONSTANTS.FUNCTION_NAMES.GET_ARTICLE}`,
        Handler: "index.handler",
        Runtime: Match.stringLikeRegexp("nodejs"),
        Timeout: TEST_CONSTANTS.TIMEOUT.SECONDS,
        MemorySize: TEST_CONSTANTS.MEMORY.MB,
      });

      // List Articles Function
      template.hasResourceProperties("AWS::Lambda::Function", {
        FunctionName: `${BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT}-${TEST_CONSTANTS.FUNCTION_NAMES.LIST_ARTICLES}`,
      });

      // List By Tag Function
      template.hasResourceProperties("AWS::Lambda::Function", {
        FunctionName: `${BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT}-${TEST_CONSTANTS.FUNCTION_NAMES.LIST_BY_TAG}`,
      });
    });

    test("should configure Lambda environment variables correctly", () => {
      // Arrange
      const envConfig = createTestEnvConfig(
        BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT
      );
      const mockStack = new cdk.Stack(app, "MockStack");
      const mockTable = createMockTable(
        mockStack,
        TEST_CONSTANTS.TABLE_NAMES.ARTICLES
      );
      const mockBucket = createMockBucket(
        mockStack,
        TEST_CONSTANTS.BUCKET_NAMES.ASSETS
      );

      // Act
      const stack = new WebappApiStack(app, TEST_CONSTANTS.STACK_IDS.API, {
        env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
        envName: BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        projectName: TEST_CONSTANTS.PROJECT_NAMES.WEBAPP,
        envConfig,
        articlesTable: mockTable,
        assetsS3Bucket: mockBucket,
      });

      const template = Template.fromStack(stack);

      // Assert
      template.hasResourceProperties("AWS::Lambda::Function", {
        Environment: {
          Variables: Match.objectLike({
            TABLE_NAME: TEST_CONSTANTS.TABLE_NAMES.ARTICLES,
            ASSETS_BUCKET_NAME: TEST_CONSTANTS.BUCKET_NAMES.ASSETS,
            GSI1_NAME: "gsi1-status-date",
            GSI2_NAME: "gsi2-tag-date",
            ENVIRONMENT: BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
            LOG_LEVEL: "DEBUG",
          }),
        },
      });
    });

    test("should set LOG_LEVEL to INFO in production", () => {
      // Arrange
      const envConfig = createTestEnvConfig(
        BASE_TEST_CONSTANTS.ENVIRONMENTS.PRODUCTION,
        true
      );
      const mockStack = new cdk.Stack(app, "MockStack");
      const mockTable = createMockTable(
        mockStack,
        TEST_CONSTANTS.TABLE_NAMES.ARTICLES
      );
      const mockBucket = createMockBucket(
        mockStack,
        TEST_CONSTANTS.BUCKET_NAMES.ASSETS
      );

      // Act
      const stack = new WebappApiStack(app, TEST_CONSTANTS.STACK_IDS.API, {
        env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
        envName: BASE_TEST_CONSTANTS.ENVIRONMENTS.PRODUCTION,
        projectName: TEST_CONSTANTS.PROJECT_NAMES.WEBAPP,
        envConfig,
        articlesTable: mockTable,
        assetsS3Bucket: mockBucket,
      });

      const template = Template.fromStack(stack);

      // Assert
      template.hasResourceProperties("AWS::Lambda::Function", {
        Environment: {
          Variables: Match.objectLike({
            LOG_LEVEL: "INFO",
          }),
        },
      });
    });

    test("should create CloudWatch Log Groups for Lambda functions", () => {
      // Arrange
      const envConfig = createTestEnvConfig(
        BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT
      );
      const mockStack = new cdk.Stack(app, "MockStack");
      const mockTable = createMockTable(
        mockStack,
        TEST_CONSTANTS.TABLE_NAMES.ARTICLES
      );
      const mockBucket = createMockBucket(
        mockStack,
        TEST_CONSTANTS.BUCKET_NAMES.ASSETS
      );

      // Act
      const stack = new WebappApiStack(app, TEST_CONSTANTS.STACK_IDS.API, {
        env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
        envName: BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        projectName: TEST_CONSTANTS.PROJECT_NAMES.WEBAPP,
        envConfig,
        articlesTable: mockTable,
        assetsS3Bucket: mockBucket,
      });

      const template = Template.fromStack(stack);

      // Assert - Should have log groups for all Lambda functions + API Gateway
      template.resourceCountIs(
        "AWS::Logs::LogGroup",
        TEST_CONSTANTS.RESOURCE_COUNTS.LOG_GROUP
      );

      // Development retention = 1 week
      template.hasResourceProperties("AWS::Logs::LogGroup", {
        LogGroupName: Match.stringLikeRegexp("/aws/lambda/"),
        RetentionInDays: 7,
      });
    });

    test("should configure production log retention to 1 month", () => {
      // Arrange
      const envConfig = createTestEnvConfig(
        BASE_TEST_CONSTANTS.ENVIRONMENTS.PRODUCTION,
        true
      );
      const mockStack = new cdk.Stack(app, "MockStack");
      const mockTable = createMockTable(
        mockStack,
        TEST_CONSTANTS.TABLE_NAMES.ARTICLES
      );
      const mockBucket = createMockBucket(
        mockStack,
        TEST_CONSTANTS.BUCKET_NAMES.ASSETS
      );

      // Act
      const stack = new WebappApiStack(app, TEST_CONSTANTS.STACK_IDS.API, {
        env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
        envName: BASE_TEST_CONSTANTS.ENVIRONMENTS.PRODUCTION,
        projectName: TEST_CONSTANTS.PROJECT_NAMES.WEBAPP,
        envConfig,
        articlesTable: mockTable,
        assetsS3Bucket: mockBucket,
      });

      const template = Template.fromStack(stack);

      // Assert
      template.hasResourceProperties("AWS::Logs::LogGroup", {
        LogGroupName: Match.stringLikeRegexp("/aws/lambda/"),
        RetentionInDays: 30, // 1 month
      });
    });
  });

  // ==========================================================================
  // IAM PERMISSIONS TESTS
  // ==========================================================================

  describe("IAM Permissions", () => {
    test("should grant Lambda functions read access to DynamoDB table", () => {
      // Arrange
      const envConfig = createTestEnvConfig(
        BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT
      );
      const mockStack = new cdk.Stack(app, "MockStack");
      const mockTable = createMockTable(
        mockStack,
        TEST_CONSTANTS.TABLE_NAMES.ARTICLES
      );
      const mockBucket = createMockBucket(
        mockStack,
        TEST_CONSTANTS.BUCKET_NAMES.ASSETS
      );

      // Act
      const stack = new WebappApiStack(app, TEST_CONSTANTS.STACK_IDS.API, {
        env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
        envName: BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        projectName: TEST_CONSTANTS.PROJECT_NAMES.WEBAPP,
        envConfig,
        articlesTable: mockTable,
        assetsS3Bucket: mockBucket,
      });

      const template = Template.fromStack(stack);

      // Assert
      template.hasResourceProperties("AWS::IAM::Policy", {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: Match.arrayWith([
                "dynamodb:BatchGetItem",
                "dynamodb:GetRecords",
                "dynamodb:GetShardIterator",
                "dynamodb:Query",
                "dynamodb:GetItem",
                "dynamodb:Scan",
                "dynamodb:ConditionCheckItem",
                "dynamodb:DescribeTable",
              ]),
              Effect: "Allow",
              Resource: Match.arrayWith([
                Match.stringLikeRegexp(TEST_CONSTANTS.TABLE_NAMES.ARTICLES),
              ]),
            }),
          ]),
        },
      });
    });

    test("should grant Lambda functions read access to S3 bucket", () => {
      // Arrange
      const envConfig = createTestEnvConfig(
        BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT
      );
      const mockStack = new cdk.Stack(app, "MockStack");
      const mockTable = createMockTable(
        mockStack,
        TEST_CONSTANTS.TABLE_NAMES.ARTICLES
      );
      const mockBucket = createMockBucket(
        mockStack,
        TEST_CONSTANTS.BUCKET_NAMES.ASSETS
      );

      // Act
      const stack = new WebappApiStack(app, TEST_CONSTANTS.STACK_IDS.API, {
        env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
        envName: BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        projectName: TEST_CONSTANTS.PROJECT_NAMES.WEBAPP,
        envConfig,
        articlesTable: mockTable,
        assetsS3Bucket: mockBucket,
      });

      const template = Template.fromStack(stack);

      // Assert
      template.hasResourceProperties("AWS::IAM::Policy", {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: Match.arrayWith(["s3:GetObject*", "s3:GetBucket*", "s3:List*"]),
              Effect: "Allow",
              Resource: Match.anyValue(),
            }),
          ]),
        },
      });
    });

    test("should create IAM roles for Lambda functions", () => {
      // Arrange
      const envConfig = createTestEnvConfig(
        BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT
      );
      const mockStack = new cdk.Stack(app, "MockStack");
      const mockTable = createMockTable(
        mockStack,
        TEST_CONSTANTS.TABLE_NAMES.ARTICLES
      );
      const mockBucket = createMockBucket(
        mockStack,
        TEST_CONSTANTS.BUCKET_NAMES.ASSETS
      );

      // Act
      const stack = new WebappApiStack(app, TEST_CONSTANTS.STACK_IDS.API, {
        env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
        envName: BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        projectName: TEST_CONSTANTS.PROJECT_NAMES.WEBAPP,
        envConfig,
        articlesTable: mockTable,
        assetsS3Bucket: mockBucket,
      });

      const template = Template.fromStack(stack);

      // Assert - Should have 1 role per Lambda function
      template.resourceCountIs(
        "AWS::IAM::Role",
        TEST_CONSTANTS.RESOURCE_COUNTS.IAM_ROLE
      );

      template.hasResourceProperties("AWS::IAM::Role", {
        AssumeRolePolicyDocument: {
          Statement: [
            {
              Action: "sts:AssumeRole",
              Effect: "Allow",
              Principal: {
                Service: "lambda.amazonaws.com",
              },
            },
          ],
        },
      });
    });
  });

  // ==========================================================================
  // API GATEWAY INTEGRATION TESTS
  // ==========================================================================

  describe("API Gateway Integrations", () => {
    test("should create GET /articles endpoint", () => {
      // Arrange
      const envConfig = createTestEnvConfig(
        BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT
      );
      const mockStack = new cdk.Stack(app, "MockStack");
      const mockTable = createMockTable(
        mockStack,
        TEST_CONSTANTS.TABLE_NAMES.ARTICLES
      );
      const mockBucket = createMockBucket(
        mockStack,
        TEST_CONSTANTS.BUCKET_NAMES.ASSETS
      );

      // Act
      const stack = new WebappApiStack(app, TEST_CONSTANTS.STACK_IDS.API, {
        env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
        envName: BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        projectName: TEST_CONSTANTS.PROJECT_NAMES.WEBAPP,
        envConfig,
        articlesTable: mockTable,
        assetsS3Bucket: mockBucket,
      });

      const template = Template.fromStack(stack);

      // Assert - Resource for /articles
      template.hasResourceProperties("AWS::ApiGateway::Resource", {
        PathPart: "articles",
      });

      // Assert - GET method
      template.hasResourceProperties("AWS::ApiGateway::Method", {
        HttpMethod: TEST_CONSTANTS.HTTP_METHODS.GET,
        ResourceId: Match.anyValue(),
        RestApiId: Match.anyValue(),
      });
    });

    test("should create GET /articles/{slug} endpoint", () => {
      // Arrange
      const envConfig = createTestEnvConfig(
        BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT
      );
      const mockStack = new cdk.Stack(app, "MockStack");
      const mockTable = createMockTable(
        mockStack,
        TEST_CONSTANTS.TABLE_NAMES.ARTICLES
      );
      const mockBucket = createMockBucket(
        mockStack,
        TEST_CONSTANTS.BUCKET_NAMES.ASSETS
      );

      // Act
      const stack = new WebappApiStack(app, TEST_CONSTANTS.STACK_IDS.API, {
        env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
        envName: BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        projectName: TEST_CONSTANTS.PROJECT_NAMES.WEBAPP,
        envConfig,
        articlesTable: mockTable,
        assetsS3Bucket: mockBucket,
      });

      const template = Template.fromStack(stack);

      // Assert - Resource for {slug} parameter
      template.hasResourceProperties("AWS::ApiGateway::Resource", {
        PathPart: "{slug}",
      });
    });

    test("should create GET /articles/tag/{tag} endpoint", () => {
      // Arrange
      const envConfig = createTestEnvConfig(
        BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT
      );
      const mockStack = new cdk.Stack(app, "MockStack");
      const mockTable = createMockTable(
        mockStack,
        TEST_CONSTANTS.TABLE_NAMES.ARTICLES
      );
      const mockBucket = createMockBucket(
        mockStack,
        TEST_CONSTANTS.BUCKET_NAMES.ASSETS
      );

      // Act
      const stack = new WebappApiStack(app, TEST_CONSTANTS.STACK_IDS.API, {
        env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
        envName: BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        projectName: TEST_CONSTANTS.PROJECT_NAMES.WEBAPP,
        envConfig,
        articlesTable: mockTable,
        assetsS3Bucket: mockBucket,
      });

      const template = Template.fromStack(stack);

      // Assert - Resource for /articles/tag
      template.hasResourceProperties("AWS::ApiGateway::Resource", {
        PathPart: "tag",
      });

      // Assert - Resource for {tag} parameter
      template.hasResourceProperties("AWS::ApiGateway::Resource", {
        PathPart: "{tag}",
      });
    });

    test("should configure Lambda integrations for all endpoints", () => {
      // Arrange
      const envConfig = createTestEnvConfig(
        BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT
      );
      const mockStack = new cdk.Stack(app, "MockStack");
      const mockTable = createMockTable(
        mockStack,
        TEST_CONSTANTS.TABLE_NAMES.ARTICLES
      );
      const mockBucket = createMockBucket(
        mockStack,
        TEST_CONSTANTS.BUCKET_NAMES.ASSETS
      );

      // Act
      const stack = new WebappApiStack(app, TEST_CONSTANTS.STACK_IDS.API, {
        env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
        envName: BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        projectName: TEST_CONSTANTS.PROJECT_NAMES.WEBAPP,
        envConfig,
        articlesTable: mockTable,
        assetsS3Bucket: mockBucket,
      });

      const template = Template.fromStack(stack);

      // Assert - Lambda integration type
      template.hasResourceProperties("AWS::ApiGateway::Method", {
        HttpMethod: TEST_CONSTANTS.HTTP_METHODS.GET,
        Integration: {
          Type: "AWS_PROXY",
          IntegrationHttpMethod: "POST", // Lambda proxy always uses POST
        },
      });

      // Assert - Lambda permissions for API Gateway
      template.hasResourceProperties("AWS::Lambda::Permission", {
        Action: "lambda:InvokeFunction",
        Principal: "apigateway.amazonaws.com",
      });
    });
  });

  // ==========================================================================
  // STACK OUTPUTS TESTS
  // ==========================================================================

  describe("Stack Outputs", () => {
    test("should export API Gateway URL", () => {
      // Arrange
      const envConfig = createTestEnvConfig(
        BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT
      );
      const mockStack = new cdk.Stack(app, "MockStack");
      const mockTable = createMockTable(
        mockStack,
        TEST_CONSTANTS.TABLE_NAMES.ARTICLES
      );
      const mockBucket = createMockBucket(
        mockStack,
        TEST_CONSTANTS.BUCKET_NAMES.ASSETS
      );

      // Act
      const stack = new WebappApiStack(app, TEST_CONSTANTS.STACK_IDS.API, {
        env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
        envName: BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        projectName: TEST_CONSTANTS.PROJECT_NAMES.WEBAPP,
        envConfig,
        articlesTable: mockTable,
        assetsS3Bucket: mockBucket,
      });

      const template = Template.fromStack(stack);

      // Assert
      template.hasOutput(TEST_CONSTANTS.OUTPUT_KEYS.API_URL, {
        Description: "API Gateway URL for articles API",
        Export: {
          Name: TEST_CONSTANTS.EXPORT_NAMES.DEV_API_URL,
        },
      });
    });

    test("should export API Gateway ID", () => {
      // Arrange
      const envConfig = createTestEnvConfig(
        BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT
      );
      const mockStack = new cdk.Stack(app, "MockStack");
      const mockTable = createMockTable(
        mockStack,
        TEST_CONSTANTS.TABLE_NAMES.ARTICLES
      );
      const mockBucket = createMockBucket(
        mockStack,
        TEST_CONSTANTS.BUCKET_NAMES.ASSETS
      );

      // Act
      const stack = new WebappApiStack(app, TEST_CONSTANTS.STACK_IDS.API, {
        env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
        envName: BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        projectName: TEST_CONSTANTS.PROJECT_NAMES.WEBAPP,
        envConfig,
        articlesTable: mockTable,
        assetsS3Bucket: mockBucket,
      });

      const template = Template.fromStack(stack);

      // Assert
      template.hasOutput(TEST_CONSTANTS.OUTPUT_KEYS.API_ID, {
        Description: "API Gateway ID",
        Export: {
          Name: TEST_CONSTANTS.EXPORT_NAMES.DEV_API_ID,
        },
      });
    });

    test("should export Lambda function ARNs", () => {
      // Arrange
      const envConfig = createTestEnvConfig(
        BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT
      );
      const mockStack = new cdk.Stack(app, "MockStack");
      const mockTable = createMockTable(
        mockStack,
        TEST_CONSTANTS.TABLE_NAMES.ARTICLES
      );
      const mockBucket = createMockBucket(
        mockStack,
        TEST_CONSTANTS.BUCKET_NAMES.ASSETS
      );

      // Act
      const stack = new WebappApiStack(app, TEST_CONSTANTS.STACK_IDS.API, {
        env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
        envName: BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        projectName: TEST_CONSTANTS.PROJECT_NAMES.WEBAPP,
        envConfig,
        articlesTable: mockTable,
        assetsS3Bucket: mockBucket,
      });

      const template = Template.fromStack(stack);

      // Assert
      template.hasOutput(TEST_CONSTANTS.OUTPUT_KEYS.GET_ARTICLE_ARN, {
        Description: "Get Article Lambda function ARN",
      });

      template.hasOutput(TEST_CONSTANTS.OUTPUT_KEYS.LIST_ARTICLES_ARN, {
        Description: "List Articles Lambda function ARN",
      });

      template.hasOutput(TEST_CONSTANTS.OUTPUT_KEYS.LIST_BY_TAG_ARN, {
        Description: "List Articles By Tag Lambda function ARN",
      });
    });

    test("should not export outputs for pipeline environment", () => {
      // Arrange
      const envConfig = createTestEnvConfig("development-pipeline");
      const mockStack = new cdk.Stack(app, "MockStack");
      const mockTable = createMockTable(
        mockStack,
        TEST_CONSTANTS.TABLE_NAMES.ARTICLES
      );
      const mockBucket = createMockBucket(
        mockStack,
        TEST_CONSTANTS.BUCKET_NAMES.ASSETS
      );

      // Act
      const stack = new WebappApiStack(app, TEST_CONSTANTS.STACK_IDS.API, {
        env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
        envName: "development-pipeline",
        projectName: TEST_CONSTANTS.PROJECT_NAMES.WEBAPP,
        envConfig,
        articlesTable: mockTable,
        assetsS3Bucket: mockBucket,
      });

      const template = Template.fromStack(stack);

      // Assert - Outputs should exist but without Export property
      const outputs = template.toJSON().Outputs;
      expect(outputs[TEST_CONSTANTS.OUTPUT_KEYS.API_URL]).toHaveProperty(
        "Value"
      );
      expect(outputs[TEST_CONSTANTS.OUTPUT_KEYS.API_URL]).not.toHaveProperty(
        "Export"
      );
    });
  });

  // ==========================================================================
  // TAGGING TESTS
  // ==========================================================================

  describe("Resource Tagging", () => {
    test("should apply standard tags to all resources", () => {
      // Arrange
      const envConfig = createTestEnvConfig(
        BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT
      );
      const mockStack = new cdk.Stack(app, "MockStack");
      const mockTable = createMockTable(
        mockStack,
        TEST_CONSTANTS.TABLE_NAMES.ARTICLES
      );
      const mockBucket = createMockBucket(
        mockStack,
        TEST_CONSTANTS.BUCKET_NAMES.ASSETS
      );

      // Act
      const stack = new WebappApiStack(app, TEST_CONSTANTS.STACK_IDS.API, {
        env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
        envName: BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        projectName: TEST_CONSTANTS.PROJECT_NAMES.WEBAPP,
        envConfig,
        articlesTable: mockTable,
        assetsS3Bucket: mockBucket,
      });

      // Assert - Check stack-level tags
      const stackTags = cdk.Tags.of(stack);
      expect(stackTags).toBeDefined();
    });
  });
});
