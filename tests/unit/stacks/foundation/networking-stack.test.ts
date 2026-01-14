/** @format */
/// <reference types="jest" />

import * as cdk from "aws-cdk-lib";
import * as logs from "aws-cdk-lib/aws-logs";
import { Template, Match } from "aws-cdk-lib/assertions";

import { NetworkingStack } from "../../../../lib/stacks/foundation/networking-stack";
import { NetworkingStackProps } from "../../../../lib/shared/types/stack-types";
import {
  VPC_CIDR_BLOCKS,
  DEFAULT_MAX_AZS,
  DEFAULT_SUBNET_CIDR_MASK,
} from "../../../../lib/shared/constants/networking-constants";

// ============================================================================
// CUSTOM MATCHERS (Type declarations will be added when matchers are used)
// ============================================================================

// ============================================================================
// TEST CONFIGURATION
// ============================================================================

/**
 * Test configuration constants
 * Centralised configuration values used across all tests
 */
const TEST_CONFIG = {
  account: "123456789012",
  region: "eu-west-1",
} as const;

/**
 * Test constants - avoid magic numbers and strings
 * All hardcoded values used in tests should be defined here
 */
const TEST_CONSTANTS = {
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
class TestFixtures {
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
   * Development stack is cached per app instance with cost-optimized configuration.
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
function createTestStack(
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

// ============================================================================
// NETWORKING STACK TESTS
// ============================================================================

describe("NetworkingStack", () => {
  let app: cdk.App;

  beforeEach(() => {
    app = new cdk.App();
  });

  // ============================================================================
  // Stack Creation
  // ============================================================================

  /**
   * Stack Creation Tests
   *
   * Verifies that NetworkingStack can be created with various
   * configuration combinations and exposes expected public properties.
   */
  describe("Stack Creation", () => {
    test("creates stack with minimal required properties", () => {
      const stack = createTestStack(app);
      const template = Template.fromStack(stack);

      template.resourceCountIs(
        "AWS::EC2::VPC",
        TEST_CONSTANTS.RESOURCE_COUNTS.VPC
      );
    });

    test("creates stack with all optional properties", () => {
      const stack = createTestStack(
        app,
        TEST_CONSTANTS.STACK_IDS.ALL_PROPERTIES,
        {
          projectName: "portfolio",
          vpcCidr: "10.1.0.0/16",
          vpcName: "custom-vpc-name",
          maxAzs: TEST_CONSTANTS.VPC.MAX_AZS,
          natGateways: 1,
          enableVpcFlowLogs: true,
          enableVpcEndpoints: true,
          enableDnsHostnames: true,
          enableDnsSupport: true,
          createSsmParameters: true,
          createOutputs: true,
          enableExports: true,
        }
      );

      const template = Template.fromStack(stack);
      template.resourceCountIs(
        "AWS::EC2::VPC",
        TEST_CONSTANTS.RESOURCE_COUNTS.VPC
      );
    });

    test("matches snapshot for minimal configuration", () => {
      const stack = createTestStack(app, TEST_CONSTANTS.STACK_IDS.SNAPSHOT);
      const template = Template.fromStack(stack);

      expect(template.toJSON()).toMatchSnapshot();
    });
  });

  // ============================================================================
  // VPC Configuration (Parameterized)
  // ============================================================================

  /**
   * VPC Configuration Tests
   *
   * Verifies VPC creation with environment-specific CIDR blocks,
   * custom CIDR blocks, DNS configuration, and tagging.
   */
  describe("VPC Configuration", () => {
    test.each([
      {
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        expectedCidr: TEST_CONSTANTS.VPC.CIDR.DEVELOPMENT,
      },
      {
        envName: TEST_CONSTANTS.ENVIRONMENTS.PRODUCTION,
        expectedCidr: TEST_CONSTANTS.VPC.CIDR.PRODUCTION,
      },
      {
        envName: TEST_CONSTANTS.ENVIRONMENTS.PIPELINE,
        expectedCidr: TEST_CONSTANTS.VPC.CIDR.PIPELINE,
      },
      {
        envName: TEST_CONSTANTS.ENVIRONMENTS.STAGING,
        expectedCidr: TEST_CONSTANTS.VPC.CIDR.STAGING,
      },
    ])(
      "creates VPC with default CIDR $expectedCidr for $envName",
      ({ envName, expectedCidr }) => {
        const stack = createTestStack(app, `TestStack-${envName}`, { envName });
        const template = Template.fromStack(stack);

        template.hasResourceProperties("AWS::EC2::VPC", {
          CidrBlock: expectedCidr,
          EnableDnsHostnames: true,
          EnableDnsSupport: true,
        });
      }
    );

    test("creates VPC with custom CIDR", () => {
      const stack = createTestStack(app, TEST_CONSTANTS.STACK_IDS.DEFAULT, {
        vpcCidr: TEST_CONSTANTS.VPC.CIDR.CUSTOM,
      });

      const template = Template.fromStack(stack);
      template.hasResourceProperties("AWS::EC2::VPC", {
        CidrBlock: TEST_CONSTANTS.VPC.CIDR.CUSTOM,
      });
    });

    test("creates exactly one VPC", () => {
      const stack = createTestStack(app);
      const template = Template.fromStack(stack);

      template.resourceCountIs(
        "AWS::EC2::VPC",
        TEST_CONSTANTS.RESOURCE_COUNTS.VPC
      );
    });

    test("VPC has correct tags", () => {
      const stack = createTestStack(app, TEST_CONSTANTS.STACK_IDS.DEFAULT, {
        projectName: "portfolio",
      });

      const template = Template.fromStack(stack);

      // CDK applies tags at stack level, which propagate to resources
      // Verify VPC exists and tags are applied via stack-level tagging
      template.hasResourceProperties("AWS::EC2::VPC", {
        Tags: Match.arrayWith([
          Match.objectLike({
            Key: TEST_CONSTANTS.TAGS.ENVIRONMENT,
            Value: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
          }),
          Match.objectLike({
            Key: TEST_CONSTANTS.TAGS.MANAGED_BY,
            Value: TEST_CONSTANTS.TAGS.CDK,
          }),
        ]),
      });
    });
  });

  // ============================================================================
  // Subnet Configuration (Parameterized)
  // ============================================================================

  /**
   * Subnet Configuration Tests
   *
   * Verifies subnet creation based on availability zones,
   * public and private subnet properties, and tagging.
   */
  describe("Subnet Configuration", () => {
    test.each([
      { maxAzs: 1, expectedSubnets: 2 },
      { maxAzs: 2, expectedSubnets: 4 },
      { maxAzs: 3, expectedSubnets: 6 },
    ])(
      "creates $expectedSubnets subnets for $maxAzs AZs",
      ({ maxAzs, expectedSubnets }) => {
        const stack = createTestStack(app, `TestStack-${maxAzs}AZ`, { maxAzs });
        const template = Template.fromStack(stack);

        template.resourceCountIs("AWS::EC2::Subnet", expectedSubnets);
      }
    );

    test("creates public subnets with correct properties", () => {
      const stack = createTestStack(app, TEST_CONSTANTS.STACK_IDS.DEFAULT, {
        maxAzs: TEST_CONSTANTS.VPC.MAX_AZS,
      });
      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::EC2::Subnet", {
        MapPublicIpOnLaunch: true,
        Tags: Match.arrayWith([
          Match.objectLike({
            Key: TEST_CONSTANTS.TAGS.SUBNET_NAME,
            Value: TEST_CONSTANTS.TAGS.PUBLIC,
          }),
        ]),
      });
    });

    test("creates private subnets with correct properties", () => {
      const stack = createTestStack(app, TEST_CONSTANTS.STACK_IDS.DEFAULT, {
        maxAzs: TEST_CONSTANTS.VPC.MAX_AZS,
      });
      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::EC2::Subnet", {
        MapPublicIpOnLaunch: false,
        Tags: Match.arrayWith([
          Match.objectLike({
            Key: TEST_CONSTANTS.TAGS.SUBNET_NAME,
            Value: TEST_CONSTANTS.TAGS.PRIVATE,
          }),
        ]),
      });
    });
  });

  // ============================================================================
  // NAT Gateway Configuration (Parameterized)
  // ============================================================================

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

        template.resourceCountIs("AWS::EC2::NatGateway", expectedNat);
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

  // ============================================================================
  // VPC Flow Logs (Parameterized)
  // ============================================================================

  /**
   * VPC Flow Logs Tests
   *
   * Verifies VPC flow log creation, CloudWatch log group configuration,
   * retention policies, and environment-specific removal policies.
   */
  describe("VPC Flow Logs", () => {
    test.each([
      {
        description: "flow logs enabled",
        enableVpcFlowLogs: true,
        expectedCount: TEST_CONSTANTS.RESOURCE_COUNTS.FLOW_LOGS_ENABLED,
      },
      {
        description: "flow logs disabled",
        enableVpcFlowLogs: false,
        expectedCount: TEST_CONSTANTS.RESOURCE_COUNTS.FLOW_LOGS_DISABLED,
      },
    ])(
      "creates VPC flow logs when $description",
      ({ enableVpcFlowLogs, expectedCount }) => {
        const stack = createTestStack(app, TEST_CONSTANTS.STACK_IDS.DEFAULT, {
          enableVpcFlowLogs,
        });

        const template = Template.fromStack(stack);
        template.resourceCountIs("AWS::EC2::FlowLog", expectedCount);
      }
    );

    test("creates CloudWatch log group with correct retention", () => {
      const stack = createTestStack(app, TEST_CONSTANTS.STACK_IDS.DEFAULT, {
        enableVpcFlowLogs: true,
        flowLogRetention: logs.RetentionDays.ONE_MONTH,
      });

      const template = Template.fromStack(stack);
      template.hasResourceProperties("AWS::Logs::LogGroup", {
        LogGroupName: Match.stringLikeRegexp(
          TEST_CONSTANTS.LOG_GROUP_PATTERNS.FLOW_LOGS
        ),
        RetentionInDays: TEST_CONSTANTS.LOG_RETENTION.ONE_MONTH_DAYS,
      });
    });

    test.each([
      {
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        expectedPolicy: TEST_CONSTANTS.REMOVAL_POLICIES.DELETE,
      },
      {
        envName: TEST_CONSTANTS.ENVIRONMENTS.PRODUCTION,
        expectedPolicy: TEST_CONSTANTS.REMOVAL_POLICIES.RETAIN,
      },
    ])(
      "uses $expectedPolicy removal policy for $envName log group",
      ({ envName, expectedPolicy }) => {
        const stack = createTestStack(app, `TestStack-${envName}`, {
          envName,
          enableVpcFlowLogs: true,
        });

        const template = Template.fromStack(stack);
        template.hasResource("AWS::Logs::LogGroup", {
          DeletionPolicy: expectedPolicy,
          UpdateReplacePolicy: expectedPolicy,
        });
      }
    );
  });

  // ============================================================================
  // VPC Endpoints
  // ============================================================================

  /**
   * VPC Endpoints Tests
   *
   * Verifies VPC endpoint creation for S3 and DynamoDB gateway endpoints,
   * and the ability to disable endpoints.
   */
  describe("VPC Endpoints", () => {
    test("creates S3 and DynamoDB gateway endpoints by default", () => {
      const stack = createTestStack(app);
      const template = Template.fromStack(stack);

      const endpoints = template.findResources("AWS::EC2::VPCEndpoint");
      const gatewayEndpoints = Object.values(endpoints).filter((endpoint) => {
        const endpointProps = endpoint.Properties as {
          VpcEndpointType?: string;
        };
        return (
          endpointProps.VpcEndpointType ===
          TEST_CONSTANTS.VPC_ENDPOINT.TYPE_GATEWAY
        );
      });

      expect(gatewayEndpoints.length).toBe(
        TEST_CONSTANTS.RESOURCE_COUNTS.GATEWAY_ENDPOINTS
      );
    });

    test("does not create VPC endpoints when disabled", () => {
      const stack = createTestStack(app, TEST_CONSTANTS.STACK_IDS.DEFAULT, {
        enableVpcEndpoints: false,
      });

      const template = Template.fromStack(stack);
      template.resourceCountIs(
        "AWS::EC2::VPCEndpoint",
        TEST_CONSTANTS.RESOURCE_COUNTS.VPC_ENDPOINTS_DISABLED
      );
    });
  });

  // ============================================================================
  // SSM Parameters
  // ============================================================================

  /**
   * SSM Parameters Tests
   *
   * Verifies SSM parameter creation for VPC ID and the ability
   * to disable parameter creation.
   */
  describe("SSM Parameters", () => {
    test("creates VPC ID SSM parameter", () => {
      const stack = createTestStack(app, TEST_CONSTANTS.STACK_IDS.DEFAULT, {
        createSsmParameters: true,
      });

      const template = Template.fromStack(stack);
      template.hasResourceProperties("AWS::SSM::Parameter", {
        Name: TEST_CONSTANTS.SSM_PARAMETER_PATHS.VPC_ID,
        Type: "String",
      });
    });

    test("does not create SSM parameters when disabled", () => {
      const stack = createTestStack(app, TEST_CONSTANTS.STACK_IDS.DEFAULT, {
        createSsmParameters: false,
      });

      const template = Template.fromStack(stack);
      template.resourceCountIs(
        "AWS::SSM::Parameter",
        TEST_CONSTANTS.RESOURCE_COUNTS.SSM_PARAMETERS_DISABLED
      );
    });
  });

  // ============================================================================
  // Validation Tests (Parameterized)
  // ============================================================================

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

  // ============================================================================
  // Feature Interactions (Read-only tests using beforeAll)
  // ============================================================================

  /**
   * Feature Interactions Tests
   *
   * Verifies that different features work together correctly,
   * such as flow logs with VPC endpoints.
   */
  describe("Feature Interactions", () => {
    let interactionStack: NetworkingStack;

    beforeAll(() => {
      const testApp = new cdk.App();
      interactionStack = createTestStack(testApp, "InteractionStack", {
        enableVpcFlowLogs: true,
        enableVpcEndpoints: true,
      });
    });

    test("flow logs and VPC endpoints work together", () => {
      const template = Template.fromStack(interactionStack);

      template.resourceCountIs(
        "AWS::EC2::FlowLog",
        TEST_CONSTANTS.RESOURCE_COUNTS.FLOW_LOGS_ENABLED
      );

      const endpoints = template.findResources("AWS::EC2::VPCEndpoint");
      expect(Object.keys(endpoints).length).toBe(
        TEST_CONSTANTS.RESOURCE_COUNTS.GATEWAY_ENDPOINTS
      );
    });
  });

  // ============================================================================
  // Cost Optimization (Read-only tests using beforeAll)
  // ============================================================================

  /**
   * Cost Optimization Tests
   *
   * Verifies environment-specific cost optimizations, such as NAT gateway
   * configuration and log retention for development vs production environments.
   */
  describe("Cost Optimization", () => {
    let devStack: NetworkingStack;
    let prodStack: NetworkingStack;

    beforeAll(() => {
      // Create separate apps to avoid construct name conflicts
      const app1 = new cdk.App();
      const app2 = new cdk.App();

      const fixtures1 = TestFixtures.getInstance(app1);
      const fixtures2 = TestFixtures.getInstance(app2);

      devStack = fixtures1.getDevStack();
      prodStack = fixtures2.getProdStack();
    });

    test("development environment has cost-optimized configuration", () => {
      const template = Template.fromStack(devStack);

      template.resourceCountIs(
        "AWS::EC2::NatGateway",
        TEST_CONSTANTS.RESOURCE_COUNTS.NAT_GATEWAYS_NONE
      );
      template.hasResourceProperties("AWS::Logs::LogGroup", {
        RetentionInDays: TEST_CONSTANTS.LOG_RETENTION.DEVELOPMENT_DAYS,
      });
    });

    test("production environment has HA configuration", () => {
      const template = Template.fromStack(prodStack);

      template.resourceCountIs(
        "AWS::EC2::NatGateway",
        TEST_CONSTANTS.RESOURCE_COUNTS.NAT_GATEWAYS_HA
      );
      template.hasResourceProperties("AWS::Logs::LogGroup", {
        RetentionInDays: TEST_CONSTANTS.LOG_RETENTION.PRODUCTION_DAYS,
      });
    });
  });

  // ============================================================================
  // Stack Properties (Parameterized)
  // ============================================================================

  /**
   * Stack Properties Tests
   *
   * Verifies that NetworkingStack exposes expected public properties
   * for cross-stack references.
   */
  describe("Stack Properties", () => {
    test.each([
      {
        property: "vpc",
        expectedProperty: "vpcId",
      },
      {
        property: "publicSubnets",
        expectedLength: TEST_CONSTANTS.VPC.MAX_AZS,
      },
      {
        property: "privateSubnets",
        expectedLength: TEST_CONSTANTS.VPC.MAX_AZS,
      },
      {
        property: "isolatedSubnets",
        expectedType: "array",
      },
    ])(
      "exposes $property property",
      ({
        property,
        expectedProperty,
        expectedLength,
        expectedType,
      }: {
        property: string;
        expectedProperty?: string;
        expectedLength?: number;
        expectedType?: string;
      }) => {
        const stack = createTestStack(app, TEST_CONSTANTS.STACK_IDS.DEFAULT, {
          maxAzs: TEST_CONSTANTS.VPC.MAX_AZS,
        });

        const prop = (stack as unknown as Record<string, unknown>)[property];
        expect(prop).toBeDefined();

        if (expectedProperty) {
          expect(
            (prop as Record<string, unknown>)[expectedProperty]
          ).toBeDefined();
        }
        if (expectedLength !== undefined) {
          expect((prop as unknown[]).length).toBe(expectedLength);
        }
        if (expectedType === "array") {
          expect(Array.isArray(prop)).toBe(true);
        }
      }
    );
  });
});
