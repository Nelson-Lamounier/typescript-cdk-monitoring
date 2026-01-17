/** @format */

/**
 * Integration Test Setup and Utilities
 *
 * This file provides utilities for running integration tests locally,
 * including stack synthesis, template validation, and test helpers.
 *
 * @module tests/integration/setup
 */

import * as fs from "fs";
import * as path from "path";

import * as cdk from "aws-cdk-lib";
import * as logs from "aws-cdk-lib/aws-logs";
import { Template } from "aws-cdk-lib/assertions";

import { NetworkingStack } from "../../lib/stacks/foundation/networking-stack";
import { MonitoringEfsStack } from "../../lib/stacks/monitoring/efs-stack";
import { MonitoringInfraStack } from "../../lib/stacks/monitoring/infra-stack";
import { MonitoringServiceStack } from "../../lib/stacks/monitoring/service-stack";

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Integration test configuration
 */
export interface IntegrationTestConfig {
  account: string;
  region: string;
  environment: string;
  projectName: string;
  vpcCidr: string;
  allowedCidr: string;
  enableVpcFlowLogs: boolean;
  flowLogRetention: logs.RetentionDays;
  saveTemplates?: boolean;
  templateOutputDir?: string;
}

/**
 * Default integration test configuration
 */
export const DEFAULT_INTEGRATION_CONFIG: IntegrationTestConfig = {
  account: "123456789012",
  region: "eu-west-1",
  environment: "development",
  projectName: "monitoring",
  vpcCidr: "10.0.0.0/16",
  allowedCidr: "10.0.0.0/8",
  enableVpcFlowLogs: true,
  flowLogRetention: logs.RetentionDays.ONE_WEEK,
  saveTemplates: false,
  templateOutputDir: path.join(__dirname, ".generated-templates"),
};

/**
 * Production integration test configuration
 */
export const PRODUCTION_INTEGRATION_CONFIG: IntegrationTestConfig = {
  ...DEFAULT_INTEGRATION_CONFIG,
  environment: "production",
};

// ============================================================================
// STACK SYNTHESIS
// ============================================================================

/**
 * Complete stack hierarchy for integration testing
 */
export interface IntegrationTestStacks {
  app: cdk.App;
  networkingStack: NetworkingStack;
  efsStack: MonitoringEfsStack;
  infraStack: MonitoringInfraStack;
  serviceStack: MonitoringServiceStack;
  templates: {
    networking: Template;
    efs: Template;
    infra: Template;
    service: Template;
  };
  config: IntegrationTestConfig;
}

/**
 * Create complete monitoring stack hierarchy for integration testing
 *
 * @param config - Integration test configuration
 * @returns Complete stack hierarchy with templates
 *
 * @example
 * ```typescript
 * const stacks = createIntegrationTestStacks();
 * const template = stacks.templates.networking;
 * template.hasResourceProperties("AWS::EC2::VPC", { ... });
 * ```
 */
