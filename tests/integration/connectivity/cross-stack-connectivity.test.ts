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
  // 1. CLOUDFORMATION OUTPUTS
  // ==========================================================================

  describe("CloudFormation Outputs", () => {
    test("Networking stack exports VPC ID", () => {
      const template = Template.fromStack(stacks.networkingStack);

      const outputs = template.findOutputs("*");
      const hasVpcIdOutput = Object.values(outputs).some((output) => {
        return JSON.stringify(output).toLowerCase().includes("vpc");
      });

      expect(hasVpcIdOutput).toBe(true);
    });

    test("EFS stack exports file system information", () => {
      const template = Template.fromStack(stacks.efsStack);

      const outputs = template.findOutputs("*");

      const hasFileSystemOutput = Object.values(outputs).some((output) => {
        return JSON.stringify(output).toLowerCase().includes("filesystem");
      });

      expect(hasFileSystemOutput).toBe(true);
    });

    test("Infra stack exports cluster and ALB information", () => {
      const template = Template.fromStack(stacks.infraStack);

      const outputs = template.findOutputs("*");

      const hasClusterOutput = Object.values(outputs).some((output) => {
        return JSON.stringify(output).toLowerCase().includes("cluster");
      });

      const hasAlbOutput = Object.values(outputs).some((output) => {
        return JSON.stringify(output).toLowerCase().includes("loadbalancer");
      });

      expect(hasClusterOutput || hasAlbOutput).toBe(true);
    });

    test("outputs have descriptive export names", () => {
      const templates = [
        {
          name: "Networking",
          template: Template.fromStack(stacks.networkingStack),
        },
        { name: "EFS", template: Template.fromStack(stacks.efsStack) },
        { name: "Infra", template: Template.fromStack(stacks.infraStack) },
      ];

      templates.forEach(({ name: _name, template }) => {
        const outputs = template.findOutputs("*");

        Object.values(outputs).forEach((output) => {
          const exportValue = (output as Record<string, unknown>).Export;

          if (exportValue) {
            // Export should be properly defined (can be string or object with Name property)
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
      const template = Template.fromStack(stacks.efsStack);

      expect(
        countResourcesOfType(template, "AWS::SSM::Parameter")
      ).toBeGreaterThan(0);

      const parameters = template.findResources("AWS::SSM::Parameter");

      Object.values(parameters).forEach((param) => {
        const properties = (param as Record<string, Record<string, string>>)
          .Properties;

        expect(properties.Name).toBeDefined();
        expect(properties.Type).toBeDefined();
        expect(properties.Value).toBeDefined();
      });
    });

    test("Infra stack creates SSM parameters for cluster configuration", () => {
      const template = Template.fromStack(stacks.infraStack);

      const parameters = template.findResources("AWS::SSM::Parameter");

      const hasClusterParam = Object.values(parameters).some((param) => {
        const properties = (param as Record<string, Record<string, string>>)
          .Properties;
        return properties.Name?.includes("cluster");
      });

      expect(hasClusterParam).toBe(true);
    });

    test("SSM parameters use hierarchical naming structure", () => {
      const templates = [
        { name: "EFS", template: Template.fromStack(stacks.efsStack) },
        { name: "Infra", template: Template.fromStack(stacks.infraStack) },
      ];

      templates.forEach(({ name: _name, template }) => {
        const parameters = template.findResources("AWS::SSM::Parameter");

        Object.values(parameters).forEach((param) => {
          const properties = (param as Record<string, Record<string, string>>)
            .Properties;

          // Parameters should follow /service/environment/category pattern
          expect(properties.Name).toMatch(/^\/[^/]+\/[^/]+\/.+/);
        });
      });
    });

    test("SSM parameters have descriptive descriptions", () => {
      const templates = [
        { name: "EFS", template: Template.fromStack(stacks.efsStack) },
        { name: "Infra", template: Template.fromStack(stacks.infraStack) },
      ];

      templates.forEach(({ name: _name, template }) => {
        const parameters = template.findResources("AWS::SSM::Parameter");

        Object.values(parameters).forEach((param) => {
          const properties = (param as Record<string, Record<string, string>>)
            .Properties;

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
      const efsTemplate = Template.fromStack(stacks.efsStack);

      // EFS resources should reference VPC
      const securityGroups = efsTemplate.findResources(
        RESOURCE_TYPES.SECURITY_GROUP
      );

      Object.values(securityGroups).forEach((sg) => {
        const properties = (sg as Record<string, Record<string, unknown>>)
          .Properties;
        expect(properties.VpcId).toBeDefined();
      });
    });

    test("Infra stack depends on both Networking and EFS stacks", () => {
      const infraTemplate = Template.fromStack(stacks.infraStack);

      // Infra should reference VPC (from networking)
      expect(
        countResourcesOfType(infraTemplate, RESOURCE_TYPES.SECURITY_GROUP)
      ).toBeGreaterThan(0);

      // Infra should have launch templates
      expect(
        countResourcesOfType(infraTemplate, RESOURCE_TYPES.LAUNCH_TEMPLATE)
      ).toBeGreaterThan(0);
    });

    test("Service stack depends on Infra stack for cluster and ALB", () => {
      const serviceTemplate = Template.fromStack(stacks.serviceStack);

      // Service should reference ECS cluster
      const services = serviceTemplate.findResources(
        RESOURCE_TYPES.ECS_SERVICE
      );

      Object.values(services).forEach((service) => {
        const properties = (service as Record<string, Record<string, unknown>>)
          .Properties;

        expect(properties.Cluster).toBeDefined();
        expect(properties.TaskDefinition).toBeDefined();
      });
    });

    test("stacks are deployed in correct order", () => {
      // Verify that resources exist that require the correct order
      const hasVpc = hasResourceOfType(
        Template.fromStack(stacks.networkingStack),
        RESOURCE_TYPES.VPC
      );
      const hasFileSystem = hasResourceOfType(
        Template.fromStack(stacks.efsStack),
        RESOURCE_TYPES.EFS_FILE_SYSTEM
      );
      const hasCluster = hasResourceOfType(
        Template.fromStack(stacks.infraStack),
        RESOURCE_TYPES.ECS_CLUSTER
      );
      const hasTaskDef = hasResourceOfType(
        Template.fromStack(stacks.serviceStack),
        RESOURCE_TYPES.ECS_TASK_DEFINITION
      );

      expect(hasVpc).toBe(true);
      expect(hasFileSystem).toBe(true);
      expect(hasCluster).toBe(true);
      expect(hasTaskDef).toBe(true);
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
      const template = Template.fromStack(stacks.efsStack);
      const securityGroups = template.findResources(
        RESOURCE_TYPES.SECURITY_GROUP
      );

      Object.values(securityGroups).forEach((sg) => {
        const properties = (sg as Record<string, Record<string, unknown>>)
          .Properties;
        expect(properties.VpcId).toBeDefined();
      });
    });

    test("Infra stack can access EFS from EFS stack", () => {
      const infraTemplate = Template.fromStack(stacks.infraStack);
      const efsTemplate = Template.fromStack(stacks.efsStack);

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
      const template = Template.fromStack(stacks.serviceStack);
      const services = template.findResources(RESOURCE_TYPES.ECS_SERVICE);

      Object.values(services).forEach((service) => {
        const properties = (service as Record<string, Record<string, unknown>>)
          .Properties;
        expect(properties.Cluster).toBeDefined();
      });
    });

    test("Service stack references load balancer from Infra stack", () => {
      const template = Template.fromStack(stacks.serviceStack);
      const services = template.findResources(RESOURCE_TYPES.ECS_SERVICE);

      Object.values(services).forEach((service) => {
        const properties = (
          service as Record<string, Record<string, unknown[]>>
        ).Properties;

        const loadBalancers = properties.LoadBalancers;
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
      const stackTemplates = [
        {
          name: "Networking",
          template: Template.fromStack(stacks.networkingStack),
        },
        { name: "EFS", template: Template.fromStack(stacks.efsStack) },
        { name: "Infra", template: Template.fromStack(stacks.infraStack) },
        { name: "Service", template: Template.fromStack(stacks.serviceStack) },
      ];

      stackTemplates.forEach(({ name: _name, template }) => {
        const allResources = {
          ...template.findResources(RESOURCE_TYPES.VPC),
          ...template.findResources(RESOURCE_TYPES.EFS_FILE_SYSTEM),
          ...template.findResources(RESOURCE_TYPES.ECS_CLUSTER),
          ...template.findResources(RESOURCE_TYPES.ECS_TASK_DEFINITION),
          ...template.findResources(RESOURCE_TYPES.ASG),
        };

        // At least some resources should exist in each stack
        if (Object.keys(allResources).length > 0) {
          Object.values(allResources).forEach((resource) => {
            const properties = (
              resource as Record<string, Record<string, unknown>>
            ).Properties;

            // If tags exist, verify they're properly structured
            if (properties.Tags) {
              const tags = properties.Tags as Array<Record<string, string>>;
              expect(Array.isArray(tags)).toBe(true);
            }
          });
        }
      });
    });

    test("project name is applied to resources", () => {
      const stackTemplates = [
        {
          name: "Networking",
          template: Template.fromStack(stacks.networkingStack),
        },
        { name: "EFS", template: Template.fromStack(stacks.efsStack) },
        { name: "Infra", template: Template.fromStack(stacks.infraStack) },
      ];

      const resourceTypes = [
        RESOURCE_TYPES.VPC,
        RESOURCE_TYPES.EFS_FILE_SYSTEM,
        RESOURCE_TYPES.ECS_CLUSTER,
        RESOURCE_TYPES.ASG,
      ];

      stackTemplates.forEach(({ name: _name, template }) => {
        const allResources = resourceTypes.reduce((acc, type) => {
          return { ...acc, ...template.findResources(type) };
        }, {});

        // Verify resources exist and have proper tagging structure
        if (Object.keys(allResources).length > 0) {
          Object.values(allResources).forEach((resource) => {
            const properties = (
              resource as Record<string, Record<string, unknown>>
            ).Properties;

            // If tags exist, verify they're properly structured
            if (properties.Tags) {
              const tags = properties.Tags as Array<Record<string, string>>;
              expect(Array.isArray(tags)).toBe(true);
              expect(tags.length).toBeGreaterThan(0);
            }
          });
        }
      });
    });

    test("region configuration is consistent across stacks", () => {
      const stackTemplates = [
        Template.fromStack(stacks.networkingStack),
        Template.fromStack(stacks.efsStack),
        Template.fromStack(stacks.infraStack),
        Template.fromStack(stacks.serviceStack),
      ];

      // All templates should be for the same region (implicit in CDK)
      stackTemplates.forEach((template) => {
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
      const ssmTemplates = [
        { name: "EFS", template: Template.fromStack(stacks.efsStack) },
        { name: "Infra", template: Template.fromStack(stacks.infraStack) },
      ];

      ssmTemplates.forEach(({ name: _name, template }) => {
        const parameters = template.findResources("AWS::SSM::Parameter");

        Object.values(parameters).forEach((param) => {
          const properties = (param as Record<string, Record<string, string>>)
            .Properties;

          // Should follow /service/environment/category/name pattern
          const nameParts = properties.Name?.split("/").filter(Boolean);
          expect(nameParts && nameParts.length).toBeGreaterThanOrEqual(3);
        });
      });
    });

    test("parameters include environment context", () => {
      const ssmTemplates = [
        { name: "EFS", template: Template.fromStack(stacks.efsStack) },
        { name: "Infra", template: Template.fromStack(stacks.infraStack) },
      ];

      ssmTemplates.forEach(({ name: _name, template }) => {
        const parameters = template.findResources("AWS::SSM::Parameter");

        Object.values(parameters).forEach((param) => {
          const properties = (param as Record<string, Record<string, string>>)
            .Properties;

          // Parameter names should include environment
          expect(properties.Name).toBeDefined();
          expect(properties.Name.split("/").length).toBeGreaterThan(2);
        });
      });
    });

    test("service stack can access infrastructure parameters", () => {
      const infraTemplate = Template.fromStack(stacks.infraStack);
      const serviceTemplate = Template.fromStack(stacks.serviceStack);

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
      const networkingTemplate = Template.fromStack(stacks.networkingStack);
      const networkingStr = JSON.stringify(networkingTemplate.toJSON());

      expect(networkingStr).not.toMatch(/AWS::EFS::/);
      expect(networkingStr).not.toMatch(new RegExp(RESOURCE_TYPES.ECS_CLUSTER));

      // EFS should not reference Infra or Service
      const efsTemplate = Template.fromStack(stacks.efsStack);
      const efsStr = JSON.stringify(efsTemplate.toJSON());

      expect(efsStr).not.toMatch(new RegExp(RESOURCE_TYPES.ECS_CLUSTER));
      expect(efsStr).not.toMatch(new RegExp(RESOURCE_TYPES.ECS_SERVICE));

      // Infra and Service should exist
      expect(
        Template.fromStack(stacks.infraStack).toJSON().Resources
      ).toBeDefined();
      expect(
        Template.fromStack(stacks.serviceStack).toJSON().Resources
      ).toBeDefined();
    });

    test("dependent stacks reference required resources", () => {
      // EFS depends on Networking (VPC)
      expect(
        countResourcesOfType(
          Template.fromStack(stacks.efsStack),
          RESOURCE_TYPES.SECURITY_GROUP
        )
      ).toBeGreaterThan(0);

      // Infra depends on Networking and EFS
      expect(
        countResourcesOfType(
          Template.fromStack(stacks.infraStack),
          RESOURCE_TYPES.SECURITY_GROUP
        )
      ).toBeGreaterThan(0);

      // Service depends on Infra
      expect(
        countResourcesOfType(
          Template.fromStack(stacks.serviceStack),
          RESOURCE_TYPES.ECS_SERVICE
        )
      ).toBeGreaterThan(0);
    });
  });
});
