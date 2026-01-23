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

// ============================================================================
// TEST DEBUGGING HELPERS
// ============================================================================

/**
 * Debug helper: Print all IAM policies found in template
 *
 * Useful for troubleshooting test failures when policies aren't found
 *
 * @param template - CDK Template to inspect
 * @returns Array of policy summaries with their statements
 */
export function debugIamPolicies(template: {
  findResources: (type: string) => Record<string, unknown>;
}) {
  const policies = template.findResources("AWS::IAM::Policy");
  const policySummaries = Object.entries(policies).map(([logicalId, policy]) => {
    const props = (policy as { Properties: Record<string, unknown> })
      .Properties;
    const doc = props.PolicyDocument as {
      Statement: Array<{
        Action: string | string[];
        Resource: string | string[];
        Effect: string;
      }>;
    };

    return {
      logicalId,
      policyName: props.PolicyName as string,
      roles: props.Roles as string[] | string | undefined,
      statements: doc.Statement.map((stmt) => ({
        effect: stmt.Effect,
        actions: Array.isArray(stmt.Action) ? stmt.Action : [stmt.Action],
        resources: Array.isArray(stmt.Resource)
          ? stmt.Resource
          : [stmt.Resource],
      })),
    };
  });

  console.log("\n=== IAM Policies Found ===");
  console.log(`Total policies: ${policySummaries.length}\n`);

  policySummaries.forEach((policy, index) => {
    console.log(`Policy ${index + 1}: ${policy.logicalId}`);
    console.log(`  Name: ${policy.policyName}`);
    console.log(`  Roles: ${JSON.stringify(policy.roles, null, 2)}`);
    console.log(`  Statements (${policy.statements.length}):`);

    policy.statements.forEach((stmt, stmtIndex) => {
      console.log(`    Statement ${stmtIndex + 1}:`);
      console.log(`      Effect: ${stmt.effect}`);
      console.log(`      Actions (${stmt.actions.length}):`);
      
      // Group actions by service for better readability
      const actionGroups: Record<string, string[]> = {};
      stmt.actions.forEach((action) => {
        const service = action.split(":")[0];
        if (!actionGroups[service]) {
          actionGroups[service] = [];
        }
        actionGroups[service].push(action);
      });
      
      Object.entries(actionGroups).forEach(([service, actions]) => {
        console.log(`        ${service}:`);
        actions.forEach((action) => console.log(`          - ${action}`));
      });
      
      console.log(`      Resources (${stmt.resources.length}):`);
      stmt.resources.forEach((resource) => {
        const resourceStr = typeof resource === "string" 
          ? resource 
          : JSON.stringify(resource);
        console.log(`        - ${resourceStr}`);
      });
    });
    console.log("");
  });

  return policySummaries;
}

/**
 * Debug helper: Find policies with specific action prefix
 *
 * @param template - CDK Template to inspect
 * @param actionPrefix - Action prefix to search for (e.g., "s3:", "dynamodb:")
 * @returns Array of matching statements
 */
export function debugPoliciesWithAction(
  template: {
    findResources: (type: string) => Record<string, unknown>;
  },
  actionPrefix: string
) {
  const policies = template.findResources("AWS::IAM::Policy");
  const matchingStatements: Array<{
    logicalId: string;
    policyName: string;
    statement: {
      effect: string;
      actions: string[];
      resources: string[];
    };
  }> = [];

  Object.entries(policies).forEach(([logicalId, policy]) => {
    const props = (policy as { Properties: Record<string, unknown> })
      .Properties;
    const doc = props.PolicyDocument as {
      Statement: Array<{
        Action: string | string[];
        Resource: string | string[];
        Effect: string;
      }>;
    };

    doc.Statement.forEach((stmt) => {
      const actions = Array.isArray(stmt.Action) ? stmt.Action : [stmt.Action];
      const hasMatchingAction = actions.some((action) =>
        String(action).startsWith(actionPrefix)
      );

      if (hasMatchingAction) {
        matchingStatements.push({
          logicalId,
          policyName: props.PolicyName as string,
          statement: {
            effect: stmt.Effect,
            actions: actions.map(String),
            resources: Array.isArray(stmt.Resource)
              ? stmt.Resource.map(String)
              : [String(stmt.Resource)],
          },
        });
      }
    });
  });

  console.log(
    `\n=== Policies with ${actionPrefix} actions ===`
  );
  console.log(`Found ${matchingStatements.length} matching statement(s)\n`);

  matchingStatements.forEach((match, index) => {
    console.log(`Match ${index + 1}:`);
    console.log(`  Policy: ${match.logicalId} (${match.policyName})`);
    console.log(`  Effect: ${match.statement.effect}`);
    console.log(`  Actions:`);
    match.statement.actions.forEach((action) => {
      const isMatch = action.startsWith(actionPrefix);
      console.log(
        `    ${isMatch ? "✓" : " "} ${action}${isMatch ? " ← MATCHES" : ""}`
      );
    });
    console.log(`  Resources:`);
    match.statement.resources.forEach((resource) =>
      console.log(`    - ${resource}`)
    );
    console.log("");
  });

  return matchingStatements;
}

/**
 * Debug helper: Print expected vs actual actions
 *
 * @param expectedActions - Expected actions (from Match.arrayWith or array)
 * @param actualActions - Actual actions found in template
 * @param actionPrefix - Optional prefix to filter (e.g., "s3:", "dynamodb:")
 */
export function debugActionComparison(
  expectedActions: string[] | ReturnType<typeof Match.arrayWith>,
  actualActions: string[],
  actionPrefix?: string
) {
  // For Match.arrayWith, we can't extract the values directly
  // So we'll just show what we're looking for
  if (!Array.isArray(expectedActions)) {
    console.log(
      "\n=== Action Comparison (Match.arrayWith pattern) ==="
    );
    console.log("Note: Match.arrayWith requires ALL listed actions to be present\n");
  }

  const filteredActual = actionPrefix
    ? actualActions.filter((action) => action.startsWith(actionPrefix))
    : actualActions;

  console.log("Expected actions (all must be present):");
  if (Array.isArray(expectedActions)) {
    expectedActions.forEach((action) => {
      const found = filteredActual.includes(action);
      console.log(`  ${found ? "✓" : "✗"} ${action}${found ? "" : " ← MISSING"}`);
    });
  } else {
    console.log("  (Match.arrayWith pattern - cannot extract exact values)");
  }

  console.log("\nActual actions found:");
  if (filteredActual.length === 0) {
    console.log("  (none)");
  } else {
    filteredActual.forEach((action) => {
      const isExpected = Array.isArray(expectedActions)
        ? expectedActions.includes(action)
        : true; // Can't check for Match patterns
      console.log(`  ${isExpected ? "✓" : "?"} ${action}`);
    });
  }
  console.log("");
}
