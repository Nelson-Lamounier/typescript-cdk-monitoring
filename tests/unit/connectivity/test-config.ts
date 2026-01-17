/** @format */

/**
 * Centralised Configuration and Types for Connectivity Integration Tests
 *
 * This module provides shared configuration, types, and utilities for all
 * connectivity integration tests to eliminate code duplication and ensure
 * consistency across test suites.
 *
 * @module tests/unit/connectivity/test-config
 */

import * as cdk from "aws-cdk-lib";
import * as logs from "aws-cdk-lib/aws-logs";

import { NetworkingStack } from "../../../lib/stacks/foundation/networking-stack";
import { MonitoringEfsStack } from "../../../lib/stacks/monitoring/efs-stack";
import { MonitoringInfraStack } from "../../../lib/stacks/monitoring/infra-stack";
import { MonitoringServiceStack } from "../../../lib/stacks/monitoring/service-stack";
import {
  AWS_CONFIG,
  ENVIRONMENT_CONFIG,
  PROJECT_CONFIG,
  NETWORK_CONFIG,
  CAPACITY_CONFIG,
  RESOURCE_TYPES,
} from "../shared/constants";

// Re-export all constants from shared constants file for backward compatibility
export {
  AWS_CONFIG,
  NETWORK_CONFIG,
  ENVIRONMENT_CONFIG,
  PROJECT_CONFIG,
  CAPACITY_CONFIG,
  PORT_CONFIG,
  RESOURCE_TYPES,
  TAG_KEYS,
  SUBNET_TYPES,
} from "../shared/constants";

// ============================================================================
// TYPES
// ============================================================================

/**
 * Complete stack hierarchy for connectivity testing
 */
export interface ConnectivityTestStacks {
  app: cdk.App;
  networkingStack: NetworkingStack;
  efsStack: MonitoringEfsStack;
  infraStack: MonitoringInfraStack;
  serviceStack: MonitoringServiceStack;
}

/**
 * Test configuration options
 */
export interface TestConfigOptions {
  account?: string;
  region?: string;
  environment?: string;
  projectName?: string;
  vpcCidr?: string;
  allowedCidr?: string;
  enableVpcFlowLogs?: boolean;
  flowLogRetention?: logs.RetentionDays;
  minCapacity?: number;
  desiredCapacity?: number;
  maxCapacity?: number;
}

/**
 * Resolved test configuration
 */
export interface ResolvedTestConfig {
  account: string;
  region: string;
  environment: string;
  projectName: string;
  vpcCidr: string;
  allowedCidr: string;
  enableVpcFlowLogs: boolean;
  flowLogRetention: logs.RetentionDays;
  minCapacity: number;
  desiredCapacity: number;
  maxCapacity: number;
}

/**
 * Subnet CIDR information
 */
export interface SubnetCidrs {
  publicSubnets: string[];
  privateSubnets: string[];
}

// Note: Additional shared types are now defined in ../types/test-types.ts
// Import from there for SubnetProperties, RouteProperties, etc.

// ============================================================================
// DEFAULT CONFIGURATION
// ============================================================================

/**
 * Default test configuration
 */
export const DEFAULT_TEST_CONFIG: ResolvedTestConfig = {
  account: AWS_CONFIG.ACCOUNT,
  region: AWS_CONFIG.REGION,
  environment: ENVIRONMENT_CONFIG.DEVELOPMENT,
  projectName: PROJECT_CONFIG.NAME,
  vpcCidr: NETWORK_CONFIG.VPC_CIDR,
  allowedCidr: NETWORK_CONFIG.ALLOWED_CIDR,
  enableVpcFlowLogs: true,
  flowLogRetention: PROJECT_CONFIG.FLOW_LOG_RETENTION,
  minCapacity: CAPACITY_CONFIG.MIN,
  desiredCapacity: CAPACITY_CONFIG.DESIRED,
  maxCapacity: CAPACITY_CONFIG.MAX,
} as const;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Resolve test configuration with defaults
 *
 * @param options - Partial test configuration
 * @returns Resolved configuration with all values
 */
export function resolveTestConfig(
  options: TestConfigOptions = {}
): ResolvedTestConfig {
  return {
    ...DEFAULT_TEST_CONFIG,
    ...options,
  };
}

/**
 * Create CDK environment configuration
 *
 * @param config - Test configuration
 * @returns CDK environment object
 */
export function createCdkEnv(
  config: ResolvedTestConfig = DEFAULT_TEST_CONFIG
): cdk.Environment {
  return {
    account: config.account,
    region: config.region,
  };
}

