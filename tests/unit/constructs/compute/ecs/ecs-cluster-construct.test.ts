/** @format */
/// <reference types="jest" />

import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { Template } from "aws-cdk-lib/assertions";

import { EcsClusterConstruct } from "../../../../../lib/constructs/compute/ecs/ecs-cluster-construct";
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
  CLUSTER: {
    MIN_CAPACITY: 1,
    MAX_CAPACITY: 2,
    DESIRED_CAPACITY: 1,
    INVALID_MIN: 3,
    INVALID_MAX: 2,
    INVALID_DESIRED: 2,
  },
  LOG_GROUP: {
    NAME_PREFIX: "/aws/ecs/cluster/",
  },
} as const;

describe("EcsClusterConstruct", () => {
  test("creates cluster, log group, ASG and capacity provider with defaults", () => {
    const app = createTestApp();
    const stack = new cdk.Stack(app, "TestStack", {
      env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
    });
    const vpc = new ec2.Vpc(stack, "Vpc", {
      maxAzs: BASE_TEST_CONSTANTS.VPC.MAX_AZS,
    });

    new EcsClusterConstruct(stack, "ClusterConstruct", {
      vpc,
      envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
      projectName: "proj",
    });

    const template = Template.fromStack(stack);

    expect(() => {
      template.resourceCountIs("AWS::ECS::Cluster", 1);
      template.resourceCountIs("AWS::Logs::LogGroup", 1);
      template.resourceCountIs("AWS::AutoScaling::AutoScalingGroup", 1);
      template.resourceCountIs("AWS::ECS::CapacityProvider", 1);

      template.hasResourceProperties("AWS::Logs::LogGroup", {
        LogGroupName: `${TEST_CONSTANTS.LOG_GROUP.NAME_PREFIX}${TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT}-cluster`,
      });

      template.hasResourceProperties("AWS::AutoScaling::AutoScalingGroup", {
        MinSize: String(TEST_CONSTANTS.CLUSTER.MIN_CAPACITY),
        MaxSize: String(TEST_CONSTANTS.CLUSTER.MAX_CAPACITY),
        DesiredCapacity: String(TEST_CONSTANTS.CLUSTER.DESIRED_CAPACITY),
      });
    }).not.toThrow();
  });

  test("throws when capacity ordering is invalid", () => {
    const app = createTestApp();
    const stack = new cdk.Stack(app, "TestStack", {
      env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
    });
    const vpc = new ec2.Vpc(stack, "Vpc", {
      maxAzs: BASE_TEST_CONSTANTS.VPC.MAX_AZS,
    });

    expect(() => {
      new EcsClusterConstruct(stack, "InvalidCapacity", {
        vpc,
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        minCapacity: TEST_CONSTANTS.CLUSTER.INVALID_MIN,
        maxCapacity: TEST_CONSTANTS.CLUSTER.INVALID_MAX,
        desiredCapacity: TEST_CONSTANTS.CLUSTER.INVALID_DESIRED,
      });
    }).toThrow("Minimum capacity cannot exceed desired capacity");
  });
});
