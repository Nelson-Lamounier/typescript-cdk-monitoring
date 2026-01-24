/** @format */
/// <reference types="jest" />

import * as cdk from "aws-cdk-lib";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { Template, Match } from "aws-cdk-lib/assertions";

import { AlbTargetGroupConstruct } from "../../../../lib/constructs/networking/alb/alb-target-group-construct";
import { VpcConstruct } from "../../../../lib/constructs/networking/vpc/vpc-construct";
import {
  DEFAULT_ALB_HTTPS_PORT,
  DEFAULT_ALB_TG_HTTP_SUCCESS_CODES,
  DEFAULT_ALB_TG_STICKINESS_DURATION_SECONDS,
} from "../../../../lib/shared/constants/networking-constants";
import {
  TEST_CONFIG,
  BASE_TEST_CONSTANTS,
  createTestApp,
  extendExpectWithCdkMatchers,
} from "../../utils/stack-test-utils";

// ============================================================================
// CUSTOM MATCHERS SETUP
// ============================================================================

extendExpectWithCdkMatchers();

// ============================================================================
// TEST CONFIGURATION
// ============================================================================

const TEST_CONSTANTS = {
  ...BASE_TEST_CONSTANTS,
  PORTS: {
    HTTP: 80,
    HTTPS: DEFAULT_ALB_HTTPS_PORT,
    CUSTOM: 8080,
    CUSTOM_HEALTH: 8081,
    GRPC: 50051,
  },
  TARGET_GROUP: {
    MAX_PORT: 70000,
    INVALID_NAME: "invalid name with spaces",
  },
  HEALTH_CHECK: {
    INTERVAL: 10,
    TIMEOUT: 10,
  },
  SLOW_START_DURATION: 120,
  DEREGISTRATION_DELAY: 45,
} as const;

