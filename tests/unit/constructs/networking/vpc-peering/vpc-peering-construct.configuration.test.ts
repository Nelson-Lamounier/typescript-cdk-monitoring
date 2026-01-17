/** @format */
/// <reference types="jest" />

import * as cdk from "aws-cdk-lib";
import { Template, Match } from "aws-cdk-lib/assertions";

import { createTestApp, extendExpectWithCdkMatchers } from "../../../utils/stack-test-utils";
import {
  TEST_CONSTANTS,
  createTestStack,
  createTestVpc,
  createPeeringConstruct,
} from "./shared-fixtures";

// ============================================================================
// CUSTOM MATCHERS SETUP
// ============================================================================

extendExpectWithCdkMatchers();

// ============================================================================
// VPC PEERING CONSTRUCT - OPTIONAL PROPERTIES & LAMBDA PROVIDERS TESTS
// ============================================================================

describe("VpcPeeringConstruct - Optional Properties & Lambda Providers", () => {
  // ============================================
  // Optional Properties Tests
  // ============================================

  describe("Optional Properties", () => {
    let app: cdk.App;
    let stack: cdk.Stack;

    beforeEach(() => {
      app = createTestApp();
      stack = createTestStack(app);
    });

    test("uses default SSM parameter path when not provided", () => {
      const vpc = createTestVpc(stack);
      createPeeringConstruct(stack, vpc, "Peering", {
        envName: TEST_CONSTANTS.ENVIRONMENTS.PRODUCTION,
        peeringName: TEST_CONSTANTS.PEERING.PROD_NAME,
      });

      const template = Template.fromStack(stack);

      expect(() => {
        template.hasResourceProperties("AWS::SSM::Parameter", {
          Name: `${TEST_CONSTANTS.SSM.DEFAULT_PREFIX}/production/connection-id`,
        });
      }).not.toThrow();
    });

    test("uses custom SSM parameter path when provided", () => {
      const vpc = createTestVpc(stack);
      createPeeringConstruct(stack, vpc, "Peering", {
        ssmParameterPath: TEST_CONSTANTS.SSM.CUSTOM_PATH,
      });

      const template = Template.fromStack(stack);

      expect(() => {
        template.hasResourceProperties("AWS::SSM::Parameter", {
          Name: TEST_CONSTANTS.SSM.CUSTOM_PATH,
        });
      }).not.toThrow();
    });

    test("includes project name in SSM parameter path when provided", () => {
      const vpc = createTestVpc(stack);
      createPeeringConstruct(stack, vpc, "Peering", {
        projectName: TEST_CONSTANTS.PROJECT_NAME,
      });

      const template = Template.fromStack(stack);

      expect(() => {
        template.hasResourceProperties("AWS::SSM::Parameter", {
          Name: `${TEST_CONSTANTS.SSM.DEFAULT_PREFIX}/test-monitoring/connection-id`,
        });
      }).not.toThrow();
    });

    test("uses default Lambda timeout when not provided", () => {
      const vpc = createTestVpc(stack);
      createPeeringConstruct(stack, vpc);

      const template = Template.fromStack(stack);

      expect(() => {
        template.hasResourceProperties("AWS::Lambda::Function", {
          Timeout: TEST_CONSTANTS.LAMBDA.DEFAULT_TIMEOUT,
        });
      }).not.toThrow();
    });

    test("uses custom Lambda timeout when provided", () => {
      const vpc = createTestVpc(stack);
      createPeeringConstruct(stack, vpc, "Peering", {
        lambdaTimeoutSeconds: TEST_CONSTANTS.LAMBDA.CUSTOM_TIMEOUT,
      });

      const template = Template.fromStack(stack);

      expect(() => {
        template.hasResourceProperties("AWS::Lambda::Function", {
          Timeout: TEST_CONSTANTS.LAMBDA.CUSTOM_TIMEOUT,
        });
      }).not.toThrow();
    });

    test("enables DNS resolution by default", () => {
      const vpc = createTestVpc(stack);
      createPeeringConstruct(stack, vpc);

      const template = Template.fromStack(stack);

      expect(() => {
        template.resourceCountIs(
          "AWS::CloudFormation::CustomResource",
          TEST_CONSTANTS.RESOURCE_COUNTS.CUSTOM_RESOURCES
        );
      }).not.toThrow();
    });

    test("disables DNS resolution when explicitly set to false", () => {
      const vpc = createTestVpc(stack);
      createPeeringConstruct(stack, vpc, "Peering", {
        enableDnsResolution: false,
      });

      const template = Template.fromStack(stack);

      expect(() => {
        template.resourceCountIs(
          "AWS::CloudFormation::CustomResource",
          TEST_CONSTANTS.RESOURCE_COUNTS.CUSTOM_RESOURCES
        );
      }).not.toThrow();
    });

    test("includes project name in output export name when provided", () => {
      const vpc = createTestVpc(stack);
      createPeeringConstruct(stack, vpc, "Peering", {
        envName: TEST_CONSTANTS.ENVIRONMENTS.PRODUCTION,
        peeringName: TEST_CONSTANTS.PEERING.PROD_NAME,
        projectName: TEST_CONSTANTS.PROJECT_NAME,
      });

      const template = Template.fromStack(stack);
      const outputs = template.toJSON().Outputs || {};
      const outputKey = "PeeringPeeringConnectionId";

      expect(outputs[outputKey]).toBeDefined();
      expect(outputs[outputKey].Export?.Name).toBe("vpc-peering-monitoring-prod");
    });

    test("uses environment name only in output export name when project name not provided", () => {
      const vpc = createTestVpc(stack);
      createPeeringConstruct(stack, vpc, "Peering", {
        envName: TEST_CONSTANTS.ENVIRONMENTS.PRODUCTION,
        peeringName: TEST_CONSTANTS.PEERING.PROD_NAME,
      });

      const template = Template.fromStack(stack);
      const outputs = template.toJSON().Outputs || {};
      const outputKey = "PeeringPeeringConnectionId";

      expect(outputs[outputKey]).toBeDefined();
      expect(outputs[outputKey].Export?.Name).toBe("vpc-peering-prod");
    });
  });

  // ============================================
  // Lambda Provider Tests
  // ============================================

  describe("Lambda Providers", () => {
    let app: cdk.App;
    let stack: cdk.Stack;

    beforeEach(() => {
      app = createTestApp();
      stack = createTestStack(app);
    });

    test("creates Lambda function for peering connection", () => {
      const vpc = createTestVpc(stack);
      createPeeringConstruct(stack, vpc);

      const template = Template.fromStack(stack);

      expect(() => {
        template.hasResourceProperties("AWS::Lambda::Function", {
          FunctionName: Match.stringLikeRegexp("create-accept-peering"),
        });
      }).not.toThrow();
    });

    test("creates Lambda function for route updates", () => {
      const vpc = createTestVpc(stack);
      createPeeringConstruct(stack, vpc);

      const template = Template.fromStack(stack);

      expect(() => {
        template.hasResourceProperties("AWS::Lambda::Function", {
          FunctionName: Match.stringLikeRegexp("update-routes"),
        });
      }).not.toThrow();
    });

    test("grants STS AssumeRole permission to peer role", () => {
      const vpc = createTestVpc(stack);
      createPeeringConstruct(stack, vpc);

      const template = Template.fromStack(stack);

      expect(() => {
        template.hasResourceProperties("AWS::IAM::Policy", {
          PolicyDocument: {
            Statement: Match.arrayWith([
              Match.objectLike({
                Effect: "Allow",
                Action: "sts:AssumeRole",
                Resource: TEST_CONSTANTS.PEER_ACCOUNT.ROLE_ARN,
              }),
            ]),
          },
        });
      }).not.toThrow();
    });

    test("grants EC2 permissions for peering operations", () => {
      const vpc = createTestVpc(stack);
      createPeeringConstruct(stack, vpc);

      const template = Template.fromStack(stack);

      expect(() => {
        template.hasResourceProperties("AWS::IAM::Policy", {
          PolicyDocument: {
            Statement: Match.arrayWith([
              Match.objectLike({
                Effect: "Allow",
                Action: Match.anyValue(),
              }),
            ]),
          },
        });
      }).not.toThrow();

      // Verify specific actions exist in at least one policy statement
      const policies = template.findResources("AWS::IAM::Policy");
      const hasPeeringActions = Object.values(policies).some(
        (policy: {
          Properties?: {
            PolicyDocument?: { Statement?: Array<{ Action?: string | string[] }> };
          };
        }) => {
          const statements = policy.Properties?.PolicyDocument?.Statement || [];
          return statements.some((stmt) => {
            const actions = Array.isArray(stmt.Action) ? stmt.Action : [stmt.Action];
            return (
              actions.includes("ec2:CreateVpcPeeringConnection") &&
              actions.includes("ec2:AcceptVpcPeeringConnection") &&
              actions.includes("ec2:DescribeVpcPeeringConnections")
            );
          });
        }
      );
      expect(hasPeeringActions).toBe(true);
    });

    test("grants EC2 permissions for route table operations", () => {
      const vpc = createTestVpc(stack);
      createPeeringConstruct(stack, vpc);

      const template = Template.fromStack(stack);

      expect(() => {
        template.hasResourceProperties("AWS::IAM::Policy", {
          PolicyDocument: {
            Statement: Match.arrayWith([
              Match.objectLike({
                Effect: "Allow",
                Action: Match.arrayWith([
                  "ec2:DescribeRouteTables",
                  "ec2:CreateRoute",
                  "ec2:DeleteRoute",
                ]),
              }),
            ]),
          },
        });
      }).not.toThrow();
    });
  });
});
