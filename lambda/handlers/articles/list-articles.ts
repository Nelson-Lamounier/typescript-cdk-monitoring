/** @format */

import {
  DynamoDBClient,
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
const GSI1_NAME = process.env.GSI1_NAME || "gsi1-status-date";

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

interface ListArticlesResponse {
  articles: ArticleMetadata[];
  nextToken?: string;
  count: number;
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
  if (!GSI1_NAME) {
    return "GSI1_NAME environment variable is not set";
  }
  return null;
}

/**
 * Parse pagination parameters from query string
 */
function parsePaginationParams(event: APIGatewayProxyEvent): {
  limit: number;
  nextToken?: string;
} {
  const queryParams = event.queryStringParameters || {};
  const limit = Math.min(
    parseInt(queryParams.limit || "10", 10),
    100 // Maximum 100 items per page
  );
  const nextToken = queryParams.nextToken;

  return { limit, nextToken };
}

/**
 * Parse status filter from query string
 */
function parseStatusFilter(event: APIGatewayProxyEvent): string {
  const queryParams = event.queryStringParameters || {};
  const status = queryParams.status || "published";

  // Validate status
  const validStatuses = ["draft", "published", "archived"];
  if (!validStatuses.includes(status)) {
    return "published";
  }

  return status;
}

// ========================================================================
// LAMBDA HANDLER: LIST ARTICLES
// ========================================================================

/**
 * List articles with pagination and filtering
 *
 * GET /articles
 *
 * Query Parameters:
 * - status: Filter by status (draft|published|archived) - default: published
 * - limit: Number of items per page (1-100) - default: 10
 * - nextToken: Pagination token from previous response
 *
 * Returns:
 * - 200: List of articles with pagination
 * - 400: Invalid query parameters
 * - 500: Internal server error
 *
 * Query Pattern:
 * Uses GSI1 (gsi1-status-date) to query articles by status
 * - gsi1pk = "STATUS#<status>"
 * - gsi1sk = "<date>#<slug>" (sorted by date descending)
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

  // Parse query parameters
  const { limit, nextToken } = parsePaginationParams(event);
  const status = parseStatusFilter(event);

  try {
    // ========================================
    // QUERY ARTICLES BY STATUS
    // ========================================

    const queryParams: QueryCommandInput = {
      TableName: TABLE_NAME,
      IndexName: GSI1_NAME,
      KeyConditionExpression: "gsi1pk = :gsi1pk",
      ExpressionAttributeValues: {
        ":gsi1pk": { S: `STATUS#${status}` },
      },
      ScanIndexForward: false, // Latest first (descending by date)
      Limit: limit,
    };

    // Add pagination token if provided
    if (nextToken) {
      try {
        queryParams.ExclusiveStartKey = JSON.parse(
          Buffer.from(nextToken, "base64").toString("utf-8")
        );
      } catch (error) {
        console.error("Invalid pagination token:", error);
        return createErrorResponse(
          400,
          "Bad Request",
          "Invalid pagination token"
        );
      }
    }

    console.log("Querying articles:", JSON.stringify(queryParams, null, 2));

    const result = await dynamoClient.send(new QueryCommand(queryParams));

    if (!result.Items) {
      return createResponse(200, {
        articles: [],
        count: 0,
      });
    }

    // ========================================
    // PROCESS RESULTS
    // ========================================

    const articles = result.Items.map((item) =>
      unmarshall(item)
    ) as ArticleMetadata[];

    // Generate next token if there are more results
    let responseNextToken: string | undefined;
    if (result.LastEvaluatedKey) {
      responseNextToken = Buffer.from(
        JSON.stringify(result.LastEvaluatedKey)
      ).toString("base64");
    }

    const response: ListArticlesResponse = {
      articles,
      count: articles.length,
      ...(responseNextToken && { nextToken: responseNextToken }),
    };

    console.log(
      `Successfully retrieved ${articles.length} articles (status: ${status})`
    );

    return createResponse(200, response, {
      "Cache-Control": "public, max-age=300, stale-while-revalidate=60",
    });
  } catch (error) {
    console.error("Error listing articles:", error);

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
