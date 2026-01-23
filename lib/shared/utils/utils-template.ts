/** @format */

/**
 * =============================================================================
 * UTILS TEMPLATE
 * =============================================================================
 *
 * This template provides a starting point for creating utility functions.
 * Utilities are PURE FUNCTIONS: same input always produces same output,
 * no side effects, no external state.
 *
 * FILE LOCATION:
 * - Place in: lib/shared/utils/{function-name}.ts or lib/shared/utils/{category}.ts
 * - Example:  lib/shared/utils/database-validation.ts
 *
 * NAMING CONVENTIONS:
 * - File:     kebab-case.ts
 * - Function: camelCase (verbs: validate, check, is, get, parse, format)
 *
 * AFTER CREATING:
 * 1. Add export to lib/shared/utils/index.ts
 * 2. Import in constructs/stacks that need these utilities
 *
 * =============================================================================
 */

// =============================================================================
// SECTION 1: IMPORTS
// =============================================================================
// Import constants for limits and validation rules

import {
  MIN_NAME_LENGTH,
  MAX_NAME_LENGTH,
  NAME_VALIDATION,
} from "../constants/constants-template";

// =============================================================================
// SECTION 2: TYPE GUARDS
// =============================================================================
// Functions that narrow types (return boolean, used in if statements)

/**
 * Check if a value is a non-empty string
 *
 * @param value - Value to check
 * @returns true if value is a non-empty string
 *
 * @example
 * ```typescript
 * if (isNonEmptyString(input)) {
 *   // input is narrowed to string type
 *   console.log(input.toUpperCase());
 * }
 * ```
 */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Check if a value is a positive integer
 *
 * @param value - Value to check
 * @returns true if value is a positive integer
 */
export function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/**
 * TODO: Add your type guards here
 */

// =============================================================================
// SECTION 3: ENVIRONMENT UTILITIES
// =============================================================================
// Functions for environment-aware configuration

/**
 * Production environment identifiers
 */
const PRODUCTION_ENVIRONMENTS = ["production", "prod"];

/**
 * Check if the environment is a production environment
 *
 * Production environments have stricter validation, warnings,
 * and different default configurations.
 *
 * @param envName - Environment name to check
 * @returns true if this is a production environment
 *
 * @example
 * ```typescript
 * if (isProductionEnvironment(props.envName)) {
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
 * Get the environment tier for resource sizing
 *
 * @param envName - Environment name
 * @returns Environment tier
 */
export function getEnvironmentTier(
  envName: string
): "production" | "staging" | "development" | "pipeline" {
  if (isProductionEnvironment(envName)) return "production";
  if (["staging", "stage", "uat"].includes(envName.toLowerCase()))
    return "staging";
  if (["pipeline", "ci", "cicd"].includes(envName.toLowerCase()))
    return "pipeline";
  return "development";
}

// =============================================================================
// SECTION 4: VALIDATION UTILITIES
// =============================================================================
// Functions that validate input and throw on failure

/**
 * Validate environment name presence and formatting
 *
 * @param envName - Environment name to validate
 * @throws Error if envName is missing or invalid
 *
 * @example
 * ```typescript
 * validateEnvName(props.envName); // Throws if invalid
 * // Safe to use props.envName here
 * ```
 */
export function validateEnvName(envName: string): void {
  if (!envName || typeof envName !== "string" || envName.trim().length === 0) {
    throw new Error(
      "Environment name (envName) is required and must be a non-empty string.\n\n" +
        "Troubleshooting Steps:\n" +
        " 1. Provide envName in construct props\n" +
        " 2. Use standard values: 'development', 'staging', 'production', 'pipeline'\n" +
        " 3. Ensure the value is not undefined or null"
    );
  }
}

/**
 * Validate resource name format
 *
 * @param name - Resource name to validate
 * @param resourceType - Type of resource for error messages
 * @throws Error if name format is invalid
 *
 * @example
 * ```typescript
 * validateResourceName(props.bucketName, 'S3 bucket');
 * ```
 */
export function validateResourceName(name: string, resourceType: string): void {
  if (!name || typeof name !== "string") {
    throw new Error(
      `${resourceType} name is required and must be a non-empty string.\n\n` +
        "Troubleshooting Steps:\n" +
        ` 1. Provide a name for the ${resourceType}\n` +
        " 2. Ensure the name is not undefined or null"
    );
  }

  const trimmed = name.trim();

  if (trimmed.length < MIN_NAME_LENGTH) {
    throw new Error(
      `${resourceType} name is too short.\n\n` +
        `Minimum length: ${MIN_NAME_LENGTH} characters\n` +
        `Received: ${trimmed.length} characters\n` +
        `Value: "${trimmed}"`
    );
  }

  if (trimmed.length > MAX_NAME_LENGTH) {
    throw new Error(
      `${resourceType} name exceeds maximum length.\n\n` +
        `Maximum length: ${MAX_NAME_LENGTH} characters\n` +
        `Received: ${trimmed.length} characters`
    );
  }

  if (!NAME_VALIDATION.PATTERN.test(trimmed)) {
    throw new Error(
      `${resourceType} name contains invalid characters: "${trimmed}"\n\n` +
        "Allowed characters:\n" +
        "  - Letters (a-z, A-Z)\n" +
        "  - Numbers (0-9)\n" +
        "  - Hyphens (-)\n" +
        "  - Underscores (_)"
    );
  }
}

