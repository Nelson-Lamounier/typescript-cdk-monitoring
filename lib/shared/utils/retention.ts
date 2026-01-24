/** @format */

import * as logs from "aws-cdk-lib/aws-logs";

/**
 * Map retention days to CDK RetentionDays enum
 *
 * Converts a numeric retention period (in days) to the closest matching
 * CDK RetentionDays enum value. This utility ensures consistent retention
 * period mapping across all CloudWatch Logs resources.
 *
 * @param days - Retention period in days (1 to infinite)
 * @returns Corresponding RetentionDays enum value
 *
 * @example
 * ```typescript
 * const retention = getRetentionDays(7); // Returns RetentionDays.ONE_WEEK
 * const logGroup = new logs.LogGroup(this, 'LogGroup', {
 *   retention: getRetentionDays(30),
 * });
 * ```
 */
export function getRetentionDays(days: number): logs.RetentionDays {
  if (days <= 1) return logs.RetentionDays.ONE_DAY;
  if (days <= 3) return logs.RetentionDays.THREE_DAYS;
  if (days <= 7) return logs.RetentionDays.ONE_WEEK;
  if (days <= 14) return logs.RetentionDays.TWO_WEEKS;
  if (days <= 30) return logs.RetentionDays.ONE_MONTH;
  if (days <= 60) return logs.RetentionDays.TWO_MONTHS;
  if (days <= 90) return logs.RetentionDays.THREE_MONTHS;
  if (days <= 120) return logs.RetentionDays.FOUR_MONTHS;
  if (days <= 150) return logs.RetentionDays.FIVE_MONTHS;
  if (days <= 180) return logs.RetentionDays.SIX_MONTHS;
  if (days <= 365) return logs.RetentionDays.ONE_YEAR;
  if (days <= 400) return logs.RetentionDays.THIRTEEN_MONTHS;
  if (days <= 545) return logs.RetentionDays.EIGHTEEN_MONTHS;
  if (days <= 731) return logs.RetentionDays.TWO_YEARS;
  if (days <= 1827) return logs.RetentionDays.FIVE_YEARS;
  return logs.RetentionDays.INFINITE;
}

/**
 * Validate retention days is within acceptable range
 *
 * @param retentionDays - Retention period in days to validate
 * @param minDays - Minimum allowed retention (default: 1)
 * @param maxDays - Maximum allowed retention (default: 2555, ~7 years)
 * @throws Error if retention days is out of range
 *
 * @example
 * ```typescript
 * validateRetentionDays(7); // Valid
 * validateRetentionDays(0); // Throws error
 * validateRetentionDays(10000); // Throws error
 * ```
 */
export function validateRetentionDays(
  retentionDays: number,
  minDays: number = 1,
  maxDays: number = 2555
): void {
  if (!Number.isInteger(retentionDays)) {
    throw new Error(
      `Retention days must be an integer. Received: ${retentionDays}`
    );
  }

  if (retentionDays < minDays) {
    throw new Error(
      `Retention days must be at least ${minDays}. Received: ${retentionDays}`
    );
  }

  if (retentionDays > maxDays) {
    throw new Error(
      `Retention days must not exceed ${maxDays} (approximately 7 years). ` +
        `Received: ${retentionDays}. ` +
        `For longer retention, consider using S3 for archival storage.`
    );
  }
}

/**
 * Get recommended retention days based on environment name
 *
 * Provides sensible defaults for different environment types to balance
 * cost with compliance requirements.
 *
 * @param envName - Environment name (e.g., "development", "staging", "production")
 * @returns Recommended retention period in days
 *
 * @example
 * ```typescript
 * const retention = getRecommendedRetentionDays("production"); // Returns 90
 * const logGroup = new logs.LogGroup(this, 'LogGroup', {
 *   retention: getRetentionDays(getRecommendedRetentionDays("development")),
 * });
 * ```
 */
export function getRecommendedRetentionDays(envName: string): number {
  const normalizedEnv = envName.toLowerCase();

  // Production environments require longer retention for compliance
  if (normalizedEnv.includes("prod") || normalizedEnv === "production") {
    return 90; // 3 months for production
  }

  // Staging environments need moderate retention for testing
  if (normalizedEnv.includes("stag") || normalizedEnv === "staging") {
    return 30; // 1 month for staging
  }

  // Development and other non-production environments
  // Use shorter retention to optimise costs
  return 7; // 1 week for development
}
