/** @format */
/// <reference types="jest" />

/**
 * WebappApiStack Tests: Lambda Functions
 *
 * Tests Lambda function creation and configuration:
 * - Function creation (Get, List, List by Tag)
 * - Environment variables configuration
 * - CloudWatch log groups
 * - Runtime and timeout settings
 * - Memory allocation
 *
 * Pattern: No conditionals, guard assertions, pre-computed data
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
  validateLambdaEnvironment,
  getLogRetentionDays,
} from "../../../utils/webapp-test-helpers";

// ============================================================================
// LAMBDA FUNCTIONS TESTS
// ============================================================================

describe("WebappApiStack: Lambda Functions", () => {
  // ============================================================================
  // FUNCTION CREATION
  // ============================================================================

  describe("Function Creation", () => {
    let template: Template;
    let functionNames: string[];

    beforeAll(() => {
      const app = createTestApp();
      const stack = createTestApiStack(app);
      template = Template.fromStack(stack);

      // Pre-compute function names for validation
      functionNames = [
        `${BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT}-${API_TEST_CONSTANTS.FUNCTION_NAMES.GET_ARTICLE}`,
        `${BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT}-${API_TEST_CONSTANTS.FUNCTION_NAMES.LIST_ARTICLES}`,
        `${BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT}-${API_TEST_CONSTANTS.FUNCTION_NAMES.LIST_BY_TAG}`,
      ];
    });

    // eslint-disable-next-line jest/expect-expect -- template.resource CountIs throws on failure
    test("should create all three Lambda functions", () => {
      template.resourceCountIs(
        "AWS::Lambda::Function",
        API_TEST_CONSTANTS.RESOURCE_COUNTS.LAMBDA
      );
    });

    // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
    test("should create Get Article function with correct configuration", () => {
      template.hasResourceProperties("AWS::Lambda::Function", {
        FunctionName: functionNames[0],
        Handler: "index.handler",
        Runtime: Match.stringLikeRegexp("nodejs"),
        Timeout: API_TEST_CONSTANTS.TIMEOUT.SECONDS,
        MemorySize: API_TEST_CONSTANTS.MEMORY.MB,
      });
    });

    // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
    test("should create List Articles function", () => {
      template.hasResourceProperties("AWS::Lambda::Function", {
        FunctionName: functionNames[1],
        Handler: "index.handler",
      });
    });

    // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
    test("should create List By Tag function", () => {
      template.hasResourceProperties("AWS::Lambda::Function", {
        FunctionName: functionNames[2],
        Handler: "index.handler",
      });
    });

    test("should use Node.js runtime for all functions", () => {
      const functions = template.findResources("AWS::Lambda::Function");
      const functionList = Object.values(functions);

      // Guard assertion
      expect(functionList.length).toBe(
        API_TEST_CONSTANTS.RESOURCE_COUNTS.LAMBDA
      );

      functionList.forEach((fn) => {
        const runtime = (fn as { Properties: { Runtime: string } }).Properties
          .Runtime;
        expect(runtime).toMatch(/^nodejs/);
      });
    });

    test("should set consistent timeout for all functions", () => {
      const functions = template.findResources("AWS::Lambda::Function");
      const functionList = Object.values(functions);

      // Guard assertion
      expect(functionList.length).toBe(
        API_TEST_CONSTANTS.RESOURCE_COUNTS.LAMBDA
      );

      functionList.forEach((fn) => {
        const timeout = (fn as { Properties: { Timeout: number } }).Properties
          .Timeout;
        expect(timeout).toBe(API_TEST_CONSTANTS.TIMEOUT.SECONDS);
      });
    });

    test("should set consistent memory size for all functions", () => {
      const functions = template.findResources("AWS::Lambda::Function");
      const functionList = Object.values(functions);

      // Guard assertion
      expect(functionList.length).toBe(
        API_TEST_CONSTANTS.RESOURCE_COUNTS.LAMBDA
      );

      functionList.forEach((fn) => {
        const memory = (fn as { Properties: { MemorySize: number } }).Properties
          .MemorySize;
        expect(memory).toBe(API_TEST_CONSTANTS.MEMORY.MB);
      });
    });
  });

  // ============================================================================
  // ENVIRONMENT VARIABLES
  // ============================================================================

  describe("Environment Variables", () => {
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
    test("should configure Lambda environment variables correctly in development", () => {
      const expectedEnv = validateLambdaEnvironment(
        API_TEST_CONSTANTS.TABLE_NAMES.ARTICLES,
        API_TEST_CONSTANTS.BUCKET_NAMES.ASSETS,
        BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        false
      );

      devTemplate.hasResourceProperties("AWS::Lambda::Function", {
        Environment: expectedEnv,
      });
    });

    // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
    test("should set LOG_LEVEL to DEBUG in development", () => {
      devTemplate.hasResourceProperties("AWS::Lambda::Function", {
        Environment: {
          Variables: Match.objectLike({
            LOG_LEVEL: "DEBUG",
          }),
        },
      });
    });

    // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
    test("should set LOG_LEVEL to INFO in production", () => {
      prodTemplate.hasResourceProperties("AWS::Lambda::Function", {
        Environment: {
          Variables: Match.objectLike({
            LOG_LEVEL: "INFO",
          }),
        },
      });
    });

    // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
    test("should include DynamoDB table name in environment", () => {
      devTemplate.hasResourceProperties("AWS::Lambda::Function", {
        Environment: {
          Variables: Match.objectLike({
            TABLE_NAME: API_TEST_CONSTANTS.TABLE_NAMES.ARTICLES,
          }),
        },
      });
    });

    // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
    test("should include S3 bucket name in environment", () => {
      devTemplate.hasResourceProperties("AWS::Lambda::Function", {
        Environment: {
          Variables: Match.objectLike({
            ASSETS_BUCKET_NAME: API_TEST_CONSTANTS.BUCKET_NAMES.ASSETS,
          }),
        },
      });
    });

    // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
    test("should include GSI names in environment", () => {
      devTemplate.hasResourceProperties("AWS::Lambda::Function", {
        Environment: {
          Variables: Match.objectLike({
            GSI1_NAME: "gsi1-status-date",
            GSI2_NAME: "gsi2-tag-date",
          }),
        },
      });
    });

    // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
    test("should include environment name in variables", () => {
      devTemplate.hasResourceProperties("AWS::Lambda::Function", {
        Environment: {
          Variables: Match.objectLike({
            ENVIRONMENT: BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
          }),
        },
      });
    });
  });

  // ============================================================================
  // CLOUDWATCH LOG GROUPS
  // ============================================================================

  describe("CloudWatch Log Groups", () => {
    let devTemplate: Template;
    let prodTemplate: Template;
    let devLogGroups: Array<{ logGroupName: string; retention: number }>;
    let prodLogGroups: Array<{ logGroupName: string; retention: number }>;

    beforeAll(() => {
      const devApp = createTestApp();
      const devStack = createTestApiStack(devApp);
      devTemplate = Template.fromStack(devStack);

      const prodApp = createTestApp();
      const prodStack = createTestApiStack(prodApp, API_TEST_CONSTANTS.STACK_IDS.API_PROD);
      prodTemplate = Template.fromStack(prodStack);

      // Pre-compute log group data
      const devLogs = devTemplate.findResources("AWS::Logs::LogGroup");
      devLogGroups = Object.values(devLogs)
        .map((lg) => {
          const props = (lg as { Properties: Record<string, unknown> })
            .Properties;
          return {
            logGroupName: props.LogGroupName as string,
            retention: props.RetentionInDays as number,
          };
        })
        .filter((lg) => lg.logGroupName?.includes("/aws/lambda/"));

      const prodLogs = prodTemplate.findResources("AWS::Logs::LogGroup");
      prodLogGroups = Object.values(prodLogs)
        .map((lg) => {
          const props = (lg as { Properties: Record<string, unknown> })
            .Properties;
          return {
            logGroupName: props.LogGroupName as string,
            retention: props.RetentionInDays as number,
          };
        })
        .filter((lg) => lg.logGroupName?.includes("/aws/lambda/"));
    });

    // eslint-disable-next-line jest/expect-expect -- template.resourceCountIs throws on failure
    test("should create CloudWatch Log Groups for Lambda functions", () => {
      // Should have 4 log groups: 3 Lambda + 1 API Gateway
      devTemplate.resourceCountIs(
        "AWS::Logs::LogGroup",
        API_TEST_CONSTANTS.RESOURCE_COUNTS.LOG_GROUP
      );
    });

    // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
    test("should create log groups with Lambda naming pattern", () => {
      devTemplate.hasResourceProperties("AWS::Logs::LogGroup", {
        LogGroupName: Match.stringLikeRegexp("/aws/lambda/"),
      });
    });

    test("should configure development log retention to 1 week", () => {
      const expectedRetention = getLogRetentionDays(false);

      // Guard assertion
      expect(devLogGroups).toBeDefined();
      expect(devLogGroups.length).toBeGreaterThan(0);

      devLogGroups.forEach((lg) => {
        expect(lg.retention).toBe(expectedRetention);
      });
    });

    test("should configure production log retention to 1 month", () => {
      const expectedRetention = getLogRetentionDays(true);

      // Guard assertion
      expect(prodLogGroups).toBeDefined();
      expect(prodLogGroups.length).toBeGreaterThan(0);

      prodLogGroups.forEach((lg) => {
        expect(lg.retention).toBe(expectedRetention);
      });
    });

    test("should have longer log retention in production than development", () => {
      const devRetention = getLogRetentionDays(false);
      const prodRetention = getLogRetentionDays(true);

      expect(prodRetention).toBeGreaterThan(devRetention);
    });
  });

  // ============================================================================
  // FUNCTION NAMING
  // ============================================================================

  describe("Function Naming", () => {
    let template: Template;
    let functions: Array<{ name: string; handler: string }>;

    beforeAll(() => {
      const app = createTestApp();
      const stack = createTestApiStack(app);
      template = Template.fromStack(stack);

      // Pre-compute function data
      const fns = template.findResources("AWS::Lambda::Function");
      functions = Object.values(fns).map((fn) => {
        const props = (fn as { Properties: Record<string, unknown> }).Properties;
        return {
          name: props.FunctionName as string,
          handler: props.Handler as string,
        };
      });
    });

    test("should prefix function names with environment", () => {
      // Guard assertion
      expect(functions.length).toBe(API_TEST_CONSTANTS.RESOURCE_COUNTS.LAMBDA);

      functions.forEach((fn) => {
        expect(fn.name).toMatch(
          new RegExp(
            `^${BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT}-webapp-`
          )
        );
      });
    });

    test("should use consistent handler naming", () => {
      // Guard assertion
      expect(functions.length).toBe(API_TEST_CONSTANTS.RESOURCE_COUNTS.LAMBDA);

      functions.forEach((fn) => {
        expect(fn.handler).toBe("index.handler");
      });
    });
  });
});
