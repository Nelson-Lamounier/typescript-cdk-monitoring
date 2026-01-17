/** @format */
/// <reference types="jest" />

import { SubnetConfigurationHelper } from "../../../../lib/shared/helpers";

import { TEST_CONSTANTS } from "./shared-fixtures";

// ============================================================================
// SUBNET CONFIGURATION HELPER - EKS CONFIGURATION TESTS
// ============================================================================

describe("SubnetConfigurationHelper - EKS Configuration", () => {
  /**
   * EKS Configuration Tests
   *
   * Verifies that EKS-optimised subnet configurations are created correctly
   * with proper Kubernetes tags, cluster name validation, and CIDR mask support.
   */
  describe("eksConfiguration", () => {
    test("creates EKS-tagged subnets with default CIDR masks", () => {
      const configs = SubnetConfigurationHelper.eksConfiguration(
        TEST_CONSTANTS.CLUSTER_NAMES.DEFAULT
      );

      expect(configs).toHaveLength(
        TEST_CONSTANTS.CONFIGURATION_COUNTS.TWO_TIER
      );
      expect(configs[0].name).toBe(TEST_CONSTANTS.SUBNET_NAMES.PUBLIC);
      expect(configs[0].subnetType).toBe(TEST_CONSTANTS.SUBNET_TYPES.PUBLIC);
      expect(configs[1].name).toBe(TEST_CONSTANTS.SUBNET_NAMES.PRIVATE);
      expect(configs[1].subnetType).toBe(
        TEST_CONSTANTS.SUBNET_TYPES.PRIVATE_WITH_EGRESS
      );

      // Check Kubernetes tags (use bracket notation for property names with special characters)
      expect(configs[0].tags).toBeDefined();
      expect(configs[0].tags).not.toBeNull();
      expect(configs[0].tags![TEST_CONSTANTS.KUBERNETES_TAGS.ROLE_ELB]).toBe(
        TEST_CONSTANTS.KUBERNETES_TAGS.ELB_VALUE
      );
      expect(
        configs[0].tags![
          `${TEST_CONSTANTS.KUBERNETES_TAGS.CLUSTER_PREFIX}${TEST_CONSTANTS.CLUSTER_NAMES.DEFAULT}`
        ]
      ).toBe(TEST_CONSTANTS.KUBERNETES_TAGS.CLUSTER_VALUE);
      expect(configs[1].tags).toBeDefined();
      expect(configs[1].tags).not.toBeNull();
      expect(
        configs[1].tags![TEST_CONSTANTS.KUBERNETES_TAGS.ROLE_INTERNAL_ELB]
      ).toBe(TEST_CONSTANTS.KUBERNETES_TAGS.ELB_VALUE);
      expect(
        configs[1].tags![
          `${TEST_CONSTANTS.KUBERNETES_TAGS.CLUSTER_PREFIX}${TEST_CONSTANTS.CLUSTER_NAMES.DEFAULT}`
        ]
      ).toBe(TEST_CONSTANTS.KUBERNETES_TAGS.CLUSTER_VALUE);
    });

    test("accepts custom CIDR masks", () => {
      const configs = SubnetConfigurationHelper.eksConfiguration(
        TEST_CONSTANTS.CLUSTER_NAMES.DEFAULT,
        TEST_CONSTANTS.CIDR_MASKS.DEFAULT,
        TEST_CONSTANTS.CIDR_MASKS.LARGE
      );

      expect(configs[0].cidrMask).toBe(TEST_CONSTANTS.CIDR_MASKS.DEFAULT);
      expect(configs[1].cidrMask).toBe(TEST_CONSTANTS.CIDR_MASKS.LARGE);
    });

    test.each([
      {
        clusterName: TEST_CONSTANTS.CLUSTER_NAMES.EMPTY,
        description: "empty string",
      },
      {
        clusterName: TEST_CONSTANTS.CLUSTER_NAMES.WHITESPACE,
        description: "whitespace-only",
      },
    ])(
      "throws error for invalid cluster name ($description)",
      ({ clusterName }) => {
        expect(() =>
          SubnetConfigurationHelper.eksConfiguration(clusterName)
        ).toThrow(TEST_CONSTANTS.VALIDATION_ERRORS.EKS_CLUSTER_NAME_REQUIRED);
      }
    );

    test("includes cluster name in Kubernetes tags", () => {
      const clusterName = TEST_CONSTANTS.CLUSTER_NAMES.PRODUCTION;
      const configs = SubnetConfigurationHelper.eksConfiguration(clusterName);

      expect(configs[0].tags).toBeDefined();
      expect(configs[0].tags).not.toBeNull();
      expect(
        configs[0].tags![
          `${TEST_CONSTANTS.KUBERNETES_TAGS.CLUSTER_PREFIX}${clusterName}`
        ]
      ).toBe(TEST_CONSTANTS.KUBERNETES_TAGS.CLUSTER_VALUE);
      expect(configs[1].tags).toBeDefined();
      expect(configs[1].tags).not.toBeNull();
      expect(
        configs[1].tags![
          `${TEST_CONSTANTS.KUBERNETES_TAGS.CLUSTER_PREFIX}${clusterName}`
        ]
      ).toBe(TEST_CONSTANTS.KUBERNETES_TAGS.CLUSTER_VALUE);
    });

    test.each([
      {
        publicCidrMask: TEST_CONSTANTS.CIDR_MASKS.INVALID_TOO_SMALL,
        privateCidrMask: TEST_CONSTANTS.CIDR_MASKS.LARGE,
        description: "invalid public CIDR mask",
      },
      {
        publicCidrMask: TEST_CONSTANTS.CIDR_MASKS.DEFAULT,
        privateCidrMask: TEST_CONSTANTS.CIDR_MASKS.INVALID_TOO_LARGE,
        description: "invalid private CIDR mask",
      },
    ])(
      "throws error for $description",
      ({ publicCidrMask, privateCidrMask }) => {
        expect(() =>
          SubnetConfigurationHelper.eksConfiguration(
            TEST_CONSTANTS.CLUSTER_NAMES.DEFAULT,
            publicCidrMask,
            privateCidrMask
          )
        ).toThrow();
      }
    );
  });
});
