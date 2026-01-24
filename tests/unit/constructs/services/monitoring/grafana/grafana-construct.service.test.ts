/** @format */
/// <reference types="jest" />

import * as cdk from "aws-cdk-lib";
import { Template, Match, Annotations } from "aws-cdk-lib/assertions";

import { extendExpectWithCdkMatchers } from "../../../../utils/stack-test-utils";

import {
  TEST_CONSTANTS,
  createTestStack,
  createTestVpc,
  createTestCluster,
  createGrafanaConstruct,
  getFargateNetworkConfig,
} from "./shared-fixtures";

// ============================================================================
// CUSTOM MATCHERS SETUP
// ============================================================================

extendExpectWithCdkMatchers();

// ============================================================================
// GRAFANA CONSTRUCT - SERVICE & CONTAINER CONFIGURATION TESTS
// ============================================================================

describe("GrafanaServiceConstruct - Service & Container Configuration", () => {
  // ============================================
  // Service Configuration Tests
  // ============================================

  describe("Service Configuration", () => {
    test("creates service with custom desired count", () => {
      const stack = createTestStack();
      const vpc = createTestVpc(stack);
      const cluster = createTestCluster(stack, vpc);

      createGrafanaConstruct(stack, {
        cluster,
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        launchType: "FARGATE",
        networkConfiguration: getFargateNetworkConfig(vpc),
        desiredCount: TEST_CONSTANTS.SERVICE.DESIRED_COUNT,
      });

      const template = Template.fromStack(stack);

      expect(() => {
        template.hasResourceProperties("AWS::ECS::Service", {
          DesiredCount: TEST_CONSTANTS.SERVICE.DESIRED_COUNT,
        });
      }).not.toThrow();
    });

    test("creates service with custom service name", () => {
      const stack = createTestStack();
      const vpc = createTestVpc(stack);
      const cluster = createTestCluster(stack, vpc);

      createGrafanaConstruct(stack, {
        cluster,
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        launchType: "FARGATE",
        networkConfiguration: getFargateNetworkConfig(vpc),
        serviceName: TEST_CONSTANTS.GRAFANA.SERVICE_NAME,
      });

      const template = Template.fromStack(stack);

      expect(() => {
        template.hasResourceProperties("AWS::ECS::Service", {
          ServiceName: TEST_CONSTANTS.GRAFANA.SERVICE_NAME,
        });
      }).not.toThrow();
    });

    test("creates service with custom health check grace period", () => {
      const stack = createTestStack();
      const vpc = createTestVpc(stack);
      const cluster = createTestCluster(stack, vpc);

      createGrafanaConstruct(stack, {
        cluster,
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        launchType: "FARGATE",
        networkConfiguration: getFargateNetworkConfig(vpc),
        healthCheckGracePeriod: cdk.Duration.seconds(
          TEST_CONSTANTS.SERVICE.HEALTH_CHECK_GRACE_PERIOD
        ),
      });

      const template = Template.fromStack(stack);

      expect(() => {
        template.hasResourceProperties("AWS::ECS::Service", {
          HealthCheckGracePeriodSeconds:
            TEST_CONSTANTS.SERVICE.HEALTH_CHECK_GRACE_PERIOD,
        });
      }).not.toThrow();
    });

    test("adds warning when desired count is 1", () => {
      const stack = createTestStack();
      const vpc = createTestVpc(stack);
      const cluster = createTestCluster(stack, vpc);

      createGrafanaConstruct(stack, {
        cluster,
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        launchType: "FARGATE",
        networkConfiguration: getFargateNetworkConfig(vpc),
        desiredCount: TEST_CONSTANTS.SERVICE.SINGLE_TASK_COUNT,
      });

      const annotations = Annotations.fromStack(stack);
      expect(() => {
        annotations.hasWarning(
          "/TestStack/Grafana",
          Match.stringLikeRegexp("single task")
        );
      }).not.toThrow();
    });
  });

  // ============================================
  // Container Configuration Tests
  // ============================================

  describe("Container Configuration", () => {
    test("creates container with default port 3000", () => {
      const stack = createTestStack();
      const vpc = createTestVpc(stack);
      const cluster = createTestCluster(stack, vpc);

      createGrafanaConstruct(stack, {
        cluster,
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        launchType: "FARGATE",
        networkConfiguration: getFargateNetworkConfig(vpc),
      });

      const template = Template.fromStack(stack);

      expect(() => {
        template.hasResourceProperties("AWS::ECS::TaskDefinition", {
          ContainerDefinitions: Match.arrayWith([
            Match.objectLike({
              Name: TEST_CONSTANTS.GRAFANA.DEFAULT_CONTAINER_NAME,
              PortMappings: Match.arrayWith([
                Match.objectLike({
                  ContainerPort: TEST_CONSTANTS.GRAFANA.DEFAULT_PORT,
                }),
              ]),
            }),
          ]),
        });
      }).not.toThrow();
    });

    test("creates container with custom port", () => {
      const stack = createTestStack();
      const vpc = createTestVpc(stack);
      const cluster = createTestCluster(stack, vpc);

      createGrafanaConstruct(stack, {
        cluster,
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        launchType: "FARGATE",
        networkConfiguration: getFargateNetworkConfig(vpc),
        containerPort: TEST_CONSTANTS.GRAFANA.CUSTOM_PORT,
      });

      const template = Template.fromStack(stack);

      expect(() => {
        template.hasResourceProperties("AWS::ECS::TaskDefinition", {
          ContainerDefinitions: Match.arrayWith([
            Match.objectLike({
              Name: TEST_CONSTANTS.GRAFANA.DEFAULT_CONTAINER_NAME,
              PortMappings: Match.arrayWith([
                Match.objectLike({
                  ContainerPort: TEST_CONSTANTS.GRAFANA.CUSTOM_PORT,
                }),
              ]),
            }),
          ]),
        });
      }).not.toThrow();
    });

    test("creates container with admin password secret", () => {
      const stack = createTestStack();
      const vpc = createTestVpc(stack);
      const cluster = createTestCluster(stack, vpc);

      createGrafanaConstruct(stack, {
        cluster,
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        launchType: "FARGATE",
        networkConfiguration: getFargateNetworkConfig(vpc),
      });

      const template = Template.fromStack(stack);

      expect(() => {
        template.hasResourceProperties("AWS::ECS::TaskDefinition", {
          ContainerDefinitions: Match.arrayWith([
            Match.objectLike({
              Name: TEST_CONSTANTS.GRAFANA.DEFAULT_CONTAINER_NAME,
              Secrets: Match.arrayWith([
                Match.objectLike({
                  Name: TEST_CONSTANTS.ADMIN_SECRET.ENV_VAR_NAME,
                }),
              ]),
            }),
          ]),
        });
      }).not.toThrow();
    });

    test("creates container with Grafana environment variables", () => {
      const stack = createTestStack();
      const vpc = createTestVpc(stack);
      const cluster = createTestCluster(stack, vpc);

      createGrafanaConstruct(stack, {
        cluster,
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        launchType: "FARGATE",
        networkConfiguration: getFargateNetworkConfig(vpc),
      });

      const template = Template.fromStack(stack);

      expect(() => {
        template.hasResourceProperties("AWS::ECS::TaskDefinition", {
          ContainerDefinitions: Match.arrayWith([
            Match.objectLike({
              Name: TEST_CONSTANTS.GRAFANA.DEFAULT_CONTAINER_NAME,
              Environment: Match.arrayWith([
                Match.objectLike({
                  Name: TEST_CONSTANTS.GRAFANA_ENV.SERVE_FROM_SUB_PATH,
                  Value: "true",
                }),
                Match.objectLike({
                  Name: TEST_CONSTANTS.GRAFANA_ENV.ALLOW_SIGN_UP,
                  Value: "false",
                }),
                Match.objectLike({
                  Name: TEST_CONSTANTS.GRAFANA_ENV.LOG_MODE,
                  Value: "console",
                }),
              ]),
            }),
          ]),
        });
      }).not.toThrow();
    });
  });
});
