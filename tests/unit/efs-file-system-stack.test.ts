/** @format */

import { App, Stack } from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as efs from "aws-cdk-lib/aws-efs";
import { Template, Match } from "aws-cdk-lib/assertions";

import { MonitoringEfsStack } from "../../lib/stacks/storage/efs-file-system-stack";

describe("MonitoringEfsStack", () => {
  let app: App;
  let vpcStack: Stack;
  let vpc: ec2.Vpc;
  let template: Template;

  beforeEach(() => {
    app = new App();

    // Create VPC for testing
    vpcStack = new Stack(app, "TestVpcStack", {
      env: { account: "123456789012", region: "eu-west-1" },
    });
    vpc = new ec2.Vpc(vpcStack, "TestVpc", {
      maxAzs: 2,
      natGateways: 0,
    });

    // Create MonitoringEfsStack
    const stack = new MonitoringEfsStack(app, "TestMonitoringEfsStack", {
      env: {
        account: "123456789012",
        region: "eu-west-1",
      },
      envName: "test",
      vpc,
      enableEncryption: true,
      lifecyclePolicy: efs.LifecyclePolicy.AFTER_30_DAYS,
    });

    template = Template.fromStack(stack);
  });

  // ============================================================================
  // EFS FILE SYSTEM TESTS
  // ============================================================================
  describe("EFS File System", () => {
    test("creates EFS file system", () => {
      template.resourceCountIs("AWS::EFS::FileSystem", 1);
    });

    test("EFS is encrypted at rest", () => {
      template.hasResourceProperties("AWS::EFS::FileSystem", {
        Encrypted: true,
      });
    });

    test("EFS has lifecycle policy for cost optimization", () => {
      template.hasResourceProperties("AWS::EFS::FileSystem", {
        LifecyclePolicies: Match.arrayWith([
          Match.objectLike({
            TransitionToIA: Match.anyValue(),
          }),
        ]),
      });
    });

    test("EFS uses elastic throughput mode by default", () => {
      template.hasResourceProperties("AWS::EFS::FileSystem", {
        ThroughputMode: "elastic",
      });
    });

    test("EFS has backup policy enabled", () => {
      template.hasResourceProperties("AWS::EFS::FileSystem", {
        BackupPolicy: {
          Status: "ENABLED",
        },
      });
    });

    test("EFS has correct tags", () => {
      template.hasResourceProperties("AWS::EFS::FileSystem", {
        FileSystemTags: Match.arrayWith([
          {
            Key: "Name",
            Value: "test-monitoring-efs",
          },
          {
            Key: "Environment",
            Value: "test",
          },
          {
            Key: "Purpose",
            Value: "MonitoringStorage",
          },
          {
            Key: "ManagedBy",
            Value: "CDK",
          },
        ]),
      });
    });
  });

  // ============================================================================
  // MOUNT TARGET TESTS
  // ============================================================================
  describe("EFS Mount Targets", () => {
    test("creates mount targets in public subnets", () => {
      const mountTargets = template.findResources("AWS::EFS::MountTarget");
      expect(Object.keys(mountTargets).length).toBeGreaterThanOrEqual(1);
    });

    test("mount targets have security group attached", () => {
      template.hasResourceProperties("AWS::EFS::MountTarget", {
        SecurityGroups: Match.anyValue(),
      });
    });
  });

  // ============================================================================
  // ACCESS POINT TESTS
  // ============================================================================
  describe("EFS Access Points", () => {
    test("creates access point for monitoring data", () => {
      template.hasResourceProperties("AWS::EFS::AccessPoint", {
        PosixUser: {
          Uid: "0",
          Gid: "0",
        },
        RootDirectory: {
          Path: "/monitoring",
          CreationInfo: {
            OwnerUid: "0",
            OwnerGid: "0",
            Permissions: "755",
          },
        },
      });
    });

    test("access point has correct tags", () => {
      template.hasResourceProperties("AWS::EFS::AccessPoint", {
        AccessPointTags: Match.arrayWith([
          {
            Key: "Name",
            Value: "test-monitoring-access-point",
          },
          {
            Key: "Environment",
            Value: "test",
          },
          {
            Key: "Purpose",
            Value: "MonitoringAccess",
          },
          {
            Key: "ManagedBy",
            Value: "CDK",
          },
        ]),
      });
    });
  });

  // ============================================================================
  // SECURITY GROUP TESTS
  // ============================================================================
  describe("EFS Security", () => {
    test("creates security group for EFS mount targets", () => {
      template.resourceCountIs("AWS::EC2::SecurityGroup", 1);
    });

    test("EFS security group allows NFS from VPC CIDR", () => {
      template.hasResourceProperties("AWS::EC2::SecurityGroup", {
        SecurityGroupIngress: Match.arrayWith([
          Match.objectLike({
            FromPort: 2049,
            ToPort: 2049,
            IpProtocol: "tcp",
            Description: Match.stringLikeRegexp(".*NFS.*"),
          }),
        ]),
      });
    });

    test("EFS security group does not allow public access", () => {
      const securityGroups = template.findResources("AWS::EC2::SecurityGroup");
      const sg = Object.values(securityGroups)[0];
      const ingressRules = sg.Properties?.SecurityGroupIngress || [];

      ingressRules.forEach((rule: Record<string, unknown>) => {
        if (rule.FromPort === 2049) {
          expect(rule.CidrIp).not.toBe("0.0.0.0/0");
        }
      });
    });

    test("security group has correct description", () => {
      template.hasResourceProperties("AWS::EC2::SecurityGroup", {
        GroupDescription: Match.stringLikeRegexp(".*EFS.*mount target.*"),
      });
    });

    test("security group has correct tags", () => {
      template.hasResourceProperties("AWS::EC2::SecurityGroup", {
        Tags: Match.arrayWith([
          {
            Key: "Name",
            Value: "test-efs-mount-target-sg",
          },
          {
            Key: "Environment",
            Value: "test",
          },
          {
            Key: "Purpose",
            Value: "EfsAccess",
          },
          {
            Key: "ManagedBy",
            Value: "CDK",
          },
        ]),
      });
    });
  });

  // ============================================================================
  // SSM PARAMETERS TESTS
  // ============================================================================
  describe("SSM Parameters", () => {
    test("creates SSM parameter for Prometheus config", () => {
      template.hasResourceProperties("AWS::SSM::Parameter", {
        Type: "String",
        Name: "/monitoring/test/prometheus-config",
        Tier: "Standard",
      });
    });

    test("creates SSM parameter for Grafana datasource config", () => {
      template.hasResourceProperties("AWS::SSM::Parameter", {
        Type: "String",
        Name: "/monitoring/test/grafana-datasource-config",
        Tier: "Standard",
      });
    });

    test("creates SSM parameter for Grafana dashboard config", () => {
      template.hasResourceProperties("AWS::SSM::Parameter", {
        Type: "String",
        Name: "/monitoring/test/grafana-dashboard-config",
        Tier: "Standard",
      });
    });

    test("creates exactly three SSM parameters", () => {
      template.resourceCountIs("AWS::SSM::Parameter", 3);
    });
  });

  // ============================================================================
  // STACK OUTPUTS TESTS
  // ============================================================================
  describe("Stack Outputs", () => {
    test("exports file system ID", () => {
      template.hasOutput("FileSystemId", {
        Description: "EFS File System ID for monitoring storage",
      });
    });

    test("exports access point ID", () => {
      template.hasOutput("AccessPointId", {
        Description: "EFS Access Point ID for monitoring",
      });
    });

    test("exports mount target security group ID", () => {
      template.hasOutput("MountTargetSecurityGroupId", {
        Description: "EFS Security Group ID",
      });
    });

    test("exports EFS availability zone", () => {
      template.hasOutput("EfsAvailabilityZone", {
        Description: "EFS Availability Zone",
      });
    });
  });

  // ============================================================================
  // STACK PROPERTIES TESTS
  // ============================================================================
  describe("Stack Properties", () => {
    test("exposes file system as public property", () => {
      const stack = new MonitoringEfsStack(app, "TestStack2", {
        env: {
          account: "123456789012",
          region: "eu-west-1",
        },
        envName: "test",
        vpc,
      });

      expect(stack.fileSystem).toBeDefined();
      expect(stack.fileSystem).toBeInstanceOf(efs.FileSystem);
    });

    test("exposes access point as public property", () => {
      const stack = new MonitoringEfsStack(app, "TestStack3", {
        env: {
          account: "123456789012",
          region: "eu-west-1",
        },
        envName: "test",
        vpc,
      });

      expect(stack.accessPoint).toBeDefined();
      expect(stack.accessPoint).toBeInstanceOf(efs.AccessPoint);
    });

    test("exposes security group as public property", () => {
      const stack = new MonitoringEfsStack(app, "TestStack4", {
        env: {
          account: "123456789012",
          region: "eu-west-1",
        },
        envName: "test",
        vpc,
      });

      expect(stack.mountTargetSecurityGroup).toBeDefined();
      expect(stack.mountTargetSecurityGroup).toBeInstanceOf(ec2.SecurityGroup);
    });
  });

  // ============================================================================
  // CUSTOM CONFIGURATION TESTS
  // ============================================================================
  describe("Custom Configuration", () => {
    test("uses custom lifecycle policy when provided", () => {
      const customStack = new MonitoringEfsStack(app, "TestStackCustom", {
        env: {
          account: "123456789012",
          region: "eu-west-1",
        },
        envName: "test",
        vpc,
        lifecyclePolicy: efs.LifecyclePolicy.AFTER_7_DAYS,
      });

      const customTemplate = Template.fromStack(customStack);
      customTemplate.hasResourceProperties("AWS::EFS::FileSystem", {
        LifecyclePolicies: Match.arrayWith([
          Match.objectLike({
            TransitionToIA: "AFTER_7_DAYS",
          }),
        ]),
      });
    });

    test("disables encryption when specified", () => {
      const customStack = new MonitoringEfsStack(app, "TestStackNoEncrypt", {
        env: {
          account: "123456789012",
          region: "eu-west-1",
        },
        envName: "test",
        vpc,
        enableEncryption: false,
      });

      const customTemplate = Template.fromStack(customStack);
      customTemplate.hasResourceProperties("AWS::EFS::FileSystem", {
        Encrypted: false,
      });
    });
  });

  // ============================================================================
  // RESOURCE COUNTS TESTS
  // ============================================================================
  describe("Resource Counts", () => {
    test("has correct total resource count", () => {
      const templateJson = template.toJSON();
      const resourceCount = Object.keys(templateJson.Resources || {}).length;

      // Should have EFS file system, access point, security group, mount targets, SSM parameters
      expect(resourceCount).toBeGreaterThanOrEqual(5);
    });

    test("creates exactly one EFS file system", () => {
      template.resourceCountIs("AWS::EFS::FileSystem", 1);
    });

    test("creates exactly one access point", () => {
      template.resourceCountIs("AWS::EFS::AccessPoint", 1);
    });

    test("creates exactly one security group", () => {
      template.resourceCountIs("AWS::EC2::SecurityGroup", 1);
    });
  });

  // ============================================================================
  // SNAPSHOT TESTS
  // ============================================================================
  describe("Snapshots", () => {
    test("MonitoringEfsStack matches snapshot", () => {
      expect(template.toJSON()).toMatchSnapshot();
    });

    test("EFS file system matches snapshot", () => {
      const fileSystems = template.findResources("AWS::EFS::FileSystem");
      expect(fileSystems).toMatchSnapshot();
    });

    test("Access point matches snapshot", () => {
      const accessPoints = template.findResources("AWS::EFS::AccessPoint");
      expect(accessPoints).toMatchSnapshot();
    });
  });
});
