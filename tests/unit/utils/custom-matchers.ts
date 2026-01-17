/** @format */

/**
 * Custom Jest Matchers for CDK Testing
 *
 * Reusable matchers for common CloudFormation/CDK assertion patterns.
 * Import and call extendExpect() in your test setup or test file.
 */

/* eslint-disable @typescript-eslint/no-namespace */

/**
 * Extend Jest's expect with custom matchers
 * Call this once in your test file or setup
 */
export function extendExpectWithCdkMatchers(): void {
    expect.extend({
      /**
       * Matches SSM parameter path pattern
       */
      toMatchSsmParameterPath(
        received: string,
        expectedPattern: string | RegExp
      ): jest.CustomMatcherResult {
        const pass =
          typeof expectedPattern === "string"
            ? received.includes(expectedPattern)
            : expectedPattern.test(received);
        return {
          pass,
          message: () =>
            `expected ${received} ${
              pass ? "not " : ""
            }to match SSM parameter path pattern ${expectedPattern}`,
        };
      },
  
      /**
       * Matches log group name pattern
       */
      toMatchLogGroupName(
        received: string,
        expectedSuffix: string
      ): jest.CustomMatcherResult {
        const pass = received.endsWith(expectedSuffix);
        return {
          pass,
          message: () =>
            `expected ${received} ${
              pass ? "not " : ""
            }to end with log group suffix ${expectedSuffix}`,
        };
      },
  
      /**
       * Validates CloudFormation output structure
       */
      toHaveValidOutput(
        received: unknown,
        outputName: string
      ): jest.CustomMatcherResult {
        const pass =
          typeof received === "object" && received !== null && "Value" in received;
        return {
          pass,
          message: () =>
            `expected output ${outputName} ${
              pass ? "not " : ""
            }to have valid CloudFormation output structure`,
        };
      },
  
      /**
       * Validates resource has expected tag
       */
      toHaveResourceTag(
        resource: unknown,
        tagKey: string,
        tagValue?: string
      ): jest.CustomMatcherResult {
        const properties = (resource as Record<string, Record<string, unknown>>)
          ?.Properties;
        const tags = (properties?.Tags || []) as Array<{ Key: string; Value: string }>;
        
        const matchingTag = tags.find((tag) => tag.Key === tagKey);
        const pass = tagValue !== undefined
          ? matchingTag?.Value === tagValue
          : matchingTag !== undefined;
  
        return {
          pass,
          message: () =>
            `expected resource ${pass ? "not " : ""}to have tag ${tagKey}${
              tagValue !== undefined ? ` with value ${tagValue}` : ""
            }`,
        };
      },
  
      /**
       * Validates resource count is at least expected
       */
      toHaveResourceCountAtLeast(
        template: unknown,
        resourceType: string,
        minCount: number
      ): jest.CustomMatcherResult {
        const templateObj = template as { findResources: (type: string) => Record<string, unknown> };
        const resources = templateObj.findResources(resourceType);
        const count = Object.keys(resources).length;
        const pass = count >= minCount;
  
        return {
          pass,
          message: () =>
            `expected template to have at least ${minCount} ${resourceType} resources, but found ${count}`,
        };
      },
    });
  }
  
  /**
   * Type declarations for custom matchers
   * Add to your test file or global types
   */
  declare global {
    namespace jest {
      interface Matchers<R> {
        toMatchSsmParameterPath(expectedPattern: string | RegExp): R;
        toMatchLogGroupName(expectedSuffix: string): R;
        toHaveValidOutput(outputName: string): R;
        toHaveResourceTag(tagKey: string, tagValue?: string): R;
        toHaveResourceCountAtLeast(resourceType: string, minCount: number): R;
      }
    }
  }