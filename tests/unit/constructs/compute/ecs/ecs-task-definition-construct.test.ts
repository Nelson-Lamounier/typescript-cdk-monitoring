/** @format */

import * as cdk from "aws-cdk-lib";
import * as ecs from "aws-cdk-lib/aws-ecs";
import { Template } from "aws-cdk-lib/assertions";

import { EcsTaskDefinitionConstruct } from "../../../../../lib/constructs/compute/ecs/ecs-task-definition-construct";

describe("EcsTaskDefinitionConstruct", () => {
  let app: cdk.App;
  let stack: cdk.Stack;

  beforeEach(() => {
    app = new cdk.App();
    stack = new cdk.Stack(app, "TestStack", {
      env: { account: "123456789012", region: "eu-west-1" },
    });
  });

  test("creates EC2 task definition with container and logging", () => {
    new EcsTaskDefinitionConstruct(stack, "Task", {
      envName: "dev",
      launchType: "EC2",
      taskDefinition: undefined as unknown as ecs.TaskDefinition, // not used for creation
      containers: [
        {
          name: "app",
          image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
          containerPort: 8080,
          logStreamPrefix: "app",
        },
      ],
    });

    const template = Template.fromStack(stack);

    template.resourceCountIs("AWS::ECS::TaskDefinition", 1);
    template.hasResourceProperties("AWS::ECS::TaskDefinition", {
      NetworkMode: "bridge",
      ContainerDefinitions: [
        {
          Name: "app",
          LogConfiguration: {
            LogDriver: "awslogs",
          },
        },
      ],
    });
  });

  test("creates Fargate task definition when launchType is FARGATE", () => {
    new EcsTaskDefinitionConstruct(stack, "FargateTask", {
      envName: "dev",
      launchType: "FARGATE",
      containers: [
        {
          name: "api",
          image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
        },
      ],
      cpu: 256,
      memoryMiB: 512,
    });

    const template = Template.fromStack(stack);

    template.hasResourceProperties("AWS::ECS::TaskDefinition", {
      Cpu: "256",
      Memory: "512",
      RequiresCompatibilities: ["FARGATE"],
      NetworkMode: "awsvpc",
    });
  });

  test("throws when Fargate CPU/memory not provided", () => {
    expect(() => {
      new EcsTaskDefinitionConstruct(stack, "InvalidFargate", {
        envName: "dev",
        launchType: "FARGATE",
        containers: [
          {
            name: "api",
            image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
          },
        ],
      });
    }).toThrow("Fargate tasks require both cpu and memoryMiB");
  });
});
