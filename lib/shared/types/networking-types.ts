/** @format */

import * as ec2 from "aws-cdk-lib/aws-ec2";

/**
 * Subnet configuration interface for VPC subnet creation
 */
export interface SubnetConfiguration {
  name: string;
  subnetType: ec2.SubnetType;
  cidrMask: number;
  mapPublicIpOnLaunch?: boolean;
  tags?: Record<string, string>;
}

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