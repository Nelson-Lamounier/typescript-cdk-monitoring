/** @format */

/**
 * Config-Aware Test Helpers
 *
 * Provides assertion helpers and utilities that validate stack outputs
 * against the centralised configuration files. Use these helpers to
 * ensure stacks are configured correctly according to environment
 * and project specifications.
 *
 * @module tests/unit/utils/config-test-helpers
 */

import { Template } from "aws-cdk-lib/assertions";

import {
  validateConfiguration,
  ValidationResult,
} from "../../../config/validation";
import { environments } from "../../../config/environments";
import { getProjectConfig, projects } from "../../../config/projects";
import { getSecurityBaseline } from "../../../config/security-baseline";
import { getDefaultTags, TagConfig } from "../../../config/tagging";

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

/**
 * Validate that a stack's configuration matches the expected config
 *
 * @param stackEnvName - Environment name used in stack
 * @param stackProjectName - Project name used in stack
 * @returns Validation result
 *
 * @example
 * ```typescript
 * const result = validateStackMatchesConfig('production', 'monitoring');
 * expect(result.valid).toBe(true);
 * ```
 */
export function validateStackMatchesConfig(
  stackEnvName: string,
  stackProjectName: string
): ValidationResult {
  return validateConfiguration(stackEnvName, stackProjectName);
}

/**
 * Assert that validation passes for a configuration
 *
 * @param envName - Environment name
 * @param projectName - Optional project name
 * @throws Error if validation fails
 */
export function assertConfigurationValid(
  envName: string,
  projectName?: string
): void {
  const result = validateConfiguration(envName, projectName);

  if (!result.valid) {
    throw new Error(
      `Configuration validation failed for ${envName}${projectName ? `/${projectName}` : ""}:\n` +
        result.errors.map((e, i) => `  ${i + 1}. ${e}`).join("\n")
    );
  }
}

// ============================================================================
// VPC CONFIGURATION ASSERTIONS
// ============================================================================

/**
 * Assert stack uses correct VPC CIDR from config
 *
 * @param templateVpcCidr - VPC CIDR from synthesised template
 * @param envName - Environment name
 * @throws Error if CIDR doesn't match config
 *
 * @example
 * ```typescript
 * const vpcCidr = extractVpcCidr(template);
 * assertVpcCidrMatchesConfig(vpcCidr, 'production');
 * ```
 */
export function assertVpcCidrMatchesConfig(
  templateVpcCidr: string,
  envName: string
): void {
  const expectedCidr = environments[envName]?.vpcCidr;

  if (!expectedCidr) {
    throw new Error(`Environment '${envName}' not found in config`);
  }

  if (templateVpcCidr !== expectedCidr) {
    throw new Error(
      `VPC CIDR mismatch: Stack uses '${templateVpcCidr}' but ` +
        `config/environments.ts specifies '${expectedCidr}' for ${envName}`
    );
  }
}

/**
 * Get expected VPC CIDR for an environment
 *
 * @param envName - Environment name
 * @returns Expected VPC CIDR
 */
export function getExpectedVpcCidr(envName: string): string {
  const env = environments[envName];
  if (!env) {
    throw new Error(`Environment '${envName}' not found in config`);
  }
  return env.vpcCidr;
}

/**
 * Get expected NAT gateway count for an environment
 *
 * @param envName - Environment name
 * @returns Expected NAT gateway count
 */
export function getExpectedNatGatewayCount(envName: string): number {
  const env = environments[envName];
  if (!env) {
    throw new Error(`Environment '${envName}' not found in config`);
  }
  return env.natGateways ?? 0;
}

// ============================================================================
// RESOURCE CONFIGURATION ASSERTIONS
// ============================================================================

/**
 * Get expected service resources from project config
 *
 * @param projectName - Project name
 * @param envName - Environment name (defaults to 'development')
 * @returns Service resource allocations
 *
 * @example
 * ```typescript
 * const resources = getExpectedServiceResources('monitoring', 'production');
 * expect(resources.prometheus.memoryMiB).toBe(1024);
 * ```
 */
