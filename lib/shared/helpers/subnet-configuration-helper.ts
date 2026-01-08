/** @format */

import * as ec2 from "aws-cdk-lib/aws-ec2";

import {
  SubnetConfiguration,
  DEFAULT_SUBNET_CIDR_MASK,
  SUBNET_CIDR_RECOMMENDATIONS,
} from "../types/networking-types";
import { validateSubnetCidrMask } from "../utils/validation";

/**
 * Helper class for creating standard subnet configurations
 *
 * Provides factory methods for common subnet patterns used in VPC creation.
 * Supports public, private, and isolated subnet types with configurable CIDR masks.
 * Includes validation and best-practice tagging.
 */
export class SubnetConfigurationHelper {
  /**
   * Create a standard public subnet configuration
   *
   * Public subnets have direct internet access via Internet Gateway
   * and automatically assign public IP addresses to launched instances.
   *
   * @param cidrMask - CIDR mask for subnet (default: 24 = ~251 usable IPs)
   * @param customTags - Additional tags to apply to subnet
   * @returns Subnet configuration for public subnet
   *
   * @example
   * ```typescript
   * // Standard /24 public subnet
   * const pubSubnet = SubnetConfigurationHelper.publicSubnet();
   *
   * // Large /20 public subnet with custom tags
   * const largePubSubnet = SubnetConfigurationHelper.publicSubnet(20, {
   *   "Purpose": "LoadBalancers"
   * });
   * ```
   */
  static publicSubnet(
    cidrMask: number = DEFAULT_SUBNET_CIDR_MASK,
    customTags?: Record<string, string>
  ): SubnetConfiguration {
    validateSubnetCidrMask(cidrMask);

    return {
      name: "Public",
      subnetType: ec2.SubnetType.PUBLIC,
      cidrMask,
      mapPublicIpOnLaunch: true,
      tags: {
        Type: "Public",
        "Network-Tier": "Public",
        ...customTags,
      },
    };
  }

  /**
   * Create a standard private subnet configuration with NAT
   *
   * Private subnets have internet access via NAT Gateway but instances
   * do not receive public IP addresses. Suitable for application servers
   * that need outbound internet access but should not be directly accessible.
   *
   * @param cidrMask - CIDR mask for subnet (default: 24 = ~251 usable IPs)
   * @param customTags - Additional tags to apply to subnet
   * @returns Subnet configuration for private subnet with egress
   *
   * @example
   * ```typescript
   * // Standard /24 private subnet
   * const privSubnet = SubnetConfigurationHelper.privateSubnet();
   *
   * // Large /20 private subnet for ECS tasks
   * const ecsSubnet = SubnetConfigurationHelper.privateSubnet(20, {
   *   "Purpose": "ECS-Tasks"
   * });
   * ```
   */
  static privateSubnet(
    cidrMask: number = DEFAULT_SUBNET_CIDR_MASK,
    customTags?: Record<string, string>
  ): SubnetConfiguration {
    validateSubnetCidrMask(cidrMask);

    // Note: mapPublicIpOnLaunch is not included for private subnets
    // CDK does not allow this property for PRIVATE_WITH_EGRESS or PRIVATE_ISOLATED subnets
    return {
      name: "Private",
      subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      cidrMask,
      tags: {
        Type: "Private",
        "Network-Tier": "Private",
        ...customTags,
      },
    };
  }

  /**
   * Create an isolated subnet configuration (no internet access)
   *
   * Isolated subnets have no internet gateway or NAT gateway access.
   * Suitable for databases and other resources that should not have
   * any internet connectivity for security purposes.
   *
   * @param cidrMask - CIDR mask for subnet (default: 24 = ~251 usable IPs)
   * @param customTags - Additional tags to apply to subnet
   * @returns Subnet configuration for isolated subnet
   *
   * @example
   * ```typescript
   * // Standard /24 isolated subnet for databases
   * const dbSubnet = SubnetConfigurationHelper.isolatedSubnet(24, {
   *   "Purpose": "Databases"
   * });
   * ```
   */
  static isolatedSubnet(
    cidrMask: number = DEFAULT_SUBNET_CIDR_MASK,
    customTags?: Record<string, string>
  ): SubnetConfiguration {
    validateSubnetCidrMask(cidrMask);

    // Note: mapPublicIpOnLaunch is not included for isolated subnets
    // CDK does not allow this property for PRIVATE_WITH_EGRESS or PRIVATE_ISOLATED subnets
    return {
      name: "Isolated",
      subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      cidrMask,
      tags: {
        Type: "Isolated",
        "Network-Tier": "Isolated",
        ...customTags,
      },
    };
  }

