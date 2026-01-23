/** @format */

import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

/**
 * Properties for CloudWatchLogsPolicy
 */
export interface CloudWatchLogsPolicyProps {
  /**
   * CloudWatch Log Group ARN
   */
  logGroupArn: string;

  /**
   * Policy name
   * @default CloudWatchLogsPolicy
   */
  policyName?: string;
}

/**
 * CloudWatchLogsPolicy - Centralized CloudWatch Logs permissions
 *
 * Creates an IAM policy with CloudWatch Logs write permissions.
 * Required for Lambda functions and ECS tasks to write logs.
 *
 * Actions included:
 * - logs:CreateLogStream - Create log streams
 * - logs:PutLogEvents - Write log events
 *
 * @example
 * ```typescript
 * const policy = new CloudWatchLogsPolicy(this, "LogsPolicy", {
 *   logGroupArn: logGroup.logGroupArn,
 * });
 * policy.attachToRole(lambdaRole);
 * ```
 */
export class CloudWatchLogsPolicy extends Construct {
  public readonly policy: iam.Policy;

  constructor(scope: Construct, id: string, props: CloudWatchLogsPolicyProps) {
    super(scope, id);

    this.policy = new iam.Policy(this, "Policy", {
      policyName: props.policyName || "CloudWatchLogsPolicy",
      statements: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            "logs:CreateLogStream", // Create log streams
            "logs:PutLogEvents",     // Write log events
          ],
          resources: [props.logGroupArn],
        }),
      ],
    });

    // Tag the policy
    cdk.Tags.of(this.policy).add("ManagedBy", "CDK");
    cdk.Tags.of(this.policy).add("Purpose", "CloudWatchLogs");
  }

  /**
   * Attach this policy to an IAM role
   *
   * @param role - IAM role to attach the policy to
   */
  public attachToRole(role: iam.IRole): void {
    this.policy.attachToRole(role);
  }
}
