/** @format */

/**
 * Shared Type Definitions for Stack Tests
 *
 * Provides common type definitions used across all stack test suites
 * to eliminate code duplication and ensure type consistency.
 *
 * @module tests/unit/types/stack-test-types
 */

import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";

// ============================================================================
// TEST CONFIGURATION TYPES
// ============================================================================

/**
 * Base test configuration for stack tests
 */
export interface BaseTestConfig {
  account: string;
  region: string;
}

/**
 * Test environment configuration
 */
export interface TestEnvironment {
  account: string;
  region: string;
}

/**
 * VPC configuration for test fixtures
 */
export interface TestVpcConfig {
  cidr?: string;
  maxAzs?: number;
  natGateways?: number;
  subnetMask?: number;
}

// ============================================================================
// TEST FIXTURE TYPES
// ============================================================================

/**
 * Minimal stack properties for testing
 * Stack-specific test files should extend this with their stack props
 */
export interface BaseTestStackProps {
  env: cdk.Environment;
  envName: string;
  vpc: ec2.IVpc;
}

/**
 * Generic test stack creator function type
 */
export type TestStackCreator<TStack extends cdk.Stack, TProps extends BaseTestStackProps> = (
  app: cdk.App,
  id: string,
  props: TProps
) => TStack;

// ============================================================================
// TEST HELPER TYPES
// ============================================================================

/**
 * Overloaded createTestStack function signature
 * Supports both: createTestStack(app, id, props) and createTestStack(app, props)
 */
export interface CreateTestStackOverloads<
  TStack extends cdk.Stack,
  TProps extends BaseTestStackProps
> {
  (app: cdk.App, id: string, props: Partial<TProps>): TStack;
  (app: cdk.App, props?: Partial<TProps>): TStack;
}

// ============================================================================
// TEST CONSTANTS TYPES
// ============================================================================

/**
 * Resource count constants for test assertions
 */
export interface ResourceCounts {
  [resourceType: string]: number;
}

/**
 * Environment name constants
 */
export interface EnvironmentNames {
  DEVELOPMENT: string;
  PRODUCTION: string;
  STAGING: string;
  PIPELINE: string;
}

/**
 * Removal policy constants
 */
export interface RemovalPolicies {
  DELETE: string;
  RETAIN: string;
}

/**
 * Stack ID constants
 */
export interface StackIds {
  DEFAULT: string;
  VPC: string;
  MINIMAL: string;
  SNAPSHOT: string;
  ALL_PROPERTIES: string;
  DEV: string;
  PROD: string;
  [key: string]: string;
}
