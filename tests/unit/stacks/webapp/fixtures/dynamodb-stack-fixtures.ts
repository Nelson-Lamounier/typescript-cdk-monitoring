/** @format */

/**
 * WebappDynamoDbStack Test Fixtures
 *
 * Centralised configuration, constants, and helper functions for DynamoDB stack tests.
 * Prevents code duplication and provides consistent test setup.
 */

import * as cdk from "aws-cdk-lib";

import { WebappDynamoDbStack } from "../../../../../lib/stacks/webapp/dynamodb-stack";
import { EnvironmentConfig } from "../../../../../config/environments";
import {
  TEST_CONFIG,
  BASE_TEST_CONSTANTS,
} from "../../../utils/stack-test-utils";

// ============================================================================
// TEST CONSTANTS
// ============================================================================

/**
 * DynamoDB stack test constants
 * All hardcoded values used in tests should be defined here
 */
export const DYNAMODB_TEST_CONSTANTS = {
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
  CORS: {
    ALLOWED_METHODS: ["GET", "PUT", "POST"],
    ALLOWED_ORIGINS: ["http://localhost:3000"],
  },
  LIFECYCLE: {
    OLD_VERSION_EXPIRATION_DAYS: 30,
    RULE_ID: "archive-old-versions",
  },
  TAGS: {
    STANDARD: {
      STACK: "WebappDynamoDB",
      LAYER: "Database",
      MANAGED_BY: "CDK",
    },
    CUSTOM: {
      PURPOSE: "Article storage for portfolio Next.js application",
      DATA_CLASSIFICATION: "Public",
      APPLICATION: "Portfolio",
    },
  },
} as const;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Create minimal environment config for testing
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

/**
 * Create a WebappDynamoDbStack with default or custom properties
 *
 * @param app - CDK App instance
 * @param idOrProps - Stack ID string or partial props object
 * @param props - Additional props if first param is ID
 * @returns Configured WebappDynamoDbStack instance
 *
 * @example
 * // Development stack with defaults
 * const stack = createTestDynamoDbStack(app);
 *
 * @example
 * // Production stack
 * const stack = createTestDynamoDbStack(app, DYNAMODB_TEST_CONSTANTS.STACK_IDS.DYNAMODB_PROD);
 *
 * @example
 * // Custom configuration
 * const stack = createTestDynamoDbStack(app, "CustomStack", {
 *   projectName: "custom-project",
 * });
 */
export function createTestDynamoDbStack(
  app: cdk.App,
  idOrProps?: string | Partial<{
    env: cdk.Environment;
    envName: string;
    projectName: string;
    envConfig: EnvironmentConfig;
  }>,
  props?: Partial<{
    env: cdk.Environment;
    envName: string;
    projectName: string;
    envConfig: EnvironmentConfig;
  }>
): WebappDynamoDbStack {
  // Determine stack ID and props
  let stackId: string;
  let stackProps: Partial<{
    env: cdk.Environment;
    envName: string;
    projectName: string;
    envConfig: EnvironmentConfig;
  }>;

  if (typeof idOrProps === "string") {
    stackId = idOrProps;
    stackProps = props || {};
  } else {
    stackId = DYNAMODB_TEST_CONSTANTS.STACK_IDS.DYNAMODB;
    stackProps = idOrProps || {};
  }

  // Determine environment based on stack ID
  const isProduction = stackId.toLowerCase().includes("prod");
  const envName = isProduction
    ? DYNAMODB_TEST_CONSTANTS.ENVIRONMENTS.PRODUCTION
    : DYNAMODB_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT;

  // Create environment config
  const envConfig = createTestEnvConfig(envName, isProduction);

  // Merge with defaults
  const finalProps = {
    env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
    envName,
    projectName: DYNAMODB_TEST_CONSTANTS.PROJECT_NAMES.WEBAPP,
    envConfig,
    ...stackProps,
  };

  return new WebappDynamoDbStack(app, stackId, finalProps);
}

/**
 * Test fixtures class for managing DynamoDB stack test setup
 */
export class DynamoDbStackTestFixtures {
  private app: cdk.App;

  constructor(app: cdk.App) {
    this.app = app;
  }

  /**
   * Create a development stack
   */
  createDevStack(): WebappDynamoDbStack {
    return createTestDynamoDbStack(
      this.app,
      DYNAMODB_TEST_CONSTANTS.STACK_IDS.DYNAMODB_DEV
    );
  }

  /**
   * Create a production stack
   */
  createProdStack(): WebappDynamoDbStack {
    return createTestDynamoDbStack(
      this.app,
      DYNAMODB_TEST_CONSTANTS.STACK_IDS.DYNAMODB_PROD
    );
  }

  /**
   * Create a custom stack with specific configuration
   */
  createCustomStack(
    stackId: string,
    overrides: Partial<{
      env: cdk.Environment;
      envName: string;
      projectName: string;
      envConfig: EnvironmentConfig;
    }>
  ): WebappDynamoDbStack {
    return createTestDynamoDbStack(this.app, stackId, overrides);
  }
}