  /**
   * Create a standard 3-tier subnet configuration
   *
   * Returns public, private, and isolated subnet configurations.
   * Useful for applications requiring multiple security tiers.
   *
   * Architecture:
   * - Public tier: Load balancers, NAT gateways, bastion hosts
   * - Private tier: Application servers, ECS/EKS workloads
   * - Isolated tier: Databases, sensitive data stores
   *
   * @param cidrMask - CIDR mask for all subnets (default: 24)
   * @returns Array of subnet configurations for 3-tier architecture
   *
   * @example
   * ```typescript
   * const vpc = new ec2.Vpc(this, 'Vpc', {
   *   subnetConfiguration: SubnetConfigurationHelper.threeTierConfiguration()
   * });
   * ```
   */
  static threeTierConfiguration(
    cidrMask: number = DEFAULT_SUBNET_CIDR_MASK
  ): SubnetConfiguration[] {
    return [
      this.publicSubnet(cidrMask),
      this.privateSubnet(cidrMask),
      this.isolatedSubnet(cidrMask),
    ];
  }

  /**
   * Create a simple 2-tier subnet configuration (public + private)
   *
   * Most common configuration for standard web applications.
   * Public subnets for load balancers, private subnets for application servers.
   *
   * @param cidrMask - CIDR mask for all subnets (default: 24)
   * @returns Array of subnet configurations for 2-tier architecture
   *
   * @example
   * ```typescript
   * const vpc = new ec2.Vpc(this, 'Vpc', {
   *   subnetConfiguration: SubnetConfigurationHelper.twoTierConfiguration()
   * });
   * ```
   */
  static twoTierConfiguration(
    cidrMask: number = DEFAULT_SUBNET_CIDR_MASK
  ): SubnetConfiguration[] {
    return [this.publicSubnet(cidrMask), this.privateSubnet(cidrMask)];
  }

  /**
   * Create EKS-optimized subnet configuration
   *
   * Includes proper tagging for AWS Load Balancer Controller subnet discovery.
   * Uses larger CIDR blocks to accommodate pod IP addresses.
   *
   * Tags applied:
   * - kubernetes.io/role/elb: 1 (public subnets - for internet-facing LBs)
   * - kubernetes.io/role/internal-elb: 1 (private subnets - for internal LBs)
   * - kubernetes.io/cluster/<cluster-name>: shared (both tiers)
   *
   * @param clusterName - Name of the EKS cluster for tagging
   * @param publicCidrMask - CIDR mask for public subnets (default: 24)
   * @param privateCidrMask - CIDR mask for private subnets (default: 20 for pod IPs)
   * @returns Array of EKS-optimized subnet configurations
   *
   * @example
   * ```typescript
   * const eksSubnets = SubnetConfigurationHelper.eksConfiguration(
   *   "my-cluster",
   *   24,  // Public /24 for load balancers
   *   20   // Private /20 for nodes + pods
   * );
   * ```
   */
  static eksConfiguration(
    clusterName: string,
    publicCidrMask: number = DEFAULT_SUBNET_CIDR_MASK,
    privateCidrMask: number = SUBNET_CIDR_RECOMMENDATIONS.LARGE
  ): SubnetConfiguration[] {
    if (!clusterName || clusterName.trim().length === 0) {
      throw new Error("EKS cluster name is required for subnet configuration");
    }

    return [
      this.publicSubnet(publicCidrMask, {
        "kubernetes.io/role/elb": "1",
        [`kubernetes.io/cluster/${clusterName}`]: "shared",
      }),
      this.privateSubnet(privateCidrMask, {
        "kubernetes.io/role/internal-elb": "1",
        [`kubernetes.io/cluster/${clusterName}`]: "shared",
      }),
    ];
  }

  /**
   * Create cost-optimized subnet configuration
   *
   * Uses smaller CIDR blocks (/28) to minimize IP address usage.
   * Suitable for development environments or workloads with few resources.
   *
   * @returns Array of cost-optimized subnet configurations
   *
   * @example
   * ```typescript
   * // Development VPC with minimal IP usage
   * const devSubnets = SubnetConfigurationHelper.costOptimizedConfiguration();
   * ```
   */
  static costOptimizedConfiguration(): SubnetConfiguration[] {
    return [
      this.publicSubnet(SUBNET_CIDR_RECOMMENDATIONS.SMALL),
      this.privateSubnet(SUBNET_CIDR_RECOMMENDATIONS.SMALL),
    ];
  }

  /**
   * Create high-density subnet configuration
   *
   * Uses large CIDR blocks (/20) to support many resources.
   * Suitable for large ECS/EKS clusters or containerized workloads.
   *
   * @returns Array of high-density subnet configurations
   *
   * @example
   * ```typescript
   * // Production VPC with large ECS cluster
   * const prodSubnets = SubnetConfigurationHelper.highDensityConfiguration();
   * ```
   */
  static highDensityConfiguration(): SubnetConfiguration[] {
    return [
      this.publicSubnet(SUBNET_CIDR_RECOMMENDATIONS.LARGE),
      this.privateSubnet(SUBNET_CIDR_RECOMMENDATIONS.LARGE),
    ];
  }
}