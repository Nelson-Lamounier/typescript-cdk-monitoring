/** @format */

/**
 * Webapp-Specific Test Helpers
 *
 * Provides utility functions specific to webapp stack testing:
 * - API Gateway validators
 * - Lambda function validators
 * - CORS configuration validators
 *
 * Pattern: Follows monitoring test helpers pattern
 */

import { Match } from "aws-cdk-lib/assertions";

// ============================================================================
// API GATEWAY VALIDATORS
// ============================================================================

/**
 * Validate CORS configuration
 *
 * @param corsConfig - CORS configuration to validate
 * @returns Match pattern for CORS headers
 */
export function validateCorsHeaders(
  headers: string[]
): ReturnType<typeof Match.arrayWith> {
  return Match.arrayWith(
    headers.map((header) => Match.stringLikeRegexp(header))
  );
}

/**
 * Validate CORS methods
 *
 * @param methods - HTTP methods to validate
 * @returns Match pattern for CORS methods
 */
export function validateCorsMethods(
  methods: string[]
): ReturnType<typeof Match.stringLikeRegexp> {
  return Match.stringLikeRegexp(methods.join(".*"));
}

/**
 * Validate throttling configuration
 *
 * @param rateLimit - Expected rate limit
 * @param burstLimit - Expected burst limit
 * @returns Match pattern for throttling settings
 */
export function validateThrottling(rateLimit: number, burstLimit: number) {
  return Match.objectLike({
    ThrottlingRateLimit: rateLimit,
    ThrottlingBurstLimit: burstLimit,
  });
}

// ============================================================================
// LAMBDA VALIDATORS
// ============================================================================

/**
 * Validate Lambda environment variables
 *
 * @param tableName - DynamoDB table name
 * @param bucketName - S3 bucket name
 * @param envName - Environment name
 * @param isProduction - Whether this is production
 * @returns Match pattern for Lambda environment
 */
export function validateLambdaEnvironment(
  tableName: string,
  bucketName: string,
  envName: string,
  isProduction: boolean = false
) {
  return {
    Variables: Match.objectLike({
      TABLE_NAME: tableName,
      ASSETS_BUCKET_NAME: bucketName,
      GSI1_NAME: "gsi1-status-date",
      GSI2_NAME: "gsi2-tag-date",
      ENVIRONMENT: envName,
      LOG_LEVEL: isProduction ? "INFO" : "DEBUG",
    }),
  };
}

/**
 * Validate Lambda CloudWatch log retention
 *
 * @param isProduction - Whether this is production
 * @returns Expected retention days
 */
export function getLogRetentionDays(isProduction: boolean): number {
  return isProduction ? 30 : 7; // 1 month for prod, 1 week for dev
}

// ============================================================================
// IAM VALIDATORS
// ============================================================================

/**
 * Validate DynamoDB read permissions
 *
 * @returns Match pattern for DynamoDB read actions
 */
export function validateDynamoDbReadPermissions() {
  // These are the actions granted by table.grantReadData()
  // See: https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_dynamodb.Table.html#grantwbrreadwbrdatagrantee
  return Match.arrayWith([
    "dynamodb:BatchGetItem",
    "dynamodb:Query",
    "dynamodb:GetItem",
    "dynamodb:Scan",
    "dynamodb:ConditionCheckItem",
    "dynamodb:DescribeTable",
  ]);
}

/**
 * Validate S3 read permissions
 *
 * @returns Match pattern for S3 read actions
 */
export function validateS3ReadPermissions() {
  return Match.arrayWith(["s3:GetObject*", "s3:GetBucket*", "s3:List*"]);
}

/**
 * Validate Lambda execution role trust policy
 *
 * @returns Match pattern for Lambda trust policy
 */
export function validateLambdaTrustPolicy() {
  return {
    Statement: [
      {
        Action: "sts:AssumeRole",
        Effect: "Allow",
        Principal: {
          Service: "lambda.amazonaws.com",
        },
      },
    ],
  };
}

// ============================================================================
// API GATEWAY INTEGRATION VALIDATORS
// ============================================================================

/**
 * Validate Lambda proxy integration
 *
 * @returns Match pattern for AWS_PROXY integration
 */
export function validateLambdaProxyIntegration() {
  return {
    Type: "AWS_PROXY",
    IntegrationHttpMethod: "POST", // Lambda proxy always uses POST
  };
}

/**
 * Validate Lambda invoke permission
 *
 * @returns Match pattern for Lambda invoke permission
 */
export function validateLambdaInvokePermission() {
  return {
    Action: "lambda:InvokeFunction",
    Principal: "apigateway.amazonaws.com",
  };
}

/**
 * Validate CORS preflight (OPTIONS) integration
 *
 * @param allowedHeaders - Allowed CORS headers
 * @param allowedMethods - Allowed HTTP methods
 * @returns Match pattern for CORS OPTIONS integration
 */
export function validateCorsPreflightIntegration(
  allowedHeaders: string[],
  allowedMethods: string[]
) {
  return {
    Type: "MOCK",
    IntegrationResponses: [
      Match.objectLike({
        ResponseParameters: Match.objectLike({
          "method.response.header.Access-Control-Allow-Headers":
            Match.stringLikeRegexp(allowedHeaders.join(".*")),
          "method.response.header.Access-Control-Allow-Methods":
            Match.stringLikeRegexp(allowedMethods.join(".*")),
          "method.response.header.Access-Control-Allow-Origin": Match.anyValue(),
        }),
      }),
    ],
  };
}

// ============================================================================
// STACK OUTPUT VALIDATORS
// ============================================================================

/**
 * Validate CloudFormation export naming
 *
 * @param envName - Environment name
 * @param projectName - Project name
 * @param resourceName - Resource name
 * @returns Expected export name
 */
export function buildExportName(
  envName: string,
  projectName: string,
  resourceName: string
): string {
  return `${envName}-${projectName}-${resourceName}`;
}

/**
 * Check if environment should export outputs
 *
 * Pipeline environments should not export to avoid cross-account issues
 *
 * @param envName - Environment name
 * @returns True if outputs should be exported
 */
export function shouldExportOutputs(envName: string): boolean {
  return !envName.includes("pipeline");
}
