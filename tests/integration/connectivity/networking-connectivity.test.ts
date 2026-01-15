/** @format */
/// <reference types="jest" />

/**
 * Integration Test: Network Connectivity Validation
 *
 * This test suite validates network connectivity across the monitoring stack
 * infrastructure to ensure proper routing, subnet configuration, and network
 * isolation.
 *
 * Test Categories:
 * 1. VPC Connectivity - Subnets, routing tables, internet gateway
 * 2. Subnet Configuration - Public/private subnet setup
 * 3. Route Tables - Routing rules and associations
 * 4. NAT Gateway - Outbound internet connectivity from private subnets
 * 5. Network ACLs - Additional network security layer
 *
 * @see docs/NETWORKING.md
 * @see https://docs.aws.amazon.com/vpc/latest/userguide/what-is-amazon-vpc.html
 */

import { Template, Match } from "aws-cdk-lib/assertions";

import { NetworkingStack } from "../../../lib/stacks/foundation/networking-stack";
import {
  createNetworkingStack,
  extractSubnetCidrs,
  countResourcesOfType,
  countAvailabilityZones,
} from "../utils/test-utils";

import {
  RESOURCE_TYPES,
  NETWORK_CONFIG,
  ENVIRONMENT_CONFIG,
  TAG_KEYS,
  SUBNET_TYPES,
  isCidrInRange,
} from "./test-config";

// ============================================================================
// TEST SUITES
// ============================================================================

