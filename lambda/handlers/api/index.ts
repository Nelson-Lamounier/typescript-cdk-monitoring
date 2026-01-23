/** @format */

import {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  Context,
} from "aws-lambda";

import {
  getArticleHandler,
  listArticlesHandler,
  listArticlesByTagHandler,
} from "./articles";

/**
 * API Gateway Routing Handler
 *
 * Routes API Gateway requests to the appropriate handler based on HTTP method and path parameters.
 *
 * Supported routes:
 * - GET /articles/{slug} → getArticleHandler (when pathParameters.slug exists)
 * - GET /articles/tag/{tag} → listArticlesByTagHandler (when pathParameters.tag exists)
 * - GET /articles → listArticlesHandler (default for /articles without path parameters)
 *
 * @param event - API Gateway proxy event
 * @param context - Lambda execution context
 * @returns API Gateway proxy result
 */
export const handler = async (
  event: APIGatewayProxyEvent,
  context: Context,
): Promise<APIGatewayProxyResult> => {
  const method = event.httpMethod;
  const pathParameters = event.pathParameters || {};

  // Route: GET /articles/tag/{tag}
  // Check for tag parameter first (more specific route)
  if (method === "GET" && pathParameters.tag) {
    return listArticlesByTagHandler(event, context);
  }

  // Route: GET /articles/{slug}
  // Check for slug parameter (specific article)
  if (method === "GET" && pathParameters.slug) {
    return getArticleHandler(event, context);
  }

  // Route: GET /articles
  // Default route for listing all articles (no path parameters)
  if (method === "GET") {
    return listArticlesHandler(event, context);
  }

  // Fallback: Return 405 Method Not Allowed for unsupported HTTP methods
  return {
    statusCode: 405,
    headers: {
      "Content-Type": "application/json",
      Allow: "GET",
    },
    body: JSON.stringify({
      message: "Method not allowed",
      method,
      allowedMethods: ["GET"],
    }),
  };
};
