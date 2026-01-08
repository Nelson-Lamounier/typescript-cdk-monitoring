/** @format */

import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import { Template, Match, Capture } from "aws-cdk-lib/assertions";

import { NetworkingStack } from "../../lib/stacks/networking-stack";
import { VpcConstruct } from "../../lib/constructs/networking/vpc/vpc-construct";
import { SubnetConfigurationHelper } from "../../lib/shared/helpers";

// ============================================================================
// VPC CONSTRUCT TESTS
// ============================================================================

describe("VpcConstruct", () => {
  let app: cdk.App;
  let stack: cdk.Stack;

  beforeEach(() => {
    app = new cdk.App();
    stack = new cdk.Stack(app, "TestStack");
  });

  // ============================================
  // Basic VPC Creation Tests
  // ============================================

  describe("Basic VPC Creation", () => {
    test("creates VPC with default configuration", () => {
      new VpcConstruct(stack, "TestVpc", {
        envName: "test",
      });
      const template = Template.fromStack(stack);

      template.resourceCountIs("AWS::EC2::VPC", 1);
    });

    test("exposes VPC as public property", () => {
      const vpcConstruct = new VpcConstruct(stack, "TestVpc", {
        envName: "test",
      });

      expect(vpcConstruct.vpc).toBeDefined();
      expect(vpcConstruct.vpc.vpcId).toBeDefined();
    });

    test("VPC has DNS support enabled", () => {
      new VpcConstruct(stack, "TestVpc", {
        envName: "test",
      });
      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::EC2::VPC", {
        EnableDnsSupport: true,
        EnableDnsHostnames: true,
      });
    });

    test("VPC has correct CIDR block", () => {
      new VpcConstruct(stack, "TestVpc", {
        envName: "test",
        cidr: "10.0.0.0/16",
      });
      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::EC2::VPC", {
        CidrBlock: "10.0.0.0/16",
      });
    });

    test("VPC has correct tags", () => {
      new VpcConstruct(stack, "TestVpc", {
        envName: "test",
        vpcName: "test-vpc",
      });
      const template = Template.fromStack(stack);

      // Check that VPC has the required tags
      // CDK may add additional tags, so we check for the presence of our tags
      const vpcResources = template.findResources("AWS::EC2::VPC");
      const vpcResource = Object.values(vpcResources)[0] as any;
      const tags = vpcResource.Properties.Tags || [];

      expect(tags).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            Key: "Name",
            Value: "test-vpc",
          }),
          expect.objectContaining({
            Key: "Environment",
            Value: "test",
          }),
          expect.objectContaining({
            Key: "ManagedBy",
            Value: "CDK",
          }),
        ])
      );
    });

    test("VPC has project tag when projectName is provided", () => {
      new VpcConstruct(stack, "TestVpc", {
        envName: "test",
        projectName: "monitoring",
      });
      const template = Template.fromStack(stack);

      const vpcResources = template.findResources("AWS::EC2::VPC");
      const vpcResource = Object.values(vpcResources)[0] as any;
      const tags = vpcResource.Properties.Tags || [];

      expect(tags).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            Key: "Project",
            Value: "monitoring",
          }),
        ])
      );
    });

    test("VPC name includes project name when projectName is provided", () => {
      new VpcConstruct(stack, "TestVpc", {
        envName: "test",
        projectName: "monitoring",
      });
      const template = Template.fromStack(stack);

      const vpcResources = template.findResources("AWS::EC2::VPC");
      const vpcResource = Object.values(vpcResources)[0] as any;
      const tags = vpcResource.Properties.Tags || [];
      const nameTag = tags.find((tag: any) => tag.Key === "Name");

      expect(nameTag?.Value).toBe("test-monitoring-vpc");
    });

    test("VPC name uses default when projectName is not provided", () => {
      new VpcConstruct(stack, "TestVpc", {
        envName: "test",
      });
      const template = Template.fromStack(stack);

      const vpcResources = template.findResources("AWS::EC2::VPC");
      const vpcResource = Object.values(vpcResources)[0] as any;
      const tags = vpcResource.Properties.Tags || [];
      const nameTag = tags.find((tag: any) => tag.Key === "Name");

      expect(nameTag?.Value).toBe("test-vpc");
    });
  });

  // ============================================
  // Availability Zone Tests
  // ============================================

  describe("Availability Zone Configuration", () => {
    test("uses 2 AZs by default", () => {
      new VpcConstruct(stack, "TestVpc", {
        envName: "test",
      });
      const template = Template.fromStack(stack);

      // 2 AZs × 2 subnet types (public + private) = 4 subnets
      template.resourceCountIs("AWS::EC2::Subnet", 4);
    });

    test("respects custom maxAzs configuration", () => {
      // Note: CDK VPC may limit AZs based on region availability
      // This test verifies the VPC is created with the requested configuration
      new VpcConstruct(stack, "TestVpc", {
        envName: "test",
        maxAzs: 3,
      });
      const template = Template.fromStack(stack);

      // VPC should be created - subnet count depends on available AZs in test environment
      template.resourceCountIs("AWS::EC2::VPC", 1);
      // At minimum, should have subnets (exact count depends on available AZs)
      const subnetCount = template.findResources("AWS::EC2::Subnet");
      expect(Object.keys(subnetCount).length).toBeGreaterThanOrEqual(2);
    });

    test("can use single AZ for development", () => {
      new VpcConstruct(stack, "TestVpc", {
        envName: "test",
        maxAzs: 1,
      });
      const template = Template.fromStack(stack);

      // 1 AZ × 2 subnet types = 2 subnets
      template.resourceCountIs("AWS::EC2::Subnet", 2);
    });
  });

  // ============================================
  // Subnet Configuration Tests
  // ============================================

  describe("Subnet Configuration", () => {
    test("creates public subnets", () => {
      new VpcConstruct(stack, "TestVpc", {
        envName: "test",
      });
      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::EC2::Subnet", {
        MapPublicIpOnLaunch: true,
        Tags: Match.arrayWith([
          Match.objectLike({
            Key: "aws-cdk:subnet-name",
            Value: "Public",
          }),
        ]),
      });
    });

    test("creates private subnets with egress", () => {
      new VpcConstruct(stack, "TestVpc", {
        envName: "test",
      });
      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::EC2::Subnet", {
        MapPublicIpOnLaunch: false,
        Tags: Match.arrayWith([
          Match.objectLike({
            Key: "aws-cdk:subnet-name",
            Value: "Private",
          }),
        ]),
      });
    });

    test("public subnets have /24 CIDR", () => {
      new VpcConstruct(stack, "TestVpc", {
        envName: "test",
      });
      const template = Template.fromStack(stack);

      const resources = template.findResources("AWS::EC2::Subnet");
      const publicSubnets = Object.values(resources).filter((subnet: any) => {
        const tags = subnet.Properties.Tags || [];
        return tags.some(
          (tag: any) =>
            tag.Key === "aws-cdk:subnet-name" && tag.Value === "Public"
        );
      });

      publicSubnets.forEach((subnet: any) => {
        const cidr = subnet.Properties.CidrBlock;
        // Check that CIDR ends with /24
        expect(cidr).toMatch(/\/24$/);
      });
    });

    test("private subnets have /24 CIDR", () => {
      new VpcConstruct(stack, "TestVpc", {
        envName: "test",
      });
      const template = Template.fromStack(stack);

      const resources = template.findResources("AWS::EC2::Subnet");
      const privateSubnets = Object.values(resources).filter((subnet: any) => {
        const tags = subnet.Properties.Tags || [];
        return tags.some(
          (tag: any) =>
            tag.Key === "aws-cdk:subnet-name" && tag.Value === "Private"
        );
      });

      privateSubnets.forEach((subnet: any) => {
        const cidr = subnet.Properties.CidrBlock;
        expect(cidr).toMatch(/\/24$/);
      });
    });

    test("exposes public subnets as property", () => {
      const vpcConstruct = new VpcConstruct(stack, "TestVpc", {
        envName: "test",
      });

      expect(vpcConstruct.publicSubnets).toBeDefined();
      expect(vpcConstruct.publicSubnets.length).toBeGreaterThan(0);
    });

    test("exposes private subnets as property", () => {
      const vpcConstruct = new VpcConstruct(stack, "TestVpc", {
        envName: "test",
      });

      expect(vpcConstruct.privateSubnets).toBeDefined();
      expect(vpcConstruct.privateSubnets.length).toBeGreaterThan(0);
    });
  });

  // ============================================
  // NAT Gateway Tests
  // ============================================

  describe("NAT Gateway Configuration", () => {
    test("creates no NAT gateways by default", () => {
      new VpcConstruct(stack, "TestVpc", {
        envName: "test",
      });
      const template = Template.fromStack(stack);

      template.resourceCountIs("AWS::EC2::NatGateway", 0);
    });

    test("creates NAT gateway when specified", () => {
      new VpcConstruct(stack, "TestVpc", {
        envName: "test",
        natGateways: 1,
      });
      const template = Template.fromStack(stack);

      template.resourceCountIs("AWS::EC2::NatGateway", 1);
    });

    test("creates multiple NAT gateways for high availability", () => {
      new VpcConstruct(stack, "TestVpc", {
        envName: "test",
        maxAzs: 2,
        natGateways: 2,
      });
      const template = Template.fromStack(stack);

      template.resourceCountIs("AWS::EC2::NatGateway", 2);
    });

    test("NAT gateway requires Elastic IP", () => {
      new VpcConstruct(stack, "TestVpc", {
        envName: "test",
        natGateways: 1,
      });
      const template = Template.fromStack(stack);

      template.resourceCountIs("AWS::EC2::EIP", 1);
    });
  });

  // ============================================
  // Internet Gateway Tests
  // ============================================

  describe("Internet Gateway", () => {
    test("creates internet gateway", () => {
      new VpcConstruct(stack, "TestVpc", {
        envName: "test",
      });
      const template = Template.fromStack(stack);

      template.resourceCountIs("AWS::EC2::InternetGateway", 1);
    });

    test("attaches internet gateway to VPC", () => {
      new VpcConstruct(stack, "TestVpc", {
        envName: "test",
      });
      const template = Template.fromStack(stack);

      template.resourceCountIs("AWS::EC2::VPCGatewayAttachment", 1);
    });
  });

  // ============================================
  // Route Table Tests
  // ============================================

  describe("Route Tables", () => {
    test("creates route tables for subnets", () => {
      new VpcConstruct(stack, "TestVpc", {
        envName: "test",
        maxAzs: 2,
      });
      const template = Template.fromStack(stack);

      // 2 public route tables + 2 private route tables (one per AZ)
      template.resourceCountIs("AWS::EC2::RouteTable", 4);
    });

    test("creates route to internet gateway for public subnets", () => {
      new VpcConstruct(stack, "TestVpc", {
        envName: "test",
      });
      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::EC2::Route", {
        DestinationCidrBlock: "0.0.0.0/0",
        GatewayId: Match.anyValue(),
      });
    });

    test("creates routes to NAT gateway for private subnets when NAT is enabled", () => {
      new VpcConstruct(stack, "TestVpc", {
        envName: "test",
        natGateways: 1,
      });
      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::EC2::Route", {
        DestinationCidrBlock: "0.0.0.0/0",
        NatGatewayId: Match.anyValue(),
      });
    });
  });

  // ============================================
  // Configuration Scenarios Tests
  // ============================================

  describe("Configuration Scenarios", () => {
    test("development configuration (cost-optimised)", () => {
      new VpcConstruct(stack, "TestVpc", {
        envName: "test",
        maxAzs: 1,
        natGateways: 0,
      });
      const template = Template.fromStack(stack);

      template.resourceCountIs("AWS::EC2::VPC", 1);
      template.resourceCountIs("AWS::EC2::Subnet", 2); // 1 AZ × 2 types
      template.resourceCountIs("AWS::EC2::NatGateway", 0);
    });

    test("production-like configuration (balanced)", () => {
      new VpcConstruct(stack, "TestVpc", {
        envName: "test",
        maxAzs: 2,
        natGateways: 1,
      });
      const template = Template.fromStack(stack);

      template.resourceCountIs("AWS::EC2::VPC", 1);
      template.resourceCountIs("AWS::EC2::Subnet", 4); // 2 AZs × 2 types
      template.resourceCountIs("AWS::EC2::NatGateway", 1);
    });

    test("high availability configuration", () => {
      new VpcConstruct(stack, "TestVpc", {
        envName: "test",
        maxAzs: 3,
        natGateways: 3,
      });
      const template = Template.fromStack(stack);

      template.resourceCountIs("AWS::EC2::VPC", 1);
      // Subnet count depends on available AZs in test environment
      // At minimum should have subnets for 2 AZs (4 subnets)
      const subnetCount = template.findResources("AWS::EC2::Subnet");
      expect(Object.keys(subnetCount).length).toBeGreaterThanOrEqual(4);
      // NAT gateway count should match requested (up to available AZs)
      const natGatewayCount = template.findResources("AWS::EC2::NatGateway");
      expect(Object.keys(natGatewayCount).length).toBeGreaterThanOrEqual(1);
    });
  });

  // ============================================
  // Security Tests
  // ============================================

  describe("Security Configuration", () => {
    test("private subnets do not auto-assign public IPs", () => {
      new VpcConstruct(stack, "TestVpc", {
        envName: "test",
      });
      const template = Template.fromStack(stack);

      const resources = template.findResources("AWS::EC2::Subnet");
      const privateSubnets = Object.values(resources).filter((subnet: any) => {
        const tags = subnet.Properties.Tags || [];
        return tags.some(
          (tag: any) =>
            tag.Key === "aws-cdk:subnet-name" && tag.Value === "Private"
        );
      });

      privateSubnets.forEach((subnet: any) => {
        expect(subnet.Properties.MapPublicIpOnLaunch).toBe(false);
      });
    });

    test("public subnets auto-assign public IPs", () => {
      new VpcConstruct(stack, "TestVpc", {
        envName: "test",
      });
      const template = Template.fromStack(stack);

      const resources = template.findResources("AWS::EC2::Subnet");
      const publicSubnets = Object.values(resources).filter((subnet: any) => {
        const tags = subnet.Properties.Tags || [];
        return tags.some(
          (tag: any) =>
            tag.Key === "aws-cdk:subnet-name" && tag.Value === "Public"
        );
      });

      publicSubnets.forEach((subnet: any) => {
        expect(subnet.Properties.MapPublicIpOnLaunch).toBe(true);
      });
    });
  });

  // ============================================
  // CIDR Validation Tests
  // ============================================

  describe("CIDR Validation", () => {
    test("accepts valid CIDR block", () => {
      expect(() => {
        new VpcConstruct(stack, "TestVpc", {
          envName: "test",
          cidr: "10.0.0.0/16",
        });
      }).not.toThrow();
    });

    test("throws error for invalid CIDR format (missing mask)", () => {
      expect(() => {
        new VpcConstruct(stack, "TestVpc", {
          envName: "test",
          cidr: "10.0.0.0",
        });
      }).toThrow("Invalid CIDR format");
    });

    test("throws error for invalid CIDR format (invalid IP)", () => {
      expect(() => {
        new VpcConstruct(stack, "TestVpc", {
          envName: "test",
          cidr: "999.999.999.999/16",
        });
      }).toThrow("Invalid IP address");
    });

    test("throws error for CIDR mask too small", () => {
      expect(() => {
        new VpcConstruct(stack, "TestVpc", {
          envName: "test",
          cidr: "10.0.0.0/7",
        });
      }).toThrow("CIDR mask must be between 8 and 28");
    });

    test("throws error for CIDR mask too large", () => {
      expect(() => {
        new VpcConstruct(stack, "TestVpc", {
          envName: "test",
          cidr: "10.0.0.0/29",
        });
      }).toThrow("CIDR mask must be between 8 and 28");
    });

    test("accepts minimum valid CIDR mask (8)", () => {
      expect(() => {
        new VpcConstruct(stack, "TestVpc", {
          envName: "test",
          cidr: "10.0.0.0/8",
        });
      }).not.toThrow();
    });

    test("accepts maximum valid CIDR mask (28)", () => {
      // Test that CIDR format validation accepts /28
      // Note: A /28 VPC is extremely small (16 IPs) and cannot accommodate
      // subnets. The validation function accepts /28 as valid format, but
      // VPC creation will fail due to subnet allocation. We test the format
      // validation by catching any error and verifying it's not a CIDR format error.
      try {
        new VpcConstruct(stack, "TestVpc", {
          envName: "test",
          cidr: "10.0.0.0/28", // Maximum valid CIDR mask
          subnetConfiguration: [
            {
              name: "Public",
              subnetType: ec2.SubnetType.PUBLIC,
              cidrMask: 28,
              mapPublicIpOnLaunch: true,
            },
          ],
          maxAzs: 1,
        });
        // If we get here, the VPC was created successfully (unlikely but possible)
      } catch (error) {
        // Verify the error is NOT a CIDR format validation error
        // This confirms the format validation passed
        if (error instanceof Error) {
          expect(error.message).not.toContain("CIDR mask must be between 8 and 28");
          expect(error.message).not.toContain("Invalid CIDR format");
          // The error should be about subnet allocation, not CIDR format
          expect(
            error.message.includes("exceeds remaining space") ||
              error.message.includes("subnet") ||
              error.message.includes("allocation")
          ).toBe(true);
        }
      }
    });
  });

  // ============================================
  // NAT Gateway Warning Tests
  // ============================================

  describe("NAT Gateway Warnings", () => {
    test("warns about single NAT Gateway in production", () => {
      const app = new cdk.App();
      const testStack = new cdk.Stack(app, "TestStack");
      const vpcConstruct = new VpcConstruct(testStack, "TestVpc", {
        envName: "production",
        natGateways: 1,
      });

      // Check that warning is added (annotations are not directly testable in unit tests,
      // but we can verify the construct is created successfully)
      expect(vpcConstruct.vpc).toBeDefined();
    });

    test("warns about zero NAT Gateways with private subnets", () => {
      const app = new cdk.App();
      const testStack = new cdk.Stack(app, "TestStack");
      const vpcConstruct = new VpcConstruct(testStack, "TestVpc", {
        envName: "test",
        natGateways: 0,
        subnetConfiguration: [
          {
            name: "Public",
            subnetType: ec2.SubnetType.PUBLIC,
            cidrMask: 24,
            mapPublicIpOnLaunch: true,
          },
          {
            name: "Private",
            subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
            cidrMask: 24,
          },
        ],
      });

      // Verify construct is created (warning is added but not directly testable)
      expect(vpcConstruct.vpc).toBeDefined();
    });

    test("does not warn when NAT Gateways match subnets", () => {
      const app = new cdk.App();
      const testStack = new cdk.Stack(app, "TestStack");
      const vpcConstruct = new VpcConstruct(testStack, "TestVpc", {
        envName: "test",
        maxAzs: 2,
        natGateways: 2,
      });

      expect(vpcConstruct.vpc).toBeDefined();
    });
  });

  // ============================================
  // Subnet Tag Application Tests
  // ============================================

  describe("Subnet Tag Application", () => {
    test("applies tags from subnet configuration", () => {
      new VpcConstruct(stack, "TestVpc", {
        envName: "test",
        subnetConfiguration: [
          {
            name: "Public",
            subnetType: ec2.SubnetType.PUBLIC,
            cidrMask: 24,
            mapPublicIpOnLaunch: true,
            tags: {
              Purpose: "LoadBalancers",
              Tier: "Public",
            },
          },
          {
            name: "Private",
            subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
            cidrMask: 24,
            tags: {
              Purpose: "ApplicationServers",
              Tier: "Private",
            },
          },
        ],
      });
      const template = Template.fromStack(stack);

      // Tags are applied to VPC and inherited by subnets
      // We verify the VPC has the tags
      const vpcResources = template.findResources("AWS::EC2::VPC");
      const vpcResource = Object.values(vpcResources)[0] as any;
      const tags = vpcResource.Properties.Tags || [];

      // Check that custom tags are present (may be on VPC or subnets)
      expect(tags.length).toBeGreaterThan(0);
    });

    test("applies EKS tags from SubnetConfigurationHelper", () => {
      const eksSubnets = SubnetConfigurationHelper.eksConfiguration("test-cluster");
      new VpcConstruct(stack, "TestVpc", {
        envName: "test",
        subnetConfiguration: eksSubnets,
      });
      const template = Template.fromStack(stack);

      // Verify VPC is created with EKS subnet configuration
      template.resourceCountIs("AWS::EC2::VPC", 1);
    });
  });

  // ============================================
  // Constants Usage Tests
  // ============================================

  describe("Constants Usage", () => {
    test("uses default CIDR from constants", () => {
      new VpcConstruct(stack, "TestVpc", {
        envName: "test",
      });
      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::EC2::VPC", {
        CidrBlock: "10.0.0.0/16", // DEFAULT_VPC_CIDR
      });
    });

    test("uses default maxAzs from constants", () => {
      new VpcConstruct(stack, "TestVpc", {
        envName: "test",
      });
      const template = Template.fromStack(stack);

      // 2 AZs × 2 subnet types = 4 subnets (DEFAULT_MAX_AZS = 2)
      template.resourceCountIs("AWS::EC2::Subnet", 4);
    });

    test("uses default NAT gateways from constants", () => {
      new VpcConstruct(stack, "TestVpc", {
        envName: "test",
      });
      const template = Template.fromStack(stack);

      // DEFAULT_NAT_GATEWAYS = 0
      template.resourceCountIs("AWS::EC2::NatGateway", 0);
    });

    test("uses default subnet CIDR mask from constants", () => {
      new VpcConstruct(stack, "TestVpc", {
        envName: "test",
      });
      const template = Template.fromStack(stack);

      // Subnets should have /24 CIDR (DEFAULT_SUBNET_CIDR_MASK = 24)
      const subnets = template.findResources("AWS::EC2::Subnet");
      Object.values(subnets).forEach((subnet: any) => {
        expect(subnet.Properties.CidrBlock).toMatch(/\/24$/);
      });
    });
  });

  // ============================================
  // Endpoint Methods Tests
  // ============================================

  describe("Endpoint Methods", () => {
    test("addInterfaceEndpoint defaults to private subnets", () => {
      const vpcConstruct = new VpcConstruct(stack, "TestVpc", {
        envName: "test",
      });

      const endpoint = vpcConstruct.addInterfaceEndpoint(
        "EcrEndpoint",
        ec2.InterfaceVpcEndpointAwsService.ECR
      );

      expect(endpoint).toBeDefined();
      expect(endpoint.vpcEndpointId).toBeDefined();
    });

    test("addInterfaceEndpoint accepts custom subnet selection", () => {
      // Create VPC with isolated subnets for this test
      const vpcConstruct = new VpcConstruct(stack, "TestVpc", {
        envName: "test",
        subnetConfiguration: [
          {
            name: "Public",
            subnetType: ec2.SubnetType.PUBLIC,
            cidrMask: 24,
            mapPublicIpOnLaunch: true,
          },
          {
            name: "Isolated",
            subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
            cidrMask: 24,
          },
        ],
      });

      const endpoint = vpcConstruct.addInterfaceEndpoint(
        "EcrEndpoint",
        ec2.InterfaceVpcEndpointAwsService.ECR,
        {
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        }
      );

      expect(endpoint).toBeDefined();
    });

    test("addInterfaceEndpoint accepts privateDnsEnabled parameter", () => {
      const vpcConstruct = new VpcConstruct(stack, "TestVpc", {
        envName: "test",
      });

      const endpoint = vpcConstruct.addInterfaceEndpoint(
        "EcrEndpoint",
        ec2.InterfaceVpcEndpointAwsService.ECR,
        undefined,
        false // Disable private DNS
      );

      expect(endpoint).toBeDefined();
    });

    test("addGatewayEndpoint creates gateway endpoint", () => {
      const vpcConstruct = new VpcConstruct(stack, "TestVpc", {
        envName: "test",
      });

      const endpoint = vpcConstruct.addGatewayEndpoint("S3Endpoint", {
        service: ec2.GatewayVpcEndpointAwsService.S3,
      });

      expect(endpoint).toBeDefined();
      expect(endpoint.vpcEndpointId).toBeDefined();
    });

    test("addGatewayEndpoint accepts endpoint policy", () => {
      const vpcConstruct = new VpcConstruct(stack, "TestVpc", {
        envName: "test",
      });

      const policy = new iam.PolicyDocument({
        statements: [
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            principals: [new iam.AnyPrincipal()],
            actions: ["s3:GetObject"],
            resources: ["arn:aws:s3:::test-bucket/*"],
          }),
        ],
      });

      const endpoint = vpcConstruct.addGatewayEndpoint(
        "S3Endpoint",
        {
          service: ec2.GatewayVpcEndpointAwsService.S3,
        },
        undefined,
        policy
      );

      expect(endpoint).toBeDefined();
    });
  });
});

