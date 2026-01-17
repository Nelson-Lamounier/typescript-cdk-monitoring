/** @format */
/// <reference types="jest" />

import * as cdk from "aws-cdk-lib";

import { createTestStack, TEST_CONSTANTS } from "./shared-fixtures";

// ============================================================================
// NETWORKING STACK - VALIDATION TESTS
// ============================================================================

describe("NetworkingStack - Validation", () => {
  let app: cdk.App;

  beforeEach(() => {
    app = new cdk.App();
  });

  /**
   * Validation Tests
   *
   * Verifies that NetworkingStack properly validates input parameters
   * and provides helpful error messages for invalid configurations.
   */
  describe("Validation", () => {
    test("validates environment name is non-empty", () => {
      expect(() => {
        createTestStack(app, TEST_CONSTANTS.STACK_IDS.DEFAULT, { envName: "" });
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
    ])(
      "throws error for invalid CIDR: $cidr",
      ({ cidr, expectedError }: { cidr: string; expectedError: RegExp }) => {
        expect(() => {
          createTestStack(app, TEST_CONSTANTS.STACK_IDS.DEFAULT, {
            vpcCidr: cidr,
          });
        }).toThrow(expectedError);
      }
    );

    test.each([
      {
        maxAzs: 0,
        expectedError: /maxAzs must be between 1 and 3/,
      },
      {
        maxAzs: 4,
        expectedError: /maxAzs must be between 1 and 3/,
      },
    ])(
      "throws error when maxAzs=$maxAzs",
      ({
        maxAzs,
        expectedError,
      }: {
        maxAzs: number;
        expectedError: RegExp;
      }) => {
        expect(() => {
          createTestStack(app, TEST_CONSTANTS.STACK_IDS.DEFAULT, { maxAzs });
        }).toThrow(expectedError);
      }
    );

    test.each([
      {
        natGateways: -1,
        maxAzs: TEST_CONSTANTS.VPC.MAX_AZS,
        expectedError: /natGateways must be between 0 and maxAzs/,
      },
      {
        natGateways: 3,
        maxAzs: TEST_CONSTANTS.VPC.MAX_AZS,
        expectedError: /natGateways must be between 0 and maxAzs/,
      },
    ])(
      "throws error when natGateways=$natGateways exceeds maxAzs=$maxAzs",
      ({
        natGateways,
        maxAzs,
        expectedError,
      }: {
        natGateways: number;
        maxAzs: number;
        expectedError: RegExp;
      }) => {
        expect(() => {
          createTestStack(app, TEST_CONSTANTS.STACK_IDS.DEFAULT, {
            maxAzs,
            natGateways,
          });
        }).toThrow(expectedError);
      }
    );
  });
});
