/** @format */
/// <reference types="jest" />

import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Template, Match } from "aws-cdk-lib/assertions";

import { WebappDynamoDbStack } from "../../../../lib/stacks/webapp/dynamodb-stack";
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
 * All hardcoded values used in tests should be defined here
 */
const TEST_CONSTANTS = {
  ...BASE_TEST_CONSTANTS,
  PROJECT_NAMES: {
    WEBAPP: "webapp",
    CUSTOM: "custom-project",
  },
  TABLE_NAMES: {
    ARTICLES: "articles",
    FULL_DEV: "webapp-articles-development",
    FULL_PROD: "webapp-articles-production",
  },
  BUCKET_NAMES: {
    ASSETS_DEV: "webapp-article-assets-development",
    ASSETS_PROD: "webapp-article-assets-production",
  },
  ATTRIBUTE_NAMES: {
    PK: "pk",
    SK: "sk",
    GSI1PK: "gsi1pk",
    GSI1SK: "gsi1sk",
    GSI2PK: "gsi2pk",
    GSI2SK: "gsi2sk",
  },
  GSI_NAMES: {
    STATUS_DATE: "gsi1-status-date",
    TAG_DATE: "gsi2-tag-date",
  },
  RESOURCE_COUNTS: {
    TABLE: 1,
    BUCKET: 1,
    GSI: 2,
    OUTPUTS: 9,
  },
  STACK_IDS: {
    ...BASE_TEST_CONSTANTS.STACK_IDS,
    DYNAMODB: "TestDynamoDbStack",
    DYNAMODB_DEV: "DevDynamoDbStack",
    DYNAMODB_PROD: "ProdDynamoDbStack",
  },
  OUTPUT_KEYS: {
    TABLE_NAME: "ArticlesTableName",
    TABLE_ARN: "ArticlesTableArn",
    GSI1_NAME: "ArticlesTableGsi1Name",
    GSI2_NAME: "ArticlesTableGsi2Name",
    STREAM_ARN: "ArticlesTableStreamArn",
    BUCKET_NAME: "AssetsBucketName",
    BUCKET_ARN: "AssetsBucketArn",
    BUCKET_DOMAIN: "AssetsBucketRegionalDomainName",
  },
  EXPORT_NAMES: {
    DEV_TABLE_NAME: "development-webapp-articles-table-name",
    DEV_TABLE_ARN: "development-webapp-articles-table-arn",
    DEV_GSI1_NAME: "development-webapp-articles-gsi1-name",
    DEV_BUCKET_NAME: "development-webapp-assets-bucket-name",
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

// ============================================================================
// WEBAPP DYNAMODB STACK TESTS
// ============================================================================

describe("WebappDynamoDbStack", () => {
  let app: cdk.App;

  beforeEach(() => {
    app = createTestApp();
  });

  // ==========================================================================
  // DYNAMODB TABLE CREATION TESTS
  // ==========================================================================

  describe("DynamoDB Table Creation", () => {
    test("should create DynamoDB articles table with correct configuration", () => {
      // Arrange
      const envConfig = createTestEnvConfig(
        BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT
      );

      // Act
      const stack = new WebappDynamoDbStack(
        app,
        TEST_CONSTANTS.STACK_IDS.DYNAMODB,
        {
          env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
          envName: BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
          projectName: TEST_CONSTANTS.PROJECT_NAMES.WEBAPP,
          envConfig,
        }
      );

      const template = Template.fromStack(stack);

      // Assert
      template.resourceCountIs(
        "AWS::DynamoDB::Table",
        TEST_CONSTANTS.RESOURCE_COUNTS.TABLE
      );

      template.hasResourceProperties("AWS::DynamoDB::Table", {
        TableName: TEST_CONSTANTS.TABLE_NAMES.FULL_DEV,
        BillingMode: "PAY_PER_REQUEST",
        KeySchema: [
          {
            AttributeName: TEST_CONSTANTS.ATTRIBUTE_NAMES.PK,
            KeyType: "HASH",
          },
          {
            AttributeName: TEST_CONSTANTS.ATTRIBUTE_NAMES.SK,
            KeyType: "RANGE",
          },
        ],
      });
    });

    test("should define all required attribute definitions", () => {
      // Arrange
      const envConfig = createTestEnvConfig(
        BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT
      );

      // Act
      const stack = new WebappDynamoDbStack(
        app,
        TEST_CONSTANTS.STACK_IDS.DYNAMODB,
        {
          env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
          envName: BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
          projectName: TEST_CONSTANTS.PROJECT_NAMES.WEBAPP,
          envConfig,
        }
      );

      const template = Template.fromStack(stack);

      // Assert - Should have pk, sk, gsi1pk, gsi1sk, gsi2pk, gsi2sk
      template.hasResourceProperties("AWS::DynamoDB::Table", {
        AttributeDefinitions: Match.arrayWith([
          {
            AttributeName: TEST_CONSTANTS.ATTRIBUTE_NAMES.PK,
            AttributeType: "S",
          },
          {
            AttributeName: TEST_CONSTANTS.ATTRIBUTE_NAMES.SK,
            AttributeType: "S",
          },
          {
            AttributeName: TEST_CONSTANTS.ATTRIBUTE_NAMES.GSI1PK,
            AttributeType: "S",
          },
          {
            AttributeName: TEST_CONSTANTS.ATTRIBUTE_NAMES.GSI1SK,
            AttributeType: "S",
          },
          {
            AttributeName: TEST_CONSTANTS.ATTRIBUTE_NAMES.GSI2PK,
            AttributeType: "S",
          },
          {
            AttributeName: TEST_CONSTANTS.ATTRIBUTE_NAMES.GSI2SK,
            AttributeType: "S",
          },
        ]),
      });
    });

    test("should use on-demand billing mode", () => {
      // Arrange
      const envConfig = createTestEnvConfig(
        BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT
      );

      // Act
      const stack = new WebappDynamoDbStack(
        app,
        TEST_CONSTANTS.STACK_IDS.DYNAMODB,
        {
          env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
          envName: BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
          projectName: TEST_CONSTANTS.PROJECT_NAMES.WEBAPP,
          envConfig,
        }
      );

      const template = Template.fromStack(stack);

      // Assert
      template.hasResourceProperties("AWS::DynamoDB::Table", {
        BillingMode: "PAY_PER_REQUEST",
      });
    });

    test("should enable DynamoDB Streams with NEW_AND_OLD_IMAGES", () => {
      // Arrange
      const envConfig = createTestEnvConfig(
        BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT
      );

      // Act
      const stack = new WebappDynamoDbStack(
        app,
        TEST_CONSTANTS.STACK_IDS.DYNAMODB,
        {
          env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
          envName: BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
          projectName: TEST_CONSTANTS.PROJECT_NAMES.WEBAPP,
          envConfig,
        }
      );

      const template = Template.fromStack(stack);

      // Assert
      template.hasResourceProperties("AWS::DynamoDB::Table", {
        StreamSpecification: {
          StreamViewType: "NEW_AND_OLD_IMAGES",
        },
      });
    });
  });

  // ==========================================================================
  // GLOBAL SECONDARY INDEXES TESTS
  // ==========================================================================

  describe("Global Secondary Indexes", () => {
    test("should create GSI1 for querying by status and date", () => {
      // Arrange
      const envConfig = createTestEnvConfig(
        BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT
      );

      // Act
      const stack = new WebappDynamoDbStack(
        app,
        TEST_CONSTANTS.STACK_IDS.DYNAMODB,
        {
          env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
          envName: BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
          projectName: TEST_CONSTANTS.PROJECT_NAMES.WEBAPP,
          envConfig,
        }
      );

      const template = Template.fromStack(stack);

      // Assert
      template.hasResourceProperties("AWS::DynamoDB::Table", {
        GlobalSecondaryIndexes: Match.arrayWith([
          Match.objectLike({
            IndexName: TEST_CONSTANTS.GSI_NAMES.STATUS_DATE,
            KeySchema: [
              {
                AttributeName: TEST_CONSTANTS.ATTRIBUTE_NAMES.GSI1PK,
                KeyType: "HASH",
              },
              {
                AttributeName: TEST_CONSTANTS.ATTRIBUTE_NAMES.GSI1SK,
                KeyType: "RANGE",
              },
            ],
            Projection: {
              ProjectionType: "ALL",
            },
          }),
        ]),
      });
    });

    test("should create GSI2 for querying by tag", () => {
      // Arrange
      const envConfig = createTestEnvConfig(
        BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT
      );

      // Act
      const stack = new WebappDynamoDbStack(
        app,
        TEST_CONSTANTS.STACK_IDS.DYNAMODB,
        {
          env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
          envName: BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
          projectName: TEST_CONSTANTS.PROJECT_NAMES.WEBAPP,
          envConfig,
        }
      );

      const template = Template.fromStack(stack);

      // Assert
      template.hasResourceProperties("AWS::DynamoDB::Table", {
        GlobalSecondaryIndexes: Match.arrayWith([
          Match.objectLike({
            IndexName: TEST_CONSTANTS.GSI_NAMES.TAG_DATE,
            KeySchema: [
              {
                AttributeName: TEST_CONSTANTS.ATTRIBUTE_NAMES.GSI2PK,
                KeyType: "HASH",
              },
              {
                AttributeName: TEST_CONSTANTS.ATTRIBUTE_NAMES.GSI2SK,
                KeyType: "RANGE",
              },
            ],
            Projection: {
              ProjectionType: "ALL",
            },
          }),
        ]),
      });
    });
  });

  // ==========================================================================
  // ENVIRONMENT-SPECIFIC CONFIGURATION TESTS
  // ==========================================================================

  describe("Environment-Specific Configuration", () => {
    test("should disable point-in-time recovery in development", () => {
      // Arrange
      const envConfig = createTestEnvConfig(
        BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        false
      );

      // Act
      const stack = new WebappDynamoDbStack(
        app,
        TEST_CONSTANTS.STACK_IDS.DYNAMODB_DEV,
        {
          env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
          envName: BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
          projectName: TEST_CONSTANTS.PROJECT_NAMES.WEBAPP,
          envConfig,
        }
      );

      const template = Template.fromStack(stack);

      // Assert
      template.hasResourceProperties("AWS::DynamoDB::Table", {
        PointInTimeRecoverySpecification: {
          PointInTimeRecoveryEnabled: false,
        },
      });
    });

    test("should enable point-in-time recovery in production", () => {
      // Arrange
      const envConfig = createTestEnvConfig(
        BASE_TEST_CONSTANTS.ENVIRONMENTS.PRODUCTION,
        true
      );

      // Act
      const stack = new WebappDynamoDbStack(
        app,
        TEST_CONSTANTS.STACK_IDS.DYNAMODB_PROD,
        {
          env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
          envName: BASE_TEST_CONSTANTS.ENVIRONMENTS.PRODUCTION,
          projectName: TEST_CONSTANTS.PROJECT_NAMES.WEBAPP,
          envConfig,
        }
      );

      const template = Template.fromStack(stack);

      // Assert
      template.hasResourceProperties("AWS::DynamoDB::Table", {
        PointInTimeRecoverySpecification: {
          PointInTimeRecoveryEnabled: true,
        },
      });
    });

    test("should disable deletion protection in development", () => {
      // Arrange
      const envConfig = createTestEnvConfig(
        BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        false
      );

      // Act
      const stack = new WebappDynamoDbStack(
        app,
        TEST_CONSTANTS.STACK_IDS.DYNAMODB_DEV,
        {
          env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
          envName: BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
          projectName: TEST_CONSTANTS.PROJECT_NAMES.WEBAPP,
          envConfig,
        }
      );

      const template = Template.fromStack(stack);

      // Assert
      template.hasResourceProperties("AWS::DynamoDB::Table", {
        DeletionProtectionEnabled: false,
      });
    });

    test("should enable deletion protection in production", () => {
      // Arrange
      const envConfig = createTestEnvConfig(
        BASE_TEST_CONSTANTS.ENVIRONMENTS.PRODUCTION,
        true
      );

      // Act
      const stack = new WebappDynamoDbStack(
        app,
        TEST_CONSTANTS.STACK_IDS.DYNAMODB_PROD,
        {
          env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
          envName: BASE_TEST_CONSTANTS.ENVIRONMENTS.PRODUCTION,
          projectName: TEST_CONSTANTS.PROJECT_NAMES.WEBAPP,
          envConfig,
        }
      );

      const template = Template.fromStack(stack);

      // Assert
      template.hasResourceProperties("AWS::DynamoDB::Table", {
        DeletionProtectionEnabled: true,
      });
    });

    test("should use DESTROY removal policy in development", () => {
      // Arrange
      const envConfig = createTestEnvConfig(
        BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        false
      );

      // Act
      const stack = new WebappDynamoDbStack(
        app,
        TEST_CONSTANTS.STACK_IDS.DYNAMODB_DEV,
        {
          env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
          envName: BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
          projectName: TEST_CONSTANTS.PROJECT_NAMES.WEBAPP,
          envConfig,
        }
      );

      const template = Template.fromStack(stack);

      // Assert
      const resources = template.findResources("AWS::DynamoDB::Table");
      const tableResource = Object.values(resources)[0];
      expect(tableResource.DeletionPolicy).toBe("Delete");
    });

    test("should use RETAIN removal policy in production", () => {
      // Arrange
      const envConfig = createTestEnvConfig(
        BASE_TEST_CONSTANTS.ENVIRONMENTS.PRODUCTION,
        true
      );

      // Act
      const stack = new WebappDynamoDbStack(
        app,
        TEST_CONSTANTS.STACK_IDS.DYNAMODB_PROD,
        {
          env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
          envName: BASE_TEST_CONSTANTS.ENVIRONMENTS.PRODUCTION,
          projectName: TEST_CONSTANTS.PROJECT_NAMES.WEBAPP,
          envConfig,
        }
      );

      const template = Template.fromStack(stack);

      // Assert
      const resources = template.findResources("AWS::DynamoDB::Table");
      const tableResource = Object.values(resources)[0];
      expect(tableResource.DeletionPolicy).toBe("Retain");
    });
  });

  // ==========================================================================
  // S3 ASSETS BUCKET TESTS
  // ==========================================================================

  describe("S3 Assets Bucket", () => {
    test("should create S3 bucket for article assets", () => {
      // Arrange
      const envConfig = createTestEnvConfig(
        BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT
      );

      // Act
      const stack = new WebappDynamoDbStack(
        app,
        TEST_CONSTANTS.STACK_IDS.DYNAMODB,
        {
          env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
          envName: BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
          projectName: TEST_CONSTANTS.PROJECT_NAMES.WEBAPP,
          envConfig,
        }
      );

      const template = Template.fromStack(stack);

      // Assert
      template.resourceCountIs(
        "AWS::S3::Bucket",
        TEST_CONSTANTS.RESOURCE_COUNTS.BUCKET
      );

      template.hasResourceProperties("AWS::S3::Bucket", {
        BucketName: TEST_CONSTANTS.BUCKET_NAMES.ASSETS_DEV,
      });
    });

    test("should enable versioning on assets bucket", () => {
      // Arrange
      const envConfig = createTestEnvConfig(
        BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT
      );

      // Act
      const stack = new WebappDynamoDbStack(
        app,
        TEST_CONSTANTS.STACK_IDS.DYNAMODB,
        {
          env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
          envName: BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
          projectName: TEST_CONSTANTS.PROJECT_NAMES.WEBAPP,
          envConfig,
        }
      );

      const template = Template.fromStack(stack);

      // Assert
      template.hasResourceProperties("AWS::S3::Bucket", {
        VersioningConfiguration: {
          Status: "Enabled",
        },
      });
    });

    test("should block all public access on assets bucket", () => {
      // Arrange
      const envConfig = createTestEnvConfig(
        BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT
      );

      // Act
      const stack = new WebappDynamoDbStack(
        app,
        TEST_CONSTANTS.STACK_IDS.DYNAMODB,
        {
          env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
          envName: BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
          projectName: TEST_CONSTANTS.PROJECT_NAMES.WEBAPP,
          envConfig,
        }
      );

      const template = Template.fromStack(stack);

      // Assert
      template.hasResourceProperties("AWS::S3::Bucket", {
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          BlockPublicPolicy: true,
          IgnorePublicAcls: true,
          RestrictPublicBuckets: true,
        },
      });
    });

    test("should configure CORS for Next.js uploads", () => {
      // Arrange
      const envConfig = createTestEnvConfig(
        BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT
      );

      // Act
      const stack = new WebappDynamoDbStack(
        app,
        TEST_CONSTANTS.STACK_IDS.DYNAMODB,
        {
          env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
          envName: BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
          projectName: TEST_CONSTANTS.PROJECT_NAMES.WEBAPP,
          envConfig,
        }
      );

      const template = Template.fromStack(stack);

      // Assert
      template.hasResourceProperties("AWS::S3::Bucket", {
        CorsConfiguration: {
          CorsRules: Match.arrayWith([
            Match.objectLike({
              AllowedMethods: Match.arrayWith(["GET", "PUT", "POST"]),
              AllowedOrigins: Match.arrayWith(["http://localhost:3000"]),
            }),
          ]),
        },
      });
    });

    test("should configure lifecycle rules for old versions", () => {
      // Arrange
      const envConfig = createTestEnvConfig(
        BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT
      );

      // Act
      const stack = new WebappDynamoDbStack(
        app,
        TEST_CONSTANTS.STACK_IDS.DYNAMODB,
        {
          env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
          envName: BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
          projectName: TEST_CONSTANTS.PROJECT_NAMES.WEBAPP,
          envConfig,
        }
      );

      const template = Template.fromStack(stack);

      // Assert
      template.hasResourceProperties("AWS::S3::Bucket", {
        LifecycleConfiguration: {
          Rules: Match.arrayWith([
            Match.objectLike({
              Id: "archive-old-versions",
              Status: "Enabled",
              NoncurrentVersionExpiration: {
                NoncurrentDays: 30,
              },
            }),
          ]),
        },
      });
    });
  });

  // ==========================================================================
  // TAGGING TESTS
  // ==========================================================================

  describe("Resource Tagging", () => {
    test("should apply standard tags to DynamoDB table", () => {
      // Arrange
      const envConfig = createTestEnvConfig(
        BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT
      );

      // Act
      const stack = new WebappDynamoDbStack(
        app,
        TEST_CONSTANTS.STACK_IDS.DYNAMODB,
        {
          env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
          envName: BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
          projectName: TEST_CONSTANTS.PROJECT_NAMES.WEBAPP,
          envConfig,
        }
      );

      const template = Template.fromStack(stack);

      // Assert
      template.hasResourceProperties("AWS::DynamoDB::Table", {
        Tags: Match.arrayWith([
          { Key: "Environment", Value: BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT },
          { Key: "Project", Value: TEST_CONSTANTS.PROJECT_NAMES.WEBAPP },
          { Key: "Stack", Value: "WebappDynamoDB" },
          { Key: "Layer", Value: "Database" },
          { Key: "ManagedBy", Value: "CDK" },
        ]),
      });
    });

    test("should apply custom tags to DynamoDB table", () => {
      // Arrange
      const envConfig = createTestEnvConfig(
        BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT
      );

      // Act
      const stack = new WebappDynamoDbStack(
        app,
        TEST_CONSTANTS.STACK_IDS.DYNAMODB,
        {
          env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
          envName: BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
          projectName: TEST_CONSTANTS.PROJECT_NAMES.WEBAPP,
          envConfig,
        }
      );

      const template = Template.fromStack(stack);

      // Assert
      template.hasResourceProperties("AWS::DynamoDB::Table", {
        Tags: Match.arrayWith([
          { Key: "Purpose", Value: "Article storage for portfolio Next.js application" },
          { Key: "DataClassification", Value: "Public" },
          { Key: "Application", Value: "Portfolio" },
        ]),
      });
    });
  });

  // ==========================================================================
  // STACK OUTPUTS TESTS
  // ==========================================================================

  describe("Stack Outputs", () => {
    test("should create all required DynamoDB outputs", () => {
      // Arrange
      const envConfig = createTestEnvConfig(
        BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT
      );

      // Act
      const stack = new WebappDynamoDbStack(
        app,
        TEST_CONSTANTS.STACK_IDS.DYNAMODB,
        {
          env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
          envName: BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
          projectName: TEST_CONSTANTS.PROJECT_NAMES.WEBAPP,
          envConfig,
        }
      );

      const template = Template.fromStack(stack);

      // Assert
      template.hasOutput(TEST_CONSTANTS.OUTPUT_KEYS.TABLE_NAME, {
        Description: "DynamoDB table name for portfolio articles",
      });

      template.hasOutput(TEST_CONSTANTS.OUTPUT_KEYS.TABLE_ARN, {
        Description: "DynamoDB table ARN for IAM policies",
      });

      template.hasOutput(TEST_CONSTANTS.OUTPUT_KEYS.GSI1_NAME, {
        Value: TEST_CONSTANTS.GSI_NAMES.STATUS_DATE,
      });

      template.hasOutput(TEST_CONSTANTS.OUTPUT_KEYS.GSI2_NAME, {
        Value: TEST_CONSTANTS.GSI_NAMES.TAG_DATE,
      });
    });

    test("should create all required S3 outputs", () => {
      // Arrange
      const envConfig = createTestEnvConfig(
        BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT
      );

      // Act
      const stack = new WebappDynamoDbStack(
        app,
        TEST_CONSTANTS.STACK_IDS.DYNAMODB,
        {
          env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
          envName: BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
          projectName: TEST_CONSTANTS.PROJECT_NAMES.WEBAPP,
          envConfig,
        }
      );

      const template = Template.fromStack(stack);

      // Assert
      template.hasOutput(TEST_CONSTANTS.OUTPUT_KEYS.BUCKET_NAME, {
        Description: "S3 bucket name for article images and media",
      });

      template.hasOutput(TEST_CONSTANTS.OUTPUT_KEYS.BUCKET_ARN, {
        Description: "S3 bucket ARN for IAM policies",
      });

      template.hasOutput(TEST_CONSTANTS.OUTPUT_KEYS.BUCKET_DOMAIN, {
        Description: "S3 bucket regional domain name for CloudFront origin",
      });
    });

    test("should export outputs in non-pipeline environments", () => {
      // Arrange
      const envConfig = createTestEnvConfig(
        BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT
      );

      // Act
      const stack = new WebappDynamoDbStack(
        app,
        TEST_CONSTANTS.STACK_IDS.DYNAMODB,
        {
          env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
          envName: BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
          projectName: TEST_CONSTANTS.PROJECT_NAMES.WEBAPP,
          envConfig,
        }
      );

      const template = Template.fromStack(stack);

      // Assert
      template.hasOutput(TEST_CONSTANTS.OUTPUT_KEYS.TABLE_NAME, {
        Export: {
          Name: TEST_CONSTANTS.EXPORT_NAMES.DEV_TABLE_NAME,
        },
      });

      template.hasOutput(TEST_CONSTANTS.OUTPUT_KEYS.GSI1_NAME, {
        Export: {
          Name: TEST_CONSTANTS.EXPORT_NAMES.DEV_GSI1_NAME,
        },
      });
    });

    test("should output stream ARN when streams are enabled", () => {
      // Arrange
      const envConfig = createTestEnvConfig(
        BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT
      );

      // Act
      const stack = new WebappDynamoDbStack(
        app,
        TEST_CONSTANTS.STACK_IDS.DYNAMODB,
        {
          env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
          envName: BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
          projectName: TEST_CONSTANTS.PROJECT_NAMES.WEBAPP,
          envConfig,
        }
      );

      const template = Template.fromStack(stack);

      // Assert
      template.hasOutput(TEST_CONSTANTS.OUTPUT_KEYS.STREAM_ARN, {
        Description: "DynamoDB stream ARN for Lambda triggers and CDC",
      });
    });
  });

  // ==========================================================================
  // PUBLIC INTERFACE TESTS
  // ==========================================================================

  describe("Public Interface", () => {
    test("should expose articlesTable property", () => {
      // Arrange
      const envConfig = createTestEnvConfig(
        BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT
      );

      // Act
      const stack = new WebappDynamoDbStack(
        app,
        TEST_CONSTANTS.STACK_IDS.DYNAMODB,
        {
          env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
          envName: BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
          projectName: TEST_CONSTANTS.PROJECT_NAMES.WEBAPP,
          envConfig,
        }
      );

      // Assert
      expect(stack.articlesTable).toBeDefined();
      expect(stack.articlesTable.tableName).toBe(
        TEST_CONSTANTS.TABLE_NAMES.FULL_DEV
      );
    });

    test("should expose assetsBucket property", () => {
      // Arrange
      const envConfig = createTestEnvConfig(
        BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT
      );

      // Act
      const stack = new WebappDynamoDbStack(
        app,
        TEST_CONSTANTS.STACK_IDS.DYNAMODB,
        {
          env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
          envName: BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
          projectName: TEST_CONSTANTS.PROJECT_NAMES.WEBAPP,
          envConfig,
        }
      );

      // Assert
      expect(stack.assetsBucket).toBeDefined();
      expect(stack.assetsBucket.bucketName).toBe(
        TEST_CONSTANTS.BUCKET_NAMES.ASSETS_DEV
      );
    });
  });
});
