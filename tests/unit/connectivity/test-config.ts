/** @format */

/**
 * Centralized Configuration and Types for Connectivity Integration Tests
 *
 * This module provides shared configuration, types, and utilities for all
 * connectivity integration tests to eliminate code duplication and ensure
 * consistency across test suites.
 *
 * @module tests/integration/connectivity/test-config
 */

import * as cdk from "aws-cdk-lib";
import * as logs from "aws-cdk-lib/aws-logs";

import { NetworkingStack } from "../../../lib/stacks/foundation/networking-stack";
import { MonitoringEfsStack } from "../../../lib/stacks/monitoring/efs-stack";
import { MonitoringInfraStack } from "../../../lib/stacks/monitoring/infra-stack";
import { MonitoringServiceStack } from "../../../lib/stacks/monitoring/service-stack";

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Default AWS configuration for connectivity tests
 */
export const AWS_CONFIG = {
  ACCOUNT: "123456789012",
  REGION: "eu-west-1",
} as const;

/**
 * Network configuration constants
 */
export const NETWORK_CONFIG = {
  VPC_CIDR: "10.0.0.0/16",
  ALLOWED_CIDR: "10.0.0.0/8",
  EXPECTED_SUBNETS: {
    PUBLIC: 2,
    PRIVATE: 2,
    TOTAL: 4,
  },
  EXPECTED_AZS: 2,
} as const;

/**
 * Environment configuration
 */
export const ENVIRONMENT_CONFIG = {
  DEVELOPMENT: "development",
  PRODUCTION: "production",
  STAGING: "staging",
} as const;

/**
 * Project configuration
 */
export const PROJECT_CONFIG = {
  NAME: "monitoring",
  FLOW_LOG_RETENTION: logs.RetentionDays.ONE_WEEK,
} as const;

/**
 * Capacity configuration for ECS
 */
export const CAPACITY_CONFIG = {
  MIN: 1,
  DESIRED: 1,
  MAX: 2,
} as const;

/**
 * Port configuration for services
 */
export const PORT_CONFIG = {
  HTTP: 80,
  HTTPS: 443,
  NFS: 2049,
  PROMETHEUS: 9090,
  GRAFANA: 3000,
  NODE_EXPORTER: 9100,
} as const;

/**
 * Resource type constants
 */
export const RESOURCE_TYPES = {
  VPC: "AWS::EC2::VPC",
  SUBNET: "AWS::EC2::Subnet",
  ROUTE_TABLE: "AWS::EC2::RouteTable",
  ROUTE: "AWS::EC2::Route",
  IGW: "AWS::EC2::InternetGateway",
  NAT_GATEWAY: "AWS::EC2::NatGateway",
  EIP: "AWS::EC2::EIP",
  SECURITY_GROUP: "AWS::EC2::SecurityGroup",
  SECURITY_GROUP_INGRESS: "AWS::EC2::SecurityGroupIngress",
  SECURITY_GROUP_EGRESS: "AWS::EC2::SecurityGroupEgress",
  EFS_FILE_SYSTEM: "AWS::EFS::FileSystem",
  EFS_MOUNT_TARGET: "AWS::EFS::MountTarget",
  EFS_ACCESS_POINT: "AWS::EFS::AccessPoint",
  ECS_CLUSTER: "AWS::ECS::Cluster",
  ECS_SERVICE: "AWS::ECS::Service",
  ECS_TASK_DEFINITION: "AWS::ECS::TaskDefinition",
  ALB: "AWS::ElasticLoadBalancingV2::LoadBalancer",
  TARGET_GROUP: "AWS::ElasticLoadBalancingV2::TargetGroup",
  LISTENER: "AWS::ElasticLoadBalancingV2::Listener",
  LISTENER_RULE: "AWS::ElasticLoadBalancingV2::ListenerRule",
  ASG: "AWS::AutoScaling::AutoScalingGroup",
  AUTO_SCALING_GROUP: "AWS::AutoScaling::AutoScalingGroup",
  LAUNCH_TEMPLATE: "AWS::EC2::LaunchTemplate",
  LOG_GROUP: "AWS::Logs::LogGroup",
  SSM_ASSOCIATION: "AWS::SSM::Association",
} as const;

/**
 * Tag keys used across stacks
 */
export const TAG_KEYS = {
  ENVIRONMENT: "Environment",
  PROJECT: "Project",
  LAYER: "Layer",
  MANAGED_BY: "ManagedBy",
  STACK_NAME: "StackName",
  SUBNET_TYPE: "aws-cdk:subnet-type",
  NAME: "Name",
} as const;

/**
 * Subnet types
 */
export const SUBNET_TYPES = {
  PUBLIC: "Public",
  PRIVATE: "Private",
  ISOLATED: "Isolated",
} as const;

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

/**
 * Resource properties type
 */
export type ResourceProperties = Record<string, Record<string, unknown>>;

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
