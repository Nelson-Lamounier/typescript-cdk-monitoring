/** @format */

/**
 * Security Tests for IAM Policy Improvements
 *
 * These tests validate the fixes for Checkov security findings:
 * - CKV_AWS_107: Credentials exposure prevention
 * - CKV_AWS_108: Data exfiltration risk mitigation
 * - CKV_AWS_111: Write access constraints
 */

import { App, Stack } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { EcsTaskExecutionRole } from "../../../lib/constructs/iam/ecs-task-execution-role";
import { Ec2InstanceRole } from "../../../lib/constructs/iam/ec2-instance-role";
import * as logs from "aws-cdk-lib/aws-logs";

describe("CKV_AWS_107: Credentials Exposure Prevention", () => {
  describe("EcsTaskExecutionRole - Secrets Manager Access", () => {
    test("should NOT grant wildcard Secrets Manager access when no secretArns provided", () => {
      // Arrange
      const app = new App();
      const stack = new Stack(app, "TestStack", {
        env: { account: "123456789012", region: "eu-west-1" },
      });

      // Act
      new EcsTaskExecutionRole(stack, "ExecutionRole", {
        envName: "test",
        enablePublicEcr: false,
      });

      const template = Template.fromStack(stack);

      // Assert - Should NOT have wildcard Secrets Manager permissions
      const policies = template.findResources("AWS::IAM::Policy");
      const policyDocuments = Object.values(policies).map(
        (policy: any) => policy.Properties.PolicyDocument
      );

      // Check that no policy grants wildcard access to secretsmanager
      policyDocuments.forEach((doc: any) => {
        doc.Statement.forEach((statement: any) => {
          if (
            statement.Action?.includes("secretsmanager:GetSecretValue") ||
            (Array.isArray(statement.Action) &&
              statement.Action.some((a: string) =>
                a.includes("secretsmanager")
              ))
          ) {
            // Should not have wildcard resources
            expect(statement.Resource).not.toContain("*");
            expect(statement.Resource).not.toMatch(/secret:\*/);
          }
        });
      });
    });

    test("should grant access ONLY to specified secrets when secretArns provided", () => {
      // Arrange
      const app = new App();
      const stack = new Stack(app, "TestStack", {
        env: { account: "123456789012", region: "eu-west-1" },
      });

      const secretArns = [
        "arn:aws:secretsmanager:eu-west-1:123456789012:secret:prod/api/key-XXXXX",
        "arn:aws:secretsmanager:eu-west-1:123456789012:secret:prod/db/password-YYYYY",
      ];

      // Act
      new EcsTaskExecutionRole(stack, "ExecutionRole", {
        envName: "production",
        enablePublicEcr: false,
        secretArns,
      });

      const template = Template.fromStack(stack);

      // Assert - Should have exactly the specified secrets
      const policies = template.findResources("AWS::IAM::Policy");
      let foundSecretsStatement = false;

      Object.values(policies).forEach((policy: any) => {
        policy.Properties.PolicyDocument.Statement.forEach(
          (statement: any) => {
            if (statement.Action?.includes("secretsmanager:GetSecretValue")) {
              foundSecretsStatement = true;
              expect(statement.Resource).toEqual(secretArns);
              // Should have AWSCURRENT condition
              expect(statement.Condition).toHaveProperty("StringEquals");
              expect(
                statement.Condition.StringEquals["secretsmanager:VersionStage"]
              ).toBe("AWSCURRENT");
            }
          }
        );
      });

      expect(foundSecretsStatement).toBe(true);
    });

    test("should show warning annotation when no secretArns provided", () => {
      // Arrange
      const app = new App();
      const stack = new Stack(app, "TestStack", {
        env: { account: "123456789012", region: "eu-west-1" },
      });

      // Act
      const roleConstruct = new EcsTaskExecutionRole(stack, "ExecutionRole", {
        envName: "test",
        enablePublicEcr: false,
      });

      // Assert - Should have warning annotation
      const annotations = roleConstruct.node.metadata.filter(
        (m) => m.type === "aws:cdk:warning"
      );
      expect(annotations.length).toBeGreaterThan(0);
      expect(annotations[0].data).toContain("No secret ARNs specified");
    });
  });
});

