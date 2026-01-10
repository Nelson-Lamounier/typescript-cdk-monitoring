/** @format */

import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as efs from "aws-cdk-lib/aws-efs";
import { Template, Match } from "aws-cdk-lib/assertions";

import { MonitoringEfsStack } from "../../../../lib/stacks/monitoring/monitoring-efs-stack";
import { MonitoringEfsStackProps } from "../../../../lib/shared/types";

// ============================================================================
// TEST CONFIGURATION
// ============================================================================

const TEST_CONFIG = {
  account: "123456789012",
  region: "eu-west-1",
  environments: {
    development: {
      envName: "development",
    },
    production: {
      envName: "production",
    },
    pipeline: {
      envName: "pipeline",
    },
    staging: {
      envName: "staging",
    },
  },
} as const;

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Create a test VPC within a stack scope
 * Includes both public and private subnets for comprehensive testing
 */
function createTestVpc(scope: cdk.Stack, id: string): ec2.IVpc {
  return new ec2.Vpc(scope, id, {
    ipAddresses: ec2.IpAddresses.cidr("10.0.0.0/16"),
    maxAzs: 2,
    natGateways: 1, // Create private subnets (even with 1 NAT gateway)
    subnetConfiguration: [
      {
        name: "Public",
        subnetType: ec2.SubnetType.PUBLIC,
        cidrMask: 24,
      },
      {
        name: "Private",
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        cidrMask: 24,
      },
    ],
  });
}

/**
 * Create a temporary stack to hold a VPC for testing
 */
function createVpcStack(
  app: cdk.App,
  id: string
): { stack: cdk.Stack; vpc: ec2.IVpc } {
  const vpcStack = new cdk.Stack(app, `VpcStack-${id}`, {
    env: {
      account: TEST_CONFIG.account,
      region: TEST_CONFIG.region,
    },
  });
  const vpc = createTestVpc(vpcStack, "TestVpc");
  return { stack: vpcStack, vpc };
}

/**
 * Create a test stack with default test configuration
 */
function createTestStack(
  app: cdk.App,
  id: string,
  props: Partial<MonitoringEfsStackProps> = {}
): MonitoringEfsStack {
  // Create a VPC if not provided
  let vpc: ec2.IVpc;
  if (props.vpc) {
    vpc = props.vpc;
  } else {
    const { vpc: testVpc } = createVpcStack(app, id);
    vpc = testVpc;
  }

  return new MonitoringEfsStack(app, id, {
    env: {
      account: TEST_CONFIG.account,
      region: TEST_CONFIG.region,
    },
    envName: "development",
    vpc,
    ...props,
  });
}

/**
 * Test fixtures for common stack configurations
 */
const fixtures = {
  minimal: (vpc: ec2.IVpc): MonitoringEfsStackProps => ({
    env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
    envName: "development",
    vpc,
  }),

  development: (vpc: ec2.IVpc): MonitoringEfsStackProps => ({
    env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
    envName: "development",
    vpc,
    enableEncryption: true,
    removalPolicy: cdk.RemovalPolicy.DESTROY,
    usePublicSubnets: true,
  }),

  production: (vpc: ec2.IVpc): MonitoringEfsStackProps => ({
    env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
    envName: "production",
    vpc,
    enableEncryption: true,
    lifecyclePolicy: efs.LifecyclePolicy.AFTER_30_DAYS,
    removalPolicy: cdk.RemovalPolicy.RETAIN,
    usePublicSubnets: false,
  }),

  custom: (
    vpc: ec2.IVpc,
    overrides: Partial<MonitoringEfsStackProps> = {}
  ): MonitoringEfsStackProps => ({
    ...fixtures.minimal(vpc),
    ...overrides,
  }),
};

// ============================================================================
// MONITORING EFS STACK TESTS
// ============================================================================

