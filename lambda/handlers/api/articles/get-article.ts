/** @format */
// To run the deploy-monitoring-dev workflow, change the handler to export async function handler(
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

import {
  createCachedResponse,
  createNotFoundResponse,
  createBadRequestResponse,
  createInternalServerErrorResponse,
} from "../../../shared/api-response";
import {
  ArticleMetadata,
  ArticleContent,
  ArticleResponse,
} from "../../../shared/types/articles-types";

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
export const handler = async (
  event: APIGatewayProxyEvent,
  context: Context,
): Promise<APIGatewayProxyResult> => {
  console.log("Event:", JSON.stringify(event, null, 2));
  console.log("Context:", JSON.stringify(context, null, 2));

  // Validate environment
  const envError = validateEnvironment();
  if (envError) {
    console.error("Environment validation failed:", envError);
    return createInternalServerErrorResponse(envError);
  }

  // Extract slug from path parameters
  const slug = extractSlug(event);
  if (!slug) {
    return createBadRequestResponse(
      "Bad Request",
      "Slug is required in path parameters",
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
      new GetItemCommand(metadataParams),
    );

    if (!metadataResult.Item) {
      console.warn(`Article not found: ${slug}`);
      return createNotFoundResponse("Article", slug);
    }

    const metadata = unmarshall(metadataResult.Item) as ArticleMetadata;

    // Only return published articles (unless admin query param provided)
    const isAdmin = event.queryStringParameters?.admin === "true";
    if (!isAdmin && metadata.status !== "published") {
      console.warn(
        `Article not published: ${slug}, status: ${metadata.status}`,
      );
      return createNotFoundResponse("Article", slug);
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
      new QueryCommand(contentParams),
    );

    if (!contentResult.Items || contentResult.Items.length === 0) {
      console.warn(`No content found for article: ${slug}`);
      return createNotFoundResponse("Content", slug);
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

    return createCachedResponse(response);
  } catch (error) {
    console.error("Error fetching article:", error);

    // Handle specific AWS SDK errors
    if (error instanceof Error) {
      return createInternalServerErrorResponse(error);
    }

    return createInternalServerErrorResponse("An unknown error occurred");
  }
};
