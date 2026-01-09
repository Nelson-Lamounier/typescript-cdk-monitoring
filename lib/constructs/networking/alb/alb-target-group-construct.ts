/** @format */

import { Construct } from "constructs";
import * as cdk from "aws-cdk-lib";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";

import {
  DEFAULT_ALB_HTTPS_PORT,
  DEFAULT_ALB_TARGET_GROUP_PORT,
  DEFAULT_ALB_TG_DEREGISTRATION_DELAY_SECONDS,
  DEFAULT_ALB_TG_GRPC_SUCCESS_CODES,
  DEFAULT_ALB_TG_HEALTH_CHECK_INTERVAL_SECONDS,
  DEFAULT_ALB_TG_HEALTH_CHECK_PATH,
  DEFAULT_ALB_TG_HEALTH_CHECK_PORT,
  DEFAULT_ALB_TG_HEALTH_CHECK_TIMEOUT_SECONDS,
  DEFAULT_ALB_TG_HEALTHY_THRESHOLD_COUNT,
  DEFAULT_ALB_TG_HTTP_SUCCESS_CODES,
  DEFAULT_ALB_TG_SLOW_START_SECONDS,
  DEFAULT_ALB_TG_STICKINESS_DURATION_SECONDS,
  DEFAULT_ALB_TG_UNHEALTHY_THRESHOLD_COUNT,
} from "../../../shared/constants/networking-constants";
import { AlbTargetGroupConstructProps } from "../../../shared/types/networking-types";
import {
  validateEnvName,
  validateHealthCheckThreshold,
  validateHealthCheckTiming,
  validatePortInRange,
  validateTargetGroupName,
  validateVpcForTargetGroup,
} from "../../../shared/utils/validation";

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
      envName,
      projectName,
      component,
      vpc,
      name,
      port,
      protocol,
      protocolVersion,
      targetType = elbv2.TargetType.INSTANCE,
      healthCheckPath = DEFAULT_ALB_TG_HEALTH_CHECK_PATH,
      healthCheckProtocol,
      healthCheckPort = DEFAULT_ALB_TG_HEALTH_CHECK_PORT,
      healthCheckIntervalSeconds = DEFAULT_ALB_TG_HEALTH_CHECK_INTERVAL_SECONDS,
      healthCheckTimeoutSeconds = DEFAULT_ALB_TG_HEALTH_CHECK_TIMEOUT_SECONDS,
      healthyThresholdCount = DEFAULT_ALB_TG_HEALTHY_THRESHOLD_COUNT,
      unhealthyThresholdCount = DEFAULT_ALB_TG_UNHEALTHY_THRESHOLD_COUNT,
      healthCheckMatcher,
      deregistrationDelaySeconds = DEFAULT_ALB_TG_DEREGISTRATION_DELAY_SECONDS,
      stickinessEnabled = false,
      stickinessCookieDurationSeconds = DEFAULT_ALB_TG_STICKINESS_DURATION_SECONDS,
      slowStartDurationSeconds = DEFAULT_ALB_TG_SLOW_START_SECONDS,
      loadBalancingAlgorithm,
      targetGroupAttributes,
      lambdaMultiValueHeadersEnabled = false,
      alarmConfig,
    } = props;

    validateEnvName(envName);
    validateTargetGroupName(name);

    const resolvedTargetType = targetType ?? elbv2.TargetType.INSTANCE;
    validateVpcForTargetGroup(vpc, resolvedTargetType);

    const resolvedPort =
      resolvedTargetType === elbv2.TargetType.LAMBDA
        ? undefined
        : port ?? DEFAULT_ALB_TARGET_GROUP_PORT;

    if (resolvedPort !== undefined) {
      validatePortInRange(resolvedPort, "Target group port");
    }

    const resolvedProtocol =
      resolvedTargetType === elbv2.TargetType.LAMBDA
        ? undefined
        : protocol ??
          (resolvedPort === DEFAULT_ALB_HTTPS_PORT
            ? elbv2.ApplicationProtocol.HTTPS
            : elbv2.ApplicationProtocol.HTTP);

    validateHealthCheckTiming(healthCheckIntervalSeconds, healthCheckTimeoutSeconds);
    validateHealthCheckThreshold("healthyThresholdCount", healthyThresholdCount);
    validateHealthCheckThreshold("unhealthyThresholdCount", unhealthyThresholdCount);

    const isGrpc = protocolVersion === elbv2.ApplicationProtocolVersion.GRPC;
    const resolvedHealthCheckProtocol =
      healthCheckProtocol ??
      (resolvedProtocol === elbv2.ApplicationProtocol.HTTPS ||
      resolvedPort === DEFAULT_ALB_HTTPS_PORT
        ? elbv2.Protocol.HTTPS
        : elbv2.Protocol.HTTP);

    const healthyHttpCodes = isGrpc
      ? undefined
      : healthCheckMatcher?.httpCodes ?? DEFAULT_ALB_TG_HTTP_SUCCESS_CODES;
    const healthyGrpcCodes = isGrpc
      ? healthCheckMatcher?.grpcCodes ?? DEFAULT_ALB_TG_GRPC_SUCCESS_CODES
      : undefined;

    const targetGroupHealthCheck: elbv2.HealthCheck = {
      enabled: true,
      path: isGrpc ? undefined : healthCheckPath,
      interval: cdk.Duration.seconds(healthCheckIntervalSeconds),
      timeout: cdk.Duration.seconds(healthCheckTimeoutSeconds),
      healthyThresholdCount,
      unhealthyThresholdCount,
      port: healthCheckPort,
      protocol: resolvedHealthCheckProtocol,
      healthyHttpCodes,
      healthyGrpcCodes,
    };

    this.targetGroup = new elbv2.ApplicationTargetGroup(this, "TargetGroup", {
      vpc: resolvedTargetType === elbv2.TargetType.LAMBDA ? undefined : vpc,
      targetGroupName: name,
      port: resolvedPort,
      protocol: resolvedProtocol,
      protocolVersion,
      targetType: resolvedTargetType,
      deregistrationDelay: cdk.Duration.seconds(deregistrationDelaySeconds),
      healthCheck: targetGroupHealthCheck,
      slowStart:
        slowStartDurationSeconds > 0
          ? cdk.Duration.seconds(slowStartDurationSeconds)
          : undefined,
      stickinessCookieDuration: stickinessEnabled
        ? cdk.Duration.seconds(
            stickinessCookieDurationSeconds ?? DEFAULT_ALB_TG_STICKINESS_DURATION_SECONDS
          )
        : undefined,
      loadBalancingAlgorithmType: loadBalancingAlgorithm,
    });

    if (lambdaMultiValueHeadersEnabled) {
      this.targetGroup.setAttribute("lambda.multi_value_headers.enabled", "true");
    }

    if (targetGroupAttributes) {
      Object.entries(targetGroupAttributes).forEach(([key, value]) => {
        this.targetGroup.setAttribute(key, value);
      });
    }

    if (
      (envName === "production" || envName === "prod") &&
      deregistrationDelaySeconds < 60
    ) {
      cdk.Annotations.of(this).addWarning(
        "Deregistration delay is below 60 seconds in production. Consider increasing to reduce connection resets during deployments."
      );
    }

    if (
      (envName === "production" || envName === "prod") &&
      healthCheckIntervalSeconds < 10
    ) {
      cdk.Annotations.of(this).addWarning(
        "Health check interval is aggressive for production. Consider using 10 seconds or higher to avoid overwhelming targets."
      );
    }

    const tags = cdk.Tags.of(this.targetGroup);
    tags.add("Name", name);
    tags.add("Environment", envName);
    tags.add("ManagedBy", "CDK");
    tags.add("ResourceType", "ApplicationTargetGroup");
    if (projectName) {
      tags.add("Project", projectName);
    }
    if (component) {
      tags.add("Component", component);
    }

    const shouldCreateUnhealthyAlarm =
      alarmConfig?.unhealthyHostThreshold !== undefined
        ? alarmConfig.createUnhealthyHostAlarm !== false
        : false;

    if (shouldCreateUnhealthyAlarm && alarmConfig?.unhealthyHostThreshold !== undefined) {
      const unhealthyMetric = this.targetGroup.metricUnhealthyHostCount({
        period: alarmConfig.metricPeriod ?? cdk.Duration.minutes(1),
      });

      new cloudwatch.Alarm(this, "UnhealthyHostsAlarm", {
        metric: unhealthyMetric,
        threshold: alarmConfig.unhealthyHostThreshold,
        evaluationPeriods: alarmConfig.evaluationPeriods ?? 2,
        datapointsToAlarm: alarmConfig.datapointsToAlarm,
        comparisonOperator:
          alarmConfig.comparisonOperator ??
          cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData:
          alarmConfig.treatMissingData ?? cloudwatch.TreatMissingData.NOT_BREACHING,
        alarmName: alarmConfig.alarmName,
        alarmDescription:
          alarmConfig.alarmDescription ??
          `Unhealthy hosts exceeded threshold for target group ${name}`,
      });
    }
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
