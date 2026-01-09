/** @format */

import * as ec2 from "aws-cdk-lib/aws-ec2";

import { COMMON_PORTS } from "../constants/networking-constants";

/**
 * Security Group Helper Utilities
 *
 * Provides helper functions for common security group patterns and validations.
 * These utilities help detect security anti-patterns and generate descriptive rule descriptions.
 */

/**
 * Check if a peer represents unrestricted access (0.0.0.0/0)
 *
 * @param peer - IP peer to check
 * @returns true if the peer allows access from anywhere (0.0.0.0/0)
 *
 * @example
 * ```typescript
 * isUnrestrictedPeer(ec2.Peer.anyIpv4()); // Returns true
 * isUnrestrictedPeer(ec2.Peer.ipv4("10.0.0.0/16")); // Returns false
 * ```
 */
export function isUnrestrictedPeer(peer: ec2.IPeer): boolean {
  // Check if peer is Peer.anyIpv4() or Peer.anyIpv6()
  // CDK's Peer.anyIpv4() creates a peer with CIDR "0.0.0.0/0"
  const peerString = peer.toString();
  return (
    peerString.includes("0.0.0.0/0") ||
    peerString.includes("::/0") ||
    peerString === "any-ipv4" ||
    peerString === "any-ipv6"
  );
}

/**
 * Check if a port represents all traffic (unrestricted port range)
 *
 * @param port - Port to check
 * @returns true if the port allows all traffic
 *
 * @example
 * ```typescript
 * isUnrestrictedPort(ec2.Port.allTraffic()); // Returns true
 * isUnrestrictedPort(ec2.Port.tcp(80)); // Returns false
 * ```
 */
export function isUnrestrictedPort(port: ec2.Port): boolean {
  const portString = port.toString();
  // Check for all traffic indicators
  return (
    portString.includes("all") ||
    portString.includes("0-65535") ||
    portString === "all-traffic"
  );
}

/**
 * Check if a port range is overly broad (covers more than 1000 ports)
 *
 * @param port - Port to check
 * @returns true if the port range is overly broad
 *
 * @example
 * ```typescript
 * isOverlyBroadPort(ec2.Port.tcpRange(1, 2000)); // Returns true
 * isOverlyBroadPort(ec2.Port.tcp(80)); // Returns false
 * ```
 */
export function isOverlyBroadPort(port: ec2.Port): boolean {
  // Try to extract port range from port object
  // This is a heuristic check - CDK doesn't expose port range directly
  const portString = port.toString();

  // Check for explicit wide ranges
  if (portString.includes("0-65535") || portString.includes("all")) {
    return true;
  }

  // Check for port ranges (format: "tcp(1000-2000)")
  const rangeMatch = portString.match(/(\d+)-(\d+)/);
  if (rangeMatch) {
    const from = parseInt(rangeMatch[1], 10);
    const to = parseInt(rangeMatch[2], 10);
    const range = to - from;
    return range > 1000;
  }

  return false;
}

/**
 * Generate a descriptive rule description from peer and port
 *
 * Creates meaningful descriptions for security group rules based on the peer
 * and port configuration, improving security auditability.
 *
 * @param peer - IP peer for the rule
 * @param port - Port for the rule
 * @param direction - Direction of the rule ('ingress' or 'egress')
 * @param _fallbackDescription - Optional fallback description (currently unused - kept for API compatibility)
 * @returns Generated description
 *
 * @example
 * ```typescript
 * generateRuleDescription(
 *   ec2.Peer.anyIpv4(),
 *   ec2.Port.tcp(80),
 *   'ingress'
 * ); // Returns "Allow HTTP (port 80) from anywhere (0.0.0.0/0)"
 * ```
 */
