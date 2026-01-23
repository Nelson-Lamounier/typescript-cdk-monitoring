/** @format */

/**
 * =============================================================================
 * CONSTANTS TEMPLATE
 * =============================================================================
 *
 * This template provides a starting point for creating new constants files.
 * Constants define static values, defaults, and limits used across the codebase.
 *
 * FILE LOCATION:
 * - Place in: lib/shared/constants/{category}-constants.ts
 * - Example:  lib/shared/constants/database-constants.ts
 *
 * NAMING CONVENTIONS:
 * - File:     kebab-case-constants.ts
 * - Constant: SCREAMING_SNAKE_CASE
 * - Object:   SCREAMING_SNAKE_CASE (with `as const`)
 *
 * AFTER CREATING:
 * 1. Add export to lib/shared/constants/index.ts
 * 2. Import in constructs/stacks/utils that need these values
 *
 * =============================================================================
 */

// =============================================================================
// SECTION 1: IMPORTS
// =============================================================================
// Import CDK types only if needed for type annotations

// import * as ec2 from "aws-cdk-lib/aws-ec2";
// import * as logs from "aws-cdk-lib/aws-logs";

// =============================================================================
// SECTION 2: DEFAULT VALUES
// =============================================================================
// Single values used as defaults throughout the codebase

/**
 * Default value for resource configuration
 * TODO: Replace with your actual defaults
 */
export const DEFAULT_RESOURCE_NAME = "my-resource";

/**
 * Default capacity for scaling
 * @example Used in ECS service desired count
 */
export const DEFAULT_CAPACITY = 1;

/**
 * Default timeout in seconds
 * 30 seconds is suitable for most web requests
 */
export const DEFAULT_TIMEOUT_SECONDS = 30;

/**
 * Default retention period in days
 * 7 days balances cost with basic operational needs
 */
export const DEFAULT_RETENTION_DAYS = 7;

// =============================================================================
// SECTION 3: LIMITS AND BOUNDARIES
// =============================================================================
// Minimum and maximum values for validation

/**
 * Minimum allowed capacity
 * At least 1 instance is required for service availability
 */
export const MIN_CAPACITY = 1;

/**
 * Maximum allowed capacity
 * Prevents accidental resource overconsumption
 */
export const MAX_CAPACITY = 10;

/**
 * Minimum timeout in seconds
 */
export const MIN_TIMEOUT_SECONDS = 1;

/**
 * Maximum timeout in seconds
 * AWS Lambda maximum is 900 seconds (15 minutes)
 */
export const MAX_TIMEOUT_SECONDS = 900;

/**
 * Minimum name length
 */
export const MIN_NAME_LENGTH = 3;

/**
 * Maximum name length for resources
 * Most AWS resources have 63 or 255 character limits
 */
export const MAX_NAME_LENGTH = 63;

// =============================================================================
// SECTION 4: ENVIRONMENT-SPECIFIC DEFAULTS
// =============================================================================
// Values that differ by environment - use `as const` for type safety

/**
 * Capacity defaults by environment
 * Production uses higher values for availability
 *
 * @example
 * ```typescript
 * const capacity = isProduction
 *   ? CAPACITY_DEFAULTS.PRODUCTION
 *   : CAPACITY_DEFAULTS.DEV;
 * ```
 */
export const CAPACITY_DEFAULTS = {
  DEV: {
    minCapacity: 1,
    maxCapacity: 2,
    desiredCapacity: 1,
  },
  STAGING: {
    minCapacity: 1,
    maxCapacity: 3,
    desiredCapacity: 1,
  },
  PRODUCTION: {
    minCapacity: 2,
    maxCapacity: 5,
    desiredCapacity: 2,
  },
} as const;

/**
 * Retention periods by environment
 * Production retains data longer for compliance
 */
export const RETENTION_DEFAULTS = {
  DEV: 7,        // 1 week - quick cleanup
  STAGING: 30,   // 1 month - basic testing history
  PRODUCTION: 90, // 3 months - compliance requirements
} as const;

/**
 * Resource sizing by environment
 * TODO: Replace with your environment-specific values
 */
