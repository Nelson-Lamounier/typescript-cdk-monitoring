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
// PROMETHEUS CONSTRUCT VOLUME TESTS
// ============================================================================

describe("PrometheusConstruct - Volumes", () => {
  let app: cdk.App;
  let stack: cdk.Stack;

  beforeEach(() => {
    app = new cdk.App();
    stack = new cdk.Stack(app, "TestStack", {
      env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
    });
  });

  /**
   * EFS Volume Configuration Tests
   *
   * Verifies that EFS volumes are configured correctly with transit encryption.
   */
  describe("EFS Configuration", () => {
    test("creates service with EFS volumes and transit encryption", () => {
      createPrometheusConstruct(stack);

      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::ECS::TaskDefinition", {
        Volumes: Match.arrayWith([
          Match.objectLike({
            Name: TEST_CONSTANTS.VOLUMES.PROMETHEUS_DATA,
            EFSVolumeConfiguration: Match.objectLike({
              TransitEncryption: "ENABLED",
            }),
          }),
        ]),
      });
    });
  });
});