export function generateRuleDescription(
  peer: ec2.IPeer,
  port: ec2.Port,
  direction: "ingress" | "egress",
  _fallbackDescription?: string
): string {
  const peerString = peer.toString();
  const portString = port.toString();

  // Extract port number if possible
  const portMatch = portString.match(/tcp\((\d+)\)|udp\((\d+)\)/);
  const portNumber = portMatch ? portMatch[1] || portMatch[2] : null;

  // Map common ports to service names
  const portServiceMap: Record<number, string> = {
    [COMMON_PORTS.HTTP]: "HTTP",
    [COMMON_PORTS.HTTPS]: "HTTPS",
    [COMMON_PORTS.SSH]: "SSH",
    [COMMON_PORTS.RDP]: "RDP",
    [COMMON_PORTS.MYSQL]: "MySQL",
    [COMMON_PORTS.POSTGRESQL]: "PostgreSQL",
    [COMMON_PORTS.MONGODB]: "MongoDB",
    [COMMON_PORTS.REDIS]: "Redis",
    [COMMON_PORTS.NODE_EXPORTER]: "Prometheus Node Exporter",
    [COMMON_PORTS.PROMETHEUS]: "Prometheus",
    [COMMON_PORTS.GRAFANA]: "Grafana",
  };

  const serviceName = portNumber
    ? portServiceMap[parseInt(portNumber, 10)] || `port ${portNumber}`
    : portString;

  // Determine peer description
  let peerDescription: string;
  if (isUnrestrictedPeer(peer)) {
    peerDescription = "anywhere (0.0.0.0/0)";
  } else if (
    peerString.includes("10.") ||
    peerString.includes("172.") ||
    peerString.includes("192.")
  ) {
    // Extract CIDR from peer string if possible
    const cidrMatch = peerString.match(/(\d+\.\d+\.\d+\.\d+\/\d+)/);
    peerDescription = cidrMatch ? `CIDR ${cidrMatch[1]}` : "specified CIDR";
  } else if (peerString.includes("security-group")) {
    peerDescription = "security group";
  } else {
    peerDescription = "specified peer";
  }

  // Generate direction-specific description
  const directionVerb = direction === "ingress" ? "Allow" : "Allow outbound";
  const directionPreposition = direction === "ingress" ? "from" : "to";

  const description = `${directionVerb} ${serviceName} ${directionPreposition} ${peerDescription}`;

  // Add security warning for unrestricted access
  if (isUnrestrictedPeer(peer) && direction === "ingress") {
    return `${description} (SECURITY WARNING: Unrestricted access)`;
  }

  return description;
}

/**
 * Generate security warnings for overly permissive rules
 *
 * @param peer - IP peer for the rule
 * @param port - Port for the rule
 * @param direction - Direction of the rule
 * @param environment - Environment name (for production-specific warnings)
 * @returns Array of warning messages (empty if no warnings)
 *
 * @example
 * ```typescript
 * const warnings = generateSecurityWarnings(
 *   ec2.Peer.anyIpv4(),
 *   ec2.Port.allTraffic(),
 *   'ingress',
 *   'production'
 * ); // Returns array with security warnings
 * ```
 */
export function generateSecurityWarnings(
  peer: ec2.IPeer,
  port: ec2.Port,
  direction: "ingress" | "egress",
  environment?: string
): string[] {
  const warnings: string[] = [];

  // Check for unrestricted peer
  if (isUnrestrictedPeer(peer)) {
    if (direction === "ingress") {
      warnings.push(
        "SECURITY WARNING: Ingress rule allows access from anywhere (0.0.0.0/0). " +
          "This exposes your resources to the entire internet. " +
          "Consider restricting to specific CIDR blocks or security groups."
      );
    } else {
      warnings.push(
        "SECURITY WARNING: Egress rule allows outbound access to anywhere (0.0.0.0/0). " +
          "This allows unrestricted outbound traffic. " +
          "Consider restricting to specific destinations for better security."
      );
    }

    // Production-specific warnings
    if (environment === "production" || environment === "prod") {
      warnings.push(
        "CRITICAL: Unrestricted access in production environment. " +
          "This violates security best practices and may not comply with security policies. " +
          "Please review and restrict access appropriately."
      );
    }
  }

  // Check for unrestricted port
  if (isUnrestrictedPort(port)) {
    warnings.push(
      "SECURITY WARNING: Port rule allows all traffic (all ports). " +
        "This is overly permissive and should be restricted to specific ports. " +
        "Consider using specific port numbers or narrow port ranges."
    );
  }

  // Check for overly broad port range
  if (isOverlyBroadPort(port)) {
    warnings.push(
      "SECURITY WARNING: Port range is overly broad (covers more than 1000 ports). " +
        "Consider narrowing the port range to only necessary ports. " +
        "This improves security and makes rule auditing easier."
    );
  }

  return warnings;
}

