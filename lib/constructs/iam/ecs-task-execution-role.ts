/** @format */

import { Construct } from "constructs";
import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import { NagSuppressions } from "cdk-nag";

import { SuppressionManager } from "../../cdk-nag";

export interface EcsTaskExecutionRoleProps {
  envName: string;
  enablePublicEcr?: boolean;
  logGroupArn?: string;
  /**
   * List of Secrets Manager secret ARNs that the task needs to access
   * If not provided, grants access to all secrets in the account (less restrictive)
   */
  secretArns?: string[];
}

/**
 * Centralised ECS Task Execution Role Construct
 *
 * Creates an IAM role for ECS tasks with:
 * - ECR image pull permissions (private or public)
 * - CloudWatch Logs permissions
 * - Secrets Manager permissions (for container secrets)
 * - Optional public ECR access
 *
 * This role is used by ECS tasks to:
 * - Pull container images from ECR
 * - Write logs to CloudWatch
 * - Read secrets from Secrets Manager (for environment variables)
 *
 * @see https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_execution_IAM_role.html
 */
export class EcsTaskExecutionRole extends Construct {
  public readonly role: iam.Role;

  constructor(scope: Construct, id: string, props: EcsTaskExecutionRoleProps) {
    super(scope, id);

    const { envName, enablePublicEcr = false, logGroupArn, secretArns } = props;

    // Create execution role
    this.role = new iam.Role(this, "ExecutionRole", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      description: `ECS Task Execution Role for ${envName}`,
    });

    // Grant ECR read access
    if (enablePublicEcr) {
      // Allow pulling from public ECR
      this.role.addToPrincipalPolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            "ecr-public:GetAuthorizationToken",
            "ecr-public:BatchCheckLayerAvailability",
            "ecr-public:GetDownloadUrlForLayer",
            "ecr-public:BatchGetImage",
          ],
          resources: ["*"],
        })
      );
    } else {
      // Allow pulling from private ECR in the same account
      this.role.addToPrincipalPolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ["ecr:GetAuthorizationToken"],
          resources: ["*"],
        })
      );

      this.role.addToPrincipalPolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            "ecr:BatchCheckLayerAvailability",
            "ecr:GetDownloadUrlForLayer",
            "ecr:BatchGetImage",
          ],
          resources: [
            `arn:aws:ecr:${cdk.Stack.of(this).region}:${
              cdk.Stack.of(this).account
            }:repository/*`,
          ],
        })
      );
    }

    // Grant CloudWatch Logs permissions
    if (logGroupArn) {
      // Specific log group
      this.role.addToPrincipalPolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ["logs:CreateLogStream", "logs:PutLogEvents"],
          resources: [`${logGroupArn}:*`],
        })
      );
    } else {
      // Wildcard for dynamic log group creation
      this.role.addToPrincipalPolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ["logs:CreateLogStream", "logs:PutLogEvents"],
          resources: [
            `arn:aws:logs:${cdk.Stack.of(this).region}:${
              cdk.Stack.of(this).account
            }:log-group:/ecs/*:*`,
          ],
        })
      );
    }

    // Grant Secrets Manager permissions
    // Required for ECS to retrieve secrets and inject them as environment variables
    if (secretArns && secretArns.length > 0) {
      // Specific secrets
      this.role.addToPrincipalPolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ["secretsmanager:GetSecretValue"],
          resources: secretArns,
        })
      );
    } else {
      // All secrets in the account (less restrictive, but convenient for development)
      // In production, consider passing specific secret ARNs
      this.role.addToPrincipalPolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ["secretsmanager:GetSecretValue"],
          resources: [
            `arn:aws:secretsmanager:${cdk.Stack.of(this).region}:${
              cdk.Stack.of(this).account
            }:secret:*`,
          ],
        })
      );
    }

    // Apply CDK Nag suppressions
    NagSuppressions.addResourceSuppressions(
      this.role,
      SuppressionManager.getExecutionRoleSuppressions(envName),
      true
    );

    // Tag the role
    cdk.Tags.of(this.role).add("Environment", envName);
    cdk.Tags.of(this.role).add("ManagedBy", "CDK");
    cdk.Tags.of(this.role).add("Purpose", "ECSTaskExecution");
  }
}
