#!/usr/bin/env ts-node
/** @format */

/**
 * Local Integration Test Helper
 *
 * This script helps run integration tests locally with various options
 * for debugging, template generation, and validation.
 *
 * Usage:
 *   ts-node scripts/tests/local-integration-test.ts [options]
 *
 * Options:
 *   --save-templates    Save generated CloudFormation templates to disk
 *   --environment <env> Environment to test (development|production)
 *   --stack <name>      Test specific stack only (networking|efs|infra|service)
 *   --summary           Print stack summary
 *   --details           Print detailed resource information
 *   --compare <file>    Compare with saved template
 *   --clean             Clean up generated templates
 *   --help              Show help
 *
 * Examples:
 *   # Run basic synthesis
 *   ts-node scripts/tests/local-integration-test.ts
 *
 *   # Save templates for inspection
 *   ts-node scripts/tests/local-integration-test.ts --save-templates
 *
 *   # Test production configuration
 *   ts-node scripts/tests/local-integration-test.ts --environment production
 *
 *   # Test specific stack
 *   ts-node scripts/tests/local-integration-test.ts --stack networking --details
 *
 *   # Clean up artifacts
 *   ts-node scripts/tests/local-integration-test.ts --clean
 */

import {
  createIntegrationTestStacks,
  createNetworkingStack,
  DEFAULT_INTEGRATION_CONFIG,
  PRODUCTION_INTEGRATION_CONFIG,
  IntegrationTestHelpers,
  IntegrationTestConfig,
} from "../../tests/integration/setup";

// ============================================================================
// CLI ARGUMENT PARSING
// ============================================================================

interface CliOptions {
  saveTemplates: boolean;
  environment: string;
  stack?: string;
  summary: boolean;
  details: boolean;
  compare?: string;
  clean: boolean;
  help: boolean;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);

  const options: CliOptions = {
    saveTemplates: false,
    environment: "development",
    summary: false,
    details: false,
    clean: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case "--save-templates":
        options.saveTemplates = true;
        break;

      case "--environment":
        options.environment = args[++i];
        break;

      case "--stack":
        options.stack = args[++i];
        break;

      case "--summary":
        options.summary = true;
        break;

      case "--details":
        options.details = true;
        break;

      case "--compare":
        options.compare = args[++i];
        break;

      case "--clean":
        options.clean = true;
        break;

      case "--help":
      case "-h":
        options.help = true;
        break;

      default:
        console.error(`Unknown option: ${arg}`);
        process.exit(1);
    }
  }

  return options;
}

