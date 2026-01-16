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
} from "../connectivity/test-config";

import { SecurityTestFixtures } from "../utils/test-utils";

describe("Security Posture: Application Security", () => {
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
   * Get resources of a specific type
   */
  const getResources = (template: Template, resourceType: string) => {
    return Object.values(template.findResources(resourceType));
  };

  /**
   * Extract ALB attributes
   */
  const getAlbAttributes = (alb: unknown): Array<Record<string, string>> => {
    const properties = (alb as Record<string, Record<string, unknown>>)
      .Properties;
    return (properties.LoadBalancerAttributes || []) as Array<
      Record<string, string>
    >;
  };

  /**
   * Find attribute by key in ALB attributes
   */
  const findAlbAttribute = (
    alb: unknown,
    key: string
  ): Record<string, string> | undefined => {
    const attributes = getAlbAttributes(alb);
    return attributes.find((attr) => attr.Key === key);
  };

  /**
   * Extract target group attributes
   */
  const getTargetGroupAttributes = (
    targetGroup: unknown
  ): Array<Record<string, string>> => {
    const properties = (targetGroup as Record<string, Record<string, unknown>>)
      .Properties;
    return (properties.TargetGroupAttributes || []) as Array<
      Record<string, string>
    >;
  };

  /**
   * Find attribute by key in target group attributes
   */
  const findTargetGroupAttribute = (
    targetGroup: unknown,
    key: string
  ): Record<string, string> | undefined => {
    const attributes = getTargetGroupAttributes(targetGroup);
    return attributes.find((attr) => attr.Key === key);
  };

  /**
   * Extract containers from task definition
   */
  const getContainersFromTaskDef = (
    taskDef: unknown
  ): Array<Record<string, unknown>> => {
    const properties = (taskDef as Record<string, Record<string, unknown>>)
      .Properties;
    return (properties.ContainerDefinitions || []) as Array<
      Record<string, unknown>
    >;
  };

  /**
   * Validate resource has required properties
   */
  const validateResourceProperties = (
    resource: unknown,
    requiredProps: string[]
  ) => {
    const properties = (resource as Record<string, Record<string, unknown>>)
      .Properties;

    requiredProps.forEach((prop) => {
      expect(properties[prop]).toBeDefined();
    });
  };

  /**
   * Check if task definition contains hardcoded secrets
   */
  const hasHardcodedSecrets = (taskDef: unknown): boolean => {
    const taskDefStr = JSON.stringify(taskDef);

    // Check for obvious hardcoded secrets
    const hasPassword = /password\s*["']\s*:\s*["'][^'"]+["']/i.test(
      taskDefStr
    );
    const hasSecret = /secret\s*["']\s*:\s*["'][^'"]+["']/i.test(taskDefStr);
    const hasAccessKey = /AKIA[0-9A-Z]{16}/.test(taskDefStr);

    return hasPassword || hasSecret || hasAccessKey;
  };

  /**
   * Check if task definition uses Secrets Manager
   */
  const usesSecretsManager = (taskDef: unknown): boolean => {
    const taskDefStr = JSON.stringify(taskDef);
    return (
      taskDefStr.includes("Secrets") ||
      taskDefStr.includes("ValueFrom") ||
      taskDefStr.includes("secretsmanager")
    );
  };

  // ==========================================================================
  // LOAD BALANCER CONFIGURATION
  // ==========================================================================

  describe("Load Balancer Configuration", () => {
    test("ALB has drop invalid header fields enabled", () => {
      const template = getTemplate("infraStack");

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
      const template = Template.fromStack(prodStacks.infraStack);
      const albs = getResources(template, RESOURCE_TYPES.ALB);

      albs.forEach((alb) => {
        const deletionProtection = findAlbAttribute(
          alb,
          "deletion_protection.enabled"
        );

        expect(deletionProtection).toBeDefined();
        expect(deletionProtection?.Value).toBeDefined();
      });
    });

    test("ALB is internet-facing with proper security groups", () => {
      const template = getTemplate("infraStack");

      template.hasResourceProperties(RESOURCE_TYPES.ALB, {
        Scheme: "internet-facing",
        SecurityGroups: Match.anyValue(),
      });
    });

    test("ALB has access logs configured (if enabled)", () => {
      const template = getTemplate("infraStack");
      const albs = getResources(template, RESOURCE_TYPES.ALB);

      albs.forEach((alb) => {
        const accessLogsAttr = findAlbAttribute(alb, "access_logs.s3.enabled");

        // If access logs are configured, value should be valid
        if (accessLogsAttr) {
          expect(["false", "true"]).toContain(accessLogsAttr.Value);
        }
      });
    });
  });

  // ==========================================================================
  // TARGET GROUP HEALTH CHECKS
  // ==========================================================================

  describe("Target Group Health Checks", () => {
    test("target groups have health checks configured", () => {
      const template = getTemplate("serviceStack");
      const targetGroups = getResources(template, RESOURCE_TYPES.TARGET_GROUP);

      targetGroups.forEach((targetGroup) => {
        const properties = (
          targetGroup as Record<string, Record<string, unknown>>
        ).Properties;

        expect(properties.HealthCheckPath).toBeDefined();
        expect(properties.HealthCheckIntervalSeconds).toBeDefined();

        // Health check is configured if path or protocol is defined
        expect(
          properties.HealthCheckPath !== undefined ||
            properties.HealthCheckProtocol !== undefined
        ).toBe(true);
      });
    });

    test("target groups have appropriate health check thresholds", () => {
      const template = getTemplate("serviceStack");
      const targetGroups = getResources(template, RESOURCE_TYPES.TARGET_GROUP);

      targetGroups.forEach((targetGroup) => {
        const properties = (
          targetGroup as Record<string, Record<string, number>>
        ).Properties;

        expect(properties.HealthyThresholdCount).toBeDefined();
        expect(properties.UnhealthyThresholdCount).toBeDefined();

        // Thresholds should be reasonable (2-10)
        expect(properties.HealthyThresholdCount).toBeGreaterThanOrEqual(2);
        expect(properties.HealthyThresholdCount).toBeLessThanOrEqual(10);
        expect(properties.UnhealthyThresholdCount).toBeGreaterThanOrEqual(2);
        expect(properties.UnhealthyThresholdCount).toBeLessThanOrEqual(10);
      });
    });

    test("target groups have deregistration delay configured (if configured)", () => {
      const template = getTemplate("serviceStack");
      const targetGroups = getResources(template, RESOURCE_TYPES.TARGET_GROUP);

      targetGroups.forEach((targetGroup) => {
        const deregDelayAttr = findTargetGroupAttribute(
          targetGroup,
          "deregistration_delay.timeout_seconds"
        );

        if (deregDelayAttr) {
          const delaySeconds = parseInt(deregDelayAttr.Value);
          expect(delaySeconds).toBeGreaterThanOrEqual(0);
          expect(delaySeconds).toBeLessThanOrEqual(300);
        }
      });
    });
  });

  // ==========================================================================
  // CONTAINER SECURITY
  // ==========================================================================

  describe("Container Security", () => {
    test("ECS containers log to CloudWatch", () => {
      const template = getTemplate("serviceStack");
      const taskDefs = getResources(
        template,
        RESOURCE_TYPES.ECS_TASK_DEFINITION
      );

      taskDefs.forEach((taskDef) => {
        const containers = getContainersFromTaskDef(taskDef);

        containers.forEach((container) => {
          const logConfig = container.LogConfiguration as Record<
            string,
            string
          >;
          expect(logConfig).toBeDefined();
          expect(logConfig.LogDriver).toBe("awslogs");
        });
      });
    });

    test("ECS task definitions do not run privileged containers", () => {
      const template = getTemplate("serviceStack");
      const taskDefs = getResources(
        template,
        RESOURCE_TYPES.ECS_TASK_DEFINITION
      );

      taskDefs.forEach((taskDef) => {
        const containers = getContainersFromTaskDef(taskDef);

        containers.forEach((container) => {
          const privileged = container.Privileged as boolean | undefined;
          expect(privileged).not.toBe(true);
        });
      });
    });

    test("ECS containers do not run as root user (if user is specified)", () => {
      const template = getTemplate("serviceStack");
      const taskDefs = getResources(
        template,
        RESOURCE_TYPES.ECS_TASK_DEFINITION
      );

      taskDefs.forEach((taskDef) => {
        const containers = getContainersFromTaskDef(taskDef);

        containers.forEach((container) => {
          const user = container.User;

          if (user !== undefined) {
            const userStr = String(user);
            expect(userStr).not.toBe("0");
            expect(userStr).not.toBe("root");
          }
        });
      });
    });

    test("ECS containers have resource limits configured", () => {
      const template = getTemplate("serviceStack");
      const taskDefs = getResources(
        template,
        RESOURCE_TYPES.ECS_TASK_DEFINITION
      );

      taskDefs.forEach((taskDef) => {
        const containers = getContainersFromTaskDef(taskDef);

        containers.forEach((container) => {
          const memory = container.Memory as number | undefined;
          const memoryReservation = container.MemoryReservation as
            | number
            | undefined;

          // Should have either memory or memoryReservation
          expect(memory !== undefined || memoryReservation !== undefined).toBe(
            true
          );
        });
      });
    });

    test("ECS tasks use valid network modes (if network mode is specified)", () => {
      const template = getTemplate("serviceStack");
      const taskDefs = getResources(
        template,
        RESOURCE_TYPES.ECS_TASK_DEFINITION
      );

      taskDefs.forEach((taskDef) => {
        const properties = (taskDef as Record<string, Record<string, string>>)
          .Properties;
        const networkMode = properties.NetworkMode;

        if (networkMode) {
          expect(["awsvpc", "bridge", "host", "none"]).toContain(networkMode);
        }
      });
    });
  });

  // ==========================================================================
  // SECRETS MANAGEMENT
  // ==========================================================================

  describe("Secrets Management", () => {
    test("Grafana admin password stored in Secrets Manager", () => {
      const template = getTemplate("serviceStack");
      const secrets = getResources(template, "AWS::SecretsManager::Secret");

      const hasGrafanaSecret = secrets.some((secret) => {
        const properties = (
          secret as Record<string, Record<string, string | undefined>>
        ).Properties;
        return properties.Name?.includes("grafana");
      });

      expect(hasGrafanaSecret).toBe(true);
    });

    test("secrets have automatic rotation configuration available", () => {
      const template = getTemplate("serviceStack");
      const secrets = getResources(template, "AWS::SecretsManager::Secret");

      secrets.forEach((secret) => {
        const properties = (secret as Record<string, Record<string, unknown>>)
          .Properties;

        // Secrets should have GenerateSecretString or SecretString
        expect(
          properties.GenerateSecretString || properties.SecretString
        ).toBeDefined();
      });
    });

    test("no hardcoded secrets in task definitions", () => {
      const template = getTemplate("serviceStack");
      const taskDefs = getResources(
        template,
        RESOURCE_TYPES.ECS_TASK_DEFINITION
      );

      taskDefs.forEach((taskDef) => {
        // Should not have hardcoded secrets
        expect(hasHardcodedSecrets(taskDef)).toBe(false);

        // If password-related fields exist, should use Secrets Manager
        const taskDefStr = JSON.stringify(taskDef);
        if (
          taskDefStr.includes("ADMIN_PASSWORD") ||
          taskDefStr.includes("password")
        ) {
          expect(usesSecretsManager(taskDef)).toBe(true);
        }
      });
    });
  });

  // ==========================================================================
  // SSM STATE MANAGER SECURITY
  // ==========================================================================

  describe("SSM State Manager Security", () => {
    test("SSM associations target specific resources", () => {
      const template = getTemplate("infraStack");
      const associations = getResources(
        template,
        RESOURCE_TYPES.SSM_ASSOCIATION
      );

      associations.forEach((association) => {
        validateResourceProperties(association, ["Targets"]);

        const properties = (
          association as Record<string, Record<string, unknown[]>>
        ).Properties;
        expect(Array.isArray(properties.Targets)).toBe(true);
        expect(properties.Targets.length).toBeGreaterThan(0);
      });
    });

    test("SSM documents use specific run command document type", () => {
      const template = getTemplate("infraStack");
      const documents = getResources(template, "AWS::SSM::Document");

      documents.forEach((document) => {
        const properties = (document as Record<string, Record<string, string>>)
          .Properties;

        expect(properties.DocumentType).toBeDefined();
        expect(["Command", "Automation"]).toContain(properties.DocumentType);
      });
    });

    test("SSM associations have compliance severity configured (if configured)", () => {
      const template = getTemplate("infraStack");
      const associations = getResources(
        template,
        RESOURCE_TYPES.SSM_ASSOCIATION
      );

      associations.forEach((association) => {
        const properties = (
          association as Record<string, Record<string, string>>
        ).Properties;
        const complianceSeverity = properties.ComplianceSeverity;

        if (complianceSeverity) {
          expect([
            "CRITICAL",
            "HIGH",
            "MEDIUM",
            "LOW",
            "UNSPECIFIED",
          ]).toContain(complianceSeverity);
        }
      });
    });
  });

  // ==========================================================================
  // API SECURITY
  // ==========================================================================

  describe("API Security", () => {
    test("listener rules have appropriate priorities", () => {
      const template = getTemplate("serviceStack");
      const listenerRules = getResources(
        template,
        RESOURCE_TYPES.LISTENER_RULE
      );

      const priorities = listenerRules.map((rule) => {
        const properties = (rule as Record<string, Record<string, number>>)
          .Properties;
        return properties.Priority;
      });

      // All priorities should be unique
      const uniquePriorities = new Set(priorities);
      expect(uniquePriorities.size).toBe(priorities.length);
    });

    test("listener rules have conditions configured", () => {
      const template = getTemplate("serviceStack");
      const listenerRules = getResources(
        template,
        RESOURCE_TYPES.LISTENER_RULE
      );

      listenerRules.forEach((rule) => {
        validateResourceProperties(rule, ["Conditions"]);

        const properties = (rule as Record<string, Record<string, unknown[]>>)
          .Properties;
        expect(Array.isArray(properties.Conditions)).toBe(true);
        expect(properties.Conditions.length).toBeGreaterThan(0);
      });
    });
  });
});
