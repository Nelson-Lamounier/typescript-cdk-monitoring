/** @format */
/// <reference types="jest" />

import * as ec2 from "aws-cdk-lib/aws-ec2";

import { SubnetConfigurationHelper } from "../../../lib/shared/helpers";
import {
  DEFAULT_SUBNET_CIDR_MASK,
  MIN_SUBNET_CIDR_MASK,
  MAX_SUBNET_CIDR_MASK,
  SUBNET_CIDR_RECOMMENDATIONS,
} from "../../../lib/shared/constants/networking-constants";

// ============================================================================
// CUSTOM MATCHERS (Type declarations will be added when matchers are used)
// ============================================================================

// ============================================================================
// TEST CONFIGURATION
// ============================================================================

/**
 * Test constants - avoid magic numbers and strings
 * All hardcoded values used in tests should be defined here
 */
const TEST_CONSTANTS = {
  CIDR_MASKS: {
    DEFAULT: DEFAULT_SUBNET_CIDR_MASK,
    MIN: MIN_SUBNET_CIDR_MASK,
    MAX: MAX_SUBNET_CIDR_MASK,
    SMALL: SUBNET_CIDR_RECOMMENDATIONS.SMALL,
    STANDARD: SUBNET_CIDR_RECOMMENDATIONS.STANDARD,
    LARGE: SUBNET_CIDR_RECOMMENDATIONS.LARGE,
    INVALID_TOO_SMALL: 8,
    INVALID_TOO_LARGE: 32,
    INVALID_NON_INTEGER: 24.5,
  },
  SUBNET_NAMES: {
    PUBLIC: "Public",
    PRIVATE: "Private",
    ISOLATED: "Isolated",
  },
  SUBNET_TYPES: {
    PUBLIC: ec2.SubnetType.PUBLIC,
    PRIVATE_WITH_EGRESS: ec2.SubnetType.PRIVATE_WITH_EGRESS,
    PRIVATE_ISOLATED: ec2.SubnetType.PRIVATE_ISOLATED,
  },
  TAGS: {
    TYPE: "Type",
    NETWORK_TIER: "Network-Tier",
    PUBLIC: "Public",
    PRIVATE: "Private",
    ISOLATED: "Isolated",
    CUSTOM: "Custom",
    PURPOSE: "Purpose",
    LOAD_BALANCERS: "LoadBalancers",
    APPLICATION_SERVERS: "ApplicationServers",
    DATABASES: "Databases",
    CUSTOM_TYPE: "CustomType",
    ADDITIONAL: "Additional",
    VALUE: "Value",
  },
  KUBERNETES_TAGS: {
    ROLE_ELB: "kubernetes.io/role/elb",
    ROLE_INTERNAL_ELB: "kubernetes.io/role/internal-elb",
    CLUSTER_PREFIX: "kubernetes.io/cluster/",
    ELB_VALUE: "1",
    CLUSTER_VALUE: "shared",
  },
  CLUSTER_NAMES: {
    DEFAULT: "my-cluster",
    PRODUCTION: "production-eks-cluster",
    EMPTY: "",
    WHITESPACE: "   ",
  },
  CONFIGURATION_COUNTS: {
    TWO_TIER: 2,
    THREE_TIER: 3,
  },
  VALIDATION_ERRORS: {
    CIDR_MASK_RANGE: "Subnet CIDR mask must be between 16 and 28",
    CIDR_MASK_INTEGER: "Subnet CIDR mask must be an integer",
    EKS_CLUSTER_NAME_REQUIRED:
      "EKS cluster name is required for subnet configuration",
  },
} as const;

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Assert that a subnet configuration has the expected default properties
 *
 * @param config - Subnet configuration to verify
 * @param expectedName - Expected subnet name
 * @param expectedType - Expected subnet type
 * @param expectedCidrMask - Expected CIDR mask
 * @param shouldMapPublicIp - Whether mapPublicIpOnLaunch should be defined
 * @param expectedMapPublicIp - Expected mapPublicIpOnLaunch value (if shouldMapPublicIp is true)
 */
