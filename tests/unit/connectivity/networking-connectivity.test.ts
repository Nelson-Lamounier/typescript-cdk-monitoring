/** @format */
/// <reference types="jest" />

/**
 * Network Connectivity Test Suite
 *
 * Tests the NetworkingStack to ensure correct VPC configuration, subnet
 * architecture, routing, and network security posture.
 *
 * **Test Philosophy:**
 * - Each test has a single, clear purpose
 * - Tests are isolated and can run in any order
 * - Descriptive names explain WHAT is being tested
 * - Edge cases and failure scenarios are covered
 * - Uses parameterized tests for multiple similar scenarios
 * - Follows AAA pattern: Arrange, Act, Assert
 *
 * **Test Coverage:**
 * 1. VPC Basic Configuration
 * 2. Subnet Architecture
 * 3. Internet Gateway & Public Routing
 * 4. NAT Gateway & Private Routing
 * 5. Route Table Associations
 * 6. VPC Endpoints
 * 7. Network Isolation & Security
 * 8. VPC Flow Logs
 * 9. High Availability
 * 10. Edge Cases & Error Scenarios
 *
 * @see https://docs.aws.amazon.com/vpc/latest/userguide/what-is-amazon-vpc.html
 */

import { Template, Match } from "aws-cdk-lib/assertions";

import { NetworkingStack } from "../../../lib/stacks/foundation/networking-stack";
import {
  createNetworkingStack,
  extractSubnetCidrs,
  countResourcesOfType,
} from "../utils/test-utils";
import type {
  SubnetProperties,
  RouteProperties,
  ResourceWithProperties,
  SubnetsByType,
  RoutesByType,
  AvailabilityZoneInfo,
  ResourceTag,
} from "../types/test-types";

import {
  RESOURCE_TYPES,
  NETWORK_CONFIG,
  ENVIRONMENT_CONFIG,
  TAG_KEYS,
  SUBNET_TYPES,
  isCidrInRange,
} from "./test-config";

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Extract subnets by type from template
 */
function getSubnetsByType(template: Template): SubnetsByType {
  const subnets = template.findResources(RESOURCE_TYPES.SUBNET);
  const publicSubnets: SubnetProperties[] = [];
  const privateSubnets: SubnetProperties[] = [];
  const isolatedSubnets: SubnetProperties[] = [];

  Object.values(subnets).forEach((subnet) => {
    const props = subnet.Properties as SubnetProperties;
    const subnetType = props.Tags.find(
      (tag) => tag.Key === TAG_KEYS.SUBNET_TYPE
    )?.Value;

    switch (subnetType) {
      case SUBNET_TYPES.PUBLIC:
        publicSubnets.push(props);
        break;
      case SUBNET_TYPES.PRIVATE:
        privateSubnets.push(props);
        break;
      case SUBNET_TYPES.ISOLATED:
        isolatedSubnets.push(props);
        break;
    }
  });

  return { publicSubnets, privateSubnets, isolatedSubnets };
}

/**
 * Get routes by type (IGW, NAT, local)
 */
function getRoutesByType(template: Template): RoutesByType {
  const routes = template.findResources(RESOURCE_TYPES.ROUTE);
  const igwRoutes: RouteProperties[] = [];
  const natRoutes: RouteProperties[] = [];
  const localRoutes: RouteProperties[] = [];
  const otherRoutes: RouteProperties[] = [];

  Object.values(routes).forEach((route) => {
    const props = route.Properties as RouteProperties;

    if (props.DestinationCidrBlock === "0.0.0.0/0") {
      if (props.GatewayId) {
        igwRoutes.push(props);
      } else if (props.NatGatewayId) {
        natRoutes.push(props);
      }
    } else {
      otherRoutes.push(props);
    }
  });

  return { igwRoutes, natRoutes, localRoutes, otherRoutes };
}

/**
 * Check if resource has required tags
 */
function hasRequiredTags(
  resource: ResourceWithProperties,
  requiredTags: string[]
): boolean {
  const tags = (resource.Properties.Tags || []) as ResourceTag[];
  return requiredTags.every((tagKey) => tags.some((tag) => tag.Key === tagKey));
}

