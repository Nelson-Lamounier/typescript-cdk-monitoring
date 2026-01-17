/** @format */

/**
 * Shared Utilities for Stack Tests
 *
 * Provides reusable test utilities, fixtures, and configuration
 * for all stack test files to eliminate code duplication.
 *
 * @module tests/unit/utils/stack-test-utils
 */

import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";

// ============================================================================
// TEST CONFIGURATION
// ============================================================================

/**
 * Test configuration constants
 * Centralised configuration values used across all stack tests
 */
export const TEST_CONFIG = {
  account: "123456789012",
  region: "eu-west-1",
} as const;

/**
 * Base test constants - avoid magic numbers and strings
 * Stack-specific constants should extend this in their test files
 */
export const BASE_TEST_CONSTANTS = {
  VPC: {
    CIDR: "10.0.0.0/16",
    MAX_AZS: 2,
    NAT_GATEWAYS: 1,
    SUBNET_MASK: 24,
  },
  ENVIRONMENTS: {
    DEVELOPMENT: "development",
    PRODUCTION: "production",
    STAGING: "staging",
    PIPELINE: "pipeline",
  },
  REMOVAL_POLICIES: {
    DELETE: "Delete",
    RETAIN: "Retain",
  },
  STACK_IDS: {
    DEFAULT: "TestStack",
    VPC: "TestVpcStack",
    MINIMAL: "MinimalStack",
    SNAPSHOT: "SnapshotStack",
    ALL_PROPERTIES: "AllPropertiesStack",
    DEV: "DevStack",
    PROD: "ProdStack",
  },
} as const;

// ============================================================================
// TEST FIXTURES CACHING CLASS
// ============================================================================

/**
 * TestFixtures caching class
 *
 * Provides cached test fixtures (VPC) to improve test performance
 * and reduce resource creation overhead. Each app instance gets its own cached fixtures.
 *
 * @example
 * ```typescript
 * const fixtures = TestFixtures.getInstance(app);
 * const vpc = fixtures.getVpc();
 * ```
 */
export class TestFixtures {
  private static instances = new Map<cdk.App, TestFixtures>();
  private vpc: ec2.IVpc | null = null;

  /**
   * Private constructor to enforce singleton pattern per app instance
   * @param app - CDK app instance
   */
  private constructor(private readonly app: cdk.App) {}

  /**
   * Get or create TestFixtures instance for the given app
   *
   * Each app instance gets its own TestFixtures singleton to avoid
   * construct name conflicts across different test suites.
   *
   * @param app - CDK app instance
   * @returns TestFixtures instance for the app
   */
  static getInstance(app: cdk.App): TestFixtures {
    if (!app) {
      throw new Error("CDK App instance is required to create TestFixtures");
    }

    if (!TestFixtures.instances.has(app)) {
      TestFixtures.instances.set(app, new TestFixtures(app));
    }

    const instance = TestFixtures.instances.get(app);
    if (!instance) {
      throw new Error("Failed to create TestFixtures instance");
    }
    return instance;
  }

  /**
   * Get or create mock VPC for testing
   *
   * VPC is cached per app instance to avoid recreating it for each test.
   * Includes both public and private subnets for comprehensive testing.
   *
   * @param options - Optional VPC configuration overrides
   * @returns IVpc instance for testing
   */
  getVpc(options?: {
    cidr?: string;
    maxAzs?: number;
    natGateways?: number;
    subnetMask?: number;
  }): ec2.IVpc {
    if (!this.vpc) {
      const vpcStack = new cdk.Stack(this.app, BASE_TEST_CONSTANTS.STACK_IDS.VPC, {
        env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
      });

      this.vpc = new ec2.Vpc(vpcStack, "TestVpc", {
        ipAddresses: ec2.IpAddresses.cidr(
          options?.cidr ?? BASE_TEST_CONSTANTS.VPC.CIDR
        ),
        maxAzs: options?.maxAzs ?? BASE_TEST_CONSTANTS.VPC.MAX_AZS,
        natGateways: options?.natGateways ?? BASE_TEST_CONSTANTS.VPC.NAT_GATEWAYS,
        subnetConfiguration: [
          {
            name: "Public",
            subnetType: ec2.SubnetType.PUBLIC,
            cidrMask: options?.subnetMask ?? BASE_TEST_CONSTANTS.VPC.SUBNET_MASK,
          },
          {
            name: "Private",
            subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
            cidrMask: options?.subnetMask ?? BASE_TEST_CONSTANTS.VPC.SUBNET_MASK,
          },
        ],
      });
    }

    return this.vpc;
  }

  /**
   * Clear cached fixtures for this app instance
   *
   * Useful for cleanup between test suites or when fixtures need to be recreated.
   */
  clear(): void {
    this.vpc = null;
  }

  /**
   * Clear all cached fixtures across all app instances
   *
   * Useful for global cleanup after all tests complete.
   */
  static clearAll(): void {
    TestFixtures.instances.clear();
  }
}

// ============================================================================
// TEST STACK CREATION HELPERS
// ============================================================================

/**
 * Create a new CDK App instance for test isolation
 *
 * Each describe block should create its own app instance to avoid
 * construct name conflicts across test suites.
 *
 * @returns New CDK App instance
 */
export function createTestApp(): cdk.App {
  return new cdk.App();
}

/**
 * Create CDK environment configuration for tests
 *
 * @param overrides - Optional environment overrides
 * @returns CDK environment configuration
 */
export function createTestEnv(
  overrides?: Partial<cdk.Environment>
): cdk.Environment {
  return {
    account: overrides?.account ?? TEST_CONFIG.account,
    region: overrides?.region ?? TEST_CONFIG.region,
  };
}

// ============================================================================
// CUSTOM MATCHERS SETUP
// ============================================================================

/**
 * Extend Jest expect with CDK-specific custom matchers
 *
 * This function should be called at the module level in test files
 * to register custom matchers for CDK assertions.
 *
 * @example
 * ```typescript
 * extendExpectWithCdkMatchers();
 *
 * describe("MyStack", () => {
 *   // tests...
 * });
 * ```
 */
export function extendExpectWithCdkMatchers(): void {
  // Custom matchers can be added here when needed
  // For now, this is a placeholder for future extensions
}
