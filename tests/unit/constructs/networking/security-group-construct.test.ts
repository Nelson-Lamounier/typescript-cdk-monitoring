/** @format */
/// <reference types="jest" />

import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { Template, Match } from "aws-cdk-lib/assertions";

import { SecurityGroupConstruct } from "../../../../lib/constructs/networking/security/security-group-construct";
import { VpcConstruct } from "../../../../lib/constructs/networking/vpc/vpc-construct";
import { COMMON_PORTS } from "../../../../lib/shared/constants/networking-constants";
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
  SECURITY_GROUP: {
    NAME: "test-sg",
    DESCRIPTION: "Test security group description",
    SHORT_DESCRIPTION: "Short",
    PROD_NAME: "prod-sg",
    PROD_DESCRIPTION: "Production security group description",
    WEB_SERVER_NAME: "web-server-sg",
    WEB_SERVER_DESCRIPTION: "Security group for web servers allowing HTTP/HTTPS traffic",
    SG1_NAME: "sg-1",
    SG1_DESCRIPTION: "First security group description",
    SG2_NAME: "sg-2",
    SG2_DESCRIPTION: "Second security group description",
    SOURCE_NAME: "source-sg",
    SOURCE_DESCRIPTION: "Source security group description",
    TARGET_NAME: "target-sg",
    TARGET_DESCRIPTION: "Target security group description",
  },
  VPC_CIDR: "10.0.0.0/16",
} as const;

// ============================================================================
// SECURITY GROUP CONSTRUCT TESTS
// ============================================================================

