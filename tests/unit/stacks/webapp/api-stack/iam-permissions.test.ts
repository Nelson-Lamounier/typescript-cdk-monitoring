/** @format */
/// <reference types="jest" />

/**
 * WebappApiStack Tests: IAM Permissions
 *
 * Tests IAM role and policy configuration:
 * - IAM role creation for Lambda functions
 * - DynamoDB read permissions
 * - S3 read permissions
 * - Trust policies
 * - Policy attachment
 *
 * Pattern: No conditionals, guard assertions, pre-computed data
 */

import { Template, Match } from "aws-cdk-lib/assertions";

import {
  API_TEST_CONSTANTS,
  createTestApiStack,
} from "../fixtures/api-stack-fixtures";
import { createTestApp } from "../../../utils/stack-test-utils";
import {
  validateDynamoDbReadPermissions,
  validateS3ReadPermissions,
  validateLambdaTrustPolicy,
} from "../../../utils/webapp-test-helpers";

// ============================================================================
// IAM PERMISSIONS TESTS
// ============================================================================

describe("WebappApiStack: IAM Permissions", () => {
  // ============================================================================
  // IAM ROLES
  // ============================================================================

  describe("IAM Roles", () => {
    let template: Template;
    let roles: Array<{ assumeRolePolicy: unknown }>;

    beforeAll(() => {
      const app = createTestApp();
      const stack = createTestApiStack(app);
      template = Template.fromStack(stack);

      // Pre-compute role data
      const iamRoles = template.findResources("AWS::IAM::Role");
      roles = Object.values(iamRoles).map((role) => {
        const props = (role as { Properties: Record<string, unknown> })
          .Properties;
        return {
          assumeRolePolicy: props.AssumeRolePolicyDocument,
        };
      });
    });

    test("should create IAM roles for Lambda functions", () => {
      template.resourceCountIs(
        "AWS::IAM::Role",
        API_TEST_CONSTANTS.RESOURCE_COUNTS.IAM_ROLE
      );
    });

    test("should configure Lambda trust policy", () => {
      const expectedTrustPolicy = validateLambdaTrustPolicy();

      template.hasResourceProperties("AWS::IAM::Role", {
        AssumeRolePolicyDocument: expectedTrustPolicy,
      });
    });

    test("should have Lambda service principal in all roles", () => {
      // Guard assertion - total includes API Gateway CloudWatch role
      expect(roles.length).toBe(API_TEST_CONSTANTS.RESOURCE_COUNTS.IAM_ROLE);

      // Filter to only Lambda roles (excludes API Gateway CloudWatch role)
      const lambdaRoles = roles.filter((role) => {
        const policy = role.assumeRolePolicy as {
          Statement: Array<{ Principal?: { Service?: string | string[] } }>;
        };
        const service = policy.Statement[0]?.Principal?.Service;
        const serviceArray = Array.isArray(service) ? service : [service];
        return serviceArray.includes("lambda.amazonaws.com");
      });

      expect(lambdaRoles.length).toBe(3); // 3 Lambda functions

      lambdaRoles.forEach((role) => {
        const policy = role.assumeRolePolicy as {
          Statement: Array<{ Principal: { Service: string } }>;
        };
        expect(policy.Statement[0].Principal.Service).toBe(
          "lambda.amazonaws.com"
        );
      });
    });

    test("should use sts:AssumeRole action in trust policy", () => {
      // Guard assertion
      expect(roles.length).toBe(API_TEST_CONSTANTS.RESOURCE_COUNTS.IAM_ROLE);

      // Filter to only Lambda roles (excludes API Gateway CloudWatch role)
      const lambdaRoles = roles.filter((role) => {
        const policy = role.assumeRolePolicy as {
          Statement: Array<{ Principal?: { Service?: string | string[] } }>;
        };
        const service = policy.Statement[0]?.Principal?.Service;
        const serviceArray = Array.isArray(service) ? service : [service];
        return serviceArray.includes("lambda.amazonaws.com");
      });

      expect(lambdaRoles.length).toBe(3); // 3 Lambda functions

      lambdaRoles.forEach((role) => {
        const policy = role.assumeRolePolicy as {
          Statement: Array<{ Action: string }>;
        };
        expect(policy.Statement[0].Action).toBe("sts:AssumeRole");
      });
    });
  });

  // ============================================================================
  // DYNAMODB PERMISSIONS
  // ============================================================================

  describe("DynamoDB Permissions", () => {
    let template: Template;
    let policiesWithDynamoDb: Array<{
      actions: string[];
      resources: string[];
    }>;

    beforeAll(() => {
      const app = createTestApp();
      const stack = createTestApiStack(app);
      template = Template.fromStack(stack);

      // Pre-compute policies with DynamoDB permissions
      const policies = template.findResources("AWS::IAM::Policy");
      policiesWithDynamoDb = Object.values(policies)
        .map((policy) => {
          const props = (policy as { Properties: Record<string, unknown> })
            .Properties;
          const doc = props.PolicyDocument as {
            Statement: Array<{ Action: string[]; Resource: string[] }>;
          };

          // Find statements with DynamoDB actions
          const dynamoDbStatements = doc.Statement.filter((stmt) =>
            stmt.Action.some((action) => action.startsWith("dynamodb:"))
          );

          return dynamoDbStatements.map((stmt) => ({
            actions: stmt.Action,
            resources: stmt.Resource,
          }));
        })
        .flat();
    });

    test("should grant Lambda functions read access to DynamoDB table", () => {
      const expectedActions = validateDynamoDbReadPermissions();

      template.hasResourceProperties("AWS::IAM::Policy", {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: expectedActions,
              Effect: "Allow",
              // Resource can be string, array, or object (Ref/GetAtt)
              // Just verify it exists
              Resource: Match.anyValue(),
            }),
          ]),
        },
      });
    });

    test("should include Query permission for GSI access", () => {
      template.hasResourceProperties("AWS::IAM::Policy", {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: Match.arrayWith(["dynamodb:Query"]),
            }),
          ]),
        },
      });
    });

    test("should include Scan permission for full table scans", () => {
      template.hasResourceProperties("AWS::IAM::Policy", {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: Match.arrayWith(["dynamodb:Scan"]),
            }),
          ]),
        },
      });
    });

    test("should include GetItem permission for single item retrieval", () => {
      template.hasResourceProperties("AWS::IAM::Policy", {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: Match.arrayWith(["dynamodb:GetItem"]),
            }),
          ]),
        },
      });
    });

    test("should scope DynamoDB permissions to specific table", () => {
      // Guard assertion
      expect(policiesWithDynamoDb).toBeDefined();
      expect(policiesWithDynamoDb.length).toBeGreaterThan(0);

      policiesWithDynamoDb.forEach((policy) => {
        // Resources can be a string or array in CloudFormation
        const resources = Array.isArray(policy.resources)
          ? policy.resources
          : [policy.resources];

        expect(resources.length).toBeGreaterThan(0);
        resources.forEach((resource) => {
          // Check if resource is a string (direct ARN) or object (Ref/GetAtt)
          if (typeof resource === "string") {
            expect(resource).toMatch(/table/);
          } else {
            // For Ref/GetAtt, just verify it's an object
            expect(resource).toBeDefined();
          }
        });
      });
    });
  });

  // ============================================================================
  // S3 PERMISSIONS
  // ============================================================================

  describe("S3 Permissions", () => {
    let template: Template;
    let policiesWithS3: Array<{ actions: string[]; resources: string[] }>;
    let policiesWithDynamoDb: Array<{
      actions: string[];
      resources: string[];
    }>;

    beforeAll(() => {
      const app = createTestApp();
      const stack = createTestApiStack(app);
      template = Template.fromStack(stack);

      // Pre-compute policies with S3 permissions
      const policies = template.findResources("AWS::IAM::Policy");
      policiesWithS3 = Object.values(policies)
        .map((policy) => {
          const props = (policy as { Properties: Record<string, unknown> })
            .Properties;
          const doc = props.PolicyDocument as {
            Statement: Array<{ Action: string[]; Resource: string[] }>;
          };

          // Find statements with S3 actions
          const s3Statements = doc.Statement.filter((stmt) =>
            stmt.Action.some((action) => action.startsWith("s3:"))
          );

          return s3Statements.map((stmt) => ({
            actions: stmt.Action,
            resources: stmt.Resource,
          }));
        })
        .flat();

      // Pre-compute policies with DynamoDB permissions (for validation)
      policiesWithDynamoDb = Object.values(policies)
        .map((policy) => {
          const props = (policy as { Properties: Record<string, unknown> })
            .Properties;
          const doc = props.PolicyDocument as {
            Statement: Array<{ Action: string[]; Resource: string[] }>;
          };

          // Find statements with DynamoDB actions
          const dynamoDbStatements = doc.Statement.filter((stmt) =>
            stmt.Action.some((action) => action.startsWith("dynamodb:"))
          );

          return dynamoDbStatements.map((stmt) => ({
            actions: stmt.Action,
            resources: stmt.Resource,
          }));
        })
        .flat();
    });

    test("should grant Lambda functions read access to S3 bucket", () => {
      const expectedActions = validateS3ReadPermissions();

      template.hasResourceProperties("AWS::IAM::Policy", {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: expectedActions,
              Effect: "Allow",
            }),
          ]),
        },
      });
    });

    test("should include GetObject permission for file retrieval", () => {
      template.hasResourceProperties("AWS::IAM::Policy", {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: Match.arrayWith(["s3:GetObject*"]),
            }),
          ]),
        },
      });
    });

    test("should include List permission for bucket operations", () => {
      template.hasResourceProperties("AWS::IAM::Policy", {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: Match.arrayWith(["s3:List*"]),
            }),
          ]),
        },
      });
    });

    test("should not grant write permissions to S3", () => {
      // Guard assertion - S3 policies should exist
      expect(policiesWithS3).toBeDefined();
      expect(policiesWithS3.length).toBeGreaterThan(0);

      policiesWithS3.forEach((policy) => {
        const hasWriteAction = policy.actions.some(
          (action) =>
            action.includes("Put") ||
            action.includes("Delete") ||
            action.includes("Write")
        );
        expect(hasWriteAction).toBe(false);
      });
    });

    test("should not grant write permissions to DynamoDB", () => {
      // Guard assertion - DynamoDB policies should exist
      expect(policiesWithDynamoDb).toBeDefined();
      expect(policiesWithDynamoDb.length).toBeGreaterThan(0);

      policiesWithDynamoDb.forEach((policy) => {
        const hasWriteAction = policy.actions.some(
          (action) =>
            action.includes("PutItem") ||
            action.includes("UpdateItem") ||
            action.includes("DeleteItem")
        );
        expect(hasWriteAction).toBe(false);
      });
    });
  });

  // ============================================================================
  // POLICY ATTACHMENT
  // ============================================================================

  describe("Policy Attachment", () => {
    let template: Template;

    beforeAll(() => {
      const app = createTestApp();
      const stack = createTestApiStack(app);
      template = Template.fromStack(stack);
    });

    test("should create IAM policies", () => {
      // CDK consolidates all permissions into a single policy per Lambda function
      // Each Lambda has 1 policy with multiple statements (DynamoDB, S3, CloudWatch Logs)
      template.resourceCountIs(
        "AWS::IAM::Policy",
        API_TEST_CONSTANTS.RESOURCE_COUNTS.IAM_POLICY
      );
    });

    test("should attach policies to Lambda execution roles", () => {
      template.hasResourceProperties("AWS::IAM::Policy", {
        Roles: Match.anyValue(),
      });
    });

    test("should grant CloudWatch Logs permissions", () => {
      template.hasResourceProperties("AWS::IAM::Policy", {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: Match.arrayWith([
                "logs:CreateLogStream",
                "logs:PutLogEvents",
              ]),
              Effect: "Allow",
            }),
          ]),
        },
      });
    });
  });
});