/**
 * Create preset security group rules for common use cases
 *
 * These factory methods provide common security group patterns for:
 * - Application Load Balancers (ALB)
 * - Relational Database Services (RDS)
 * - ECS services
 * - Web servers
 * - Database servers
 */
export class SecurityGroupRulePresets {
  /**
   * Create ingress rules for an Application Load Balancer
   *
   * Allows HTTP (80) and HTTPS (443) from anywhere.
   * Use this for internet-facing load balancers.
   *
   * @param allowHttp - Allow HTTP traffic (default: true)
   * @param allowHttps - Allow HTTPS traffic (default: true)
   * @returns Array of ingress rules
   *
   * @example
   * ```typescript
   * const albRules = SecurityGroupRulePresets.forApplicationLoadBalancer();
   * securityGroup.addIngressRules(albRules);
   * ```
   */
  static forApplicationLoadBalancer(
    allowHttp: boolean = true,
    allowHttps: boolean = true
  ): Array<{ peer: ec2.IPeer; port: ec2.Port; description: string }> {
    const rules: Array<{
      peer: ec2.IPeer;
      port: ec2.Port;
      description: string;
    }> = [];

    if (allowHttp) {
      rules.push({
        peer: ec2.Peer.anyIpv4(),
        port: ec2.Port.tcp(COMMON_PORTS.HTTP),
        description: "Allow HTTP traffic from internet for load balancer",
      });
    }

    if (allowHttps) {
      rules.push({
        peer: ec2.Peer.anyIpv4(),
        port: ec2.Port.tcp(COMMON_PORTS.HTTPS),
        description: "Allow HTTPS traffic from internet for load balancer",
      });
    }

    return rules;
  }

  /**
   * Create ingress rules for an RDS database
   *
   * Allows database access from specified security group or CIDR.
   * Defaults to MySQL/PostgreSQL ports.
   *
   * @param peer - Peer to allow access from (security group or CIDR)
   * @param databaseType - Database type ('mysql', 'postgresql', 'mongodb', 'redis', or custom port)
   * @param customPort - Custom port number (used if databaseType is 'custom')
   * @returns Array of ingress rules
   *
   * @example
   * ```typescript
   * const dbRules = SecurityGroupRulePresets.forRdsDatabase(
   *   ec2.Peer.securityGroupId('sg-12345678'),
   *   'postgresql'
   * );
   * ```
   */
  static forRdsDatabase(
    peer: ec2.IPeer,
    databaseType:
      | "mysql"
      | "postgresql"
      | "mongodb"
      | "redis"
      | "custom" = "postgresql",
    customPort?: number
  ): Array<{ peer: ec2.IPeer; port: ec2.Port; description: string }> {
    const portMap: Record<string, number> = {
      mysql: COMMON_PORTS.MYSQL,
      postgresql: COMMON_PORTS.POSTGRESQL,
      mongodb: COMMON_PORTS.MONGODB,
      redis: COMMON_PORTS.REDIS,
    };

    const port =
      databaseType === "custom" && customPort
        ? customPort
        : portMap[databaseType] || COMMON_PORTS.POSTGRESQL;

    const dbName = databaseType.charAt(0).toUpperCase() + databaseType.slice(1);

    return [
      {
        peer,
        port: ec2.Port.tcp(port),
        description: `Allow ${dbName} database access from specified peer`,
      },
    ];
  }

