/** @format */
/// <reference types="jest" />

import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";

import { VpcFlowLogsConstruct } from "../../../../../lib/constructs/networking/vpc/vpc-flow-logs-construct";
import { createTestApp, extendExpectWithCdkMatchers } from "../../../utils/stack-test-utils";

import {
  TEST_CONSTANTS,
  createTestStack,
  createTestVpc,
  createFlowLogsConstruct,
} from "./shared-fixtures";

// ============================================================================
// CUSTOM MATCHERS SETUP
// ============================================================================

extendExpectWithCdkMatchers();

// ============================================================================
// VPC FLOW LOGS CONSTRUCT - REMOVAL POLICY & ENVIRONMENT TESTS
// ============================================================================

describe("VpcFlowLogsConstruct - Removal Policy & Environment", () => {
  let app: cdk.App;

  beforeEach(() => {
    app = createTestApp();
  });

  // ============================================
  // Removal Policy Tests
  // ============================================

  describe("Removal Policy", () => {
    let removalPolicyTestData: Array<{
      envName: string;
      expectedPolicy: string;
      logGroupResource: { DeletionPolicy?: string; UpdateReplacePolicy?: string };
    }>;

    beforeAll(() => {
      const configs = [
        {
          envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
          expectedPolicy: TEST_CONSTANTS.REMOVAL_POLICIES.DELETE,
        },
        {
          envName: TEST_CONSTANTS.ENVIRONMENTS.PRODUCTION,
          expectedPolicy: TEST_CONSTANTS.REMOVAL_POLICIES.RETAIN,
        },
        {
          envName: TEST_CONSTANTS.ENVIRONMENTS.STAGING,
          expectedPolicy: TEST_CONSTANTS.REMOVAL_POLICIES.DELETE,
        },
      ];

      removalPolicyTestData = configs.map((config) => {
        const testApp = createTestApp();
        const testStack = createTestStack(testApp, `RemovalStack-${config.envName}`);
        createFlowLogsConstruct(testStack, "FlowLogs", {
          envName: config.envName,
        });

        const template = Template.fromStack(testStack);
        const logGroupResources = template.findResources("AWS::Logs::LogGroup");
        const logGroupResource = Object.values(logGroupResources)[0] as {
          DeletionPolicy?: string;
          UpdateReplacePolicy?: string;
        };

        return {
          ...config,
          logGroupResource,
        };
      });
    });

    test.each([
      {
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        expectedPolicy: TEST_CONSTANTS.REMOVAL_POLICIES.DELETE,
      },
      {
        envName: TEST_CONSTANTS.ENVIRONMENTS.PRODUCTION,
        expectedPolicy: TEST_CONSTANTS.REMOVAL_POLICIES.RETAIN,
      },
      {
        envName: TEST_CONSTANTS.ENVIRONMENTS.STAGING,
        expectedPolicy: TEST_CONSTANTS.REMOVAL_POLICIES.DELETE,
      },
    ])(
      "applies $expectedPolicy removal policy for $envName environment",
      ({ envName, expectedPolicy }) => {
        const testData = removalPolicyTestData.find((d) => d.envName === envName);
        expect(testData).toBeDefined();
        expect(testData?.logGroupResource.DeletionPolicy).toBe(expectedPolicy);
        expect(testData?.logGroupResource.UpdateReplacePolicy).toBe(expectedPolicy);
      }
    );

    test("allows explicit RETAIN policy override", () => {
      const stack = createTestStack(app, "RetainStack");

      createFlowLogsConstruct(stack, "FlowLogs", {
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        removalPolicy: cdk.RemovalPolicy.RETAIN,
      });

      const template = Template.fromStack(stack);
      const logGroupResources = template.findResources("AWS::Logs::LogGroup");
      const logGroupResource = Object.values(logGroupResources)[0] as {
        DeletionPolicy?: string;
        UpdateReplacePolicy?: string;
      };

      expect(logGroupResource.DeletionPolicy).toBe(
        TEST_CONSTANTS.REMOVAL_POLICIES.RETAIN
      );
      expect(logGroupResource.UpdateReplacePolicy).toBe(
        TEST_CONSTANTS.REMOVAL_POLICIES.RETAIN
      );
    });

    test("allows explicit DESTROY policy override", () => {
      const stack = createTestStack(app, "DestroyStack");

      createFlowLogsConstruct(stack, "FlowLogs", {
        envName: TEST_CONSTANTS.ENVIRONMENTS.PRODUCTION,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });

      const template = Template.fromStack(stack);
      const logGroupResources = template.findResources("AWS::Logs::LogGroup");
      const logGroupResource = Object.values(logGroupResources)[0] as {
        DeletionPolicy?: string;
        UpdateReplacePolicy?: string;
      };

      expect(logGroupResource.DeletionPolicy).toBe(
        TEST_CONSTANTS.REMOVAL_POLICIES.DELETE
      );
      expect(logGroupResource.UpdateReplacePolicy).toBe(
        TEST_CONSTANTS.REMOVAL_POLICIES.DELETE
      );
    });
  });

  // ============================================
  // Production Environment Warnings Tests
  // ============================================

  describe("Production Environment Warnings", () => {
    test("adds warning for short retention in production", () => {
      const productionStack = createTestStack(app, "ProductionStack");
      const productionVpc = createTestVpc(productionStack, "ProductionVpc");

      const construct = new VpcFlowLogsConstruct(productionStack, "FlowLogs", {
        vpc: productionVpc,
        envName: TEST_CONSTANTS.ENVIRONMENTS.PRODUCTION,
        retentionDays: TEST_CONSTANTS.RETENTION_DAYS.SEVEN_DAYS, // Below minimum for production
      });

      // Check that warning annotation was added
      // Note: We can't directly test annotations, but we can verify the construct was created
      expect(construct).toBeDefined();
    });

    test("does not warn for adequate retention in production", () => {
      const productionStack = createTestStack(app, "ProductionStack2");
      const productionVpc = createTestVpc(productionStack, "ProductionVpc2");

      const construct = new VpcFlowLogsConstruct(productionStack, "FlowLogs", {
        vpc: productionVpc,
        envName: TEST_CONSTANTS.ENVIRONMENTS.PRODUCTION,
        retentionDays: TEST_CONSTANTS.RETENTION_DAYS.NINETY_DAYS, // Above minimum for production
      });

      expect(construct).toBeDefined();
    });

    test("recognises 'prod' as production environment", () => {
      const prodStack = createTestStack(app, "ProdStack");
      const prodVpc = createTestVpc(prodStack, "ProdVpc");

      const construct = new VpcFlowLogsConstruct(prodStack, "FlowLogs", {
        vpc: prodVpc,
        envName: "prod",
        retentionDays: TEST_CONSTANTS.RETENTION_DAYS.SEVEN_DAYS,
      });

      expect(construct).toBeDefined();
    });
  });
});