/**
 * Validate numeric value is within range
 *
 * @param value - Value to validate
 * @param min - Minimum allowed value
 * @param max - Maximum allowed value
 * @param fieldName - Name of field for error messages
 * @throws Error if value is out of range
 *
 * @example
 * ```typescript
 * validateRange(props.capacity, 1, 10, 'capacity');
 * ```
 */
export function validateRange(
  value: number,
  min: number,
  max: number,
  fieldName: string
): void {
  if (typeof value !== "number" || isNaN(value)) {
    throw new Error(
      `${fieldName} must be a valid number.\n` + `Received: ${typeof value}`
    );
  }

  if (value < min || value > max) {
    throw new Error(
      `${fieldName} must be between ${min} and ${max}.\n` +
        `Received: ${value}`
    );
  }
}

/**
 * Validate ordering: min <= desired <= max
 *
 * @param min - Minimum value
 * @param desired - Desired value
 * @param max - Maximum value
 * @throws Error if ordering is violated
 *
 * @example
 * ```typescript
 * validateOrdering(props.minCapacity, props.desiredCapacity, props.maxCapacity);
 * ```
 */
export function validateOrdering(
  min: number,
  desired: number,
  max: number
): void {
  if (min > desired) {
    throw new Error(
      `Minimum value (${min}) cannot exceed desired value (${desired}).`
    );
  }

  if (desired > max) {
    throw new Error(
      `Desired value (${desired}) cannot exceed maximum value (${max}).`
    );
  }
}

// =============================================================================
// SECTION 5: TRANSFORMATION UTILITIES
// =============================================================================
// Functions that transform data from one format to another

/**
 * Convert environment name to standard format
 *
 * @param envName - Environment name to normalise
 * @returns Normalised environment name
 *
 * @example
 * ```typescript
 * normaliseEnvName('PROD'); // Returns 'production'
 * normaliseEnvName('dev');  // Returns 'development'
 * ```
 */
export function normaliseEnvName(envName: string): string {
  const lower = envName.toLowerCase().trim();

  const mappings: Record<string, string> = {
    prod: "production",
    dev: "development",
    stage: "staging",
    uat: "staging",
    ci: "pipeline",
    cicd: "pipeline",
  };

  return mappings[lower] ?? lower;
}

/**
 * Generate a resource name with standard prefix
 *
 * @param envName - Environment name
 * @param resourceType - Type of resource
 * @param suffix - Optional suffix
 * @returns Generated resource name
 *
 * @example
 * ```typescript
 * generateResourceName('prod', 'cluster', 'ecs');
 * // Returns 'prod-cluster-ecs'
 * ```
 */
export function generateResourceName(
  envName: string,
  resourceType: string,
  suffix?: string
): string {
  const parts = [envName, resourceType];
  if (suffix) {
    parts.push(suffix);
  }
  return parts.join("-");
}

/**
 * TODO: Add your transformation utilities here
 */

// =============================================================================
// SECTION 6: HELPER UTILITIES
// =============================================================================
// General helper functions

/**
 * Safely get a value with fallback
 *
 * @param value - Primary value
 * @param fallback - Fallback if primary is undefined/null
 * @returns Value or fallback
 *
 * @example
 * ```typescript
 * const capacity = getOrDefault(props.capacity, 1);
 * ```
 */
export function getOrDefault<T>(value: T | undefined | null, fallback: T): T {
  return value ?? fallback;
}

/**
 * Create environment-aware default value getter
 *
 * @param envName - Environment name
 * @param devValue - Value for development
 * @param prodValue - Value for production
 * @returns Appropriate value for environment
 *
 * @example
 * ```typescript
 * const capacity = getEnvDefault(props.envName, 1, 2);
 * ```
 */
export function getEnvDefault<T>(
  envName: string,
  devValue: T,
  prodValue: T
): T {
  return isProductionEnvironment(envName) ? prodValue : devValue;
}

// =============================================================================
// SECTION 7: NEXT STEPS
// =============================================================================
/**
 * After creating your utils file:
 *
 * [ ] 1. Rename this file to {category}.ts or {function-name}.ts
 * [ ] 2. Replace placeholder functions with actual utilities
 * [ ] 3. Add export to lib/shared/utils/index.ts:
 *        export * from "./{filename}";
 * [ ] 4. Import in constructs/stacks that need these utilities
 * [ ] 5. Document all functions with JSDoc (@param, @returns, @throws, @example)
 * [ ] 6. Write helpful error messages with troubleshooting steps
 * [ ] 7. Keep functions pure (no side effects)
 * [ ] 8. Remove unused sections
 * [ ] 9. Delete this template section
 */
