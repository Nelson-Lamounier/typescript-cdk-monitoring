/** @format */
/// <reference types="jest" />

import { SubnetConfigurationHelper } from "../../../../lib/shared/helpers";

import { assertSubnetDefaults, assertTags, TEST_CONSTANTS } from "./shared-fixtures";

// ============================================================================
// SUBNET CONFIGURATION HELPER - BASIC SUBNET TESTS
// ============================================================================

describe("SubnetConfigurationHelper - Basic Subnets", () => {
  /**
   * Public Subnet Tests
   *
   * Verifies that public subnet configurations are created correctly
   * with proper defaults, validation, and tag support.
   */
  describe("publicSubnet", () => {
    test("creates public subnet with correct defaults", () => {
      const config = SubnetConfigurationHelper.publicSubnet();

      assertSubnetDefaults(
        config,
        TEST_CONSTANTS.SUBNET_NAMES.PUBLIC,
        TEST_CONSTANTS.SUBNET_TYPES.PUBLIC,
        TEST_CONSTANTS.CIDR_MASKS.DEFAULT,
        true
      );

      assertTags(config.tags, {
        [TEST_CONSTANTS.TAGS.TYPE]: TEST_CONSTANTS.TAGS.PUBLIC,
        [TEST_CONSTANTS.TAGS.NETWORK_TIER]: TEST_CONSTANTS.TAGS.PUBLIC,
      });
    });

    test("accepts custom CIDR mask", () => {
      const config = SubnetConfigurationHelper.publicSubnet(
        TEST_CONSTANTS.CIDR_MASKS.LARGE
      );

      expect(config.cidrMask).toBe(TEST_CONSTANTS.CIDR_MASKS.LARGE);
      expect(config.subnetType).toBe(TEST_CONSTANTS.SUBNET_TYPES.PUBLIC);
      expect(config.mapPublicIpOnLaunch).toBe(true);
    });

    test.each([
      {
        cidrMask: TEST_CONSTANTS.CIDR_MASKS.INVALID_TOO_SMALL,
        expectedError: TEST_CONSTANTS.VALIDATION_ERRORS.CIDR_MASK_RANGE,
      },
      {
        cidrMask: TEST_CONSTANTS.CIDR_MASKS.INVALID_TOO_LARGE,
        expectedError: TEST_CONSTANTS.VALIDATION_ERRORS.CIDR_MASK_RANGE,
      },
      {
        cidrMask: TEST_CONSTANTS.CIDR_MASKS.INVALID_NON_INTEGER,
        expectedError: TEST_CONSTANTS.VALIDATION_ERRORS.CIDR_MASK_INTEGER,
      },
    ])(
      "throws error for invalid CIDR mask: $cidrMask",
      ({ cidrMask, expectedError }) => {
        expect(() => SubnetConfigurationHelper.publicSubnet(cidrMask)).toThrow(
          expectedError
        );
      }
    );

    test("accepts custom tags", () => {
      const config = SubnetConfigurationHelper.publicSubnet(
        TEST_CONSTANTS.CIDR_MASKS.DEFAULT,
        {
          [TEST_CONSTANTS.TAGS.CUSTOM]: TEST_CONSTANTS.TAGS.VALUE,
          [TEST_CONSTANTS.TAGS.PURPOSE]: TEST_CONSTANTS.TAGS.LOAD_BALANCERS,
        }
      );

      assertTags(config.tags, {
        [TEST_CONSTANTS.TAGS.TYPE]: TEST_CONSTANTS.TAGS.PUBLIC,
        [TEST_CONSTANTS.TAGS.NETWORK_TIER]: TEST_CONSTANTS.TAGS.PUBLIC,
        [TEST_CONSTANTS.TAGS.CUSTOM]: TEST_CONSTANTS.TAGS.VALUE,
        [TEST_CONSTANTS.TAGS.PURPOSE]: TEST_CONSTANTS.TAGS.LOAD_BALANCERS,
      });
    });

    test("merges custom tags with default tags", () => {
      const config = SubnetConfigurationHelper.publicSubnet(
        TEST_CONSTANTS.CIDR_MASKS.DEFAULT,
        {
          [TEST_CONSTANTS.TAGS.TYPE]: TEST_CONSTANTS.TAGS.CUSTOM_TYPE,
          [TEST_CONSTANTS.TAGS.ADDITIONAL]: TEST_CONSTANTS.TAGS.VALUE,
        }
      );

      assertTags(config.tags, {
        [TEST_CONSTANTS.TAGS.TYPE]: TEST_CONSTANTS.TAGS.CUSTOM_TYPE,
        [TEST_CONSTANTS.TAGS.NETWORK_TIER]: TEST_CONSTANTS.TAGS.PUBLIC,
        [TEST_CONSTANTS.TAGS.ADDITIONAL]: TEST_CONSTANTS.TAGS.VALUE,
      });
    });
  });

  /**
   * Private Subnet Tests
   *
   * Verifies that private subnet configurations are created correctly
   * with proper defaults, validation, and tag support.
   */
  describe("privateSubnet", () => {
    test("creates private subnet with correct defaults", () => {
      const config = SubnetConfigurationHelper.privateSubnet();

      assertSubnetDefaults(
        config,
        TEST_CONSTANTS.SUBNET_NAMES.PRIVATE,
        TEST_CONSTANTS.SUBNET_TYPES.PRIVATE_WITH_EGRESS,
        TEST_CONSTANTS.CIDR_MASKS.DEFAULT,
        undefined
      );

      assertTags(config.tags, {
        [TEST_CONSTANTS.TAGS.TYPE]: TEST_CONSTANTS.TAGS.PRIVATE,
        [TEST_CONSTANTS.TAGS.NETWORK_TIER]: TEST_CONSTANTS.TAGS.PRIVATE,
      });
    });

    test("accepts custom CIDR mask", () => {
      const config = SubnetConfigurationHelper.privateSubnet(
        TEST_CONSTANTS.CIDR_MASKS.LARGE
      );

      expect(config.cidrMask).toBe(TEST_CONSTANTS.CIDR_MASKS.LARGE);
      expect(config.subnetType).toBe(
        TEST_CONSTANTS.SUBNET_TYPES.PRIVATE_WITH_EGRESS
      );
      // mapPublicIpOnLaunch should not be set for private subnets (CDK doesn't allow it)
      expect(config.mapPublicIpOnLaunch).toBeUndefined();
    });

    test.each([
      {
        cidrMask: TEST_CONSTANTS.CIDR_MASKS.INVALID_TOO_SMALL,
        description: "too small",
      },
      {
        cidrMask: TEST_CONSTANTS.CIDR_MASKS.INVALID_TOO_LARGE,
        description: "too large",
      },
    ])("throws error for invalid CIDR mask ($description)", ({ cidrMask }) => {
      expect(() => SubnetConfigurationHelper.privateSubnet(cidrMask)).toThrow();
    });

    test("accepts custom tags", () => {
      const config = SubnetConfigurationHelper.privateSubnet(
        TEST_CONSTANTS.CIDR_MASKS.DEFAULT,
        {
          [TEST_CONSTANTS.TAGS.PURPOSE]:
            TEST_CONSTANTS.TAGS.APPLICATION_SERVERS,
        }
      );

      assertTags(config.tags, {
        [TEST_CONSTANTS.TAGS.TYPE]: TEST_CONSTANTS.TAGS.PRIVATE,
        [TEST_CONSTANTS.TAGS.NETWORK_TIER]: TEST_CONSTANTS.TAGS.PRIVATE,
        [TEST_CONSTANTS.TAGS.PURPOSE]: TEST_CONSTANTS.TAGS.APPLICATION_SERVERS,
      });
    });
  });

  /**
   * Isolated Subnet Tests
   *
   * Verifies that isolated subnet configurations are created correctly
   * with proper defaults, validation, and tag support.
   */
  describe("isolatedSubnet", () => {
    test("creates isolated subnet with correct defaults", () => {
      const config = SubnetConfigurationHelper.isolatedSubnet();

      assertSubnetDefaults(
        config,
        TEST_CONSTANTS.SUBNET_NAMES.ISOLATED,
        TEST_CONSTANTS.SUBNET_TYPES.PRIVATE_ISOLATED,
        TEST_CONSTANTS.CIDR_MASKS.DEFAULT,
        undefined
      );

      assertTags(config.tags, {
        [TEST_CONSTANTS.TAGS.TYPE]: TEST_CONSTANTS.TAGS.ISOLATED,
        [TEST_CONSTANTS.TAGS.NETWORK_TIER]: TEST_CONSTANTS.TAGS.ISOLATED,
      });
    });

    test("accepts custom CIDR mask", () => {
      const config = SubnetConfigurationHelper.isolatedSubnet(
        TEST_CONSTANTS.CIDR_MASKS.LARGE
      );

      expect(config.cidrMask).toBe(TEST_CONSTANTS.CIDR_MASKS.LARGE);
      expect(config.subnetType).toBe(
        TEST_CONSTANTS.SUBNET_TYPES.PRIVATE_ISOLATED
      );
      // mapPublicIpOnLaunch should not be set for isolated subnets (CDK doesn't allow it)
      expect(config.mapPublicIpOnLaunch).toBeUndefined();
    });

    test.each([
      {
        cidrMask: TEST_CONSTANTS.CIDR_MASKS.INVALID_TOO_SMALL,
        description: "too small",
      },
      {
        cidrMask: TEST_CONSTANTS.CIDR_MASKS.INVALID_TOO_LARGE,
        description: "too large",
      },
    ])("throws error for invalid CIDR mask ($description)", ({ cidrMask }) => {
      expect(() =>
        SubnetConfigurationHelper.isolatedSubnet(cidrMask)
      ).toThrow();
    });

    test("accepts custom tags", () => {
      const config = SubnetConfigurationHelper.isolatedSubnet(
        TEST_CONSTANTS.CIDR_MASKS.DEFAULT,
        {
          [TEST_CONSTANTS.TAGS.PURPOSE]: TEST_CONSTANTS.TAGS.DATABASES,
        }
      );

      assertTags(config.tags, {
        [TEST_CONSTANTS.TAGS.TYPE]: TEST_CONSTANTS.TAGS.ISOLATED,
        [TEST_CONSTANTS.TAGS.NETWORK_TIER]: TEST_CONSTANTS.TAGS.ISOLATED,
        [TEST_CONSTANTS.TAGS.PURPOSE]: TEST_CONSTANTS.TAGS.DATABASES,
      });

      // mapPublicIpOnLaunch should not be set for isolated subnets
      expect(config.mapPublicIpOnLaunch).toBeUndefined();
    });
  });
});
