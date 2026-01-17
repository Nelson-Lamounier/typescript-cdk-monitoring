/** @format */
/// <reference types="jest" />

import * as cdk from "aws-cdk-lib";
import * as ecs from "aws-cdk-lib/aws-ecs";
import { Template } from "aws-cdk-lib/assertions";

import { EcsTaskDefinitionConstruct } from "../../../../../lib/constructs/compute/ecs/ecs-task-definition-construct";
import {
  TEST_CONFIG,
  BASE_TEST_CONSTANTS,
  createTestApp,
  extendExpectWithCdkMatchers,
} from "../../../utils/stack-test-utils";

// ============================================================================
// CUSTOM MATCHERS SETUP
// ============================================================================

extendExpectWithCdkMatchers();

// ============================================================================
// TEST CONFIGURATION
// ============================================================================

const TEST_CONSTANTS = {
  ...BASE_TEST_CONSTANTS,
  TASK_DEF: {
    EC2: {
      LAUNCH_TYPE: "EC2" as const,
      NETWORK_MODE: "bridge",
      CONTAINER_NAME: "app",
      CONTAINER_PORT: 8080,
      LOG_STREAM_PREFIX: "app",
    },
    FARGATE: {
      LAUNCH_TYPE: "FARGATE" as const,
      NETWORK_MODE: "awsvpc",
      CONTAINER_NAME: "api",
      CPU: "256",
      MEMORY_MIB: "512",
      CPU_NUMBER: 256,
      MEMORY_MIB_NUMBER: 512,
      REQUIRES_COMPATIBILITIES: ["FARGATE"],
    },
    IMAGE: "amazon/amazon-ecs-sample",
    LOG_DRIVER: "awslogs",
  },
} as const;

describe("EcsTaskDefinitionConstruct", () => {
  test("creates EC2 task definition with container and logging", () => {
    const app = createTestApp();
    const stack = new cdk.Stack(app, "TestStack", {
      env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
    });

    new EcsTaskDefinitionConstruct(stack, "Task", {
      envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
      launchType: TEST_CONSTANTS.TASK_DEF.EC2.LAUNCH_TYPE,
      containers: [
        {
          name: TEST_CONSTANTS.TASK_DEF.EC2.CONTAINER_NAME,
          image: ecs.ContainerImage.fromRegistry(TEST_CONSTANTS.TASK_DEF.IMAGE),
          containerPort: TEST_CONSTANTS.TASK_DEF.EC2.CONTAINER_PORT,
          logStreamPrefix: TEST_CONSTANTS.TASK_DEF.EC2.LOG_STREAM_PREFIX,
        },
      ],
    });

    const template = Template.fromStack(stack);

    expect(() => {
      template.resourceCountIs("AWS::ECS::TaskDefinition", 1);
      template.hasResourceProperties("AWS::ECS::TaskDefinition", {
        NetworkMode: TEST_CONSTANTS.TASK_DEF.EC2.NETWORK_MODE,
        ContainerDefinitions: [
          {
            Name: TEST_CONSTANTS.TASK_DEF.EC2.CONTAINER_NAME,
            LogConfiguration: {
              LogDriver: TEST_CONSTANTS.TASK_DEF.LOG_DRIVER,
            },
          },
        ],
      });
    }).not.toThrow();
  });

  test("creates Fargate task definition when launchType is FARGATE", () => {
    const app = createTestApp();
    const stack = new cdk.Stack(app, "TestStack", {
      env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
    });

    new EcsTaskDefinitionConstruct(stack, "FargateTask", {
      envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
      launchType: TEST_CONSTANTS.TASK_DEF.FARGATE.LAUNCH_TYPE,
      containers: [
        {
          name: TEST_CONSTANTS.TASK_DEF.FARGATE.CONTAINER_NAME,
          image: ecs.ContainerImage.fromRegistry(TEST_CONSTANTS.TASK_DEF.IMAGE),
        },
      ],
      cpu: TEST_CONSTANTS.TASK_DEF.FARGATE.CPU_NUMBER,
      memoryMiB: TEST_CONSTANTS.TASK_DEF.FARGATE.MEMORY_MIB_NUMBER,
    });

    const template = Template.fromStack(stack);

    expect(() => {
      template.hasResourceProperties("AWS::ECS::TaskDefinition", {
        Cpu: TEST_CONSTANTS.TASK_DEF.FARGATE.CPU,
        Memory: TEST_CONSTANTS.TASK_DEF.FARGATE.MEMORY_MIB,
        RequiresCompatibilities: TEST_CONSTANTS.TASK_DEF.FARGATE.REQUIRES_COMPATIBILITIES,
        NetworkMode: TEST_CONSTANTS.TASK_DEF.FARGATE.NETWORK_MODE,
      });
    }).not.toThrow();
  });

  test("throws when Fargate CPU/memory not provided", () => {
    const app = createTestApp();
    const stack = new cdk.Stack(app, "TestStack", {
      env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
    });

    expect(() => {
      new EcsTaskDefinitionConstruct(stack, "InvalidFargate", {
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        launchType: TEST_CONSTANTS.TASK_DEF.FARGATE.LAUNCH_TYPE,
        containers: [
          {
            name: TEST_CONSTANTS.TASK_DEF.FARGATE.CONTAINER_NAME,
            image: ecs.ContainerImage.fromRegistry(TEST_CONSTANTS.TASK_DEF.IMAGE),
          },
        ],
      });
    }).toThrow("Fargate tasks require both cpu and memoryMiB");
  });
});
