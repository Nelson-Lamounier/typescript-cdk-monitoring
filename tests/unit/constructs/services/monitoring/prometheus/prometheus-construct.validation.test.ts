/** @format */
/// <reference types="jest" />

import * as cdk from "aws-cdk-lib";

import { PrometheusConstruct } from "../../../../../../lib/constructs/services/monitoring/prometheus";
import type {
  PrometheusServiceConstructProps,
  PrometheusVolumeConfig,
} from "../../../../../../lib/shared/types/service-types";

import {
  getFargateNetworkConfig,
  TEST_CONFIG,
  TEST_CONSTANTS,
  TestFixtures,
} from "./shared-fixtures";

// ============================================================================
// PROMETHEUS CONSTRUCT VALIDATION TESTS
// ============================================================================

describe("PrometheusConstruct - Validation", () => {
  let app: cdk.App;
  let stack: cdk.Stack;

  beforeEach(() => {
    app = new cdk.App();
    stack = new cdk.Stack(app, "TestStack", {
      env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
    });
  });

  /**
   * Validation Tests
   *
   * Verifies that PrometheusConstruct properly validates input parameters
   * and provides helpful error messages for invalid configurations.
   */
  describe("Input Validation", () => {
    test("throws error when envName is empty", () => {
      const fixtures = TestFixtures.getInstance(app);
      const { fileSystem, accessPoint } = fixtures.getEfsResources(stack);

      expect(() => {
        new PrometheusConstruct(stack, "Prometheus", {
          cluster: fixtures.getCluster(stack),
          envName: "",
          launchType: "FARGATE",
          networkConfiguration: getFargateNetworkConfig(fixtures.getVpc(stack)),
          dataVolume: {
            efs: { fileSystem, accessPoint },
          },
        });
      }).toThrow();
    });

    test("throws error when host path volume is used with Fargate", () => {
      const fixtures = TestFixtures.getInstance(app);
      const vpc = fixtures.getVpc(stack);

      expect(() => {
        const dataVolume: PrometheusVolumeConfig = {
          hostPath: TEST_CONSTANTS.VOLUMES.DATA_HOST_PATH,
        };

        const props: PrometheusServiceConstructProps = {
          cluster: fixtures.getCluster(stack),
          envName: TEST_CONSTANTS.ENVIRONMENTS.DEV,
          launchType: "FARGATE",
          networkConfiguration: getFargateNetworkConfig(vpc),
          dataVolume,
        };

        new PrometheusConstruct(stack, "Prometheus", props);
      }).toThrow(TEST_CONSTANTS.VALIDATION_ERRORS.HOST_PATH_FARGATE);
    });

    test("throws error when config volume uses host path with Fargate", () => {
      const fixtures = TestFixtures.getInstance(app);
      const vpc = fixtures.getVpc(stack);
      const { fileSystem, accessPoint } = fixtures.getEfsResources(stack);

      expect(() => {
        const dataVolume: PrometheusVolumeConfig = {
          efs: { fileSystem, accessPoint },
        };
        const configVolume: PrometheusVolumeConfig = {
          hostPath: TEST_CONSTANTS.VOLUMES.CONFIG_HOST_PATH,
        };

        const props: PrometheusServiceConstructProps = {
          cluster: fixtures.getCluster(stack),
          envName: TEST_CONSTANTS.ENVIRONMENTS.DEV,
          launchType: "FARGATE",
          networkConfiguration: getFargateNetworkConfig(vpc),
          dataVolume,
          configVolume,
        };

        new PrometheusConstruct(stack, "Prometheus", props);
      }).toThrow(TEST_CONSTANTS.VALIDATION_ERRORS.HOST_PATH_FARGATE);
    });
  });

  /**
   * Public Properties Tests
   *
   * Verifies that PrometheusConstruct exposes expected public properties
   * for cross-stack references.
   */
  describe("Public Properties", () => {
    test("exposes service property", () => {
      const fixtures = TestFixtures.getInstance(app);
      const vpc = fixtures.getVpc(stack);
      const cluster = fixtures.getCluster(stack);
      const { fileSystem, accessPoint } = fixtures.getEfsResources(stack);

      const prometheus = new PrometheusConstruct(stack, "Prometheus", {
        cluster,
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEV,
        launchType: "FARGATE",
        networkConfiguration: getFargateNetworkConfig(vpc),
        dataVolume: {
          efs: { fileSystem, accessPoint },
        },
      });

      expect(prometheus.service).toBeDefined();
    });

    test("exposes taskDefinition property", () => {
      const fixtures = TestFixtures.getInstance(app);
      const vpc = fixtures.getVpc(stack);
      const cluster = fixtures.getCluster(stack);
      const { fileSystem, accessPoint } = fixtures.getEfsResources(stack);

      const prometheus = new PrometheusConstruct(stack, "Prometheus", {
        cluster,
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEV,
        launchType: "FARGATE",
        networkConfiguration: getFargateNetworkConfig(vpc),
        dataVolume: {
          efs: { fileSystem, accessPoint },
        },
      });

      expect(prometheus.taskDefinition).toBeDefined();
    });

    test("exposes logGroup property", () => {
      const fixtures = TestFixtures.getInstance(app);
      const vpc = fixtures.getVpc(stack);
      const cluster = fixtures.getCluster(stack);
      const { fileSystem, accessPoint } = fixtures.getEfsResources(stack);

      const prometheus = new PrometheusConstruct(stack, "Prometheus", {
        cluster,
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEV,
        launchType: "FARGATE",
        networkConfiguration: getFargateNetworkConfig(vpc),
        dataVolume: {
          efs: { fileSystem, accessPoint },
        },
      });

      expect(prometheus.logGroup).toBeDefined();
    });
  });
});
