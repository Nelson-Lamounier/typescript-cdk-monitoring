/** @format */

/**
 * Centralised Configuration Validation
 * 
 * This module orchestrates validation functions from across the codebase
 * and runs comprehensive checks before CDK synthesis. This enables early
 * error detection and prevents invalid configurations from being deployed.
 * 
 * Validation Categories:
 * - Environment configuration
 * - Project configuration
 * - Security baseline requirements
 * - Resource capacity and compatibility
 * - Tag completeness
 * - KMS key configuration
 */

import { environments, EnvironmentConfig } from "./environments";
import { getProjectConfig, ProjectConfig } from "./projects";
import { getSecurityBaseline, getEncryptionConfig, validateTags as validateTagConfig } from "./security-baseline";
import { getDefaultTags } from "./tagging";
import { validateInstanceType } from "../lib/shared/helpers/instance-type-helper";
import { validateKmsKeyArn } from "../lib/shared/helpers/kms-key-helper";

/**
 * Validation result with errors and warnings
 */
export interface ValidationResult {
  /** Whether validation passed (no errors) */
  valid: boolean;
  /** Critical errors that prevent deployment */
  errors: string[];
  /** Non-critical warnings that should be reviewed */
  warnings: string[];
}

/**
 * Validation context for detailed error messages
 */
interface ValidationContext {
  envName: string;
  projectName?: string;
  envConfig: EnvironmentConfig;
  projectConfig?: ProjectConfig;
}

/**
 * Validate environment configuration
 * 
 * Checks:
 * - Environment exists in configuration
 * - Account and region are defined (if not auto-detect)
 * - VPC CIDR is valid
 * - NAT gateway configuration is reasonable
 */
