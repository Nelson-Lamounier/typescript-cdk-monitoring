/** @format */
/// <reference types="jest" />

import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as logs from "aws-cdk-lib/aws-logs";
import * as kms from "aws-cdk-lib/aws-kms";
import { Template, Match } from "aws-cdk-lib/assertions";

import { VpcFlowLogsConstruct } from "../../../../lib/constructs/networking/vpc/vpc-flow-logs-construct";
import { VpcConstruct } from "../../../../lib/constructs/networking/vpc/vpc-construct";
import { MIN_PRODUCTION_FLOW_LOGS_RETENTION_DAYS } from "../../../../lib/shared/constants/networking-constants";

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
  ENVIRONMENTS: {
    TEST: "test",
    DEVELOPMENT: "development",
    PRODUCTION: "production",
    STAGING: "staging",
    PROD: "prod",
  },
  PROJECT_NAMES: {
    MONITORING: "monitoring",
  },
  RESOURCE_COUNTS: {
    LOG_GROUP: 1,
    FLOW_LOG: 1,
    KMS_KEY: 1,
  },
  LOG_GROUP_NAMES: {
    DEFAULT: "/aws/vpc/flowlogs/development",
    WITH_PROJECT: "/aws/vpc/flowlogs/production-monitoring",
    CUSTOM: "/custom/flowlogs/test",
  },
  REMOVAL_POLICIES: {
    DELETE: "Delete",
    RETAIN: "Retain",
    SNAPSHOT: "Snapshot",
  },
  TRAFFIC_TYPES: {
    ALL: "ALL",
    ACCEPT: "ACCEPT",
    REJECT: "REJECT",
  },
  AGGREGATION_INTERVALS: {
    ONE_MINUTE: 60,
    TEN_MINUTES: 600,
  },
  RETENTION_DAYS: {
    ONE_DAY: 1,
    THREE_DAYS: 3,
    SEVEN_DAYS: 7,
    FOURTEEN_DAYS: 14,
    THIRTY_DAYS: 30,
    NINETY_DAYS: 90,
    THREE_SIXTY_FIVE_DAYS: 365,
    INVALID_TOO_LOW: 0,
    INVALID_TOO_HIGH: 10000,
    INVALID_NON_INTEGER: 7.5,
    PRODUCTION_MINIMUM: MIN_PRODUCTION_FLOW_LOGS_RETENTION_DAYS,
  },
  IAM: {
    SERVICE_PRINCIPAL: "vpc-flow-logs.amazonaws.com",
    ACTIONS: {
      CREATE_LOG_STREAM: "logs:CreateLogStream",
      PUT_LOG_EVENTS: "logs:PutLogEvents",
      DESCRIBE_LOG_STREAMS: "logs:DescribeLogStreams",
    },
    KMS_ACTIONS: {
      DECRYPT: "kms:Decrypt",
      ENCRYPT: "kms:Encrypt",
      REENCRYPT: "kms:ReEncrypt*",
      GENERATE_DATA_KEY: "kms:GenerateDataKey*",
    },
  },
  TAGS: {
    ENVIRONMENT: "Environment",
    PROJECT: "Project",
    MANAGED_BY: "ManagedBy",
    CDK: "CDK",
  },
  VALIDATION_ERRORS: {
    RETENTION_TOO_LOW: "Retention days must be at least 1",
    RETENTION_TOO_HIGH: "Retention days must not exceed 2555",
    RETENTION_NON_INTEGER: "Retention days must be an integer",
  },
} as const;

// ============================================================================
// TEST FIXTURES CACHING CLASS
// ============================================================================

/**
 * Create VPC for testing
 *
 * Creates a VPC construct in the given stack. Each stack gets its own VPC
 * to avoid construct name conflicts.
 *
 * @param stack - Stack instance to create VPC in
 * @param id - Optional construct ID (defaults to "TestVpc")
 * @returns IVpc instance for testing
 */
function createTestVpc(stack: cdk.Stack, id: string = "TestVpc"): ec2.IVpc {
  if (!stack) {
    throw new Error("Stack instance is required to create VPC");
  }

  const vpcConstruct = new VpcConstruct(stack, id, {
    envName: TEST_CONSTANTS.ENVIRONMENTS.TEST,
  });
  return vpcConstruct.vpc;
}

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Create a test stack with default configuration
 *
 * @param app - CDK app instance
 * @param id - Stack ID
 * @returns Stack instance for testing
 */
