/** @format */
/// <reference types="jest" />

import * as cdk from "aws-cdk-lib";
import * as ecr from "aws-cdk-lib/aws-ecr";
import { Template, Match } from "aws-cdk-lib/assertions";

import { WebappEcrStack } from "../../../../lib/stacks/webapp/ecr-stack";
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
    pipelineAccount: TEST_CONSTANTS.ACCOUNTS.PIPELINE,
  };
}

// ============================================================================
// WEBAPP ECR STACK TESTS
// ============================================================================

describe("WebappEcrStack", () => {
  let app: cdk.App;

  beforeEach(() => {
    app = createTestApp();
  });

  // ==========================================================================
  // REPOSITORY CREATION TESTS
  // ==========================================================================

  describe("Repository Creation", () => {
    test("should create ECR repository with default configuration", () => {
      // Arrange
      const envConfig = createTestEnvConfig(
        BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT
      );

      // Act
      const stack = new WebappEcrStack(app, TEST_CONSTANTS.STACK_IDS.ECR, {
        env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
        envName: BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        projectName: TEST_CONSTANTS.PROJECT_NAMES.WEBAPP,
        envConfig,
      });

      const template = Template.fromStack(stack);

      // Assert
      template.resourceCountIs(
        "AWS::ECR::Repository",
        TEST_CONSTANTS.RESOURCE_COUNTS.REPOSITORY
      );

      template.hasResourceProperties("AWS::ECR::Repository", {
        RepositoryName: TEST_CONSTANTS.REPOSITORY_NAMES.DEFAULT,
        ImageScanningConfiguration: {
          ScanOnPush: true,
        },
      });
    });

    test("should use custom repository name when provided", () => {
      // Arrange
      const envConfig = createTestEnvConfig(
        BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT
      );
      const customRepoName = TEST_CONSTANTS.REPOSITORY_NAMES.CUSTOM;

      // Act
      const stack = new WebappEcrStack(
        app,
        TEST_CONSTANTS.STACK_IDS.ECR_CUSTOM,
        {
          env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
          envName: BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
          projectName: TEST_CONSTANTS.PROJECT_NAMES.WEBAPP,
          envConfig,
          repositoryName: customRepoName,
        }
      );

      const template = Template.fromStack(stack);

      // Assert
      template.hasResourceProperties("AWS::ECR::Repository", {
        RepositoryName: customRepoName,
      });
    });

    test("should enable image scanning on push", () => {
      // Arrange
      const envConfig = createTestEnvConfig(
        BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT
      );

      // Act
      const stack = new WebappEcrStack(app, TEST_CONSTANTS.STACK_IDS.ECR, {
        env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
        envName: BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        projectName: TEST_CONSTANTS.PROJECT_NAMES.WEBAPP,
        envConfig,
      });

      const template = Template.fromStack(stack);

      // Assert
      template.hasResourceProperties("AWS::ECR::Repository", {
        ImageScanningConfiguration: {
          ScanOnPush: true,
        },
      });
    });
  });

  // ==========================================================================
  // ENVIRONMENT-SPECIFIC CONFIGURATION TESTS
  // ==========================================================================

  describe("Environment-Specific Configuration", () => {
    test("should use MUTABLE tags in development environment", () => {
      // Arrange
      const envConfig = createTestEnvConfig(
        BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        false
      );

      // Act
      const stack = new WebappEcrStack(
        app,
        TEST_CONSTANTS.STACK_IDS.ECR_DEV,
        {
          env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
          envName: BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
          projectName: TEST_CONSTANTS.PROJECT_NAMES.WEBAPP,
          envConfig,
        }
      );

      const template = Template.fromStack(stack);

      // Assert
      template.hasResourceProperties("AWS::ECR::Repository", {
        ImageTagMutability: "MUTABLE",
      });
    });

    test("should use IMMUTABLE tags in production environment", () => {
      // Arrange
      const envConfig = createTestEnvConfig(
        BASE_TEST_CONSTANTS.ENVIRONMENTS.PRODUCTION,
        true
      );

      // Act
      const stack = new WebappEcrStack(
        app,
        TEST_CONSTANTS.STACK_IDS.ECR_PROD,
        {
          env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
          envName: BASE_TEST_CONSTANTS.ENVIRONMENTS.PRODUCTION,
          projectName: TEST_CONSTANTS.PROJECT_NAMES.WEBAPP,
          envConfig,
        }
      );

      const template = Template.fromStack(stack);

      // Assert
      template.hasResourceProperties("AWS::ECR::Repository", {
        ImageTagMutability: "IMMUTABLE",
      });
    });

    test("should keep 10 images in development environment", () => {
      // Arrange
      const envConfig = createTestEnvConfig(
        BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        false
      );

      // Act
      const stack = new WebappEcrStack(
        app,
        TEST_CONSTANTS.STACK_IDS.ECR_DEV,
        {
          env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
          envName: BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
          projectName: TEST_CONSTANTS.PROJECT_NAMES.WEBAPP,
          envConfig,
        }
      );

      const template = Template.fromStack(stack);

      // Assert
      template.hasResourceProperties("AWS::ECR::Repository", {
        LifecyclePolicy: {
          LifecyclePolicyText: Match.serializedJson(
            Match.objectLike({
              rules: Match.arrayWith([
                Match.objectLike({
                  selection: Match.objectLike({
                    countNumber: TEST_CONSTANTS.LIFECYCLE.DEV_MAX_IMAGES,
                    countType: "imageCountMoreThan",
                  }),
                }),
              ]),
            })
          ),
        },
      });
    });

    test("should keep 20 images in production environment", () => {
      // Arrange
      const envConfig = createTestEnvConfig(
        BASE_TEST_CONSTANTS.ENVIRONMENTS.PRODUCTION,
        true
      );

      // Act
      const stack = new WebappEcrStack(
        app,
        TEST_CONSTANTS.STACK_IDS.ECR_PROD,
        {
          env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
          envName: BASE_TEST_CONSTANTS.ENVIRONMENTS.PRODUCTION,
          projectName: TEST_CONSTANTS.PROJECT_NAMES.WEBAPP,
          envConfig,
        }
      );

      const template = Template.fromStack(stack);

      // Assert
      template.hasResourceProperties("AWS::ECR::Repository", {
        LifecyclePolicy: {
          LifecyclePolicyText: Match.serializedJson(
            Match.objectLike({
              rules: Match.arrayWith([
                Match.objectLike({
                  selection: Match.objectLike({
                    countNumber: TEST_CONSTANTS.LIFECYCLE.PROD_MAX_IMAGES,
                  }),
                }),
              ]),
            })
          ),
        },
      });
    });

    test("should use DESTROY removal policy in development", () => {
      // Arrange
      const envConfig = createTestEnvConfig(
        BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        false
      );

      // Act
      const stack = new WebappEcrStack(
        app,
        TEST_CONSTANTS.STACK_IDS.ECR_DEV,
        {
          env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
          envName: BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
          projectName: TEST_CONSTANTS.PROJECT_NAMES.WEBAPP,
          envConfig,
        }
      );

      const template = Template.fromStack(stack);

      // Assert
      const resources = template.findResources("AWS::ECR::Repository");
      const repositoryResource = Object.values(resources)[0];
      expect(repositoryResource.DeletionPolicy).toBe("Delete");
    });

    test("should use RETAIN removal policy in production", () => {
      // Arrange
      const envConfig = createTestEnvConfig(
        BASE_TEST_CONSTANTS.ENVIRONMENTS.PRODUCTION,
        true
      );

      // Act
      const stack = new WebappEcrStack(
        app,
        TEST_CONSTANTS.STACK_IDS.ECR_PROD,
        {
          env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
          envName: BASE_TEST_CONSTANTS.ENVIRONMENTS.PRODUCTION,
          projectName: TEST_CONSTANTS.PROJECT_NAMES.WEBAPP,
          envConfig,
        }
      );

      const template = Template.fromStack(stack);

      // Assert
      const resources = template.findResources("AWS::ECR::Repository");
      const repositoryResource = Object.values(resources)[0];
      expect(repositoryResource.DeletionPolicy).toBe("Retain");
    });
  });

  // ==========================================================================
  // LIFECYCLE POLICY TESTS
  // ==========================================================================

  describe("Lifecycle Policies", () => {
    test("should configure lifecycle policy with correct priority", () => {
      // Arrange
      const envConfig = createTestEnvConfig(
        BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT
      );

      // Act
      const stack = new WebappEcrStack(app, TEST_CONSTANTS.STACK_IDS.ECR, {
        env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
        envName: BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        projectName: TEST_CONSTANTS.PROJECT_NAMES.WEBAPP,
        envConfig,
      });

      const template = Template.fromStack(stack);

      // Assert
      template.hasResourceProperties("AWS::ECR::Repository", {
        LifecyclePolicy: {
          LifecyclePolicyText: Match.serializedJson(
            Match.objectLike({
              rules: Match.arrayWith([
                Match.objectLike({
                  rulePriority: TEST_CONSTANTS.LIFECYCLE.RULE_PRIORITY,
                }),
              ]),
            })
          ),
        },
      });
    });

    test("should apply lifecycle policy to all tags", () => {
      // Arrange
      const envConfig = createTestEnvConfig(
        BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT
      );

      // Act
      const stack = new WebappEcrStack(app, TEST_CONSTANTS.STACK_IDS.ECR, {
        env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
        envName: BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        projectName: TEST_CONSTANTS.PROJECT_NAMES.WEBAPP,
        envConfig,
      });

      const template = Template.fromStack(stack);

      // Assert
      template.hasResourceProperties("AWS::ECR::Repository", {
        LifecyclePolicy: {
          LifecyclePolicyText: Match.serializedJson(
            Match.objectLike({
              rules: Match.arrayWith([
                Match.objectLike({
                  selection: Match.objectLike({
                    tagStatus: TEST_CONSTANTS.LIFECYCLE.TAG_STATUS_ANY,
                  }),
                }),
              ]),
            })
          ),
        },
      });
    });

    test("should accept custom lifecycle rules", () => {
      // Arrange
      const envConfig = createTestEnvConfig(
        BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT
      );
      const customMaxImages = 15;

      // Act
      const stack = new WebappEcrStack(app, TEST_CONSTANTS.STACK_IDS.ECR, {
        env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
        envName: BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        projectName: TEST_CONSTANTS.PROJECT_NAMES.WEBAPP,
        envConfig,
        lifecycleRules: [
          {
            description: "Custom rule",
            maxImageCount: customMaxImages,
            rulePriority: 1,
            tagStatus: ecr.TagStatus.ANY,
          },
        ],
      });

      const template = Template.fromStack(stack);

      // Assert
      template.hasResourceProperties("AWS::ECR::Repository", {
        LifecyclePolicy: {
          LifecyclePolicyText: Match.serializedJson(
            Match.objectLike({
              rules: Match.arrayWith([
                Match.objectLike({
                  description: "Custom rule",
                  selection: Match.objectLike({
                    countNumber: customMaxImages,
                  }),
                }),
              ]),
            })
          ),
        },
      });
    });
  });

  // ==========================================================================
  // CROSS-ACCOUNT ACCESS TESTS
  // ==========================================================================

  describe("Cross-Account Access", () => {
    test("should grant pipeline account access when provided", () => {
      // Arrange
      const envConfig = createTestEnvConfig(
        BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT
      );

      // Act
      const stack = new WebappEcrStack(app, TEST_CONSTANTS.STACK_IDS.ECR, {
        env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
        envName: BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        projectName: TEST_CONSTANTS.PROJECT_NAMES.WEBAPP,
        envConfig,
        pipelineAccount: TEST_CONSTANTS.ACCOUNTS.PIPELINE,
      });

      const template = Template.fromStack(stack);

      // Assert
      template.hasResourceProperties("AWS::ECR::Repository", {
        RepositoryPolicyText: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Principal: Match.objectLike({
                AWS: Match.stringLikeRegexp(TEST_CONSTANTS.ACCOUNTS.PIPELINE),
              }),
              Action: Match.arrayWith([
                "ecr:BatchGetImage",
                "ecr:GetDownloadUrlForLayer",
                "ecr:PutImage",
              ]),
            }),
          ]),
        }),
      });
    });

    test("should not add repository policy when pipeline account is not provided", () => {
      // Arrange
      const envConfig = createTestEnvConfig(
        BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT
      );

      // Act
      const stack = new WebappEcrStack(app, TEST_CONSTANTS.STACK_IDS.ECR, {
        env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
        envName: BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        projectName: TEST_CONSTANTS.PROJECT_NAMES.WEBAPP,
        envConfig,
        pipelineAccount: undefined,
      });

      const template = Template.fromStack(stack);

      // Assert - Repository exists but no policy
      template.resourceCountIs(
        "AWS::ECR::Repository",
        TEST_CONSTANTS.RESOURCE_COUNTS.REPOSITORY
      );
      
      const resources = template.findResources("AWS::ECR::Repository");
      const repositoryResource = Object.values(resources)[0];
      
      // Policy should be undefined or empty
      if (repositoryResource.Properties.RepositoryPolicyText) {
        const policy = repositoryResource.Properties.RepositoryPolicyText;
        // If policy exists, it should have no statements
        expect(
          !policy.Statement || policy.Statement.length === 0
        ).toBeTruthy();
      }
    });
  });

  // ==========================================================================
  // TAGGING TESTS
  // ==========================================================================

  describe("Resource Tagging", () => {
    test("should apply standard tags to repository", () => {
      // Arrange
      const envConfig = createTestEnvConfig(
        BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT
      );

      // Act
      const stack = new WebappEcrStack(app, TEST_CONSTANTS.STACK_IDS.ECR, {
        env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
        envName: BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        projectName: TEST_CONSTANTS.PROJECT_NAMES.WEBAPP,
        envConfig,
      });

      const template = Template.fromStack(stack);

      // Assert
      template.hasResourceProperties("AWS::ECR::Repository", {
        Tags: Match.arrayWith([
          { Key: "Environment", Value: BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT },
          { Key: "Project", Value: TEST_CONSTANTS.PROJECT_NAMES.WEBAPP },
          { Key: "Stack", Value: "WebappEcr" },
          { Key: "Layer", Value: "Storage" },
          { Key: "ManagedBy", Value: "CDK" },
        ]),
      });
    });
  });

  // ==========================================================================
  // STACK OUTPUTS TESTS
  // ==========================================================================

  describe("Stack Outputs", () => {
    test("should create all required stack outputs", () => {
      // Arrange
      const envConfig = createTestEnvConfig(
        BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT
      );

      // Act
      const stack = new WebappEcrStack(app, TEST_CONSTANTS.STACK_IDS.ECR, {
        env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
        envName: BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        projectName: TEST_CONSTANTS.PROJECT_NAMES.WEBAPP,
        envConfig,
      });

      const template = Template.fromStack(stack);

      // Assert
      template.hasOutput(TEST_CONSTANTS.OUTPUT_KEYS.REPOSITORY_URI, {
        Description: "ECR repository URI for webapp container images",
      });

      template.hasOutput(TEST_CONSTANTS.OUTPUT_KEYS.REPOSITORY_ARN, {
        Description: "ECR repository ARN for IAM policies",
      });

      template.hasOutput(TEST_CONSTANTS.OUTPUT_KEYS.REPOSITORY_NAME, {
        Description: "ECR repository name",
      });
    });

    test("should export outputs in non-pipeline environments", () => {
      // Arrange
      const envConfig = createTestEnvConfig(
        BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT
      );

      // Act
      const stack = new WebappEcrStack(app, TEST_CONSTANTS.STACK_IDS.ECR, {
        env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
        envName: BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        projectName: TEST_CONSTANTS.PROJECT_NAMES.WEBAPP,
        envConfig,
      });

      const template = Template.fromStack(stack);

      // Assert
      template.hasOutput(TEST_CONSTANTS.OUTPUT_KEYS.REPOSITORY_URI, {
        Export: {
          Name: TEST_CONSTANTS.EXPORT_NAMES.DEV_URI,
        },
      });

      template.hasOutput(TEST_CONSTANTS.OUTPUT_KEYS.REPOSITORY_ARN, {
        Export: {
          Name: TEST_CONSTANTS.EXPORT_NAMES.DEV_ARN,
        },
      });

      template.hasOutput(TEST_CONSTANTS.OUTPUT_KEYS.REPOSITORY_NAME, {
        Export: {
          Name: TEST_CONSTANTS.EXPORT_NAMES.DEV_NAME,
        },
      });
    });

    test("should not export outputs in pipeline environment", () => {
      // Arrange
      const envConfig = createTestEnvConfig(
        BASE_TEST_CONSTANTS.ENVIRONMENTS.PIPELINE
      );

      // Act
      const stack = new WebappEcrStack(app, TEST_CONSTANTS.STACK_IDS.ECR, {
        env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
        envName: BASE_TEST_CONSTANTS.ENVIRONMENTS.PIPELINE,
        projectName: TEST_CONSTANTS.PROJECT_NAMES.WEBAPP,
        envConfig,
      });

      const template = Template.fromStack(stack);
      const outputs = template.toJSON().Outputs;

      // Assert - Outputs exist but without Export property
      expect(outputs[TEST_CONSTANTS.OUTPUT_KEYS.REPOSITORY_URI]).toBeDefined();
      expect(
        outputs[TEST_CONSTANTS.OUTPUT_KEYS.REPOSITORY_URI].Export
      ).toBeUndefined();
    });
  });

  // ==========================================================================
  // PUBLIC INTERFACE TESTS
  // ==========================================================================

  describe("Public Interface", () => {
    test("should expose repository property", () => {
      // Arrange
      const envConfig = createTestEnvConfig(
        BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT
      );

      // Act
      const stack = new WebappEcrStack(app, TEST_CONSTANTS.STACK_IDS.ECR, {
        env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
        envName: BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        projectName: TEST_CONSTANTS.PROJECT_NAMES.WEBAPP,
        envConfig,
      });

      // Assert
      expect(stack.repository).toBeDefined();
      expect(stack.repository.repositoryName).toBe(
        TEST_CONSTANTS.REPOSITORY_NAMES.DEFAULT
      );
    });
  });
});
