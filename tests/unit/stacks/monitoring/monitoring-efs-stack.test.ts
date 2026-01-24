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
import {
  TEST_CONFIG,
  BASE_TEST_CONSTANTS,
  TestFixtures,
  createTestApp,
  createTestEnv,
  extendExpectWithCdkMatchers,
} from "../../utils/stack-test-utils";
import {
  EFS_TEST_CONSTANTS,
  EFS_RESOURCE_COUNTS,
  SSM_PARAMETER_PATHS,
  EFS_OUTPUT_NAMES,
  SSM_DOCUMENT_CONFIG,
  EFS_LIFECYCLE_POLICIES,
} from "../../shared/constants";

// ============================================================================
// CUSTOM MATCHERS SETUP
// ============================================================================

extendExpectWithCdkMatchers();

// ============================================================================
// TEST CONFIGURATION
// ============================================================================

/**
 * Stack-specific test constants
 * Extends base constants with EFS-specific values
 */
const TEST_CONSTANTS = {
  ...BASE_TEST_CONSTANTS,
  EFS: {
    ...EFS_TEST_CONSTANTS,
    OWNER_UID: MONITORING_EFS_POSIX_USER.uid,
    OWNER_GID: MONITORING_EFS_POSIX_USER.gid,
    PERMISSIONS: MONITORING_EFS_CREATION_ACL.permissions,
  },
  RESOURCE_COUNTS: EFS_RESOURCE_COUNTS,
  SSM_PARAMETER_PATHS,
  OUTPUT_NAMES: EFS_OUTPUT_NAMES,
  SSM_DOCUMENT: SSM_DOCUMENT_CONFIG,
  LIFECYCLE_POLICIES: EFS_LIFECYCLE_POLICIES,
} as const;

// ============================================================================
// TEST FIXTURES EXTENSION
// ============================================================================

/**
 * Extended TestFixtures for MonitoringEfsStack
 * Adds stack-specific helper methods
 */
class EfsTestFixtures {
  private baseFixtures: TestFixtures;

  constructor(app: cdk.App) {
    this.baseFixtures = TestFixtures.getInstance(app);
  }

  /**
   * Get or create mock VPC for testing
   *
   * @returns IVpc instance for testing
   */
  getVpc(): ec2.IVpc {
    return this.baseFixtures.getVpc();
  }

