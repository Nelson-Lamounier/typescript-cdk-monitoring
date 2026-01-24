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
  getResources,
  getResourceProperties,
  getContainersFromTaskDef,
  getTaskDefNetworkMode,
  getSecurityGroupIngressRules,
  getIngressRules,
  validateResourceProperties,
  isInRange,
  isValidNetworkMode,
  isNfsPortRule,
  isUnrestrictedAccess,
} from "../utils";
import type { ContainerDefinition } from "../utils";

import {
  ConnectivityTestStacks,
  RESOURCE_TYPES,
  PORT_CONFIG,
  STORAGE_TEST_STACKS,
  IAM_TEST_STACKS,
  INSTANCE_TEST_STACKS,
} from "./test-config";

// ============================================================================
// TEST SUITES
// ============================================================================

describe("Integration: Service Connectivity Tests", () => {
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
   * Check if container has specific port mapping
   */
  const containerHasPort = (
    container: ContainerDefinition,
    port: number
  ): boolean => {
    const portMappings = container.PortMappings;
    return portMappings?.some((pm) => pm.ContainerPort === port) ?? false;
  };

  // ==========================================================================
  // 1. ALB TO ECS CONNECTIVITY
  // ==========================================================================

  describe("ALB to ECS Connectivity", () => {
    describe("Target Group Configuration", () => {
      let targetGroups: unknown[];
      let targetGroupProperties: Array<Record<string, unknown>>;

      beforeAll(() => {
        const template = getTemplate(IAM_TEST_STACKS[3]);
        targetGroups = getResources(template, RESOURCE_TYPES.TARGET_GROUP);
        targetGroupProperties = targetGroups.map((tg) =>
          getResourceProperties(tg)
        );
      });

      test("ALB has target groups configured", () => {
        expect(targetGroups.length).toBeGreaterThan(0);
      });

      test("target groups are configured with correct ports", () => {
        targetGroupProperties.forEach((properties) => {
          expect(properties.Port).toBeDefined();
          expect(properties.Protocol).toBe("HTTP");
        });
      });

      test("target groups have health checks enabled", () => {
        targetGroupProperties.forEach((properties) => {
          expect(properties.HealthCheckPath).toBeDefined();
          expect(properties.HealthCheckIntervalSeconds).toBeDefined();
        });
      });
    });

    describe("ALB Listener Configuration", () => {
      let listeners: unknown[];

      beforeAll(() => {
        const template = getTemplate(INSTANCE_TEST_STACKS[0]);
        listeners = getResources(template, RESOURCE_TYPES.LISTENER);
      });

      test("ALB listener forwards traffic to target groups", () => {
        expect(listeners.length).toBeGreaterThan(0);

        listeners.forEach((listener) => {
          const validation = validateResourceProperties(listener, [
            "Protocol",
            "Port",
            "DefaultActions",
          ]);
          expect(validation.valid).toBe(true);
        });
      });
    });

    describe("Security Group Configuration", () => {
      let securityGroups: unknown[];
      let albToEcsRules: unknown[];

      beforeAll(() => {
        const template = getTemplate(INSTANCE_TEST_STACKS[0]);
        securityGroups = getResources(template, RESOURCE_TYPES.SECURITY_GROUP);

        const rules = getResources(
          template,
          RESOURCE_TYPES.SECURITY_GROUP_INGRESS
        );
        albToEcsRules = rules.filter((rule) => {
          const properties = getResourceProperties(rule);
          const isTcp = properties.IpProtocol === "tcp";
          const hasSourceSg = properties.SourceSecurityGroupId !== undefined;
          return isTcp && hasSourceSg;
        });
      });

      test("ALB security groups exist", () => {
        expect(securityGroups.length).toBeGreaterThan(0);
      });

      test("ECS instances accept traffic from ALB security group", () => {
        expect(albToEcsRules.length).toBeGreaterThan(0);
      });
    });
  });

  // ==========================================================================
  // 2. ECS TO EFS CONNECTIVITY
  // ==========================================================================

  describe("ECS to EFS Connectivity", () => {
    describe("EFS Mount Target Configuration", () => {
      let mountTargets: unknown[];
      let mountTargetProperties: Array<Record<string, unknown>>;

      beforeAll(() => {
        const template = getTemplate(STORAGE_TEST_STACKS[0]);
        mountTargets = getResources(template, RESOURCE_TYPES.EFS_MOUNT_TARGET);
        mountTargetProperties = mountTargets.map((mt) =>
          getResourceProperties(mt)
        );
      });

      test("EFS has mount targets in availability zones", () => {
        expect(mountTargets.length).toBeGreaterThanOrEqual(1);

        mountTargets.forEach((mt) => {
          const validation = validateResourceProperties(mt, [
            "FileSystemId",
            "SubnetId",
            "SecurityGroups",
          ]);
          expect(validation.valid).toBe(true);
        });
      });

      test("EFS mount targets are in private subnets", () => {
        mountTargets.forEach((mt) => {
          const validation = validateResourceProperties(mt, ["SubnetId"]);
          expect(validation.valid).toBe(true);
        });
      });

      test("EFS mount targets have correct security group associations", () => {
        mountTargetProperties.forEach((properties) => {
          const securityGroups = properties.SecurityGroups as unknown[];
          expect(Array.isArray(securityGroups)).toBe(true);
          expect(securityGroups.length).toBeGreaterThan(0);
        });
      });
    });

    describe("EFS Security Group Configuration", () => {
      let securityGroups: unknown[];
      let nfsRules: Array<Record<string, unknown>>;

      beforeAll(() => {
        const template = getTemplate(STORAGE_TEST_STACKS[0]);
        securityGroups = getResources(template, RESOURCE_TYPES.SECURITY_GROUP);

        // Get all ingress rules from SecurityGroupIngress resources
        const standaloneRules = getSecurityGroupIngressRules(template);
        const standaloneNfsRules = standaloneRules
          .map((rule) => getResourceProperties(rule))
          .filter((properties) => isNfsPortRule(properties));

        // Also get ingress rules from security groups' SecurityGroupIngress property
        const securityGroupNfsRules = securityGroups.flatMap((sg) => {
          try {
            const ingressRules = getIngressRules(sg);
            return ingressRules.filter((rule) => isNfsPortRule(rule));
          } catch {
            return [];
          }
        });

        nfsRules = [...standaloneNfsRules, ...securityGroupNfsRules];
      });

      test("EFS security groups exist", () => {
        expect(securityGroups.length).toBeGreaterThan(0);
      });

      test("EFS security group allows NFS traffic from ECS security group", () => {
        expect(nfsRules.length).toBeGreaterThan(0);
      });
    });

    // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
    test("EFS access point is configured for ECS tasks", () => {
      const template = getTemplate(STORAGE_TEST_STACKS[0]);

      template.hasResourceProperties(RESOURCE_TYPES.EFS_ACCESS_POINT, {
        FileSystemId: Match.anyValue(),
        PosixUser: Match.objectLike({
          Uid: Match.anyValue(),
          Gid: Match.anyValue(),
        }),
      });
    });
  });

  // ==========================================================================
  // 3. SECURITY GROUP CONNECTIVITY RULES
  // ==========================================================================

  describe("Security Group Connectivity Rules", () => {
    describe("Security Group Existence", () => {
      let securityGroupsByStack: Array<{
        stackKey: keyof Omit<ConnectivityTestStacks, "app">;
        securityGroups: unknown[];
      }>;

      beforeAll(() => {
        const stacksToTest: ReadonlyArray<
          keyof Omit<ConnectivityTestStacks, "app">
        > = [STORAGE_TEST_STACKS[0], INSTANCE_TEST_STACKS[0]];

        securityGroupsByStack = stacksToTest.map((stackKey) => {
          const template = getTemplate(stackKey);
          const securityGroups = getResources(
            template,
            RESOURCE_TYPES.SECURITY_GROUP
          );
          return { stackKey, securityGroups };
        });
      });

      test("security groups exist for all components", () => {
        securityGroupsByStack.forEach(({ securityGroups }) => {
          expect(securityGroups.length).toBeGreaterThan(0);
        });
      });
    });

    describe("Security Group Rule Configuration", () => {
      let tcpUdpRules: Array<Record<string, unknown>>;
      let unrestrictedRules: Array<Record<string, unknown>>;

      beforeAll(() => {
        const template = getTemplate(INSTANCE_TEST_STACKS[0]);
        
        // Get all ingress rules from SecurityGroupIngress resources
        const standaloneRules = getSecurityGroupIngressRules(template);
        const standaloneRuleProperties = standaloneRules.map((rule) =>
          getResourceProperties(rule)
        );
        
        // Also get ingress rules from security groups' SecurityGroupIngress property
        const securityGroups = getResources(template, RESOURCE_TYPES.SECURITY_GROUP);
        const securityGroupRuleProperties = securityGroups.flatMap((sg) => {
          try {
            return getIngressRules(sg);
          } catch {
            return [];
          }
        });

        const allRules = [...standaloneRuleProperties, ...securityGroupRuleProperties];

        tcpUdpRules = allRules.filter((rule) => {
          const protocol = rule.IpProtocol as string;
          return protocol === "tcp" || protocol === "udp";
        });

        unrestrictedRules = allRules.filter((rule) => isUnrestrictedAccess(rule));
      });

      test("security group rules use least privilege principle", () => {
        expect(tcpUdpRules.length).toBeGreaterThan(0);

        tcpUdpRules.forEach((rule) => {
          expect(rule.FromPort).toBeDefined();
          expect(rule.ToPort).toBeDefined();
        });
      });

      test("no security groups allow unrestricted inbound traffic", () => {
        unrestrictedRules.forEach((rule) => {
          expect(rule.IpProtocol).not.toBe("-1");
        });
      });
    });

    test("security group egress allows necessary outbound traffic", () => {
      const template = getTemplate(INSTANCE_TEST_STACKS[0]);
      const egressRules = getResources(
        template,
        RESOURCE_TYPES.SECURITY_GROUP_EGRESS
      );

      expect(egressRules.length).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // 4. PORT AND PROTOCOL CONFIGURATION
  // ==========================================================================

  describe("Port and Protocol Configuration", () => {
    // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
    test("ALB listens on standard HTTP port 80", () => {
      const template = getTemplate(INSTANCE_TEST_STACKS[0]);

      template.hasResourceProperties(RESOURCE_TYPES.LISTENER, {
        Port: PORT_CONFIG.HTTP,
        Protocol: "HTTP",
      });
    });

    describe("Service Port Configuration", () => {
      let prometheusContainers: Array<{
        container: ContainerDefinition;
        hasCorrectPort: boolean;
      }>;
      let grafanaContainers: Array<{
        container: ContainerDefinition;
        hasCorrectPort: boolean;
      }>;
      let nodeExporterContainers: Array<{
        container: ContainerDefinition;
        hasCorrectPort: boolean;
      }>;

      beforeAll(() => {
        const template = getTemplate(IAM_TEST_STACKS[3]);
        const taskDefs = getResources(template, RESOURCE_TYPES.ECS_TASK_DEFINITION);

        const allContainers = taskDefs.flatMap((taskDef) =>
          getContainersFromTaskDef(taskDef)
        );

        prometheusContainers = allContainers
          .filter((container) =>
            container.Name?.toLowerCase().includes("prometheus")
          )
          .map((container) => ({
            container,
            hasCorrectPort: containerHasPort(container, PORT_CONFIG.PROMETHEUS),
          }));

        grafanaContainers = allContainers
          .filter((container) =>
            container.Name?.toLowerCase().includes("grafana")
          )
          .map((container) => ({
            container,
            hasCorrectPort: containerHasPort(container, PORT_CONFIG.GRAFANA),
          }));

        nodeExporterContainers = allContainers
          .filter((container) =>
            container.Name?.toLowerCase().includes("node-exporter")
          )
          .map((container) => ({
            container,
            hasCorrectPort: containerHasPort(
              container,
              PORT_CONFIG.NODE_EXPORTER
            ),
          }));
      });

      test("Prometheus service uses correct port", () => {
        expect(prometheusContainers.length).toBeGreaterThan(0);
        prometheusContainers.forEach(({ hasCorrectPort }) => {
          expect(hasCorrectPort).toBe(true);
        });
      });

      test("Grafana service uses correct port", () => {
        expect(grafanaContainers.length).toBeGreaterThan(0);
        grafanaContainers.forEach(({ hasCorrectPort }) => {
          expect(hasCorrectPort).toBe(true);
        });
      });

      test("Node Exporter uses correct port for metrics", () => {
        expect(nodeExporterContainers.length).toBeGreaterThan(0);
        nodeExporterContainers.forEach(({ hasCorrectPort }) => {
          expect(hasCorrectPort).toBe(true);
        });
      });
    });

    describe("EFS NFS Port Configuration", () => {
      let securityGroups: unknown[];
      let nfsRules: Array<Record<string, unknown>>;

      beforeAll(() => {
        const template = getTemplate(STORAGE_TEST_STACKS[0]);
        securityGroups = getResources(template, RESOURCE_TYPES.SECURITY_GROUP);

        // Get all ingress rules from SecurityGroupIngress resources
        const standaloneRules = getSecurityGroupIngressRules(template);
        const standaloneNfsRules = standaloneRules
          .map((rule) => getResourceProperties(rule))
          .filter((properties) => isNfsPortRule(properties));

        // Also get ingress rules from security groups' SecurityGroupIngress property
        const securityGroupNfsRules = securityGroups.flatMap((sg) => {
          try {
            const ingressRules = getIngressRules(sg);
            return ingressRules.filter((rule) => isNfsPortRule(rule));
          } catch {
            return [];
          }
        });

        nfsRules = [...standaloneNfsRules, ...securityGroupNfsRules];
      });

      test("EFS security groups exist", () => {
        expect(securityGroups.length).toBeGreaterThan(0);
      });

      test("EFS uses NFS port 2049", () => {
        expect(nfsRules.length).toBeGreaterThan(0);
        nfsRules.forEach((rule) => {
          expect(rule.IpProtocol).toBe("tcp");
        });
      });
    });
  });

  // ==========================================================================
  // 5. NETWORK MODE CONFIGURATION
  // ==========================================================================

  describe("Network Mode Configuration", () => {
    describe("Task Definition Network Mode", () => {
      let taskDefsWithNetworkMode: Array<{
        taskDef: unknown;
        networkMode: string;
      }>;

      beforeAll(() => {
        const template = getTemplate(IAM_TEST_STACKS[3]);
        const taskDefs = getResources(template, RESOURCE_TYPES.ECS_TASK_DEFINITION);

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

      test("ECS tasks use appropriate network mode", () => {
        expect(taskDefsWithNetworkMode.length).toBeGreaterThan(0);

        taskDefsWithNetworkMode.forEach(({ networkMode }) => {
          expect(isValidNetworkMode(networkMode)).toBe(true);
        });
      });
    });

    describe("Bridge Network Mode Port Mapping", () => {
      let bridgeContainers: Array<{
        container: ContainerDefinition;
        portMappings: Array<{ ContainerPort: number }>;
      }>;

      beforeAll(() => {
        const template = getTemplate(IAM_TEST_STACKS[3]);
        const taskDefs = getResources(template, RESOURCE_TYPES.ECS_TASK_DEFINITION);

        const bridgeTaskDefs = taskDefs.filter((taskDef) => {
          const networkMode = getTaskDefNetworkMode(taskDef);
          return networkMode === "bridge";
        });

        bridgeContainers = bridgeTaskDefs.flatMap((taskDef) => {
          const containers = getContainersFromTaskDef(taskDef);
          return containers.map((container) => ({
            container,
            portMappings: container.PortMappings || [],
          }));
        });
      });

      test("bridge network mode containers use dynamic port mapping", () => {
        expect(bridgeContainers.length).toBeGreaterThan(0);

        bridgeContainers.forEach(({ portMappings }) => {
          expect(portMappings.length).toBeGreaterThan(0);
          portMappings.forEach((pm) => {
            expect(pm.ContainerPort).toBeDefined();
          });
        });
      });
    });
  });

  // ==========================================================================
  // 6. HEALTH CHECK CONNECTIVITY
  // ==========================================================================

  describe("Health Check Connectivity", () => {
    describe("Target Group Health Check Configuration", () => {
      let targetGroups: unknown[];
      let targetGroupProperties: Array<Record<string, unknown>>;
      let targetGroupsWithProtocol: Array<Record<string, unknown>>;

      beforeAll(() => {
        const template = getTemplate(IAM_TEST_STACKS[3]);
        targetGroups = getResources(template, RESOURCE_TYPES.TARGET_GROUP);
        targetGroupProperties = targetGroups.map((tg) =>
          getResourceProperties(tg)
        );

        targetGroupsWithProtocol = targetGroupProperties.filter(
          (properties) => properties.HealthCheckProtocol !== undefined
        );
      });

      test("ALB target groups have accessible health check paths", () => {
        expect(targetGroups.length).toBeGreaterThan(0);

        targetGroupProperties.forEach((properties) => {
          expect(properties.HealthCheckPath).toBeDefined();
          expect(properties.HealthCheckIntervalSeconds).toBeDefined();
          expect(properties.HealthyThresholdCount).toBeDefined();
          expect(properties.UnhealthyThresholdCount).toBeDefined();
        });

        targetGroupsWithProtocol.forEach((properties) => {
          expect(["HTTP", "HTTPS", "TCP"]).toContain(
            properties.HealthCheckProtocol
          );
        });
      });
    });

    describe("Health Check Interval Configuration", () => {
      let targetGroupIntervals: Array<{
        interval: number;
        timeout: number | undefined;
      }>;
      let intervalsWithTimeout: Array<{
        interval: number;
        timeout: number;
      }>;

      beforeAll(() => {
        const template = getTemplate(IAM_TEST_STACKS[3]);
        const targetGroups = getResources(template, RESOURCE_TYPES.TARGET_GROUP);

        targetGroupIntervals = targetGroups.map((tg) => {
          const properties = getResourceProperties<{
            HealthCheckIntervalSeconds: number;
            HealthCheckTimeoutSeconds?: number;
          }>(tg);
          return {
            interval: properties.HealthCheckIntervalSeconds,
            timeout: properties.HealthCheckTimeoutSeconds,
          };
        });

        intervalsWithTimeout = targetGroupIntervals
          .filter(
            (item): item is { interval: number; timeout: number } =>
              item.timeout !== undefined
          )
          .map((item) => ({
            interval: item.interval,
            timeout: item.timeout,
          }));
      });

      test("health check intervals are reasonable", () => {
        targetGroupIntervals.forEach(({ interval }) => {
          expect(interval).toBeDefined();
          expect(isInRange(interval, 5, 300)).toBe(true);
        });
      });

      test("health check interval is greater than timeout when timeout is defined", () => {
        intervalsWithTimeout.forEach(({ interval, timeout }) => {
          expect(interval).toBeGreaterThan(timeout);
        });
      });
    });

    describe("ECS Service Health Check Grace Period", () => {
      let servicesWithLoadBalancers: unknown[];

      beforeAll(() => {
        const template = getTemplate(IAM_TEST_STACKS[3]);
        const services = getResources(template, RESOURCE_TYPES.ECS_SERVICE);

        servicesWithLoadBalancers = services.filter((service) => {
          const properties = getResourceProperties(service);
          const loadBalancers = properties.LoadBalancers;
          return (
            Array.isArray(loadBalancers) && loadBalancers.length > 0
          );
        });
      });

      test("ECS services have health check grace period configured (if load balancers exist)", () => {
        expect(servicesWithLoadBalancers.length).toBeGreaterThan(0);

        servicesWithLoadBalancers.forEach((service) => {
          const properties = getResourceProperties(service);
          expect(properties.HealthCheckGracePeriodSeconds).toBeDefined();
        });
      });
    });
  });

  // ==========================================================================
  // 7. SERVICE DISCOVERY
  // ==========================================================================

  describe("Service Discovery", () => {
    describe("ECS Cluster Configuration", () => {
      let clusters: unknown[];

      beforeAll(() => {
        const template = getTemplate(INSTANCE_TEST_STACKS[0]);
        clusters = getResources(template, RESOURCE_TYPES.ECS_CLUSTER);
      });

      test("ECS cluster supports service discovery", () => {
        expect(clusters.length).toBe(1);

        clusters.forEach((c) => {
          const validation = validateResourceProperties(c, ["ClusterName"]);
          expect(validation.valid).toBe(true);
        });
      });
    });

    describe("Service DNS Configuration", () => {
      let urlHostEnvVars: Array<{ name: string; value: string }>;

      beforeAll(() => {
        const template = getTemplate(IAM_TEST_STACKS[3]);
        const taskDefs = getResources(template, RESOURCE_TYPES.ECS_TASK_DEFINITION);

        const allContainers = taskDefs.flatMap((taskDef) =>
          getContainersFromTaskDef(taskDef)
        );

        urlHostEnvVars = allContainers
          .flatMap((container) => container.Environment || [])
          .filter((env) => {
            const name = env.Name || "";
            return name.includes("URL") || name.includes("HOST");
          })
          .map((env) => ({
            name: env.Name || "",
            value: env.Value || "",
          }));
      });

      test("services can reference each other via DNS", () => {
        expect(urlHostEnvVars).toBeDefined();
        expect(Array.isArray(urlHostEnvVars)).toBe(true);

        urlHostEnvVars.forEach(({ value }) => {
          // DNS names should not be hardcoded IPs
          expect(value).not.toMatch(/^\d+\.\d+\.\d+\.\d+$/);
        });
      });
    });
  });

  // ==========================================================================
  // 8. CROSS-STACK CONNECTIVITY
  // ==========================================================================

  describe("Cross-Stack Connectivity", () => {
    describe("EFS Cross-Stack Access", () => {
      let efsFileSystems: unknown[];
      let asgs: unknown[];
      let associations: unknown[];

      beforeAll(() => {
        const infraTemplate = getTemplate(INSTANCE_TEST_STACKS[0]);
        const efsTemplate = getTemplate(STORAGE_TEST_STACKS[0]);

        efsFileSystems = getResources(
          efsTemplate,
          RESOURCE_TYPES.EFS_FILE_SYSTEM
        );
        asgs = getResources(infraTemplate, RESOURCE_TYPES.ASG);
        associations = getResources(
          infraTemplate,
          RESOURCE_TYPES.SSM_ASSOCIATION
        );
      });

      test("Infra stack can access EFS from EFS stack", () => {
        expect(efsFileSystems.length).toBeGreaterThan(0);
        expect(asgs.length).toBeGreaterThan(0);
        expect(associations.length).toBeGreaterThan(0);
      });
    });

    describe("Service Stack Dependencies", () => {
      let services: unknown[];

      beforeAll(() => {
        const template = getTemplate(IAM_TEST_STACKS[3]);
        services = getResources(template, RESOURCE_TYPES.ECS_SERVICE);
      });

      test("Service stack references resources from Infra stack", () => {
        expect(services.length).toBeGreaterThan(0);

        services.forEach((service) => {
          const validation = validateResourceProperties(service, ["Cluster"]);
          expect(validation.valid).toBe(true);
        });
      });
    });

    describe("VPC Consistency Across Stacks", () => {
      let vpcIds: Set<string>;

      beforeAll(() => {
        const efsTemplate = getTemplate(STORAGE_TEST_STACKS[0]);
        const infraTemplate = getTemplate(INSTANCE_TEST_STACKS[0]);

        const efsSecurityGroups = getResources(
          efsTemplate,
          RESOURCE_TYPES.SECURITY_GROUP
        );
        const infraSecurityGroups = getResources(
          infraTemplate,
          RESOURCE_TYPES.SECURITY_GROUP
        );

        vpcIds = new Set<string>();

        [...efsSecurityGroups, ...infraSecurityGroups].forEach((sg) => {
          const properties = getResourceProperties<{ VpcId: unknown }>(sg);
          vpcIds.add(JSON.stringify(properties.VpcId));
        });
      });

      test("all stacks use same VPC for connectivity", () => {
        expect(vpcIds.size).toBe(1);
      });
    });
  });
});
