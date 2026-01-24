/** @format */

/**
 * Environment utility functions for CDK stacks
 *
 * Provides helper functions for environment-aware configuration
 * and validation across the infrastructure.
 */

/**
 * Production environment names
 */
const PRODUCTION_ENVIRONMENTS = ["production", "prod"];

/**
 * Check if the environment is a production environment
 *
 * Production environments have stricter validation, warnings,
 * and different default configurations (e.g., multi-AZ, HA settings).
 *
 * @param envName - Environment name to check
 * @returns true if this is a production environment
 *
 * @example
 * ```typescript
 * if (isProductionEnvironment(props.envName)) {
 *   // Apply production-specific settings
 *   natGateways = 2; // HA NAT gateways
 * }
 * ```
 */
export function isProductionEnvironment(envName: string): boolean {
  if (!envName) return false;
  return PRODUCTION_ENVIRONMENTS.includes(envName.toLowerCase());
}

/**
 * Check if the environment is a development environment
 *
 * @param envName - Environment name to check
 * @returns true if this is a development environment
 */
export function isDevelopmentEnvironment(envName: string): boolean {
  if (!envName) return false;
  return ["development", "dev"].includes(envName.toLowerCase());
}

/**
 * Check if the environment is a staging environment
 *
 * @param envName - Environment name to check
 * @returns true if this is a staging environment
 */
export function isStagingEnvironment(envName: string): boolean {
  if (!envName) return false;
  return ["staging", "stage", "uat"].includes(envName.toLowerCase());
}

/**
 * Check if the environment is a pipeline/CI environment
 *
 * @param envName - Environment name to check
 * @returns true if this is a pipeline environment
 */
export function isPipelineEnvironment(envName: string): boolean {
  if (!envName) return false;
  return ["pipeline", "ci", "cicd"].includes(envName.toLowerCase());
}

/**
 * Get the environment tier for resource sizing
 *
 * @param envName - Environment name
 * @returns Environment tier: 'production', 'staging', 'development', or 'pipeline'
 */
export function getEnvironmentTier(
  envName: string
): "production" | "staging" | "development" | "pipeline" {
  if (isProductionEnvironment(envName)) return "production";
  if (isStagingEnvironment(envName)) return "staging";
  if (isPipelineEnvironment(envName)) return "pipeline";
  return "development";
}

/**
 * Validate environment name is one of the expected values
 *
 * @param envName - Environment name to validate
 * @param allowedEnvironments - List of allowed environment names
 * @throws Error if environment is not in allowed list
 */
export function validateEnvironmentName(
  envName: string,
  allowedEnvironments: string[] = [
    "development",
    "staging",
    "production",
    "pipeline",
  ]
): void {
  if (!envName || typeof envName !== "string") {
    throw new Error("Environment name must be a non-empty string");
  }

  const normalised = envName.toLowerCase();
  if (!allowedEnvironments.map((e) => e.toLowerCase()).includes(normalised)) {
    throw new Error(
      `Invalid environment name: '${envName}'.\n` +
        `Allowed environments: ${allowedEnvironments.join(", ")}`
    );
  }
}
