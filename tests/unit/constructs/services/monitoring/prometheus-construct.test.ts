/** @format */

import * as cdk from "aws-cdk-lib";
import * as autoscaling from "aws-cdk-lib/aws-autoscaling";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as efs from "aws-cdk-lib/aws-efs";
import * as logs from "aws-cdk-lib/aws-logs";
import { Annotations, Match, Template } from "aws-cdk-lib/assertions";

import { PrometheusConstruct } from "../../../../../lib/constructs/services/monitoring/prometheus";

describe("PrometheusConstruct", () => {
  let app: cdk.App;
  let stack: cdk.Stack;
  let vpc: ec2.Vpc;
  let cluster: ecs.Cluster;

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

  /**
   * Helper to create EFS file system and access point for testing
   */
  const createEfsVolume = () => {
    const fileSystem = new efs.FileSystem(stack, "EfsFileSystem", {
      vpc,
    });

    const accessPoint = new efs.AccessPoint(stack, "EfsAccessPoint", {
      fileSystem,
      path: "/prometheus",
      posixUser: { uid: "65534", gid: "65534" },
      createAcl: { ownerUid: "65534", ownerGid: "65534", permissions: "750" },
    });

    return { fileSystem, accessPoint };
  };

  beforeEach(() => {
    app = new cdk.App();
    stack = new cdk.Stack(app, "TestStack", {
      env: { account: "123456789012", region: "eu-west-1" },
    });
    vpc = new ec2.Vpc(stack, "Vpc", { maxAzs: 2 });
    cluster = new ecs.Cluster(stack, "Cluster", { vpc });
  });

  describe("Basic Creation with Fargate", () => {
    test("creates Prometheus service with minimal required props", () => {
      const { fileSystem, accessPoint } = createEfsVolume();

      new PrometheusConstruct(stack, "Prometheus", {
        cluster,
        envName: "dev",
        launchType: "FARGATE",
        networkConfiguration: getFargateNetworkConfig(),
        dataVolume: {
          efs: { fileSystem, accessPoint },
        },
      });

      const template = Template.fromStack(stack);

      // Should create a Log Group
      template.resourceCountIs("AWS::Logs::LogGroup", 1);
      template.hasResourceProperties("AWS::Logs::LogGroup", {
        LogGroupName: "/ecs/dev-prometheus",
        RetentionInDays: 30, // ONE_MONTH default
      });

      // Should create a Task Definition
      template.resourceCountIs("AWS::ECS::TaskDefinition", 1);

      // Should create an ECS Service
      template.resourceCountIs("AWS::ECS::Service", 1);
    });

    test("creates service with project name in log group", () => {
      const { fileSystem, accessPoint } = createEfsVolume();

      new PrometheusConstruct(stack, "Prometheus", {
        cluster,
        envName: "dev",
        projectName: "monitoring",
        launchType: "FARGATE",
        networkConfiguration: getFargateNetworkConfig(),
        dataVolume: {
          efs: { fileSystem, accessPoint },
        },
      });

      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::Logs::LogGroup", {
        LogGroupName: "/ecs/monitoring-prometheus",
      });
    });

    test("creates service with custom log retention", () => {
      const { fileSystem, accessPoint } = createEfsVolume();

      new PrometheusConstruct(stack, "Prometheus", {
        cluster,
        envName: "dev",
        launchType: "FARGATE",
        networkConfiguration: getFargateNetworkConfig(),
        logRetention: logs.RetentionDays.ONE_WEEK,
        dataVolume: {
          efs: { fileSystem, accessPoint },
        },
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

      new PrometheusConstruct(stack, "Prometheus", {
        cluster: ec2Cluster,
        envName: "dev",
        launchType: "EC2",
        dataVolume: {
          hostPath: "/mnt/prometheus/data",
        },
        configVolume: {
          hostPath: "/mnt/prometheus/config",
        },
      });

      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::ECS::TaskDefinition", {
        Volumes: Match.arrayWith([
          Match.objectLike({
            Name: "prometheus-data",
            Host: {
              SourcePath: "/mnt/prometheus/data",
            },
          }),
          Match.objectLike({
            Name: "prometheus-config",
            Host: {
              SourcePath: "/mnt/prometheus/config",
            },
          }),
        ]),
      });
    });

    test("uses dataVolume for config when configVolume is not provided", () => {
      const ec2Cluster = createEc2Cluster();

      new PrometheusConstruct(stack, "Prometheus", {
        cluster: ec2Cluster,
        envName: "dev",
        launchType: "EC2",
        dataVolume: {
          hostPath: "/mnt/prometheus/data",
        },
        // No configVolume provided - should use dataVolume path
      });

      const template = Template.fromStack(stack);

      // Both volumes should use the same host path
      template.hasResourceProperties("AWS::ECS::TaskDefinition", {
        Volumes: Match.arrayWith([
          Match.objectLike({
            Name: "prometheus-data",
            Host: {
              SourcePath: "/mnt/prometheus/data",
            },
          }),
          Match.objectLike({
            Name: "prometheus-config",
            Host: {
              SourcePath: "/mnt/prometheus/data",
            },
          }),
        ]),
      });
    });
  });

  describe("Fargate Launch Type", () => {
    test("creates Fargate task definition when specified", () => {
      const { fileSystem, accessPoint } = createEfsVolume();

      new PrometheusConstruct(stack, "Prometheus", {
        cluster,
        envName: "dev",
        launchType: "FARGATE",
        networkConfiguration: getFargateNetworkConfig(),
        dataVolume: {
          efs: { fileSystem, accessPoint },
        },
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
      const { fileSystem, accessPoint } = createEfsVolume();

      new PrometheusConstruct(stack, "Prometheus", {
        cluster: ec2Cluster,
        envName: "dev",
        launchType: "FARGATE",
        dataVolume: {
          efs: { fileSystem, accessPoint },
        },
        // No network configuration provided
      });

      const annotations = Annotations.fromStack(stack);
      annotations.hasWarning(
        "/TestStack/Prometheus",
        Match.stringLikeRegexp("Fargate requires awsvpc networking")
      );
    });
  });

  describe("EFS Volume Configuration", () => {
    test("creates service with EFS volumes and transit encryption", () => {
      const { fileSystem, accessPoint } = createEfsVolume();

      new PrometheusConstruct(stack, "Prometheus", {
        cluster,
        envName: "dev",
        launchType: "FARGATE",
        networkConfiguration: getFargateNetworkConfig(),
        dataVolume: {
          efs: { fileSystem, accessPoint },
        },
      });

      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::ECS::TaskDefinition", {
        Volumes: Match.arrayWith([
          Match.objectLike({
            Name: "prometheus-data",
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
      const { fileSystem, accessPoint } = createEfsVolume();

      new PrometheusConstruct(stack, "Prometheus", {
        cluster,
        envName: "dev",
        launchType: "FARGATE",
        networkConfiguration: getFargateNetworkConfig(),
        dataVolume: {
          efs: { fileSystem, accessPoint },
        },
        desiredCount: 3,
      });

      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::ECS::Service", {
        DesiredCount: 3,
      });
    });

    test("creates service with custom service name", () => {
      const { fileSystem, accessPoint } = createEfsVolume();

      new PrometheusConstruct(stack, "Prometheus", {
        cluster,
        envName: "dev",
        launchType: "FARGATE",
        networkConfiguration: getFargateNetworkConfig(),
        dataVolume: {
          efs: { fileSystem, accessPoint },
        },
        serviceName: "custom-prometheus-service",
      });

      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::ECS::Service", {
        ServiceName: "custom-prometheus-service",
      });
    });

    test("creates service with custom health check grace period", () => {
      const { fileSystem, accessPoint } = createEfsVolume();

      new PrometheusConstruct(stack, "Prometheus", {
        cluster,
        envName: "dev",
        launchType: "FARGATE",
        networkConfiguration: getFargateNetworkConfig(),
        dataVolume: {
          efs: { fileSystem, accessPoint },
        },
        healthCheckGracePeriod: cdk.Duration.seconds(300),
      });

      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::ECS::Service", {
        HealthCheckGracePeriodSeconds: 300,
      });
    });

    test("adds warning when desired count is 1", () => {
      const { fileSystem, accessPoint } = createEfsVolume();

      new PrometheusConstruct(stack, "Prometheus", {
        cluster,
        envName: "dev",
        launchType: "FARGATE",
        networkConfiguration: getFargateNetworkConfig(),
        dataVolume: {
          efs: { fileSystem, accessPoint },
        },
        desiredCount: 1,
      });

      const annotations = Annotations.fromStack(stack);
      annotations.hasWarning(
        "/TestStack/Prometheus",
        Match.stringLikeRegexp("single task")
      );
    });
  });

  describe("Container Configuration", () => {
    test("creates container with default port 9090", () => {
      const { fileSystem, accessPoint } = createEfsVolume();

      new PrometheusConstruct(stack, "Prometheus", {
        cluster,
        envName: "dev",
        launchType: "FARGATE",
        networkConfiguration: getFargateNetworkConfig(),
        dataVolume: {
          efs: { fileSystem, accessPoint },
        },
      });

      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::ECS::TaskDefinition", {
        ContainerDefinitions: Match.arrayWith([
          Match.objectLike({
            Name: "prometheus",
            PortMappings: Match.arrayWith([
              Match.objectLike({
                ContainerPort: 9090,
              }),
            ]),
          }),
        ]),
      });
    });

    test("creates container with custom port", () => {
      const { fileSystem, accessPoint } = createEfsVolume();

      new PrometheusConstruct(stack, "Prometheus", {
        cluster,
        envName: "dev",
        launchType: "FARGATE",
        networkConfiguration: getFargateNetworkConfig(),
        dataVolume: {
          efs: { fileSystem, accessPoint },
        },
        containerPort: 8080,
      });

      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::ECS::TaskDefinition", {
        ContainerDefinitions: Match.arrayWith([
          Match.objectLike({
            Name: "prometheus",
            PortMappings: Match.arrayWith([
              Match.objectLike({
                ContainerPort: 8080,
              }),
            ]),
          }),
        ]),
      });
    });

    test("creates container with environment variables", () => {
      const { fileSystem, accessPoint } = createEfsVolume();

      new PrometheusConstruct(stack, "Prometheus", {
        cluster,
        envName: "dev",
        launchType: "FARGATE",
        networkConfiguration: getFargateNetworkConfig(),
        dataVolume: {
          efs: { fileSystem, accessPoint },
        },
      });

      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::ECS::TaskDefinition", {
        ContainerDefinitions: Match.arrayWith([
          Match.objectLike({
            Name: "prometheus",
            Environment: Match.arrayWith([
              Match.objectLike({
                Name: "ENVIRONMENT",
                Value: "dev",
              }),
            ]),
          }),
        ]),
      });
    });

    test("creates container with command including retention time", () => {
      const { fileSystem, accessPoint } = createEfsVolume();

      new PrometheusConstruct(stack, "Prometheus", {
        cluster,
        envName: "dev",
        launchType: "FARGATE",
        networkConfiguration: getFargateNetworkConfig(),
        dataVolume: {
          efs: { fileSystem, accessPoint },
        },
        retentionTime: "30d",
      });

      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::ECS::TaskDefinition", {
        ContainerDefinitions: Match.arrayWith([
          Match.objectLike({
            Name: "prometheus",
            Command: Match.arrayWith([
              Match.stringLikeRegexp("--storage.tsdb.retention.time=30d"),
            ]),
          }),
        ]),
      });
    });
  });

  describe("Alertmanager Sidecar", () => {
    test("adds Alertmanager container when configured", () => {
      const { fileSystem, accessPoint } = createEfsVolume();

      new PrometheusConstruct(stack, "Prometheus", {
        cluster,
        envName: "dev",
        launchType: "FARGATE",
        networkConfiguration: getFargateNetworkConfig(),
        dataVolume: {
          efs: { fileSystem, accessPoint },
        },
        alertmanager: {
          configContent: "route:\n  receiver: default",
        },
      });

      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::ECS::TaskDefinition", {
        ContainerDefinitions: Match.arrayWith([
          Match.objectLike({
            Name: "prometheus",
          }),
          Match.objectLike({
            Name: "alertmanager",
            PortMappings: Match.arrayWith([
              Match.objectLike({
                ContainerPort: 9093,
              }),
            ]),
          }),
        ]),
      });
    });

    test("uses custom Alertmanager port when specified", () => {
      const { fileSystem, accessPoint } = createEfsVolume();

      new PrometheusConstruct(stack, "Prometheus", {
        cluster,
        envName: "dev",
        launchType: "FARGATE",
        networkConfiguration: getFargateNetworkConfig(),
        dataVolume: {
          efs: { fileSystem, accessPoint },
        },
        alertmanager: {
          port: 9094,
        },
      });

      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::ECS::TaskDefinition", {
        ContainerDefinitions: Match.arrayWith([
          Match.objectLike({
            Name: "alertmanager",
            PortMappings: Match.arrayWith([
              Match.objectLike({
                ContainerPort: 9094,
              }),
            ]),
          }),
        ]),
      });
    });
  });

  describe("Prometheus Configuration", () => {
    test("creates config with custom scrape interval", () => {
      const { fileSystem, accessPoint } = createEfsVolume();

      new PrometheusConstruct(stack, "Prometheus", {
        cluster,
        envName: "dev",
        launchType: "FARGATE",
        networkConfiguration: getFargateNetworkConfig(),
        dataVolume: {
          efs: { fileSystem, accessPoint },
        },
        scrapeInterval: "15s",
      });

      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::ECS::TaskDefinition", {
        ContainerDefinitions: Match.arrayWith([
          Match.objectLike({
            Name: "prometheus",
            Command: Match.arrayWith([
              Match.stringLikeRegexp("scrape_interval: 15s"),
            ]),
          }),
        ]),
      });
    });

    test("creates config with static targets", () => {
      const { fileSystem, accessPoint } = createEfsVolume();

      new PrometheusConstruct(stack, "Prometheus", {
        cluster,
        envName: "dev",
        launchType: "FARGATE",
        networkConfiguration: getFargateNetworkConfig(),
        dataVolume: {
          efs: { fileSystem, accessPoint },
        },
        staticTargets: [
          {
            jobName: "node-exporter",
            targets: ["localhost:9100", "10.0.0.1:9100"],
          },
        ],
      });

      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::ECS::TaskDefinition", {
        ContainerDefinitions: Match.arrayWith([
          Match.objectLike({
            Name: "prometheus",
            Command: Match.arrayWith([
              Match.stringLikeRegexp('job_name: "node-exporter"'),
            ]),
          }),
        ]),
      });
    });
  });

  describe("Validation", () => {
    test("throws error when envName is empty", () => {
      const { fileSystem, accessPoint } = createEfsVolume();

      expect(() => {
        new PrometheusConstruct(stack, "Prometheus", {
          cluster,
          envName: "",
          launchType: "FARGATE",
          networkConfiguration: getFargateNetworkConfig(),
          dataVolume: {
            efs: { fileSystem, accessPoint },
          },
        });
      }).toThrow();
    });

    test("throws error when host path volume is used with Fargate", () => {
      expect(() => {
        new PrometheusConstruct(stack, "Prometheus", {
          cluster,
          envName: "dev",
          launchType: "FARGATE",
          networkConfiguration: getFargateNetworkConfig(),
          dataVolume: {
            hostPath: "/mnt/prometheus/data",
          },
        });
      }).toThrow("Host path volumes are not supported for Fargate");
    });

    test("throws error when config volume uses host path with Fargate", () => {
      const { fileSystem, accessPoint } = createEfsVolume();

      expect(() => {
        new PrometheusConstruct(stack, "Prometheus", {
          cluster,
          envName: "dev",
          launchType: "FARGATE",
          networkConfiguration: getFargateNetworkConfig(),
          dataVolume: {
            efs: { fileSystem, accessPoint },
          },
          configVolume: {
            hostPath: "/mnt/prometheus/config",
          },
        });
      }).toThrow("Host path volumes are not supported for Fargate");
    });
  });

  describe("Public Properties", () => {
    test("exposes service property", () => {
      const { fileSystem, accessPoint } = createEfsVolume();

      const prometheus = new PrometheusConstruct(stack, "Prometheus", {
        cluster,
        envName: "dev",
        launchType: "FARGATE",
        networkConfiguration: getFargateNetworkConfig(),
        dataVolume: {
          efs: { fileSystem, accessPoint },
        },
      });

      expect(prometheus.service).toBeDefined();
    });

    test("exposes taskDefinition property", () => {
      const { fileSystem, accessPoint } = createEfsVolume();

      const prometheus = new PrometheusConstruct(stack, "Prometheus", {
        cluster,
        envName: "dev",
        launchType: "FARGATE",
        networkConfiguration: getFargateNetworkConfig(),
        dataVolume: {
          efs: { fileSystem, accessPoint },
        },
      });

      expect(prometheus.taskDefinition).toBeDefined();
    });

    test("exposes logGroup property", () => {
      const { fileSystem, accessPoint } = createEfsVolume();

      const prometheus = new PrometheusConstruct(stack, "Prometheus", {
        cluster,
        envName: "dev",
        launchType: "FARGATE",
        networkConfiguration: getFargateNetworkConfig(),
        dataVolume: {
          efs: { fileSystem, accessPoint },
        },
      });

      expect(prometheus.logGroup).toBeDefined();
    });
  });
});
