/** @format */
/// <reference types="jest" />

import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";

import { createTestStack, TEST_CONSTANTS } from "./shared-fixtures";

// ============================================================================
// NETWORKING STACK - SSM PARAMETERS TESTS
// ============================================================================

describe("NetworkingStack - SSM Parameters", () => {
  let app: cdk.App;

  beforeEach(() => {
    app = new cdk.App();
  });

  /**
   * SSM Parameters Tests
   *
   * Verifies SSM parameter creation for VPC ID and the ability
   * to disable parameter creation.
   */
  describe("SSM Parameters", () => {
    test("creates VPC ID SSM parameter", () => {
      const stack = createTestStack(app, TEST_CONSTANTS.STACK_IDS.DEFAULT, {
        createSsmParameters: true,
      });

      const template = Template.fromStack(stack);
      template.hasResourceProperties("AWS::SSM::Parameter", {
        Name: TEST_CONSTANTS.SSM_PARAMETER_PATHS.VPC_ID,
        Type: "String",
      });
    });

    test("does not create SSM parameters when disabled", () => {
      const stack = createTestStack(app, TEST_CONSTANTS.STACK_IDS.DEFAULT, {
        createSsmParameters: false,
      });

      const template = Template.fromStack(stack);
      template.resourceCountIs(
        "AWS::SSM::Parameter",
        TEST_CONSTANTS.RESOURCE_COUNTS.SSM_PARAMETERS_DISABLED
      );
    });
  });
});
