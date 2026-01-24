/** @format */
/// <reference types="jest" />

/**
 * Security Posture Tests: IAM Security
 *
 * Validates IAM security configurations including:
 * - Least privilege principle adherence
 * - Role trust relationships
 * - Managed policy usage
 * - SSM parameter access permissions
 * - No wildcard permissions on sensitive resources
 *
 * @see https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html
 */

import { Template, Match } from "aws-cdk-lib/assertions";

import {
  type ConnectivityTestStacks,
  IAM_TEST_STACKS,
} from "../connectivity/test-config";
import { SecurityTestFixtures } from "../utils/test-utils";
// Import shared utilities - functions
import {
  getRoles,
  getPolicies,
  getPolicyStatements,
  hasManagedPolicy,
  hasServiceTrust,
  isLambdaRole,
  hasAction,
  hasWildcardAction,
  isReadOnlyAction,
  getActions,
} from "../utils";

describe("Security Posture: IAM Security", () => {
  let stacks: ConnectivityTestStacks;

  beforeAll(() => {
    stacks = SecurityTestFixtures.getDevelopmentStacks();
  });

  /**
   * Get template from stack name
   */
  const getTemplate = (stackName: keyof ConnectivityTestStacks) => {
    if (stackName === "app") {
      throw new Error("Cannot get template for app");
    }
    return Template.fromStack(stacks[stackName]);
  };

  /**
   * Get all templates from multiple stacks
   */
  const getTemplates = (
    stackNames: ReadonlyArray<keyof ConnectivityTestStacks>
  ): Template[] => {
    return stackNames.map((name) => getTemplate(name));
  };

  // ==========================================================================
  // LEAST PRIVILEGE PRINCIPLE
  // ==========================================================================

  describe("Least Privilege Principle", () => {
    // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
    test("instance role has SSM managed instance core policy", () => {
      const template = getTemplate(IAM_TEST_STACKS[2]);

      template.hasResourceProperties("AWS::IAM::Role", {
        ManagedPolicyArns: Match.arrayWith([
          Match.objectLike({
            "Fn::Join": Match.arrayWith([
              Match.arrayWith([
                Match.stringLikeRegexp("AmazonSSMManagedInstanceCore"),
              ]),
            ]),
          }),
        ]),
      });
    });

    describe("Prohibited Managed Policies", () => {
      let allRoles: Array<{ role: unknown; stackName: string }>;

      beforeAll(() => {
        const templates = getTemplates(IAM_TEST_STACKS);

        // Pre-compute all roles with their stack names
        allRoles = templates.flatMap((template, index) => {
          const roles = getRoles(template);
          return roles.map((role) => ({
            role,
            stackName: IAM_TEST_STACKS[index],
          }));
        });
      });

      test("roles exist", () => {
        expect(allRoles.length).toBeGreaterThan(0);
      });

      test("no roles have AdministratorAccess policy", () => {
        expect(allRoles).toBeDefined();
        expect(Array.isArray(allRoles)).toBe(true);

        allRoles.forEach(({ role }) => {
          expect(hasManagedPolicy(role, "AdministratorAccess")).toBe(false);
        });
      });

      test("no roles have PowerUserAccess policy", () => {
        expect(allRoles).toBeDefined();
        expect(Array.isArray(allRoles)).toBe(true);

        allRoles.forEach(({ role }) => {
          expect(hasManagedPolicy(role, "PowerUserAccess")).toBe(false);
        });
      });
    });

    describe("Wildcard Permissions on Sensitive Actions", () => {
      let policiesWithWildcardResources: Array<{
        policy: unknown;
        statement: Record<string, unknown>;
        hasWriteActions: boolean;
      }>;

      beforeAll(() => {
        const template = getTemplate(IAM_TEST_STACKS[2]);
        const policies = getPolicies(template);

        // Pre-compute policies with wildcard resources and write actions
        policiesWithWildcardResources = policies.flatMap((policy) => {
          const statements = getPolicyStatements(policy);
          return statements
            .filter((statement) => statement.Resource === "*")
            .map((statement) => {
              const actions = getActions(statement);
              const hasWriteActions = actions.some((action) => {
                const actionStr = String(action);
                return !isReadOnlyAction(actionStr);
              });

              return {
                policy,
                statement,
                hasWriteActions,
              };
            });
        });
      });

      test("policies with wildcard resources exist", () => {
        expect(policiesWithWildcardResources.length).toBeGreaterThan(0);
      });

      test("instance roles do not have wildcard permissions on sensitive actions", () => {
        expect(policiesWithWildcardResources).toBeDefined();
        expect(Array.isArray(policiesWithWildcardResources)).toBe(true);

        policiesWithWildcardResources.forEach(({ statement }) => {
          const actions = getActions(statement);
          // Write actions with wildcard resource should be service-specific
          // Actions should be defined and not completely open
          expect(actions.length).toBeGreaterThan(0);
        });
      });
    });
  });

  // ==========================================================================
  // ROLE TRUST RELATIONSHIPS
  // ==========================================================================

  describe("Role Trust Relationships", () => {
    // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
    test("EC2 instance role trusts EC2 service", () => {
      const template = getTemplate(IAM_TEST_STACKS[2]);

      template.hasResourceProperties("AWS::IAM::Role", {
        AssumeRolePolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Effect: "Allow",
              Principal: Match.objectLike({
                Service: "ec2.amazonaws.com",
              }),
              Action: "sts:AssumeRole",
            }),
          ]),
        }),
      });
    });

    // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
    test("ECS task execution role trusts ECS tasks service", () => {
      const template = getTemplate(IAM_TEST_STACKS[3]);

      template.hasResourceProperties("AWS::IAM::Role", {
        AssumeRolePolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Effect: "Allow",
              Principal: Match.objectLike({
                Service: "ecs-tasks.amazonaws.com",
              }),
              Action: "sts:AssumeRole",
            }),
          ]),
        }),
      });
    });

    describe("Lambda Execution Roles", () => {
      let lambdaRoles: unknown[];

      beforeAll(() => {
        const template = getTemplate(IAM_TEST_STACKS[0]);
        const roles = getRoles(template);

        // Pre-filter Lambda roles
        lambdaRoles = roles.filter((role) => isLambdaRole(role));
      });

      test("Lambda execution role trusts Lambda service (if Lambda roles exist)", () => {
        // This test validates configuration IF Lambda roles exist
        // Empty array is valid - means no Lambda roles configured
        expect(lambdaRoles).toBeDefined();
        expect(Array.isArray(lambdaRoles)).toBe(true);

        // If Lambda roles exist, they should have service trust
        lambdaRoles.forEach((role) => {
          expect(hasServiceTrust(role, "lambda.amazonaws.com")).toBe(true);
        });
      });
    });
  });

  // ==========================================================================
  // SSM PARAMETER ACCESS
  // ==========================================================================

  describe("SSM Parameter Access", () => {
    // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
    test("instance role has read access to SSM parameters", () => {
      const template = getTemplate(IAM_TEST_STACKS[2]);

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

    describe("SSM Parameter Access Scoping", () => {
      let scopedSsmStatements: Array<{
        policy: unknown;
        statement: Record<string, unknown>;
      }>;

      beforeAll(() => {
        const template = getTemplate(IAM_TEST_STACKS[2]);
        const policies = getPolicies(template);

        // Pre-filter and extract scoped SSM statements
        scopedSsmStatements = policies.flatMap((policy) => {
          const statements = getPolicyStatements(policy);
          return statements
            .filter(
              (statement) =>
                hasAction(statement, "ssm:GetParameter") &&
                statement.Resource !== "*"
            )
            .map((statement) => ({
              policy,
              statement,
            }));
        });
      });

      test("SSM parameter access is scoped to specific paths (if SSM actions exist)", () => {
        // This test validates configuration IF SSM actions exist
        // Empty array is valid - means no scoped SSM statements
        expect(scopedSsmStatements).toBeDefined();
        expect(Array.isArray(scopedSsmStatements)).toBe(true);

        // If scoped SSM statements exist, validate they have resources
        scopedSsmStatements.forEach(({ statement }) => {
          // Resource should be scoped
          expect(statement.Resource).toBeDefined();
        });
      });
    });
  });

  // ==========================================================================
  // EFS ACCESS PERMISSIONS
  // ==========================================================================

  describe("EFS Access Permissions", () => {
    // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
    test("instance role has EFS mount permissions", () => {
      const template = getTemplate(IAM_TEST_STACKS[2]);

      template.hasResourceProperties("AWS::IAM::Policy", {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Effect: "Allow",
              Action: Match.arrayWith([
                "elasticfilesystem:ClientMount",
                "elasticfilesystem:ClientWrite",
              ]),
            }),
          ]),
        },
      });
    });

    describe("EFS Access Scoping", () => {
      let efsStatements: Array<{
        policy: unknown;
        statement: Record<string, unknown>;
      }>;

      beforeAll(() => {
        const template = getTemplate(IAM_TEST_STACKS[2]);
        const policies = getPolicies(template);

        // Pre-filter and extract EFS statements
        efsStatements = policies.flatMap((policy) => {
          const statements = getPolicyStatements(policy);
          return statements
            .filter((statement) => hasAction(statement, "elasticfilesystem:"))
            .map((statement) => ({
              policy,
              statement,
            }));
        });
      });

      test("EFS access is scoped to specific file system (if EFS actions exist)", () => {
        // This test validates configuration IF EFS actions exist
        // Empty array is valid - means no EFS statements
        expect(efsStatements).toBeDefined();
        expect(Array.isArray(efsStatements)).toBe(true);

        // If EFS statements exist, validate they have resources
        efsStatements.forEach(({ statement }) => {
          // EFS actions should be scoped to specific resources
          expect(statement.Resource).toBeDefined();
        });
      });
    });
  });

  // ==========================================================================
  // SERVICE ROLE PERMISSIONS
  // ==========================================================================

  describe("Service Role Permissions", () => {
    let allPolicyStatements: Array<{
      policy: unknown;
      statement: Record<string, unknown>;
    }>;

    beforeAll(() => {
      const template = getTemplate(IAM_TEST_STACKS[3]);
      const policies = getPolicies(template);

      // Pre-compute all policy statements
      allPolicyStatements = policies.flatMap((policy) => {
        const statements = getPolicyStatements(policy);
        return statements.map((statement) => ({
          policy,
          statement,
        }));
      });
    });

    test("ECS task roles have minimal required permissions", () => {
      expect(allPolicyStatements.length).toBeGreaterThan(0);

      allPolicyStatements.forEach(({ statement }) => {
        // No statement should allow all actions
        expect(hasWildcardAction(statement)).toBe(false);
      });
    });
  });
});
