/** @format */
/// <reference types="jest" />

import * as cdk from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";

import { EcrConstruct } from "../../../../lib/constructs/storage/ecr/ecr-construct";

// ============================================================================
// TEST CONFIGURATION
// ============================================================================

/**
 * Test configuration constants
 * Centralised configuration values used across all tests
 */
const TEST_CONFIG = {
  account: "123456789012",
  region: "eu-west-1",
} as const;

/**
 * Test constants - avoid magic numbers and strings
 * All hardcoded values used in tests should be defined here
 */
const TEST_CONSTANTS = {
  ENVIRONMENTS: {
    DEV: "dev",
  },
  PROJECT_NAMES: {
    PROJECT: "proj",
  },
  REPOSITORY_NAMES: {
    DEFAULT: "my-repo",
  },
  REGIONS: {
    PRIMARY: "eu-west-1",
    SECONDARY: "eu-west-2",
  },
  RESOURCE_COUNTS: {
    REPOSITORY: 1,
    REPLICATION_CONFIG: 1,
  },
  LIFECYCLE: {
    RULE_PRIORITY: 1,
    COUNT_NUMBER: 10,
    TAG_STATUS: "any",
  },
  REPLICATION: {
    FILTER_TYPE: "PREFIX",
  },
} as const;

// ============================================================================
// ECR CONSTRUCT TESTS
// ============================================================================

describe("EcrConstruct", () => {
  let app: cdk.App;
  let stack: cdk.Stack;

  beforeEach(() => {
    app = new cdk.App();
    stack = new cdk.Stack(app, "TestStack", {
      env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
    });
  });

  /**
   * Repository Creation Tests
   *
   * Verifies that ECR repository is created with correct default configuration,
   * including image scanning, tag mutability, and lifecycle policies.
   */
  describe("Repository Creation", () => {
    test("creates repository with defaults, tagging, and lifecycle rule", () => {
      new EcrConstruct(stack, "EcrRepo", {
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEV,
        projectName: TEST_CONSTANTS.PROJECT_NAMES.PROJECT,
        repositoryName: TEST_CONSTANTS.REPOSITORY_NAMES.DEFAULT,
      });

      const template = Template.fromStack(stack);

      template.resourceCountIs(
        "AWS::ECR::Repository",
        TEST_CONSTANTS.RESOURCE_COUNTS.REPOSITORY
      );
      template.hasResourceProperties("AWS::ECR::Repository", {
        RepositoryName: TEST_CONSTANTS.REPOSITORY_NAMES.DEFAULT,
        ImageScanningConfiguration: { ScanOnPush: true },
        ImageTagMutability: "IMMUTABLE",
      });

      template.hasResourceProperties("AWS::ECR::Repository", {
        LifecyclePolicy: {
          LifecyclePolicyText: Match.serializedJson(
            Match.objectLike({
              rules: Match.arrayWith([
                Match.objectLike({
                  rulePriority: TEST_CONSTANTS.LIFECYCLE.RULE_PRIORITY,
                  selection: Match.objectLike({
                    tagStatus: TEST_CONSTANTS.LIFECYCLE.TAG_STATUS,
                    countNumber: TEST_CONSTANTS.LIFECYCLE.COUNT_NUMBER,
                  }),
                }),
              ]),
            })
          ),
        },
      });
    });
  });

  /**
   * Replication Configuration Tests
   *
   * Verifies that ECR replication is configured correctly when
   * replication destinations are provided.
   */
  describe("Replication Configuration", () => {
    test("creates replication configuration when destinations provided", () => {
      new EcrConstruct(stack, "EcrWithReplication", {
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEV,
        repositoryName: TEST_CONSTANTS.REPOSITORY_NAMES.DEFAULT,
        replicationDestinations: [
          {
            region: TEST_CONSTANTS.REGIONS.SECONDARY,
          },
        ],
      });

      const template = Template.fromStack(stack);

      template.resourceCountIs(
        "AWS::ECR::ReplicationConfiguration",
        TEST_CONSTANTS.RESOURCE_COUNTS.REPLICATION_CONFIG
      );
      template.hasResourceProperties("AWS::ECR::ReplicationConfiguration", {
        ReplicationConfiguration: {
          Rules: [
            Match.objectLike({
              Destinations: [
                Match.objectLike({
                  Region: TEST_CONSTANTS.REGIONS.SECONDARY,
                  RegistryId: TEST_CONFIG.account,
                }),
              ],
              RepositoryFilters: [
                Match.objectLike({
                  FilterType: TEST_CONSTANTS.REPLICATION.FILTER_TYPE,
                }),
              ],
            }),
          ],
        },
      });
    });
  });
});
