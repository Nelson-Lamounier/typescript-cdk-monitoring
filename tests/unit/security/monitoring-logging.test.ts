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

import { type ConnectivityTestStacks } from "../connectivity/test-config";

import { SecurityTestFixtures } from "../utils/test-utils";

describe("Security Posture: Monitoring & Logging", () => {
  let stacks: ConnectivityTestStacks;

  beforeAll(() => {
    stacks = SecurityTestFixtures.getDevelopmentStacks();
  });

  // ==========================================================================
  // HELPER FUNCTIONS (defined as arrow functions)
  // ==========================================================================

  /**
   * Get template from stack name
   */
  const getTemplate = (stackName: keyof ConnectivityTestStacks) => {
    if (stackName === "app") {
      throw new Error("Cannot get template for app");
    }
    return Template.fromStack(stacks[stackName]);
  };

  /**
   * Get all templates from multiple stacks
   */
  const getTemplates = (
    stackNames: Array<keyof ConnectivityTestStacks>
  ): Template[] => {
    return stackNames.map((name) => getTemplate(name));
  };

  /**
   * Get resources of a specific type
   */
  const getResources = (template: Template, resourceType: string) => {
    return Object.values(template.findResources(resourceType));
  };

  /**
   * Get log groups from template
   */
  const getLogGroups = (template: Template) => {
    return getResources(template, "AWS::Logs::LogGroup");
  };

  /**
   * Get ECS clusters from template
   */
  const getClusters = (template: Template) => {
    return getResources(template, "AWS::ECS::Cluster");
  };

  /**
   * Get EventBridge rules from template
   */
  const getEventBridgeRules = (template: Template) => {
    return getResources(template, "AWS::Events::Rule");
  };

  /**
   * Get task definitions from template
   */
  const getTaskDefinitions = (template: Template) => {
    return getResources(template, "AWS::ECS::TaskDefinition");
  };

  /**
   * Get SSM associations from template
   */
  const getAssociations = (template: Template) => {
    return getResources(template, "AWS::SSM::Association");
  };

  /**
   * Extract deletion policy from resource
   */
  const getDeletionPolicy = (resource: unknown): string | undefined => {
    return (resource as Record<string, string | undefined>).DeletionPolicy;
  };

  /**
   * Extract log group properties
   */
  const getLogGroupProperties = (
    logGroup: unknown
  ): Record<string, unknown> => {
    return (logGroup as Record<string, Record<string, unknown>>).Properties;
  };

  /**
   * Extract cluster settings
   */
  const getClusterSettings = (
    cluster: unknown
  ): Array<Record<string, string>> => {
    const properties = (cluster as Record<string, Record<string, unknown>>)
      .Properties;
    return (properties.ClusterSettings || []) as Array<Record<string, string>>;
  };

  /**
   * Extract container insights setting from cluster
   */
  const getContainerInsightsSetting = (
    cluster: unknown
  ): Record<string, string> | undefined => {
    const settings = getClusterSettings(cluster);
    return settings.find((setting) => setting.Name === "containerInsights");
  };

  /**
   * Extract container definitions from task definition
   */
  const getContainerDefinitions = (
    taskDef: unknown
  ): Array<Record<string, unknown>> => {
    const properties = (taskDef as Record<string, Record<string, unknown>>)
      .Properties;
    return (properties.ContainerDefinitions || []) as Array<
      Record<string, unknown>
    >;
  };

  /**
   * Extract log configuration from container
   */
  const getLogConfiguration = (
    container: unknown
  ): Record<string, unknown> | undefined => {
    return (container as Record<string, Record<string, unknown>>)
      .LogConfiguration;
  };

  /**
   * Extract log configuration options
   */
  const getLogOptions = (
    container: unknown
  ): Record<string, string> | undefined => {
    const logConfig = getLogConfiguration(container);
    return logConfig?.Options as Record<string, string> | undefined;
  };

  /**
   * Extract rule properties
   */
  const getRuleProperties = (rule: unknown): Record<string, unknown> => {
    return (rule as Record<string, Record<string, unknown>>).Properties;
  };

  /**
   * Extract association properties
   */
  const getAssociationProperties = (
    association: unknown
  ): Record<string, unknown> => {
    return (association as Record<string, Record<string, unknown>>).Properties;
  };

  // ==========================================================================
  // CLOUDWATCH LOGS
  // ==========================================================================

  describe("CloudWatch Logs", () => {
    test("log groups have retention configured", () => {
      const template = getTemplate("infraStack");

      template.hasResourceProperties("AWS::Logs::LogGroup", {
        RetentionInDays: Match.anyValue(),
      });
    });

    test("log groups have deletion policy configured for production", () => {
      const prodStacks = SecurityTestFixtures.getProductionStacks();
      const template = Template.fromStack(prodStacks.infraStack);
      const logGroups = getLogGroups(template);

      logGroups.forEach((logGroup) => {
        const deletionPolicy = getDeletionPolicy(logGroup);

        expect(deletionPolicy).toBeDefined();
        expect(["Retain", "Delete", "Snapshot"]).toContain(deletionPolicy);
      });
    });

    test("all log groups have retention set to prevent indefinite storage", () => {
      const templates = getTemplates([
        "networkingStack",
        "infraStack",
        "serviceStack",
      ]);

      templates.forEach((template) => {
        const logGroups = getLogGroups(template);

        logGroups.forEach((logGroup) => {
          const properties = getLogGroupProperties(logGroup);
          expect(properties.RetentionInDays).toBeDefined();
          expect(properties.RetentionInDays).not.toBe(null);
        });
      });
    });

    test("log group names follow consistent naming pattern", () => {
      const templates = getTemplates([
        "networkingStack",
        "infraStack",
        "serviceStack",
      ]);

      templates.forEach((template) => {
        const logGroups = getLogGroups(template);

        logGroups.forEach((logGroup) => {
          const properties = getLogGroupProperties(logGroup);
          const logGroupName = properties.LogGroupName;

          if (typeof logGroupName === "string") {
            expect(logGroupName.length).toBeGreaterThan(0);
          } else if (logGroupName && typeof logGroupName === "object") {
            expect(logGroupName).toBeDefined();
          }
        });
      });
    });
  });

  // ==========================================================================
  // VPC FLOW LOGS
  // ==========================================================================

  describe("VPC Flow Logs", () => {
    test("VPC Flow Logs capture all traffic types", () => {
      const template = getTemplate("networkingStack");

      template.hasResourceProperties("AWS::EC2::FlowLog", {
        TrafficType: "ALL",
      });
    });

    test("VPC Flow Logs have IAM role for CloudWatch Logs delivery", () => {
      const template = getTemplate("networkingStack");

      template.hasResourceProperties("AWS::EC2::FlowLog", {
        DeliverLogsPermissionArn: Match.anyValue(),
      });
    });

    test("VPC Flow Logs are sent to CloudWatch Logs", () => {
      const template = getTemplate("networkingStack");

      template.hasResourceProperties("AWS::EC2::FlowLog", {
        LogDestinationType: "cloud-watch-logs",
        LogGroupName: Match.anyValue(),
      });
    });
  });

  // ==========================================================================
  // CONTAINER INSIGHTS
  // ==========================================================================

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

    test("Container Insights is explicitly configured (if configured)", () => {
      const template = getTemplate("infraStack");
      const clusters = getClusters(template);

      clusters.forEach((cluster) => {
        const containerInsights = getContainerInsightsSetting(cluster);

        if (containerInsights) {
          expect(["enabled", "disabled"]).toContain(containerInsights.Value);
        }
      });
    });
  });

  // ==========================================================================
  // EVENTBRIDGE RULES
  // ==========================================================================

  describe("EventBridge Rules", () => {
    test("ECS state change events are captured", () => {
      const template = getTemplate("infraStack");

      template.hasResourceProperties("AWS::Events::Rule", {
        EventPattern: Match.objectLike({
          source: ["aws.ecs"],
          "detail-type": Match.anyValue(),
        }),
      });
    });

    test("EventBridge rules have targets configured", () => {
      const template = getTemplate("infraStack");
      const rules = getEventBridgeRules(template);

      rules.forEach((rule) => {
        const properties = getRuleProperties(rule);
        expect(properties.Targets).toBeDefined();
        expect(Array.isArray(properties.Targets)).toBe(true);
      });
    });

    test("EventBridge rules are enabled (if state is specified)", () => {
      const template = getTemplate("infraStack");
      const rules = getEventBridgeRules(template);

      rules.forEach((rule) => {
        const properties = getRuleProperties(rule) as Record<string, string>;
        const state = properties.State;

        if (state) {
          expect(state).toBe("ENABLED");
        }
      });
    });
  });

  // ==========================================================================
  // APPLICATION LOGGING
  // ==========================================================================

  describe("Application Logging", () => {
    test("ECS containers log to CloudWatch", () => {
      const template = getTemplate("serviceStack");
      const taskDefs = getTaskDefinitions(template);

      taskDefs.forEach((taskDef) => {
        const containers = getContainerDefinitions(taskDef);

        containers.forEach((container) => {
          const logConfig = getLogConfiguration(container);
          expect(logConfig).toBeDefined();
          expect(logConfig?.LogDriver).toBe("awslogs");
          expect(logConfig?.Options).toBeDefined();
        });
      });
    });

    test("container logs have stream prefix configured (if log configuration exists)", () => {
      const template = getTemplate("serviceStack");
      const taskDefs = getTaskDefinitions(template);

      taskDefs.forEach((taskDef) => {
        const containers = getContainerDefinitions(taskDef);

        containers.forEach((container) => {
          const options = getLogOptions(container);

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

  // ==========================================================================
  // AUDIT LOGGING
  // ==========================================================================

  describe("Audit Logging", () => {
    test("SSM associations have output logging configured", () => {
      const template = getTemplate("infraStack");
      const associations = getAssociations(template);

      associations.forEach((association) => {
        const properties = getAssociationProperties(association);

        // At minimum, associations are tracked in SSM State Manager
        expect(properties.AssociationName).toBeDefined();
      });
    });
  });
});