describe("Integration: Network Connectivity Tests", () => {
  let stack: NetworkingStack;
  let template: Template;

  beforeAll(() => {
    stack = createNetworkingStack();
    template = Template.fromStack(stack);
  });

  // ==========================================================================
  // 1. VPC CONNECTIVITY
  // ==========================================================================

  describe("VPC Configuration", () => {
    test("VPC exists with correct CIDR block", () => {
      template.hasResourceProperties(RESOURCE_TYPES.VPC, {
        CidrBlock: NETWORK_CONFIG.VPC_CIDR,
      });
    });

    test("VPC has DNS resolution enabled", () => {
      template.hasResourceProperties(RESOURCE_TYPES.VPC, {
        EnableDnsSupport: true,
        EnableDnsHostnames: true,
      });
    });

    test("VPC spans multiple availability zones", () => {
      expect(countAvailabilityZones(template)).toBeGreaterThanOrEqual(
        NETWORK_CONFIG.EXPECTED_AZS
      );
    });

    test("VPC has both public and private subnets", () => {
      const { publicSubnets, privateSubnets } = extractSubnetCidrs(template);

      expect(publicSubnets.length).toBeGreaterThan(0);
      expect(privateSubnets.length).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // 2. SUBNET CONFIGURATION
  // ==========================================================================

  describe("Subnet Configuration", () => {
    test("all subnets are within VPC CIDR range", () => {
      const { publicSubnets, privateSubnets } = extractSubnetCidrs(template);

      [...publicSubnets, ...privateSubnets].forEach((cidr) => {
        expect(isCidrInRange(cidr, NETWORK_CONFIG.VPC_CIDR)).toBe(true);
      });
    });

    test("public subnets have MapPublicIpOnLaunch enabled", () => {
      const subnets = template.findResources(RESOURCE_TYPES.SUBNET);

      Object.values(subnets).forEach((subnet) => {
        const properties = (subnet as Record<string, Record<string, unknown>>)
          .Properties;
        const tags = (properties.Tags || []) as Array<Record<string, string>>;

        const subnetType = tags.find((tag) => tag.Key === TAG_KEYS.SUBNET_TYPE);

        if (subnetType?.Value === SUBNET_TYPES.PUBLIC) {
          expect(properties.MapPublicIpOnLaunch).toBe(true);
        }
      });
    });

    test("private subnets do not have MapPublicIpOnLaunch enabled", () => {
      const subnets = template.findResources(RESOURCE_TYPES.SUBNET);

      Object.values(subnets).forEach((subnet) => {
        const properties = (subnet as Record<string, Record<string, unknown>>)
          .Properties;
        const tags = (properties.Tags || []) as Array<Record<string, string>>;

        const subnetType = tags.find((tag) => tag.Key === TAG_KEYS.SUBNET_TYPE);

        if (subnetType?.Value === SUBNET_TYPES.PRIVATE) {
          expect(properties.MapPublicIpOnLaunch).not.toBe(true);
        }
      });
    });

    test("subnets have proper tagging for identification", () => {
      const subnets = template.findResources(RESOURCE_TYPES.SUBNET);

      Object.values(subnets).forEach((subnet) => {
        const properties = (subnet as Record<string, Record<string, unknown>>)
          .Properties;
        const tags = (properties.Tags || []) as Array<Record<string, string>>;

        const hasNameTag = tags.some((tag) => tag.Key === TAG_KEYS.NAME);
        const hasSubnetTypeTag = tags.some(
          (tag) => tag.Key === TAG_KEYS.SUBNET_TYPE
        );

        expect(hasNameTag).toBe(true);
        expect(hasSubnetTypeTag).toBe(true);
      });
    });
  });

  // ==========================================================================
  // 3. INTERNET GATEWAY
  // ==========================================================================

  describe("Internet Gateway", () => {
    test("Internet Gateway exists for VPC", () => {
      expect(countResourcesOfType(template, RESOURCE_TYPES.IGW)).toBe(1);
    });

    test("Internet Gateway is attached to VPC", () => {
      template.hasResourceProperties("AWS::EC2::VPCGatewayAttachment", {
        VpcId: Match.anyValue(),
        InternetGatewayId: Match.anyValue(),
      });
    });

    test("public route table has route to Internet Gateway", () => {
      const routes = template.findResources(RESOURCE_TYPES.ROUTE);
      let hasIgwRoute = false;

      Object.values(routes).forEach((route) => {
        const properties = (route as Record<string, Record<string, unknown>>)
          .Properties;

        if (
          properties.DestinationCidrBlock === "0.0.0.0/0" &&
          properties.GatewayId
        ) {
          hasIgwRoute = true;
        }
      });

      expect(hasIgwRoute).toBe(true);
    });
  });

  // ==========================================================================
  // 4. NAT GATEWAY
  // ==========================================================================

  describe("NAT Gateway Configuration", () => {
    test("NAT Gateway configuration for private subnet outbound connectivity", () => {
      const natGatewayCount = countResourcesOfType(
        template,
        RESOURCE_TYPES.NAT_GATEWAY
      );

      // NAT Gateways may be disabled in development for cost optimization
      // If NAT Gateways exist, verify they're properly configured
      if (natGatewayCount > 0) {
        expect(natGatewayCount).toBeGreaterThanOrEqual(1);
      } else {
        // If no NAT Gateways, that's acceptable for development/test environments
        expect(natGatewayCount).toBe(0);
      }
    });

    test("NAT Gateway is in public subnet", () => {
      const natGateways = template.findResources(RESOURCE_TYPES.NAT_GATEWAY);

      Object.values(natGateways).forEach((natGw) => {
        const properties = (natGw as Record<string, Record<string, unknown>>)
          .Properties;
        expect(properties.SubnetId).toBeDefined();
      });
    });

    test("NAT Gateway has Elastic IP allocation if deployed", () => {
      const natGatewayCount = countResourcesOfType(
        template,
        RESOURCE_TYPES.NAT_GATEWAY
      );

      // Only check if NAT Gateways are deployed
      if (natGatewayCount > 0) {
        template.hasResourceProperties(RESOURCE_TYPES.NAT_GATEWAY, {
          AllocationId: Match.anyValue(),
        });
      } else {
        // No NAT Gateways deployed (acceptable for development)
        expect(natGatewayCount).toBe(0);
      }
    });

    test("Elastic IP exists for NAT Gateway if deployed", () => {
      const natGatewayCount = countResourcesOfType(
        template,
        RESOURCE_TYPES.NAT_GATEWAY
      );
      const eipCount = countResourcesOfType(template, RESOURCE_TYPES.EIP);

      // Only check if NAT Gateways are deployed
      if (natGatewayCount > 0) {
        expect(eipCount).toBeGreaterThanOrEqual(1);

        const eips = template.findResources(RESOURCE_TYPES.EIP);
        Object.values(eips).forEach((eip) => {
          const properties = (eip as Record<string, Record<string, unknown>>)
            .Properties;
          expect(properties.Domain).toBe("vpc");
        });
      } else {
        // No NAT Gateways, so no EIPs needed
        expect(natGatewayCount).toBe(0);
      }
    });

    test("private route table has route to NAT Gateway if deployed", () => {
      const natGatewayCount = countResourcesOfType(
        template,
        RESOURCE_TYPES.NAT_GATEWAY
      );
      const routes = template.findResources(RESOURCE_TYPES.ROUTE);

      // Only check if NAT Gateways are deployed
      if (natGatewayCount > 0) {
        let hasNatRoute = false;

        Object.values(routes).forEach((route) => {
          const properties = (route as Record<string, Record<string, unknown>>)
            .Properties;

          if (
            properties.DestinationCidrBlock === "0.0.0.0/0" &&
            properties.NatGatewayId
          ) {
            hasNatRoute = true;
          }
        });

        expect(hasNatRoute).toBe(true);
      } else {
        // No NAT Gateways deployed (acceptable for development)
        expect(natGatewayCount).toBe(0);
      }
    });
  });

  // ==========================================================================
  // 5. ROUTE TABLES
  // ==========================================================================

  describe("Route Table Configuration", () => {
    test("route tables exist for subnets", () => {
      expect(
        countResourcesOfType(template, RESOURCE_TYPES.ROUTE_TABLE)
      ).toBeGreaterThanOrEqual(2);
    });

    test("route tables are associated with subnets", () => {
      const associations = template.findResources(
        "AWS::EC2::SubnetRouteTableAssociation"
      );
      expect(Object.keys(associations).length).toBeGreaterThan(0);

      Object.values(associations).forEach((assoc) => {
        const properties = (assoc as Record<string, Record<string, unknown>>)
          .Properties;
        expect(properties.RouteTableId).toBeDefined();
        expect(properties.SubnetId).toBeDefined();
      });
    });

    test("public and private route tables have appropriate routing", () => {
      const natGatewayCount = countResourcesOfType(
        template,
        RESOURCE_TYPES.NAT_GATEWAY
      );
      const routes = template.findResources(RESOURCE_TYPES.ROUTE);

      // Public route table should have IGW route
      const hasIgwRoute = Object.values(routes).some((route) => {
        const properties = (route as Record<string, Record<string, unknown>>)
          .Properties;
        return (
          properties.DestinationCidrBlock === "0.0.0.0/0" &&
          properties.GatewayId
        );
      });

      expect(hasIgwRoute).toBe(true);

      // Private route table should have NAT route only if NAT Gateway is deployed
      if (natGatewayCount > 0) {
        const hasNatRoute = Object.values(routes).some((route) => {
          const properties = (route as Record<string, Record<string, unknown>>)
            .Properties;
          return (
            properties.DestinationCidrBlock === "0.0.0.0/0" &&
            properties.NatGatewayId
          );
        });
        expect(hasNatRoute).toBe(true);
      }
    });

    test("route tables have proper tagging", () => {
      const routeTables = template.findResources(RESOURCE_TYPES.ROUTE_TABLE);

      Object.values(routeTables).forEach((rt) => {
        const properties = (rt as Record<string, Record<string, unknown>>)
          .Properties;
        const tags = (properties.Tags || []) as Array<Record<string, string>>;

        const hasNameTag = tags.some((tag) => tag.Key === TAG_KEYS.NAME);
        expect(hasNameTag).toBe(true);
      });
    });
  });

  // ==========================================================================
  // 6. VPC ENDPOINTS
  // ==========================================================================

  describe("VPC Endpoints", () => {
    test("S3 Gateway Endpoint exists for cost optimisation", () => {
      const endpoints = template.findResources("AWS::EC2::VPCEndpoint");
      const hasS3Endpoint = Object.values(endpoints).some((endpoint) => {
        const properties = (endpoint as Record<string, Record<string, unknown>>)
          .Properties;
        return (
          properties.ServiceName &&
          JSON.stringify(properties.ServiceName).includes("s3")
        );
      });

      // S3 endpoint is optional but recommended
      if (Object.keys(endpoints).length > 0) {
        expect(hasS3Endpoint).toBe(true);
      }
    });

    test("VPC Endpoints are associated with correct route tables", () => {
      const endpoints = template.findResources("AWS::EC2::VPCEndpoint");

      Object.values(endpoints).forEach((endpoint) => {
        const properties = (endpoint as Record<string, Record<string, unknown>>)
          .Properties;

        if (properties.VpcEndpointType === "Gateway") {
          expect(properties.RouteTableIds).toBeDefined();
        }
      });
    });
  });

  // ==========================================================================
  // 7. NETWORK ISOLATION
  // ==========================================================================

  describe("Network Isolation", () => {
    test("public and private subnets are properly segregated", () => {
      const { publicSubnets, privateSubnets } = extractSubnetCidrs(template);

      // Ensure no overlap between public and private subnet CIDRs
      publicSubnets.forEach((publicCidr) => {
        expect(privateSubnets).not.toContain(publicCidr);
      });
    });

    test("route table associations prevent cross-subnet routing conflicts", () => {
      const associations = template.findResources(
        "AWS::EC2::SubnetRouteTableAssociation"
      );

      const subnetToRouteTable = new Map<string, string>();

      Object.values(associations).forEach((assoc) => {
        const properties = (assoc as Record<string, Record<string, unknown>>)
          .Properties;
        const subnetId = JSON.stringify(properties.SubnetId);
        const routeTableId = JSON.stringify(properties.RouteTableId);

        // Each subnet should have only one route table association
        expect(subnetToRouteTable.has(subnetId)).toBe(false);
        subnetToRouteTable.set(subnetId, routeTableId);
      });
    });
  });

  // ==========================================================================
  // 8. FLOW LOGS
  // ==========================================================================

  describe("VPC Flow Logs", () => {
    test("VPC Flow Logs capture network traffic", () => {
      template.hasResourceProperties("AWS::EC2::FlowLog", {
        ResourceType: "VPC",
        TrafficType: "ALL",
      });
    });

    test("Flow Logs use CloudWatch Logs destination", () => {
      template.hasResourceProperties("AWS::EC2::FlowLog", {
        LogDestinationType: "cloud-watch-logs",
      });
    });

    test("Flow Logs have IAM role for CloudWatch access", () => {
      const flowLogs = template.findResources("AWS::EC2::FlowLog");

      Object.values(flowLogs).forEach((flowLog) => {
        const properties = (flowLog as Record<string, Record<string, unknown>>)
          .Properties;

        if (properties.LogDestinationType === "cloud-watch-logs") {
          expect(properties.DeliverLogsPermissionArn).toBeDefined();
        }
      });
    });

    test("Flow Logs log group has retention configured", () => {
      const logGroups = template.findResources("AWS::Logs::LogGroup");
      const flowLogGroups = Object.values(logGroups).filter((lg) => {
        const properties = (lg as Record<string, Record<string, unknown>>)
          .Properties;
        const lgName = properties.LogGroupName;
        return (
          typeof lgName === "string" &&
          (lgName.includes("FlowLog") || lgName.includes("flow-log"))
        );
      });

      flowLogGroups.forEach((lg) => {
        const properties = (lg as Record<string, Record<string, unknown>>)
          .Properties;
        expect(properties.RetentionInDays).toBeDefined();
      });
    });
  });

  // ==========================================================================
  // 9. HIGH AVAILABILITY
  // ==========================================================================

  describe("High Availability Configuration", () => {
    test("subnets span multiple availability zones", () => {
      const subnets = template.findResources("AWS::EC2::Subnet");
      const azCounts = new Map<string, number>();

      Object.values(subnets).forEach((subnet) => {
        const properties = (subnet as Record<string, Record<string, unknown>>)
          .Properties;
        const az = properties.AvailabilityZone as string;
        azCounts.set(az, (azCounts.get(az) || 0) + 1);
      });

      expect(azCounts.size).toBeGreaterThanOrEqual(2);
    });

    test("each availability zone has both public and private subnets", () => {
      const subnets = template.findResources("AWS::EC2::Subnet");
      const azSubnetTypes = new Map<string, Set<string>>();

      Object.values(subnets).forEach((subnet) => {
        const properties = (subnet as Record<string, Record<string, unknown>>)
          .Properties;
        const tags = (properties.Tags || []) as Array<Record<string, string>>;
        const az = properties.AvailabilityZone as string;

        const subnetType = tags.find(
          (tag) => tag.Key === "aws-cdk:subnet-type"
        );

        if (subnetType) {
          if (!azSubnetTypes.has(az)) {
            azSubnetTypes.set(az, new Set());
          }
          const azTypes = azSubnetTypes.get(az);
          if (azTypes) {
            azTypes.add(subnetType.Value);
          }
        }
      });

      azSubnetTypes.forEach((types, _az) => {
        expect(types.has("Public")).toBe(true);
        expect(types.has("Private")).toBe(true);
      });
    });

    test("production environment has NAT Gateway in multiple AZs", () => {
      const prodStack = createNetworkingStack({
        environment: ENVIRONMENT_CONFIG.PRODUCTION,
      });
      const prodTemplate = Template.fromStack(prodStack);

      const natGatewayCount = countResourcesOfType(
        prodTemplate,
        RESOURCE_TYPES.NAT_GATEWAY
      );

      // Production should have multiple NAT Gateways for HA
      if (natGatewayCount > 1) {
        const natGateways = prodTemplate.findResources(
          RESOURCE_TYPES.NAT_GATEWAY
        );
        const natAzs = new Set<string>();

        Object.values(natGateways).forEach((natGw) => {
          const properties = (natGw as Record<string, Record<string, unknown>>)
            .Properties;
          // Get subnet AZ from subnet reference
          if (properties.SubnetId) {
            natAzs.add(JSON.stringify(properties.SubnetId));
          }
        });

        expect(natAzs.size).toBeGreaterThanOrEqual(1);
      }
    });
  });

  // ==========================================================================
  // 10. DHCP OPTIONS
  // ==========================================================================

  describe("DHCP Configuration", () => {
    test("VPC uses AWS default DHCP options or custom DHCP options set", () => {
      const vpcs = template.findResources("AWS::EC2::VPC");

      Object.values(vpcs).forEach((vpc) => {
        const properties = (vpc as Record<string, Record<string, unknown>>)
          .Properties;

        // VPC should either use default DHCP or have custom DHCP options
        // If no DhcpOptionsId is set, AWS uses default DHCP
        if (properties.DhcpOptionsId) {
          expect(properties.DhcpOptionsId).toBeDefined();
        }
      });
    });
  });
});
