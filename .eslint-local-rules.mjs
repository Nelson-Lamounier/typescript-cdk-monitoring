
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
        let describeDepth = 0;
        let testDepth = 0;
        let hookDepth = 0;

        const isDescribe = (node) => {
          const name = node.callee.name;
          const objectName = node.callee.object?.name;
          return name === "describe" || objectName === "describe";
        };

        const isTest = (node) => {
          const name = node.callee.name;
          const objectName = node.callee.object?.name;
          return (
            ["it", "test"].includes(name) ||
            ["it", "test"].includes(objectName)
          );
        };

        const isHook = (node) => {
          const name = node.callee.name;
          return ["beforeAll", "beforeEach", "afterAll", "afterEach"].includes(
            name
          );
        };

        const isInHelperFunction = (node) => {
          let parent = node.parent;
          while (parent) {
            if (
              parent.type === "ArrowFunctionExpression" ||
              parent.type === "FunctionExpression" ||
              parent.type === "FunctionDeclaration"
            ) {
              const params = parent.params || [];
              if (
                params.some(
                  (param) =>
                    (param.type === "Identifier" &&
                      param.name === "template") ||
                    (param.type === "ObjectPattern" &&
                      param.properties.some(
                        (prop) =>
                          prop.type === "Property" &&
                          prop.key.type === "Identifier" &&
                          prop.key.name === "template"
                      ))
                )
              ) {
                return true;
              }
            }
            parent = parent.parent;
          }
          return false;
        };

        return {
          CallExpression(node) {
            if (isDescribe(node)) describeDepth++;
            if (isTest(node)) testDepth++;
            if (isHook(node)) hookDepth++;

            if (describeDepth > 0 && testDepth === 0 && hookDepth === 0) {
              if (
                node.callee.object?.name === "template" &&
                !isInHelperFunction(node)
              ) {
                context.report({
                  node,
                  messageId: "noTemplateInDescribe",
                });
              }
            }
          },

          "CallExpression:exit"(node) {
            if (isDescribe(node)) describeDepth--;
            if (isTest(node)) testDepth--;
            if (isHook(node)) hookDepth--;
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
        let describeDepth = 0;
        let testDepth = 0;

        const isDescribe = (node) => {
          const name = node.callee.name;
          const objectName = node.callee.object?.name;
          return name === "describe" || objectName === "describe";
        };

        const isTest = (node) => {
          const name = node.callee.name;
          const objectName = node.callee.object?.name;
          return (
            ["it", "test"].includes(name) ||
            ["it", "test"].includes(objectName)
          );
        };

        return {
          CallExpression(node) {
            if (isDescribe(node)) describeDepth++;
            if (isTest(node)) testDepth++;

            // Check for IIFE pattern: (function() {})() or (() => {})()
            if (describeDepth > testDepth) {
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
            if (isDescribe(node)) describeDepth--;
            if (isTest(node)) testDepth--;
          },
        };
      },
    },
  },
};