function validateEnvironmentConfig(ctx: ValidationContext): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check VPC CIDR format
  if (ctx.envConfig.vpcCidr) {
    const cidrPattern = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;
    if (!cidrPattern.test(ctx.envConfig.vpcCidr)) {
      errors.push(`Invalid VPC CIDR format: ${ctx.envConfig.vpcCidr}`);
    }
  } else {
    errors.push("VPC CIDR is required");
  }

  // Validate NAT gateway count
  const natGateways = ctx.envConfig.natGateways ?? 0;
  if (natGateways < 0) {
    errors.push(`NAT gateway count cannot be negative: ${natGateways}`);
  }
  if (natGateways > 3) {
    warnings.push(
      `High NAT gateway count (${natGateways}). Each gateway costs ~£30/month. ` +
      `Consider using 1 for cost or 2 for HA.`
    );
  }

  // Production-specific checks
  if (ctx.envConfig.isProduction) {
    if (natGateways === 0) {
      warnings.push(
        "Production environment has 0 NAT gateways. Private subnets cannot access the internet. " +
        "This is OK if you're using VPC endpoints for all AWS services."
      );
    }

    if (!ctx.envConfig.account) {
      warnings.push(
        "Production account ID not specified. CDK will auto-detect from credentials. " +
        "Consider explicitly setting for safety."
      );
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validate project configuration
 * 
 * Checks:
 * - Instance type is valid
 * - Capacity settings are reasonable
 * - Memory allocations fit within instance capacity
 * - EBS volumes are properly configured
 */
function validateProjectConfig(ctx: ValidationContext): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!ctx.projectConfig) {
    return { valid: true, errors, warnings };
  }

  // Validate instance type
  if (ctx.projectConfig.compute?.instanceType) {
    const instanceTypeValidation = validateInstanceType(
      ctx.projectConfig.compute.instanceType
    );
    if (!instanceTypeValidation.isValid) {
      errors.push(
        `Invalid instance type for ${ctx.projectName}: ${instanceTypeValidation.error}`
      );
    }
  }

  // Validate capacity settings
  const compute = ctx.projectConfig.compute;
  if (compute) {
    const min = compute.minCapacity ?? 0;
    const max = compute.maxCapacity ?? 0;
    const desired = compute.desiredCapacity ?? 0;

    if (min > max) {
      errors.push(
        `minCapacity (${min}) cannot be greater than maxCapacity (${max})`
      );
    }

    if (desired < min || desired > max) {
      errors.push(
        `desiredCapacity (${desired}) must be between minCapacity (${min}) and maxCapacity (${max})`
      );
    }

    // Warn about single instance in production
    if (ctx.envConfig.isProduction && max === 1) {
      warnings.push(
        `Production environment has maxCapacity of 1. Consider using at least 2 for high availability.`
      );
    }
  }

  // Validate EBS volumes
  if (ctx.projectConfig.storage?.ebsVolumes) {
    ctx.projectConfig.storage.ebsVolumes.forEach((vol, index) => {
      if (vol.sizeGB < 1) {
        errors.push(`EBS volume ${index} has invalid size: ${vol.sizeGB}GB`);
      }
      if (vol.sizeGB > 16000) {
        warnings.push(
          `EBS volume ${index} is very large (${vol.sizeGB}GB). ` +
          `Consider using EFS for large shared storage.`
        );
      }
      if (!vol.deviceName.startsWith("/dev/")) {
        errors.push(
          `EBS volume ${index} has invalid device name: ${vol.deviceName}. ` +
          `Must start with /dev/`
        );
      }
    });
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validate memory allocations vs instance capacity
 * 
 * Checks that total memory allocated to services doesn't exceed
 * the available memory on the instance type.
 */
function validateMemoryCapacity(ctx: ValidationContext): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!ctx.projectConfig?.compute?.services) {
    return { valid: true, errors, warnings };
  }

  // Calculate total memory allocated
  let totalMemoryMiB = 0;
  const services = ctx.projectConfig.compute.services;
  
  Object.entries(services).forEach(([serviceName, config]) => {
    if (config.memoryMiB) {
      totalMemoryMiB += config.memoryMiB;
    }
  });

  // Get instance type memory (approximate values)
  const instanceType = ctx.projectConfig.compute.instanceType || "t3.small";
  const instanceMemory = getInstanceMemoryMiB(instanceType);

  if (instanceMemory) {
    // Leave ~20% buffer for system overhead
    const usableMemory = instanceMemory * 0.8;
    
    if (totalMemoryMiB > instanceMemory) {
      errors.push(
        `Total service memory (${totalMemoryMiB} MiB) exceeds instance capacity (${instanceMemory} MiB) ` +
        `for ${instanceType}. Services: ${JSON.stringify(services)}`
      );
    } else if (totalMemoryMiB > usableMemory) {
      warnings.push(
        `Total service memory (${totalMemoryMiB} MiB) is close to instance capacity (${instanceMemory} MiB). ` +
        `Consider leaving ~20% buffer for system overhead. Current buffer: ${
          Math.round(((instanceMemory - totalMemoryMiB) / instanceMemory) * 100)
        }%`
      );
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Get approximate memory for instance type (in MiB)
 * 
 * This is a simplified lookup. For production, consider using
 * AWS SDK to fetch actual instance type details.
 */
function getInstanceMemoryMiB(instanceType: string): number | null {
  const memoryMap: Record<string, number> = {
    "t3.nano": 512,
    "t3.micro": 1024,
    "t3.small": 2048,
    "t3.medium": 4096,
    "t3.large": 8192,
    "t3.xlarge": 16384,
    "t3.2xlarge": 32768,
    "t4g.nano": 512,
    "t4g.micro": 1024,
    "t4g.small": 2048,
    "t4g.medium": 4096,
    "t4g.large": 8192,
    "m5.large": 8192,
    "m5.xlarge": 16384,
    "m5.2xlarge": 32768,
    "m5.4xlarge": 65536,
    "c5.large": 4096,
    "c5.xlarge": 8192,
    "c5.2xlarge": 16384,
    "r5.large": 16384,
    "r5.xlarge": 32768,
  };

  return memoryMap[instanceType] ?? null;
}

/**
 * Validate security baseline configuration
 * 
 * Checks:
 * - Production security requirements are met
 * - HTTPS configuration for production
 * - Proper IP restrictions
 * - Encryption configuration
 */
function validateSecurityBaseline(ctx: ValidationContext): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const baseline = getSecurityBaseline(ctx.envName);

  // Production-specific security checks
  if (ctx.envConfig.isProduction) {
    // Check IP restrictions
    if (
      baseline.network.allowedIpRanges.includes("0.0.0.0/0") ||
      baseline.network.allowedIpRanges.length === 0
    ) {
      warnings.push(
        "Production environment allows access from anywhere (0.0.0.0/0). " +
        "Update CORPORATE_IP_RANGES in config/security-baseline.ts with your VPN/office IPs."
      );
    }

    // Check HTTPS
    if (!baseline.transport.enableHttps) {
      errors.push(
        "Production environment must enable HTTPS. " +
        "Set enableHttps: true in security baseline."
      );
    }

    // Check deletion protection
    if (!baseline.protection.enableDeletionProtection) {
      warnings.push(
        "Production environment has deletion protection disabled. " +
        "Enable to prevent accidental resource deletion."
      );
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validate KMS encryption configuration
 * 
 * Checks KMS key ARN formats for all configured encryption keys
 */
function validateEncryptionConfig(ctx: ValidationContext): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const encConfig = getEncryptionConfig(ctx.envName);

  const keyTypes: Array<[keyof typeof encConfig, string]> = [
    ["ebsKmsKeyArn", "EBS"],
    ["efsKmsKeyArn", "EFS"],
    ["ecrKmsKeyArn", "ECR"],
    ["s3KmsKeyArn", "S3"],
    ["dynamoDbKmsKeyArn", "DynamoDB"],
    ["logsKmsKeyArn", "CloudWatch Logs"],
  ];

  keyTypes.forEach(([key, resourceType]) => {
    const keyArn = encConfig[key];
    if (keyArn) {
      const validation = validateKmsKeyArn(keyArn);
      if (!validation.isValid) {
        errors.push(`Invalid ${resourceType} KMS key: ${validation.error}`);
      }
    }
  });

  // Warn if production has no customer-managed keys
  if (ctx.envConfig.isProduction) {
    const hasAnyKey = keyTypes.some(([key]) => encConfig[key]);
    if (!hasAnyKey) {
      warnings.push(
        "Production environment is using AWS-managed encryption keys. " +
        "Consider using customer-managed KMS keys for enhanced control and audit logging. " +
        "See docs/KMS_CONFIGURATION_GUIDE.md"
      );
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validate tag configuration
 * 
 * Checks that all required tags are present and valid
 */
function validateTagConfiguration(ctx: ValidationContext): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const tags = getDefaultTags(ctx.envName, ctx.projectName);
  const tagValidation = validateTagConfig(tags);

  if (!tagValidation.isValid) {
    tagValidation.errors.forEach((error) => {
      errors.push(`Tag validation failed: ${error}`);
    });
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validate complete configuration for an environment and project
 * 
 * Runs all validation checks and returns a comprehensive result.
 * This should be called before CDK synthesis to catch configuration
 * errors early.
 * 
 * @param envName - Environment name (development, staging, production)
 * @param projectName - Optional project name (monitoring, webapp, etc.)
 * @returns ValidationResult with all errors and warnings
 * 
 * @example
 * ```typescript
 * const validation = validateConfiguration('production', 'monitoring');
 * if (!validation.valid) {
 *   throw new Error(`Configuration invalid:\n${validation.errors.join('\n')}`);
 * }
 * if (validation.warnings.length > 0) {
 *   console.warn(`Warnings:\n${validation.warnings.join('\n')}`);
 * }
 * ```
 */
export function validateConfiguration(
  envName: string,
  projectName?: string
): ValidationResult {
  const allErrors: string[] = [];
  const allWarnings: string[] = [];

  // Check environment exists
  const envConfig = environments[envName];
  if (!envConfig) {
    return {
      valid: false,
      errors: [
        `Environment '${envName}' not found in configuration. ` +
        `Available: ${Object.keys(environments).join(", ")}`,
      ],
      warnings: [],
    };
  }

  // Get project config if specified
  const projectConfig = projectName
    ? getProjectConfig(projectName, envName)
    : undefined;

  const ctx: ValidationContext = {
    envName,
    projectName,
    envConfig,
    projectConfig,
  };

  // Run all validation checks
  const validators = [
    validateEnvironmentConfig,
    validateProjectConfig,
    validateMemoryCapacity,
    validateSecurityBaseline,
    validateEncryptionConfig,
    validateTagConfiguration,
  ];

  validators.forEach((validator) => {
    const result = validator(ctx);
    allErrors.push(...result.errors);
    allWarnings.push(...result.warnings);
  });

  return {
    valid: allErrors.length === 0,
    errors: allErrors,
    warnings: allWarnings,
  };
}

/**
 * Validate all projects in an environment
 * 
 * Useful for CI/CD pipelines to validate entire environment configuration
 * 
 * @param envName - Environment name
 * @param projectNames - Array of project names to validate
 * @returns Map of project name to validation result
 */
export function validateAllProjects(
  envName: string,
  projectNames: string[]
): Map<string, ValidationResult> {
  const results = new Map<string, ValidationResult>();

  projectNames.forEach((projectName) => {
    const result = validateConfiguration(envName, projectName);
    results.set(projectName, result);
  });

  return results;
}

/**
 * Format validation result for console output
 * 
 * @param result - Validation result to format
 * @param context - Optional context string (e.g., environment + project name)
 * @returns Formatted string ready for console.log/console.error
 */
export function formatValidationResult(
  result: ValidationResult,
  context?: string
): string {
  const lines: string[] = [];

  if (context) {
    lines.push(`\n=== Validation Result: ${context} ===`);
  }

  if (result.valid) {
    lines.push("✅ Validation passed");
  } else {
    lines.push("❌ Validation failed");
  }

  if (result.errors.length > 0) {
    lines.push(`\n🚨 Errors (${result.errors.length}):`);
    result.errors.forEach((error, i) => {
      lines.push(`  ${i + 1}. ${error}`);
    });
  }

  if (result.warnings.length > 0) {
    lines.push(`\n⚠️  Warnings (${result.warnings.length}):`);
    result.warnings.forEach((warning, i) => {
      lines.push(`  ${i + 1}. ${warning}`);
    });
  }

  if (result.valid && result.warnings.length === 0) {
    lines.push("No errors or warnings found.");
  }

  return lines.join("\n");
}
