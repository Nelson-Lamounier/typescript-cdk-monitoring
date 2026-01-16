/** @format */

export default {
  rules: {
    "no-template-in-describe": {
      meta: {
        type: "problem",
        docs: {
          description: "Disallow template access outside of test functions",
          category: "Possible Errors",
          recommended: true,
        },
        messages: {
          noTemplateInDescribe:
            'Do not access "template" in describe blocks. ' +
            "Move this code into a test function (it/test) or beforeAll/beforeEach.",
        },
      },
      create(context) {
        let inDescribe = false;
        let inTest = false;
        let inHook = false;

        return {
          CallExpression(node) {
            // Track when we're inside describe
            if (node.callee.name === "describe") {
              inDescribe = true;
            }

            // Track when we're inside it/test
            if (node.callee.name === "it" || node.callee.name === "test") {
              inTest = true;
            }

            // Track when we're inside hooks
            if (
              ["beforeAll", "beforeEach", "afterAll", "afterEach"].includes(
                node.callee.name
              )
            ) {
              inHook = true;
            }

            // Check for template access
            if (inDescribe && !inTest && !inHook) {
              if (
                node.callee.object?.name === "template" ||
                node.arguments.some(
                  (arg) => arg.type === "Identifier" && arg.name === "template"
                )
              ) {
                context.report({
                  node,
                  messageId: "noTemplateInDescribe",
                });
              }
            }
          },

          "CallExpression:exit"(node) {
            if (node.callee.name === "describe") {
              inDescribe = false;
            }
            if (node.callee.name === "it" || node.callee.name === "test") {
              inTest = false;
            }
            if (
              ["beforeAll", "beforeEach", "afterAll", "afterEach"].includes(
                node.callee.name
              )
            ) {
              inHook = false;
            }
          },
        };
      },
    },

    "no-iife-in-describe": {
      meta: {
        type: "problem",
        docs: {
          description:
            "Disallow immediately invoked function expressions in describe blocks",
          category: "Possible Errors",
        },
        messages: {
          noIifeInDescribe:
            "Do not use IIFE in describe blocks. " +
            "This executes during initialization when variables may be undefined.",
        },
      },
      create(context) {
        let inDescribe = 0;
        let inTest = 0;

        return {
          CallExpression(node) {
            if (node.callee.name === "describe") {
              inDescribe++;
            }
            if (node.callee.name === "it" || node.callee.name === "test") {
              inTest++;
            }

            // Check for IIFE pattern: (function() {})() or (() => {})()
            if (inDescribe > inTest) {
              if (
                node.callee.type === "FunctionExpression" ||
                node.callee.type === "ArrowFunctionExpression"
              ) {
                context.report({
                  node,
                  messageId: "noIifeInDescribe",
                });
              }
            }
          },

          "CallExpression:exit"(node) {
            if (node.callee.name === "describe") {
              inDescribe--;
            }
            if (node.callee.name === "it" || node.callee.name === "test") {
              inTest--;
            }
          },
        };
      },
    },
  },
};
