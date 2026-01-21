/** @format */

import {
  DynamoDBClient,
  GetItemCommand,
  GetItemCommandInput,
  QueryCommand,
  QueryCommandInput,
} from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  Context,
} from "aws-lambda";

// ========================================================================
// ENVIRONMENT VARIABLES
// ========================================================================

const TABLE_NAME = process.env.TABLE_NAME || "";
const REGION = process.env.AWS_REGION || "eu-west-1";

// ========================================================================
// AWS SDK CLIENTS
// ========================================================================

const dynamoClient = new DynamoDBClient({ region: REGION });

// ========================================================================
// TYPES
// ========================================================================

interface ArticleMetadata {
  pk: string;
  sk: string;
  entityType: string;
  slug: string;
  title: string;
  description: string;
  author: string;
  date: string;
  status: "draft" | "published" | "archived";
  tags: string[];
  category: string;
  readingTimeMinutes: number;
  featuredImage?: string;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  version: number;
  gsi1pk: string;
  gsi1sk: string;
}

interface ArticleContent {
  pk: string;
  sk: string;
  entityType: string;
  contentType: "mdx" | "markdown" | "html";
  content: string;
  contentS3Key?: string;
  componentData?: Array<{
    componentId: string;
    componentType: string;
    position: number;
    props: Record<string, unknown>;
  }>;
  images: Array<{
    id: string;
    s3Key: string;
    alt: string;
    caption?: string;
    width?: number;
    height?: number;
  }>;
  version: number;
  createdAt: string;
  changelog?: string;
}

interface ArticleResponse {
  metadata: ArticleMetadata;
  content: ArticleContent;
}

// ========================================================================
// HELPER FUNCTIONS
// ========================================================================

/**
 * Create standardised API response
 */
function createResponse(
  statusCode: number,
  body: object | string,
  headers?: Record<string, string>
): APIGatewayProxyResult {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*", // Configure per environment
      "Access-Control-Allow-Credentials": "true",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  };
}

/**
 * Create error response
 */
function createErrorResponse(
  statusCode: number,
  error: string,
  details?: string
): APIGatewayProxyResult {
  return createResponse(statusCode, {
    error,
    details,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Validate required environment variables
 */
function validateEnvironment(): string | null {
  if (!TABLE_NAME) {
    return "TABLE_NAME environment variable is not set";
  }
  return null;
}

/**
 * Extract slug from path parameters
 */
function extractSlug(event: APIGatewayProxyEvent): string | null {
  return event.pathParameters?.slug || null;
}

// ========================================================================
// LAMBDA HANDLER: GET ARTICLE BY SLUG
// ========================================================================

/**
 * Get article by slug - Retrieves both metadata and latest content
 *
 * GET /articles/{slug}
 *
 * Returns:
 * - 200: Article found with metadata and content
 * - 404: Article not found or not published
 * - 500: Internal server error
 *
 * Query Pattern:
 * 1. Get metadata: pk="ARTICLE#<slug>", sk="METADATA"
 * 2. Query content: pk="ARTICLE#<slug>", sk begins_with "CONTENT#v"
 * 3. Return latest content version
 *
 * @param event - API Gateway event
 * @param context - Lambda context
 */
export async function handler(
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> {
  console.log("Event:", JSON.stringify(event, null, 2));
  console.log("Context:", JSON.stringify(context, null, 2));

  // Validate environment
  const envError = validateEnvironment();
  if (envError) {
    console.error("Environment validation failed:", envError);
    return createErrorResponse(500, "Internal server error", envError);
  }

  // Extract slug from path parameters
  const slug = extractSlug(event);
  if (!slug) {
    return createErrorResponse(
      400,
      "Bad Request",
      "Slug is required in path parameters"
    );
  }

  try {
    // ========================================
    // FETCH METADATA
    // ========================================

    const metadataParams: GetItemCommandInput = {
      TableName: TABLE_NAME,
      Key: {
        pk: { S: `ARTICLE#${slug}` },
        sk: { S: "METADATA" },
      },
    };

    console.log("Fetching metadata:", JSON.stringify(metadataParams, null, 2));

    const metadataResult = await dynamoClient.send(
      new GetItemCommand(metadataParams)
    );

    if (!metadataResult.Item) {
      console.warn(`Article not found: ${slug}`);
      return createErrorResponse(404, "Not Found", `Article '${slug}' not found`);
    }

    const metadata = unmarshall(metadataResult.Item) as ArticleMetadata;

    // Only return published articles (unless admin query param provided)
    const isAdmin = event.queryStringParameters?.admin === "true";
    if (!isAdmin && metadata.status !== "published") {
      console.warn(`Article not published: ${slug}, status: ${metadata.status}`);
      return createErrorResponse(404, "Not Found", `Article '${slug}' not found`);
    }

    // ========================================
    // FETCH LATEST CONTENT
    // ========================================

    const contentParams: QueryCommandInput = {
      TableName: TABLE_NAME,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
      ExpressionAttributeValues: {
        ":pk": { S: `ARTICLE#${slug}` },
        ":sk": { S: "CONTENT#v" },
      },
      ScanIndexForward: false, // Latest version first (descending sort)
      Limit: 1,
    };

    console.log("Fetching content:", JSON.stringify(contentParams, null, 2));

    const contentResult = await dynamoClient.send(
      new QueryCommand(contentParams)
    );

    if (!contentResult.Items || contentResult.Items.length === 0) {
      console.warn(`No content found for article: ${slug}`);
      return createErrorResponse(
        404,
        "Not Found",
        `Content not found for article '${slug}'`
      );
    }

    const content = unmarshall(contentResult.Items[0]) as ArticleContent;

    // ========================================
    // BUILD RESPONSE
    // ========================================

    const response: ArticleResponse = {
      metadata,
      content,
    };

    console.log(`Successfully retrieved article: ${slug}`);

    return createResponse(200, response, {
      "Cache-Control": "public, max-age=300, stale-while-revalidate=60",
    });
  } catch (error) {
    console.error("Error fetching article:", error);

    // Handle specific AWS SDK errors
    if (error instanceof Error) {
      return createErrorResponse(500, "Internal server error", error.message);
    }

    return createErrorResponse(
      500,
      "Internal server error",
      "An unknown error occurred"
    );
  }
}
