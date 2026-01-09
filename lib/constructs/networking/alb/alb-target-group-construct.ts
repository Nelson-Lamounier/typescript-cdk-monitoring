/** @format */

import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as cdk from "aws-cdk-lib";

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
