/** @format */
/// <reference types="jest" />

import * as cdk from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";

import { createTestStack, TEST_CONSTANTS } from "./shared-fixtures";

// ============================================================================
// NETWORKING STACK - SUBNET CONFIGURATION TESTS
// ============================================================================

describe("NetworkingStack - Subnet Configuration", () => {
  let app: cdk.App;

  beforeEach(() => {
    app = new cdk.App();
  });

  /**
   * Subnet Configuration Tests
   *
   * Verifies subnet creation based on availability zones,
   * public and private subnet properties, and tagging.
   */
  describe("Subnet Configuration", () => {
    test.each([
      { maxAzs: 1, expectedSubnets: 2 },
      { maxAzs: 2, expectedSubnets: 4 },
      { maxAzs: 3, expectedSubnets: 6 },
    ])(
      "creates $expectedSubnets subnets for $maxAzs AZs",
      ({ maxAzs, expectedSubnets }) => {
        const stack = createTestStack(app, `TestStack-${maxAzs}AZ`, { maxAzs });
        const template = Template.fromStack(stack);

        // eslint-disable-next-line local/no-template-in-describe
        template.resourceCountIs("AWS::EC2::Subnet", expectedSubnets);
      }
    );

    test("creates public subnets with correct properties", () => {
      const stack = createTestStack(app, TEST_CONSTANTS.STACK_IDS.DEFAULT, {
        maxAzs: TEST_CONSTANTS.VPC.MAX_AZS,
      });
      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::EC2::Subnet", {
        MapPublicIpOnLaunch: true,
        Tags: Match.arrayWith([
          Match.objectLike({
            Key: TEST_CONSTANTS.TAGS.SUBNET_NAME,
            Value: TEST_CONSTANTS.TAGS.PUBLIC,
          }),
        ]),
      });
    });

    test("creates private subnets with correct properties", () => {
      const stack = createTestStack(app, TEST_CONSTANTS.STACK_IDS.DEFAULT, {
        maxAzs: TEST_CONSTANTS.VPC.MAX_AZS,
      });
      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::EC2::Subnet", {
        MapPublicIpOnLaunch: false,
        Tags: Match.arrayWith([
          Match.objectLike({
            Key: TEST_CONSTANTS.TAGS.SUBNET_NAME,
            Value: TEST_CONSTANTS.TAGS.PRIVATE,
          }),
        ]),
      });
    });
  });
});
