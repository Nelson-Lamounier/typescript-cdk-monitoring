/** @format */

/**
 * Default CIDR mask for subnets
 * /24 provides 251 usable IP addresses per subnet
 */
export const DEFAULT_SUBNET_CIDR_MASK = 24;

/**
 * Minimum allowed CIDR mask for subnets
 * /16 provides maximum subnet size
 */
export const MIN_SUBNET_CIDR_MASK = 16;

/**
 * Maximum allowed CIDR mask for subnets
 * /28 provides minimum subnet size (11 usable IPs)
 */
export const MAX_SUBNET_CIDR_MASK = 28;

/**
 * Recommended CIDR masks for different use cases
 */
export const SUBNET_CIDR_RECOMMENDATIONS = {
  /**
   * Small workloads, development environments
   * Provides ~11 usable IPs
   */
  SMALL: 28,

  /**
   * Standard workloads, most production environments
   * Provides ~251 usable IPs
   */
  STANDARD: 24,

  /**
   * Large EKS clusters, high-density workloads
   * Provides ~4091 usable IPs
   */
  LARGE: 20,

  /**
   * Very large deployments
   * Provides ~16,379 usable IPs
   */
  EXTRA_LARGE: 18,
} as const;

/**
 * Default VPC CIDR block
 * /16 provides 65,536 IP addresses
 */
export const DEFAULT_VPC_CIDR = "10.0.0.0/16";

/**
 * Default number of availability zones
 */
export const DEFAULT_MAX_AZS = 2;

/**
 * Default number of NAT gateways
 * 0 = no NAT gateways (no internet access for private subnets)
 */
export const DEFAULT_NAT_GATEWAYS = 0;

/**
 * Default VPC Flow Logs retention period (days)
 * 7 days balances cost with basic compliance requirements
 * Production environments should use at least 30 days
 */
export const DEFAULT_FLOW_LOGS_RETENTION_DAYS = 7;

/**
 * Minimum recommended VPC Flow Logs retention for production environments
 * 30 days is the minimum for compliance and security analysis
 */
export const MIN_PRODUCTION_FLOW_LOGS_RETENTION_DAYS = 30;

/**
 * Recommended VPC Flow Logs retention periods for different environments
 */
export const FLOW_LOGS_RETENTION_RECOMMENDATIONS = {
  /**
   * Development environments
   * Short retention for cost optimisation
   */
  DEVELOPMENT: 7,

  /**
   * Staging environments
   * Moderate retention for testing and validation
   */
  STAGING: 30,

  /**
   * Production environments
   * Extended retention for compliance and security analysis
   */
  PRODUCTION: 90,

  /**
   * High-compliance production environments
   * Maximum retention for audit and forensic analysis
   */
  HIGH_COMPLIANCE: 365,
} as const;

/**
 * VPC Peering Lambda handler paths
 */
export const VPC_PEERING_LAMBDA_HANDLERS = {
  /**
   * Lambda handler for creating and accepting VPC peering connections
   */
  CREATE_ACCEPT: "handlers/vpc-peering-create-accept.ts",

  /**
   * Lambda handler for updating route tables in peer VPC
   */
  UPDATE_ROUTES: "handlers/vpc-peering-routes.ts",
} as const;

/**
 * Default Lambda timeout for VPC peering operations (seconds)
 * Peering operations typically complete in seconds, not minutes
 */
export const DEFAULT_VPC_PEERING_LAMBDA_TIMEOUT_SECONDS = 60;

/**
 * Default SSM parameter path prefix for VPC peering connections
 */
export const DEFAULT_VPC_PEERING_SSM_PREFIX = "/vpc-peering";