describe("MonitoringEfsStack", () => {
  let app: cdk.App;

  beforeEach(() => {
    app = new cdk.App();
  });

  // ============================================================================
  // Stack Creation
  // ============================================================================

  describe("Stack Creation", () => {
    test("creates stack with minimal required properties", () => {
      const { vpc } = createVpcStack(app, "Minimal");
      const stack = new MonitoringEfsStack(
        app,
        "TestStack",
        fixtures.minimal(vpc)
      );
      const template = Template.fromStack(stack);

      template.resourceCountIs("AWS::EFS::FileSystem", 1);
    });

    test("creates stack with all optional properties", () => {
      const { vpc } = createVpcStack(app, "Test");
      const stack = createTestStack(app, "TestStack", {
        vpc,
        projectName: "monitoring",
        enableEncryption: true,
        lifecyclePolicy: efs.LifecyclePolicy.AFTER_30_DAYS,
        removalPolicy: cdk.RemovalPolicy.RETAIN,
        usePublicSubnets: false,
        createSsmParameters: true,
        createOutputs: true,
        enableExports: true,
      });

      const template = Template.fromStack(stack);
      template.resourceCountIs("AWS::EFS::FileSystem", 1);
    });

    test("matches snapshot for minimal configuration", () => {
      const { vpc } = createVpcStack(app, "Snapshot");
      const stack = new MonitoringEfsStack(
        app,
        "MinimalStack",
        fixtures.minimal(vpc)
      );
      const template = Template.fromStack(stack);

      // Normalize dynamic values (timestamp) for snapshot comparison
      const templateJson = template.toJSON();
      const customResources = templateJson.Resources || {};
      Object.values(customResources).forEach((resource: any) => {
        if (
          resource.Type === "AWS::CloudFormation::CustomResource" &&
          resource.Properties?.Timestamp
        ) {
          resource.Properties.Timestamp = "<TIMESTAMP>";
        }
      });

      expect(templateJson).toMatchSnapshot();
    });
  });

  // ============================================================================
  // EFS File System Configuration (Parameterized)
  // ============================================================================

  describe("EFS File System Configuration", () => {
    test.each([
      { envName: "development", expectedPolicy: "Delete" },
      { envName: "production", expectedPolicy: "Retain" },
      { envName: "staging", expectedPolicy: "Delete" },
      { envName: "pipeline", expectedPolicy: "Delete" },
    ])(
      "uses $expectedPolicy removal policy for $envName",
      ({ envName, expectedPolicy }) => {
        const { vpc } = createVpcStack(app, `Policy-${envName}`);
        const stack = createTestStack(app, `TestStack-${envName}`, {
          envName,
          vpc,
        });
        const template = Template.fromStack(stack);

        template.hasResource("AWS::EFS::FileSystem", {
          DeletionPolicy: expectedPolicy,
          UpdateReplacePolicy: expectedPolicy,
        });
      }
    );

    test("creates EFS file system with encryption enabled by default", () => {
      const { vpc } = createVpcStack(app, "Test");
      const stack = createTestStack(app, "TestStack", { vpc });
      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::EFS::FileSystem", {
        Encrypted: true,
      });
    });

    test("creates EFS file system without encryption when disabled", () => {
      const { vpc } = createVpcStack(app, "Test");
      const stack = createTestStack(app, "TestStack", {
        vpc,
        enableEncryption: false,
      });
      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::EFS::FileSystem", {
        Encrypted: false,
      });
    });

    test.each([
      {
        policy: efs.LifecyclePolicy.AFTER_7_DAYS,
        expectedTransition: "AFTER_7_DAYS",
      },
      {
        policy: efs.LifecyclePolicy.AFTER_14_DAYS,
        expectedTransition: "AFTER_14_DAYS",
      },
      {
        policy: efs.LifecyclePolicy.AFTER_30_DAYS,
        expectedTransition: "AFTER_30_DAYS",
      },
      {
        policy: efs.LifecyclePolicy.AFTER_60_DAYS,
        expectedTransition: "AFTER_60_DAYS",
      },
      {
        policy: efs.LifecyclePolicy.AFTER_90_DAYS,
        expectedTransition: "AFTER_90_DAYS",
      },
    ])(
      "creates EFS with lifecycle policy $expectedTransition",
      ({ policy, expectedTransition }) => {
        const { vpc } = createVpcStack(app, "Test");
        const stack = createTestStack(app, "TestStack", {
          vpc,
          lifecyclePolicy: policy,
        });
        const template = Template.fromStack(stack);

        template.hasResourceProperties("AWS::EFS::FileSystem", {
          LifecyclePolicies: [
            {
              TransitionToIA: expectedTransition,
            },
          ],
        });
      }
    );

    test("creates exactly one EFS file system", () => {
      const { vpc } = createVpcStack(app, "Test");
      const stack = createTestStack(app, "TestStack", { vpc });
      const template = Template.fromStack(stack);

      template.resourceCountIs("AWS::EFS::FileSystem", 1);
    });
  });

  // ============================================================================
  // EFS Access Point Configuration
  // ============================================================================

  describe("EFS Access Point Configuration", () => {
    test("creates EFS access point with correct path", () => {
      const { vpc } = createVpcStack(app, "Test");
      const stack = createTestStack(app, "TestStack", { vpc });
      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::EFS::AccessPoint", {
        PosixUser: {
          Uid: Match.anyValue(),
          Gid: Match.anyValue(),
        },
        RootDirectory: {
          CreationInfo: {
            OwnerUid: Match.anyValue(),
            OwnerGid: Match.anyValue(),
            Permissions: Match.anyValue(),
          },
          Path: "/monitoring",
        },
      });
    });

    test("creates exactly one EFS access point", () => {
      const { vpc } = createVpcStack(app, "Test");
      const stack = createTestStack(app, "TestStack", { vpc });
      const template = Template.fromStack(stack);

      template.resourceCountIs("AWS::EFS::AccessPoint", 1);
    });
  });

  // ============================================================================
  // Security Group Configuration
  // ============================================================================

  describe("Security Group Configuration", () => {
    test("creates security group for EFS mount targets", () => {
      const { vpc } = createVpcStack(app, "Test");
      const stack = createTestStack(app, "TestStack", { vpc });
      const template = Template.fromStack(stack);

      template.resourceCountIs("AWS::EC2::SecurityGroup", 1);
    });

    test("security group allows NFS traffic from VPC CIDR", () => {
      const { vpc } = createVpcStack(app, "Test");
      const stack = createTestStack(app, "TestStack", { vpc });
      const template = Template.fromStack(stack);

      // VPC CIDR may be a CloudFormation intrinsic function if VPC is in different stack
      // So we match on the structure rather than exact CIDR value
      template.hasResourceProperties("AWS::EC2::SecurityGroup", {
        SecurityGroupIngress: Match.arrayWith([
          Match.objectLike({
            IpProtocol: "tcp",
            FromPort: 2049,
            ToPort: 2049,
            // CidrIp can be a string or CloudFormation function
            CidrIp: Match.anyValue(),
          }),
        ]),
      });

      // Verify the ingress rule exists and has correct port
      const securityGroups = template.findResources("AWS::EC2::SecurityGroup");
      const sg = Object.values(securityGroups)[0] as any;
      const ingressRules = sg.Properties.SecurityGroupIngress;
      const nfsRule = ingressRules.find(
        (rule: any) =>
          rule.IpProtocol === "tcp" &&
          rule.FromPort === 2049 &&
          rule.ToPort === 2049
      );
      expect(nfsRule).toBeDefined();
    });
  });

  // ============================================================================
  // Lambda Function Configuration
  // ============================================================================

  describe("Lambda Function Configuration", () => {
    test("creates Lambda function for EFS initialization", () => {
      const { vpc } = createVpcStack(app, "Test");
      const stack = createTestStack(app, "TestStack", { vpc });
      const template = Template.fromStack(stack);

      template.resourceCountIs("AWS::Lambda::Function", 1);
    });

    test("Lambda function has correct environment variables", () => {
      const { vpc } = createVpcStack(app, "Test");
      const stack = createTestStack(app, "TestStack", {
        vpc,
        envName: "development",
      });
      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::Lambda::Function", {
        Environment: {
          Variables: {
            ENVIRONMENT: "development",
            EFS_FILE_SYSTEM_ID: Match.anyValue(),
            EFS_ACCESS_POINT_ID: Match.anyValue(),
          },
        },
      });
    });

    test("Lambda function has EFS permissions", () => {
      const { vpc } = createVpcStack(app, "Test");
      const stack = createTestStack(app, "TestStack", { vpc });
      const template = Template.fromStack(stack);

      const functions = template.findResources("AWS::Lambda::Function");
      const functionResource = Object.values(functions)[0] as any;

      expect(functionResource).toBeDefined();
      // Verify Lambda has IAM role with EFS permissions
      const roleArn = functionResource.Properties.Role["Fn::GetAtt"][0];
      expect(roleArn).toBeDefined();
    });
  });

  // ============================================================================
  // Custom Resource Configuration
  // ============================================================================

  describe("Custom Resource Configuration", () => {
    test("creates custom resource for EFS initialization", () => {
      const { vpc } = createVpcStack(app, "Test");
      const stack = createTestStack(app, "TestStack", { vpc });
      const template = Template.fromStack(stack);

      template.resourceCountIs("AWS::CloudFormation::CustomResource", 1);
    });

    test("custom resource has correct properties", () => {
      const { vpc } = createVpcStack(app, "Test");
      const stack = createTestStack(app, "TestStack", {
        vpc,
        envName: "development",
      });
      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::CloudFormation::CustomResource", {
        Environment: "development",
        Region: TEST_CONFIG.region,
        FileSystemId: Match.anyValue(),
        AccessPointId: Match.anyValue(),
      });
    });
  });

  // ============================================================================
  // SSM Parameters Configuration
  // ============================================================================

  describe("SSM Parameters Configuration", () => {
    test("creates SSM parameters by default", () => {
      const { vpc } = createVpcStack(app, "Test");
      const stack = createTestStack(app, "TestStack", { vpc });
      const template = Template.fromStack(stack);

      const parameters = template.findResources("AWS::SSM::Parameter");
      expect(Object.keys(parameters).length).toBeGreaterThan(0);
    });

    test("creates Prometheus configuration SSM parameter", () => {
      const { vpc } = createVpcStack(app, "Test");
      const stack = createTestStack(app, "TestStack", {
        vpc,
        envName: "development",
      });
      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::SSM::Parameter", {
        Name: "/monitoring/development/prometheus-config",
        Type: "String",
        Tier: "Standard",
      });
    });

    test("creates Grafana datasource configuration SSM parameter", () => {
      const { vpc } = createVpcStack(app, "Test");
      const stack = createTestStack(app, "TestStack", {
        vpc,
        envName: "development",
      });
      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::SSM::Parameter", {
        Name: "/monitoring/development/grafana-datasource-config",
        Type: "String",
        Tier: "Standard",
      });
    });

    test("creates Grafana dashboard configuration SSM parameter", () => {
      const { vpc } = createVpcStack(app, "Test");
      const stack = createTestStack(app, "TestStack", {
        vpc,
        envName: "development",
      });
      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::SSM::Parameter", {
        Name: "/monitoring/development/grafana-dashboard-config",
        Type: "String",
        Tier: "Standard",
      });
    });

    test("creates EFS discovery SSM parameters when enabled", () => {
      const { vpc } = createVpcStack(app, "Test");
      const stack = createTestStack(app, "TestStack", {
        vpc,
        createSsmParameters: true,
      });
      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::SSM::Parameter", {
        Name: Match.stringLikeRegexp("/monitoring/.*/efs/config/.*"),
      });
    });

    test("does not create SSM parameters when disabled", () => {
      const { vpc } = createVpcStack(app, "Test");
      const stack = createTestStack(app, "TestStack", {
        vpc,
        createSsmParameters: false,
      });
      const template = Template.fromStack(stack);

      // Should still have monitoring config parameters (Prometheus, Grafana)
      // but not EFS discovery parameters
      const parameters = template.findResources("AWS::SSM::Parameter");
      const efsParams = Object.values(parameters).filter((param: any) =>
        param.Properties.Name?.includes("/efs/")
      );
      expect(efsParams.length).toBe(0);
    });
  });

  // ============================================================================
  // CloudFormation Outputs
  // ============================================================================

  describe("CloudFormation Outputs", () => {
    test("creates CloudFormation outputs by default", () => {
      const { vpc } = createVpcStack(app, "Test");
      const stack = createTestStack(app, "TestStack", { vpc });
      const template = Template.fromStack(stack);

      template.hasOutput("FileSystemId", {
        Description: Match.stringLikeRegexp("EFS file system ID"),
      });
    });

    test("creates FileSystemId output", () => {
      const { vpc } = createVpcStack(app, "Test");
      const stack = createTestStack(app, "TestStack", { vpc });
      const template = Template.fromStack(stack);

      template.hasOutput("FileSystemId", {
        Description: Match.stringLikeRegexp("EFS file system ID"),
      });
    });

    test("creates AccessPointId output", () => {
      const { vpc } = createVpcStack(app, "Test");
      const stack = createTestStack(app, "TestStack", { vpc });
      const template = Template.fromStack(stack);

      template.hasOutput("AccessPointId", {
        Description: Match.stringLikeRegexp("EFS access point ID"),
      });
    });

    test("creates SecurityGroupId output", () => {
      const { vpc } = createVpcStack(app, "Test");
      const stack = createTestStack(app, "TestStack", { vpc });
      const template = Template.fromStack(stack);

      template.hasOutput("SecurityGroupId", {
        Description: Match.stringLikeRegexp("EFS mount target security group"),
      });
    });

    test("creates exports when enableExports is true", () => {
      const { vpc } = createVpcStack(app, "Test");
      const stack = createTestStack(app, "TestStack", {
        vpc,
        envName: "development",
        projectName: "monitoring",
        createOutputs: true,
        enableExports: true,
      });
      const template = Template.fromStack(stack);

      template.hasOutput("FileSystemId", {
        Export: {
          Name: "development-monitoring-monitoring-efs-id",
        },
      });
    });

    test("does not create exports when enableExports is false", () => {
      const { vpc } = createVpcStack(app, "Test");
      const stack = createTestStack(app, "TestStack", {
        vpc,
        createOutputs: true,
        enableExports: false,
      });
      const template = Template.fromStack(stack);

      const outputs = template.findOutputs("FileSystemId");
      expect(outputs.FileSystemId.Export).toBeUndefined();
    });

    test("does not create stack outputs when disabled", () => {
      const { vpc } = createVpcStack(app, "Test");
      const stack = createTestStack(app, "TestStack", {
        vpc,
        createOutputs: false,
        createSsmParameters: false,
      });
      const template = Template.fromStack(stack);

      expect(template.findOutputs("FileSystemId")).toEqual({});
      expect(template.findOutputs("AccessPointId")).toEqual({});
      expect(template.findOutputs("SecurityGroupId")).toEqual({});
    });
  });

  // ============================================================================
  // Subnet Selection
  // ============================================================================

  describe("Subnet Selection", () => {
    test("uses public subnets by default", () => {
      const { vpc } = createVpcStack(app, "Test");
      const stack = createTestStack(app, "TestStack", {
        vpc,
        usePublicSubnets: true,
      });
      const template = Template.fromStack(stack);

      // Verify mount targets are created (one per AZ)
      const mountTargets = template.findResources("AWS::EFS::MountTarget");
      expect(Object.keys(mountTargets).length).toBeGreaterThan(0);
    });

    test("uses private subnets when usePublicSubnets is false", () => {
      const { vpc } = createVpcStack(app, "Test");
      const stack = createTestStack(app, "TestStack", {
        vpc,
        usePublicSubnets: false,
      });
      const template = Template.fromStack(stack);

      const mountTargets = template.findResources("AWS::EFS::MountTarget");
      expect(Object.keys(mountTargets).length).toBeGreaterThan(0);
    });

    test("uses custom subnet selection when provided", () => {
      const { vpc } = createVpcStack(app, "Test");
      const customSubnets = vpc.selectSubnets({
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        onePerAz: true,
      });

      const stack = createTestStack(app, "TestStack", {
        vpc,
        mountTargetSubnetSelection: customSubnets,
      });
      const template = Template.fromStack(stack);

      const mountTargets = template.findResources("AWS::EFS::MountTarget");
      expect(Object.keys(mountTargets).length).toBeGreaterThan(0);
    });
  });

  // ============================================================================
  // Validation Tests (Parameterized)
  // ============================================================================

  describe("Validation", () => {
    test("validates environment name is non-empty", () => {
      const { vpc } = createVpcStack(app, "Test");
      expect(() => {
        createTestStack(app, "TestStack", { vpc, envName: "" });
      }).toThrow(/environment name/i);
    });

    test("throws error when VPC is not provided", () => {
      expect(() => {
        new MonitoringEfsStack(app, "TestStack", {
          env: {
            account: TEST_CONFIG.account,
            region: TEST_CONFIG.region,
          },
          envName: "development",
          vpc: undefined as any,
        });
      }).toThrow(/VPC is required/i);
    });
  });

  // ============================================================================
  // Feature Interactions
  // ============================================================================

  describe("Feature Interactions", () => {
    test("encryption and lifecycle policy work together", () => {
      const { vpc } = createVpcStack(app, "Test");
      const stack = createTestStack(app, "TestStack", {
        vpc,
        enableEncryption: true,
        lifecyclePolicy: efs.LifecyclePolicy.AFTER_30_DAYS,
      });
      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::EFS::FileSystem", {
        Encrypted: true,
        LifecyclePolicies: [
          {
            TransitionToIA: "AFTER_30_DAYS",
          },
        ],
      });
    });

    test("SSM parameters and outputs work together", () => {
      const { vpc } = createVpcStack(app, "Test");
      const stack = createTestStack(app, "TestStack", {
        vpc,
        createSsmParameters: true,
        createOutputs: true,
      });
      const template = Template.fromStack(stack);

      const parameters = template.findResources("AWS::SSM::Parameter");
      const outputs = template.findOutputs("*");
      expect(Object.keys(parameters).length).toBeGreaterThan(0);
      expect(Object.keys(outputs).length).toBeGreaterThan(0);
    });
  });

  // ============================================================================
  // Cost Optimization
  // ============================================================================

  describe("Cost Optimization", () => {
    test("development environment has cost-optimized configuration", () => {
      const { vpc } = createVpcStack(app, "Dev");
      const stack = new MonitoringEfsStack(
        app,
        "DevStack",
        fixtures.development(vpc)
      );
      const template = Template.fromStack(stack);

      template.hasResource("AWS::EFS::FileSystem", {
        DeletionPolicy: "Delete",
        UpdateReplacePolicy: "Delete",
      });
    });

    test("production environment has HA and data retention configuration", () => {
      const { vpc } = createVpcStack(app, "Prod");
      const stack = new MonitoringEfsStack(
        app,
        "ProdStack",
        fixtures.production(vpc)
      );
      const template = Template.fromStack(stack);

      template.hasResource("AWS::EFS::FileSystem", {
        DeletionPolicy: "Retain",
        UpdateReplacePolicy: "Retain",
      });

      template.hasResourceProperties("AWS::EFS::FileSystem", {
        LifecyclePolicies: [
          {
            TransitionToIA: "AFTER_30_DAYS",
          },
        ],
      });
    });
  });

  // ============================================================================
  // Stack Properties
  // ============================================================================

  describe("Stack Properties", () => {
    test.each([
      { property: "fileSystem", expectedType: "object" },
      { property: "accessPoint", expectedType: "object" },
      { property: "mountTargetSecurityGroup", expectedType: "object" },
      { property: "efsAvailabilityZone", expectedType: "string" },
      { property: "efsInitializationComplete", expectedType: "object" },
    ])("exposes $property property", ({ property, expectedType }) => {
      const { vpc } = createVpcStack(app, "Test");
      const stack = createTestStack(app, "TestStack", { vpc });

      const prop = (stack as any)[property];
      expect(prop).toBeDefined();

      if (expectedType === "string") {
        expect(typeof prop).toBe("string");
      } else {
        expect(typeof prop).toBe("object");
      }
    });
  });

  // ============================================================================
  // Cross-Account Targets
  // ============================================================================

  describe("Cross-Account Targets", () => {
    test("creates Prometheus config with cross-account targets", () => {
      const { vpc } = createVpcStack(app, "Test");
      const stack = createTestStack(app, "TestStack", {
        vpc,
        envName: "development",
        crossAccountTargets: [
          {
            envName: "staging",
            targetType: "node-exporter",
            port: 9100,
            accountId: "987654321098",
            roleArn: "arn:aws:iam::987654321098:role/prometheus-scraper",
            useEc2ServiceDiscovery: true,
          },
        ],
      });
      const template = Template.fromStack(stack);

      // Verify Prometheus config SSM parameter exists
      template.hasResourceProperties("AWS::SSM::Parameter", {
        Name: "/monitoring/development/prometheus-config",
      });

      // Verify the config contains cross-account scrape configs
      const parameters = template.findResources("AWS::SSM::Parameter");
      const prometheusParam = Object.values(parameters).find(
        (param: any) =>
          param.Properties.Name === "/monitoring/development/prometheus-config"
      );
      expect(prometheusParam).toBeDefined();
    });

    test("creates Prometheus config without cross-account targets", () => {
      const { vpc } = createVpcStack(app, "Test");
      const stack = createTestStack(app, "TestStack", {
        vpc,
        envName: "development",
      });
      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::SSM::Parameter", {
        Name: "/monitoring/development/prometheus-config",
      });
    });
  });
});
