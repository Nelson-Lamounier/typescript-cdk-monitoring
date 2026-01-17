/** @format */
/// <reference types="jest" />

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
// GRAFANA CONSTRUCT - DATASOURCE & PROPERTIES TESTS
// ============================================================================

describe("GrafanaServiceConstruct - Datasource & Properties", () => {
  // ============================================
  // Datasource Provisioning Tests
  // ============================================

  describe("Datasource Provisioning", () => {
    test("generates datasource provisioning YAML for Prometheus", () => {
      const stack = createTestStack();
      const vpc = createTestVpc(stack);
      const cluster = createTestCluster(stack, vpc);

      const grafana = createGrafanaConstruct(stack, {
        cluster,
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        launchType: "FARGATE",
        networkConfiguration: getFargateNetworkConfig(vpc),
        datasources: [
          {
            name: TEST_CONSTANTS.DATASOURCES.PROMETHEUS.NAME,
            type: TEST_CONSTANTS.DATASOURCES.PROMETHEUS.TYPE,
            url: TEST_CONSTANTS.DATASOURCES.PROMETHEUS.URL,
          },
        ],
      });

      expect(grafana.datasourceProvisioning).toBeDefined();
      expect(grafana.datasourceProvisioning).toContain("apiVersion: 1");
      expect(grafana.datasourceProvisioning).toContain(
        `name: ${TEST_CONSTANTS.DATASOURCES.PROMETHEUS.NAME}`
      );
      expect(grafana.datasourceProvisioning).toContain(
        `type: ${TEST_CONSTANTS.DATASOURCES.PROMETHEUS.TYPE}`
      );
      expect(grafana.datasourceProvisioning).toContain(
        `url: ${TEST_CONSTANTS.DATASOURCES.PROMETHEUS.URL}`
      );
    });

    test("generates datasource provisioning YAML for CloudWatch", () => {
      const stack = createTestStack();
      const vpc = createTestVpc(stack);
      const cluster = createTestCluster(stack, vpc);

      const grafana = createGrafanaConstruct(stack, {
        cluster,
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        launchType: "FARGATE",
        networkConfiguration: getFargateNetworkConfig(vpc),
        datasources: [
          {
            name: TEST_CONSTANTS.DATASOURCES.CLOUDWATCH.NAME,
            type: TEST_CONSTANTS.DATASOURCES.CLOUDWATCH.TYPE,
            region: TEST_CONSTANTS.DATASOURCES.CLOUDWATCH.REGION,
          },
        ],
      });

      expect(grafana.datasourceProvisioning).toBeDefined();
      expect(grafana.datasourceProvisioning).toContain(
        `name: ${TEST_CONSTANTS.DATASOURCES.CLOUDWATCH.NAME}`
      );
      expect(grafana.datasourceProvisioning).toContain(
        `type: ${TEST_CONSTANTS.DATASOURCES.CLOUDWATCH.TYPE}`
      );
      expect(grafana.datasourceProvisioning).toContain(
        `defaultRegion: ${TEST_CONSTANTS.DATASOURCES.CLOUDWATCH.REGION}`
      );
    });

    test("returns undefined when no datasources are provided", () => {
      const stack = createTestStack();
      const vpc = createTestVpc(stack);
      const cluster = createTestCluster(stack, vpc);

      const grafana = createGrafanaConstruct(stack, {
        cluster,
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        launchType: "FARGATE",
        networkConfiguration: getFargateNetworkConfig(vpc),
      });

      expect(grafana.datasourceProvisioning).toBeUndefined();
    });
  });

  // ============================================
  // Public Properties Tests
  // ============================================

  describe("Public Properties", () => {
    test("exposes service property", () => {
      const stack = createTestStack();
      const vpc = createTestVpc(stack);
      const cluster = createTestCluster(stack, vpc);

      const grafana = createGrafanaConstruct(stack, {
        cluster,
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        launchType: "FARGATE",
        networkConfiguration: getFargateNetworkConfig(vpc),
      });

      expect(grafana.service).toBeDefined();
    });

    test("exposes taskDefinition property", () => {
      const stack = createTestStack();
      const vpc = createTestVpc(stack);
      const cluster = createTestCluster(stack, vpc);

      const grafana = createGrafanaConstruct(stack, {
        cluster,
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        launchType: "FARGATE",
        networkConfiguration: getFargateNetworkConfig(vpc),
      });

      expect(grafana.taskDefinition).toBeDefined();
    });

    test("exposes logGroup property", () => {
      const stack = createTestStack();
      const vpc = createTestVpc(stack);
      const cluster = createTestCluster(stack, vpc);

      const grafana = createGrafanaConstruct(stack, {
        cluster,
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        launchType: "FARGATE",
        networkConfiguration: getFargateNetworkConfig(vpc),
      });

      expect(grafana.logGroup).toBeDefined();
    });
  });
});