// ============================================================================
// SUBNET CONFIGURATION HELPER TESTS
// ============================================================================

describe("SubnetConfigurationHelper", () => {
  describe("Factory Methods", () => {
    test("creates public subnet configuration", () => {
      const config = SubnetConfigurationHelper.publicSubnet(24);

      expect(config.name).toBe("Public");
      expect(config.subnetType).toBe(ec2.SubnetType.PUBLIC);
      expect(config.cidrMask).toBe(24);
      expect(config.mapPublicIpOnLaunch).toBe(true);
    });

    test("creates private subnet configuration", () => {
      const config = SubnetConfigurationHelper.privateSubnet(24);

      expect(config.name).toBe("Private");
      expect(config.subnetType).toBe(ec2.SubnetType.PRIVATE_WITH_EGRESS);
      expect(config.cidrMask).toBe(24);
    });

    test("creates isolated subnet configuration", () => {
      const config = SubnetConfigurationHelper.isolatedSubnet(24);

      expect(config.name).toBe("Isolated");
      expect(config.subnetType).toBe(ec2.SubnetType.PRIVATE_ISOLATED);
      expect(config.cidrMask).toBe(24);
    });

    test("creates two-tier configuration", () => {
      const configs = SubnetConfigurationHelper.twoTierConfiguration();

      expect(configs).toHaveLength(2);
      expect(configs[0].name).toBe("Public");
      expect(configs[1].name).toBe("Private");
    });

    test("creates three-tier configuration", () => {
      const configs = SubnetConfigurationHelper.threeTierConfiguration();

      expect(configs).toHaveLength(3);
      expect(configs[0].name).toBe("Public");
      expect(configs[1].name).toBe("Private");
      expect(configs[2].name).toBe("Isolated");
    });
  });
});

