/** @format */
/// <reference types="jest" />

/**
 * MonitoringInfraStack Security Configuration Tests
 *
 * Tests IAM permissions, encryption, security groups, and IMDSv2 enforcement.
 */

import { Template, Match } from "aws-cdk-lib/assertions";

import { DEFAULT_ASG_BLOCK_DEVICE_SIZE_GB } from "../../../../../lib/shared/constants/compute-constants";
import {
  createTestApp,
  extendExpectWithCdkMatchers,
} from "../../../utils/stack-test-utils";

import { createTestStack } from "./shared-fixtures";

// ============================================================================
// CUSTOM MATCHERS SETUP
// ============================================================================

extendExpectWithCdkMatchers();

// ============================================================================
// TESTS
// ============================================================================

describe("MonitoringInfraStack - Security Configuration", () => {
  // ==========================================================================
  // Security Groups
  // ==========================================================================

  describe("Security Groups", () => {
    let allowedIpTemplate: Template;
    let defaultTemplate: Template;

    beforeAll(() => {
      const app = createTestApp();

      // Create stacks before templates
      const allowedIpStack = createTestStack(app, "SecurityGroups-AllowedIp", {
        allowedIpRanges: ["10.0.0.0/8", "192.168.0.0/16"],
      });
      const defaultStack = createTestStack(app, "SecurityGroups-Default");

      // Now create templates
      allowedIpTemplate = Template.fromStack(allowedIpStack);
      defaultTemplate = Template.fromStack(defaultStack);
    });

    test("ALB security group is configured with allowed IP ranges", () => {
      const securityGroups = allowedIpTemplate.findResources(
        "AWS::EC2::SecurityGroup"
      );
      const sgStr = JSON.stringify(securityGroups);
      expect(sgStr).toContain("load balancer");
    });

    test("creates security groups with proper configuration", () => {
      const securityGroups = defaultTemplate.findResources(
        "AWS::EC2::SecurityGroup"
      );
      expect(Object.keys(securityGroups).length).toBeGreaterThanOrEqual(2);

      const sgIngress = defaultTemplate.findResources(
        "AWS::EC2::SecurityGroupIngress"
      );
      expect(Object.keys(sgIngress).length).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // IAM Permissions
  // ==========================================================================

  describe("IAM Permissions", () => {
    let template: Template;
    let metadataTemplate: Template;
    let policies: Record<string, unknown>;
    let metadataPolicies: Record<string, unknown>;

    beforeAll(() => {
      const app = createTestApp();

      // Create all stacks first
      const stack = createTestStack(app, "IAMPermissions-Default");
      const metadataStack = createTestStack(app, "IAMPermissions-Metadata", {
        enableMetadataTracking: true,
      });

      // Then create templates
      template = Template.fromStack(stack);
      metadataTemplate = Template.fromStack(metadataStack);

      // Pre-compute policies
      policies = template.findResources("AWS::IAM::Policy");
      metadataPolicies = metadataTemplate.findResources("AWS::IAM::Policy");
    });

    test("launch template role has ECS managed policy", () => {
      expect(() => {
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
      }).not.toThrow();
    });

    test("launch template role has EFS permissions", () => {
      expect(() => {
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
      }).not.toThrow();
    });

    test("launch template role has SSM read permissions", () => {
      expect(() => {
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
      }).not.toThrow();
    });

    test("launch template role has SSM write permissions when metadata tracking enabled", () => {
      const policyStr = JSON.stringify(metadataPolicies);
      expect(policyStr).toContain("ssm:PutParameter");
      expect(policyStr).toContain("ssm:AddTagsToResource");
      expect(policyStr).toContain("bootstrap");
    });

    test("launch template role has CloudWatch Logs permissions", () => {
      const policyStr = JSON.stringify(policies);
      expect(policyStr).toContain("logs:CreateLogStream");
      expect(policyStr).toContain("logs:PutLogEvents");
      expect(policyStr).toContain("log-group:/ecs/");
    });
  });

  // ==========================================================================
  // SSM Write Permissions When Disabled
  // ==========================================================================

  describe("SSM Write Permissions When Disabled", () => {
    let hasSsmWritePermission: boolean;

    beforeAll(() => {
      const testApp = createTestApp();
      const stack = createTestStack(testApp, "SsmWriteDisabledStack", {
        enableMetadataTracking: false,
      });
      const template = Template.fromStack(stack);
      const policies = template.findResources("AWS::IAM::Policy");

      // Pre-compute the conditional check in beforeAll
      hasSsmWritePermission = Object.values(policies).some((policy: any) => {
        const statements =
          policy.Properties?.PolicyDocument?.Statement || [];
        return statements.some(
          (stmt: any) =>
            stmt.Action?.includes("ssm:PutParameter") &&
            stmt.Resource?.some?.((r: any) =>
              JSON.stringify(r).includes("bootstrap")
            )
        );
      });
    });

    test("does not add SSM write permissions when metadata tracking disabled", () => {
      expect(hasSsmWritePermission).toBe(false);
    });
  });

  // ==========================================================================
  // Encryption
  // ==========================================================================

  describe("Encryption", () => {
    let template: Template;

    beforeAll(() => {
      const app = createTestApp();
      const stack = createTestStack(app, "Encryption-Test");
      template = Template.fromStack(stack);
    });

    test("EBS volumes are encrypted", () => {
      expect(() => {
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
      }).not.toThrow();
    });

    test("EBS volume size matches constant", () => {
      expect(() => {
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
      }).not.toThrow();
    });
  });

  // ==========================================================================
  // IMDSv2 Enforcement
  // ==========================================================================

  describe("IMDSv2 Enforcement", () => {
    let template: Template;

    beforeAll(() => {
      const app = createTestApp();
      const stack = createTestStack(app, "IMDSv2-Test");
      template = Template.fromStack(stack);
    });

    test("launch template enforces IMDSv2", () => {
      expect(() => {
        template.hasResourceProperties("AWS::EC2::LaunchTemplate", {
          LaunchTemplateData: {
            MetadataOptions: {
              HttpTokens: "required",
            },
          },
        });
      }).not.toThrow();
    });
  });
});
