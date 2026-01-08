/** @format */

import {
  MIN_SUBNET_CIDR_MASK,
  MAX_SUBNET_CIDR_MASK,
} from "../constants/networking-constants";

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
export function validateSubnetConfiguration(config: {
  name: string;
  cidrMask: number;
}): void {
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
    throw new Error(
      `Invalid CIDR mask: "${maskStr}". Must be a number between 8 and 28`
    );
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

/**
 * Check if two CIDR blocks overlap
 *
 * Two CIDR blocks overlap if one contains the other or they share any IP addresses.
 * VPC peering connections cannot be established between VPCs with overlapping CIDRs.
 *
 * @param cidr1 - First CIDR block (e.g., "10.0.0.0/16")
 * @param cidr2 - Second CIDR block (e.g., "10.0.0.0/24")
 * @returns true if the CIDR blocks overlap, false otherwise
 *
 * @example
 * ```typescript
 * cidrOverlaps("10.0.0.0/16", "10.0.0.0/24"); // Returns true (overlaps)
 * cidrOverlaps("10.0.0.0/16", "172.16.0.0/16"); // Returns false (no overlap)
 * ```
 */
export function cidrOverlaps(cidr1: string, cidr2: string): boolean {
  // Validate both CIDR blocks first
  validateCidr(cidr1);
  validateCidr(cidr2);

  // Parse CIDR blocks
  const parseCidr = (cidr: string): { network: number; mask: number } => {
    const [ipAddress, maskStr] = cidr.split("/");
    const mask = parseInt(maskStr, 10);
    const octets = ipAddress.split(".").map((octet) => parseInt(octet, 10));

    // Convert IP to 32-bit integer
    const network =
      (octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3];

    return { network, mask };
  };

  const cidr1Parsed = parseCidr(cidr1);
  const cidr2Parsed = parseCidr(cidr2);

  // Calculate network addresses (with mask applied)
  const mask1 = 0xffffffff << (32 - cidr1Parsed.mask);
  const mask2 = 0xffffffff << (32 - cidr2Parsed.mask);

  const network1 = cidr1Parsed.network & mask1;
  const network2 = cidr2Parsed.network & mask2;

  // Calculate network ranges
  const size1 = Math.pow(2, 32 - cidr1Parsed.mask);
  const size2 = Math.pow(2, 32 - cidr2Parsed.mask);

  const end1 = network1 + size1 - 1;
  const end2 = network2 + size2 - 1;

  // Check for overlap: ranges overlap if one starts before the other ends
  return (
    (network1 >= network2 && network1 <= end2) ||
    (network2 >= network1 && network2 <= end1)
  );
}

/**
 * Validate AWS account ID format
 *
 * AWS account IDs are 12-digit numbers. This function validates the format
 * and provides helpful error messages.
 *
 * @param accountId - AWS account ID to validate
 * @throws Error if account ID format is invalid
 *
 * @example
 * ```typescript
 * validateAccountId("123456789012"); // Valid
 * validateAccountId("123"); // Throws error (too short)
 * validateAccountId("invalid"); // Throws error (not numeric)
 * ```
 */
export function validateAccountId(accountId: string): void {
  if (!accountId || typeof accountId !== "string") {
    throw new Error("AWS account ID must be a non-empty string");
  }

  // AWS account IDs are exactly 12 digits
  const accountIdRegex = /^\d{12}$/;
  if (!accountIdRegex.test(accountId)) {
    throw new Error(
      `Invalid AWS account ID format: "${accountId}". ` +
        `Account IDs must be exactly 12 digits (e.g., "123456789012"). ` +
        `Received: ${accountId.length} characters.`
    );
  }
}

/**
 * Validate AWS region name
 *
 * Validates that the region name matches known AWS region patterns.
 * AWS regions follow the pattern: {location}-{direction}-{number}
 * Examples: us-east-1, eu-west-1, ap-southeast-2
 *
 * @param region - AWS region name to validate
 * @throws Error if region format is invalid
 *
 * @example
 * ```typescript
 * validateRegion("us-east-1"); // Valid
 * validateRegion("eu-west-1"); // Valid
 * validateRegion("invalid"); // Throws error
 * ```
 */
export function validateRegion(region: string): void {
  if (!region || typeof region !== "string") {
    throw new Error("AWS region must be a non-empty string");
  }

  // AWS region pattern: {location}-{direction}-{number}
  // Examples: us-east-1, eu-west-1, ap-southeast-2, cn-north-1
  const regionRegex = /^[a-z]{2}-[a-z]+-\d+$/;
  if (!regionRegex.test(region)) {
    throw new Error(
      `Invalid AWS region format: "${region}". ` +
        `Regions must follow the pattern: {location}-{direction}-{number} ` +
        `(e.g., "us-east-1", "eu-west-1", "ap-southeast-2").`
    );
  }
}

/**
 * Validate security group name format
 *
 * AWS security group names must:
 * - Be 1-255 characters long
 * - Contain only alphanumeric characters, spaces, dots, hyphens, and underscores
 * - Not start or end with a space
 *
 * @param groupName - Security group name to validate
 * @throws Error if name format is invalid
 *
 * @example
 * ```typescript
 * validateSecurityGroupName("my-security-group"); // Valid
 * validateSecurityGroupName(""); // Throws error (empty)
 * validateSecurityGroupName(" name "); // Throws error (leading/trailing spaces)
 * ```
 */
export function validateSecurityGroupName(groupName: string): void {
  if (!groupName || typeof groupName !== "string") {
    throw new Error(
      "Security group name is required and must be a non-empty string.\n\n" +
        "Troubleshooting Steps:\n" +
        " 1. Ensure groupName is provided in SecurityGroupConstructProps\n" +
        " 2. Verify the name is not undefined or null\n" +
        " 3. Check that the name follows AWS naming conventions"
    );
  }

  const trimmedName = groupName.trim();
  if (trimmedName.length === 0) {
    throw new Error(
      "Security group name cannot be empty or contain only whitespace.\n\n" +
        "Troubleshooting Steps:\n" +
        " 1. Provide a meaningful name for the security group\n" +
        " 2. Use alphanumeric characters, hyphens, underscores, or dots\n" +
        " 3. Example: 'web-server-sg' or 'database-sg'"
    );
  }

  if (trimmedName.length > 255) {
    throw new Error(
      `Security group name exceeds maximum length of 255 characters.\n\n` +
        `Received: ${trimmedName.length} characters.\n` +
        `Please shorten the name to comply with AWS limits.`
    );
  }

  // AWS allows: alphanumeric, spaces, dots, hyphens, underscores
  // But cannot start or end with space
  if (groupName !== trimmedName) {
    throw new Error(
      "Security group name cannot have leading or trailing spaces.\n\n" +
        `Received: "${groupName}"\n` +
        `Trimmed: "${trimmedName}"\n\n` +
        "Please remove leading/trailing whitespace."
    );
  }

  // Validate characters: alphanumeric, spaces, dots, hyphens, underscores
  const validNameRegex = /^[a-zA-Z0-9\s._-]+$/;
  if (!validNameRegex.test(trimmedName)) {
    throw new Error(
      `Security group name contains invalid characters: "${trimmedName}"\n\n` +
        "Allowed characters: alphanumeric, spaces, dots (.), hyphens (-), underscores (_)\n" +
        "Example valid names: 'web-server-sg', 'database_sg', 'app.sg.01'"
    );
  }
}

/**
 * Validate security group description
 *
 * AWS security group descriptions must:
 * - Be at least 10 characters long (best practice for meaningful descriptions)
 * - Be no more than 255 characters
 * - Provide meaningful context about the security group's purpose
 *
 * @param description - Security group description to validate
 * @throws Error if description is invalid
 *
 * @example
 * ```typescript
 * validateSecurityGroupDescription("Security group for web servers"); // Valid
 * validateSecurityGroupDescription("SG"); // Throws error (too short)
 * ```
 */
export function validateSecurityGroupDescription(description: string): void {
  if (!description || typeof description !== "string") {
    throw new Error(
      "Security group description is required and must be a non-empty string.\n\n" +
        "Troubleshooting Steps:\n" +
        " 1. Ensure description is provided in SecurityGroupConstructProps\n" +
        " 2. Provide a meaningful description explaining the security group's purpose\n" +
        " 3. Example: 'Security group for web servers allowing HTTP/HTTPS traffic'"
    );
  }

  const trimmedDescription = description.trim();
  if (trimmedDescription.length === 0) {
    throw new Error(
      "Security group description cannot be empty or contain only whitespace.\n\n" +
        "Please provide a meaningful description that explains:\n" +
        " - What resources this security group protects\n" +
        " - What traffic patterns are expected\n" +
        " - Example: 'Security group for application load balancer allowing HTTP/HTTPS'"
    );
  }

  if (trimmedDescription.length < 10) {
    throw new Error(
      `Security group description is too short: ${trimmedDescription.length} characters.\n\n` +
        `Minimum length: 10 characters (best practice for meaningful descriptions)\n` +
        `Received: "${trimmedDescription}"\n\n` +
        "Please provide a more descriptive explanation of the security group's purpose.\n" +
        "Example: 'Security group for web servers allowing HTTP/HTTPS traffic from internet'"
    );
  }

  if (trimmedDescription.length > 255) {
    throw new Error(
      `Security group description exceeds maximum length of 255 characters.\n\n` +
        `Received: ${trimmedDescription.length} characters.\n` +
        `Please shorten the description to comply with AWS limits.`
    );
  }
}

/**
 * Validate that a VPC is provided and not undefined
 *
 * @param vpc - VPC to validate
 * @throws Error if VPC is undefined or null
 *
 * @example
 * ```typescript
 * validateVpcProvided(vpc); // Valid
 * validateVpcProvided(undefined); // Throws error
 * ```
 */
export function validateVpcProvided(vpc: unknown): void {
  if (!vpc) {
    throw new Error(
      "VPC is required for SecurityGroupConstruct but was not provided.\n\n" +
        "Troubleshooting Steps:\n" +
        " 1. Ensure vpc property is provided in SecurityGroupConstructProps\n" +
        " 2. Verify that the VPC construct has been created before creating the security group\n" +
        " 3. Check that you're passing the VPC reference correctly\n\n" +
        "Example:\n" +
        "  const vpc = new VpcConstruct(...);\n" +
        "  const sg = new SecurityGroupConstruct(this, 'SG', {\n" +
        "    vpc: vpc.vpc, // Ensure vpc property is set\n" +
        "    ...\n" +
        "  });"
    );
  }
}
