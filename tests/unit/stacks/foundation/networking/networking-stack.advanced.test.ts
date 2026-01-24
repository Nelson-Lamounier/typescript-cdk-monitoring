/** @format */
/// <reference types="jest" />

import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";

import { createTestStack, TEST_CONSTANTS, TestFixtures } from "./shared-fixtures";

// ============================================================================
// NETWORKING STACK - ADVANCED TESTS
// ============================================================================

describe("NetworkingStack - Advanced Features", () => {
  /**
   * Feature Interactions Tests
   *
   * Verifies that different features work together correctly,
   * such as flow logs with VPC endpoints.
   */
  describe("Feature Interactions", () => {
    let interactionStack: any;

    beforeAll(() => {
      const testApp = new cdk.App();
      interactionStack = createTestStack(testApp, "InteractionStack", {
        enableVpcFlowLogs: true,
        enableVpcEndpoints: true,
      });
    });

    test("flow logs and VPC endpoints work together", () => {
      const template = Template.fromStack(interactionStack);

      template.resourceCountIs(
        "AWS::EC2::FlowLog",
        TEST_CONSTANTS.RESOURCE_COUNTS.FLOW_LOGS_ENABLED
      );

      const endpoints = template.findResources("AWS::EC2::VPCEndpoint");
      expect(Object.keys(endpoints).length).toBe(
        TEST_CONSTANTS.RESOURCE_COUNTS.TOTAL_VPC_ENDPOINTS
      );
    });
  });

  /**
   * Cost Optimisation Tests
   *
   * Verifies environment-specific cost optimisations, such as NAT gateway
   * configuration and log retention for development vs production environments.
   */
  describe("Cost Optimization", () => {
    let devStack: any;
    let prodStack: any;

    beforeAll(() => {
      // Create separate apps to avoid construct name conflicts
      const app1 = new cdk.App();
      const app2 = new cdk.App();

      const fixtures1 = TestFixtures.getInstance(app1);
      const fixtures2 = TestFixtures.getInstance(app2);

      devStack = fixtures1.getDevStack();
      prodStack = fixtures2.getProdStack();
    });

    test("development environment has cost-optimised configuration", () => {
      const template = Template.fromStack(devStack);

      template.resourceCountIs(
        "AWS::EC2::NatGateway",
        TEST_CONSTANTS.RESOURCE_COUNTS.NAT_GATEWAYS_NONE
      );
      template.hasResourceProperties("AWS::Logs::LogGroup", {
        RetentionInDays: TEST_CONSTANTS.LOG_RETENTION.DEVELOPMENT_DAYS,
      });
    });

    test("production environment has HA configuration", () => {
      const template = Template.fromStack(prodStack);

      template.resourceCountIs(
        "AWS::EC2::NatGateway",
        TEST_CONSTANTS.RESOURCE_COUNTS.NAT_GATEWAYS_HA
      );
      template.hasResourceProperties("AWS::Logs::LogGroup", {
        RetentionInDays: TEST_CONSTANTS.LOG_RETENTION.PRODUCTION_DAYS,
      });
    });
  });

  /**
   * Stack Properties Tests
   *
   * Verifies that NetworkingStack exposes expected public properties
   * for cross-stack references.
   *
   * NOTE: Tests are split to avoid conditionals in test bodies.
   */
  describe("Stack Properties", () => {
    let stack: any;

    beforeAll(() => {
      const app = new cdk.App();
      stack = createTestStack(app, TEST_CONSTANTS.STACK_IDS.DEFAULT, {
        maxAzs: TEST_CONSTANTS.VPC.MAX_AZS,
      });
    });

    test("exposes vpc property with vpcId", () => {
      expect(stack.vpc).toBeDefined();
      expect(stack.vpc.vpcId).toBeDefined();
    });

    test("exposes publicSubnets array with correct length", () => {
      expect(stack.publicSubnets).toBeDefined();
      expect(Array.isArray(stack.publicSubnets)).toBe(true);
      expect(stack.publicSubnets.length).toBe(TEST_CONSTANTS.VPC.MAX_AZS);
    });

    test("exposes privateSubnets array with correct length", () => {
      expect(stack.privateSubnets).toBeDefined();
      expect(Array.isArray(stack.privateSubnets)).toBe(true);
      expect(stack.privateSubnets.length).toBe(TEST_CONSTANTS.VPC.MAX_AZS);
    });

    test("exposes isolatedSubnets as array", () => {
      expect(stack.isolatedSubnets).toBeDefined();
      expect(Array.isArray(stack.isolatedSubnets)).toBe(true);
    });
  });
});
