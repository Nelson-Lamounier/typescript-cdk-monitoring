/** @format */

import * as cdk from "aws-cdk-lib";

import { NetworkingStack } from "../../lib/stacks/foundation/networking-stack";
import { WebappEcrStack } from "../../lib/stacks/webapp/ecr-stack";
import { WebappDynamoDbStack } from "../../lib/stacks/webapp/dynamodb-stack";
import { WebappApiStack } from "../../lib/stacks/webapp/api-stack";
import { EnvironmentConfig } from "../../config/environments";

/**
 * Create all webapp stacks for a single environment
 *
 * Architecture:
 * 1. WebappEcrStack - Container registry (ECR repository)
 * 2. WebappDynamoDbStack - Database layer (DynamoDB tables + S3 assets)
 * 3. WebappApiStack - API layer (API Gateway + Lambda functions)
 *
 * API Architecture:
 * Client -> CloudFront -> API Gateway -> Lambda -> DynamoDB
 *                                              -> S3 (images)
 *
 * Future stacks (to be added):
 * 4. WebappInfraStack - Compute layer (EC2, ECS cluster, ALB)
 * 5. WebappServiceStack - Application layer (webapp containers)
 *
 * Dependencies:
 * - Requires NetworkingStack (VPC, subnets, security groups)
 * - ECR and DynamoDB stacks are standalone (no dependencies on other webapp stacks)
 * - API stack depends on DynamoDB stack (for table and bucket references)
 *
 * @param app CDK app
 * @param envName Environment name (e.g., 'development', 'staging', 'production')
 * @param envConfig Environment configuration
 * @param networkingStack The networking stack (for VPC reference)
 * @param stackProps Stack properties including env (account/region)
 * @param projectName Project name (default: 'webapp')
 */
export function createWebappStacks(
  app: cdk.App,
  envName: string,
  envConfig: EnvironmentConfig,
  networkingStack: NetworkingStack,
  stackProps: cdk.StackProps,
  projectName: string = "webapp"
): {
  ecrStack: WebappEcrStack;
  dynamoDbStack: WebappDynamoDbStack;
  apiStack: WebappApiStack;
} {
  const stackNamePrefix = `${envName}-Webapp`;

  // ============================================================================
  // 1. WEBAPP ECR STACK (Container Registry)
  // ============================================================================

  const ecrStack = new WebappEcrStack(app, `${stackNamePrefix}Ecr`, {
    ...stackProps,
    envName,
    projectName,
    envConfig,
    pipelineAccount: envConfig.pipelineAccount,
  });

  // Add dependency on networking (for consistency, though ECR doesn't require VPC)
  ecrStack.addDependency(networkingStack);

  // ============================================================================
  // 2. WEBAPP DYNAMODB STACK (Database Layer)
  // ============================================================================

  const dynamoDbStack = new WebappDynamoDbStack(
    app,
    `${stackNamePrefix}DynamoDb`,
    {
      ...stackProps,
      envName,
      projectName,
      envConfig,
    }
  );

  // DynamoDB is standalone but add dependency for consistent deployment order
  dynamoDbStack.addDependency(networkingStack);

  // ============================================================================
  // 3. WEBAPP API STACK (API Gateway + Lambda Functions)
  // ============================================================================

  const apiStack = new WebappApiStack(app, `${stackNamePrefix}Api`, {
    ...stackProps,
    envName,
    projectName,
    envConfig,
    articlesTable: dynamoDbStack.articlesTable,
    assetsS3Bucket: dynamoDbStack.assetsBucket,
    // Configure CORS origins per environment
    corsOrigins: envConfig.isProduction
      ? [] // Add production domain here
      : ["*"], // Allow all origins in non-production
  });

  // API stack depends on DynamoDB stack
  apiStack.addDependency(dynamoDbStack);

  return {
    ecrStack,
    dynamoDbStack,
    apiStack,
  };
}
