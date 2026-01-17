/** @format */
/// <reference types="jest" />

/**
 * MonitoringInfraStack Networking Configuration Tests
 *
 * Tests ALB and listener configuration.
 */

import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Template, Match } from "aws-cdk-lib/assertions";

import { MONITORING_ALB_IDLE_TIMEOUT } from "../../../../../lib/shared/constants/monitoring-constants";
import {
  createTestApp,
  createTestEnv,
  extendExpectWithCdkMatchers,
} from "../../../utils/stack-test-utils";

import { TEST_CONSTANTS, createTestStack } from "./shared-fixtures";

// ============================================================================
// CUSTOM MATCHERS SETUP
// ============================================================================

extendExpectWithCdkMatchers();

// ============================================================================
// TESTS
// ============================================================================

describe("MonitoringInfraStack - Networking Configuration", () => {
  // ==========================================================================
  // Load Balancer Configuration
  // ==========================================================================

  describe("Load Balancer Configuration", () => {
    let defaultTemplate: Template;
    let nameTemplate: Template;
    let customTimeoutTemplate: Template;
    let accessLogsTemplate: Template;
    let deletionProtectionTemplate: Template;

    beforeAll(() => {
      const app = createTestApp();

      // Create all stacks first
      const defaultStack = createTestStack(app, "ALB-Default");
      const nameStack = createTestStack(app, "ALB-Name", {
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        projectName: "mon",
      });
      const customTimeoutStack = createTestStack(app, "ALB-CustomTimeout", {
        albIdleTimeout: cdk.Duration.seconds(120),
      });
      const deletionProtectionStack = createTestStack(
        app,
        "ALB-DeletionProtection",
        {
          enableDeletionProtection: true,
        }
      );

      // Access logs needs its own app due to S3 bucket dependency
      const accessLogsApp = createTestApp();
      const s3Stack = new cdk.Stack(accessLogsApp, "S3StackAccessLogs", {
        env: createTestEnv(),
      });
      const logsBucket = new s3.Bucket(s3Stack, "LogsBucket", {
        bucketName: cdk.PhysicalName.GENERATE_IF_NEEDED,
      });
      const accessLogsStack = createTestStack(
        accessLogsApp,
        "ALB-AccessLogs",
        {
          enableAccessLogs: true,
          accessLogsBucket: logsBucket,
        }
      );

      // Then create templates
      defaultTemplate = Template.fromStack(defaultStack);
      nameTemplate = Template.fromStack(nameStack);
      customTimeoutTemplate = Template.fromStack(customTimeoutStack);
      deletionProtectionTemplate = Template.fromStack(deletionProtectionStack);
      accessLogsTemplate = Template.fromStack(accessLogsStack);
    });

    test("creates internet-facing ALB", () => {
      expect(() => {
        defaultTemplate.hasResourceProperties(
          "AWS::ElasticLoadBalancingV2::LoadBalancer",
          {
            Scheme: "internet-facing",
            Type: "application",
          }
        );
      }).not.toThrow();
    });

    test("configures ALB name correctly", () => {
      expect(() => {
        nameTemplate.hasResourceProperties(
          "AWS::ElasticLoadBalancingV2::LoadBalancer",
          {
            Name: "development-mon-mon-alb",
          }
        );
      }).not.toThrow();
    });

    test("sets correct idle timeout", () => {
      expect(() => {
        customTimeoutTemplate.hasResourceProperties(
          "AWS::ElasticLoadBalancingV2::LoadBalancer",
          {
            LoadBalancerAttributes: Match.arrayWith([
              Match.objectLike({
                Key: "idle_timeout.timeout_seconds",
                Value: "120",
              }),
            ]),
          }
        );
      }).not.toThrow();
    });

    test("uses default idle timeout from constants", () => {
      expect(() => {
        defaultTemplate.hasResourceProperties(
          "AWS::ElasticLoadBalancingV2::LoadBalancer",
          {
            LoadBalancerAttributes: Match.arrayWith([
              Match.objectLike({
                Key: "idle_timeout.timeout_seconds",
                Value: MONITORING_ALB_IDLE_TIMEOUT.toSeconds().toString(),
              }),
            ]),
          }
        );
      }).not.toThrow();
    });

    test("enables access logs when configured", () => {
      expect(() => {
        accessLogsTemplate.hasResourceProperties(
          "AWS::ElasticLoadBalancingV2::LoadBalancer",
          {
            LoadBalancerAttributes: Match.arrayWith([
              Match.objectLike({
                Key: "access_logs.s3.enabled",
                Value: "true",
              }),
            ]),
          }
        );
      }).not.toThrow();
    });

    test("enables deletion protection when specified", () => {
      expect(() => {
        deletionProtectionTemplate.hasResourceProperties(
          "AWS::ElasticLoadBalancingV2::LoadBalancer",
          {
            LoadBalancerAttributes: Match.arrayWith([
              Match.objectLike({
                Key: "deletion_protection.enabled",
                Value: "true",
              }),
            ]),
          }
        );
      }).not.toThrow();
    });
  });

  // ==========================================================================
  // ALB Listener Configuration
  // ==========================================================================

  describe("ALB Listener Configuration", () => {
    let httpTemplate: Template;
    let httpsTemplate: Template;
    let redirectTemplate: Template;

    beforeAll(() => {
      const app = createTestApp();

      // Create all stacks first
      const httpStack = createTestStack(app, "Listener-HTTP");
      const httpsStack = createTestStack(app, "Listener-HTTPS", {
        enableHttps: true,
        certificateArn: TEST_CONSTANTS.CERTIFICATE_ARN,
      });
      const redirectStack = createTestStack(app, "Listener-Redirect", {
        enableHttps: true,
        certificateArn: TEST_CONSTANTS.CERTIFICATE_ARN,
      });

      // Then create templates
      httpTemplate = Template.fromStack(httpStack);
      httpsTemplate = Template.fromStack(httpsStack);
      redirectTemplate = Template.fromStack(redirectStack);
    });

    test("creates HTTP listener by default", () => {
      expect(() => {
        httpTemplate.hasResourceProperties(
          "AWS::ElasticLoadBalancingV2::Listener",
          {
            Protocol: "HTTP",
            Port: 80,
          }
        );
      }).not.toThrow();
    });

    test("creates HTTPS listener when enabled", () => {
      expect(() => {
        httpsTemplate.hasResourceProperties(
          "AWS::ElasticLoadBalancingV2::Listener",
          {
            Protocol: "HTTPS",
            Port: 443,
            Certificates: Match.arrayWith([
              Match.objectLike({
                CertificateArn: TEST_CONSTANTS.CERTIFICATE_ARN,
              }),
            ]),
          }
        );
      }).not.toThrow();
    });

    test("creates HTTP to HTTPS redirect when HTTPS enabled", () => {
      expect(() => {
        redirectTemplate.hasResourceProperties(
          "AWS::ElasticLoadBalancingV2::Listener",
          {
            Protocol: "HTTP",
            Port: 80,
            DefaultActions: Match.arrayWith([
              Match.objectLike({
                Type: "redirect",
                RedirectConfig: Match.objectLike({
                  Protocol: "HTTPS",
                  Port: "443",
                  StatusCode: "HTTP_301",
                }),
              }),
            ]),
          }
        );
      }).not.toThrow();
    });
  });
});
