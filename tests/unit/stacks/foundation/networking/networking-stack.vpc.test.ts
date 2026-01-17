/** @format */
/// <reference types="jest" />

import * as cdk from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";

import { createTestStack, TEST_CONSTANTS } from "./shared-fixtures";

// ============================================================================
// NETWORKING STACK - VPC CONFIGURATION TESTS
// ============================================================================

describe("NetworkingStack - VPC Configuration", () => {
  let app: cdk.App;

  beforeEach(() => {
    app = new cdk.App();
  });

  /**
   * VPC Configuration Tests
   *
   * Verifies VPC creation with environment-specific CIDR blocks,
   * custom CIDR blocks, DNS configuration, and tagging.
   */
  describe("VPC Configuration", () => {
    test.each([
      {
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        expectedCidr: TEST_CONSTANTS.VPC.CIDR.DEVELOPMENT,
      },
      {
        envName: TEST_CONSTANTS.ENVIRONMENTS.PRODUCTION,
        expectedCidr: TEST_CONSTANTS.VPC.CIDR.PRODUCTION,
      },
      {
        envName: TEST_CONSTANTS.ENVIRONMENTS.PIPELINE,
        expectedCidr: TEST_CONSTANTS.VPC.CIDR.PIPELINE,
      },
      {
        envName: TEST_CONSTANTS.ENVIRONMENTS.STAGING,
        expectedCidr: TEST_CONSTANTS.VPC.CIDR.STAGING,
      },
    ])(
      "creates VPC with default CIDR $expectedCidr for $envName",
      ({ envName, expectedCidr }) => {
        const stack = createTestStack(app, `TestStack-${envName}`, { envName });
        const template = Template.fromStack(stack);

        // eslint-disable-next-line local/no-template-in-describe
        template.hasResourceProperties("AWS::EC2::VPC", {
          CidrBlock: expectedCidr,
          EnableDnsHostnames: true,
          EnableDnsSupport: true,
        });
      }
    );

    test("creates VPC with custom CIDR", () => {
      const stack = createTestStack(app, TEST_CONSTANTS.STACK_IDS.DEFAULT, {
        vpcCidr: TEST_CONSTANTS.VPC.CIDR.CUSTOM,
      });

      const template = Template.fromStack(stack);
      template.hasResourceProperties("AWS::EC2::VPC", {
        CidrBlock: TEST_CONSTANTS.VPC.CIDR.CUSTOM,
      });
    });

    test("creates exactly one VPC", () => {
      const stack = createTestStack(app);
      const template = Template.fromStack(stack);

      template.resourceCountIs(
        "AWS::EC2::VPC",
        TEST_CONSTANTS.RESOURCE_COUNTS.VPC
      );
    });

    test("VPC has correct tags", () => {
      const stack = createTestStack(app, TEST_CONSTANTS.STACK_IDS.DEFAULT, {
        projectName: "portfolio",
      });

      const template = Template.fromStack(stack);

      // CDK applies tags at stack level, which propagate to resources
      // Verify VPC exists and tags are applied via stack-level tagging
      template.hasResourceProperties("AWS::EC2::VPC", {
        Tags: Match.arrayWith([
          Match.objectLike({
            Key: TEST_CONSTANTS.TAGS.ENVIRONMENT,
            Value: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
          }),
          Match.objectLike({
            Key: TEST_CONSTANTS.TAGS.MANAGED_BY,
            Value: TEST_CONSTANTS.TAGS.CDK,
          }),
        ]),
      });
    });
  });
});
