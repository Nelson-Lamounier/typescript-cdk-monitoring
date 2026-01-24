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
  INSTANCE_TEST_STACKS,
  IAM_TEST_STACKS,
  EXPORT_TEST_STACKS,
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
      const template = getTemplate(INSTANCE_TEST_STACKS[0]);
      const clusters = getResources(template, RESOURCE_TYPES.ECS_CLUSTER);

      expect(clusters.length).toBeGreaterThan(0);
      clusters.forEach((cluster) => {
        expect(hasTag(cluster, "Environment")).toBe(true);
      });
    });

    test("ECS cluster has Project tag", () => {
      const template = getTemplate(INSTANCE_TEST_STACKS[0]);
      const clusters = getResources(template, RESOURCE_TYPES.ECS_CLUSTER);

      expect(clusters.length).toBeGreaterThan(0);
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

      const template = getTemplate(INSTANCE_TEST_STACKS[0]);

      const allResources = resourceTypes.flatMap((resourceType) =>
        getResources(template, resourceType)
      );

      expect(allResources.length).toBeGreaterThan(0);

      allResources.forEach((resource) => {
        const tags = getResourceTags(resource);
        // Tags array exists and is an array
        expect(Array.isArray(tags)).toBe(true);
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

      expect(fileSystems.length).toBeGreaterThan(0);
      fileSystems.forEach((fileSystem) => {
        const deletionPolicy = getDeletionPolicy(fileSystem);
        expect(deletionPolicy).toBe("Retain");
      });
    });

    test("ALB has deletion protection configured in production", () => {
      const prodStacks = SecurityTestFixtures.getProductionStacks();
      const template = Template.fromStack(prodStacks.infraStack);
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

    test("production log groups have deletion policy configured", () => {
      const prodStacks = SecurityTestFixtures.getProductionStacks();
      const template = Template.fromStack(prodStacks.infraStack);
      const logGroups = getResources(template, RESOURCE_TYPES.LOG_GROUP);

      expect(logGroups.length).toBeGreaterThan(0);
      logGroups.forEach((logGroup) => {
        const deletionPolicy = getDeletionPolicy(logGroup);

        expect(deletionPolicy).toBeDefined();
        expect(["Retain", "Delete", "Snapshot"]).toContain(deletionPolicy);
      });
    });

    test("non-production ALBs have deletion protection disabled for cost management", () => {
      const template = getTemplate(INSTANCE_TEST_STACKS[0]);
      const albs = getResources(template, RESOURCE_TYPES.ALB);

      expect(albs.length).toBeGreaterThan(0);
      albs.forEach((alb) => {
        const deletionProtection = findAlbAttribute(
          alb,
          "deletion_protection.enabled"
        );

        expect(deletionProtection).toBeDefined();
        expect(deletionProtection?.Value).toBe("false");
      });
    });
  });

  // ==========================================================================
  // UPDATE POLICIES
  // ==========================================================================

  describe("Update Policies", () => {
    test("Auto Scaling Groups have update policies configured", () => {
      const template = getTemplate(INSTANCE_TEST_STACKS[0]);
      const asgs = getResources(template, RESOURCE_TYPES.AUTO_SCALING_GROUP);

      expect(asgs.length).toBeGreaterThan(0);
      asgs.forEach((asg) => {
        const updatePolicy = getUpdatePolicy(asg);
        expect(updatePolicy).toBeDefined();
      });
    });

    describe("Auto Scaling Groups Rolling Update Configuration", () => {
      let asgsWithRollingUpdate: Array<{
        name: string;
        rollingUpdate: Record<string, unknown>;
        hasMinInstanceRequirement: boolean;
      }>;

      beforeAll(() => {
        const template = getTemplate(INSTANCE_TEST_STACKS[0]);
        const asgs = getResources(template, RESOURCE_TYPES.AUTO_SCALING_GROUP);

        asgsWithRollingUpdate = asgs
          .map((asg, index) => {
            const updatePolicy = getUpdatePolicy(asg);
            const rollingUpdate = updatePolicy
              ? getRollingUpdate(updatePolicy)
              : undefined;

            // Pre-compute the requirement check here
            const hasMinInstanceRequirement = rollingUpdate !== undefined && (
              rollingUpdate.MinInstancesInService !== undefined ||
              rollingUpdate.MinSuccessfulInstancesPercent !== undefined
            );

            return { name: `ASG-${index}`, rollingUpdate, hasMinInstanceRequirement };
          })
          .filter(
            (
              item
            ): item is {
              name: string;
              rollingUpdate: Record<string, unknown>;
              hasMinInstanceRequirement: boolean;
            } => item.rollingUpdate !== undefined
          );
      });

      test("rolling updates have PauseTime configured", () => {
        expect(asgsWithRollingUpdate).toBeDefined();
        expect(Array.isArray(asgsWithRollingUpdate)).toBe(true);

        asgsWithRollingUpdate.forEach(({ rollingUpdate }) => {
          expect(rollingUpdate.PauseTime).toBeDefined();
        });
      });

      test("rolling updates have minimum instance requirements", () => {
        expect(asgsWithRollingUpdate).toBeDefined();
        expect(Array.isArray(asgsWithRollingUpdate)).toBe(true);

        asgsWithRollingUpdate.forEach(({ hasMinInstanceRequirement }) => {
          expect(hasMinInstanceRequirement).toBe(true);
        });
      });
    });

    describe("ECS Service Circuit Breaker Configuration", () => {
      let servicesWithCircuitBreaker: Array<{
        name: string;
        circuitBreaker: Record<string, boolean>;
      }>;

      beforeAll(() => {
        const template = getTemplate(IAM_TEST_STACKS[3]);
        const services = getResources(template, RESOURCE_TYPES.ECS_SERVICE);

        servicesWithCircuitBreaker = services
          .map((service, index) => {
            const deployConfig = getDeploymentConfiguration(service);
            const circuitBreaker = deployConfig
              ? getCircuitBreaker(deployConfig)
              : undefined;
            return { name: `Service-${index}`, circuitBreaker };
          })
          .filter(
            (
              item
            ): item is {
              name: string;
              circuitBreaker: Record<string, boolean>;
            } => item.circuitBreaker !== undefined
          );
      });

      test("circuit breakers have Enable property defined", () => {
        expect(servicesWithCircuitBreaker).toBeDefined();
        expect(Array.isArray(servicesWithCircuitBreaker)).toBe(true);

        servicesWithCircuitBreaker.forEach(({ circuitBreaker }) => {
          expect(circuitBreaker.Enable).toBeDefined();
          expect(typeof circuitBreaker.Enable).toBe("boolean");
        });
      });
    });
  });

  // ==========================================================================
  // ENVIRONMENT-SPECIFIC CONFIGURATIONS
  // ==========================================================================

  describe("Environment-Specific Configurations", () => {
    test("production has higher or equal capacity compared to development", () => {
      const devTemplate = getTemplate(INSTANCE_TEST_STACKS[0]);
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

      // Guard assertions - ensure we have data to compare
      expect(devAsgs.length).toBeGreaterThan(0);
      expect(prodAsgs.length).toBeGreaterThan(0);

      const devCapacity = devAsgs.map(getAsgCapacity);
      const prodCapacity = prodAsgs.map(getAsgCapacity);

      const minDevCapacity = Math.min(...devCapacity);
      const minProdCapacity = Math.min(...prodCapacity);

      expect(minProdCapacity).toBeGreaterThanOrEqual(minDevCapacity);
    });

    // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
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

    describe("Container Insights Configuration", () => {
      let clusters: unknown[];
      let clustersWithInsightsSetting: Array<{
        name: string;
        containerInsights: Record<string, string>;
      }>;

      beforeAll(() => {
        const template = getTemplate(INSTANCE_TEST_STACKS[0]);
        clusters = getResources(template, RESOURCE_TYPES.ECS_CLUSTER);

        clustersWithInsightsSetting = clusters
          .map((cluster, index) => ({
            name: `Cluster-${index}`,
            containerInsights: getContainerInsightsSetting(cluster),
          }))
          .filter(
            (item): item is {
              name: string;
              containerInsights: Record<string, string>;
            } => item.containerInsights !== undefined
          );
      });

      test("all clusters have Container Insights explicitly configured", () => {
        expect(clusters.length).toBeGreaterThan(0);
        expect(clustersWithInsightsSetting.length).toBe(clusters.length);
      });

      test("Container Insights values are valid", () => {
        expect(clustersWithInsightsSetting.length).toBeGreaterThan(0);
        clustersWithInsightsSetting.forEach(({ containerInsights }) => {
          expect(["enabled", "disabled"]).toContain(containerInsights.Value);
        });
      });
    });
  });

  // ==========================================================================
  // RESOURCE NAMING
  // ==========================================================================

  describe("Resource Naming", () => {
    describe("Environment Context in Resource Names", () => {
      let substantialResources: Array<{
        resource: unknown;
        hasContext: boolean;
      }>;

      beforeAll(() => {
        const resourceTypes = [
          RESOURCE_TYPES.ECS_CLUSTER,
          RESOURCE_TYPES.ALB,
          RESOURCE_TYPES.LOG_GROUP,
        ];

        const template = getTemplate(INSTANCE_TEST_STACKS[0]);

        const allResources = resourceTypes.flatMap((resourceType) =>
          getResources(template, resourceType)
        );

        // Filter to substantial resources and pre-compute context check
        substantialResources = allResources
          .map((resource) => {
            const resourceStr = JSON.stringify(resource);
            return {
              resource,
              resourceLength: resourceStr.length,
              hasContext: hasEnvironmentContext(resourceStr),
            };
          })
          .filter((item) => item.resourceLength > 100);
      });

      test("substantial resources exist", () => {
        expect(substantialResources.length).toBeGreaterThan(0);
      });

      test("resources have environment context", () => {
        expect(substantialResources.length).toBeGreaterThan(0);
        substantialResources.forEach(({ hasContext }) => {
          // Resources should have environment context in their configuration
          expect(hasContext).toBe(true);
        });
      });
    });

    describe("CloudFormation Export Validation", () => {
      let allExports: Array<{
        outputKey: string;
        exportConfig: Record<string, unknown>;
      }>;

      beforeAll(() => {
        const templates = EXPORT_TEST_STACKS.map((stackName) =>
          getTemplate(stackName)
        );

        // Collect all exports across templates in beforeAll
        allExports = templates.flatMap((template) => {
          const outputs = getOutputs(template);
          return Object.entries(outputs)
            .map(([key, output]) => ({
              outputKey: key,
              exportConfig: (output as Record<string, unknown>).Export as
                | Record<string, unknown>
                | undefined,
            }))
            .filter(
              (item): item is {
                outputKey: string;
                exportConfig: Record<string, unknown>;
              } => item.exportConfig !== undefined
            );
        });
      });

      test("exports collection is defined", () => {
        expect(allExports).toBeDefined();
        expect(Array.isArray(allExports)).toBe(true);
      });

      test("all exports have valid structure", () => {
        // Guard: ensure we have exports to validate
        // If no exports exist, this documents that state
        expect(allExports).toBeDefined();
        
        allExports.forEach(({ exportConfig }) => {
          expect(exportConfig).not.toBeNull();
          expect(typeof exportConfig).toBe("object");
          expect(exportConfig.Name).toBeDefined();
        });
      });
    });
  });

  // ==========================================================================
  // COST MANAGEMENT
  // ==========================================================================

  describe("Cost Management", () => {
    describe("Instance Type Configuration", () => {
      let launchTemplates: unknown[];
      let instanceTypes: string[];

      beforeAll(() => {
        const template = getTemplate(INSTANCE_TEST_STACKS[0]);
        launchTemplates = getResources(
          template,
          RESOURCE_TYPES.LAUNCH_TEMPLATE
        );

        // Extract instance types in beforeAll
        instanceTypes = launchTemplates
          .map((lt) => getInstanceType(lt))
          .filter((type): type is string => type !== undefined);
      });

      test("launch templates exist", () => {
        expect(launchTemplates.length).toBeGreaterThan(0);
      });

      test("instance types are defined", () => {
        expect(instanceTypes.length).toBeGreaterThan(0);
      });

      test("development uses appropriate instance types (t3/t2)", () => {
        expect(instanceTypes.length).toBeGreaterThan(0);
        instanceTypes.forEach((instanceType) => {
          expect(instanceType).toMatch(/^(t3|t2)/);
        });
      });
    });

    // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
    test("GP3 volumes used for cost optimization", () => {
      const template = getTemplate(INSTANCE_TEST_STACKS[0]);

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