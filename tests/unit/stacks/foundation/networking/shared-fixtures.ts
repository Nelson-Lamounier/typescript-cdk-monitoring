/** @format */

import * as cdk from "aws-cdk-lib";
import * as logs from "aws-cdk-lib/aws-logs";

import { NetworkingStack } from "../../../../../lib/stacks/foundation/networking-stack";
import { NetworkingStackProps } from "../../../../../lib/shared/types/stack-types";
import {
  VPC_CIDR_BLOCKS,
  DEFAULT_MAX_AZS,
  DEFAULT_SUBNET_CIDR_MASK,
} from "../../../../../lib/shared/constants/networking-constants";

// ============================================================================
// TEST CONFIGURATION
// ============================================================================

/**
 * Test configuration constants
 * Centralised configuration values used across all tests
 */
export const TEST_CONFIG = {
  account: "123456789012",
  region: "eu-west-1",
} as const;

/**
 * Test constants - avoid magic numbers and strings
 * All hardcoded values used in tests should be defined here
 */
export const TEST_CONSTANTS = {
  VPC: {
    CIDR: {
      DEVELOPMENT: VPC_CIDR_BLOCKS.DEV,
      PRODUCTION: VPC_CIDR_BLOCKS.PRODUCTION,
      STAGING: VPC_CIDR_BLOCKS.STAGING,
      PIPELINE: VPC_CIDR_BLOCKS.PIPELINE,
      CUSTOM: "10.99.0.0/16",
    },
    MAX_AZS: DEFAULT_MAX_AZS,
    SUBNET_MASK: DEFAULT_SUBNET_CIDR_MASK,
  },
  RESOURCE_COUNTS: {
    VPC: 1,
    GATEWAY_ENDPOINTS: 2,
    INTERFACE_ENDPOINTS: 3, // SSM, SSM Messages, EC2 Messages
    TOTAL_VPC_ENDPOINTS: 5, // 2 gateway + 3 interface
    SSM_PARAMETERS_DISABLED: 0,
    NAT_GATEWAYS_NONE: 0,
    NAT_GATEWAYS_HA: 2,
    FLOW_LOGS_DISABLED: 0,
    FLOW_LOGS_ENABLED: 1,
    VPC_ENDPOINTS_DISABLED: 0,
  },
  STACK_IDS: {
    DEFAULT: "TestStack",
    MINIMAL: "MinimalStack",
    SNAPSHOT: "SnapshotStack",
    ALL_PROPERTIES: "AllPropertiesStack",
    DEV: "DevStack",
    PROD: "ProdStack",
  },
  ENVIRONMENTS: {
    DEVELOPMENT: "development",
    PRODUCTION: "production",
    STAGING: "staging",
    PIPELINE: "pipeline",
  },
  SSM_PARAMETER_PATHS: {
    VPC_ID: "/networking/development/config/vpc-id",
  },
  TAGS: {
    ENVIRONMENT: "Environment",
    MANAGED_BY: "ManagedBy",
    LAYER: "Layer",
    CDK: "CDK",
    FOUNDATION: "Foundation",
    SUBNET_NAME: "aws-cdk:subnet-name",
    PUBLIC: "Public",
    PRIVATE: "Private",
  },
  REMOVAL_POLICIES: {
    DELETE: "Delete",
    RETAIN: "Retain",
  },
  LOG_RETENTION: {
    DEVELOPMENT_DAYS: 3,
    PRODUCTION_DAYS: 180,
    ONE_MONTH_DAYS: 30,
  },
  LOG_GROUP_PATTERNS: {
    FLOW_LOGS: "/aws/vpc/flowlogs/development",
  },
  VPC_ENDPOINT: {
    TYPE_GATEWAY: "Gateway",
  },
  VALIDATION: {
    MAX_AZS_MIN: 1,
    MAX_AZS_MAX: 3,
    NAT_GATEWAYS_MIN: 0,
  },
} as const;

// ============================================================================
// TEST FIXTURES CACHING CLASS
// ============================================================================

/**
 * TestFixtures caching class
 *
 * Provides cached test fixtures (NetworkingStack instances) to improve test
 * performance and reduce resource creation overhead. Each app instance gets
 * its own cached fixtures.
 *
 * @example
 * ```typescript
 * const fixtures = TestFixtures.getInstance(app);
 * const stack = fixtures.getMinimalStack();
 * ```
 */
