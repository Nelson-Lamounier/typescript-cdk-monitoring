/** @format */
/// <reference types="jest" />

import * as cdk from "aws-cdk-lib";
import * as logs from "aws-cdk-lib/aws-logs";
import { Template } from "aws-cdk-lib/assertions";

import { createTestApp, extendExpectWithCdkMatchers } from "../../../../utils/stack-test-utils";

import {
  TEST_CONSTANTS,
  createTestStack,
  createTestVpc,
  createTestCluster,
  createGrafanaConstruct,

} from "./shared-fixtures";

// ============================================================================
// CUSTOM MATCHERS SETUP
// ============================================================================

extendExpectWithCdkMatchers();

// ============================================================================
// GRAFANA CONSTRUCT - CREATION & VALIDATION TESTS
// ============================================================================

describe("GrafanaServiceConstruct - Creation & Validation", () => {
  // ============================================
  // Basic Construction Tests
  // ============================================

  describe("Basic Construction", () => {
    let stack: cdk.Stack;
    let template: Template;

    beforeAll(() => {
      stack = createTestStack();
      const vpc = createTestVpc(stack);
      const cluster = createTestCluster(stack, vpc);

      createGrafanaConstruct(stack, {
        cluster,
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
      });

      template = Template.fromStack(stack);
    });

    test("creates Grafana service with minimal required props", () => {
      expect(() => {
        // Should create a Log Group
        template.resourceCountIs("AWS::Logs::LogGroup", 1);
        template.hasResourceProperties("AWS::Logs::LogGroup", {
          LogGroupName: `${TEST_CONSTANTS.GRAFANA.LOG_GROUP_PREFIX}${TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT}-${TEST_CONSTANTS.GRAFANA.DEFAULT_CONTAINER_NAME}`,
          RetentionInDays: TEST_CONSTANTS.TASK_DEFINITION.DEFAULT_RETENTION_DAYS,
        });

        // Should create a Task Definition
        template.resourceCountIs("AWS::ECS::TaskDefinition", 1);

        // Should create an ECS Service
        template.resourceCountIs("AWS::ECS::Service", 1);
      }).not.toThrow();
    });
  });

  // ============================================
  // Log Configuration Tests
  // ============================================

  describe("Log Configuration", () => {
    test("creates service with project name in log group", () => {
      const stack = createTestStack();
      const vpc = createTestVpc(stack);
      const cluster = createTestCluster(stack, vpc);

      createGrafanaConstruct(stack, {
        cluster,
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        projectName: "monitoring",
      });

      const template = Template.fromStack(stack);

      expect(() => {
        template.hasResourceProperties("AWS::Logs::LogGroup", {
          LogGroupName: `${TEST_CONSTANTS.GRAFANA.LOG_GROUP_PREFIX}monitoring-${TEST_CONSTANTS.GRAFANA.DEFAULT_CONTAINER_NAME}`,
        });
      }).not.toThrow();
    });

    test("creates service with custom log retention", () => {
      const stack = createTestStack();
      const vpc = createTestVpc(stack);
      const cluster = createTestCluster(stack, vpc);

      createGrafanaConstruct(stack, {
        cluster,
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        logRetention: logs.RetentionDays.ONE_WEEK,
      });

      const template = Template.fromStack(stack);

      expect(() => {
        template.hasResourceProperties("AWS::Logs::LogGroup", {
          RetentionInDays: TEST_CONSTANTS.TASK_DEFINITION.CUSTOM_RETENTION_DAYS,
        });
      }).not.toThrow();
    });
  });

  // ============================================
  // Input Validation Tests
  // ============================================

  describe("Validation", () => {
    test("throws error when envName is empty", () => {
      const stack = createTestStack();
      const vpc = createTestVpc(stack);
      const cluster = createTestCluster(stack, vpc);

      expect(() => {
        createGrafanaConstruct(stack, {
          cluster,
          envName: "",
        });
      }).toThrow();
    });

    test("throws error when adminPasswordSecretArn is missing", () => {
      const app = createTestApp();
      const stack = new cdk.Stack(app, "TestStack");
      const vpc = createTestVpc(stack);
      const cluster = createTestCluster(stack, vpc);

      expect(() => {
        createGrafanaConstruct(stack, {
          cluster,
          envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
          adminPasswordSecretArn: "",
        });
      }).toThrow();
    });

    test("throws error when host path volume is used with Fargate", () => {
      const stack = createTestStack();
      const vpc = createTestVpc(stack);
      const cluster = createTestCluster(stack, vpc);

      expect(() => {
        createGrafanaConstruct(stack, {
          cluster,
          envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
          dataVolume: {
            hostPath: TEST_CONSTANTS.VOLUMES.HOST_PATH,
          },
        });
      }).toThrow("Host path volumes are not supported for Fargate");
    });
  });
});
