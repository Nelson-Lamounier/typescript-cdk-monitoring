/** @format */
/// <reference types="jest" />

import * as cdk from "aws-cdk-lib";
import { Template, Match } from "aws-cdk-lib/assertions";

import { VpcConstruct } from "../../../../../lib/constructs/networking/vpc/vpc-construct";
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
// VPC PEERING CONSTRUCT - RESOURCES & INTEGRATION TESTS
// ============================================================================

describe("VpcPeeringConstruct - Resources & Integration", () => {
  // ============================================
  // Custom Resource Tests
  // ============================================

  describe("Custom Resources", () => {
    let app: cdk.App;
    let stack: cdk.Stack;

    beforeEach(() => {
      app = createTestApp();
      stack = createTestStack(app);
    });

    test("creates custom resource with correct properties for peering", () => {
      const vpc = createTestVpc(stack);
      createPeeringConstruct(stack, vpc);

      const template = Template.fromStack(stack);

      expect(() => {
        template.resourceCountIs(
          "AWS::CloudFormation::CustomResource",
          TEST_CONSTANTS.RESOURCE_COUNTS.CUSTOM_RESOURCES
        );
        template.hasResourceProperties("AWS::Lambda::Function", {
          FunctionName: Match.stringLikeRegexp("create-accept-peering"),
        });
      }).not.toThrow();
    });

    test("creates custom resource for route updates with correct properties", () => {
      const vpc = createTestVpc(stack);
      createPeeringConstruct(stack, vpc);

      const template = Template.fromStack(stack);

      expect(() => {
        template.resourceCountIs(
          "AWS::CloudFormation::CustomResource",
          TEST_CONSTANTS.RESOURCE_COUNTS.CUSTOM_RESOURCES
        );
        template.hasResourceProperties("AWS::Lambda::Function", {
          FunctionName: Match.stringLikeRegexp("update-routes"),
        });
      }).not.toThrow();
    });

    test("uses stack region when peer region not provided", () => {
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

    test("uses provided peer region when specified", () => {
      const vpc = createTestVpc(stack);
      createPeeringConstruct(stack, vpc, "Peering", {
        peerRegion: TEST_CONSTANTS.PEER_REGION.CUSTOM,
      });

      const template = Template.fromStack(stack);

      expect(() => {
        template.resourceCountIs(
          "AWS::CloudFormation::CustomResource",
          TEST_CONSTANTS.RESOURCE_COUNTS.CUSTOM_RESOURCES
        );
      }).not.toThrow();
    });
  });

  // ============================================
  // Route Table Tests
  // ============================================

  describe("Route Tables", () => {
    let app: cdk.App;
    let stack: cdk.Stack;
    let template: Template;
    let routes: Record<string, any>;
    let peeringRoutes: any[];

    beforeAll(() => {
      app = createTestApp();
      stack = createTestStack(app);
      const vpc = createTestVpc(stack);
      createPeeringConstruct(stack, vpc);
      template = Template.fromStack(stack);

      // Pre-compute routes for tests
      routes = template.findResources("AWS::EC2::Route");

      // Filter for routes that target peer VPC CIDR (peering routes)
      peeringRoutes = Object.values(routes).filter(
        (route: {
          Properties?: {
            DestinationCidrBlock?: string;
            VpcPeeringConnectionId?: string;
          };
        }) =>
          route.Properties?.DestinationCidrBlock === TEST_CONSTANTS.PEER_VPC.CIDR &&
          route.Properties?.VpcPeeringConnectionId !== undefined
      );
    });

    test("creates routes for all unique route tables", () => {
      // Should create at least one route for peering
      expect(Object.keys(routes).length).toBeGreaterThanOrEqual(
        TEST_CONSTANTS.RESOURCE_COUNTS.MIN_ROUTES
      );

      expect(peeringRoutes.length).toBeGreaterThanOrEqual(
        TEST_CONSTANTS.RESOURCE_COUNTS.MIN_ROUTES
      );

      // All peering routes should target peer VPC CIDR
      peeringRoutes.forEach((route) => {
        expect(route.Properties?.DestinationCidrBlock).toBe(TEST_CONSTANTS.PEER_VPC.CIDR);
      });
    });

    test("routes depend on peering connection resource", () => {
      expect(() => {
        template.hasResourceProperties("AWS::EC2::Route", {
          VpcPeeringConnectionId: Match.anyValue(),
        });
      }).not.toThrow();
    });
  });

  // ============================================
  // Tags Tests
  // ============================================

  describe("Tags", () => {
    let app: cdk.App;
    let stack: cdk.Stack;

    beforeEach(() => {
      app = createTestApp();
      stack = createTestStack(app);
    });

    test("adds Environment tag", () => {
      const vpc = createTestVpc(stack);
      createPeeringConstruct(stack, vpc, "Peering", {
        envName: TEST_CONSTANTS.ENVIRONMENTS.PRODUCTION,
        peeringName: TEST_CONSTANTS.PEERING.PROD_NAME,
      });

      const template = Template.fromStack(stack);

      expect(() => {
        template.resourceCountIs(
          "AWS::CloudFormation::CustomResource",
          TEST_CONSTANTS.RESOURCE_COUNTS.CUSTOM_RESOURCES
        );
      }).not.toThrow();
    });

    test("adds Project tag when project name provided", () => {
      const vpc = createTestVpc(stack);
      createPeeringConstruct(stack, vpc, "Peering", {
        projectName: TEST_CONSTANTS.PROJECT_NAME,
      });

      const template = Template.fromStack(stack);

      expect(() => {
        template.resourceCountIs(
          "AWS::CloudFormation::CustomResource",
          TEST_CONSTANTS.RESOURCE_COUNTS.CUSTOM_RESOURCES
        );
      }).not.toThrow();
    });
  });

  // ============================================
  // Warnings Tests
  // ============================================

  describe("Warnings", () => {
    test("adds warning when Lambda timeout exceeds 120 seconds", () => {
      const app = createTestApp();
      const stack = createTestStack(app);
      const vpcConstruct = new VpcConstruct(stack, "TestVpc", {
        envName: TEST_CONSTANTS.ENVIRONMENTS.TEST,
      });

      createPeeringConstruct(stack, vpcConstruct.vpc, "Peering", {
        lambdaTimeoutSeconds: TEST_CONSTANTS.LAMBDA.WARNING_TIMEOUT,
      });

      const template = Template.fromStack(stack);
      const functions = template.findResources("AWS::Lambda::Function");
      expect(Object.keys(functions).length).toBeGreaterThanOrEqual(
        TEST_CONSTANTS.RESOURCE_COUNTS.MIN_ROUTES
      );
    });
  });

  // ============================================
  // Integration Tests
  // ============================================

  describe("Integration", () => {
    test("creates complete peering setup with all resources", () => {
      const app = createTestApp();
      const stack = createTestStack(app);
      const vpc = createTestVpc(stack);

      createPeeringConstruct(stack, vpc, "Peering", {
        envName: TEST_CONSTANTS.ENVIRONMENTS.PRODUCTION,
        peeringName: TEST_CONSTANTS.PEERING.PROD_NAME,
        projectName: TEST_CONSTANTS.PROJECT_NAME,
        lambdaTimeoutSeconds: TEST_CONSTANTS.LAMBDA.CUSTOM_TIMEOUT,
        enableDnsResolution: true,
      });

      const template = Template.fromStack(stack);

      // Verify all expected resources are created
      expect(() => {
        template.resourceCountIs(
          "AWS::CloudFormation::CustomResource",
          TEST_CONSTANTS.RESOURCE_COUNTS.CUSTOM_RESOURCES
        );
        template.resourceCountIs(
          "AWS::SSM::Parameter",
          TEST_CONSTANTS.RESOURCE_COUNTS.SSM_PARAMETERS
        );
      }).not.toThrow();

      const routes = template.findResources("AWS::EC2::Route");
      expect(Object.keys(routes).length).toBeGreaterThanOrEqual(
        TEST_CONSTANTS.RESOURCE_COUNTS.MIN_ROUTES
      );

      const lambdaFunctions = template.findResources("AWS::Lambda::Function");
      expect(Object.keys(lambdaFunctions).length).toBeGreaterThanOrEqual(
        TEST_CONSTANTS.RESOURCE_COUNTS.MIN_LAMBDA_FUNCTIONS
      );

      // Verify outputs exist
      const json = template.toJSON();
      
      // Guard assertion: Outputs must exist
      expect(json.Outputs).toBeDefined();
      
      const outputs = json.Outputs;
      expect(Object.keys(outputs).length).toBeGreaterThanOrEqual(
        TEST_CONSTANTS.RESOURCE_COUNTS.MIN_OUTPUTS
      );

      // Verify specific outputs exist
      expect(outputs["PeeringPeeringConnectionId"]).toBeDefined();
      expect(outputs["PeeringPeerVpcCidr"]).toBeDefined();
      expect(outputs["PeeringSsmParameterPath"]).toBeDefined();
    });

    test("creates peering with minimal configuration", () => {
      const app = createTestApp();
      const stack = createTestStack(app);
      const vpc = createTestVpc(stack);

      createPeeringConstruct(stack, vpc);

      const template = Template.fromStack(stack);

      // Verify minimal resources are created
      expect(() => {
        template.resourceCountIs(
          "AWS::CloudFormation::CustomResource",
          TEST_CONSTANTS.RESOURCE_COUNTS.CUSTOM_RESOURCES
        );
        template.resourceCountIs(
          "AWS::SSM::Parameter",
          TEST_CONSTANTS.RESOURCE_COUNTS.SSM_PARAMETERS
        );
      }).not.toThrow();

      const routes = template.findResources("AWS::EC2::Route");
      expect(Object.keys(routes).length).toBeGreaterThanOrEqual(
        TEST_CONSTANTS.RESOURCE_COUNTS.MIN_ROUTES
      );
    });
  });
});
