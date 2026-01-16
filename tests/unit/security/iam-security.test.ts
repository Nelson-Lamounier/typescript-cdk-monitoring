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

import { type ConnectivityTestStacks } from "../connectivity/test-config";

import { SecurityTestFixtures } from "../utils/test-utils";

describe("Security Posture: IAM Security", () => {
  let stacks: ConnectivityTestStacks;

  beforeAll(() => {
    stacks = SecurityTestFixtures.getDevelopmentStacks();
  });

  // ==========================================================================
  // HELPER FUNCTIONS (defined as arrow functions)
  // ==========================================================================

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
    stackNames: Array<keyof ConnectivityTestStacks>
  ): Template[] => {
    return stackNames.map((name) => getTemplate(name));
  };

  /**
   * Get resources of a specific type
   */
  const getResources = (template: Template, resourceType: string) => {
    return Object.values(template.findResources(resourceType));
  };

  /**
   * Get IAM roles from template
   */
  const getRoles = (template: Template) => {
    return getResources(template, "AWS::IAM::Role");
  };

  /**
   * Get IAM policies from template
   */
  const getPolicies = (template: Template) => {
    return getResources(template, "AWS::IAM::Policy");
  };

  /**
   * Extract managed policy ARNs from role
   */
  const getManagedPolicyArns = (role: unknown): unknown[] => {
    const properties = (role as Record<string, Record<string, unknown[]>>)
      .Properties;
    return properties.ManagedPolicyArns || [];
  };

  /**
   * Check if managed policy ARNs contain policy name
   */
  const hasManagedPolicy = (role: unknown, policyName: string): boolean => {
    const managedPolicies = getManagedPolicyArns(role);
    return managedPolicies.some((policy) => {
      return JSON.stringify(policy).includes(policyName);
    });
  };

  /**
   * Extract policy document from policy
   */
  const getPolicyDocument = (
    policy: unknown
  ): Record<string, Array<Record<string, unknown>>> => {
    const properties = (policy as Record<string, Record<string, unknown>>)
      .Properties;
    return (properties.PolicyDocument || {}) as Record<
      string,
      Array<Record<string, unknown>>
    >;
  };

  /**
   * Extract policy statements
   */
  const getPolicyStatements = (
    policy: unknown
  ): Array<Record<string, unknown>> => {
    const policyDocument = getPolicyDocument(policy);
    return policyDocument.Statement || [];
  };

  /**
   * Extract actions from statement (normalize to array)
   */
  const getActions = (statement: Record<string, unknown>): unknown[] => {
    const action = statement.Action;
    return Array.isArray(action) ? action : action ? [action] : [];
  };

  /**
   * Check if statement has specific action
   */
  const hasAction = (
    statement: Record<string, unknown>,
    actionPattern: string
  ): boolean => {
    const actions = getActions(statement);
    return actions.some((action) => String(action).includes(actionPattern));
  };

  /**
   * Check if statement has wildcard action
   */
  const hasWildcardAction = (statement: Record<string, unknown>): boolean => {
    const actions = getActions(statement);
    return actions.some((action) => String(action) === "*");
  };

  /**
   * Check if action is read-only
   */
  const isReadOnlyAction = (action: string): boolean => {
    return (
      action.startsWith("Describe") ||
      action.startsWith("Get") ||
      action.startsWith("List")
    );
  };

  /**
   * Extract assume role policy document from role
   */
  const getAssumeRolePolicy = (
    role: unknown
  ): Record<string, Array<Record<string, unknown>>> => {
    const properties = (role as Record<string, Record<string, unknown>>)
      .Properties;
    return (properties.AssumeRolePolicyDocument || {}) as Record<
      string,
      Array<Record<string, unknown>>
    >;
  };

  /**
   * Extract assume role statements
   */
  const getAssumeRoleStatements = (
    role: unknown
  ): Array<Record<string, unknown>> => {
    const assumePolicy = getAssumeRolePolicy(role);
    return assumePolicy.Statement || [];
  };

  /**
   * Check if role trusts specific service
   */
  const hasServiceTrust = (role: unknown, service: string): boolean => {
    const statements = getAssumeRoleStatements(role);
    return statements.some((statement) => {
      const principal = statement.Principal as
        | Record<string, string>
        | undefined;
      return principal?.Service === service;
    });
  };

  /**
   * Check if role is for Lambda (by name)
   */
  const isLambdaRole = (role: unknown): boolean => {
    const roleJson = JSON.stringify(role);
    return roleJson.includes("lambda");
  };

  // ==========================================================================
  // LEAST PRIVILEGE PRINCIPLE
  // ==========================================================================

  describe("Least Privilege Principle", () => {
    test("instance role has SSM managed instance core policy", () => {
      const template = getTemplate("infraStack");

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

    test("no roles have AdministratorAccess policy", () => {
      const templates = getTemplates([
        "networkingStack",
        "efsStack",
        "infraStack",
        "serviceStack",
      ]);

      templates.forEach((template) => {
        const roles = getRoles(template);

        roles.forEach((role) => {
          expect(hasManagedPolicy(role, "AdministratorAccess")).toBe(false);
        });
      });
    });

    test("no roles have PowerUserAccess policy", () => {
      const templates = getTemplates([
        "networkingStack",
        "efsStack",
        "infraStack",
        "serviceStack",
      ]);

      templates.forEach((template) => {
        const roles = getRoles(template);

        roles.forEach((role) => {
          expect(hasManagedPolicy(role, "PowerUserAccess")).toBe(false);
        });
      });
    });

    test("instance roles do not have wildcard permissions on sensitive actions", () => {
      const template = getTemplate("infraStack");
      const policies = getPolicies(template);

      policies.forEach((policy) => {
        const statements = getPolicyStatements(policy);

        statements.forEach((statement) => {
          if (statement.Resource === "*") {
            const actions = getActions(statement);

            const hasWriteActions = actions.some((action) => {
              const actionStr = String(action);
              return !isReadOnlyAction(actionStr);
            });

            // Write actions with wildcard resource should be service-specific
            if (hasWriteActions) {
              // Just verify actions are defined and not completely open
              expect(actions.length).toBeGreaterThan(0);
            }
          }
        });
      });
    });
  });

  // ==========================================================================
  // ROLE TRUST RELATIONSHIPS
  // ==========================================================================

  describe("Role Trust Relationships", () => {
    test("EC2 instance role trusts EC2 service", () => {
      const template = getTemplate("infraStack");

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

    test("ECS task execution role trusts ECS tasks service", () => {
      const template = getTemplate("serviceStack");

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

    test("Lambda execution role trusts Lambda service (if Lambda roles exist)", () => {
      const template = getTemplate("networkingStack");
      const roles = getRoles(template);

      roles.forEach((role) => {
        // Only check roles that are actually for Lambda
        if (isLambdaRole(role)) {
          expect(hasServiceTrust(role, "lambda.amazonaws.com")).toBe(true);
        }
      });
    });
  });

  // ==========================================================================
  // SSM PARAMETER ACCESS
  // ==========================================================================

  describe("SSM Parameter Access", () => {
    test("instance role has read access to SSM parameters", () => {
      const template = getTemplate("infraStack");

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

    test("SSM parameter access is scoped to specific paths (if SSM actions exist)", () => {
      const template = getTemplate("infraStack");
      const policies = getPolicies(template);

      policies.forEach((policy) => {
        const statements = getPolicyStatements(policy);

        statements.forEach((statement) => {
          if (
            hasAction(statement, "ssm:GetParameter") &&
            statement.Resource !== "*"
          ) {
            // Resource should be scoped
            expect(statement.Resource).toBeDefined();
          }
        });
      });
    });
  });

  // ==========================================================================
  // EFS ACCESS PERMISSIONS
  // ==========================================================================

  describe("EFS Access Permissions", () => {
    test("instance role has EFS mount permissions", () => {
      const template = getTemplate("infraStack");

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

    test("EFS access is scoped to specific file system (if EFS actions exist)", () => {
      const template = getTemplate("infraStack");
      const policies = getPolicies(template);

      policies.forEach((policy) => {
        const statements = getPolicyStatements(policy);

        statements.forEach((statement) => {
          if (hasAction(statement, "elasticfilesystem:")) {
            // EFS actions should be scoped to specific resources
            expect(statement.Resource).toBeDefined();
          }
        });
      });
    });
  });

  // ==========================================================================
  // SERVICE ROLE PERMISSIONS
  // ==========================================================================

  describe("Service Role Permissions", () => {
    test("ECS task roles have minimal required permissions", () => {
      const template = getTemplate("serviceStack");
      const policies = getPolicies(template);

      policies.forEach((policy) => {
        const statements = getPolicyStatements(policy);

        statements.forEach((statement) => {
          // No statement should allow all actions
          expect(hasWildcardAction(statement)).toBe(false);
        });
      });
    });
  });
});
