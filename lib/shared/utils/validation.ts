/** @format */

import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as logs from "aws-cdk-lib/aws-logs";

import {
  MIN_SUBNET_CIDR_MASK,
  MAX_SUBNET_CIDR_MASK,
  MAX_HEALTH_CHECK_THRESHOLD,
  MAX_TARGET_GROUP_PORT,
  MIN_HEALTH_CHECK_THRESHOLD,
  MIN_TARGET_GROUP_PORT,
} from "../constants/networking-constants";
import {
  MAX_CLUSTER_NAME_LENGTH,
  MIN_CLUSTER_NAME_LENGTH,
} from "../constants/compute-constants";
import { EcsLaunchType, ContainerConfig } from "../types/compute-types";
import {
  DEFAULT_ECS_SERVICE_MAX_HEALTHY_PERCENT,
  DEFAULT_ECS_SERVICE_MIN_HEALTHY_PERCENT,
} from "../constants/compute-constants";

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

/**
 * Validate load balancer name format
 *
 * AWS load balancer names must:
 * - Be 1-32 characters long
 * - Contain only alphanumeric characters and hyphens
 * - Not start or end with a hyphen
 * - Be unique within the account and region
 *
 * @param loadBalancerName - Load balancer name to validate
 * @throws Error if name format is invalid
 *
 * @example
 * ```typescript
 * validateLoadBalancerName("my-alb"); // Valid
 * validateLoadBalancerName(""); // Throws error (empty)
 * validateLoadBalancerName("-invalid"); // Throws error (starts with hyphen)
 * ```
 */
export function validateLoadBalancerName(loadBalancerName: string): void {
  if (!loadBalancerName || typeof loadBalancerName !== "string") {
    throw new Error(
      "Load balancer name is required and must be a non-empty string.\n\n" +
        "Troubleshooting Steps:\n" +
        " 1. Ensure loadBalancerName is provided in AlbConstructProps\n" +
        " 2. Verify the name is not undefined or null\n" +
        " 3. Check that the name follows AWS naming conventions"
    );
  }

  const trimmedName = loadBalancerName.trim();
  if (trimmedName.length === 0) {
    throw new Error(
      "Load balancer name cannot be empty or contain only whitespace.\n\n" +
        "Troubleshooting Steps:\n" +
        " 1. Provide a meaningful name for the load balancer\n" +
        " 2. Use alphanumeric characters and hyphens only\n" +
        " 3. Example: 'web-alb' or 'api-load-balancer'"
    );
  }

  if (trimmedName.length > 32) {
    throw new Error(
      `Load balancer name exceeds maximum length of 32 characters.\n\n` +
        `Received: ${trimmedName.length} characters.\n` +
        `Please shorten the name to comply with AWS limits.`
    );
  }

  if (loadBalancerName !== trimmedName) {
    throw new Error(
      "Load balancer name cannot have leading or trailing spaces.\n\n" +
        `Received: "${loadBalancerName}"\n` +
        `Trimmed: "${trimmedName}"\n\n` +
        "Please remove leading/trailing whitespace."
    );
  }

  // AWS allows: alphanumeric and hyphens, but cannot start or end with hyphen
  const validNameRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$/;
  if (!validNameRegex.test(trimmedName)) {
    throw new Error(
      `Load balancer name contains invalid characters or format: "${trimmedName}"\n\n` +
        "Allowed characters: alphanumeric and hyphens\n" +
        "Cannot start or end with a hyphen\n" +
        "Example valid names: 'web-alb', 'api-load-balancer', 'alb01'"
    );
  }
}

/**
 * Validate that public subnets exist for internet-facing load balancer
 *
 * @param vpc - VPC to check for public subnets
 * @throws Error if no public subnets found
 *
 * @example
 * ```typescript
 * validatePublicSubnetsForInternetFacing(vpc); // Valid if public subnets exist
 * ```
 */
