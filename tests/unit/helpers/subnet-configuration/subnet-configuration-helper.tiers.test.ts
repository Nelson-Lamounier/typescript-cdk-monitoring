/** @format */
/// <reference types="jest" />

import { SubnetConfigurationHelper } from "../../../../lib/shared/helpers";

import { TEST_CONSTANTS } from "./shared-fixtures";

// ============================================================================
// SUBNET CONFIGURATION HELPER - TIER CONFIGURATION TESTS
// ============================================================================

describe("SubnetConfigurationHelper - Tier Configurations", () => {
  /**
   * Two-Tier Configuration Tests
   *
   * Verifies that two-tier subnet configurations (public + private)
   * are created correctly with proper defaults and validation.
   */
  describe("twoTierConfiguration", () => {
    test("creates two-tier configuration with default CIDR mask", () => {
      const configs = SubnetConfigurationHelper.twoTierConfiguration();

      expect(configs).toHaveLength(
        TEST_CONSTANTS.CONFIGURATION_COUNTS.TWO_TIER
      );
      expect(configs[0].name).toBe(TEST_CONSTANTS.SUBNET_NAMES.PUBLIC);
      expect(configs[0].subnetType).toBe(TEST_CONSTANTS.SUBNET_TYPES.PUBLIC);
      expect(configs[1].name).toBe(TEST_CONSTANTS.SUBNET_NAMES.PRIVATE);
      expect(configs[1].subnetType).toBe(
        TEST_CONSTANTS.SUBNET_TYPES.PRIVATE_WITH_EGRESS
      );
      expect(configs[0].cidrMask).toBe(TEST_CONSTANTS.CIDR_MASKS.DEFAULT);
      expect(configs[1].cidrMask).toBe(TEST_CONSTANTS.CIDR_MASKS.DEFAULT);
    });

    test("accepts custom CIDR mask for all subnets", () => {
      const configs = SubnetConfigurationHelper.twoTierConfiguration(
        TEST_CONSTANTS.CIDR_MASKS.LARGE
      );

      expect(configs).toHaveLength(
        TEST_CONSTANTS.CONFIGURATION_COUNTS.TWO_TIER
      );
      expect(configs[0].cidrMask).toBe(TEST_CONSTANTS.CIDR_MASKS.LARGE);
      expect(configs[1].cidrMask).toBe(TEST_CONSTANTS.CIDR_MASKS.LARGE);
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
        SubnetConfigurationHelper.twoTierConfiguration(cidrMask)
      ).toThrow();
    });
  });

  /**
   * Three-Tier Configuration Tests
   *
   * Verifies that three-tier subnet configurations (public + private + isolated)
   * are created correctly with proper defaults and validation.
   */
  describe("threeTierConfiguration", () => {
    test("creates three-tier configuration with default CIDR mask", () => {
      const configs = SubnetConfigurationHelper.threeTierConfiguration();

      expect(configs).toHaveLength(
        TEST_CONSTANTS.CONFIGURATION_COUNTS.THREE_TIER
      );
      expect(configs[0].name).toBe(TEST_CONSTANTS.SUBNET_NAMES.PUBLIC);
      expect(configs[0].subnetType).toBe(TEST_CONSTANTS.SUBNET_TYPES.PUBLIC);
      expect(configs[1].name).toBe(TEST_CONSTANTS.SUBNET_NAMES.PRIVATE);
      expect(configs[1].subnetType).toBe(
        TEST_CONSTANTS.SUBNET_TYPES.PRIVATE_WITH_EGRESS
      );
      expect(configs[2].name).toBe(TEST_CONSTANTS.SUBNET_NAMES.ISOLATED);
      expect(configs[2].subnetType).toBe(
        TEST_CONSTANTS.SUBNET_TYPES.PRIVATE_ISOLATED
      );
      expect(configs[0].cidrMask).toBe(TEST_CONSTANTS.CIDR_MASKS.DEFAULT);
      expect(configs[1].cidrMask).toBe(TEST_CONSTANTS.CIDR_MASKS.DEFAULT);
      expect(configs[2].cidrMask).toBe(TEST_CONSTANTS.CIDR_MASKS.DEFAULT);
    });

    test("accepts custom CIDR mask for all subnets", () => {
      const configs = SubnetConfigurationHelper.threeTierConfiguration(
        TEST_CONSTANTS.CIDR_MASKS.LARGE
      );

      expect(configs).toHaveLength(
        TEST_CONSTANTS.CONFIGURATION_COUNTS.THREE_TIER
      );
      expect(configs[0].cidrMask).toBe(TEST_CONSTANTS.CIDR_MASKS.LARGE);
      expect(configs[1].cidrMask).toBe(TEST_CONSTANTS.CIDR_MASKS.LARGE);
      expect(configs[2].cidrMask).toBe(TEST_CONSTANTS.CIDR_MASKS.LARGE);
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
        SubnetConfigurationHelper.threeTierConfiguration(cidrMask)
      ).toThrow();
    });
  });
});
