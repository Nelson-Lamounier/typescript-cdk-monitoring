/** @format */

import * as cdk from "aws-cdk-lib";
import * as autoscaling from "aws-cdk-lib/aws-autoscaling";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as efs from "aws-cdk-lib/aws-efs";
import * as logs from "aws-cdk-lib/aws-logs";
import { Annotations, Match, Template } from "aws-cdk-lib/assertions";

import { GrafanaServiceConstruct } from "../../../../../lib/constructs/services/monitoring/grafana";

describe("GrafanaServiceConstruct", () => {
  let app: cdk.App;
  let stack: cdk.Stack;
  let vpc: ec2.Vpc;
  let cluster: ecs.Cluster;

  const mockAdminSecretArn =
    "arn:aws:secretsmanager:eu-west-1:123456789012:secret:grafana-admin-abc123";

  /**
   * Helper function to create a cluster with EC2 capacity for EC2 launch type tests
   */
  const createEc2Cluster = (): ecs.Cluster => {
    const ec2Cluster = new ecs.Cluster(stack, "Ec2Cluster", { vpc });

    const asg = new autoscaling.AutoScalingGroup(stack, "ASG", {
      vpc,
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T3,
        ec2.InstanceSize.MICRO
      ),
      machineImage: ecs.EcsOptimizedImage.amazonLinux2(),
      minCapacity: 1,
      maxCapacity: 1,
    });

    const capacityProvider = new ecs.AsgCapacityProvider(
      stack,
      "CapacityProvider",
      {
        autoScalingGroup: asg,
      }
    );

    ec2Cluster.addAsgCapacityProvider(capacityProvider);

    return ec2Cluster;
  };

  /**
   * Helper to get network configuration for Fargate
   */
  const getFargateNetworkConfig = () => ({
    awsvpcConfiguration: {
      subnets: vpc.privateSubnets.map((s) => s.subnetId),
      securityGroups: [],
    },
  });

  beforeEach(() => {
    app = new cdk.App();
    stack = new cdk.Stack(app, "TestStack", {
      env: { account: "123456789012", region: "eu-west-1" },
    });
    vpc = new ec2.Vpc(stack, "Vpc", { maxAzs: 2 });
    cluster = new ecs.Cluster(stack, "Cluster", { vpc });
  });

  describe("Basic Creation with Fargate", () => {
    test("creates Grafana service with minimal required props", () => {
      new GrafanaServiceConstruct(stack, "Grafana", {
        cluster,
        envName: "dev",
        adminPasswordSecretArn: mockAdminSecretArn,
        launchType: "FARGATE",
        networkConfiguration: getFargateNetworkConfig(),
      });

      const template = Template.fromStack(stack);

      // Should create a Log Group
      template.resourceCountIs("AWS::Logs::LogGroup", 1);
      template.hasResourceProperties("AWS::Logs::LogGroup", {
        LogGroupName: "/ecs/dev-grafana",
        RetentionInDays: 30, // ONE_MONTH default
      });

      // Should create a Task Definition
      template.resourceCountIs("AWS::ECS::TaskDefinition", 1);

      // Should create an ECS Service
      template.resourceCountIs("AWS::ECS::Service", 1);
    });

    test("creates service with project name in log group", () => {
      new GrafanaServiceConstruct(stack, "Grafana", {
        cluster,
        envName: "dev",
        projectName: "monitoring",
        adminPasswordSecretArn: mockAdminSecretArn,
        launchType: "FARGATE",
        networkConfiguration: getFargateNetworkConfig(),
      });

      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::Logs::LogGroup", {
        LogGroupName: "/ecs/monitoring-grafana",
      });
    });

    test("creates service with custom log retention", () => {
      new GrafanaServiceConstruct(stack, "Grafana", {
        cluster,
        envName: "dev",
        adminPasswordSecretArn: mockAdminSecretArn,
        logRetention: logs.RetentionDays.ONE_WEEK,
        launchType: "FARGATE",
        networkConfiguration: getFargateNetworkConfig(),
      });

      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::Logs::LogGroup", {
        RetentionInDays: 7,
      });
    });
  });

  describe("EC2 Launch Type", () => {
    test("creates EC2 service with host path volumes", () => {
      const ec2Cluster = createEc2Cluster();

      new GrafanaServiceConstruct(stack, "Grafana", {
        cluster: ec2Cluster,
        envName: "dev",
        adminPasswordSecretArn: mockAdminSecretArn,
        launchType: "EC2",
        dataVolume: {
          hostPath: "/mnt/grafana/data",
        },
      });

      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::ECS::TaskDefinition", {
        Volumes: Match.arrayWith([
          Match.objectLike({
            Name: "grafana-data",
            Host: {
              SourcePath: "/mnt/grafana/data",
            },
          }),
        ]),
      });
    });
  });

  describe("Fargate Launch Type", () => {
    test("creates Fargate task definition when specified", () => {
      new GrafanaServiceConstruct(stack, "Grafana", {
        cluster,
        envName: "dev",
        adminPasswordSecretArn: mockAdminSecretArn,
        launchType: "FARGATE",
        networkConfiguration: getFargateNetworkConfig(),
      });

      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::ECS::TaskDefinition", {
        RequiresCompatibilities: ["FARGATE"],
        NetworkMode: "awsvpc",
        Cpu: "512",
        Memory: "1024",
      });
    });

    test("adds warning when Fargate is used without network configuration", () => {
      // Use EC2 cluster with capacity to avoid EC2 validation error
      const ec2Cluster = createEc2Cluster();

      new GrafanaServiceConstruct(stack, "Grafana", {
        cluster: ec2Cluster,
        envName: "dev",
        adminPasswordSecretArn: mockAdminSecretArn,
        launchType: "FARGATE",
        // No network configuration provided
      });

      const annotations = Annotations.fromStack(stack);
      annotations.hasWarning(
        "/TestStack/Grafana",
        Match.stringLikeRegexp("Fargate services require awsvpc networking")
      );
    });
  });

  describe("EFS Volume Configuration", () => {
    test("creates service with EFS volumes", () => {
      const fileSystem = new efs.FileSystem(stack, "EfsFileSystem", {
        vpc,
      });

      const accessPoint = new efs.AccessPoint(stack, "EfsAccessPoint", {
        fileSystem,
        path: "/grafana",
        posixUser: { uid: "1000", gid: "1000" },
        createAcl: { ownerUid: "1000", ownerGid: "1000", permissions: "750" },
      });

      new GrafanaServiceConstruct(stack, "Grafana", {
        cluster,
        envName: "dev",
        adminPasswordSecretArn: mockAdminSecretArn,
        launchType: "FARGATE",
        dataVolume: {
          efs: {
            fileSystem,
            accessPoint,
          },
        },
        networkConfiguration: getFargateNetworkConfig(),
      });

      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::ECS::TaskDefinition", {
        Volumes: Match.arrayWith([
          Match.objectLike({
            Name: "grafana-data",
            EFSVolumeConfiguration: Match.objectLike({
              TransitEncryption: "ENABLED",
            }),
          }),
        ]),
      });
    });
  });

  describe("Service Configuration", () => {
    test("creates service with custom desired count", () => {
      new GrafanaServiceConstruct(stack, "Grafana", {
        cluster,
        envName: "dev",
        adminPasswordSecretArn: mockAdminSecretArn,
        launchType: "FARGATE",
        networkConfiguration: getFargateNetworkConfig(),
        desiredCount: 3,
      });

      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::ECS::Service", {
        DesiredCount: 3,
      });
    });

    test("creates service with custom service name", () => {
      new GrafanaServiceConstruct(stack, "Grafana", {
        cluster,
        envName: "dev",
        adminPasswordSecretArn: mockAdminSecretArn,
        launchType: "FARGATE",
        networkConfiguration: getFargateNetworkConfig(),
        serviceName: "custom-grafana-service",
      });

      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::ECS::Service", {
        ServiceName: "custom-grafana-service",
      });
    });

    test("creates service with custom health check grace period", () => {
      new GrafanaServiceConstruct(stack, "Grafana", {
        cluster,
        envName: "dev",
        adminPasswordSecretArn: mockAdminSecretArn,
        launchType: "FARGATE",
        networkConfiguration: getFargateNetworkConfig(),
        healthCheckGracePeriod: cdk.Duration.seconds(300),
      });

      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::ECS::Service", {
        HealthCheckGracePeriodSeconds: 300,
      });
    });

    test("adds warning when desired count is 1", () => {
      new GrafanaServiceConstruct(stack, "Grafana", {
        cluster,
        envName: "dev",
        adminPasswordSecretArn: mockAdminSecretArn,
        launchType: "FARGATE",
        networkConfiguration: getFargateNetworkConfig(),
        desiredCount: 1,
      });

      const annotations = Annotations.fromStack(stack);
      annotations.hasWarning(
        "/TestStack/Grafana",
        Match.stringLikeRegexp("single task")
      );
    });
  });

  describe("Container Configuration", () => {
    test("creates container with default port 3000", () => {
      new GrafanaServiceConstruct(stack, "Grafana", {
        cluster,
        envName: "dev",
        adminPasswordSecretArn: mockAdminSecretArn,
        launchType: "FARGATE",
        networkConfiguration: getFargateNetworkConfig(),
      });

      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::ECS::TaskDefinition", {
        ContainerDefinitions: Match.arrayWith([
          Match.objectLike({
            Name: "grafana",
            PortMappings: Match.arrayWith([
              Match.objectLike({
                ContainerPort: 3000,
              }),
            ]),
          }),
        ]),
      });
    });

    test("creates container with custom port", () => {
      new GrafanaServiceConstruct(stack, "Grafana", {
        cluster,
        envName: "dev",
        adminPasswordSecretArn: mockAdminSecretArn,
        launchType: "FARGATE",
        networkConfiguration: getFargateNetworkConfig(),
        containerPort: 8080,
      });

      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::ECS::TaskDefinition", {
        ContainerDefinitions: Match.arrayWith([
          Match.objectLike({
            Name: "grafana",
            PortMappings: Match.arrayWith([
              Match.objectLike({
                ContainerPort: 8080,
              }),
            ]),
          }),
        ]),
      });
    });

    test("creates container with admin password secret", () => {
      new GrafanaServiceConstruct(stack, "Grafana", {
        cluster,
        envName: "dev",
        adminPasswordSecretArn: mockAdminSecretArn,
        launchType: "FARGATE",
        networkConfiguration: getFargateNetworkConfig(),
      });

      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::ECS::TaskDefinition", {
        ContainerDefinitions: Match.arrayWith([
          Match.objectLike({
            Name: "grafana",
            Secrets: Match.arrayWith([
              Match.objectLike({
                Name: "GF_SECURITY_ADMIN_PASSWORD",
              }),
            ]),
          }),
        ]),
      });
    });

    test("creates container with Grafana environment variables", () => {
      new GrafanaServiceConstruct(stack, "Grafana", {
        cluster,
        envName: "dev",
        adminPasswordSecretArn: mockAdminSecretArn,
        launchType: "FARGATE",
        networkConfiguration: getFargateNetworkConfig(),
      });

      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::ECS::TaskDefinition", {
        ContainerDefinitions: Match.arrayWith([
          Match.objectLike({
            Name: "grafana",
            Environment: Match.arrayWith([
              Match.objectLike({
                Name: "GF_SERVER_SERVE_FROM_SUB_PATH",
                Value: "true",
              }),
              Match.objectLike({
                Name: "GF_USERS_ALLOW_SIGN_UP",
                Value: "false",
              }),
              Match.objectLike({
                Name: "GF_LOG_MODE",
                Value: "console",
              }),
            ]),
          }),
        ]),
      });
    });
  });

  describe("Validation", () => {
    test("throws error when envName is empty", () => {
      expect(() => {
        new GrafanaServiceConstruct(stack, "Grafana", {
          cluster,
          envName: "",
          adminPasswordSecretArn: mockAdminSecretArn,
          launchType: "FARGATE",
          networkConfiguration: getFargateNetworkConfig(),
        });
      }).toThrow();
    });

    test("throws error when adminPasswordSecretArn is missing", () => {
      expect(() => {
        new GrafanaServiceConstruct(stack, "Grafana", {
          cluster,
          envName: "dev",
          adminPasswordSecretArn: "",
          launchType: "FARGATE",
          networkConfiguration: getFargateNetworkConfig(),
        });
      }).toThrow();
    });

    test("throws error when host path volume is used with Fargate", () => {
      expect(() => {
        new GrafanaServiceConstruct(stack, "Grafana", {
          cluster,
          envName: "dev",
          adminPasswordSecretArn: mockAdminSecretArn,
          launchType: "FARGATE",
          networkConfiguration: getFargateNetworkConfig(),
          dataVolume: {
            hostPath: "/mnt/grafana/data",
          },
        });
      }).toThrow("Host path volumes are not supported for Fargate");
    });
  });

  describe("Datasource Provisioning", () => {
    test("generates datasource provisioning YAML for Prometheus", () => {
      const grafana = new GrafanaServiceConstruct(stack, "Grafana", {
        cluster,
        envName: "dev",
        adminPasswordSecretArn: mockAdminSecretArn,
        launchType: "FARGATE",
        networkConfiguration: getFargateNetworkConfig(),
        datasources: [
          {
            name: "Prometheus",
            type: "prometheus",
            url: "http://prometheus:9090",
          },
        ],
      });

      expect(grafana.datasourceProvisioning).toBeDefined();
      expect(grafana.datasourceProvisioning).toContain("apiVersion: 1");
      expect(grafana.datasourceProvisioning).toContain("name: Prometheus");
      expect(grafana.datasourceProvisioning).toContain("type: prometheus");
      expect(grafana.datasourceProvisioning).toContain(
        "url: http://prometheus:9090"
      );
    });

    test("generates datasource provisioning YAML for CloudWatch", () => {
      const grafana = new GrafanaServiceConstruct(stack, "Grafana", {
        cluster,
        envName: "dev",
        adminPasswordSecretArn: mockAdminSecretArn,
        launchType: "FARGATE",
        networkConfiguration: getFargateNetworkConfig(),
        datasources: [
          {
            name: "CloudWatch",
            type: "cloudwatch",
            region: "eu-west-1",
          },
        ],
      });

      expect(grafana.datasourceProvisioning).toBeDefined();
      expect(grafana.datasourceProvisioning).toContain("name: CloudWatch");
      expect(grafana.datasourceProvisioning).toContain("type: cloudwatch");
      expect(grafana.datasourceProvisioning).toContain(
        "defaultRegion: eu-west-1"
      );
    });

    test("returns undefined when no datasources are provided", () => {
      const grafana = new GrafanaServiceConstruct(stack, "Grafana", {
        cluster,
        envName: "dev",
        adminPasswordSecretArn: mockAdminSecretArn,
        launchType: "FARGATE",
        networkConfiguration: getFargateNetworkConfig(),
      });

      expect(grafana.datasourceProvisioning).toBeUndefined();
    });
  });

  describe("Public Properties", () => {
    test("exposes service property", () => {
      const grafana = new GrafanaServiceConstruct(stack, "Grafana", {
        cluster,
        envName: "dev",
        adminPasswordSecretArn: mockAdminSecretArn,
        launchType: "FARGATE",
        networkConfiguration: getFargateNetworkConfig(),
      });

      expect(grafana.service).toBeDefined();
    });

    test("exposes taskDefinition property", () => {
      const grafana = new GrafanaServiceConstruct(stack, "Grafana", {
        cluster,
        envName: "dev",
        adminPasswordSecretArn: mockAdminSecretArn,
        launchType: "FARGATE",
        networkConfiguration: getFargateNetworkConfig(),
      });

      expect(grafana.taskDefinition).toBeDefined();
    });

    test("exposes logGroup property", () => {
      const grafana = new GrafanaServiceConstruct(stack, "Grafana", {
        cluster,
        envName: "dev",
        adminPasswordSecretArn: mockAdminSecretArn,
        launchType: "FARGATE",
        networkConfiguration: getFargateNetworkConfig(),
      });

      expect(grafana.logGroup).toBeDefined();
    });
  });
});
