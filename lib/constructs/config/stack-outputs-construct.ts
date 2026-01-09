/** @format */

import { Construct } from "constructs";
import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as ecs from "aws-cdk-lib/aws-ecs";

export interface StackOutputsConstructProps {
  envName: string;
  vpc: ec2.IVpc;
  repository: ecr.Repository;
  cluster: ecs.ICluster;
  service: ecs.IService;
}

/**
 * Construct that creates CloudFormation Outputs for infrastructure resources
 *
 * These outputs are visible in the CloudFormation console and can be
 * referenced by other stacks or external tools.
 */
export class StackOutputsConstruct extends Construct {
  constructor(scope: Construct, id: string, props: StackOutputsConstructProps) {
    super(scope, id);

    // VPC Outputs
    new cdk.CfnOutput(this, "VpcId", {
      value: props.vpc.vpcId,
      description: "VPC ID",
      exportName: `${props.envName}-vpc-id`,
    });

    new cdk.CfnOutput(this, "VpcCidr", {
      value: props.vpc.vpcCidrBlock,
      description: "VPC CIDR Block",
      exportName: `${props.envName}-vpc-cidr`,
    });

    // ECR Outputs
    new cdk.CfnOutput(this, "RepositoryUri", {
      value: props.repository.repositoryUri,
      description: "ECR Repository URI",
      exportName: `${props.envName}-ecr-repository-uri`,
    });

    new cdk.CfnOutput(this, "RepositoryArn", {
      value: props.repository.repositoryArn,
      description: "ECR Repository ARN",
      exportName: `${props.envName}-ecr-repository-arn`,
    });

    new cdk.CfnOutput(this, "RepositoryName", {
      value: props.repository.repositoryName,
      description: "ECR Repository Name",
      exportName: `${props.envName}-ecr-repository-name`,
    });

    // ECS Outputs
    new cdk.CfnOutput(this, "EcsClusterName", {
      value: props.cluster.clusterName,
      description: "ECS Cluster Name",
      exportName: `${props.envName}-ecs-cluster-name`,
    });

    new cdk.CfnOutput(this, "EcsClusterArn", {
      value: props.cluster.clusterArn,
      description: "ECS Cluster ARN",
      exportName: `${props.envName}-ecs-cluster-arn`,
    });

    new cdk.CfnOutput(this, "EcsServiceName", {
      value: props.service.serviceName,
      description: "ECS Service Name",
      exportName: `${props.envName}-ecs-service-name`,
    });
  }
}
