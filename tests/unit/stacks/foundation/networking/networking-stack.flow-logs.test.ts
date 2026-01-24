/** @format */
/// <reference types="jest" />

import * as cdk from "aws-cdk-lib";
import * as logs from "aws-cdk-lib/aws-logs";
import { Match, Template } from "aws-cdk-lib/assertions";

import { createTestStack, TEST_CONSTANTS } from "./shared-fixtures";

// ============================================================================
// NETWORKING STACK - VPC FLOW LOGS TESTS
// ============================================================================

describe("NetworkingStack - VPC Flow Logs", () => {
  let app: cdk.App;

  beforeEach(() => {
    app = new cdk.App();
  });

  /**
   * VPC Flow Logs Tests
   *
   * Verifies VPC flow log creation, CloudWatch log group configuration,
   * retention policies, and environment-specific removal policies.
   */
  describe("VPC Flow Logs", () => {
    test.each([
      {
        description: "flow logs enabled",
        enableVpcFlowLogs: true,
        expectedCount: TEST_CONSTANTS.RESOURCE_COUNTS.FLOW_LOGS_ENABLED,
      },
      {
        description: "flow logs disabled",
        enableVpcFlowLogs: false,
        expectedCount: TEST_CONSTANTS.RESOURCE_COUNTS.FLOW_LOGS_DISABLED,
      },
    ])(
      "creates VPC flow logs when $description",
      ({ enableVpcFlowLogs, expectedCount }) => {
        const stack = createTestStack(app, TEST_CONSTANTS.STACK_IDS.DEFAULT, {
          enableVpcFlowLogs,
        });

        const template = Template.fromStack(stack);
        // eslint-disable-next-line local/no-template-in-describe
        template.resourceCountIs("AWS::EC2::FlowLog", expectedCount);
      }
    );

    test("creates CloudWatch log group with correct retention", () => {
      const stack = createTestStack(app, TEST_CONSTANTS.STACK_IDS.DEFAULT, {
        enableVpcFlowLogs: true,
        flowLogRetention: logs.RetentionDays.ONE_MONTH,
      });

      const template = Template.fromStack(stack);
      template.hasResourceProperties("AWS::Logs::LogGroup", {
        LogGroupName: Match.stringLikeRegexp(
          TEST_CONSTANTS.LOG_GROUP_PATTERNS.FLOW_LOGS
        ),
        RetentionInDays: TEST_CONSTANTS.LOG_RETENTION.ONE_MONTH_DAYS,
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
    ])(
      "uses $expectedPolicy removal policy for $envName log group",
      ({ envName, expectedPolicy }) => {
        const stack = createTestStack(app, `TestStack-${envName}`, {
          envName,
          enableVpcFlowLogs: true,
        });

        const template = Template.fromStack(stack);
        // eslint-disable-next-line local/no-template-in-describe
        template.hasResource("AWS::Logs::LogGroup", {
          DeletionPolicy: expectedPolicy,
          UpdateReplacePolicy: expectedPolicy,
        });
      }
    );
  });
});