export function validatePublicSubnetsForInternetFacing(
  vpc: ec2.IVpc
): void {
  const publicSubnets = vpc.publicSubnets;
  if (!publicSubnets || publicSubnets.length === 0) {
    throw new Error(
      "Internet-facing load balancer requires public subnets, but none were found in the VPC.\n\n" +
        "Troubleshooting Steps:\n" +
        " 1. Ensure the VPC has public subnets configured\n" +
        " 2. Verify subnet configuration includes PUBLIC subnet type\n" +
        " 3. Check that subnets are in different availability zones\n" +
        " 4. Consider using internal load balancer (internetFacing: false) if public subnets are not available\n\n" +
        "Example VPC configuration:\n" +
        "  const vpc = new ec2.Vpc(this, 'Vpc', {\n" +
        "    subnetConfiguration: [\n" +
        "      { name: 'Public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },\n" +
        "      { name: 'Private', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },\n" +
        "    ],\n" +
        "  });"
    );
  }
}

/**
 * Validate that certificate is provided when HTTPS is enabled
 *
 * @param enableHttps - Whether HTTPS is enabled
 * @param certificateArn - Certificate ARN (optional)
 * @throws Error if HTTPS enabled without certificate
 *
 * @example
 * ```typescript
 * validateCertificateForHttps(true, "arn:aws:acm:..."); // Valid
 * validateCertificateForHttps(true, undefined); // Throws error
 * ```
 */
export function validateCertificateForHttps(
  enableHttps: boolean,
  certificateArn?: string
): void {
  if (enableHttps && !certificateArn) {
    throw new Error(
      "Certificate ARN is required when HTTPS is enabled.\n\n" +
        "Troubleshooting Steps:\n" +
        " 1. Provide certificateArn in AlbListenerConstructProps when enableHttps is true\n" +
        " 2. Ensure the certificate is in the same region as the load balancer\n" +
        " 3. Verify the certificate is issued by ACM or imported into ACM\n\n" +
        "Example:\n" +
        "  const listener = new AlbListenerConstruct(this, 'Listener', {\n" +
        "    loadBalancer: alb,\n" +
        "    enableHttps: true,\n" +
        "    certificateArn: 'arn:aws:acm:region:account:certificate/cert-id',\n" +
        "  });"
    );
  }
}

/**
 * Validate that redirect prerequisites are met
 *
 * @param redirectHttpToHttps - Whether redirect is enabled
 * @param enableHttp - Whether HTTP is enabled
 * @param enableHttps - Whether HTTPS is enabled
 * @throws Error if redirect enabled without both HTTP and HTTPS
 *
 * @example
 * ```typescript
 * validateRedirectPrerequisites(true, true, true); // Valid
 * validateRedirectPrerequisites(true, false, true); // Throws error
 * ```
 */
export function validateRedirectPrerequisites(
  redirectHttpToHttps: boolean,
  enableHttp: boolean,
  enableHttps: boolean
): void {
  if (redirectHttpToHttps && (!enableHttp || !enableHttps)) {
    throw new Error(
      "HTTP to HTTPS redirect requires both HTTP and HTTPS listeners to be enabled.\n\n" +
        "Troubleshooting Steps:\n" +
        " 1. Set enableHttp: true when using redirectHttpToHttps\n" +
        " 2. Set enableHttps: true when using redirectHttpToHttps\n" +
        " 3. Ensure certificateArn is provided for HTTPS listener\n\n" +
        "Example:\n" +
        "  const listener = new AlbListenerConstruct(this, 'Listener', {\n" +
        "    loadBalancer: alb,\n" +
        "    enableHttp: true,\n" +
        "    enableHttps: true,\n" +
        "    certificateArn: 'arn:aws:acm:...',\n" +
        "    redirectHttpToHttps: true,\n" +
        "  });"
    );
  }
}

/**
 * Validate that at least one listener is enabled
 *
 * @param enableHttp - Whether HTTP is enabled
 * @param enableHttps - Whether HTTPS is enabled
 * @throws Error if both listeners are disabled
 *
 * @example
 * ```typescript
 * validateAtLeastOneListener(true, false); // Valid
 * validateAtLeastOneListener(false, true); // Valid
 * validateAtLeastOneListener(false, false); // Throws error
 * ```
 */
