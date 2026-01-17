/** @format */
/// <reference types="jest" />

import { SubnetConfigurationHelper } from "../../../../lib/shared/helpers";

import { TEST_CONSTANTS } from "./shared-fixtures";

// ============================================================================
// SUBNET CONFIGURATION HELPER - SPECIALIZED CONFIGURATIONS
// ============================================================================

describe("SubnetConfigurationHelper - Specialized Configurations", () => {
  /**
   * Cost-Optimised Configuration Tests
   *
   * Verifies that cost-optimised subnet configurations use small CIDR masks
   * suitable for development environments.
   */
  describe("costOptimizedConfiguration", () => {
    test("creates cost-optimised configuration with small CIDR masks", () => {
      const configs = SubnetConfigurationHelper.costOptimizedConfiguration();

      expect(configs).toHaveLength(
        TEST_CONSTANTS.CONFIGURATION_COUNTS.TWO_TIER
      );
      expect(configs[0].name).toBe(TEST_CONSTANTS.SUBNET_NAMES.PUBLIC);
      expect(configs[1].name).toBe(TEST_CONSTANTS.SUBNET_NAMES.PRIVATE);
      // Should use SMALL recommendation which is 28
      expect(configs[0].cidrMask).toBe(TEST_CONSTANTS.CIDR_MASKS.SMALL);
      expect(configs[1].cidrMask).toBe(TEST_CONSTANTS.CIDR_MASKS.SMALL);
    });

    test("has correct subnet types", () => {
      const configs = SubnetConfigurationHelper.costOptimizedConfiguration();

      expect(configs[0].subnetType).toBe(TEST_CONSTANTS.SUBNET_TYPES.PUBLIC);
      expect(configs[1].subnetType).toBe(
        TEST_CONSTANTS.SUBNET_TYPES.PRIVATE_WITH_EGRESS
      );
    });
  });

  /**
   * High-Density Configuration Tests
   *
   * Verifies that high-density subnet configurations use large CIDR masks
   * suitable for large containerised workloads.
   */
  describe("highDensityConfiguration", () => {
    test("creates high-density configuration with large CIDR masks", () => {
      const configs = SubnetConfigurationHelper.highDensityConfiguration();

      expect(configs).toHaveLength(
        TEST_CONSTANTS.CONFIGURATION_COUNTS.TWO_TIER
      );
      expect(configs[0].name).toBe(TEST_CONSTANTS.SUBNET_NAMES.PUBLIC);
      expect(configs[1].name).toBe(TEST_CONSTANTS.SUBNET_NAMES.PRIVATE);
      // Should use LARGE recommendation which is 20
      expect(configs[0].cidrMask).toBe(TEST_CONSTANTS.CIDR_MASKS.LARGE);
      expect(configs[1].cidrMask).toBe(TEST_CONSTANTS.CIDR_MASKS.LARGE);
    });

    test("has correct subnet types", () => {
      const configs = SubnetConfigurationHelper.highDensityConfiguration();

      expect(configs[0].subnetType).toBe(TEST_CONSTANTS.SUBNET_TYPES.PUBLIC);
      expect(configs[1].subnetType).toBe(
        TEST_CONSTANTS.SUBNET_TYPES.PRIVATE_WITH_EGRESS
      );
    });
  });

  /**
   * Edge Cases Tests
   *
   * Verifies boundary conditions and edge cases for CIDR mask validation
   * and tier configurations.
   */
  describe("edge cases", () => {
    test("handles minimum valid CIDR mask", () => {
      const config = SubnetConfigurationHelper.publicSubnet(
        TEST_CONSTANTS.CIDR_MASKS.MIN
      );
      expect(config.cidrMask).toBe(TEST_CONSTANTS.CIDR_MASKS.MIN);
    });

    test("handles maximum valid CIDR mask", () => {
      const config = SubnetConfigurationHelper.publicSubnet(
        TEST_CONSTANTS.CIDR_MASKS.MAX
      );
      expect(config.cidrMask).toBe(TEST_CONSTANTS.CIDR_MASKS.MAX);
    });

    test("handles boundary values in tier configurations", () => {
      const twoTier = SubnetConfigurationHelper.twoTierConfiguration(
        TEST_CONSTANTS.CIDR_MASKS.MIN
      );
      expect(twoTier[0].cidrMask).toBe(TEST_CONSTANTS.CIDR_MASKS.MIN);
      expect(twoTier[1].cidrMask).toBe(TEST_CONSTANTS.CIDR_MASKS.MIN);

      const threeTier = SubnetConfigurationHelper.threeTierConfiguration(
        TEST_CONSTANTS.CIDR_MASKS.MAX
      );
      expect(threeTier[0].cidrMask).toBe(TEST_CONSTANTS.CIDR_MASKS.MAX);
      expect(threeTier[1].cidrMask).toBe(TEST_CONSTANTS.CIDR_MASKS.MAX);
      expect(threeTier[2].cidrMask).toBe(TEST_CONSTANTS.CIDR_MASKS.MAX);
    });
  });
});
