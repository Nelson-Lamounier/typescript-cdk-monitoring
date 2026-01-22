/** @format */

import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

import { DynamoDbTableConstruct } from "../../constructs/storage/dynamodb/dynamodb-table-construct";
import { S3BucketConstruct } from "../../constructs/storage/s3/s3-bucket-construct";
import { EnvironmentConfig } from "../../../config/environments";
import { SuppressionManager } from "../../cdk-nag/suppression-manager";

/**
 * Properties for WebappDynamoDbStack
 */
export interface WebappDynamoDbStackProps extends cdk.StackProps {
  envName: string;
  projectName: string;
  envConfig: EnvironmentConfig;
}

/**
 * WebappDynamoDbStack - Provisions database and storage for portfolio Next.js application
 *
 * This stack creates:
 * 1. DynamoDB Articles Table - Single-table design for article content
 * 2. S3 Assets Bucket - Storage for images and media
 *
 * Articles Table Design:
 * - Primary Key: pk (String) - Format: `ARTICLE#<slug>`
 * - Sort Key: sk (String) - Format: `METADATA` | `CONTENT#<version>`
 * - GSI1: Query by status and date (gsi1pk: `STATUS#<status>`, gsi1sk: `<date>#<slug>`)
 * - GSI2: Query by tag (gsi2pk: `TAG#<tag>`, gsi2sk: `<date>#<slug>`)
 *
 * Table Design Benefits:
 * - Single table design follows AWS best practices for DynamoDB
 * - Supports content versioning through sort key pattern
 * - Efficient queries for listing, filtering, and searching articles
 * - Future-proof for comments, analytics, and related content
 *
 * Access Patterns Supported:
 * 1. Get article by slug: pk=ARTICLE#<slug>, sk=METADATA
 * 2. Get article content: pk=ARTICLE#<slug>, sk=CONTENT#v<N>
 * 3. List published articles: GSI1 query where gsi1pk=STATUS#published
 * 4. List articles by tag: GSI2 query where gsi2pk=TAG#<tag>
 * 5. Get article versions: pk=ARTICLE#<slug>, sk begins_with CONTENT#
 *
 * S3 Assets Bucket:
 * - Stores article images, diagrams, and media files
 * - Versioning enabled for content recovery
 * - Block public access (serve via CloudFront only)
 * - Lifecycle policies for cost optimisation
 *
 * Integration with Portfolio App:
 * - Next.js app fetches articles via API Gateway + Lambda
 * - Images served via CloudFront with S3 origin
 * - MDX content rendered client-side with next-mdx-remote
 * - Custom components (ScenarioKeywords, EliminationList) stored as JSON
 *
 * Cost Optimisation:
 * - On-demand billing for DynamoDB (no capacity planning)
 * - AWS managed encryption (no additional KMS costs)
 * - S3 Intelligent-Tiering for automatic cost optimisation
 * - Point-in-time recovery enabled only in production
 *
 * Dependencies:
 * - None (standalone stack for portfolio application)
 *
 * Exported Resources:
 * - Articles table name and ARN
 * - Assets S3 bucket name and ARN
 * - GSI names for query operations
 *
 * @see lib/constructs/storage/dynamodb/dynamodb-table-construct.ts
 * @see lib/constructs/storage/s3/s3-bucket-construct.ts
 * @see docs/DYNAMODB_ARTICLES_MIGRATION.md
 */
