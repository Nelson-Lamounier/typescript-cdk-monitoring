/** @format */

/**
 * Test Configuration Factory
 *
 * Provides typed access to actual config values for tests while allowing
 * overrides for specific test scenarios. This ensures tests validate against
 * real production configuration while maintaining flexibility for edge cases.
 *
 * @module tests/unit/shared/config-factory
 */

import * as logs from "aws-cdk-lib/aws-logs";

import {
  environments,
  EnvironmentConfig,
} from "../../../config/environments";
import {
  projects,
  getProjectConfig,
  ProjectConfig,
  ProjectType,
} from "../../../config/projects";
import {
  getSecurityBaseline,
  getEncryptionConfig,
  SecurityBaseline,
  EncryptionConfig,
} from "../../../config/security-baseline";
import {
  getDefaultTags,
  getResourceTags,
  TagConfig,
} from "../../../config/tagging";

// ============================================================================
// TYPES
// ============================================================================

/**
 * Complete test configuration for an environment/project combination
 */
export interface TestEnvironmentConfig {
  /** Environment configuration from config/environments.ts */
  environment: EnvironmentConfig;
  /** Project configuration (if specified) from config/projects.ts */
  project?: ProjectConfig;
  /** Security baseline for the environment */
  security: SecurityBaseline;
  /** Encryption configuration for the environment */
  encryption: EncryptionConfig;
  /** Default tags for resources */
  tags: TagConfig;
}

/**
 * Test stack creation options
 */
