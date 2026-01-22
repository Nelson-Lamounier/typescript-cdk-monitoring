/** @format */
/// <reference types="jest" />

/**
 * WebappApiStack Tests: API Gateway Integrations
 *
 * Tests API Gateway integration with Lambda functions:
 * - REST API resource creation (/articles, /{slug}, /tag/{tag})
 * - HTTP method configuration
 * - Lambda proxy integrations
 * - Lambda invoke permissions
 * - Request/response mappings
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
  validateLambdaProxyIntegration,
  validateLambdaInvokePermission,
} from "../../../utils/webapp-test-helpers";

// ============================================================================
// API GATEWAY INTEGRATIONS TESTS
// ============================================================================

describe("WebappApiStack: API Gateway Integrations", () => {
  // ============================================================================
  // REST API RESOURCES
  // ============================================================================

  describe("REST API Resources", () => {
    let template: Template;
    let resources: Array<{ pathPart: string }>;

    beforeAll(() => {
      const app = createTestApp();
      const stack = createTestApiStack(app);
      template = Template.fromStack(stack);

      // Pre-compute resource data
      const apiResources = template.findResources("AWS::ApiGateway::Resource");
      resources = Object.values(apiResources).map((resource) => {
        const props = (resource as { Properties: Record<string, unknown> })
          .Properties;
        return {
          pathPart: props.PathPart as string,
        };
      });
    });

    test("should create /articles resource", () => {
      template.hasResourceProperties("AWS::ApiGateway::Resource", {
        PathPart: "articles",
      });
    });

    test("should create /{slug} resource for article retrieval", () => {
      template.hasResourceProperties("AWS::ApiGateway::Resource", {
        PathPart: "{slug}",
      });
    });

    test("should create /articles/tag resource", () => {
      template.hasResourceProperties("AWS::ApiGateway::Resource", {
        PathPart: "tag",
      });
    });

    test("should create /articles/tag/{tag} resource", () => {
      // Should have both 'tag' path and '{tag}' parameter
      const tagResources = resources.filter(
        (r) => r.pathPart === "tag" || r.pathPart === "{tag}"
      );

      expect(tagResources.length).toBeGreaterThanOrEqual(2);
    });

    test("should use curly braces for path parameters", () => {
      const parameterResources = resources.filter((r) =>
        r.pathPart.includes("{")
      );

      // Guard assertion
      expect(parameterResources.length).toBeGreaterThan(0);

      parameterResources.forEach((resource) => {
        expect(resource.pathPart).toMatch(/^\{[a-z]+\}$/);
      });
    });
  });

  // ============================================================================
  // HTTP METHODS
  // ============================================================================

  describe("HTTP Methods", () => {
    let template: Template;
    let methods: Array<{ httpMethod: string; resourceId: string }>;

    beforeAll(() => {
      const app = createTestApp();
      const stack = createTestApiStack(app);
      template = Template.fromStack(stack);

      // Pre-compute method data
      const apiMethods = template.findResources("AWS::ApiGateway::Method");
      methods = Object.values(apiMethods).map((method) => {
        const props = (method as { Properties: Record<string, unknown> })
          .Properties;
        return {
          httpMethod: props.HttpMethod as string,
          resourceId: props.ResourceId as string,
        };
      });
    });

    test("should create GET /articles endpoint", () => {
      template.hasResourceProperties("AWS::ApiGateway::Method", {
        HttpMethod: API_TEST_CONSTANTS.HTTP_METHODS.GET,
        ResourceId: Match.anyValue(),
        RestApiId: Match.anyValue(),
      });
    });

    test("should create GET /articles/{slug} endpoint", () => {
      // Verify both resource and method exist
      template.hasResourceProperties("AWS::ApiGateway::Resource", {
        PathPart: "{slug}",
      });

      template.hasResourceProperties("AWS::ApiGateway::Method", {
        HttpMethod: API_TEST_CONSTANTS.HTTP_METHODS.GET,
      });
    });

    test("should create GET /articles/tag/{tag} endpoint", () => {
      // Verify resource exists
      template.hasResourceProperties("AWS::ApiGateway::Resource", {
        PathPart: "{tag}",
      });

      template.hasResourceProperties("AWS::ApiGateway::Method", {
        HttpMethod: API_TEST_CONSTANTS.HTTP_METHODS.GET,
      });
    });

    test("should create OPTIONS methods for CORS", () => {
      const optionsMethods = methods.filter(
        (m) => m.httpMethod === API_TEST_CONSTANTS.HTTP_METHODS.OPTIONS
      );

      // Guard assertion - OPTIONS methods should exist
      expect(optionsMethods.length).toBeGreaterThan(0);
    });

    test("should only use GET and OPTIONS methods", () => {
      const allowedMethods = [
        API_TEST_CONSTANTS.HTTP_METHODS.GET,
        API_TEST_CONSTANTS.HTTP_METHODS.OPTIONS,
      ];

      // Guard assertion
      expect(methods.length).toBeGreaterThan(0);

      methods.forEach((method) => {
        expect(allowedMethods).toContain(method.httpMethod);
      });
    });
  });

  // ============================================================================
  // LAMBDA INTEGRATIONS
  // ============================================================================

  describe("Lambda Integrations", () => {
    let template: Template;
    let integrations: Array<{ type: string; httpMethod?: string }>;

    beforeAll(() => {
      const app = createTestApp();
      const stack = createTestApiStack(app);
      template = Template.fromStack(stack);

      // Pre-compute integration data
      const apiMethods = template.findResources("AWS::ApiGateway::Method");
      integrations = Object.values(apiMethods)
        .map((method) => {
          const props = (method as { Properties: Record<string, unknown> })
            .Properties;
          const integration = props.Integration as {
            Type: string;
            IntegrationHttpMethod?: string;
          };

          return {
            type: integration?.Type,
            httpMethod: integration?.IntegrationHttpMethod,
          };
        })
        .filter((i) => i.type); // Filter out methods without integrations
    });

    test("should configure Lambda proxy integrations", () => {
      const expectedIntegration = validateLambdaProxyIntegration();

      template.hasResourceProperties("AWS::ApiGateway::Method", {
        HttpMethod: API_TEST_CONSTANTS.HTTP_METHODS.GET,
        Integration: expectedIntegration,
      });
    });

    test("should use AWS_PROXY integration type for Lambda", () => {
      const lambdaIntegrations = integrations.filter(
        (i) => i.type === "AWS_PROXY"
      );

      // Guard assertion - should have 3 Lambda integrations
      expect(lambdaIntegrations.length).toBe(
        API_TEST_CONSTANTS.RESOURCE_COUNTS.LAMBDA
      );
    });

    test("should use POST for Lambda proxy integration method", () => {
      const lambdaIntegrations = integrations.filter(
        (i) => i.type === "AWS_PROXY"
      );

      // Guard assertion
      expect(lambdaIntegrations.length).toBeGreaterThan(0);

      lambdaIntegrations.forEach((integration) => {
        expect(integration.httpMethod).toBe("POST");
      });
    });

    test("should configure integration timeout", () => {
      template.hasResourceProperties("AWS::ApiGateway::Method", {
        HttpMethod: API_TEST_CONSTANTS.HTTP_METHODS.GET,
        Integration: {
          TimeoutInMillis: 29000, // API Gateway default
        },
      });
    });
  });

  // ============================================================================
  // LAMBDA PERMISSIONS
  // ============================================================================

  describe("Lambda Permissions", () => {
    let template: Template;
    let permissions: Array<{ action: string; principal: string }>;

    beforeAll(() => {
      const app = createTestApp();
      const stack = createTestApiStack(app);
      template = Template.fromStack(stack);

      // Pre-compute permission data
      const lambdaPermissions = template.findResources(
        "AWS::Lambda::Permission"
      );
      permissions = Object.values(lambdaPermissions).map((permission) => {
        const props = (permission as { Properties: Record<string, unknown> })
          .Properties;
        return {
          action: props.Action as string,
          principal: props.Principal as string,
        };
      });
    });

    test("should grant API Gateway permission to invoke Lambda", () => {
      const expectedPermission = validateLambdaInvokePermission();

      template.hasResourceProperties("AWS::Lambda::Permission", {
        Action: expectedPermission.Action,
        Principal: expectedPermission.Principal,
      });
    });

    test("should create Lambda permissions for all functions", () => {
      // Should have at least 3 permissions (one per Lambda function)
      expect(permissions.length).toBeGreaterThanOrEqual(
        API_TEST_CONSTANTS.RESOURCE_COUNTS.LAMBDA
      );
    });

    test("should use lambda:InvokeFunction action", () => {
      // Guard assertion
      expect(permissions.length).toBeGreaterThan(0);

      permissions.forEach((permission) => {
        expect(permission.action).toBe("lambda:InvokeFunction");
      });
    });

    test("should use apigateway.amazonaws.com principal", () => {
      // Guard assertion
      expect(permissions.length).toBeGreaterThan(0);

      permissions.forEach((permission) => {
        expect(permission.principal).toBe("apigateway.amazonaws.com");
      });
    });

    test("should scope permissions to specific API Gateway", () => {
      template.hasResourceProperties("AWS::Lambda::Permission", {
        SourceArn: Match.stringLikeRegexp("execute-api"),
      });
    });
  });

  // ============================================================================
  // REQUEST VALIDATION
  // ============================================================================

  describe("Request Validation", () => {
    let template: Template;

    beforeAll(() => {
      const app = createTestApp();
      const stack = createTestApiStack(app);
      template = Template.fromStack(stack);
    });

    test("should configure request validator", () => {
      template.resourceCountIs("AWS::ApiGateway::RequestValidator", 1);
    });

    test("should validate request parameters", () => {
      template.hasResourceProperties("AWS::ApiGateway::RequestValidator", {
        ValidateRequestParameters: true,
      });
    });

    test("should enable request body validation", () => {
      template.hasResourceProperties("AWS::ApiGateway::RequestValidator", {
        ValidateRequestBody: true,
      });
    });
  });

  // ============================================================================
  // INTEGRATION RESPONSES
  // ============================================================================

  describe("Integration Responses", () => {
    let template: Template;
    let methodsWithIntegrationResponses: Array<{
      httpMethod: string;
      statusCode: string;
    }>;

    beforeAll(() => {
      const app = createTestApp();
      const stack = createTestApiStack(app);
      template = Template.fromStack(stack);

      // Pre-compute methods with integration responses
      const apiMethods = template.findResources("AWS::ApiGateway::Method");
      methodsWithIntegrationResponses = Object.values(apiMethods)
        .map((method) => {
          const props = (method as { Properties: Record<string, unknown> })
            .Properties;
          const integration = props.Integration as {
            IntegrationResponses?: Array<{ StatusCode: string }>;
          };
          const responses = integration?.IntegrationResponses || [];

          return responses.map((response) => ({
            httpMethod: props.HttpMethod as string,
            statusCode: response.StatusCode,
          }));
        })
        .flat()
        .filter((r) => r.statusCode);
    });

    test("should configure CORS response headers in OPTIONS methods", () => {
      template.hasResourceProperties("AWS::ApiGateway::Method", {
        HttpMethod: "OPTIONS",
        Integration: {
          IntegrationResponses: [
            Match.objectLike({
              StatusCode: "200",
              ResponseParameters: Match.objectLike({
                "method.response.header.Access-Control-Allow-Headers":
                  Match.anyValue(),
                "method.response.header.Access-Control-Allow-Methods":
                  Match.anyValue(),
                "method.response.header.Access-Control-Allow-Origin":
                  Match.anyValue(),
              }),
            }),
          ],
        },
      });
    });

    test("should return 200 status code for successful CORS preflight", () => {
      const corsResponses = methodsWithIntegrationResponses.filter(
        (r) => r.httpMethod === "OPTIONS" && r.statusCode === "200"
      );

      // Guard assertion - CORS OPTIONS should exist
      expect(corsResponses.length).toBeGreaterThan(0);
    });
  });
});
