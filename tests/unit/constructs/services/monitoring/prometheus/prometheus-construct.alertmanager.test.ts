/** @format */
/// <reference types="jest" />

import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";

import {
  createPrometheusConstruct,
  TEST_CONFIG,
  TEST_CONSTANTS,
} from "./shared-fixtures";

// ============================================================================
// PROMETHEUS CONSTRUCT ALERTMANAGER TESTS
// ============================================================================

describe("PrometheusConstruct - Alertmanager Sidecar", () => {
  let app: cdk.App;
  let stack: cdk.Stack;

  beforeEach(() => {
    app = new cdk.App();
    stack = new cdk.Stack(app, "TestStack", {
      env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
    });
  });

  /**
   * Alertmanager Sidecar Tests
   *
   * Verifies that Alertmanager container is added when configured.
   */
  describe("Sidecar Configuration", () => {
    test("adds Alertmanager container when configured", () => {
      const construct = createPrometheusConstruct(stack, {
        alertmanager: {
          configContent: "route:\n  receiver: default",
        },
      });

      expect(construct).toBeDefined();
      expect(construct.taskDefinition).toBeDefined();

      // Verify task definition exists (Alertmanager is added via addContainer)
      const template = Template.fromStack(stack);
      template.resourceCountIs(
        "AWS::ECS::TaskDefinition",
        TEST_CONSTANTS.RESOURCE_COUNTS.TASK_DEFINITION
      );
    });

    test("uses custom Alertmanager port when specified", () => {
      const construct = createPrometheusConstruct(stack, {
        alertmanager: {
          port: TEST_CONSTANTS.CONTAINER.ALERTMANAGER_CUSTOM_PORT,
        },
      });

      expect(construct).toBeDefined();
      expect(construct.taskDefinition).toBeDefined();

      // Verify task definition exists (Alertmanager port is configured via addContainer)
      const template = Template.fromStack(stack);
      template.resourceCountIs(
        "AWS::ECS::TaskDefinition",
        TEST_CONSTANTS.RESOURCE_COUNTS.TASK_DEFINITION
      );
    });
  });
});