export interface TestStackOptions {
  /** Environment name (development, staging, production, pipeline) */
  envName?: string;
  /** Project name (monitoring, webapp, etc.) */
  projectName?: string;
  /** Override VPC CIDR for testing */
  vpcCidrOverride?: string;
  /** Override NAT gateway count */
  natGatewaysOverride?: number;
  /** Enable VPC flow logs */
  enableVpcFlowLogs?: boolean;
  /** Flow log retention period */
  flowLogRetention?: logs.RetentionDays;
  /** Override allowed IP ranges */
  allowedIpRangesOverride?: string[];
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Standard test AWS configuration for CDK synthesis
 * Uses mock account/region that CDK accepts for testing
 */
export const TEST_AWS_CONFIG = {
  ACCOUNT: "123456789012",
  REGION: "eu-west-1",
} as const;

/**
 * Available environment names from config
 */
export const ENVIRONMENT_NAMES = Object.keys(environments) as Array<
  keyof typeof environments
>;

/**
 * Available project names from config
 */
export const PROJECT_NAMES = Object.keys(projects) as Array<
  keyof typeof projects
>;

/**
 * Project types enum re-exported for convenience
 */
export { ProjectType };

// ============================================================================
// CONFIG FACTORY FUNCTIONS
// ============================================================================

/**
 * Get complete test configuration for an environment/project combination
 *
 * @param envName - Environment name (defaults to 'development')
 * @param projectName - Optional project name
 * @returns Complete test configuration
 * @throws Error if environment not found
 *
 * @example
 * ```typescript
 * const config = getTestConfig('production', 'monitoring');
 * console.log(config.environment.vpcCidr); // "10.3.0.0/16"
 * console.log(config.security.transport.enableHttps); // true
 * ```
 */
export function getTestConfig(
  envName: string = "development",
  projectName?: string
): TestEnvironmentConfig {
  const environment = environments[envName];

  if (!environment) {
    const validEnvs = Object.keys(environments).join(", ");
    throw new Error(
      `Environment '${envName}' not found in config.\n` +
        `Valid environments: ${validEnvs}`
    );
  }

  const project = projectName
    ? getProjectConfig(projectName, envName)
    : undefined;

  return {
    environment,
    project,
    security: getSecurityBaseline(envName),
    encryption: getEncryptionConfig(envName),
    tags: getDefaultTags(envName, projectName),
  };
}

/**
 * Get development test config with optional overrides
 *
 * @param projectName - Project name (defaults to 'monitoring')
 * @param overrides - Optional environment config overrides
 * @returns Development test configuration
 *
 * @example
 * ```typescript
 * const config = getDevelopmentTestConfig('webapp', {
 *   natGateways: 1, // Override for specific test
 * });
 * ```
 */
export function getDevelopmentTestConfig(
  projectName: string = "monitoring",
  overrides?: Partial<EnvironmentConfig>
): TestEnvironmentConfig {
  const config = getTestConfig("development", projectName);

  if (overrides) {
    config.environment = { ...config.environment, ...overrides };
  }

  return config;
}

/**
 * Get production test config for security/compliance testing
 *
 * @param projectName - Project name (defaults to 'monitoring')
 * @returns Production test configuration
 *
 * @example
 * ```typescript
 * const config = getProductionTestConfig('monitoring');
 * expect(config.security.transport.enableHttps).toBe(true);
 * ```
 */
export function getProductionTestConfig(
  projectName: string = "monitoring"
): TestEnvironmentConfig {
  return getTestConfig("production", projectName);
}

/**
 * Get staging test config
 *
 * @param projectName - Project name (defaults to 'monitoring')
 * @returns Staging test configuration
 */
export function getStagingTestConfig(
  projectName: string = "monitoring"
): TestEnvironmentConfig {
  return getTestConfig("staging", projectName);
}

/**
 * Get pipeline test config
 *
 * @param projectName - Project name (defaults to 'monitoring')
 * @returns Pipeline test configuration
 */
export function getPipelineTestConfig(
  projectName: string = "monitoring"
): TestEnvironmentConfig {
  return getTestConfig("pipeline", projectName);
}

// ============================================================================
// ENVIRONMENT VALUE ACCESSORS
// ============================================================================

/**
 * Get VPC CIDR for an environment
 *
 * @param envName - Environment name
 * @returns VPC CIDR block
 */
export function getVpcCidr(envName: string): string {
  const env = environments[envName];
  if (!env) {
    throw new Error(`Environment '${envName}' not found`);
  }
  return env.vpcCidr;
}

/**
 * Get NAT gateway count for an environment
 *
 * @param envName - Environment name
 * @returns Number of NAT gateways
 */
export function getNatGatewayCount(envName: string): number {
  const env = environments[envName];
  if (!env) {
    throw new Error(`Environment '${envName}' not found`);
  }
  return env.natGateways ?? 0;
}

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
 * Get all VPC CIDRs mapped by environment
 *
 * @returns Record of environment name to VPC CIDR
 */
export function getAllVpcCidrs(): Record<string, string> {
  const cidrs: Record<string, string> = {};
  Object.entries(environments).forEach(([name, config]) => {
    cidrs[name] = config.vpcCidr;
  });
  return cidrs;
}

// ============================================================================
// PROJECT VALUE ACCESSORS
// ============================================================================

/**
 * Get service resource configuration for a project
 *
 * @param projectName - Project name
 * @param envName - Environment name for overrides
 * @returns Service resource allocations
 */
export function getServiceResources(
  projectName: string,
  envName: string = "development"
): Record<string, { memoryMiB?: number; cpu?: number }> {
  const config = getProjectConfig(projectName, envName);
  return config.compute?.services ?? {};
}

/**
 * Get compute configuration for a project
 *
 * @param projectName - Project name
 * @param envName - Environment name for overrides
 * @returns Compute configuration
 */
export function getComputeConfig(
  projectName: string,
  envName: string = "development"
): {
  instanceType?: string;
  minCapacity?: number;
  maxCapacity?: number;
  desiredCapacity?: number;
} {
  const config = getProjectConfig(projectName, envName);
  return {
    instanceType: config.compute?.instanceType,
    minCapacity: config.compute?.minCapacity,
    maxCapacity: config.compute?.maxCapacity,
    desiredCapacity: config.compute?.desiredCapacity,
  };
}

// ============================================================================
// TAG ACCESSORS
// ============================================================================

/**
 * Get default tags for testing
 *
 * @param envName - Environment name
 * @param projectName - Optional project name
 * @returns Tag configuration
 */
export function getTestTags(
  envName: string = "development",
  projectName?: string
): TagConfig {
  return getDefaultTags(envName, projectName);
}

/**
 * Get resource-specific tags for testing
 *
 * @param envName - Environment name
 * @param projectName - Project name
 * @param resourceType - Resource type (e.g., 'efs', 'ecr')
 * @returns Tag configuration with resource-specific tags
 */
export function getTestResourceTags(
  envName: string,
  projectName: string,
  resourceType: string
): TagConfig {
  return getResourceTags(envName, projectName, resourceType);
}

// ============================================================================
// TEST STACK OPTIONS RESOLVER
// ============================================================================

/**
 * Resolve test stack options with config values and overrides
 *
 * @param options - Test stack options
 * @returns Resolved configuration values
 *
 * @example
 * ```typescript
 * const resolved = resolveTestStackOptions({
 *   envName: 'production',
 *   projectName: 'monitoring',
 *   natGatewaysOverride: 1, // Override production default
 * });
 * ```
 */
export function resolveTestStackOptions(options: TestStackOptions = {}): {
  envName: string;
  projectName: string;
  vpcCidr: string;
  natGateways: number;
  enableVpcFlowLogs: boolean;
  flowLogRetention: logs.RetentionDays;
  allowedIpRanges: string[];
  isProduction: boolean;
} {
  const envName = options.envName ?? "development";
  const projectName = options.projectName ?? "monitoring";

  const config = getTestConfig(envName, projectName);

  return {
    envName,
    projectName,
    vpcCidr: options.vpcCidrOverride ?? config.environment.vpcCidr,
    natGateways:
      options.natGatewaysOverride ?? config.environment.natGateways ?? 0,
    enableVpcFlowLogs: options.enableVpcFlowLogs ?? true,
    flowLogRetention:
      options.flowLogRetention ?? logs.RetentionDays.ONE_WEEK,
    allowedIpRanges:
      options.allowedIpRangesOverride ??
      config.security.network.allowedIpRanges,
    isProduction: config.environment.isProduction,
  };
}

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

/**
 * Validate that an environment exists in config
 *
 * @param envName - Environment name to validate
 * @returns True if valid
 */
export function isValidEnvironment(envName: string): boolean {
  return envName in environments;
}

/**
 * Validate that a project exists in config
 *
 * @param projectName - Project name to validate
 * @returns True if valid
 */
export function isValidProject(projectName: string): boolean {
  return projectName in projects;
}

/**
 * Get all environment names
 *
 * @returns Array of environment names
 */
export function getEnvironmentNames(): string[] {
  return Object.keys(environments);
}

/**
 * Get all project names
 *
 * @returns Array of project names
 */
export function getProjectNames(): string[] {
  return Object.keys(projects);
}

// ============================================================================
// RE-EXPORTS FOR CONVENIENCE
// ============================================================================

export {
  environments,
  EnvironmentConfig,
  projects,
  getProjectConfig,
  ProjectConfig,
  getSecurityBaseline,
  SecurityBaseline,
  getEncryptionConfig,
  EncryptionConfig,
  getDefaultTags,
  getResourceTags,
  TagConfig,
};