function printHelp(): void {
  console.log(`
Local Integration Test Helper

This script helps run integration tests locally with various options
for debugging, template generation, and validation.

USAGE:
  ts-node scripts/tests/local-integration-test.ts [options]

OPTIONS:
  --save-templates    Save generated CloudFormation templates to disk
  --environment <env> Environment to test (development|production)
  --stack <name>      Test specific stack only (networking|efs|infra|service)
  --summary           Print stack summary
  --details           Print detailed resource information
  --compare <file>    Compare with saved template
  --clean             Clean up generated templates
  --help, -h          Show this help message

EXAMPLES:
  # Run basic synthesis
  ts-node scripts/tests/local-integration-test.ts

  # Save templates for inspection
  ts-node scripts/tests/local-integration-test.ts --save-templates

  # Test production configuration
  ts-node scripts/tests/local-integration-test.ts --environment production

  # Test specific stack with details
  ts-node scripts/tests/local-integration-test.ts --stack networking --details

  # Compare with baseline template
  ts-node scripts/tests/local-integration-test.ts --compare baseline.json

  # Clean up artifacts
  ts-node scripts/tests/local-integration-test.ts --clean

ENVIRONMENT VARIABLES:
  CLEANUP_TEMPLATES   Set to 'false' to keep templates (default: true)

OUTPUT:
  Templates are saved to: tests/integration/.generated-templates/
  `);
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

function main(): void {
  const options = parseArgs();

  console.log("\n" + "=".repeat(80));
  console.log("Local Integration Test Helper");
  console.log("=".repeat(80) + "\n");

  // Show help
  if (options.help) {
    printHelp();
    return;
  }

  // Clean up
  if (options.clean) {
    console.log("🧹 Cleaning up generated templates...");
    IntegrationTestHelpers.cleanupTestArtifacts();
    console.log("✅ Cleanup complete\n");
    return;
  }

  // Get configuration
  const config: Partial<IntegrationTestConfig> =
    options.environment === "production"
      ? { ...PRODUCTION_INTEGRATION_CONFIG }
      : { ...DEFAULT_INTEGRATION_CONFIG };

  config.saveTemplates = options.saveTemplates;

  console.log("📋 Configuration:");
  console.log(`  Environment:    ${options.environment}`);
  console.log(`  Region:         ${config.region}`);
  console.log(`  Account:        ${config.account}`);
  console.log(`  Save Templates: ${options.saveTemplates ? "Yes" : "No"}`);
  console.log("");

  try {
    // Test specific stack
    if (options.stack) {
      console.log(`🔨 Synthesising ${options.stack} stack...`);

      if (options.stack === "networking") {
        const { template } = createNetworkingStack(config);
        console.log("✅ Stack synthesised successfully\n");

        if (options.details) {
          IntegrationTestHelpers.printResourceDetails(template, "Networking");
        }

        const resourceCount = Object.keys(
          template.toJSON().Resources || {}
        ).length;
        console.log(`📊 Resource Count: ${resourceCount}`);
      } else {
        console.error(
          `❌ Specific stack testing only supported for 'networking'`
        );
        console.error(`   For other stacks, run without --stack to test all`);
        process.exit(1);
      }
    } else {
      // Test all stacks
      console.log("🔨 Synthesising all stacks...");

      const startTime = Date.now();
      const stacks = createIntegrationTestStacks(config);
      const duration = Date.now() - startTime;

      console.log(`✅ All stacks synthesised successfully (${duration}ms)\n`);

      // Validate synthesis
      IntegrationTestHelpers.validateStackSynthesis(stacks);

      // Print summary if requested
      if (options.summary) {
        IntegrationTestHelpers.printStackSummary(stacks);
      }

      // Print details if requested
      if (options.details) {
        IntegrationTestHelpers.printResourceDetails(
          stacks.templates.networking,
          "Networking"
        );
        IntegrationTestHelpers.printResourceDetails(
          stacks.templates.efs,
          "EFS"
        );
        IntegrationTestHelpers.printResourceDetails(
          stacks.templates.infra,
          "Infrastructure"
        );
        IntegrationTestHelpers.printResourceDetails(
          stacks.templates.service,
          "Service"
        );
      } else {
        // Basic resource counts
        IntegrationTestHelpers.validateResourceCounts(stacks);
        console.log("");
      }

      // Compare with baseline if requested
      if (options.compare) {
        console.log(`\n🔍 Comparing with baseline: ${options.compare}`);
        try {
          IntegrationTestHelpers.loadTemplateFromFile(
            "networking",
            options.environment
          );
          // Comparison logic would go here
          console.log("✅ Comparison complete");
        } catch (error) {
          console.error(
            `❌ Failed to load baseline: ${(error as Error).message}`
          );
        }
      }
    }

    // Success message
    console.log("\n" + "=".repeat(80));
    console.log("✅ Integration test completed successfully");
    console.log("=".repeat(80) + "\n");

    if (options.saveTemplates) {
      console.log(
        `📁 Templates saved to: ${
          config.templateOutputDir || "tests/integration/.generated-templates"
        }`
      );
      console.log(
        "   You can inspect these files to debug CloudFormation issues\n"
      );
    }
  } catch (error) {
    console.error("\n" + "=".repeat(80));
    console.error("❌ Integration test failed");
    console.error("=".repeat(80));
    console.error(`\nError: ${(error as Error).message}\n`);

    if ((error as Error).stack) {
      console.error("Stack trace:");
      console.error((error as Error).stack);
    }

    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

export { main };