export function createIntegrationTestStacks(
  config: Partial<IntegrationTestConfig> = {}
): IntegrationTestStacks {
  const finalConfig: IntegrationTestConfig = {
    ...DEFAULT_INTEGRATION_CONFIG,
    ...config,
  };

  const app = new cdk.App();

  // Layer 1: Networking Stack
  const networkingStack = new NetworkingStack(app, "TestNetworkingStack", {
    env: {
      account: finalConfig.account,
      region: finalConfig.region,
    },
    envName: finalConfig.environment,
    projectName: finalConfig.projectName,
    vpcCidr: finalConfig.vpcCidr,
    enableVpcFlowLogs: finalConfig.enableVpcFlowLogs,
    flowLogRetention: finalConfig.flowLogRetention,
  });

  // Layer 2: EFS Stack
  const efsStack = new MonitoringEfsStack(app, "TestEfsStack", {
    env: {
      account: finalConfig.account,
      region: finalConfig.region,
    },
    envName: finalConfig.environment,
    projectName: finalConfig.projectName,
    vpc: networkingStack.vpc,
  });

  // Layer 3: Infrastructure Stack
  const infraStack = new MonitoringInfraStack(app, "TestInfraStack", {
    env: {
      account: finalConfig.account,
      region: finalConfig.region,
    },
    envName: finalConfig.environment,
    projectName: finalConfig.projectName,
    vpc: networkingStack.vpc,
    efsStackName: efsStack.stackName,
    fileSystem: efsStack.fileSystem,
    efsAccessPoint: efsStack.accessPoint,
    efsAvailabilityZone: efsStack.efsAvailabilityZone,
    efsSecurityGroup: efsStack.mountTargetSecurityGroup,
    efsInitializationComplete: efsStack.efsInitializationExecution,
    minCapacity: 1,
    desiredCapacity: 1,
    maxCapacity: 2,
    allowedIpRanges: [finalConfig.allowedCidr],
  });

  // Layer 4: Service Stack
  const serviceStack = new MonitoringServiceStack(app, "TestServiceStack", {
    env: {
      account: finalConfig.account,
      region: finalConfig.region,
    },
    envName: finalConfig.environment,
    projectName: finalConfig.projectName,
    cluster: infraStack.cluster,
    loadBalancer: infraStack.loadBalancer,
    listener: infraStack.listener,
  });

  // Generate templates
  const templates = {
    networking: Template.fromStack(networkingStack),
    efs: Template.fromStack(efsStack),
    infra: Template.fromStack(infraStack),
    service: Template.fromStack(serviceStack),
  };

  // Optionally save templates to disk for inspection
  if (finalConfig.saveTemplates) {
    saveTemplatesToDisk(templates, finalConfig);
  }

  return {
    app,
    networkingStack,
    efsStack,
    infraStack,
    serviceStack,
    templates,
    config: finalConfig,
  };
}

/**
 * Create networking stack only for faster testing
 *
 * @param config - Integration test configuration
 * @returns Networking stack and template
 */
export function createNetworkingStack(
  config: Partial<IntegrationTestConfig> = {}
): { stack: NetworkingStack; template: Template } {
  const finalConfig: IntegrationTestConfig = {
    ...DEFAULT_INTEGRATION_CONFIG,
    ...config,
  };

  const app = new cdk.App();

  const stack = new NetworkingStack(app, "TestNetworkingStack", {
    env: {
      account: finalConfig.account,
      region: finalConfig.region,
    },
    envName: finalConfig.environment,
    projectName: finalConfig.projectName,
    vpcCidr: finalConfig.vpcCidr,
    enableVpcFlowLogs: finalConfig.enableVpcFlowLogs,
    flowLogRetention: finalConfig.flowLogRetention,
  });

  const template = Template.fromStack(stack);

  if (finalConfig.saveTemplates) {
    saveTemplateToFile(
      template,
      "networking",
      finalConfig.environment,
      finalConfig.templateOutputDir
    );
  }

  return { stack, template };
}

// ============================================================================
// TEMPLATE UTILITIES
// ============================================================================

/**
 * Save templates to disk for inspection
 *
 * @param templates - Generated templates
 * @param config - Integration test configuration
 */
export function saveTemplatesToDisk(
  templates: Record<string, Template>,
  config: IntegrationTestConfig
): void {
  const outputDir =
    config.templateOutputDir ||
    (DEFAULT_INTEGRATION_CONFIG.templateOutputDir as string);

  // Create output directory if it doesn't exist
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Save each template
  Object.entries(templates).forEach(([name, template]) => {
    saveTemplateToFile(template, name, config.environment, outputDir);
  });

   
  console.log(`✅ Templates saved to: ${outputDir}`);
}

/**
 * Save individual template to file
 *
 * @param template - CloudFormation template
 * @param name - Stack name
 * @param environment - Environment name
 * @param outputDir - Output directory
 */
export function saveTemplateToFile(
  template: Template,
  name: string,
  environment: string,
  outputDir: string = DEFAULT_INTEGRATION_CONFIG.templateOutputDir as string
): void {
  const fileName = `${environment}-${name}-template.json`;
  const filePath = path.join(outputDir, fileName);

  // Create directory if needed
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Write template
  const templateJson = template.toJSON();
  fs.writeFileSync(filePath, JSON.stringify(templateJson, null, 2));
}

