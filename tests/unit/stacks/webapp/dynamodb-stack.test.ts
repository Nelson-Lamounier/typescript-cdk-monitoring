/** @format */
/// <reference types="jest" />

/**
 * WebappDynamoDbStack Tests
 *
 * Comprehensive tests for the DynamoDB articles table stack:
 * - Table creation and configuration
 * - Global Secondary Indexes (GSI1, GSI2)
 * - Environment-specific settings (dev vs prod)
 * - S3 assets bucket configuration
 * - Resource tagging and outputs
 *
 * Pattern: Follows monitoring-efs-stack test structure
 * - Uses fixtures for constants and helpers
 * - No code duplication
 * - Clear Arrange-Act-Assert pattern
 */

import { Template, Match } from "aws-cdk-lib/assertions";

import { createTestApp } from "../../utils/stack-test-utils";

import {
  DYNAMODB_TEST_CONSTANTS,
  createTestDynamoDbStack,
} from "./fixtures/dynamodb-stack-fixtures";

// ============================================================================
// WEBAPP DYNAMODB STACK TESTS
// ============================================================================

describe("WebappDynamoDbStack", () => {
  // ==========================================================================
  // DYNAMODB TABLE CREATION TESTS
  // ==========================================================================

  describe("DynamoDB Table Creation", () => {
    let template: Template;

    beforeAll(() => {
      const app = createTestApp();
      const stack = createTestDynamoDbStack(app);
      template = Template.fromStack(stack);
    });

    // eslint-disable-next-line jest/expect-expect -- template.resourceCountIs throws on failure
    test("should create DynamoDB articles table with correct configuration", () => {
      template.resourceCountIs(
        "AWS::DynamoDB::Table",
        DYNAMODB_TEST_CONSTANTS.RESOURCE_COUNTS.TABLE
      );

      template.hasResourceProperties("AWS::DynamoDB::Table", {
        TableName: DYNAMODB_TEST_CONSTANTS.TABLE_NAMES.FULL_DEV,
        BillingMode: "PAY_PER_REQUEST",
        KeySchema: [
          {
            AttributeName: DYNAMODB_TEST_CONSTANTS.ATTRIBUTE_NAMES.PK,
            KeyType: "HASH",
          },
          {
            AttributeName: DYNAMODB_TEST_CONSTANTS.ATTRIBUTE_NAMES.SK,
            KeyType: "RANGE",
          },
        ],
      });
    });

    // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
    test("should define all required attribute definitions", () => {
      template.hasResourceProperties("AWS::DynamoDB::Table", {
        AttributeDefinitions: Match.arrayWith([
          {
            AttributeName: DYNAMODB_TEST_CONSTANTS.ATTRIBUTE_NAMES.PK,
            AttributeType: "S",
          },
          {
            AttributeName: DYNAMODB_TEST_CONSTANTS.ATTRIBUTE_NAMES.SK,
            AttributeType: "S",
          },
          {
            AttributeName: DYNAMODB_TEST_CONSTANTS.ATTRIBUTE_NAMES.GSI1PK,
            AttributeType: "S",
          },
          {
            AttributeName: DYNAMODB_TEST_CONSTANTS.ATTRIBUTE_NAMES.GSI1SK,
            AttributeType: "S",
          },
          {
            AttributeName: DYNAMODB_TEST_CONSTANTS.ATTRIBUTE_NAMES.GSI2PK,
            AttributeType: "S",
          },
          {
            AttributeName: DYNAMODB_TEST_CONSTANTS.ATTRIBUTE_NAMES.GSI2SK,
            AttributeType: "S",
          },
        ]),
      });
    });

    // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
    test("should use on-demand billing mode", () => {
      template.hasResourceProperties("AWS::DynamoDB::Table", {
        BillingMode: "PAY_PER_REQUEST",
      });
    });

    // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
    test("should enable DynamoDB Streams with NEW_AND_OLD_IMAGES", () => {
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
    let template: Template;

    beforeAll(() => {
      const app = createTestApp();
      const stack = createTestDynamoDbStack(app);
      template = Template.fromStack(stack);
    });

    // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
    test("should create GSI1 for querying by status and date", () => {
      template.hasResourceProperties("AWS::DynamoDB::Table", {
        GlobalSecondaryIndexes: Match.arrayWith([
          Match.objectLike({
            IndexName: DYNAMODB_TEST_CONSTANTS.GSI_NAMES.STATUS_DATE,
            KeySchema: [
              {
                AttributeName: DYNAMODB_TEST_CONSTANTS.ATTRIBUTE_NAMES.GSI1PK,
                KeyType: "HASH",
              },
              {
                AttributeName: DYNAMODB_TEST_CONSTANTS.ATTRIBUTE_NAMES.GSI1SK,
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

    // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
    test("should create GSI2 for querying by tag", () => {
      template.hasResourceProperties("AWS::DynamoDB::Table", {
        GlobalSecondaryIndexes: Match.arrayWith([
          Match.objectLike({
            IndexName: DYNAMODB_TEST_CONSTANTS.GSI_NAMES.TAG_DATE,
            KeySchema: [
              {
                AttributeName: DYNAMODB_TEST_CONSTANTS.ATTRIBUTE_NAMES.GSI2PK,
                KeyType: "HASH",
              },
              {
                AttributeName: DYNAMODB_TEST_CONSTANTS.ATTRIBUTE_NAMES.GSI2SK,
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
    let devTemplate: Template;
    let prodTemplate: Template;

    beforeAll(() => {
      const devApp = createTestApp();
      const devStack = createTestDynamoDbStack(
        devApp,
        DYNAMODB_TEST_CONSTANTS.STACK_IDS.DYNAMODB_DEV
      );
      devTemplate = Template.fromStack(devStack);

      const prodApp = createTestApp();
      const prodStack = createTestDynamoDbStack(
        prodApp,
        DYNAMODB_TEST_CONSTANTS.STACK_IDS.DYNAMODB_PROD
      );
      prodTemplate = Template.fromStack(prodStack);
    });

    test("should disable point-in-time recovery in development", () => {
      const resources = devTemplate.findResources("AWS::DynamoDB::Table");
      const tableResource = Object.values(resources)[0] as any;
      
      // When PITR is disabled, the property is undefined (not present in template)
      // CloudFormation treats undefined as false (disabled)
      expect(tableResource.Properties.PointInTimeRecoverySpecification).toBeUndefined();
    });

    // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
    test("should enable point-in-time recovery in production", () => {
      prodTemplate.hasResourceProperties("AWS::DynamoDB::Table", {
        PointInTimeRecoverySpecification: {
          PointInTimeRecoveryEnabled: true,
        },
      });
    });

    // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
    test("should disable deletion protection in development", () => {
      devTemplate.hasResourceProperties("AWS::DynamoDB::Table", {
        DeletionProtectionEnabled: false,
      });
    });

    // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
    test("should enable deletion protection in production", () => {
      prodTemplate.hasResourceProperties("AWS::DynamoDB::Table", {
        DeletionProtectionEnabled: true,
      });
    });

    test("should use DESTROY removal policy in development", () => {
      const resources = devTemplate.findResources("AWS::DynamoDB::Table");
      const tableResource = Object.values(resources)[0];
      expect(tableResource.DeletionPolicy).toBe("Delete");
    });

    test("should use RETAIN removal policy in production", () => {
      const resources = prodTemplate.findResources("AWS::DynamoDB::Table");
      const tableResource = Object.values(resources)[0];
      expect(tableResource.DeletionPolicy).toBe("Retain");
    });
  });

  // ==========================================================================
  // S3 ASSETS BUCKET TESTS
  // ==========================================================================

  describe("S3 Assets Bucket", () => {
    let template: Template;

    beforeAll(() => {
      const app = createTestApp();
      const stack = createTestDynamoDbStack(app);
      template = Template.fromStack(stack);
    });

    // eslint-disable-next-line jest/expect-expect -- template.resourceCountIs throws on failure
    test("should create S3 bucket for article assets", () => {
      template.resourceCountIs(
        "AWS::S3::Bucket",
        DYNAMODB_TEST_CONSTANTS.RESOURCE_COUNTS.BUCKET
      );

      template.hasResourceProperties("AWS::S3::Bucket", {
        BucketName: DYNAMODB_TEST_CONSTANTS.BUCKET_NAMES.ASSETS_DEV,
      });
    });

    // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
    test("should enable versioning on assets bucket", () => {
      template.hasResourceProperties("AWS::S3::Bucket", {
        VersioningConfiguration: {
          Status: "Enabled",
        },
      });
    });

    // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
    test("should block all public access on assets bucket", () => {
      template.hasResourceProperties("AWS::S3::Bucket", {
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          BlockPublicPolicy: true,
          IgnorePublicAcls: true,
          RestrictPublicBuckets: true,
        },
      });
    });

    // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
    test("should configure CORS for Next.js uploads", () => {
      template.hasResourceProperties("AWS::S3::Bucket", {
        CorsConfiguration: {
          CorsRules: Match.arrayWith([
            Match.objectLike({
              AllowedMethods: Match.arrayWith(
                [...DYNAMODB_TEST_CONSTANTS.CORS.ALLOWED_METHODS]
              ),
              AllowedOrigins: Match.arrayWith(
                [...DYNAMODB_TEST_CONSTANTS.CORS.ALLOWED_ORIGINS]
              ),
            }),
          ]),
        },
      });
    });

    // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
    test("should configure lifecycle rules for old versions", () => {
      template.hasResourceProperties("AWS::S3::Bucket", {
        LifecycleConfiguration: {
          Rules: Match.arrayWith([
            Match.objectLike({
              Id: DYNAMODB_TEST_CONSTANTS.LIFECYCLE.RULE_ID,
              Status: "Enabled",
              NoncurrentVersionExpiration: {
                NoncurrentDays:
                  DYNAMODB_TEST_CONSTANTS.LIFECYCLE.OLD_VERSION_EXPIRATION_DAYS,
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
    let template: Template;

    beforeAll(() => {
      const app = createTestApp();
      const stack = createTestDynamoDbStack(app);
      template = Template.fromStack(stack);
    });

    test("should apply standard tags to DynamoDB table", () => {
      const resources = template.findResources("AWS::DynamoDB::Table");
      const tableResource = Object.values(resources)[0] as any;
      const tags = tableResource.Properties.Tags;
      
      // Verify each required tag is present
      expect(tags).toContainEqual({ Key: "Environment", Value: DYNAMODB_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT });
      expect(tags).toContainEqual({ Key: "Project", Value: DYNAMODB_TEST_CONSTANTS.PROJECT_NAMES.WEBAPP });
      expect(tags).toContainEqual({ Key: "Stack", Value: DYNAMODB_TEST_CONSTANTS.TAGS.STANDARD.STACK });
      expect(tags).toContainEqual({ Key: "Layer", Value: DYNAMODB_TEST_CONSTANTS.TAGS.STANDARD.LAYER });
      expect(tags).toContainEqual({ Key: "ManagedBy", Value: DYNAMODB_TEST_CONSTANTS.TAGS.STANDARD.MANAGED_BY });
    });

    // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
    test("should apply custom tags to DynamoDB table", () => {
      const resources = template.findResources("AWS::DynamoDB::Table");
      const tableResource = Object.values(resources)[0] as any;
      const tags = tableResource.Properties.Tags;
      
      // Verify custom tags are present
      expect(tags).toContainEqual({ Key: "Purpose", Value: DYNAMODB_TEST_CONSTANTS.TAGS.CUSTOM.PURPOSE });
      expect(tags).toContainEqual({ Key: "DataClassification", Value: DYNAMODB_TEST_CONSTANTS.TAGS.CUSTOM.DATA_CLASSIFICATION });
      expect(tags).toContainEqual({ Key: "Application", Value: DYNAMODB_TEST_CONSTANTS.TAGS.CUSTOM.APPLICATION });
    });
  });

  // ==========================================================================
  // STACK OUTPUTS TESTS
  // ==========================================================================

  describe("Stack Outputs", () => {
    let template: Template;

    beforeAll(() => {
      const app = createTestApp();
      const stack = createTestDynamoDbStack(app);
      template = Template.fromStack(stack);
    });

    // eslint-disable-next-line jest/expect-expect -- template.hasOutput throws on failure
    test("should create all required DynamoDB outputs", () => {
      template.hasOutput(DYNAMODB_TEST_CONSTANTS.OUTPUT_KEYS.TABLE_NAME, {
        Description: "DynamoDB table name for portfolio articles",
      });

      template.hasOutput(DYNAMODB_TEST_CONSTANTS.OUTPUT_KEYS.TABLE_ARN, {
        Description: "DynamoDB table ARN for IAM policies",
      });

      template.hasOutput(DYNAMODB_TEST_CONSTANTS.OUTPUT_KEYS.GSI1_NAME, {
        Value: DYNAMODB_TEST_CONSTANTS.GSI_NAMES.STATUS_DATE,
      });

      template.hasOutput(DYNAMODB_TEST_CONSTANTS.OUTPUT_KEYS.GSI2_NAME, {
        Value: DYNAMODB_TEST_CONSTANTS.GSI_NAMES.TAG_DATE,
      });
    });

    // eslint-disable-next-line jest/expect-expect -- template.hasOutput throws on failure
    test("should create all required S3 outputs", () => {
      template.hasOutput(DYNAMODB_TEST_CONSTANTS.OUTPUT_KEYS.BUCKET_NAME, {
        Description: "S3 bucket name for article images and media",
      });

      template.hasOutput(DYNAMODB_TEST_CONSTANTS.OUTPUT_KEYS.BUCKET_ARN, {
        Description: "S3 bucket ARN for IAM policies",
      });

      template.hasOutput(DYNAMODB_TEST_CONSTANTS.OUTPUT_KEYS.BUCKET_DOMAIN, {
        Description: "S3 bucket regional domain name for CloudFront origin",
      });
    });

    // eslint-disable-next-line jest/expect-expect -- template.hasOutput throws on failure
    test("should export outputs in non-pipeline environments", () => {
      template.hasOutput(DYNAMODB_TEST_CONSTANTS.OUTPUT_KEYS.TABLE_NAME, {
        Export: {
          Name: DYNAMODB_TEST_CONSTANTS.EXPORT_NAMES.DEV_TABLE_NAME,
        },
      });

      template.hasOutput(DYNAMODB_TEST_CONSTANTS.OUTPUT_KEYS.GSI1_NAME, {
        Export: {
          Name: DYNAMODB_TEST_CONSTANTS.EXPORT_NAMES.DEV_GSI1_NAME,
        },
      });
    });

    // eslint-disable-next-line jest/expect-expect -- template.hasOutput throws on failure
    test("should output stream ARN when streams are enabled", () => {
      template.hasOutput(DYNAMODB_TEST_CONSTANTS.OUTPUT_KEYS.STREAM_ARN, {
        Description: "DynamoDB stream ARN for Lambda triggers and CDC",
      });
    });
  });

  // ==========================================================================
  // PUBLIC INTERFACE TESTS
  // ==========================================================================

  describe("Public Interface", () => {
    let stack: any;

    beforeAll(() => {
      const app = createTestApp();
      stack = createTestDynamoDbStack(app);
    });

    test("should expose articlesTable property", () => {
      expect(stack.articlesTable).toBeDefined();
      // Use Template assertion instead of direct property comparison to handle CDK tokens
      const template = Template.fromStack(stack);
      template.hasResourceProperties("AWS::DynamoDB::Table", {
        TableName: DYNAMODB_TEST_CONSTANTS.TABLE_NAMES.FULL_DEV,
      });
    });

    test("should expose assetsBucket property", () => {
      expect(stack.assetsBucket).toBeDefined();
      // Use Template assertion instead of direct property comparison to handle CDK tokens
      const template = Template.fromStack(stack);
      template.hasResourceProperties("AWS::S3::Bucket", {
        BucketName: DYNAMODB_TEST_CONSTANTS.BUCKET_NAMES.ASSETS_DEV,
      });
    });
  });
});
