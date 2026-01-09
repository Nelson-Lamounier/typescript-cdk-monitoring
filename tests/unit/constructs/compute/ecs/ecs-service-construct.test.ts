/** @format */

import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import { Template } from "aws-cdk-lib/assertions";

import { EcsServiceConstruct } from "../../../../../lib/constructs/compute/ecs/ecs-service-construct";

describe("EcsServiceConstruct", () => {
  let app: cdk.App;
  let stack: cdk.Stack;
  let vpc: ec2.Vpc;
  let cluster: ecs.Cluster;
  let taskDef: ecs.FargateTaskDefinition;

  beforeEach(() => {
    app = new cdk.App();
    stack = new cdk.Stack(app, "TestStack", {
      env: { account: "123456789012", region: "eu-west-1" },
    });
    vpc = new ec2.Vpc(stack, "Vpc", { maxAzs: 2 });
    cluster = new ecs.Cluster(stack, "Cluster", { vpc });
    taskDef = new ecs.FargateTaskDefinition(stack, "TaskDef", {
      cpu: 256,
      memoryLimitMiB: 512,
    });
    taskDef.addContainer("app", {
      image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
      memoryReservationMiB: 256,
    });
  });

  test("creates service with defaults and tags", () => {
    new EcsServiceConstruct(stack, "ServiceConstruct", {
      cluster,
      taskDefinition: taskDef,
      envName: "dev",
      projectName: "proj",
      desiredCount: 2,
    });

    const template = Template.fromStack(stack);

    template.resourceCountIs("AWS::ECS::Service", 1);
    template.hasResourceProperties("AWS::ECS::Service", {
      DesiredCount: 2,
      DeploymentConfiguration: {
        MinimumHealthyPercent: 100,
        MaximumPercent: 200,
      },
    });
  });

  test("supports Fargate service creation with network settings", () => {
    new EcsServiceConstruct(stack, "FargateService", {
      cluster,
      taskDefinition: taskDef,
      envName: "dev",
      launchType: "FARGATE",
      desiredCount: 1,
      networkConfiguration: {
        awsvpcConfiguration: {
          assignPublicIp: "ENABLED",
          securityGroups: [],
          subnets: vpc.publicSubnets.map((s) => s.subnetId),
        },
      },
    });

    const template = Template.fromStack(stack);

    template.hasResourceProperties("AWS::ECS::Service", {
      LaunchType: "FARGATE",
      NetworkConfiguration: {
        AwsvpcConfiguration: {
          AssignPublicIp: "ENABLED",
        },
      },
    });
  });

  test("creates alarms when configured", () => {
    new EcsServiceConstruct(stack, "ServiceWithAlarms", {
      cluster,
      taskDefinition: taskDef,
      envName: "dev",
      desiredCount: 1,
      alarmConfig: {
        enabled: true,
        cpuThreshold: 80,
      },
    });

    const template = Template.fromStack(stack);
    template.resourceCountIs("AWS::CloudWatch::Alarm", 1);
  });

  test("throws when desiredCount is invalid", () => {
    expect(() => {
      new EcsServiceConstruct(stack, "InvalidService", {
        cluster,
        taskDefinition: taskDef,
        envName: "dev",
        desiredCount: 0,
      });
    }).toThrow("Desired count must be greater than 0");
  });
});
