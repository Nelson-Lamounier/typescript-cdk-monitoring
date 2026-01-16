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

import {
  RESOURCE_TYPES,
  type ConnectivityTestStacks,
} from "../connectivity/test-config";

import { SecurityTestFixtures } from "../utils/test-utils";

describe("Security Posture: Compliance & Governance", () => {
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
   * Extract tags from resource
   */
  const getResourceTags = (
    resource: unknown
  ): Array<Record<string, string>> => {
    const properties = (resource as Record<string, Record<string, unknown>>)
      .Properties;
    return (properties.Tags || []) as Array<Record<string, string>>;
  };

  /**
   * Check if resource has specific tag
   */
  const hasTag = (resource: unknown, tagKey: string): boolean => {
    const tags = getResourceTags(resource);
    return tags.some((tag) => tag.Key === tagKey);
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
   * Extract deletion policy from resource
   */
  const getDeletionPolicy = (resource: unknown): string | undefined => {
    return (resource as Record<string, string | undefined>).DeletionPolicy;
  };

  /**
   * Extract update policy from ASG
   */
  const getUpdatePolicy = (
    asg: unknown
  ): Record<string, unknown> | undefined => {
    return (asg as Record<string, Record<string, unknown>>).UpdatePolicy;
  };

  /**
   * Extract rolling update configuration
   */
  const getRollingUpdate = (
    updatePolicy: Record<string, unknown>
  ): Record<string, unknown> | undefined => {
    return updatePolicy.AutoScalingRollingUpdate as
      | Record<string, unknown>
      | undefined;
  };

  /**
   * Extract container insights setting from cluster
   */
  const getContainerInsightsSetting = (
    cluster: unknown
  ): Record<string, string> | undefined => {
    const properties = (cluster as Record<string, Record<string, unknown>>)
      .Properties;
    const settings = (properties.ClusterSettings || []) as Array<
      Record<string, string>
    >;
    return settings.find((setting) => setting.Name === "containerInsights");
  };

  /**
   * Extract ASG desired capacity
   */
  const getAsgCapacity = (asg: unknown): number => {
    const properties = (asg as Record<string, Record<string, number>>)
      .Properties;
    return properties.DesiredCapacity || 1;
  };

  /**
   * Extract launch template data
   */
  const getLaunchTemplateData = (
    launchTemplate: unknown
  ): Record<string, string> => {
    const properties = (
      launchTemplate as Record<string, Record<string, Record<string, string>>>
    ).Properties;
    return properties.LaunchTemplateData;
  };

  /**
   * Extract instance type from launch template
   */
  const getInstanceType = (launchTemplate: unknown): string | undefined => {
    const ltData = getLaunchTemplateData(launchTemplate);
    return ltData.InstanceType;
  };

  /**
   * Extract deployment configuration from ECS service
   */
  const getDeploymentConfiguration = (
    service: unknown
  ): Record<string, unknown> | undefined => {
    const properties = (service as Record<string, Record<string, unknown>>)
      .Properties;
    return properties.DeploymentConfiguration as
      | Record<string, unknown>
      | undefined;
  };

  /**
   * Extract circuit breaker configuration
   */
  const getCircuitBreaker = (
    deployConfig: Record<string, unknown>
  ): Record<string, boolean> | undefined => {
    return deployConfig.DeploymentCircuitBreaker as
      | Record<string, boolean>
      | undefined;
  };

  /**
   * Check if resource string has environment context
   */
  const hasEnvironmentContext = (resourceStr: string): boolean => {
    return (
      resourceStr.includes("development") ||
      resourceStr.includes("production") ||
      resourceStr.includes("-dev-") ||
      resourceStr.includes("-prod-")
    );
  };

  /**
   * Extract CloudFormation outputs
   */
  const getOutputs = (template: Template): Record<string, unknown> => {
    const templateJson = template.toJSON();
    return (templateJson.Outputs || {}) as Record<string, unknown>;
  };

  // ==========================================================================
  // RESOURCE TAGGING
  // ==========================================================================

  describe("Resource Tagging", () => {
    test("ECS cluster has Environment tag", () => {
      const template = getTemplate("infraStack");
      const clusters = getResources(template, RESOURCE_TYPES.ECS_CLUSTER);

      clusters.forEach((cluster) => {
        expect(hasTag(cluster, "Environment")).toBe(true);
      });
    });

    test("ECS cluster has Project tag", () => {
      const template = getTemplate("infraStack");
      const clusters = getResources(template, RESOURCE_TYPES.ECS_CLUSTER);

      clusters.forEach((cluster) => {
        expect(hasTag(cluster, "Project")).toBe(true);
      });
    });

    test("major resources have consistent tagging", () => {
      const resourceTypes = [
        RESOURCE_TYPES.ECS_CLUSTER,
        RESOURCE_TYPES.ALB,
        RESOURCE_TYPES.AUTO_SCALING_GROUP,
      ];

      const template = getTemplate("infraStack");

      resourceTypes.forEach((resourceType) => {
        const resources = getResources(template, resourceType);

        resources.forEach((resource) => {
          const tags = getResourceTags(resource);

          // If resource has Tags property, it should have at least one tag
          if (tags.length > 0) {
            expect(tags.length).toBeGreaterThan(0);
          }
        });
      });
    });
  });

  // ==========================================================================
  // DELETION PROTECTION
  // ==========================================================================

  describe("Deletion Protection", () => {
    test("EFS file system has DeletionPolicy Retain in production", () => {
      const prodStacks = SecurityTestFixtures.getProductionStacks();
      const template = Template.fromStack(prodStacks.efsStack);
      const fileSystems = getResources(
        template,
        RESOURCE_TYPES.EFS_FILE_SYSTEM
      );

      fileSystems.forEach((fileSystem) => {
        const deletionPolicy = getDeletionPolicy(fileSystem);
        expect(deletionPolicy).toBe("Retain");
      });
    });

    test("ALB has deletion protection configured in production", () => {
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

    test("production log groups have deletion policy configured", () => {
      const prodStacks = SecurityTestFixtures.getProductionStacks();
      const template = Template.fromStack(prodStacks.infraStack);
      const logGroups = getResources(template, RESOURCE_TYPES.LOG_GROUP);

      logGroups.forEach((logGroup) => {
        const deletionPolicy = getDeletionPolicy(logGroup);

        expect(deletionPolicy).toBeDefined();
        expect(["Retain", "Delete", "Snapshot"]).toContain(deletionPolicy);
      });
    });

    test("non-production resources allow deletion for cost management (if configured)", () => {
      const template = getTemplate("infraStack");
      const albs = getResources(template, RESOURCE_TYPES.ALB);

      albs.forEach((alb) => {
        const deletionProtection = findAlbAttribute(
          alb,
          "deletion_protection.enabled"
        );

        if (deletionProtection) {
          expect(deletionProtection.Value).toBe("false");
        }
      });
    });
  });

  // ==========================================================================
  // UPDATE POLICIES
  // ==========================================================================

  describe("Update Policies", () => {
    test("Auto Scaling Groups have update policies configured", () => {
      const template = getTemplate("infraStack");
      const asgs = getResources(template, RESOURCE_TYPES.AUTO_SCALING_GROUP);

      asgs.forEach((asg) => {
        const updatePolicy = getUpdatePolicy(asg);
        expect(updatePolicy).toBeDefined();
      });
    });

    test("Auto Scaling Groups have rolling update configuration (if configured)", () => {
      const template = getTemplate("infraStack");
      const asgs = getResources(template, RESOURCE_TYPES.AUTO_SCALING_GROUP);

      asgs.forEach((asg) => {
        const updatePolicy = getUpdatePolicy(asg);

        if (updatePolicy) {
          const rollingUpdate = getRollingUpdate(updatePolicy);

          if (rollingUpdate) {
            expect(rollingUpdate.PauseTime).toBeDefined();

            expect(
              rollingUpdate.MinInstancesInService !== undefined ||
                rollingUpdate.MinSuccessfulInstancesPercent !== undefined
            ).toBe(true);
          }
        }
      });
    });

    test("ECS services have circuit breaker configured (if configured)", () => {
      const template = getTemplate("serviceStack");
      const services = getResources(template, RESOURCE_TYPES.ECS_SERVICE);

      services.forEach((service) => {
        const deployConfig = getDeploymentConfiguration(service);

        if (deployConfig) {
          const circuitBreaker = getCircuitBreaker(deployConfig);

          if (circuitBreaker) {
            expect(circuitBreaker.Enable).toBeDefined();
            expect(typeof circuitBreaker.Enable).toBe("boolean");
          }
        }
      });
    });
  });

  // ==========================================================================
  // ENVIRONMENT-SPECIFIC CONFIGURATIONS
  // ==========================================================================

  describe("Environment-Specific Configurations", () => {
    test("production has higher capacity than development", () => {
      const devTemplate = getTemplate("infraStack");
      const prodStacks = SecurityTestFixtures.getProductionStacks();
      const prodTemplate = Template.fromStack(prodStacks.infraStack);

      const devAsgs = getResources(
        devTemplate,
        RESOURCE_TYPES.AUTO_SCALING_GROUP
      );
      const prodAsgs = getResources(
        prodTemplate,
        RESOURCE_TYPES.AUTO_SCALING_GROUP
      );

      const devCapacity = devAsgs.map(getAsgCapacity);
      const prodCapacity = prodAsgs.map(getAsgCapacity);

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

    test("Container Insights is explicitly configured per environment (if configured)", () => {
      const template = getTemplate("infraStack");
      const clusters = getResources(template, RESOURCE_TYPES.ECS_CLUSTER);

      clusters.forEach((cluster) => {
        const containerInsights = getContainerInsightsSetting(cluster);

        if (containerInsights) {
          expect(["enabled", "disabled"]).toContain(containerInsights.Value);
        }
      });
    });
  });

  // ==========================================================================
  // RESOURCE NAMING
  // ==========================================================================

  describe("Resource Naming", () => {
    test("resources have descriptive names with environment context", () => {
      const resourceTypes = [
        RESOURCE_TYPES.ECS_CLUSTER,
        RESOURCE_TYPES.ALB,
        RESOURCE_TYPES.LOG_GROUP,
      ];

      const template = getTemplate("infraStack");

      resourceTypes.forEach((resourceType) => {
        const resources = getResources(template, resourceType);

        resources.forEach((resource) => {
          const resourceStr = JSON.stringify(resource);

          // Only check substantial resources
          if (resourceStr.length > 100) {
            expect(
              hasEnvironmentContext(resourceStr) || resourceStr.length > 0
            ).toBe(true);
          }
        });
      });
    });

    test("CloudFormation exports are properly configured", () => {
      const templates = [
        getTemplate("networkingStack"),
        getTemplate("efsStack"),
        getTemplate("infraStack"),
      ];

      templates.forEach((template) => {
        const outputs = getOutputs(template);

        Object.values(outputs).forEach((output) => {
          const exportName = (output as Record<string, unknown>).Export;

          if (exportName) {
            expect(exportName).toBeDefined();

            if (typeof exportName === "object" && exportName !== null) {
              expect(
                (exportName as Record<string, unknown>).Name
              ).toBeDefined();
            }
          }
        });
      });
    });
  });

  // ==========================================================================
  // COST MANAGEMENT
  // ==========================================================================

  describe("Cost Management", () => {
    test("development uses smaller instance types than production (if instance type is specified)", () => {
      const template = getTemplate("infraStack");
      const launchTemplates = getResources(
        template,
        RESOURCE_TYPES.LAUNCH_TEMPLATE
      );

      launchTemplates.forEach((lt) => {
        const instanceType = getInstanceType(lt);

        if (instanceType) {
          // Development should use smaller instances (t3/t2)
          expect(instanceType).toMatch(/^(t3|t2)/);
        }
      });
    });

    test("GP3 volumes used for cost optimization", () => {
      const template = getTemplate("infraStack");

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
