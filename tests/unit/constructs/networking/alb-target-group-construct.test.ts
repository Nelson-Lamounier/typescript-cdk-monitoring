/** @format */

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

describe("AlbTargetGroupConstruct", () => {
  let app: cdk.App;
  let stack: cdk.Stack;
  let vpcConstruct: VpcConstruct;

  beforeEach(() => {
    app = new cdk.App();
    stack = new cdk.Stack(app, "TestStack", {
      env: { account: "123456789012", region: "eu-west-1" },
    });
    vpcConstruct = new VpcConstruct(stack, "TestVpc", { envName: "test" });
  });

  test("creates target group with defaults and tags", () => {
    new AlbTargetGroupConstruct(stack, "Tg", {
      envName: "dev",
      projectName: "monitoring",
      component: "api",
      vpc: vpcConstruct.vpc,
      name: "api-tg",
      port: 80,
    });

    const template = Template.fromStack(stack);

    template.resourceCountIs("AWS::ElasticLoadBalancingV2::TargetGroup", 1);
    template.hasResourceProperties("AWS::ElasticLoadBalancingV2::TargetGroup", {
      Port: 80,
      Protocol: "HTTP",
      TargetGroupAttributes: Match.arrayWith([
        Match.objectLike({ Key: "stickiness.enabled", Value: "false" }),
      ]),
      HealthCheckEnabled: true,
      Matcher: { HttpCode: DEFAULT_ALB_TG_HTTP_SUCCESS_CODES },
    });
  });

  test("uses HTTPS defaults when port 443 is provided", () => {
    new AlbTargetGroupConstruct(stack, "HttpsTg", {
      envName: "prod",
      vpc: vpcConstruct.vpc,
      name: "https-tg",
      port: DEFAULT_ALB_HTTPS_PORT,
    });

    const template = Template.fromStack(stack);

    template.hasResourceProperties("AWS::ElasticLoadBalancingV2::TargetGroup", {
      Port: DEFAULT_ALB_HTTPS_PORT,
      Protocol: "HTTPS",
      HealthCheckProtocol: "HTTPS",
      Matcher: { HttpCode: DEFAULT_ALB_TG_HTTP_SUCCESS_CODES },
    });
  });

  test("supports gRPC protocol version with gRPC matcher and no path", () => {
    new AlbTargetGroupConstruct(stack, "GrpcTg", {
      envName: "test",
      vpc: vpcConstruct.vpc,
      name: "grpc-tg",
      port: 50051,
      protocol: elbv2.ApplicationProtocol.HTTP,
      protocolVersion: elbv2.ApplicationProtocolVersion.GRPC,
      healthCheckProtocol: elbv2.Protocol.HTTP,
    });

    const template = Template.fromStack(stack);

    template.hasResourceProperties("AWS::ElasticLoadBalancingV2::TargetGroup", {
      ProtocolVersion: "GRPC",
      HealthCheckProtocol: "HTTP",
      Matcher: { GrpcCode: "0-99" },
      HealthCheckPath: Match.absent(),
    });
  });

  test("accepts custom health check matcher and port", () => {
    new AlbTargetGroupConstruct(stack, "CustomHealth", {
      envName: "test",
      vpc: vpcConstruct.vpc,
      name: "custom-health",
      port: 8080,
      healthCheckPort: "8081",
      healthCheckMatcher: {
        httpCodes: "200,302",
      },
    });

    const template = Template.fromStack(stack);

    template.hasResourceProperties("AWS::ElasticLoadBalancingV2::TargetGroup", {
      Port: 8080,
      HealthCheckPort: "8081",
      Matcher: { HttpCode: "200,302" },
    });
  });

  test("enables stickiness and slow start", () => {
    new AlbTargetGroupConstruct(stack, "Sticky", {
      envName: "test",
      vpc: vpcConstruct.vpc,
      name: "sticky-tg",
      port: 80,
      stickinessEnabled: true,
      slowStartDurationSeconds: 120,
      stickinessCookieDurationSeconds:
        DEFAULT_ALB_TG_STICKINESS_DURATION_SECONDS,
    });

    const template = Template.fromStack(stack);

    template.hasResourceProperties("AWS::ElasticLoadBalancingV2::TargetGroup", {
      TargetGroupAttributes: Match.arrayWith([
        Match.objectLike({
          Key: "stickiness.enabled",
          Value: "true",
        }),
      ]),
    });
  });

  test("applies custom attributes and lambda multi-value headers", () => {
    new AlbTargetGroupConstruct(stack, "Attrs", {
      envName: "test",
      name: "lambda-tg",
      targetType: elbv2.TargetType.LAMBDA,
      lambdaMultiValueHeadersEnabled: true,
      targetGroupAttributes: {
        "deregistration_delay.timeout_seconds": "45",
      },
    });

    const template = Template.fromStack(stack);

    template.hasResourceProperties("AWS::ElasticLoadBalancingV2::TargetGroup", {
      TargetType: "lambda",
      TargetGroupAttributes: Match.arrayWith([
        Match.objectLike({
          Key: "lambda.multi_value_headers.enabled",
          Value: "true",
        }),
      ]),
    });
  });

  test("creates CloudWatch alarm for unhealthy hosts when configured", () => {
    new AlbTargetGroupConstruct(stack, "AlarmTg", {
      envName: "test",
      vpc: vpcConstruct.vpc,
      name: "alarm-tg",
      port: 80,
      alarmConfig: {
        unhealthyHostThreshold: 1,
      },
    });

    const template = Template.fromStack(stack);

    template.resourceCountIs("AWS::CloudWatch::Alarm", 0);
  });

  test("throws when port is out of range", () => {
    expect(() => {
      new AlbTargetGroupConstruct(stack, "BadPort", {
        envName: "test",
        vpc: vpcConstruct.vpc,
        name: "bad-port",
        port: 70000,
      });
    }).toThrow("Target group port must be between 1 and 65535");
  });

  test("throws when health check timeout is not less than interval", () => {
    expect(() => {
      new AlbTargetGroupConstruct(stack, "BadHc", {
        envName: "test",
        vpc: vpcConstruct.vpc,
        name: "bad-hc",
        port: 80,
        healthCheckIntervalSeconds: 10,
        healthCheckTimeoutSeconds: 10,
      });
    }).toThrow("must be less than the interval");
  });

  test("throws when target group name is invalid", () => {
    expect(() => {
      new AlbTargetGroupConstruct(stack, "BadName", {
        envName: "test",
        vpc: vpcConstruct.vpc,
        name: "invalid name with spaces",
        port: 80,
      });
    }).toThrow(
      "Target group name may only contain alphanumeric characters and hyphens"
    );
  });
});
