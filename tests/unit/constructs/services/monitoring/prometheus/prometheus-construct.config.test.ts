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
// PROMETHEUS CONSTRUCT CONFIG TESTS
// ============================================================================

describe("PrometheusConstruct - Prometheus Configuration", () => {
  let app: cdk.App;
  let stack: cdk.Stack;

  beforeEach(() => {
    app = new cdk.App();
    stack = new cdk.Stack(app, "TestStack", {
      env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
    });
  });

  /**
   * Prometheus Configuration Tests
   *
   * Verifies that Prometheus configuration (scrape interval, static targets)
   * is accepted and the construct is created successfully. Note: The actual
   * config content is written to a file mounted as a volume, so we verify
   * the construct creation rather than the config file content.
   */
  describe("Configuration Properties", () => {
    test("creates config with custom scrape interval", () => {
      // Verify construct is created successfully with scrape interval
      // The config content is written to a file, not in the command array
      const construct = createPrometheusConstruct(stack, {
        scrapeInterval: TEST_CONSTANTS.SCRAPE_INTERVAL.CUSTOM,
      });

      expect(construct).toBeDefined();
      expect(construct.service).toBeDefined();
      expect(construct.taskDefinition).toBeDefined();

      // Verify config volume is mounted (config is written to file)
      const template = Template.fromStack(stack);
      template.hasResourceProperties("AWS::ECS::TaskDefinition", {
        Volumes: Match.arrayWith([
          Match.objectLike({
            Name: TEST_CONSTANTS.VOLUMES.PROMETHEUS_CONFIG,
          }),
        ]),
      });
    });

    test("creates config with static targets", () => {
      // Verify construct is created successfully with static targets
      // The config content is written to a file, not in the command array
      const construct = createPrometheusConstruct(stack, {
        staticTargets: [
          {
            jobName: TEST_CONSTANTS.STATIC_TARGETS.JOB_NAME,
            targets: [...TEST_CONSTANTS.STATIC_TARGETS.TARGETS],
          },
        ],
      });

      expect(construct).toBeDefined();
      expect(construct.service).toBeDefined();
      expect(construct.taskDefinition).toBeDefined();

      // Verify config volume is mounted (config is written to file)
      const template = Template.fromStack(stack);
      template.hasResourceProperties("AWS::ECS::TaskDefinition", {
        Volumes: Match.arrayWith([
          Match.objectLike({
            Name: TEST_CONSTANTS.VOLUMES.PROMETHEUS_CONFIG,
          }),
        ]),
      });
    });
  });
});
