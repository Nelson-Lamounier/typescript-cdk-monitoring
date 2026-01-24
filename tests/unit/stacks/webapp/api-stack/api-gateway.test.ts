/** @format */
/// <reference types="jest" />

/**
 * WebappApiStack Tests: API Gateway Creation & Configuration
 *
 * Tests API Gateway REST API creation and configuration:
 * - REST API creation with correct naming
 * - CloudWatch logging configuration
 * - CORS configuration
 * - Throttling limits (dev vs prod)
 *
 * Pattern: Follows monitoring-efs-stack test structure
 * - Uses beforeAll for stack creation
 * - No conditionals in test bodies
 * - Guard assertions for forEach loops
 */

import { Template, Match } from "aws-cdk-lib/assertions";

import {
  API_TEST_CONSTANTS,
  createTestApiStack,
} from "../fixtures/api-stack-fixtures";
import {
  createTestApp,
  BASE_TEST_CONSTANTS,
} from "../../../utils/stack-test-utils";
import {
  validateCorsPreflightIntegration,
  validateThrottling,
  getLogRetentionDays,
} from "../../../utils/webapp-test-helpers";

// ============================================================================
// API GATEWAY CREATION & CONFIGURATION TESTS
// ============================================================================

describe("WebappApiStack: API Gateway Creation", () => {
  // ============================================================================
  // REST API CREATION
  // ============================================================================

  describe("REST API Creation", () => {
    let template: Template;

    beforeAll(() => {
      const app = createTestApp();
      const stack = createTestApiStack(app);
      template = Template.fromStack(stack);
    });

    // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
    test("should create REST API with correct configuration", () => {
      template.resourceCountIs(
        "AWS::ApiGateway::RestApi",
        API_TEST_CONSTANTS.RESOURCE_COUNTS.API
      );

      template.hasResourceProperties("AWS::ApiGateway::RestApi", {
        Name: API_TEST_CONSTANTS.API_NAMES.FULL_DEV,
        Description: Match.stringLikeRegexp("Articles API"),
        EndpointConfiguration: {
          Types: ["REGIONAL"],
        },
      });
    });

    // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
    test("should use regional endpoint configuration", () => {
      template.hasResourceProperties("AWS::ApiGateway::RestApi", {
        EndpointConfiguration: {
          Types: ["REGIONAL"],
        },
      });
    });

    // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
    test("should include descriptive API name with environment prefix", () => {
      template.hasResourceProperties("AWS::ApiGateway::RestApi", {
        Name: Match.stringLikeRegexp(
          `${BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT}.*articles-api`
        ),
      });
    });
  });

  // ============================================================================
  // CLOUDWATCH LOGGING
  // ============================================================================

  describe("CloudWatch Logging", () => {
    let devTemplate: Template;
    let prodTemplate: Template;

    beforeAll(() => {
      const devApp = createTestApp();
      const devStack = createTestApiStack(devApp);
      devTemplate = Template.fromStack(devStack);

      const prodApp = createTestApp();
      const prodStack = createTestApiStack(prodApp, API_TEST_CONSTANTS.STACK_IDS.API_PROD);
      prodTemplate = Template.fromStack(prodStack);
    });

    // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
    test("should enable CloudWatch logging for API Gateway", () => {
      devTemplate.hasResourceProperties("AWS::ApiGateway::Stage", {
        StageName: "api",
        MethodSettings: [
          Match.objectLike({
            LoggingLevel: "INFO",
            MetricsEnabled: true,
          }),
        ],
      });
    });

    // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
    test("should create CloudWatch Log Group for API Gateway", () => {
      devTemplate.hasResourceProperties("AWS::Logs::LogGroup", {
        LogGroupName: Match.stringLikeRegexp("/aws/apigateway/"),
      });
    });

    // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
    test("should configure development log retention to 1 week", () => {
      const expectedRetention = getLogRetentionDays(false);

      devTemplate.hasResourceProperties("AWS::Logs::LogGroup", {
        LogGroupName: Match.stringLikeRegexp("/aws/apigateway/"),
        RetentionInDays: expectedRetention,
      });
    });

    // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
    test("should configure production log retention to 1 month", () => {
      const expectedRetention = getLogRetentionDays(true);

      prodTemplate.hasResourceProperties("AWS::Logs::LogGroup", {
        LogGroupName: Match.stringLikeRegexp("/aws/apigateway/"),
        RetentionInDays: expectedRetention,
      });
    });

    // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
    test("should disable data trace logging in development", () => {
      // Data trace is disabled in development for cost optimization
      devTemplate.hasResourceProperties("AWS::ApiGateway::Stage", {
        MethodSettings: [
          Match.objectLike({
            DataTraceEnabled: false,
          }),
        ],
      });
    });
  });

  // ============================================================================
  // CORS CONFIGURATION
  // ============================================================================

  describe("CORS Configuration", () => {
    let templateWithDefaultCors: Template;
    let templateWithCustomCors: Template;

    beforeAll(() => {
      // Default CORS (["*"] for development)
      const defaultApp = createTestApp();
      const defaultStack = createTestApiStack(defaultApp);
      templateWithDefaultCors = Template.fromStack(defaultStack);

      // Custom CORS origins
      const customApp = createTestApp();
      const customStack = createTestApiStack(customApp, "CustomCorsApiStack");
      templateWithCustomCors = Template.fromStack(customStack);
    });

    // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
    test("should create OPTIONS method for CORS preflight", () => {
      templateWithDefaultCors.hasResourceProperties("AWS::ApiGateway::Method", {
        HttpMethod: API_TEST_CONSTANTS.HTTP_METHODS.OPTIONS,
      });
    });

    // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
    test("should configure CORS with correct headers and methods", () => {
      const expectedIntegration = validateCorsPreflightIntegration(
        [...API_TEST_CONSTANTS.CORS.HEADERS],
        [...API_TEST_CONSTANTS.CORS.METHODS]
      );

      templateWithCustomCors.hasResourceProperties("AWS::ApiGateway::Method", {
        HttpMethod: API_TEST_CONSTANTS.HTTP_METHODS.OPTIONS,
        Integration: expectedIntegration,
      });
    });

    // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
    test("should set CORS max age header", () => {
      templateWithDefaultCors.hasResourceProperties("AWS::ApiGateway::Method", {
        HttpMethod: "OPTIONS",
        Integration: {
          IntegrationResponses: [
            Match.objectLike({
              ResponseParameters: Match.objectLike({
                "method.response.header.Access-Control-Max-Age": Match.anyValue(),
              }),
            }),
          ],
        },
      });
    });
  });

  // ============================================================================
  // THROTTLING CONFIGURATION
  // ============================================================================

  describe("Throttling Configuration", () => {
    let devTemplate: Template;
    let prodTemplate: Template;

    beforeAll(() => {
      const devApp = createTestApp();
      const devStack = createTestApiStack(devApp);
      devTemplate = Template.fromStack(devStack);

      const prodApp = createTestApp();
      const prodStack = createTestApiStack(prodApp, API_TEST_CONSTANTS.STACK_IDS.API_PROD);
      prodTemplate = Template.fromStack(prodStack);
    });

    // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
    test("should configure throttling limits for development", () => {
      const expectedThrottling = validateThrottling(
        API_TEST_CONSTANTS.THROTTLE.DEV_RATE,
        API_TEST_CONSTANTS.THROTTLE.DEV_BURST
      );

      devTemplate.hasResourceProperties("AWS::ApiGateway::Stage", {
        MethodSettings: [expectedThrottling],
      });
    });

    // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
    test("should configure throttling limits for production", () => {
      const expectedThrottling = validateThrottling(
        API_TEST_CONSTANTS.THROTTLE.PROD_RATE,
        API_TEST_CONSTANTS.THROTTLE.PROD_BURST
      );

      prodTemplate.hasResourceProperties("AWS::ApiGateway::Stage", {
        MethodSettings: [expectedThrottling],
      });
    });

    test("should have higher throttling limits in production than development", () => {
      const prodRate = API_TEST_CONSTANTS.THROTTLE.PROD_RATE;
      const devRate = API_TEST_CONSTANTS.THROTTLE.DEV_RATE;
      const prodBurst = API_TEST_CONSTANTS.THROTTLE.PROD_BURST;
      const devBurst = API_TEST_CONSTANTS.THROTTLE.DEV_BURST;

      expect(prodRate).toBeGreaterThan(devRate);
      expect(prodBurst).toBeGreaterThan(devBurst);
    });
  });

  // ============================================================================
  // API DEPLOYMENT CONFIGURATION
  // ============================================================================

  describe("API Deployment", () => {
    let devTemplate: Template;
    let prodTemplate: Template;

    beforeAll(() => {
      const devApp = createTestApp();
      const devStack = createTestApiStack(devApp);
      devTemplate = Template.fromStack(devStack);
      
      const prodApp = createTestApp();
      const prodStack = createTestApiStack(prodApp, API_TEST_CONSTANTS.STACK_IDS.API_PROD);
      prodTemplate = Template.fromStack(prodStack);
    });

    // eslint-disable-next-line jest/expect-expect -- template.resourceCountIs throws on failure
    test("should create API deployment", () => {
      devTemplate.resourceCountIs("AWS::ApiGateway::Deployment", 1);
    });

    // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
    test("should create API stage with correct name", () => {
      devTemplate.hasResourceProperties("AWS::ApiGateway::Stage", {
        StageName: "api",
      });
    });

    // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
    test("should enable tracing in API stage for production", () => {
      prodTemplate.hasResourceProperties("AWS::ApiGateway::Stage", {
        TracingEnabled: true,
      });
    });
    
    // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
    test("should disable tracing in API stage for development", () => {
      devTemplate.hasResourceProperties("AWS::ApiGateway::Stage", {
        TracingEnabled: false,
      });
    });
  });
});
