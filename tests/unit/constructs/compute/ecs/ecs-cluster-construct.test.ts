/** @format */

import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { Template } from "aws-cdk-lib/assertions";

import { EcsClusterConstruct } from "../../../../../lib/constructs/compute/ecs/ecs-cluster-construct";

describe("EcsClusterConstruct", () => {
  let app: cdk.App;
  let stack: cdk.Stack;
  let vpc: ec2.Vpc;

  beforeEach(() => {
    app = new cdk.App();
    stack = new cdk.Stack(app, "TestStack", {
      env: { account: "123456789012", region: "eu-west-1" },
    });
    vpc = new ec2.Vpc(stack, "Vpc", { maxAzs: 2 });
  });

  test("creates cluster, log group, ASG and capacity provider with defaults", () => {
    new EcsClusterConstruct(stack, "ClusterConstruct", {
      vpc,
      envName: "dev",
      projectName: "proj",
    });

    const template = Template.fromStack(stack);

    template.resourceCountIs("AWS::ECS::Cluster", 1);
    template.resourceCountIs("AWS::Logs::LogGroup", 1);
    template.resourceCountIs("AWS::AutoScaling::AutoScalingGroup", 1);
    template.resourceCountIs("AWS::ECS::CapacityProvider", 1);

    template.hasResourceProperties("AWS::Logs::LogGroup", {
      LogGroupName: "/aws/ecs/cluster/dev-cluster",
    });

    template.hasResourceProperties("AWS::AutoScaling::AutoScalingGroup", {
      MinSize: "1",
      MaxSize: "2",
      DesiredCapacity: "1",
    });
  });

  test("throws when capacity ordering is invalid", () => {
    expect(() => {
      new EcsClusterConstruct(stack, "InvalidCapacity", {
        vpc,
        envName: "dev",
        minCapacity: 3,
        maxCapacity: 2,
        desiredCapacity: 2,
      });
    }).toThrow("Minimum capacity cannot exceed desired capacity");
  });
});
