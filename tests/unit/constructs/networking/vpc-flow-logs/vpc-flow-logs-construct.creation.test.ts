/** @format */
/// <reference types="jest" />

import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as logs from "aws-cdk-lib/aws-logs";
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
// VPC FLOW LOGS CONSTRUCT - CREATION & VALIDATION TESTS
// ============================================================================

describe("VpcFlowLogsConstruct - Creation & Validation", () => {
  let app: cdk.App;
  let stack: cdk.Stack;
  let vpc: ec2.IVpc;

  beforeEach(() => {
    app = createTestApp();
    stack = createTestStack(app, "TestStack");
    vpc = createTestVpc(stack);
  });

  // ============================================
  // Basic Construction Tests
  // ============================================

  describe("Basic Construction", () => {
    test("creates VPC Flow Logs with default configuration", () => {
      createFlowLogsConstruct(stack, "FlowLogs");

      const template = Template.fromStack(stack);

      expect(() => {
        // Should create CloudWatch Log Group
        template.resourceCountIs(
          "AWS::Logs::LogGroup",
          TEST_CONSTANTS.RESOURCE_COUNTS.LOG_GROUP
        );

        // Should create IAM Role for flow logs (check for specific role)
        template.hasResourceProperties("AWS::IAM::Role", {
          AssumeRolePolicyDocument: {
            Statement: [
              {
                Effect: "Allow",
                Principal: {
                  Service: TEST_CONSTANTS.IAM.SERVICE_PRINCIPAL,
                },
              },
            ],
          },
        });

        // Should create VPC Flow Log
        template.resourceCountIs(
          "AWS::EC2::FlowLog",
          TEST_CONSTANTS.RESOURCE_COUNTS.FLOW_LOG
        );
      }).not.toThrow();
    });

    test("exposes log group and log group name", () => {
      const flowLogsConstruct = createFlowLogsConstruct(stack, "FlowLogs");

      expect(flowLogsConstruct.logGroup).toBeDefined();
      expect(flowLogsConstruct.logGroupName).toBeDefined();
    });

    test("creates log group with default retention", () => {
      createFlowLogsConstruct(stack, "FlowLogs");

      const template = Template.fromStack(stack);

      expect(() => {
        template.hasResourceProperties("AWS::Logs::LogGroup", {
          RetentionInDays: logs.RetentionDays.ONE_WEEK,
        });
      }).not.toThrow();
    });

    test("creates log group with default removal policy DESTROY for non-production", () => {
      createFlowLogsConstruct(stack, "FlowLogs", {
        envName: TEST_CONSTANTS.ENVIRONMENTS.TEST,
      });

      const template = Template.fromStack(stack);

      // Check both DeletionPolicy and UpdateReplacePolicy for DESTROY (non-production default)
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
  // Validation Tests
  // ============================================

  describe("Validation", () => {
    test("throws error when VPC is undefined", () => {
      expect(() => {
        new VpcFlowLogsConstruct(stack, "FlowLogs", {
          vpc: undefined as unknown as ec2.IVpc,
          envName: TEST_CONSTANTS.ENVIRONMENTS.TEST,
        });
      }).toThrow(TEST_CONSTANTS.VALIDATION_ERRORS.MISSING_VPC);
    });

    test("throws error when VPC is null", () => {
      expect(() => {
        new VpcFlowLogsConstruct(stack, "FlowLogs", {
          vpc: null as unknown as ec2.IVpc,
          envName: TEST_CONSTANTS.ENVIRONMENTS.TEST,
        });
      }).toThrow(TEST_CONSTANTS.VALIDATION_ERRORS.MISSING_VPC);
    });

    test("throws error when envName is empty", () => {
      expect(() => {
        new VpcFlowLogsConstruct(stack, "FlowLogs", {
          vpc,
          envName: "",
        });
      }).toThrow(TEST_CONSTANTS.VALIDATION_ERRORS.INVALID_ENVIRONMENT);
    });

    test("throws error when envName is undefined", () => {
      expect(() => {
        new VpcFlowLogsConstruct(stack, "FlowLogs", {
          vpc,
          envName: undefined as unknown as string,
        });
      }).toThrow(TEST_CONSTANTS.VALIDATION_ERRORS.INVALID_ENVIRONMENT);
    });

    test.each([
      {
        retentionDays: TEST_CONSTANTS.RETENTION_DAYS.INVALID_TOO_LOW,
        expectedError: TEST_CONSTANTS.VALIDATION_ERRORS.RETENTION_TOO_LOW,
      },
      {
        retentionDays: TEST_CONSTANTS.RETENTION_DAYS.INVALID_TOO_HIGH,
        expectedError: TEST_CONSTANTS.VALIDATION_ERRORS.RETENTION_TOO_HIGH,
      },
      {
        retentionDays: TEST_CONSTANTS.RETENTION_DAYS.INVALID_NON_INTEGER,
        expectedError: TEST_CONSTANTS.VALIDATION_ERRORS.RETENTION_NON_INTEGER,
      },
    ])(
      "throws error for invalid retention days: $retentionDays",
      ({ retentionDays, expectedError }) => {
        expect(() => {
          createFlowLogsConstruct(stack, "FlowLogs", {
            retentionDays: retentionDays as number,
          });
        }).toThrow(expectedError);
      }
    );
  });
});
