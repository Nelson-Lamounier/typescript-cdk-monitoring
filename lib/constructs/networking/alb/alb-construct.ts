/** @format */

import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cdk from "aws-cdk-lib";
import { NagSuppressions } from "cdk-nag";

import { AlbConstructProps } from "../../../shared/types/networking-types";
import {
  validateVpcProvided,
  validateLoadBalancerName,
  validatePublicSubnetsForInternetFacing,
} from "../../../shared/utils/validation";
import {
  DEFAULT_ALB_IDLE_TIMEOUT_SECONDS,
  DEFAULT_ALB_ACCESS_LOG_RETENTION_DAYS,
  DEFAULT_ALB_ACCESS_LOG_TRANSITION_TO_IA_DAYS,
  DEFAULT_ALB_ACCESS_LOG_PREFIX,
  MIN_PRODUCTION_ALB_ACCESS_LOG_RETENTION_DAYS,
} from "../../../shared/constants/networking-constants";
import { SuppressionManager } from "../../../cdk-nag";
import { SecurityGroupConstruct } from "../security/security-group-construct";
import { COMMON_PORTS } from "../../../shared/constants/networking-constants";
import {
  BRIDGE_NETWORK_DYNAMIC_PORT_RANGE,
  MONITORING_PORTS,
} from "../../../shared/constants/monitoring-constants";

/**
 * Reusable construct for creating an Application Load Balancer with enhanced security and validation
 *
 * This construct creates an ALB with:
 * - Comprehensive input validation
 * - Security best practices (drop invalid headers, desync mitigation)
 * - Configurable access logging with KMS encryption support
 * - Production environment warnings
 * - Proper subnet validation
 * - Enhanced security group configuration
 *
 * Features:
 * - Creates ALB in specified VPC
 * - Configurable internet-facing or internal
 * - Optional deletion protection with production warnings
 * - Automatic tagging with environment and project context
 * - Configurable access logs with lifecycle management
 * - Security best practices enabled by default
 * - Helper method for HTTP to HTTPS redirect
 *
 * @example
 * ```typescript
 * const alb = new AlbConstruct(this, 'ALB', {
 *   vpc: vpc,
 *   envName: 'production',
 *   projectName: 'monitoring',
 *   loadBalancerName: 'web-alb',
 *   internetFacing: true,
 *   deletionProtection: true,
 *   accessLogEnabled: true,
 * });
 * ```
 */
export class AlbConstruct extends Construct {
  public readonly loadBalancer: elbv2.ApplicationLoadBalancer;
  public readonly securityGroup: ec2.ISecurityGroup;
  public readonly accessLogBucket?: s3.IBucket;