function assertSubnetDefaults(
  config: ReturnType<typeof SubnetConfigurationHelper.publicSubnet>,
  expectedName: string,
  expectedType: ec2.SubnetType,
  expectedCidrMask: number,
  shouldMapPublicIp: boolean,
  expectedMapPublicIp?: boolean
): void {
  expect(config.name).toBe(expectedName);
  expect(config.subnetType).toBe(expectedType);
  expect(config.cidrMask).toBe(expectedCidrMask);
  
  expect(shouldMapPublicIp ? config.mapPublicIpOnLaunch !== undefined : config.mapPublicIpOnLaunch === undefined).toBe(true);
  expect(shouldMapPublicIp && expectedMapPublicIp !== undefined ? config.mapPublicIpOnLaunch === expectedMapPublicIp : true).toBe(true);
}

/**
 * Assert that tags contain expected values
 *
 * @param tags - Tags object to verify
 * @param expectedTags - Object with expected tag key-value pairs
 */
function assertTags(
  tags: Record<string, string> | undefined,
  expectedTags: Record<string, string>
): void {
  expect(tags).toBeDefined();
  
  Object.entries(expectedTags).forEach(([key, value]) => {
    expect(tags).toHaveProperty(key, value);
  });
}

// ============================================================================
// SUBNET CONFIGURATION HELPER TESTS
// ============================================================================

