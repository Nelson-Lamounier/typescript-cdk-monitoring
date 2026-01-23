/** @format */

import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

/**
 * Properties for DynamoDbReadPolicy
 */
export interface DynamoDbReadPolicyProps {
  /**
   * DynamoDB table ARN
   */
  tableArn: string;

  /**
   * Policy name
   * @default DynamoDbReadPolicy
   */
  policyName?: string;
}

/**
 * DynamoDbReadPolicy - Centralized DynamoDB read permissions
 *
 * Creates an IAM policy with DynamoDB read permissions that match
 * what `table.grantReadData()` would provide.
 *
 * Actions included:
 * - dynamodb:BatchGetItem - Batch retrieval of multiple items
 * - dynamodb:GetItem - Get single item by key
 * - dynamodb:Query - Query with GSI or partition key
 * - dynamodb:Scan - Full table scan
 * - dynamodb:ConditionCheckItem - Conditional checks for transactions
 * - dynamodb:DescribeTable - Get table metadata
 *
 * @example
 * ```typescript
 * const policy = new DynamoDbReadPolicy(this, "DynamoDbPolicy", {
 *   tableArn: table.tableArn,
 * });
 * policy.attachToRole(lambdaRole);
 * ```
 */
export class DynamoDbReadPolicy extends Construct {
  public readonly policy: iam.Policy;

  constructor(scope: Construct, id: string, props: DynamoDbReadPolicyProps) {
    super(scope, id);

    this.policy = new iam.Policy(this, "Policy", {
      policyName: props.policyName || "DynamoDbReadPolicy",
      statements: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            "dynamodb:BatchGetItem",      // Batch retrieval of multiple items
            "dynamodb:GetItem",            // Get single item by key
            "dynamodb:Query",              // Query with GSI or partition key
            "dynamodb:Scan",               // Full table scan
            "dynamodb:ConditionCheckItem", // Conditional checks for transactions
            "dynamodb:DescribeTable",      // Get table metadata
          ],
          resources: [props.tableArn],
        }),
      ],
    });

    // Tag the policy
    cdk.Tags.of(this.policy).add("ManagedBy", "CDK");
    cdk.Tags.of(this.policy).add("Purpose", "DynamoDbRead");
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
