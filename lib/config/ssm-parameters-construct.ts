/** @format */

import { Construct } from "constructs";
import * as ssm from "aws-cdk-lib/aws-ssm";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as ecs from "aws-cdk-lib/aws-ecs";

export interface SsmParametersConstructProps {
  envName: string;
  vpc: ec2.IVpc;
  repository: ecr.Repository;
  cluster: ecs.ICluster;
  service: ecs.IService;
}

/**
 * Construct that creates SSM Parameters for infrastructure resources
 *
 * This allows other services and pipelines to discover infrastructure
 * resources dynamically without hardcoding values.
 */
export class SsmParametersConstruct extends Construct {
  constructor(
    scope: Construct,
    id: string,
    props: SsmParametersConstructProps
  ) {
    super(scope, id);

    // VPC Parameters
    new ssm.StringParameter(this, "VpcIdParameter", {
      parameterName: `/vpc/${props.envName}/vpc-id`,
      stringValue: props.vpc.vpcId,
      description: `VPC ID for ${props.envName} environment`,
      tier: ssm.ParameterTier.STANDARD,
    });

    // ECR Parameters
    new ssm.StringParameter(this, "RepositoryUriParameter", {
      parameterName: `/ecr/${props.envName}/repository-uri`,
      stringValue: props.repository.repositoryUri,
      description: `ECR Repository URI for ${props.envName} environment`,
      tier: ssm.ParameterTier.STANDARD,
    });

    new ssm.StringParameter(this, "RepositoryArnParameter", {
      parameterName: `/ecr/${props.envName}/repository-arn`,
      stringValue: props.repository.repositoryArn,
      description: `ECR Repository ARN for ${props.envName} environment`,
      tier: ssm.ParameterTier.STANDARD,
    });

    new ssm.StringParameter(this, "RepositoryNameParameter", {
      parameterName: `/ecr/${props.envName}/repository-name`,
      stringValue: props.repository.repositoryName,
      description: `ECR Repository Name for ${props.envName} environment`,
      tier: ssm.ParameterTier.STANDARD,
    });

    // ECS Parameters
    new ssm.StringParameter(this, "EcsClusterNameParameter", {
      parameterName: `/ecs/${props.envName}/cluster-name`,
      stringValue: props.cluster.clusterName,
      description: `ECS Cluster Name for ${props.envName} environment`,
      tier: ssm.ParameterTier.STANDARD,
    });

    new ssm.StringParameter(this, "EcsClusterArnParameter", {
      parameterName: `/ecs/${props.envName}/cluster-arn`,
      stringValue: props.cluster.clusterArn,
      description: `ECS Cluster ARN for ${props.envName} environment`,
      tier: ssm.ParameterTier.STANDARD,
    });

    new ssm.StringParameter(this, "EcsServiceNameParameter", {
      parameterName: `/ecs/${props.envName}/service-name`,
      stringValue: props.service.serviceName,
      description: `ECS Service Name for ${props.envName} environment`,
      tier: ssm.ParameterTier.STANDARD,
    });
  }
}
