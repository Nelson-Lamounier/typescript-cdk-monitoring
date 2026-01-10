/** @format */

import * as cdk from "aws-cdk-lib";
import * as logs from "aws-cdk-lib/aws-logs";
import { Template, Match, Capture } from "aws-cdk-lib/assertions";

import { NetworkingStack } from "../../../../lib/stacks/foundation/networking-stack";
import { NetworkingStackProps } from "../../../../lib/shared/types";

// ============================================================================
// TEST CONFIGURATION
// ============================================================================

const TEST_CONFIG = {
  account: "123456789012",
  region: "eu-west-1",
  environments: {
    development: {
      envName: "development",
      expectedCidr: "10.0.0.0/16", // VPC_CIDR_BLOCKS.DEV
    },
    production: {
      envName: "production",
      expectedCidr: "10.2.0.0/16", // VPC_CIDR_BLOCKS.PRODUCTION
    },
    pipeline: {
      envName: "pipeline",
      expectedCidr: "10.10.0.0/16", // VPC_CIDR_BLOCKS.PIPELINE
    },
    staging: {
      envName: "staging",
      expectedCidr: "10.1.0.0/16", // VPC_CIDR_BLOCKS.STAGING
    },
  },
} as const;

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Create a test stack with default test configuration
 */
function createTestStack(
  app: cdk.App,
  id: string,
  props: Partial<NetworkingStackProps> = {}
): NetworkingStack {
  return new NetworkingStack(app, id, {
    env: {
      account: TEST_CONFIG.account,
      region: TEST_CONFIG.region,
    },
    envName: "development",
    ...props,
  });
}

/**
 * Test fixtures for common stack configurations
 */
const fixtures = {
  minimal: (): NetworkingStackProps => ({
    env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
    envName: "development",
  }),

  development: (): NetworkingStackProps => ({
    env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
    envName: "development",
    maxAzs: 2,
    natGateways: 0,
    enableVpcFlowLogs: true,
    flowLogRetention: logs.RetentionDays.THREE_DAYS,
  }),

  production: (): NetworkingStackProps => ({
    env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
    envName: "production",
    maxAzs: 2,
    natGateways: 2,
    enableVpcFlowLogs: true,
    flowLogRetention: logs.RetentionDays.SIX_MONTHS,
    enableVpcEndpoints: true,
  }),

  custom: (
    overrides: Partial<NetworkingStackProps> = {}
  ): NetworkingStackProps => ({
    ...fixtures.minimal(),
    ...overrides,
  }),
};

// ============================================================================
// NETWORKING STACK TESTS
// ============================================================================