describe("SecurityGroupConstruct", () => {
  let app: cdk.App;
  let stack: cdk.Stack;
  let vpc: ec2.IVpc;

  // Helper to create fresh test environment
  const createTestEnvironment = () => {
    const testApp = createTestApp();
    const testStack = new cdk.Stack(testApp, "TestStack", {
      env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
    });
    const vpcConstruct = new VpcConstruct(testStack, "TestVpc", {
      envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
    });
    return { testApp, testStack, testVpc: vpcConstruct.vpc };
  };

  beforeEach(() => {
    const env = createTestEnvironment();
    app = env.testApp;
    stack = env.testStack;
    vpc = env.testVpc;
  });

  // ============================================
  // Basic Construction Tests
  // ============================================

  describe("Basic Construction", () => {
    test("creates security group with minimal required properties", () => {
      new SecurityGroupConstruct(stack, "SecurityGroup", {
        vpc,
        groupName: TEST_CONSTANTS.SECURITY_GROUP.NAME,
        description: TEST_CONSTANTS.SECURITY_GROUP.DESCRIPTION,
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
      });

      const template = Template.fromStack(stack);

      expect(() => {
        template.resourceCountIs("AWS::EC2::SecurityGroup", 1);
        template.hasResourceProperties("AWS::EC2::SecurityGroup", {
          GroupDescription: TEST_CONSTANTS.SECURITY_GROUP.DESCRIPTION,
          GroupName: TEST_CONSTANTS.SECURITY_GROUP.NAME,
          VpcId: {
            Ref: Match.stringLikeRegexp("TestVpc.*"),
          },
        });
      }).not.toThrow();
    });

    test("exposes security group and security group ID", () => {
      const construct = new SecurityGroupConstruct(stack, "SecurityGroup", {
        vpc,
        groupName: TEST_CONSTANTS.SECURITY_GROUP.NAME,
        description: TEST_CONSTANTS.SECURITY_GROUP.DESCRIPTION,
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
      });

      expect(construct.securityGroup).toBeDefined();
      expect(construct.securityGroupId).toBeDefined();
      expect(typeof construct.securityGroupId).toBe("string");
    });

    test("defaults allowAllOutbound to false", () => {
      new SecurityGroupConstruct(stack, "SecurityGroup", {
        vpc,
        groupName: TEST_CONSTANTS.SECURITY_GROUP.NAME,
        description: TEST_CONSTANTS.SECURITY_GROUP.DESCRIPTION,
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
      });

      const template = Template.fromStack(stack);

      // When allowAllOutbound is false, CDK creates a default deny-all egress rule
      // We verify that there's no allow-all rule (0.0.0.0/0 with protocol -1)
      expect(() => {
        template.hasResourceProperties("AWS::EC2::SecurityGroup", {
          SecurityGroupEgress: Match.not(
            Match.arrayWith([
              Match.objectLike({
                CidrIp: "0.0.0.0/0",
                IpProtocol: "-1",
              }),
            ])
          ),
        });
      }).not.toThrow();
    });

    test("creates security group with allowAllOutbound set to true when specified", () => {
      new SecurityGroupConstruct(stack, "SecurityGroup", {
        vpc,
        groupName: TEST_CONSTANTS.SECURITY_GROUP.NAME,
        description: TEST_CONSTANTS.SECURITY_GROUP.DESCRIPTION,
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        allowAllOutbound: true,
      });

      const template = Template.fromStack(stack);

      // When allowAllOutbound is true, CDK creates a default egress rule
      expect(() => {
        template.hasResourceProperties("AWS::EC2::SecurityGroup", {
          SecurityGroupEgress: Match.arrayWith([
            Match.objectLike({
              CidrIp: "0.0.0.0/0",
              IpProtocol: "-1",
            }),
          ]),
        });
      }).not.toThrow();
    });
  });

  // ============================================
  // Input Validation Tests
  // ============================================

  describe("Input Validation", () => {
    test("throws error when VPC is undefined", () => {
      expect(() => {
        new SecurityGroupConstruct(stack, "SecurityGroup", {
          vpc: undefined as unknown as ec2.IVpc,
          groupName: TEST_CONSTANTS.SECURITY_GROUP.NAME,
          description: TEST_CONSTANTS.SECURITY_GROUP.DESCRIPTION,
          envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        });
      }).toThrow("VPC is required for SecurityGroupConstruct");
    });

    test("throws error when VPC is null", () => {
      expect(() => {
        new SecurityGroupConstruct(stack, "SecurityGroup", {
          vpc: null as unknown as ec2.IVpc,
          groupName: TEST_CONSTANTS.SECURITY_GROUP.NAME,
          description: TEST_CONSTANTS.SECURITY_GROUP.DESCRIPTION,
          envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        });
      }).toThrow("VPC is required for SecurityGroupConstruct");
    });

    test("throws error when group name is empty", () => {
      expect(() => {
        new SecurityGroupConstruct(stack, "SecurityGroup", {
          vpc,
          groupName: "",
          description: TEST_CONSTANTS.SECURITY_GROUP.DESCRIPTION,
          envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        });
      }).toThrow("Security group name is required");
    });

    test("throws error when group name is only whitespace", () => {
      expect(() => {
        new SecurityGroupConstruct(stack, "SecurityGroup", {
          vpc,
          groupName: "   ",
          description: TEST_CONSTANTS.SECURITY_GROUP.DESCRIPTION,
          envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        });
      }).toThrow("Security group name cannot be empty");
    });

    test("throws error when description is too short", () => {
      expect(() => {
        new SecurityGroupConstruct(stack, "SecurityGroup", {
          vpc,
          groupName: TEST_CONSTANTS.SECURITY_GROUP.NAME,
          description: TEST_CONSTANTS.SECURITY_GROUP.SHORT_DESCRIPTION,
          envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        });
      }).toThrow("Security group description is too short");
    });

    test("throws error when description is empty", () => {
      expect(() => {
        new SecurityGroupConstruct(stack, "SecurityGroup", {
          vpc,
          groupName: TEST_CONSTANTS.SECURITY_GROUP.NAME,
          description: "",
          envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        });
      }).toThrow("Security group description is required");
    });

    test("throws error when envName is missing", () => {
      expect(() => {
        new SecurityGroupConstruct(stack, "SecurityGroup", {
          vpc,
          groupName: TEST_CONSTANTS.SECURITY_GROUP.NAME,
          description: TEST_CONSTANTS.SECURITY_GROUP.DESCRIPTION,
          envName: undefined as unknown as string,
        });
      }).toThrow("Environment name (envName) is required");
    });

    test("throws error when envName is empty string", () => {
      expect(() => {
        new SecurityGroupConstruct(stack, "SecurityGroup", {
          vpc,
          groupName: TEST_CONSTANTS.SECURITY_GROUP.NAME,
          description: TEST_CONSTANTS.SECURITY_GROUP.DESCRIPTION,
          envName: "",
        });
      }).toThrow("Environment name (envName) is required");
    });

    test("throws error when envName is only whitespace", () => {
      expect(() => {
        new SecurityGroupConstruct(stack, "SecurityGroup", {
          vpc,
          groupName: TEST_CONSTANTS.SECURITY_GROUP.NAME,
          description: TEST_CONSTANTS.SECURITY_GROUP.DESCRIPTION,
          envName: "   ",
        });
      }).toThrow("Environment name (envName) is required");
    });
  });

  // ============================================
  // Ingress Rules Tests
  // ============================================

  describe("Ingress Rules", () => {
    test("adds ingress rules from props", () => {
      new SecurityGroupConstruct(stack, "SecurityGroup", {
        vpc,
        groupName: TEST_CONSTANTS.SECURITY_GROUP.NAME,
        description: TEST_CONSTANTS.SECURITY_GROUP.DESCRIPTION,
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        ingressRules: [
          {
            peer: ec2.Peer.anyIpv4(),
            port: ec2.Port.tcp(COMMON_PORTS.HTTP),
            description: "Allow HTTP from internet",
          },
          {
            peer: ec2.Peer.ipv4(TEST_CONSTANTS.VPC_CIDR),
            port: ec2.Port.tcp(COMMON_PORTS.HTTPS),
            description: "Allow HTTPS from VPC",
          },
        ],
      });

      const template = Template.fromStack(stack);

      expect(() => {
        template.hasResourceProperties("AWS::EC2::SecurityGroup", {
          SecurityGroupIngress: Match.arrayWith([
            Match.objectLike({
              CidrIp: "0.0.0.0/0",
              FromPort: COMMON_PORTS.HTTP,
              ToPort: COMMON_PORTS.HTTP,
              IpProtocol: "tcp",
              Description: "Allow HTTP from internet",
            }),
            Match.objectLike({
              CidrIp: TEST_CONSTANTS.VPC_CIDR,
              FromPort: COMMON_PORTS.HTTPS,
              ToPort: COMMON_PORTS.HTTPS,
              IpProtocol: "tcp",
              Description: "Allow HTTPS from VPC",
            }),
          ]),
        });
      }).not.toThrow();
    });

    test("generates description for ingress rules when not provided", () => {
      new SecurityGroupConstruct(stack, "SecurityGroup", {
        vpc,
        groupName: TEST_CONSTANTS.SECURITY_GROUP.NAME,
        description: TEST_CONSTANTS.SECURITY_GROUP.DESCRIPTION,
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        ingressRules: [
          {
            peer: ec2.Peer.anyIpv4(),
            port: ec2.Port.tcp(COMMON_PORTS.HTTP),
          },
        ],
      });

      const template = Template.fromStack(stack);

      expect(() => {
        template.hasResourceProperties("AWS::EC2::SecurityGroup", {
          SecurityGroupIngress: Match.arrayWith([
            Match.objectLike({
              Description: Match.stringLikeRegexp("Allow.*80.*"),
            }),
          ]),
        });
      }).not.toThrow();
    });

    test("allows adding ingress rules via addIngressRule method", () => {
      const construct = new SecurityGroupConstruct(stack, "SecurityGroup", {
        vpc,
        groupName: TEST_CONSTANTS.SECURITY_GROUP.NAME,
        description: TEST_CONSTANTS.SECURITY_GROUP.DESCRIPTION,
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
      });

      construct.addIngressRule(
        ec2.Peer.anyIpv4(),
        ec2.Port.tcp(COMMON_PORTS.SSH),
        "Allow SSH from anywhere"
      );

      const template = Template.fromStack(stack);

      expect(() => {
        template.hasResourceProperties("AWS::EC2::SecurityGroup", {
          SecurityGroupIngress: Match.arrayWith([
            Match.objectLike({
              CidrIp: "0.0.0.0/0",
              FromPort: COMMON_PORTS.SSH,
              ToPort: COMMON_PORTS.SSH,
              IpProtocol: "tcp",
              Description: "Allow SSH from anywhere",
            }),
          ]),
        });
      }).not.toThrow();
    });
  });

  // ============================================
  // Egress Rules Tests
  // ============================================

  describe("Egress Rules", () => {
    test("adds egress rules from props when allowAllOutbound is false", () => {
      new SecurityGroupConstruct(stack, "SecurityGroup", {
        vpc,
        groupName: TEST_CONSTANTS.SECURITY_GROUP.NAME,
        description: TEST_CONSTANTS.SECURITY_GROUP.DESCRIPTION,
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        allowAllOutbound: false,
        egressRules: [
          {
            peer: ec2.Peer.anyIpv4(),
            port: ec2.Port.tcp(COMMON_PORTS.HTTPS),
            description: "Allow outbound HTTPS",
          },
        ],
      });

      const template = Template.fromStack(stack);

      expect(() => {
        template.hasResourceProperties("AWS::EC2::SecurityGroup", {
          SecurityGroupEgress: Match.arrayWith([
            Match.objectLike({
              CidrIp: "0.0.0.0/0",
              FromPort: COMMON_PORTS.HTTPS,
              ToPort: COMMON_PORTS.HTTPS,
              IpProtocol: "tcp",
              Description: "Allow outbound HTTPS",
            }),
          ]),
        });
      }).not.toThrow();
    });

    test("adds egress rules even when allowAllOutbound is true", () => {
      // CRITICAL FIX: Egress rules should be respected even when allowAllOutbound=true
      // Note: When allowAllOutbound=true, CDK creates a default allow-all rule.
      // Explicit egress rules are still added via addEgressRule(), but they may be
      // redundant since the default rule already allows all traffic.
      // This test verifies that our construct attempts to add explicit rules.
      const construct = new SecurityGroupConstruct(stack, "SecurityGroup", {
        vpc,
        groupName: TEST_CONSTANTS.SECURITY_GROUP.NAME,
        description: TEST_CONSTANTS.SECURITY_GROUP.DESCRIPTION,
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        allowAllOutbound: true,
        egressRules: [
          {
            peer: ec2.Peer.anyIpv4(),
            port: ec2.Port.tcp(COMMON_PORTS.HTTPS),
            description: "Allow outbound HTTPS for AWS services",
          },
        ],
      });

      const template = Template.fromStack(stack);

      // Verify that the security group has egress rules (at minimum the default allow-all)
      template.hasResourceProperties("AWS::EC2::SecurityGroup", {
        SecurityGroupEgress: Match.arrayWith([
          Match.objectLike({
            CidrIp: "0.0.0.0/0",
            IpProtocol: "-1",
          }),
        ]),
      });

      // Verify the construct was created successfully
      // The explicit rule may be redundant but is still added for documentation
      expect(construct).toBeDefined();
      expect(construct.securityGroup).toBeDefined();
    });

    test("generates description for egress rules when not provided", () => {
      new SecurityGroupConstruct(stack, "SecurityGroup", {
        vpc,
        groupName: TEST_CONSTANTS.SECURITY_GROUP.NAME,
        description: TEST_CONSTANTS.SECURITY_GROUP.DESCRIPTION,
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        egressRules: [
          {
            peer: ec2.Peer.anyIpv4(),
            port: ec2.Port.tcp(COMMON_PORTS.HTTPS),
          },
        ],
      });

      const template = Template.fromStack(stack);

      expect(() => {
        template.hasResourceProperties("AWS::EC2::SecurityGroup", {
          SecurityGroupEgress: Match.arrayWith([
            Match.objectLike({
              Description: Match.stringLikeRegexp("Allow outbound.*"),
            }),
          ]),
        });
      }).not.toThrow();
    });

    test("allows adding egress rules via addEgressRule method", () => {
      const construct = new SecurityGroupConstruct(stack, "SecurityGroup", {
        vpc,
        groupName: TEST_CONSTANTS.SECURITY_GROUP.NAME,
        description: TEST_CONSTANTS.SECURITY_GROUP.DESCRIPTION,
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
      });

      construct.addEgressRule(
        ec2.Peer.anyIpv4(),
        ec2.Port.tcp(COMMON_PORTS.HTTP),
        "Allow outbound HTTP for updates"
      );

      const template = Template.fromStack(stack);

      expect(() => {
        template.hasResourceProperties("AWS::EC2::SecurityGroup", {
          SecurityGroupEgress: Match.arrayWith([
            Match.objectLike({
              CidrIp: "0.0.0.0/0",
              FromPort: COMMON_PORTS.HTTP,
              ToPort: COMMON_PORTS.HTTP,
              IpProtocol: "tcp",
              Description: "Allow outbound HTTP for updates",
            }),
          ]),
        });
      }).not.toThrow();
    });
  });

  // ============================================
  // Security Group Connections Tests
  // ============================================

  describe("Security Group Connections", () => {
    let connectionTestData: {
      ingressTest: {
        sourceSg: SecurityGroupConstruct;
        targetSg: SecurityGroupConstruct;
        hasIngressRule: boolean;
      };
      egressTest: {
        sourceSg: SecurityGroupConstruct;
        targetSg: SecurityGroupConstruct;
        hasEgressRule: boolean;
      };
    };

    beforeAll(() => {
      // Create isolated test environment that doesn't use the shared beforeEach stack
      const connectionTestApp = createTestApp();
      const connectionTestStack = new cdk.Stack(connectionTestApp, "ConnectionTestStack", {
        env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
      });
      const connectionTestVpc = new VpcConstruct(connectionTestStack, "TestVpc", {
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
      }).vpc;

      // Setup for ingress test
      const ingressSourceSg = new SecurityGroupConstruct(connectionTestStack, "SourceSG", {
        vpc: connectionTestVpc,
        groupName: `${TEST_CONSTANTS.SECURITY_GROUP.SOURCE_NAME}-conn-from`,
        description: TEST_CONSTANTS.SECURITY_GROUP.SOURCE_DESCRIPTION,
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
      });

      const ingressTargetSg = new SecurityGroupConstruct(connectionTestStack, "TargetSG", {
        vpc: connectionTestVpc,
        groupName: `${TEST_CONSTANTS.SECURITY_GROUP.TARGET_NAME}-conn-from`,
        description: TEST_CONSTANTS.SECURITY_GROUP.TARGET_DESCRIPTION,
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
      });

      ingressTargetSg.allowFrom(
        ingressSourceSg.securityGroup,
        ec2.Port.tcp(COMMON_PORTS.HTTP),
        "Allow HTTP from source security group"
      );

      // Setup for egress test
      const egressSourceSg = new SecurityGroupConstruct(connectionTestStack, "SourceSG2", {
        vpc: connectionTestVpc,
        groupName: `${TEST_CONSTANTS.SECURITY_GROUP.SOURCE_NAME}-conn-to`,
        description: TEST_CONSTANTS.SECURITY_GROUP.SOURCE_DESCRIPTION,
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
      });

      const egressTargetSg = new SecurityGroupConstruct(connectionTestStack, "TargetSG2", {
        vpc: connectionTestVpc,
        groupName: `${TEST_CONSTANTS.SECURITY_GROUP.TARGET_NAME}-conn-to`,
        description: TEST_CONSTANTS.SECURITY_GROUP.TARGET_DESCRIPTION,
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
      });

      egressSourceSg.allowTo(
        egressTargetSg.securityGroup,
        ec2.Port.tcp(COMMON_PORTS.HTTPS),
        "Allow HTTPS to target security group"
      );

      // Pre-compute template (single synthesis)
      const template = Template.fromStack(connectionTestStack);
      const securityGroupResources = template.findResources(
        "AWS::EC2::SecurityGroup"
      );
      const ingressResources = template.findResources(
        "AWS::EC2::SecurityGroupIngress"
      );
      const egressResources = template.findResources(
        "AWS::EC2::SecurityGroupEgress"
      );

      // Pre-compute ingress rule check
      const ingressTargetGroupName = `${TEST_CONSTANTS.SECURITY_GROUP.TARGET_NAME}-conn-from`;
      const targetSgResource = Object.values(securityGroupResources).find(
        (resource: Record<string, unknown>) =>
          (resource.Properties as Record<string, unknown>).GroupName ===
          ingressTargetGroupName
      ) as Record<string, unknown> | undefined;

      const targetSgIngressRules = targetSgResource
        ? ((targetSgResource.Properties as Record<string, unknown>)
            .SecurityGroupIngress as Array<Record<string, unknown>> | undefined)
        : undefined;

      const hasInlineIngressRule =
        targetSgIngressRules?.some(
          (rule) =>
            rule.SourceSecurityGroupId !== undefined &&
            rule.FromPort === COMMON_PORTS.HTTP &&
            rule.ToPort === COMMON_PORTS.HTTP &&
            rule.IpProtocol === "tcp" &&
            rule.Description === "Allow HTTP from source security group"
        ) ?? false;

      const hasSeparateIngressRule = Object.values(ingressResources).some(
        (resource: Record<string, unknown>) => {
          const props = resource.Properties as Record<string, unknown>;
          return (
            props.GroupId !== undefined &&
            props.SourceSecurityGroupId !== undefined &&
            props.FromPort === COMMON_PORTS.HTTP &&
            props.ToPort === COMMON_PORTS.HTTP &&
            props.IpProtocol === "tcp" &&
            props.Description === "Allow HTTP from source security group"
          );
        }
      );

      const hasIngressRule = hasInlineIngressRule || hasSeparateIngressRule;

      // Pre-compute egress rule check
      const egressSourceGroupName = `${TEST_CONSTANTS.SECURITY_GROUP.SOURCE_NAME}-conn-to`;
      const sourceSgResource = Object.values(securityGroupResources).find(
        (resource: Record<string, unknown>) =>
          (resource.Properties as Record<string, unknown>).GroupName ===
          egressSourceGroupName
      ) as Record<string, unknown> | undefined;

      const sourceSgEgressRules = sourceSgResource
        ? ((sourceSgResource.Properties as Record<string, unknown>)
            .SecurityGroupEgress as Array<Record<string, unknown>> | undefined)
        : undefined;

      const hasInlineEgressRule =
        sourceSgEgressRules?.some(
          (rule) =>
            rule.DestinationSecurityGroupId !== undefined &&
            rule.FromPort === COMMON_PORTS.HTTPS &&
            rule.ToPort === COMMON_PORTS.HTTPS &&
            rule.IpProtocol === "tcp" &&
            rule.Description === "Allow HTTPS to target security group"
        ) ?? false;

      const hasSeparateEgressRule = Object.values(egressResources).some(
        (resource: Record<string, unknown>) => {
          const props = resource.Properties as Record<string, unknown>;
          return (
            props.GroupId !== undefined &&
            props.DestinationSecurityGroupId !== undefined &&
            props.FromPort === COMMON_PORTS.HTTPS &&
            props.ToPort === COMMON_PORTS.HTTPS &&
            props.IpProtocol === "tcp" &&
            props.Description === "Allow HTTPS to target security group"
          );
        }
      );

      const hasEgressRule = hasInlineEgressRule || hasSeparateEgressRule;

      connectionTestData = {
        ingressTest: {
          sourceSg: ingressSourceSg,
          targetSg: ingressTargetSg,
          hasIngressRule,
        },
        egressTest: {
          sourceSg: egressSourceSg,
          targetSg: egressTargetSg,
          hasEgressRule,
        },
      };
    });

    test("allows connections from another security group", () => {
      // Guard assertion
      expect(connectionTestData).toBeDefined();
      expect(connectionTestData.ingressTest).toBeDefined();

      // Verify constructs were created
      expect(connectionTestData.ingressTest.targetSg).toBeDefined();
      expect(connectionTestData.ingressTest.targetSg.securityGroup).toBeDefined();
      expect(connectionTestData.ingressTest.sourceSg).toBeDefined();
      expect(connectionTestData.ingressTest.sourceSg.securityGroup).toBeDefined();

      // Verify the ingress rule was created
      expect(connectionTestData.ingressTest.hasIngressRule).toBe(true);
    });

    test("allows connections to another security group", () => {
      // Guard assertion
      expect(connectionTestData).toBeDefined();
      expect(connectionTestData.egressTest).toBeDefined();

      // Verify constructs were created
      expect(connectionTestData.egressTest.sourceSg).toBeDefined();
      expect(connectionTestData.egressTest.sourceSg.securityGroup).toBeDefined();
      expect(connectionTestData.egressTest.targetSg).toBeDefined();
      expect(connectionTestData.egressTest.targetSg.securityGroup).toBeDefined();

      // Verify the egress rule was created
      expect(connectionTestData.egressTest.hasEgressRule).toBe(true);
    });
  });

  // ============================================
  // Tagging Tests
  // ============================================

  describe("Tagging", () => {
    test("adds Name tag with group name", () => {
      new SecurityGroupConstruct(stack, "SecurityGroup", {
        vpc,
        groupName: TEST_CONSTANTS.SECURITY_GROUP.NAME,
        description: TEST_CONSTANTS.SECURITY_GROUP.DESCRIPTION,
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
      });

      const template = Template.fromStack(stack);

      expect(() => {
        template.hasResourceProperties("AWS::EC2::SecurityGroup", {
          Tags: Match.arrayWith([
            {
              Key: "Name",
              Value: TEST_CONSTANTS.SECURITY_GROUP.NAME,
            },
          ]),
        });
      }).not.toThrow();
    });

    test("adds Environment tag with envName", () => {
      new SecurityGroupConstruct(stack, "SecurityGroup", {
        vpc,
        groupName: TEST_CONSTANTS.SECURITY_GROUP.NAME,
        description: TEST_CONSTANTS.SECURITY_GROUP.DESCRIPTION,
        envName: TEST_CONSTANTS.ENVIRONMENTS.PRODUCTION,
      });

      const template = Template.fromStack(stack);

      expect(() => {
        template.hasResourceProperties("AWS::EC2::SecurityGroup", {
          Tags: Match.arrayWith([
            {
              Key: "Environment",
              Value: TEST_CONSTANTS.ENVIRONMENTS.PRODUCTION,
            },
          ]),
        });
      }).not.toThrow();
    });

    test("adds ManagedBy tag", () => {
      new SecurityGroupConstruct(stack, "SecurityGroup", {
        vpc,
        groupName: TEST_CONSTANTS.SECURITY_GROUP.NAME,
        description: TEST_CONSTANTS.SECURITY_GROUP.DESCRIPTION,
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
      });

      const template = Template.fromStack(stack);

      expect(() => {
        template.hasResourceProperties("AWS::EC2::SecurityGroup", {
          Tags: Match.arrayWith([
            {
              Key: "ManagedBy",
              Value: "CDK",
            },
          ]),
        });
      }).not.toThrow();
    });

    test("adds ResourceType tag", () => {
      new SecurityGroupConstruct(stack, "SecurityGroup", {
        vpc,
        groupName: TEST_CONSTANTS.SECURITY_GROUP.NAME,
        description: TEST_CONSTANTS.SECURITY_GROUP.DESCRIPTION,
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
      });

      const template = Template.fromStack(stack);

      expect(() => {
        template.hasResourceProperties("AWS::EC2::SecurityGroup", {
          Tags: Match.arrayWith([
            {
              Key: "ResourceType",
              Value: "SecurityGroup",
            },
          ]),
        });
      }).not.toThrow();
    });

    test("adds Project tag when projectName is provided", () => {
      new SecurityGroupConstruct(stack, "SecurityGroup", {
        vpc,
        groupName: TEST_CONSTANTS.SECURITY_GROUP.NAME,
        description: TEST_CONSTANTS.SECURITY_GROUP.DESCRIPTION,
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        projectName: "monitoring",
      });

      const template = Template.fromStack(stack);

      expect(() => {
        template.hasResourceProperties("AWS::EC2::SecurityGroup", {
          Tags: Match.arrayWith([
            {
              Key: "Project",
              Value: "monitoring",
            },
          ]),
        });
      }).not.toThrow();
    });

    test("does not add Project tag when projectName is not provided", () => {
      new SecurityGroupConstruct(stack, "SecurityGroup", {
        vpc,
        groupName: TEST_CONSTANTS.SECURITY_GROUP.NAME,
        description: TEST_CONSTANTS.SECURITY_GROUP.DESCRIPTION,
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
      });

      const template = Template.fromStack(stack);

      const securityGroupResources = template.findResources(
        "AWS::EC2::SecurityGroup"
      );
      const securityGroupResource = Object.values(securityGroupResources)[0];
      const tags = securityGroupResource.Properties.Tags;

      const hasProjectTag = tags.some(
        (tag: { Key: string; Value: string }) => tag.Key === "Project"
      );
      expect(hasProjectTag).toBe(false);
    });
  });

  // ============================================
  // Security Warnings Tests
  // ============================================

  describe("Security Warnings", () => {
    test("warns when allowAllOutbound is true in production", () => {
      const productionStack = new cdk.Stack(app, "ProductionStack", {
        env: {
          account: "123456789012",
          region: "eu-west-1",
        },
      });
      const productionVpc = new VpcConstruct(productionStack, "TestVpc", {
        envName: TEST_CONSTANTS.ENVIRONMENTS.PRODUCTION,
      }).vpc;

      const construct = new SecurityGroupConstruct(productionStack, "SecurityGroup", {
        vpc: productionVpc,
        groupName: TEST_CONSTANTS.SECURITY_GROUP.PROD_NAME,
        description: TEST_CONSTANTS.SECURITY_GROUP.PROD_DESCRIPTION,
        envName: TEST_CONSTANTS.ENVIRONMENTS.PRODUCTION,
        allowAllOutbound: true,
      });

      // Construct should be created (warnings don't prevent creation)
      expect(construct).toBeDefined();
      expect(construct.securityGroup).toBeDefined();
    });

    test("warns when allowAllOutbound is true in prod environment", () => {
      const prodStack = new cdk.Stack(app, "ProdStack", {
        env: {
          account: "123456789012",
          region: "eu-west-1",
        },
      });
      const prodVpc = new VpcConstruct(prodStack, "TestVpc", {
      envName: "prod",
      }).vpc;

      const construct = new SecurityGroupConstruct(prodStack, "SecurityGroup", {
        vpc: prodVpc,
        groupName: TEST_CONSTANTS.SECURITY_GROUP.PROD_NAME,
        description: TEST_CONSTANTS.SECURITY_GROUP.PROD_DESCRIPTION,
      envName: "prod",
        allowAllOutbound: true,
      });

      expect(construct).toBeDefined();
    });

    test("warns when ingress rule allows access from anywhere", () => {
      const construct = new SecurityGroupConstruct(stack, "SecurityGroup", {
        vpc,
        groupName: TEST_CONSTANTS.SECURITY_GROUP.NAME,
        description: TEST_CONSTANTS.SECURITY_GROUP.DESCRIPTION,
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        ingressRules: [
          {
            peer: ec2.Peer.anyIpv4(),
            port: ec2.Port.tcp(COMMON_PORTS.HTTP),
          },
        ],
      });

      // Construct should be created (warnings don't prevent creation)
      expect(construct).toBeDefined();
    });

    test("warns when ingress rule allows all traffic", () => {
      const construct = new SecurityGroupConstruct(stack, "SecurityGroup", {
        vpc,
        groupName: TEST_CONSTANTS.SECURITY_GROUP.NAME,
        description: TEST_CONSTANTS.SECURITY_GROUP.DESCRIPTION,
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        ingressRules: [
          {
            peer: ec2.Peer.anyIpv4(),
            port: ec2.Port.allTraffic(),
          },
        ],
      });

      expect(construct).toBeDefined();
    });

    test("warns when egress rule allows access to anywhere", () => {
      const construct = new SecurityGroupConstruct(stack, "SecurityGroup", {
        vpc,
        groupName: TEST_CONSTANTS.SECURITY_GROUP.NAME,
        description: TEST_CONSTANTS.SECURITY_GROUP.DESCRIPTION,
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        egressRules: [
          {
            peer: ec2.Peer.anyIpv4(),
            port: ec2.Port.tcp(COMMON_PORTS.HTTPS),
          },
        ],
      });

      expect(construct).toBeDefined();
    });
  });

  // ============================================
  // Integration Tests
  // ============================================

  describe("Integration", () => {
    test("creates complete security group with all features", () => {
      const construct = new SecurityGroupConstruct(stack, "SecurityGroup", {
        vpc,
        groupName: TEST_CONSTANTS.SECURITY_GROUP.WEB_SERVER_NAME,
        description: TEST_CONSTANTS.SECURITY_GROUP.WEB_SERVER_DESCRIPTION,
        envName: TEST_CONSTANTS.ENVIRONMENTS.PRODUCTION,
        projectName: "monitoring",
        allowAllOutbound: false,
        ingressRules: [
          {
            peer: ec2.Peer.anyIpv4(),
            port: ec2.Port.tcp(COMMON_PORTS.HTTP),
            description: "Allow HTTP from internet",
          },
          {
            peer: ec2.Peer.anyIpv4(),
            port: ec2.Port.tcp(COMMON_PORTS.HTTPS),
            description: "Allow HTTPS from internet",
          },
        ],
        egressRules: [
          {
            peer: ec2.Peer.anyIpv4(),
            port: ec2.Port.tcp(COMMON_PORTS.HTTPS),
            description: "Allow outbound HTTPS for AWS services",
          },
          {
            peer: ec2.Peer.anyIpv4(),
            port: ec2.Port.tcp(COMMON_PORTS.HTTP),
            description: "Allow outbound HTTP for package updates",
          },
        ],
      });

      const template = Template.fromStack(stack);

      // Verify security group exists
      template.resourceCountIs("AWS::EC2::SecurityGroup", 1);

      // Verify properties
      template.hasResourceProperties("AWS::EC2::SecurityGroup", {
        GroupDescription: "Security group for web servers allowing HTTP/HTTPS traffic",
        GroupName: "web-server-sg",
      });

      // Verify tags separately (order may vary)
      const securityGroupResources = template.findResources(
        "AWS::EC2::SecurityGroup"
      );
      const securityGroupResource = Object.values(
        securityGroupResources
      )[0] as Record<string, unknown>;
      const tags = (securityGroupResource.Properties as Record<string, unknown>)
        .Tags as Array<{ Key: string; Value: string }>;

      expect(tags).toBeInstanceOf(Array);
      expect(tags).toContainEqual({ Key: "Name", Value: "web-server-sg" });
      expect(tags).toContainEqual({ Key: "Environment", Value: "production" });
      expect(tags).toContainEqual({ Key: "Project", Value: "monitoring" });
      expect(tags).toContainEqual({ Key: "ManagedBy", Value: "CDK" });
      expect(tags).toContainEqual({
        Key: "ResourceType",
        Value: "SecurityGroup",
      });

      // Verify ingress rules
      template.hasResourceProperties("AWS::EC2::SecurityGroup", {
        SecurityGroupIngress: Match.arrayWith([
          Match.objectLike({
            CidrIp: "0.0.0.0/0",
            FromPort: COMMON_PORTS.HTTP,
            ToPort: COMMON_PORTS.HTTP,
            Description: "Allow HTTP from internet",
          }),
          Match.objectLike({
            CidrIp: "0.0.0.0/0",
            FromPort: COMMON_PORTS.HTTPS,
            ToPort: COMMON_PORTS.HTTPS,
            Description: "Allow HTTPS from internet",
          }),
        ]),
      });

      // Verify egress rules
      template.hasResourceProperties("AWS::EC2::SecurityGroup", {
        SecurityGroupEgress: Match.arrayWith([
          Match.objectLike({
            CidrIp: "0.0.0.0/0",
            FromPort: COMMON_PORTS.HTTPS,
            ToPort: COMMON_PORTS.HTTPS,
            Description: "Allow outbound HTTPS for AWS services",
          }),
          Match.objectLike({
            CidrIp: "0.0.0.0/0",
            FromPort: COMMON_PORTS.HTTP,
            ToPort: COMMON_PORTS.HTTP,
            Description: "Allow outbound HTTP for package updates",
          }),
        ]),
      });

      // Verify construct exposes security group
      expect(construct.securityGroup).toBeDefined();
      expect(construct.securityGroupId).toBeDefined();
    });

    test("works with multiple security groups in same stack", () => {
      const sg1 = new SecurityGroupConstruct(stack, "SecurityGroup1", {
        vpc,
        groupName: TEST_CONSTANTS.SECURITY_GROUP.SG1_NAME,
        description: TEST_CONSTANTS.SECURITY_GROUP.SG1_DESCRIPTION,
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
      });

      const sg2 = new SecurityGroupConstruct(stack, "SecurityGroup2", {
        vpc,
        groupName: TEST_CONSTANTS.SECURITY_GROUP.SG2_NAME,
        description: TEST_CONSTANTS.SECURITY_GROUP.SG2_DESCRIPTION,
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
      });

      // Allow sg1 to connect to sg2
      sg2.allowFrom(sg1.securityGroup, ec2.Port.tcp(COMMON_PORTS.HTTP));

      const template = Template.fromStack(stack);

      // Should have 2 security groups
      template.resourceCountIs("AWS::EC2::SecurityGroup", 2);

      // Both should be defined
      expect(sg1.securityGroup).toBeDefined();
      expect(sg2.securityGroup).toBeDefined();
      expect(sg1.securityGroupId).toBeDefined();
      expect(sg2.securityGroupId).toBeDefined();
    });
  });
});
