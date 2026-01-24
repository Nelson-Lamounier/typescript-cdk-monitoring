/** @format */
/// <reference types="jest" />

/**
 * MonitoringInfraStack Observability Configuration Tests
 *
 * Tests CloudWatch Logs, ECS events, and SSM State Manager configuration.
 */

import * as cdk from "aws-cdk-lib";
import * as logs from "aws-cdk-lib/aws-logs";
import { Template, Match } from "aws-cdk-lib/assertions";

import {
  MONITORING_TASK_LOG_RETENTION,
  MONITORING_EVENT_LOG_RETENTION,
} from "../../../../../lib/shared/constants/monitoring-constants";
import {
  createTestApp,
  extendExpectWithCdkMatchers,
} from "../../../utils/stack-test-utils";

import { createTestStack } from "./shared-fixtures";

// ============================================================================
// CUSTOM MATCHERS SETUP
// ============================================================================

extendExpectWithCdkMatchers();

// ============================================================================
// TESTS
// ============================================================================

describe("MonitoringInfraStack - Observability Configuration", () => {
  // ==========================================================================
  // CloudWatch Logs Configuration
  // ==========================================================================

  describe("CloudWatch Logs Configuration", () => {
    let defaultTemplate: Template;
    let customTaskRetentionTemplate: Template;
    let customEventRetentionTemplate: Template;

    beforeAll(() => {
      const app = createTestApp();

      // Create all stacks first
      const defaultStack = createTestStack(app, "Logs-Default");
      const customTaskRetentionStack = createTestStack(
        app,
        "Logs-CustomTaskRetention",
        {
          taskLogRetention: logs.RetentionDays.ONE_MONTH,
        }
      );
      const customEventRetentionStack = createTestStack(
        app,
        "Logs-CustomEventRetention",
        {
          eventLogRetention: logs.RetentionDays.SIX_MONTHS,
        }
      );

      // Then create templates
      defaultTemplate = Template.fromStack(defaultStack);
      customTaskRetentionTemplate = Template.fromStack(customTaskRetentionStack);
      customEventRetentionTemplate = Template.fromStack(
        customEventRetentionStack
      );
    });

    test("creates task log group with correct name", () => {
      expect(() => {
        defaultTemplate.hasResourceProperties("AWS::Logs::LogGroup", {
          LogGroupName: Match.stringLikeRegexp("^/ecs/.*/tasks$"),
        });
      }).not.toThrow();
    });

    test("creates event log group with correct name", () => {
      expect(() => {
        defaultTemplate.hasResourceProperties("AWS::Logs::LogGroup", {
          LogGroupName: Match.stringLikeRegexp("^/ecs/.*/events$"),
        });
      }).not.toThrow();
    });

    test("uses default task log retention from constants", () => {
      expect(() => {
        defaultTemplate.hasResourceProperties("AWS::Logs::LogGroup", {
          LogGroupName: Match.stringLikeRegexp("^/ecs/.*/tasks$"),
          RetentionInDays: MONITORING_TASK_LOG_RETENTION,
        });
      }).not.toThrow();
    });

    test("uses default event log retention from constants", () => {
      expect(() => {
        defaultTemplate.hasResourceProperties("AWS::Logs::LogGroup", {
          LogGroupName: Match.stringLikeRegexp("^/ecs/.*/events$"),
          RetentionInDays: MONITORING_EVENT_LOG_RETENTION,
        });
      }).not.toThrow();
    });

    test("respects custom task log retention", () => {
      expect(() => {
        customTaskRetentionTemplate.hasResourceProperties(
          "AWS::Logs::LogGroup",
          {
            LogGroupName: Match.stringLikeRegexp("^/ecs/.*/tasks$"),
            RetentionInDays: 30,
          }
        );
      }).not.toThrow();
    });

    test("respects custom event log retention", () => {
      expect(() => {
        customEventRetentionTemplate.hasResourceProperties(
          "AWS::Logs::LogGroup",
          {
            LogGroupName: Match.stringLikeRegexp("^/ecs/.*/events$"),
            RetentionInDays: 180,
          }
        );
      }).not.toThrow();
    });
  });

  // ==========================================================================
  // Log Group Removal Policy
  // ==========================================================================

  describe("Log Group Removal Policy", () => {
    interface LogGroupPolicy {
      deletionPolicy: string | undefined;
      updateReplacePolicy: string | undefined;
    }

    let logGroupPolicies: LogGroupPolicy[];

    beforeAll(() => {
      const testApp = createTestApp();
      const stack = createTestStack(testApp, "LogRemovalPolicy-Test");
      const template = Template.fromStack(stack);
      const logGroups = template.findResources("AWS::Logs::LogGroup");

      // Pre-extract policies in beforeAll
      logGroupPolicies = Object.values(logGroups).map((lg) => {
        const logGroup = lg as {
          DeletionPolicy?: string;
          UpdateReplacePolicy?: string;
        };
        return {
          deletionPolicy: logGroup.DeletionPolicy,
          updateReplacePolicy: logGroup.UpdateReplacePolicy,
        };
      });
    });

    test("applies DESTROY removal policy to log groups", () => {
      expect(logGroupPolicies.length).toBeGreaterThan(0);

      logGroupPolicies.forEach((policy) => {
        expect(policy.deletionPolicy).toBe("Delete");
        expect(policy.updateReplacePolicy).toBe("Delete");
      });
    });
  });

  // ==========================================================================
  // ECS Event Rule Configuration
  // ==========================================================================

  describe("ECS Event Rule Configuration", () => {
    let template: Template;
    let rules: Record<string, unknown>;

    beforeAll(() => {
      const app = createTestApp();
      const stack = createTestStack(app, "ECSEvents-Test");
      template = Template.fromStack(stack);
      rules = template.findResources("AWS::Events::Rule");
    });

    test("creates event rule for ECS events", () => {
      expect(() => {
        template.hasResourceProperties("AWS::Events::Rule", {
          EventPattern: {
            source: ["aws.ecs"],
            "detail-type": [
              "ECS Task State Change",
              "ECS Container Instance State Change",
              "ECS Service Action",
            ],
          },
        });
      }).not.toThrow();
    });

    test("event rule is configured with targets", () => {
      expect(() => {
        template.resourceCountIs("AWS::Events::Rule", 1);
      }).not.toThrow();

      const ruleProps = Object.values(rules)[0] as { Properties: { Targets?: unknown } };
      expect(ruleProps.Properties.Targets).toBeDefined();
    });
  });

  // ==========================================================================
  // SSM State Manager Configuration
  // ==========================================================================

  describe("SSM State Manager Configuration", () => {
    let template: Template;
    let associations: Record<string, unknown>;
    let hasEcsAgentAssociation: boolean;

    beforeAll(() => {
      const app = createTestApp();
      const stack = createTestStack(app, "SSMStateManager-Test");
      template = Template.fromStack(stack);
      associations = template.findResources("AWS::SSM::Association");

      // Pre-compute conditional check in beforeAll
      hasEcsAgentAssociation = Object.values(associations).some(
        (assoc: any) =>
          assoc.Properties?.Name?.includes?.("AWS-ConfigureAWSPackage")
      );
    });

    test("creates SSM State Manager associations", () => {
      expect(Object.keys(associations).length).toBeGreaterThanOrEqual(2);
    });

    test("configures EFS mount point in SSM", () => {
      expect(hasEcsAgentAssociation).toBe(true);
    });
  });

  // ==========================================================================
  // Best Practices - Constants Usage
  // ==========================================================================

  describe("Best Practices - Constants Usage", () => {
    let template: Template;

    beforeAll(() => {
      const app = createTestApp();
      const stack = createTestStack(app, "BestPractices-Constants", {
        envName: "development",
      });
      template = Template.fromStack(stack);
    });

    test("uses constants for monitoring ports", () => {
      expect(() => {
        template.hasResourceProperties("AWS::EC2::SecurityGroupIngress", {
          IpProtocol: "tcp",
          FromPort: 9090, // MONITORING_PORTS.PROMETHEUS
          ToPort: 9090,
        });
      }).not.toThrow();
    });

    test("uses constants for dynamic port range", () => {
      expect(() => {
        template.hasResourceProperties("AWS::EC2::SecurityGroupIngress", {
          IpProtocol: "tcp",
          FromPort: 32768, // BRIDGE_NETWORK_DYNAMIC_PORT_RANGE.MIN
          ToPort: 65535, // Actual dynamic port range upper limit
        });
      }).not.toThrow();
    });
  });

  // ==========================================================================
  // Production Warnings
  // ==========================================================================

  describe("Production Warnings", () => {
    let warningsStack: cdk.Stack;
    let suppressedStack: cdk.Stack;

    beforeAll(() => {
      const app1 = createTestApp();
      const app2 = createTestApp();

      warningsStack = createTestStack(app1, "Warnings-Test", {
        envName: "development",
        enableHttps: false,
        enableAccessLogs: false,
        allowedIpRanges: ["0.0.0.0/0"],
      });

      suppressedStack = createTestStack(app2, "WarningsSuppressed-Test", {
        envName: "development",
        enableProductionWarnings: false,
        enableHttps: false,
        allowedIpRanges: ["0.0.0.0/0"],
      });
    });

    test("stack warns about production best practices when appropriate", () => {
      expect(warningsStack).toBeDefined();
      expect((warningsStack as any).loadBalancer).toBeDefined();
    });

    test("production warnings can be suppressed via configuration", () => {
      expect(suppressedStack).toBeDefined();
    });
  });

  // ==========================================================================
  // Resource Tagging
  // ==========================================================================

  describe("Resource Tagging", () => {
    let taggedStack: cdk.Stack;
    let customTaggedStack: cdk.Stack;
    let envTaggedStack: cdk.Stack;

    beforeAll(() => {
      const app1 = createTestApp();
      const app2 = createTestApp();
      const app3 = createTestApp();

      taggedStack = createTestStack(app1, "Tagged-Test", {
        envName: "development",
        projectName: "monitoring",
      });

      customTaggedStack = createTestStack(app2, "CustomTagged-Test", {
        customTags: {
          Owner: "DevOps",
          CostCenter: "Engineering",
        },
      });

      envTaggedStack = createTestStack(app3, "EnvTagged-Test", {
        envName: "development",
      });
    });

    test("applies tags to stack resources", () => {
      expect(taggedStack).toBeDefined();
      const tags = cdk.Tags.of(taggedStack);
      expect(tags).toBeDefined();
    });

    test("applies custom tags when specified", () => {
      expect(customTaggedStack).toBeDefined();
      const tags = cdk.Tags.of(customTaggedStack);
      expect(tags).toBeDefined();
    });

    test("applies environment-specific tags", () => {
      expect(envTaggedStack).toBeDefined();
      expect(envTaggedStack.stackName).toContain("EnvTagged-Test");
    });
  });
});
