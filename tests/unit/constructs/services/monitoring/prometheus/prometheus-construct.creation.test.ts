/** @format */
/// <reference types="jest" />

import * as cdk from "aws-cdk-lib";
import * as logs from "aws-cdk-lib/aws-logs";
import { Template } from "aws-cdk-lib/assertions";

import {
  createPrometheusConstruct,
  TEST_CONFIG,
  TEST_CONSTANTS,
} from "./shared-fixtures";

// ============================================================================
// PROMETHEUS CONSTRUCT CREATION TESTS
// ============================================================================

describe("PrometheusConstruct - Basic Creation", () => {
  let app: cdk.App;
  let stack: cdk.Stack;

  beforeEach(() => {
    app = new cdk.App();
    stack = new cdk.Stack(app, "TestStack", {
      env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
    });
  });

  /**
   * Basic Creation with Fargate Tests
   *
   * Verifies that PrometheusConstruct can be created with Fargate launch type
   * and minimal required properties.
   */
  describe("with minimal required props", () => {
    test("creates Prometheus service with minimal required props", () => {
      createPrometheusConstruct(stack);

      const template = Template.fromStack(stack);

      // Should create a Log Group
      template.resourceCountIs(
        "AWS::Logs::LogGroup",
        TEST_CONSTANTS.RESOURCE_COUNTS.LOG_GROUP
      );
      template.hasResourceProperties("AWS::Logs::LogGroup", {
        LogGroupName: TEST_CONSTANTS.LOG_GROUP_NAMES.DEFAULT,
        RetentionInDays: TEST_CONSTANTS.RETENTION.DEFAULT_DAYS,
      });

      // Should create a Task Definition
      template.resourceCountIs(
        "AWS::ECS::TaskDefinition",
        TEST_CONSTANTS.RESOURCE_COUNTS.TASK_DEFINITION
      );

      // Should create an ECS Service
      template.resourceCountIs(
        "AWS::ECS::Service",
        TEST_CONSTANTS.RESOURCE_COUNTS.ECS_SERVICE
      );
    });

    test("creates service with project name in log group", () => {
      createPrometheusConstruct(stack, {
        projectName: TEST_CONSTANTS.PROJECT_NAMES.MONITORING,
      });

      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::Logs::LogGroup", {
        LogGroupName: TEST_CONSTANTS.LOG_GROUP_NAMES.WITH_PROJECT,
      });
    });

    test("creates service with custom log retention", () => {
      const construct = createPrometheusConstruct(stack, {
        logRetention: logs.RetentionDays.ONE_WEEK,
      });

      // Verify construct is created successfully
      expect(construct).toBeDefined();
      expect(construct.logGroup).toBeDefined();

      // Verify log group exists
      const template = Template.fromStack(stack);
      template.resourceCountIs(
        "AWS::Logs::LogGroup",
        TEST_CONSTANTS.RESOURCE_COUNTS.LOG_GROUP
      );
    });
  });
});
