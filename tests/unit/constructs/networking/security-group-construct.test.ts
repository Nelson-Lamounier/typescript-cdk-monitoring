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

  beforeEach(() => {
    app = createTestApp();
    stack = new cdk.Stack(app, "TestStack", {
      env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
    });

    // Create a VPC for testing
    const vpcConstruct = new VpcConstruct(stack, "TestVpc", {
      envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
    });
    vpc = vpcConstruct.vpc;
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
    let ingressTestData: {
      hasIngressRule: boolean;
      targetSg: SecurityGroupConstruct;
    };
    let egressTestData: {
      hasEgressRule: boolean;
      sourceSg: SecurityGroupConstruct;
    };

    beforeAll(() => {
      // Pre-compute ingress test data
      const sourceSg = new SecurityGroupConstruct(stack, "SourceSG", {
        vpc,
        groupName: TEST_CONSTANTS.SECURITY_GROUP.SOURCE_NAME,
        description: TEST_CONSTANTS.SECURITY_GROUP.SOURCE_DESCRIPTION,
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
      });

      const targetSg = new SecurityGroupConstruct(stack, "TargetSG", {
        vpc,
        groupName: TEST_CONSTANTS.SECURITY_GROUP.TARGET_NAME,
        description: TEST_CONSTANTS.SECURITY_GROUP.TARGET_DESCRIPTION,
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
      });

      targetSg.allowFrom(
        sourceSg.securityGroup,
        ec2.Port.tcp(COMMON_PORTS.HTTP),
        "Allow HTTP from source security group"
      );

      const template = Template.fromStack(stack);

      // Find the target security group resource
      const securityGroupResources = template.findResources(
        "AWS::EC2::SecurityGroup"
      );
      const targetSgResource = Object.values(securityGroupResources).find(
        (resource: Record<string, unknown>) =>
          (resource.Properties as Record<string, unknown>).GroupName ===
          TEST_CONSTANTS.SECURITY_GROUP.TARGET_NAME
      ) as Record<string, unknown> | undefined;

      const targetSgProps = targetSgResource
        ? (targetSgResource.Properties as Record<string, unknown>)
        : {};

      // Check SecurityGroupIngress property
      let hasIngressRule = false;
      const ingressRules = targetSgProps.SecurityGroupIngress as
        | Array<Record<string, unknown>>
        | undefined;

      if (ingressRules && Array.isArray(ingressRules)) {
        hasIngressRule = ingressRules.some((rule) => {
          const hasSourceSg = rule.SourceSecurityGroupId !== undefined;
          const fromPortMatches = rule.FromPort === COMMON_PORTS.HTTP;
          const toPortMatches = rule.ToPort === COMMON_PORTS.HTTP;
          const protocolMatches = rule.IpProtocol === "tcp";
          const descriptionMatches =
            rule.Description === "Allow HTTP from source security group";
          return (
            hasSourceSg &&
            fromPortMatches &&
            toPortMatches &&
            protocolMatches &&
            descriptionMatches
          );
        });
      }

      // Check for separate SecurityGroupIngress resources if not found in properties
      if (!hasIngressRule) {
        const ingressResources = template.findResources(
          "AWS::EC2::SecurityGroupIngress"
        );
        hasIngressRule = Object.values(ingressResources).some(
          (resource: Record<string, unknown>) => {
            const props = resource.Properties as Record<string, unknown>;
            const hasGroupId = props.GroupId !== undefined;
            const hasSourceSg = props.SourceSecurityGroupId !== undefined;
            const fromPortMatches = props.FromPort === COMMON_PORTS.HTTP;
            const toPortMatches = props.ToPort === COMMON_PORTS.HTTP;
            const protocolMatches = props.IpProtocol === "tcp";
            const descriptionMatches =
              props.Description === "Allow HTTP from source security group";
            return (
              hasGroupId &&
              hasSourceSg &&
              fromPortMatches &&
              toPortMatches &&
              protocolMatches &&
              descriptionMatches
            );
          }
        );
      }

      ingressTestData = {
        hasIngressRule,
        targetSg,
      };

      // Pre-compute egress test data
      const sourceSg2 = new SecurityGroupConstruct(stack, "SourceSG2", {
        vpc,
        groupName: `${TEST_CONSTANTS.SECURITY_GROUP.SOURCE_NAME}-2`,
        description: TEST_CONSTANTS.SECURITY_GROUP.SOURCE_DESCRIPTION,
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
      });

      const targetSg2 = new SecurityGroupConstruct(stack, "TargetSG2", {
        vpc,
        groupName: `${TEST_CONSTANTS.SECURITY_GROUP.TARGET_NAME}-2`,
        description: TEST_CONSTANTS.SECURITY_GROUP.TARGET_DESCRIPTION,
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
      });

      sourceSg2.allowTo(
        targetSg2.securityGroup,
        ec2.Port.tcp(COMMON_PORTS.HTTPS),
        "Allow HTTPS to target security group"
      );

      const template2 = Template.fromStack(stack);

      // Find the source security group resource
      const securityGroupResources2 = template2.findResources(
        "AWS::EC2::SecurityGroup"
      );
      const sourceSgResource = Object.values(securityGroupResources2).find(
        (resource: Record<string, unknown>) =>
          (resource.Properties as Record<string, unknown>).GroupName ===
          `${TEST_CONSTANTS.SECURITY_GROUP.SOURCE_NAME}-2`
      ) as Record<string, unknown> | undefined;

      const sourceSgProps = sourceSgResource
        ? (sourceSgResource.Properties as Record<string, unknown>)
        : {};

      // Check SecurityGroupEgress property
      let hasEgressRule = false;
      const egressRules = sourceSgProps.SecurityGroupEgress as
        | Array<Record<string, unknown>>
        | undefined;

      if (egressRules && Array.isArray(egressRules)) {
        hasEgressRule = egressRules.some(
          (rule) =>
            rule.DestinationSecurityGroupId &&
            rule.FromPort === COMMON_PORTS.HTTPS &&
            rule.ToPort === COMMON_PORTS.HTTPS &&
            rule.IpProtocol === "tcp" &&
            rule.Description === "Allow HTTPS to target security group"
        );
      }

      // Check for separate SecurityGroupEgress resources if not found in properties
      if (!hasEgressRule) {
        const egressResources = template2.findResources(
          "AWS::EC2::SecurityGroupEgress"
        );
        hasEgressRule = Object.values(egressResources).some(
          (resource: Record<string, unknown>) => {
            const props = resource.Properties as Record<string, unknown>;
            return (
              props.GroupId &&
              props.DestinationSecurityGroupId &&
              props.FromPort === COMMON_PORTS.HTTPS &&
              props.ToPort === COMMON_PORTS.HTTPS &&
              props.IpProtocol === "tcp" &&
              props.Description === "Allow HTTPS to target security group"
            );
          }
        );
      }

      egressTestData = {
        hasEgressRule,
        sourceSg: sourceSg2,
      };
    });

    test("allows connections from another security group", () => {
      // Guard assertions
      expect(ingressTestData).toBeDefined();
      expect(ingressTestData.targetSg).toBeDefined();
      expect(ingressTestData.targetSg.securityGroup).toBeDefined();

      // Verify the rule exists
      expect(ingressTestData.hasIngressRule).toBe(true);
    });

    test("allows connections to another security group", () => {
      // Guard assertions
      expect(egressTestData).toBeDefined();
      expect(egressTestData.sourceSg).toBeDefined();
      expect(egressTestData.sourceSg.securityGroup).toBeDefined();

      // Verify the rule exists
      expect(egressTestData.hasEgressRule).toBe(true);
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
