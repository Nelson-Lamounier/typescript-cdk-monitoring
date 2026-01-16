/** @format */

import js from "@eslint/js";
import tseslint from "typescript-eslint";
import importPlugin from "eslint-plugin-import";
import jestPlugin from "eslint-plugin-jest";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load custom rules (ES module import)
import localRules from "./.eslint-local-rules.mjs";

export default [
  // Base configurations
  js.configs.recommended,

  // Global ignores
  {
    ignores: [
      "node_modules/**",
      "cdk.out/**",
      "coverage/**",
      "*.js",
      "*.d.ts",
      "test-results/**",
      ".turbo/**",
      "dist/**",
      "build/**",
      "playground/**",
    ],
  },

  // JavaScript files configuration (for scripts and config files)
  {
    files: ["**/*.js", "**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        console: "readonly",
        process: "readonly",
        require: "readonly",
        module: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
      },
    },
    rules: {
      "no-console": "off",
      "prefer-const": "error",
      "no-var": "error",
    },
  },

  // TypeScript files configuration
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        tsconfigRootDir: __dirname,
        project: "./tsconfig.json",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
      import: importPlugin,
    },
    rules: {
      // TypeScript specific rules
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/explicit-module-boundary-types": "off",
      "@typescript-eslint/no-non-null-assertion": "warn",
      "@typescript-eslint/no-require-imports": "warn",

      // Import rules (simplified)
      "import/order": [
        "error",
        {
          groups: [
            "builtin",
            "external",
            "internal",
            "parent",
            "sibling",
            "index",
          ],
          "newlines-between": "always",
        },
      ],

      // General rules
      "no-console": "warn",
      "prefer-const": "error",
      "no-var": "error",
    },
  },

  // Lambda handlers and scripts - more relaxed rules
  {
    files: [
      "lambda/**/*.ts",
      "handlers/**/*.ts",
      "scripts/**/*.ts",
      "scripts/**/*.js",
      "playground/**/*.ts",
    ],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        tsconfigRootDir: __dirname,
        project: "./tsconfig.json",
      },
    },
    rules: {
      "no-console": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-require-imports": "off",
    },
  },

  // Test files configuration with Jest plugin
  {
    files: ["**/*.test.ts", "**/*.test.tsx", "tests/**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        tsconfigRootDir: __dirname,
        project: "./tsconfig.json",
      },
      globals: {
        // Jest globals
        describe: "readonly",
        test: "readonly",
        it: "readonly",
        expect: "readonly",
        beforeAll: "readonly",
        afterAll: "readonly",
        beforeEach: "readonly",
        afterEach: "readonly",
        jest: "readonly",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
      import: importPlugin,
      jest: jestPlugin,
      local: localRules,
    },
    rules: {
      // Basic rules
      "no-console": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],

      // Prevent accessing variables before they're initialized
      "no-use-before-define": [
        "error",
        {
          variables: true,
          functions: false, // Allow function hoisting
        },
      ],

      // Jest recommended rules
      ...jestPlugin.configs.recommended.rules,

      // Custom Jest rules for template safety
      "jest/no-conditional-in-test": "error",
      "jest/valid-describe-callback": "error",
      "jest/valid-title": [
        "error",
        {
          mustNotMatch: "template\\.",
        },
      ],
      "jest/no-done-callback": "error",
      "jest/no-test-return-statement": "error",
      "jest/no-duplicate-hooks": "error",
      "jest/require-top-level-describe": "error",

      // Custom local rules
      "local/no-template-in-describe": "error",
      "local/no-iife-in-describe": "error",
    },
  },

  // Deployment scripts - allow console for operational visibility
  {
    files: ["bin/**/*.ts"],
    rules: {
      "no-console": "off",
      "@typescript-eslint/no-require-imports": "off",
    },
  },
];
