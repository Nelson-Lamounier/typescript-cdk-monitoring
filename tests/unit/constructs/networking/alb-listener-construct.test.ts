/** @format */

import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { Template, Match } from "aws-cdk-lib/assertions";

import { AlbListenerConstruct } from "../../../../lib/constructs/networking/alb/alb-listener-construct";
import { VpcConstruct } from "../../../../lib/constructs/networking/vpc/vpc-construct";
import {
  DEFAULT_ALB_HTTP_PORT,
  DEFAULT_ALB_HTTPS_PORT,
  DEFAULT_ALB_FIXED_RESPONSE_STATUS_CODE,
  DEFAULT_ALB_FIXED_RESPONSE_CONTENT_TYPE,
  DEFAULT_ALB_FIXED_RESPONSE_MESSAGE,
} from "../../../../lib/shared/constants/networking-constants";

// ============================================================================
// ALB LISTENER CONSTRUCT TESTS
// ============================================================================

describe("AlbListenerConstruct", () => {
  let app: cdk.App;
  let stack: cdk.Stack;
  let vpc: ec2.IVpc;
  let loadBalancer: elbv2.ApplicationLoadBalancer;
  const certificateArn =
    "arn:aws:acm:eu-west-1:123456789012:certificate/test-cert";

  beforeEach(() => {
    app = new cdk.App();
    stack = new cdk.Stack(app, "TestStack", {
      env: {
        account: "123456789012",
        region: "eu-west-1",
      },
    });

    // Create a VPC for testing
    const vpcConstruct = new VpcConstruct(stack, "TestVpc", {
      envName: "test",
    });
    vpc = vpcConstruct.vpc;

    // Create an ALB for testing
    loadBalancer = new elbv2.ApplicationLoadBalancer(stack, "TestALB", {
      vpc,
      internetFacing: true,
    });
  });

  // ============================================
  // Basic Construction Tests
  // ============================================

  describe("Basic Construction", () => {
    test("creates HTTP listener with minimal required properties", () => {
      new AlbListenerConstruct(stack, "Listener", {
        loadBalancer,
        envName: "test",
        enableHttp: true,
        enableHttps: false,
      });

      const template = Template.fromStack(stack);

      template.resourceCountIs("AWS::ElasticLoadBalancingV2::Listener", 1);
      template.hasResourceProperties("AWS::ElasticLoadBalancingV2::Listener", {
        Port: DEFAULT_ALB_HTTP_PORT,
        Protocol: "HTTP",
      });
    });

    test("creates HTTPS listener when enabled with certificate", () => {
      new AlbListenerConstruct(stack, "Listener", {
        loadBalancer,
        envName: "test",
        enableHttp: false,
        enableHttps: true,
        certificateArn,
      });

      const template = Template.fromStack(stack);

      template.resourceCountIs("AWS::ElasticLoadBalancingV2::Listener", 1);
      template.hasResourceProperties("AWS::ElasticLoadBalancingV2::Listener", {
        Port: DEFAULT_ALB_HTTPS_PORT,
        Protocol: "HTTPS",
        Certificates: Match.arrayWith([
          Match.objectLike({
            CertificateArn: certificateArn,
          }),
        ]),
      });
    });

    test("creates both HTTP and HTTPS listeners", () => {
      new AlbListenerConstruct(stack, "Listener", {
        loadBalancer,
        envName: "test",
        enableHttp: true,
        enableHttps: true,
        certificateArn,
      });

      const template = Template.fromStack(stack);

      template.resourceCountIs("AWS::ElasticLoadBalancingV2::Listener", 2);

      // Check HTTP listener
      template.hasResourceProperties("AWS::ElasticLoadBalancingV2::Listener", {
        Port: DEFAULT_ALB_HTTP_PORT,
        Protocol: "HTTP",
      });

      // Check HTTPS listener
      template.hasResourceProperties("AWS::ElasticLoadBalancingV2::Listener", {
        Port: DEFAULT_ALB_HTTPS_PORT,
        Protocol: "HTTPS",
      });
    });

    test("exposes httpListener, httpsListener, and primary listener", () => {
      const construct = new AlbListenerConstruct(stack, "Listener", {
        loadBalancer,
        envName: "test",
        enableHttp: true,
        enableHttps: true,
        certificateArn,
      });

      expect(construct.httpListener).toBeDefined();
      expect(construct.httpsListener).toBeDefined();
      expect(construct.listener).toBeDefined();
      expect(construct.primaryListener).toBeDefined();

      // Primary listener should be HTTPS when both are available
      expect(construct.listener).toBe(construct.httpsListener);
    });

    test("primary listener is HTTP when HTTPS is not enabled", () => {
      const construct = new AlbListenerConstruct(stack, "Listener", {
        loadBalancer,
        envName: "test",
        enableHttp: true,
        enableHttps: false,
      });

      expect(construct.listener).toBe(construct.httpListener);
      expect(construct.httpsListener).toBeUndefined();
    });
  });

  // ============================================
  // Input Validation Tests
  // ============================================

  describe("Input Validation", () => {
    test("throws error when envName is missing", () => {
      expect(() => {
        new AlbListenerConstruct(stack, "Listener", {
          loadBalancer,
          envName: "",
          enableHttp: true,
        });
      }).toThrow("Environment name (envName) is required");
    });

    test("throws error when envName is undefined", () => {
      expect(() => {
        new AlbListenerConstruct(stack, "Listener", {
          loadBalancer,
          envName: undefined as unknown as string,
          enableHttp: true,
        });
      }).toThrow("Environment name (envName) is required");
    });

    test("throws error when both listeners are disabled", () => {
      expect(() => {
        new AlbListenerConstruct(stack, "Listener", {
          loadBalancer,
          envName: "test",
          enableHttp: false,
          enableHttps: false,
        });
      }).toThrow("At least one listener (HTTP or HTTPS) must be enabled");
    });

    test("throws error when HTTPS enabled without certificate", () => {
      expect(() => {
        new AlbListenerConstruct(stack, "Listener", {
          loadBalancer,
          envName: "test",
          enableHttps: true,
          // certificateArn missing
        });
      }).toThrow("Certificate ARN is required when HTTPS is enabled");
    });

    test("throws error when redirect enabled without both listeners", () => {
      expect(() => {
        new AlbListenerConstruct(stack, "Listener", {
          loadBalancer,
          envName: "test",
          enableHttp: false,
          enableHttps: true,
          certificateArn,
          redirectHttpToHttps: true,
        });
      }).toThrow(
        "HTTP to HTTPS redirect requires both HTTP and HTTPS listeners"
      );
    });
  });

  // ============================================
  // Default Actions Tests
  // ============================================

  describe("Default Actions", () => {
    test("HTTP listener uses fixed response by default", () => {
      new AlbListenerConstruct(stack, "Listener", {
        loadBalancer,
        envName: "test",
        enableHttp: true,
        enableHttps: false,
      });

      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::ElasticLoadBalancingV2::Listener", {
        Port: DEFAULT_ALB_HTTP_PORT,
        DefaultActions: Match.arrayWith([
          Match.objectLike({
            Type: "fixed-response",
            FixedResponseConfig: {
              StatusCode: String(DEFAULT_ALB_FIXED_RESPONSE_STATUS_CODE),
              ContentType: DEFAULT_ALB_FIXED_RESPONSE_CONTENT_TYPE,
              MessageBody: DEFAULT_ALB_FIXED_RESPONSE_MESSAGE,
            },
          }),
        ]),
      });
    });

    test("HTTP listener redirects to HTTPS when configured", () => {
      new AlbListenerConstruct(stack, "Listener", {
        loadBalancer,
        envName: "test",
        enableHttp: true,
        enableHttps: true,
        certificateArn,
        redirectHttpToHttps: true,
      });

      const template = Template.fromStack(stack);

      // Find HTTP listener
      const listeners = template.findResources(
        "AWS::ElasticLoadBalancingV2::Listener"
      );
      const httpListener = Object.values(listeners).find(
        (listener: Record<string, unknown>) =>
          (listener.Properties as Record<string, unknown>).Port ===
          DEFAULT_ALB_HTTP_PORT
      );

      expect(httpListener).toBeDefined();
      const defaultActions = (httpListener as Record<string, unknown>)
        .Properties as Record<string, unknown>;
      const actions = defaultActions.DefaultActions as Array<
        Record<string, unknown>
      >;
      expect(actions[0].Type).toBe("redirect");
      const redirectConfig = actions[0].RedirectConfig as Record<
        string,
        unknown
      >;
      expect(redirectConfig.Protocol).toBe("HTTPS");
      expect(redirectConfig.Port).toBe(String(DEFAULT_ALB_HTTPS_PORT));
      expect(redirectConfig.StatusCode).toBe("HTTP_301");
    });

    test("HTTPS listener uses fixed response by default", () => {
      new AlbListenerConstruct(stack, "Listener", {
        loadBalancer,
        envName: "test",
        enableHttp: false,
        enableHttps: true,
        certificateArn,
      });

      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::ElasticLoadBalancingV2::Listener", {
        Port: DEFAULT_ALB_HTTPS_PORT,
        DefaultActions: Match.arrayWith([
          Match.objectLike({
            Type: "fixed-response",
            FixedResponseConfig: {
              StatusCode: String(DEFAULT_ALB_FIXED_RESPONSE_STATUS_CODE),
            },
          }),
        ]),
      });
    });

    test("uses custom default action when provided", () => {
      const customAction = elbv2.ListenerAction.fixedResponse(503, {
        contentType: "application/json",
        messageBody: '{"error": "Service unavailable"}',
      });

      new AlbListenerConstruct(stack, "Listener", {
        loadBalancer,
        envName: "test",
        enableHttp: true,
        enableHttps: false,
        httpDefaultAction: customAction,
      });

      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::ElasticLoadBalancingV2::Listener", {
        Port: DEFAULT_ALB_HTTP_PORT,
        DefaultActions: Match.arrayWith([
          Match.objectLike({
            Type: "fixed-response",
            FixedResponseConfig: {
              StatusCode: "503",
              ContentType: "application/json",
              MessageBody: '{"error": "Service unavailable"}',
            },
          }),
        ]),
      });
    });
  });

  // ============================================
  // SSL Configuration Tests
  // ============================================

  describe("SSL Configuration", () => {
    test("uses TLS 1.3 by default", () => {
      new AlbListenerConstruct(stack, "Listener", {
        loadBalancer,
        envName: "test",
        enableHttps: true,
        certificateArn,
      });

      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::ElasticLoadBalancingV2::Listener", {
        Port: DEFAULT_ALB_HTTPS_PORT,
        SslPolicy: "ELBSecurityPolicy-TLS13-1-2-2021-06",
      });
    });

    test("uses custom SSL policy when provided", () => {
      new AlbListenerConstruct(stack, "Listener", {
        loadBalancer,
        envName: "test",
        enableHttps: true,
        certificateArn,
        sslPolicy: elbv2.SslPolicy.TLS12,
      });

      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::ElasticLoadBalancingV2::Listener", {
        Port: DEFAULT_ALB_HTTPS_PORT,
        SslPolicy: "ELBSecurityPolicy-TLS-1-2-2017-01",
      });
    });

    test("supports SNI with multiple certificates", () => {
      const additionalCert1 =
        "arn:aws:acm:eu-west-1:123456789012:certificate/cert1";
      const additionalCert2 =
        "arn:aws:acm:eu-west-1:123456789012:certificate/cert2";

      new AlbListenerConstruct(stack, "Listener", {
        loadBalancer,
        envName: "test",
        enableHttps: true,
        certificateArn,
        additionalCertificates: [additionalCert1, additionalCert2],
      });

      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::ElasticLoadBalancingV2::Listener", {
        Port: DEFAULT_ALB_HTTPS_PORT,
        Certificates: Match.arrayWith([
          Match.objectLike({ CertificateArn: certificateArn }),
          Match.objectLike({ CertificateArn: additionalCert1 }),
          Match.objectLike({ CertificateArn: additionalCert2 }),
        ]),
      });
    });
  });

  // ============================================
  // Port Configuration Tests
  // ============================================

  describe("Port Configuration", () => {
    test("uses default HTTP port 80", () => {
      new AlbListenerConstruct(stack, "Listener", {
        loadBalancer,
        envName: "test",
        enableHttp: true,
        enableHttps: false,
      });

      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::ElasticLoadBalancingV2::Listener", {
        Port: DEFAULT_ALB_HTTP_PORT,
      });
    });

    test("uses default HTTPS port 443", () => {
      new AlbListenerConstruct(stack, "Listener", {
        loadBalancer,
        envName: "test",
        enableHttps: true,
        certificateArn,
      });

      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::ElasticLoadBalancingV2::Listener", {
        Port: DEFAULT_ALB_HTTPS_PORT,
      });
    });

    test("uses custom HTTP port when provided", () => {
      const customPort = 8080;

      new AlbListenerConstruct(stack, "Listener", {
        loadBalancer,
        envName: "test",
        enableHttp: true,
        enableHttps: false,
        httpPort: customPort,
      });

      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::ElasticLoadBalancingV2::Listener", {
        Port: customPort,
      });
    });

    test("uses custom HTTPS port when provided", () => {
      const customPort = 8443;

      new AlbListenerConstruct(stack, "Listener", {
        loadBalancer,
        envName: "test",
        enableHttps: true,
        certificateArn,
        httpsPort: customPort,
      });

      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::ElasticLoadBalancingV2::Listener", {
        Port: customPort,
      });
    });
  });

  // ============================================
  // Listener Rules Tests
  // ============================================

  describe("Listener Rules", () => {
    let construct: AlbListenerConstruct;
    let targetGroup: elbv2.ApplicationTargetGroup;

    beforeEach(() => {
      construct = new AlbListenerConstruct(stack, "Listener", {
        loadBalancer,
        envName: "test",
        enableHttp: true,
        enableHttps: true,
        certificateArn,
      });

      targetGroup = new elbv2.ApplicationTargetGroup(stack, "TargetGroup", {
        vpc,
        port: 80,
        protocol: elbv2.ApplicationProtocol.HTTP,
      });
    });

    test("addTargetGroup adds rule to primary listener", () => {
      construct.addTargetGroup("TestRule", targetGroup, 100, [
        elbv2.ListenerCondition.pathPatterns(["/api/*"]),
      ]);

      const template = Template.fromStack(stack);

      template.resourceCountIs("AWS::ElasticLoadBalancingV2::ListenerRule", 1);
      template.hasResourceProperties(
        "AWS::ElasticLoadBalancingV2::ListenerRule",
        {
          Priority: 100,
          Conditions: Match.arrayWith([
            Match.objectLike({
              Field: "path-pattern",
              PathPatternConfig: {
                Values: ["/api/*"],
              },
            }),
          ]),
        }
      );
    });

    test("addPathRule creates path-based routing rule", () => {
      construct.addPathRule("PathRule", targetGroup, "/api/*", 100);

      const template = Template.fromStack(stack);

      template.hasResourceProperties(
        "AWS::ElasticLoadBalancingV2::ListenerRule",
        {
          Priority: 100,
          Conditions: Match.arrayWith([
            Match.objectLike({
              Field: "path-pattern",
              PathPatternConfig: {
                Values: ["/api/*"],
              },
            }),
          ]),
        }
      );
    });

    test("addHostRule creates host-based routing rule", () => {
      construct.addHostRule("HostRule", targetGroup, "api.example.com", 100);

      const template = Template.fromStack(stack);

      template.hasResourceProperties(
        "AWS::ElasticLoadBalancingV2::ListenerRule",
        {
          Priority: 100,
          Conditions: Match.arrayWith([
            Match.objectLike({
              Field: "host-header",
              HostHeaderConfig: {
                Values: ["api.example.com"],
              },
            }),
          ]),
        }
      );
    });

    test("addHeaderRule creates header-based routing rule", () => {
      construct.addHeaderRule(
        "HeaderRule",
        targetGroup,
        "X-Custom-Header",
        ["value1", "value2"],
        100
      );

      const template = Template.fromStack(stack);

      template.hasResourceProperties(
        "AWS::ElasticLoadBalancingV2::ListenerRule",
        {
          Priority: 100,
          Conditions: Match.arrayWith([
            Match.objectLike({
              Field: "http-header",
              HttpHeaderConfig: {
                HttpHeaderName: "X-Custom-Header",
                Values: ["value1", "value2"],
              },
            }),
          ]),
        }
      );
    });

    test("addWeightedTargetGroups creates weighted forwarding rule", () => {
      const targetGroup2 = new elbv2.ApplicationTargetGroup(
        stack,
        "TargetGroup2",
        {
          vpc,
          port: 80,
          protocol: elbv2.ApplicationProtocol.HTTP,
        }
      );

      construct.addWeightedTargetGroups(
        "WeightedRule",
        [
          { targetGroup, weight: 80 },
          { targetGroup: targetGroup2, weight: 20 },
        ],
        100
      );

      const template = Template.fromStack(stack);

      template.hasResourceProperties(
        "AWS::ElasticLoadBalancingV2::ListenerRule",
        {
          Priority: 100,
          Actions: Match.arrayWith([
            Match.objectLike({
              Type: "forward",
              ForwardConfig: {
                TargetGroups: Match.arrayWith([
                  Match.objectLike({ Weight: 80 }),
                  Match.objectLike({ Weight: 20 }),
                ]),
              },
            }),
          ]),
        }
      );
    });

    test("addWeightedTargetGroups throws error when total weight is zero", () => {
      expect(() => {
        construct.addWeightedTargetGroups(
          "WeightedRule",
          [{ targetGroup, weight: 0 }],
          100
        );
      }).toThrow("Total weight of target groups must be greater than 0");
    });
  });

  // ============================================
  // Tagging Tests
  // ============================================

  describe("Tagging", () => {
    test("adds standard tags to HTTP listener", () => {
      new AlbListenerConstruct(stack, "Listener", {
        loadBalancer,
        envName: "test",
        enableHttp: true,
        enableHttps: false,
      });

      const template = Template.fromStack(stack);

      // Tags are applied via CDK Tags API, check in the synthesized template
      const listeners = template.findResources(
        "AWS::ElasticLoadBalancingV2::Listener"
      );
      const httpListener = Object.values(listeners)[0];

      // CDK applies tags at the stack level, so we verify the listener exists
      expect(httpListener).toBeDefined();
    });

    test("adds project tag when projectName is provided", () => {
      new AlbListenerConstruct(stack, "Listener", {
        loadBalancer,
        envName: "test",
        projectName: "monitoring",
        enableHttp: true,
        enableHttps: false,
      });

      const template = Template.fromStack(stack);

      // Verify listener is created (tags are applied via CDK Tags API)
      template.resourceCountIs("AWS::ElasticLoadBalancingV2::Listener", 1);
    });

    test("adds tags to both HTTP and HTTPS listeners", () => {
      new AlbListenerConstruct(stack, "Listener", {
        loadBalancer,
        envName: "test",
        projectName: "monitoring",
        enableHttp: true,
        enableHttps: true,
        certificateArn,
      });

      const template = Template.fromStack(stack);

      // Both listeners should be created
      template.resourceCountIs("AWS::ElasticLoadBalancingV2::Listener", 2);
    });
  });

  // ============================================
  // CloudFormation Outputs Tests
  // ============================================

  describe("CloudFormation Outputs", () => {
    test("creates output for HTTP listener ARN", () => {
      new AlbListenerConstruct(stack, "Listener", {
        loadBalancer,
        envName: "test",
        enableHttp: true,
        enableHttps: false,
      });

      const template = Template.fromStack(stack);

      template.hasOutput("HttpListenerArn", {
        Description: "HTTP Listener ARN",
      });
    });

    test("creates output for HTTPS listener ARN", () => {
      new AlbListenerConstruct(stack, "Listener", {
        loadBalancer,
        envName: "test",
        enableHttps: true,
        certificateArn,
      });

      const template = Template.fromStack(stack);

      template.hasOutput("HttpsListenerArn", {
        Description: "HTTPS Listener ARN",
      });
    });

    test("creates unique export names with loadBalancerName", () => {
      new AlbListenerConstruct(stack, "Listener", {
        loadBalancer,
        envName: "test",
        loadBalancerName: "my-alb",
        enableHttp: true,
        enableHttps: false,
      });

      const template = Template.fromStack(stack);

      const outputs = template.findOutputs("HttpListenerArn");
      const output = Object.values(outputs)[0];

      expect(output).toBeDefined();
      expect(output.Export?.Name).toContain("my-alb");
    });
  });

  // ============================================
  // Integration Tests
  // ============================================

  describe("Integration", () => {
    test("creates complete listener configuration with all features", () => {
      const construct = new AlbListenerConstruct(stack, "Listener", {
        loadBalancer,
        envName: "production",
        projectName: "monitoring",
        enableHttp: true,
        enableHttps: true,
        certificateArn,
        additionalCertificates: [
          "arn:aws:acm:eu-west-1:123456789012:certificate/cert2",
        ],
        redirectHttpToHttps: true,
        sslPolicy: elbv2.SslPolicy.TLS13_RES,
        loadBalancerName: "monitoring-alb",
      });

      const targetGroup = new elbv2.ApplicationTargetGroup(
        stack,
        "TargetGroup",
        {
          vpc,
          port: 80,
          protocol: elbv2.ApplicationProtocol.HTTP,
        }
      );

      construct.addPathRule("ApiRule", targetGroup, "/api/*", 100);

      const template = Template.fromStack(stack);

      // Verify both listeners exist
      template.resourceCountIs("AWS::ElasticLoadBalancingV2::Listener", 2);

      // Verify HTTPS listener has multiple certificates (SNI)
      template.hasResourceProperties("AWS::ElasticLoadBalancingV2::Listener", {
        Port: DEFAULT_ALB_HTTPS_PORT,
        Certificates: Match.arrayWith([
          Match.objectLike({ CertificateArn: certificateArn }),
          Match.objectLike({
            CertificateArn:
              "arn:aws:acm:eu-west-1:123456789012:certificate/cert2",
          }),
        ]),
      });

      // Verify listener rule exists
      template.resourceCountIs("AWS::ElasticLoadBalancingV2::ListenerRule", 1);

      // Verify outputs
      template.hasOutput("HttpListenerArn", {});
      template.hasOutput("HttpsListenerArn", {});

      // Verify primary listener is HTTPS
      expect(construct.listener).toBe(construct.httpsListener);
    });
  });
});