describe("CKV_AWS_108: Data Exfiltration Risk Mitigation", () => {
  describe("Ec2InstanceRole - Least Privilege Policies", () => {
    test("should NOT use AWS managed policies", () => {
      // Arrange
      const app = new App();
      const stack = new Stack(app, "TestStack", {
        env: { account: "123456789012", region: "eu-west-1" },
      });

      // Act
      new Ec2InstanceRole(stack, "InstanceRole", {
        envName: "test",
        attachEcsInstancePolicy: true,
      });

      const template = Template.fromStack(stack);

      // Assert - Should NOT have managed policy attachments
      const roles = template.findResources("AWS::IAM::Role");
      Object.values(roles).forEach((role: any) => {
        expect(role.Properties.ManagedPolicyArns).toBeUndefined();
      });
    });

    test("should scope SSM permissions to specific parameter paths", () => {
      // Arrange
      const app = new App();
      const stack = new Stack(app, "TestStack", {
        env: { account: "123456789012", region: "eu-west-1" },
      });

      // Act
      new Ec2InstanceRole(stack, "InstanceRole", {
        envName: "production",
        attachEcsInstancePolicy: false,
      });

      const template = Template.fromStack(stack);

      // Assert - SSM Parameter Store access should be scoped
      const policies = template.findResources("AWS::IAM::Policy");
      let foundSsmParameterAccess = false;

      Object.values(policies).forEach((policy: any) => {
        policy.Properties.PolicyDocument.Statement.forEach(
          (statement: any) => {
            if (
              statement.Action?.includes("ssm:GetParameter") ||
              (Array.isArray(statement.Action) &&
                statement.Action.some((a: string) =>
                  a.startsWith("ssm:GetParameter")
                ))
            ) {
              foundSsmParameterAccess = true;
              // Should be scoped to /monitoring/* or /{stackName}/*
              expect(statement.Resource).toBeDefined();
              expect(Array.isArray(statement.Resource)).toBe(true);
              statement.Resource.forEach((resource: any) => {
                expect(resource).toMatch(/parameter\/(monitoring|TestStack)\//);
              });
            }
          }
        );
      });

      expect(foundSsmParameterAccess).toBe(true);
    });

    test("should scope ECR permissions to account and region only", () => {
      // Arrange
      const app = new App();
      const stack = new Stack(app, "TestStack", {
        env: { account: "123456789012", region: "eu-west-1" },
      });

      // Act
      new Ec2InstanceRole(stack, "InstanceRole", {
        envName: "test",
        attachEcsInstancePolicy: true,
      });

      const template = Template.fromStack(stack);

      // Assert - ECR permissions should be scoped to account
      const policies = template.findResources("AWS::IAM::Policy");
      let foundEcrAccess = false;

      Object.values(policies).forEach((policy: any) => {
        policy.Properties.PolicyDocument.Statement.forEach(
          (statement: any) => {
            if (
              statement.Action?.includes("ecr:BatchGetImage") ||
              (Array.isArray(statement.Action) &&
                statement.Action.some((a: string) => a.includes("ecr:Batch")))
            ) {
              foundEcrAccess = true;
              // Should be scoped to account/region
              statement.Resource.forEach((resource: any) => {
                if (
                  typeof resource === "string" &&
                  resource.includes("repository")
                ) {
                  expect(resource).toMatch(/arn:aws:ecr:eu-west-1:123456789012:/);
                }
              });
            }
          }
        );
      });

      expect(foundEcrAccess).toBe(true);
    });

    test("should add aws:RequestedRegion condition to prevent cross-region access", () => {
      // Arrange
      const app = new App();
      const stack = new Stack(app, "TestStack", {
        env: { account: "123456789012", region: "eu-west-1" },
      });

      // Act
      new Ec2InstanceRole(stack, "InstanceRole", {
        envName: "test",
        attachEcsInstancePolicy: true,
      });

      const template = Template.fromStack(stack);

      // Assert - Should have region conditions
      const policies = template.findResources("AWS::IAM::Policy");
      let foundRegionCondition = false;

      Object.values(policies).forEach((policy: any) => {
        policy.Properties.PolicyDocument.Statement.forEach(
          (statement: any) => {
            if (statement.Condition?.StringEquals?.["aws:RequestedRegion"]) {
              foundRegionCondition = true;
              expect(
                statement.Condition.StringEquals["aws:RequestedRegion"]
              ).toBe("eu-west-1");
            }
          }
        );
      });

      expect(foundRegionCondition).toBe(true);
    });
  });
});

describe("CKV_AWS_111: Write Access Constraints", () => {
  describe("CloudWatch Logs Write Permissions", () => {
    test("should scope log write permissions to environment-specific log groups", () => {
      // Arrange
      const app = new App();
      const stack = new Stack(app, "TestStack", {
        env: { account: "123456789012", region: "eu-west-1" },
      });

      const logGroup = new logs.LogGroup(stack, "LogGroup", {
        logGroupName: "/ecs/production-app",
      });

      // Act
      new EcsTaskExecutionRole(stack, "ExecutionRole", {
        envName: "production",
        logGroupArn: logGroup.logGroupArn,
      });

      const template = Template.fromStack(stack);

      // Assert - CloudWatch Logs write should be scoped
      const policies = template.findResources("AWS::IAM::Policy");
      let foundLogsWrite = false;

      Object.values(policies).forEach((policy: any) => {
        policy.Properties.PolicyDocument.Statement.forEach(
          (statement: any) => {
            if (statement.Action?.includes("logs:PutLogEvents")) {
              foundLogsWrite = true;
              // Should be scoped to specific log group
              expect(statement.Resource).toBeDefined();
              expect(statement.Resource).not.toContain(
                "arn:aws:logs:*:*:log-group:*"
              );
              // Should reference the specific log group
              statement.Resource.forEach((resource: any) => {
                if (typeof resource === "string") {
                  expect(resource).toMatch(/log-group:(\/ecs\/|<.*>)/);
                }
              });
            }
          }
        );
      });

      expect(foundLogsWrite).toBe(true);
    });

    test("should add cloudwatch:namespace condition to metric writes", () => {
      // Arrange
      const app = new App();
      const stack = new Stack(app, "TestStack", {
        env: { account: "123456789012", region: "eu-west-1" },
      });

      // Act
      new Ec2InstanceRole(stack, "InstanceRole", {
        envName: "production",
        attachEcsInstancePolicy: false,
      });

      const template = Template.fromStack(stack);

      // Assert - CloudWatch Metrics should have namespace condition
      const policies = template.findResources("AWS::IAM::Policy");
      let foundMetricsWrite = false;

      Object.values(policies).forEach((policy: any) => {
        policy.Properties.PolicyDocument.Statement.forEach(
          (statement: any) => {
            if (statement.Action?.includes("cloudwatch:PutMetricData")) {
              foundMetricsWrite = true;
              // Should have namespace condition
              expect(statement.Condition).toHaveProperty("StringEquals");
              expect(
                statement.Condition.StringEquals["cloudwatch:namespace"]
              ).toBeDefined();
              expect(
                Array.isArray(
                  statement.Condition.StringEquals["cloudwatch:namespace"]
                )
              ).toBe(true);
            }
          }
        );
      });

      expect(foundMetricsWrite).toBe(true);
    });
  });

  describe("ECR Write Prevention", () => {
    test("should NOT grant ECR push/put permissions", () => {
      // Arrange
      const app = new App();
      const stack = new Stack(app, "TestStack", {
        env: { account: "123456789012", region: "eu-west-1" },
      });

      // Act
      new Ec2InstanceRole(stack, "InstanceRole", {
        envName: "test",
        attachEcsInstancePolicy: true,
      });

      const template = Template.fromStack(stack);

      // Assert - Should not have ECR write permissions
      const policies = template.findResources("AWS::IAM::Policy");

      Object.values(policies).forEach((policy: any) => {
        policy.Properties.PolicyDocument.Statement.forEach(
          (statement: any) => {
            const actions = Array.isArray(statement.Action)
              ? statement.Action
              : [statement.Action];

            actions.forEach((action: string) => {
              if (action.startsWith("ecr:")) {
                // Should not have write actions
                expect(action).not.toMatch(/ecr:Put/);
                expect(action).not.toMatch(/ecr:Upload/);
                expect(action).not.toMatch(/ecr:InitiateLayerUpload/);
                expect(action).not.toMatch(/ecr:CompleteLayerUpload/);
              }
            });
          }
        );
      });
    });
  });
});

describe("Security Regression Tests", () => {
  test("execution role should still work without breaking existing functionality", () => {
    // Arrange
    const app = new App();
    const stack = new Stack(app, "TestStack", {
      env: { account: "123456789012", region: "eu-west-1" },
    });

    // Act - Create role like existing code does
    const roleConstruct = new EcsTaskExecutionRole(stack, "ExecutionRole", {
      envName: "test",
      enablePublicEcr: true,
    });

    // Assert - Should synthesize without errors
    expect(roleConstruct.role).toBeDefined();
    expect(roleConstruct.role.roleArn).toBeDefined();

    const template = Template.fromStack(stack);
    template.resourceCountIs("AWS::IAM::Role", 1);
    template.resourceCountIs("AWS::IAM::Policy", 1);
  });

  test("instance role should still work without breaking existing functionality", () => {
    // Arrange
    const app = new App();
    const stack = new Stack(app, "TestStack", {
      env: { account: "123456789012", region: "eu-west-1" },
    });

    // Act - Create role like existing code does
    const roleConstruct = new Ec2InstanceRole(stack, "InstanceRole", {
      envName: "test",
      attachEcsInstancePolicy: true,
    });

    // Assert - Should synthesize without errors
    expect(roleConstruct.role).toBeDefined();
    expect(roleConstruct.role.roleArn).toBeDefined();

    const template = Template.fromStack(stack);
    template.resourceCountIs("AWS::IAM::Role", 1);
    // Should have inline policies, not managed policies
    const roles = template.findResources("AWS::IAM::Role");
    Object.values(roles).forEach((role: any) => {
      expect(role.Properties.ManagedPolicyArns).toBeUndefined();
    });
  });
});
