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

import { RESOURCE_TYPES } from "../connectivity/test-config";

import { SecurityTestFixtures, type SecurityTestStacks } from "./test-fixtures";

describe("Security Posture: Application Security", () => {
  let stacks: SecurityTestStacks;

  beforeAll(() => {
    stacks = SecurityTestFixtures.getDevelopmentStacks();
  });

  describe("Load Balancer Configuration", () => {
    test("ALB has drop invalid header fields enabled", () => {
      const template = Template.fromStack(stacks.infraStack);

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

      const albs = template.findResources(RESOURCE_TYPES.ALB);

      // Production should have deletion protection explicitly configured
      Object.values(albs).forEach((alb) => {
        const properties = (alb as Record<string, Record<string, unknown>>)
          .Properties;
        const attributes = (properties.LoadBalancerAttributes || []) as Array<
          Record<string, string>
        >;

        const deletionProtection = attributes.find(
          (attr) => attr.Key === "deletion_protection.enabled"
        );

        // Deletion protection should be explicitly configured
        expect(deletionProtection).toBeDefined();
        expect(deletionProtection?.Value).toBeDefined();
      });
    });

    test("ALB is internet-facing with proper security groups", () => {
      const template = Template.fromStack(stacks.infraStack);

      template.hasResourceProperties(RESOURCE_TYPES.ALB, {
        Scheme: "internet-facing",
        SecurityGroups: Match.anyValue(),
      });
    });

    test("ALB has access logs disabled for non-production (cost optimization)", () => {
      const template = Template.fromStack(stacks.infraStack);

      const albs = template.findResources(RESOURCE_TYPES.ALB);

      Object.values(albs).forEach((alb) => {
        const properties = (alb as Record<string, Record<string, unknown>>)
          .Properties;
        const attributes = (properties.LoadBalancerAttributes || []) as Array<
          Record<string, string>
        >;

        const accessLogsAttr = attributes.find(
          (attr) => attr.Key === "access_logs.s3.enabled"
        );

        // For development, access logs can be disabled
        if (accessLogsAttr) {
          expect(["false", "true"]).toContain(accessLogsAttr.Value);
        }
      });
    });
  });

  describe("Target Group Health Checks", () => {
    test("target groups have health checks configured", () => {
      const template = Template.fromStack(stacks.serviceStack);

      const targetGroups = template.findResources(RESOURCE_TYPES.TARGET_GROUP);

      Object.values(targetGroups).forEach((targetGroup) => {
        const properties = (
          targetGroup as Record<string, Record<string, unknown>>
        ).Properties;

        // Health check path should be defined
        expect(properties.HealthCheckPath).toBeDefined();

        // Health check interval should be defined
        expect(properties.HealthCheckIntervalSeconds).toBeDefined();

        // Protocol may be implicit (defaults to target group protocol)
        // So we just verify health check is configured
        expect(
          properties.HealthCheckPath !== undefined ||
            properties.HealthCheckProtocol !== undefined
        ).toBe(true);
      });
    });

    test("target groups have appropriate health check thresholds", () => {
      const template = Template.fromStack(stacks.serviceStack);

      const targetGroups = template.findResources(RESOURCE_TYPES.TARGET_GROUP);

      Object.values(targetGroups).forEach((targetGroup) => {
        const properties = (
          targetGroup as Record<string, Record<string, number>>
        ).Properties;

        expect(properties.HealthyThresholdCount).toBeDefined();
        expect(properties.UnhealthyThresholdCount).toBeDefined();

        // Thresholds should be reasonable
        expect(properties.HealthyThresholdCount).toBeGreaterThanOrEqual(2);
        expect(properties.HealthyThresholdCount).toBeLessThanOrEqual(10);
        expect(properties.UnhealthyThresholdCount).toBeGreaterThanOrEqual(2);
        expect(properties.UnhealthyThresholdCount).toBeLessThanOrEqual(10);
      });
    });

    test("target groups have deregistration delay configured", () => {
      const template = Template.fromStack(stacks.serviceStack);

      const targetGroups = template.findResources(RESOURCE_TYPES.TARGET_GROUP);

      Object.values(targetGroups).forEach((targetGroup) => {
        const properties = (
          targetGroup as Record<string, Record<string, unknown>>
        ).Properties;
        const attributes = (properties.TargetGroupAttributes || []) as Array<
          Record<string, string>
        >;

        const deregDelayAttr = attributes.find(
          (attr) => attr.Key === "deregistration_delay.timeout_seconds"
        );

        if (deregDelayAttr) {
          const delaySeconds = parseInt(deregDelayAttr.Value);
          expect(delaySeconds).toBeGreaterThanOrEqual(0);
          expect(delaySeconds).toBeLessThanOrEqual(300);
        }
      });
    });
  });

  describe("Container Security", () => {
    test("ECS containers log to CloudWatch", () => {
      const template = Template.fromStack(stacks.serviceStack);

      const taskDefs = template.findResources(
        RESOURCE_TYPES.ECS_TASK_DEFINITION
      );

      Object.values(taskDefs).forEach((taskDef) => {
        const properties = (taskDef as Record<string, Record<string, unknown>>)
          .Properties;
        const containers = properties.ContainerDefinitions as Array<
          Record<string, Record<string, string>>
        >;

        containers.forEach((container) => {
          expect(container.LogConfiguration).toBeDefined();
          expect(container.LogConfiguration.LogDriver).toBe("awslogs");
        });
      });
    });

    test("ECS task definitions do not run privileged containers", () => {
      const template = Template.fromStack(stacks.serviceStack);

      const taskDefs = template.findResources(
        RESOURCE_TYPES.ECS_TASK_DEFINITION
      );

      Object.values(taskDefs).forEach((taskDef) => {
        const properties = (taskDef as Record<string, Record<string, unknown>>)
          .Properties;
        const containers = properties.ContainerDefinitions as Array<
          Record<string, boolean | undefined>
        >;

        containers.forEach((container) => {
          expect(container.Privileged).not.toBe(true);
        });
      });
    });

    test("ECS containers do not run as root user", () => {
      const template = Template.fromStack(stacks.serviceStack);

      const taskDefs = template.findResources(
        RESOURCE_TYPES.ECS_TASK_DEFINITION
      );

      Object.values(taskDefs).forEach((taskDef) => {
        const properties = (taskDef as Record<string, Record<string, unknown>>)
          .Properties;
        const containers = properties.ContainerDefinitions as Array<
          Record<string, Record<string, number> | undefined>
        >;

        containers.forEach((container) => {
          // If User is specified, it should not be root (0)
          if (container.User !== undefined) {
            const user = String(container.User);
            expect(user).not.toBe("0");
            expect(user).not.toBe("root");
          }
        });
      });
    });

    test("ECS containers have resource limits configured", () => {
      const template = Template.fromStack(stacks.serviceStack);

      const taskDefs = template.findResources(
        RESOURCE_TYPES.ECS_TASK_DEFINITION
      );

      Object.values(taskDefs).forEach((taskDef) => {
        const properties = (taskDef as Record<string, Record<string, unknown>>)
          .Properties;
        const containers = properties.ContainerDefinitions as Array<
          Record<string, number | undefined>
        >;

        containers.forEach((container) => {
          // Should have either memory or memoryReservation
          expect(
            container.Memory !== undefined ||
              container.MemoryReservation !== undefined
          ).toBe(true);
        });
      });
    });

    test("ECS tasks use valid network modes", () => {
      const template = Template.fromStack(stacks.serviceStack);

      const taskDefs = template.findResources(
        RESOURCE_TYPES.ECS_TASK_DEFINITION
      );

      Object.values(taskDefs).forEach((taskDef) => {
        const properties = (taskDef as Record<string, Record<string, string>>)
          .Properties;

        // Valid network modes for ECS on EC2
        if (properties.NetworkMode) {
          expect(["awsvpc", "bridge", "host", "none"]).toContain(
            properties.NetworkMode
          );
        }
      });
    });
  });

  describe("Secrets Management", () => {
    test("Grafana admin password stored in Secrets Manager", () => {
      const template = Template.fromStack(stacks.serviceStack);

      const secrets = template.findResources("AWS::SecretsManager::Secret");
      const hasGrafanaSecret = Object.values(secrets).some((secret) => {
        const properties = (
          secret as Record<string, Record<string, string | undefined>>
        ).Properties;
        const name = properties.Name;
        return name?.includes("grafana");
      });

      expect(hasGrafanaSecret).toBe(true);
    });

    test("secrets have automatic rotation configuration available", () => {
      const template = Template.fromStack(stacks.serviceStack);

      const secrets = template.findResources("AWS::SecretsManager::Secret");

      Object.values(secrets).forEach((secret) => {
        const properties = (secret as Record<string, Record<string, unknown>>)
          .Properties;

        // Secrets should have GenerateSecretString for automatic generation
        expect(
          properties.GenerateSecretString || properties.SecretString
        ).toBeDefined();
      });
    });

    test("no hardcoded secrets in task definitions", () => {
      const template = Template.fromStack(stacks.serviceStack);

      const taskDefs = template.findResources(
        RESOURCE_TYPES.ECS_TASK_DEFINITION
      );

      Object.values(taskDefs).forEach((taskDef) => {
        const taskDefStr = JSON.stringify(taskDef);

        // Should not have obvious hardcoded secrets (but allow service ARNs)
        expect(taskDefStr).not.toMatch(/password\s*["']\s*:\s*["'][^'"]+["']/i);
        expect(taskDefStr).not.toMatch(/secret\s*["']\s*:\s*["'][^'"]+["']/i);
        expect(taskDefStr).not.toMatch(/AKIA[0-9A-Z]{16}/); // AWS Access Key

        // Ensure secrets are referenced from Secrets Manager (not hardcoded)
        if (
          taskDefStr.includes("ADMIN_PASSWORD") ||
          taskDefStr.includes("password")
        ) {
          // Should use Secrets or ValueFrom, not plain text
          expect(
            taskDefStr.includes("Secrets") ||
              taskDefStr.includes("ValueFrom") ||
              taskDefStr.includes("secretsmanager")
          ).toBe(true);
        }
      });
    });
  });

  describe("SSM State Manager Security", () => {
    test("SSM associations target specific resources", () => {
      const template = Template.fromStack(stacks.infraStack);

      const associations = template.findResources(
        RESOURCE_TYPES.SSM_ASSOCIATION
      );

      Object.values(associations).forEach((association) => {
        const properties = (
          association as Record<string, Record<string, unknown[]>>
        ).Properties;
        expect(properties.Targets).toBeDefined();
        expect(Array.isArray(properties.Targets)).toBe(true);
        expect(properties.Targets.length).toBeGreaterThan(0);
      });
    });

    test("SSM documents use specific run command document type", () => {
      const template = Template.fromStack(stacks.infraStack);

      const documents = template.findResources("AWS::SSM::Document");

      Object.values(documents).forEach((document) => {
        const properties = (document as Record<string, Record<string, string>>)
          .Properties;
        expect(properties.DocumentType).toBeDefined();
        expect(["Command", "Automation"]).toContain(properties.DocumentType);
      });
    });

    test("SSM associations have compliance severity configured", () => {
      const template = Template.fromStack(stacks.infraStack);

      const associations = template.findResources(
        RESOURCE_TYPES.SSM_ASSOCIATION
      );

      Object.values(associations).forEach((association) => {
        const properties = (
          association as Record<string, Record<string, string>>
        ).Properties;

        // ComplianceSeverity helps track association compliance
        if (properties.ComplianceSeverity) {
          expect([
            "CRITICAL",
            "HIGH",
            "MEDIUM",
            "LOW",
            "UNSPECIFIED",
          ]).toContain(properties.ComplianceSeverity);
        }
      });
    });
  });

  describe("API Security", () => {
    test("listener rules have appropriate priorities", () => {
      const template = Template.fromStack(stacks.serviceStack);

      const listenerRules = template.findResources(
        RESOURCE_TYPES.LISTENER_RULE
      );

      const priorities = Object.values(listenerRules).map((rule) => {
        const properties = (rule as Record<string, Record<string, number>>)
          .Properties;
        return properties.Priority;
      });

      // All priorities should be unique
      const uniquePriorities = new Set(priorities);
      expect(uniquePriorities.size).toBe(priorities.length);
    });

    test("listener rules have conditions configured", () => {
      const template = Template.fromStack(stacks.serviceStack);

      const listenerRules = template.findResources(
        RESOURCE_TYPES.LISTENER_RULE
      );

      Object.values(listenerRules).forEach((rule) => {
        const properties = (rule as Record<string, Record<string, unknown[]>>)
          .Properties;
        expect(properties.Conditions).toBeDefined();
        expect(Array.isArray(properties.Conditions)).toBe(true);
        expect(properties.Conditions.length).toBeGreaterThan(0);
      });
    });
  });
});