export function validateAtLeastOneListener(
  enableHttp: boolean,
  enableHttps: boolean
): void {
  if (!enableHttp && !enableHttps) {
    throw new Error(
      "At least one listener (HTTP or HTTPS) must be enabled.\n\n" +
        "Troubleshooting Steps:\n" +
        " 1. Set enableHttp: true to enable HTTP listener\n" +
        " 2. Set enableHttps: true to enable HTTPS listener (requires certificateArn)\n" +
        " 3. You can enable both listeners for maximum flexibility\n\n" +
        "Example:\n" +
        "  const listener = new AlbListenerConstruct(this, 'Listener', {\n" +
        "    loadBalancer: alb,\n" +
        "    enableHttp: true, // At least one must be true\n" +
        "    enableHttps: false,\n" +
        "  });"
    );
  }
}

/**
 * Validate environment name presence and formatting
 */
export function validateEnvName(envName: string): void {
  if (!envName || typeof envName !== "string" || envName.trim().length === 0) {
    throw new Error(
      "Environment name (envName) is required and must be a non-empty string.\n\n" +
        "Troubleshooting Steps:\n" +
        " 1. Provide envName in construct props\n" +
        " 2. Use standard values such as 'development', 'staging', 'production', or 'pipeline'\n" +
        " 3. Ensure the value is not undefined or null"
    );
  }
}

/**
 * Validate a listener or target group port number
 */
export function validatePortInRange(port: number, context = "Port"): void {
  if (!Number.isInteger(port)) {
    throw new Error(`${context} must be an integer. Received: ${port}`);
  }

  if (port < MIN_TARGET_GROUP_PORT || port > MAX_TARGET_GROUP_PORT) {
    throw new Error(
      `${context} must be between ${MIN_TARGET_GROUP_PORT} and ${MAX_TARGET_GROUP_PORT}. Received: ${port}`
    );
  }
}

/**
 * Validate target group name format
 */
export function validateTargetGroupName(name: string): void {
  if (!name || typeof name !== "string") {
    throw new Error("Target group name is required and must be a string.");
  }

  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new Error("Target group name cannot be empty or whitespace only.");
  }

  if (trimmed.length > 32) {
    throw new Error(
      `Target group name must not exceed 32 characters. Received: ${trimmed.length}`
    );
  }

  const nameRegex = /^[A-Za-z0-9-]+$/;
  if (!nameRegex.test(trimmed)) {
    throw new Error(
      "Target group name may only contain alphanumeric characters and hyphens."
    );
  }

  if (trimmed.startsWith("-") || trimmed.endsWith("-")) {
    throw new Error("Target group name cannot start or end with a hyphen.");
  }
}

/**
 * Validate health check timing to ensure timeout is less than interval
 */
export function validateHealthCheckTiming(
  intervalSeconds: number,
  timeoutSeconds: number
): void {
  if (intervalSeconds <= 0 || timeoutSeconds <= 0) {
    throw new Error("Health check interval and timeout must be greater than 0.");
  }

  if (!Number.isInteger(intervalSeconds) || !Number.isInteger(timeoutSeconds)) {
    throw new Error(
      "Health check interval and timeout must be integer values expressed in seconds."
    );
  }

  if (timeoutSeconds >= intervalSeconds) {
    throw new Error(
      `Health check timeout (${timeoutSeconds}s) must be less than the interval (${intervalSeconds}s).`
    );
  }
}

/**
 * Validate health check threshold counts
 */
export function validateHealthCheckThreshold(
  name: string,
  value: number
): void {
  if (!Number.isInteger(value)) {
    throw new Error(`${name} must be an integer.`);
  }

  if (value < MIN_HEALTH_CHECK_THRESHOLD || value > MAX_HEALTH_CHECK_THRESHOLD) {
    throw new Error(
      `${name} must be between ${MIN_HEALTH_CHECK_THRESHOLD} and ${MAX_HEALTH_CHECK_THRESHOLD}. Received: ${value}`
    );
  }
}

/**
 * Validate that VPC is provided when required by target type
 */
export function validateVpcForTargetGroup(
  vpc: ec2.IVpc | undefined,
  targetType: elbv2.TargetType
): void {
  if (targetType !== elbv2.TargetType.LAMBDA && !vpc) {
    throw new Error(
      "VPC is required for instance or IP target groups. Provide a VPC when targetType is not LAMBDA."
    );
  }
}

