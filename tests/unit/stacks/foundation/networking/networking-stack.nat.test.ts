/** @format */
/// <reference types="jest" />

import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";

import { createTestStack, TEST_CONSTANTS } from "./shared-fixtures";

// ============================================================================
// NETWORKING STACK - NAT GATEWAY CONFIGURATION TESTS
// ============================================================================

describe("NetworkingStack - NAT Gateway Configuration", () => {
  let app: cdk.App;

  beforeEach(() => {
    app = new cdk.App();
  });

  /**
   * NAT Gateway Configuration Tests
   *
   * Verifies NAT gateway creation based on configuration,
   * EIP allocation, and placement in public subnets.
   */
  describe("NAT Gateway Configuration", () => {
    test.each([
      {
        natGateways: 0,
        expectedNat: TEST_CONSTANTS.RESOURCE_COUNTS.NAT_GATEWAYS_NONE,
        expectedEip: TEST_CONSTANTS.RESOURCE_COUNTS.NAT_GATEWAYS_NONE,
      },
      { natGateways: 1, expectedNat: 1, expectedEip: 1 },
      {
        natGateways: 2,
        expectedNat: TEST_CONSTANTS.RESOURCE_COUNTS.NAT_GATEWAYS_HA,
        expectedEip: TEST_CONSTANTS.RESOURCE_COUNTS.NAT_GATEWAYS_HA,
      },
    ])(
      "creates $expectedNat NAT gateways with $expectedEip EIPs when natGateways=$natGateways",
      ({ natGateways, expectedNat, expectedEip }) => {
        const stack = createTestStack(app, `TestStack-NAT${natGateways}`, {
          maxAzs: TEST_CONSTANTS.VPC.MAX_AZS,
          natGateways,
        });
        const template = Template.fromStack(stack);

        // eslint-disable-next-line local/no-template-in-describe
        template.resourceCountIs("AWS::EC2::NatGateway", expectedNat);
        // eslint-disable-next-line local/no-template-in-describe
        template.resourceCountIs("AWS::EC2::EIP", expectedEip);
      }
    );

    test("NAT gateways are created in public subnets only", () => {
      const stack = createTestStack(app, TEST_CONSTANTS.STACK_IDS.DEFAULT, {
        maxAzs: TEST_CONSTANTS.VPC.MAX_AZS,
        natGateways: TEST_CONSTANTS.RESOURCE_COUNTS.NAT_GATEWAYS_HA,
      });

      const template = Template.fromStack(stack);
      const natGateways = template.findResources("AWS::EC2::NatGateway");
      const subnets = template.findResources("AWS::EC2::Subnet");

      Object.values(natGateways).forEach((nat) => {
        const natProps = nat.Properties as { SubnetId: { Ref: string } };
        const subnetRef = natProps.SubnetId.Ref;
        const subnet = subnets[subnetRef];
        const subnetProps = subnet.Properties as {
          MapPublicIpOnLaunch: boolean;
        };
        expect(subnetProps.MapPublicIpOnLaunch).toBe(true);
      });
    });
  });
});
