/** @format */

import * as path from "path";

import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as logs from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";

import { EnvironmentConfig } from "../../../config/environments";
import { ApiGatewayConstruct } from "../../constructs/networking/api/api-gateway-construct";
import { LambdaFunctionConstruct } from "../../constructs/compute/lambda/lambda-function-construct";
import { SuppressionManager } from "../../cdk-nag";

/**
 * Properties for WebappApiStack
 */
export interface WebappApiStackProps extends cdk.StackProps {
  /**
   * Environment name
   */
  envName: string;

  /**
   * Project name
   */
  projectName: string;

  /**
   * Environment configuration
   */
  envConfig: EnvironmentConfig;

  /**
   * DynamoDB Articles table
   */
  articlesTable: dynamodb.ITable;

  /**
   * S3 Assets bucket
   */
  assetsS3Bucket: s3.IBucket;

  /**
   * Allowed CORS origins
   * @default ['*'] for non-production, specific domain for production
   */
  corsOrigins?: string[];
}

/**
 * WebappApiStack - Provisions serverless API for portfolio webapp
 *
 * Architecture:
 * Client -> CloudFront -> API Gateway -> Lambda -> DynamoDB
 *                                              -> S3 (images)
 *
 * This stack creates:
 * - API Gateway REST API with CloudWatch logging
 * - Lambda functions for article operations:
 *   - GET /articles - List articles (with pagination)
 *   - GET /articles/{slug} - Get article by slug
 *   - GET /articles/tag/{tag} - List articles by tag
 * - IAM permissions for Lambda to access DynamoDB and S3
 * - CloudWatch Log Groups with retention policies
 * - CORS configuration for frontend integration
 *
 * Dependencies:
 * - WebappDynamoDbStack (articles table and S3 bucket)
 *
 * Exported Resources:
 * - API Gateway URL (export: `${environment}-${project}-api-url`)
 * - API Gateway ID (export: `${environment}-${project}-api-id`)
 *
 * Cost Optimisation:
 * - Lambda functions use ARM64 architecture for lower cost
 * - API Gateway caching disabled in development
 * - CloudWatch Logs retention: 1 week (dev), 1 month (prod)
 * - On-demand DynamoDB billing
 *
 * Security:
 * - Least privilege IAM permissions
 * - API Gateway throttling enabled
 * - CloudWatch logging for audit trails
 * - CORS restricted to frontend domains
 *
 * @example
 * ```typescript
 * const apiStack = new WebappApiStack(app, 'WebappApi', {
 *   envName: 'production',
 *   projectName: 'webapp',
 *   envConfig: productionConfig,
 *   articlesTable: dynamoDbStack.articlesTable,
 *   assetsS3Bucket: dynamoDbStack.assetsS3Bucket,
 *   corsOrigins: ['https://example.com'],
 * });
 * ```
 */
export class WebappApiStack extends cdk.Stack {
  public readonly api: ApiGatewayConstruct;
  public readonly getArticleFunction: LambdaFunctionConstruct;
  public readonly listArticlesFunction: LambdaFunctionConstruct;
  public readonly listArticlesByTagFunction: LambdaFunctionConstruct;

