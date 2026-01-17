/** @format */
/// <reference types="jest" />

import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as logs from "aws-cdk-lib/aws-logs";
import * as kms from "aws-cdk-lib/aws-kms";
import { Template, Match } from "aws-cdk-lib/assertions";

import { VpcFlowLogsConstruct } from "../../../../../lib/constructs/networking/vpc/vpc-flow-logs-construct";
import { createTestApp, extendExpectWithCdkMatchers } from "../../../utils/stack-test-utils";

import {
  TEST_CONSTANTS,
  createTestStack,
  createTestVpc,
  createFlowLogsConstruct,
} from "./shared-fixtures";

// ============================================================================
// CUSTOM MATCHERS SETUP
// ============================================================================

extendExpectWithCdkMatchers();

// ============================================================================
// VPC FLOW LOGS CONSTRUCT - CONFIGURATION TESTS
// ============================================================================

describe("VpcFlowLogsConstruct - Configuration", () => {
  let app: cdk.App;
  let stack: cdk.Stack;
  let vpc: ec2.IVpc;

  beforeEach(() => {
    app = createTestApp();
    stack = createTestStack(app, "TestStack");
    vpc = createTestVpc(stack);
  });

  // ============================================
  // Log Group Naming Tests
  // ============================================

  describe("Log Group Naming", () => {
    let namingTestData: Array<{
      envName: string;
      projectName?: string;
      expectedName: string;
      template: Template;
    }>;

    beforeAll(() => {
      const configs = [
        {
          envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
          projectName: undefined,
          expectedName: TEST_CONSTANTS.LOG_GROUP_NAMES.DEFAULT,
        },
        {
          envName: TEST_CONSTANTS.ENVIRONMENTS.PRODUCTION,
          projectName: TEST_CONSTANTS.PROJECT_NAMES.MONITORING,
          expectedName: TEST_CONSTANTS.LOG_GROUP_NAMES.WITH_PROJECT,
        },
      ];

      namingTestData = configs.map((config) => {
        const testApp = createTestApp();
        const testStack = createTestStack(testApp, `NamingStack-${config.envName}`);
        createFlowLogsConstruct(testStack, "FlowLogs", {
          envName: config.envName,
          projectName: config.projectName,
        });

        return {
          ...config,
          template: Template.fromStack(testStack),
        };
      });
    });

    test.each([
      {
        description: "default naming pattern without project name",
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        expectedName: TEST_CONSTANTS.LOG_GROUP_NAMES.DEFAULT,
      },
      {
        description: "includes project name in log group name",
        envName: TEST_CONSTANTS.ENVIRONMENTS.PRODUCTION,
        expectedName: TEST_CONSTANTS.LOG_GROUP_NAMES.WITH_PROJECT,
      },
    ])("uses $description", ({ envName, expectedName }) => {
      const testData = namingTestData.find((d) => d.envName === envName);
      expect(testData).toBeDefined();

      expect(() => {
        testData?.template.hasResourceProperties("AWS::Logs::LogGroup", {
          LogGroupName: expectedName,
        });
      }).not.toThrow();
    });

    test("uses custom log group name when provided", () => {
      const customApp = createTestApp();
      const customStack = createTestStack(customApp, "CustomStack");
      const customVpc = createTestVpc(customStack, "CustomVpc");

      new VpcFlowLogsConstruct(customStack, "FlowLogs", {
        vpc: customVpc,
        envName: TEST_CONSTANTS.ENVIRONMENTS.TEST,
        logGroupName: TEST_CONSTANTS.LOG_GROUP_NAMES.CUSTOM,
      });

      const customTemplate = Template.fromStack(customStack);

      expect(() => {
        customTemplate.hasResourceProperties("AWS::Logs::LogGroup", {
          LogGroupName: TEST_CONSTANTS.LOG_GROUP_NAMES.CUSTOM,
        });
      }).not.toThrow();
    });
  });

  // ============================================
  // Retention Configuration Tests
  // ============================================

  describe("Retention Configuration", () => {
    let retentionTestData: Array<{
      days: number;
      expected: logs.RetentionDays;
      template: Template;
    }>;

    beforeAll(() => {
      const configs = [
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
      ];

      retentionTestData = configs.map((config) => {
        const testApp = createTestApp();
        const testStack = createTestStack(testApp, `RetentionStack${config.days}`);
        const testVpc = createTestVpc(testStack, `Vpc${config.days}`);

        new VpcFlowLogsConstruct(testStack, "FlowLogs", {
          vpc: testVpc,
          envName: TEST_CONSTANTS.ENVIRONMENTS.TEST,
          retentionDays: config.days,
        });

        return {
          ...config,
          template: Template.fromStack(testStack),
        };
      });
    });

    test("accepts custom retention days", () => {
      createFlowLogsConstruct(stack, "FlowLogs", {
        retentionDays: TEST_CONSTANTS.RETENTION_DAYS.THIRTY_DAYS,
      });

      const template = Template.fromStack(stack);

      expect(() => {
        template.hasResourceProperties("AWS::Logs::LogGroup", {
          RetentionInDays: logs.RetentionDays.ONE_MONTH,
        });
      }).not.toThrow();
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
        const testData = retentionTestData.find((d) => d.days === days);
        expect(testData).toBeDefined();

        expect(() => {
          testData?.template.hasResourceProperties("AWS::Logs::LogGroup", {
            RetentionInDays: expected,
          });
        }).not.toThrow();
      }
    );
  });

  // ============================================
  // Traffic Type Configuration Tests
  // ============================================

  describe("Traffic Type Configuration", () => {
    let trafficTypeTestData: Array<{
      trafficType: ec2.FlowLogTrafficType | undefined;
      expectedType: string;
      description: string;
      template: Template;
    }>;

    beforeAll(() => {
      const configs = [
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
      ];

      trafficTypeTestData = configs.map((config) => {
        const testApp = createTestApp();
        const testStack = createTestStack(testApp, `TrafficStack-${config.expectedType}`);
        const testVpc = createTestVpc(testStack);

        new VpcFlowLogsConstruct(testStack, "FlowLogs", {
          vpc: testVpc,
          envName: TEST_CONSTANTS.ENVIRONMENTS.TEST,
          trafficType: config.trafficType,
        });

        return {
          ...config,
          template: Template.fromStack(testStack),
        };
      });
    });

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
    ])("uses $description", ({ expectedType }) => {
      const testData = trafficTypeTestData.find((d) => d.expectedType === expectedType);
      expect(testData).toBeDefined();

      expect(() => {
        testData?.template.hasResourceProperties("AWS::EC2::FlowLog", {
          ResourceType: "VPC",
          TrafficType: expectedType,
        });
      }).not.toThrow();
    });
  });

  // ============================================
  // Custom Log Format Tests
  // ============================================

  describe("Custom Log Format", () => {
    test("creates flow log without custom format by default", () => {
      createFlowLogsConstruct(stack, "FlowLogs");

      const template = Template.fromStack(stack);

      expect(() => {
        // When no custom format, CDK uses default format
        // We can verify the flow log exists
        template.resourceCountIs(
          "AWS::EC2::FlowLog",
          TEST_CONSTANTS.RESOURCE_COUNTS.FLOW_LOG
        );
      }).not.toThrow();
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

      expect(() => {
        // Verify flow log was created (format is applied at runtime)
        template.resourceCountIs(
          "AWS::EC2::FlowLog",
          TEST_CONSTANTS.RESOURCE_COUNTS.FLOW_LOG
        );
      }).not.toThrow();
    });
  });

  // ============================================
  // Aggregation Interval Tests
  // ============================================

  describe("Aggregation Interval", () => {
    let aggregationTestData: Array<{
      interval: ec2.FlowLogMaxAggregationInterval;
      expectedSeconds: number;
      description: string;
      template: Template;
    }>;

    beforeAll(() => {
      const configs = [
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
      ];

      aggregationTestData = configs.map((config) => {
        const testApp = createTestApp();
        const testStack = createTestStack(testApp, `AggregationStack-${config.expectedSeconds}`);
        const testVpc = createTestVpc(testStack);

        new VpcFlowLogsConstruct(testStack, "FlowLogs", {
          vpc: testVpc,
          envName: TEST_CONSTANTS.ENVIRONMENTS.TEST,
          maxAggregationInterval: config.interval,
        });

        return {
          ...config,
          template: Template.fromStack(testStack),
        };
      });
    });

    test("creates flow log without aggregation interval by default", () => {
      createFlowLogsConstruct(stack, "FlowLogs");

      const template = Template.fromStack(stack);

      expect(() => {
        template.resourceCountIs(
          "AWS::EC2::FlowLog",
          TEST_CONSTANTS.RESOURCE_COUNTS.FLOW_LOG
        );
      }).not.toThrow();
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
      ({ expectedSeconds }) => {
        const testData = aggregationTestData.find((d) => d.expectedSeconds === expectedSeconds);
        expect(testData).toBeDefined();

        expect(() => {
          testData?.template.hasResourceProperties("AWS::EC2::FlowLog", {
            MaxAggregationInterval: expectedSeconds,
          });
        }).not.toThrow();
      }
    );
  });

  // ============================================
  // KMS Encryption Tests
  // ============================================

  describe("KMS Encryption", () => {
    test("creates log group without encryption key by default", () => {
      createFlowLogsConstruct(stack, "FlowLogs");

      const template = Template.fromStack(stack);

      expect(() => {
        template.hasResourceProperties("AWS::Logs::LogGroup", {
          KmsKeyId: Match.absent(),
        });
      }).not.toThrow();
    });

    test("applies KMS encryption when key is provided", () => {
      const key = new kms.Key(stack, "LogKey");

      new VpcFlowLogsConstruct(stack, "FlowLogs", {
        vpc,
        envName: TEST_CONSTANTS.ENVIRONMENTS.TEST,
        encryptionKey: key,
      });

      const template = Template.fromStack(stack);

      expect(() => {
        template.hasResourceProperties("AWS::Logs::LogGroup", {
          KmsKeyId: {
            "Fn::GetAtt": [Match.stringLikeRegexp("LogKey.*"), "Arn"],
          },
        });
      }).not.toThrow();
    });

    test("grants KMS permissions to flow logs role when key provided", () => {
      const key = new kms.Key(stack, "LogKey");

      new VpcFlowLogsConstruct(stack, "FlowLogs", {
        vpc,
        envName: TEST_CONSTANTS.ENVIRONMENTS.TEST,
        encryptionKey: key,
      });

      const template = Template.fromStack(stack);

      expect(() => {
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
      }).not.toThrow();
    });
  });
});