/**
 * Load template from file
 *
 * @param name - Stack name
 * @param environment - Environment name
 * @param inputDir - Input directory
 * @returns CloudFormation template
 */
export function loadTemplateFromFile(
  name: string,
  environment: string,
  inputDir: string = DEFAULT_INTEGRATION_CONFIG.templateOutputDir as string
): Record<string, unknown> {
  const fileName = `${environment}-${name}-template.json`;
  const filePath = path.join(inputDir, fileName);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Template file not found: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(content);
}

/**
 * Compare two templates and report differences
 *
 * @param template1 - First template
 * @param template2 - Second template
 * @returns Array of differences
 */
export function compareTemplates(
  template1: Template,
  template2: Template
): string[] {
  const json1 = template1.toJSON();
  const json2 = template2.toJSON();

  const differences: string[] = [];

  // Compare resources
  const resources1 = json1.Resources || {};
  const resources2 = json2.Resources || {};

  const allResourceIds = new Set([
    ...Object.keys(resources1),
    ...Object.keys(resources2),
  ]);

  allResourceIds.forEach((resourceId) => {
    if (!resources1[resourceId]) {
      differences.push(`Resource removed: ${resourceId}`);
    } else if (!resources2[resourceId]) {
      differences.push(`Resource added: ${resourceId}`);
    } else {
      const str1 = JSON.stringify(resources1[resourceId]);
      const str2 = JSON.stringify(resources2[resourceId]);
      if (str1 !== str2) {
        differences.push(`Resource modified: ${resourceId}`);
      }
    }
  });

  return differences;
}

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

/**
 * Validate that all stacks synthesise without errors
 *
 * @param stacks - Integration test stacks
 * @throws Error if synthesis fails
 */
export function validateStackSynthesis(stacks: IntegrationTestStacks): void {
  try {
    // Attempt to access all templates to ensure synthesis succeeded
    const { networking, efs, infra, service } = stacks.templates;

    if (!networking.toJSON().Resources) {
      throw new Error("Networking stack has no resources");
    }

    if (!efs.toJSON().Resources) {
      throw new Error("EFS stack has no resources");
    }

    if (!infra.toJSON().Resources) {
      throw new Error("Infra stack has no resources");
    }

    if (!service.toJSON().Resources) {
      throw new Error("Service stack has no resources");
    }

     
    console.log("✅ All stacks synthesised successfully");
  } catch (error) {
     
    console.error("❌ Stack synthesis failed:", error);
    throw error;
  }
}

/**
 * Validate resource counts across stacks
 *
 * @param stacks - Integration test stacks
 * @returns Resource count validation results
 */
export function validateResourceCounts(stacks: IntegrationTestStacks): {
  networking: number;
  efs: number;
  infra: number;
  service: number;
  total: number;
} {
  const counts = {
    networking: Object.keys(
      stacks.templates.networking.toJSON().Resources || {}
    ).length,
    efs: Object.keys(stacks.templates.efs.toJSON().Resources || {}).length,
    infra: Object.keys(stacks.templates.infra.toJSON().Resources || {}).length,
    service: Object.keys(stacks.templates.service.toJSON().Resources || {})
      .length,
    total: 0,
  };

  counts.total = counts.networking + counts.efs + counts.infra + counts.service;

   
  console.log("📊 Resource Counts:");
  console.log(`  Networking: ${counts.networking}`);
  console.log(`  EFS:        ${counts.efs}`);
  console.log(`  Infra:      ${counts.infra}`);
  console.log(`  Service:    ${counts.service}`);
  console.log(`  Total:      ${counts.total}`);
   

  return counts;
}

/**
 * Extract all resource types from stacks
 *
 * @param stacks - Integration test stacks
 * @returns Set of resource types
 */
export function extractResourceTypes(
  stacks: IntegrationTestStacks
): Set<string> {
  const resourceTypes = new Set<string>();

  Object.values(stacks.templates).forEach((template) => {
    const resources = template.toJSON().Resources || {};
    Object.values(resources).forEach((resource) => {
      const type = (resource as Record<string, string>).Type;
      if (type) {
        resourceTypes.add(type);
      }
    });
  });

  return resourceTypes;
}

// ============================================================================
// CLEANUP UTILITIES
// ============================================================================