export function getExpectedServiceResources(
  projectName: string,
  envName: string = "development"
): Record<string, { memoryMiB?: number; cpu?: number }> {
  const config = getProjectConfig(projectName, envName);
  return config.compute?.services ?? {};
}

/**
 * Get expected instance type for a project/environment
 *
 * @param projectName - Project name
 * @param envName - Environment name
 * @returns Expected instance type
 */
export function getExpectedInstanceType(
  projectName: string,
  envName: string = "development"
): string | undefined {
  const config = getProjectConfig(projectName, envName);
  return config.compute?.instanceType;
}

/**
 * Get expected capacity configuration for a project/environment
 *
 * @param projectName - Project name
 * @param envName - Environment name
 * @returns Capacity configuration
 */
export function getExpectedCapacity(
  projectName: string,
  envName: string = "development"
): { min: number; max: number; desired: number } {
  const config = getProjectConfig(projectName, envName);
  return {
    min: config.compute?.minCapacity ?? 1,
    max: config.compute?.maxCapacity ?? 2,
    desired: config.compute?.desiredCapacity ?? 1,
  };
}

// ============================================================================
// SECURITY CONFIGURATION ASSERTIONS
// ============================================================================

/**
 * Assert template has HTTPS enabled for production
 *
 * @param template - CloudFormation template
 * @param envName - Environment name
 */
export function assertHttpsConfigurationCorrect(
  template: Template,
  envName: string
): void {
  const baseline = getSecurityBaseline(envName);

  if (baseline.transport.enableHttps) {
    // Check for HTTPS listener (port 443)
    const listeners = template.findResources(
      "AWS::ElasticLoadBalancingV2::Listener"
    );

    const hasHttpsListener = Object.values(listeners).some((listener) => {
      const props = (listener as { Properties: { Port: number } }).Properties;
      return props.Port === 443;
    });

    if (!hasHttpsListener && Object.keys(listeners).length > 0) {
      throw new Error(
        `Security baseline requires HTTPS for ${envName} but no HTTPS listener found`
      );
    }
  }
}

/**
 * Get expected security baseline for an environment
 *
 * @param envName - Environment name
 * @returns Security baseline configuration
 */
export function getExpectedSecurityBaseline(envName: string) {
  return getSecurityBaseline(envName);
}

/**
 * Check if deletion protection should be enabled
 *
 * @param envName - Environment name
 * @returns True if deletion protection should be enabled
 */
export function shouldHaveDeletionProtection(envName: string): boolean {
  const baseline = getSecurityBaseline(envName);
  return baseline.protection.enableDeletionProtection;
}

/**
 * Check if VPC flow logs should be enabled
 *
 * @param envName - Environment name
 * @returns True if VPC flow logs should be enabled
 */
export function shouldHaveVpcFlowLogs(envName: string): boolean {
  const baseline = getSecurityBaseline(envName);
  return baseline.audit.enableVpcFlowLogs;
}

// ============================================================================
// TAG CONFIGURATION ASSERTIONS
// ============================================================================

/**
 * Get expected tags for a resource
 *
 * @param envName - Environment name
 * @param projectName - Project name
 * @returns Expected tag configuration
 */
export function getExpectedTags(
  envName: string,
  projectName?: string
): TagConfig {
  return getDefaultTags(envName, projectName);
}

/**
 * Assert resource has expected environment tag
 *
 * @param resourceTags - Tags from resource
 * @param envName - Expected environment name
 */
export function assertEnvironmentTag(
  resourceTags: Array<{ Key: string; Value: string }>,
  envName: string
): void {
  const envTag = resourceTags.find((t) => t.Key === "Environment");

  if (!envTag) {
    throw new Error("Resource missing Environment tag");
  }

  if (envTag.Value !== envName) {
    throw new Error(
      `Environment tag mismatch: expected '${envName}', got '${envTag.Value}'`
    );
  }
}