export class WebappDynamoDbStack extends cdk.Stack {
  public readonly articlesTable: dynamodb.Table;
  public readonly assetsBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: WebappDynamoDbStackProps) {
    super(scope, id, props);

    const { envName, projectName, envConfig } = props;

    const isProduction = envConfig.isProduction;

    // ========================================================================
    // S3 BUCKET FOR ARTICLE ASSETS (IMAGES, MEDIA)
    // ========================================================================
    //
    // Purpose: Store article images, diagrams, and media files
    // Access: Private (serve via CloudFront only)
    // Features:
    // - Versioning for content recovery
    // - Intelligent-Tiering for cost optimisation
    // - Lifecycle rules for old versions
    // - CORS configuration for Next.js image uploads
    //
    // ========================================================================

    const assetsBucketConstruct = new S3BucketConstruct(this, "AssetsBucket", {
      envName,
      config: {
        bucketName: `${projectName}-article-assets-${envName}`,
        purpose: "article-assets",
        versioned: true,
        encryption: s3.BucketEncryption.S3_MANAGED,
        blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
        
        // Cost optimisation: Automatically move objects to cheaper storage
        lifecycleRules: [
          {
            id: "archive-old-versions",
            enabled: true,
            noncurrentVersionExpiration: cdk.Duration.days(isProduction ? 90 : 30),
            transitions: isProduction
              ? [
                  {
                    storageClass: s3.StorageClass.INTELLIGENT_TIERING,
                    transitionAfter: cdk.Duration.days(0), // Immediate
                  },
                ]
              : undefined,
          },
          {
            id: "delete-incomplete-uploads",
            enabled: true,
            abortIncompleteMultipartUploadAfter: cdk.Duration.days(7),
          },
        ],
        
        // CORS configuration for Next.js uploads
        cors: [
          {
            allowedMethods: [
              s3.HttpMethods.GET,
              s3.HttpMethods.PUT,
              s3.HttpMethods.POST,
            ],
            allowedOrigins: isProduction
              ? ["https://yourportfolio.com"] // Replace with your domain
              : ["http://localhost:3000", "https://*.vercel.app"],
            allowedHeaders: ["*"],
            maxAge: 3000,
          },
        ],
        
        removalPolicy: isProduction
          ? cdk.RemovalPolicy.RETAIN
          : cdk.RemovalPolicy.DESTROY,
        autoDeleteObjects: !isProduction, // Safe cleanup in non-production
      },
    });

    this.assetsBucket = assetsBucketConstruct.bucket;

    // ========================================================================
    // ARTICLES TABLE - Single Table Design
    // ========================================================================
    //
    // Schema Design (based on DYNAMODB_ARTICLES_MIGRATION.md):
    //
    // Primary Key:
    // - pk: ARTICLE#<slug>
    // - sk: METADATA | CONTENT#v<version>
    //
    // GSI1 - Query by Status and Date:
    // - gsi1pk: STATUS#<status> (published|draft|archived)
    // - gsi1sk: <date>#<slug> (ISO date for sorting)
    // - Use case: List published articles sorted by date
    //
    // GSI2 - Query by Tag:
    // - gsi2pk: TAG#<tag>
    // - gsi2sk: <date>#<slug>
    // - Use case: Filter articles by tag (e.g., TAG#aws, TAG#devops)
    //
    // Example Metadata Item:
    // {
    //   pk: "ARTICLE#aws-devops-pro-exam",
    //   sk: "METADATA",
    //   entityType: "ARTICLE_METADATA",
    //   slug: "aws-devops-pro-exam",
    //   title: "AWS DevOps Pro Exam Guide",
    //   description: "Comprehensive guide...",
    //   author: "Nelson Lamounier",
    //   date: "2025-01-20",
    //   status: "published",
    //   tags: ["aws", "certification", "devops"],
    //   category: "AWS Certification",
    //   readingTimeMinutes: 12,
    //   featuredImage: "s3://bucket/articles/featured.png",
    //   version: 1,
    //   gsi1pk: "STATUS#published",
    //   gsi1sk: "2025-01-20#aws-devops-pro-exam",
    //   gsi2pk: "TAG#aws", // Denormalised per tag
    //   gsi2sk: "2025-01-20#aws-devops-pro-exam",
    //   createdAt: "2025-01-20T10:00:00Z",
    //   updatedAt: "2025-01-20T10:00:00Z",
    //   publishedAt: "2025-01-20T15:00:00Z"
    // }
    //
    // Example Content Item:
    // {
    //   pk: "ARTICLE#aws-devops-pro-exam",
    //   sk: "CONTENT#v1",
    //   entityType: "ARTICLE_CONTENT",
    //   contentType: "mdx",
    //   content: "# Article content here...",
    //   componentData: [
    //     {
    //       componentId: "scenario-keywords-1",
    //       componentType: "ScenarioKeywords",
    //       props: { keywords: [...] }
    //     }
    //   ],
    //   images: [
    //     {
    //       id: "spider-method",
    //       s3Key: "articles/aws-devops-pro/SPIDER_Method.jpeg",
    //       alt: "Spider method diagram",
    //       width: 800,
    //       height: 600
    //     }
    //   ],
    //   version: 1,
    //   createdAt: "2025-01-20T10:00:00Z"
    // }
    //
    // ========================================================================

    const articlesTableConstruct = new DynamoDbTableConstruct(
      this,
      "ArticlesTable",
      {
        envName,
        projectName,
        tableName: "articles",
        partitionKey: {
          name: "pk",
          type: dynamodb.AttributeType.STRING,
        },
        sortKey: {
          name: "sk",
          type: dynamodb.AttributeType.STRING,
        },
        
        // Define additional attributes for GSIs
        additionalAttributes: [
          {
            name: "gsi1pk",
            type: dynamodb.AttributeType.STRING,
          },
          {
            name: "gsi1sk",
            type: dynamodb.AttributeType.STRING,
          },
          {
            name: "gsi2pk",
            type: dynamodb.AttributeType.STRING,
          },
          {
            name: "gsi2sk",
            type: dynamodb.AttributeType.STRING,
          },
        ],
        
        // GSI1: Query by status and date
        // Use case: List all published articles sorted by date
        // Query: gsi1pk = "STATUS#published" ORDER BY gsi1sk DESC
        globalSecondaryIndexes: [
          {
            indexName: "gsi1-status-date",
            partitionKey: "gsi1pk",
            sortKey: "gsi1sk",
            projectionType: dynamodb.ProjectionType.ALL,
          },
          // GSI2: Query by tag
          // Use case: Filter articles by tag (e.g., "TAG#aws")
          // Query: gsi2pk = "TAG#aws" ORDER BY gsi2sk DESC
          // Note: Requires denormalised entries per tag per article
          {
            indexName: "gsi2-tag-date",
            partitionKey: "gsi2pk",
            sortKey: "gsi2sk",
            projectionType: dynamodb.ProjectionType.ALL,
          },
        ],
        
        // On-demand billing - best for variable workloads
        // Portfolio sites typically have unpredictable traffic patterns
        billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,

        // Point-in-time recovery - enabled in production only
        // Cost: ~20% of table storage costs
        // Benefit: Restore to any point within last 35 days
        pointInTimeRecovery: isProduction,

        // AWS managed encryption (default) - no additional cost
        // For compliance requirements, use CUSTOMER_MANAGED with KMS key
        encryption: dynamodb.TableEncryption.AWS_MANAGED,

        // Deletion protection - prevent accidental deletion in production
        deletionProtection: isProduction,

        // Removal policy
        // Production: Retain table when stack is deleted
        // Non-production: Allow cleanup when stack is deleted
        removalPolicy: isProduction
          ? cdk.RemovalPolicy.RETAIN
          : cdk.RemovalPolicy.DESTROY,

        // DynamoDB Streams - enable for change data capture
        // Use cases:
        // - Trigger Lambda on article publish/update
        // - Sync to OpenSearch for full-text search
        // - Analytics and audit logging
        // - Real-time notifications
        stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,

        // Time To Live - enable if you have expiring data
        // Use case: Auto-delete draft articles after 90 days
        // timeToLive: {
        //   attributeName: 'ttl',
        //   enabled: true,
        // },

        // Custom tags
        tags: {
          Purpose: "Article storage for portfolio Next.js application",
          DataClassification: "Public",
          Application: "Portfolio",
        },
      }
    );

    this.articlesTable = articlesTableConstruct.table;

    // ========================================================================
    // FUTURE: ADD MORE TABLES HERE
    // ========================================================================
    //
    // Examples of additional tables you might need:
    //
    // 1. Users Table
    // const usersTable = new DynamoDbTableConstruct(this, 'UsersTable', {
    //   envName,
    //   projectName,
    //   tableName: 'users',
    //   partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING }, // USER#<userId>
    //   sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING }, // PROFILE | SESSION#<sessionId>
    // });
    //
    // 2. Sessions Table (for authentication)
    // const sessionsTable = new DynamoDbTableConstruct(this, 'SessionsTable', {
    //   envName,
    //   projectName,
    //   tableName: 'sessions',
    //   partitionKey: { name: 'sessionId', type: dynamodb.AttributeType.STRING },
    //   timeToLive: {
    //     attributeName: 'ttl',
    //     enabled: true,
    //   },
    // });
    //
    // 3. Analytics Table
    // const analyticsTable = new DynamoDbTableConstruct(this, 'AnalyticsTable', {
    //   envName,
    //   projectName,
    //   tableName: 'analytics',
    //   partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING }, // ARTICLE#<slug>
    //   sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING }, // VIEW#<timestamp>
    //   timeToLive: {
    //     attributeName: 'ttl',
    //     enabled: true, // Auto-delete old analytics data
    //   },
    // });

    // ========================================================================
    // CDK NAG SUPPRESSIONS & TAGS
    // ========================================================================

    SuppressionManager.applyToStack(this, "WebappDynamoDbStack", envName);
    cdk.Tags.of(this).add("Stack", "WebappDynamoDB");
    cdk.Tags.of(this).add("Project", projectName);
    cdk.Tags.of(this).add("Environment", envName);
    cdk.Tags.of(this).add("Layer", "Database");
    cdk.Tags.of(this).add("ManagedBy", "CDK");

    // ========================================================================
    // STACK OUTPUTS
    // ========================================================================

    const shouldExport = !envName.includes("pipeline");
    const exportPrefix = `${envName}-${projectName}`;

    // DynamoDB Table Outputs
    new cdk.CfnOutput(this, "ArticlesTableName", {
      value: this.articlesTable.tableName,
      description: "DynamoDB table name for portfolio articles",
      ...(shouldExport && {
        exportName: `${exportPrefix}-articles-table-name`,
      }),
    });

    new cdk.CfnOutput(this, "ArticlesTableArn", {
      value: this.articlesTable.tableArn,
      description: "DynamoDB table ARN for IAM policies",
      ...(shouldExport && {
        exportName: `${exportPrefix}-articles-table-arn`,
      }),
    });

    // GSI Outputs - Important for Lambda queries
    new cdk.CfnOutput(this, "ArticlesTableGsi1Name", {
      value: "gsi1-status-date",
      description: "GSI1 name for querying articles by status and date",
      ...(shouldExport && {
        exportName: `${exportPrefix}-articles-gsi1-name`,
      }),
    });

    new cdk.CfnOutput(this, "ArticlesTableGsi2Name", {
      value: "gsi2-tag-date",
      description: "GSI2 name for querying articles by tag",
      ...(shouldExport && {
        exportName: `${exportPrefix}-articles-gsi2-name`,
      }),
    });

    // Stream ARN - For Lambda triggers and change data capture
    if (this.articlesTable.tableStreamArn) {
      new cdk.CfnOutput(this, "ArticlesTableStreamArn", {
        value: this.articlesTable.tableStreamArn,
        description: "DynamoDB stream ARN for Lambda triggers and CDC",
        ...(shouldExport && {
          exportName: `${exportPrefix}-articles-stream-arn`,
        }),
      });
    }

    // S3 Assets Bucket Outputs
    new cdk.CfnOutput(this, "AssetsBucketName", {
      value: this.assetsBucket.bucketName,
      description: "S3 bucket name for article images and media",
      ...(shouldExport && {
        exportName: `${exportPrefix}-assets-bucket-name`,
      }),
    });

    new cdk.CfnOutput(this, "AssetsBucketArn", {
      value: this.assetsBucket.bucketArn,
      description: "S3 bucket ARN for IAM policies",
      ...(shouldExport && {
        exportName: `${exportPrefix}-assets-bucket-arn`,
      }),
    });

    new cdk.CfnOutput(this, "AssetsBucketRegionalDomainName", {
      value: this.assetsBucket.bucketRegionalDomainName,
      description: "S3 bucket regional domain name for CloudFront origin",
      ...(shouldExport && {
        exportName: `${exportPrefix}-assets-bucket-domain`,
      }),
    });
  }
}
