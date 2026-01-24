/** @format */

import * as ec2 from "aws-cdk-lib/aws-ec2";

import { SubnetConfigurationHelper } from "../../../../lib/shared/helpers";
import {
  DEFAULT_SUBNET_CIDR_MASK,
  MIN_SUBNET_CIDR_MASK,
  MAX_SUBNET_CIDR_MASK,
  SUBNET_CIDR_RECOMMENDATIONS,
} from "../../../../lib/shared/constants/networking-constants";

// ============================================================================
// TEST CONFIGURATION
// ============================================================================

/**
 * Test constants - avoid magic numbers and strings
 * All hardcoded values used in tests should be defined here
 */
export const TEST_CONSTANTS = {
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
 * @param expectedMapPublicIp - Expected mapPublicIpOnLaunch value (or undefined)
 */
export function assertSubnetDefaults(
  config: ReturnType<typeof SubnetConfigurationHelper.publicSubnet>,
  expectedName: string,
  expectedType: ec2.SubnetType,
  expectedCidrMask: number,
  expectedMapPublicIp?: boolean
): void {
  expect(config.name).toBe(expectedName);
  expect(config.subnetType).toBe(expectedType);
  expect(config.cidrMask).toBe(expectedCidrMask);
  if (expectedMapPublicIp !== undefined) {
    expect(config.mapPublicIpOnLaunch).toBe(expectedMapPublicIp);
  } else {
    expect(config.mapPublicIpOnLaunch).toBeUndefined();
  }
}

/**
 * Assert that tags contain expected values
 *
 * @param tags - Tags object to verify
 * @param expectedTags - Object with expected tag key-value pairs
 */
export function assertTags(
  tags: Record<string, string> | undefined,
  expectedTags: Record<string, string>
): void {
  expect(tags).toBeDefined();
  if (!tags) return;

  Object.entries(expectedTags).forEach(([key, value]) => {
    expect(tags).toHaveProperty(key, value);
  });
}