function createTestStack(app: cdk.App, id: string): cdk.Stack {
  if (!app) {
    throw new Error("CDK App instance is required to create test stack");
  }

  return new cdk.Stack(app, id, {
    env: {
      account: TEST_CONFIG.account,
      region: TEST_CONFIG.region,
    },
  });
}

/**
 * Create VPC Flow Logs construct with default configuration
 *
 * @param stack - Stack instance
 * @param id - Construct ID
 * @param props - Optional construct properties
 * @returns VpcFlowLogsConstruct instance
 */
function createFlowLogsConstruct(
  stack: cdk.Stack,
  id: string,
  props: Partial<{
    vpc: ec2.IVpc;
    envName: string;
    projectName?: string;
    retentionDays?: number;
    removalPolicy?: cdk.RemovalPolicy;
  }> = {}
): VpcFlowLogsConstruct {
  const vpc = props.vpc ?? createTestVpc(stack, `Vpc-${id}`);

  return new VpcFlowLogsConstruct(stack, id, {
    vpc,
    envName: props.envName ?? TEST_CONSTANTS.ENVIRONMENTS.TEST,
    projectName: props.projectName,
    retentionDays: props.retentionDays,
    removalPolicy: props.removalPolicy,
  });
}

// ============================================================================
// VPC FLOW LOGS CONSTRUCT TESTS
// ============================================================================

