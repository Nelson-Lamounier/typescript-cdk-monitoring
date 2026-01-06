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
