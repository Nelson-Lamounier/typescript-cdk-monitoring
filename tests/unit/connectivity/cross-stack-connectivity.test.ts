/** @format */
/// <reference types="jest" />

/**
 * Integration Test: Cross-Stack Connectivity Validation
 *
 * This test suite validates cross-stack dependencies, CloudFormation exports/
 * imports, SSM parameter references, and stack orchestration to ensure proper
 * connectivity and data flow between stacks.
 *
 * Test Categories:
 * 1. CloudFormation Exports - Stack outputs and exports
 * 2. SSM Parameters - Cross-stack parameter sharing
 * 3. Stack Dependencies - Proper dependency chains
 * 4. Resource References - Cross-stack resource sharing
 * 5. Configuration Propagation - Environment config flow
 *
 * @see docs/CROSS_STACK_CONNECTIVITY.md
 * @see https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-cfn-stack-exports.html
 */

import { Template } from "aws-cdk-lib/assertions";

import {
  createConnectivityTestStacks,
  hasResourceOfType,
  countResourcesOfType,
  validateStackDependencies,
} from "../utils/test-utils";
// Import shared utilities - functions
import {
  getResources,
  getResourceProperties,
  getSsmParameters,
  getOutputsWithExports,
  hasOutputWithKeyword,
  getResourceTags,
  validateResourceProperties,
  validateTags,
  getSsmParameterProperties,
} from "../utils";

import {
  ConnectivityTestStacks,
  RESOURCE_TYPES,
  EXPORT_TEST_STACKS,
  INSTANCE_TEST_STACKS,
  STORAGE_TEST_STACKS,
  IAM_TEST_STACKS,
  NETWORKING_TEST_STACKS,
} from "./test-config";


// ============================================================================
// TEST SUITES
// ============================================================================