  constructor(scope: Construct, id: string, props: WebappApiStackProps) {
    super(scope, id, {
      ...props,
      description: `Serverless API for ${props.projectName} portfolio - Provisions API Gateway REST API with Lambda functions for article operations`,
    });

    const {
      envName,
      projectName,
      envConfig,
      articlesTable,
      assetsS3Bucket,
      corsOrigins,
    } = props;

    const isProduction = envConfig.isProduction;

    // Determine CORS origins
    const allowedOrigins = corsOrigins || (isProduction ? [] : ["*"]);

    // ========================================================================
    // API GATEWAY
    // ========================================================================

    this.api = new ApiGatewayConstruct(this, "ArticlesApi", {
      envName,
      projectName,
      apiName: "articles-api",
      description: `Articles API for ${projectName} portfolio`,

      enableLogging: true,
      logRetention: isProduction
        ? logs.RetentionDays.ONE_MONTH
        : logs.RetentionDays.ONE_WEEK,

      enableDetailedMetrics: isProduction,
      enableTracing: isProduction,

      cors: {
        allowOrigins: allowedOrigins,
        allowMethods: ["GET", "OPTIONS"],
        allowHeaders: ["Content-Type", "Authorization", "X-Api-Key"],
        allowCredentials: true,
        maxAge: 3600,
      },

      throttle: {
        rateLimit: isProduction ? 1000 : 100,
        burstLimit: isProduction ? 2000 : 200,
      },

      stageName: "api",

      removalPolicy: isProduction
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
    });

    // ========================================================================
    // LAMBDA FUNCTIONS
    // ========================================================================

    // Shared environment variables for all Lambda functions
    const sharedEnvironment = {
      TABLE_NAME: articlesTable.tableName,
      ASSETS_BUCKET_NAME: assetsS3Bucket.bucketName,
      GSI1_NAME: "gsi1-status-date",
      GSI2_NAME: "gsi2-tag-date",
      ENVIRONMENT: envName,
      LOG_LEVEL: isProduction ? "INFO" : "DEBUG",
    };

    // ========================================
    // GET ARTICLE BY SLUG
    // ========================================

    this.getArticleFunction = new LambdaFunctionConstruct(
      this,
      "GetArticleFunction",
      {
        envName,
        functionName: `${projectName}-get-article`,
        entry: path.join(__dirname, "../../../lambda/handlers/api/index.ts"),
        handler: "handler",
        memorySize: 256,
        timeout: cdk.Duration.seconds(30),
        environment: sharedEnvironment,
        logRetention: isProduction
          ? logs.RetentionDays.ONE_MONTH
          : logs.RetentionDays.ONE_WEEK,
        // Explicit IAM permissions via separate policy resources
        dynamoDbTableArn: articlesTable.tableArn,
        s3BucketArn: assetsS3Bucket.bucketArn,
      },
    );

    // Add to API Gateway
    this.api.addLambdaIntegration(
      "GET",
      "/articles/{slug}",
      this.getArticleFunction.function,
    );

    // ========================================
    // LIST ARTICLES
    // ========================================

    this.listArticlesFunction = new LambdaFunctionConstruct(
      this,
      "ListArticlesFunction",
      {
        envName,
        functionName: `${projectName}-list-articles`,
        entry: path.join(__dirname, "../../../lambda/handlers/api/index.ts"),
        handler: "handler",
        memorySize: 256,
        timeout: cdk.Duration.seconds(30),
        environment: sharedEnvironment,
        logRetention: isProduction
          ? logs.RetentionDays.ONE_MONTH
          : logs.RetentionDays.ONE_WEEK,
        // Explicit IAM permissions via separate policy resources
        dynamoDbTableArn: articlesTable.tableArn,
      },
    );

    // Add to API Gateway
    this.api.addLambdaIntegration(
      "GET",
      "/articles",
      this.listArticlesFunction.function,
    );

    // ========================================
    // LIST ARTICLES BY TAG
    // ========================================

    this.listArticlesByTagFunction = new LambdaFunctionConstruct(
      this,
      "ListArticlesByTagFunction",
      {
        envName,
        functionName: `${projectName}-list-articles-by-tag`,
        entry: path.join(__dirname, "../../../lambda/handlers/api/index.ts"),
        handler: "handler",
        memorySize: 256,
        timeout: cdk.Duration.seconds(30),
        environment: sharedEnvironment,
        logRetention: isProduction
          ? logs.RetentionDays.ONE_MONTH
          : logs.RetentionDays.ONE_WEEK,
        // Explicit IAM permissions via separate policy resources
        dynamoDbTableArn: articlesTable.tableArn,
      },
    );

    // Add to API Gateway
    this.api.addLambdaIntegration(
      "GET",
      "/articles/tag/{tag}",
      this.listArticlesByTagFunction.function,
    );

    // ========================================================================
    // STACK OUTPUTS
    // ========================================================================

    const shouldExport = !envName.includes("pipeline");
    const exportPrefix = `${envName}-${projectName}`;

    new cdk.CfnOutput(this, "ApiUrl", {
      value: this.api.api.url,
      description: "API Gateway URL for articles API",
      ...(shouldExport && { exportName: `${exportPrefix}-api-url` }),
    });

    new cdk.CfnOutput(this, "ApiId", {
      value: this.api.api.restApiId,
      description: "API Gateway ID",
      ...(shouldExport && { exportName: `${exportPrefix}-api-id` }),
    });

    new cdk.CfnOutput(this, "ApiEndpoint", {
      value: `${this.api.api.url}api`,
      description: "Full API endpoint with stage",
      ...(shouldExport && { exportName: `${exportPrefix}-api-endpoint` }),
    });

    // Lambda function ARNs for reference
    new cdk.CfnOutput(this, "GetArticleFunctionArn", {
      value: this.getArticleFunction.function.functionArn,
      description: "Get Article Lambda function ARN",
    });

    new cdk.CfnOutput(this, "ListArticlesFunctionArn", {
      value: this.listArticlesFunction.function.functionArn,
      description: "List Articles Lambda function ARN",
    });

    new cdk.CfnOutput(this, "ListArticlesByTagFunctionArn", {
      value: this.listArticlesByTagFunction.function.functionArn,
      description: "List Articles By Tag Lambda function ARN",
    });

    // ========================================================================
    // TAGGING
    // ========================================================================

    cdk.Tags.of(this).add("Environment", envName);
    cdk.Tags.of(this).add("Project", projectName);
    cdk.Tags.of(this).add("ManagedBy", "CDK");
    cdk.Tags.of(this).add("Stack", "WebappApi");
    cdk.Tags.of(this).add("CostCentre", projectName);

    // ========================================================================
    // CDK NAG SUPPRESSIONS
    // ========================================================================

    SuppressionManager.applyToStack(this, "WebappApiStack", envName);
  }
}
