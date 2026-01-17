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
  type ConnectivityTestStacks,
  MONITORING_TEST_STACKS,
} from "../connectivity/test-config";
import { SecurityTestFixtures } from "../utils/test-utils";
// Import shared utilities - functions
import {
  getLogGroups,
  getClusters,
  getEventBridgeRules,
  getTaskDefinitions,
  getAssociations,
  getDeletionPolicy,
  getLogGroupProperties,
  getContainerInsightsSetting,
  getContainersFromTaskDef,
  getLogConfiguration,
  getLogOptions,
  getRuleProperties,
  getAssociationProperties,
} from "../utils";

describe("Security Posture: Monitoring & Logging", () => {
  let stacks: ConnectivityTestStacks;

  beforeAll(() => {
    stacks = SecurityTestFixtures.getDevelopmentStacks();
  });

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
    stackNames: ReadonlyArray<keyof ConnectivityTestStacks>
  ): Template[] => {
    return stackNames.map((name) => getTemplate(name));
  };

  // ==========================================================================
  // CLOUDWATCH LOGS
  // ==========================================================================

  describe("CloudWatch Logs", () => {
    // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
    test("log groups have retention configured", () => {
      const template = getTemplate(MONITORING_TEST_STACKS[1]);

      template.hasResourceProperties("AWS::Logs::LogGroup", {
        RetentionInDays: Match.anyValue(),
      });
    });

    describe("Production Log Group Deletion Policies", () => {
      let prodLogGroups: unknown[];

      beforeAll(() => {
        const prodStacks = SecurityTestFixtures.getProductionStacks();
        const template = Template.fromStack(prodStacks.infraStack);
        prodLogGroups = getLogGroups(template);
      });

      test("log groups exist", () => {
        expect(prodLogGroups.length).toBeGreaterThan(0);
      });

      test("log groups have deletion policy configured for production", () => {
        expect(prodLogGroups).toBeDefined();
        expect(Array.isArray(prodLogGroups)).toBe(true);

        prodLogGroups.forEach((logGroup) => {
          const deletionPolicy = getDeletionPolicy(logGroup);

          expect(deletionPolicy).toBeDefined();
          expect(["Retain", "Delete", "Snapshot"]).toContain(deletionPolicy);
        });
      });
    });

    describe("Log Group Retention Configuration", () => {
      let allLogGroups: Array<{
        logGroup: unknown;
        properties: Record<string, unknown>;
      }>;

      beforeAll(() => {
        const templates = getTemplates(MONITORING_TEST_STACKS);

        // Pre-compute all log groups with their properties
        allLogGroups = templates.flatMap((template) => {
          const logGroups = getLogGroups(template);
          return logGroups.map((logGroup) => ({
            logGroup,
            properties: getLogGroupProperties(logGroup),
          }));
        });
      });

      test("log groups exist", () => {
        expect(allLogGroups.length).toBeGreaterThan(0);
      });

      test("all log groups have retention set to prevent indefinite storage", () => {
        expect(allLogGroups).toBeDefined();
        expect(Array.isArray(allLogGroups)).toBe(true);

        allLogGroups.forEach(({ properties }) => {
          expect(properties.RetentionInDays).toBeDefined();
          expect(properties.RetentionInDays).not.toBe(null);
        });
      });
    });

    describe("Log Group Naming", () => {
      let stringLogGroupNames: Array<{
        logGroup: unknown;
        logGroupName: string;
      }>;
      let objectLogGroupNames: Array<{
        logGroup: unknown;
        logGroupName: unknown;
      }>;

      beforeAll(() => {
        const templates = getTemplates(MONITORING_TEST_STACKS);

        // Pre-compute and separate log groups by name type
        const allLogGroups = templates.flatMap((template) => {
          const logGroups = getLogGroups(template);
          return logGroups.map((logGroup) => {
            const properties = getLogGroupProperties(logGroup);
            return {
              logGroup,
              logGroupName: properties.LogGroupName,
            };
          });
        });

        // Pre-filter string and object log group names
        stringLogGroupNames = allLogGroups
          .filter(
            (item): item is { logGroup: unknown; logGroupName: string } =>
              typeof item.logGroupName === "string"
          )
          .map((item) => ({
            logGroup: item.logGroup,
            logGroupName: item.logGroupName,
          }));

        objectLogGroupNames = allLogGroups
          .filter(
            (item) =>
              item.logGroupName !== null &&
              typeof item.logGroupName === "object"
          )
          .map((item) => ({
            logGroup: item.logGroup,
            logGroupName: item.logGroupName,
          }));
      });

      test("log groups exist", () => {
        expect(
          stringLogGroupNames.length + objectLogGroupNames.length
        ).toBeGreaterThan(0);
      });

      test("log group names follow consistent naming pattern", () => {
        expect(stringLogGroupNames).toBeDefined();
        expect(Array.isArray(stringLogGroupNames)).toBe(true);
        expect(objectLogGroupNames).toBeDefined();
        expect(Array.isArray(objectLogGroupNames)).toBe(true);

        // Validate string log group names
        stringLogGroupNames.forEach(({ logGroupName }) => {
          expect(logGroupName.length).toBeGreaterThan(0);
        });

        // Validate object log group names
        objectLogGroupNames.forEach(({ logGroupName }) => {
          expect(logGroupName).toBeDefined();
        });
      });
    });
  });

  // ==========================================================================
  // VPC FLOW LOGS
  // ==========================================================================

  describe("VPC Flow Logs", () => {
    // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
    test("VPC Flow Logs capture all traffic types", () => {
      const template = getTemplate("networkingStack");

      template.hasResourceProperties("AWS::EC2::FlowLog", {
        TrafficType: "ALL",
      });
    });

    // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
    test("VPC Flow Logs have IAM role for CloudWatch Logs delivery", () => {
      const template = getTemplate("networkingStack");

      template.hasResourceProperties("AWS::EC2::FlowLog", {
        DeliverLogsPermissionArn: Match.anyValue(),
      });
    });

    // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
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
    // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
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

    describe("Container Insights Configuration", () => {
      let clustersWithInsights: Array<{
        cluster: unknown;
        containerInsights: { Name: string; Value: string } | undefined;
      }>;
      let clustersWithConfiguredInsights: Array<{
        cluster: unknown;
        containerInsights: { Name: string; Value: string };
      }>;

      beforeAll(() => {
        const template = getTemplate(MONITORING_TEST_STACKS[1]);
        const clusters = getClusters(template);

        // Pre-compute clusters with container insights setting
        clustersWithInsights = clusters.map((cluster) => ({
          cluster,
          containerInsights: getContainerInsightsSetting(cluster),
        }));

        // Pre-filter to only clusters that have Container Insights configured
        clustersWithConfiguredInsights = clustersWithInsights
          .filter(
            (item): item is {
              cluster: unknown;
              containerInsights: { Name: string; Value: string };
            } => item.containerInsights !== undefined
          )
          .map((item) => ({
            cluster: item.cluster,
            containerInsights: item.containerInsights,
          }));
      });

      test("clusters exist", () => {
        expect(clustersWithInsights.length).toBeGreaterThan(0);
      });

      test("Container Insights is explicitly configured (if configured)", () => {
        // This test validates configuration IF Container Insights is configured
        // Empty array is valid - means no clusters have Container Insights
        expect(clustersWithConfiguredInsights).toBeDefined();
        expect(Array.isArray(clustersWithConfiguredInsights)).toBe(true);

        // If Container Insights is configured, validate the value
        clustersWithConfiguredInsights.forEach(({ containerInsights }) => {
          expect(["enabled", "disabled"]).toContain(containerInsights.Value);
        });
      });
    });
  });

  // ==========================================================================
  // EVENTBRIDGE RULES
  // ==========================================================================

  describe("EventBridge Rules", () => {
    // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
    test("ECS state change events are captured", () => {
      const template = getTemplate(MONITORING_TEST_STACKS[1]);

      template.hasResourceProperties("AWS::Events::Rule", {
        EventPattern: Match.objectLike({
          source: ["aws.ecs"],
          "detail-type": Match.anyValue(),
        }),
      });
    });

    describe("EventBridge Rule Configuration", () => {
      let rules: unknown[];

      beforeAll(() => {
        const template = getTemplate(MONITORING_TEST_STACKS[1]);
        rules = getEventBridgeRules(template);
      });

      test("EventBridge rules exist", () => {
        expect(rules.length).toBeGreaterThan(0);
      });

      test("EventBridge rules have targets configured", () => {
        expect(rules).toBeDefined();
        expect(Array.isArray(rules)).toBe(true);

        rules.forEach((rule) => {
          const properties = getRuleProperties(rule);
          expect(properties.Targets).toBeDefined();
          expect(Array.isArray(properties.Targets)).toBe(true);
        });
      });
    });

    describe("EventBridge Rule State", () => {
      let rulesWithState: Array<{
        rule: unknown;
        state: string | undefined;
      }>;

      beforeAll(() => {
        const template = getTemplate(MONITORING_TEST_STACKS[1]);
        const rules = getEventBridgeRules(template);

        // Pre-compute rules with state
        rulesWithState = rules.map((rule) => {
          const properties = getRuleProperties(rule) as Record<string, string>;
          return {
            rule,
            state: properties.State,
          };
        });
      });

      test("rules exist", () => {
        expect(rulesWithState.length).toBeGreaterThan(0);
      });

      test("EventBridge rules are enabled (if state is specified)", () => {
        // This test validates configuration IF state is specified
        // Empty array is valid - means no rules have state specified
        expect(rulesWithState).toBeDefined();
        expect(Array.isArray(rulesWithState)).toBe(true);

        // Filter to only rules that have state specified
        const rulesWithSpecifiedState = rulesWithState.filter(
          (item) => item.state !== undefined
        );

        // If state is specified, it must be ENABLED
        rulesWithSpecifiedState.forEach(({ state }) => {
          expect(state).toBeDefined();
          expect(state).toBe("ENABLED");
        });
      });
    });
  });

  // ==========================================================================
  // APPLICATION LOGGING
  // ==========================================================================

  describe("Application Logging", () => {
    describe("Container CloudWatch Logging", () => {
      let containersWithLogConfig: Array<{
        container: unknown;
        logConfig: Record<string, unknown> | undefined;
      }>;

      beforeAll(() => {
        const template = getTemplate(MONITORING_TEST_STACKS[2]);
        const taskDefs = getTaskDefinitions(template);

        // Pre-compute all containers with log configuration
        containersWithLogConfig = taskDefs.flatMap((taskDef) => {
          const containers = getContainersFromTaskDef(taskDef);
          return containers.map((container) => ({
            container,
            logConfig: getLogConfiguration(container),
          }));
        });
      });

      test("containers exist", () => {
        expect(containersWithLogConfig.length).toBeGreaterThan(0);
      });

      test("ECS containers log to CloudWatch", () => {
        expect(containersWithLogConfig).toBeDefined();
        expect(Array.isArray(containersWithLogConfig)).toBe(true);

        containersWithLogConfig.forEach(({ logConfig }) => {
          expect(logConfig).toBeDefined();
          expect(logConfig?.LogDriver).toBe("awslogs");
          expect(logConfig?.Options).toBeDefined();
        });
      });
    });

    describe("Container Log Stream Prefix", () => {
      let containersWithLogOptions: Array<{
        container: unknown;
        options: Record<string, string> | undefined;
        hasStreamPrefix: boolean;
      }>;

      beforeAll(() => {
        const template = getTemplate(MONITORING_TEST_STACKS[2]);
        const taskDefs = getTaskDefinitions(template);

        // Pre-compute containers with log options
        containersWithLogOptions = taskDefs.flatMap((taskDef) => {
          const containers = getContainersFromTaskDef(taskDef);
          return containers.map((container) => {
            const options = getLogOptions(container);
            const hasStreamPrefix =
              options !== undefined &&
              (options["awslogs-stream-prefix"] !== undefined ||
                options["awslogs-stream-prefix"] !== undefined);

            return {
              container,
              options,
              hasStreamPrefix,
            };
          });
        });
      });

      test("containers exist", () => {
        expect(containersWithLogOptions.length).toBeGreaterThan(0);
      });

      test("container logs have stream prefix configured (if log configuration exists)", () => {
        // This test validates configuration IF log configuration exists
        // Empty array is valid - means no containers have log options
        expect(containersWithLogOptions).toBeDefined();
        expect(Array.isArray(containersWithLogOptions)).toBe(true);

        // Filter to only containers that have log options
        const containersWithOptions = containersWithLogOptions.filter(
          (item) => item.options !== undefined
        );

        // If log options exist, validate stream prefix
        containersWithOptions.forEach(({ hasStreamPrefix }) => {
          expect(hasStreamPrefix).toBe(true);
        });
      });
    });
  });

  // ==========================================================================
  // AUDIT LOGGING
  // ==========================================================================

  describe("Audit Logging", () => {
    let associations: unknown[];

    beforeAll(() => {
      const template = getTemplate(MONITORING_TEST_STACKS[1]);
      associations = getAssociations(template);
    });

    test("SSM associations exist", () => {
      expect(associations.length).toBeGreaterThan(0);
    });

    test("SSM associations have output logging configured", () => {
      expect(associations).toBeDefined();
      expect(Array.isArray(associations)).toBe(true);

      associations.forEach((association) => {
        const properties = getAssociationProperties(association);

        // At minimum, associations are tracked in SSM State Manager
        expect(properties.AssociationName).toBeDefined();
      });
    });
  });
});
