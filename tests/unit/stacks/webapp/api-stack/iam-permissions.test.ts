/** @format */
/// <reference types="jest" />

/* eslint-disable jest/no-conditional-in-test */
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

    // eslint-disable-next-line jest/expect-expect
    test("should create IAM roles for Lambda functions", () => {
      template.resourceCountIs(
        "AWS::IAM::Role",
        API_TEST_CONSTANTS.RESOURCE_COUNTS.IAM_ROLE,
      );
    });

    // eslint-disable-next-line jest/expect-expect
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

      // Verify all Lambda roles have correct service principal
      const allHaveLambdaPrincipal = lambdaRoles.every((role) => {
        const policy = role.assumeRolePolicy as {
          Statement: Array<{ Principal: { Service: string } }>;
        };
        return policy.Statement[0].Principal.Service === "lambda.amazonaws.com";
      });

      expect(allHaveLambdaPrincipal).toBe(true);
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

      // Verify all Lambda roles use sts:AssumeRole
      const allUseAssumeRole = lambdaRoles.every((role) => {
        const policy = role.assumeRolePolicy as {
          Statement: Array<{ Action: string }>;
        };
        return policy.Statement[0].Action === "sts:AssumeRole";
      });

      expect(allUseAssumeRole).toBe(true);
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
            stmt.Action.some((action) => action.startsWith("dynamodb:")),
          );

          return dynamoDbStatements.map((stmt) => ({
            actions: stmt.Action,
            resources: stmt.Resource,
          }));
        })
        .flat();
    });

    test("should grant Lambda functions read access to DynamoDB table", () => {
      // Check if all 3 policies have DynamoDB permissions
      // All functions (getArticle, listArticles, listArticlesByTag) need DynamoDB access
      const policies = template.findResources("AWS::IAM::Policy");
      
      let policiesWithDynamoDb = 0;
      const expectedActions = [
        "dynamodb:BatchGetItem",
        "dynamodb:GetItem",
        "dynamodb:Query",
        "dynamodb:Scan",
        "dynamodb:ConditionCheckItem",
        "dynamodb:DescribeTable",
      ];
      
      Object.entries(policies).forEach(([_logicalId, policy]) => {
        const props = (policy as { Properties: Record<string, unknown> }).Properties;
        const doc = props.PolicyDocument as {
          Statement: Array<{
            Action: string | string[];
            Effect: string;
          }>;
        };
        
        // Check each statement for DynamoDB actions
        const hasStatement = doc.Statement.some((stmt) => {
          const actions = Array.isArray(stmt.Action) ? stmt.Action : [stmt.Action];
          
          // Check if this statement has all required DynamoDB actions
          const hasAllActions = expectedActions.every((expected) =>
            actions.some((actual) => actual === expected)
          );
          
          return hasAllActions && stmt.Effect === "Allow";
        });

        if (hasStatement) {
          policiesWithDynamoDb++;
        }
      });
      
      // All 3 Lambda functions should have DynamoDB permissions
      expect(policiesWithDynamoDb).toBe(3);
    });

    test("should include Query permission for GSI access", () => {
      // Check if policies contain Query permission
      expect(policiesWithDynamoDb.length).toBeGreaterThan(0);
      
      const hasQuery = policiesWithDynamoDb.some((policy) =>
        policy.actions.includes("dynamodb:Query")
      );
      
      expect(hasQuery).toBe(true);
    });

    test("should include Scan permission for full table scans", () => {
      // Check if policies contain Scan permission
      expect(policiesWithDynamoDb.length).toBeGreaterThan(0);
      
      const hasScan = policiesWithDynamoDb.some((policy) =>
        policy.actions.includes("dynamodb:Scan")
      );
      
      expect(hasScan).toBe(true);
    });

    test("should include GetItem permission for single item retrieval", () => {
      // Check if policies contain GetItem permission
      expect(policiesWithDynamoDb.length).toBeGreaterThan(0);
      
      const hasGetItem = policiesWithDynamoDb.some((policy) =>
        policy.actions.includes("dynamodb:GetItem")
      );
      
      expect(hasGetItem).toBe(true);
    });

    test("should scope DynamoDB permissions to specific table", () => {
      // Guard assertion
      expect(policiesWithDynamoDb).toBeDefined();
      expect(policiesWithDynamoDb.length).toBeGreaterThan(0);

      // Verify all policies have valid resources
      const allHaveValidResources = policiesWithDynamoDb.every((policy) => {
        // Resources can be a string or array in CloudFormation
        const resources = Array.isArray(policy.resources)
          ? policy.resources
          : [policy.resources];

        if (resources.length === 0) {
          return false;
        }

        // Check each resource
        return resources.every((resource) => {
          // Check if resource is a string (direct ARN) or object (Ref/GetAtt)
          return typeof resource === "string"
            ? resource.includes("table")
            : resource !== undefined;
        });
      });

      expect(allHaveValidResources).toBe(true);
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
            stmt.Action.some((action) => action.startsWith("s3:")),
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
            stmt.Action.some((action) => action.startsWith("dynamodb:")),
          );

          return dynamoDbStatements.map((stmt) => ({
            actions: stmt.Action,
            resources: stmt.Resource,
          }));
        })
        .flat();
    });

    test("should grant Lambda functions read access to S3 bucket", () => {
      // Check if at least one policy has S3 permissions
      // Only getArticleFunction should have S3 access (for large content retrieval)
      const policies = template.findResources("AWS::IAM::Policy");
      
      let foundS3Permissions = false;
      let policiesChecked = 0;
      let policiesWithS3Count = 0;
      
      Object.entries(policies).forEach(([_logicalId, policy]) => {
        policiesChecked++;
        const props = (policy as { Properties: Record<string, unknown> }).Properties;
        const doc = props.PolicyDocument as {
          Statement: Array<{
            Action: string | string[];
            Effect: string;
          }>;
        };
        
        // Check if any statement has S3 actions
        const hasS3Statement = doc.Statement.some((stmt) => {
          const actions = Array.isArray(stmt.Action) ? stmt.Action : [stmt.Action];
          const hasS3GetObject = actions.some((a) => a.startsWith("s3:GetObject"));
          const hasS3List = actions.some((a) => a.startsWith("s3:List"));
          const hasS3GetBucket = actions.some((a) => a.startsWith("s3:GetBucket"));
          
          return hasS3GetObject && hasS3List && hasS3GetBucket && stmt.Effect === "Allow";
        });

        if (hasS3Statement) {
          foundS3Permissions = true;
          policiesWithS3Count++;
        }
      });
      
      // Verify we found S3 permissions
      expect(foundS3Permissions).toBe(true);
      expect(policiesChecked).toBe(3); // 3 Lambda functions
      expect(policiesWithS3Count).toBe(1); // Only getArticleFunction should have S3
    });

    test("should include GetObject permission for file retrieval", () => {
      // Check if policies contain GetObject permission
      expect(policiesWithS3.length).toBeGreaterThan(0);
      
      const hasGetObject = policiesWithS3.some((policy) =>
        policy.actions.some((action) => action.startsWith("s3:GetObject"))
      );
      
      expect(hasGetObject).toBe(true);
    });

    test("should include List permission for bucket operations", () => {
      // Check if policies contain List permission
      expect(policiesWithS3.length).toBeGreaterThan(0);
      
      const hasList = policiesWithS3.some((policy) =>
        policy.actions.some((action) => action.startsWith("s3:List"))
      );
      
      expect(hasList).toBe(true);
    });

    test("should not grant write permissions to S3", () => {
      // Guard assertion - S3 policies should exist
      expect(policiesWithS3).toBeDefined();
      expect(policiesWithS3.length).toBeGreaterThan(0);

      // Check that no policy has write actions
      const hasAnyWriteAction = policiesWithS3.some((policy) =>
        policy.actions.some(
          (action) =>
            action.includes("Put") ||
            action.includes("Delete") ||
            action.includes("Write"),
        ),
      );

      expect(hasAnyWriteAction).toBe(false);
    });

    test("should not grant write permissions to DynamoDB", () => {
      // Guard assertion - DynamoDB policies should exist
      expect(policiesWithDynamoDb).toBeDefined();
      expect(policiesWithDynamoDb.length).toBeGreaterThan(0);

      // Check that no policy has write actions
      const hasAnyWriteAction = policiesWithDynamoDb.some((policy) =>
        policy.actions.some(
          (action) =>
            action.includes("PutItem") ||
            action.includes("UpdateItem") ||
            action.includes("DeleteItem"),
        ),
      );

      expect(hasAnyWriteAction).toBe(false);
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

    // eslint-disable-next-line jest/expect-expect
    test("should create IAM policies", () => {
      // CDK consolidates all permissions into a single policy per Lambda function
      // Each Lambda has 1 policy with multiple statements (DynamoDB, S3, CloudWatch Logs)
      template.resourceCountIs(
        "AWS::IAM::Policy",
        API_TEST_CONSTANTS.RESOURCE_COUNTS.IAM_POLICY,
      );
    });

    // eslint-disable-next-line jest/expect-expect
    test("should attach policies to Lambda execution roles", () => {
      template.hasResourceProperties("AWS::IAM::Policy", {
        Roles: Match.anyValue(),
      });
    });

    // eslint-disable-next-line jest/expect-expect
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
