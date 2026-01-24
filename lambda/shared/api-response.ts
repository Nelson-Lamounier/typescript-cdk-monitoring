/** @format */

/**
 * API Gateway Response Utilities
 *
 * Shared utility functions for creating consistent API Gateway responses
 * across all Lambda handlers.
 */

import { APIGatewayProxyResult } from "aws-lambda";

/**
 * Default CORS headers
 */
const DEFAULT_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*", // Configure per environment
  "Access-Control-Allow-Credentials": "true",
};

/**
 * Create standardised API response
 *
 * @param statusCode - HTTP status code
 * @param body - Response body (object or string)
 * @param headers - Additional headers to include
 */
export function createResponse(
  statusCode: number,
  body: object | string,
  headers?: Record<string, string>
): APIGatewayProxyResult {
  return {
    statusCode,
    headers: {
      ...DEFAULT_HEADERS,
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  };
}

/**
 * Create success response (200 OK)
 *
 * @param data - Response data
 * @param headers - Additional headers
 */
export function createSuccessResponse(
  data: object,
  headers?: Record<string, string>
): APIGatewayProxyResult {
  return createResponse(200, data, headers);
}

/**
 * Create created response (201 Created)
 *
 * @param data - Response data
 * @param headers - Additional headers
 */
export function createCreatedResponse(
  data: object,
  headers?: Record<string, string>
): APIGatewayProxyResult {
  return createResponse(201, data, headers);
}

/**
 * Create error response
 *
 * @param statusCode - HTTP status code
 * @param error - Error message
 * @param details - Additional error details
 */
export function createErrorResponse(
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
 * Create bad request response (400)
 *
 * @param message - Error message
 * @param details - Additional details
 */
export function createBadRequestResponse(
  message: string,
  details?: string
): APIGatewayProxyResult {
  return createErrorResponse(400, message, details);
}

/**
 * Create unauthorized response (401)
 *
 * @param message - Error message
 */
export function createUnauthorizedResponse(
  message: string = "Unauthorized"
): APIGatewayProxyResult {
  return createErrorResponse(401, message);
}

/**
 * Create forbidden response (403)
 *
 * @param message - Error message
 */
export function createForbiddenResponse(
  message: string = "Forbidden"
): APIGatewayProxyResult {
  return createErrorResponse(403, message);
}

/**
 * Create not found response (404)
 *
 * @param resource - Resource type that wasn't found
 * @param identifier - Resource identifier
 */
export function createNotFoundResponse(
  resource: string,
  identifier?: string
): APIGatewayProxyResult {
  const details = identifier
    ? `${resource} '${identifier}' not found`
    : `${resource} not found`;
  return createErrorResponse(404, "Not Found", details);
}

/**
 * Create internal server error response (500)
 *
 * @param error - Error object or message
 */
export function createInternalServerErrorResponse(
  error: Error | string
): APIGatewayProxyResult {
  const message = error instanceof Error ? error.message : error;
  return createErrorResponse(500, "Internal server error", message);
}

/**
 * Create cached response with Cache-Control header
 *
 * @param data - Response data
 * @param maxAge - Cache max-age in seconds
 * @param staleWhileRevalidate - stale-while-revalidate in seconds
 */
export function createCachedResponse(
  data: object,
  maxAge: number = 300,
  staleWhileRevalidate: number = 60
): APIGatewayProxyResult {
  return createResponse(200, data, {
    "Cache-Control": `public, max-age=${maxAge}, stale-while-revalidate=${staleWhileRevalidate}`,
  });
}