describe("SubnetConfigurationHelper", () => {
  // ============================================================================
  // Public Subnet Tests
  // ============================================================================

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
        true,
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

  // ============================================================================
  // Private Subnet Tests
  // ============================================================================

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
        false
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

  // ============================================================================
  // Isolated Subnet Tests
  // ============================================================================

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
        false
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

  // ============================================================================
  // Two-Tier Configuration Tests
  // ============================================================================

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

  // ============================================================================
  // Three-Tier Configuration Tests
  // ============================================================================

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

  // ============================================================================
  // EKS Configuration Tests
  // ============================================================================

  /**
   * EKS Configuration Tests
   *
   * Verifies that EKS-optimized subnet configurations are created correctly
   * with proper Kubernetes tags, cluster name validation, and CIDR mask support.
   */
  describe("eksConfiguration", () => {
    let eksTestData: {
      defaultConfigs: ReturnType<typeof SubnetConfigurationHelper.eksConfiguration>;
      customCidrConfigs: ReturnType<typeof SubnetConfigurationHelper.eksConfiguration>;
      productionConfigs: ReturnType<typeof SubnetConfigurationHelper.eksConfiguration>;
      publicTagsValid: boolean;
      privateTagsValid: boolean;
      productionPublicTagsValid: boolean;
      productionPrivateTagsValid: boolean;
    };

    beforeAll(() => {
      // Pre-compute configurations
      const defaultConfigs = SubnetConfigurationHelper.eksConfiguration(
        TEST_CONSTANTS.CLUSTER_NAMES.DEFAULT
      );
      const customCidrConfigs = SubnetConfigurationHelper.eksConfiguration(
        TEST_CONSTANTS.CLUSTER_NAMES.DEFAULT,
        TEST_CONSTANTS.CIDR_MASKS.DEFAULT,
        TEST_CONSTANTS.CIDR_MASKS.LARGE
      );
      const productionConfigs = SubnetConfigurationHelper.eksConfiguration(
        TEST_CONSTANTS.CLUSTER_NAMES.PRODUCTION
      );

      // Pre-compute tag validations for default configs
      const publicTags = defaultConfigs[0].tags ?? {};
      const privateTags = defaultConfigs[1].tags ?? {};
      
      const publicTagsValid =
        publicTags[TEST_CONSTANTS.KUBERNETES_TAGS.ROLE_ELB] === TEST_CONSTANTS.KUBERNETES_TAGS.ELB_VALUE &&
        publicTags[`${TEST_CONSTANTS.KUBERNETES_TAGS.CLUSTER_PREFIX}${TEST_CONSTANTS.CLUSTER_NAMES.DEFAULT}`] === TEST_CONSTANTS.KUBERNETES_TAGS.CLUSTER_VALUE;

      const privateTagsValid =
        privateTags[TEST_CONSTANTS.KUBERNETES_TAGS.ROLE_INTERNAL_ELB] === TEST_CONSTANTS.KUBERNETES_TAGS.ELB_VALUE &&
        privateTags[`${TEST_CONSTANTS.KUBERNETES_TAGS.CLUSTER_PREFIX}${TEST_CONSTANTS.CLUSTER_NAMES.DEFAULT}`] === TEST_CONSTANTS.KUBERNETES_TAGS.CLUSTER_VALUE;

      // Pre-compute tag validations for production configs
      const productionPublicTags = productionConfigs[0].tags ?? {};
      const productionPrivateTags = productionConfigs[1].tags ?? {};

      const productionPublicTagsValid =
        productionPublicTags[`${TEST_CONSTANTS.KUBERNETES_TAGS.CLUSTER_PREFIX}${TEST_CONSTANTS.CLUSTER_NAMES.PRODUCTION}`] === TEST_CONSTANTS.KUBERNETES_TAGS.CLUSTER_VALUE;

      const productionPrivateTagsValid =
        productionPrivateTags[`${TEST_CONSTANTS.KUBERNETES_TAGS.CLUSTER_PREFIX}${TEST_CONSTANTS.CLUSTER_NAMES.PRODUCTION}`] === TEST_CONSTANTS.KUBERNETES_TAGS.CLUSTER_VALUE;

      eksTestData = {
        defaultConfigs,
        customCidrConfigs,
        productionConfigs,
        publicTagsValid,
        privateTagsValid,
        productionPublicTagsValid,
        productionPrivateTagsValid,
      };
    });

    test("creates EKS-tagged subnets with default CIDR masks", () => {
      // Guard assertion
      expect(eksTestData).toBeDefined();
      expect(eksTestData.defaultConfigs).toBeDefined();

      const configs = eksTestData.defaultConfigs;

      expect(configs).toHaveLength(
        TEST_CONSTANTS.CONFIGURATION_COUNTS.TWO_TIER
      );
      expect(configs[0].name).toBe(TEST_CONSTANTS.SUBNET_NAMES.PUBLIC);
      expect(configs[0].subnetType).toBe(TEST_CONSTANTS.SUBNET_TYPES.PUBLIC);
      expect(configs[1].name).toBe(TEST_CONSTANTS.SUBNET_NAMES.PRIVATE);
      expect(configs[1].subnetType).toBe(
        TEST_CONSTANTS.SUBNET_TYPES.PRIVATE_WITH_EGRESS
      );

      // Verify tags are defined
      expect(configs[0].tags).toBeDefined();
      expect(configs[1].tags).toBeDefined();

      // Verify pre-computed tag validation
      expect(eksTestData.publicTagsValid).toBe(true);
      expect(eksTestData.privateTagsValid).toBe(true);
    });

    test("accepts custom CIDR masks", () => {
      // Guard assertion
      expect(eksTestData).toBeDefined();
      expect(eksTestData.customCidrConfigs).toBeDefined();

      const configs = eksTestData.customCidrConfigs;

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
      // Guard assertion
      expect(eksTestData).toBeDefined();
      expect(eksTestData.productionConfigs).toBeDefined();

      const configs = eksTestData.productionConfigs;

      expect(configs[0].tags).toBeDefined();
      expect(configs[1].tags).toBeDefined();

      // Verify pre-computed tag validation
      expect(eksTestData.productionPublicTagsValid).toBe(true);
      expect(eksTestData.productionPrivateTagsValid).toBe(true);
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

  // ============================================================================
  // Cost-Optimized Configuration Tests
  // ============================================================================

  /**
   * Cost-Optimized Configuration Tests
   *
   * Verifies that cost-optimized subnet configurations use small CIDR masks
   * suitable for development environments.
   */
  describe("costOptimizedConfiguration", () => {
    test("creates cost-optimized configuration with small CIDR masks", () => {
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

  // ============================================================================
  // High-Density Configuration Tests
  // ============================================================================

  /**
   * High-Density Configuration Tests
   *
   * Verifies that high-density subnet configurations use large CIDR masks
   * suitable for large containerized workloads.
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

  // ============================================================================
  // Edge Cases Tests
  // ============================================================================

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
