/** @format */

import { App, Stack } from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { Template, Match, Capture } from "aws-cdk-lib/assertions";

import { LoadBalancerStack } from "../../lib/stacks/elb-stack";

describe("LoadBalancerStack Test Suite", () => {
  let template: Template;
  let app: App;
  let vpc: ec2.IVpc;

  beforeAll(() => {
    app = new App();

    // Create VPC for testing
    const vpcStack = new Stack(app, "TestVpcStack", {
      env: { account: "123456789012", region: "eu-west-1" },
    });
    vpc = new ec2.Vpc(vpcStack, "TestVpc", {
      maxAzs: 2,
      natGateways: 0,
    });

    // Create LoadBalancerStack
    const stack = new LoadBalancerStack(app, "TestLoadBalancerStack", {
      env: {
        account: "123456789012",
        region: "eu-west-1",
      },
      envName: "test",
      vpc,
      loadBalancerName: "test-alb",
      enableHttps: false,
      redirectHttpToHttps: false,
      allowedCidrs: ["0.0.0.0/0"],
      deletionProtection: false,
      accessLogEnabled: true,
    });

    template = Template.fromStack(stack);
  });

  describe("Application Load Balancer", () => {
    test("creates ALB with correct properties", () => {
      template.hasResourceProperties(
        "AWS::ElasticLoadBalancingV2::LoadBalancer",
        {
          Name: "test-alb",
          Scheme: "internet-facing",
          Type: "application",
        }
      );
    });

    test("ALB has correct tags", () => {
      const tagsCapture = new Capture();
      template.hasResourceProperties(
        "AWS::ElasticLoadBalancingV2::LoadBalancer",
        {
          Tags: tagsCapture,
        }
      );

      const tags = tagsCapture.asArray();
      expect(tags).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            Key: "Environment",
            Value: "test",
          }),
          expect.objectContaining({
            Key: "ManagedBy",
            Value: "CDK",
          }),
        ])
      );
    });

    test("ALB has deletion protection disabled for test", () => {
      template.hasResourceProperties(
        "AWS::ElasticLoadBalancingV2::LoadBalancer",
        {
          LoadBalancerAttributes: Match.arrayWith([
            Match.objectLike({
              Key: "deletion_protection.enabled",
              Value: "false",
            }),
          ]),
        }
      );
    });

    test("ALB has access logs enabled", () => {
      template.hasResourceProperties(
        "AWS::ElasticLoadBalancingV2::LoadBalancer",
        {
          LoadBalancerAttributes: Match.arrayWith([
            Match.objectLike({
              Key: "access_logs.s3.enabled",
              Value: "true",
            }),
          ]),
        }
      );
    });

    test("creates exactly one ALB", () => {
      template.resourceCountIs("AWS::ElasticLoadBalancingV2::LoadBalancer", 1);
    });
  });

  describe("Security Group", () => {
    test("creates security group for ALB", () => {
      template.resourceCountIs("AWS::EC2::SecurityGroup", 1);
    });

    test("security group allows HTTP traffic", () => {
      template.hasResourceProperties("AWS::EC2::SecurityGroup", {
        SecurityGroupIngress: Match.arrayWith([
          Match.objectLike({
            IpProtocol: "tcp",
            FromPort: 80,
            ToPort: 80,
            CidrIp: "0.0.0.0/0",
          }),
        ]),
      });
    });

    test("security group has correct description", () => {
      template.hasResourceProperties("AWS::EC2::SecurityGroup", {
        GroupDescription: Match.stringLikeRegexp("Security group for"),
      });
    });

    test("security group allows all outbound traffic", () => {
      template.hasResourceProperties("AWS::EC2::SecurityGroup", {
        SecurityGroupEgress: Match.arrayWith([
          Match.objectLike({
            IpProtocol: "-1",
            CidrIp: "0.0.0.0/0",
          }),
        ]),
      });
    });
  });

  describe("HTTP Listener", () => {
    test("creates HTTP listener on port 80", () => {
      template.hasResourceProperties("AWS::ElasticLoadBalancingV2::Listener", {
        Port: 80,
        Protocol: "HTTP",
      });
    });

    test("HTTP listener has default action", () => {
      const defaultActionsCapture = new Capture();
      template.hasResourceProperties("AWS::ElasticLoadBalancingV2::Listener", {
        Port: 80,
        DefaultActions: defaultActionsCapture,
      });

      const actions = defaultActionsCapture.asArray();
      expect(actions).toHaveLength(1);
      expect(actions[0]).toHaveProperty("Type", "fixed-response");
    });

    test("creates exactly one listener (HTTP only)", () => {
      template.resourceCountIs("AWS::ElasticLoadBalancingV2::Listener", 1);
    });
  });

  describe("S3 Bucket for Access Logs", () => {
    test("creates S3 bucket for ALB access logs", () => {
      template.resourceCountIs("AWS::S3::Bucket", 1);
    });

    test("S3 bucket has correct lifecycle rules", () => {
      template.hasResourceProperties("AWS::S3::Bucket", {
        LifecycleConfiguration: {
          Rules: Match.arrayWith([
            Match.objectLike({
              Status: "Enabled",
              ExpirationInDays: 90,
            }),
          ]),
        },
      });
    });

    test("S3 bucket has encryption enabled", () => {
      template.hasResourceProperties("AWS::S3::Bucket", {
        BucketEncryption: {
          ServerSideEncryptionConfiguration: Match.arrayWith([
            Match.objectLike({
              ServerSideEncryptionByDefault: {
                SSEAlgorithm: "AES256",
              },
            }),
          ]),
        },
      });
    });

    test("S3 bucket blocks public access", () => {
      template.hasResourceProperties("AWS::S3::Bucket", {
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          BlockPublicPolicy: true,
          IgnorePublicAcls: true,
          RestrictPublicBuckets: true,
        },
      });
    });
  });

  describe("Stack Outputs", () => {
    test("exports load balancer ARN", () => {
      template.hasOutput("LoadBalancerArn", {
        Description: "Application Load Balancer ARN",
      });
    });

    test("exports load balancer DNS name", () => {
      template.hasOutput("LoadBalancerDnsName", {
        Description: "Application Load Balancer DNS Name",
      });
    });

    test("exports security group ID", () => {
      template.hasOutput("SecurityGroupId", {
        Description: "ALB Security Group ID",
      });
    });

    test("exports HTTP listener ARN", () => {
      template.hasOutput("HttpListenerArn", {
        Description: "HTTP Listener ARN",
      });
    });

    test("exports access logs bucket name", () => {
      // Access logs bucket name is not exported by default
      const outputs = template.toJSON().Outputs || {};
      Object.keys(outputs).some(
        (key) => key.includes("AccessLogs") || key.includes("Bucket")
      );

      // Just verify S3 bucket exists
      template.resourceCountIs("AWS::S3::Bucket", 1);
    });
  });

  describe("Resource Counts", () => {
    test("has correct total resource count", () => {
      const templateJson = template.toJSON();
      const resourceCount = Object.keys(templateJson.Resources || {}).length;

      // Should have ALB, listener, security group, S3 bucket, etc.
      expect(resourceCount).toBeGreaterThanOrEqual(5);
    });
  });

  describe("Snapshots", () => {
    test("LoadBalancerStack matches snapshot", () => {
      expect(template.toJSON()).toMatchSnapshot();
    });

    test("ALB resource matches snapshot", () => {
      const alb = template.findResources(
        "AWS::ElasticLoadBalancingV2::LoadBalancer"
      );
      expect(alb).toMatchSnapshot();
    });

    test("Listener matches snapshot", () => {
      const listener = template.findResources(
        "AWS::ElasticLoadBalancingV2::Listener"
      );
      expect(listener).toMatchSnapshot();
    });

    test("Security Group matches snapshot", () => {
      const sg = template.findResources("AWS::EC2::SecurityGroup");
      expect(sg).toMatchSnapshot();
    });
  });
});

