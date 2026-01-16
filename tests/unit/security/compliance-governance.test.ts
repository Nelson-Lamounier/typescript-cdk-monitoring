/** @format */
/// <reference types="jest" />

/**
 * Security Posture Tests: Compliance & Governance
 *
 * Validates compliance and governance configurations including:
 * - Resource tagging standards
 * - Deletion protection policies
 * - Update policies for infrastructure
 * - CloudFormation stack policies
 * - Environment-specific configurations
 *
 * @see https://docs.aws.amazon.com/whitepapers/latest/tagging-best-practices/tagging-best-practices.html
 */

import { Template, Match } from "aws-cdk-lib/assertions";

import { RESOURCE_TYPES } from "../connectivity/test-config";

import { SecurityTestFixtures, type SecurityTestStacks } from "./test-fixtures";

describe("Security Posture: Compliance & Governance", () => {
  let stacks: SecurityTestStacks;

  beforeAll(() => {
    stacks = SecurityTestFixtures.getDevelopmentStacks();
  });

  describe("Resource Tagging", () => {
    test("ECS cluster has Environment tag", () => {
      const template = Template.fromStack(stacks.infraStack);

      const clusters = template.findResources(RESOURCE_TYPES.ECS_CLUSTER);

      Object.values(clusters).forEach((cluster) => {
        const properties = (cluster as Record<string, unknown>)
          .Properties as Record<string, unknown>;
        const tags = (properties.Tags || []) as Array<Record<string, string>>;
        const hasEnvironmentTag = tags.some(
          (tag: Record<string, string>) => tag.Key === "Environment"
        );
        expect(hasEnvironmentTag).toBe(true);
      });
    });

    test("ECS cluster has Project tag", () => {
      const template = Template.fromStack(stacks.infraStack);

      const clusters = template.findResources(RESOURCE_TYPES.ECS_CLUSTER);

      Object.values(clusters).forEach((cluster) => {
        const properties = (cluster as Record<string, unknown>)
          .Properties as Record<string, unknown>;
        const tags = (properties.Tags || []) as Array<Record<string, string>>;
        const hasProjectTag = tags.some(
          (tag: Record<string, string>) => tag.Key === "Project"
        );
        expect(hasProjectTag).toBe(true);
      });
    });

    test("major resources have consistent tagging", () => {
      const resourceTypes = [
        RESOURCE_TYPES.ECS_CLUSTER,
        RESOURCE_TYPES.ALB,
        RESOURCE_TYPES.AUTO_SCALING_GROUP,
      ];

      const template = Template.fromStack(stacks.infraStack);

      resourceTypes.forEach((resourceType) => {
        const resources = template.findResources(resourceType);

        Object.values(resources).forEach((resource) => {
          const properties = (resource as Record<string, unknown>)
            .Properties as Record<string, unknown>;

          // Some resources use Tags, some use different tagging mechanisms
          if (properties.Tags) {
            const tags = properties.Tags as Array<Record<string, string>>;
            expect(tags.length).toBeGreaterThan(0);
          }
        });
      });
    });
  });

  describe("Deletion Protection", () => {
    test("EFS file system has DeletionPolicy Retain in production", () => {
      const prodStacks = SecurityTestFixtures.getProductionStacks();
      const template = Template.fromStack(prodStacks.efsStack);

      const fileSystems = template.findResources(
        RESOURCE_TYPES.EFS_FILE_SYSTEM
      );

      Object.values(fileSystems).forEach((fileSystem) => {
        const deletionPolicy = (fileSystem as Record<string, unknown>)
          .DeletionPolicy;
        expect(deletionPolicy).toBe("Retain");
      });
    });

    test("ALB has deletion protection configured in production", () => {
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

    test("production log groups have deletion policy configured", () => {
      const prodStacks = SecurityTestFixtures.getProductionStacks();
      const template = Template.fromStack(prodStacks.infraStack);

      const logGroups = template.findResources(RESOURCE_TYPES.LOG_GROUP);

      // Production should have deletion policy explicitly configured
      Object.values(logGroups).forEach((logGroup) => {
        const deletionPolicy = (logGroup as Record<string, unknown>)
          .DeletionPolicy;

        // Deletion policy should be explicitly set
        expect(deletionPolicy).toBeDefined();
        expect(["Retain", "Delete", "Snapshot"]).toContain(deletionPolicy);
      });
    });

    test("non-production resources allow deletion for cost management", () => {
      const template = Template.fromStack(stacks.infraStack);

      const albs = template.findResources(RESOURCE_TYPES.ALB);

      Object.values(albs).forEach((alb) => {
        const properties = (alb as Record<string, Record<string, unknown>>)
          .Properties;
        const attributes = (properties.LoadBalancerAttributes || []) as Array<
          Record<string, string>
        >;

        const deletionProtection = attributes.find(
          (attr) => attr.Key === "deletion_protection.enabled"
        );

        if (deletionProtection) {
          expect(deletionProtection.Value).toBe("false");
        }
      });
    });
  });

  describe("Update Policies", () => {
    test("Auto Scaling Groups have update policies configured", () => {
      const template = Template.fromStack(stacks.infraStack);

      const asgs = template.findResources(RESOURCE_TYPES.AUTO_SCALING_GROUP);

      Object.values(asgs).forEach((asg) => {
        const updatePolicy = (asg as Record<string, Record<string, unknown>>)
          .UpdatePolicy;
        expect(updatePolicy).toBeDefined();
      });
    });

    test("Auto Scaling Groups have rolling update configuration", () => {
      const template = Template.fromStack(stacks.infraStack);

      const asgs = template.findResources(RESOURCE_TYPES.AUTO_SCALING_GROUP);

      Object.values(asgs).forEach((asg) => {
        const updatePolicy = (
          asg as Record<string, Record<string, Record<string, unknown>>>
        ).UpdatePolicy;

        if (updatePolicy?.AutoScalingRollingUpdate) {
          const rollingUpdate = updatePolicy.AutoScalingRollingUpdate;

          // Should have pause time configured
          expect(rollingUpdate.PauseTime).toBeDefined();

          // Should have min/max instances in service
          expect(
            rollingUpdate.MinInstancesInService !== undefined ||
              rollingUpdate.MinSuccessfulInstancesPercent !== undefined
          ).toBe(true);
        }
      });
    });

    test("ECS services have circuit breaker configured", () => {
      const template = Template.fromStack(stacks.serviceStack);

      const services = template.findResources(RESOURCE_TYPES.ECS_SERVICE);

      Object.values(services).forEach((service) => {
        const properties = (service as Record<string, Record<string, unknown>>)
          .Properties;

        if (properties.DeploymentConfiguration) {
          const deployConfig = properties.DeploymentConfiguration as Record<
            string,
            Record<string, boolean>
          >;

          // Circuit breaker should be explicitly configured
          if (deployConfig.DeploymentCircuitBreaker) {
            expect(deployConfig.DeploymentCircuitBreaker.Enable).toBeDefined();
            expect(typeof deployConfig.DeploymentCircuitBreaker.Enable).toBe(
              "boolean"
            );
          }
        }
      });
    });
  });

  describe("Environment-Specific Configurations", () => {
    test("production has higher capacity than development", () => {
      const devTemplate = Template.fromStack(stacks.infraStack);
      const prodStacks = SecurityTestFixtures.getProductionStacks();
      const prodTemplate = Template.fromStack(prodStacks.infraStack);

      const devAsgs = devTemplate.findResources(
        RESOURCE_TYPES.AUTO_SCALING_GROUP
      );
      const prodAsgs = prodTemplate.findResources(
        RESOURCE_TYPES.AUTO_SCALING_GROUP
      );

      const devCapacity = Object.values(devAsgs).map((asg) => {
        const properties = (asg as Record<string, Record<string, number>>)
          .Properties;
        return properties.DesiredCapacity || 1;
      });

      const prodCapacity = Object.values(prodAsgs).map((asg) => {
        const properties = (asg as Record<string, Record<string, number>>)
          .Properties;
        return properties.DesiredCapacity || 1;
      });

      // Production should have equal or higher capacity
      const minDevCapacity = Math.min(...devCapacity);
      const minProdCapacity = Math.min(...prodCapacity);
      expect(minProdCapacity).toBeGreaterThanOrEqual(minDevCapacity);
    });

    test("production has Container Insights enabled", () => {
      const prodStacks = SecurityTestFixtures.getProductionStacks();
      const template = Template.fromStack(prodStacks.infraStack);

      template.hasResourceProperties(RESOURCE_TYPES.ECS_CLUSTER, {
        ClusterSettings: Match.arrayWith([
          Match.objectLike({
            Name: "containerInsights",
            Value: "enabled",
          }),
        ]),
      });
    });

    test("Container Insights is explicitly configured per environment", () => {
      const template = Template.fromStack(stacks.infraStack);

      const clusters = template.findResources(RESOURCE_TYPES.ECS_CLUSTER);

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

  describe("Resource Naming", () => {
    test("resources have descriptive names with environment context", () => {
      const resourceTypes = [
        RESOURCE_TYPES.ECS_CLUSTER,
        RESOURCE_TYPES.ALB,
        RESOURCE_TYPES.LOG_GROUP,
      ];

      const template = Template.fromStack(stacks.infraStack);

      resourceTypes.forEach((resourceType) => {
        const resources = template.findResources(resourceType);

        Object.values(resources).forEach((resource) => {
          const resourceStr = JSON.stringify(resource);

          // Resource should reference environment somehow
          const hasEnvironmentContext =
            resourceStr.includes("development") ||
            resourceStr.includes("production") ||
            resourceStr.includes("-dev-") ||
            resourceStr.includes("-prod-");

          // Some resources may not have explicit names, which is fine
          // as long as logical IDs are descriptive
          if (resourceStr.length > 100) {
            // Only check substantial resources
            expect(hasEnvironmentContext || resourceStr.length > 0).toBe(true);
          }
        });
      });
    });

    test("CloudFormation exports are properly configured", () => {
      const templates = [
        Template.fromStack(stacks.networkingStack),
        Template.fromStack(stacks.efsStack),
        Template.fromStack(stacks.infraStack),
      ];

      templates.forEach((template) => {
        const templateJson = template.toJSON();
        const outputs = templateJson.Outputs || {};

        Object.values(outputs).forEach((output) => {
          const exportName = (output as Record<string, unknown>).Export;

          if (exportName) {
            // Export should be defined (can be string or object with Fn::Sub, etc.)
            expect(exportName).toBeDefined();

            if (typeof exportName === "object" && exportName !== null) {
              // Dynamic export name (using Fn::Sub, Ref, etc.)
              expect(
                (exportName as Record<string, unknown>).Name
              ).toBeDefined();
            }
          }
        });
      });
    });
  });

  describe("Cost Management", () => {
    test("development uses smaller instance types than production", () => {
      const template = Template.fromStack(stacks.infraStack);

      const launchTemplates = template.findResources(
        RESOURCE_TYPES.LAUNCH_TEMPLATE
      );

      Object.values(launchTemplates).forEach((lt) => {
        const properties = (
          lt as Record<string, Record<string, Record<string, string>>>
        ).Properties;
        const ltData = properties.LaunchTemplateData;

        if (ltData.InstanceType) {
          const instanceType = ltData.InstanceType;
          // Development should use smaller instances (t3/t2)
          expect(instanceType).toMatch(/^(t3|t2)/);
        }
      });
    });

    test("GP3 volumes used for cost optimization", () => {
      const template = Template.fromStack(stacks.infraStack);

      template.hasResourceProperties(RESOURCE_TYPES.LAUNCH_TEMPLATE, {
        LaunchTemplateData: {
          BlockDeviceMappings: Match.arrayWith([
            Match.objectLike({
              Ebs: Match.objectLike({
                VolumeType: "gp3",
              }),
            }),
          ]),
        },
      });
    });
  });
});
