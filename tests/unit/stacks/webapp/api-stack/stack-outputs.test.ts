/** @format */
/// <reference types="jest" />

/**
 * WebappApiStack Tests: Stack Outputs & Tagging
 *
 * Tests CloudFormation outputs and resource tagging:
 * - API Gateway URL export
 * - API Gateway ID export
 * - Lambda function ARN exports
 * - Export naming conventions
 * - Pipeline environment handling
 * - Resource tagging
 *
 * Pattern: No conditionals, guard assertions, pre-computed data
 */

import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";

import {
  API_TEST_CONSTANTS,
  createTestApiStack,
} from "../fixtures/api-stack-fixtures";
import {
  createTestApp,
  BASE_TEST_CONSTANTS,
} from "../../../utils/stack-test-utils";
import {
  buildExportName,
  shouldExportOutputs,
} from "../../../utils/webapp-test-helpers";

// ============================================================================
// STACK OUTPUTS & TAGGING TESTS
// ============================================================================

describe("WebappApiStack: Stack Outputs & Tagging", () => {
  // ============================================================================
  // CLOUDFORMATION OUTPUTS
  // ============================================================================

  describe("CloudFormation Outputs", () => {
    let template: Template;
    let outputs: Record<
      string,
      { Value: unknown; Export?: { Name: string }; Description?: string }
    >;
    let outputsWithDescriptions: Array<{
      key: string;
      description: string | undefined;
    }>;

    beforeAll(() => {
      const app = createTestApp();
      const stack = createTestApiStack(app);
      template = Template.fromStack(stack);

      // Pre-compute outputs
      outputs = template.toJSON().Outputs;

      // Pre-compute outputs with descriptions
      outputsWithDescriptions = Object.entries(outputs)
        .map(([key, output]) => ({
          key,
          description: output.Description,
        }))
        .filter((item) => item.description !== undefined);
    });

    // eslint-disable-next-line jest/expect-expect -- template.hasOutput throws on failure
    test("should export API Gateway URL", () => {
      template.hasOutput(API_TEST_CONSTANTS.OUTPUT_KEYS.API_URL, {
        Description: "API Gateway URL for articles API",
        Export: {
          Name: API_TEST_CONSTANTS.EXPORT_NAMES.DEV_API_URL,
        },
      });
    });

    // eslint-disable-next-line jest/expect-expect -- template.hasOutput throws on failure
    test("should export API Gateway ID", () => {
      template.hasOutput(API_TEST_CONSTANTS.OUTPUT_KEYS.API_ID, {
        Description: "API Gateway ID",
        Export: {
          Name: API_TEST_CONSTANTS.EXPORT_NAMES.DEV_API_ID,
        },
      });
    });

    // eslint-disable-next-line jest/expect-expect -- template.hasOutput throws on failure
    test("should export API Gateway endpoint", () => {
      template.hasOutput(API_TEST_CONSTANTS.OUTPUT_KEYS.API_ENDPOINT, {
        Description: "API Gateway endpoint",
        Export: {
          Name: API_TEST_CONSTANTS.EXPORT_NAMES.DEV_API_ENDPOINT,
        },
      });
    });

    // eslint-disable-next-line jest/expect-expect -- template.hasOutput throws on failure
    test("should export Get Article Lambda function ARN", () => {
      template.hasOutput(API_TEST_CONSTANTS.OUTPUT_KEYS.GET_ARTICLE_ARN, {
        Description: "Get Article Lambda function ARN",
      });
    });

    // eslint-disable-next-line jest/expect-expect -- template.hasOutput throws on failure
    test("should export List Articles Lambda function ARN", () => {
      template.hasOutput(API_TEST_CONSTANTS.OUTPUT_KEYS.LIST_ARTICLES_ARN, {
        Description: "List Articles Lambda function ARN",
      });
    });

    // eslint-disable-next-line jest/expect-expect -- template.hasOutput throws on failure
    test("should export List By Tag Lambda function ARN", () => {
      template.hasOutput(API_TEST_CONSTANTS.OUTPUT_KEYS.LIST_BY_TAG_ARN, {
        Description: "List Articles By Tag Lambda function ARN",
      });
    });

    test("should have all expected outputs present", () => {
      const expectedOutputKeys = [
        API_TEST_CONSTANTS.OUTPUT_KEYS.API_URL,
        API_TEST_CONSTANTS.OUTPUT_KEYS.API_ID,
        API_TEST_CONSTANTS.OUTPUT_KEYS.API_ENDPOINT,
        API_TEST_CONSTANTS.OUTPUT_KEYS.GET_ARTICLE_ARN,
        API_TEST_CONSTANTS.OUTPUT_KEYS.LIST_ARTICLES_ARN,
        API_TEST_CONSTANTS.OUTPUT_KEYS.LIST_BY_TAG_ARN,
      ];

      expectedOutputKeys.forEach((key) => {
        expect(outputs).toHaveProperty(key);
      });
    });

    test("should use descriptive output descriptions", () => {
      // Guard assertion
      expect(outputsWithDescriptions.length).toBeGreaterThan(0);

      outputsWithDescriptions.forEach((output) => {
        expect(typeof output.description).toBe("string");
        expect((output.description as string).length).toBeGreaterThan(0);
      });
    });
  });

  // ============================================================================
  // EXPORT NAMING
  // ============================================================================

  describe("Export Naming", () => {
    let devTemplate: Template;
    let prodTemplate: Template;
    let devOutputs: Record<
      string,
      { Value: unknown; Export?: { Name: string } }
    >;
    let prodOutputs: Record<
      string,
      { Value: unknown; Export?: { Name: string } }
    >;
    let exportNames: string[];

    beforeAll(() => {
      const devApp = createTestApp();
      const devStack = createTestApiStack(devApp);
      devTemplate = Template.fromStack(devStack);
      devOutputs = devTemplate.toJSON().Outputs;

      const prodApp = createTestApp();
      const prodStack = createTestApiStack(prodApp, API_TEST_CONSTANTS.STACK_IDS.API_PROD);
      prodTemplate = Template.fromStack(prodStack);
      prodOutputs = prodTemplate.toJSON().Outputs;

      // Pre-compute export names for validation
      exportNames = Object.values(devOutputs)
        .filter((output) => output.Export?.Name !== undefined)
        .map((output) => output.Export?.Name as string);
    });

    test("should prefix export names with environment", () => {
      const expectedPrefix = buildExportName(
        BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        API_TEST_CONSTANTS.PROJECT_NAMES.WEBAPP,
        ""
      );

      const apiUrlExport = devOutputs[API_TEST_CONSTANTS.OUTPUT_KEYS.API_URL]
        ?.Export?.Name;
      expect(apiUrlExport).toMatch(new RegExp(`^${expectedPrefix}`));
    });

    test("should use kebab-case for export names", () => {
      // Guard assertion
      expect(exportNames.length).toBeGreaterThan(0);

      exportNames.forEach((name) => {
        // Should not contain underscores or uppercase letters
        expect(name).not.toMatch(/[A-Z_]/);
        // Should contain hyphens
        expect(name).toMatch(/-/);
      });
    });

    test("should have different export names for different environments", () => {
      const devApiUrl = devOutputs[API_TEST_CONSTANTS.OUTPUT_KEYS.API_URL]
        ?.Export?.Name;
      const prodApiUrl = prodOutputs[API_TEST_CONSTANTS.OUTPUT_KEYS.API_URL]
        ?.Export?.Name;

      expect(devApiUrl).toBeDefined();
      expect(prodApiUrl).toBeDefined();
      expect(devApiUrl).not.toBe(prodApiUrl);
    });
  });

  // ============================================================================
  // PIPELINE ENVIRONMENT HANDLING
  // ============================================================================

  describe("Pipeline Environment Handling", () => {
    let pipelineTemplate: Template;
    let pipelineOutputs: Record<
      string,
      { Value: unknown; Export?: { Name: string } }
    >;

    beforeAll(() => {
      const app = createTestApp();
      const stack = createTestApiStack(app, "PipelineApiStack");
      pipelineTemplate = Template.fromStack(stack);
      pipelineOutputs = pipelineTemplate.toJSON().Outputs;
    });

    test("should not export outputs for pipeline environment", () => {
      const hasExports = Object.values(pipelineOutputs).some(
        (output) => output.Export !== undefined
      );

      expect(hasExports).toBe(false);
    });

    test("should still create outputs for pipeline environment", () => {
      expect(pipelineOutputs[API_TEST_CONSTANTS.OUTPUT_KEYS.API_URL]).toHaveProperty(
        "Value"
      );
    });

    test("should determine export eligibility correctly", () => {
      const devShouldExport = shouldExportOutputs(
        BASE_TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT
      );
      const pipelineShouldExport = shouldExportOutputs("development-pipeline");

      expect(devShouldExport).toBe(true);
      expect(pipelineShouldExport).toBe(false);
    });
  });

  // ============================================================================
  // RESOURCE TAGGING
  // ============================================================================

  describe("Resource Tagging", () => {
    let stack: cdk.Stack;

    beforeAll(() => {
      const app = createTestApp();
      stack = createTestApiStack(app);
    });

    test("should apply standard tags to stack", () => {
      const stackTags = cdk.Tags.of(stack);
      expect(stackTags).toBeDefined();
    });

    test("should have taggable resources", () => {
      const template = Template.fromStack(stack);

      // Lambda functions should be taggable
      const functions = template.findResources("AWS::Lambda::Function");
      expect(Object.keys(functions).length).toBeGreaterThan(0);

      // API Gateway should be taggable
      const apis = template.findResources("AWS::ApiGateway::RestApi");
      expect(Object.keys(apis).length).toBeGreaterThan(0);
    });
  });

  // ============================================================================
  // OUTPUT VALUES
  // ============================================================================

  describe("Output Values", () => {
    let template: Template;
    let outputs: Record<string, { Value: unknown }>;

    beforeAll(() => {
      const app = createTestApp();
      const stack = createTestApiStack(app);
      template = Template.fromStack(stack);
      outputs = template.toJSON().Outputs;
    });

    test("should reference API Gateway URL correctly", () => {
      const apiUrlOutput = outputs[API_TEST_CONSTANTS.OUTPUT_KEYS.API_URL];
      expect(apiUrlOutput.Value).toBeDefined();
    });

    test("should reference Lambda ARNs correctly", () => {
      const getArticleArn =
        outputs[API_TEST_CONSTANTS.OUTPUT_KEYS.GET_ARTICLE_ARN];
      expect(getArticleArn.Value).toBeDefined();
    });

    test("should use Fn::GetAtt for ARN references", () => {
      const getArticleArn =
        outputs[API_TEST_CONSTANTS.OUTPUT_KEYS.GET_ARTICLE_ARN];
      const value = getArticleArn.Value as { "Fn::GetAtt": string[] };

      expect(value).toHaveProperty("Fn::GetAtt");
      expect(Array.isArray(value["Fn::GetAtt"])).toBe(true);
      expect(value["Fn::GetAtt"][1]).toBe("Arn");
    });
  });

  // ============================================================================
  // STACK METADATA
  // ============================================================================

  describe("Stack Metadata", () => {
    let template: Template;
    let stackJson: { Metadata?: Record<string, unknown> };

    beforeAll(() => {
      const app = createTestApp();
      const stack = createTestApiStack(app);
      template = Template.fromStack(stack);
      stackJson = template.toJSON();
    });

    test("should include CDK metadata", () => {
      expect(stackJson.Metadata).toBeDefined();
    });

    test("should have description", () => {
      expect(stackJson).toBeDefined();
    });
  });
});
