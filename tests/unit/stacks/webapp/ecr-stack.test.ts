/** @format */
/// <reference types="jest" />

/**
 * WebappEcrStack Tests
 *
 * Comprehensive tests for the ECR repository stack:
 * - Repository creation and configuration
 * - Environment-specific settings (dev vs prod)
 * - Lifecycle policies
 * - Cross-account access
 * - Resource tagging and outputs
 *
 * Pattern: Follows monitoring-efs-stack test structure
 * - Uses fixtures for constants and helpers
 * - No code duplication
 * - Clear Arrange-Act-Assert pattern
 */

import * as ecr from "aws-cdk-lib/aws-ecr";
import { Template, Match } from "aws-cdk-lib/assertions";

import { createTestApp } from "../../utils/stack-test-utils";

import {
  ECR_TEST_CONSTANTS,
  createTestEcrStack,
} from "./fixtures/ecr-stack-fixtures";

// ============================================================================
// WEBAPP ECR STACK TESTS
// ============================================================================

describe("WebappEcrStack", () => {
  // ==========================================================================
  // REPOSITORY CREATION TESTS
  // ==========================================================================

  describe("Repository Creation", () => {
    let template: Template;

    beforeAll(() => {
      const app = createTestApp();
      const stack = createTestEcrStack(app);
      template = Template.fromStack(stack);
    });

    // eslint-disable-next-line jest/expect-expect -- template.resourceCountIs throws on failure
    test("should create ECR repository with default configuration", () => {
      template.resourceCountIs(
        "AWS::ECR::Repository",
        ECR_TEST_CONSTANTS.RESOURCE_COUNTS.REPOSITORY
      );

      template.hasResourceProperties("AWS::ECR::Repository", {
        RepositoryName: ECR_TEST_CONSTANTS.REPOSITORY_NAMES.DEFAULT,
        ImageScanningConfiguration: {
          ScanOnPush: true,
        },
      });
    });

    // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
    test("should use custom repository name when provided", () => {
      const app = createTestApp();
      const stack = createTestEcrStack(
        app,
        ECR_TEST_CONSTANTS.STACK_IDS.ECR_CUSTOM,
        {
          repositoryName: ECR_TEST_CONSTANTS.REPOSITORY_NAMES.CUSTOM,
        }
      );
      const customTemplate = Template.fromStack(stack);

      customTemplate.hasResourceProperties("AWS::ECR::Repository", {
        RepositoryName: ECR_TEST_CONSTANTS.REPOSITORY_NAMES.CUSTOM,
      });
    });

    // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
    test("should enable image scanning on push", () => {
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
    let devTemplate: Template;
    let prodTemplate: Template;

    beforeAll(() => {
      const devApp = createTestApp();
      const devStack = createTestEcrStack(
        devApp,
        ECR_TEST_CONSTANTS.STACK_IDS.ECR_DEV
      );
      devTemplate = Template.fromStack(devStack);

      const prodApp = createTestApp();
      const prodStack = createTestEcrStack(
        prodApp,
        ECR_TEST_CONSTANTS.STACK_IDS.ECR_PROD
      );
      prodTemplate = Template.fromStack(prodStack);
    });

    // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
    test("should use MUTABLE tags in development environment", () => {
      devTemplate.hasResourceProperties("AWS::ECR::Repository", {
        ImageTagMutability: ECR_TEST_CONSTANTS.IMAGE_TAG_MUTABILITY.MUTABLE,
      });
    });

    // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
    test("should use IMMUTABLE tags in production environment", () => {
      prodTemplate.hasResourceProperties("AWS::ECR::Repository", {
        ImageTagMutability: ECR_TEST_CONSTANTS.IMAGE_TAG_MUTABILITY.IMMUTABLE,
      });
    });

    // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
    test("should keep 10 images in development environment", () => {
      devTemplate.hasResourceProperties("AWS::ECR::Repository", {
        LifecyclePolicy: {
          LifecyclePolicyText: Match.serializedJson(
            Match.objectLike({
              rules: Match.arrayWith([
                Match.objectLike({
                  selection: Match.objectLike({
                    countNumber: ECR_TEST_CONSTANTS.LIFECYCLE.DEV_MAX_IMAGES,
                    countType: "imageCountMoreThan",
                  }),
                }),
              ]),
            })
          ),
        },
      });
    });

    // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
    test("should keep 20 images in production environment", () => {
      prodTemplate.hasResourceProperties("AWS::ECR::Repository", {
        LifecyclePolicy: {
          LifecyclePolicyText: Match.serializedJson(
            Match.objectLike({
              rules: Match.arrayWith([
                Match.objectLike({
                  selection: Match.objectLike({
                    countNumber: ECR_TEST_CONSTANTS.LIFECYCLE.PROD_MAX_IMAGES,
                  }),
                }),
              ]),
            })
          ),
        },
      });
    });

    test("should use DESTROY removal policy in development", () => {
      const resources = devTemplate.findResources("AWS::ECR::Repository");
      const repositoryResource = Object.values(resources)[0];
      expect(repositoryResource.DeletionPolicy).toBe("Delete");
    });

    test("should use RETAIN removal policy in production", () => {
      const resources = prodTemplate.findResources("AWS::ECR::Repository");
      const repositoryResource = Object.values(resources)[0];
      expect(repositoryResource.DeletionPolicy).toBe("Retain");
    });
  });

  // ==========================================================================
  // LIFECYCLE POLICY TESTS
  // ==========================================================================

  describe("Lifecycle Policies", () => {
    let template: Template;

    beforeAll(() => {
      const app = createTestApp();
      const stack = createTestEcrStack(app);
      template = Template.fromStack(stack);
    });

    // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
    test("should configure lifecycle policy with correct priority", () => {
      template.hasResourceProperties("AWS::ECR::Repository", {
        LifecyclePolicy: {
          LifecyclePolicyText: Match.serializedJson(
            Match.objectLike({
              rules: Match.arrayWith([
                Match.objectLike({
                  rulePriority: ECR_TEST_CONSTANTS.LIFECYCLE.RULE_PRIORITY,
                }),
              ]),
            })
          ),
        },
      });
    });

    // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
    test("should apply lifecycle policy to all tags", () => {
      template.hasResourceProperties("AWS::ECR::Repository", {
        LifecyclePolicy: {
          LifecyclePolicyText: Match.serializedJson(
            Match.objectLike({
              rules: Match.arrayWith([
                Match.objectLike({
                  selection: Match.objectLike({
                    tagStatus: ECR_TEST_CONSTANTS.LIFECYCLE.TAG_STATUS_ANY,
                  }),
                }),
              ]),
            })
          ),
        },
      });
    });

    // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
    test("should accept custom lifecycle rules", () => {
      const app = createTestApp();
      const stack = createTestEcrStack(app, ECR_TEST_CONSTANTS.STACK_IDS.ECR, {
        lifecycleRules: [
          {
            description: "Custom rule",
            maxImageCount: ECR_TEST_CONSTANTS.LIFECYCLE.CUSTOM_MAX_IMAGES,
            rulePriority: 1,
            tagStatus: ecr.TagStatus.ANY,
          },
        ],
      });
      const customTemplate = Template.fromStack(stack);

      customTemplate.hasResourceProperties("AWS::ECR::Repository", {
        LifecyclePolicy: {
          LifecyclePolicyText: Match.serializedJson(
            Match.objectLike({
              rules: Match.arrayWith([
                Match.objectLike({
                  description: "Custom rule",
                  selection: Match.objectLike({
                    countNumber:
                      ECR_TEST_CONSTANTS.LIFECYCLE.CUSTOM_MAX_IMAGES,
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
    let templateWithPipeline: Template;
    let templateWithoutPipeline: Template;
    let hasNoPolicyResult: boolean;

    beforeAll(() => {
      const pipelineApp = createTestApp();
      const pipelineStack = createTestEcrStack(
        pipelineApp,
        ECR_TEST_CONSTANTS.STACK_IDS.ECR,
        {
          pipelineAccount: ECR_TEST_CONSTANTS.ACCOUNTS.PIPELINE,
        }
      );
      templateWithPipeline = Template.fromStack(pipelineStack);

      const noPipelineApp = createTestApp();
      const noPipelineStack = createTestEcrStack(
        noPipelineApp,
        ECR_TEST_CONSTANTS.STACK_IDS.ECR,
        {
          pipelineAccount: undefined,
        }
      );
      templateWithoutPipeline = Template.fromStack(noPipelineStack);

      // Pre-compute policy check
      const resources =
        templateWithoutPipeline.findResources("AWS::ECR::Repository");
      const repositoryResource = Object.values(resources)[0];
      const policy = repositoryResource.Properties.RepositoryPolicyText;
      hasNoPolicyResult =
        !policy || !policy.Statement || policy.Statement.length === 0;
    });

    // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
    test("should grant pipeline account access when provided", () => {
      templateWithPipeline.hasResourceProperties("AWS::ECR::Repository", {
        RepositoryPolicyText: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Principal: Match.objectLike({
                AWS: Match.stringLikeRegexp(
                  ECR_TEST_CONSTANTS.ACCOUNTS.PIPELINE
                ),
              }),
              Action: Match.arrayWith([
                ECR_TEST_CONSTANTS.ECR_ACTIONS.BATCH_GET_IMAGE,
                ECR_TEST_CONSTANTS.ECR_ACTIONS.GET_DOWNLOAD_URL,
                ECR_TEST_CONSTANTS.ECR_ACTIONS.PUT_IMAGE,
              ]),
            }),
          ]),
        }),
      });
    });

    test("should not add repository policy when pipeline account is not provided", () => {
      templateWithoutPipeline.resourceCountIs(
        "AWS::ECR::Repository",
        ECR_TEST_CONSTANTS.RESOURCE_COUNTS.REPOSITORY
      );

      expect(hasNoPolicyResult).toBeTruthy();
    });
  });

  // ==========================================================================
  // TAGGING TESTS
  // ==========================================================================

  describe("Resource Tagging", () => {
    let template: Template;

    beforeAll(() => {
      const app = createTestApp();
      const stack = createTestEcrStack(app);
      template = Template.fromStack(stack);
    });

    // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
    test("should apply standard tags to repository", () => {
      template.hasResourceProperties("AWS::ECR::Repository", {
        Tags: Match.arrayWith([
          {
            Key: "Environment",
            Value: ECR_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
          },
          {
            Key: "Project",
            Value: ECR_TEST_CONSTANTS.PROJECT_NAMES.WEBAPP,
          },
          {
            Key: "Stack",
            Value: ECR_TEST_CONSTANTS.TAGS.STANDARD.STACK,
          },
          {
            Key: "Layer",
            Value: ECR_TEST_CONSTANTS.TAGS.STANDARD.LAYER,
          },
          {
            Key: "ManagedBy",
            Value: ECR_TEST_CONSTANTS.TAGS.STANDARD.MANAGED_BY,
          },
        ]),
      });
    });
  });

  // ==========================================================================
  // STACK OUTPUTS TESTS
  // ==========================================================================

  describe("Stack Outputs", () => {
    let devTemplate: Template;
    let pipelineTemplate: Template;

    beforeAll(() => {
      const devApp = createTestApp();
      const devStack = createTestEcrStack(devApp);
      devTemplate = Template.fromStack(devStack);

      const pipelineApp = createTestApp();
      const pipelineStack = createTestEcrStack(
        pipelineApp,
        ECR_TEST_CONSTANTS.STACK_IDS.ECR,
        {
          envName: ECR_TEST_CONSTANTS.ENVIRONMENTS.PIPELINE,
          envConfig: {
            envName: ECR_TEST_CONSTANTS.ENVIRONMENTS.PIPELINE,
            account: "123456789012",
            region: "us-east-1",
            vpcCidr: "10.0.0.0/16",
            natGateways: 1,
            isProduction: false,
            pipelineAccount: "999888777666",
          },
        }
      );
      pipelineTemplate = Template.fromStack(pipelineStack);
    });

    // eslint-disable-next-line jest/expect-expect -- template.hasOutput throws on failure
    test("should create all required stack outputs", () => {
      devTemplate.hasOutput(ECR_TEST_CONSTANTS.OUTPUT_KEYS.REPOSITORY_URI, {
        Description: "ECR repository URI for webapp container images",
      });

      devTemplate.hasOutput(ECR_TEST_CONSTANTS.OUTPUT_KEYS.REPOSITORY_ARN, {
        Description: "ECR repository ARN for IAM policies",
      });

      devTemplate.hasOutput(ECR_TEST_CONSTANTS.OUTPUT_KEYS.REPOSITORY_NAME, {
        Description: "ECR repository name",
      });
    });

    // eslint-disable-next-line jest/expect-expect -- template.hasOutput throws on failure
    test("should export outputs in non-pipeline environments", () => {
      devTemplate.hasOutput(ECR_TEST_CONSTANTS.OUTPUT_KEYS.REPOSITORY_URI, {
        Export: {
          Name: ECR_TEST_CONSTANTS.EXPORT_NAMES.DEV_URI,
        },
      });

      devTemplate.hasOutput(ECR_TEST_CONSTANTS.OUTPUT_KEYS.REPOSITORY_ARN, {
        Export: {
          Name: ECR_TEST_CONSTANTS.EXPORT_NAMES.DEV_ARN,
        },
      });

      devTemplate.hasOutput(ECR_TEST_CONSTANTS.OUTPUT_KEYS.REPOSITORY_NAME, {
        Export: {
          Name: ECR_TEST_CONSTANTS.EXPORT_NAMES.DEV_NAME,
        },
      });
    });

    test("should not export outputs in pipeline environment", () => {
      const outputs = pipelineTemplate.toJSON().Outputs;

      // Outputs exist but without Export property
      expect(
        outputs[ECR_TEST_CONSTANTS.OUTPUT_KEYS.REPOSITORY_URI]
      ).toBeDefined();
      expect(
        outputs[ECR_TEST_CONSTANTS.OUTPUT_KEYS.REPOSITORY_URI].Export
      ).toBeUndefined();
    });
  });

  // ==========================================================================
  // PUBLIC INTERFACE TESTS
  // ==========================================================================

  describe("Public Interface", () => {
    let stack: any;

    beforeAll(() => {
      const app = createTestApp();
      stack = createTestEcrStack(app);
    });

    test("should expose repository property", () => {
      expect(stack.repository).toBeDefined();
      expect(stack.repository.repositoryName).toBe(
        ECR_TEST_CONSTANTS.REPOSITORY_NAMES.DEFAULT
      );
    });
  });
});
