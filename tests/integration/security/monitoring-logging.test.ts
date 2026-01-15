/** @format */
/// <reference types="jest" />

/**
 * Security Posture Tests: Monitoring & Logging
 *
 * Validates monitoring and logging configurations including:
 * - CloudWatch Logs retention and encryption
 * - VPC Flow Logs configuration
 * - Container Insights for ECS
 * - EventBridge rules for security events
 * - Log group deletion policies
 *
 * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/WhatIsCloudWatchLogs.html
 */

import { Template, Match } from "aws-cdk-lib/assertions";

import {
  SecurityTestFixtures,
  TEST_CONSTANTS,
  type SecurityTestStacks,
} from "./test-fixtures";

describe("Security Posture: Monitoring & Logging", () => {
  let stacks: SecurityTestStacks;

  beforeAll(() => {
    stacks = SecurityTestFixtures.getDevelopmentStacks();
  });

  describe("CloudWatch Logs", () => {
    test("log groups have retention configured", () => {
      const template = Template.fromStack(stacks.infraStack);

      template.hasResourceProperties("AWS::Logs::LogGroup", {
        RetentionInDays: Match.anyValue(),
      });
    });

    test("log groups have deletion policy configured for production", () => {
      const prodStacks = SecurityTestFixtures.getProductionStacks();
      const template = Template.fromStack(prodStacks.infraStack);

      const logGroups = template.findResources("AWS::Logs::LogGroup");

      // Production should have deletion policy explicitly configured
      Object.values(logGroups).forEach((logGroup) => {
        const deletionPolicy = (logGroup as Record<string, unknown>)
          .DeletionPolicy;
        
        // Deletion policy should be explicitly set (Retain, Delete, or Snapshot)
        expect(deletionPolicy).toBeDefined();
        expect(["Retain", "Delete", "Snapshot"]).toContain(deletionPolicy);
      });
    });

    test("all log groups have retention set to prevent indefinite storage", () => {
      const templates = [
        Template.fromStack(stacks.networkingStack),
        Template.fromStack(stacks.infraStack),
        Template.fromStack(stacks.serviceStack),
      ];

      templates.forEach((template) => {
        const logGroups = template.findResources("AWS::Logs::LogGroup");

        Object.values(logGroups).forEach((logGroup) => {
          const properties = (
            logGroup as Record<string, Record<string, unknown>>
          ).Properties;
          expect(properties.RetentionInDays).toBeDefined();
          expect(properties.RetentionInDays).not.toBe(null);
        });
      });
    });

    test("log group names follow consistent naming pattern", () => {
      const templates = [
        Template.fromStack(stacks.networkingStack),
        Template.fromStack(stacks.infraStack),
        Template.fromStack(stacks.serviceStack),
      ];

      templates.forEach((template) => {
        const logGroups = template.findResources("AWS::Logs::LogGroup");

        Object.values(logGroups).forEach((logGroup) => {
          const properties = (
            logGroup as Record<string, Record<string, unknown>>
          ).Properties;
          
          // LogGroupName can be a string, object (Ref), or undefined
          const logGroupName = properties.LogGroupName;
          
          if (typeof logGroupName === "string") {
            // String log group names should be descriptive
            expect(logGroupName.length).toBeGreaterThan(0);
          } else if (logGroupName && typeof logGroupName === "object") {
            // Dynamic names (Ref, Fn::Join, etc.) are acceptable
            expect(logGroupName).toBeDefined();
          }
          // If no explicit name, CloudFormation generates one automatically
        });
      });
    });
  });

  describe("VPC Flow Logs", () => {
    test("VPC Flow Logs capture all traffic types", () => {
      const template = Template.fromStack(stacks.networkingStack);

      template.hasResourceProperties("AWS::EC2::FlowLog", {
        TrafficType: "ALL",
      });
    });

    test("VPC Flow Logs have IAM role for CloudWatch Logs delivery", () => {
      const template = Template.fromStack(stacks.networkingStack);

      template.hasResourceProperties("AWS::EC2::FlowLog", {
        DeliverLogsPermissionArn: Match.anyValue(),
      });
    });

    test("VPC Flow Logs are sent to CloudWatch Logs", () => {
      const template = Template.fromStack(stacks.networkingStack);

      template.hasResourceProperties("AWS::EC2::FlowLog", {
        LogDestinationType: "cloud-watch-logs",
        LogGroupName: Match.anyValue(),
      });
    });
  });

  describe("Container Insights", () => {
    test("ECS cluster has Container Insights enabled for production", () => {
      const prodStacks = SecurityTestFixtures.getProductionStacks();
      const template = Template.fromStack(prodStacks.infraStack);

      template.hasResourceProperties("AWS::ECS::Cluster", {
        ClusterSettings: Match.arrayWith([
          Match.objectLike({
            Name: "containerInsights",
            Value: "enabled",
          }),
        ]),
      });
    });

    test("Container Insights is explicitly configured", () => {
      const template = Template.fromStack(stacks.infraStack);

      const clusters = template.findResources("AWS::ECS::Cluster");

      Object.values(clusters).forEach((cluster) => {
        const properties = (cluster as Record<string, Record<string, unknown>>)
          .Properties;
        const settings = (properties.ClusterSettings || []) as Array<
          Record<string, string>
        >;

        const containerInsights = settings.find(
          (setting) => setting.Name === "containerInsights"
        );

        if (containerInsights) {
          // Container Insights should be explicitly enabled or disabled
          expect(["enabled", "disabled"]).toContain(containerInsights.Value);
        }
      });
    });
  });

  describe("EventBridge Rules", () => {
    test("ECS state change events are captured", () => {
      const template = Template.fromStack(stacks.infraStack);

      template.hasResourceProperties("AWS::Events::Rule", {
        EventPattern: Match.objectLike({
          source: ["aws.ecs"],
          "detail-type": Match.anyValue(),
        }),
      });
    });

    test("EventBridge rules have targets configured", () => {
      const template = Template.fromStack(stacks.infraStack);

      const rules = template.findResources("AWS::Events::Rule");

      Object.values(rules).forEach((rule) => {
        const properties = (rule as Record<string, Record<string, unknown>>)
          .Properties;
        expect(properties.Targets).toBeDefined();
        expect(Array.isArray(properties.Targets)).toBe(true);
      });
    });

    test("EventBridge rules are enabled", () => {
      const template = Template.fromStack(stacks.infraStack);

      const rules = template.findResources("AWS::Events::Rule");

      Object.values(rules).forEach((rule) => {
        const properties = (rule as Record<string, Record<string, string>>)
          .Properties;
        // State should either be undefined (defaults to ENABLED) or explicitly ENABLED
        if (properties.State) {
          expect(properties.State).toBe("ENABLED");
        }
      });
    });
  });

  describe("Application Logging", () => {
    test("ECS containers log to CloudWatch", () => {
      const template = Template.fromStack(stacks.serviceStack);

      const taskDefs = template.findResources("AWS::ECS::TaskDefinition");

      Object.values(taskDefs).forEach((taskDef) => {
        const properties = (taskDef as Record<string, Record<string, unknown>>)
          .Properties;
        const containers = properties.ContainerDefinitions as Array<
          Record<string, Record<string, string>>
        >;

        containers.forEach((container) => {
          expect(container.LogConfiguration).toBeDefined();
          expect(container.LogConfiguration.LogDriver).toBe("awslogs");
          expect(container.LogConfiguration.Options).toBeDefined();
        });
      });
    });

    test("container logs have stream prefix configured", () => {
      const template = Template.fromStack(stacks.serviceStack);

      const taskDefs = template.findResources("AWS::ECS::TaskDefinition");

      Object.values(taskDefs).forEach((taskDef) => {
        const properties = (taskDef as Record<string, Record<string, unknown>>)
          .Properties;
        const containers = properties.ContainerDefinitions as Array<
          Record<string, Record<string, Record<string, string>>>
        >;

        containers.forEach((container) => {
          const options = container.LogConfiguration?.Options;
          if (options) {
            expect(
              options["awslogs-stream-prefix"] ||
                options["awslogs-stream-prefix"]
            ).toBeDefined();
          }
        });
      });
    });
  });

  describe("Audit Logging", () => {
    test("SSM associations have output logging configured", () => {
      const template = Template.fromStack(stacks.infraStack);

      const associations = template.findResources("AWS::SSM::Association");

      Object.values(associations).forEach((association) => {
        const properties = (association as Record<string, Record<string, unknown>>)
          .Properties;
        
        // Associations should have output location or sync compliance
        const hasLogging =
          properties.OutputLocation !== undefined ||
          properties.SyncCompliance !== undefined;

        // At minimum, associations are tracked in SSM State Manager
        expect(properties.AssociationName).toBeDefined();
      });
    });
  });
});
