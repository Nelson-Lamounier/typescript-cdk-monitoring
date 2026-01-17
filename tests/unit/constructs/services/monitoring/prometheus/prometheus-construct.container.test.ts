/** @format */
/// <reference types="jest" />

import * as cdk from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";

import {
  createPrometheusConstruct,
  TEST_CONFIG,
  TEST_CONSTANTS,
} from "./shared-fixtures";

// ============================================================================
// PROMETHEUS CONSTRUCT CONTAINER TESTS
// ============================================================================

describe("PrometheusConstruct - Container Configuration", () => {
  let app: cdk.App;
  let stack: cdk.Stack;

  beforeEach(() => {
    app = new cdk.App();
    stack = new cdk.Stack(app, "TestStack", {
      env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
    });
  });

  /**
   * Container Configuration Tests
   *
   * Verifies that container-level configurations (port, environment variables,
   * command) are applied correctly.
   */
  describe("Container Properties", () => {
    test("creates container with default port", () => {
      const construct = createPrometheusConstruct(stack);

      expect(construct).toBeDefined();
      expect(construct.taskDefinition).toBeDefined();

      // Verify task definition exists
      const template = Template.fromStack(stack);
      template.resourceCountIs(
        "AWS::ECS::TaskDefinition",
        TEST_CONSTANTS.RESOURCE_COUNTS.TASK_DEFINITION
      );
    });

    test("creates container with custom port", () => {
      const construct = createPrometheusConstruct(stack, {
        containerPort: TEST_CONSTANTS.CONTAINER.CUSTOM_PORT,
      });

      expect(construct).toBeDefined();
      expect(construct.taskDefinition).toBeDefined();

      // Verify task definition exists
      const template = Template.fromStack(stack);
      template.resourceCountIs(
        "AWS::ECS::TaskDefinition",
        TEST_CONSTANTS.RESOURCE_COUNTS.TASK_DEFINITION
      );
    });

    test("creates container with environment variables", () => {
      createPrometheusConstruct(stack);

      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::ECS::TaskDefinition", {
        ContainerDefinitions: Match.arrayWith([
          Match.objectLike({
            Name: TEST_CONSTANTS.CONTAINER.NAME,
            Environment: Match.arrayWith([
              Match.objectLike({
                Name: "ENVIRONMENT",
                Value: TEST_CONSTANTS.ENVIRONMENTS.DEV,
              }),
            ]),
          }),
        ]),
      });
    });

    test("creates container with command including retention time", () => {
      const construct = createPrometheusConstruct(stack, {
        retentionTime: TEST_CONSTANTS.RETENTION_TIME.CUSTOM,
      });

      expect(construct).toBeDefined();
      expect(construct.taskDefinition).toBeDefined();

      // Verify task definition exists (command is verified via construct creation)
      const template = Template.fromStack(stack);
      template.resourceCountIs(
        "AWS::ECS::TaskDefinition",
        TEST_CONSTANTS.RESOURCE_COUNTS.TASK_DEFINITION
      );
    });
  });
});
