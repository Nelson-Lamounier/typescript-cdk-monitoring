/** @format */

import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import { Template } from "aws-cdk-lib/assertions";

import { AutoScalingGroupConstruct } from "../../../../../lib/constructs/compute/ecs/auto-scaling-group-construct";
import { LaunchTemplateConstruct } from "../../../../../lib/constructs/compute/launch-template/launch-template-construct";

describe("AutoScalingGroupConstruct", () => {
  let app: cdk.App;
  let stack: cdk.Stack;
  let vpc: ec2.Vpc;
  let cluster: ecs.Cluster;
  let launchTemplate: ec2.ILaunchTemplate;

  beforeEach(() => {
    app = new cdk.App();
    stack = new cdk.Stack(app, "TestStack", {
      env: { account: "123456789012", region: "eu-west-1" },
    });
    vpc = new ec2.Vpc(stack, "Vpc", {
      maxAzs: 2,
    });
    cluster = new ecs.Cluster(stack, "Cluster", { vpc });

    const lt = new LaunchTemplateConstruct(stack, "LaunchTemplate", {
      vpc,
      envName: "test",
      ecsConfig: { clusterName: "test-cluster" },
    });
    launchTemplate = lt.launchTemplate;
  });

  test("creates ASG with provided launch template and capacity settings", () => {
    new AutoScalingGroupConstruct(stack, "Asg", {
      vpc,
      cluster,
      envName: "test",
      projectName: "proj",
      launchTemplate,
      minCapacity: 1,
      maxCapacity: 2,
      desiredCapacity: 1,
    });

    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::AutoScaling::AutoScalingGroup", {
      MinSize: "1",
      MaxSize: "2",
      DesiredCapacity: "1",
    });
  });

  test("attaches capacity provider to cluster", () => {
    new AutoScalingGroupConstruct(stack, "Asg", {
      vpc,
      cluster,
      envName: "test",
      launchTemplate,
      minCapacity: 1,
      maxCapacity: 1,
      desiredCapacity: 1,
    });

    const template = Template.fromStack(stack);
    template.resourceCountIs("AWS::ECS::CapacityProvider", 1);
    template.hasResourceProperties(
      "AWS::ECS::ClusterCapacityProviderAssociations",
      {
        Cluster: { Ref: "ClusterEB0386A7" },
      }
    );
  });

  test("uses provided subnet selection", () => {
    new AutoScalingGroupConstruct(stack, "Asg", {
      vpc,
      cluster,
      envName: "test",
      launchTemplate,
      minCapacity: 1,
      maxCapacity: 1,
      desiredCapacity: 1,
      subnetSelection: { subnetType: ec2.SubnetType.PUBLIC },
    });

    const template = Template.fromStack(stack);
    const asgs = template.findResources("AWS::AutoScaling::AutoScalingGroup");
    const asg = Object.values(asgs)[0] as {
      Properties?: { VPCZoneIdentifier?: unknown };
    };
    expect(asg.Properties?.VPCZoneIdentifier).toBeDefined();
  });

  test("throws when cluster is not concrete", () => {
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
        envName: "test",
        launchTemplate,
        minCapacity: 1,
        maxCapacity: 1,
        desiredCapacity: 1,
      });
    }).toThrow("ECS cluster must be a concrete Cluster");
  });
});