export class TestFixtures {
  private static instances = new Map<cdk.App, TestFixtures>();
  private minimalStack: NetworkingStack | null = null;
  private devStack: NetworkingStack | null = null;
  private prodStack: NetworkingStack | null = null;

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
   * Get or create minimal test stack
   *
   * Minimal stack is cached per app instance to avoid recreating it for each test.
   *
   * @returns NetworkingStack instance with minimal configuration
   */
  getMinimalStack(): NetworkingStack {
    if (!this.minimalStack) {
      this.minimalStack = new NetworkingStack(
        this.app,
        TEST_CONSTANTS.STACK_IDS.MINIMAL,
        {
          env: {
            account: TEST_CONFIG.account,
            region: TEST_CONFIG.region,
          },
          envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        }
      );
    }
    return this.minimalStack;
  }

  /**
   * Get or create development test stack
   *
   * Development stack is cached per app instance with cost-optimised configuration.
   *
   * @returns NetworkingStack instance with development configuration
   */
  getDevStack(): NetworkingStack {
    if (!this.devStack) {
      this.devStack = new NetworkingStack(
        this.app,
        TEST_CONSTANTS.STACK_IDS.DEV,
        {
          env: {
            account: TEST_CONFIG.account,
            region: TEST_CONFIG.region,
          },
          envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
          maxAzs: TEST_CONSTANTS.VPC.MAX_AZS,
          natGateways: TEST_CONSTANTS.RESOURCE_COUNTS.NAT_GATEWAYS_NONE,
          enableVpcFlowLogs: true,
          flowLogRetention: logs.RetentionDays.THREE_DAYS,
        }
      );
    }
    return this.devStack;
  }

  /**
   * Get or create production test stack
   *
   * Production stack is cached per app instance with HA configuration.
   *
   * @returns NetworkingStack instance with production configuration
   */
  getProdStack(): NetworkingStack {
    if (!this.prodStack) {
      this.prodStack = new NetworkingStack(
        this.app,
        TEST_CONSTANTS.STACK_IDS.PROD,
        {
          env: {
            account: TEST_CONFIG.account,
            region: TEST_CONFIG.region,
          },
          envName: TEST_CONSTANTS.ENVIRONMENTS.PRODUCTION,
          maxAzs: TEST_CONSTANTS.VPC.MAX_AZS,
          natGateways: TEST_CONSTANTS.RESOURCE_COUNTS.NAT_GATEWAYS_HA,
          enableVpcFlowLogs: true,
          flowLogRetention: logs.RetentionDays.SIX_MONTHS,
          enableVpcEndpoints: true,
        }
      );
    }
    return this.prodStack;
  }

  /**
   * Clear cached fixtures for this app instance
   *
   * Useful for cleanup between test suites or when fixtures need to be recreated.
   */
  clear(): void {
    this.minimalStack = null;
    this.devStack = null;
    this.prodStack = null;
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
// TEST HELPERS
// ============================================================================

/**
 * Create test stack with default configuration
 *
 * Uses TestFixtures caching to improve performance for read-only tests.
 * For tests that modify stack configuration, creates a new stack instance.
 *
 * @param app - CDK app instance
 * @param idOrProps - Stack ID string, or props object if id is omitted
 * @param props - Optional stack properties to override defaults (only used if idOrProps is a string)
 * @returns NetworkingStack instance for testing
 *
 * @example
 * ```typescript
 * // With explicit stack ID
 * const stack = createTestStack(app, "MyTestStack", {
 *   envName: "production",
 * });
 *
 * // Without stack ID (uses default)
 * const stack = createTestStack(app, {
 *   envName: "production",
 * });
 * ```
 */
export function createTestStack(
  app: cdk.App,
  idOrProps?: string | Partial<NetworkingStackProps>,
  props?: Partial<NetworkingStackProps>
): NetworkingStack {
  if (!app) {
    throw new Error("CDK App instance is required to create test stack");
  }

  let id: string;
  let stackProps: Partial<NetworkingStackProps>;

  // Handle overloaded signature: idOrProps can be string (id) or object (props)
  if (typeof idOrProps === "string") {
    id = idOrProps;
    stackProps = props ?? {};
  } else {
    id = TEST_CONSTANTS.STACK_IDS.DEFAULT;
    stackProps = idOrProps ?? {};
  }

  if (!id) {
    throw new Error("Stack ID is required to create test stack");
  }

  return new NetworkingStack(app, id, {
    env: {
      account: TEST_CONFIG.account,
      region: TEST_CONFIG.region,
    },
    envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
    ...stackProps,
  });
}