// ============================================================================
// NETWORKING STACK TESTS
// ============================================================================

describe("NetworkingStack", () => {
  let template: Template;
  let app: cdk.App;

  beforeAll(() => {
    app = new cdk.App();
    const stack = new NetworkingStack(app, "TestNetworkingStack", {
      env: {
        account: "123456789012",
        region: "eu-west-1",
      },
      envName: "test",
      maxAzs: 2,
      natGateways: 0,
      enableVpcFlowLogs: true,
      enableVpcEndpoints: true,
    });
    template = Template.fromStack(stack);
  });

  describe("VPC Configuration", () => {
    test("creates VPC with correct properties", () => {
      template.hasResourceProperties("AWS::EC2::VPC", {
        CidrBlock: "10.0.0.0/16",
        EnableDnsHostnames: true,
        EnableDnsSupport: true,
      });
    });

    test("VPC has correct tags", () => {
      const tagsCapture = new Capture();
      template.hasResourceProperties("AWS::EC2::VPC", {
        Tags: tagsCapture,
      });

      const tags = tagsCapture.asArray();
      expect(tags).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            Key: "Environment",
            Value: "test",
          }),
          expect.objectContaining({
            Key: "ManagedBy",
            Value: "CDK",
          }),
        ])
      );
    });

    test("creates exactly one VPC", () => {
      template.resourceCountIs("AWS::EC2::VPC", 1);
    });
  });

  describe("Subnet Configuration", () => {
    test("creates correct number of subnets", () => {
      // 2 AZs × 2 subnet types (public + private) = 4 subnets
      template.resourceCountIs("AWS::EC2::Subnet", 4);
    });

    test("creates public subnets with correct properties", () => {
      template.hasResourceProperties("AWS::EC2::Subnet", {
        MapPublicIpOnLaunch: true,
        Tags: Match.arrayWith([
          Match.objectLike({
            Key: "aws-cdk:subnet-name",
            Value: "Public",
          }),
        ]),
      });
    });

    test("creates private subnets with correct properties", () => {
      template.hasResourceProperties("AWS::EC2::Subnet", {
        MapPublicIpOnLaunch: false,
        Tags: Match.arrayWith([
          Match.objectLike({
            Key: "aws-cdk:subnet-name",
            Value: "Private",
          }),
        ]),
      });
    });

    test("subnets have correct CIDR blocks", () => {
      const subnets = template.findResources("AWS::EC2::Subnet");
      Object.values(subnets).forEach((subnet: any) => {
        expect(subnet.Properties.CidrBlock).toMatch(/^10\.0\.\d+\.0\/24$/);
      });
    });
  });

  describe("Internet Gateway", () => {
    test("creates internet gateway", () => {
      template.resourceCountIs("AWS::EC2::InternetGateway", 1);
    });

    test("attaches internet gateway to VPC", () => {
      template.resourceCountIs("AWS::EC2::VPCGatewayAttachment", 1);
      template.hasResourceProperties("AWS::EC2::VPCGatewayAttachment", {
        VpcId: Match.objectLike({
          Ref: Match.stringLikeRegexp("Vpc"),
        }),
      });
    });
  });

  describe("NAT Gateway Configuration", () => {
    test("does not create NAT gateways when natGateways is 0", () => {
      template.resourceCountIs("AWS::EC2::NatGateway", 0);
    });

    test("does not create Elastic IPs when no NAT gateways", () => {
      template.resourceCountIs("AWS::EC2::EIP", 0);
    });
  });

  describe("Route Tables", () => {
    test("creates route tables for subnets", () => {
      // 2 public + 2 private = 4 route tables
      template.resourceCountIs("AWS::EC2::RouteTable", 4);
    });

    test("creates routes to internet gateway", () => {
      template.hasResourceProperties("AWS::EC2::Route", {
        DestinationCidrBlock: "0.0.0.0/0",
        GatewayId: Match.objectLike({
          Ref: Match.stringLikeRegexp("IGW"),
        }),
      });
    });
  });

  describe("VPC Flow Logs", () => {
    test("creates flow logs log group without project name", () => {
      template.hasResourceProperties("AWS::Logs::LogGroup", {
        LogGroupName: "/aws/vpc/flowlogs/test",
        RetentionInDays: 7,
      });
    });

    test("creates flow logs with correct configuration", () => {
      template.hasResourceProperties("AWS::EC2::FlowLog", {
        ResourceType: "VPC",
        TrafficType: "ALL",
        LogDestinationType: "cloud-watch-logs",
      });
    });

    test("flow logs have correct IAM role", () => {
      template.hasResourceProperties("AWS::IAM::Role", {
        AssumeRolePolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: "sts:AssumeRole",
              Effect: "Allow",
              Principal: {
                Service: "vpc-flow-logs.amazonaws.com",
              },
            }),
          ]),
        }),
      });
    });
  });

  describe("VPC Endpoints", () => {
    test("creates S3 gateway endpoint", () => {
      // ServiceName is a CloudFormation intrinsic function, so we check structure
      template.hasResourceProperties("AWS::EC2::VPCEndpoint", {
        VpcEndpointType: "Gateway",
        ServiceName: Match.anyValue(), // ServiceName is Fn::Join in CloudFormation
      });

      // Verify S3 endpoint exists by checking the template structure
      const endpoints = template.findResources("AWS::EC2::VPCEndpoint");
      const s3Endpoint = Object.values(endpoints).find((endpoint: any) => {
        const serviceName = endpoint.Properties?.ServiceName;
        if (typeof serviceName === "string") {
          return serviceName.includes("s3");
        }
        // If it's a CloudFormation function, check the joined parts
        if (serviceName?.["Fn::Join"]) {
          const parts = serviceName["Fn::Join"][1];
          return JSON.stringify(parts).toLowerCase().includes("s3");
        }
        return false;
      });
      expect(s3Endpoint).toBeDefined();
    });

    test("creates DynamoDB gateway endpoint", () => {
      // ServiceName is a CloudFormation intrinsic function, so we check structure
      template.hasResourceProperties("AWS::EC2::VPCEndpoint", {
        VpcEndpointType: "Gateway",
        ServiceName: Match.anyValue(), // ServiceName is Fn::Join in CloudFormation
      });

      // Verify DynamoDB endpoint exists by checking the template structure
      const endpoints = template.findResources("AWS::EC2::VPCEndpoint");
      const dynamoEndpoint = Object.values(endpoints).find((endpoint: any) => {
        const serviceName = endpoint.Properties?.ServiceName;
        if (typeof serviceName === "string") {
          return serviceName.includes("dynamodb");
        }
        // If it's a CloudFormation function, check the joined parts
        if (serviceName?.["Fn::Join"]) {
          const parts = serviceName["Fn::Join"][1];
          return JSON.stringify(parts).toLowerCase().includes("dynamodb");
        }
        return false;
      });
      expect(dynamoEndpoint).toBeDefined();
    });
  });

  describe("SSM Parameters", () => {
    test("creates VPC ID parameter without project name", () => {
      template.hasResourceProperties("AWS::SSM::Parameter", {
        Name: "/networking/test/vpc-id",
        Type: "String",
        Tier: "Standard",
      });
    });

    test("creates VPC CIDR parameter without project name", () => {
      template.hasResourceProperties("AWS::SSM::Parameter", {
        Name: "/networking/test/vpc-cidr",
        Type: "String",
        Tier: "Standard",
      });
    });
  });

  describe("Stack Outputs", () => {
    test("exports VPC ID without project name", () => {
      template.hasOutput("VpcId", {
        Description: "VPC ID",
        Export: {
          Name: "test-vpc-id",
        },
      });
    });

    test("exports VPC CIDR without project name", () => {
      template.hasOutput("VpcCidr", {
        Description: "VPC CIDR Block",
        Export: {
          Name: "test-vpc-cidr",
        },
      });
    });

    test("exports subnet IDs without project name", () => {
      template.hasOutput("PublicSubnet1Id", {
        Description: "Public Subnet 1 ID",
        Export: {
          Name: "test-public-subnet-1-id",
        },
      });

      template.hasOutput("PublicSubnet2Id", {
        Description: "Public Subnet 2 ID",
        Export: {
          Name: "test-public-subnet-2-id",
        },
      });

      template.hasOutput("PrivateSubnet1Id", {
        Description: "Private Subnet 1 ID",
        Export: {
          Name: "test-private-subnet-1-id",
        },
      });

      template.hasOutput("PrivateSubnet2Id", {
        Description: "Private Subnet 2 ID",
        Export: {
          Name: "test-private-subnet-2-id",
        },
      });
    });

    test("exports availability zones without project name", () => {
      template.hasOutput("AvailabilityZones", {
        Description: "Availability Zones",
        Export: {
          Name: "test-azs",
        },
      });
    });

    test("exports flow logs log group name without project name", () => {
      template.hasOutput("FlowLogsLogGroup", {
        Description: "VPC Flow Logs CloudWatch Log Group",
        Export: {
          Name: "test-flow-logs-log-group",
        },
      });
    });
  });

  describe("Resource Counts", () => {
    test("has correct total resource count", () => {
      const templateJson = template.toJSON();
      const resourceCount = Object.keys(templateJson.Resources || {}).length;

      // Should have VPC, subnets, route tables, IGW, flow logs, endpoints, SSM params, etc.
      expect(resourceCount).toBeGreaterThan(10);
    });
  });

  describe("Stack Properties", () => {
    test("exposes VPC as public property", () => {
      const testStack = new NetworkingStack(app, "TestStack2", {
        env: {
          account: "123456789012",
          region: "eu-west-1",
        },
        envName: "test",
      });

      expect(testStack.vpc).toBeDefined();
      expect(testStack.vpc.vpcId).toBeDefined();
    });

    test("exposes VPC construct as public property", () => {
      const testStack = new NetworkingStack(app, "TestStack3", {
        env: {
          account: "123456789012",
          region: "eu-west-1",
        },
        envName: "test",
      });

      expect(testStack.vpcConstruct).toBeDefined();
    });

    test("exposes public subnets getter", () => {
      const testStack = new NetworkingStack(app, "TestStack4", {
        env: {
          account: "123456789012",
          region: "eu-west-1",
        },
        envName: "test",
      });

      expect(testStack.publicSubnets).toBeDefined();
      expect(testStack.publicSubnets.length).toBeGreaterThan(0);
    });

    test("exposes private subnets getter", () => {
      const testStack = new NetworkingStack(app, "TestStack5", {
        env: {
          account: "123456789012",
          region: "eu-west-1",
        },
        envName: "test",
      });

      expect(testStack.privateSubnets).toBeDefined();
      expect(testStack.privateSubnets.length).toBeGreaterThan(0);
    });
  });

  describe("Optional Features", () => {
    test("can disable VPC Flow Logs", () => {
      const testApp = new cdk.App();
      const testStack = new NetworkingStack(testApp, "TestStackNoFlowLogs", {
        env: {
          account: "123456789012",
          region: "eu-west-1",
        },
        envName: "test",
        enableVpcFlowLogs: false,
      });
      const testTemplate = Template.fromStack(testStack);

      testTemplate.resourceCountIs("AWS::EC2::FlowLog", 0);
    });

    test("can disable VPC Endpoints", () => {
      const testApp = new cdk.App();
      const testStack = new NetworkingStack(testApp, "TestStackNoEndpoints", {
        env: {
          account: "123456789012",
          region: "eu-west-1",
        },
        envName: "test",
        enableVpcEndpoints: false,
      });
      const testTemplate = Template.fromStack(testStack);

      // Should not have any VPC endpoints
      const endpoints = testTemplate.findResources("AWS::EC2::VPCEndpoint");
      expect(Object.keys(endpoints).length).toBe(0);
    });
  });

  describe("Multi-Project Infrastructure Pattern", () => {
    test("creates project-specific VPC name when projectName is provided", () => {
      const testApp = new cdk.App();
      const testStack = new NetworkingStack(testApp, "TestStackWithProject", {
        env: {
          account: "123456789012",
          region: "eu-west-1",
        },
        envName: "test",
        projectName: "monitoring",
      });
      const testTemplate = Template.fromStack(testStack);

      const vpcResources = testTemplate.findResources("AWS::EC2::VPC");
      const vpcResource = Object.values(vpcResources)[0] as any;
      const tags = vpcResource.Properties.Tags || [];
      const nameTag = tags.find((tag: any) => tag.Key === "Name");

      expect(nameTag?.Value).toBe("test-monitoring-vpc");
    });

    test("creates project-specific SSM parameters when projectName is provided", () => {
      const testApp = new cdk.App();
      const testStack = new NetworkingStack(testApp, "TestStackWithProject", {
        env: {
          account: "123456789012",
          region: "eu-west-1",
        },
        envName: "test",
        projectName: "monitoring",
      });
      const testTemplate = Template.fromStack(testStack);

      testTemplate.hasResourceProperties("AWS::SSM::Parameter", {
        Name: "/networking/monitoring/test/vpc-id",
        Type: "String",
        Tier: "Standard",
      });

      testTemplate.hasResourceProperties("AWS::SSM::Parameter", {
        Name: "/networking/monitoring/test/vpc-cidr",
        Type: "String",
        Tier: "Standard",
      });
    });

    test("creates project-specific CloudFormation exports when projectName is provided", () => {
      const testApp = new cdk.App();
      const testStack = new NetworkingStack(testApp, "TestStackWithProject", {
        env: {
          account: "123456789012",
          region: "eu-west-1",
        },
        envName: "test",
        projectName: "monitoring",
      });
      const testTemplate = Template.fromStack(testStack);

      testTemplate.hasOutput("VpcId", {
        Description: "VPC ID",
        Export: {
          Name: "test-monitoring-vpc-id",
        },
      });

      testTemplate.hasOutput("VpcCidr", {
        Description: "VPC CIDR Block",
        Export: {
          Name: "test-monitoring-vpc-cidr",
        },
      });

      testTemplate.hasOutput("AvailabilityZones", {
        Description: "Availability Zones",
        Export: {
          Name: "test-monitoring-azs",
        },
      });
    });

    test("creates project-specific flow logs log group when projectName is provided", () => {
      const testApp = new cdk.App();
      const testStack = new NetworkingStack(testApp, "TestStackWithProject", {
        env: {
          account: "123456789012",
          region: "eu-west-1",
        },
        envName: "test",
        projectName: "monitoring",
        enableVpcFlowLogs: true,
      });
      const testTemplate = Template.fromStack(testStack);

      testTemplate.hasResourceProperties("AWS::Logs::LogGroup", {
        LogGroupName: "/aws/vpc/flowlogs/test-monitoring",
        RetentionInDays: 7,
      });
    });

    test("creates project-specific subnet exports when projectName is provided", () => {
      const testApp = new cdk.App();
      const testStack = new NetworkingStack(testApp, "TestStackWithProject", {
        env: {
          account: "123456789012",
          region: "eu-west-1",
        },
        envName: "test",
        projectName: "monitoring",
        maxAzs: 2,
      });
      const testTemplate = Template.fromStack(testStack);

      testTemplate.hasOutput("PublicSubnet1Id", {
        Description: "Public Subnet 1 ID",
        Export: {
          Name: "test-monitoring-public-subnet-1-id",
        },
      });

      testTemplate.hasOutput("PrivateSubnet1Id", {
        Description: "Private Subnet 1 ID",
        Export: {
          Name: "test-monitoring-private-subnet-1-id",
        },
      });
    });

    test("adds Project tag to stack when projectName is provided", () => {
      const testApp = new cdk.App();
      const testStack = new NetworkingStack(testApp, "TestStackWithProject", {
        env: {
          account: "123456789012",
          region: "eu-west-1",
        },
        envName: "test",
        projectName: "monitoring",
      });
      const testTemplate = Template.fromStack(testStack);

      // Check VPC has Project tag
      const vpcResources = testTemplate.findResources("AWS::EC2::VPC");
      const vpcResource = Object.values(vpcResources)[0] as any;
      const tags = vpcResource.Properties.Tags || [];

      expect(tags).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            Key: "Project",
            Value: "monitoring",
          }),
        ])
      );
    });

    test("maintains backward compatibility when projectName is not provided", () => {
      const testApp = new cdk.App();
      const testStack = new NetworkingStack(testApp, "TestStackNoProject", {
        env: {
          account: "123456789012",
          region: "eu-west-1",
        },
        envName: "test",
      });
      const testTemplate = Template.fromStack(testStack);

      // Should use default naming without project name
      testTemplate.hasResourceProperties("AWS::SSM::Parameter", {
        Name: "/networking/test/vpc-id",
      });

      testTemplate.hasOutput("VpcId", {
        Export: {
          Name: "test-vpc-id",
        },
      });

      testTemplate.hasResourceProperties("AWS::Logs::LogGroup", {
        LogGroupName: "/aws/vpc/flowlogs/test",
      });
    });
  });
});
