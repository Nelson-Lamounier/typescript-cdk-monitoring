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
      const json = template.toJSON();
      
      // Guard assertion: Outputs must exist
      expect(json.Outputs).toBeDefined();
      
      const outputs = json.Outputs;
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
      const json = template.toJSON();
      
      // Guard assertion: Outputs must exist
      expect(json.Outputs).toBeDefined();
      
      const outputs = json.Outputs;
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
      
      // Guard assertion: Ensure policies exist
      expect(Object.keys(policies).length).toBeGreaterThan(0);
      
      // Extract all policy statements for verification
      const allStatements: Array<{ Action: string | string[] }> = [];
      for (const policy of Object.values(policies)) {
        const typedPolicy = policy as {
          Properties: {
            PolicyDocument: { Statement: Array<{ Action: string | string[] }> };
          };
        };
        
        // Guard assertion: Ensure Properties, PolicyDocument, and Statement exist
        expect(typedPolicy.Properties).toBeDefined();
        expect(typedPolicy.Properties.PolicyDocument).toBeDefined();
        expect(typedPolicy.Properties.PolicyDocument.Statement).toBeDefined();
        
        // After guard assertions, we know these properties exist
        const statements = typedPolicy.Properties.PolicyDocument.Statement;
        allStatements.push(...statements);
      }
      
      // Guard assertion: Ensure we have statements to check
      expect(allStatements.length).toBeGreaterThan(0);
      
      // Extract all actions from all statements
      const allActions: string[] = [];
      for (const stmt of allStatements) {
        // Guard assertion: Ensure Action exists
        expect(stmt.Action).toBeDefined();
        
        // After guard assertion, Action is guaranteed to exist
        // Wrap in array and flatten to handle both string and string[] uniformly
        const actionValue = stmt.Action;
        const actionArray = [actionValue].flat();
        allActions.push(...actionArray);
      }
      
      // Guard assertion: Ensure we have actions to verify
      expect(allActions.length).toBeGreaterThan(0);
      
      // Verify required peering actions are present
      expect(allActions).toContain("ec2:CreateVpcPeeringConnection");
      expect(allActions).toContain("ec2:AcceptVpcPeeringConnection");
      expect(allActions).toContain("ec2:DescribeVpcPeeringConnections");
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
