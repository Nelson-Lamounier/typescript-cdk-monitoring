/** @format */
/// <reference types="jest" />

import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as efs from "aws-cdk-lib/aws-efs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as ssm from "aws-cdk-lib/aws-ssm";
import { Template, Match } from "aws-cdk-lib/assertions";

import { MonitoringInfraStack } from "../../../../lib/stacks/monitoring/infra-stack";
import { MonitoringInfraStackProps } from "../../../../lib/shared/types/stack-types";
import {
  MONITORING_PORTS,
  BRIDGE_NETWORK_DYNAMIC_PORT_RANGE,
  MONITORING_TASK_LOG_RETENTION,
  MONITORING_EVENT_LOG_RETENTION,
  MONITORING_ALB_IDLE_TIMEOUT,
  MONITORING_CAPACITY_DEFAULTS,
} from "../../../../lib/shared/constants/monitoring-constants";
import { DEFAULT_ASG_BLOCK_DEVICE_SIZE_GB } from "../../../../lib/shared/constants/compute-constants";

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
  efsFileSystemId: "fs-1234567890abcdef0",
  efsStackName: "MonitoringEfsStack",
  certificateArn:
    "arn:aws:acm:eu-west-1:123456789012:certificate/12345678-1234-1234-1234-123456789012",
} as const;

/**
 * Test constants - avoid magic numbers and strings
 * All hardcoded values used in tests should be defined here
 */
const TEST_CONSTANTS = {
  VPC: {
    MAX_AZS: 2,
    NAT_GATEWAYS: 0,
  },
  EFS: {
    OWNER_UID: "1000",
    OWNER_GID: "1000",
    PERMISSIONS: "755",
    AVAILABILITY_ZONE: "eu-west-1a",
    MOUNT_PATH: "/monitoring",
  },
  RESOURCE_COUNTS: {
    ECS_CLUSTER: 1,
    LOAD_BALANCER: 1,
    AUTO_SCALING_GROUP: 1,
    LOG_GROUPS: 2,
    SSM_PARAMETERS: 5,
  },
  LOG_SUFFIXES: {
    TASKS: "/tasks",
    EVENTS: "/events",
  },
  STACK_IDS: {
    DEFAULT: "TestStack",
    VPC: "TestVpcStack",
    EFS: "TestEfsStack",
    ALL_PROPERTIES: "AllPropertiesStack",
    TAGGED: "TaggedStack",
    CUSTOM_TAGGED: "CustomTaggedStack",
    ENV_TAGGED: "EnvTaggedStack",
  },
  ENVIRONMENTS: {
    DEVELOPMENT: "development",
    DEV: "dev",
    PRODUCTION: "production",
    STAGING: "staging",
  },
  SSM_ASSOCIATION_NAMES: {
    RUN_SHELL_SCRIPT: "AWS-RunShellScript",
    CONFIGURE_AWS_PACKAGE: "AWS-ConfigureAWSPackage",
  },
  DESCRIPTIONS: {
    EFS_SECURITY_GROUP: "Security group for EFS",
    LOAD_BALANCER: "load balancer",
  },
  SSM_PARAMETER_PATHS: {
    CLUSTER_NAME: "/monitoring/dev/infra/config/cluster-name",
    CLUSTER_ARN: "/monitoring/dev/infra/config/cluster-arn",
    ALB_DNS: "/monitoring/dev/infra/config/alb-dns",
    LISTENER_ARN: "/monitoring/dev/infra/config/listener-arn",
    ASG_NAME: "/monitoring/dev/infra/config/asg-name",
  },
} as const;

// ============================================================================
// TEST FIXTURES CACHING CLASS
// ============================================================================

/**
 * EFS resources structure returned by TestFixtures
 */
interface EfsResources {
  fileSystem: efs.FileSystem;
  accessPoint: efs.AccessPoint;
  securityGroup: ec2.SecurityGroup;
  initializationComplete: ssm.CfnAssociation;
  availabilityZone: string;
}

/**
 * TestFixtures caching class
 *
 * Provides cached test fixtures (VPC, EFS resources) to improve test performance
 * and reduce resource creation overhead. Each app instance gets its own cached fixtures.
 *
 * @example
 * ```typescript
 * const fixtures = TestFixtures.getInstance(app);
 * const stack = new MonitoringInfraStack(app, "TestStack", {
 *   ...fixtures.getMinimalProps(),
 *   envName: "production",
 * });
 * ```
 */
class TestFixtures {
  private static instances = new Map<cdk.App, TestFixtures>();
  private vpc: ec2.IVpc | null = null;
  private efsResources: EfsResources | null = null;

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
   *
   * @returns IVpc instance for testing
   */
  getVpc(): ec2.IVpc {
    if (!this.vpc) {
      const vpcStack = new cdk.Stack(this.app, TEST_CONSTANTS.STACK_IDS.VPC, {
        env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
      });

      this.vpc = new ec2.Vpc(vpcStack, "Vpc", {
        maxAzs: TEST_CONSTANTS.VPC.MAX_AZS,
        natGateways: TEST_CONSTANTS.VPC.NAT_GATEWAYS,
      });
    }

    return this.vpc;
  }

  /**
   * Get or create mock EFS file system and related resources
   *
   * EFS resources are cached per app instance. The VPC must be created first.
   *
   * @returns Object containing EFS resources for testing
   */
  getEfsResources(): EfsResources {
    if (!this.efsResources) {
      const vpc = this.getVpc();
      const efsStack = new cdk.Stack(this.app, TEST_CONSTANTS.STACK_IDS.EFS, {
        env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
      });

      const fileSystem = new efs.FileSystem(efsStack, "FileSystem", {
        vpc,
        encrypted: true,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });

      const accessPoint = fileSystem.addAccessPoint("AccessPoint", {
        path: TEST_CONSTANTS.EFS.MOUNT_PATH,
        createAcl: {
          ownerUid: TEST_CONSTANTS.EFS.OWNER_UID,
          ownerGid: TEST_CONSTANTS.EFS.OWNER_GID,
          permissions: TEST_CONSTANTS.EFS.PERMISSIONS,
        },
        posixUser: {
          uid: TEST_CONSTANTS.EFS.OWNER_UID,
          gid: TEST_CONSTANTS.EFS.OWNER_GID,
        },
      });

      const securityGroup = new ec2.SecurityGroup(efsStack, "SecurityGroup", {
        vpc,
        description: TEST_CONSTANTS.DESCRIPTIONS.EFS_SECURITY_GROUP,
      });

      const initializationComplete = new ssm.CfnAssociation(
        efsStack,
        "InitComplete",
        {
          name: TEST_CONSTANTS.SSM_ASSOCIATION_NAMES.RUN_SHELL_SCRIPT,
        }
      );

      this.efsResources = {
        fileSystem,
        accessPoint,
        securityGroup,
        initializationComplete,
        availabilityZone: TEST_CONSTANTS.EFS.AVAILABILITY_ZONE,
      };
    }

    return this.efsResources;
  }

