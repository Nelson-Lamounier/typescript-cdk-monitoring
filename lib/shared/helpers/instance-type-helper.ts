/** @format */

/**
 * Helper functions for converting instance type strings to CDK InstanceType objects
 * 
 * This module provides utilities to parse instance type strings from configuration
 * and convert them to CDK's ec2.InstanceType objects.
 */

import * as ec2 from "aws-cdk-lib/aws-ec2";
import { ProjectConfig } from "../../../config/projects";

/**
 * Converts an instance type string to a CDK InstanceType object
 * 
 * @param instanceTypeStr - Instance type string (e.g., "t3.small", "m5.large")
 * @returns CDK InstanceType object
 * @throws Error if instance type string is invalid
 * 
 * @example
 * ```typescript
 * const instanceType = parseInstanceType("t3.small");
 * // Returns: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.SMALL)
 * ```
 */
export function parseInstanceType(instanceTypeStr: string): ec2.InstanceType {
  if (!instanceTypeStr || !instanceTypeStr.includes('.')) {
    throw new Error(`Invalid instance type string: ${instanceTypeStr}. Expected format: "family.size" (e.g., "t3.small")`);
  }

  const [family, size] = instanceTypeStr.split('.');
  
  if (!family || !size) {
    throw new Error(`Invalid instance type string: ${instanceTypeStr}. Expected format: "family.size" (e.g., "t3.small")`);
  }

  // Convert family to InstanceClass enum key (e.g., "t3" -> "T3")
  const instanceClassKey = family.toUpperCase();
  
  // Convert size to InstanceSize enum key
  // Handle sizes with numbers: "2xlarge" -> "XLARGE2", "4xlarge" -> "XLARGE4"
  // Regular sizes: "small" -> "SMALL", "xlarge" -> "XLARGE"
  let instanceSizeKey: string;
  const match = size.match(/^(\d+)(.+)$/);
  if (match) {
    // Size starts with a number (e.g., "2xlarge")
    const [, number, sizeName] = match;
    instanceSizeKey = `${sizeName.toUpperCase()}${number}`;
  } else {
    // Regular size (e.g., "small", "xlarge")
    instanceSizeKey = size.toUpperCase();
  }

  // Validate that the instance class exists
  if (!(instanceClassKey in ec2.InstanceClass)) {
    throw new Error(
      `Unknown instance class: ${family}. Valid classes include: t2, t3, t3a, t4g, m5, m6i, c5, c6i, r5, r6i, etc.`
    );
  }

  // Validate that the instance size exists
  if (!(instanceSizeKey in ec2.InstanceSize)) {
    throw new Error(
      `Unknown instance size: ${size}. Valid sizes include: nano, micro, small, medium, large, xlarge, 2xlarge, etc.`
    );
  }

  return ec2.InstanceType.of(
    ec2.InstanceClass[instanceClassKey as keyof typeof ec2.InstanceClass],
    ec2.InstanceSize[instanceSizeKey as keyof typeof ec2.InstanceSize]
  );
}

/**
 * Gets instance type from project configuration with fallback to default
 * 
 * @param projectConfig - Project configuration object
 * @param defaultInstanceType - Fallback instance type string (default: "t3.small")
 * @returns CDK InstanceType object
 * 
 * @example
 * ```typescript
 * const projectConfig = getProjectConfig("monitoring", "production");
 * const instanceType = getInstanceTypeFromConfig(projectConfig);
 * // Returns instance type from config, or t3.small if not specified
 * ```
 */
export function getInstanceTypeFromConfig(
  projectConfig: ProjectConfig,
  defaultInstanceType: string = "t3.small"
): ec2.InstanceType {
  const instanceTypeStr = projectConfig.compute?.instanceType ?? defaultInstanceType;
  return parseInstanceType(instanceTypeStr);
}

/**
 * Gets instance type from configuration with environment-aware fallback
 * 
 * This function is useful when you want different default instance types
 * for production vs non-production environments.
 * 
 * @param projectConfig - Project configuration object
 * @param isProduction - Whether this is a production environment
 * @param prodDefault - Default instance type for production (default: "t3.medium")
 * @param nonProdDefault - Default instance type for non-production (default: "t3.small")
 * @returns CDK InstanceType object
 * 
 * @example
 * ```typescript
 * const projectConfig = getProjectConfig("webapp", envName);
 * const instanceType = getInstanceTypeFromConfigWithEnvDefault(
 *   projectConfig,
 *   envConfig.isProduction
 * );
 * // Returns: t3.medium for prod, t3.small for dev (if not specified in config)
 * ```
 */
export function getInstanceTypeFromConfigWithEnvDefault(
  projectConfig: ProjectConfig,
  isProduction: boolean,
  prodDefault: string = "t3.medium",
  nonProdDefault: string = "t3.small"
): ec2.InstanceType {
  const defaultInstanceType = isProduction ? prodDefault : nonProdDefault;
  return getInstanceTypeFromConfig(projectConfig, defaultInstanceType);
}

/**
 * Validates an instance type string without throwing errors
 * 
 * @param instanceTypeStr - Instance type string to validate
 * @returns Object with isValid flag and optional error message
 * 
 * @example
 * ```typescript
 * const result = validateInstanceType("t3.small");
 * if (!result.isValid) {
 *   console.error(result.error);
 * }
 * ```
 */
export function validateInstanceType(instanceTypeStr: string): {
  isValid: boolean;
  error?: string;
} {
  try {
    parseInstanceType(instanceTypeStr);
    return { isValid: true };
  } catch (error) {
    return {
      isValid: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