/**
 * Validate ECS cluster reference
 */
export function validateClusterProvided(cluster: ecs.ICluster): void {
  if (!cluster || !cluster.clusterName) {
    throw new Error("ECS cluster is required and must have a valid clusterName.");
  }
}

/**
 * Validate containers array and names
 */
export function validateContainers(containers: ContainerConfig[]): void {
  if (!containers || containers.length === 0) {
    throw new Error("At least one container configuration is required.");
  }

  containers.forEach((c) => {
    if (!c.name || c.name.trim().length === 0) {
      throw new Error("Container name is required.");
    }
    const nameRegex = /^[a-zA-Z0-9-_]+$/;
    if (!nameRegex.test(c.name)) {
      throw new Error(
        `Container name "${c.name}" is invalid. Only alphanumeric characters, hyphens, and underscores are allowed.`
      );
    }
  });
}

/**
 * Validate Fargate requirements
 */
export function validateFargateResources(
  launchType: EcsLaunchType,
  cpu?: number,
  memoryMiB?: number
): void {
  if (launchType === "FARGATE") {
    if (cpu === undefined || memoryMiB === undefined) {
      throw new Error("Fargate tasks require both cpu and memoryMiB to be specified.");
    }
  }
}

export function validateDesiredCount(desired?: number): void {
  if (desired !== undefined && desired <= 0) {
    throw new Error("Desired count must be greater than 0.");
  }
}

export function validateDeploymentPercentages(
  minHealthy: number,
  maxHealthy: number
): void {
  if (minHealthy <= 0 || minHealthy > 100) {
    throw new Error("minHealthyPercent must be between 1 and 100.");
  }
  if (maxHealthy < minHealthy || maxHealthy > 200) {
    throw new Error("maxHealthyPercent must be between minHealthyPercent and 200.");
  }
}

/**
 * Validate ECS cluster name formatting
 */
export function validateClusterName(clusterName: string): void {
  if (!clusterName || typeof clusterName !== "string") {
    throw new Error("Cluster name is required and must be a string.");
  }

  const trimmed = clusterName.trim();
  if (trimmed.length < MIN_CLUSTER_NAME_LENGTH || trimmed.length > MAX_CLUSTER_NAME_LENGTH) {
    throw new Error(
      `Cluster name must be between ${MIN_CLUSTER_NAME_LENGTH} and ${MAX_CLUSTER_NAME_LENGTH} characters. Received: ${trimmed.length}`
    );
  }

  const regex = /^[A-Za-z0-9\-_]+$/;
  if (!regex.test(trimmed)) {
    throw new Error(
      "Cluster name may only contain alphanumeric characters, hyphens, and underscores."
    );
  }
}

/**
 * Validate capacity ordering: min <= desired <= max
 */
export function validateCapacityOrder(
  min: number,
  desired: number,
  max: number
): void {
  if (min > desired) {
    throw new Error("Minimum capacity cannot exceed desired capacity.");
  }
  if (desired > max) {
    throw new Error("Desired capacity cannot exceed maximum capacity.");
  }
}

/**
 * Validate VPC has a valid ID
 */
export function validateVpcIdPresent(vpc: ec2.IVpc): void {
  if (!vpc || !vpc.vpcId || vpc.vpcId.trim().length === 0) {
    throw new Error("VPC is required and must have a valid VPC ID.");
  }
}

/**
 * Validate CloudWatch Log Group name format
 */
export function validateLogGroupName(name: string): void {
  if (!name || typeof name !== "string") {
    throw new Error("Log group name must be a non-empty string.");
  }
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new Error("Log group name cannot be empty.");
  }
  if (trimmed.length > 512) {
    throw new Error("Log group name must be 512 characters or fewer.");
  }
  const pattern = /^[.\-_/#A-Za-z0-9]+$/;
  if (!pattern.test(trimmed)) {
    throw new Error(
      "Log group name may only include alphanumeric characters and the symbols . - _ / #"
    );
  }
}
