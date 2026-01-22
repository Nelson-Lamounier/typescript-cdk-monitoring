/** @format */

import { Construct } from "constructs";
import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as s3 from "aws-cdk-lib/aws-s3";
import { NagSuppressions } from "cdk-nag";

import { SuppressionManager } from "../../cdk-nag";

// ============================================================================
// ALB CONSTRUCT
// ============================================================================

export interface AlbConstructProps {
  vpc: ec2.IVpc;
  envName: string;
  projectName?: string; // Project name for resource naming and tagging
  loadBalancerName: string;
  internetFacing?: boolean;
  securityGroup?: ec2.ISecurityGroup;
  deletionProtection?: boolean;
  accessLogEnabled?: boolean;
  accessLogBucket?: s3.IBucket;
  accessLogPrefix?: string;
}

/**
 * Reusable construct for creating an Application Load Balancer
 *
 * This construct focuses solely on creating the ALB resource itself.
 * Listeners, target groups, and security groups are managed separately.
 *
 * Features:
 * - Creates ALB in specified VPC
 * - Configurable internet-facing or internal
 * - Optional deletion protection
 * - Automatic tagging
 */
export class AlbConstruct extends Construct {
  public readonly loadBalancer: elbv2.ApplicationLoadBalancer;
  public readonly securityGroup: ec2.ISecurityGroup;
  public readonly accessLogBucket?: s3.IBucket;