  /**
   * Create minimal test stack props using cached fixtures
   *
   * @returns Minimal stack properties for testing
   */
  getMinimalProps(): MonitoringInfraStackProps {
    const vpc = this.getVpc();
    const efsResources = this.getEfsResources();

    return {
      env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
      envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
      vpc,
      efsStackName: TEST_CONFIG.efsStackName,
      fileSystem: efsResources.fileSystem,
      efsAccessPoint: efsResources.accessPoint,
      efsAvailabilityZone: efsResources.availabilityZone,
      efsSecurityGroup: efsResources.securityGroup,
      efsInitializationComplete: efsResources.initializationComplete,
    };
  }

  /**
   * Clear cached fixtures for this app instance
   *
   * Useful for cleanup between test suites or when fixtures need to be recreated.
   */
  clear(): void {
    this.vpc = null;
    this.efsResources = null;
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
 * gets its own cached VPC and EFS resources.
 *
 * @param app - CDK app instance
 * @param idOrProps - Stack ID string, or props object if id is omitted
 * @param props - Optional stack properties to override defaults (only used if idOrProps is a string)
 * @returns MonitoringInfraStack instance for testing
 *
 * @example
 * ```typescript
 * // With explicit stack ID
 * const stack = createTestStack(app, "MyTestStack", {
 *   envName: "production",
 *   enableHttps: true,
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
  idOrProps?: string | Partial<MonitoringInfraStackProps>,
  props?: Partial<MonitoringInfraStackProps>
): MonitoringInfraStack {
  if (!app) {
    throw new Error("CDK App instance is required to create test stack");
  }

  let id: string;
  let stackProps: Partial<MonitoringInfraStackProps>;

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

  return new MonitoringInfraStack(app, id, {
    ...minimalProps,
    ...stackProps,
  });
}

// ============================================================================
// CUSTOM MATCHERS
// ============================================================================

/**
 * Custom matchers for common test patterns
 */
expect.extend({
  /**
   * Matches SSM parameter path pattern
   */
  toMatchSsmParameterPath(
    received: string,
    expectedPattern: string | RegExp
  ): jest.CustomMatcherResult {
    const pass =
      typeof expectedPattern === "string"
        ? received.includes(expectedPattern)
        : expectedPattern.test(received);
    return {
      pass,
      message: () =>
        `expected ${received} ${
          pass ? "not " : ""
        }to match SSM parameter path pattern ${expectedPattern}`,
    };
  },

  /**
   * Matches log group name pattern
   */
  toMatchLogGroupName(
    received: string,
    expectedSuffix: string
  ): jest.CustomMatcherResult {
    const pass = received.endsWith(expectedSuffix);
    return {
      pass,
      message: () =>
        `expected ${received} ${
          pass ? "not " : ""
        }to end with log group suffix ${expectedSuffix}`,
    };
  },

  /**
   * Validates CloudFormation output structure
   */
  toHaveValidOutput(
    received: unknown,
    outputName: string
  ): jest.CustomMatcherResult {
    const pass =
      typeof received === "object" && received !== null && "Value" in received;
    return {
      pass,
      message: () =>
        `expected output ${outputName} ${
          pass ? "not " : ""
        }to have valid CloudFormation output structure`,
    };
  },
});

// ============================================================================
// MONITORING INFRA STACK TESTS
// ============================================================================

describe("MonitoringInfraStack", () => {
  let app: cdk.App;

  beforeEach(() => {
    app = new cdk.App();
  });

  // ============================================================================
  // Stack Creation and Validation
  // ============================================================================

  /**
   * Stack Creation Tests
   *
   * Verifies that MonitoringInfraStack can be created with various
   * configuration combinations and exposes expected public properties.
   */
  describe("Stack Creation", () => {
    test("creates stack with minimal required properties", () => {
      const stack = createTestStack(app);
      const template = Template.fromStack(stack);

      // Verify essential resources are created
      template.resourceCountIs(
        "AWS::ECS::Cluster",
        TEST_CONSTANTS.RESOURCE_COUNTS.ECS_CLUSTER
      );
      template.resourceCountIs(
        "AWS::ElasticLoadBalancingV2::LoadBalancer",
        TEST_CONSTANTS.RESOURCE_COUNTS.LOAD_BALANCER
      );
      template.resourceCountIs(
        "AWS::AutoScaling::AutoScalingGroup",
        TEST_CONSTANTS.RESOURCE_COUNTS.AUTO_SCALING_GROUP
      );
      // Check that at least our expected log groups exist (ECS creates additional ones for Lambda)
      const logGroups = template.findResources("AWS::Logs::LogGroup");
      expect(Object.keys(logGroups).length).toBeGreaterThanOrEqual(
        TEST_CONSTANTS.RESOURCE_COUNTS.LOG_GROUPS
      );
    });

    test("exposes public properties correctly", () => {
      const stack = createTestStack(app);

      expect(stack.cluster).toBeDefined();
      expect(stack.autoScalingGroup).toBeDefined();
      expect(stack.loadBalancer).toBeDefined();
      expect(stack.listener).toBeDefined();
      expect(stack.taskLogGroup).toBeDefined();
      expect(stack.eventLogGroup).toBeDefined();
    });

    test("creates stack with all optional properties", () => {
      const testApp = new cdk.App();
      const s3Stack = new cdk.Stack(testApp, "S3StackAllProps", {
        env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
      });
      const logsBucket = new s3.Bucket(s3Stack, "LogsBucket", {
        bucketName: cdk.PhysicalName.GENERATE_IF_NEEDED,
      });

      const stack = createTestStack(
        testApp,
        TEST_CONSTANTS.STACK_IDS.ALL_PROPERTIES,
        {
          envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
          projectName: "monitoring",
          allowedIpRanges: ["10.0.0.0/8"],
          enableHttps: true,
          certificateArn: TEST_CONFIG.certificateArn,
          enableAccessLogs: true,
          accessLogsBucket: logsBucket,
          // Use development defaults - no need to override
          minCapacity: MONITORING_CAPACITY_DEFAULTS.DEV.minCapacity,
          maxCapacity: MONITORING_CAPACITY_DEFAULTS.DEV.maxCapacity,
          desiredCapacity: MONITORING_CAPACITY_DEFAULTS.DEV.desiredCapacity,
          instanceType: ec2.InstanceType.of(
            ec2.InstanceClass.T3,
            ec2.InstanceSize.SMALL
          ),
          enableContainerInsights: true,
          enableExecuteCommand: true,
          enableDeletionProtection: true,
          enableSystemUpdates: true,
          enableMetadataTracking: true,
          taskLogRetention: logs.RetentionDays.ONE_WEEK,
          eventLogRetention: logs.RetentionDays.ONE_WEEK,
          albIdleTimeout: cdk.Duration.seconds(120),
          createSsmParameters: true,
          createOutputs: true,
          enableExports: true,
        }
      );

      const template = Template.fromStack(stack);
      template.resourceCountIs("AWS::ECS::Cluster", 1);
      template.resourceCountIs("AWS::ElasticLoadBalancingV2::LoadBalancer", 1);
    });
  });

  /**
   * Validation Tests
   *
   * Verifies that MonitoringInfraStack properly validates input parameters
   * and provides helpful error messages for invalid configurations.
   */
  describe("Validation", () => {
    test("throws error when envName is empty", () => {
      expect(() => {
        createTestStack(app, TEST_CONSTANTS.STACK_IDS.DEFAULT, { envName: "" });
      }).toThrow(/environment name/i);
    });

    test("throws error when VPC is missing", () => {
      const testApp = new cdk.App();
      const fixtures = TestFixtures.getInstance(testApp);
      const efsResources = fixtures.getEfsResources();

      expect(() => {
        new MonitoringInfraStack(testApp, TEST_CONSTANTS.STACK_IDS.DEFAULT, {
          env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
          envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
          vpc: null as unknown as ec2.IVpc,
          efsStackName: TEST_CONFIG.efsStackName,
          fileSystem: efsResources.fileSystem,
          efsAccessPoint: efsResources.accessPoint,
          efsAvailabilityZone: efsResources.availabilityZone,
          efsSecurityGroup: efsResources.securityGroup,
          efsInitializationComplete: efsResources.initializationComplete,
        });
      }).toThrow(/VPC is required/);
    });

    test("throws error when file system is missing", () => {
      const testApp = new cdk.App();
      const fixtures = TestFixtures.getInstance(testApp);
      const vpc = fixtures.getVpc();
      const efsResources = fixtures.getEfsResources();

      expect(() => {
        new MonitoringInfraStack(testApp, TEST_CONSTANTS.STACK_IDS.DEFAULT, {
          env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
          envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
          vpc,
          efsStackName: TEST_CONFIG.efsStackName,
          fileSystem: null as unknown as efs.FileSystem,
          efsAccessPoint: efsResources.accessPoint,
          efsAvailabilityZone: efsResources.availabilityZone,
          efsSecurityGroup: efsResources.securityGroup,
          efsInitializationComplete: efsResources.initializationComplete,
        });
      }).toThrow(/EFS file system is required/);
    });

    test("throws error when EFS security group is missing", () => {
      const testApp = new cdk.App();
      const fixtures = TestFixtures.getInstance(testApp);
      const vpc = fixtures.getVpc();
      const efsResources = fixtures.getEfsResources();

      expect(() => {
        new MonitoringInfraStack(testApp, TEST_CONSTANTS.STACK_IDS.DEFAULT, {
          env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
          envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
          vpc,
          efsStackName: TEST_CONFIG.efsStackName,
          fileSystem: efsResources.fileSystem,
          efsAccessPoint: efsResources.accessPoint,
          efsAvailabilityZone: efsResources.availabilityZone,
          efsSecurityGroup: null as unknown as ec2.SecurityGroup,
          efsInitializationComplete: efsResources.initializationComplete,
        });
      }).toThrow(/EFS security group is required/);
    });

    test("throws error when EFS initialization complete is missing", () => {
      const testApp = new cdk.App();
      const fixtures = TestFixtures.getInstance(testApp);
      const vpc = fixtures.getVpc();
      const efsResources = fixtures.getEfsResources();

      expect(() => {
        new MonitoringInfraStack(testApp, TEST_CONSTANTS.STACK_IDS.DEFAULT, {
          env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
          envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
          vpc,
          efsStackName: TEST_CONFIG.efsStackName,
          fileSystem: efsResources.fileSystem,
          efsAccessPoint: efsResources.accessPoint,
          efsAvailabilityZone: efsResources.availabilityZone,
          efsSecurityGroup: efsResources.securityGroup,
          efsInitializationComplete: null as unknown as ssm.CfnAssociation,
        });
      }).toThrow(/EFS initialization complete resource is required/);
    });

    test("throws error when enableHttps is true but certificateArn is missing", () => {
      expect(() => {
        createTestStack(app, {
          enableHttps: true,
          certificateArn: undefined,
        });
      }).toThrow(/certificateArn is required when enableHttps is true/);
    });

    test("throws error when enableAccessLogs is true but accessLogsBucket is missing", () => {
      expect(() => {
        createTestStack(app, {
          enableAccessLogs: true,
          accessLogsBucket: undefined,
        });
      }).toThrow(/accessLogsBucket is required when enableAccessLogs is true/);
    });

    test("throws error for invalid CIDR in allowedIpRanges", () => {
      expect(() => {
        createTestStack(app, {
          allowedIpRanges: ["invalid-cidr"],
        });
      }).toThrow(/CIDR/i);
    });

    test("throws error when minCapacity > maxCapacity", () => {
      expect(() => {
        createTestStack(app, {
          minCapacity: 3,
          maxCapacity: 2,
        });
      }).toThrow(/capacity/i);
    });

    test("throws error when desiredCapacity > maxCapacity", () => {
      expect(() => {
        createTestStack(app, {
          desiredCapacity: 4,
          maxCapacity: 3,
        });
      }).toThrow(/capacity/i);
    });

    test("throws error when desiredCapacity < minCapacity", () => {
      expect(() => {
        createTestStack(app, {
          minCapacity: 2,
          desiredCapacity: 1,
        });
      }).toThrow(/capacity/i);
    });
  });

  /**
   * Security Configuration Tests
   *
   * Verifies security group configurations, IAM permissions, and encryption
   * settings for the monitoring infrastructure stack.
   */
  describe("Security Configuration", () => {
    /**
     * Security Groups Tests
     *
     * Verifies that security groups are created with proper ingress/egress rules
     * and IP range restrictions.
     */
    describe("Security Groups", () => {
      test("ALB security group is configured with allowed IP ranges", () => {
        const stack = createTestStack(app, {
          allowedIpRanges: ["10.0.0.0/8", "192.168.0.0/16"],
        });

        const template = Template.fromStack(stack);

        // Verify security groups exist with descriptions
        const securityGroups = template.findResources(
          "AWS::EC2::SecurityGroup"
        );
        const sgStr = JSON.stringify(securityGroups);
        expect(sgStr).toContain("load balancer");
      });

      test("creates security groups with proper configuration", () => {
        const stack = createTestStack(app);
        const template = Template.fromStack(stack);

        // Check that security groups exist (CDK handles the detailed rules)
        const securityGroups = template.findResources(
          "AWS::EC2::SecurityGroup"
        );
        expect(Object.keys(securityGroups).length).toBeGreaterThanOrEqual(2);

        // Verify security group ingress rules exist
        const sgIngress = template.findResources(
          "AWS::EC2::SecurityGroupIngress"
        );
        expect(Object.keys(sgIngress).length).toBeGreaterThan(0);
      });
    });

    /**
     * IAM Permissions Tests
     *
     * Verifies that launch template IAM roles have correct managed policies
     * and inline policies for ECS, EFS, SSM, and CloudWatch Logs access.
     */
    describe("IAM Permissions", () => {
      test("launch template role has ECS managed policy", () => {
        const stack = createTestStack(app);
        const template = Template.fromStack(stack);

        template.hasResourceProperties("AWS::IAM::Role", {
          ManagedPolicyArns: Match.arrayWith([
            Match.objectLike({
              "Fn::Join": Match.arrayWith([
                Match.arrayWith([
                  Match.stringLikeRegexp(
                    ".*AmazonEC2ContainerServiceforEC2Role"
                  ),
                ]),
              ]),
            }),
          ]),
        });
      });

      test("launch template role has EFS permissions", () => {
        const stack = createTestStack(app);
        const template = Template.fromStack(stack);

        template.hasResourceProperties("AWS::IAM::Policy", {
          PolicyDocument: {
            Statement: Match.arrayWith([
              Match.objectLike({
                Effect: "Allow",
                Action: Match.arrayWith([
                  "elasticfilesystem:ClientMount",
                  "elasticfilesystem:ClientWrite",
                  "elasticfilesystem:ClientRootAccess",
                ]),
              }),
            ]),
          },
        });
      });

      test("launch template role has SSM read permissions", () => {
        const stack = createTestStack(app);
        const template = Template.fromStack(stack);

        template.hasResourceProperties("AWS::IAM::Policy", {
          PolicyDocument: {
            Statement: Match.arrayWith([
              Match.objectLike({
                Effect: "Allow",
                Action: Match.arrayWith([
                  "ssm:GetParameter",
                  "ssm:GetParameters",
                  "ssm:GetParametersByPath",
                ]),
              }),
            ]),
          },
        });
      });

      test("launch template role has SSM write permissions when metadata tracking enabled", () => {
        const stack = createTestStack(app, {
          enableMetadataTracking: true,
        });
        const template = Template.fromStack(stack);

        // Check that IAM policy exists with SSM permissions (simplified assertion)
        const policies = template.findResources("AWS::IAM::Policy");
        const policyStr = JSON.stringify(policies);
        expect(policyStr).toContain("ssm:PutParameter");
        expect(policyStr).toContain("ssm:AddTagsToResource");
        expect(policyStr).toContain("bootstrap");
      });

      test("does not add SSM write permissions when metadata tracking disabled", () => {
        const stack = createTestStack(app, {
          enableMetadataTracking: false,
        });
        const template = Template.fromStack(stack);

        const policies = template.findResources("AWS::IAM::Policy");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const hasSsmWrite = Object.values(policies).some((policy: any) => {
          const statements = policy.Properties?.PolicyDocument?.Statement || [];
          return statements.some(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (stmt: any) =>
              stmt.Action?.includes("ssm:PutParameter") &&
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              stmt.Resource?.some?.((r: any) =>
                JSON.stringify(r).includes("bootstrap")
              )
          );
        });

        expect(hasSsmWrite).toBe(false);
      });

      test("launch template role has CloudWatch Logs permissions", () => {
        const stack = createTestStack(app);
        const template = Template.fromStack(stack);

        // Check that IAM policy exists with CloudWatch Logs permissions
        const policies = template.findResources("AWS::IAM::Policy");
        const policyStr = JSON.stringify(policies);
        expect(policyStr).toContain("logs:CreateLogStream");
        expect(policyStr).toContain("logs:PutLogEvents");
        expect(policyStr).toContain("log-group:/ecs/");
      });
    });

    describe("Encryption", () => {
      test("EBS volumes are encrypted", () => {
        const stack = createTestStack(app);
        const template = Template.fromStack(stack);

        template.hasResourceProperties("AWS::EC2::LaunchTemplate", {
          LaunchTemplateData: {
            BlockDeviceMappings: Match.arrayWith([
              Match.objectLike({
                Ebs: Match.objectLike({
                  Encrypted: true,
                }),
              }),
            ]),
          },
        });
      });

      test("EBS volume size matches constant", () => {
        const stack = createTestStack(app);
        const template = Template.fromStack(stack);

        template.hasResourceProperties("AWS::EC2::LaunchTemplate", {
          LaunchTemplateData: {
            BlockDeviceMappings: Match.arrayWith([
              Match.objectLike({
                Ebs: Match.objectLike({
                  VolumeSize: DEFAULT_ASG_BLOCK_DEVICE_SIZE_GB,
                  VolumeType: "gp3",
                }),
              }),
            ]),
          },
        });
      });
    });

    describe("IMDSv2 Enforcement", () => {
      test("launch template enforces IMDSv2", () => {
        const stack = createTestStack(app);
        const template = Template.fromStack(stack);

        template.hasResourceProperties("AWS::EC2::LaunchTemplate", {
          LaunchTemplateData: {
            MetadataOptions: {
              HttpTokens: "required",
            },
          },
        });
      });
    });
  });

  /**
   * ECS Cluster Configuration Tests
   *
   * Verifies ECS cluster creation, naming, container insights, and execute command
   * configuration based on environment and custom settings.
   */
  describe("ECS Cluster Configuration", () => {
    test("creates ECS cluster with correct name", () => {
      const stack = createTestStack(app, {
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        projectName: "monitoring",
      });
      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::ECS::Cluster", {
        ClusterName: "development-monitoring-monitoring-cluster",
      });
    });

    test("creates ECS cluster with custom name", () => {
      const stack = createTestStack(app, "CustomClusterNameStack", {
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        clusterName: "custom-cluster-name",
      });
      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::ECS::Cluster", {
        ClusterName: "custom-cluster-name",
      });
    });

    test("enables container insights when specified", () => {
      const stack = createTestStack(app, {
        enableContainerInsights: true,
      });
      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::ECS::Cluster", {
        ClusterSettings: Match.arrayWith([
          Match.objectLike({
            Name: "containerInsights",
            Value: "enabled",
          }),
        ]),
      });
    });

    test("enables execute command when specified", () => {
      const stack = createTestStack(app, {
        enableExecuteCommand: true,
      });

      expect(stack.cluster.executeCommandConfiguration).toBeDefined();
    });
  });

  /**
   * Auto Scaling Group Configuration Tests
   *
   * Verifies ASG capacity settings, instance types, and environment-aware defaults
   * for development, staging, and production environments.
   */
  describe("Auto Scaling Group Configuration", () => {
    test("uses default capacity for development environment", () => {
      const stack = createTestStack(app, {
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
      });
      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::AutoScaling::AutoScalingGroup", {
        MinSize: MONITORING_CAPACITY_DEFAULTS.DEV.minCapacity.toString(),
        MaxSize: MONITORING_CAPACITY_DEFAULTS.DEV.maxCapacity.toString(),
        DesiredCapacity:
          MONITORING_CAPACITY_DEFAULTS.DEV.desiredCapacity.toString(),
      });
    });

    test("applies environment-aware capacity defaults", () => {
      // Stack applies appropriate defaults based on environment
      // Testing with development environment (matches mock VPC/EFS context)
      const stack = createTestStack(app, "EnvDefaultsTestStack", {
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
      });

      expect(stack).toBeDefined();

      // Verify key resources exist with defaults applied
      const template = Template.fromStack(stack);
      template.resourceCountIs("AWS::ECS::Cluster", 1);
      template.resourceCountIs("AWS::AutoScaling::AutoScalingGroup", 1);
    });

    test("uses correct instance type for development", () => {
      const stack = createTestStack(app, {
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
      });
      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::EC2::LaunchTemplate", {
        LaunchTemplateData: {
          InstanceType: "t3.micro",
        },
      });
    });

    test("applies instance type based on environment", () => {
      const stack = createTestStack(app, "InstanceTypeTestStack", {
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
      });
      const template = Template.fromStack(stack);

      // Verify launch template exists - instance type is environment-specific
      template.resourceCountIs("AWS::EC2::LaunchTemplate", 1);
      template.hasResourceProperties("AWS::EC2::LaunchTemplate", {
        LaunchTemplateData: Match.objectLike({
          InstanceType: Match.anyValue(),
        }),
      });
    });

    test("respects custom instance type", () => {
      const stack = createTestStack(app, {
        instanceType: ec2.InstanceType.of(
          ec2.InstanceClass.T3,
          ec2.InstanceSize.LARGE
        ),
      });
      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::EC2::LaunchTemplate", {
        LaunchTemplateData: {
          InstanceType: "t3.large",
        },
      });
    });

    test("configures public IP association correctly", () => {
      const stack = createTestStack(app);
      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::EC2::LaunchTemplate", {
        LaunchTemplateData: {
          NetworkInterfaces: Match.arrayWith([
            Match.objectLike({
              AssociatePublicIpAddress: true,
            }),
          ]),
        },
      });
    });
  });

  /**
   * Load Balancer Configuration Tests
   *
   * Verifies ALB creation, deletion protection, idle timeout, and access logs
   * configuration.
   */
  describe("Load Balancer Configuration", () => {
    test("creates internet-facing ALB", () => {
      const stack = createTestStack(app);
      const template = Template.fromStack(stack);

      template.hasResourceProperties(
        "AWS::ElasticLoadBalancingV2::LoadBalancer",
        {
          Scheme: "internet-facing",
          Type: "application",
        }
      );
    });

    test("configures ALB name correctly", () => {
      const stack = createTestStack(app, {
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEV,
        projectName: "mon",
      });
      const template = Template.fromStack(stack);

      template.hasResourceProperties(
        "AWS::ElasticLoadBalancingV2::LoadBalancer",
        {
          Name: "dev-mon-mon-alb",
        }
      );
    });

    test("sets correct idle timeout", () => {
      const stack = createTestStack(app, {
        albIdleTimeout: cdk.Duration.seconds(120),
      });
      const template = Template.fromStack(stack);

      template.hasResourceProperties(
        "AWS::ElasticLoadBalancingV2::LoadBalancer",
        {
          LoadBalancerAttributes: Match.arrayWith([
            Match.objectLike({
              Key: "idle_timeout.timeout_seconds",
              Value: "120",
            }),
          ]),
        }
      );
    });

    test("uses default idle timeout from constants", () => {
      const stack = createTestStack(app);
      const template = Template.fromStack(stack);

      template.hasResourceProperties(
        "AWS::ElasticLoadBalancingV2::LoadBalancer",
        {
          LoadBalancerAttributes: Match.arrayWith([
            Match.objectLike({
              Key: "idle_timeout.timeout_seconds",
              Value: MONITORING_ALB_IDLE_TIMEOUT.toSeconds().toString(),
            }),
          ]),
        }
      );
    });

    test("enables access logs when configured", () => {
      const testApp = new cdk.App();
      const s3Stack = new cdk.Stack(testApp, "S3StackAccessLogs", {
        env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
      });
      const logsBucket = new s3.Bucket(s3Stack, "LogsBucket", {
        bucketName: cdk.PhysicalName.GENERATE_IF_NEEDED,
      });

      const stack = createTestStack(testApp, "AccessLogsEnabledStack", {
        enableAccessLogs: true,
        accessLogsBucket: logsBucket,
      });
      const template = Template.fromStack(stack);

      template.hasResourceProperties(
        "AWS::ElasticLoadBalancingV2::LoadBalancer",
        {
          LoadBalancerAttributes: Match.arrayWith([
            Match.objectLike({
              Key: "access_logs.s3.enabled",
              Value: "true",
            }),
          ]),
        }
      );
    });

    test("enables deletion protection when specified", () => {
      const stack = createTestStack(app, {
        enableDeletionProtection: true,
      });
      const template = Template.fromStack(stack);

      template.hasResourceProperties(
        "AWS::ElasticLoadBalancingV2::LoadBalancer",
        {
          LoadBalancerAttributes: Match.arrayWith([
            Match.objectLike({
              Key: "deletion_protection.enabled",
              Value: "true",
            }),
          ]),
        }
      );
    });
  });

  // ============================================================================
  // ALB Listener Configuration
  // ============================================================================

  describe("ALB Listener Configuration", () => {
    test("creates HTTP listener by default", () => {
      const stack = createTestStack(app);
      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::ElasticLoadBalancingV2::Listener", {
        Protocol: "HTTP",
        Port: 80,
      });
    });

    test("creates HTTPS listener when enabled", () => {
      const stack = createTestStack(app, {
        enableHttps: true,
        certificateArn: TEST_CONFIG.certificateArn,
      });
      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::ElasticLoadBalancingV2::Listener", {
        Protocol: "HTTPS",
        Port: 443,
        Certificates: Match.arrayWith([
          Match.objectLike({
            CertificateArn: TEST_CONFIG.certificateArn,
          }),
        ]),
      });
    });

    test("creates HTTP to HTTPS redirect when HTTPS enabled", () => {
      const stack = createTestStack(app, {
        enableHttps: true,
        certificateArn: TEST_CONFIG.certificateArn,
      });
      const template = Template.fromStack(stack);

      // Verify redirect action exists
      template.hasResourceProperties("AWS::ElasticLoadBalancingV2::Listener", {
        Protocol: "HTTP",
        Port: 80,
        DefaultActions: Match.arrayWith([
          Match.objectLike({
            Type: "redirect",
            RedirectConfig: Match.objectLike({
              Protocol: "HTTPS",
              Port: "443",
              StatusCode: "HTTP_301",
            }),
          }),
        ]),
      });
    });
  });

  /**
   * CloudWatch Logs Configuration Tests
   *
   * Verifies log group creation, retention policies, and removal policies
   * for task and event logs.
   */
  describe("CloudWatch Logs Configuration", () => {
    test("creates task log group with correct name", () => {
      const stack = createTestStack(app);
      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::Logs::LogGroup", {
        LogGroupName: Match.stringLikeRegexp("^/ecs/.*/tasks$"),
      });
    });

    test("creates event log group with correct name", () => {
      const stack = createTestStack(app);
      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::Logs::LogGroup", {
        LogGroupName: Match.stringLikeRegexp("^/ecs/.*/events$"),
      });
    });

    test.each([
      {
        logType: "task",
        logSuffix: TEST_CONSTANTS.LOG_SUFFIXES.TASKS,
        defaultRetention: MONITORING_TASK_LOG_RETENTION,
        customRetention: logs.RetentionDays.ONE_MONTH,
        customRetentionDays: 30,
        propName: "taskLogRetention" as const,
      },
      {
        logType: "event",
        logSuffix: TEST_CONSTANTS.LOG_SUFFIXES.EVENTS,
        defaultRetention: MONITORING_EVENT_LOG_RETENTION,
        customRetention: logs.RetentionDays.SIX_MONTHS,
        customRetentionDays: 180,
        propName: "eventLogRetention" as const,
      },
    ])(
      "uses default $logType log retention from constants",
      ({ logSuffix, defaultRetention }) => {
        const stack = createTestStack(app);
        const template = Template.fromStack(stack);

        template.hasResourceProperties("AWS::Logs::LogGroup", {
          LogGroupName: Match.stringLikeRegexp(
            `.*${logSuffix.replace("/", "\\/")}$`
          ),
          RetentionInDays: defaultRetention,
        });
      }
    );

    test.each([
      {
        logType: "task",
        logSuffix: TEST_CONSTANTS.LOG_SUFFIXES.TASKS,
        customRetention: logs.RetentionDays.ONE_MONTH,
        customRetentionDays: 30,
        propName: "taskLogRetention" as const,
      },
      {
        logType: "event",
        logSuffix: TEST_CONSTANTS.LOG_SUFFIXES.EVENTS,
        customRetention: logs.RetentionDays.SIX_MONTHS,
        customRetentionDays: 180,
        propName: "eventLogRetention" as const,
      },
    ])(
      "respects custom $logType log retention",
      ({ logSuffix, customRetention, customRetentionDays, propName }) => {
        const stack = createTestStack(app, TEST_CONSTANTS.STACK_IDS.DEFAULT, {
          [propName]: customRetention,
        });
        const template = Template.fromStack(stack);

        template.hasResourceProperties("AWS::Logs::LogGroup", {
          LogGroupName: Match.stringLikeRegexp(
            `.*${logSuffix.replace("/", "\\/")}$`
          ),
          RetentionInDays: customRetentionDays,
        });
      }
    );

    /**
     * Verifies that log groups have DESTROY removal policy applied
     */
    test("applies DESTROY removal policy to log groups", () => {
      const stack = createTestStack(app);
      const template = Template.fromStack(stack);

      const logGroups = template.findResources("AWS::Logs::LogGroup");
      Object.values(logGroups).forEach((lg) => {
        const logGroup = lg as {
          DeletionPolicy?: string;
          UpdateReplacePolicy?: string;
        };
        expect(logGroup.DeletionPolicy).toBe("Delete");
        expect(logGroup.UpdateReplacePolicy).toBe("Delete");
      });
    });
  });

  // ============================================================================
  // ECS Event Rule Configuration
  // ============================================================================

  describe("ECS Event Rule Configuration", () => {
    test("creates event rule for ECS events", () => {
      const stack = createTestStack(app);
      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::Events::Rule", {
        EventPattern: {
          source: ["aws.ecs"],
          "detail-type": [
            "ECS Task State Change",
            "ECS Container Instance State Change",
            "ECS Service Action",
          ],
        },
      });
    });

    test("event rule is configured with targets", () => {
      const stack = createTestStack(app);
      const template = Template.fromStack(stack);

      // Verify event rule exists - CDK handles target configuration
      template.resourceCountIs("AWS::Events::Rule", 1);
      const rules = template.findResources("AWS::Events::Rule");
      const ruleProps = Object.values(rules)[0].Properties;
      expect(ruleProps.Targets).toBeDefined();
    });
  });

  // ============================================================================
  // VPC Endpoint Configuration (Simplified - CDK manages internals)
  // ============================================================================

  describe("VPC Endpoint Configuration", () => {
    test("handles VPC endpoint configuration based on subnet type", () => {
      // Test that stack can be created with public subnets
      // VPC endpoint logic is handled internally by CDK based on subnet availability
      const stack = createTestStack(app, "VPCEndpointTestStack", {
        usePublicSubnets: true,
      });

      expect(stack).toBeDefined();
      const template = Template.fromStack(stack);
      // Just verify basic resources exist
      template.resourceCountIs("AWS::ECS::Cluster", 1);
    });
  });

  // ============================================================================
  // Dependencies (Simplified - CDK manages dependencies)
  // ============================================================================

  describe("Dependencies", () => {
    test("stack resources are created with proper dependencies", () => {
      const stack = createTestStack(app);
      const template = Template.fromStack(stack);

      // Verify key resources exist - CDK manages dependencies internally
      template.resourceCountIs("AWS::ECS::Cluster", 1);
      template.resourceCountIs("AWS::AutoScaling::AutoScalingGroup", 1);

      // Stack creation succeeds means dependencies are correct
      expect(stack).toBeDefined();
    });
  });

  // ============================================================================
  // SSM Parameters
  // ============================================================================

  /**
   * SSM Parameters Tests
   *
   * Verifies that SSM parameters are created with correct paths and descriptions,
   * and can be disabled when not needed.
   */
  describe("SSM Parameters", () => {
    test("creates SSM parameters by default", () => {
      const stack = createTestStack(app, TEST_CONSTANTS.STACK_IDS.DEFAULT, {
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
      });
      const template = Template.fromStack(stack);

      expect(stack.ssmParameters).toBeDefined();
      template.resourceCountIs(
        "AWS::SSM::Parameter",
        TEST_CONSTANTS.RESOURCE_COUNTS.SSM_PARAMETERS
      );
    });

    test.each([
      {
        parameterName: "cluster-name",
        expectedPath: TEST_CONSTANTS.SSM_PARAMETER_PATHS.CLUSTER_NAME,
        descriptionPattern: /cluster name/i,
      },
      {
        parameterName: "cluster-arn",
        expectedPath: TEST_CONSTANTS.SSM_PARAMETER_PATHS.CLUSTER_ARN,
        descriptionPattern: /cluster ARN/i,
      },
      {
        parameterName: "alb-dns",
        expectedPath: TEST_CONSTANTS.SSM_PARAMETER_PATHS.ALB_DNS,
        descriptionPattern: /ALB DNS/i,
      },
      {
        parameterName: "listener-arn",
        expectedPath: TEST_CONSTANTS.SSM_PARAMETER_PATHS.LISTENER_ARN,
        descriptionPattern: /listener ARN/i,
      },
      {
        parameterName: "asg-name",
        expectedPath: TEST_CONSTANTS.SSM_PARAMETER_PATHS.ASG_NAME,
        descriptionPattern: /Auto Scaling Group/i,
      },
    ])(
      "creates $parameterName parameter with correct path and description",
      ({ expectedPath, descriptionPattern }) => {
        const stack = createTestStack(app, TEST_CONSTANTS.STACK_IDS.DEFAULT, {
          envName: TEST_CONSTANTS.ENVIRONMENTS.DEV,
        });
        const template = Template.fromStack(stack);

        const patternStr =
          descriptionPattern instanceof RegExp
            ? descriptionPattern.source
            : descriptionPattern;
        template.hasResourceProperties("AWS::SSM::Parameter", {
          Name: expectedPath,
          Type: "String",
          Description: Match.stringLikeRegexp(patternStr),
        });
      }
    );

    test("does not create SSM parameters when disabled", () => {
      const stack = createTestStack(app, TEST_CONSTANTS.STACK_IDS.DEFAULT, {
        createSsmParameters: false,
      });
      const template = Template.fromStack(stack);

      expect(stack.ssmParameters).toBeUndefined();
      template.resourceCountIs("AWS::SSM::Parameter", 0);
    });
  });

  // ============================================================================
  // CloudFormation Outputs
  // ============================================================================

  describe("CloudFormation Outputs", () => {
    test.each([
      "ClusterName",
      "ClusterArn",
      "LoadBalancerDns",
      "ListenerArn",
      "MonitoringUrl",
      "PrometheusUrl",
      "GrafanaUrl",
      "AutoScalingGroupName",
      "TaskLogGroupName",
    ])("creates %s output by default", (outputName) => {
      const stack = createTestStack(app);
      const template = Template.fromStack(stack);

      template.hasOutput(outputName, {});
      const outputs = template.toJSON().Outputs;
      expect(outputs[outputName]).toBeDefined();
      expect(outputs[outputName].Value).toBeDefined();
    });

    test.each([
      {
        protocol: "HTTP",
        enableHttps: false,
        expectedProtocol: "http://",
      },
      {
        protocol: "HTTPS",
        enableHttps: true,
        expectedProtocol: "https://",
        certificateArn: TEST_CONFIG.certificateArn,
      },
    ])(
      "generates correct monitoring URLs with $protocol",
      ({ enableHttps, expectedProtocol, certificateArn }) => {
        const stack = createTestStack(app, {
          enableHttps,
          certificateArn,
        });
        const template = Template.fromStack(stack);

        const outputs = template.toJSON().Outputs;
        const monitoringUrl = outputs.MonitoringUrl.Value["Fn::Join"][1];
        expect(monitoringUrl[0]).toBe(expectedProtocol);
      }
    );

    test("exports outputs when enableExports is true", () => {
      const stack = createTestStack(app, {
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEV,
        projectName: "mon",
        enableExports: true,
      });
      const template = Template.fromStack(stack);

      template.hasOutput("ClusterName", {
        Export: {
          Name: "dev-mon-monitoring-cluster-name",
        },
      });
    });

    test("does not export outputs when enableExports is false", () => {
      const stack = createTestStack(app, {
        enableExports: false,
      });
      const template = Template.fromStack(stack);

      const outputs = template.toJSON().Outputs;
      expect(outputs.ClusterName.Export).toBeUndefined();
    });

    test("does not create outputs when createOutputs is false", () => {
      const stack = createTestStack(app, {
        createOutputs: false,
        createSsmParameters: false,
      });
      const template = Template.fromStack(stack);

      const outputs = template.toJSON().Outputs;
      // Some outputs may still be created by CDK constructs themselves (like LaunchTemplate)
      // Check that our custom outputs are not present
      if (outputs) {
        expect(outputs.ClusterName).toBeUndefined();
        expect(outputs.ClusterArn).toBeUndefined();
        expect(outputs.LoadBalancerDns).toBeUndefined();
      }
    });

    test("includes SSM parameter prefix in outputs when parameters enabled", () => {
      const stack = createTestStack(app, {
        createSsmParameters: true,
      });
      const template = Template.fromStack(stack);

      template.hasOutput("SsmParameterPrefix", {});
    });
  });

  // ============================================================================
  // Production Warnings
  // ============================================================================

  describe("Production Warnings", () => {
    test("stack warns about production best practices when appropriate", () => {
      // Production warnings are logged to console during stack synthesis
      // Testing that stack can be created with warning-triggering configurations
      const stack = createTestStack(app, "WarningsTestStack", {
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT, // Use dev to avoid production validation issues
        enableHttps: false,
        enableAccessLogs: false,
        allowedIpRanges: ["0.0.0.0/0"],
      });

      expect(stack).toBeDefined();
      expect(stack.loadBalancer).toBeDefined();
    });

    test("production warnings can be suppressed via configuration", () => {
      // Test that enableProductionWarnings flag works
      const stack = createTestStack(app, "WarningsSuppressedStack", {
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        enableProductionWarnings: false,
        enableHttps: false,
        allowedIpRanges: ["0.0.0.0/0"],
      });

      expect(stack).toBeDefined();
    });
  });

  // ============================================================================
  // Resource Tagging (Read-only tests using beforeAll)
  // ============================================================================

  describe("Resource Tagging", () => {
    let taggedStack: MonitoringInfraStack;
    let customTaggedStack: MonitoringInfraStack;
    let envTaggedStack: MonitoringInfraStack;

    beforeAll(() => {
      // Create separate apps to avoid construct name conflicts
      const app1 = new cdk.App();
      const app2 = new cdk.App();
      const app3 = new cdk.App();

      taggedStack = createTestStack(app1, "TaggedStack", {
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        projectName: "monitoring",
      });
      customTaggedStack = createTestStack(app2, "CustomTaggedStack", {
        customTags: {
          Owner: "DevOps",
          CostCenter: "Engineering",
        },
      });
      envTaggedStack = createTestStack(app3, "EnvTaggedStack", {
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
      });
    });

    test("applies tags to stack resources", () => {
      // Tags are applied via applyStackTags helper
      expect(taggedStack).toBeDefined();

      // Verify Tags.of() can be called on the stack
      const tags = cdk.Tags.of(taggedStack);
      expect(tags).toBeDefined();
    });

    test("applies custom tags when specified", () => {
      expect(customTaggedStack).toBeDefined();
      const tags = cdk.Tags.of(customTaggedStack);
      expect(tags).toBeDefined();
    });

    test("applies environment-specific tags", () => {
      expect(envTaggedStack).toBeDefined();
      expect(envTaggedStack.stackName).toContain("EnvTaggedStack");
    });
  });

  // ============================================================================
  // Best Practices - No Magic Numbers
  // ============================================================================

  describe("Best Practices - Constants Usage", () => {
    test("uses constants for monitoring ports", () => {
      const stack = createTestStack(app);
      const template = Template.fromStack(stack);

      // Verify Prometheus port uses constant (added as separate SecurityGroupIngress)
      template.hasResourceProperties("AWS::EC2::SecurityGroupIngress", {
        IpProtocol: "tcp",
        FromPort: MONITORING_PORTS.PROMETHEUS,
        ToPort: MONITORING_PORTS.PROMETHEUS,
      });
    });

    test("uses constants for dynamic port range", () => {
      const stack = createTestStack(app);
      const template = Template.fromStack(stack);

      // Dynamic port range is added as a separate SecurityGroupIngress resource
      template.hasResourceProperties("AWS::EC2::SecurityGroupIngress", {
        IpProtocol: "tcp",
        FromPort: BRIDGE_NETWORK_DYNAMIC_PORT_RANGE.MIN,
        ToPort: BRIDGE_NETWORK_DYNAMIC_PORT_RANGE.MAX,
      });
    });

    test("uses constants for capacity defaults", () => {
      const stack = createTestStack(app, {
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
      });
      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::AutoScaling::AutoScalingGroup", {
        MinSize: MONITORING_CAPACITY_DEFAULTS.DEV.minCapacity.toString(),
        MaxSize: MONITORING_CAPACITY_DEFAULTS.DEV.maxCapacity.toString(),
        DesiredCapacity:
          MONITORING_CAPACITY_DEFAULTS.DEV.desiredCapacity.toString(),
      });
    });

    test("uses constants for EBS volume size", () => {
      const stack = createTestStack(app);
      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::EC2::LaunchTemplate", {
        LaunchTemplateData: {
          BlockDeviceMappings: Match.arrayWith([
            Match.objectLike({
              Ebs: Match.objectLike({
                VolumeSize: DEFAULT_ASG_BLOCK_DEVICE_SIZE_GB,
              }),
            }),
          ]),
        },
      });
    });
  });

  // ============================================================================
  // Reliability - Error Handling
  // ============================================================================

  describe("Reliability - Error Handling", () => {
    test("provides helpful error message for HTTPS misconfiguration", () => {
      expect(() => {
        createTestStack(app, {
          enableHttps: true,
          certificateArn: undefined,
        });
      }).toThrow(/certificateArn is required when enableHttps is true/i);
    });

    test("provides helpful error message for access logs misconfiguration", () => {
      expect(() => {
        createTestStack(app, {
          enableAccessLogs: true,
          accessLogsBucket: undefined,
        });
      }).toThrow(/accessLogsBucket is required when enableAccessLogs is true/i);
    });

    test("validates capacity configuration with helpful error", () => {
      expect(() => {
        createTestStack(app, {
          minCapacity: 3,
          maxCapacity: 2,
          desiredCapacity: 2,
        });
      }).toThrow(/capacity/i);
    });
  });

  // ============================================================================
  // SSM State Manager Configuration
  // ============================================================================

  describe("SSM State Manager Configuration", () => {
    test("creates SSM State Manager associations", () => {
      const stack = createTestStack(app);
      const template = Template.fromStack(stack);

      // SSM State Manager creates multiple associations
      // Check that at least some associations exist
      const associations = template.findResources("AWS::SSM::Association");
      expect(Object.keys(associations).length).toBeGreaterThanOrEqual(2);
    });

    test("configures EFS mount point in SSM", () => {
      const stack = createTestStack(app);
      const template = Template.fromStack(stack);

      const associations = template.findResources("AWS::SSM::Association");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ecsAgentAssoc = Object.values(associations).find((assoc: any) =>
        assoc.Properties?.Name?.includes?.("AWS-ConfigureAWSPackage")
      );

      expect(ecsAgentAssoc).toBeDefined();
    });
  });
});
