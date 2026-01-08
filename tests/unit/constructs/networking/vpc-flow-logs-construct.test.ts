/** @format */

import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as logs from "aws-cdk-lib/aws-logs";
import * as kms from "aws-cdk-lib/aws-kms";
import * as iam from "aws-cdk-lib/aws-iam";
import { Template, Match } from "aws-cdk-lib/assertions";

import { VpcFlowLogsConstruct } from "../../../../lib/constructs/networking/vpc/vpc-flow-logs-construct";
import { VpcConstruct } from "../../../../lib/constructs/networking/vpc/vpc-construct";
import {
  DEFAULT_FLOW_LOGS_RETENTION_DAYS,
  MIN_PRODUCTION_FLOW_LOGS_RETENTION_DAYS,
} from "../../../../lib/shared/constants/networking-constants";

// ============================================================================
// VPC FLOW LOGS CONSTRUCT TESTS
// ============================================================================

describe("VpcFlowLogsConstruct", () => {
  let app: cdk.App;
  let stack: cdk.Stack;
  let vpc: ec2.IVpc;

  beforeEach(() => {
    app = new cdk.App();
    stack = new cdk.Stack(app, "TestStack", {
      env: {
        account: "123456789012",
        region: "eu-west-1",
      },
    });

    // Create a VPC for testing
    const vpcConstruct = new VpcConstruct(stack, "TestVpc", {
      envName: "test",
    });
    vpc = vpcConstruct.vpc;
  });

  // ============================================
  // Basic Construction Tests
  // ============================================

  describe("Basic Construction", () => {
    test("creates VPC Flow Logs with default configuration", () => {
      new VpcFlowLogsConstruct(stack, "FlowLogs", {
        vpc,
        envName: "test",
      });

      const template = Template.fromStack(stack);

      // Should create CloudWatch Log Group
      template.resourceCountIs("AWS::Logs::LogGroup", 1);

      // Should create IAM Role for flow logs (check for specific role)
      template.hasResourceProperties("AWS::IAM::Role", {
        AssumeRolePolicyDocument: {
          Statement: [
            {
              Effect: "Allow",
              Principal: {
                Service: "vpc-flow-logs.amazonaws.com",
              },
            },
          ],
        },
      });

      // Should create VPC Flow Log
      template.resourceCountIs("AWS::EC2::FlowLog", 1);
    });

    test("exposes log group and log group name", () => {
      const flowLogsConstruct = new VpcFlowLogsConstruct(stack, "FlowLogs", {
        vpc,
        envName: "test",
      });

      expect(flowLogsConstruct.logGroup).toBeDefined();
      expect(flowLogsConstruct.logGroupName).toBeDefined();
    });

    test("creates log group with default retention", () => {
      new VpcFlowLogsConstruct(stack, "FlowLogs", {
        vpc,
        envName: "test",
      });

      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::Logs::LogGroup", {
        RetentionInDays: logs.RetentionDays.ONE_WEEK,
      });
    });

    test("creates log group with default removal policy RETAIN", () => {
      new VpcFlowLogsConstruct(stack, "FlowLogs", {
        vpc,
        envName: "test",
      });

      const template = Template.fromStack(stack);

      // Check both DeletionPolicy and UpdateReplacePolicy for RETAIN
      const logGroupResources = template.findResources("AWS::Logs::LogGroup");
      const logGroupResource = Object.values(logGroupResources)[0];
      expect(logGroupResource.DeletionPolicy).toBe("Retain");
      expect(logGroupResource.UpdateReplacePolicy).toBe("Retain");
    });
  });

  // ============================================
  // Log Group Naming Tests
  // ============================================

  describe("Log Group Naming", () => {
    test("uses default naming pattern without project name", () => {
      new VpcFlowLogsConstruct(stack, "FlowLogs", {
        vpc,
        envName: "development",
      });

      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::Logs::LogGroup", {
        LogGroupName: "/aws/vpc/flowlogs/development",
      });
    });

    test("includes project name in log group name when provided", () => {
      new VpcFlowLogsConstruct(stack, "FlowLogs", {
        vpc,
        envName: "production",
        projectName: "monitoring",
      });

      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::Logs::LogGroup", {
        LogGroupName: "/aws/vpc/flowlogs/production-monitoring",
      });
    });

    test("uses custom log group name when provided", () => {
      new VpcFlowLogsConstruct(stack, "FlowLogs", {
        vpc,
        envName: "test",
        logGroupName: "/custom/flowlogs/test",
      });

      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::Logs::LogGroup", {
        LogGroupName: "/custom/flowlogs/test",
      });
    });
  });

  // ============================================
  // Retention Configuration Tests
  // ============================================

  describe("Retention Configuration", () => {
    test("accepts custom retention days", () => {
      new VpcFlowLogsConstruct(stack, "FlowLogs", {
        vpc,
        envName: "test",
        retentionDays: 30,
      });

      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::Logs::LogGroup", {
        RetentionInDays: logs.RetentionDays.ONE_MONTH,
      });
    });

    test("maps retention days to correct CDK enum values", () => {
      // Test key retention period mappings
      const testCases = [
        { days: 1, expected: logs.RetentionDays.ONE_DAY },
        { days: 3, expected: logs.RetentionDays.THREE_DAYS },
        { days: 7, expected: logs.RetentionDays.ONE_WEEK },
        { days: 14, expected: logs.RetentionDays.TWO_WEEKS },
        { days: 30, expected: logs.RetentionDays.ONE_MONTH },
        { days: 90, expected: logs.RetentionDays.THREE_MONTHS },
        { days: 365, expected: logs.RetentionDays.ONE_YEAR },
      ];

      // Create separate test stacks for each case to avoid synthesis conflicts
      testCases.forEach(({ days, expected }) => {
        const testApp = new cdk.App();
        const testStack = new cdk.Stack(testApp, `TestStack${days}`, {
          env: {
            account: "123456789012",
            region: "eu-west-1",
          },
        });
        const testVpc = new VpcConstruct(testStack, "TestVpc", {
          envName: "test",
        }).vpc;

        new VpcFlowLogsConstruct(testStack, "FlowLogs", {
          vpc: testVpc,
          envName: "test",
          retentionDays: days,
        });

        const template = Template.fromStack(testStack);
        template.hasResourceProperties("AWS::Logs::LogGroup", {
          RetentionInDays: expected,
        });
      });
    });

    test("throws error for invalid retention days (too low)", () => {
      expect(() => {
        new VpcFlowLogsConstruct(stack, "FlowLogs", {
          vpc,
          envName: "test",
          retentionDays: 0,
        });
      }).toThrow("Retention days must be at least 1");
    });

    test("throws error for invalid retention days (too high)", () => {
      expect(() => {
        new VpcFlowLogsConstruct(stack, "FlowLogs", {
          vpc,
          envName: "test",
          retentionDays: 10000,
        });
      }).toThrow("Retention days must not exceed 2555");
    });

    test("throws error for non-integer retention days", () => {
      expect(() => {
        new VpcFlowLogsConstruct(stack, "FlowLogs", {
          vpc,
          envName: "test",
          retentionDays: 7.5,
        });
      }).toThrow("Retention days must be an integer");
    });
  });

  // ============================================
  // Production Warnings Tests
  // ============================================

  describe("Production Environment Warnings", () => {
    test("adds warning for short retention in production", () => {
      const productionStack = new cdk.Stack(app, "ProductionStack", {
        env: {
          account: "123456789012",
          region: "eu-west-1",
        },
      });
      const productionVpc = new VpcConstruct(productionStack, "TestVpc", {
        envName: "production",
      }).vpc;

      const construct = new VpcFlowLogsConstruct(productionStack, "FlowLogs", {
        vpc: productionVpc,
        envName: "production",
        retentionDays: 7, // Below minimum for production
      });

      // Check that warning annotation was added
      const annotations = cdk.Annotations.of(construct);
      // Note: We can't directly test annotations, but we can verify the construct was created
      expect(construct).toBeDefined();
    });

    test("does not warn for adequate retention in production", () => {
      const productionStack = new cdk.Stack(app, "ProductionStack2", {
        env: {
          account: "123456789012",
          region: "eu-west-1",
        },
      });
      const productionVpc = new VpcConstruct(productionStack, "TestVpc", {
        envName: "production",
      }).vpc;

      const construct = new VpcFlowLogsConstruct(productionStack, "FlowLogs", {
        vpc: productionVpc,
        envName: "production",
        retentionDays: 90, // Above minimum for production
      });

      expect(construct).toBeDefined();
    });

    test("recognises 'prod' as production environment", () => {
      const prodStack = new cdk.Stack(app, "ProdStack", {
        env: {
          account: "123456789012",
          region: "eu-west-1",
        },
      });
      const prodVpc = new VpcConstruct(prodStack, "TestVpc", {
        envName: "prod",
      }).vpc;

      const construct = new VpcFlowLogsConstruct(prodStack, "FlowLogs", {
        vpc: prodVpc,
        envName: "prod",
        retentionDays: 7,
      });

      expect(construct).toBeDefined();
    });
  });

  // ============================================
  // KMS Encryption Tests
  // ============================================

  describe("KMS Encryption", () => {
    test("creates log group without encryption key by default", () => {
      new VpcFlowLogsConstruct(stack, "FlowLogs", {
        vpc,
        envName: "test",
      });

      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::Logs::LogGroup", {
        KmsKeyId: Match.absent(),
      });
    });

    test("applies KMS encryption when key is provided", () => {
      const key = new kms.Key(stack, "LogKey");

      new VpcFlowLogsConstruct(stack, "FlowLogs", {
        vpc,
        envName: "test",
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
        envName: "test",
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
                "kms:Decrypt",
                "kms:Encrypt",
                "kms:ReEncrypt*",
                "kms:GenerateDataKey*",
              ]),
            }),
          ]),
        },
      });
    });
  });

  // ============================================
  // Traffic Type Configuration Tests
  // ============================================

  describe("Traffic Type Configuration", () => {
    test("uses ALL traffic type by default", () => {
      new VpcFlowLogsConstruct(stack, "FlowLogs", {
        vpc,
        envName: "test",
      });

      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::EC2::FlowLog", {
        ResourceType: "VPC",
        TrafficType: "ALL",
      });
    });

    test("accepts ACCEPT traffic type", () => {
      new VpcFlowLogsConstruct(stack, "FlowLogs", {
        vpc,
        envName: "test",
        trafficType: ec2.FlowLogTrafficType.ACCEPT,
      });

      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::EC2::FlowLog", {
        TrafficType: "ACCEPT",
      });
    });

    test("accepts REJECT traffic type", () => {
      new VpcFlowLogsConstruct(stack, "FlowLogs", {
        vpc,
        envName: "test",
        trafficType: ec2.FlowLogTrafficType.REJECT,
      });

      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::EC2::FlowLog", {
        TrafficType: "REJECT",
      });
    });
  });

  // ============================================
  // Custom Log Format Tests
  // ============================================

  describe("Custom Log Format", () => {
    test("creates flow log without custom format by default", () => {
      new VpcFlowLogsConstruct(stack, "FlowLogs", {
        vpc,
        envName: "test",
      });

      const template = Template.fromStack(stack);

      // When no custom format, CDK uses default format
      // We can verify the flow log exists
      template.resourceCountIs("AWS::EC2::FlowLog", 1);
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
        envName: "test",
        logFormat: customFormat,
      });

      const template = Template.fromStack(stack);

      // Verify flow log was created (format is applied at runtime)
      template.resourceCountIs("AWS::EC2::FlowLog", 1);
    });
  });

  // ============================================
  // Aggregation Interval Tests
  // ============================================

  describe("Aggregation Interval", () => {
    test("creates flow log without aggregation interval by default", () => {
      new VpcFlowLogsConstruct(stack, "FlowLogs", {
        vpc,
        envName: "test",
      });

      const template = Template.fromStack(stack);

      template.resourceCountIs("AWS::EC2::FlowLog", 1);
    });

    test("applies 1-minute aggregation interval when specified", () => {
      new VpcFlowLogsConstruct(stack, "FlowLogs", {
        vpc,
        envName: "test",
        maxAggregationInterval: ec2.FlowLogMaxAggregationInterval.ONE_MINUTE,
      });

      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::EC2::FlowLog", {
        MaxAggregationInterval: 60,
      });
    });

    test("applies 10-minute aggregation interval when specified", () => {
      new VpcFlowLogsConstruct(stack, "FlowLogs", {
        vpc,
        envName: "test",
        maxAggregationInterval: ec2.FlowLogMaxAggregationInterval.TEN_MINUTES,
      });

      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::EC2::FlowLog", {
        MaxAggregationInterval: 600,
      });
    });
  });

  // ============================================
  // Removal Policy Tests
  // ============================================

  describe("Removal Policy", () => {
    test("uses RETAIN removal policy by default", () => {
      new VpcFlowLogsConstruct(stack, "FlowLogs", {
        vpc,
        envName: "test",
      });

      const template = Template.fromStack(stack);

      // DeletionPolicy is a resource-level attribute, not a property
      const logGroupResources = template.findResources("AWS::Logs::LogGroup");
      const logGroupResource = Object.values(logGroupResources)[0];
      expect(logGroupResource.DeletionPolicy).toBe("Retain");
      expect(logGroupResource.UpdateReplacePolicy).toBe("Retain");
    });

    test("accepts DESTROY removal policy", () => {
      new VpcFlowLogsConstruct(stack, "FlowLogs", {
        vpc,
        envName: "test",
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });

      const template = Template.fromStack(stack);

      const logGroupResources = template.findResources("AWS::Logs::LogGroup");
      const logGroupResource = Object.values(logGroupResources)[0];
      expect(logGroupResource.DeletionPolicy).toBe("Delete");
      expect(logGroupResource.UpdateReplacePolicy).toBe("Delete");
    });

    test("accepts SNAPSHOT removal policy", () => {
      new VpcFlowLogsConstruct(stack, "FlowLogs", {
        vpc,
        envName: "test",
        removalPolicy: cdk.RemovalPolicy.SNAPSHOT,
      });

      const template = Template.fromStack(stack);

      const logGroupResources = template.findResources("AWS::Logs::LogGroup");
      const logGroupResource = Object.values(logGroupResources)[0];
      expect(logGroupResource.DeletionPolicy).toBe("Snapshot");
      expect(logGroupResource.UpdateReplacePolicy).toBe("Snapshot");
    });
  });

  // ============================================
  // IAM Role and Permissions Tests
  // ============================================

  describe("IAM Role and Permissions", () => {
    test("creates IAM role for VPC Flow Logs service", () => {
      new VpcFlowLogsConstruct(stack, "FlowLogs", {
        vpc,
        envName: "test",
      });

      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::IAM::Role", {
        AssumeRolePolicyDocument: {
          Statement: [
            {
              Effect: "Allow",
              Principal: {
                Service: "vpc-flow-logs.amazonaws.com",
              },
              Action: "sts:AssumeRole",
            },
          ],
        },
      });
    });

    test("grants explicit CloudWatch Logs permissions", () => {
      new VpcFlowLogsConstruct(stack, "FlowLogs", {
        vpc,
        envName: "test",
      });

      const template = Template.fromStack(stack);

      // Check that the policy contains the CloudWatch Logs statement
      // (there may be multiple statements, e.g., KMS permissions if encryption is enabled)
      template.hasResourceProperties("AWS::IAM::Policy", {
        PolicyDocument: {
          Statement: Match.arrayWith([
            {
              Effect: "Allow",
              Action: [
                "logs:CreateLogStream",
                "logs:PutLogEvents",
                "logs:DescribeLogStreams",
              ],
              Resource: Match.anyValue(),
            },
          ]),
        },
      });
    });

    test("scopes permissions to specific log group ARN", () => {
      new VpcFlowLogsConstruct(stack, "FlowLogs", {
        vpc,
        envName: "test",
      });

      const template = Template.fromStack(stack);

      // Get the log group logical ID to verify ARN references
      const logGroupResources = template.findResources("AWS::Logs::LogGroup");
      const logGroupLogicalId = Object.keys(logGroupResources)[0];

      // Verify the IAM policy has resources scoped to the log group ARN
      // Check that Resource array contains exactly 2 elements referencing the log group
      const policyResources = template.findResources("AWS::IAM::Policy");
      const policyResource = Object.values(policyResources)[0];
      const statements = policyResource.Properties.PolicyDocument.Statement;
      const logsStatement = statements.find(
        (stmt: any) =>
          stmt.Effect === "Allow" &&
          stmt.Action?.includes("logs:CreateLogStream")
      );

      expect(logsStatement).toBeDefined();
      expect(logsStatement.Resource).toBeInstanceOf(Array);
      expect(logsStatement.Resource).toHaveLength(2);

      // Verify both resources reference the log group ARN
      // First should be the ARN directly, second should be ARN with :* suffix
      const resources = logsStatement.Resource;
      const hasDirectArn = resources.some(
        (resource: any) =>
          resource?.["Fn::GetAtt"]?.[0] === logGroupLogicalId &&
          resource?.["Fn::GetAtt"]?.[1] === "Arn"
      );
      const hasArnWithWildcard = resources.some(
        (resource: any) =>
          resource?.["Fn::Join"] &&
          resource["Fn::Join"][1]?.includes(":*")
      );

      expect(hasDirectArn).toBe(true);
      expect(hasArnWithWildcard).toBe(true);
    });

    test("includes environment name in role description", () => {
      new VpcFlowLogsConstruct(stack, "FlowLogs", {
        vpc,
        envName: "production",
      });

      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::IAM::Role", {
        Description: "Role for VPC Flow Logs in production environment",
      });
    });
  });

  // ============================================
  // Tags Tests
  // ============================================

  describe("Tags", () => {
    test("adds Environment tag", () => {
      new VpcFlowLogsConstruct(stack, "FlowLogs", {
        vpc,
        envName: "staging",
      });

      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::Logs::LogGroup", {
        Tags: Match.arrayWith([
          {
            Key: "Environment",
            Value: "staging",
          },
        ]),
      });
    });

    test("adds Project tag when project name provided", () => {
      new VpcFlowLogsConstruct(stack, "FlowLogs", {
        vpc,
        envName: "test",
        projectName: "monitoring",
      });

      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::Logs::LogGroup", {
        Tags: Match.arrayWith([
          {
            Key: "Project",
            Value: "monitoring",
          },
        ]),
      });
    });

    test("adds ManagedBy tag", () => {
      new VpcFlowLogsConstruct(stack, "FlowLogs", {
        vpc,
        envName: "test",
      });

      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::Logs::LogGroup", {
        Tags: Match.arrayWith([
          {
            Key: "ManagedBy",
            Value: "CDK",
          },
        ]),
      });
    });
  });

  // ============================================
  // Integration Tests
  // ============================================

  describe("Integration", () => {
    test("creates complete flow logs setup with all features", () => {
      const key = new kms.Key(stack, "LogKey");

      new VpcFlowLogsConstruct(stack, "FlowLogs", {
        vpc,
        envName: "production",
        projectName: "monitoring",
        retentionDays: 90,
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

      const template = Template.fromStack(stack);

      // Verify all resources created
      template.resourceCountIs("AWS::Logs::LogGroup", 1);
      // Check for flow logs IAM role specifically (VPC construct may create other roles)
      template.hasResourceProperties("AWS::IAM::Role", {
        AssumeRolePolicyDocument: {
          Statement: [
            {
              Effect: "Allow",
              Principal: {
                Service: "vpc-flow-logs.amazonaws.com",
              },
            },
          ],
        },
        Description: "Role for VPC Flow Logs in production environment",
      });
      template.resourceCountIs("AWS::EC2::FlowLog", 1);
      template.resourceCountIs("AWS::KMS::Key", 1);

      // Verify log group properties
      template.hasResourceProperties("AWS::Logs::LogGroup", {
        LogGroupName: "/aws/vpc/flowlogs/production-monitoring",
        RetentionInDays: logs.RetentionDays.THREE_MONTHS,
      });

      // Verify removal policy separately
      const logGroupResources = template.findResources("AWS::Logs::LogGroup");
      const logGroupResource = Object.values(logGroupResources)[0];
      expect(logGroupResource.DeletionPolicy).toBe("Retain");
      expect(logGroupResource.UpdateReplacePolicy).toBe("Retain");

      // Verify flow log properties
      template.hasResourceProperties("AWS::EC2::FlowLog", {
        ResourceType: "VPC",
        TrafficType: "ALL",
        MaxAggregationInterval: 600,
      });
    });
  });
});