/**
 * Assert resource has expected project tag
 *
 * @param resourceTags - Tags from resource
 * @param projectName - Expected project name
 */
export function assertProjectTag(
  resourceTags: Array<{ Key: string; Value: string }>,
  projectName: string
): void {
  const projectTag = resourceTags.find((t) => t.Key === "Project");

  if (!projectTag) {
    throw new Error("Resource missing Project tag");
  }

  if (projectTag.Value !== projectName) {
    throw new Error(
      `Project tag mismatch: expected '${projectName}', got '${projectTag.Value}'`
    );
  }
}

// ============================================================================
// TEMPLATE EXTRACTION HELPERS
// ============================================================================

/**
 * Extract VPC CIDR from template
 *
 * @param template - CloudFormation template
 * @returns VPC CIDR or undefined
 */
export function extractVpcCidr(template: Template): string | undefined {
  const vpcs = template.findResources("AWS::EC2::VPC");
  const vpcKeys = Object.keys(vpcs);

  if (vpcKeys.length === 0) {
    return undefined;
  }

  const vpc = vpcs[vpcKeys[0]] as {
    Properties: { CidrBlock: string };
  };

  return vpc.Properties.CidrBlock;
}

/**
 * Count NAT gateways in template
 *
 * @param template - CloudFormation template
 * @returns Number of NAT gateways
 */
export function countNatGateways(template: Template): number {
  const natGateways = template.findResources("AWS::EC2::NatGateway");
  return Object.keys(natGateways).length;
}

/**
 * Extract tags from a resource in template
 *
 * @param template - CloudFormation template
 * @param resourceType - CloudFormation resource type
 * @returns Array of tag objects
 */
export function extractResourceTags(
  template: Template,
  resourceType: string
): Array<{ Key: string; Value: string }> {
  const resources = template.findResources(resourceType);
  const resourceKeys = Object.keys(resources);

  if (resourceKeys.length === 0) {
    return [];
  }

  const resource = resources[resourceKeys[0]] as {
    Properties: { Tags?: Array<{ Key: string; Value: string }> };
  };

  return resource.Properties.Tags ?? [];
}

// ============================================================================
// ENVIRONMENT HELPERS
// ============================================================================

/**
 * Check if environment is production
 *
 * @param envName - Environment name
 * @returns True if production environment
 */
export function isProductionEnvironment(envName: string): boolean {
  const env = environments[envName];
  return env?.isProduction ?? false;
}

/**
 * Get all environment names from config
 *
 * @returns Array of environment names
 */
export function getAllEnvironmentNames(): string[] {
  return Object.keys(environments);
}

/**
 * Get all project names from config
 *
 * @returns Array of project names
 */
export function getAllProjectNames(): string[] {
  return Object.keys(projects);
}

// ============================================================================
// TEST MATRIX GENERATORS
// ============================================================================

/**
 * Generate test cases for all environment/project combinations
 *
 * @returns Array of test case objects
 *
 * @example
 * ```typescript
 * const testCases = generateEnvironmentProjectMatrix();
 * testCases.forEach(({ envName, projectName }) => {
 *   test(`${projectName} in ${envName}`, () => {
 *     // Test logic
 *   });
 * });
 * ```
 */
export function generateEnvironmentProjectMatrix(): Array<{
  envName: string;
  projectName: string;
}> {
  const matrix: Array<{ envName: string; projectName: string }> = [];

  Object.keys(environments).forEach((envName) => {
    Object.keys(projects).forEach((projectName) => {
      matrix.push({ envName, projectName });
    });
  });

  return matrix;
}

/**
 * Generate test cases for all environments
 *
 * @returns Array of environment names
 */
export function generateEnvironmentTestCases(): string[] {
  return Object.keys(environments);
}

/**
 * Generate test cases for all projects
 *
 * @returns Array of project names
 */
export function generateProjectTestCases(): string[] {
  return Object.keys(projects);
}
