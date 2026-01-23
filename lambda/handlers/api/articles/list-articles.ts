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
  ListArticlesResponse,
} from "../../../shared/types/articles-types";

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
    100, // Maximum 100 items per page
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
      unmarshall(item),
    ) as ArticleMetadata[];

    // Generate next token if there are more results
    let responseNextToken: string | undefined;
    if (result.LastEvaluatedKey) {
      responseNextToken = Buffer.from(
        JSON.stringify(result.LastEvaluatedKey),
      ).toString("base64");
    }

    const response: ListArticlesResponse = {
      articles,
      count: articles.length,
      ...(responseNextToken && { nextToken: responseNextToken }),
    };

    console.log(
      `Successfully retrieved ${articles.length} articles (status: ${status})`,
    );

    return createCachedResponse(response);
  } catch (error) {
    console.error("Error listing articles:", error);

    // Handle specific AWS SDK errors
    if (error instanceof Error) {
      return createInternalServerErrorResponse(error);
    }

    return createInternalServerErrorResponse("An unknown error occurred");
  }
}
