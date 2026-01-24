/** @format */

import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

/**
 * Properties for LambdaExecutionPolicy
 */
export interface LambdaExecutionPolicyProps {
  /**
   * CloudWatch Log Group ARN (required)
   */
  logGroupArn: string;

  /**
   * DynamoDB table ARN (optional)
   * If provided, adds DynamoDB read permissions
   */
  dynamoDbTableArn?: string;

  /**
   * S3 bucket ARN (optional)
   * If provided, adds S3 read permissions
   */
  s3BucketArn?: string;

  /**
   * Environment name (for policy naming)
   */
  envName: string;

  /**
   * Function name (for policy naming)
   */
  functionName: string;
}

/**
 * LambdaExecutionPolicy - Combined Lambda execution permissions
 *
 * Creates a consolidated IAM policy for Lambda function execution that includes:
 * - CloudWatch Logs permissions (always included)
 * - DynamoDB read permissions (if table ARN provided)
 * - S3 read permissions (if bucket ARN provided)
 *
 * This policy combines multiple permission types into a single policy resource
 * for easier management and auditing. Uses centralized permission definitions
 * to avoid code duplication.
 *
 * @example
 * ```typescript
 * const policy = new LambdaExecutionPolicy(this, "ExecutionPolicy", {
 *   logGroupArn: logGroup.logGroupArn,
 *   dynamoDbTableArn: table.tableArn,
 *   s3BucketArn: bucket.bucketArn,
 *   envName: "development",
 *   functionName: "my-function",
 * });
 * policy.attachToRole(lambdaRole);
 * ```
 */
export class LambdaExecutionPolicy extends Construct {
  public readonly policy: iam.Policy;

  constructor(
    scope: Construct,
    id: string,
    props: LambdaExecutionPolicyProps
  ) {
    super(scope, id);

    const statements: iam.PolicyStatement[] = [];

    // ========================================================================
    // CLOUDWATCH LOGS PERMISSIONS (always required)
    // ========================================================================
    statements.push(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "logs:CreateLogStream", // Create log streams
          "logs:PutLogEvents",     // Write log events
        ],
        resources: [props.logGroupArn],
      })
    );

    // ========================================================================
    // DYNAMODB READ PERMISSIONS (if table ARN provided)
    // ========================================================================
    // These actions match what table.grantReadData() would provide
    if (props.dynamoDbTableArn) {
      statements.push(
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
          resources: [props.dynamoDbTableArn],
        })
      );
    }

    // ========================================================================
    // S3 READ PERMISSIONS (if bucket ARN provided)
    // ========================================================================
    if (props.s3BucketArn) {
      statements.push(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            "s3:GetObject*",    // Get object (including versions)
            "s3:List*",         // List bucket contents
            "s3:GetBucket*",    // Get bucket metadata
          ],
          resources: [
            props.s3BucketArn,           // Bucket itself
            `${props.s3BucketArn}/*`,    // All objects in bucket
          ],
        })
      );
    }

    // ========================================================================
    // CREATE CONSOLIDATED POLICY
    // ========================================================================
    this.policy = new iam.Policy(this, "Policy", {
      policyName: `${props.envName}-${props.functionName}-policy`,
      statements,
    });

    // ========================================================================
    // TAGGING
    // ========================================================================
    cdk.Tags.of(this.policy).add("Environment", props.envName);
    cdk.Tags.of(this.policy).add("ManagedBy", "CDK");
    cdk.Tags.of(this.policy).add("Function", props.functionName);
    cdk.Tags.of(this.policy).add("Purpose", "LambdaExecution");
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