describe("AlbTargetGroupConstruct", () => {
  let app: cdk.App;
  let stack: cdk.Stack;
  let vpcConstruct: VpcConstruct;

  beforeEach(() => {
    app = createTestApp();
    stack = new cdk.Stack(app, "TestStack", {
      env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
    });
    vpcConstruct = new VpcConstruct(stack, "TestVpc", {
      envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
    });
  });

  test("creates target group with defaults and tags", () => {
    new AlbTargetGroupConstruct(stack, "Tg", {
      envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
      projectName: "monitoring",
      component: "api",
      vpc: vpcConstruct.vpc,
      name: "api-tg",
      port: TEST_CONSTANTS.PORTS.HTTP,
    });

    const template = Template.fromStack(stack);

    expect(() => {
      template.resourceCountIs("AWS::ElasticLoadBalancingV2::TargetGroup", 1);
      template.hasResourceProperties("AWS::ElasticLoadBalancingV2::TargetGroup", {
        Port: TEST_CONSTANTS.PORTS.HTTP,
        Protocol: "HTTP",
        TargetGroupAttributes: Match.arrayWith([
          Match.objectLike({ Key: "stickiness.enabled", Value: "false" }),
        ]),
        HealthCheckEnabled: true,
        Matcher: { HttpCode: DEFAULT_ALB_TG_HTTP_SUCCESS_CODES },
      });
    }).not.toThrow();
  });

  test("uses HTTPS defaults when port 443 is provided", () => {
    new AlbTargetGroupConstruct(stack, "HttpsTg", {
      envName: TEST_CONSTANTS.ENVIRONMENTS.PRODUCTION,
      vpc: vpcConstruct.vpc,
      name: "https-tg",
      port: TEST_CONSTANTS.PORTS.HTTPS,
    });

    const template = Template.fromStack(stack);

    expect(() => {
      template.hasResourceProperties("AWS::ElasticLoadBalancingV2::TargetGroup", {
        Port: TEST_CONSTANTS.PORTS.HTTPS,
        Protocol: "HTTPS",
        HealthCheckProtocol: "HTTPS",
        Matcher: { HttpCode: DEFAULT_ALB_TG_HTTP_SUCCESS_CODES },
      });
    }).not.toThrow();
  });

  test("supports gRPC protocol version with gRPC matcher and no path", () => {
    new AlbTargetGroupConstruct(stack, "GrpcTg", {
      envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
      vpc: vpcConstruct.vpc,
      name: "grpc-tg",
      port: TEST_CONSTANTS.PORTS.GRPC,
      protocol: elbv2.ApplicationProtocol.HTTP,
      protocolVersion: elbv2.ApplicationProtocolVersion.GRPC,
      healthCheckProtocol: elbv2.Protocol.HTTP,
    });

    const template = Template.fromStack(stack);

    expect(() => {
      template.hasResourceProperties("AWS::ElasticLoadBalancingV2::TargetGroup", {
        ProtocolVersion: "GRPC",
        HealthCheckProtocol: "HTTP",
        Matcher: { GrpcCode: "0-99" },
        HealthCheckPath: Match.absent(),
      });
    }).not.toThrow();
  });

  test("accepts custom health check matcher and port", () => {
    new AlbTargetGroupConstruct(stack, "CustomHealth", {
      envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
      vpc: vpcConstruct.vpc,
      name: "custom-health",
      port: TEST_CONSTANTS.PORTS.CUSTOM,
      healthCheckPort: String(TEST_CONSTANTS.PORTS.CUSTOM_HEALTH),
      healthCheckMatcher: {
        httpCodes: "200,302",
      },
    });

    const template = Template.fromStack(stack);

    expect(() => {
      template.hasResourceProperties("AWS::ElasticLoadBalancingV2::TargetGroup", {
        Port: TEST_CONSTANTS.PORTS.CUSTOM,
        HealthCheckPort: String(TEST_CONSTANTS.PORTS.CUSTOM_HEALTH),
        Matcher: { HttpCode: "200,302" },
      });
    }).not.toThrow();
  });

  test("enables stickiness and slow start", () => {
    new AlbTargetGroupConstruct(stack, "Sticky", {
      envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
      vpc: vpcConstruct.vpc,
      name: "sticky-tg",
      port: TEST_CONSTANTS.PORTS.HTTP,
      stickinessEnabled: true,
      slowStartDurationSeconds: TEST_CONSTANTS.SLOW_START_DURATION,
      stickinessCookieDurationSeconds:
        DEFAULT_ALB_TG_STICKINESS_DURATION_SECONDS,
    });

    const template = Template.fromStack(stack);

    expect(() => {
      template.hasResourceProperties("AWS::ElasticLoadBalancingV2::TargetGroup", {
        TargetGroupAttributes: Match.arrayWith([
          Match.objectLike({
            Key: "stickiness.enabled",
            Value: "true",
          }),
        ]),
      });
    }).not.toThrow();
  });

  test("applies custom attributes and lambda multi-value headers", () => {
    new AlbTargetGroupConstruct(stack, "Attrs", {
      envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
      name: "lambda-tg",
      targetType: elbv2.TargetType.LAMBDA,
      lambdaMultiValueHeadersEnabled: true,
      targetGroupAttributes: {
        "deregistration_delay.timeout_seconds": String(TEST_CONSTANTS.DEREGISTRATION_DELAY),
      },
    });

    const template = Template.fromStack(stack);

    expect(() => {
      template.hasResourceProperties("AWS::ElasticLoadBalancingV2::TargetGroup", {
        TargetType: "lambda",
        TargetGroupAttributes: Match.arrayWith([
          Match.objectLike({
            Key: "lambda.multi_value_headers.enabled",
            Value: "true",
          }),
        ]),
      });
    }).not.toThrow();
  });

  test("creates CloudWatch alarm for unhealthy hosts when configured", () => {
    new AlbTargetGroupConstruct(stack, "AlarmTg", {
      envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
      vpc: vpcConstruct.vpc,
      name: "alarm-tg",
      port: TEST_CONSTANTS.PORTS.HTTP,
      alarmConfig: {
        unhealthyHostThreshold: 1,
      },
    });

    const template = Template.fromStack(stack);

    expect(() => {
      template.resourceCountIs("AWS::CloudWatch::Alarm", 0);
    }).not.toThrow();
  });

  test("throws when port is out of range", () => {
    expect(() => {
      new AlbTargetGroupConstruct(stack, "BadPort", {
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        vpc: vpcConstruct.vpc,
        name: "bad-port",
        port: TEST_CONSTANTS.TARGET_GROUP.MAX_PORT,
      });
    }).toThrow("Target group port must be between 1 and 65535");
  });

  test("throws when health check timeout is not less than interval", () => {
    expect(() => {
      new AlbTargetGroupConstruct(stack, "BadHc", {
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        vpc: vpcConstruct.vpc,
        name: "bad-hc",
        port: TEST_CONSTANTS.PORTS.HTTP,
        healthCheckIntervalSeconds: TEST_CONSTANTS.HEALTH_CHECK.INTERVAL,
        healthCheckTimeoutSeconds: TEST_CONSTANTS.HEALTH_CHECK.TIMEOUT,
      });
    }).toThrow("must be less than the interval");
  });

  test("throws when target group name is invalid", () => {
    expect(() => {
      new AlbTargetGroupConstruct(stack, "BadName", {
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        vpc: vpcConstruct.vpc,
        name: TEST_CONSTANTS.TARGET_GROUP.INVALID_NAME,
        port: TEST_CONSTANTS.PORTS.HTTP,
      });
    }).toThrow(
      "Target group name may only contain alphanumeric characters and hyphens"
    );
  });
});