/**
 * Validate required configuration
 *
 * @param config - Configuration to validate
 * @throws Error if configuration is invalid
 */
export function validateTestConfig(config: ResolvedTestConfig): void {
  if (!config.account || !config.account.match(/^\d{12}$/)) {
    throw new Error(`Invalid AWS account: ${config.account}`);
  }

  if (!config.region) {
    throw new Error("AWS region is required");
  }

  if (!config.vpcCidr || !config.vpcCidr.match(/^\d+\.\d+\.\d+\.\d+\/\d+$/)) {
    throw new Error(`Invalid VPC CIDR: ${config.vpcCidr}`);
  }

  if (config.minCapacity > config.desiredCapacity) {
    throw new Error(
      `Min capacity (${config.minCapacity}) cannot exceed desired capacity (${config.desiredCapacity})`
    );
  }

  if (config.desiredCapacity > config.maxCapacity) {
    throw new Error(
      `Desired capacity (${config.desiredCapacity}) cannot exceed max capacity (${config.maxCapacity})`
    );
  }
}

/**
 * Check if value is within valid range
 *
 * @param value - Value to check
 * @param min - Minimum value
 * @param max - Maximum value
 * @returns True if within range
 */
export function isInRange(value: number, min: number, max: number): boolean {
  return value >= min && value <= max;
}

/**
 * Check if CIDR is within VPC range
 *
 * @param cidr - CIDR to check
 * @param vpcCidr - VPC CIDR
 * @returns True if CIDR is within VPC range
 */
export function isCidrInRange(cidr: string, vpcCidr: string): boolean {
  // Simple check - in production would use proper IP calculation
  const cidrBase = cidr.split("/")[0].split(".").slice(0, 2).join(".");
  const vpcBase = vpcCidr.split("/")[0].split(".").slice(0, 2).join(".");
  return cidrBase === vpcBase;
}

/**
 * Get resource type name (user-friendly)
 *
 * @param resourceType - CloudFormation resource type
 * @returns User-friendly name
 */
export function getResourceTypeName(resourceType: string): string {
  const typeMap: Record<string, string> = {
    [RESOURCE_TYPES.VPC]: "VPC",
    [RESOURCE_TYPES.SUBNET]: "Subnet",
    [RESOURCE_TYPES.SECURITY_GROUP]: "Security Group",
    [RESOURCE_TYPES.EFS_FILE_SYSTEM]: "EFS File System",
    [RESOURCE_TYPES.ECS_CLUSTER]: "ECS Cluster",
    [RESOURCE_TYPES.ALB]: "Application Load Balancer",
  };

  return typeMap[resourceType] || resourceType;
}

// ============================================================================
// STACK CONFIGURATION FOR TESTING
// ============================================================================

/**
 * Stack names that contain IAM roles for security testing
 * Update this array when new stacks with IAM roles are added
 */
export const IAM_TEST_STACKS: ReadonlyArray<
  keyof Omit<ConnectivityTestStacks, "app">
> = [
  "networkingStack",
  "efsStack",
  "infraStack",
  "serviceStack",
] as const;

/**
 * Stack names that contain networking resources for testing
 * Update this array when new networking stacks are added
 */
export const NETWORKING_TEST_STACKS: ReadonlyArray<
  keyof Omit<ConnectivityTestStacks, "app">
> = [
  "networkingStack",
  "efsStack",
  "infraStack",
] as const;

/**
 * Stack names that contain monitoring/logging resources for testing
 * Update this array when new monitoring stacks are added
 */
export const MONITORING_TEST_STACKS: ReadonlyArray<
  keyof Omit<ConnectivityTestStacks, "app">
> = [
  "networkingStack",
  "infraStack",
  "serviceStack",
] as const;

/**
 * Stack names that contain CloudFormation exports for testing
 * Update this array when new stacks with exports are added
 */
export const EXPORT_TEST_STACKS: ReadonlyArray<
  keyof Omit<ConnectivityTestStacks, "app">
> = [
  "networkingStack",
  "efsStack",
  "infraStack",
] as const;

/**
 * Stack names that contain EC2 instances, launch templates, and Auto Scaling Groups for testing
 * Update this array when new stacks with EC2 instances are added
 */
export const INSTANCE_TEST_STACKS: ReadonlyArray<
  keyof Omit<ConnectivityTestStacks, "app">
> = [
  "infraStack",
] as const;

/**
 * Stack names that contain storage resources (EFS, EBS, S3) for testing
 * Update this array when new stacks with storage resources are added
 */
export const STORAGE_TEST_STACKS: ReadonlyArray<
  keyof Omit<ConnectivityTestStacks, "app">
> = [
  "efsStack",
] as const;
