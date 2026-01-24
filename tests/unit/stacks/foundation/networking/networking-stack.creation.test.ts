/** @format */
/// <reference types="jest" />

import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";

import { createTestStack, TEST_CONSTANTS } from "./shared-fixtures";

// ============================================================================
// NETWORKING STACK - CREATION TESTS
// ============================================================================

describe("NetworkingStack - Stack Creation", () => {
  let app: cdk.App;

  beforeEach(() => {
    app = new cdk.App();
  });

  /**
   * Stack Creation Tests
   *
   * Verifies that NetworkingStack can be created with various
   * configuration combinations and exposes expected public properties.
   */
  describe("Stack Creation", () => {
    test("creates stack with minimal required properties", () => {
      const stack = createTestStack(app);
      const template = Template.fromStack(stack);

      template.resourceCountIs(
        "AWS::EC2::VPC",
        TEST_CONSTANTS.RESOURCE_COUNTS.VPC
      );
    });

    test("creates stack with all optional properties", () => {
      const stack = createTestStack(
        app,
        TEST_CONSTANTS.STACK_IDS.ALL_PROPERTIES,
        {
          projectName: "portfolio",
          vpcCidr: "10.1.0.0/16",
          vpcName: "custom-vpc-name",
          maxAzs: TEST_CONSTANTS.VPC.MAX_AZS,
          natGateways: 1,
          enableVpcFlowLogs: true,
          enableVpcEndpoints: true,
          enableDnsHostnames: true,
          enableDnsSupport: true,
          createSsmParameters: true,
          createOutputs: true,
          enableExports: true,
        }
      );

      const template = Template.fromStack(stack);
      template.resourceCountIs(
        "AWS::EC2::VPC",
        TEST_CONSTANTS.RESOURCE_COUNTS.VPC
      );
    });

    test("matches snapshot for minimal configuration", () => {
      const stack = createTestStack(app, TEST_CONSTANTS.STACK_IDS.SNAPSHOT);
      const template = Template.fromStack(stack);

      expect(template.toJSON()).toMatchSnapshot();
    });
  });
});