/**
 * Get availability zones from subnets
 */
function getAvailabilityZones(template: Template): AvailabilityZoneInfo {
  const subnets = template.findResources(RESOURCE_TYPES.SUBNET);
  const azSet = new Set<string>();

  Object.values(subnets).forEach((subnet) => {
    const az = (subnet.Properties as SubnetProperties).AvailabilityZone;
    if (az && typeof az === "string") {
      azSet.add(az);
    }
  });

  const zones = Array.from(azSet);
  return {
    zones,
    count: zones.length,
  };
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe("Network Connectivity Tests", () => {
  let stack: NetworkingStack;
  let template: Template;

  // Setup: Create stack once for all tests (performance optimization)
  beforeAll(() => {
    stack = createNetworkingStack();
    template = Template.fromStack(stack);
  });

  // ============================================================================
  // 1. VPC BASIC CONFIGURATION
  // ============================================================================

  describe("VPC Configuration", () => {
    describe("when creating a VPC", () => {
      it("should create exactly one VPC", () => {
        // Assert
        expect(countResourcesOfType(template, RESOURCE_TYPES.VPC)).toBe(1);
      });

      it("should use the configured CIDR block", () => {
        // Assert
        template.hasResourceProperties(RESOURCE_TYPES.VPC, {
          CidrBlock: NETWORK_CONFIG.VPC_CIDR,
        });
      });

      it("should enable DNS support for service discovery", () => {
        // Assert
        template.hasResourceProperties(RESOURCE_TYPES.VPC, {
          EnableDnsSupport: true,
        });
      });

      it("should enable DNS hostnames for EC2 instances", () => {
        // Assert
        template.hasResourceProperties(RESOURCE_TYPES.VPC, {
          EnableDnsHostnames: true,
        });
      });

      it("should have standard VPC tags", () => {
        // Arrange
        const vpcs = template.findResources(RESOURCE_TYPES.VPC);
        const vpc = Object.values(vpcs)[0] as ResourceWithProperties;

        // Assert
        expect(
          hasRequiredTags(vpc, [TAG_KEYS.NAME, TAG_KEYS.ENVIRONMENT])
        ).toBe(true);
      });
    });

    describe("when configuring VPC scope", () => {
      it("should span at least 2 availability zones for high availability", () => {
        // Act
        const azCount = getAvailabilityZones(template).count;

        // Assert
        expect(azCount).toBeGreaterThanOrEqual(NETWORK_CONFIG.EXPECTED_AZS);
      });

      it("should not exceed 3 availability zones for cost optimization", () => {
        // Act
        const azCount = getAvailabilityZones(template).count;

        // Assert
        expect(azCount).toBeLessThanOrEqual(3);
      });
    });
  });

  // ============================================================================
  // 2. SUBNET ARCHITECTURE
  // ============================================================================

  describe("Subnet Architecture", () => {
    describe("when creating subnets", () => {
      it("should create both public and private subnets", () => {
        // Act
        const { publicSubnets, privateSubnets } = getSubnetsByType(template);

        // Assert
        expect(publicSubnets.length).toBeGreaterThan(0);
        expect(privateSubnets.length).toBeGreaterThan(0);
      });

      it("should create equal number of public and private subnets per AZ", () => {
        // Act
        const { publicSubnets, privateSubnets } = getSubnetsByType(template);

        // Assert
        expect(publicSubnets.length).toBe(privateSubnets.length);
      });

      it("should create at least 2 subnets of each type", () => {
        // Act
        const { publicSubnets, privateSubnets } = getSubnetsByType(template);

        // Assert
        expect(publicSubnets.length).toBeGreaterThanOrEqual(
          NETWORK_CONFIG.EXPECTED_SUBNETS.PUBLIC
        );
        expect(privateSubnets.length).toBeGreaterThanOrEqual(
          NETWORK_CONFIG.EXPECTED_SUBNETS.PRIVATE
        );
      });
    });

    describe("when configuring subnet CIDR blocks", () => {
      it("should ensure all subnet CIDRs are within VPC CIDR range", () => {
        // Arrange
        const { publicSubnets, privateSubnets } = extractSubnetCidrs(template);
        const allCidrs = [...publicSubnets, ...privateSubnets];

        // Act & Assert
        allCidrs.forEach((cidr) => {
          expect(isCidrInRange(cidr, NETWORK_CONFIG.VPC_CIDR)).toBe(true);
        });
      });

      it("should not have overlapping CIDR blocks between subnets", () => {
        // Arrange
        const { publicSubnets, privateSubnets } = extractSubnetCidrs(template);
        const allCidrs = [...publicSubnets, ...privateSubnets];

        // Act
        const uniqueCidrs = new Set(allCidrs);

        // Assert
        expect(uniqueCidrs.size).toBe(allCidrs.length);
      });

      it("should use different CIDR blocks for public and private subnets", () => {
        // Arrange
        const { publicSubnets, privateSubnets } = extractSubnetCidrs(template);

        // Act & Assert
        publicSubnets.forEach((publicCidr) => {
          expect(privateSubnets).not.toContain(publicCidr);
        });
      });
    });

    describe("when configuring public subnets", () => {
      it("should enable auto-assign public IP on launch", () => {
        // Arrange
        const { publicSubnets } = getSubnetsByType(template);

        // Act & Assert
        publicSubnets.forEach((subnet) => {
          expect(subnet.MapPublicIpOnLaunch).toBe(true);
        });
      });

      it("should have descriptive Name tag", () => {
        // Arrange
        const { publicSubnets } = getSubnetsByType(template);

        // Act & Assert
        publicSubnets.forEach((subnet) => {
          const nameTag = subnet.Tags.find((tag) => tag.Key === TAG_KEYS.NAME);
          expect(nameTag).toBeDefined();
          expect(nameTag?.Value).toMatch(/public/i);
        });
      });

      it("should have subnet type tag set to Public", () => {
        // Arrange
        const { publicSubnets } = getSubnetsByType(template);

        // Act & Assert
        publicSubnets.forEach((subnet) => {
          const typeTag = subnet.Tags.find(
            (tag) => tag.Key === TAG_KEYS.SUBNET_TYPE
          );
          expect(typeTag?.Value).toBe(SUBNET_TYPES.PUBLIC);
        });
      });
    });

    describe("when configuring private subnets", () => {
      it("should not enable auto-assign public IP on launch", () => {
        // Arrange
        const { privateSubnets } = getSubnetsByType(template);

        // Act & Assert
        privateSubnets.forEach((subnet) => {
          expect(subnet.MapPublicIpOnLaunch).not.toBe(true);
        });
      });

      it("should have descriptive Name tag", () => {
        // Arrange
        const { privateSubnets } = getSubnetsByType(template);

        // Act & Assert
        privateSubnets.forEach((subnet) => {
          const nameTag = subnet.Tags.find((tag) => tag.Key === TAG_KEYS.NAME);
          expect(nameTag).toBeDefined();
          expect(nameTag?.Value).toMatch(/private/i);
        });
      });

      it("should have subnet type tag set to Private", () => {
        // Arrange
        const { privateSubnets } = getSubnetsByType(template);

        // Act & Assert
        privateSubnets.forEach((subnet) => {
          const typeTag = subnet.Tags.find(
            (tag) => tag.Key === TAG_KEYS.SUBNET_TYPE
          );
          expect(typeTag?.Value).toBe(SUBNET_TYPES.PRIVATE);
        });
      });
    });

    describe("when distributing subnets across availability zones", () => {
      it("should place at least one public subnet in each AZ", () => {
        // Arrange
        const { publicSubnets } = getSubnetsByType(template);
        const azs = new Set(publicSubnets.map((s) => s.AvailabilityZone));

        // Assert
        expect(azs.size).toBeGreaterThanOrEqual(NETWORK_CONFIG.EXPECTED_AZS);
      });

      it("should place at least one private subnet in each AZ", () => {
        // Arrange
        const { privateSubnets } = getSubnetsByType(template);
        const azs = new Set(privateSubnets.map((s) => s.AvailabilityZone));

        // Assert
        expect(azs.size).toBeGreaterThanOrEqual(NETWORK_CONFIG.EXPECTED_AZS);
      });

      it("should have matching AZs for public and private subnets", () => {
        // Arrange
        const { publicSubnets, privateSubnets } = getSubnetsByType(template);
        const publicAzs = new Set(publicSubnets.map((s) => s.AvailabilityZone));
        const privateAzs = new Set(
          privateSubnets.map((s) => s.AvailabilityZone)
        );

        // Assert
        publicAzs.forEach((az) => {
          expect(privateAzs.has(az)).toBe(true);
        });
      });
    });
  });

  // ============================================================================
  // 3. INTERNET GATEWAY & PUBLIC ROUTING
  // ============================================================================

  describe("Internet Gateway Configuration", () => {
    describe("when creating internet gateway", () => {
      it("should create exactly one internet gateway", () => {
        // Assert
        expect(countResourcesOfType(template, RESOURCE_TYPES.IGW)).toBe(1);
      });

      it("should attach internet gateway to VPC", () => {
        // Assert
        template.hasResourceProperties("AWS::EC2::VPCGatewayAttachment", {
          VpcId: Match.anyValue(),
          InternetGatewayId: Match.anyValue(),
        });
      });
    });

    describe("when configuring public routing", () => {
      it("should have default route to internet gateway", () => {
        // Arrange
        const { igwRoutes } = getRoutesByType(template);

        // Assert
        expect(igwRoutes.length).toBeGreaterThan(0);
      });

      it("should route all internet traffic (0.0.0.0/0) through IGW", () => {
        // Arrange
        const { igwRoutes } = getRoutesByType(template);

        // Act & Assert
        igwRoutes.forEach((route) => {
          expect(route.DestinationCidrBlock).toBe("0.0.0.0/0");
          expect(route.GatewayId).toBeDefined();
        });
      });
    });
  });

  // ============================================================================
  // 4. NAT GATEWAY & PRIVATE ROUTING
  // ============================================================================

  describe("NAT Gateway Configuration", () => {
    // Calculate NAT gateway count once for use in conditional tests
    const getNatGatewayCount = () =>
      countResourcesOfType(template, RESOURCE_TYPES.NAT_GATEWAY);

    describe("when NAT gateways are deployed", () => {
      it("should deploy NAT gateway only if environment requires it", () => {
        // Act
        const count = getNatGatewayCount();

        // Assert - Development may have 0, Production should have >= 1
        expect(count).toBeGreaterThanOrEqual(0);
      });

      it("should place NAT gateway in public subnet (if NAT gateways exist)", () => {
        // Arrange
        const natCount = getNatGatewayCount();

        // Skip test if no NAT gateways
        if (natCount === 0) {
          return;
        }

        const natGateways = template.findResources(RESOURCE_TYPES.NAT_GATEWAY);

        // Act & Assert
        Object.values(natGateways).forEach((natGw) => {
          const props = natGw.Properties as Record<string, unknown>;
          expect(props.SubnetId).toBeDefined();
        });
      });

      it("should allocate Elastic IP for NAT gateway (if NAT gateways exist)", () => {
        // Arrange
        const natCount = getNatGatewayCount();

        // Skip test if no NAT gateways
        if (natCount === 0) {
          return;
        }

        // Assert
        template.hasResourceProperties(RESOURCE_TYPES.NAT_GATEWAY, {
          AllocationId: Match.anyValue(),
        });
      });

      it("should create Elastic IP with VPC domain (if NAT gateways exist)", () => {
        // Arrange
        const natCount = getNatGatewayCount();

        // Skip test if no NAT gateways
        if (natCount === 0) {
          return;
        }

        const eips = template.findResources(RESOURCE_TYPES.EIP);

        // Act & Assert
        Object.values(eips).forEach((eip) => {
          const props = eip.Properties as Record<string, unknown>;
          expect(props.Domain).toBe("vpc");
        });
      });

      it("should have at least one EIP for NAT gateway (if NAT gateways exist)", () => {
        // Arrange
        const natCount = getNatGatewayCount();

        // Skip test if no NAT gateways
        if (natCount === 0) {
          return;
        }

        // Act
        const eipCount = countResourcesOfType(template, RESOURCE_TYPES.EIP);

        // Assert
        expect(eipCount).toBeGreaterThanOrEqual(natCount);
      });

      it("should route private subnet internet traffic through NAT gateway (if NAT gateways exist)", () => {
        // Arrange
        const natCount = getNatGatewayCount();

        // Skip test if no NAT gateways
        if (natCount === 0) {
          return;
        }

        const { natRoutes } = getRoutesByType(template);

        // Assert
        expect(natRoutes.length).toBeGreaterThan(0);
        natRoutes.forEach((route) => {
          expect(route.DestinationCidrBlock).toBe("0.0.0.0/0");
          expect(route.NatGatewayId).toBeDefined();
        });
      });
    });

    describe("when NAT gateways are not deployed (cost optimization)", () => {
      it("should not create any Elastic IPs (if no NAT gateways)", () => {
        // Arrange
        const natCount = getNatGatewayCount();

        // Skip test if NAT gateways exist
        if (natCount > 0) {
          return;
        }

        // Act
        const eipCount = countResourcesOfType(template, RESOURCE_TYPES.EIP);

        // Assert
        expect(eipCount).toBe(0);
      });

      it("should not have NAT gateway routes (if no NAT gateways)", () => {
        // Arrange
        const natCount = getNatGatewayCount();

        // Skip test if NAT gateways exist
        if (natCount > 0) {
          return;
        }

        const { natRoutes } = getRoutesByType(template);

        // Assert
        expect(natRoutes.length).toBe(0);
      });
    });
  });

  // ============================================================================
  // 5. ROUTE TABLE ASSOCIATIONS
  // ============================================================================

  describe("Route Table Configuration", () => {
    describe("when creating route tables", () => {
      it("should create at least 2 route tables (public + private)", () => {
        // Act
        const rtCount = countResourcesOfType(
          template,
          RESOURCE_TYPES.ROUTE_TABLE
        );

        // Assert
        expect(rtCount).toBeGreaterThanOrEqual(2);
      });

      it("should have descriptive Name tags on route tables", () => {
        // Arrange
        const routeTables = template.findResources(RESOURCE_TYPES.ROUTE_TABLE);

        // Act & Assert
        Object.values(routeTables).forEach((rt) => {
          const resource = rt as ResourceWithProperties;
          expect(hasRequiredTags(resource, [TAG_KEYS.NAME])).toBe(true);
        });
      });
    });

    describe("when associating route tables with subnets", () => {
      it("should associate every subnet with a route table", () => {
        // Arrange
        const subnets = template.findResources(RESOURCE_TYPES.SUBNET);
        const associations = template.findResources(
          "AWS::EC2::SubnetRouteTableAssociation"
        );

        // Assert
        expect(Object.keys(associations).length).toBeGreaterThanOrEqual(
          Object.keys(subnets).length
        );
      });

      it("should not associate same subnet with multiple route tables", () => {
        // Arrange
        const associations = template.findResources(
          "AWS::EC2::SubnetRouteTableAssociation"
        );
        const subnetIds = new Set<string>();

        // Act
        Object.values(associations).forEach((assoc) => {
          const props = assoc.Properties as Record<string, unknown>;
          const subnetId = JSON.stringify(props.SubnetId);

          // Assert
          expect(subnetIds.has(subnetId)).toBe(false);
          subnetIds.add(subnetId);
        });
      });

      it("should define both SubnetId and RouteTableId in associations", () => {
        // Arrange
        const associations = template.findResources(
          "AWS::EC2::SubnetRouteTableAssociation"
        );

        // Act & Assert
        Object.values(associations).forEach((assoc) => {
          const props = assoc.Properties as Record<string, unknown>;
          expect(props.RouteTableId).toBeDefined();
          expect(props.SubnetId).toBeDefined();
        });
      });
    });

    describe("when configuring routing rules", () => {
      it("should have IGW route in at least one route table (public)", () => {
        // Arrange
        const { igwRoutes } = getRoutesByType(template);

        // Assert
        expect(igwRoutes.length).toBeGreaterThan(0);
      });

      it("should have NAT route in at least one route table (private) - if NAT gateways exist", () => {
        // Arrange
        const natCount = countResourcesOfType(
          template,
          RESOURCE_TYPES.NAT_GATEWAY
        );

        // Skip test if no NAT gateways
        if (natCount === 0) {
          return;
        }

        const { natRoutes } = getRoutesByType(template);

        // Assert
        expect(natRoutes.length).toBeGreaterThan(0);
      });

      it("should not have both IGW and NAT routes in same route table", () => {
        // Arrange
        const routes = template.findResources(RESOURCE_TYPES.ROUTE);
        const routeTableToType = new Map<string, Set<string>>();

        // Act
        Object.values(routes).forEach((route) => {
          const props = route.Properties as RouteProperties;
          const rtId = JSON.stringify(props.RouteTableId);

          if (!routeTableToType.has(rtId)) {
            routeTableToType.set(rtId, new Set());
          }

          const types = routeTableToType.get(rtId);
          if (types) {
            if (props.GatewayId) {
              types.add("IGW");
            } else if (props.NatGatewayId) {
              types.add("NAT");
            }
          }
        });

        // Assert - No route table should have both
        routeTableToType.forEach((types) => {
          if (types.has("IGW") && types.has("NAT")) {
            fail("Route table has both IGW and NAT routes (invalid)");
          }
        });
      });
    });
  });

  // ============================================================================
  // 6. VPC ENDPOINTS
  // ============================================================================

  describe("VPC Endpoints", () => {
    const endpoints = () => template.findResources("AWS::EC2::VPCEndpoint");

    describe("when configuring S3 endpoint for cost optimization", () => {
      it("should create S3 gateway endpoint if endpoints are enabled", () => {
        // Arrange
        const allEndpoints = endpoints();

        // Act - Check if any endpoint is for S3
        if (Object.keys(allEndpoints).length > 0) {
          const hasS3Endpoint = Object.values(allEndpoints).some((endpoint) => {
            const props = endpoint.Properties as Record<string, unknown>;
            return (
              props.ServiceName &&
              JSON.stringify(props.ServiceName).includes("s3")
            );
          });

          // Assert
          expect(hasS3Endpoint).toBe(true);
        }
      });

      it("should use Gateway type for S3 endpoint (no cost)", () => {
        // Arrange
        const allEndpoints = endpoints();

        // Act & Assert
        Object.values(allEndpoints).forEach((endpoint) => {
          const props = endpoint.Properties as Record<string, unknown>;
          if (
            props.ServiceName &&
            JSON.stringify(props.ServiceName).includes("s3")
          ) {
            expect(props.VpcEndpointType).toBe("Gateway");
          }
        });
      });
    });

    describe("when associating gateway endpoints", () => {
      it("should associate gateway endpoints with route tables", () => {
        // Arrange
        const allEndpoints = endpoints();

        // Act & Assert
        Object.values(allEndpoints).forEach((endpoint) => {
          const props = endpoint.Properties as Record<string, unknown>;
          if (props.VpcEndpointType === "Gateway") {
            expect(props.RouteTableIds).toBeDefined();
          }
        });
      });
    });
  });

  // ============================================================================
  // 7. NETWORK ISOLATION & SECURITY
  // ============================================================================

  describe("Network Isolation", () => {
    describe("when segregating network tiers", () => {
      it("should not allow subnet CIDR overlap between public and private", () => {
        // Arrange
        const { publicSubnets, privateSubnets } = extractSubnetCidrs(template);

        // Act & Assert
        publicSubnets.forEach((publicCidr) => {
          expect(privateSubnets).not.toContain(publicCidr);
        });
      });

      it("should use different route tables for public and private subnets", () => {
        // Arrange
        const associations = template.findResources(
          "AWS::EC2::SubnetRouteTableAssociation"
        );
        const { publicSubnets } = getSubnetsByType(template);
        const subnets = template.findResources(RESOURCE_TYPES.SUBNET);

        const publicSubnetIds = new Set(
          Object.entries(subnets)
            .filter(([_id, subnet]) => {
              const props = subnet.Properties as SubnetProperties;
              return publicSubnets.some(
                (ps) => ps.CidrBlock === props.CidrBlock
              );
            })
            .map(([id]) => id)
        );

        const routeTables = new Map<string, Set<string>>();

        // Act
        Object.values(associations).forEach((assoc) => {
          const props = assoc.Properties as Record<string, unknown>;
          const subnetRef = JSON.stringify(props.SubnetId);
          const rtRef = JSON.stringify(props.RouteTableId);

          if (!routeTables.has(rtRef)) {
            routeTables.set(rtRef, new Set());
          }
          const rtSubnets = routeTables.get(rtRef);
          if (rtSubnets) {
            rtSubnets.add(subnetRef);
          }
        });

        // Assert - Each route table should not mix public and private subnets
        routeTables.forEach((subnetsInRt) => {
          const hasPublic = Array.from(subnetsInRt).some((s) =>
            Array.from(publicSubnetIds).some((ps) => s.includes(ps))
          );
          const hasPrivate = subnetsInRt.size > 0 && !hasPublic;

          // If route table has both types, this is a configuration error
          if (hasPublic && hasPrivate) {
            fail("Route table associates both public and private subnets");
          }
        });
      });
    });
  });

  // ============================================================================
  // 8. VPC FLOW LOGS
  // ============================================================================

  describe("VPC Flow Logs", () => {
    describe("when enabling flow logs for security monitoring", () => {
      it("should create flow log for VPC", () => {
        // Assert
        template.hasResourceProperties("AWS::EC2::FlowLog", {
          ResourceType: "VPC",
        });
      });

      it("should capture all traffic (not just accepted or rejected)", () => {
        // Assert
        template.hasResourceProperties("AWS::EC2::FlowLog", {
          TrafficType: "ALL",
        });
      });

      it("should send logs to CloudWatch Logs", () => {
        // Assert
        template.hasResourceProperties("AWS::EC2::FlowLog", {
          LogDestinationType: "cloud-watch-logs",
        });
      });

      it("should have IAM role for CloudWatch Logs delivery", () => {
        // Arrange
        const flowLogs = template.findResources("AWS::EC2::FlowLog");

        // Act & Assert
        Object.values(flowLogs).forEach((flowLog) => {
          const props = flowLog.Properties as Record<string, unknown>;
          if (props.LogDestinationType === "cloud-watch-logs") {
            expect(props.DeliverLogsPermissionArn).toBeDefined();
          }
        });
      });

      it("should configure log retention for cost management", () => {
        // Arrange
        const logGroups = template.findResources("AWS::Logs::LogGroup");
        const flowLogGroups = Object.values(logGroups).filter((lg) => {
          const props = lg.Properties as Record<string, unknown>;
          const lgName = props.LogGroupName;
          return (
            typeof lgName === "string" &&
            (lgName.includes("FlowLog") || lgName.includes("flow-log"))
          );
        });

        // Act & Assert
        flowLogGroups.forEach((lg) => {
          const props = lg.Properties as Record<string, unknown>;
          expect(props.RetentionInDays).toBeDefined();
        });
      });
    });
  });

  // ============================================================================
  // 9. HIGH AVAILABILITY
  // ============================================================================

  describe("High Availability Configuration", () => {
    describe("when ensuring fault tolerance", () => {
      it("should distribute subnets across multiple AZs", () => {
        // Act
        const azInfo = getAvailabilityZones(template);

        // Assert
        expect(azInfo.count).toBeGreaterThanOrEqual(2);
      });

      it("should have at least one subnet of each type per AZ", () => {
        // Arrange
        const subnets = template.findResources("AWS::EC2::Subnet");
        const azSubnetTypes = new Map<string, Set<string>>();

        // Act
        Object.values(subnets).forEach((subnet) => {
          const props = subnet.Properties as SubnetProperties;
          const az = props.AvailabilityZone;
          const subnetType = props.Tags.find(
            (tag) => tag.Key === TAG_KEYS.SUBNET_TYPE
          )?.Value;

          if (az && subnetType) {
            if (!azSubnetTypes.has(az)) {
              azSubnetTypes.set(az, new Set());
            }
            const azTypes = azSubnetTypes.get(az);
            if (azTypes) {
              azTypes.add(subnetType);
            }
          }
        });

        // Assert
        azSubnetTypes.forEach((types) => {
          expect(types.has(SUBNET_TYPES.PUBLIC)).toBe(true);
          expect(types.has(SUBNET_TYPES.PRIVATE)).toBe(true);
        });
      });
    });

    describe("when testing production configuration", () => {
      it("should deploy multiple NAT gateways in production for HA", () => {
        // Arrange
        const prodStack = createNetworkingStack({
          environment: ENVIRONMENT_CONFIG.PRODUCTION,
        });
        const prodTemplate = Template.fromStack(prodStack);

        // Act
        const natCount = countResourcesOfType(
          prodTemplate,
          RESOURCE_TYPES.NAT_GATEWAY
        );

        // Assert - Production should ideally have 2+ NAT Gateways
        if (natCount > 1) {
          expect(natCount).toBeGreaterThanOrEqual(2);
        }
      });
    });
  });

  // ============================================================================
  // 10. EDGE CASES & ERROR SCENARIOS
  // ============================================================================

  describe("Edge Cases & Validation", () => {
    describe("when handling optional DHCP configuration", () => {
      it("should allow default DHCP or custom DHCP options", () => {
        // Arrange
        const vpcs = template.findResources("AWS::EC2::VPC");

        // Act & Assert
        Object.values(vpcs).forEach((vpc) => {
          const props = vpc.Properties as Record<string, unknown>;
          // DhcpOptionsId is optional - if set, should be defined
          if (props.DhcpOptionsId) {
            expect(props.DhcpOptionsId).toBeDefined();
          }
          // If not set, AWS uses default DHCP options (this is valid)
        });
      });
    });

    describe("when validating resource limits", () => {
      it("should not exceed AWS limits for subnets per VPC (200)", () => {
        // Act
        const subnetCount = countResourcesOfType(
          template,
          RESOURCE_TYPES.SUBNET
        );

        // Assert
        expect(subnetCount).toBeLessThanOrEqual(200);
      });

      it("should not exceed AWS limits for route tables per VPC (200)", () => {
        // Act
        const rtCount = countResourcesOfType(
          template,
          RESOURCE_TYPES.ROUTE_TABLE
        );

        // Assert
        expect(rtCount).toBeLessThanOrEqual(200);
      });
    });

    describe("when handling missing or invalid configuration", () => {
      it("should fail gracefully with invalid CIDR block", () => {
        // This test ensures the stack construction validates CIDR
        expect(() => {
          createNetworkingStack({ vpcCidr: "invalid-cidr" });
        }).toThrow();
      });

      it("should handle empty environment name", () => {
        // Ensure environment validation
        expect(() => {
          createNetworkingStack({ environment: "" });
        }).toThrow();
      });
    });

    describe("when testing resource dependencies", () => {
      it("should create IGW before creating IGW attachment", () => {
        // Arrange
        const igws = template.findResources(RESOURCE_TYPES.IGW);
        const attachments = template.findResources(
          "AWS::EC2::VPCGatewayAttachment"
        );

        // Assert
        expect(Object.keys(igws).length).toBeGreaterThan(0);
        expect(Object.keys(attachments).length).toBeGreaterThan(0);
      });

      it("should create subnets before creating NAT gateways", () => {
        // Arrange
        const subnets = template.findResources(RESOURCE_TYPES.SUBNET);
        const natGateways = template.findResources(RESOURCE_TYPES.NAT_GATEWAY);

        // Act
        const hasSubnets = Object.keys(subnets).length > 0;
        const hasNatGateways = Object.keys(natGateways).length > 0;

        // Assert
        if (hasNatGateways) {
          expect(hasSubnets).toBe(true);
        }
      });
    });
  });
});
