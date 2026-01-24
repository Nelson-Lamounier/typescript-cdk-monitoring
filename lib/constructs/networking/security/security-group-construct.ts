/** @format */

import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";

import { SecurityGroupConstructProps } from "../../../shared/types/networking-types";
import {
  validateSecurityGroupName,
  validateSecurityGroupDescription,
  validateVpcProvided,
} from "../../../shared/utils/validation";
import {
  generateRuleDescription,
  generateSecurityWarnings,
} from "../../../shared/helpers/security-group-helper";

/**
 * Reusable construct for creating Security Groups with enhanced validation and security features
 *
 * This construct simplifies security group creation with:
 * - Comprehensive input validation
 * - Security warnings for overly permissive rules
 * - Automatic rule description generation
 * - Environment and project tagging
 * - Production-specific security checks
 * - Fixed egress rule handling (respects explicit rules even when allowAllOutbound=true)
 *
 * Features:
 * - Declarative rule definition
 * - Automatic tagging with environment and project context
 * - Support for both ingress and egress rules
 * - Configurable outbound traffic with security warnings
 * - Production environment validation
 * - Security warnings for unrestricted access
 *
 * @example
 * ```typescript
 * const securityGroup = new SecurityGroupConstruct(this, 'WebServerSG', {
 *   vpc: vpc,
 *   groupName: 'web-server-sg',
 *   description: 'Security group for web servers allowing HTTP/HTTPS traffic',
 *   envName: 'production',
 *   projectName: 'monitoring',
 *   allowAllOutbound: false, // Security best practice
 *   ingressRules: [
 *     {
 *       peer: ec2.Peer.anyIpv4(),
 *       port: ec2.Port.tcp(80),
 *       description: 'Allow HTTP from internet'
 *     }
 *   ]
 * });
 * ```
 */
export class SecurityGroupConstruct extends Construct {
  public readonly securityGroup: ec2.SecurityGroup;

  constructor(
    scope: Construct,
    id: string,
    props: SecurityGroupConstructProps
  ) {
    super(scope, id);

    // ========================================
    // Input Validation
    // ========================================

    // Validate VPC is provided
    validateVpcProvided(props.vpc);

    // Validate security group name
    validateSecurityGroupName(props.groupName);

    // Validate description
    validateSecurityGroupDescription(props.description);

    // Extract and validate environment name
    if (
      !props.envName ||
      typeof props.envName !== "string" ||
      props.envName.trim().length === 0
    ) {
      throw new Error(
        "Environment name (envName) is required for SecurityGroupConstruct.\n\n" +
          "Troubleshooting Steps:\n" +
          " 1. Ensure envName property is provided in SecurityGroupConstructProps\n" +
          " 2. Use standard environment names: 'development', 'staging', 'production', 'pipeline'\n" +
          " 3. The environment name is used for tagging and resource identification"
      );
    }

    const {
      vpc,
      groupName,
      description,
      envName,
      projectName,
      allowAllOutbound = false, // Security best practice: default to false
      ingressRules = [],
      egressRules = [],
    } = props;

    // ========================================
    // Security Warnings
    // ========================================

    // Warn about allowAllOutbound in production
    if (allowAllOutbound && (envName === "production" || envName === "prod")) {
      cdk.Annotations.of(this).addWarning(
        "SECURITY WARNING: allowAllOutbound is set to true in production environment.\n" +
          "This allows unrestricted outbound access, which violates security best practices.\n" +
          "Consider setting allowAllOutbound to false and using explicit egress rules instead.\n" +
          "This provides better security control and makes rule auditing easier."
      );
    } else if (allowAllOutbound) {
      cdk.Annotations.of(this).addWarning(
        "SECURITY WARNING: allowAllOutbound is set to true.\n" +
          "This allows unrestricted outbound access. Consider using explicit egress rules for better security control."
      );
    }

    // Validate and warn about overly permissive ingress rules
    ingressRules.forEach((rule, _index) => {
      const warnings = generateSecurityWarnings(
        rule.peer,
        rule.port,
        "ingress",
        envName
      );
      warnings.forEach((warning) => {
        cdk.Annotations.of(this).addWarning(
          `Ingress rule ${_index + 1}: ${warning}`
        );
      });
    });

    // Validate and warn about overly permissive egress rules
    egressRules.forEach((rule, _index) => {
      const warnings = generateSecurityWarnings(
        rule.peer,
        rule.port,
        "egress",
        envName
      );
      warnings.forEach((warning) => {
        cdk.Annotations.of(this).addWarning(
          `Egress rule ${_index + 1}: ${warning}`
        );
      });
    });

    // ========================================
    // Security Group Creation
    // ========================================

    // Create security group
    this.securityGroup = new ec2.SecurityGroup(this, "SecurityGroup", {
      vpc,
      securityGroupName: groupName,
      description,
      allowAllOutbound,
    });

    // ========================================
    // Ingress Rules
    // ========================================

    ingressRules.forEach((rule) => {
      // Generate description if not provided
      const ruleDescription =
        rule.description ||
        generateRuleDescription(rule.peer, rule.port, "ingress");

      this.securityGroup.addIngressRule(rule.peer, rule.port, ruleDescription);
    });

    // ========================================
    // Egress Rules
    // ========================================

    // CRITICAL FIX: Always respect explicitly provided egress rules
    // Even when allowAllOutbound=true, explicit egress rules should be added
    // This allows users to document specific outbound requirements
    egressRules.forEach((rule) => {
      // Generate description if not provided
      const ruleDescription =
        rule.description ||
        generateRuleDescription(rule.peer, rule.port, "egress");

      this.securityGroup.addEgressRule(rule.peer, rule.port, ruleDescription);
    });

    // ========================================
    // Tagging
    // ========================================

    // Add standard tags
    cdk.Tags.of(this.securityGroup).add("Name", groupName);
    cdk.Tags.of(this.securityGroup).add("Environment", envName);
    cdk.Tags.of(this.securityGroup).add("ManagedBy", "CDK");

    // Add project tag if provided
    if (projectName) {
      cdk.Tags.of(this.securityGroup).add("Project", projectName);
    }

    // Add resource type tag for easier filtering
    cdk.Tags.of(this.securityGroup).add("ResourceType", "SecurityGroup");
  }

