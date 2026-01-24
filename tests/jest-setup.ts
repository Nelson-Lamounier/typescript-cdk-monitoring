/** @format */

// Jest setup file for CDK infrastructure tests
// This file runs before each test suite

// Set default environment variables for CDK tests
// These prevent CDK from trying to look up real AWS account/region during synthesis
// CDK requires these to be set when synthesising stacks in tests
if (!process.env.CDK_DEFAULT_ACCOUNT) {
  process.env.CDK_DEFAULT_ACCOUNT = "123456789012";
}

if (!process.env.CDK_DEFAULT_REGION) {
  process.env.CDK_DEFAULT_REGION = "eu-west-1";
}

// Suppress AWS SDK credential warnings during tests
// Tests don't need real AWS credentials for CDK synthesis
process.env.AWS_REGION = process.env.AWS_REGION || "eu-west-1";

// Suppress CDK Docker output during tests
// CDK uses Docker for bundling Lambda functions and other containerized resources
// Setting these to false suppresses verbose Docker build output
process.env.CDK_DOCKER_VERBOSE = "false";
process.env.CDK_DEBUG = "false";

// Suppress CDK asset bundling output
// This prevents Docker build logs from cluttering test output
process.env.CDK_ASSET_VERBOSE = "false";

// Enable Docker BuildKit but suppress verbose output
// BuildKit is faster but we use quiet progress to reduce output clutter
process.env.DOCKER_BUILDKIT = "1";
process.env.BUILDKIT_PROGRESS = "quiet";
