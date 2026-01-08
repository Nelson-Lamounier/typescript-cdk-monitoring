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

  /**
   * Validate VPC CIDR block format
   * 
   * Validates that the CIDR block is in the correct format (e.g., "10.0.0.0/16")
   * and that the network mask is within acceptable range (8-28).
   * 
   * @param cidr - CIDR block to validate (e.g., "10.0.0.0/16")
   * @throws Error if CIDR format is invalid
   * 
   * @example
   * ```typescript
   * validateCidr("10.0.0.0/16"); // Valid
   * validateCidr("10.0.0.0");    // Throws error (missing mask)
   * validateCidr("invalid");     // Throws error (invalid format)
   * validateCidr("10.0.0.0/32"); // Throws error (mask too large)
   * ```
   */
  export function validateCidr(cidr: string): void {
    if (!cidr || typeof cidr !== "string") {
      throw new Error("CIDR block must be a non-empty string");
    }

    // Check format: should be IP address followed by /mask
    const cidrRegex = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;
    if (!cidrRegex.test(cidr)) {
      throw new Error(
        `Invalid CIDR format: "${cidr}". Expected format: "x.x.x.x/mask" (e.g., "10.0.0.0/16")`
      );
    }

    // Extract and validate IP address parts
    const [ipAddress, maskStr] = cidr.split("/");
    const mask = parseInt(maskStr, 10);

    if (isNaN(mask)) {
      throw new Error(`Invalid CIDR mask: "${maskStr}". Must be a number between 8 and 28`);
    }

    // Validate mask range (8-28 for VPC CIDR blocks)
    if (mask < 8 || mask > 28) {
      throw new Error(
        `CIDR mask must be between 8 and 28. Received: ${mask}. ` +
        `Common values: /16 (65,536 IPs), /24 (256 IPs), /28 (16 IPs)`
      );
    }

    // Validate IP address octets
    const octets = ipAddress.split(".").map((octet) => parseInt(octet, 10));
    if (octets.length !== 4) {
      throw new Error(`Invalid IP address format: "${ipAddress}"`);
    }

    for (const octet of octets) {
      if (isNaN(octet) || octet < 0 || octet > 255) {
        throw new Error(
          `Invalid IP address: "${ipAddress}". Each octet must be between 0 and 255`
        );
      }
    }

    // Validate that the network portion matches the mask
    // For example, 10.0.0.0/16 should have 0.0 in the host portion
    // Note: We don't enforce strict network address validation as some use cases
    // may require non-zero network addresses, but the format must be valid
  }