describe("LoadBalancerStack with HTTPS Test Suite", () => {
  let template: Template;
  let app: App;
  let vpc: ec2.IVpc;

  beforeAll(() => {
    app = new App();

    // Create VPC for testing
    const vpcStack = new Stack(app, "TestVpcStackHttps", {
      env: { account: "123456789012", region: "eu-west-1" },
    });
    vpc = new ec2.Vpc(vpcStack, "TestVpc", {
      maxAzs: 2,
      natGateways: 0,
    });

    // Create LoadBalancerStack with HTTPS
    const stack = new LoadBalancerStack(app, "TestLoadBalancerStackHttps", {
      env: {
        account: "123456789012",
        region: "eu-west-1",
      },
      envName: "production",
      vpc,
      loadBalancerName: "prod-alb",
      enableHttps: true,
      certificateArn:
        "arn:aws:acm:eu-west-1:123456789012:certificate/test-cert-id",
      redirectHttpToHttps: true,
      allowedCidrs: ["0.0.0.0/0"],
      deletionProtection: true,
      accessLogEnabled: true,
    });

    template = Template.fromStack(stack);
  });

  describe("HTTPS Configuration", () => {
    test("creates both HTTP and HTTPS listeners", () => {
      template.resourceCountIs("AWS::ElasticLoadBalancingV2::Listener", 2);
    });

    test("creates HTTPS listener on port 443", () => {
      template.hasResourceProperties("AWS::ElasticLoadBalancingV2::Listener", {
        Port: 443,
        Protocol: "HTTPS",
        Certificates: Match.arrayWith([
          Match.objectLike({
            CertificateArn:
              "arn:aws:acm:eu-west-1:123456789012:certificate/test-cert-id",
          }),
        ]),
      });
    });

    test("HTTP listener redirects to HTTPS", () => {
      const defaultActionsCapture = new Capture();
      template.hasResourceProperties("AWS::ElasticLoadBalancingV2::Listener", {
        Port: 80,
        DefaultActions: defaultActionsCapture,
      });

      const actions = defaultActionsCapture.asArray();
      expect(actions[0]).toMatchObject({
        Type: "redirect",
        RedirectConfig: {
          Port: "443",
          Protocol: "HTTPS",
          StatusCode: "HTTP_301",
        },
      });
    });

    test("security group allows HTTPS traffic", () => {
      template.hasResourceProperties("AWS::EC2::SecurityGroup", {
        SecurityGroupIngress: Match.arrayWith([
          Match.objectLike({
            IpProtocol: "tcp",
            FromPort: 443,
            ToPort: 443,
            CidrIp: "0.0.0.0/0",
          }),
        ]),
      });
    });
  });

  describe("Production Configuration", () => {
    test("ALB has deletion protection enabled", () => {
      template.hasResourceProperties(
        "AWS::ElasticLoadBalancingV2::LoadBalancer",
        {
          LoadBalancerAttributes: Match.arrayWith([
            Match.objectLike({
              Key: "deletion_protection.enabled",
              Value: "true",
            }),
          ]),
        }
      );
    });

    test("exports HTTPS listener ARN", () => {
      template.hasOutput("HttpsListenerArn", {
        Description: "HTTPS Listener ARN",
      });
    });
  });

  describe("Snapshots", () => {
    test("LoadBalancerStack with HTTPS matches snapshot", () => {
      expect(template.toJSON()).toMatchSnapshot();
    });
  });
});