/**
 * Clean up generated templates directory
 *
 * @param outputDir - Directory to clean
 */
export function cleanupGeneratedTemplates(
  outputDir: string = DEFAULT_INTEGRATION_CONFIG.templateOutputDir as string
): void {
  if (fs.existsSync(outputDir)) {
    fs.rmSync(outputDir, { recursive: true, force: true });
     
    console.log(`🧹 Cleaned up: ${outputDir}`);
  }
}

/**
 * Clean up all test artifacts
 */
export function cleanupTestArtifacts(): void {
  cleanupGeneratedTemplates();
   
  console.log("✅ All test artifacts cleaned up");
}

// ============================================================================
// DEBUGGING UTILITIES
// ============================================================================

/**
 * Print stack summary for debugging
 *
 * @param stacks - Integration test stacks
 */
export function printStackSummary(stacks: IntegrationTestStacks): void {
   
  console.log("\n" + "=".repeat(80));
  console.log("Stack Summary");
  console.log("=".repeat(80));
  console.log(`Environment: ${stacks.config.environment}`);
  console.log(`Region:      ${stacks.config.region}`);
  console.log(`VPC CIDR:    ${stacks.config.vpcCidr}`);
  console.log("=".repeat(80));

  validateResourceCounts(stacks);

  console.log("\nResource Types:");
  const resourceTypes = extractResourceTypes(stacks);
  Array.from(resourceTypes)
    .sort()
    .forEach((type) => {
      console.log(`  - ${type}`);
    });

  console.log("\n" + "=".repeat(80));
   
}

/**
 * Print detailed resource information for a stack
 *
 * @param template - CloudFormation template
 * @param stackName - Name of the stack
 */
export function printResourceDetails(
  template: Template,
  stackName: string
): void {
  const json = template.toJSON();
  const resources = json.Resources || {};

   
  console.log(`\n${stackName} Stack Resources:`);
  console.log("-".repeat(80));

  Object.entries(resources).forEach(([logicalId, resource]) => {
    const type = (resource as Record<string, string>).Type;
    console.log(`${logicalId} (${type})`);
  });

  console.log("-".repeat(80));
  console.log(`Total: ${Object.keys(resources).length} resources\n`);
   
}

// ============================================================================
// EXPORT HELPERS
// ============================================================================

/**
 * Export utilities for use in tests
 */
export const IntegrationTestHelpers = {
  // Stack creation
  createIntegrationTestStacks,
  createNetworkingStack,

  // Template utilities
  saveTemplatesToDisk,
  saveTemplateToFile,
  loadTemplateFromFile,
  compareTemplates,

  // Validation
  validateStackSynthesis,
  validateResourceCounts,
  extractResourceTypes,

  // Cleanup
  cleanupGeneratedTemplates,
  cleanupTestArtifacts,

  // Debugging
  printStackSummary,
  printResourceDetails,
};

// ============================================================================
// JEST SETUP
// ============================================================================

/**
 * Global setup for Jest integration tests
 *
 * Note: This function uses Jest globals and should only be called
 * from within Jest test files
 */
export function setupIntegrationTests(): void {
  // Only run in Jest environment
  if (typeof process.env.JEST_WORKER_ID === "undefined") {
    return;
  }

  // Use try-catch to handle when Jest globals are not available
  try {
     
    const jestGlobal = global as any;

    // Set default test timeout for CDK synthesis
    if (jestGlobal.jest && typeof jestGlobal.jest.setTimeout === "function") {
      jestGlobal.jest.setTimeout(30000); // 30 seconds
    }

    // Clean up before tests
    if (jestGlobal.beforeAll && typeof jestGlobal.beforeAll === "function") {
      jestGlobal.beforeAll(() => {
         
        console.log("🧪 Setting up integration tests...");
      });
    }

    // Clean up after tests
    if (jestGlobal.afterAll && typeof jestGlobal.afterAll === "function") {
      jestGlobal.afterAll(() => {
        if (process.env.CLEANUP_TEMPLATES !== "false") {
          cleanupTestArtifacts();
        }
      });
    }
  } catch {
    // Silently ignore if Jest is not available
  }
}
