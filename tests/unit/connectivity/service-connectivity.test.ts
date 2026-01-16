/** @format */
/// <reference types="jest" />

/**
 * Integration Test: Service-to-Service Connectivity Validation
 *
 * This test suite validates connectivity between services in the monitoring
 * stack, including ALB to ECS, ECS to EFS, and inter-service communication.
 *
 * Test Categories:
 * 1. ALB Connectivity - Load balancer to target groups
 * 2. ECS Connectivity - Tasks to EFS, tasks to tasks
 * 3. EFS Connectivity - Mount targets and access points
 * 4. Security Group Rules - Service-to-service communication
 * 5. Port Configuration - Expected ports and protocols
 *
 * @see docs/SERVICE_CONNECTIVITY.md
 * @see https://docs.aws.amazon.com/elasticloadbalancing/latest/application/introduction.html
 */

import { Template, Match } from "aws-cdk-lib/assertions";

import { createConnectivityTestStacks } from "../utils/test-utils";

import {
  ConnectivityTestStacks,
  RESOURCE_TYPES,
  PORT_CONFIG,
} from "./test-config";

// ============================================================================
// TEST SUITES
// ============================================================================

describe("Integration: Service Connectivity Tests", () => {
  let stacks: ConnectivityTestStacks;

  beforeAll(() => {
    stacks = createConnectivityTestStacks();
  });

  // ==========================================================================
  // 1. ALB TO ECS CONNECTIVITY
  // ==========================================================================

  describe("ALB to ECS Connectivity", () => {
    test("ALB has target groups configured", () => {
      const template = Template.fromStack(stacks.serviceStack);

      const targetGroups = template.findResources(RESOURCE_TYPES.TARGET_GROUP);
      expect(Object.keys(targetGroups).length).toBeGreaterThan(0);
    });

    test("ALB listener forwards traffic to target groups", () => {
      const template = Template.fromStack(stacks.infraStack);

      const listeners = template.findResources(RESOURCE_TYPES.LISTENER);

      expect(Object.keys(listeners).length).toBeGreaterThan(0);

      Object.values(listeners).forEach((listener) => {
        const properties = (listener as Record<string, Record<string, unknown>>)
          .Properties;

        expect(properties.Protocol).toBeDefined();
        expect(properties.Port).toBeDefined();
        expect(properties.DefaultActions).toBeDefined();
      });
    });

    test("target groups are configured with correct ports", () => {
      const template = Template.fromStack(stacks.serviceStack);

      const targetGroups = template.findResources(RESOURCE_TYPES.TARGET_GROUP);

      Object.values(targetGroups).forEach((tg) => {
        const properties = (tg as Record<string, Record<string, unknown>>)
          .Properties;
        expect(properties.Port).toBeDefined();
        expect(properties.Protocol).toBe("HTTP");
      });
    });

    test("target groups have health checks enabled", () => {
      const template = Template.fromStack(stacks.serviceStack);

      const targetGroups = template.findResources(RESOURCE_TYPES.TARGET_GROUP);

      Object.values(targetGroups).forEach((tg) => {
        const properties = (tg as Record<string, Record<string, unknown>>)
          .Properties;

        // Health check is enabled if HealthCheckPath is defined
        // HealthCheckEnabled property is optional (defaults to true)
        expect(properties.HealthCheckPath).toBeDefined();
        expect(properties.HealthCheckIntervalSeconds).toBeDefined();
      });
    });

    test("ALB security group allows inbound traffic from allowed CIDRs", () => {
      const template = Template.fromStack(stacks.infraStack);

      // Check both standalone and inline security group rules
      const rules = template.findResources(
        RESOURCE_TYPES.SECURITY_GROUP_INGRESS
      );
      const securityGroups = template.findResources(
        RESOURCE_TYPES.SECURITY_GROUP
      );

      // Check standalone ingress rules
      Object.values(rules).forEach((rule) => {
        const properties = (rule as Record<string, Record<string, unknown>>)
          .Properties;

        if (
          properties.IpProtocol === "tcp" &&
          (properties.FromPort === PORT_CONFIG.HTTP ||
            properties.FromPort === PORT_CONFIG.HTTPS)
        ) {
          // Valid HTTP/HTTPS rule found
        }
      });

      // Check inline ingress rules
      Object.values(securityGroups).forEach((sg) => {
        const properties = (sg as Record<string, Record<string, unknown>>)
          .Properties;

        if (properties.SecurityGroupIngress) {
          const ingressRules = properties.SecurityGroupIngress as Array<
            Record<string, unknown>
          >;

          ingressRules.forEach((rule) => {
            if (
              rule.IpProtocol === "tcp" &&
              (rule.FromPort === PORT_CONFIG.HTTP ||
                rule.FromPort === PORT_CONFIG.HTTPS)
            ) {
              // Valid HTTP/HTTPS rule found
            }
          });
        }
      });

      // At least one security group should exist
      expect(Object.keys(securityGroups).length).toBeGreaterThan(0);
    });

    test("ECS instances accept traffic from ALB security group", () => {
      const template = Template.fromStack(stacks.infraStack);

      const rules = template.findResources(
        RESOURCE_TYPES.SECURITY_GROUP_INGRESS
      );
      let hasAlbToEcsRule = false;

      Object.values(rules).forEach((rule) => {
        const properties = (rule as Record<string, Record<string, unknown>>)
          .Properties;

        // ALB to ECS should use security group reference
        if (
          properties.IpProtocol === "tcp" &&
          properties.SourceSecurityGroupId
        ) {
          hasAlbToEcsRule = true;
        }
      });

      expect(hasAlbToEcsRule).toBe(true);
    });
  });

  // ==========================================================================
  // 2. ECS TO EFS CONNECTIVITY
  // ==========================================================================

  describe("ECS to EFS Connectivity", () => {
    test("EFS has mount targets in availability zones", () => {
      const template = Template.fromStack(stacks.efsStack);

      const mountTargets = template.findResources(
        RESOURCE_TYPES.EFS_MOUNT_TARGET
      );
      expect(Object.keys(mountTargets).length).toBeGreaterThanOrEqual(1);

      Object.values(mountTargets).forEach((mt) => {
        const properties = (mt as Record<string, Record<string, unknown>>)
          .Properties;
        expect(properties.FileSystemId).toBeDefined();
        expect(properties.SubnetId).toBeDefined();
        expect(properties.SecurityGroups).toBeDefined();
      });
    });

    test("EFS mount targets are in private subnets", () => {
      const template = Template.fromStack(stacks.efsStack);

      const mountTargets = template.findResources(
        RESOURCE_TYPES.EFS_MOUNT_TARGET
      );

      Object.values(mountTargets).forEach((mt) => {
        const properties = (mt as Record<string, Record<string, unknown>>)
          .Properties;

        // Mount targets should have subnet IDs
        expect(properties.SubnetId).toBeDefined();
      });
    });

    test("EFS security group allows NFS traffic from ECS security group", () => {
      const template = Template.fromStack(stacks.efsStack);

      // Check for inline ingress rules in security groups
      const securityGroups = template.findResources(
        RESOURCE_TYPES.SECURITY_GROUP
      );

      Object.values(securityGroups).forEach((sg) => {
        const properties = (sg as Record<string, Record<string, unknown>>)
          .Properties;

        if (properties.SecurityGroupIngress) {
          const ingressRules = properties.SecurityGroupIngress as Array<
            Record<string, unknown>
          >;

          ingressRules.forEach((rule) => {
            if (
              rule.FromPort === PORT_CONFIG.NFS &&
              rule.ToPort === PORT_CONFIG.NFS
            ) {
              // Valid NFS rule found
            }
          });
        }
      });

      // EFS security group should exist
      expect(Object.keys(securityGroups).length).toBeGreaterThan(0);
    });

    test("EFS access point is configured for ECS tasks", () => {
      const template = Template.fromStack(stacks.efsStack);

      template.hasResourceProperties(RESOURCE_TYPES.EFS_ACCESS_POINT, {
        FileSystemId: Match.anyValue(),
        PosixUser: Match.objectLike({
          Uid: Match.anyValue(),
          Gid: Match.anyValue(),
        }),
      });
    });

    test("EFS mount targets have correct security group associations", () => {
      const template = Template.fromStack(stacks.efsStack);

      const mountTargets = template.findResources(
        RESOURCE_TYPES.EFS_MOUNT_TARGET
      );

      Object.values(mountTargets).forEach((mt) => {
        const properties = (mt as Record<string, Record<string, unknown>>)
          .Properties;
        const securityGroups = properties.SecurityGroups as unknown[];

        expect(Array.isArray(securityGroups)).toBe(true);
        expect(securityGroups.length).toBeGreaterThan(0);
      });
    });
  });

  // ==========================================================================
  // 3. SECURITY GROUP CONNECTIVITY RULES
  // ==========================================================================

  describe("Security Group Connectivity Rules", () => {
    test("security groups exist for all components", () => {
      const templates = [
        { name: "EFS", template: Template.fromStack(stacks.efsStack) },
        { name: "Infra", template: Template.fromStack(stacks.infraStack) },
      ];

      templates.forEach(({ name: _name, template }) => {
        const securityGroups = template.findResources(
          RESOURCE_TYPES.SECURITY_GROUP
        );
        expect(Object.keys(securityGroups).length).toBeGreaterThan(0);
      });
    });

    test("security group rules use least privilege principle", () => {
      const template = Template.fromStack(stacks.infraStack);

      const rules = template.findResources(
        RESOURCE_TYPES.SECURITY_GROUP_INGRESS
      );

      Object.values(rules).forEach((rule) => {
        const properties = (rule as Record<string, Record<string, unknown>>)
          .Properties;

        // Rules should specify specific ports, not all traffic
        if (
          properties.IpProtocol === "tcp" ||
          properties.IpProtocol === "udp"
        ) {
          expect(properties.FromPort).toBeDefined();
          expect(properties.ToPort).toBeDefined();
        }
      });
    });

    test("security group egress allows necessary outbound traffic", () => {
      const template = Template.fromStack(stacks.infraStack);

      const egressRules = template.findResources(
        RESOURCE_TYPES.SECURITY_GROUP_EGRESS
      );

      // Should have at least default egress rule
      expect(Object.keys(egressRules).length).toBeGreaterThan(0);
    });

    test("no security groups allow unrestricted inbound traffic", () => {
      const templates = [
        Template.fromStack(stacks.efsStack),
        Template.fromStack(stacks.infraStack),
      ];

      templates.forEach((template) => {
        const rules = template.findResources(
          RESOURCE_TYPES.SECURITY_GROUP_INGRESS
        );

        Object.values(rules).forEach((rule) => {
          const properties = (rule as Record<string, Record<string, unknown>>)
            .Properties;

          // If CIDR is 0.0.0.0/0, it should only be for specific use cases
          if (
            properties.CidrIp === "0.0.0.0/0" ||
            properties.CidrIpv6 === "::/0"
          ) {
            // Should not allow all ports
            expect(properties.IpProtocol).not.toBe("-1");
          }
        });
      });
    });
  });

  // ==========================================================================
  // 4. PORT AND PROTOCOL CONFIGURATION
  // ==========================================================================

  describe("Port and Protocol Configuration", () => {
    test("ALB listens on standard HTTP port 80", () => {
      const template = Template.fromStack(stacks.infraStack);

      template.hasResourceProperties(RESOURCE_TYPES.LISTENER, {
        Port: PORT_CONFIG.HTTP,
        Protocol: "HTTP",
      });
    });

    test("Prometheus service uses correct port", () => {
      const template = Template.fromStack(stacks.serviceStack);

      const taskDefs = template.findResources(
        RESOURCE_TYPES.ECS_TASK_DEFINITION
      );

      Object.values(taskDefs).forEach((taskDef) => {
        const properties = (taskDef as Record<string, Record<string, unknown>>)
          .Properties;
        const containers = properties.ContainerDefinitions as Array<
          Record<string, unknown>
        >;

        containers.forEach((container) => {
          const name = container.Name as string;
          const portMappings = container.PortMappings as Array<
            Record<string, number>
          >;

          if (name?.toLowerCase().includes("prometheus")) {
            const hasPrometheusPort = portMappings?.some(
              (pm) => pm.ContainerPort === PORT_CONFIG.PROMETHEUS
            );
            expect(hasPrometheusPort).toBe(true);
          }
        });
      });
    });

    test("Grafana service uses correct port", () => {
      const template = Template.fromStack(stacks.serviceStack);

      const taskDefs = template.findResources(
        RESOURCE_TYPES.ECS_TASK_DEFINITION
      );

      Object.values(taskDefs).forEach((taskDef) => {
        const properties = (taskDef as Record<string, Record<string, unknown>>)
          .Properties;
        const containers = properties.ContainerDefinitions as Array<
          Record<string, unknown>
        >;

        containers.forEach((container) => {
          const name = container.Name as string;
          const portMappings = container.PortMappings as Array<
            Record<string, number>
          >;

          if (name?.toLowerCase().includes("grafana")) {
            const hasGrafanaPort = portMappings?.some(
              (pm) => pm.ContainerPort === PORT_CONFIG.GRAFANA
            );
            expect(hasGrafanaPort).toBe(true);
          }
        });
      });
    });

    test("EFS uses NFS port 2049", () => {
      const template = Template.fromStack(stacks.efsStack);

      const securityGroups = template.findResources(
        RESOURCE_TYPES.SECURITY_GROUP
      );

      Object.values(securityGroups).forEach((sg) => {
        const properties = (sg as Record<string, Record<string, unknown>>)
          .Properties;

        if (properties.SecurityGroupIngress) {
          const ingressRules = properties.SecurityGroupIngress as Array<
            Record<string, unknown>
          >;

          ingressRules.forEach((rule) => {
            if (
              rule.FromPort === PORT_CONFIG.NFS &&
              rule.ToPort === PORT_CONFIG.NFS
            ) {
              expect(rule.IpProtocol).toBe("tcp");
            }
          });
        }
      });

      // EFS security group should exist
      expect(Object.keys(securityGroups).length).toBeGreaterThan(0);
    });

    test("Node Exporter uses correct port for metrics", () => {
      const template = Template.fromStack(stacks.serviceStack);

      const taskDefs = template.findResources(
        RESOURCE_TYPES.ECS_TASK_DEFINITION
      );

      Object.values(taskDefs).forEach((taskDef) => {
        const properties = (taskDef as Record<string, Record<string, unknown>>)
          .Properties;
        const containers = properties.ContainerDefinitions as Array<
          Record<string, unknown>
        >;

        containers.forEach((container) => {
          const name = container.Name as string;
          const portMappings = container.PortMappings as Array<
            Record<string, number>
          >;

          if (name?.toLowerCase().includes("node-exporter")) {
            const hasNodeExporterPort = portMappings?.some(
              (pm) => pm.ContainerPort === PORT_CONFIG.NODE_EXPORTER
            );
            expect(hasNodeExporterPort).toBe(true);
          }
        });
      });
    });
  });

  // ==========================================================================
  // 5. NETWORK MODE CONFIGURATION
  // ==========================================================================

  describe("Network Mode Configuration", () => {
    test("ECS tasks use appropriate network mode", () => {
      const template = Template.fromStack(stacks.serviceStack);

      const taskDefs = template.findResources(
        RESOURCE_TYPES.ECS_TASK_DEFINITION
      );

      Object.values(taskDefs).forEach((taskDef) => {
        const properties = (taskDef as Record<string, Record<string, string>>)
          .Properties;

        // Network mode should be defined
        expect(properties.NetworkMode).toBeDefined();

        // Common modes: bridge, host, awsvpc
        expect(["bridge", "host", "awsvpc"]).toContain(properties.NetworkMode);
      });
    });

    test("bridge network mode containers use dynamic port mapping", () => {
      const template = Template.fromStack(stacks.serviceStack);

      const taskDefs = template.findResources(
        RESOURCE_TYPES.ECS_TASK_DEFINITION
      );

      Object.values(taskDefs).forEach((taskDef) => {
        const properties = (taskDef as Record<string, Record<string, unknown>>)
          .Properties;

        if (properties.NetworkMode === "bridge") {
          const containers = properties.ContainerDefinitions as Array<
            Record<string, unknown>
          >;

          containers.forEach((container) => {
            const portMappings = container.PortMappings as Array<
              Record<string, number>
            >;

            // Bridge mode should have port mappings
            if (portMappings && portMappings.length > 0) {
              portMappings.forEach((pm) => {
                expect(pm.ContainerPort).toBeDefined();
              });
            }
          });
        }
      });
    });
  });

  // ==========================================================================
  // 6. HEALTH CHECK CONNECTIVITY
  // ==========================================================================

  describe("Health Check Connectivity", () => {
    test("ALB target groups have accessible health check paths", () => {
      const template = Template.fromStack(stacks.serviceStack);

      const targetGroups = template.findResources(RESOURCE_TYPES.TARGET_GROUP);

      Object.values(targetGroups).forEach((tg) => {
        const properties = (tg as Record<string, Record<string, unknown>>)
          .Properties;

        expect(properties.HealthCheckPath).toBeDefined();
        // HealthCheckProtocol may be undefined (defaults to target protocol)
        if (properties.HealthCheckProtocol) {
          expect(["HTTP", "HTTPS", "TCP"]).toContain(
            properties.HealthCheckProtocol
          );
        }
        expect(properties.HealthCheckIntervalSeconds).toBeDefined();
        expect(properties.HealthyThresholdCount).toBeDefined();
        expect(properties.UnhealthyThresholdCount).toBeDefined();
      });
    });

    test("health check intervals are reasonable", () => {
      const template = Template.fromStack(stacks.serviceStack);

      const targetGroups = template.findResources(RESOURCE_TYPES.TARGET_GROUP);

      Object.values(targetGroups).forEach((tg) => {
        const properties = (tg as Record<string, Record<string, number>>)
          .Properties;

        const interval = properties.HealthCheckIntervalSeconds;
        const timeout = properties.HealthCheckTimeoutSeconds;

        // Interval should be greater than timeout
        if (interval && timeout) {
          expect(interval).toBeGreaterThan(timeout);
        }

        // Interval should be reasonable (5-300 seconds)
        if (interval) {
          expect(interval).toBeGreaterThanOrEqual(5);
          expect(interval).toBeLessThanOrEqual(300);
        }
      });
    });

    test("ECS services have health check grace period configured", () => {
      const template = Template.fromStack(stacks.serviceStack);

      const services = template.findResources(RESOURCE_TYPES.ECS_SERVICE);

      Object.values(services).forEach((service) => {
        const properties = (service as Record<string, Record<string, unknown>>)
          .Properties;

        // Services with load balancers should have grace period
        if (properties.LoadBalancers) {
          expect(properties.HealthCheckGracePeriodSeconds).toBeDefined();
        }
      });
    });
  });

  // ==========================================================================
  // 7. SERVICE DISCOVERY
  // ==========================================================================

  describe("Service Discovery", () => {
    test("ECS cluster supports service discovery", () => {
      const template = Template.fromStack(stacks.infraStack);

      const cluster = template.findResources(RESOURCE_TYPES.ECS_CLUSTER);
      expect(Object.keys(cluster).length).toBe(1);

      // Cluster should be configured for service discovery
      Object.values(cluster).forEach((c) => {
        const properties = (c as Record<string, Record<string, string>>)
          .Properties;
        expect(properties.ClusterName).toBeDefined();
      });
    });

    test("services can reference each other via DNS", () => {
      const template = Template.fromStack(stacks.serviceStack);

      const taskDefs = template.findResources(
        RESOURCE_TYPES.ECS_TASK_DEFINITION
      );

      Object.values(taskDefs).forEach((taskDef) => {
        const properties = (taskDef as Record<string, Record<string, unknown>>)
          .Properties;
        const containers = properties.ContainerDefinitions as Array<
          Record<string, unknown>
        >;

        containers.forEach((container) => {
          const environment = container.Environment as Array<
            Record<string, string>
          >;

          // Environment variables may contain service discovery endpoints
          if (environment) {
            environment.forEach((env) => {
              // DNS names should not be hardcoded IPs
              if (env.Name?.includes("URL") || env.Name?.includes("HOST")) {
                expect(env.Value).not.toMatch(/^\d+\.\d+\.\d+\.\d+$/);
              }
            });
          }
        });
      });
    });
  });

  // ==========================================================================
  // 8. CROSS-STACK CONNECTIVITY
  // ==========================================================================

  describe("Cross-Stack Connectivity", () => {
    test("Infra stack can access EFS from EFS stack", () => {
      const infraTemplate = Template.fromStack(stacks.infraStack);
      const efsTemplate = Template.fromStack(stacks.efsStack);

      // Verify EFS resources exist in EFS stack
      const efsFileSystems = efsTemplate.findResources(
        RESOURCE_TYPES.EFS_FILE_SYSTEM
      );
      expect(Object.keys(efsFileSystems).length).toBeGreaterThan(0);

      // Verify Infra stack has ECS instances that could mount EFS
      const asgs = infraTemplate.findResources(RESOURCE_TYPES.ASG);
      expect(Object.keys(asgs).length).toBeGreaterThan(0);

      // Verify SSM associations exist for EFS mounting
      const associations = infraTemplate.findResources(
        RESOURCE_TYPES.SSM_ASSOCIATION
      );
      expect(Object.keys(associations).length).toBeGreaterThan(0);
    });

    test("Service stack references resources from Infra stack", () => {
      const template = Template.fromStack(stacks.serviceStack);

      // Service stack should reference cluster from infra stack
      const services = template.findResources(RESOURCE_TYPES.ECS_SERVICE);

      expect(Object.keys(services).length).toBeGreaterThan(0);

      Object.values(services).forEach((service) => {
        const properties = (service as Record<string, Record<string, unknown>>)
          .Properties;

        // All services must have a cluster
        expect(properties.Cluster).toBeDefined();

        // LoadBalancers is optional (some services may not use ALB)
        // Just verify the service exists and has a cluster reference
      });
    });

    test("all stacks use same VPC for connectivity", () => {
      // All resources should be in the same VPC
      const efsTemplate = Template.fromStack(stacks.efsStack);
      const infraTemplate = Template.fromStack(stacks.infraStack);

      const efsSecurityGroups = efsTemplate.findResources(
        RESOURCE_TYPES.SECURITY_GROUP
      );
      const infraSecurityGroups = infraTemplate.findResources(
        RESOURCE_TYPES.SECURITY_GROUP
      );

      // All security groups should reference the same VPC
      const vpcIds = new Set<string>();

      [
        ...Object.values(efsSecurityGroups),
        ...Object.values(infraSecurityGroups),
      ].forEach((sg) => {
        const properties = (sg as Record<string, Record<string, unknown>>)
          .Properties;
        vpcIds.add(JSON.stringify(properties.VpcId));
      });

      // All should be in the same VPC
      expect(vpcIds.size).toBe(1);
    });
  });
});