  /**
   * Create ingress rules for ECS services
   *
   * Allows traffic from ALB security group on specified ports.
   *
   * @param albSecurityGroup - ALB security group to allow traffic from
   * @param ports - Ports to allow (default: [80, 443])
   * @returns Array of ingress rules
   *
   * @example
   * ```typescript
   * const ecsRules = SecurityGroupRulePresets.forEcsService(albSecurityGroup, [8080]);
   * ```
   */
  static forEcsService(
    albSecurityGroup: ec2.ISecurityGroup,
    ports: number[] = [COMMON_PORTS.HTTP, COMMON_PORTS.HTTPS]
  ): Array<{ peer: ec2.IPeer; port: ec2.Port; description: string }> {
    return ports.map((port) => ({
      peer: ec2.Peer.securityGroupId(albSecurityGroup.securityGroupId),
      port: ec2.Port.tcp(port),
      description: `Allow traffic from ALB on port ${port} for ECS service`,
    }));
  }

  /**
   * Create ingress rules for web servers
   *
   * Allows HTTP and HTTPS from anywhere (for public web servers).
   *
   * @param allowHttp - Allow HTTP traffic (default: true)
   * @param allowHttps - Allow HTTPS traffic (default: true)
   * @returns Array of ingress rules
   *
   * @example
   * ```typescript
   * const webRules = SecurityGroupRulePresets.forWebServer();
   * ```
   */
  static forWebServer(
    allowHttp: boolean = true,
    allowHttps: boolean = true
  ): Array<{ peer: ec2.IPeer; port: ec2.Port; description: string }> {
    const rules: Array<{
      peer: ec2.IPeer;
      port: ec2.Port;
      description: string;
    }> = [];

    if (allowHttp) {
      rules.push({
        peer: ec2.Peer.anyIpv4(),
        port: ec2.Port.tcp(COMMON_PORTS.HTTP),
        description: "Allow HTTP traffic from internet for web server",
      });
    }

    if (allowHttps) {
      rules.push({
        peer: ec2.Peer.anyIpv4(),
        port: ec2.Port.tcp(COMMON_PORTS.HTTPS),
        description: "Allow HTTPS traffic from internet for web server",
      });
    }

    return rules;
  }

  /**
   * Create egress rules for outbound HTTPS (common AWS service access)
   *
   * Allows outbound HTTPS for AWS service endpoints (ECR, ECS, CloudWatch, etc.).
   *
   * @returns Egress rule
   *
   * @example
   * ```typescript
   * const httpsEgress = SecurityGroupRulePresets.forOutboundHttps();
   * securityGroup.addEgressRule(httpsEgress.peer, httpsEgress.port, httpsEgress.description);
   * ```
   */
  static forOutboundHttps(): {
    peer: ec2.IPeer;
    port: ec2.Port;
    description: string;
  } {
    return {
      peer: ec2.Peer.anyIpv4(),
      port: ec2.Port.tcp(COMMON_PORTS.HTTPS),
      description:
        "Allow outbound HTTPS for AWS service endpoints (ECR, ECS, CloudWatch, SSM)",
    };
  }

  /**
   * Create egress rules for outbound HTTP (package updates)
   *
   * Allows outbound HTTP for package manager updates (yum, apt, etc.).
   *
   * @returns Egress rule
   *
   * @example
   * ```typescript
   * const httpEgress = SecurityGroupRulePresets.forOutboundHttp();
   * ```
   */
  static forOutboundHttp(): {
    peer: ec2.IPeer;
    port: ec2.Port;
    description: string;
  } {
    return {
      peer: ec2.Peer.anyIpv4(),
      port: ec2.Port.tcp(COMMON_PORTS.HTTP),
      description:
        "Allow outbound HTTP for package manager updates (yum, apt, etc.)",
    };
  }
}
