/** @format */
/// <reference types="jest" />

import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";

import { createTestStack, TEST_CONSTANTS } from "./shared-fixtures";

// ============================================================================
// NETWORKING STACK - VPC ENDPOINTS TESTS
// ============================================================================

describe("NetworkingStack - VPC Endpoints", () => {
  let app: cdk.App;

  beforeEach(() => {
    app = new cdk.App();
  });

  /**
   * VPC Endpoints Tests
   *
   * Verifies VPC endpoint creation for S3 and DynamoDB gateway endpoints,
   * and the ability to disable endpoints.
   */
  describe("VPC Endpoints", () => {
    test("creates S3 and DynamoDB gateway endpoints by default", () => {
      const stack = createTestStack(app);
      const template = Template.fromStack(stack);

      const endpoints = template.findResources("AWS::EC2::VPCEndpoint");
      const gatewayEndpoints = Object.values(endpoints).filter((endpoint) => {
        const endpointProps = endpoint.Properties as {
          VpcEndpointType?: string;
        };
        return (
          endpointProps.VpcEndpointType ===
          TEST_CONSTANTS.VPC_ENDPOINT.TYPE_GATEWAY
        );
      });

      expect(gatewayEndpoints.length).toBe(
        TEST_CONSTANTS.RESOURCE_COUNTS.GATEWAY_ENDPOINTS
      );
    });

    test("does not create VPC endpoints when disabled", () => {
      const stack = createTestStack(app, TEST_CONSTANTS.STACK_IDS.DEFAULT, {
        enableVpcEndpoints: false,
      });

      const template = Template.fromStack(stack);
      template.resourceCountIs(
        "AWS::EC2::VPCEndpoint",
        TEST_CONSTANTS.RESOURCE_COUNTS.VPC_ENDPOINTS_DISABLED
      );
    });
  });
});
