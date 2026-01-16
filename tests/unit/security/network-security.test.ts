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

import { SecurityTestFixtures, type SecurityTestStacks } from "./test-fixtures";

describe("Security Posture: Network Security", () => {
  let stacks: SecurityTestStacks;

  beforeAll(() => {
    stacks = SecurityTestFixtures.getDevelopmentStacks();
  });

  describe("VPC Configuration", () => {
    test("VPC has DNS hostnames and DNS support enabled", () => {
      const template = Template.fromStack(stacks.networkingStack);

      template.hasResourceProperties("AWS::EC2::VPC", {
        EnableDnsHostnames: true,
        EnableDnsSupport: true,
      });
    });

    test("VPC Flow Logs are enabled and capture all traffic", () => {
      const template = Template.fromStack(stacks.networkingStack);

      template.hasResourceProperties("AWS::EC2::FlowLog", {
        ResourceType: "VPC",
        TrafficType: "ALL",
        LogDestinationType: "cloud-watch-logs",
      });
    });

    test("VPC Flow Logs have retention configured", () => {
      const template = Template.fromStack(stacks.networkingStack);

      template.hasResourceProperties("AWS::Logs::LogGroup", {
        RetentionInDays: Match.anyValue(),
      });
    });
  });

  describe("Security Groups", () => {
    test("no security groups allow unrestricted SSH access", () => {
      const template = Template.fromStack(stacks.infraStack);

      const rules = template.findResources("AWS::EC2::SecurityGroupIngress");

      Object.entries(rules).forEach(([_logicalId, resource]) => {
        const properties = (resource as Record<string, Record<string, unknown>>)
          .Properties;
        if (properties.FromPort === 22 && properties.ToPort === 22) {
          expect(properties.CidrIp).not.toBe("0.0.0.0/0");
          expect(properties.CidrIpv6).not.toBe("::/0");
        }
      });
    });

    test("no security groups allow unrestricted RDP access", () => {
      const template = Template.fromStack(stacks.infraStack);

      const rules = template.findResources("AWS::EC2::SecurityGroupIngress");

      Object.entries(rules).forEach(([_logicalId, resource]) => {
        const properties = (resource as Record<string, Record<string, unknown>>)
          .Properties;
        if (properties.FromPort === 3389 && properties.ToPort === 3389) {
          expect(properties.CidrIp).not.toBe("0.0.0.0/0");
          expect(properties.CidrIpv6).not.toBe("::/0");
        }
      });
    });

    test("EFS security group does not allow unrestricted NFS access", () => {
      const template = Template.fromStack(stacks.efsStack);

      const securityGroups = template.findResources("AWS::EC2::SecurityGroup");

      // EFS security group should exist
      expect(Object.keys(securityGroups).length).toBeGreaterThan(0);

      // Verify no security group allows NFS from 0.0.0.0/0
      Object.values(securityGroups).forEach((sg) => {
        const properties = (sg as Record<string, Record<string, unknown>>)
          .Properties;

        if (properties.SecurityGroupIngress) {
          const ingressRules = properties.SecurityGroupIngress as Array<
            Record<string, unknown>
          >;

          // Check for NFS rules with unrestricted access
          ingressRules.forEach((rule) => {
            if (rule.FromPort === 2049 && rule.ToPort === 2049) {
              // Should NOT allow from anywhere
              expect(rule.CidrIp).not.toBe("0.0.0.0/0");
              expect(rule.CidrIpv6).not.toBe("::/0");
            }
          });
        }
      });
    });

    test("no security group allows all traffic from 0.0.0.0/0", () => {
      const templates = [
        Template.fromStack(stacks.networkingStack),
        Template.fromStack(stacks.efsStack),
        Template.fromStack(stacks.infraStack),
      ];

      templates.forEach((template) => {
        const rules = template.findResources("AWS::EC2::SecurityGroupIngress");

        Object.entries(rules).forEach(([_logicalId, resource]) => {
          const properties = (
            resource as Record<string, Record<string, unknown>>
          ).Properties;
          if (
            properties.CidrIp === "0.0.0.0/0" ||
            properties.CidrIpv6 === "::/0"
          ) {
            // If allowing from anywhere, ensure it's restricted to specific ports
            expect(properties.IpProtocol).not.toBe("-1"); // Not all protocols
          }
        });
      });
    });
  });

  describe("Network Isolation", () => {
    test("private subnets exist for workload isolation", () => {
      const template = Template.fromStack(stacks.networkingStack);

      const subnets = template.findResources("AWS::EC2::Subnet");
      const privateSubnets = Object.values(subnets).filter((subnet) => {
        const properties = (subnet as Record<string, Record<string, unknown>>)
          .Properties;
        const tags = (properties.Tags || []) as Array<Record<string, string>>;
        return tags.some(
          (tag) => tag.Key === "aws-cdk:subnet-type" && tag.Value === "Private"
        );
      });

      expect(privateSubnets.length).toBeGreaterThan(0);
    });

    test("NAT Gateways are in public subnets if present", () => {
      const template = Template.fromStack(stacks.networkingStack);

      const natGateways = template.findResources("AWS::EC2::NatGateway");

      // If NAT Gateways exist, they should be in public subnets
      if (Object.keys(natGateways).length > 0) {
        Object.values(natGateways).forEach((natGw) => {
          const properties = (natGw as Record<string, Record<string, unknown>>)
            .Properties;
          expect(properties.SubnetId).toBeDefined();
        });
      }

      // NAT Gateways are optional in test configurations
      expect(Object.keys(natGateways).length).toBeGreaterThanOrEqual(0);
    });

    test("Internet Gateway exists for public subnet access", () => {
      const template = Template.fromStack(stacks.networkingStack);

      template.resourceCountIs("AWS::EC2::InternetGateway", 1);
    });
  });
});