describe("NetworkingStack", () => {
  let app: cdk.App;

  beforeEach(() => {
    app = new cdk.App();
  });

  // ============================================================================
  // Basic Stack Creation
  // ============================================================================

  describe("Stack Creation", () => {
    test("creates stack with minimal required properties", () => {
      const stack = new NetworkingStack(app, "TestStack", fixtures.minimal());
      const template = Template.fromStack(stack);

      template.resourceCountIs("AWS::EC2::VPC", 1);
    });

    test("creates stack with all optional properties", () => {
      const stack = createTestStack(app, "TestStack", {
        projectName: "portfolio",
        vpcCidr: "10.1.0.0/16",
        vpcName: "custom-vpc-name",
        maxAzs: 2,
        natGateways: 1,
        enableVpcFlowLogs: true,
        enableVpcEndpoints: true,
        enableDnsHostnames: true,
        enableDnsSupport: true,
        createSsmParameters: true,
        createOutputs: true,
        enableExports: true,
      });

      const template = Template.fromStack(stack);
      template.resourceCountIs("AWS::EC2::VPC", 1);
    });

    test("matches snapshot for minimal configuration", () => {
      const stack = new NetworkingStack(
        app,
        "MinimalStack",
        fixtures.minimal()
      );
      const template = Template.fromStack(stack);

      expect(template.toJSON()).toMatchSnapshot();
    });
  });

  // ============================================================================
  // VPC Configuration (Parameterized)
  // ============================================================================

  describe("VPC Configuration", () => {
    test.each([
      { envName: "development", expectedCidr: "10.0.0.0/16" }, // VPC_CIDR_BLOCKS.DEV
      { envName: "production", expectedCidr: "10.2.0.0/16" }, // VPC_CIDR_BLOCKS.PRODUCTION
      { envName: "pipeline", expectedCidr: "10.10.0.0/16" }, // VPC_CIDR_BLOCKS.PIPELINE
      { envName: "staging", expectedCidr: "10.1.0.0/16" }, // VPC_CIDR_BLOCKS.STAGING
    ])(
      "creates VPC with default CIDR $expectedCidr for $envName",
      ({ envName, expectedCidr }) => {
        const stack = createTestStack(app, `TestStack-${envName}`, { envName });
        const template = Template.fromStack(stack);

        template.hasResourceProperties("AWS::EC2::VPC", {
          CidrBlock: expectedCidr,
          EnableDnsHostnames: true,
          EnableDnsSupport: true,
        });
      }
    );

    test("creates VPC with custom CIDR", () => {
      const stack = createTestStack(app, "TestStack", {
        vpcCidr: "10.99.0.0/16",
      });

      const template = Template.fromStack(stack);
      template.hasResourceProperties("AWS::EC2::VPC", {
        CidrBlock: "10.99.0.0/16",
      });
    });

    test("creates exactly one VPC", () => {
      const stack = createTestStack(app, "TestStack");
      const template = Template.fromStack(stack);

      template.resourceCountIs("AWS::EC2::VPC", 1);
    });

    test("VPC has correct tags", () => {
      const stack = createTestStack(app, "TestStack", {
        projectName: "portfolio",
      });

      const template = Template.fromStack(stack);
      const tagsCapture = new Capture();

      template.hasResourceProperties("AWS::EC2::VPC", {
        Tags: tagsCapture,
      });

      const tags = tagsCapture.asArray();
      expect(tags).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ Key: "Environment", Value: "development" }),
          expect.objectContaining({ Key: "ManagedBy", Value: "CDK" }),
          expect.objectContaining({ Key: "Layer", Value: "Foundation" }),
        ])
      );
    });
  });

  // ============================================================================
  // Subnet Configuration (Parameterized)
  // ============================================================================

  describe("Subnet Configuration", () => {
    test.each([
      { maxAzs: 1, expectedSubnets: 2 },
      { maxAzs: 2, expectedSubnets: 4 },
      { maxAzs: 3, expectedSubnets: 6 },
    ])(
      "creates $expectedSubnets subnets for $maxAzs AZs",
      ({ maxAzs, expectedSubnets }) => {
        const stack = createTestStack(app, `TestStack-${maxAzs}AZ`, { maxAzs });
        const template = Template.fromStack(stack);

        template.resourceCountIs("AWS::EC2::Subnet", expectedSubnets);
      }
    );

    test("creates public subnets with correct properties", () => {
      const stack = createTestStack(app, "TestStack", { maxAzs: 2 });
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

    test("creates private subnets with correct properties", () => {
      const stack = createTestStack(app, "TestStack", { maxAzs: 2 });
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
  });

  // ============================================================================
  // NAT Gateway Configuration (Parameterized)
  // ============================================================================

  describe("NAT Gateway Configuration", () => {
    test.each([
      { natGateways: 0, expectedNat: 0, expectedEip: 0 },
      { natGateways: 1, expectedNat: 1, expectedEip: 1 },
      { natGateways: 2, expectedNat: 2, expectedEip: 2 },
    ])(
      "creates $expectedNat NAT gateways with $expectedEip EIPs when natGateways=$natGateways",
      ({ natGateways, expectedNat, expectedEip }) => {
        const stack = createTestStack(app, `TestStack-NAT${natGateways}`, {
          maxAzs: 2,
          natGateways,
        });
        const template = Template.fromStack(stack);

        template.resourceCountIs("AWS::EC2::NatGateway", expectedNat);
        template.resourceCountIs("AWS::EC2::EIP", expectedEip);
      }
    );

    test("NAT gateways are created in public subnets only", () => {
      const stack = createTestStack(app, "TestStack", {
        maxAzs: 2,
        natGateways: 2,
      });

      const template = Template.fromStack(stack);
      const natGateways = template.findResources("AWS::EC2::NatGateway");
      const subnets = template.findResources("AWS::EC2::Subnet");

      Object.values(natGateways).forEach((nat: any) => {
        const subnetRef = nat.Properties.SubnetId.Ref;
        const subnet = subnets[subnetRef];
        expect(subnet.Properties.MapPublicIpOnLaunch).toBe(true);
      });
    });
  });

  // ============================================================================
  // VPC Flow Logs
  // ============================================================================

  describe("VPC Flow Logs", () => {
    test("creates VPC flow logs when enabled", () => {
      const stack = createTestStack(app, "TestStack", {
        enableVpcFlowLogs: true,
      });

      const template = Template.fromStack(stack);
      template.resourceCountIs("AWS::EC2::FlowLog", 1);
    });

    test("does not create VPC flow logs when disabled", () => {
      const stack = createTestStack(app, "TestStack", {
        enableVpcFlowLogs: false,
      });

      const template = Template.fromStack(stack);
      template.resourceCountIs("AWS::EC2::FlowLog", 0);
    });

    test("creates CloudWatch log group with correct retention", () => {
      const stack = createTestStack(app, "TestStack", {
        enableVpcFlowLogs: true,
        flowLogRetention: logs.RetentionDays.ONE_MONTH,
      });

      const template = Template.fromStack(stack);
      template.hasResourceProperties("AWS::Logs::LogGroup", {
        LogGroupName: Match.stringLikeRegexp("/aws/vpc/flowlogs/development"),
        RetentionInDays: 30,
      });
    });

    test("uses DESTROY removal policy for development", () => {
      const stack = createTestStack(app, "TestStack", {
        envName: "development",
        enableVpcFlowLogs: true,
      });

      const template = Template.fromStack(stack);
      template.hasResource("AWS::Logs::LogGroup", {
        DeletionPolicy: "Delete",
        UpdateReplacePolicy: "Delete",
      });
    });

    test("uses RETAIN removal policy for production", () => {
      const stack = createTestStack(app, "TestStack", {
        envName: "production",
        enableVpcFlowLogs: true,
      });

      const template = Template.fromStack(stack);
      template.hasResource("AWS::Logs::LogGroup", {
        DeletionPolicy: "Retain",
        UpdateReplacePolicy: "Retain",
      });
    });
  });

  // ============================================================================
  // VPC Endpoints
  // ============================================================================

  describe("VPC Endpoints", () => {
    test("creates S3 and DynamoDB gateway endpoints by default", () => {
      const stack = createTestStack(app, "TestStack");
      const template = Template.fromStack(stack);

      const endpoints = template.findResources("AWS::EC2::VPCEndpoint");
      const gatewayEndpoints = Object.values(endpoints).filter(
        (endpoint: any) => endpoint.Properties.VpcEndpointType === "Gateway"
      );

      expect(gatewayEndpoints.length).toBe(2);
    });

    test("does not create VPC endpoints when disabled", () => {
      const stack = createTestStack(app, "TestStack", {
        enableVpcEndpoints: false,
      });

      const template = Template.fromStack(stack);
      template.resourceCountIs("AWS::EC2::VPCEndpoint", 0);
    });
  });

  // ============================================================================
  // SSM Parameters
  // ============================================================================

  describe("SSM Parameters", () => {
    test("creates VPC ID SSM parameter", () => {
      const stack = createTestStack(app, "TestStack", {
        createSsmParameters: true,
      });

      const template = Template.fromStack(stack);
      template.hasResourceProperties("AWS::SSM::Parameter", {
        Name: "/networking/development/config/vpc-id",
        Type: "String",
      });
    });

    test("does not create SSM parameters when disabled", () => {
      const stack = createTestStack(app, "TestStack", {
        createSsmParameters: false,
      });

      const template = Template.fromStack(stack);
      template.resourceCountIs("AWS::SSM::Parameter", 0);
    });
  });

  // ============================================================================
  // Validation Tests (Parameterized)
  // ============================================================================

  describe("Validation", () => {
    test("validates environment name is non-empty", () => {
      expect(() => {
        createTestStack(app, "TestStack", { envName: "" });
      }).toThrow(/environment name/i);
    });

    test.each([
      {
        cidr: "invalid",
        expectedError: /Invalid CIDR format/i,
      },
      {
        cidr: "300.300.300.300/16",
        expectedError:
          /Invalid IP address.*Each octet must be between 0 and 255/i,
      },
      {
        cidr: "10.0.0.0/33",
        expectedError: /CIDR mask must be between 8 and 28/i,
      },
    ])("throws error for invalid CIDR: $cidr", ({ cidr, expectedError }) => {
      expect(() => {
        createTestStack(app, "TestStack", { vpcCidr: cidr });
      }).toThrow(expectedError);
    });

    test.each([
      { maxAzs: 0, expectedError: /maxAzs must be between 1 and 3/ },
      { maxAzs: 4, expectedError: /maxAzs must be between 1 and 3/ },
    ])("throws error when maxAzs=$maxAzs", ({ maxAzs, expectedError }) => {
      expect(() => {
        createTestStack(app, "TestStack", { maxAzs });
      }).toThrow(expectedError);
    });

    test.each([
      {
        natGateways: -1,
        maxAzs: 2,
        expectedError: /natGateways must be between 0 and maxAzs/,
      },
      {
        natGateways: 3,
        maxAzs: 2,
        expectedError: /natGateways must be between 0 and maxAzs/,
      },
    ])(
      "throws error when natGateways=$natGateways exceeds maxAzs=$maxAzs",
      ({ natGateways, maxAzs, expectedError }) => {
        expect(() => {
          createTestStack(app, "TestStack", { maxAzs, natGateways });
        }).toThrow(expectedError);
      }
    );
  });

  // ============================================================================
  // Feature Interactions
  // ============================================================================

  describe("Feature Interactions", () => {
    test("flow logs and VPC endpoints work together", () => {
      const stack = createTestStack(app, "TestStack", {
        enableVpcFlowLogs: true,
        enableVpcEndpoints: true,
      });

      const template = Template.fromStack(stack);

      template.resourceCountIs("AWS::EC2::FlowLog", 1);

      const endpoints = template.findResources("AWS::EC2::VPCEndpoint");
      expect(Object.keys(endpoints).length).toBe(2);
    });
  });

  // ============================================================================
  // Cost Optimization
  // ============================================================================

  describe("Cost Optimization", () => {
    test("development environment has cost-optimized configuration", () => {
      const stack = new NetworkingStack(
        app,
        "DevStack",
        fixtures.development()
      );
      const template = Template.fromStack(stack);

      template.resourceCountIs("AWS::EC2::NatGateway", 0);
      template.hasResourceProperties("AWS::Logs::LogGroup", {
        RetentionInDays: 3,
      });
    });

    test("production environment has HA configuration", () => {
      const stack = new NetworkingStack(
        app,
        "ProdStack",
        fixtures.production()
      );
      const template = Template.fromStack(stack);

      template.resourceCountIs("AWS::EC2::NatGateway", 2);
      template.hasResourceProperties("AWS::Logs::LogGroup", {
        RetentionInDays: 180,
      });
    });
  });

  // ============================================================================
  // Stack Properties
  // ============================================================================

  describe("Stack Properties", () => {
    test.each([
      { property: "vpc", expectedProperty: "vpcId" },
      { property: "publicSubnets", expectedLength: 2 },
      { property: "privateSubnets", expectedLength: 2 },
      { property: "isolatedSubnets", expectedType: "array" },
    ])(
      "exposes $property property",
      ({ property, expectedProperty, expectedLength, expectedType }) => {
        const stack = createTestStack(app, "TestStack", { maxAzs: 2 });

        const prop = (stack as any)[property];
        expect(prop).toBeDefined();

        if (expectedProperty) {
          expect((prop as any)[expectedProperty]).toBeDefined();
        }
        if (expectedLength !== undefined) {
          expect(prop.length).toBe(expectedLength);
        }
        if (expectedType === "array") {
          expect(Array.isArray(prop)).toBe(true);
        }
      }
    );
  });
});
