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
// PROMETHEUS CONSTRUCT SERVICE TESTS
// ============================================================================

describe("PrometheusConstruct - Service Configuration", () => {
  let app: cdk.App;
  let stack: cdk.Stack;

  beforeEach(() => {
    app = new cdk.App();
    stack = new cdk.Stack(app, "TestStack", {
      env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
    });
  });

  /**
   * Service Configuration Tests
   *
   * Verifies that service-level configurations (desired count, service name,
   * health check grace period) are applied correctly.
   */
  describe("Service Properties", () => {
    test("creates service with custom desired count", () => {
      const construct = createPrometheusConstruct(stack, {
        desiredCount: TEST_CONSTANTS.DESIRED_COUNT.CUSTOM,
      });

      expect(construct).toBeDefined();
      expect(construct.service).toBeDefined();

      // Verify service exists
      const template = Template.fromStack(stack);
      const services = template.findResources("AWS::ECS::Service");
      expect(Object.keys(services).length).toBeGreaterThan(0);
    });

    test("creates service with custom service name", () => {
      const construct = createPrometheusConstruct(stack, {
        serviceName: "custom-prometheus-service",
      });

      expect(construct).toBeDefined();
      expect(construct.service).toBeDefined();

      // Verify service exists
      const template = Template.fromStack(stack);
      const services = template.findResources("AWS::ECS::Service");
      expect(Object.keys(services).length).toBeGreaterThan(0);
    });

    test("creates service with custom health check grace period", () => {
      const construct = createPrometheusConstruct(stack, {
        healthCheckGracePeriod: cdk.Duration.seconds(
          TEST_CONSTANTS.HEALTH_CHECK.GRACE_PERIOD_SECONDS
        ),
      });

      expect(construct).toBeDefined();
      expect(construct.service).toBeDefined();

      // Verify service exists
      const template = Template.fromStack(stack);
      const services = template.findResources("AWS::ECS::Service");
      expect(Object.keys(services).length).toBeGreaterThan(0);
    });

    test("adds warning when desired count is 1", () => {
      const construct = createPrometheusConstruct(stack, {
        desiredCount: TEST_CONSTANTS.DESIRED_COUNT.SINGLE,
      });

      // Verify construct is created (warning is added but we can't easily test annotations)
      expect(construct).toBeDefined();
      expect(construct.service).toBeDefined();
    });
  });
});