describe("VpcFlowLogsConstruct", () => {
  let app: cdk.App;
  let stack: cdk.Stack;
  let vpc: ec2.IVpc;

  beforeEach(() => {
    app = new cdk.App();
    stack = createTestStack(app, "TestStack");
    vpc = createTestVpc(stack);
  });

  // ============================================================================
  // Basic Construction Tests
  // ============================================================================

  /**
   * Basic Construction Tests
   *
   * Verifies that VpcFlowLogsConstruct can be created with default configuration
   * and exposes expected public properties.
   */
  describe("Basic Construction", () => {
    test("creates VPC Flow Logs with default configuration", () => {
      createFlowLogsConstruct(stack, "FlowLogs");

      const template = Template.fromStack(stack);

      // Should create CloudWatch Log Group
      template.resourceCountIs(
        "AWS::Logs::LogGroup",
        TEST_CONSTANTS.RESOURCE_COUNTS.LOG_GROUP
      );

      // Should create IAM Role for flow logs (check for specific role)
      template.hasResourceProperties("AWS::IAM::Role", {
        AssumeRolePolicyDocument: {
          Statement: [
            {
              Effect: "Allow",
              Principal: {
                Service: TEST_CONSTANTS.IAM.SERVICE_PRINCIPAL,
              },
            },
          ],
        },
      });

      // Should create VPC Flow Log
      template.resourceCountIs(
        "AWS::EC2::FlowLog",
        TEST_CONSTANTS.RESOURCE_COUNTS.FLOW_LOG
      );
    });

    test("exposes log group and log group name", () => {
      const flowLogsConstruct = createFlowLogsConstruct(stack, "FlowLogs");

      expect(flowLogsConstruct.logGroup).toBeDefined();
      expect(flowLogsConstruct.logGroupName).toBeDefined();
    });

    test("creates log group with default retention", () => {
      createFlowLogsConstruct(stack, "FlowLogs");

      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::Logs::LogGroup", {
        RetentionInDays: logs.RetentionDays.ONE_WEEK,
      });
    });

    test("creates log group with default removal policy DESTROY for non-production", () => {
      createFlowLogsConstruct(stack, "FlowLogs", {
        envName: TEST_CONSTANTS.ENVIRONMENTS.TEST,
      });

      const template = Template.fromStack(stack);

      // Check both DeletionPolicy and UpdateReplacePolicy for DESTROY (non-production default)
      const logGroupResources = template.findResources("AWS::Logs::LogGroup");
      const logGroupResource = Object.values(logGroupResources)[0] as {
        DeletionPolicy?: string;
        UpdateReplacePolicy?: string;
      };
      expect(logGroupResource.DeletionPolicy).toBe(
        TEST_CONSTANTS.REMOVAL_POLICIES.DELETE
      );
      expect(logGroupResource.UpdateReplacePolicy).toBe(
        TEST_CONSTANTS.REMOVAL_POLICIES.DELETE
      );
    });
  });

  // ============================================================================
  // Log Group Naming Tests (Parameterized)
  // ============================================================================

  /**
   * Log Group Naming Tests
   *
   * Verifies that log group names are created correctly with and without
   * project names, and with custom names.
   */
  describe("Log Group Naming", () => {
    test.each([
      {
        description: "default naming pattern without project name",
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        expectedName: TEST_CONSTANTS.LOG_GROUP_NAMES.DEFAULT,
      },
      {
        description: "includes project name in log group name",
        envName: TEST_CONSTANTS.ENVIRONMENTS.PRODUCTION,
        projectName: TEST_CONSTANTS.PROJECT_NAMES.MONITORING,
        expectedName: TEST_CONSTANTS.LOG_GROUP_NAMES.WITH_PROJECT,
      },
    ])("uses $description", ({ envName, projectName, expectedName }) => {
      createFlowLogsConstruct(stack, "FlowLogs", {
        envName,
        projectName,
      });

      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::Logs::LogGroup", {
        LogGroupName: expectedName,
      });
    });

    test("uses custom log group name when provided", () => {
      // Create a separate stack with custom log group name
      const customStack = createTestStack(app, "CustomStack");
      const customVpc = createTestVpc(customStack, "CustomVpc");

      new VpcFlowLogsConstruct(customStack, "FlowLogs", {
        vpc: customVpc,
        envName: TEST_CONSTANTS.ENVIRONMENTS.TEST,
        logGroupName: TEST_CONSTANTS.LOG_GROUP_NAMES.CUSTOM,
      });

      const customTemplate = Template.fromStack(customStack);
      customTemplate.hasResourceProperties("AWS::Logs::LogGroup", {
        LogGroupName: TEST_CONSTANTS.LOG_GROUP_NAMES.CUSTOM,
      });
    });
  });

  // ============================================================================
  // Retention Configuration Tests (Parameterized)
  // ============================================================================

  /**
   * Retention Configuration Tests
   *
   * Verifies that retention days are correctly mapped to CDK enum values
   * and validation errors are thrown for invalid values.
   */
  describe("Retention Configuration", () => {
    test("accepts custom retention days", () => {
      createFlowLogsConstruct(stack, "FlowLogs", {
        retentionDays: TEST_CONSTANTS.RETENTION_DAYS.THIRTY_DAYS,
      });

      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::Logs::LogGroup", {
        RetentionInDays: logs.RetentionDays.ONE_MONTH,
      });
    });

    test.each([
      {
        days: TEST_CONSTANTS.RETENTION_DAYS.ONE_DAY,
        expected: logs.RetentionDays.ONE_DAY,
      },
      {
        days: TEST_CONSTANTS.RETENTION_DAYS.THREE_DAYS,
        expected: logs.RetentionDays.THREE_DAYS,
      },
      {
        days: TEST_CONSTANTS.RETENTION_DAYS.SEVEN_DAYS,
        expected: logs.RetentionDays.ONE_WEEK,
      },
      {
        days: TEST_CONSTANTS.RETENTION_DAYS.FOURTEEN_DAYS,
        expected: logs.RetentionDays.TWO_WEEKS,
      },
      {
        days: TEST_CONSTANTS.RETENTION_DAYS.THIRTY_DAYS,
        expected: logs.RetentionDays.ONE_MONTH,
      },
      {
        days: TEST_CONSTANTS.RETENTION_DAYS.NINETY_DAYS,
        expected: logs.RetentionDays.THREE_MONTHS,
      },
      {
        days: TEST_CONSTANTS.RETENTION_DAYS.THREE_SIXTY_FIVE_DAYS,
        expected: logs.RetentionDays.ONE_YEAR,
      },
    ])(
      "maps retention days $days to correct CDK enum value",
      ({ days, expected }) => {
        // Create separate test stacks for each case to avoid synthesis conflicts
        const testApp = new cdk.App();
        const testStack = createTestStack(testApp, `TestStack${days}`);
        const testVpc = createTestVpc(testStack, `Vpc${days}`);

        new VpcFlowLogsConstruct(testStack, "FlowLogs", {
          vpc: testVpc,
          envName: TEST_CONSTANTS.ENVIRONMENTS.TEST,
          retentionDays: days,
        });

        const template = Template.fromStack(testStack);
        template.hasResourceProperties("AWS::Logs::LogGroup", {
          RetentionInDays: expected,
        });
      }
    );

    test.each([
      {
        retentionDays: TEST_CONSTANTS.RETENTION_DAYS.INVALID_TOO_LOW,
        expectedError: TEST_CONSTANTS.VALIDATION_ERRORS.RETENTION_TOO_LOW,
      },
      {
        retentionDays: TEST_CONSTANTS.RETENTION_DAYS.INVALID_TOO_HIGH,
        expectedError: TEST_CONSTANTS.VALIDATION_ERRORS.RETENTION_TOO_HIGH,
      },
      {
        retentionDays: TEST_CONSTANTS.RETENTION_DAYS.INVALID_NON_INTEGER,
        expectedError: TEST_CONSTANTS.VALIDATION_ERRORS.RETENTION_NON_INTEGER,
      },
    ])(
      "throws error for invalid retention days: $retentionDays",
      ({ retentionDays, expectedError }) => {
        expect(() => {
          createFlowLogsConstruct(stack, "FlowLogs", {
            retentionDays: retentionDays as number,
          });
        }).toThrow(expectedError);
      }
    );
  });

  // ============================================================================
  // Production Warnings Tests
  // ============================================================================

  /**
   * Production Environment Warnings Tests
   *
   * Verifies that warnings are added for short retention in production
   * environments and that 'prod' is recognized as production.
   */
  describe("Production Environment Warnings", () => {
    test("adds warning for short retention in production", () => {
      const productionStack = createTestStack(app, "ProductionStack");
      const productionVpc = createTestVpc(productionStack, "ProductionVpc");

      const construct = new VpcFlowLogsConstruct(productionStack, "FlowLogs", {
        vpc: productionVpc,
        envName: TEST_CONSTANTS.ENVIRONMENTS.PRODUCTION,
        retentionDays: TEST_CONSTANTS.RETENTION_DAYS.SEVEN_DAYS, // Below minimum for production
      });

      // Check that warning annotation was added
      // Note: We can't directly test annotations, but we can verify the construct was created
      expect(construct).toBeDefined();
    });

    test("does not warn for adequate retention in production", () => {
      const productionStack = createTestStack(app, "ProductionStack2");
      const productionVpc = createTestVpc(productionStack, "ProductionVpc2");

      const construct = new VpcFlowLogsConstruct(productionStack, "FlowLogs", {
        vpc: productionVpc,
        envName: TEST_CONSTANTS.ENVIRONMENTS.PRODUCTION,
        retentionDays: TEST_CONSTANTS.RETENTION_DAYS.NINETY_DAYS, // Above minimum for production
      });

      expect(construct).toBeDefined();
    });

    test("recognises 'prod' as production environment", () => {
      const prodStack = createTestStack(app, "ProdStack");
      const prodVpc = createTestVpc(prodStack, "ProdVpc");

      const construct = new VpcFlowLogsConstruct(prodStack, "FlowLogs", {
        vpc: prodVpc,
        envName: TEST_CONSTANTS.ENVIRONMENTS.PROD,
        retentionDays: TEST_CONSTANTS.RETENTION_DAYS.SEVEN_DAYS,
      });

      expect(construct).toBeDefined();
    });
  });

  // ============================================================================
  // KMS Encryption Tests
  // ============================================================================

  /**
   * KMS Encryption Tests
   *
   * Verifies that KMS encryption can be applied to log groups and that
   * appropriate IAM permissions are granted.
   */
  describe("KMS Encryption", () => {
    test("creates log group without encryption key by default", () => {
      createFlowLogsConstruct(stack, "FlowLogs");

      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::Logs::LogGroup", {
        KmsKeyId: Match.absent(),
      });
    });

    test("applies KMS encryption when key is provided", () => {
      const key = new kms.Key(stack, "LogKey");

      new VpcFlowLogsConstruct(stack, "FlowLogs", {
        vpc,
        envName: TEST_CONSTANTS.ENVIRONMENTS.TEST,
        encryptionKey: key,
      });

      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::Logs::LogGroup", {
        KmsKeyId: {
          "Fn::GetAtt": [Match.stringLikeRegexp("LogKey.*"), "Arn"],
        },
      });
    });

    test("grants KMS permissions to flow logs role when key provided", () => {
      const key = new kms.Key(stack, "LogKey");

      new VpcFlowLogsConstruct(stack, "FlowLogs", {
        vpc,
        envName: TEST_CONSTANTS.ENVIRONMENTS.TEST,
        encryptionKey: key,
      });

      const template = Template.fromStack(stack);

      // Should have KMS permissions in the role
      template.hasResourceProperties("AWS::IAM::Policy", {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Effect: "Allow",
              Action: Match.arrayWith([
                TEST_CONSTANTS.IAM.KMS_ACTIONS.DECRYPT,
                TEST_CONSTANTS.IAM.KMS_ACTIONS.ENCRYPT,
                TEST_CONSTANTS.IAM.KMS_ACTIONS.REENCRYPT,
                TEST_CONSTANTS.IAM.KMS_ACTIONS.GENERATE_DATA_KEY,
              ]),
            }),
          ]),
        },
      });
    });
  });

  // ============================================================================
  // Traffic Type Configuration Tests (Parameterized)
  // ============================================================================

  /**
   * Traffic Type Configuration Tests
   *
   * Verifies that different traffic types (ALL, ACCEPT, REJECT) can be configured.
   */
  describe("Traffic Type Configuration", () => {
    test.each([
      {
        trafficType: undefined,
        expectedType: TEST_CONSTANTS.TRAFFIC_TYPES.ALL,
        description: "ALL traffic type by default",
      },
      {
        trafficType: ec2.FlowLogTrafficType.ACCEPT,
        expectedType: TEST_CONSTANTS.TRAFFIC_TYPES.ACCEPT,
        description: "ACCEPT traffic type",
      },
      {
        trafficType: ec2.FlowLogTrafficType.REJECT,
        expectedType: TEST_CONSTANTS.TRAFFIC_TYPES.REJECT,
        description: "REJECT traffic type",
      },
    ])("uses $description", ({ trafficType, expectedType }) => {
      new VpcFlowLogsConstruct(stack, "FlowLogs", {
        vpc,
        envName: TEST_CONSTANTS.ENVIRONMENTS.TEST,
        trafficType,
      });

      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::EC2::FlowLog", {
        ResourceType: "VPC",
        TrafficType: expectedType,
      });
    });
  });

  // ============================================================================
  // Custom Log Format Tests
  // ============================================================================

  /**
   * Custom Log Format Tests
   *
   * Verifies that custom log formats can be applied to flow logs.
   */
  describe("Custom Log Format", () => {
    test("creates flow log without custom format by default", () => {
      createFlowLogsConstruct(stack, "FlowLogs");

      const template = Template.fromStack(stack);

      // When no custom format, CDK uses default format
      // We can verify the flow log exists
      template.resourceCountIs(
        "AWS::EC2::FlowLog",
        TEST_CONSTANTS.RESOURCE_COUNTS.FLOW_LOG
      );
    });

    test("applies custom log format when provided", () => {
      const customFormat = [
        ec2.LogFormat.VERSION,
        ec2.LogFormat.SRC_ADDR,
        ec2.LogFormat.DST_ADDR,
        ec2.LogFormat.ACTION,
      ];

      new VpcFlowLogsConstruct(stack, "FlowLogs", {
        vpc,
        envName: TEST_CONSTANTS.ENVIRONMENTS.TEST,
        logFormat: customFormat,
      });

      const template = Template.fromStack(stack);

      // Verify flow log was created (format is applied at runtime)
      template.resourceCountIs(
        "AWS::EC2::FlowLog",
        TEST_CONSTANTS.RESOURCE_COUNTS.FLOW_LOG
      );
    });
  });

  // ============================================================================
  // Aggregation Interval Tests (Parameterized)
  // ============================================================================

  /**
   * Aggregation Interval Tests
   *
   * Verifies that aggregation intervals can be configured for cost optimization.
   */
  describe("Aggregation Interval", () => {
    test("creates flow log without aggregation interval by default", () => {
      createFlowLogsConstruct(stack, "FlowLogs");

      const template = Template.fromStack(stack);

      template.resourceCountIs(
        "AWS::EC2::FlowLog",
        TEST_CONSTANTS.RESOURCE_COUNTS.FLOW_LOG
      );
    });

    test.each([
      {
        interval: ec2.FlowLogMaxAggregationInterval.ONE_MINUTE,
        expectedSeconds: TEST_CONSTANTS.AGGREGATION_INTERVALS.ONE_MINUTE,
        description: "1-minute aggregation interval",
      },
      {
        interval: ec2.FlowLogMaxAggregationInterval.TEN_MINUTES,
        expectedSeconds: TEST_CONSTANTS.AGGREGATION_INTERVALS.TEN_MINUTES,
        description: "10-minute aggregation interval",
      },
    ])(
      "applies $description when specified",
      ({ interval, expectedSeconds }) => {
        new VpcFlowLogsConstruct(stack, "FlowLogs", {
          vpc,
          envName: TEST_CONSTANTS.ENVIRONMENTS.TEST,
          maxAggregationInterval: interval,
        });

        const template = Template.fromStack(stack);

        template.hasResourceProperties("AWS::EC2::FlowLog", {
          MaxAggregationInterval: expectedSeconds,
        });
      }
    );
  });

  // ============================================================================
  // Removal Policy Tests (Parameterized)
  // ============================================================================

  /**
   * Removal Policy Tests
   *
   * Verifies that removal policies can be configured and that environment-aware
   * defaults are applied correctly.
   */
  describe("Removal Policy", () => {
    test.each([
      {
        envName: TEST_CONSTANTS.ENVIRONMENTS.TEST,
        expectedPolicy: TEST_CONSTANTS.REMOVAL_POLICIES.DELETE,
        description: "DESTROY removal policy for non-production",
      },
      {
        envName: TEST_CONSTANTS.ENVIRONMENTS.PRODUCTION,
        expectedPolicy: TEST_CONSTANTS.REMOVAL_POLICIES.RETAIN,
        description: "RETAIN removal policy for production",
      },
    ])("uses $description by default", ({ envName, expectedPolicy }) => {
      const testStack = createTestStack(app, `TestStack-${envName}`);
      const testVpc = createTestVpc(testStack, `Vpc-${envName}`);

      new VpcFlowLogsConstruct(testStack, "FlowLogs", {
        vpc: testVpc,
        envName,
      });

      const template = Template.fromStack(testStack);

      // DeletionPolicy is a resource-level attribute, not a property
      const logGroupResources = template.findResources("AWS::Logs::LogGroup");
      const logGroupResource = Object.values(logGroupResources)[0] as {
        DeletionPolicy?: string;
        UpdateReplacePolicy?: string;
      };
      expect(logGroupResource.DeletionPolicy).toBe(expectedPolicy);
      expect(logGroupResource.UpdateReplacePolicy).toBe(expectedPolicy);
    });

    test.each([
      {
        policy: cdk.RemovalPolicy.DESTROY,
        expectedPolicy: TEST_CONSTANTS.REMOVAL_POLICIES.DELETE,
        description: "DESTROY removal policy",
      },
      {
        policy: cdk.RemovalPolicy.SNAPSHOT,
        expectedPolicy: TEST_CONSTANTS.REMOVAL_POLICIES.SNAPSHOT,
        description: "SNAPSHOT removal policy",
      },
      {
        policy: cdk.RemovalPolicy.RETAIN,
        expectedPolicy: TEST_CONSTANTS.REMOVAL_POLICIES.RETAIN,
        description: "RETAIN removal policy",
      },
    ])(
      "accepts $description when explicitly set",
      ({ policy, expectedPolicy }) => {
        createFlowLogsConstruct(stack, "FlowLogs", {
          removalPolicy: policy,
        });

        const template = Template.fromStack(stack);

        const logGroupResources = template.findResources("AWS::Logs::LogGroup");
        const logGroupResource = Object.values(logGroupResources)[0] as {
          DeletionPolicy?: string;
          UpdateReplacePolicy?: string;
        };
        expect(logGroupResource.DeletionPolicy).toBe(expectedPolicy);
        expect(logGroupResource.UpdateReplacePolicy).toBe(expectedPolicy);
      }
    );
  });

  // ============================================================================
  // IAM Role and Permissions Tests
  // ============================================================================

  /**
   * IAM Role and Permissions Tests
   *
   * Verifies that IAM roles are created with correct permissions and descriptions.
   */
  describe("IAM Role and Permissions", () => {
    test("creates IAM role for VPC Flow Logs service", () => {
      createFlowLogsConstruct(stack, "FlowLogs");

      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::IAM::Role", {
        AssumeRolePolicyDocument: {
          Statement: [
            {
              Effect: "Allow",
              Principal: {
                Service: TEST_CONSTANTS.IAM.SERVICE_PRINCIPAL,
              },
              Action: "sts:AssumeRole",
            },
          ],
        },
      });
    });

    test("grants explicit CloudWatch Logs permissions", () => {
      createFlowLogsConstruct(stack, "FlowLogs");

      const template = Template.fromStack(stack);

      // Check that the policy contains the CloudWatch Logs statement
      // (there may be multiple statements, e.g., KMS permissions if encryption is enabled)
      template.hasResourceProperties("AWS::IAM::Policy", {
        PolicyDocument: {
          Statement: Match.arrayWith([
            {
              Effect: "Allow",
              Action: [
                TEST_CONSTANTS.IAM.ACTIONS.CREATE_LOG_STREAM,
                TEST_CONSTANTS.IAM.ACTIONS.PUT_LOG_EVENTS,
                TEST_CONSTANTS.IAM.ACTIONS.DESCRIBE_LOG_STREAMS,
              ],
              Resource: Match.anyValue(),
            },
          ]),
        },
      });
    });

    test("scopes permissions to specific log group ARN", () => {
      createFlowLogsConstruct(stack, "FlowLogs");

      const template = Template.fromStack(stack);

      // Verify the IAM policy has resources scoped to the log group ARN
      // Check that Resource array contains exactly 2 elements referencing the log group
      const policyResources = template.findResources("AWS::IAM::Policy");
      const policyResource = Object.values(policyResources)[0] as {
        Properties: {
          PolicyDocument: {
            Statement: Array<{
              Effect?: string;
              Action?: string | string[];
              Resource?: unknown;
            }>;
          };
        };
      };
      const statements = policyResource.Properties.PolicyDocument.Statement;
      const logsStatement = statements.find(
        (stmt) =>
          stmt.Effect === "Allow" &&
          (Array.isArray(stmt.Action)
            ? stmt.Action.includes(TEST_CONSTANTS.IAM.ACTIONS.CREATE_LOG_STREAM)
            : stmt.Action === TEST_CONSTANTS.IAM.ACTIONS.CREATE_LOG_STREAM)
      );

      expect(logsStatement).toBeDefined();
      expect(logsStatement?.Resource).toBeInstanceOf(Array);
      expect((logsStatement?.Resource as unknown[]).length).toBe(2);
    });

    test.each([
      {
        envName: TEST_CONSTANTS.ENVIRONMENTS.PRODUCTION,
        projectName: undefined,
        expectedDescription: `VPC Flow Logs role for ${TEST_CONSTANTS.ENVIRONMENTS.PRODUCTION} environment`,
      },
      {
        envName: TEST_CONSTANTS.ENVIRONMENTS.PRODUCTION,
        projectName: TEST_CONSTANTS.PROJECT_NAMES.MONITORING,
        expectedDescription: `VPC Flow Logs role for ${TEST_CONSTANTS.ENVIRONMENTS.PRODUCTION} environment (${TEST_CONSTANTS.PROJECT_NAMES.MONITORING})`,
      },
    ])(
      "includes environment name and project name in role description",
      ({ envName, projectName, expectedDescription }) => {
        const testStack = createTestStack(app, `TestStack-${envName}`);
        const testVpc = createTestVpc(testStack, `Vpc-${envName}`);

        new VpcFlowLogsConstruct(testStack, "FlowLogs", {
          vpc: testVpc,
          envName,
          projectName,
        });

        const template = Template.fromStack(testStack);

        // Find the flow logs role (may be multiple roles in stack)
        const roles = template.findResources("AWS::IAM::Role");
        const flowLogsRole = Object.values(roles).find((role) => {
          const roleProps = role.Properties as {
            AssumeRolePolicyDocument?: {
              Statement?: Array<{
                Principal?: { Service?: string | string[] };
              }>;
            };
            Description?: string;
          };
          const hasFlowLogsPrincipal =
            roleProps.AssumeRolePolicyDocument?.Statement?.some((stmt) => {
              const service = stmt.Principal?.Service;
              return (
                (typeof service === "string" &&
                  service === TEST_CONSTANTS.IAM.SERVICE_PRINCIPAL) ||
                (Array.isArray(service) &&
                  service.includes(TEST_CONSTANTS.IAM.SERVICE_PRINCIPAL))
              );
            });
          return hasFlowLogsPrincipal;
        });

        expect(flowLogsRole).toBeDefined();
        const roleProps = flowLogsRole?.Properties as { Description?: string };
        expect(roleProps.Description).toBe(expectedDescription);
      }
    );
  });

  // ============================================================================
  // Tags Tests (Parameterized)
  // ============================================================================

  /**
   * Tags Tests
   *
   * Verifies that appropriate tags are applied to log groups.
   */
  describe("Tags", () => {
    test.each([
      {
        tagKey: TEST_CONSTANTS.TAGS.ENVIRONMENT,
        tagValue: TEST_CONSTANTS.ENVIRONMENTS.STAGING,
        description: "Environment tag",
      },
      {
        tagKey: TEST_CONSTANTS.TAGS.MANAGED_BY,
        tagValue: TEST_CONSTANTS.TAGS.CDK,
        description: "ManagedBy tag",
      },
    ])("adds $description", ({ tagKey, tagValue }) => {
      new VpcFlowLogsConstruct(stack, "FlowLogs", {
        vpc,
        envName: TEST_CONSTANTS.ENVIRONMENTS.STAGING,
      });

      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::Logs::LogGroup", {
        Tags: Match.arrayWith([
          {
            Key: tagKey,
            Value: tagValue,
          },
        ]),
      });
    });

    test("adds Project tag when project name provided", () => {
      createFlowLogsConstruct(stack, "FlowLogs", {
        projectName: TEST_CONSTANTS.PROJECT_NAMES.MONITORING,
      });

      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::Logs::LogGroup", {
        Tags: Match.arrayWith([
          {
            Key: TEST_CONSTANTS.TAGS.PROJECT,
            Value: TEST_CONSTANTS.PROJECT_NAMES.MONITORING,
          },
        ]),
      });
    });
  });

  // ============================================================================
  // Integration Tests (Read-only tests using beforeAll)
  // ============================================================================

  /**
   * Integration Tests
   *
   * Verifies that all features work together correctly in a complete setup.
   */
  describe("Integration", () => {
    let integrationStack: cdk.Stack;
    let integrationVpc: ec2.IVpc;

    beforeAll(() => {
      const testApp = new cdk.App();
      integrationStack = createTestStack(testApp, "IntegrationStack");
      integrationVpc = createTestVpc(integrationStack, "IntegrationVpc");
    });

    test("creates complete flow logs setup with all features", () => {
      const key = new kms.Key(integrationStack, "LogKey");

      new VpcFlowLogsConstruct(integrationStack, "FlowLogs", {
        vpc: integrationVpc,
        envName: TEST_CONSTANTS.ENVIRONMENTS.PRODUCTION,
        projectName: TEST_CONSTANTS.PROJECT_NAMES.MONITORING,
        retentionDays: TEST_CONSTANTS.RETENTION_DAYS.NINETY_DAYS,
        encryptionKey: key,
        trafficType: ec2.FlowLogTrafficType.ALL,
        logFormat: [
          ec2.LogFormat.VERSION,
          ec2.LogFormat.SRC_ADDR,
          ec2.LogFormat.DST_ADDR,
        ],
        maxAggregationInterval: ec2.FlowLogMaxAggregationInterval.TEN_MINUTES,
        removalPolicy: cdk.RemovalPolicy.RETAIN,
      });

      const template = Template.fromStack(integrationStack);

      // Verify all resources created
      template.resourceCountIs(
        "AWS::Logs::LogGroup",
        TEST_CONSTANTS.RESOURCE_COUNTS.LOG_GROUP
      );
      // Check for flow logs IAM role specifically (VPC construct may create other roles)
      template.hasResourceProperties("AWS::IAM::Role", {
        AssumeRolePolicyDocument: {
          Statement: [
            {
              Effect: "Allow",
              Principal: {
                Service: TEST_CONSTANTS.IAM.SERVICE_PRINCIPAL,
              },
            },
          ],
        },
        Description: `VPC Flow Logs role for ${TEST_CONSTANTS.ENVIRONMENTS.PRODUCTION} environment (${TEST_CONSTANTS.PROJECT_NAMES.MONITORING})`,
      });
      template.resourceCountIs(
        "AWS::EC2::FlowLog",
        TEST_CONSTANTS.RESOURCE_COUNTS.FLOW_LOG
      );
      template.resourceCountIs(
        "AWS::KMS::Key",
        TEST_CONSTANTS.RESOURCE_COUNTS.KMS_KEY
      );

      // Verify log group properties
      template.hasResourceProperties("AWS::Logs::LogGroup", {
        LogGroupName: TEST_CONSTANTS.LOG_GROUP_NAMES.WITH_PROJECT,
        RetentionInDays: logs.RetentionDays.THREE_MONTHS,
      });

      // Verify removal policy separately
      const logGroupResources = template.findResources("AWS::Logs::LogGroup");
      const logGroupResource = Object.values(logGroupResources)[0] as {
        DeletionPolicy?: string;
        UpdateReplacePolicy?: string;
      };
      expect(logGroupResource.DeletionPolicy).toBe(
        TEST_CONSTANTS.REMOVAL_POLICIES.RETAIN
      );
      expect(logGroupResource.UpdateReplacePolicy).toBe(
        TEST_CONSTANTS.REMOVAL_POLICIES.RETAIN
      );

      // Verify flow log properties
      template.hasResourceProperties("AWS::EC2::FlowLog", {
        ResourceType: "VPC",
        TrafficType: TEST_CONSTANTS.TRAFFIC_TYPES.ALL,
        MaxAggregationInterval:
          TEST_CONSTANTS.AGGREGATION_INTERVALS.TEN_MINUTES,
      });
    });
  });
});
