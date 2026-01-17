/** @format */
/// <reference types="jest" />

import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import { Template } from "aws-cdk-lib/assertions";

import { AutoScalingGroupConstruct } from "../../../../../lib/constructs/compute/ecs/auto-scaling-group-construct";
import { LaunchTemplateConstruct } from "../../../../../lib/constructs/compute/launch-template/launch-template-construct";
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
    NAME: "test-cluster",
  },
  ASG: {
    MIN_CAPACITY: 1,
    MAX_CAPACITY: 2,
    DESIRED_CAPACITY: 1,
  },
} as const;

describe("AutoScalingGroupConstruct", () => {
  let app: cdk.App;
  let stack: cdk.Stack;
  let vpc: ec2.Vpc;

  beforeAll(() => {
    // Setup for the "throws when cluster is not concrete" test
    app = createTestApp();
    stack = new cdk.Stack(app, "TestStack", {
      env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
    });
    vpc = new ec2.Vpc(stack, "Vpc", {
      maxAzs: BASE_TEST_CONSTANTS.VPC.MAX_AZS,
    });
  });

  test("creates ASG with provided launch template and capacity settings", () => {
    const testApp = createTestApp();
    const testStack = new cdk.Stack(testApp, "AsgTest1", {
      env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
    });
    const testVpc = new ec2.Vpc(testStack, "Vpc", {
      maxAzs: BASE_TEST_CONSTANTS.VPC.MAX_AZS,
    });
    const testCluster = new ecs.Cluster(testStack, "Cluster", { vpc: testVpc });
    const testLt = new LaunchTemplateConstruct(testStack, "LaunchTemplate", {
      vpc: testVpc,
      envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
      ecsConfig: { clusterName: TEST_CONSTANTS.CLUSTER.NAME },
    });

    new AutoScalingGroupConstruct(testStack, "Asg", {
      vpc: testVpc,
      cluster: testCluster,
      envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
      projectName: "proj",
      launchTemplate: testLt.launchTemplate,
      minCapacity: TEST_CONSTANTS.ASG.MIN_CAPACITY,
      maxCapacity: TEST_CONSTANTS.ASG.MAX_CAPACITY,
      desiredCapacity: TEST_CONSTANTS.ASG.DESIRED_CAPACITY,
    });

    const template = Template.fromStack(testStack);
    expect(() => {
      template.hasResourceProperties("AWS::AutoScaling::AutoScalingGroup", {
        MinSize: String(TEST_CONSTANTS.ASG.MIN_CAPACITY),
        MaxSize: String(TEST_CONSTANTS.ASG.MAX_CAPACITY),
        DesiredCapacity: String(TEST_CONSTANTS.ASG.DESIRED_CAPACITY),
      });
    }).not.toThrow();
  });

  test("attaches capacity provider to cluster", () => {
    const testApp = createTestApp();
    const testStack = new cdk.Stack(testApp, "AsgTest2", {
      env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
    });
    const testVpc = new ec2.Vpc(testStack, "Vpc", {
      maxAzs: BASE_TEST_CONSTANTS.VPC.MAX_AZS,
    });
    const testCluster = new ecs.Cluster(testStack, "Cluster", { vpc: testVpc });
    const testLt = new LaunchTemplateConstruct(testStack, "LaunchTemplate", {
      vpc: testVpc,
      envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
      ecsConfig: { clusterName: TEST_CONSTANTS.CLUSTER.NAME },
    });

    new AutoScalingGroupConstruct(testStack, "Asg", {
      vpc: testVpc,
      cluster: testCluster,
      envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
      launchTemplate: testLt.launchTemplate,
      minCapacity: TEST_CONSTANTS.ASG.MIN_CAPACITY,
      maxCapacity: TEST_CONSTANTS.ASG.MIN_CAPACITY,
      desiredCapacity: TEST_CONSTANTS.ASG.MIN_CAPACITY,
    });

    const template = Template.fromStack(testStack);
    expect(() => {
      template.resourceCountIs("AWS::ECS::CapacityProvider", 1);
      template.hasResourceProperties(
        "AWS::ECS::ClusterCapacityProviderAssociations",
        {
          Cluster: { Ref: "ClusterEB0386A7" },
        }
      );
    }).not.toThrow();
  });

  test("uses provided subnet selection", () => {
    const testApp = createTestApp();
    const testStack = new cdk.Stack(testApp, "AsgTest3", {
      env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
    });
    const testVpc = new ec2.Vpc(testStack, "Vpc", {
      maxAzs: BASE_TEST_CONSTANTS.VPC.MAX_AZS,
    });
    const testCluster = new ecs.Cluster(testStack, "Cluster", { vpc: testVpc });
    const testLt = new LaunchTemplateConstruct(testStack, "LaunchTemplate", {
      vpc: testVpc,
      envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
      ecsConfig: { clusterName: TEST_CONSTANTS.CLUSTER.NAME },
    });

    new AutoScalingGroupConstruct(testStack, "Asg", {
      vpc: testVpc,
      cluster: testCluster,
      envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
      launchTemplate: testLt.launchTemplate,
      minCapacity: TEST_CONSTANTS.ASG.MIN_CAPACITY,
      maxCapacity: TEST_CONSTANTS.ASG.MIN_CAPACITY,
      desiredCapacity: TEST_CONSTANTS.ASG.MIN_CAPACITY,
      subnetSelection: { subnetType: ec2.SubnetType.PUBLIC },
    });

    const template = Template.fromStack(testStack);
    const asgs = template.findResources("AWS::AutoScaling::AutoScalingGroup");
    const asg = Object.values(asgs)[0] as {
      Properties?: { VPCZoneIdentifier?: unknown };
    };
    expect(asg.Properties?.VPCZoneIdentifier).toBeDefined();
  });

  test("throws when cluster is not concrete", () => {
    const testLt = new LaunchTemplateConstruct(stack, "LaunchTemplate", {
      vpc,
      envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
      ecsConfig: { clusterName: TEST_CONSTANTS.CLUSTER.NAME },
    });

    const iCluster = ecs.Cluster.fromClusterAttributes(
      stack,
      "ImportedCluster",
      {
        clusterName: "imported",
        vpc,
      }
    );

    expect(() => {
      new AutoScalingGroupConstruct(stack, "Asg", {
        vpc,
        cluster: iCluster,
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        launchTemplate: testLt.launchTemplate,
        minCapacity: TEST_CONSTANTS.ASG.MIN_CAPACITY,
        maxCapacity: TEST_CONSTANTS.ASG.MIN_CAPACITY,
        desiredCapacity: TEST_CONSTANTS.ASG.MIN_CAPACITY,
      });
    }).toThrow("ECS cluster must be a concrete Cluster");
  });
});
