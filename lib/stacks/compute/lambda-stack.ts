/** @format */

import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { NagSuppressions } from "cdk-nag";

export interface LambdaFunctionConstructProps {
  /**
   * Environment name
   */
  envName: string;

  /**
   * Function name
   */
  functionName: string;

  /**
   * Path to the Lambda handler file (TypeScript)
   * e.g., 'lambda/handlers/vpc-peering-accept.ts'
   */
  entry: string;

  /**
   * Handler function name
   * @default 'handler'
   */
  handler?: string;

  /**
   * Runtime environment variables
   */
  environment?: { [key: string]: string };

  /**
   * Lambda timeout
   * @default Duration.minutes(5)
   */
  timeout?: cdk.Duration;

  /**
   * Memory size in MB
   * @default 256
   */
  memorySize?: number;

  /**
   * Log retention period
   * @default RetentionDays.ONE_WEEK
   */
  logRetention?: logs.RetentionDays;

  /**
   * IAM policy statements to attach to the function
   */
  initialPolicy?: iam.PolicyStatement[];

  /**
   * Lambda runtime
   * @default Runtime.NODEJS_20_X
   */
  runtime?: lambda.Runtime;

  /**
   * Bundling options for NodejsFunction
   */
  bundling?: {
    minify?: boolean;
    sourceMap?: boolean;
    externalModules?: string[];
  };
}

/**
 * Reusable Lambda Function Construct
 *
 * Creates a Lambda function with TypeScript support using esbuild bundling.
 * Includes automatic log group creation, IAM role management, and CDK Nag compliance.
 *
 * Features:
 * - TypeScript support with automatic bundling
 * - CloudWatch Logs with configurable retention
 * - IAM role with least privilege
 * - Environment variable support
 * - Configurable timeout and memory
 *
 * Usage:
 * ```typescript
 * const fn = new LambdaFunctionConstruct(this, 'MyFunction', {
 *   envName: 'development',
 *   functionName: 'my-function',
 *   entry: 'lambda/handlers/my-handler.ts',
 *   environment: {
 *     TABLE_NAME: table.tableName,
 *   },
 *   initialPolicy: [
 *     new iam.PolicyStatement({
 *       actions: ['dynamodb:PutItem'],
 *       resources: [table.tableArn],
 *     }),
 *   ],
 * });
 * ```
 */
export class LambdaFunctionConstruct extends Construct {
  public readonly function: NodejsFunction;
  public readonly role: iam.Role;
  public readonly logGroup: logs.LogGroup;

  constructor(
    scope: Construct,
    id: string,
    props: LambdaFunctionConstructProps
  ) {
    super(scope, id);

    // Create log group
    this.logGroup = new logs.LogGroup(this, "LogGroup", {
      logGroupName: `/aws/lambda/${props.envName}-${props.functionName}`,
      retention: props.logRetention || logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Create Lambda function with TypeScript support
    this.function = new NodejsFunction(this, "Function", {
      functionName: `${props.envName}-${props.functionName}`,
      entry: props.entry,
      handler: props.handler || "handler",
      runtime: props.runtime || lambda.Runtime.NODEJS_20_X,
      timeout: props.timeout || cdk.Duration.minutes(5),
      memorySize: props.memorySize || 256,
      environment: props.environment,
      logGroup: this.logGroup,
      bundling: {
        minify: props.bundling?.minify ?? true,
        sourceMap: props.bundling?.sourceMap ?? true,
        externalModules: props.bundling?.externalModules ?? ["@aws-sdk/*"],
        target: "node20",
        mainFields: ["module", "main"],
      },
      initialPolicy: props.initialPolicy,
    });

    this.role = this.function.role as iam.Role;

    // ========================================================================
    // CDK NAG SUPPRESSIONS
    // ========================================================================
    NagSuppressions.addResourceSuppressions(
      this.function,
      [
        {
          id: "AwsSolutions-IAM4",
          reason:
            "Lambda function uses AWSLambdaBasicExecutionRole for CloudWatch Logs access - this is the standard pattern for Lambda functions",
          appliesTo: [
            "Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
          ],
        },
        {
          id: "AwsSolutions-L1",
          reason:
            "Lambda function uses Node.js 20.x which is the latest LTS runtime as of 2024",
        },
      ],
      true
    );

    // ========================================================================
    // OUTPUTS
    // ========================================================================
    new cdk.CfnOutput(this, "FunctionArn", {
      value: this.function.functionArn,
      description: `Lambda function ARN for ${props.functionName}`,
      exportName: `${props.envName}-${props.functionName}-arn`,
    });

    new cdk.CfnOutput(this, "FunctionName", {
      value: this.function.functionName,
      description: `Lambda function name for ${props.functionName}`,
      exportName: `${props.envName}-${props.functionName}-name`,
    });

    // ========================================================================
    // TAGS
    // ========================================================================
    cdk.Tags.of(this).add("Environment", props.envName);
    cdk.Tags.of(this).add("ManagedBy", "CDK");
    cdk.Tags.of(this).add("Function", props.functionName);
  }
}
