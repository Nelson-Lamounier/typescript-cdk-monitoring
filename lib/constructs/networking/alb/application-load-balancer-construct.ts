/** @format */

import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

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
 * Construct for creating an Application Load Balancer with monitoring-specific configuration
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
    if (securityGroups.length === 0) {
      this.securityGroup = new ec2.SecurityGroup(this, "AlbSecurityGroup", {
        vpc,
        description: `Security group for ${envName} monitoring ALB`,
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
    this.loadBalancer = new elbv2.ApplicationLoadBalancer(
      this,
      "MonitoringAlb",
      {
        vpc,
        internetFacing,
        securityGroup: this.securityGroup,
        vpcSubnets: subnetSelection,
        idleTimeout,
        deletionProtection,
        loadBalancerName: loadBalancerName || `${envName}-monitoring-alb`,
      }
    );

    // Configure access logs if enabled
    if (enableAccessLogs && accessLogsBucket) {
      this.loadBalancer.logAccessLogs(accessLogsBucket, accessLogsPrefix);
    }

    // Add tags
    cdk.Tags.of(this.loadBalancer).add("Name", `${envName}-monitoring-alb`);
    cdk.Tags.of(this.loadBalancer).add("Environment", envName);
    cdk.Tags.of(this.loadBalancer).add("Purpose", "MonitoringLoadBalancer");
    cdk.Tags.of(this.loadBalancer).add("ManagedBy", "CDK");

    if (this.securityGroup) {
      cdk.Tags.of(this.securityGroup).add(
        "Name",
        `${envName}-monitoring-alb-sg`
      );
      cdk.Tags.of(this.securityGroup).add("Environment", envName);
      cdk.Tags.of(this.securityGroup).add("Purpose", "MonitoringALBSecurity");
      cdk.Tags.of(this.securityGroup).add("ManagedBy", "CDK");
    }

    // Output load balancer information (without export names to avoid conflicts)
    // Export names are managed at the stack level to prevent duplicate exports
    new cdk.CfnOutput(this, "LoadBalancerArn", {
      value: this.loadBalancer.loadBalancerArn,
      description: `ALB ARN for ${envName} monitoring`,
      // exportName removed - managed at stack level to avoid duplicate exports
    });

    new cdk.CfnOutput(this, "LoadBalancerDnsName", {
      value: this.loadBalancer.loadBalancerDnsName,
      description: `ALB DNS name for ${envName} monitoring`,
      // exportName removed - managed at stack level to avoid duplicate exports
    });

    new cdk.CfnOutput(this, "LoadBalancerHostedZoneId", {
      value: this.loadBalancer.loadBalancerCanonicalHostedZoneId,
      description: `ALB hosted zone ID for ${envName} monitoring`,
      // exportName removed - managed at stack level to avoid duplicate exports
    });
  }
}
