/** @format */

import * as cdk from "aws-cdk-lib";
import * as autoscaling from "aws-cdk-lib/aws-autoscaling";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import { Construct } from "constructs";

import {
  DEFAULT_ASG_DESIRED_CAPACITY,
  DEFAULT_ASG_HEALTH_GRACE_SECONDS,
  DEFAULT_ASG_MAX_CAPACITY,
  DEFAULT_ASG_MIN_CAPACITY,
  DEFAULT_ASG_UPDATE_MAX_BATCH_SIZE,
  DEFAULT_ASG_UPDATE_MIN_IN_SERVICE,
  DEFAULT_ASG_UPDATE_PAUSE_TIME_SECONDS,
} from "../../../shared/constants/compute-constants";
import { AutoScalingGroupConstructProps } from "../../../shared/types/compute-types";
import {
  validateCapacityOrder,
  validateClusterProvided,
  validateEnvName,
  validateVpcIdPresent,
} from "../../../shared/utils/validation";

/**
 * Construct for creating an Auto Scaling Group for ECS with monitoring-specific configuration
 */
export class AutoScalingGroupConstruct extends Construct {
  public readonly autoScalingGroup: autoscaling.AutoScalingGroup;
  public readonly launchTemplate: ec2.ILaunchTemplate;

  constructor(
    scope: Construct,
    id: string,
    props: AutoScalingGroupConstructProps
  ) {
    super(scope, id);

    const {
      vpc,
      cluster,
      envName,
      projectName,
      launchTemplate,
      minCapacity = DEFAULT_ASG_MIN_CAPACITY,
      maxCapacity = DEFAULT_ASG_MAX_CAPACITY,
      desiredCapacity = DEFAULT_ASG_DESIRED_CAPACITY,
      subnetSelection,
      enableManagedScaling = true,
      enableManagedTerminationProtection = false,
      healthCheckGraceSeconds = DEFAULT_ASG_HEALTH_GRACE_SECONDS,
      updateMaxBatchSize = DEFAULT_ASG_UPDATE_MAX_BATCH_SIZE,
      updateMinInstancesInService = DEFAULT_ASG_UPDATE_MIN_IN_SERVICE,
      updatePauseTimeSeconds = DEFAULT_ASG_UPDATE_PAUSE_TIME_SECONDS,
    } = props;

    validateEnvName(envName);
    validateClusterProvided(cluster);
    validateVpcIdPresent(vpc);
    validateCapacityOrder(minCapacity, desiredCapacity, maxCapacity);

    this.launchTemplate = launchTemplate;

    // Create Auto Scaling Group
    this.autoScalingGroup = new autoscaling.AutoScalingGroup(this, "EcsAsg", {
      vpc,
      launchTemplate: this.launchTemplate,
      minCapacity,
      maxCapacity,
      desiredCapacity,
      vpcSubnets: {
        ...(subnetSelection ?? {
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        }),
      },
      healthChecks: autoscaling.HealthChecks.ec2({
        gracePeriod: cdk.Duration.seconds(healthCheckGraceSeconds),
      }),
      updatePolicy: autoscaling.UpdatePolicy.rollingUpdate({
        maxBatchSize: updateMaxBatchSize,
        minInstancesInService: updateMinInstancesInService,
        pauseTime: cdk.Duration.seconds(updatePauseTimeSeconds),
      }),
    });

    const capacityProvider = new ecs.AsgCapacityProvider(
      this,
      "CapacityProvider",
      {
        autoScalingGroup: this.autoScalingGroup,
        enableManagedScaling,
        enableManagedTerminationProtection,
      }
    );

    if (ecs.Cluster.isCluster(cluster)) {
      cluster.addAsgCapacityProvider(capacityProvider);
    } else {
      throw new Error(
        "ECS cluster must be a concrete Cluster to attach an ASG capacity provider."
      );
    }

    // Add tags
    cdk.Tags.of(this.autoScalingGroup).add("Name", `${envName}-asg`);
    cdk.Tags.of(this.autoScalingGroup).add("Environment", envName);
    cdk.Tags.of(this.autoScalingGroup).add("ManagedBy", "CDK");
    if (projectName) {
      cdk.Tags.of(this.autoScalingGroup).add("Project", projectName);
    }

    // Output Auto Scaling Group information
    new cdk.CfnOutput(this, "AutoScalingGroupName", {
      value: this.autoScalingGroup.autoScalingGroupName,
      description: `Auto Scaling Group name for ${envName}`,
      exportName: `${cdk.Stack.of(this).stackName}-asg-name`,
    });
  }
}
