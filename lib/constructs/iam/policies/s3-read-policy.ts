/** @format */

import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

/**
 * Properties for S3ReadPolicy
 */
export interface S3ReadPolicyProps {
  /**
   * S3 bucket ARN
   */
  bucketArn: string;

  /**
   * Policy name
   * @default S3ReadPolicy
   */
  policyName?: string;
}

/**
 * S3ReadPolicy - Centralized S3 read permissions
 *
 * Creates an IAM policy with S3 read permissions that match
 * what `bucket.grantRead()` would provide.
 *
 * Actions included:
 * - s3:GetObject* - Get object (including versions)
 * - s3:List* - List bucket contents
 * - s3:GetBucket* - Get bucket metadata
 *
 * Resources:
 * - Bucket ARN (for bucket operations)
 * - Bucket ARN/* (for object operations)
 *
 * @example
 * ```typescript
 * const policy = new S3ReadPolicy(this, "S3Policy", {
 *   bucketArn: bucket.bucketArn,
 * });
 * policy.attachToRole(lambdaRole);
 * ```
 */
export class S3ReadPolicy extends Construct {
  public readonly policy: iam.Policy;

  constructor(scope: Construct, id: string, props: S3ReadPolicyProps) {
    super(scope, id);

    this.policy = new iam.Policy(this, "Policy", {
      policyName: props.policyName || "S3ReadPolicy",
      statements: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            "s3:GetObject*",    // Get object (including versions)
            "s3:List*",         // List bucket contents
            "s3:GetBucket*",    // Get bucket metadata
          ],
          resources: [
            props.bucketArn,           // Bucket itself
            `${props.bucketArn}/*`,    // All objects in bucket
          ],
        }),
      ],
    });

    // Tag the policy
    cdk.Tags.of(this.policy).add("ManagedBy", "CDK");
    cdk.Tags.of(this.policy).add("Purpose", "S3Read");
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