export const RESOURCE_SIZING = {
  DEV: {
    instanceType: "t3.small",
    memoryMiB: 512,
    cpu: 256,
  },
  STAGING: {
    instanceType: "t3.medium",
    memoryMiB: 1024,
    cpu: 512,
  },
  PRODUCTION: {
    instanceType: "t3.large",
    memoryMiB: 2048,
    cpu: 1024,
  },
} as const;

// =============================================================================
// SECTION 5: PORT DEFINITIONS
// =============================================================================
// Common port numbers for networking configuration

/**
 * Application ports
 * TODO: Replace with your application-specific ports
 */
export const APPLICATION_PORTS = {
  /**
   * Primary application port
   */
  APP: 8080,

  /**
   * Health check port
   */
  HEALTH: 8081,

  /**
   * Metrics endpoint port
   */
  METRICS: 9090,

  /**
   * Admin interface port
   */
  ADMIN: 9000,
} as const;

/**
 * Port ranges for dynamic port allocation
 */
export const PORT_RANGES = {
  /**
   * Ephemeral port range for Linux
   */
  EPHEMERAL: { min: 32768, max: 65535 },

  /**
   * Application port range
   */
  APPLICATION: { min: 8000, max: 9999 },
} as const;

// =============================================================================
// SECTION 6: PATH AND PREFIX DEFINITIONS
// =============================================================================
// Standard paths and prefixes for resource naming

/**
 * SSM Parameter Store path prefixes
 */
export const SSM_PATH_PREFIXES = {
  /**
   * Base prefix for all parameters
   */
  BASE: "/myapp",

  /**
   * Configuration parameters
   */
  CONFIG: "/myapp/config",

  /**
   * Secrets references
   */
  SECRETS: "/myapp/secrets",

  /**
   * Infrastructure outputs
   */
  INFRA: "/myapp/infra",
} as const;

/**
 * S3 key prefixes
 */
export const S3_PREFIXES = {
  LOGS: "logs/",
  BACKUPS: "backups/",
  CONFIG: "config/",
  DATA: "data/",
} as const;

// =============================================================================
// SECTION 7: VALIDATION PATTERNS
// =============================================================================
// Regular expressions and validation rules

/**
 * Validation rules for resource names
 */
export const NAME_VALIDATION = {
  /**
   * Pattern for valid resource names
   * Allows: letters, numbers, hyphens, underscores
   */
  PATTERN: /^[a-zA-Z0-9-_]+$/,

  /**
   * Minimum length for names
   */
  MIN_LENGTH: 3,

  /**
   * Maximum length for names
   */
  MAX_LENGTH: 63,
} as const;

/**
 * Validation rules for specific resource types
 */
export const RESOURCE_VALIDATION = {
  /**
   * S3 bucket name validation
   */
  S3_BUCKET: {
    PATTERN: /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/,
    MIN_LENGTH: 3,
    MAX_LENGTH: 63,
  },

  /**
   * ECS cluster name validation
   */
  ECS_CLUSTER: {
    PATTERN: /^[a-zA-Z0-9-_]+$/,
    MIN_LENGTH: 1,
    MAX_LENGTH: 255,
  },
} as const;

// =============================================================================
// SECTION 8: FEATURE FLAGS AND TOGGLES
// =============================================================================
// Boolean flags for enabling/disabling features

/**
 * Default feature flags by environment
 */
export const FEATURE_FLAGS = {
  DEV: {
    enableMetrics: false,
    enableTracing: false,
    enableEncryption: true,
    enableBackup: false,
  },
  STAGING: {
    enableMetrics: true,
    enableTracing: true,
    enableEncryption: true,
    enableBackup: false,
  },
  PRODUCTION: {
    enableMetrics: true,
    enableTracing: true,
    enableEncryption: true,
    enableBackup: true,
  },
} as const;

// =============================================================================
// SECTION 9: NEXT STEPS
// =============================================================================
/**
 * After creating your constants file:
 *
 * [ ] 1. Rename this file to {category}-constants.ts
 * [ ] 2. Replace all placeholder constants with actual values
 * [ ] 3. Add export to lib/shared/constants/index.ts:
 *        export * from "./{category}-constants";
 * [ ] 4. Import in validation functions, constructs, and stacks
 * [ ] 5. Document all constants with JSDoc
 * [ ] 6. Use `as const` for all object constants
 * [ ] 7. Group related constants with section dividers
 * [ ] 8. Remove unused sections
 * [ ] 9. Delete this template section
 */
