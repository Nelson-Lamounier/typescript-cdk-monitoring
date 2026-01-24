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

import {
  createCachedResponse,
  createBadRequestResponse,
  createInternalServerErrorResponse,
  createResponse,
} from "../../../shared/api-response";
import {
  ArticleMetadata,
  ListArticlesByTagResponse,
} from "../../../shared/types/articles-types";

// ========================================================================
// ENVIRONMENT VARIABLES
// ========================================================================

const TABLE_NAME = process.env.TABLE_NAME || "";
const REGION = process.env.AWS_REGION || "eu-west-1";
const GSI2_NAME = process.env.GSI2_NAME || "gsi2-tag-date";

// ========================================================================
// AWS SDK CLIENTS
// ========================================================================

const dynamoClient = new DynamoDBClient({ region: REGION });

// ========================================================================
// HELPER FUNCTIONS
// ========================================================================

/**
 * Validate required environment variables
 */
function validateEnvironment(): string | null {
  if (!TABLE_NAME) {
    return "TABLE_NAME environment variable is not set";
  }
  if (!GSI2_NAME) {
    return "GSI2_NAME environment variable is not set";
  }
  return null;
}

/**
 * Extract tag from path parameters
 */
function extractTag(event: APIGatewayProxyEvent): string | null {
  return event.pathParameters?.tag || null;
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
    100, // Maximum 100 items per page
  );
  const nextToken = queryParams.nextToken;

  return { limit, nextToken };
}

// ========================================================================
// LAMBDA HANDLER: LIST ARTICLES BY TAG
// ========================================================================

/**
 * List articles by tag with pagination
 *
 * GET /articles/tag/{tag}
 *
 * Query Parameters:
 * - limit: Number of items per page (1-100) - default: 10
 * - nextToken: Pagination token from previous response
 *
 * Returns:
 * - 200: List of articles for the tag
 * - 400: Invalid query parameters or missing tag
 * - 500: Internal server error
 *
 * Query Pattern:
 * Uses GSI2 (gsi2-tag-date) to query articles by tag
 * - gsi2pk = "TAG#<tag>"
 * - gsi2sk = "<date>#<slug>" (sorted by date descending)
 *
 * Note: For each tag on an article, a separate item exists in GSI2
 * This enables efficient tag-based queries
 *
 * @param event - API Gateway event
 * @param context - Lambda context
 */
export const handler = async (
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> => {
  console.log("Event:", JSON.stringify(event, null, 2));
  console.log("Context:", JSON.stringify(context, null, 2));

  // Validate environment
  const envError = validateEnvironment();
  if (envError) {
    console.error("Environment validation failed:", envError);
    return createInternalServerErrorResponse(envError);
  }

  // Extract tag from path parameters
  const tag = extractTag(event);
  if (!tag) {
    return createBadRequestResponse(
      "Bad Request",
      "Tag is required in path parameters",
    );
  }

  // Decode tag (URL encoded)
  const decodedTag = decodeURIComponent(tag);

  // Parse query parameters
  const { limit, nextToken } = parsePaginationParams(event);

  try {
    // ========================================
    // QUERY ARTICLES BY TAG
    // ========================================

    const queryParams: QueryCommandInput = {
      TableName: TABLE_NAME,
      IndexName: GSI2_NAME,
      KeyConditionExpression: "gsi2pk = :gsi2pk",
      ExpressionAttributeValues: {
        ":gsi2pk": { S: `TAG#${decodedTag}` },
      },
      ScanIndexForward: false, // Latest first (descending by date)
      Limit: limit,
    };

    // Add pagination token if provided
    if (nextToken) {
      try {
        queryParams.ExclusiveStartKey = JSON.parse(
          Buffer.from(nextToken, "base64").toString("utf-8"),
        );
      } catch (error) {
        console.error("Invalid pagination token:", error);
        return createBadRequestResponse(
          "Bad Request",
          "Invalid pagination token",
        );
      }
    }

    console.log(
      "Querying articles by tag:",
      JSON.stringify(queryParams, null, 2),
    );

    const result = await dynamoClient.send(new QueryCommand(queryParams));

    if (!result.Items || result.Items.length === 0) {
      return createResponse(200, {
        tag: decodedTag,
        articles: [],
        count: 0,
      });
    }

    // ========================================
    // PROCESS RESULTS
    // ========================================

    const articles = result.Items.map((item) =>
      unmarshall(item),
    ) as ArticleMetadata[];

    // Filter out non-published articles (unless admin mode)
    const isAdmin = event.queryStringParameters?.admin === "true";
    const filteredArticles = isAdmin
      ? articles
      : articles.filter((article) => article.status === "published");

    // Generate next token if there are more results
    let responseNextToken: string | undefined;
    if (result.LastEvaluatedKey) {
      responseNextToken = Buffer.from(
        JSON.stringify(result.LastEvaluatedKey),
      ).toString("base64");
    }

    const response: ListArticlesByTagResponse = {
      tag: decodedTag,
      articles: filteredArticles,
      count: filteredArticles.length,
      ...(responseNextToken && { nextToken: responseNextToken }),
    };

    console.log(
      `Successfully retrieved ${filteredArticles.length} articles for tag: ${decodedTag}`,
    );

    return createCachedResponse(response);
  } catch (error) {
    console.error("Error listing articles by tag:", error);

    // Handle specific AWS SDK errors
    if (error instanceof Error) {
      return createInternalServerErrorResponse(error);
    }

    return createInternalServerErrorResponse("An unknown error occurred");
  }
}
