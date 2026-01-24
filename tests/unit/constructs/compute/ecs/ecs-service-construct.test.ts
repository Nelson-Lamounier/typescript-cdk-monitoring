/** @format */
/// <reference types="jest" />

import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import { Template } from "aws-cdk-lib/assertions";

import { EcsServiceConstruct } from "../../../../../lib/constructs/compute/ecs/ecs-service-construct";
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
    CPU: 256,
    MEMORY_MIB: 512,
    CONTAINER_MEMORY_RESERVATION_MIB: 256,
    CONTAINER_IMAGE: "amazon/amazon-ecs-sample",
    CONTAINER_NAME: "app",
  },
  SERVICE: {
    DESIRED_COUNT: 2,
    MIN_HEALTHY_PERCENT: 100,
    MAX_PERCENT: 200,
    INVALID_DESIRED_COUNT: 0,
  },
  ALARM: {
    CPU_THRESHOLD: 80,
  },
  NETWORK: {
    ASSIGN_PUBLIC_IP: "ENABLED" as const,
  },
} as const;

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Create test infrastructure (VPC, Cluster, TaskDefinition)
 * Each test needs its own isolated infrastructure
 */
function createTestInfrastructure(stack: cdk.Stack) {
  const vpc = new ec2.Vpc(stack, "Vpc", {
    maxAzs: BASE_TEST_CONSTANTS.VPC.MAX_AZS,
  });
  const cluster = new ecs.Cluster(stack, "Cluster", { vpc });
  const taskDef = new ecs.FargateTaskDefinition(stack, "TaskDef", {
    cpu: TEST_CONSTANTS.TASK_DEF.CPU,
    memoryLimitMiB: TEST_CONSTANTS.TASK_DEF.MEMORY_MIB,
  });
  taskDef.addContainer(TEST_CONSTANTS.TASK_DEF.CONTAINER_NAME, {
    image: ecs.ContainerImage.fromRegistry(TEST_CONSTANTS.TASK_DEF.CONTAINER_IMAGE),
    memoryReservationMiB: TEST_CONSTANTS.TASK_DEF.CONTAINER_MEMORY_RESERVATION_MIB,
  });

  return { vpc, cluster, taskDef };
}

describe("EcsServiceConstruct", () => {
  test("creates service with defaults and tags", () => {
    const app = createTestApp();
    const stack = new cdk.Stack(app, "TestStack", {
      env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
    });
    const { cluster, taskDef } = createTestInfrastructure(stack);

    new EcsServiceConstruct(stack, "ServiceConstruct", {
      cluster,
      taskDefinition: taskDef,
      envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
      projectName: "proj",
      desiredCount: TEST_CONSTANTS.SERVICE.DESIRED_COUNT,
    });

    const template = Template.fromStack(stack);

    expect(() => {
      template.resourceCountIs("AWS::ECS::Service", 1);
      template.hasResourceProperties("AWS::ECS::Service", {
        DesiredCount: TEST_CONSTANTS.SERVICE.DESIRED_COUNT,
        DeploymentConfiguration: {
          MinimumHealthyPercent: TEST_CONSTANTS.SERVICE.MIN_HEALTHY_PERCENT,
          MaximumPercent: TEST_CONSTANTS.SERVICE.MAX_PERCENT,
        },
      });
    }).not.toThrow();
  });

  test("supports Fargate service creation with network settings", () => {
    const app = createTestApp();
    const stack = new cdk.Stack(app, "TestStack", {
      env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
    });
    const { vpc, cluster, taskDef } = createTestInfrastructure(stack);

    new EcsServiceConstruct(stack, "FargateService", {
      cluster,
      taskDefinition: taskDef,
      envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
      launchType: "FARGATE",
      desiredCount: 1,
      networkConfiguration: {
        awsvpcConfiguration: {
          assignPublicIp: TEST_CONSTANTS.NETWORK.ASSIGN_PUBLIC_IP,
          securityGroups: [],
          subnets: vpc.publicSubnets.map((s) => s.subnetId),
        },
      },
    });

    const template = Template.fromStack(stack);

    expect(() => {
      template.hasResourceProperties("AWS::ECS::Service", {
        LaunchType: "FARGATE",
        NetworkConfiguration: {
          AwsvpcConfiguration: {
            AssignPublicIp: TEST_CONSTANTS.NETWORK.ASSIGN_PUBLIC_IP,
          },
        },
      });
    }).not.toThrow();
  });

  test("creates alarms when configured", () => {
    const app = createTestApp();
    const stack = new cdk.Stack(app, "TestStack", {
      env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
    });
    const { cluster, taskDef } = createTestInfrastructure(stack);

    new EcsServiceConstruct(stack, "ServiceWithAlarms", {
      cluster,
      taskDefinition: taskDef,
      envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
      desiredCount: 1,
      alarmConfig: {
        enabled: true,
        cpuThreshold: TEST_CONSTANTS.ALARM.CPU_THRESHOLD,
      },
    });

    const template = Template.fromStack(stack);
    expect(() => {
      template.resourceCountIs("AWS::CloudWatch::Alarm", 1);
    }).not.toThrow();
  });

  test("throws when desiredCount is invalid", () => {
    const app = createTestApp();
    const stack = new cdk.Stack(app, "TestStack", {
      env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
    });
    const { cluster, taskDef } = createTestInfrastructure(stack);

    expect(() => {
      new EcsServiceConstruct(stack, "InvalidService", {
        cluster,
        taskDefinition: taskDef,
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        desiredCount: TEST_CONSTANTS.SERVICE.INVALID_DESIRED_COUNT,
      });
    }).toThrow("Desired count must be greater than 0");
  });
});
