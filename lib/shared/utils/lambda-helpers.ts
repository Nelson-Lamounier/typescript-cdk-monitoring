/** @format */

import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as cr from "aws-cdk-lib/custom-resources";
import { Construct } from "constructs";
import { NagSuppressions } from "cdk-nag";

import { LambdaFunctionConstruct } from "../../constructs/compute/lambda";

/**
 * Common IAM policy statements for VPC peering Lambda functions
 */
export interface VpcPeeringLambdaPolicy {
  /**
   * Policy statements to add to the Lambda function
   */
  statements: iam.PolicyStatement[];
}

/**
 * Create a custom resource provider for VPC peering operations
 *
 * This helper reduces duplication between createPeeringProvider and
 * createUpdateRoutesProvider by extracting common logic.
 *
 * @param scope - Construct scope
 * @param id - Logical ID for the provider
 * @param handlerPath - Path to Lambda handler file
 * @param functionName - Name for the Lambda function
 * @param peerRoleArn - IAM role ARN in peer account
 * @param timeoutSeconds - Lambda timeout in seconds
 * @param additionalPolicies - Additional IAM policy statements
 * @returns Custom resource provider
 */
export function createVpcPeeringProvider(
  scope: Construct,
  id: string,
  handlerPath: string,
  functionName: string,
  peerRoleArn: string,
  timeoutSeconds: number = 60,
  additionalPolicies: iam.PolicyStatement[] = []
): cr.Provider {
  // Base policy statements required for all VPC peering operations
  const basePolicies: iam.PolicyStatement[] = [
    // Permission to assume role in peer account
    new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ["sts:AssumeRole"],
      resources: [peerRoleArn],
    }),
    ...additionalPolicies,
  ];

  const lambdaFunction = new LambdaFunctionConstruct(scope, `${id}Lambda`, {
    envName: "vpc-peering",
    functionName,
    entry: handlerPath,
    timeout: cdk.Duration.seconds(timeoutSeconds),
    initialPolicy: basePolicies,
  });

  // Add CDK Nag suppressions for required wildcard permissions
  // VPC peering operations require broad EC2 permissions because
  // resource IDs are not known at deploy time
  if (additionalPolicies.some((p) => p.actions?.includes("ec2:*"))) {
    NagSuppressions.addResourceSuppressions(
      lambdaFunction.function,
      [
        {
          id: "AwsSolutions-IAM5",
          reason:
            "VPC peering Lambda requires ec2:* permissions because peering connection IDs are not known at deploy time",
        },
      ],
      true
    );
  }

  const provider = new cr.Provider(scope, id, {
    onEventHandler: lambdaFunction.function,
  });

  // Add standard CDK Nag suppressions for custom resource providers
  NagSuppressions.addResourceSuppressions(
    provider,
    [
      {
        id: "AwsSolutions-IAM4",
        reason:
          "Custom Resource Provider framework uses AWSLambdaBasicExecutionRole for CloudWatch Logs access",
        appliesTo: [
          "Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
        ],
      },
      {
        id: "AwsSolutions-IAM5",
        reason:
          "Custom Resource Provider requires invoke permissions on handler Lambda with all versions",
      },
      {
        id: "AwsSolutions-L1",
        reason:
          "Custom Resource Provider framework Lambda runtime is managed by CDK",
      },
    ],
    true
  );

  return provider;
}
