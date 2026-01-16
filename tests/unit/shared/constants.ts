/** @format */

/**
 * Shared Test Constants
 *
 * Centralised constants used across all test suites to eliminate duplication
 * and ensure consistency.
 *
 * @module tests/unit/shared/constants
 */

import * as logs from "aws-cdk-lib/aws-logs";

// ============================================================================
// AWS CONFIGURATION
// ============================================================================

/**
 * Default AWS configuration for all tests
 */
export const AWS_CONFIG = {
  ACCOUNT: "123456789012",
  REGION: "eu-west-1",
} as const;

// ============================================================================
// NETWORK CONFIGURATION
// ============================================================================

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

// ============================================================================
// ENVIRONMENT CONFIGURATION
// ============================================================================

/**
 * Environment configuration
 */
export const ENVIRONMENT_CONFIG = {
  DEVELOPMENT: "development",
  PRODUCTION: "production",
  STAGING: "staging",
} as const;

// ============================================================================
// PROJECT CONFIGURATION
// ============================================================================

/**
 * Project configuration
 */
export const PROJECT_CONFIG = {
  NAME: "monitoring",
  FLOW_LOG_RETENTION: logs.RetentionDays.ONE_WEEK,
} as const;

// ============================================================================
// CAPACITY CONFIGURATION
// ============================================================================

/**
 * Capacity configuration for ECS
 */
export const CAPACITY_CONFIG = {
  MIN: 1,
  DESIRED: 1,
  MAX: 2,
} as const;

// ============================================================================
// PORT CONFIGURATION
// ============================================================================

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

// ============================================================================
// RESOURCE TYPES
// ============================================================================

/**
 * CloudFormation resource type constants
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

// ============================================================================
// TAG KEYS
// ============================================================================

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

// ============================================================================
// SUBNET TYPES
// ============================================================================

/**
 * Subnet types
 */
export const SUBNET_TYPES = {
  PUBLIC: "Public",
  PRIVATE: "Private",
  ISOLATED: "Isolated",
} as const;