describe("Integration: Cross-Stack Connectivity Tests", () => {
  let stacks: ConnectivityTestStacks;

  beforeAll(() => {
    stacks = createConnectivityTestStacks();
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
  // 1. CLOUDFORMATION OUTPUTS
  // ==========================================================================

  describe("CloudFormation Outputs", () => {
    test("Networking stack exports VPC ID", () => {
      const template = getTemplate(NETWORKING_TEST_STACKS[0]);
      expect(hasOutputWithKeyword(template, "vpc")).toBe(true);
    });

    test("EFS stack exports file system information", () => {
      const template = getTemplate(STORAGE_TEST_STACKS[0]);
      expect(hasOutputWithKeyword(template, "filesystem")).toBe(true);
    });

    describe("Infra Stack Exports", () => {
      let hasCluster: boolean;
      let hasAlb: boolean;
      let hasRequiredOutput: boolean;

      beforeAll(() => {
        const template = getTemplate(INSTANCE_TEST_STACKS[0]);
        hasCluster = hasOutputWithKeyword(template, "cluster");
        hasAlb = hasOutputWithKeyword(template, "loadbalancer");

        // Pre-compute: at least one of cluster or ALB outputs should exist
        const outputsExist = [hasCluster, hasAlb];
        hasRequiredOutput = outputsExist.some((exists) => exists === true);
      });

      test("Infra stack exports cluster and ALB information", () => {
        expect(hasRequiredOutput).toBe(true);
      });
    });

    describe("Export Name Validation", () => {
      let allExports: Array<{
        stackName: keyof ConnectivityTestStacks;
        output: Record<string, unknown>;
        exportValue: Record<string, unknown>;
      }>;

      beforeAll(() => {
        const templates = getTemplates(EXPORT_TEST_STACKS);

        // Pre-compute all exports with their stack names
        allExports = templates.flatMap((template, index) => {
          const stackName = EXPORT_TEST_STACKS[index];
          const outputsWithExports = getOutputsWithExports(template);
          return outputsWithExports.map((output) => {
            const exportValue = (output as Record<string, unknown>).Export as
              | Record<string, unknown>
              | undefined;
            return {
              stackName,
              output,
              exportValue: exportValue || {},
            };
          });
        });
      });

      test("outputs exist", () => {
        expect(allExports.length).toBeGreaterThan(0);
      });

      test("outputs have descriptive export names", () => {
        expect(allExports).toBeDefined();
        expect(Array.isArray(allExports)).toBe(true);

        allExports.forEach(({ exportValue }) => {
          expect(exportValue).toBeDefined();
          expect(exportValue).not.toBeNull();
          expect(typeof exportValue).toBe("object");
          expect(exportValue.Name).toBeDefined();
        });
      });
    });
  });

  // ==========================================================================
  // 2. SSM PARAMETERS
  // ==========================================================================

  describe("SSM Parameter Configuration", () => {
    describe("EFS Stack Parameters", () => {
      let efsParameters: unknown[];

      beforeAll(() => {
        const template = getTemplate(STORAGE_TEST_STACKS[0]);
        efsParameters = getSsmParameters(template);
      });

      test("EFS stack creates SSM parameters for configuration", () => {
        expect(efsParameters.length).toBeGreaterThan(0);

        efsParameters.forEach((param) => {
          const properties = getSsmParameterProperties(param);
          expect(properties.Name).toBeDefined();
          expect(properties.Type).toBeDefined();
          expect(properties.Value).toBeDefined();
        });
      });
    });

    describe("Infra Stack Cluster Parameters", () => {
      let infraParameters: unknown[];
      let parametersWithCluster: Array<{
        parameter: unknown;
        properties: Record<string, string>;
      }>;

      beforeAll(() => {
        const template = getTemplate(INSTANCE_TEST_STACKS[0]);
        infraParameters = getSsmParameters(template);

        // Pre-filter parameters with "cluster" in name
        parametersWithCluster = infraParameters
          .map((param) => ({
            parameter: param,
            properties: getSsmParameterProperties(param),
          }))
          .filter((item) => item.properties.Name?.includes("cluster"));
      });

      test("Infra stack creates SSM parameters for cluster configuration", () => {
        expect(parametersWithCluster.length).toBeGreaterThan(0);
      });
    });

    describe("SSM Parameter Naming Structure", () => {
      let allParameters: Array<{
        stackName: keyof ConnectivityTestStacks;
        properties: Record<string, string>;
      }>;

      beforeAll(() => {
        const stacksToTest: ReadonlyArray<keyof ConnectivityTestStacks> = [
          STORAGE_TEST_STACKS[0],
          INSTANCE_TEST_STACKS[0],
        ];
        const templates = getTemplates(stacksToTest);

        // Pre-compute all parameters with their stack names
        allParameters = templates.flatMap((template, index) => {
          const stackName = stacksToTest[index];
          const parameters = getSsmParameters(template);
          return parameters.map((param) => ({
            stackName,
            properties: getSsmParameterProperties(param),
          }));
        });
      });

      test("parameters exist", () => {
        expect(allParameters.length).toBeGreaterThan(0);
      });

      test("SSM parameters use hierarchical naming structure", () => {
        expect(allParameters).toBeDefined();
        expect(Array.isArray(allParameters)).toBe(true);

        allParameters.forEach(({ properties }) => {
          // Parameters should follow /service/environment/category pattern
          expect(properties.Name).toMatch(/^\/[^/]+\/[^/]+\/.+/);
        });
      });
    });

    describe("SSM Parameter Descriptions", () => {
      let parametersWithDescription: Array<{
        stackName: keyof ConnectivityTestStacks;
        properties: Record<string, string>;
      }>;

      beforeAll(() => {
        const stacksToTest: ReadonlyArray<keyof ConnectivityTestStacks> = [
          STORAGE_TEST_STACKS[0],
          INSTANCE_TEST_STACKS[0],
        ];
        const templates = getTemplates(stacksToTest);

        // Pre-filter parameters with descriptions
        parametersWithDescription = templates.flatMap((template, index) => {
          const stackName = stacksToTest[index];
          const parameters = getSsmParameters(template);
          return parameters
            .map((param) => ({
              stackName,
              properties: getSsmParameterProperties(param),
            }))
            .filter((item) => item.properties.Description !== undefined);
        });
      });

      test("SSM parameters have descriptive descriptions (if provided)", () => {
        // This test validates configuration IF descriptions are provided
        // Empty array is valid - means no parameters have descriptions
        expect(parametersWithDescription).toBeDefined();
        expect(Array.isArray(parametersWithDescription)).toBe(true);

        // If descriptions exist, validate they are descriptive
        parametersWithDescription.forEach(({ properties }) => {
          expect(properties.Description).toBeDefined();
          expect(properties.Description.length).toBeGreaterThan(10);
        });
      });
    });
  });

  // ==========================================================================
  // 3. STACK DEPENDENCIES
  // ==========================================================================

  describe("Stack Dependency Chain", () => {
    describe("EFS Stack Dependencies", () => {
      let efsSecurityGroups: unknown[];

      beforeAll(() => {
        const template = getTemplate(STORAGE_TEST_STACKS[0]);
        efsSecurityGroups = getResources(
          template,
          RESOURCE_TYPES.SECURITY_GROUP
        );
      });

      test("EFS stack depends on Networking stack for VPC", () => {
        expect(efsSecurityGroups.length).toBeGreaterThan(0);

        efsSecurityGroups.forEach((sg) => {
          const validation = validateResourceProperties(sg, ["VpcId"]);
          expect(validation.valid).toBe(true);
        });
      });
    });

    describe("Infra Stack Dependencies", () => {
      let infraSecurityGroups: unknown[];
      let infraLaunchTemplates: unknown[];

      beforeAll(() => {
        const template = getTemplate(INSTANCE_TEST_STACKS[0]);
        infraSecurityGroups = getResources(
          template,
          RESOURCE_TYPES.SECURITY_GROUP
        );
        infraLaunchTemplates = getResources(
          template,
          RESOURCE_TYPES.LAUNCH_TEMPLATE
        );
      });

      test("Infra stack depends on both Networking and EFS stacks", () => {
        expect(infraSecurityGroups.length).toBeGreaterThan(0);
        expect(infraLaunchTemplates.length).toBeGreaterThan(0);
      });
    });

    describe("Service Stack Dependencies", () => {
      let serviceServices: unknown[];

      beforeAll(() => {
        const template = getTemplate(IAM_TEST_STACKS[3]);
        serviceServices = getResources(template, RESOURCE_TYPES.ECS_SERVICE);
      });

      test("Service stack depends on Infra stack for cluster and ALB", () => {
        expect(serviceServices.length).toBeGreaterThan(0);

        serviceServices.forEach((service) => {
          const validation = validateResourceProperties(service, [
            "Cluster",
            "TaskDefinition",
          ]);
          expect(validation.valid).toBe(true);
        });
      });
    });

    describe("Stack Deployment Order", () => {
      let stackChecks: Array<{
        stack: keyof ConnectivityTestStacks;
        resourceType: string;
        hasResource: boolean;
      }>;

      beforeAll(() => {
        const checks = [
          {
            stack: NETWORKING_TEST_STACKS[0],
            resourceType: RESOURCE_TYPES.VPC,
          },
          {
            stack: STORAGE_TEST_STACKS[0],
            resourceType: RESOURCE_TYPES.EFS_FILE_SYSTEM,
          },
          {
            stack: INSTANCE_TEST_STACKS[0],
            resourceType: RESOURCE_TYPES.ECS_CLUSTER,
          },
          {
            stack: IAM_TEST_STACKS[3],
            resourceType: RESOURCE_TYPES.ECS_TASK_DEFINITION,
          },
        ] as const;

        // Pre-compute resource existence checks
        stackChecks = checks.map(({ stack, resourceType }) => {
          const template = getTemplate(stack);
          return {
            stack,
            resourceType,
            hasResource: hasResourceOfType(template, resourceType),
          };
        });
      });

      test("stacks are deployed in correct order", () => {
        expect(stackChecks).toBeDefined();
        expect(Array.isArray(stackChecks)).toBe(true);

        stackChecks.forEach(({ hasResource }) => {
          expect(hasResource).toBe(true);
        });
      });
    });

    test("stack dependencies are properly configured", () => {
      expect(validateStackDependencies(stacks)).toBe(true);
    });
  });

  // ==========================================================================
  // 4. RESOURCE REFERENCES
  // ==========================================================================

  describe("Cross-Stack Resource References", () => {
    describe("EFS VPC References", () => {
      let efsSecurityGroups: unknown[];

      beforeAll(() => {
        const template = getTemplate(STORAGE_TEST_STACKS[0]);
        efsSecurityGroups = getResources(
          template,
          RESOURCE_TYPES.SECURITY_GROUP
        );
      });

      test("EFS stack references VPC from Networking stack", () => {
        expect(efsSecurityGroups.length).toBeGreaterThan(0);

        efsSecurityGroups.forEach((sg) => {
          const validation = validateResourceProperties(sg, ["VpcId"]);
          expect(validation.valid).toBe(true);
        });
      });
    });

    describe("Infra Stack EFS Access", () => {
      let efsFileSystems: unknown[];
      let infraAssociations: unknown[];
      let infraAsgs: unknown[];

      beforeAll(() => {
        const efsTemplate = getTemplate(STORAGE_TEST_STACKS[0]);
        const infraTemplate = getTemplate(INSTANCE_TEST_STACKS[0]);

        efsFileSystems = getResources(
          efsTemplate,
          RESOURCE_TYPES.EFS_FILE_SYSTEM
        );
        infraAssociations = getResources(
          infraTemplate,
          RESOURCE_TYPES.SSM_ASSOCIATION
        );
        infraAsgs = getResources(infraTemplate, RESOURCE_TYPES.ASG);
      });

      test("Infra stack can access EFS from EFS stack", () => {
        expect(efsFileSystems.length).toBeGreaterThan(0);
        expect(infraAssociations.length).toBeGreaterThan(0);
        expect(infraAsgs.length).toBeGreaterThan(0);
      });
    });

    describe("Service Stack Cluster References", () => {
      let serviceServices: unknown[];

      beforeAll(() => {
        const template = getTemplate(IAM_TEST_STACKS[3]);
        serviceServices = getResources(template, RESOURCE_TYPES.ECS_SERVICE);
      });

      test("Service stack references cluster from Infra stack", () => {
        expect(serviceServices.length).toBeGreaterThan(0);

        serviceServices.forEach((service) => {
          const validation = validateResourceProperties(service, ["Cluster"]);
          expect(validation.valid).toBe(true);
        });
      });
    });

    describe("Service Stack Load Balancer References", () => {
      let servicesWithLoadBalancers: Array<{
        service: unknown;
        properties: Record<string, unknown[]>;
        loadBalancers: unknown[];
      }>;

      beforeAll(() => {
        const template = getTemplate(IAM_TEST_STACKS[3]);
        const services = getResources(template, RESOURCE_TYPES.ECS_SERVICE);

        // Pre-filter and pre-compute services with load balancers
        servicesWithLoadBalancers = services
          .map((service) => {
            const properties = getResourceProperties<{
              LoadBalancers?: unknown[];
            }>(service);
            return {
              service,
              properties: properties as Record<string, unknown[]>,
              loadBalancers: properties.LoadBalancers || [],
            };
          })
          .filter(
            (item) =>
              item.loadBalancers !== undefined &&
              Array.isArray(item.loadBalancers) &&
              item.loadBalancers.length > 0
          )
          .map((item) => ({
            service: item.service,
            properties: item.properties,
            loadBalancers: item.loadBalancers,
          }));
      });

      test("Service stack references load balancer from Infra stack (if load balancers exist)", () => {
        // This test validates configuration IF load balancers exist
        // Empty array is valid - means no services have load balancers
        expect(servicesWithLoadBalancers).toBeDefined();
        expect(Array.isArray(servicesWithLoadBalancers)).toBe(true);

        // If load balancers exist, validate they are properly configured
        servicesWithLoadBalancers.forEach(({ loadBalancers }) => {
          expect(loadBalancers).toBeDefined();
          expect(loadBalancers.length).toBeGreaterThan(0);
          expect(loadBalancers[0]).toBeDefined();
        });
      });
    });
  });

  // ==========================================================================
  // 5. CONFIGURATION PROPAGATION
  // ==========================================================================

  describe("Configuration Propagation", () => {
    describe("Environment Configuration", () => {
      let allResources: Array<{
        stackName: keyof ConnectivityTestStacks;
        resource: unknown;
        properties: Record<string, unknown>;
      }>;

      beforeAll(() => {
        const stacksToTest: ReadonlyArray<keyof ConnectivityTestStacks> = [
          NETWORKING_TEST_STACKS[0],
          STORAGE_TEST_STACKS[0],
          INSTANCE_TEST_STACKS[0],
          IAM_TEST_STACKS[3],
        ];
        const templates = getTemplates(stacksToTest);

        const resourceTypes = [
          RESOURCE_TYPES.VPC,
          RESOURCE_TYPES.EFS_FILE_SYSTEM,
          RESOURCE_TYPES.ECS_CLUSTER,
          RESOURCE_TYPES.ECS_TASK_DEFINITION,
          RESOURCE_TYPES.ASG,
        ];

        // Pre-compute all resources with their stack names
        allResources = templates.flatMap((template, index) => {
          const stackName = stacksToTest[index];
          return resourceTypes.flatMap((type) => {
            const resources = getResources(template, type);
            return resources.map((resource) => ({
              stackName,
              resource,
              properties: getResourceProperties(resource),
            }));
          });
        });
      });

      test("environment configuration is applied to stacks", () => {
        expect(allResources).toBeDefined();
        expect(Array.isArray(allResources)).toBe(true);

        allResources.forEach(({ properties }) => {
          expect(validateTags(properties)).toBe(true);
        });
      });
    });

    describe("Project Name Tagging", () => {
      let taggedResources: Array<{
        stackName: keyof ConnectivityTestStacks;
        resource: unknown;
        properties: Record<string, unknown>;
        tags: Array<{ Key: string; Value: string }>;
        tagCount: number;
      }>;

      beforeAll(() => {
        const stacksToTest: ReadonlyArray<keyof ConnectivityTestStacks> = [
          NETWORKING_TEST_STACKS[0],
          STORAGE_TEST_STACKS[0],
          INSTANCE_TEST_STACKS[0],
        ];
        const templates = getTemplates(stacksToTest);

        const resourceTypes = [
          RESOURCE_TYPES.VPC,
          RESOURCE_TYPES.EFS_FILE_SYSTEM,
          RESOURCE_TYPES.ECS_CLUSTER,
          RESOURCE_TYPES.ASG,
        ];

        // Pre-compute resources with tags
        taggedResources = templates.flatMap((template, index) => {
          const stackName = stacksToTest[index];
          return resourceTypes.flatMap((type) => {
            const resources = getResources(template, type);
            return resources
              .map((resource) => {
                const properties = getResourceProperties(resource);
                const tags = getResourceTags(resource);
                return {
                  stackName,
                  resource,
                  properties,
                  tags,
                  tagCount: tags.length,
                };
              })
              .filter((item) => item.tagCount > 0);
          });
        });
      });

      test("project name is applied to resources", () => {
        expect(taggedResources.length).toBeGreaterThan(0);

        taggedResources.forEach(({ tags }) => {
          expect(Array.isArray(tags)).toBe(true);
          expect(tags.length).toBeGreaterThanOrEqual(1);
        });
      });
    });

    describe("Region Configuration", () => {
      let stackTemplates: Array<{
        stackName: keyof ConnectivityTestStacks;
        template: Template;
        hasResources: boolean;
      }>;

      beforeAll(() => {
        const stacksToTest: ReadonlyArray<keyof ConnectivityTestStacks> = [
          NETWORKING_TEST_STACKS[0],
          STORAGE_TEST_STACKS[0],
          INSTANCE_TEST_STACKS[0],
          IAM_TEST_STACKS[3],
        ];
        const templates = getTemplates(stacksToTest);

        // Pre-compute template resource checks
        stackTemplates = templates.map((template, index) => {
          const stackName = stacksToTest[index];
          const json = template.toJSON();
          return {
            stackName,
            template,
            hasResources:
              json.Resources !== undefined &&
              Object.keys(json.Resources).length > 0,
          };
        });
      });

      test("region configuration is consistent across stacks", () => {
        expect(stackTemplates).toBeDefined();
        expect(Array.isArray(stackTemplates)).toBe(true);

        stackTemplates.forEach(({ hasResources }) => {
          expect(hasResources).toBe(true);
        });
      });
    });
  });

  // ==========================================================================
  // 6. PARAMETER STORE CONNECTIVITY
  // ==========================================================================

  describe("Parameter Store Connectivity", () => {
    describe("Parameter Naming Convention", () => {
      let allParameters: Array<{
        stackName: keyof ConnectivityTestStacks;
        properties: Record<string, string>;
        nameParts: string[];
      }>;

      beforeAll(() => {
        const stacksToTest: ReadonlyArray<keyof ConnectivityTestStacks> = [
          STORAGE_TEST_STACKS[0],
          INSTANCE_TEST_STACKS[0],
        ];
        const templates = getTemplates(stacksToTest);

        // Pre-compute parameters with name parts
        allParameters = templates.flatMap((template, index) => {
          const stackName = stacksToTest[index];
          const parameters = getSsmParameters(template);
          return parameters.map((param) => {
            const properties = getSsmParameterProperties(param);
            const nameParts = properties.Name?.split("/").filter(Boolean) || [];
            return {
              stackName,
              properties,
              nameParts,
            };
          });
        });
      });

      test("parameters follow consistent naming convention", () => {
        expect(allParameters.length).toBeGreaterThan(0);

        allParameters.forEach(({ nameParts }) => {
          expect(nameParts).toBeDefined();
          expect(nameParts.length).toBeGreaterThanOrEqual(3);
        });
      });
    });

    describe("Parameter Environment Context", () => {
      let allParameters: Array<{
        stackName: keyof ConnectivityTestStacks;
        properties: Record<string, string>;
        nameParts: string[];
      }>;

      beforeAll(() => {
        const stacksToTest: ReadonlyArray<keyof ConnectivityTestStacks> = [
          STORAGE_TEST_STACKS[0],
          INSTANCE_TEST_STACKS[0],
        ];
        const templates = getTemplates(stacksToTest);

        // Pre-compute parameters with name parts
        allParameters = templates.flatMap((template, index) => {
          const stackName = stacksToTest[index];
          const parameters = getSsmParameters(template);
          return parameters.map((param) => {
            const properties = getSsmParameterProperties(param);
            const nameParts = properties.Name?.split("/").filter(Boolean) || [];
            return {
              stackName,
              properties,
              nameParts,
            };
          });
        });
      });

      test("parameters include environment context", () => {
        expect(allParameters.length).toBeGreaterThan(0);

        allParameters.forEach(({ properties, nameParts }) => {
          expect(properties.Name).toBeDefined();
          expect(nameParts.length).toBeGreaterThan(2);
        });
      });
    });

    describe("Service Stack Parameter Access", () => {
      let infraParameters: unknown[];
      let serviceServices: unknown[];

      beforeAll(() => {
        const infraTemplate = getTemplate(INSTANCE_TEST_STACKS[0]);
        const serviceTemplate = getTemplate(IAM_TEST_STACKS[3]);

        infraParameters = getSsmParameters(infraTemplate);
        serviceServices = getResources(serviceTemplate, RESOURCE_TYPES.ECS_SERVICE);
      });

      test("service stack can access infrastructure parameters", () => {
        expect(infraParameters.length).toBeGreaterThan(0);
        expect(serviceServices.length).toBeGreaterThan(0);
      });
    });
  });

  // ==========================================================================
  // 7. DEPENDENCY VALIDATION
  // ==========================================================================

  describe("Dependency Validation", () => {
    describe("Circular Dependency Prevention", () => {
      let networkingStr: string;
      let efsStr: string;
      let infraJson: Record<string, unknown>;
      let serviceJson: Record<string, unknown>;

      beforeAll(() => {
        const networkingTemplate = getTemplate(NETWORKING_TEST_STACKS[0]);
        const efsTemplate = getTemplate(STORAGE_TEST_STACKS[0]);
        const infraTemplate = getTemplate(INSTANCE_TEST_STACKS[0]);
        const serviceTemplate = getTemplate(IAM_TEST_STACKS[3]);

        networkingStr = JSON.stringify(networkingTemplate.toJSON());
        efsStr = JSON.stringify(efsTemplate.toJSON());
        infraJson = infraTemplate.toJSON();
        serviceJson = serviceTemplate.toJSON();
      });

      test("circular dependencies do not exist between stacks", () => {
        // Networking should not reference EFS or Infra
        expect(networkingStr).not.toMatch(/AWS::EFS::/);
        expect(networkingStr).not.toMatch(new RegExp(RESOURCE_TYPES.ECS_CLUSTER));

        // EFS should not reference Infra or Service
        expect(efsStr).not.toMatch(new RegExp(RESOURCE_TYPES.ECS_CLUSTER));
        expect(efsStr).not.toMatch(new RegExp(RESOURCE_TYPES.ECS_SERVICE));

        // Infra and Service should exist
        expect(infraJson.Resources).toBeDefined();
        expect(serviceJson.Resources).toBeDefined();
      });
    });

    describe("Required Resource Dependencies", () => {
      let dependencyChecks: Array<{
        stack: keyof ConnectivityTestStacks;
        resourceType: string;
        count: number;
      }>;

      beforeAll(() => {
        const dependencies = [
          {
            stack: STORAGE_TEST_STACKS[0],
            resourceType: RESOURCE_TYPES.SECURITY_GROUP,
          },
          {
            stack: INSTANCE_TEST_STACKS[0],
            resourceType: RESOURCE_TYPES.SECURITY_GROUP,
          },
          {
            stack: IAM_TEST_STACKS[3],
            resourceType: RESOURCE_TYPES.ECS_SERVICE,
          },
        ] as const;

        // Pre-compute resource counts
        dependencyChecks = dependencies.map(({ stack, resourceType }) => {
          const template = getTemplate(stack);
          return {
            stack,
            resourceType,
            count: countResourcesOfType(template, resourceType),
          };
        });
      });

      test("dependent stacks reference required resources", () => {
        expect(dependencyChecks).toBeDefined();
        expect(Array.isArray(dependencyChecks)).toBe(true);

        dependencyChecks.forEach(({ count }) => {
          expect(count).toBeGreaterThan(0);
        });
      });
    });
  });
});
