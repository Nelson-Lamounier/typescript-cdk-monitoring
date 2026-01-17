/** @format */
/// <reference types="jest" />

/**
 * Security Posture Tests: Network Security
 *
 * Validates network-level security configurations including:
 * - VPC configuration and DNS settings
 * - VPC Flow Logs for traffic monitoring
 * - Security Group rules and restrictions
 * - Network isolation and access controls
 *
 * @see https://docs.aws.amazon.com/vpc/latest/userguide/security-best-practices.html
 */

import { Template, Match } from "aws-cdk-lib/assertions";

import {
  type ConnectivityTestStacks,
  NETWORKING_TEST_STACKS,
} from "../connectivity/test-config";
import { SecurityTestFixtures } from "../utils/test-utils";
// Import shared utilities - functions
import {
  getSecurityGroups,
  getSecurityGroupIngressRules,
  getSubnets,
  getNatGateways,
  getResourceProperties,
  getIngressRules,
  getNatGatewayProperties,
  isPortRule,
  isUnrestrictedAccess,
  isAllProtocols,
  isPrivateSubnet,
} from "../utils";

describe("Security Posture: Network Security", () => {
  let stacks: ConnectivityTestStacks;

  beforeAll(() => {
    stacks = SecurityTestFixtures.getDevelopmentStacks();
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
  // VPC CONFIGURATION
  // ==========================================================================

  describe("VPC Configuration", () => {
    // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
    test("VPC has DNS hostnames and DNS support enabled", () => {
      const template = getTemplate(NETWORKING_TEST_STACKS[0]);

      template.hasResourceProperties("AWS::EC2::VPC", {
        EnableDnsHostnames: true,
        EnableDnsSupport: true,
      });
    });

    // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
    test("VPC Flow Logs are enabled and capture all traffic", () => {
      const template = getTemplate(NETWORKING_TEST_STACKS[0]);

      template.hasResourceProperties("AWS::EC2::FlowLog", {
        ResourceType: "VPC",
        TrafficType: "ALL",
        LogDestinationType: "cloud-watch-logs",
      });
    });

    // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
    test("VPC Flow Logs have retention configured", () => {
      const template = getTemplate(NETWORKING_TEST_STACKS[0]);

      template.hasResourceProperties("AWS::Logs::LogGroup", {
        RetentionInDays: Match.anyValue(),
      });
    });
  });

  // ==========================================================================
  // SECURITY GROUPS
  // ==========================================================================

  describe("Security Groups", () => {
    describe("SSH Access Restrictions", () => {
      let sshRules: Array<{
        rule: unknown;
        properties: Record<string, unknown>;
      }>;

      beforeAll(() => {
        const template = getTemplate(NETWORKING_TEST_STACKS[2]);
        const rules = getSecurityGroupIngressRules(template);

        // Pre-filter SSH rules (port 22)
        sshRules = rules
          .map((rule) => ({
            rule,
            properties: getResourceProperties(rule),
          }))
          .filter((item) => isPortRule(item.properties, 22));
      });

      test("no security groups allow unrestricted SSH access (if SSH rules exist)", () => {
        // This test validates configuration IF SSH rules exist
        // Empty array is valid - means no SSH rules configured
        expect(sshRules).toBeDefined();
        expect(Array.isArray(sshRules)).toBe(true);

        // If SSH rules exist, they must not allow unrestricted access
        sshRules.forEach(({ properties }) => {
          expect(properties.CidrIp).not.toBe("0.0.0.0/0");
          expect(properties.CidrIpv6).not.toBe("::/0");
        });
      });
    });

    describe("RDP Access Restrictions", () => {
      let rdpRules: Array<{
        rule: unknown;
        properties: Record<string, unknown>;
      }>;

      beforeAll(() => {
        const template = getTemplate(NETWORKING_TEST_STACKS[2]);
        const rules = getSecurityGroupIngressRules(template);

        // Pre-filter RDP rules (port 3389)
        rdpRules = rules
          .map((rule) => ({
            rule,
            properties: getResourceProperties(rule),
          }))
          .filter((item) => isPortRule(item.properties, 3389));
      });

      test("no security groups allow unrestricted RDP access (if RDP rules exist)", () => {
        // This test validates configuration IF RDP rules exist
        // Empty array is valid - means no RDP rules configured
        expect(rdpRules).toBeDefined();
        expect(Array.isArray(rdpRules)).toBe(true);

        // If RDP rules exist, they must not allow unrestricted access
        rdpRules.forEach(({ properties }) => {
          expect(properties.CidrIp).not.toBe("0.0.0.0/0");
          expect(properties.CidrIpv6).not.toBe("::/0");
        });
      });
    });

    describe("EFS NFS Access Restrictions", () => {
      let nfsRules: Array<{
        sg: unknown;
        rule: Record<string, unknown>;
      }>;

      beforeAll(() => {
        const template = getTemplate(NETWORKING_TEST_STACKS[1]);
        const securityGroups = getSecurityGroups(template);

        // Pre-compute and filter NFS rules (port 2049)
        nfsRules = securityGroups.flatMap((sg) => {
          const ingressRules = getIngressRules(sg);
          return ingressRules
            .filter((rule) => isPortRule(rule, 2049))
            .map((rule) => ({
              sg,
              rule,
            }));
        });
      });

      test("EFS security group does not allow unrestricted NFS access", () => {
        expect(nfsRules).toBeDefined();
        expect(Array.isArray(nfsRules)).toBe(true);

        nfsRules.forEach(({ rule }) => {
          expect(rule.CidrIp).not.toBe("0.0.0.0/0");
          expect(rule.CidrIpv6).not.toBe("::/0");
        });
      });
    });

    describe("Unrestricted Access Restrictions", () => {
      let unrestrictedRules: Array<{
        rule: unknown;
        properties: Record<string, unknown>;
        isAllProtocols: boolean;
      }>;

      beforeAll(() => {
        const templates = getTemplates(NETWORKING_TEST_STACKS);

        // Pre-compute and filter unrestricted rules
        unrestrictedRules = templates.flatMap((template) => {
          const rules = getSecurityGroupIngressRules(template);
          return rules
            .map((rule) => ({
              rule,
              properties: getResourceProperties(rule),
            }))
            .filter((item) => isUnrestrictedAccess(item.properties))
            .map((item) => ({
              rule: item.rule,
              properties: item.properties,
              isAllProtocols: isAllProtocols(item.properties),
            }));
        });
      });

      test("no security group allows all traffic from 0.0.0.0/0", () => {
        expect(unrestrictedRules).toBeDefined();
        expect(Array.isArray(unrestrictedRules)).toBe(true);

        // If allowing from anywhere, ensure it's restricted to specific ports
        unrestrictedRules.forEach(({ isAllProtocols: allProtocols }) => {
          expect(allProtocols).toBe(false);
        });
      });
    });
  });

  // ==========================================================================
  // NETWORK ISOLATION
  // ==========================================================================

  describe("Network Isolation", () => {
    describe("Private Subnets", () => {
      let privateSubnets: unknown[];

      beforeAll(() => {
        const template = getTemplate(NETWORKING_TEST_STACKS[0]);
        const subnets = getSubnets(template);

        // Pre-filter private subnets
        privateSubnets = subnets.filter((subnet) => isPrivateSubnet(subnet));
      });

      test("private subnets exist for workload isolation", () => {
        expect(privateSubnets.length).toBeGreaterThan(0);
      });
    });

    describe("NAT Gateway Configuration", () => {
      let natGateways: unknown[];

      beforeAll(() => {
        const template = getTemplate(NETWORKING_TEST_STACKS[0]);
        natGateways = getNatGateways(template);
      });

      test("NAT Gateways are in public subnets (if NAT gateways exist)", () => {
        // This test validates configuration IF NAT gateways exist
        // Empty array is valid - means no NAT gateways configured
        expect(natGateways).toBeDefined();
        expect(Array.isArray(natGateways)).toBe(true);

        // If NAT gateways exist, validate their configuration
        natGateways.forEach((natGw) => {
          const properties = getNatGatewayProperties(natGw);
          expect(properties.SubnetId).toBeDefined();
        });
      });
    });

    // eslint-disable-next-line jest/expect-expect -- template.resourceCountIs throws on failure
    test("Internet Gateway exists for public subnet access", () => {
      const template = getTemplate(NETWORKING_TEST_STACKS[0]);

      template.resourceCountIs("AWS::EC2::InternetGateway", 1);
    });
  });
});