  /**
   * Add an ingress rule to the security group
   *
   * Automatically generates a description if not provided and warns about
   * overly permissive rules.
   *
   * @param peer - IP peer to allow access from
   * @param port - Port to allow
   * @param description - Optional description (auto-generated if not provided)
   */
  public addIngressRule(
    peer: ec2.IPeer,
    port: ec2.Port,
    description?: string
  ): void {
    // Generate warnings for overly permissive rules
    const warnings = generateSecurityWarnings(peer, port, "ingress");
    warnings.forEach((warning) => {
      cdk.Annotations.of(this).addWarning(`Ingress rule: ${warning}`);
    });

    // Generate description if not provided
    const ruleDescription =
      description || generateRuleDescription(peer, port, "ingress");

    this.securityGroup.addIngressRule(peer, port, ruleDescription);
  }

  /**
   * Add an egress rule to the security group
   *
   * Automatically generates a description if not provided and warns about
   * overly permissive rules.
   *
   * Note: This method always adds the rule, even if allowAllOutbound=true.
   * This allows explicit documentation of outbound requirements.
   *
   * @param peer - IP peer to allow access to
   * @param port - Port to allow
   * @param description - Optional description (auto-generated if not provided)
   */
  public addEgressRule(
    peer: ec2.IPeer,
    port: ec2.Port,
    description?: string
  ): void {
    // Generate warnings for overly permissive rules
    const warnings = generateSecurityWarnings(peer, port, "egress");
    warnings.forEach((warning) => {
      cdk.Annotations.of(this).addWarning(`Egress rule: ${warning}`);
    });

    // Generate description if not provided
    const ruleDescription =
      description || generateRuleDescription(peer, port, "egress");

    this.securityGroup.addEgressRule(peer, port, ruleDescription);
  }

  /**
   * Allow connections from another security group
   *
   * @param other - Other security group to allow connections from
   * @param port - Port to allow
   * @param description - Optional description
   */
  public allowFrom(
    other: ec2.ISecurityGroup,
    port: ec2.Port,
    description?: string
  ): void {
    const ruleDescription =
      description ||
      generateRuleDescription(
        ec2.Peer.securityGroupId(other.securityGroupId),
        port,
        "ingress"
      );

    this.securityGroup.connections.allowFrom(other, port, ruleDescription);
  }

  /**
   * Allow connections to another security group
   *
   * @param other - Other security group to allow connections to
   * @param port - Port to allow
   * @param description - Optional description
   */
  public allowTo(
    other: ec2.ISecurityGroup,
    port: ec2.Port,
    description?: string
  ): void {
    const ruleDescription =
      description ||
      generateRuleDescription(
        ec2.Peer.securityGroupId(other.securityGroupId),
        port,
        "egress"
      );

    this.securityGroup.connections.allowTo(other, port, ruleDescription);
  }

  /**
   * Get the security group ID
   */
  public get securityGroupId(): string {
    return this.securityGroup.securityGroupId;
  }
}
