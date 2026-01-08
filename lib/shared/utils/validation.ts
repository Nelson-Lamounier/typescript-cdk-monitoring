/** @format */

import {
  MIN_SUBNET_CIDR_MASK,
  MAX_SUBNET_CIDR_MASK,
} from "../types/networking-types";
  
  /**
   * Validate subnet CIDR mask is within acceptable range
   * 
   * @param cidrMask - CIDR mask to validate (16-28)
   * @throws Error if CIDR mask is out of range
   * 
   * @example
   * ```typescript
   * validateSubnetCidrMask(24); // Valid
   * validateSubnetCidrMask(8);  // Throws error
   * validateSubnetCidrMask(32); // Throws error
   * ```
   */
  export function validateSubnetCidrMask(cidrMask: number): void {
    if (cidrMask < MIN_SUBNET_CIDR_MASK || cidrMask > MAX_SUBNET_CIDR_MASK) {
      throw new Error(
        `Subnet CIDR mask must be between ${MIN_SUBNET_CIDR_MASK} and ${MAX_SUBNET_CIDR_MASK}. ` +
          `Received: ${cidrMask}. ` +
          `Common values: /24 (251 IPs), /20 (4091 IPs), /28 (11 IPs)`
      );
    }
  
    if (!Number.isInteger(cidrMask)) {
      throw new Error(
        `Subnet CIDR mask must be an integer. Received: ${cidrMask}`
      );
    }
  }
  
  /**
   * Validate subnet configuration object
   * 
   * @param config - Subnet configuration to validate
   * @throws Error if configuration is invalid
   */
  export function validateSubnetConfiguration(
    config: { name: string; cidrMask: number }
  ): void {
    if (!config.name || config.name.trim().length === 0) {
      throw new Error("Subnet name is required and cannot be empty");
    }
  
    validateSubnetCidrMask(config.cidrMask);
  }