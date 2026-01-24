/** @format */
/// <reference types="jest" />

import { Template, Match, Annotations } from "aws-cdk-lib/assertions";

import { extendExpectWithCdkMatchers } from "../../../../utils/stack-test-utils";

import {
  TEST_CONSTANTS,
  createTestStack,
  createTestVpc,
  createTestCluster,
  createEc2Cluster,
  createGrafanaConstruct,
  createEfsResources,
  getFargateNetworkConfig,
} from "./shared-fixtures";

// ============================================================================
// CUSTOM MATCHERS SETUP
// ============================================================================

extendExpectWithCdkMatchers();

// ============================================================================
// GRAFANA CONSTRUCT - LAUNCH TYPE & VOLUME CONFIGURATION TESTS
// ============================================================================

describe("GrafanaServiceConstruct - Launch Type & Volume Configuration", () => {
  // ============================================
  // EC2 Launch Type Tests
  // ============================================

  describe("EC2 Launch Type", () => {
    test("creates EC2 service with host path volumes", () => {
      const stack = createTestStack();
      const vpc = createTestVpc(stack);
      const cluster = createEc2Cluster(stack, vpc);

      createGrafanaConstruct(stack, {
        cluster,
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        launchType: "EC2",
        dataVolume: {
          hostPath: TEST_CONSTANTS.VOLUMES.HOST_PATH,
        },
        networkConfiguration: undefined,
      });

      const template = Template.fromStack(stack);

      expect(() => {
        template.hasResourceProperties("AWS::ECS::TaskDefinition", {
          Volumes: Match.arrayWith([
            Match.objectLike({
              Name: TEST_CONSTANTS.GRAFANA.DATA_VOLUME_NAME,
              Host: {
                SourcePath: TEST_CONSTANTS.VOLUMES.HOST_PATH,
              },
            }),
          ]),
        });
      }).not.toThrow();
    });
  });

  // ============================================
  // Fargate Launch Type Tests
  // ============================================

  describe("Fargate Launch Type", () => {
    test("creates Fargate task definition when specified", () => {
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
          RequiresCompatibilities: ["FARGATE"],
          NetworkMode: "awsvpc",
          Cpu: TEST_CONSTANTS.TASK_DEFINITION.FARGATE_CPU,
          Memory: TEST_CONSTANTS.TASK_DEFINITION.FARGATE_MEMORY,
        });
      }).not.toThrow();
    });

    test("adds warning when Fargate is used without network configuration", () => {
      const stack = createTestStack();
      const vpc = createTestVpc(stack);
      const cluster = createEc2Cluster(stack, vpc);

      createGrafanaConstruct(stack, {
        cluster,
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        launchType: "FARGATE",
        networkConfiguration: undefined,
      });

      const annotations = Annotations.fromStack(stack);
      expect(() => {
        annotations.hasWarning(
          "/TestStack/Grafana",
          Match.stringLikeRegexp("Fargate services require awsvpc networking")
        );
      }).not.toThrow();
    });
  });

  // ============================================
  // EFS Volume Configuration Tests
  // ============================================

  describe("EFS Volume Configuration", () => {
    test("creates service with EFS volumes", () => {
      const stack = createTestStack();
      const vpc = createTestVpc(stack);
      const cluster = createTestCluster(stack, vpc);
      const { fileSystem, accessPoint } = createEfsResources(stack, vpc);

      createGrafanaConstruct(stack, {
        cluster,
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        launchType: "FARGATE",
        dataVolume: {
          efs: {
            fileSystem,
            accessPoint,
          },
        },
        networkConfiguration: getFargateNetworkConfig(vpc),
      });

      const template = Template.fromStack(stack);

      expect(() => {
        template.hasResourceProperties("AWS::ECS::TaskDefinition", {
          Volumes: Match.arrayWith([
            Match.objectLike({
              Name: TEST_CONSTANTS.GRAFANA.DATA_VOLUME_NAME,
              EFSVolumeConfiguration: Match.objectLike({
                TransitEncryption: "ENABLED",
              }),
            }),
          ]),
        });
      }).not.toThrow();
    });
  });
});