  constructor(scope: Construct, id: string, props: AlbConstructProps) {
    super(scope, id);

    // Create security group if not provided
    this.securityGroup =
      props.securityGroup ||
      new ec2.SecurityGroup(this, "SecurityGroup", {
        vpc: props.vpc,
        description: `Security group for ${props.loadBalancerName}`,
        allowAllOutbound: true,
      });

    // Create S3 bucket for access logs if enabled and not provided
    if (props.accessLogEnabled) {
      const stack = cdk.Stack.of(this);
      const accountId = stack.account || cdk.Aws.ACCOUNT_ID;

      this.accessLogBucket =
        props.accessLogBucket ||
        new s3.Bucket(this, "AccessLogBucket", {
          bucketName: `${props.loadBalancerName}-access-logs-${accountId}`,
          encryption: s3.BucketEncryption.S3_MANAGED,
          blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
          enforceSSL: true, // Require SSL/TLS for all requests
          removalPolicy: cdk.RemovalPolicy.RETAIN,
          autoDeleteObjects: false,
          lifecycleRules: [
            {
              id: "DeleteOldLogs",
              enabled: true,
              expiration: cdk.Duration.days(90),
              transitions: [
                {
                  storageClass: s3.StorageClass.INFREQUENT_ACCESS,
                  transitionAfter: cdk.Duration.days(30),
                },
              ],
            },
          ],
          serverAccessLogsPrefix: "bucket-access-logs/",
        });

      // Add bucket policy to allow ALB to write logs
      // No need to add bucket policy explicitly as CDK handles this automatically
      // when logAccessLogs is called
    }

    // Create the Application Load Balancer
    this.loadBalancer = new elbv2.ApplicationLoadBalancer(this, "ALB", {
      vpc: props.vpc,
      loadBalancerName: props.loadBalancerName,
      internetFacing: props.internetFacing ?? true,
      securityGroup: this.securityGroup,
      vpcSubnets: {
        subnetType: props.internetFacing
          ? ec2.SubnetType.PUBLIC
          : ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      deletionProtection: props.deletionProtection ?? false,
    });

    // Enable access logs if configured
    if (props.accessLogEnabled && this.accessLogBucket) {
      this.loadBalancer.logAccessLogs(
        this.accessLogBucket,
        props.accessLogPrefix || "alb-logs"
      );
    }

    // Add tags (project-agnostic)
    cdk.Tags.of(this.loadBalancer).add("Environment", props.envName);
    if (props.projectName) {
      cdk.Tags.of(this.loadBalancer).add("Project", props.projectName);
    }
    cdk.Tags.of(this.loadBalancer).add("ManagedBy", "CDK");
    cdk.Tags.of(this.loadBalancer).add("Name", props.loadBalancerName);

    // Apply CDK Nag suppressions for internet-facing ALB security group
    // Internet-facing ALBs require public access, which is expected
    if (props.internetFacing) {
      NagSuppressions.addResourceSuppressions(
        this.securityGroup,
        SuppressionManager.getPublicAccessSuppressions(),
        true
      );
    }
  }

  /**
   * Allow inbound traffic on a specific port
   */
  public allowInbound(
    peer: ec2.IPeer,
    port: ec2.Port,
    description?: string
  ): void {
    if (this.securityGroup instanceof ec2.SecurityGroup) {
      this.securityGroup.addIngressRule(peer, port, description);
    }
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

// ============================================================================
// ALB LISTENER CONSTRUCT
// ============================================================================

export interface AlbListenerConstructProps {
  /**
   * The Application Load Balancer to add the listener to
   */
  loadBalancer: elbv2.IApplicationLoadBalancer;

  /**
   * Whether to enable HTTP listener
   * @default true
   */
  enableHttp?: boolean;

  /**
   * Whether to enable HTTPS listener
   * @default false
   */
  enableHttps?: boolean;

  /**
   * SSL certificate ARN for HTTPS listeners
   */
  certificateArn?: string;

  /**
   * Whether to redirect HTTP to HTTPS
   * @default false
   */
  redirectHttpToHttps?: boolean;

  /**
   * SSL policy for HTTPS listeners
   * @default ELBSecurityPolicy-TLS-1-2-2017-01
   */
  sslPolicy?: elbv2.SslPolicy;
}

/**
 * Construct for creating ALB listeners (HTTP and HTTPS)
 */
export class AlbListenerConstruct extends Construct {
  public readonly httpListener?: elbv2.ApplicationListener;
  public readonly httpsListener?: elbv2.ApplicationListener;
  public readonly listener: elbv2.ApplicationListener; // Primary listener for backward compatibility

  constructor(scope: Construct, id: string, props: AlbListenerConstructProps) {
    super(scope, id);

    const {
      loadBalancer,
      enableHttp = true,
      enableHttps = false,
      certificateArn,
      redirectHttpToHttps = false,
      sslPolicy = elbv2.SslPolicy.TLS12,
    } = props;

    // Create HTTP listener if enabled
    if (enableHttp) {
      const httpAction =
        redirectHttpToHttps && enableHttps
          ? elbv2.ListenerAction.redirect({
              protocol: "HTTPS",
              port: "443",
              permanent: true,
            })
          : elbv2.ListenerAction.fixedResponse(404, {
              contentType: "text/plain",
              messageBody: "Not Found",
            });

      this.httpListener = loadBalancer.addListener("HttpListener", {
        port: 80,
        protocol: elbv2.ApplicationProtocol.HTTP,
        defaultAction: httpAction,
      });
    }

    // Create HTTPS listener if enabled
    if (enableHttps && certificateArn) {
      this.httpsListener = loadBalancer.addListener("HttpsListener", {
        port: 443,
        protocol: elbv2.ApplicationProtocol.HTTPS,
        defaultAction: elbv2.ListenerAction.fixedResponse(404, {
          contentType: "text/plain",
          messageBody: "Not Found",
        }),
        certificates: [elbv2.ListenerCertificate.fromArn(certificateArn)],
        sslPolicy,
      });
    }

    // Set primary listener (HTTPS if available, otherwise HTTP)
    if (this.httpsListener) {
      this.listener = this.httpsListener;
    } else if (this.httpListener) {
      this.listener = this.httpListener;
    } else {
      throw new Error("At least one listener (HTTP or HTTPS) must be enabled");
    }

    // Note: Listener ARN outputs are created at the stack level, not here
    // to avoid duplicate outputs and maintain consistency
  }

  /**
   * Add a target group to the primary listener
   */
  public addTargetGroup(
    id: string,
    targetGroup: elbv2.IApplicationTargetGroup,
    priority: number,
    conditions: elbv2.ListenerCondition[]
  ): void {
    this.listener.addTargetGroups(id, {
      targetGroups: [targetGroup],
      priority,
      conditions,
    });
  }

  /**
   * Get the primary listener (HTTPS if available, otherwise HTTP)
   */
  public get primaryListener(): elbv2.ApplicationListener {
    return this.listener;
  }
}

// ============================================================================
// ALB TARGET GROUP CONSTRUCT
// ============================================================================

export interface AlbTargetGroupConstructProps {
  vpc: ec2.IVpc;
  name: string;
  port: number;
  protocol?: elbv2.ApplicationProtocol;
  targetType?: elbv2.TargetType;
  healthCheckPath?: string;
  healthCheckInterval?: cdk.Duration;
  healthCheckTimeout?: cdk.Duration;
  healthyThresholdCount?: number;
  unhealthyThresholdCount?: number;
  deregistrationDelay?: cdk.Duration;
  stickinessCookieDuration?: cdk.Duration;
  enableStickySession?: boolean;
}

/**
 * Reusable construct for creating ALB target groups
 *
 * This construct creates a target group with sensible defaults
 * and configurable health check parameters.
 *
 * Features:
 * - Configurable health checks
 * - Support for different target types (INSTANCE, IP, LAMBDA)
 * - Optional sticky sessions
 * - Deregistration delay configuration
 */
export class AlbTargetGroupConstruct extends Construct {
  public readonly targetGroup: elbv2.ApplicationTargetGroup;

  constructor(
    scope: Construct,
    id: string,
    props: AlbTargetGroupConstructProps
  ) {
    super(scope, id);

    const {
      vpc,
      name,
      port,
      protocol = elbv2.ApplicationProtocol.HTTP,
      targetType = elbv2.TargetType.INSTANCE,
      healthCheckPath = "/",
      healthCheckInterval = cdk.Duration.seconds(30),
      healthCheckTimeout = cdk.Duration.seconds(10),
      healthyThresholdCount = 2,
      unhealthyThresholdCount = 5,
      deregistrationDelay = cdk.Duration.seconds(30),
      stickinessCookieDuration,
      enableStickySession = false,
    } = props;

    // Create the target group
    this.targetGroup = new elbv2.ApplicationTargetGroup(this, "TargetGroup", {
      vpc,
      targetGroupName: name,
      port,
      protocol,
      targetType,
      deregistrationDelay,
      healthCheck: {
        enabled: true,
        path: healthCheckPath,
        interval: healthCheckInterval,
        timeout: healthCheckTimeout,
        healthyThresholdCount,
        unhealthyThresholdCount,
        port: "traffic-port",
        protocol: elbv2.Protocol.HTTP,
      },
      stickinessCookieDuration: enableStickySession
        ? stickinessCookieDuration || cdk.Duration.hours(1)
        : undefined,
    });

    // Add tags
    cdk.Tags.of(this.targetGroup).add("Name", name);
  }

  /**
   * Get the target group ARN
   */
  public get targetGroupArn(): string {
    return this.targetGroup.targetGroupArn;
  }

  /**
   * Get the target group name
   */
  public get targetGroupName(): string {
    return this.targetGroup.targetGroupName;
  }

  /**
   * Get the target group full name
   */
  public get targetGroupFullName(): string {
    return this.targetGroup.targetGroupFullName;
  }
}

// ============================================================================
// APPLICATION LOAD BALANCER CONSTRUCT (Alternative implementation)
// ============================================================================

export interface ApplicationLoadBalancerConstructProps {
  /**
   * VPC where the load balancer will be created
   */
  vpc: ec2.IVpc;

  /**
   * Environment name for resource naming and tagging
   */
  envName: string;

  /**
   * Project name for resource naming and tagging
   */
  projectName?: string;

  /**
   * Whether the load balancer is internet-facing
   * @default true
   */
  internetFacing?: boolean;

  /**
   * Security groups for the load balancer
   */
  securityGroups?: ec2.ISecurityGroup[];

  /**
   * Subnets for the load balancer
   * @default Public subnets for internet-facing, private for internal
   */
  subnets?: ec2.SubnetSelection;

  /**
   * Whether to enable access logs
   * @default false
   */
  enableAccessLogs?: boolean;

  /**
   * S3 bucket for access logs (required if enableAccessLogs is true)
   */
  accessLogsBucket?: s3.IBucket;

  /**
   * Prefix for access logs
   * @default "alb-access-logs"
   */
  accessLogsPrefix?: string;

  /**
   * Idle timeout for the load balancer
   * @default 60 seconds
   */
  idleTimeout?: cdk.Duration;

  /**
   * Whether to enable deletion protection
   * @default false
   */
  deletionProtection?: boolean;

  /**
   * Custom load balancer name
   */
  loadBalancerName?: string;
}

/**
 * Construct for creating an Application Load Balancer (project-agnostic)
 */
export class ApplicationLoadBalancerConstruct extends Construct {
  public readonly loadBalancer: elbv2.ApplicationLoadBalancer;
  public readonly securityGroup: ec2.SecurityGroup;

  constructor(
    scope: Construct,
    id: string,
    props: ApplicationLoadBalancerConstructProps
  ) {
    super(scope, id);

    const {
      vpc,
      envName,
      projectName,
      internetFacing = true,
      securityGroups = [],
      subnets,
      enableAccessLogs = false,
      accessLogsBucket,
      accessLogsPrefix = "alb-access-logs",
      idleTimeout = cdk.Duration.seconds(60),
      deletionProtection = false,
      loadBalancerName,
    } = props;

    // Create default security group if none provided
    // Project-agnostic naming: uses project name if provided
    const albName =
      loadBalancerName ||
      (projectName ? `${envName}-${projectName}-alb` : `${envName}-alb`);

    if (securityGroups.length === 0) {
      this.securityGroup = new ec2.SecurityGroup(this, "AlbSecurityGroup", {
        vpc,
        description: `Security group for ${albName}`,
        allowAllOutbound: true,
      });

      // Add ingress rules for HTTP and HTTPS
      this.securityGroup.addIngressRule(
        ec2.Peer.anyIpv4(),
        ec2.Port.tcp(80),
        "Allow HTTP access from anywhere"
      );

      this.securityGroup.addIngressRule(
        ec2.Peer.anyIpv4(),
        ec2.Port.tcp(443),
        "Allow HTTPS access from anywhere"
      );

      securityGroups.push(this.securityGroup);
    } else {
      this.securityGroup = securityGroups[0] as ec2.SecurityGroup;
    }

    // Determine subnets based on internet-facing configuration
    const subnetSelection = subnets || {
      subnetType: internetFacing
        ? ec2.SubnetType.PUBLIC
        : ec2.SubnetType.PRIVATE_WITH_EGRESS,
    };

    // Create Application Load Balancer
    // Project-agnostic naming: uses project name if provided
    this.loadBalancer = new elbv2.ApplicationLoadBalancer(
      this,
      "ApplicationAlb",
      {
        vpc,
        internetFacing,
        securityGroup: this.securityGroup,
        vpcSubnets: subnetSelection,
        idleTimeout,
        deletionProtection,
        loadBalancerName: albName,
      }
    );

    // Configure access logs if enabled
    if (enableAccessLogs && accessLogsBucket) {
      this.loadBalancer.logAccessLogs(accessLogsBucket, accessLogsPrefix);
    }

    // Add tags (project-agnostic)
    cdk.Tags.of(this.loadBalancer).add("Name", albName);
    cdk.Tags.of(this.loadBalancer).add("Environment", envName);
    if (projectName) {
      cdk.Tags.of(this.loadBalancer).add("Project", projectName);
    }
    cdk.Tags.of(this.loadBalancer).add("ManagedBy", "CDK");

    if (this.securityGroup) {
      const sgName = projectName
        ? `${envName}-${projectName}-alb-sg`
        : `${envName}-alb-sg`;
      cdk.Tags.of(this.securityGroup).add("Name", sgName);
      cdk.Tags.of(this.securityGroup).add("Environment", envName);
      if (projectName) {
        cdk.Tags.of(this.securityGroup).add("Project", projectName);
      }
      cdk.Tags.of(this.securityGroup).add("ManagedBy", "CDK");
    }

    // Output load balancer information (without export names to avoid conflicts)
    // Export names are managed at the stack level to prevent duplicate exports
    // Project-agnostic descriptions
    const projectLabel = projectName || "application";
    new cdk.CfnOutput(this, "LoadBalancerArn", {
      value: this.loadBalancer.loadBalancerArn,
      description: `ALB ARN for ${envName} ${projectLabel}`,
      // exportName removed - managed at stack level to avoid duplicate exports
    });

    new cdk.CfnOutput(this, "LoadBalancerDnsName", {
      value: this.loadBalancer.loadBalancerDnsName,
      description: `ALB DNS name for ${envName} ${projectLabel}`,
      // exportName removed - managed at stack level to avoid duplicate exports
    });

    new cdk.CfnOutput(this, "LoadBalancerHostedZoneId", {
      value: this.loadBalancer.loadBalancerCanonicalHostedZoneId,
      description: `ALB hosted zone ID for ${envName} ${projectLabel}`,
      // exportName removed - managed at stack level to avoid duplicate exports
    });
  }
}

// ============================================================================
// LOAD BALANCER STACK
// ============================================================================

export interface TargetGroupConfig {
  name: string;
  port: number;
  protocol?: elbv2.ApplicationProtocol;
  targetType?: elbv2.TargetType;
  healthCheckPath?: string;
  healthCheckInterval?: cdk.Duration;
  deregistrationDelay?: cdk.Duration;
}

export interface ListenerRuleConfig {
  targetGroupName: string;
  priority: number;
  pathPattern?: string;
  hostHeader?: string;
}

export interface LoadBalancerStackProps extends cdk.StackProps {
  envName: string;
  projectName?: string; // Project name for resource naming and tagging
  vpc: ec2.IVpc;
  loadBalancerName?: string;
  internetFacing?: boolean;
  enableHttps?: boolean;
  certificateArn?: string;
  redirectHttpToHttps?: boolean;
  deletionProtection?: boolean;
  accessLogEnabled?: boolean;
  allowedCidrs?: string[];
}

/**
 * Refactored Load Balancer Stack
 *
 * This stack creates an Application Load Balancer with modular constructs:
 * - AlbConstruct: Creates the ALB resource
 * - AlbListenerConstruct: Manages HTTP/HTTPS listeners
 * - AlbTargetGroupConstruct: Creates target groups (added dynamically)
 *
 * Benefits:
 * - Clear separation of concerns
 * - Easier to test individual components
 * - More flexible and reusable
 * - Better CDK Nag compliance
 *
 * Usage:
 * 1. Create the stack
 * 2. Add target groups with addTargetGroup()
 * 3. Add listener rules with addListenerRule()
 */
export class LoadBalancerStack extends cdk.Stack {
  public readonly alb: AlbConstruct;
  public readonly listeners: AlbListenerConstruct;
  public readonly targetGroups: Map<string, AlbTargetGroupConstruct> =
    new Map();

  constructor(scope: Construct, id: string, props: LoadBalancerStackProps) {
    super(scope, id, props);

    const {
      envName,
      projectName,
      vpc,
      loadBalancerName,
      internetFacing = true,
      enableHttps = false,
      certificateArn,
      redirectHttpToHttps = false,
      deletionProtection = false,
      accessLogEnabled = true,
      allowedCidrs = ["0.0.0.0/0"],
    } = props;

    // Project-agnostic load balancer name
    const albName =
      loadBalancerName ||
      (projectName ? `${envName}-${projectName}-alb` : `${envName}-alb`);

    // ========================================================================
    // 1. CREATE APPLICATION LOAD BALANCER
    // ========================================================================
    this.alb = new AlbConstruct(this, "ALB", {
      vpc,
      envName,
      projectName: projectName, // Pass project name for tagging
      loadBalancerName: albName,
      internetFacing,
      deletionProtection,
      accessLogEnabled,
      accessLogPrefix: projectName
        ? `${envName}/${projectName}/alb`
        : `${envName}/alb`,
    });

    // ========================================================================
    // 2. CONFIGURE SECURITY GROUP
    // ========================================================================
    // Allow HTTP traffic
    allowedCidrs.forEach((cidr) => {
      this.alb.allowInbound(
        ec2.Peer.ipv4(cidr),
        ec2.Port.tcp(80),
        `Allow HTTP from ${cidr}`
      );
    });

    // Allow HTTPS traffic if enabled
    if (enableHttps) {
      allowedCidrs.forEach((cidr) => {
        this.alb.allowInbound(
          ec2.Peer.ipv4(cidr),
          ec2.Port.tcp(443),
          `Allow HTTPS from ${cidr}`
        );
      });
    }

    // ========================================================================
    // 3. CREATE LISTENERS
    // ========================================================================
    this.listeners = new AlbListenerConstruct(this, "Listeners", {
      loadBalancer: this.alb.loadBalancer,
      enableHttp: true,
      enableHttps,
      certificateArn,
      redirectHttpToHttps,
    });

    // ========================================================================
    // 4. CLOUDFORMATION OUTPUTS
    // ========================================================================
    // Project-agnostic export naming: includes project name if provided
    const exportPrefix = projectName
      ? `${envName}-${projectName}`
      : `${envName}`;

    new cdk.CfnOutput(this, "LoadBalancerArn", {
      value: this.alb.loadBalancerArn,
      description: "Application Load Balancer ARN",
      exportName: `${exportPrefix}-alb-arn`,
    });

    new cdk.CfnOutput(this, "LoadBalancerDnsName", {
      value: this.alb.dnsName,
      description: "Application Load Balancer DNS Name",
      exportName: `${exportPrefix}-alb-dns`,
    });

    new cdk.CfnOutput(this, "SecurityGroupId", {
      value: this.alb.securityGroup.securityGroupId,
      description: "ALB Security Group ID",
      exportName: `${exportPrefix}-alb-sg-id`,
    });

    if (this.listeners.httpListener) {
      new cdk.CfnOutput(this, "HttpListenerArn", {
        value: this.listeners.httpListener.listenerArn,
        description: "HTTP Listener ARN",
        exportName: `${exportPrefix}-http-listener-arn`,
      });
    }

    if (this.listeners.httpsListener) {
      new cdk.CfnOutput(this, "HttpsListenerArn", {
        value: this.listeners.httpsListener.listenerArn,
        description: "HTTPS Listener ARN",
        exportName: `${exportPrefix}-https-listener-arn`,
      });
    }

    // ========================================================================
    // 5. CDK NAG SUPPRESSIONS
    // ========================================================================
    // Apply centralized CDK Nag suppressions using SuppressionManager
    // This includes public access suppressions for internet-facing ALBs
    // and load balancer-specific suppressions (access logging, etc.)
    SuppressionManager.applyToStack(this, "LoadBalancerStack", envName);

    // ========================================================================
    // 6. RESOURCE TAGGING
    // ========================================================================
    // Project-agnostic tagging: includes project name if provided
    cdk.Tags.of(this).add("Stack", "LoadBalancer");
    if (projectName) {
      cdk.Tags.of(this).add("Project", projectName);
    }
    cdk.Tags.of(this).add("Environment", envName);
    cdk.Tags.of(this).add("ManagedBy", "CDK");
  }

  /**
   * Add a target group to the load balancer
   */
  public addTargetGroup(
    config: TargetGroupConfig
  ): elbv2.IApplicationTargetGroup {
    const vpc = this.alb.loadBalancer.vpc;
    if (!vpc) {
      throw new Error("Load balancer VPC is not available");
    }

    const targetGroupConstruct = new AlbTargetGroupConstruct(
      this,
      `TG-${config.name}`,
      {
        vpc,
        name: config.name,
        port: config.port,
        protocol: config.protocol,
        targetType: config.targetType,
        healthCheckPath: config.healthCheckPath,
        healthCheckInterval: config.healthCheckInterval,
        deregistrationDelay: config.deregistrationDelay,
      }
    );

    this.targetGroups.set(config.name, targetGroupConstruct);

    // Output target group ARN
    new cdk.CfnOutput(this, `TargetGroupArn-${config.name}`, {
      value: targetGroupConstruct.targetGroupArn,
      description: `Target Group ARN for ${config.name}`,
      exportName: `${this.stackName}-tg-${config.name}-arn`,
    });

    return targetGroupConstruct.targetGroup;
  }

  /**
   * Add a listener rule to route traffic to a target group
   */
  public addListenerRule(config: ListenerRuleConfig): void {
    const targetGroupConstruct = this.targetGroups.get(config.targetGroupName);
    if (!targetGroupConstruct) {
      throw new Error(
        `Target group ${config.targetGroupName} not found. Create it first with addTargetGroup()`
      );
    }

    const conditions: elbv2.ListenerCondition[] = [];

    if (config.pathPattern) {
      conditions.push(
        elbv2.ListenerCondition.pathPatterns([config.pathPattern])
      );
    }

    if (config.hostHeader) {
      conditions.push(elbv2.ListenerCondition.hostHeaders([config.hostHeader]));
    }

    if (conditions.length === 0) {
      throw new Error(
        "At least one condition (pathPattern or hostHeader) is required"
      );
    }

    this.listeners.addTargetGroup(
      `Rule-${config.targetGroupName}`,
      targetGroupConstruct.targetGroup,
      config.priority,
      conditions
    );
  }

  /**
   * Get a target group by name
   */
  public getTargetGroup(name: string): elbv2.IApplicationTargetGroup {
    const targetGroup = this.targetGroups.get(name);
    if (!targetGroup) {
      throw new Error(`Target group ${name} not found`);
    }
    return targetGroup.targetGroup;
  }

  /**
   * Get the load balancer
   */
  public getLoadBalancer(): elbv2.IApplicationLoadBalancer {
    return this.alb.loadBalancer;
  }

  /**
   * Get the security group
   */
  public getSecurityGroup(): ec2.ISecurityGroup {
    return this.alb.securityGroup;
  }

  /**
   * Get the primary listener (HTTPS if available, otherwise HTTP)
   */
  public getPrimaryListener(): elbv2.ApplicationListener | undefined {
    return this.listeners.primaryListener;
  }
}
