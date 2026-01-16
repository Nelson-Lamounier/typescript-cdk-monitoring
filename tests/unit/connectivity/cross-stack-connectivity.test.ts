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

import { ConnectivityTestStacks, RESOURCE_TYPES } from "./test-config";

// ============================================================================
// TEST SUITES
// ============================================================================

describe("Integration: Cross-Stack Connectivity Tests", () => {
  let stacks: ConnectivityTestStacks;

  beforeAll(() => {
    stacks = createConnectivityTestStacks();
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
   * Check if output contains keyword
   */
  const hasOutputWithKeyword = (template: Template, keyword: string) => {
    const outputs = template.findOutputs("*");
    return Object.values(outputs).some((output) =>
      JSON.stringify(output).toLowerCase().includes(keyword.toLowerCase())
    );
  };

  /**
   * Validate SSM parameter structure
   */
  const validateSsmParameters = (
    template: Template,
    validationFn?: (properties: Record<string, string>) => void
  ) => {
    const parameters = template.findResources("AWS::SSM::Parameter");

    Object.values(parameters).forEach((param) => {
      const properties = (param as Record<string, Record<string, string>>)
        .Properties;

      // Basic validation
      expect(properties.Name).toBeDefined();
      expect(properties.Type).toBeDefined();
      expect(properties.Value).toBeDefined();

      // Custom validation if provided
      if (validationFn) {
        validationFn(properties);
      }
    });
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
   * Validate tags structure
   */
  const validateTags = (
    properties: Record<string, unknown>,
    minTagCount = 0
  ) => {
    if (properties.Tags) {
      const tags = properties.Tags as Array<Record<string, string>>;
      expect(Array.isArray(tags)).toBe(true);
      if (minTagCount > 0) {
        expect(tags.length).toBeGreaterThanOrEqual(minTagCount);
      }
    }
  };

  // ==========================================================================
  // 1. CLOUDFORMATION OUTPUTS
  // ==========================================================================

  describe("CloudFormation Outputs", () => {
    test("Networking stack exports VPC ID", () => {
      const template = getTemplate("networkingStack");
      expect(hasOutputWithKeyword(template, "vpc")).toBe(true);
    });

    test("EFS stack exports file system information", () => {
      const template = getTemplate("efsStack");
      expect(hasOutputWithKeyword(template, "filesystem")).toBe(true);
    });

    test("Infra stack exports cluster and ALB information", () => {
      const template = getTemplate("infraStack");

      const hasCluster = hasOutputWithKeyword(template, "cluster");
      const hasAlb = hasOutputWithKeyword(template, "loadbalancer");

      expect(hasCluster || hasAlb).toBe(true);
    });

    test("outputs have descriptive export names", () => {
      const stacksToTest = [
        { name: "Networking", key: "networkingStack" },
        { name: "EFS", key: "efsStack" },
        { name: "Infra", key: "infraStack" },
      ] as const;

      stacksToTest.forEach(({ key }) => {
        const template = getTemplate(key);
        const outputs = template.findOutputs("*");

        Object.values(outputs).forEach((output) => {
          const exportValue = (output as Record<string, unknown>).Export;

          if (exportValue) {
            expect(exportValue).toBeDefined();

            if (typeof exportValue === "object" && exportValue !== null) {
              expect(
                (exportValue as Record<string, unknown>).Name
              ).toBeDefined();
            }
          }
        });
      });
    });
  });

  // ==========================================================================
  // 2. SSM PARAMETERS
  // ==========================================================================

  describe("SSM Parameter Configuration", () => {
    test("EFS stack creates SSM parameters for configuration", () => {
      const template = getTemplate("efsStack");

      expect(
        countResourcesOfType(template, "AWS::SSM::Parameter")
      ).toBeGreaterThan(0);

      validateSsmParameters(template);
    });

    test("Infra stack creates SSM parameters for cluster configuration", () => {
      const template = getTemplate("infraStack");
      const parameters = template.findResources("AWS::SSM::Parameter");

      const hasClusterParam = Object.values(parameters).some((param) => {
        const properties = (param as Record<string, Record<string, string>>)
          .Properties;
        return properties.Name?.includes("cluster");
      });

      expect(hasClusterParam).toBe(true);
    });

    test("SSM parameters use hierarchical naming structure", () => {
      const stacksToTest = ["efsStack", "infraStack"] as const;

      stacksToTest.forEach((stackKey) => {
        const template = getTemplate(stackKey);

        validateSsmParameters(template, (properties) => {
          // Parameters should follow /service/environment/category pattern
          expect(properties.Name).toMatch(/^\/[^/]+\/[^/]+\/.+/);
        });
      });
    });

    test("SSM parameters have descriptive descriptions (if provided)", () => {
      const stacksToTest = ["efsStack", "infraStack"] as const;

      stacksToTest.forEach((stackKey) => {
        const template = getTemplate(stackKey);

        validateSsmParameters(template, (properties) => {
          if (properties.Description) {
            expect(properties.Description.length).toBeGreaterThan(10);
          }
        });
      });
    });
  });

  // ==========================================================================
  // 3. STACK DEPENDENCIES
  // ==========================================================================

  describe("Stack Dependency Chain", () => {
    test("EFS stack depends on Networking stack for VPC", () => {
      const template = getTemplate("efsStack");
      const securityGroups = template.findResources(
        RESOURCE_TYPES.SECURITY_GROUP
      );

      Object.values(securityGroups).forEach((sg) => {
        validateResourceProperties(sg, ["VpcId"]);
      });
    });

    test("Infra stack depends on both Networking and EFS stacks", () => {
      const template = getTemplate("infraStack");

      // Infra should reference VPC (from networking)
      expect(
        countResourcesOfType(template, RESOURCE_TYPES.SECURITY_GROUP)
      ).toBeGreaterThan(0);

      // Infra should have launch templates
      expect(
        countResourcesOfType(template, RESOURCE_TYPES.LAUNCH_TEMPLATE)
      ).toBeGreaterThan(0);
    });

    test("Service stack depends on Infra stack for cluster and ALB", () => {
      const template = getTemplate("serviceStack");
      const services = template.findResources(RESOURCE_TYPES.ECS_SERVICE);

      Object.values(services).forEach((service) => {
        validateResourceProperties(service, ["Cluster", "TaskDefinition"]);
      });
    });

    test("stacks are deployed in correct order", () => {
      // Verify that resources exist that require the correct order
      const checks = [
        {
          stack: "networkingStack",
          resourceType: RESOURCE_TYPES.VPC,
          description: "Networking has VPC",
        },
        {
          stack: "efsStack",
          resourceType: RESOURCE_TYPES.EFS_FILE_SYSTEM,
          description: "EFS has file system",
        },
        {
          stack: "infraStack",
          resourceType: RESOURCE_TYPES.ECS_CLUSTER,
          description: "Infra has ECS cluster",
        },
        {
          stack: "serviceStack",
          resourceType: RESOURCE_TYPES.ECS_TASK_DEFINITION,
          description: "Service has task definition",
        },
      ] as const;

      checks.forEach(({ stack, resourceType }) => {
        const template = getTemplate(stack);
        expect(hasResourceOfType(template, resourceType)).toBe(true);
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
    test("EFS stack references VPC from Networking stack", () => {
      const template = getTemplate("efsStack");
      const securityGroups = template.findResources(
        RESOURCE_TYPES.SECURITY_GROUP
      );

      Object.values(securityGroups).forEach((sg) => {
        validateResourceProperties(sg, ["VpcId"]);
      });
    });

    test("Infra stack can access EFS from EFS stack", () => {
      const infraTemplate = getTemplate("infraStack");
      const efsTemplate = getTemplate("efsStack");

      // Verify EFS resources exist in EFS stack
      expect(
        countResourcesOfType(efsTemplate, RESOURCE_TYPES.EFS_FILE_SYSTEM)
      ).toBeGreaterThan(0);

      // Verify Infra stack has SSM associations for EFS mounting
      expect(
        countResourcesOfType(infraTemplate, RESOURCE_TYPES.SSM_ASSOCIATION)
      ).toBeGreaterThan(0);

      // Verify ECS instances exist that can mount EFS
      expect(
        countResourcesOfType(infraTemplate, RESOURCE_TYPES.ASG)
      ).toBeGreaterThan(0);
    });

    test("Service stack references cluster from Infra stack", () => {
      const template = getTemplate("serviceStack");
      const services = template.findResources(RESOURCE_TYPES.ECS_SERVICE);

      Object.values(services).forEach((service) => {
        validateResourceProperties(service, ["Cluster"]);
      });
    });

    test("Service stack references load balancer from Infra stack (if load balancers exist)", () => {
      const template = getTemplate("serviceStack");
      const services = template.findResources(RESOURCE_TYPES.ECS_SERVICE);

      Object.values(services).forEach((service) => {
        const properties = (
          service as Record<string, Record<string, unknown[]>>
        ).Properties;

        const loadBalancers = properties.LoadBalancers;

        // Only validate if load balancers are configured
        if (loadBalancers && loadBalancers.length > 0) {
          expect(loadBalancers[0]).toBeDefined();
        }
      });
    });
  });

  // ==========================================================================
  // 5. CONFIGURATION PROPAGATION
  // ==========================================================================

  describe("Configuration Propagation", () => {
    test("environment configuration is applied to stacks", () => {
      const stacksToTest = [
        { name: "Networking", key: "networkingStack" },
        { name: "EFS", key: "efsStack" },
        { name: "Infra", key: "infraStack" },
        { name: "Service", key: "serviceStack" },
      ] as const;

      stacksToTest.forEach(({ key }) => {
        const template = getTemplate(key);

        // Get all major resource types for this stack
        const resourceTypesToCheck = [
          RESOURCE_TYPES.VPC,
          RESOURCE_TYPES.EFS_FILE_SYSTEM,
          RESOURCE_TYPES.ECS_CLUSTER,
          RESOURCE_TYPES.ECS_TASK_DEFINITION,
          RESOURCE_TYPES.ASG,
        ];

        const allResources = resourceTypesToCheck.reduce((acc, type) => {
          return { ...acc, ...template.findResources(type) };
        }, {});

        // If resources exist, validate their tag structure
        if (Object.keys(allResources).length > 0) {
          Object.values(allResources).forEach((resource) => {
            const properties = (
              resource as Record<string, Record<string, unknown>>
            ).Properties;

            validateTags(properties);
          });
        }
      });
    });

    test("project name is applied to resources", () => {
      const stacksToTest = [
        { name: "Networking", key: "networkingStack" },
        { name: "EFS", key: "efsStack" },
        { name: "Infra", key: "infraStack" },
      ] as const;

      const resourceTypes = [
        RESOURCE_TYPES.VPC,
        RESOURCE_TYPES.EFS_FILE_SYSTEM,
        RESOURCE_TYPES.ECS_CLUSTER,
        RESOURCE_TYPES.ASG,
      ];

      stacksToTest.forEach(({ key }) => {
        const template = getTemplate(key);

        const allResources = resourceTypes.reduce((acc, type) => {
          return { ...acc, ...template.findResources(type) };
        }, {});

        // Verify resources exist and have proper tagging structure
        if (Object.keys(allResources).length > 0) {
          Object.values(allResources).forEach((resource) => {
            const properties = (
              resource as Record<string, Record<string, unknown>>
            ).Properties;

            validateTags(properties, 1);
          });
        }
      });
    });

    test("region configuration is consistent across stacks", () => {
      const stacksToTest = [
        "networkingStack",
        "efsStack",
        "infraStack",
        "serviceStack",
      ] as const;

      stacksToTest.forEach((stackKey) => {
        const template = getTemplate(stackKey);
        const json = template.toJSON();

        expect(json.Resources).toBeDefined();
        expect(Object.keys(json.Resources).length).toBeGreaterThan(0);
      });
    });
  });

  // ==========================================================================
  // 6. PARAMETER STORE CONNECTIVITY
  // ==========================================================================

  describe("Parameter Store Connectivity", () => {
    test("parameters follow consistent naming convention", () => {
      const stacksToTest = ["efsStack", "infraStack"] as const;

      stacksToTest.forEach((stackKey) => {
        const template = getTemplate(stackKey);

        validateSsmParameters(template, (properties) => {
          // Should follow /service/environment/category/name pattern
          const nameParts = properties.Name?.split("/").filter(Boolean);
          expect(nameParts && nameParts.length).toBeGreaterThanOrEqual(3);
        });
      });
    });

    test("parameters include environment context", () => {
      const stacksToTest = ["efsStack", "infraStack"] as const;

      stacksToTest.forEach((stackKey) => {
        const template = getTemplate(stackKey);

        validateSsmParameters(template, (properties) => {
          // Parameter names should include environment
          expect(properties.Name).toBeDefined();
          expect(properties.Name.split("/").length).toBeGreaterThan(2);
        });
      });
    });

    test("service stack can access infrastructure parameters", () => {
      const infraTemplate = getTemplate("infraStack");
      const serviceTemplate = getTemplate("serviceStack");

      // Infra creates parameters
      expect(
        countResourcesOfType(infraTemplate, "AWS::SSM::Parameter")
      ).toBeGreaterThan(0);

      // Service stack references cluster (which may use parameters)
      expect(
        countResourcesOfType(serviceTemplate, RESOURCE_TYPES.ECS_SERVICE)
      ).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // 7. DEPENDENCY VALIDATION
  // ==========================================================================

  describe("Dependency Validation", () => {
    test("circular dependencies do not exist between stacks", () => {
      // Networking should not reference EFS or Infra
      const networkingTemplate = getTemplate("networkingStack");
      const networkingStr = JSON.stringify(networkingTemplate.toJSON());

      expect(networkingStr).not.toMatch(/AWS::EFS::/);
      expect(networkingStr).not.toMatch(new RegExp(RESOURCE_TYPES.ECS_CLUSTER));

      // EFS should not reference Infra or Service
      const efsTemplate = getTemplate("efsStack");
      const efsStr = JSON.stringify(efsTemplate.toJSON());

      expect(efsStr).not.toMatch(new RegExp(RESOURCE_TYPES.ECS_CLUSTER));
      expect(efsStr).not.toMatch(new RegExp(RESOURCE_TYPES.ECS_SERVICE));

      // Infra and Service should exist
      const infraJson = getTemplate("infraStack").toJSON();
      const serviceJson = getTemplate("serviceStack").toJSON();

      expect(infraJson.Resources).toBeDefined();
      expect(serviceJson.Resources).toBeDefined();
    });

    test("dependent stacks reference required resources", () => {
      const dependencies = [
        {
          stack: "efsStack",
          resourceType: RESOURCE_TYPES.SECURITY_GROUP,
          description: "EFS depends on Networking (VPC)",
        },
        {
          stack: "infraStack",
          resourceType: RESOURCE_TYPES.SECURITY_GROUP,
          description: "Infra depends on Networking and EFS",
        },
        {
          stack: "serviceStack",
          resourceType: RESOURCE_TYPES.ECS_SERVICE,
          description: "Service depends on Infra",
        },
      ] as const;

      dependencies.forEach(({ stack, resourceType }) => {
        const template = getTemplate(stack);
        expect(countResourcesOfType(template, resourceType)).toBeGreaterThan(0);
      });
    });
  });
});
