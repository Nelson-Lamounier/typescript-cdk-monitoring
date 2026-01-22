/** @format */

/**
 * WebappEcrStack Test Fixtures
 *
 * Centralised configuration, constants, and helper functions for ECR stack tests.
 * Prevents code duplication and provides consistent test setup.
 */

import * as cdk from "aws-cdk-lib";

import { WebappEcrStack } from "../../../../../lib/stacks/webapp/ecr-stack";
import { EnvironmentConfig } from "../../../../../config/environments";
import {
  TEST_CONFIG,
  BASE_TEST_CONSTANTS,
} from "../../../utils/stack-test-utils";

// ============================================================================
// TEST CONSTANTS
// ============================================================================

/**
 * ECR stack test constants
 * All hardcoded values used in tests should be defined here
 */
export const ECR_TEST_CONSTANTS = {
  ...BASE_TEST_CONSTANTS,
  PROJECT_NAMES: {
    WEBAPP: "webapp",
    CUSTOM: "custom-project",
  },
  REPOSITORY_NAMES: {
    DEFAULT: "webapp-webapp",
    CUSTOM: "custom-repo",
  },
  ACCOUNTS: {
    CURRENT: "123456789012",
    PIPELINE: "999888777666",
  },
  LIFECYCLE: {
    DEV_MAX_IMAGES: 10,
    PROD_MAX_IMAGES: 20,
    CUSTOM_MAX_IMAGES: 15,
    RULE_PRIORITY: 1,
    TAG_STATUS_ANY: "any",
  },
  RESOURCE_COUNTS: {
    REPOSITORY: 1,
    OUTPUTS: 3,
  },
  STACK_IDS: {
    ...BASE_TEST_CONSTANTS.STACK_IDS,
    ECR: "TestEcrStack",
    ECR_DEV: "DevEcrStack",
    ECR_PROD: "ProdEcrStack",
    ECR_CUSTOM: "CustomEcrStack",
  },
  OUTPUT_KEYS: {
    REPOSITORY_URI: "RepositoryUri",
    REPOSITORY_ARN: "RepositoryArn",
    REPOSITORY_NAME: "RepositoryName",
  },
  EXPORT_NAMES: {
    DEV_URI: "development-webapp-ecr-repository-uri",
    DEV_ARN: "development-webapp-ecr-repository-arn",
    DEV_NAME: "development-webapp-ecr-repository-name",
    PROD_URI: "production-webapp-ecr-repository-uri",
  },
  IMAGE_TAG_MUTABILITY: {
    MUTABLE: "MUTABLE",
    IMMUTABLE: "IMMUTABLE",
  },
  TAGS: {
    STANDARD: {
      STACK: "WebappEcr",
      LAYER: "Storage",
      MANAGED_BY: "CDK",
    },
  },
  ECR_ACTIONS: {
    BATCH_GET_IMAGE: "ecr:BatchGetImage",
    GET_DOWNLOAD_URL: "ecr:GetDownloadUrlForLayer",
    PUT_IMAGE: "ecr:PutImage",
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
    pipelineAccount: ECR_TEST_CONSTANTS.ACCOUNTS.PIPELINE,
  };
}

/**
 * Create a WebappEcrStack with default or custom properties
 *
 * @param app - CDK App instance
 * @param idOrProps - Stack ID string or partial props object
 * @param props - Additional props if first param is ID
 * @returns Configured WebappEcrStack instance
 *
 * @example
 * // Development stack with defaults
 * const stack = createTestEcrStack(app);
 *
 * @example
 * // Production stack
 * const stack = createTestEcrStack(app, ECR_TEST_CONSTANTS.STACK_IDS.ECR_PROD);
 *
 * @example
 * // Custom configuration
 * const stack = createTestEcrStack(app, "CustomStack", {
 *   repositoryName: "custom-repo",
 * });
 */
export function createTestEcrStack(
  app: cdk.App,
  idOrProps?: string | Partial<{
    env: cdk.Environment;
    envName: string;
    projectName: string;
    envConfig: EnvironmentConfig;
    repositoryName?: string;
    pipelineAccount?: string;
    lifecycleRules?: any[];
  }>,
  props?: Partial<{
    env: cdk.Environment;
    envName: string;
    projectName: string;
    envConfig: EnvironmentConfig;
    repositoryName?: string;
    pipelineAccount?: string;
    lifecycleRules?: any[];
  }>
): WebappEcrStack {
  // Determine stack ID and props
  let stackId: string;
  let stackProps: Partial<{
    env: cdk.Environment;
    envName: string;
    projectName: string;
    envConfig: EnvironmentConfig;
    repositoryName?: string;
    pipelineAccount?: string;
    lifecycleRules?: any[];
  }>;

  if (typeof idOrProps === "string") {
    stackId = idOrProps;
    stackProps = props || {};
  } else {
    stackId = ECR_TEST_CONSTANTS.STACK_IDS.ECR;
    stackProps = idOrProps || {};
  }

  // Determine environment based on stack ID
  const isProduction = stackId.toLowerCase().includes("prod");
  const isPipeline = stackId.toLowerCase().includes("pipeline");
  let envName: string;

  if (isPipeline) {
    envName = ECR_TEST_CONSTANTS.ENVIRONMENTS.PIPELINE;
  } else if (isProduction) {
    envName = ECR_TEST_CONSTANTS.ENVIRONMENTS.PRODUCTION;
  } else {
    envName = ECR_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT;
  }

  // Create environment config
  const envConfig = createTestEnvConfig(envName, isProduction);

  // Merge with defaults
  const finalProps = {
    env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
    envName,
    projectName: ECR_TEST_CONSTANTS.PROJECT_NAMES.WEBAPP,
    envConfig,
    ...stackProps,
  };

  return new WebappEcrStack(app, stackId, finalProps);
}

/**
 * Test fixtures class for managing ECR stack test setup
 */
export class EcrStackTestFixtures {
  private app: cdk.App;

  constructor(app: cdk.App) {
    this.app = app;
  }

  /**
   * Create a development stack
   */
  createDevStack(): WebappEcrStack {
    return createTestEcrStack(
      this.app,
      ECR_TEST_CONSTANTS.STACK_IDS.ECR_DEV
    );
  }

  /**
   * Create a production stack
   */
  createProdStack(): WebappEcrStack {
    return createTestEcrStack(
      this.app,
      ECR_TEST_CONSTANTS.STACK_IDS.ECR_PROD
    );
  }

  /**
   * Create a pipeline stack
   */
  createPipelineStack(): WebappEcrStack {
    const envConfig = createTestEnvConfig(
      ECR_TEST_CONSTANTS.ENVIRONMENTS.PIPELINE
    );
    return createTestEcrStack(this.app, ECR_TEST_CONSTANTS.STACK_IDS.ECR, {
      envName: ECR_TEST_CONSTANTS.ENVIRONMENTS.PIPELINE,
      envConfig,
    });
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
      repositoryName?: string;
      pipelineAccount?: string;
      lifecycleRules?: any[];
    }>
  ): WebappEcrStack {
    return createTestEcrStack(this.app, stackId, overrides);
  }
}
