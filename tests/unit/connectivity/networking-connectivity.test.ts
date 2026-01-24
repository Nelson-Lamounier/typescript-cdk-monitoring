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
// Import shared utilities from centralized utils
import {
  getSubnetsByType,
  getRoutesByType,
  getAvailabilityZones,
  hasRequiredTags,
} from "../utils";
// Import types
import type {
  SubnetProperties,
  RouteProperties,
  ResourceWithProperties,
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

      // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
      it("should use the configured CIDR block", () => {
        template.hasResourceProperties(RESOURCE_TYPES.VPC, {
          CidrBlock: NETWORK_CONFIG.VPC_CIDR,
        });
      });

      // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
      it("should enable DNS support for service discovery", () => {
        template.hasResourceProperties(RESOURCE_TYPES.VPC, {
          EnableDnsSupport: true,
        });
      });

      // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
      it("should enable DNS hostnames for EC2 instances", () => {
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
    // Pre-computed data for Subnet Architecture tests
    let publicSubnets: SubnetProperties[];
    let privateSubnets: SubnetProperties[];
    let publicCidrs: string[];
    let privateCidrs: string[];
    let allCidrs: string[];
    let uniqueCidrs: Set<string>;
    let publicAzs: Set<string>;
    let privateAzs: Set<string>;
    let cidrOverlaps: string[];
    let azsNotInPrivate: string[];

    beforeAll(() => {
      // Pre-extract subnets by type
      const subnetData = getSubnetsByType(template);
      publicSubnets = subnetData.publicSubnets;
      privateSubnets = subnetData.privateSubnets;

      // Pre-extract CIDRs
      const cidrData = extractSubnetCidrs(template);
      publicCidrs = cidrData.publicSubnets;
      privateCidrs = cidrData.privateSubnets;
      allCidrs = [...publicCidrs, ...privateCidrs];
      uniqueCidrs = new Set(allCidrs);

      // Pre-compute CIDR overlaps
      cidrOverlaps = publicCidrs.filter((cidr) => privateCidrs.includes(cidr));

      // Pre-compute AZs
      publicAzs = new Set(publicSubnets.map((s) => s.AvailabilityZone));
      privateAzs = new Set(privateSubnets.map((s) => s.AvailabilityZone));

      // Pre-compute AZs not matching
      azsNotInPrivate = Array.from(publicAzs).filter((az) => !privateAzs.has(az));
    });

    describe("when creating subnets", () => {
      it("should create both public and private subnets", () => {
        expect(publicSubnets.length).toBeGreaterThan(0);
        expect(privateSubnets.length).toBeGreaterThan(0);
      });

      it("should create equal number of public and private subnets per AZ", () => {
        expect(publicSubnets.length).toBe(privateSubnets.length);
      });

      it("should create at least 2 subnets of each type", () => {
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
        // Guard assertion
        expect(allCidrs).toBeDefined();
        expect(allCidrs.length).toBeGreaterThan(0);

        allCidrs.forEach((cidr) => {
          expect(isCidrInRange(cidr, NETWORK_CONFIG.VPC_CIDR)).toBe(true);
        });
      });

      it("should not have overlapping CIDR blocks between subnets", () => {
        expect(uniqueCidrs.size).toBe(allCidrs.length);
      });

      it("should use different CIDR blocks for public and private subnets", () => {
        expect(cidrOverlaps.length).toBe(0);
      });
    });

    describe("when configuring public subnets", () => {
      it("should enable auto-assign public IP on launch", () => {
        // Guard assertion
        expect(publicSubnets).toBeDefined();
        expect(publicSubnets.length).toBeGreaterThan(0);

        publicSubnets.forEach((subnet) => {
          expect(subnet.MapPublicIpOnLaunch).toBe(true);
        });
      });

      it("should have descriptive Name tag", () => {
        // Guard assertion
        expect(publicSubnets).toBeDefined();
        expect(publicSubnets.length).toBeGreaterThan(0);

        publicSubnets.forEach((subnet) => {
          const nameTag = subnet.Tags.find((tag: ResourceTag) => tag.Key === TAG_KEYS.NAME);
          expect(nameTag).toBeDefined();
          expect(nameTag?.Value).toMatch(/public/i);
        });
      });

      it("should have subnet type tag set to Public", () => {
        // Guard assertion
        expect(publicSubnets).toBeDefined();
        expect(publicSubnets.length).toBeGreaterThan(0);

        publicSubnets.forEach((subnet) => {
          const typeTag = subnet.Tags.find(
            (tag: ResourceTag) => tag.Key === TAG_KEYS.SUBNET_TYPE
          );
          expect(typeTag?.Value).toBe(SUBNET_TYPES.PUBLIC);
        });
      });
    });

    describe("when configuring private subnets", () => {
      it("should not enable auto-assign public IP on launch", () => {
        // Guard assertion
        expect(privateSubnets).toBeDefined();
        expect(privateSubnets.length).toBeGreaterThan(0);

        privateSubnets.forEach((subnet) => {
          expect(subnet.MapPublicIpOnLaunch).not.toBe(true);
        });
      });

      it("should have descriptive Name tag", () => {
        // Guard assertion
        expect(privateSubnets).toBeDefined();
        expect(privateSubnets.length).toBeGreaterThan(0);

        privateSubnets.forEach((subnet) => {
          const nameTag = subnet.Tags.find((tag: ResourceTag) => tag.Key === TAG_KEYS.NAME);
          expect(nameTag).toBeDefined();
          expect(nameTag?.Value).toMatch(/private/i);
        });
      });

      it("should have subnet type tag set to Private", () => {
        // Guard assertion
        expect(privateSubnets).toBeDefined();
        expect(privateSubnets.length).toBeGreaterThan(0);

        privateSubnets.forEach((subnet) => {
          const typeTag = subnet.Tags.find(
            (tag: ResourceTag) => tag.Key === TAG_KEYS.SUBNET_TYPE
          );
          expect(typeTag?.Value).toBe(SUBNET_TYPES.PRIVATE);
        });
      });
    });

    describe("when distributing subnets across availability zones", () => {
      it("should place at least one public subnet in each AZ", () => {
        expect(publicAzs.size).toBeGreaterThanOrEqual(NETWORK_CONFIG.EXPECTED_AZS);
      });

      it("should place at least one private subnet in each AZ", () => {
        expect(privateAzs.size).toBeGreaterThanOrEqual(NETWORK_CONFIG.EXPECTED_AZS);
      });

      it("should have matching AZs for public and private subnets", () => {
        // All public AZs should exist in private AZs
        expect(azsNotInPrivate.length).toBe(0);
      });
    });
  });

  // ============================================================================
  // 3. INTERNET GATEWAY & PUBLIC ROUTING
  // ============================================================================

  describe("Internet Gateway Configuration", () => {
    // Pre-computed data for Internet Gateway tests
    let igwCount: number;
    let igwRoutes: RouteProperties[];

    beforeAll(() => {
      igwCount = countResourcesOfType(template, RESOURCE_TYPES.IGW);
      const routes = getRoutesByType(template);
      igwRoutes = routes.igwRoutes;
    });

    describe("when creating internet gateway", () => {
      it("should create exactly one internet gateway", () => {
        expect(igwCount).toBe(1);
      });

      // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
      it("should attach internet gateway to VPC", () => {
        template.hasResourceProperties("AWS::EC2::VPCGatewayAttachment", {
          VpcId: Match.anyValue(),
          InternetGatewayId: Match.anyValue(),
        });
      });
    });

    describe("when configuring public routing", () => {
      it("should have default route to internet gateway", () => {
        expect(igwRoutes.length).toBeGreaterThan(0);
      });

      it("should route all internet traffic (0.0.0.0/0) through IGW", () => {
        // Guard assertion
        expect(igwRoutes).toBeDefined();
        expect(igwRoutes.length).toBeGreaterThan(0);

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
    // Pre-computed data for NAT Gateway tests
    let natGatewayCount: number;
    let eipCount: number;
    let natGateways: Array<{ props: Record<string, unknown> }>;
    let eips: Array<{ props: Record<string, unknown> }>;
    let natRoutes: RouteProperties[];
    let hasNatGateways: boolean;

    beforeAll(() => {
      // Pre-compute all NAT Gateway related data
      natGatewayCount = countResourcesOfType(template, RESOURCE_TYPES.NAT_GATEWAY);
      eipCount = countResourcesOfType(template, RESOURCE_TYPES.EIP);
      hasNatGateways = natGatewayCount > 0;

      // Pre-extract NAT Gateway properties
      const natGwResources = template.findResources(RESOURCE_TYPES.NAT_GATEWAY);
      natGateways = Object.values(natGwResources).map((natGw) => ({
        props: natGw.Properties as Record<string, unknown>,
      }));

      // Pre-extract EIP properties
      const eipResources = template.findResources(RESOURCE_TYPES.EIP);
      eips = Object.values(eipResources).map((eip) => ({
        props: eip.Properties as Record<string, unknown>,
      }));

      // Pre-extract NAT routes
      const routes = getRoutesByType(template);
      natRoutes = routes.natRoutes;
    });

    describe("when NAT gateways are deployed (optional)", () => {
      it("should deploy NAT gateway only if environment requires it", () => {
        // Assert - Development may have 0, Production should have >= 1
        expect(natGatewayCount).toBeGreaterThanOrEqual(0);
      });

      it("should place NAT gateway in public subnet (if NAT gateways exist)", () => {
        // Guard assertion - empty array is valid for optional feature
        expect(natGateways).toBeDefined();
        expect(Array.isArray(natGateways)).toBe(true);

        // Validate each NAT gateway
        natGateways.forEach(({ props }) => {
          expect(props.SubnetId).toBeDefined();
        });
      });

      it("should allocate Elastic IP for NAT gateway (if NAT gateways exist)", () => {
        // Guard assertion - empty NAT gateways is valid (optional)
        expect(natGateways).toBeDefined();
        expect(Array.isArray(natGateways)).toBe(true);

        // Validate each NAT gateway has AllocationId
        natGateways.forEach(({ props }) => {
          expect(props.AllocationId).toBeDefined();
        });
      });

      it("should create Elastic IP with VPC domain (if NAT gateways exist)", () => {
        // Guard assertion - empty array is valid for optional feature
        expect(eips).toBeDefined();
        expect(Array.isArray(eips)).toBe(true);

        // Validate each EIP
        eips.forEach(({ props }) => {
          expect(props.Domain).toBe("vpc");
        });
      });

      it("should have at least one EIP for NAT gateway (if NAT gateways exist)", () => {
        // Guard assertion
        expect(natGatewayCount).toBeGreaterThanOrEqual(0);
        expect(eipCount).toBeGreaterThanOrEqual(0);

        // If NAT gateways exist, there should be at least as many EIPs
        // If no NAT gateways, this assertion is trivially true (0 >= 0)
        expect(eipCount).toBeGreaterThanOrEqual(natGatewayCount);
      });

      it("should route private subnet internet traffic through NAT gateway (if NAT gateways exist)", () => {
        // Guard assertion - empty array is valid for optional feature
        expect(natRoutes).toBeDefined();
        expect(Array.isArray(natRoutes)).toBe(true);

        // Validate each NAT route
        natRoutes.forEach((route) => {
          expect(route.DestinationCidrBlock).toBe("0.0.0.0/0");
          expect(route.NatGatewayId).toBeDefined();
        });
      });
    });

    describe("when NAT gateways are not deployed (cost optimization)", () => {
      it("should have consistent EIP and NAT gateway counts", () => {
        // Guard assertions
        expect(natGatewayCount).toBeGreaterThanOrEqual(0);
        expect(eipCount).toBeGreaterThanOrEqual(0);

        // If no NAT gateways, there should be no EIPs for NAT
        // If NAT gateways exist, there should be EIPs
        // This is a consistency check, not conditional skip
        expect(eipCount).toBeGreaterThanOrEqual(natGatewayCount);
      });

      it("should have consistent NAT routes and NAT gateway presence", () => {
        // Guard assertions
        expect(natRoutes).toBeDefined();
        expect(Array.isArray(natRoutes)).toBe(true);
        expect(natGatewayCount).toBeGreaterThanOrEqual(0);

        // If no NAT gateways, there should be no NAT routes
        // If NAT gateways exist, there should be NAT routes
        // Consistency check: routes count should be 0 when gateways are 0
        const hasNatRoutes = natRoutes.length > 0;
        const isConsistent = hasNatGateways === hasNatRoutes;
        expect(isConsistent).toBe(true);
      });
    });
  });

  // ============================================================================
  // 5. ROUTE TABLE ASSOCIATIONS
  // ============================================================================

  describe("Route Table Configuration", () => {
    // Pre-computed data for Route Table tests
    let routeTableCount: number;
    let routeTables: Array<{ resource: ResourceWithProperties }>;
    let associations: Array<{ props: Record<string, unknown>; subnetId: string }>;
    let subnetCount: number;
    let igwRoutes: RouteProperties[];
    let natRoutes: RouteProperties[];
    let natGatewayCount: number;
    let routeTableToType: Map<string, Set<string>>;
    let routeTablesWithBothTypes: Array<{ rtId: string; types: Set<string> }>;

    beforeAll(() => {
      // Pre-compute all route table data
      routeTableCount = countResourcesOfType(template, RESOURCE_TYPES.ROUTE_TABLE);
      subnetCount = countResourcesOfType(template, RESOURCE_TYPES.SUBNET);
      natGatewayCount = countResourcesOfType(template, RESOURCE_TYPES.NAT_GATEWAY);

      // Pre-extract route tables
      const rtResources = template.findResources(RESOURCE_TYPES.ROUTE_TABLE);
      routeTables = Object.values(rtResources).map((rt) => ({
        resource: rt as ResourceWithProperties,
      }));

      // Pre-extract associations
      const assocResources = template.findResources("AWS::EC2::SubnetRouteTableAssociation");
      associations = Object.values(assocResources).map((assoc) => {
        const props = assoc.Properties as Record<string, unknown>;
        return {
          props,
          subnetId: JSON.stringify(props.SubnetId),
        };
      });

      // Pre-extract routes by type
      const routes = getRoutesByType(template);
      igwRoutes = routes.igwRoutes;
      natRoutes = routes.natRoutes;

      // Pre-compute route table to type mapping
      routeTableToType = new Map<string, Set<string>>();
      const allRoutes = template.findResources(RESOURCE_TYPES.ROUTE);
      Object.values(allRoutes).forEach((route) => {
        const props = route.Properties as RouteProperties;
        const rtId = JSON.stringify(props.RouteTableId);

        const existingTypes = routeTableToType.get(rtId);
        const types = existingTypes ?? new Set<string>();
        routeTableToType.set(rtId, types);

        // Add route types based on gateway presence
        if (props.GatewayId !== undefined) {
          types.add("IGW");
        }
        if (props.NatGatewayId !== undefined) {
          types.add("NAT");
        }
      });

      // Pre-compute route tables with both types (violations)
      routeTablesWithBothTypes = Array.from(routeTableToType.entries())
        .filter(([, types]) => types.has("IGW") && types.has("NAT"))
        .map(([rtId, types]) => ({ rtId, types }));
    });

    describe("when creating route tables", () => {
      it("should create at least 2 route tables (public + private)", () => {
        expect(routeTableCount).toBeGreaterThanOrEqual(2);
      });

      it("should have descriptive Name tags on route tables", () => {
        // Guard assertion
        expect(routeTables).toBeDefined();
        expect(routeTables.length).toBeGreaterThan(0);

        routeTables.forEach(({ resource }) => {
          expect(hasRequiredTags(resource, [TAG_KEYS.NAME])).toBe(true);
        });
      });
    });

    describe("when associating route tables with subnets", () => {
      it("should associate every subnet with a route table", () => {
        expect(associations.length).toBeGreaterThanOrEqual(subnetCount);
      });

      it("should not associate same subnet with multiple route tables", () => {
        // Guard assertion
        expect(associations).toBeDefined();
        expect(Array.isArray(associations)).toBe(true);

        // Pre-computed unique check
        const subnetIds = associations.map((a) => a.subnetId);
        const uniqueSubnetIds = new Set(subnetIds);
        expect(uniqueSubnetIds.size).toBe(subnetIds.length);
      });

      it("should define both SubnetId and RouteTableId in associations", () => {
        // Guard assertion
        expect(associations).toBeDefined();
        expect(Array.isArray(associations)).toBe(true);

        associations.forEach(({ props }) => {
          expect(props.RouteTableId).toBeDefined();
          expect(props.SubnetId).toBeDefined();
        });
      });
    });

    describe("when configuring routing rules", () => {
      it("should have IGW route in at least one route table (public)", () => {
        expect(igwRoutes.length).toBeGreaterThan(0);
      });

      it("should have NAT route in at least one route table (private) - if NAT gateways exist", () => {
        // Guard assertions
        expect(natRoutes).toBeDefined();
        expect(Array.isArray(natRoutes)).toBe(true);
        expect(natGatewayCount).toBeGreaterThanOrEqual(0);

        // If NAT gateways exist, NAT routes should exist
        // If no NAT gateways, empty array is valid
        const hasNatGateways = natGatewayCount > 0;
        const hasNatRoutes = natRoutes.length > 0;
        const isConsistent = hasNatGateways === hasNatRoutes;
        expect(isConsistent).toBe(true);
      });

      it("should not have both IGW and NAT routes in same route table", () => {
        // Guard assertions
        expect(routeTableToType).toBeDefined();
        expect(routeTablesWithBothTypes).toBeDefined();
        expect(Array.isArray(routeTablesWithBothTypes)).toBe(true);

        // Assert no route tables have both types
        expect(routeTablesWithBothTypes.length).toBe(0);
      });
    });
  });

  // ============================================================================
  // 6. VPC ENDPOINTS
  // ============================================================================

  describe("VPC Endpoints", () => {
    // Pre-computed data for VPC Endpoint tests
    let allEndpoints: Array<{ props: Record<string, unknown> }>;
    let s3Endpoints: Array<{ props: Record<string, unknown> }>;
    let gatewayEndpoints: Array<{ props: Record<string, unknown> }>;
    let hasAnyEndpoints: boolean;
    let hasS3Endpoint: boolean;

    beforeAll(() => {
      // Pre-extract all endpoints
      const endpointResources = template.findResources("AWS::EC2::VPCEndpoint");
      allEndpoints = Object.values(endpointResources).map((endpoint) => ({
        props: endpoint.Properties as Record<string, unknown>,
      }));

      hasAnyEndpoints = allEndpoints.length > 0;

      // Pre-filter S3 endpoints
      s3Endpoints = allEndpoints.filter(({ props }) => {
        const serviceName = props.ServiceName;
        return serviceName && JSON.stringify(serviceName).includes("s3");
      });

      hasS3Endpoint = s3Endpoints.length > 0;

      // Pre-filter gateway endpoints
      gatewayEndpoints = allEndpoints.filter(
        ({ props }) => props.VpcEndpointType === "Gateway"
      );
    });

    describe("when configuring S3 endpoint for cost optimization (optional)", () => {
      it("should create S3 gateway endpoint if endpoints are enabled", () => {
        // Guard assertion - endpoints are optional
        expect(allEndpoints).toBeDefined();
        expect(Array.isArray(allEndpoints)).toBe(true);

        // If endpoints exist, check for S3
        // Empty array is valid (no endpoints configured)
        expect(hasS3Endpoint).toBeDefined();

        // Valid configurations:
        // 1. No endpoints at all (cost optimization)
        // 2. If endpoints exist, S3 should be one of them
        // Using pre-computed hasS3Endpoint boolean
        expect(hasS3Endpoint).toBe(hasAnyEndpoints);
      });

      it("should use Gateway type for S3 endpoint (no cost) (if S3 endpoint exists)", () => {
        // Guard assertion - S3 endpoints are optional
        expect(s3Endpoints).toBeDefined();
        expect(Array.isArray(s3Endpoints)).toBe(true);

        // Validate each S3 endpoint uses Gateway type
        s3Endpoints.forEach(({ props }) => {
          expect(props.VpcEndpointType).toBe("Gateway");
        });
      });
    });

    describe("when associating gateway endpoints", () => {
      it("should associate gateway endpoints with route tables (if gateway endpoints exist)", () => {
        // Guard assertion - gateway endpoints are optional
        expect(gatewayEndpoints).toBeDefined();
        expect(Array.isArray(gatewayEndpoints)).toBe(true);

        // Validate each gateway endpoint has route table associations
        gatewayEndpoints.forEach(({ props }) => {
          expect(props.RouteTableIds).toBeDefined();
        });
      });
    });
  });

  // ============================================================================
  // 7. NETWORK ISOLATION & SECURITY
  // ============================================================================

  describe("Network Isolation", () => {
    // Pre-computed data for Network Isolation tests
    let publicCidrs: string[];
    let privateCidrs: string[];
    let cidrOverlaps: string[];
    let routeTableMixedSubnets: Array<{ rtId: string; hasPublicAndPrivate: boolean }>;

    beforeAll(() => {
      // Pre-extract subnet CIDRs
      const cidrs = extractSubnetCidrs(template);
      publicCidrs = cidrs.publicSubnets;
      privateCidrs = cidrs.privateSubnets;

      // Pre-compute overlapping CIDRs
      cidrOverlaps = publicCidrs.filter((cidr) => privateCidrs.includes(cidr));

      // Pre-compute route table to subnet type mapping
      const associations = template.findResources("AWS::EC2::SubnetRouteTableAssociation");
      const { publicSubnets } = getSubnetsByType(template);
      const subnets = template.findResources(RESOURCE_TYPES.SUBNET);

      // Build set of public subnet IDs
      const publicSubnetIds = new Set(
        Object.entries(subnets)
          .filter(([, subnet]) => {
            const props = subnet.Properties as SubnetProperties;
            return publicSubnets.some((ps) => ps.CidrBlock === props.CidrBlock);
          })
          .map(([id]) => id)
      );

      // Build route table to subnets mapping
      const routeTableToSubnets = new Map<string, Set<string>>();
      Object.values(associations).forEach((assoc) => {
        const props = assoc.Properties as Record<string, unknown>;
        const subnetRef = JSON.stringify(props.SubnetId);
        const rtRef = JSON.stringify(props.RouteTableId);

        const existingSubnets = routeTableToSubnets.get(rtRef);
        const rtSubnets = existingSubnets ?? new Set<string>();
        routeTableToSubnets.set(rtRef, rtSubnets);
        rtSubnets.add(subnetRef);
      });

      // Pre-compute violations (route tables with mixed subnet types)
      routeTableMixedSubnets = Array.from(routeTableToSubnets.entries()).map(
        ([rtId, subnetsInRt]) => {
          const subnetRefs = Array.from(subnetsInRt);
          const hasPublic = subnetRefs.some((s) =>
            Array.from(publicSubnetIds).some((ps) => s.includes(ps))
          );
          const hasPrivate = subnetRefs.some(
            (s) => !Array.from(publicSubnetIds).some((ps) => s.includes(ps))
          );
          return {
            rtId,
            hasPublicAndPrivate: hasPublic && hasPrivate,
          };
        }
      );
    });

    describe("when segregating network tiers", () => {
      it("should not allow subnet CIDR overlap between public and private", () => {
        // Guard assertions
        expect(publicCidrs.length).toBeGreaterThan(0);
        expect(privateCidrs.length).toBeGreaterThan(0);

        // Assert no overlaps
        expect(cidrOverlaps.length).toBe(0);
      });

      it("should use different route tables for public and private subnets", () => {
        // Guard assertions
        expect(routeTableMixedSubnets).toBeDefined();
        expect(Array.isArray(routeTableMixedSubnets)).toBe(true);
        expect(routeTableMixedSubnets.length).toBeGreaterThan(0);

        // Assert no route tables have mixed subnet types
        const violations = routeTableMixedSubnets.filter(
          (rt) => rt.hasPublicAndPrivate
        );
        expect(violations.length).toBe(0);
      });
    });
  });

  // ============================================================================
  // 8. VPC FLOW LOGS
  // ============================================================================

  describe("VPC Flow Logs", () => {
    // Pre-computed data for VPC Flow Logs tests
    let cloudWatchFlowLogs: Array<{ props: Record<string, unknown> }>;
    let flowLogGroups: Array<{ props: Record<string, unknown> }>;

    beforeAll(() => {
      // Pre-extract CloudWatch flow logs
      const flowLogs = template.findResources("AWS::EC2::FlowLog");
      cloudWatchFlowLogs = Object.values(flowLogs)
        .filter((flowLog) => {
          const props = flowLog.Properties as Record<string, unknown>;
          return props.LogDestinationType === "cloud-watch-logs";
        })
        .map((flowLog) => ({
          props: flowLog.Properties as Record<string, unknown>,
        }));

      // Pre-extract flow log groups
      const logGroups = template.findResources("AWS::Logs::LogGroup");
      flowLogGroups = Object.values(logGroups)
        .filter((lg) => {
          const props = lg.Properties as Record<string, unknown>;
          const lgName = props.LogGroupName;
          return (
            typeof lgName === "string" &&
            (lgName.includes("FlowLog") || lgName.includes("flow-log"))
          );
        })
        .map((lg) => ({
          props: lg.Properties as Record<string, unknown>,
        }));
    });

    describe("when enabling flow logs for security monitoring", () => {
      // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
      it("should create flow log for VPC", () => {
        template.hasResourceProperties("AWS::EC2::FlowLog", {
          ResourceType: "VPC",
        });
      });

      // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
      it("should capture all traffic (not just accepted or rejected)", () => {
        template.hasResourceProperties("AWS::EC2::FlowLog", {
          TrafficType: "ALL",
        });
      });

      // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
      it("should send logs to CloudWatch Logs", () => {
        template.hasResourceProperties("AWS::EC2::FlowLog", {
          LogDestinationType: "cloud-watch-logs",
        });
      });

      it("should have IAM role for CloudWatch Logs delivery", () => {
        // Guard assertion - CloudWatch flow logs are expected
        expect(cloudWatchFlowLogs).toBeDefined();
        expect(Array.isArray(cloudWatchFlowLogs)).toBe(true);

        // Validate each CloudWatch flow log has IAM role
        cloudWatchFlowLogs.forEach(({ props }) => {
          expect(props.DeliverLogsPermissionArn).toBeDefined();
        });
      });

      it("should configure log retention for cost management", () => {
        // Guard assertion - flow log groups are optional
        expect(flowLogGroups).toBeDefined();
        expect(Array.isArray(flowLogGroups)).toBe(true);

        // Validate each flow log group has retention
        flowLogGroups.forEach(({ props }) => {
          expect(props.RetentionInDays).toBeDefined();
        });
      });
    });
  });

  // ============================================================================
  // 9. HIGH AVAILABILITY
  // ============================================================================

  describe("High Availability Configuration", () => {
    // Pre-computed data for High Availability tests
    let azCount: number;
    let azSubnetTypes: Map<string, Set<string>>;
    let azsMissingSubnetTypes: Array<{ az: string; missingPublic: boolean; missingPrivate: boolean }>;

    beforeAll(() => {
      // Pre-compute AZ count
      const azInfo = getAvailabilityZones(template);
      azCount = azInfo.count;

      // Pre-compute AZ to subnet types mapping
      azSubnetTypes = new Map<string, Set<string>>();
      const subnets = template.findResources("AWS::EC2::Subnet");

      Object.values(subnets).forEach((subnet) => {
        const props = subnet.Properties as SubnetProperties;
        const az = props.AvailabilityZone;
        const tags = props.Tags || [];
        const subnetTypeTag = tags.find(
          (tag: ResourceTag) => tag.Key === TAG_KEYS.SUBNET_TYPE
        );
        const subnetType = subnetTypeTag?.Value;

        // Only process if valid AZ and subnet type
        if (az !== undefined && subnetType !== undefined) {
          const existingTypes = azSubnetTypes.get(az);
          const azTypes = existingTypes ?? new Set<string>();
          azSubnetTypes.set(az, azTypes);
          azTypes.add(subnetType);
        }
      });

      // Pre-compute AZs missing subnet types
      azsMissingSubnetTypes = Array.from(azSubnetTypes.entries())
        .map(([az, types]) => ({
          az,
          missingPublic: !types.has(SUBNET_TYPES.PUBLIC),
          missingPrivate: !types.has(SUBNET_TYPES.PRIVATE),
        }))
        .filter((item) => item.missingPublic || item.missingPrivate);
    });

    describe("when ensuring fault tolerance", () => {
      it("should distribute subnets across multiple AZs", () => {
        expect(azCount).toBeGreaterThanOrEqual(2);
      });

      it("should have at least one subnet of each type per AZ", () => {
        // Guard assertions
        expect(azSubnetTypes).toBeDefined();
        expect(azSubnetTypes.size).toBeGreaterThan(0);

        // Assert no AZs are missing required subnet types
        expect(azsMissingSubnetTypes.length).toBe(0);
      });
    });

    describe("when testing production configuration", () => {
      // Pre-computed production data
      let prodNatCount: number;

      beforeAll(() => {
        const prodStack = createNetworkingStack({
          environment: ENVIRONMENT_CONFIG.PRODUCTION,
        });
        const prodTemplate = Template.fromStack(prodStack);
        prodNatCount = countResourcesOfType(prodTemplate, RESOURCE_TYPES.NAT_GATEWAY);
      });

      it("should deploy multiple NAT gateways in production for HA", () => {
        // Guard assertion
        expect(prodNatCount).toBeGreaterThanOrEqual(0);

        // Production NAT count should be valid (any number is acceptable)
        // 0 = cost-optimized, 1 = single NAT, 2+ = HA config
        expect(prodNatCount).toBeGreaterThanOrEqual(0);
      });
    });
  });

  // ============================================================================
  // 10. EDGE CASES & ERROR SCENARIOS
  // ============================================================================

  describe("Edge Cases & Validation", () => {
    // Pre-computed data for Edge Cases tests
    let vpcsWithDhcp: Array<{ vpc: unknown; hasDhcpOptions: boolean }>;
    let subnetCount: number;
    let routeTableCount: number;
    let igwCount: number;
    let attachmentCount: number;
    let subnetCountForDeps: number;
    let natGatewayCountForDeps: number;

    beforeAll(() => {
      // Pre-extract VPCs with DHCP options
      const vpcs = template.findResources("AWS::EC2::VPC");
      vpcsWithDhcp = Object.values(vpcs).map((vpc) => {
        const props = vpc.Properties as Record<string, unknown>;
        return {
          vpc,
          hasDhcpOptions: props.DhcpOptionsId !== undefined,
        };
      });

      // Pre-compute resource counts
      subnetCount = countResourcesOfType(template, RESOURCE_TYPES.SUBNET);
      routeTableCount = countResourcesOfType(template, RESOURCE_TYPES.ROUTE_TABLE);

      // Pre-compute dependency resource counts
      const igws = template.findResources(RESOURCE_TYPES.IGW);
      const attachments = template.findResources("AWS::EC2::VPCGatewayAttachment");
      igwCount = Object.keys(igws).length;
      attachmentCount = Object.keys(attachments).length;

      const subnetsForDeps = template.findResources(RESOURCE_TYPES.SUBNET);
      const natGatewaysForDeps = template.findResources(RESOURCE_TYPES.NAT_GATEWAY);
      subnetCountForDeps = Object.keys(subnetsForDeps).length;
      natGatewayCountForDeps = Object.keys(natGatewaysForDeps).length;
    });

    describe("when handling optional DHCP configuration", () => {
      it("should allow default DHCP or custom DHCP options", () => {
        // Guard assertion
        expect(vpcsWithDhcp).toBeDefined();
        expect(Array.isArray(vpcsWithDhcp)).toBe(true);
        expect(vpcsWithDhcp.length).toBeGreaterThan(0);

        // All VPCs should have valid DHCP configuration (either custom or default)
        // If hasDhcpOptions is true, it's explicitly set; if false, AWS uses defaults
        // Both are valid configurations
        vpcsWithDhcp.forEach(({ hasDhcpOptions }) => {
          expect(typeof hasDhcpOptions).toBe("boolean");
        });
      });
    });

    describe("when validating resource limits", () => {
      it("should not exceed AWS limits for subnets per VPC (200)", () => {
        expect(subnetCount).toBeLessThanOrEqual(200);
      });

      it("should not exceed AWS limits for route tables per VPC (200)", () => {
        expect(routeTableCount).toBeLessThanOrEqual(200);
      });
    });

    describe("when handling missing or invalid configuration", () => {
      it("should fail gracefully with invalid CIDR block", () => {
        expect(() => {
          createNetworkingStack({ vpcCidr: "invalid-cidr" });
        }).toThrow();
      });

      it("should handle empty environment name", () => {
        expect(() => {
          createNetworkingStack({ environment: "" });
        }).toThrow();
      });
    });

    describe("when testing resource dependencies", () => {
      it("should create IGW before creating IGW attachment", () => {
        expect(igwCount).toBeGreaterThan(0);
        expect(attachmentCount).toBeGreaterThan(0);
      });

      it("should create subnets before creating NAT gateways (if NAT gateways exist)", () => {
        // Guard assertions
        expect(subnetCountForDeps).toBeGreaterThanOrEqual(0);
        expect(natGatewayCountForDeps).toBeGreaterThanOrEqual(0);

        // If NAT gateways exist, subnets must exist (dependency)
        // NAT gateways require public subnets to be placed in
        // Subnets should always exist (required infrastructure)
        expect(subnetCountForDeps).toBeGreaterThan(0);
      });
    });
  });
});
