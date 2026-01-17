/** @format */
/// <reference types="jest" />

/**
 * Security Posture Tests: Application Security
 *
 * Validates application-level security configurations including:
 * - Load balancer security settings
 * - Target group health checks
 * - Container security (no privileged containers)
 * - Secrets management
 * - SSM State Manager security
 *
 * @see https://docs.aws.amazon.com/elasticloadbalancing/latest/application/application-load-balancers.html
 */

import { Template, Match } from "aws-cdk-lib/assertions";

import {
  RESOURCE_TYPES,
  type ConnectivityTestStacks,
  INSTANCE_TEST_STACKS,
  IAM_TEST_STACKS,
} from "../connectivity/test-config";
import { SecurityTestFixtures } from "../utils/test-utils";
// Import shared utilities - functions
import {
  getResources,
  getResourceProperties,
  findAlbAttribute,
  findTargetGroupAttribute,
  getContainersFromTaskDef,
  getTaskDefNetworkMode,
  getSsmTargets,
  secretNameMatches,
  hasHardcodedSecrets,
  usesSecretsManager,
  prepareContainerData,
  prepareTargetGroupData,
  prepareSecretData,
  validateResourceProperties,
  isInRange,
  isValidNetworkMode,
  isValidComplianceSeverity,
} from "../utils";
// Import shared utilities - types
import type {
  PreparedContainerData,
  PreparedTargetGroupData,
  PreparedSecretData,
} from "../utils";