  constructor(scope: Construct, id: string, props: AlbConstructProps) {
    super(scope, id);

    // ========================================
    // Input Validation
    // ========================================

    // Validate VPC is provided
    validateVpcProvided(props.vpc);

    // Validate load balancer name
    validateLoadBalancerName(props.loadBalancerName);

    // Validate environment name
    if (
      !props.envName ||
      typeof props.envName !== "string" ||
      props.envName.trim().length === 0
    ) {
      throw new Error(
        "Environment name (envName) is required for AlbConstruct.\n\n" +
          "Troubleshooting Steps:\n" +
          " 1. Ensure envName property is provided in AlbConstructProps\n" +
          " 2. Use standard environment names: 'development', 'staging', 'production', 'pipeline'\n" +
          " 3. The environment name is used for tagging and resource identification"
      );
    }

    const {
      vpc,
      envName,
      loadBalancerName,
      projectName,
      internetFacing = true,
      securityGroup: providedSecurityGroup,
      deletionProtection = false,
      accessLogEnabled = false,
      accessLogBucket: providedAccessLogBucket,
      accessLogPrefix = DEFAULT_ALB_ACCESS_LOG_PREFIX,
      accessLogBucketEncryptionKey,
      accessLogRetentionDays = DEFAULT_ALB_ACCESS_LOG_RETENTION_DAYS,
      accessLogTransitionToIADays = DEFAULT_ALB_ACCESS_LOG_TRANSITION_TO_IA_DAYS,
      serverAccessLogsBucket,
      idleTimeout = cdk.Duration.seconds(DEFAULT_ALB_IDLE_TIMEOUT_SECONDS),
      // crossZoneLoadBalancing is always enabled for ALB (cannot be disabled)
      // Kept in interface for API compatibility but not used here
      http2Enabled = true,
      dropInvalidHeaderFields = true,
      desyncMitigationMode = elbv2.DesyncMitigationMode.DEFENSIVE,
      vpcSubnets,
    } = props;

    // Validate public subnets for internet-facing ALB
    if (internetFacing) {
      validatePublicSubnetsForInternetFacing(vpc);
    }

    // ========================================
    // Production Warnings
    // ========================================

    // Warn about deletion protection in production
    if (
      !deletionProtection &&
      (envName === "production" || envName === "prod")
    ) {
      cdk.Annotations.of(this).addWarning(
        "SECURITY WARNING: Deletion protection is disabled in production environment.\n" +
          "Deletion protection should be enabled in production to prevent accidental deletion of load balancers.\n" +
          "Consider setting deletionProtection: true for production environments."
      );
    }

    // Warn about access logs in production
    if (!accessLogEnabled && (envName === "production" || envName === "prod")) {
      cdk.Annotations.of(this).addWarning(
        "SECURITY WARNING: Access logs are disabled in production environment.\n" +
          "Access logs should be enabled in production for security auditing and troubleshooting.\n" +
          "Consider setting accessLogEnabled: true for production environments."
      );
    }

    // Warn about short retention in production
    if (
      accessLogEnabled &&
      accessLogRetentionDays < MIN_PRODUCTION_ALB_ACCESS_LOG_RETENTION_DAYS &&
      (envName === "production" || envName === "prod")
    ) {
      cdk.Annotations.of(this).addWarning(
        `SECURITY WARNING: Access log retention is ${accessLogRetentionDays} days, which is below the recommended minimum of ${MIN_PRODUCTION_ALB_ACCESS_LOG_RETENTION_DAYS} days for production.\n` +
          "Consider increasing accessLogRetentionDays for better compliance and security analysis."
      );
    }

    // Warn about internet-facing ALB
    if (internetFacing) {
      cdk.Annotations.of(this).addInfo(
        "INFO: Internet-facing load balancer is configured.\n" +
          "Ensure proper security group rules are configured and consider:\n" +
          " 1. WAF (Web Application Firewall) protection\n" +
          " 2. Rate limiting\n" +
          " 3. DDoS protection\n" +
          " 4. Regular security reviews of ingress rules"
      );
    }

    // ========================================
    // Security Group Creation
    // ========================================

    // Create security group if not provided
    if (providedSecurityGroup) {
      this.securityGroup = providedSecurityGroup;
    } else {
      // Use SecurityGroupConstruct for better security defaults
      const sgConstruct = new SecurityGroupConstruct(this, "SecurityGroup", {
        vpc,
        groupName: `${loadBalancerName}-sg`,
        description: `Security group for ${loadBalancerName} application load balancer`,
        envName,
        projectName,
        allowAllOutbound: false, // Security best practice
        egressRules: [
          {
            peer: ec2.Peer.anyIpv4(),
            port: ec2.Port.tcp(COMMON_PORTS.HTTPS),
            description:
              "Allow outbound HTTPS for health checks and backend communication",
          },
          {
            peer: ec2.Peer.anyIpv4(),
            port: ec2.Port.tcp(COMMON_PORTS.HTTP),
            description: "Allow outbound HTTP for health checks",
          },
          {
            peer: ec2.Peer.ipv4(vpc.vpcCidrBlock),
            port: ec2.Port.tcpRange(
              BRIDGE_NETWORK_DYNAMIC_PORT_RANGE.MIN,
              BRIDGE_NETWORK_DYNAMIC_PORT_RANGE.MAX
            ),
            description:
              "Allow outbound to ECS tasks on dynamic ports for health checks (bridge networking)",
          },
          // Prometheus uses static port mapping (hostPort: 9090), not dynamic ports
          // ALB needs egress to port 9090 for health checks and traffic forwarding
          {
            peer: ec2.Peer.ipv4(vpc.vpcCidrBlock),
            port: ec2.Port.tcp(MONITORING_PORTS.PROMETHEUS),
            description:
              "Allow outbound to Prometheus on static port 9090 for health checks",
          },
        ],
      });
      this.securityGroup = sgConstruct.securityGroup;
    }

    // ========================================
    // S3 Bucket for Access Logs
    // ========================================

    if (accessLogEnabled && !providedAccessLogBucket) {
      const stack = cdk.Stack.of(this);
      const accountId = stack.account || cdk.Aws.ACCOUNT_ID;

      // Determine encryption
      let encryption: s3.BucketEncryption;
      if (accessLogBucketEncryptionKey) {
        encryption = s3.BucketEncryption.KMS;
      } else {
        encryption = s3.BucketEncryption.S3_MANAGED;
      }

      // Build lifecycle rules
      const lifecycleRules: s3.LifecycleRule[] = [
        {
          id: "DeleteOldLogs",
          enabled: true,
          expiration: cdk.Duration.days(accessLogRetentionDays),
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: cdk.Duration.days(accessLogTransitionToIADays),
            },
          ],
        },
      ];

