/** @format */

/**
 * Shared utility functions for infrastructure code
 *
 * This module exports commonly used utility functions for:
 * - Retention period management (CloudWatch Logs)
 * - Validation (CIDR, subnet configurations, etc.)
 */

export {
  getRetentionDays,
  validateRetentionDays,
  getRecommendedRetentionDays,
} from "./retention";

export {
  validateCidr,
  validateSubnetCidrMask,
  validateSubnetConfiguration,
  cidrOverlaps,
  validateAccountId,
  validateRegion,
} from "./validation";

export { createVpcPeeringProvider } from "./lambda-helpers";
export { getUniqueRouteTables } from "./route-table-helpers";
