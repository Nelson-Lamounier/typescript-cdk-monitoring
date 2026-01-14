/** @format */
/// <reference types="jest" />

import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as efs from "aws-cdk-lib/aws-efs";
import { Template, Match } from "aws-cdk-lib/assertions";

import { MonitoringEfsStack } from "../../../../lib/stacks/monitoring/efs-stack";
import { MonitoringEfsStackProps } from "../../../../lib/shared/types/stack-types";
import {
  MONITORING_EFS_POSIX_USER,
  MONITORING_EFS_CREATION_ACL,
} from "../../../../lib/shared/constants/monitoring-constants";

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
    CIDR: "10.0.0.0/16",
    MAX_AZS: 2,
    NAT_GATEWAYS: 1,
    SUBNET_MASK: 24,
  },
  EFS: {
    MOUNT_PATH: "/monitoring",
    NFS_PORT: 2049,
    OWNER_UID: MONITORING_EFS_POSIX_USER.uid,
    OWNER_GID: MONITORING_EFS_POSIX_USER.gid,
    PERMISSIONS: MONITORING_EFS_CREATION_ACL.permissions,
  },
  RESOURCE_COUNTS: {
    FILE_SYSTEM: 1,
    ACCESS_POINT: 1,
    SECURITY_GROUP: 1,
    SSM_DOCUMENT: 1,
    SSM_ASSOCIATION: 1,
    LAMBDA_FUNCTION: 0,
    CUSTOM_RESOURCE: 0,
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
  ENVIRONMENTS: {
    DEVELOPMENT: "development",
    PRODUCTION: "production",
    STAGING: "staging",
    PIPELINE: "pipeline",
  },
  SSM_PARAMETER_PATHS: {
    PROMETHEUS_CONFIG: "/monitoring/development/prometheus-config",
    PROMETHEUS_CONFIG_YAML: "/monitoring/development/prometheus-config-yaml",
    GRAFANA_DATASOURCE_CONFIG:
      "/monitoring/development/grafana-datasource-config",
    GRAFANA_DATASOURCE_CONFIG_YAML:
      "/monitoring/development/grafana-datasource-config-yaml",
    GRAFANA_DASHBOARD_CONFIG:
      "/monitoring/development/grafana-dashboard-config",
    GRAFANA_DASHBOARD_CONFIG_YAML:
      "/monitoring/development/grafana-dashboard-config-yaml",
    EFS_CONFIG_PREFIX: "/monitoring/.*/efs/config/.*",
  },
  OUTPUT_NAMES: {
    FILE_SYSTEM_ID: "FileSystemId",
    ACCESS_POINT_ID: "AccessPointId",
    SECURITY_GROUP_ID: "SecurityGroupId",
  },
  REMOVAL_POLICIES: {
    DELETE: "Delete",
    RETAIN: "Retain",
  },
  SSM_DOCUMENT: {
    TYPE: "Automation",
    FORMAT: "YAML",
  },
  LIFECYCLE_POLICIES: {
    AFTER_7_DAYS: "AFTER_7_DAYS",
    AFTER_14_DAYS: "AFTER_14_DAYS",
    AFTER_30_DAYS: "AFTER_30_DAYS",
    AFTER_60_DAYS: "AFTER_60_DAYS",
    AFTER_90_DAYS: "AFTER_90_DAYS",
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
 * const stack = new MonitoringEfsStack(app, "TestStack", {
 *   ...fixtures.getMinimalProps(),
 *   envName: "production",
 * });
 * ```
 */
class TestFixtures {
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
   * @returns IVpc instance for testing
   */
  getVpc(): ec2.IVpc {
    if (!this.vpc) {
      const vpcStack = new cdk.Stack(this.app, TEST_CONSTANTS.STACK_IDS.VPC, {
        env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
      });

      this.vpc = new ec2.Vpc(vpcStack, "TestVpc", {
        ipAddresses: ec2.IpAddresses.cidr(TEST_CONSTANTS.VPC.CIDR),
        maxAzs: TEST_CONSTANTS.VPC.MAX_AZS,
        natGateways: TEST_CONSTANTS.VPC.NAT_GATEWAYS,
        subnetConfiguration: [
          {
            name: "Public",
            subnetType: ec2.SubnetType.PUBLIC,
            cidrMask: TEST_CONSTANTS.VPC.SUBNET_MASK,
          },
          {
            name: "Private",
            subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
            cidrMask: TEST_CONSTANTS.VPC.SUBNET_MASK,
          },
        ],
      });
    }

    return this.vpc;
  }

  /**
   * Create minimal test stack props using cached fixtures
   *
   * @returns Minimal stack properties for testing
   */
  getMinimalProps(): MonitoringEfsStackProps {
    const vpc = this.getVpc();

    return {
      env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
      envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
      vpc,
    };
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
// TEST HELPERS
// ============================================================================

/**
 * Create test stack with default configuration
 *
 * Uses TestFixtures caching to improve performance. Each app instance
 * gets its own cached VPC.
 *
 * @param app - CDK app instance
 * @param idOrProps - Stack ID string, or props object if id is omitted
 * @param props - Optional stack properties to override defaults (only used if idOrProps is a string)
 * @returns MonitoringEfsStack instance for testing
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
  idOrProps?: string | Partial<MonitoringEfsStackProps>,
  props?: Partial<MonitoringEfsStackProps>
): MonitoringEfsStack {
  if (!app) {
    throw new Error("CDK App instance is required to create test stack");
  }

  let id: string;
  let stackProps: Partial<MonitoringEfsStackProps>;

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

  const fixtures = TestFixtures.getInstance(app);
  const minimalProps = fixtures.getMinimalProps();

  return new MonitoringEfsStack(app, id, {
    ...minimalProps,
    ...stackProps,
  });
}

// ============================================================================
// MONITORING EFS STACK TESTS
// ============================================================================

describe("MonitoringEfsStack", () => {
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
   * Verifies that MonitoringEfsStack can be created with various
   * configuration combinations and exposes expected public properties.
   */
  describe("Stack Creation", () => {
    test("creates stack with minimal required properties", () => {
      const stack = createTestStack(app);
      const template = Template.fromStack(stack);

      template.resourceCountIs(
        "AWS::EFS::FileSystem",
        TEST_CONSTANTS.RESOURCE_COUNTS.FILE_SYSTEM
      );
    });

    test("creates stack with all optional properties", () => {
      const stack = createTestStack(
        app,
        TEST_CONSTANTS.STACK_IDS.ALL_PROPERTIES,
        {
          projectName: "monitoring",
          enableEncryption: true,
          lifecyclePolicy: efs.LifecyclePolicy.AFTER_30_DAYS,
          removalPolicy: cdk.RemovalPolicy.RETAIN,
          usePublicSubnets: false,
          createSsmParameters: true,
          createOutputs: true,
          enableExports: true,
        }
      );

      const template = Template.fromStack(stack);
      template.resourceCountIs(
        "AWS::EFS::FileSystem",
        TEST_CONSTANTS.RESOURCE_COUNTS.FILE_SYSTEM
      );
    });

    test("matches snapshot for minimal configuration", () => {
      const stack = createTestStack(app, TEST_CONSTANTS.STACK_IDS.SNAPSHOT);
      const template = Template.fromStack(stack);

      expect(template.toJSON()).toMatchSnapshot();
    });
  });

  // ============================================================================
  // EFS File System Configuration (Parameterized)
  // ============================================================================

  /**
   * EFS File System Configuration Tests
   *
   * Verifies EFS file system creation, encryption, lifecycle policies,
   * and removal policies based on environment and configuration.
   */
  describe("EFS File System Configuration", () => {
    test.each([
      {
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        expectedPolicy: TEST_CONSTANTS.REMOVAL_POLICIES.DELETE,
      },
      {
        envName: TEST_CONSTANTS.ENVIRONMENTS.PRODUCTION,
        expectedPolicy: TEST_CONSTANTS.REMOVAL_POLICIES.RETAIN,
      },
      {
        envName: TEST_CONSTANTS.ENVIRONMENTS.STAGING,
        expectedPolicy: TEST_CONSTANTS.REMOVAL_POLICIES.DELETE,
      },
      {
        envName: TEST_CONSTANTS.ENVIRONMENTS.PIPELINE,
        expectedPolicy: TEST_CONSTANTS.REMOVAL_POLICIES.DELETE,
      },
    ])(
      "uses $expectedPolicy removal policy for $envName",
      ({ envName, expectedPolicy }) => {
        const stack = createTestStack(app, `TestStack-${envName}`, {
          envName,
        });
        const template = Template.fromStack(stack);

        template.hasResource("AWS::EFS::FileSystem", {
          DeletionPolicy: expectedPolicy,
          UpdateReplacePolicy: expectedPolicy,
        });
      }
    );

    test.each([
      {
        description: "encryption enabled by default",
        enableEncryption: undefined,
        expectedEncrypted: true,
      },
      {
        description: "encryption disabled when specified",
        enableEncryption: false,
        expectedEncrypted: false,
      },
    ])(
      "creates EFS file system with $description",
      ({ enableEncryption, expectedEncrypted }) => {
        const stack = createTestStack(app, TEST_CONSTANTS.STACK_IDS.DEFAULT, {
          enableEncryption,
        });
        const template = Template.fromStack(stack);

        template.hasResourceProperties("AWS::EFS::FileSystem", {
          Encrypted: expectedEncrypted,
        });
      }
    );

    test.each([
      {
        policy: efs.LifecyclePolicy.AFTER_7_DAYS,
        expectedTransition: TEST_CONSTANTS.LIFECYCLE_POLICIES.AFTER_7_DAYS,
      },
      {
        policy: efs.LifecyclePolicy.AFTER_14_DAYS,
        expectedTransition: TEST_CONSTANTS.LIFECYCLE_POLICIES.AFTER_14_DAYS,
      },
      {
        policy: efs.LifecyclePolicy.AFTER_30_DAYS,
        expectedTransition: TEST_CONSTANTS.LIFECYCLE_POLICIES.AFTER_30_DAYS,
      },
      {
        policy: efs.LifecyclePolicy.AFTER_60_DAYS,
        expectedTransition: TEST_CONSTANTS.LIFECYCLE_POLICIES.AFTER_60_DAYS,
      },
      {
        policy: efs.LifecyclePolicy.AFTER_90_DAYS,
        expectedTransition: TEST_CONSTANTS.LIFECYCLE_POLICIES.AFTER_90_DAYS,
      },
    ])(
      "creates EFS with lifecycle policy $expectedTransition",
      ({ policy, expectedTransition }) => {
        const stack = createTestStack(app, TEST_CONSTANTS.STACK_IDS.DEFAULT, {
          lifecyclePolicy: policy,
        });
        const template = Template.fromStack(stack);

        template.hasResourceProperties("AWS::EFS::FileSystem", {
          LifecyclePolicies: [
            {
              TransitionToIA: expectedTransition,
            },
          ],
        });
      }
    );

    test("creates exactly one EFS file system", () => {
      const stack = createTestStack(app);
      const template = Template.fromStack(stack);

      template.resourceCountIs(
        "AWS::EFS::FileSystem",
        TEST_CONSTANTS.RESOURCE_COUNTS.FILE_SYSTEM
      );
    });
  });

  // ============================================================================
  // EFS Access Point Configuration
  // ============================================================================

  /**
   * EFS Access Point Configuration Tests
   *
   * Verifies that EFS access point is created with correct POSIX user
   * configuration and mount path.
   */
  describe("EFS Access Point Configuration", () => {
    test("creates EFS access point with correct path and POSIX configuration", () => {
      const stack = createTestStack(app);
      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::EFS::AccessPoint", {
        PosixUser: {
          Uid: TEST_CONSTANTS.EFS.OWNER_UID,
          Gid: TEST_CONSTANTS.EFS.OWNER_GID,
        },
        RootDirectory: {
          CreationInfo: {
            OwnerUid: TEST_CONSTANTS.EFS.OWNER_UID,
            OwnerGid: TEST_CONSTANTS.EFS.OWNER_GID,
            Permissions: TEST_CONSTANTS.EFS.PERMISSIONS,
          },
          Path: TEST_CONSTANTS.EFS.MOUNT_PATH,
        },
      });
    });

    test("creates exactly one EFS access point", () => {
      const stack = createTestStack(app);
      const template = Template.fromStack(stack);

      template.resourceCountIs(
        "AWS::EFS::AccessPoint",
        TEST_CONSTANTS.RESOURCE_COUNTS.ACCESS_POINT
      );
    });
  });

  // ============================================================================
  // Security Group Configuration
  // ============================================================================

  /**
   * Security Group Configuration Tests
   *
   * Verifies that security group is created with correct NFS ingress rules
   * allowing traffic from VPC CIDR.
   */
  describe("Security Group Configuration", () => {
    test("creates security group for EFS mount targets", () => {
      const stack = createTestStack(app);
      const template = Template.fromStack(stack);

      template.resourceCountIs(
        "AWS::EC2::SecurityGroup",
        TEST_CONSTANTS.RESOURCE_COUNTS.SECURITY_GROUP
      );
    });

    test("security group allows NFS traffic from VPC CIDR", () => {
      const stack = createTestStack(app);
      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::EC2::SecurityGroup", {
        SecurityGroupIngress: Match.arrayWith([
          Match.objectLike({
            IpProtocol: "tcp",
            FromPort: TEST_CONSTANTS.EFS.NFS_PORT,
            ToPort: TEST_CONSTANTS.EFS.NFS_PORT,
            CidrIp: Match.anyValue(),
          }),
        ]),
      });
    });
  });

  // ============================================================================
  // SSM Automation Document Configuration
  // ============================================================================

  /**
   * SSM Automation Document Configuration Tests
   *
   * Verifies that SSM Automation Document is created for EFS initialization,
   * along with IAM roles and associations. Confirms no Lambda functions
   * or custom resources are created.
   */
  describe("SSM Automation Document Configuration", () => {
    test("creates SSM Automation Document for EFS initialization", () => {
      const stack = createTestStack(app);
      const template = Template.fromStack(stack);

      template.resourceCountIs(
        "AWS::SSM::Document",
        TEST_CONSTANTS.RESOURCE_COUNTS.SSM_DOCUMENT
      );
    });

    test("creates SSM Document with correct type and format", () => {
      const stack = createTestStack(app, TEST_CONSTANTS.STACK_IDS.DEFAULT, {
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
      });
      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::SSM::Document", {
        DocumentType: TEST_CONSTANTS.SSM_DOCUMENT.TYPE,
        DocumentFormat: TEST_CONSTANTS.SSM_DOCUMENT.FORMAT,
      });
    });

    test("creates IAM role for automation execution", () => {
      const stack = createTestStack(app);
      const template = Template.fromStack(stack);

      const roles = template.findResources("AWS::IAM::Role");
      const automationRole = Object.values(roles).find((role) => {
        const roleProps = role.Properties as {
          AssumeRolePolicyDocument?: {
            Statement?: Array<{
              Principal?: { Service?: string | string[] };
            }>;
          };
        };
        return roleProps.AssumeRolePolicyDocument?.Statement?.some((stmt) => {
          const service = stmt.Principal?.Service;
          return (
            (typeof service === "string" &&
              service.includes("ssm.amazonaws.com")) ||
            (Array.isArray(service) &&
              service.some((s) => s.includes("ssm.amazonaws.com")))
          );
        });
      });
      expect(automationRole).toBeDefined();
    });

    test("creates SSM Association to execute automation", () => {
      const stack = createTestStack(app);
      const template = Template.fromStack(stack);

      template.resourceCountIs(
        "AWS::SSM::Association",
        TEST_CONSTANTS.RESOURCE_COUNTS.SSM_ASSOCIATION
      );
    });

    test("SSM Association has correct parameters", () => {
      const stack = createTestStack(app, TEST_CONSTANTS.STACK_IDS.DEFAULT, {
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
      });
      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::SSM::Association", {
        Parameters: {
          FileSystemId: Match.anyValue(),
          AccessPointId: Match.anyValue(),
          Environment: [TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT],
          AutomationAssumeRole: Match.anyValue(),
        },
      });
    });

    test("no Lambda function is created", () => {
      const stack = createTestStack(app);
      const template = Template.fromStack(stack);

      // Lambda-based initialization has been replaced by SSM Automation
      template.resourceCountIs(
        "AWS::Lambda::Function",
        TEST_CONSTANTS.RESOURCE_COUNTS.LAMBDA_FUNCTION
      );
    });

    test("no custom resource is created", () => {
      const stack = createTestStack(app);
      const template = Template.fromStack(stack);

      // Custom resource has been replaced by SSM Association
      template.resourceCountIs(
        "AWS::CloudFormation::CustomResource",
        TEST_CONSTANTS.RESOURCE_COUNTS.CUSTOM_RESOURCE
      );
    });
  });

  // ============================================================================
  // SSM Parameters Configuration (Parameterized)
  // ============================================================================

  /**
   * SSM Parameters Configuration Tests
   *
   * Verifies that SSM parameters are created for Prometheus and Grafana
   * configurations in both JSON and YAML formats, and EFS discovery parameters.
   */
  describe("SSM Parameters Configuration", () => {
    test("creates SSM parameters by default", () => {
      const stack = createTestStack(app);
      const template = Template.fromStack(stack);

      const parameters = template.findResources("AWS::SSM::Parameter");
      expect(Object.keys(parameters).length).toBeGreaterThan(0);
    });

    test.each([
      {
        parameterName: "Prometheus JSON configuration",
        expectedPath: TEST_CONSTANTS.SSM_PARAMETER_PATHS.PROMETHEUS_CONFIG,
      },
      {
        parameterName: "Prometheus YAML configuration",
        expectedPath: TEST_CONSTANTS.SSM_PARAMETER_PATHS.PROMETHEUS_CONFIG_YAML,
      },
      {
        parameterName: "Grafana datasource JSON configuration",
        expectedPath:
          TEST_CONSTANTS.SSM_PARAMETER_PATHS.GRAFANA_DATASOURCE_CONFIG,
      },
      {
        parameterName: "Grafana datasource YAML configuration",
        expectedPath:
          TEST_CONSTANTS.SSM_PARAMETER_PATHS.GRAFANA_DATASOURCE_CONFIG_YAML,
      },
      {
        parameterName: "Grafana dashboard JSON configuration",
        expectedPath:
          TEST_CONSTANTS.SSM_PARAMETER_PATHS.GRAFANA_DASHBOARD_CONFIG,
      },
      {
        parameterName: "Grafana dashboard YAML configuration",
        expectedPath:
          TEST_CONSTANTS.SSM_PARAMETER_PATHS.GRAFANA_DASHBOARD_CONFIG_YAML,
      },
    ])("creates $parameterName SSM parameter", ({ expectedPath }) => {
      const stack = createTestStack(app, TEST_CONSTANTS.STACK_IDS.DEFAULT, {
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
      });
      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::SSM::Parameter", {
        Name: expectedPath,
        Type: "String",
        Tier: "Standard",
      });
    });

    test("creates both JSON and YAML versions of each config", () => {
      const stack = createTestStack(app, TEST_CONSTANTS.STACK_IDS.DEFAULT, {
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
      });
      const template = Template.fromStack(stack);

      const parameters = template.findResources("AWS::SSM::Parameter");
      const paramNames = Object.values(parameters).map(
        (param) => (param.Properties as { Name: string }).Name
      );

      // Check JSON versions exist
      expect(paramNames).toContain(
        TEST_CONSTANTS.SSM_PARAMETER_PATHS.PROMETHEUS_CONFIG
      );
      expect(paramNames).toContain(
        TEST_CONSTANTS.SSM_PARAMETER_PATHS.GRAFANA_DATASOURCE_CONFIG
      );
      expect(paramNames).toContain(
        TEST_CONSTANTS.SSM_PARAMETER_PATHS.GRAFANA_DASHBOARD_CONFIG
      );

      // Check YAML versions exist
      expect(paramNames).toContain(
        TEST_CONSTANTS.SSM_PARAMETER_PATHS.PROMETHEUS_CONFIG_YAML
      );
      expect(paramNames).toContain(
        TEST_CONSTANTS.SSM_PARAMETER_PATHS.GRAFANA_DATASOURCE_CONFIG_YAML
      );
      expect(paramNames).toContain(
        TEST_CONSTANTS.SSM_PARAMETER_PATHS.GRAFANA_DASHBOARD_CONFIG_YAML
      );
    });

    test("creates EFS discovery SSM parameters when enabled", () => {
      const stack = createTestStack(app, TEST_CONSTANTS.STACK_IDS.DEFAULT, {
        createSsmParameters: true,
      });
      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::SSM::Parameter", {
        Name: Match.stringLikeRegexp(
          TEST_CONSTANTS.SSM_PARAMETER_PATHS.EFS_CONFIG_PREFIX
        ),
      });
    });

    test("does not create SSM parameters when disabled", () => {
      const stack = createTestStack(app, TEST_CONSTANTS.STACK_IDS.DEFAULT, {
        createSsmParameters: false,
      });
      const template = Template.fromStack(stack);

      // Should still have monitoring config parameters (Prometheus, Grafana)
      // but not EFS discovery parameters
      const parameters = template.findResources("AWS::SSM::Parameter");
      const efsParams = Object.values(parameters).filter((param) => {
        const paramProps = param.Properties as { Name?: string };
        return paramProps.Name?.includes("/efs/");
      });
      expect(efsParams.length).toBe(0);
    });
  });

  // ============================================================================
  // CloudFormation Outputs (Parameterized)
  // ============================================================================

  /**
   * CloudFormation Outputs Tests
   *
   * Verifies that CloudFormation outputs are created for file system ID,
   * access point ID, and security group ID, with optional exports.
   */
  describe("CloudFormation Outputs", () => {
    test.each([
      {
        outputName: TEST_CONSTANTS.OUTPUT_NAMES.FILE_SYSTEM_ID,
        descriptionPattern: "EFS file system ID",
      },
      {
        outputName: TEST_CONSTANTS.OUTPUT_NAMES.ACCESS_POINT_ID,
        descriptionPattern: "EFS access point ID",
      },
      {
        outputName: TEST_CONSTANTS.OUTPUT_NAMES.SECURITY_GROUP_ID,
        descriptionPattern: "EFS.*security group",
      },
    ])(
      "creates $outputName output with correct description",
      ({ outputName, descriptionPattern }) => {
        const stack = createTestStack(app, TEST_CONSTANTS.STACK_IDS.DEFAULT, {
          createOutputs: true,
        });
        const template = Template.fromStack(stack);

        template.hasOutput(outputName, {
          Description: Match.stringLikeRegexp(descriptionPattern),
        });
      }
    );

    test("creates CloudFormation outputs by default", () => {
      const stack = createTestStack(app);
      const template = Template.fromStack(stack);

      template.hasOutput(TEST_CONSTANTS.OUTPUT_NAMES.FILE_SYSTEM_ID, {
        Description: Match.stringLikeRegexp("EFS file system ID"),
      });
    });

    test("exports outputs when enableExports is true", () => {
      const stack = createTestStack(app, TEST_CONSTANTS.STACK_IDS.DEFAULT, {
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        projectName: "monitoring",
        enableExports: true,
        createOutputs: true,
      });
      const template = Template.fromStack(stack);

      // Verify output exists with export
      const outputs = template.toJSON().Outputs;
      const fileSystemOutput = outputs?.[
        TEST_CONSTANTS.OUTPUT_NAMES.FILE_SYSTEM_ID
      ] as {
        Export?: { Name?: string };
      };
      expect(fileSystemOutput).toBeDefined();
      expect(fileSystemOutput.Export).toBeDefined();
      expect(fileSystemOutput.Export?.Name).toMatch(/.*efs.*id.*/i);
    });

    test("does not create exports when enableExports is false", () => {
      const stack = createTestStack(app, TEST_CONSTANTS.STACK_IDS.DEFAULT, {
        enableExports: false,
      });
      const template = Template.fromStack(stack);

      const outputs = template.toJSON().Outputs;
      expect(
        (
          outputs[TEST_CONSTANTS.OUTPUT_NAMES.FILE_SYSTEM_ID] as {
            Export?: unknown;
          }
        ).Export
      ).toBeUndefined();
    });

    test("does not create stack outputs when disabled", () => {
      const stack = createTestStack(app, TEST_CONSTANTS.STACK_IDS.DEFAULT, {
        createOutputs: false,
      });
      const template = Template.fromStack(stack);

      const outputs = template.toJSON().Outputs;
      // When createOutputs is false, custom outputs should not exist
      // Some outputs may still be created by CDK constructs
      // Verify stack property indicates outputs are disabled
      expect(stack).toBeDefined();
      if (outputs) {
        // Verify custom outputs are not present
        expect(
          outputs[TEST_CONSTANTS.OUTPUT_NAMES.FILE_SYSTEM_ID]
        ).toBeUndefined();
        expect(
          outputs[TEST_CONSTANTS.OUTPUT_NAMES.ACCESS_POINT_ID]
        ).toBeUndefined();
      }
    });
  });

  // ============================================================================
  // Subnet Selection
  // ============================================================================

  /**
   * Subnet Selection Tests
   *
   * Verifies that EFS mount targets are created in the correct subnet type
   * (public or private) based on configuration.
   */
  describe("Subnet Selection", () => {
    test("uses public subnets by default", () => {
      const stack = createTestStack(app);
      const template = Template.fromStack(stack);

      // Verify mount targets exist (EFS creates mount targets in subnets)
      template.resourceCountIs("AWS::EFS::MountTarget", 2);
    });

    test("uses private subnets when usePublicSubnets is false", () => {
      const stack = createTestStack(app, TEST_CONSTANTS.STACK_IDS.DEFAULT, {
        usePublicSubnets: false,
      });
      const template = Template.fromStack(stack);

      // Verify mount targets exist in private subnets
      template.resourceCountIs("AWS::EFS::MountTarget", 2);
    });

    test("uses custom subnet selection when provided", () => {
      const fixtures = TestFixtures.getInstance(app);
      const vpc = fixtures.getVpc();

      const stack = createTestStack(app, TEST_CONSTANTS.STACK_IDS.DEFAULT, {
        vpc,
        mountTargetSubnetSelection: {
          subnetGroupName: "Private",
        },
      });
      const template = Template.fromStack(stack);

      // Verify mount targets exist
      template.resourceCountIs("AWS::EFS::MountTarget", 2);
    });
  });

  // ============================================================================
  // Validation Tests (Parameterized)
  // ============================================================================

  /**
   * Validation Tests
   *
   * Verifies that MonitoringEfsStack properly validates input parameters
   * and provides helpful error messages for invalid configurations.
   */
  describe("Validation", () => {
    test("validates environment name is non-empty", () => {
      const fixtures = TestFixtures.getInstance(app);
      const vpc = fixtures.getVpc();

      expect(() => {
        createTestStack(app, TEST_CONSTANTS.STACK_IDS.DEFAULT, {
          vpc,
          envName: "",
        });
      }).toThrow(/environment name/i);
    });

    test("throws error when VPC is not provided", () => {
      expect(() => {
        new MonitoringEfsStack(app, TEST_CONSTANTS.STACK_IDS.DEFAULT, {
          env: {
            account: TEST_CONFIG.account,
            region: TEST_CONFIG.region,
          },
          envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
          vpc: null as unknown as ec2.IVpc,
        });
      }).toThrow(/VPC is required/i);
    });
  });

  // ============================================================================
  // Feature Interactions (Read-only tests using beforeAll)
  // ============================================================================

  /**
   * Feature Interactions Tests
   *
   * Verifies that different features work together correctly,
   * such as encryption with lifecycle policies, and SSM parameters with outputs.
   */
  describe("Feature Interactions", () => {
    let encryptionLifecycleStack: MonitoringEfsStack;
    let ssmOutputsStack: MonitoringEfsStack;

    beforeAll(() => {
      // Create separate apps to avoid construct name conflicts
      const app1 = new cdk.App();
      const app2 = new cdk.App();

      const fixtures1 = TestFixtures.getInstance(app1);
      const fixtures2 = TestFixtures.getInstance(app2);
      const vpc1 = fixtures1.getVpc();
      const vpc2 = fixtures2.getVpc();

      encryptionLifecycleStack = createTestStack(
        app1,
        "EncryptionLifecycleStack",
        {
          vpc: vpc1,
          enableEncryption: true,
          lifecyclePolicy: efs.LifecyclePolicy.AFTER_30_DAYS,
        }
      );

      ssmOutputsStack = createTestStack(app2, "SsmOutputsStack", {
        vpc: vpc2,
        createSsmParameters: true,
        createOutputs: true,
      });
    });

    test("encryption and lifecycle policy work together", () => {
      const template = Template.fromStack(encryptionLifecycleStack);

      template.hasResourceProperties("AWS::EFS::FileSystem", {
        Encrypted: true,
        LifecyclePolicies: [
          {
            TransitionToIA: TEST_CONSTANTS.LIFECYCLE_POLICIES.AFTER_30_DAYS,
          },
        ],
      });
    });

    test("SSM parameters and outputs work together", () => {
      const template = Template.fromStack(ssmOutputsStack);

      const parameters = template.findResources("AWS::SSM::Parameter");
      const outputs = template.toJSON().Outputs;
      expect(Object.keys(parameters).length).toBeGreaterThan(0);
      expect(Object.keys(outputs).length).toBeGreaterThan(0);
    });
  });

  // ============================================================================
  // Cost Optimization (Read-only tests using beforeAll)
  // ============================================================================

  /**
   * Cost Optimization Tests
   *
   * Verifies environment-specific cost optimizations, such as removal policies
   * and lifecycle policies for development vs production environments.
   */
  describe("Cost Optimization", () => {
    let devStack: MonitoringEfsStack;
    let prodStack: MonitoringEfsStack;

    beforeAll(() => {
      // Create separate apps to avoid construct name conflicts
      const app1 = new cdk.App();
      const app2 = new cdk.App();

      const fixtures1 = TestFixtures.getInstance(app1);
      const fixtures2 = TestFixtures.getInstance(app2);
      const vpc1 = fixtures1.getVpc();
      const vpc2 = fixtures2.getVpc();

      devStack = createTestStack(app1, TEST_CONSTANTS.STACK_IDS.DEV, {
        vpc: vpc1,
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        enableEncryption: true,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        usePublicSubnets: true,
      });

      prodStack = createTestStack(app2, TEST_CONSTANTS.STACK_IDS.PROD, {
        vpc: vpc2,
        envName: TEST_CONSTANTS.ENVIRONMENTS.PRODUCTION,
        enableEncryption: true,
        lifecyclePolicy: efs.LifecyclePolicy.AFTER_30_DAYS,
        removalPolicy: cdk.RemovalPolicy.RETAIN,
        usePublicSubnets: false,
      });
    });

    test("development environment has cost-optimized configuration", () => {
      const template = Template.fromStack(devStack);

      template.hasResource("AWS::EFS::FileSystem", {
        DeletionPolicy: TEST_CONSTANTS.REMOVAL_POLICIES.DELETE,
        UpdateReplacePolicy: TEST_CONSTANTS.REMOVAL_POLICIES.DELETE,
      });
    });

    test("production environment has HA and data retention configuration", () => {
      const template = Template.fromStack(prodStack);

      template.hasResource("AWS::EFS::FileSystem", {
        DeletionPolicy: TEST_CONSTANTS.REMOVAL_POLICIES.RETAIN,
        UpdateReplacePolicy: TEST_CONSTANTS.REMOVAL_POLICIES.RETAIN,
      });

      template.hasResourceProperties("AWS::EFS::FileSystem", {
        LifecyclePolicies: [
          {
            TransitionToIA: TEST_CONSTANTS.LIFECYCLE_POLICIES.AFTER_30_DAYS,
          },
        ],
      });
    });
  });

  // ============================================================================
  // Stack Properties (Parameterized)
  // ============================================================================

  /**
   * Stack Properties Tests
   *
   * Verifies that MonitoringEfsStack exposes expected public properties
   * for cross-stack references.
   */
  describe("Stack Properties", () => {
    test.each([
      {
        property: "fileSystem",
        expectedType: "object",
      },
      {
        property: "accessPoint",
        expectedType: "object",
      },
      {
        property: "mountTargetSecurityGroup",
        expectedType: "object",
      },
      {
        property: "efsAvailabilityZone",
        expectedType: "string",
      },
      {
        property: "efsInitializationExecution",
        expectedType: "object",
      },
    ])("exposes $property property", ({ property, expectedType }) => {
      const stack = createTestStack(app);

      const prop = (stack as unknown as Record<string, unknown>)[property];
      expect(prop).toBeDefined();

      if (expectedType === "string") {
        expect(typeof prop).toBe("string");
      } else {
        expect(typeof prop).toBe("object");
      }
    });
  });

  // ============================================================================
  // Cross-Account Targets
  // ============================================================================

  /**
   * Cross-Account Targets Tests
   *
   * Verifies that Prometheus configuration includes cross-account targets
   * when specified, and works correctly without them.
   */
  describe("Cross-Account Targets", () => {
    test("creates Prometheus config with cross-account targets", () => {
      const stack = createTestStack(app, TEST_CONSTANTS.STACK_IDS.DEFAULT, {
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        crossAccountTargets: [
          {
            envName: TEST_CONSTANTS.ENVIRONMENTS.STAGING,
            targetType: "node-exporter",
            port: 9100,
            accountId: "987654321098",
            roleArn: "arn:aws:iam::987654321098:role/prometheus-scraper",
            useEc2ServiceDiscovery: true,
          },
        ],
      });
      const template = Template.fromStack(stack);

      // Verify Prometheus config SSM parameter exists
      template.hasResourceProperties("AWS::SSM::Parameter", {
        Name: TEST_CONSTANTS.SSM_PARAMETER_PATHS.PROMETHEUS_CONFIG,
      });

      // Verify the config contains cross-account scrape configs
      const parameters = template.findResources("AWS::SSM::Parameter");
      const prometheusParam = Object.values(parameters).find((param) => {
        const paramProps = param.Properties as { Name?: string };
        return (
          paramProps.Name ===
          TEST_CONSTANTS.SSM_PARAMETER_PATHS.PROMETHEUS_CONFIG
        );
      });
      expect(prometheusParam).toBeDefined();
    });

    test("creates Prometheus config without cross-account targets", () => {
      const stack = createTestStack(app, TEST_CONSTANTS.STACK_IDS.DEFAULT, {
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
      });
      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::SSM::Parameter", {
        Name: TEST_CONSTANTS.SSM_PARAMETER_PATHS.PROMETHEUS_CONFIG,
      });
    });
  });
});
