/** @format */
/// <reference types="jest" />

import * as cdk from "aws-cdk-lib";
import { Annotations, Match, Template } from "aws-cdk-lib/assertions";

import { PrometheusConstruct } from "../../../../../../lib/constructs/services/monitoring/prometheus";

import {
  createPrometheusConstruct,
  TEST_CONFIG,
  TEST_CONSTANTS,
  TestFixtures,
} from "./shared-fixtures";

// ============================================================================
// PROMETHEUS CONSTRUCT LAUNCH TYPE TESTS
// ============================================================================

describe("PrometheusConstruct - Launch Type", () => {
  let app: cdk.App;
  let stack: cdk.Stack;

  beforeEach(() => {
    app = new cdk.App();
    stack = new cdk.Stack(app, "TestStack", {
      env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
    });
  });

  /**
   * EC2 Launch Type Tests
   *
   * Verifies that PrometheusConstruct can be created with EC2 launch type
   * and host path volumes.
   */
  describe("EC2", () => {
    test("creates EC2 service with host path volumes", () => {
      const fixtures = TestFixtures.getInstance(app);
      const ec2Cluster = fixtures.getEc2Cluster(stack);

      new PrometheusConstruct(stack, "Prometheus", {
        cluster: ec2Cluster,
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEV,
        launchType: "EC2",
        dataVolume: {
          hostPath: TEST_CONSTANTS.VOLUMES.DATA_HOST_PATH,
        },
        configVolume: {
          hostPath: TEST_CONSTANTS.VOLUMES.CONFIG_HOST_PATH,
        },
      });

      const template = Template.fromStack(stack);
      
      // Guard assertion: Template must be defined
      expect(template).toBeDefined();

      template.hasResourceProperties("AWS::ECS::TaskDefinition", {
        Volumes: Match.arrayWith([
          Match.objectLike({
            Name: TEST_CONSTANTS.VOLUMES.PROMETHEUS_DATA,
            Host: {
              SourcePath: TEST_CONSTANTS.VOLUMES.DATA_HOST_PATH,
            },
          }),
          Match.objectLike({
            Name: TEST_CONSTANTS.VOLUMES.PROMETHEUS_CONFIG,
            Host: {
              SourcePath: TEST_CONSTANTS.VOLUMES.CONFIG_HOST_PATH,
            },
          }),
        ]),
      });
    });

    test("uses dataVolume for config when configVolume is not provided", () => {
      const fixtures = TestFixtures.getInstance(app);
      const ec2Cluster = fixtures.getEc2Cluster(stack);

      new PrometheusConstruct(stack, "Prometheus", {
        cluster: ec2Cluster,
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEV,
        launchType: "EC2",
        dataVolume: {
          hostPath: TEST_CONSTANTS.VOLUMES.DATA_HOST_PATH,
        },
        // No configVolume provided - should use dataVolume path
      });

      const template = Template.fromStack(stack);
      
      // Guard assertion: Template must be defined
      expect(template).toBeDefined();

      // Both volumes should use the same host path
      template.hasResourceProperties("AWS::ECS::TaskDefinition", {
        Volumes: Match.arrayWith([
          Match.objectLike({
            Name: TEST_CONSTANTS.VOLUMES.PROMETHEUS_DATA,
            Host: {
              SourcePath: TEST_CONSTANTS.VOLUMES.DATA_HOST_PATH,
            },
          }),
          Match.objectLike({
            Name: TEST_CONSTANTS.VOLUMES.PROMETHEUS_CONFIG,
            Host: {
              SourcePath: TEST_CONSTANTS.VOLUMES.DATA_HOST_PATH,
            },
          }),
        ]),
      });
    });
  });

  /**
   * Fargate Launch Type Tests
   *
   * Verifies that PrometheusConstruct can be created with Fargate launch type
   * and proper network configuration.
   */
  describe("Fargate", () => {
    test("creates Fargate task definition when specified", () => {
      createPrometheusConstruct(stack);

      const template = Template.fromStack(stack);
      
      // Guard assertion: Template must be defined
      expect(template).toBeDefined();

      template.hasResourceProperties("AWS::ECS::TaskDefinition", {
        RequiresCompatibilities: ["FARGATE"],
        NetworkMode: TEST_CONSTANTS.FARGATE.NETWORK_MODE,
        Cpu: TEST_CONSTANTS.FARGATE.CPU,
        Memory: TEST_CONSTANTS.FARGATE.MEMORY,
      });
    });

    test("adds warning when Fargate is used without network configuration", () => {
      // Use EC2 cluster with capacity to avoid EC2 validation error
      const fixtures = TestFixtures.getInstance(app);
      const ec2Cluster = fixtures.getEc2Cluster(stack);
      const { fileSystem, accessPoint } = fixtures.getEfsResources(stack);

      new PrometheusConstruct(stack, "Prometheus", {
        cluster: ec2Cluster,
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEV,
        launchType: "FARGATE",
        dataVolume: {
          efs: { fileSystem, accessPoint },
        },
        // No network configuration provided
      });

      const annotations = Annotations.fromStack(stack);
      
      // Guard assertion: Annotations must be defined
      expect(annotations).toBeDefined();
      
      annotations.hasWarning(
        "/TestStack/Prometheus",
        Match.stringLikeRegexp("Fargate requires awsvpc networking")
      );
    });
  });
});