describe("Security Posture: Application Security", () => {
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

  // ==========================================================================
  // LOAD BALANCER CONFIGURATION
  // ==========================================================================

  describe("Load Balancer Configuration", () => {
    // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
    test("ALB has drop invalid header fields enabled", () => {
      const template = getTemplate(INSTANCE_TEST_STACKS[0]);

      template.hasResourceProperties(RESOURCE_TYPES.ALB, {
        LoadBalancerAttributes: Match.arrayWith([
          Match.objectLike({
            Key: "routing.http.drop_invalid_header_fields.enabled",
            Value: "true",
          }),
        ]),
      });
    });

    test("ALB has deletion protection configured for production", () => {
      const prodStacks = SecurityTestFixtures.getProductionStacks();
      const template = Template.fromStack(prodStacks[INSTANCE_TEST_STACKS[0]]);
      const albs = getResources(template, RESOURCE_TYPES.ALB);

      expect(albs.length).toBeGreaterThan(0);
      albs.forEach((alb) => {
        const deletionProtection = findAlbAttribute(
          alb,
          "deletion_protection.enabled"
        );

        expect(deletionProtection).toBeDefined();
        expect(deletionProtection?.Value).toBeDefined();
      });
    });

    // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
    test("ALB is internet-facing with proper security groups", () => {
      const template = getTemplate(INSTANCE_TEST_STACKS[0]);

      template.hasResourceProperties(RESOURCE_TYPES.ALB, {
        Scheme: "internet-facing",
        SecurityGroups: Match.anyValue(),
      });
    });

    describe("ALB Access Logs Configuration", () => {
      let albsWithAccessLogs: Array<{
        alb: unknown;
        accessLogsEnabled: string | undefined;
      }>;

      beforeAll(() => {
        const template = getTemplate(INSTANCE_TEST_STACKS[0]);
        const albs = getResources(template, RESOURCE_TYPES.ALB);

        // Pre-filter and extract in beforeAll
        albsWithAccessLogs = albs
          .map((alb) => {
            const accessLogsAttr = findAlbAttribute(alb, "access_logs.s3.enabled");
            return {
              alb,
              accessLogsEnabled: accessLogsAttr?.Value,
            };
          })
          .filter((item) => item.accessLogsEnabled !== undefined);
      });

      test("ALBs with access logs have valid configuration values", () => {
        // This test validates configuration IF access logs are configured
        // Empty array is valid - means access logs are not configured
        expect(albsWithAccessLogs).toBeDefined();
        expect(Array.isArray(albsWithAccessLogs)).toBe(true);

        // If configured, values must be valid
        albsWithAccessLogs.forEach(({ accessLogsEnabled }) => {
          expect(["false", "true"]).toContain(accessLogsEnabled);
        });
      });
    });
  });

  // ==========================================================================
  // TARGET GROUP HEALTH CHECKS
  // ==========================================================================

  describe("Target Group Health Checks", () => {
    describe("Health Check Configuration", () => {
      let preparedTargetGroups: PreparedTargetGroupData[];

      beforeAll(() => {
        const template = getTemplate(IAM_TEST_STACKS[3]);
        const targetGroups = getResources(template, RESOURCE_TYPES.TARGET_GROUP);

        // Pre-compute all health check data
        preparedTargetGroups = targetGroups.map(prepareTargetGroupData);
      });

      test("target groups exist", () => {
        expect(preparedTargetGroups.length).toBeGreaterThan(0);
      });

      test("target groups have health checks configured", () => {
        preparedTargetGroups.forEach(({ hasHealthCheck }) => {
          expect(hasHealthCheck).toBe(true);
        });
      });

      test("target groups have appropriate health check thresholds", () => {
        preparedTargetGroups.forEach(({ healthyThreshold, unhealthyThreshold }) => {
          expect(healthyThreshold).toBeDefined();
          expect(unhealthyThreshold).toBeDefined();

          // Thresholds should be reasonable (2-10)
          expect(isInRange(healthyThreshold!, 2, 10)).toBe(true);
          expect(isInRange(unhealthyThreshold!, 2, 10)).toBe(true);
        });
      });
    });

    describe("Deregistration Delay Configuration", () => {
      let targetGroupsWithDelay: Array<{
        targetGroup: unknown;
        delaySeconds: number;
      }>;

      beforeAll(() => {
        const template = getTemplate(IAM_TEST_STACKS[3]);
        const targetGroups = getResources(template, RESOURCE_TYPES.TARGET_GROUP);

        // Pre-filter and extract in beforeAll
        targetGroupsWithDelay = targetGroups
          .map((targetGroup) => {
            const deregDelayAttr = findTargetGroupAttribute(
              targetGroup,
              "deregistration_delay.timeout_seconds"
            );
            return {
              targetGroup,
              delaySeconds: deregDelayAttr ? parseInt(deregDelayAttr.Value || "0") : -1,
            };
          })
          .filter((item) => item.delaySeconds >= 0);
      });

      test("target groups have deregistration delay configured", () => {
        expect(targetGroupsWithDelay.length).toBeGreaterThan(0);
      });

      test("deregistration delay is within acceptable range", () => {
        targetGroupsWithDelay.forEach(({ delaySeconds }) => {
          expect(isInRange(delaySeconds, 0, 300)).toBe(true);
        });
      });
    });
  });

  // ==========================================================================
  // CONTAINER SECURITY
  // ==========================================================================

  describe("Container Security", () => {
    describe("Container Configuration", () => {
      let preparedContainers: PreparedContainerData[];

      beforeAll(() => {
        const template = getTemplate(IAM_TEST_STACKS[3]);
        const taskDefs = getResources(template, RESOURCE_TYPES.ECS_TASK_DEFINITION);

        // Pre-compute all container data
        preparedContainers = taskDefs.flatMap((taskDef) => {
          const containers = getContainersFromTaskDef(taskDef);
          return containers.map((container) =>
            prepareContainerData(container as Record<string, unknown>)
          );
        });
      });

      test("containers exist", () => {
        expect(preparedContainers.length).toBeGreaterThan(0);
      });

      test("ECS containers log to CloudWatch", () => {
        preparedContainers.forEach(({ container, hasLogConfiguration }) => {
          expect(hasLogConfiguration).toBe(true);
          const logConfig = (container as Record<string, Record<string, string>>)
            .LogConfiguration;
          expect(logConfig.LogDriver).toBe("awslogs");
        });
      });

      test("ECS task definitions do not run privileged containers", () => {
        preparedContainers.forEach(({ isPrivileged }) => {
          expect(isPrivileged).toBe(false);
        });
      });

      test("ECS containers have resource limits configured", () => {
        preparedContainers.forEach(({ hasMemoryLimits }) => {
          expect(hasMemoryLimits).toBe(true);
        });
      });
    });

    describe("Container User Configuration", () => {
      let containersWithUser: PreparedContainerData[];

      beforeAll(() => {
        const template = getTemplate(IAM_TEST_STACKS[3]);
        const taskDefs = getResources(template, RESOURCE_TYPES.ECS_TASK_DEFINITION);

        // Pre-filter containers with user specified
        const allContainers = taskDefs.flatMap((taskDef) => {
          const containers = getContainersFromTaskDef(taskDef);
          return containers.map((container) =>
            prepareContainerData(container as Record<string, unknown>)
          );
        });

        containersWithUser = allContainers.filter((c) => c.hasUser);
      });

      test("containers with user specified do not run as root", () => {
        // This test validates that IF user is specified, it's not root
        // Empty array is valid - means no containers explicitly set a user
        expect(containersWithUser).toBeDefined();
        expect(Array.isArray(containersWithUser)).toBe(true);

        // If user is specified, it must not be root
        containersWithUser.forEach(({ runsAsRoot }) => {
          expect(runsAsRoot).toBe(false);
        });
      });
    });

    describe("Task Definition Network Mode", () => {
      let taskDefsWithNetworkMode: Array<{
        taskDef: unknown;
        networkMode: string;
      }>;

      beforeAll(() => {
        const template = getTemplate(IAM_TEST_STACKS[3]);
        const taskDefs = getResources(template, RESOURCE_TYPES.ECS_TASK_DEFINITION);

        // Pre-filter and extract in beforeAll
        taskDefsWithNetworkMode = taskDefs
          .map((taskDef) => ({
            taskDef,
            networkMode: getTaskDefNetworkMode(taskDef),
          }))
          .filter(
            (item): item is { taskDef: unknown; networkMode: string } =>
              item.networkMode !== undefined
          );
      });

      test("task definitions with network mode exist", () => {
        expect(taskDefsWithNetworkMode.length).toBeGreaterThan(0);
      });

      test("ECS tasks use valid network modes", () => {
        taskDefsWithNetworkMode.forEach(({ networkMode }) => {
          expect(isValidNetworkMode(networkMode)).toBe(true);
        });
      });
    });
  });

  // ==========================================================================
  // SECRETS MANAGEMENT
  // ==========================================================================

  describe("Secrets Management", () => {
    describe("Grafana Secret Configuration", () => {
      let secrets: unknown[];
      let hasGrafanaSecret: boolean;

      beforeAll(() => {
        const template = getTemplate(IAM_TEST_STACKS[3]);
        secrets = getResources(template, "AWS::SecretsManager::Secret");

        // Pre-compute in beforeAll
        hasGrafanaSecret = secrets.some((secret) =>
          secretNameMatches(secret, "grafana")
        );
      });

      test("secrets exist", () => {
        expect(secrets.length).toBeGreaterThan(0);
      });

      test("Grafana admin password stored in Secrets Manager", () => {
        expect(hasGrafanaSecret).toBe(true);
      });
    });

    describe("Secret Rotation Configuration", () => {
      let preparedSecrets: PreparedSecretData[];

      beforeAll(() => {
        const template = getTemplate(IAM_TEST_STACKS[3]);
        const secrets = getResources(template, "AWS::SecretsManager::Secret");

        // Pre-compute all secret data
        preparedSecrets = secrets.map(prepareSecretData);
      });

      test("secrets have configuration defined", () => {
        expect(preparedSecrets.length).toBeGreaterThan(0);

        preparedSecrets.forEach(({ hasSecretConfiguration }) => {
          expect(hasSecretConfiguration).toBe(true);
        });
      });
    });

    describe("Task Definition Secrets", () => {
      let taskDefs: unknown[];
      let taskDefsWithPassword: Array<{
        taskDef: unknown;
        usesSecretsManagerForPassword: boolean;
      }>;

      beforeAll(() => {
        const template = getTemplate(IAM_TEST_STACKS[3]);
        taskDefs = getResources(template, RESOURCE_TYPES.ECS_TASK_DEFINITION);

        // Pre-filter and pre-compute in beforeAll
        taskDefsWithPassword = taskDefs
          .map((taskDef) => {
            const taskDefStr = JSON.stringify(taskDef);
            const hasPasswordField =
              taskDefStr.includes("ADMIN_PASSWORD") ||
              taskDefStr.includes("password");
            return {
              taskDef,
              hasPasswordField,
              usesSecretsManagerForPassword: hasPasswordField
                ? usesSecretsManager(taskDef)
                : true, // Mark as valid if no password field
            };
          })
          .filter((item) => item.hasPasswordField);
      });

      test("no hardcoded secrets in task definitions", () => {
        expect(taskDefs.length).toBeGreaterThan(0);

        taskDefs.forEach((taskDef) => {
          expect(hasHardcodedSecrets(taskDef)).toBe(false);
        });
      });

      test("password fields use Secrets Manager", () => {
        // This test documents the state - may have zero password fields
        expect(taskDefsWithPassword).toBeDefined();

        taskDefsWithPassword.forEach(({ usesSecretsManagerForPassword }) => {
          expect(usesSecretsManagerForPassword).toBe(true);
        });
      });
    });
  });

  // ==========================================================================
  // SSM STATE MANAGER SECURITY
  // ==========================================================================

  describe("SSM State Manager Security", () => {
    test("SSM associations target specific resources", () => {
      const template = getTemplate(INSTANCE_TEST_STACKS[0]);
      const associations = getResources(template, RESOURCE_TYPES.SSM_ASSOCIATION);

      expect(associations.length).toBeGreaterThan(0);

      associations.forEach((association) => {
        const validation = validateResourceProperties(association, ["Targets"]);
        expect(validation.valid).toBe(true);

        const targets = getSsmTargets(association);
        expect(Array.isArray(targets)).toBe(true);
        expect(targets.length).toBeGreaterThan(0);
      });
    });

    test("SSM documents use specific run command document type", () => {
      const template = getTemplate(INSTANCE_TEST_STACKS[0]);
      const documents = getResources(template, "AWS::SSM::Document");

      expect(documents.length).toBeGreaterThan(0);

      documents.forEach((document) => {
        const properties = getResourceProperties<{ DocumentType: string }>(document);
        expect(properties.DocumentType).toBeDefined();
        expect(["Command", "Automation"]).toContain(properties.DocumentType);
      });
    });

    describe("SSM Association Compliance Severity", () => {
      let associationsWithSeverity: Array<{
        association: unknown;
        complianceSeverity: string;
      }>;

      beforeAll(() => {
        const template = getTemplate(INSTANCE_TEST_STACKS[0]);
        const associations = getResources(template, RESOURCE_TYPES.SSM_ASSOCIATION);

        // Pre-filter and extract in beforeAll
        associationsWithSeverity = associations
          .map((association) => {
            const properties = getResourceProperties<{ ComplianceSeverity?: string }>(association);
            return {
              association,
              complianceSeverity: properties.ComplianceSeverity,
            };
          })
          .filter(
            (item): item is { association: unknown; complianceSeverity: string } =>
              item.complianceSeverity !== undefined
          );
      });

      test("associations with compliance severity exist", () => {
        expect(associationsWithSeverity.length).toBeGreaterThan(0);
      });

      test("compliance severity values are valid", () => {
        associationsWithSeverity.forEach(({ complianceSeverity }) => {
          expect(isValidComplianceSeverity(complianceSeverity)).toBe(true);
        });
      });
    });
  });

  // ==========================================================================
  // API SECURITY
  // ==========================================================================

  describe("API Security", () => {
    test("listener rules have appropriate priorities", () => {
      const template = getTemplate(IAM_TEST_STACKS[3]);
      const listenerRules = getResources(template, RESOURCE_TYPES.LISTENER_RULE);

      expect(listenerRules.length).toBeGreaterThan(0);

      const priorities = listenerRules.map((rule) => {
        const properties = getResourceProperties<{ Priority: number }>(rule);
        return properties.Priority;
      });

      // All priorities should be unique
      const uniquePriorities = new Set(priorities);
      expect(uniquePriorities.size).toBe(priorities.length);
    });

    test("listener rules have conditions configured", () => {
      const template = getTemplate(IAM_TEST_STACKS[3]);
      const listenerRules = getResources(template, RESOURCE_TYPES.LISTENER_RULE);

      expect(listenerRules.length).toBeGreaterThan(0);

      listenerRules.forEach((rule) => {
        const validation = validateResourceProperties(rule, ["Conditions"]);
        expect(validation.valid).toBe(true);

        const properties = getResourceProperties<{ Conditions: unknown[] }>(rule);
        expect(Array.isArray(properties.Conditions)).toBe(true);
        expect(properties.Conditions.length).toBeGreaterThan(0);
      });
    });
  });
});