      // Create bucket with proper configuration
      this.accessLogBucket = new s3.Bucket(this, "AccessLogBucket", {
        bucketName: `${loadBalancerName}-access-logs-${accountId}`,
        encryption,
        encryptionKey: accessLogBucketEncryptionKey,
        blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
        enforceSSL: true,
        versioned: true, // CKV_AWS_21 fix - enable versioning
        removalPolicy: cdk.RemovalPolicy.RETAIN,
        autoDeleteObjects: false,
        lifecycleRules,
        // Only enable server access logs if separate bucket is provided
        // This avoids circular logging (bucket logging to itself)
        serverAccessLogsBucket: serverAccessLogsBucket,
        serverAccessLogsPrefix: serverAccessLogsBucket
          ? "bucket-access-logs/"
          : undefined,
      });
    } else if (accessLogEnabled && providedAccessLogBucket) {
      this.accessLogBucket = providedAccessLogBucket;
    }

    // ========================================
    // Application Load Balancer Creation
    // ========================================

    // Determine subnet selection
    const subnetSelection =
      vpcSubnets ||
      (internetFacing
        ? { subnetType: ec2.SubnetType.PUBLIC }
        : { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS });

    // Create the Application Load Balancer
    this.loadBalancer = new elbv2.ApplicationLoadBalancer(this, "ALB", {
      vpc,
      loadBalancerName,
      internetFacing,
      securityGroup: this.securityGroup,
      vpcSubnets: subnetSelection,
      deletionProtection,
      idleTimeout,
      http2Enabled,
      dropInvalidHeaderFields,
      desyncMitigationMode,
    });

    // Note: Cross-zone load balancing is always enabled for Application Load Balancers
    // and cannot be disabled (unlike Network Load Balancers)
    // The crossZoneLoadBalancing prop is kept for API compatibility but has no effect

    // ========================================
    // Access Logs Configuration
    // ========================================

    if (accessLogEnabled && this.accessLogBucket) {
      this.loadBalancer.logAccessLogs(this.accessLogBucket, accessLogPrefix);
    }

    // ========================================
    // Tagging
    // ========================================

    cdk.Tags.of(this.loadBalancer).add("Environment", envName);
    cdk.Tags.of(this.loadBalancer).add("ManagedBy", "CDK");
    cdk.Tags.of(this.loadBalancer).add("Name", loadBalancerName);
    cdk.Tags.of(this.loadBalancer).add(
      "ResourceType",
      "ApplicationLoadBalancer"
    );

    if (projectName) {
      cdk.Tags.of(this.loadBalancer).add("Project", projectName);
    }

    // ========================================
    // CDK Nag Suppressions
    // ========================================

    // Apply CDK Nag suppressions for internet-facing ALB security group
    // Stack-level suppressions don't always reach construct-level resources
    if (internetFacing && this.securityGroup instanceof ec2.SecurityGroup) {
      NagSuppressions.addResourceSuppressions(
        this.securityGroup,
        SuppressionManager.getPublicAccessSuppressions(),
        true
      );
    }
  }

  /**
   * Allow inbound traffic on a specific port
   *
   * This method adds ingress rules to the security group.
   * Works with concrete SecurityGroup instances.
   *
   * Note: If an ISecurityGroup is provided in props, this method will attempt
   * to add rules. For best results, use a concrete SecurityGroup or let the
   * construct create one automatically.
   *
   * @param peer - IP peer to allow access from
   * @param port - Port to allow
   * @param description - Optional description for the rule
   */
  public allowInbound(
    peer: ec2.IPeer,
    port: ec2.Port,
    description?: string
  ): void {
    // Always try to add the rule - works with concrete SecurityGroup
    // If ISecurityGroup is provided, this will use the connections API
    if (this.securityGroup instanceof ec2.SecurityGroup) {
      this.securityGroup.addIngressRule(peer, port, description);
    } else {
      // For ISecurityGroup, we can't directly add rules
      // Use connections API which works with ISecurityGroup
      // Note: This creates a connection rule, which may behave differently
      // than direct ingress rules for some peer types
      cdk.Annotations.of(this).addWarning(
        "allowInbound called with ISecurityGroup interface. " +
          "For best results, use a concrete SecurityGroup or let the construct create one automatically. " +
          "Attempting to use connections API as fallback."
      );

      // Use connections API as fallback
      // This works but may not support all peer types
      try {
        this.securityGroup.connections.allowFrom(peer, port, description);
      } catch (error) {
        throw new Error(
          `Failed to add ingress rule: ${
            error instanceof Error ? error.message : String(error)
          }. ` +
            "Consider using a concrete SecurityGroup instead of ISecurityGroup for full rule support."
        );
      }
    }
  }

  /**
   * Create HTTP to HTTPS redirect listener
   *
   * This is a common pattern for HTTPS-only applications.
   * Creates an HTTP listener that redirects all traffic to HTTPS.
   *
   * Note: The httpsListener parameter is kept for API compatibility
   * but is not required for the redirect to work.
   *
   * @param _httpsListener - The HTTPS listener (kept for API compatibility)
   * @returns The HTTP listener that redirects to HTTPS
   *
   * @example
   * ```typescript
   * const httpsListener = alb.addListener('HttpsListener', {
   *   port: 443,
   *   certificates: [certificate],
   * });
   *
   * alb.addHttpToHttpsRedirect(httpsListener);
   * ```
   */
  public addHttpToHttpsRedirect(
    _httpsListener: elbv2.ApplicationListener
  ): elbv2.ApplicationListener {
    return this.loadBalancer.addListener("HttpListener", {
      port: COMMON_PORTS.HTTP,
      protocol: elbv2.ApplicationProtocol.HTTP,
      defaultAction: elbv2.ListenerAction.redirect({
        protocol: "HTTPS",
        port: "443",
        permanent: true,
      }),
    });
  }

  /**
   * Get the load balancer ARN
   */
  public get loadBalancerArn(): string {
    return this.loadBalancer.loadBalancerArn;
  }

  /**
   * Get the load balancer DNS name
   */
  public get dnsName(): string {
    return this.loadBalancer.loadBalancerDnsName;
  }

  /**
   * Get the load balancer full name
   */
  public get loadBalancerFullName(): string {
    return this.loadBalancer.loadBalancerFullName;
  }
}