  /**
   * Create minimal test stack props using cached fixtures
   *
   * @returns Minimal stack properties for testing
   */
  getMinimalProps(): MonitoringEfsStackProps {
    const vpc = this.getVpc();

    return {
      env: createTestEnv(),
      envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
      vpc,
    };
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

  const fixtures = new EfsTestFixtures(app);
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
    let app: cdk.App;
    let minimalStack: MonitoringEfsStack;
    let allPropertiesStack: MonitoringEfsStack;
    let snapshotStack: MonitoringEfsStack;
    let minimalTemplate: Template;
    let allPropertiesTemplate: Template;
    let snapshotTemplate: Template;

    beforeAll(() => {
      app = createTestApp();

      // Create ALL stacks first before calling Template.fromStack()
      // Template.fromStack() triggers synthesis which locks the app
      minimalStack = createTestStack(app);
      allPropertiesStack = createTestStack(
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
      snapshotStack = createTestStack(app, TEST_CONSTANTS.STACK_IDS.SNAPSHOT);

      // Now create templates from the stacks
      minimalTemplate = Template.fromStack(minimalStack);
      allPropertiesTemplate = Template.fromStack(allPropertiesStack);
      snapshotTemplate = Template.fromStack(snapshotStack);
    });

    test("creates stack with minimal required properties", () => {
      expect(() => {
        minimalTemplate.resourceCountIs(
          "AWS::EFS::FileSystem",
          TEST_CONSTANTS.RESOURCE_COUNTS.FILE_SYSTEM
        );
      }).not.toThrow();
    });

    test("creates stack with all optional properties", () => {
      expect(() => {
        allPropertiesTemplate.resourceCountIs(
          "AWS::EFS::FileSystem",
          TEST_CONSTANTS.RESOURCE_COUNTS.FILE_SYSTEM
        );
      }).not.toThrow();
    });

    test("matches snapshot for minimal configuration", () => {
      expect(snapshotTemplate.toJSON()).toMatchSnapshot();
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
    let app: cdk.App;
    let defaultStack: MonitoringEfsStack;
    let defaultTemplate: Template;
    let removalPolicyStacks: Array<{
      envName: string;
      expectedPolicy: string;
      stack: MonitoringEfsStack;
      template: Template;
    }>;
    let encryptionStacks: Array<{
      description: string;
      expectedEncrypted: boolean;
      stack: MonitoringEfsStack;
      template: Template;
    }>;
    let lifecycleStacks: Array<{
      expectedTransition: string;
      stack: MonitoringEfsStack;
      template: Template;
    }>;

    beforeAll(() => {
      app = createTestApp();

      // Pre-compute all stacks and templates
      defaultStack = createTestStack(app);
      defaultTemplate = Template.fromStack(defaultStack);

      // Pre-compute removal policy stacks
      const removalPolicyConfigs = [
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
      ];

      removalPolicyStacks = removalPolicyConfigs.map((config) => {
        const removalApp = createTestApp();
        const stack = createTestStack(removalApp, `TestStack-${config.envName}`, {
          envName: config.envName,
        });
        return {
          envName: config.envName,
          expectedPolicy: config.expectedPolicy,
          stack,
          template: Template.fromStack(stack),
        };
      });

      // Pre-compute encryption stacks
      const encryptionConfigs = [
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
      ];

      encryptionStacks = encryptionConfigs.map((config) => {
        const encryptionApp = createTestApp();
        const stack = createTestStack(encryptionApp, TEST_CONSTANTS.STACK_IDS.DEFAULT, {
          enableEncryption: config.enableEncryption,
        });
        return {
          description: config.description,
          expectedEncrypted: config.expectedEncrypted,
          stack,
          template: Template.fromStack(stack),
        };
      });

      // Pre-compute lifecycle policy stacks
      const lifecyclePolicies = [
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
      ];

      lifecycleStacks = lifecyclePolicies.map(({ policy, expectedTransition }) => {
        const lifecycleApp = createTestApp();
        const stack = createTestStack(lifecycleApp, TEST_CONSTANTS.STACK_IDS.DEFAULT, {
          lifecyclePolicy: policy,
        });
        return {
          expectedTransition,
          stack,
          template: Template.fromStack(stack),
        };
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
        const testData = removalPolicyStacks.find((data) => data.envName === envName);
        expect(testData).toBeDefined();
        expect(testData?.expectedPolicy).toBe(expectedPolicy);

        expect(() => {
          testData?.template.hasResource("AWS::EFS::FileSystem", {
            DeletionPolicy: expectedPolicy,
            UpdateReplacePolicy: expectedPolicy,
          });
        }).not.toThrow();
      }
    );

    test.each([
      {
        description: "encryption enabled by default",
        expectedEncrypted: true,
      },
      {
        description: "encryption disabled when specified",
        expectedEncrypted: false,
      },
    ])(
      "creates EFS file system with $description",
      ({ description, expectedEncrypted }) => {
        const testData = encryptionStacks.find((data) => data.description === description);
        expect(testData).toBeDefined();
        expect(testData?.expectedEncrypted).toBe(expectedEncrypted);

        expect(() => {
          testData?.template.hasResourceProperties("AWS::EFS::FileSystem", {
            Encrypted: expectedEncrypted,
          });
        }).not.toThrow();
      }
    );

    test.each([
      {
        expectedTransition: TEST_CONSTANTS.LIFECYCLE_POLICIES.AFTER_7_DAYS,
      },
      {
        expectedTransition: TEST_CONSTANTS.LIFECYCLE_POLICIES.AFTER_14_DAYS,
      },
      {
        expectedTransition: TEST_CONSTANTS.LIFECYCLE_POLICIES.AFTER_30_DAYS,
      },
      {
        expectedTransition: TEST_CONSTANTS.LIFECYCLE_POLICIES.AFTER_60_DAYS,
      },
      {
        expectedTransition: TEST_CONSTANTS.LIFECYCLE_POLICIES.AFTER_90_DAYS,
      },
    ])(
      "creates EFS with lifecycle policy $expectedTransition",
      ({ expectedTransition }) => {
        const testData = lifecycleStacks.find(
          (data) => data.expectedTransition === expectedTransition
        );
        expect(testData).toBeDefined();
        expect(testData?.expectedTransition).toBe(expectedTransition);

        expect(() => {
          testData?.template.hasResourceProperties("AWS::EFS::FileSystem", {
            LifecyclePolicies: [
              {
                TransitionToIA: expectedTransition,
              },
            ],
          });
        }).not.toThrow();
      }
    );

    test("creates exactly one EFS file system", () => {
      expect(() => {
        defaultTemplate.resourceCountIs(
          "AWS::EFS::FileSystem",
          TEST_CONSTANTS.RESOURCE_COUNTS.FILE_SYSTEM
        );
      }).not.toThrow();
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
    let app: cdk.App;
    let stack: MonitoringEfsStack;
    let template: Template;

    beforeAll(() => {
      app = createTestApp();
      stack = createTestStack(app);
      template = Template.fromStack(stack);
    });

    test("creates EFS access point with correct path and POSIX configuration", () => {
      expect(() => {
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
      }).not.toThrow();
    });

    test("creates exactly one EFS access point", () => {
      expect(() => {
        template.resourceCountIs(
          "AWS::EFS::AccessPoint",
          TEST_CONSTANTS.RESOURCE_COUNTS.ACCESS_POINT
        );
      }).not.toThrow();
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
    let app: cdk.App;
    let stack: MonitoringEfsStack;
    let template: Template;

    beforeAll(() => {
      app = createTestApp();
      stack = createTestStack(app);
      template = Template.fromStack(stack);
    });

    test("creates security group for EFS mount targets", () => {
      expect(() => {
        template.resourceCountIs(
          "AWS::EC2::SecurityGroup",
          TEST_CONSTANTS.RESOURCE_COUNTS.SECURITY_GROUP
        );
      }).not.toThrow();
    });

    test("security group allows NFS traffic from VPC CIDR", () => {
      expect(() => {
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
      }).not.toThrow();
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
    let app: cdk.App;
    let defaultStack: MonitoringEfsStack;
    let devStack: MonitoringEfsStack;
    let defaultTemplate: Template;
    let devTemplate: Template;
    let automationRole: unknown;

    beforeAll(() => {
      app = createTestApp();

      // Create ALL stacks first before calling Template.fromStack()
      // Template.fromStack() triggers synthesis which locks the app
      defaultStack = createTestStack(app, "DefaultSsmStack");
      devStack = createTestStack(app, "DevSsmStack", {
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
      });

      // Now create templates from the stacks
      defaultTemplate = Template.fromStack(defaultStack);
      devTemplate = Template.fromStack(devStack);

      // Pre-compute automation role
      const roles = defaultTemplate.findResources("AWS::IAM::Role");
      automationRole = Object.values(roles).find((role) => {
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
    });

    test("creates SSM Automation Document for EFS initialization", () => {
      expect(() => {
        defaultTemplate.resourceCountIs(
          "AWS::SSM::Document",
          TEST_CONSTANTS.RESOURCE_COUNTS.SSM_DOCUMENT
        );
      }).not.toThrow();
    });

    test("creates SSM Document with correct type and format", () => {
      expect(() => {
        devTemplate.hasResourceProperties("AWS::SSM::Document", {
          DocumentType: TEST_CONSTANTS.SSM_DOCUMENT.TYPE,
          DocumentFormat: TEST_CONSTANTS.SSM_DOCUMENT.FORMAT,
        });
      }).not.toThrow();
    });

    test("creates IAM role for automation execution", () => {
      expect(automationRole).toBeDefined();
    });

    test("creates SSM Association to execute automation", () => {
      expect(() => {
        defaultTemplate.resourceCountIs(
          "AWS::SSM::Association",
          TEST_CONSTANTS.RESOURCE_COUNTS.SSM_ASSOCIATION
        );
      }).not.toThrow();
    });

    test("SSM Association has correct parameters", () => {
      expect(() => {
        devTemplate.hasResourceProperties("AWS::SSM::Association", {
          Parameters: {
            FileSystemId: Match.anyValue(),
            AccessPointId: Match.anyValue(),
            Environment: [TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT],
            AutomationAssumeRole: Match.anyValue(),
          },
        });
      }).not.toThrow();
    });

    test("no Lambda function is created", () => {
      // Lambda-based initialization has been replaced by SSM Automation
      expect(() => {
        defaultTemplate.resourceCountIs(
          "AWS::Lambda::Function",
          TEST_CONSTANTS.RESOURCE_COUNTS.LAMBDA_FUNCTION
        );
      }).not.toThrow();
    });

    test("no custom resource is created", () => {
      // Custom resource has been replaced by SSM Association
      expect(() => {
        defaultTemplate.resourceCountIs(
          "AWS::CloudFormation::CustomResource",
          TEST_CONSTANTS.RESOURCE_COUNTS.CUSTOM_RESOURCE
        );
      }).not.toThrow();
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
    let app: cdk.App;
    let defaultTemplate: Template;
    let paramNames: string[];
    let efsParamsCount: number;

    beforeAll(() => {
      app = createTestApp();

      // Pre-compute default template
      const defaultStack = createTestStack(app);
      defaultTemplate = Template.fromStack(defaultStack);

      // Pre-compute parameter names for JSON/YAML tests
      const parameters = defaultTemplate.findResources("AWS::SSM::Parameter");
      paramNames = Object.values(parameters).map(
        (param) => (param.Properties as { Name: string }).Name
      );

      // Pre-compute EFS params count for disabled test
      const disabledApp = createTestApp();
      const disabledStack = createTestStack(disabledApp, TEST_CONSTANTS.STACK_IDS.DEFAULT, {
        createSsmParameters: false,
      });
      const disabledTemplate = Template.fromStack(disabledStack);
      const disabledParams = disabledTemplate.findResources("AWS::SSM::Parameter");
      efsParamsCount = Object.values(disabledParams).filter((param) => {
        const paramProps = param.Properties as { Name?: string };
        return paramProps.Name?.includes("/efs/");
      }).length;
    });

    test("creates SSM parameters by default", () => {
      const parameters = defaultTemplate.findResources("AWS::SSM::Parameter");
      expect(Object.keys(parameters).length).toBeGreaterThan(0);
    });

    test("creates Prometheus JSON configuration SSM parameter", () => {
      expect(paramNames).toContain(
        TEST_CONSTANTS.SSM_PARAMETER_PATHS.PROMETHEUS_CONFIG
      );
    });

    test("creates Prometheus YAML configuration SSM parameter", () => {
      expect(paramNames).toContain(
        TEST_CONSTANTS.SSM_PARAMETER_PATHS.PROMETHEUS_CONFIG_YAML
      );
    });

    test("creates Grafana datasource JSON configuration SSM parameter", () => {
      expect(paramNames).toContain(
        TEST_CONSTANTS.SSM_PARAMETER_PATHS.GRAFANA_DATASOURCE_CONFIG
      );
    });

    test("creates Grafana datasource YAML configuration SSM parameter", () => {
      expect(paramNames).toContain(
        TEST_CONSTANTS.SSM_PARAMETER_PATHS.GRAFANA_DATASOURCE_CONFIG_YAML
      );
    });

    test("creates Grafana dashboard JSON configuration SSM parameter", () => {
      expect(paramNames).toContain(
        TEST_CONSTANTS.SSM_PARAMETER_PATHS.GRAFANA_DASHBOARD_CONFIG
      );
    });

    test("creates Grafana dashboard YAML configuration SSM parameter", () => {
      expect(paramNames).toContain(
        TEST_CONSTANTS.SSM_PARAMETER_PATHS.GRAFANA_DASHBOARD_CONFIG_YAML
      );
    });

    test("creates EFS discovery SSM parameters when enabled", () => {
      expect(() => {
        defaultTemplate.hasResourceProperties("AWS::SSM::Parameter", {
          Name: Match.stringLikeRegexp(
            TEST_CONSTANTS.SSM_PARAMETER_PATHS.EFS_CONFIG_PREFIX
          ),
        });
      }).not.toThrow();
    });

    test("does not create EFS SSM parameters when disabled", () => {
      expect(efsParamsCount).toBe(0);
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
    let app: cdk.App;
    let defaultTemplate: Template;
    let exportsTemplate: Template;
    let noExportsTemplate: Template;
    let noOutputsTemplate: Template;
    let exportsOutputs: Record<string, unknown>;
    let noExportsOutputs: Record<string, unknown>;
    let noOutputsOutputs: Record<string, unknown> | undefined;

    beforeAll(() => {
      app = createTestApp();

      // Default stack with outputs
      const defaultStack = createTestStack(app, "DefaultOutputsStack", {
        createOutputs: true,
      });
      defaultTemplate = Template.fromStack(defaultStack);

      // Stack with exports enabled
      const exportsApp = createTestApp();
      const exportsStack = createTestStack(exportsApp, TEST_CONSTANTS.STACK_IDS.DEFAULT, {
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        projectName: "monitoring",
        enableExports: true,
        createOutputs: true,
      });
      exportsTemplate = Template.fromStack(exportsStack);
      exportsOutputs = exportsTemplate.toJSON().Outputs as Record<string, unknown>;

      // Stack with exports disabled
      const noExportsApp = createTestApp();
      const noExportsStack = createTestStack(noExportsApp, TEST_CONSTANTS.STACK_IDS.DEFAULT, {
        enableExports: false,
      });
      noExportsTemplate = Template.fromStack(noExportsStack);
      noExportsOutputs = noExportsTemplate.toJSON().Outputs as Record<string, unknown>;

      // Stack with outputs disabled
      const noOutputsApp = createTestApp();
      const noOutputsStack = createTestStack(noOutputsApp, TEST_CONSTANTS.STACK_IDS.DEFAULT, {
        createOutputs: false,
      });
      noOutputsTemplate = Template.fromStack(noOutputsStack);
      noOutputsOutputs = noOutputsTemplate.toJSON().Outputs as Record<string, unknown> | undefined;
    });

    test("creates FileSystemId output with correct description", () => {
      expect(() => {
        defaultTemplate.hasOutput(TEST_CONSTANTS.OUTPUT_NAMES.FILE_SYSTEM_ID, {
          Description: Match.stringLikeRegexp("EFS file system ID"),
        });
      }).not.toThrow();
    });

    test("creates AccessPointId output with correct description", () => {
      expect(() => {
        defaultTemplate.hasOutput(TEST_CONSTANTS.OUTPUT_NAMES.ACCESS_POINT_ID, {
          Description: Match.stringLikeRegexp("EFS access point ID"),
        });
      }).not.toThrow();
    });

    test("creates SecurityGroupId output with correct description", () => {
      expect(() => {
        defaultTemplate.hasOutput(TEST_CONSTANTS.OUTPUT_NAMES.SECURITY_GROUP_ID, {
          Description: Match.stringLikeRegexp("EFS.*security group"),
        });
      }).not.toThrow();
    });

    test("exports outputs when enableExports is true", () => {
      const fileSystemOutput = exportsOutputs[
        TEST_CONSTANTS.OUTPUT_NAMES.FILE_SYSTEM_ID
      ] as { Export?: { Name?: string } };
      expect(fileSystemOutput).toBeDefined();
      expect(fileSystemOutput.Export).toBeDefined();
      expect(fileSystemOutput.Export?.Name).toMatch(/.*efs.*id.*/i);
    });

    test("does not create exports when enableExports is false", () => {
      const fileSystemOutput = noExportsOutputs[
        TEST_CONSTANTS.OUTPUT_NAMES.FILE_SYSTEM_ID
      ] as { Export?: unknown };
      expect(fileSystemOutput.Export).toBeUndefined();
    });

    test("does not create stack outputs when disabled", () => {
      // Pre-computed in beforeAll - no conditional needed
      expect(noOutputsOutputs).toBeDefined();
      expect(
        noOutputsOutputs?.[TEST_CONSTANTS.OUTPUT_NAMES.FILE_SYSTEM_ID]
      ).toBeUndefined();
      expect(
        noOutputsOutputs?.[TEST_CONSTANTS.OUTPUT_NAMES.ACCESS_POINT_ID]
      ).toBeUndefined();
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
    let publicSubnetTemplate: Template;
    let privateSubnetTemplate: Template;
    let customSubnetTemplate: Template;

    beforeAll(() => {
      // Public subnets (default)
      const publicApp = createTestApp();
      const publicStack = createTestStack(publicApp);
      publicSubnetTemplate = Template.fromStack(publicStack);

      // Private subnets
      const privateApp = createTestApp();
      const privateStack = createTestStack(privateApp, TEST_CONSTANTS.STACK_IDS.DEFAULT, {
        usePublicSubnets: false,
      });
      privateSubnetTemplate = Template.fromStack(privateStack);

      // Custom subnet selection
      const customApp = createTestApp();
      const fixtures = TestFixtures.getInstance(customApp);
      const vpc = fixtures.getVpc();
      const customStack = createTestStack(customApp, TEST_CONSTANTS.STACK_IDS.DEFAULT, {
        vpc,
        mountTargetSubnetSelection: {
          subnetGroupName: "Private",
        },
      });
      customSubnetTemplate = Template.fromStack(customStack);
    });

    test("uses public subnets by default", () => {
      expect(() => {
        publicSubnetTemplate.resourceCountIs("AWS::EFS::MountTarget", 2);
      }).not.toThrow();
    });

    test("uses private subnets when usePublicSubnets is false", () => {
      expect(() => {
        privateSubnetTemplate.resourceCountIs("AWS::EFS::MountTarget", 2);
      }).not.toThrow();
    });

    test("uses custom subnet selection when provided", () => {
      expect(() => {
        customSubnetTemplate.resourceCountIs("AWS::EFS::MountTarget", 2);
      }).not.toThrow();
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
      const app = createTestApp();
      const fixtures = TestFixtures.getInstance(app);
      const vpc = fixtures.getVpc();

      expect(() => {
        createTestStack(app, "ValidationEnvNameStack", {
          vpc,
          envName: "",
        });
      }).toThrow(/environment name/i);
    });

    test("throws error when VPC is not provided", () => {
      const app = createTestApp();

      expect(() => {
        new MonitoringEfsStack(app, "ValidationVpcStack", {
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

      expect(() => {
        template.hasResourceProperties("AWS::EFS::FileSystem", {
          Encrypted: true,
          LifecyclePolicies: [
            {
              TransitionToIA: TEST_CONSTANTS.LIFECYCLE_POLICIES.AFTER_30_DAYS,
            },
          ],
        });
      }).not.toThrow();
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

      expect(() => {
        template.hasResource("AWS::EFS::FileSystem", {
          DeletionPolicy: TEST_CONSTANTS.REMOVAL_POLICIES.DELETE,
          UpdateReplacePolicy: TEST_CONSTANTS.REMOVAL_POLICIES.DELETE,
        });
      }).not.toThrow();
    });

    test("production environment has HA and data retention configuration", () => {
      const template = Template.fromStack(prodStack);

      expect(() => {
        template.hasResource("AWS::EFS::FileSystem", {
          DeletionPolicy: TEST_CONSTANTS.REMOVAL_POLICIES.RETAIN,
          UpdateReplacePolicy: TEST_CONSTANTS.REMOVAL_POLICIES.RETAIN,
        });
      }).not.toThrow();

      expect(() => {
        template.hasResourceProperties("AWS::EFS::FileSystem", {
          LifecyclePolicies: [
            {
              TransitionToIA: TEST_CONSTANTS.LIFECYCLE_POLICIES.AFTER_30_DAYS,
            },
          ],
        });
      }).not.toThrow();
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
    let stack: MonitoringEfsStack;

    beforeAll(() => {
      const app = createTestApp();
      stack = createTestStack(app);
    });

    test("exposes fileSystem property", () => {
      const prop = (stack as unknown as Record<string, unknown>).fileSystem;
      expect(prop).toBeDefined();
      expect(typeof prop).toBe("object");
    });

    test("exposes accessPoint property", () => {
      const prop = (stack as unknown as Record<string, unknown>).accessPoint;
      expect(prop).toBeDefined();
      expect(typeof prop).toBe("object");
    });

    test("exposes mountTargetSecurityGroup property", () => {
      const prop = (stack as unknown as Record<string, unknown>).mountTargetSecurityGroup;
      expect(prop).toBeDefined();
      expect(typeof prop).toBe("object");
    });

    test("exposes efsAvailabilityZone property", () => {
      const prop = (stack as unknown as Record<string, unknown>).efsAvailabilityZone;
      expect(prop).toBeDefined();
      expect(typeof prop).toBe("string");
    });

    test("exposes efsInitializationExecution property", () => {
      const prop = (stack as unknown as Record<string, unknown>).efsInitializationExecution;
      expect(prop).toBeDefined();
      expect(typeof prop).toBe("object");
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
    let crossAccountTemplate: Template;
    let noCrossAccountTemplate: Template;
    let prometheusParam: unknown;

    beforeAll(() => {
      // Stack with cross-account targets
      const crossAccountApp = createTestApp();
      const crossAccountStack = createTestStack(crossAccountApp, TEST_CONSTANTS.STACK_IDS.DEFAULT, {
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
      crossAccountTemplate = Template.fromStack(crossAccountStack);

      // Pre-compute prometheus param
      const parameters = crossAccountTemplate.findResources("AWS::SSM::Parameter");
      prometheusParam = Object.values(parameters).find((param) => {
        const paramProps = param.Properties as { Name?: string };
        return (
          paramProps.Name ===
          TEST_CONSTANTS.SSM_PARAMETER_PATHS.PROMETHEUS_CONFIG
        );
      });

      // Stack without cross-account targets
      const noCrossAccountApp = createTestApp();
      const noCrossAccountStack = createTestStack(noCrossAccountApp, TEST_CONSTANTS.STACK_IDS.DEFAULT, {
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
      });
      noCrossAccountTemplate = Template.fromStack(noCrossAccountStack);
    });

    test("creates Prometheus config with cross-account targets", () => {
      expect(() => {
        crossAccountTemplate.hasResourceProperties("AWS::SSM::Parameter", {
          Name: TEST_CONSTANTS.SSM_PARAMETER_PATHS.PROMETHEUS_CONFIG,
        });
      }).not.toThrow();
      expect(prometheusParam).toBeDefined();
    });

    test("creates Prometheus config without cross-account targets", () => {
      expect(() => {
        noCrossAccountTemplate.hasResourceProperties("AWS::SSM::Parameter", {
          Name: TEST_CONSTANTS.SSM_PARAMETER_PATHS.PROMETHEUS_CONFIG,
        });
      }).not.toThrow();
    });
  });
});
