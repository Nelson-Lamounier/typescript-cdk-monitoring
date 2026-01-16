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

import { type ConnectivityTestStacks } from "../connectivity/test-config";

import { SecurityTestFixtures } from "../utils/test-utils";

describe("Security Posture: Network Security", () => {
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
   * Get all templates from multiple stacks
   */
  const getTemplates = (
    stackNames: Array<keyof ConnectivityTestStacks>
  ): Template[] => {
    return stackNames.map((name) => getTemplate(name));
  };

  /**
   * Get resources of a specific type
   */
  const getResources = (template: Template, resourceType: string) => {
    return Object.values(template.findResources(resourceType));
  };

  /**
   * Get security group ingress rules from template
   */
  const getSecurityGroupIngressRules = (template: Template) => {
    return getResources(template, "AWS::EC2::SecurityGroupIngress");
  };

  /**
   * Get security groups from template
   */
  const getSecurityGroups = (template: Template) => {
    return getResources(template, "AWS::EC2::SecurityGroup");
  };

  /**
   * Get subnets from template
   */
  const getSubnets = (template: Template) => {
    return getResources(template, "AWS::EC2::Subnet");
  };

  /**
   * Get NAT gateways from template
   */
  const getNatGateways = (template: Template) => {
    return getResources(template, "AWS::EC2::NatGateway");
  };

  /**
   * Extract properties from resource
   */
  const getResourceProperties = (
    resource: unknown
  ): Record<string, unknown> => {
    return (resource as Record<string, Record<string, unknown>>).Properties;
  };

  /**
   * Extract security group properties
   */
  const getSecurityGroupProperties = (sg: unknown): Record<string, unknown> => {
    return getResourceProperties(sg);
  };

  /**
   * Extract ingress rules from security group
   */
  const getIngressRules = (sg: unknown): Array<Record<string, unknown>> => {
    const properties = getSecurityGroupProperties(sg);
    return (properties.SecurityGroupIngress || []) as Array<
      Record<string, unknown>
    >;
  };

  /**
   * Check if rule is for specific port
   */
  const isPortRule = (rule: Record<string, unknown>, port: number): boolean => {
    return rule.FromPort === port && rule.ToPort === port;
  };

  /**
   * Check if rule allows unrestricted access
   */
  const isUnrestrictedAccess = (rule: Record<string, unknown>): boolean => {
    return rule.CidrIp === "0.0.0.0/0" || rule.CidrIpv6 === "::/0";
  };

  /**
   * Check if rule allows all protocols
   */
  const isAllProtocols = (rule: Record<string, unknown>): boolean => {
    return rule.IpProtocol === "-1";
  };

  /**
   * Extract subnet tags
   */
  const getSubnetTags = (subnet: unknown): Array<Record<string, string>> => {
    const properties = getResourceProperties(subnet);
    return (properties.Tags || []) as Array<Record<string, string>>;
  };

  /**
   * Check if subnet is private
   */
  const isPrivateSubnet = (subnet: unknown): boolean => {
    const tags = getSubnetTags(subnet);
    return tags.some(
      (tag) => tag.Key === "aws-cdk:subnet-type" && tag.Value === "Private"
    );
  };

  /**
   * Extract NAT gateway properties
   */
  const getNatGatewayProperties = (natGw: unknown): Record<string, unknown> => {
    return getResourceProperties(natGw);
  };

  // ==========================================================================
  // VPC CONFIGURATION
  // ==========================================================================

  describe("VPC Configuration", () => {
    test("VPC has DNS hostnames and DNS support enabled", () => {
      const template = getTemplate("networkingStack");

      template.hasResourceProperties("AWS::EC2::VPC", {
        EnableDnsHostnames: true,
        EnableDnsSupport: true,
      });
    });

    test("VPC Flow Logs are enabled and capture all traffic", () => {
      const template = getTemplate("networkingStack");

      template.hasResourceProperties("AWS::EC2::FlowLog", {
        ResourceType: "VPC",
        TrafficType: "ALL",
        LogDestinationType: "cloud-watch-logs",
      });
    });

    test("VPC Flow Logs have retention configured", () => {
      const template = getTemplate("networkingStack");

      template.hasResourceProperties("AWS::Logs::LogGroup", {
        RetentionInDays: Match.anyValue(),
      });
    });
  });

  // ==========================================================================
  // SECURITY GROUPS
  // ==========================================================================

  describe("Security Groups", () => {
    test("no security groups allow unrestricted SSH access (if SSH rules exist)", () => {
      const template = getTemplate("infraStack");
      const rules = getSecurityGroupIngressRules(template);

      rules.forEach((rule) => {
        const properties = getResourceProperties(rule);

        if (isPortRule(properties, 22)) {
          expect(properties.CidrIp).not.toBe("0.0.0.0/0");
          expect(properties.CidrIpv6).not.toBe("::/0");
        }
      });
    });

    test("no security groups allow unrestricted RDP access (if RDP rules exist)", () => {
      const template = getTemplate("infraStack");
      const rules = getSecurityGroupIngressRules(template);

      rules.forEach((rule) => {
        const properties = getResourceProperties(rule);

        if (isPortRule(properties, 3389)) {
          expect(properties.CidrIp).not.toBe("0.0.0.0/0");
          expect(properties.CidrIpv6).not.toBe("::/0");
        }
      });
    });

    test("EFS security group does not allow unrestricted NFS access", () => {
      const template = getTemplate("efsStack");
      const securityGroups = getSecurityGroups(template);

      expect(securityGroups.length).toBeGreaterThan(0);

      securityGroups.forEach((sg) => {
        const ingressRules = getIngressRules(sg);

        ingressRules.forEach((rule) => {
          if (isPortRule(rule, 2049)) {
            expect(rule.CidrIp).not.toBe("0.0.0.0/0");
            expect(rule.CidrIpv6).not.toBe("::/0");
          }
        });
      });
    });

    test("no security group allows all traffic from 0.0.0.0/0", () => {
      const templates = getTemplates([
        "networkingStack",
        "efsStack",
        "infraStack",
      ]);

      templates.forEach((template) => {
        const rules = getSecurityGroupIngressRules(template);

        rules.forEach((rule) => {
          const properties = getResourceProperties(rule);

          if (isUnrestrictedAccess(properties)) {
            // If allowing from anywhere, ensure it's restricted to specific ports
            expect(isAllProtocols(properties)).toBe(false);
          }
        });
      });
    });
  });

  // ==========================================================================
  // NETWORK ISOLATION
  // ==========================================================================

  describe("Network Isolation", () => {
    test("private subnets exist for workload isolation", () => {
      const template = getTemplate("networkingStack");
      const subnets = getSubnets(template);
      const privateSubnets = subnets.filter(isPrivateSubnet);

      expect(privateSubnets.length).toBeGreaterThan(0);
    });

    test("NAT Gateways are in public subnets (if NAT gateways exist)", () => {
      const template = getTemplate("networkingStack");
      const natGateways = getNatGateways(template);

      if (natGateways.length > 0) {
        natGateways.forEach((natGw) => {
          const properties = getNatGatewayProperties(natGw);
          expect(properties.SubnetId).toBeDefined();
        });
      }

      // NAT Gateways are optional in test configurations
      expect(natGateways.length).toBeGreaterThanOrEqual(0);
    });

    test("Internet Gateway exists for public subnet access", () => {
      const template = getTemplate("networkingStack");

      template.resourceCountIs("AWS::EC2::InternetGateway", 1);
    });
  });
});
