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

// ============================================================================
// EFS TEST CONSTANTS
// ============================================================================

/**
 * EFS-specific test constants
 */
export const EFS_TEST_CONSTANTS = {
  MOUNT_PATH: "/monitoring",
  NFS_PORT: 2049,
  OWNER_UID: "1000",
  OWNER_GID: "1000",
  PERMISSIONS: "755",
  AVAILABILITY_ZONE: "eu-west-1a",
} as const;

// ============================================================================
// RESOURCE COUNT CONSTANTS
// ============================================================================

/**
 * Expected resource counts for EFS stack tests
 */
export const EFS_RESOURCE_COUNTS = {
  FILE_SYSTEM: 1,
  ACCESS_POINT: 1,
  SECURITY_GROUP: 1,
  SSM_DOCUMENT: 1,
  SSM_ASSOCIATION: 1,
  LAMBDA_FUNCTION: 0,
  CUSTOM_RESOURCE: 0,
} as const;

// ============================================================================
// SSM PARAMETER PATHS
// ============================================================================

/**
 * SSM parameter paths for monitoring configuration
 */
export const SSM_PARAMETER_PATHS = {
  PROMETHEUS_CONFIG: "/monitoring/development/prometheus-config",
  PROMETHEUS_CONFIG_YAML: "/monitoring/development/prometheus-config-yaml",
  GRAFANA_DATASOURCE_CONFIG:
    "/monitoring/development/grafana-datasource-config",
  GRAFANA_DATASOURCE_CONFIG_YAML:
    "/monitoring/development/grafana-datasource-config-yaml",
  GRAFANA_DASHBOARD_CONFIG:
    "/monitoring/development/grafana-dashboard-config",
  GRAFANA_DASHBOARD_CONFIG_YAML:
    "/monitoring/development/grafana-dashboard-config-yaml",
  EFS_CONFIG_PREFIX: "/monitoring/.*/efs/config/.*",
} as const;

// ============================================================================
// OUTPUT NAMES
// ============================================================================

/**
 * CloudFormation output names for EFS stack
 */
export const EFS_OUTPUT_NAMES = {
  FILE_SYSTEM_ID: "FileSystemId",
  ACCESS_POINT_ID: "AccessPointId",
  SECURITY_GROUP_ID: "SecurityGroupId",
} as const;

// ============================================================================
// SSM DOCUMENT CONSTANTS
// ============================================================================

/**
 * SSM document configuration constants
 */
export const SSM_DOCUMENT_CONFIG = {
  TYPE: "Automation",
  FORMAT: "YAML",
} as const;

// ============================================================================
// LIFECYCLE POLICY CONSTANTS
// ============================================================================

/**
 * EFS lifecycle policy transition values
 */
export const EFS_LIFECYCLE_POLICIES = {
  AFTER_7_DAYS: "AFTER_7_DAYS",
  AFTER_14_DAYS: "AFTER_14_DAYS",
  AFTER_30_DAYS: "AFTER_30_DAYS",
  AFTER_60_DAYS: "AFTER_60_DAYS",
  AFTER_90_DAYS: "AFTER_90_DAYS",
} as const;

// ============================================================================
// MONITORING INFRA CONSTANTS
// ============================================================================

export const MONITORING_INFRA_CONSTANTS = {
  EFS_STACK_NAME: "MonitoringEfsStack",
  CERTIFICATE_ARN:
    "arn:aws:acm:eu-west-1:123456789012:certificate/12345678-1234-1234-1234-123456789012",
  LOG_SUFFIXES: {
    TASKS: "/tasks",
    EVENTS: "/events",
  },
  DESCRIPTIONS: {
    EFS_SECURITY_GROUP: "Security group for EFS",
    LOAD_BALANCER: "load balancer",
  },
  SSM_ASSOCIATION_NAMES: {
    RUN_SHELL_SCRIPT: "AWS-RunShellScript",
    CONFIGURE_AWS_PACKAGE: "AWS-ConfigureAWSPackage",
  },
} as const;

export const MONITORING_INFRA_RESOURCE_COUNTS = {
  ECS_CLUSTER: 1,
  LOAD_BALANCER: 1,
  AUTO_SCALING_GROUP: 1,
  LOG_GROUPS: 2,
  SSM_PARAMETERS: 5,
} as const;

export const MONITORING_INFRA_SSM_PATHS = {
  CLUSTER_NAME: "/monitoring/development/infra/config/cluster-name",
  CLUSTER_ARN: "/monitoring/development/infra/config/cluster-arn",
  ALB_DNS: "/monitoring/development/infra/config/alb-dns",
  LISTENER_ARN: "/monitoring/development/infra/config/listener-arn",
  ASG_NAME: "/monitoring/development/infra/config/asg-name",
} as const;

// ============================================================================
// MONITORING SERVICE CONSTANTS
// ============================================================================

export const MONITORING_SERVICE_RESOURCE_COUNTS = {
  ECS_SERVICES: 3,
  TARGET_GROUPS: 2,
  LISTENER_RULES: 2,
  SECRETS: 1,
  SSM_PARAMETERS: 5,
  OUTPUTS: 6,
} as const;

export const MONITORING_SERVICE_NAMES = {
  PROMETHEUS: "prometheus",
  GRAFANA: "grafana",
  NODE_EXPORTER: "node-exporter",
} as const;

export const MONITORING_SERVICE_SECRET_NAMES = {
  GRAFANA_ADMIN: "grafana-admin-password",
} as const;

export const MONITORING_SERVICE_SSM_PARAMETER_NAMES = {
  PROMETHEUS_SERVICE_ARN: "prometheus-service-arn",
  GRAFANA_SERVICE_ARN: "grafana-service-arn",
  NODE_EXPORTER_SERVICE_ARN: "node-exporter-service-arn",
  PROMETHEUS_TARGET_GROUP_ARN: "prometheus-target-group-arn",
  GRAFANA_TARGET_GROUP_ARN: "grafana-target-group-arn",
} as const;

export const MONITORING_SERVICE_OUTPUT_NAMES = {
  PROMETHEUS_SERVICE_ARN: "PrometheusServiceArn",
  GRAFANA_SERVICE_ARN: "GrafanaServiceArn",
  NODE_EXPORTER_SERVICE_ARN: "NodeExporterServiceArn",
  PROMETHEUS_TARGET_GROUP_ARN: "PrometheusTargetGroupArn",
  GRAFANA_TARGET_GROUP_ARN: "GrafanaTargetGroupArn",
  GRAFANA_ADMIN_SECRET_ARN: "GrafanaAdminSecretArn",
} as const;

// ============================================================================
// SECURITY STACK CONSTANTS
// ============================================================================

export const SECURITY_RESOURCE_COUNTS = {
  TASK_DEFINITIONS: 1,
  S3_BUCKETS: 1,
  LOG_GROUPS: 1,
  IAM_ROLES: 2,
  SSM_PARAMETERS: 4,
  EVENTBRIDGE_RULES: 1,
} as const;

export const SECURITY_SSM_PARAMETER_NAMES = {
  RESULTS_BUCKET_NAME: "results-bucket-name",
  RESULTS_BUCKET_ARN: "results-bucket-arn",
  TASK_DEFINITION_ARN: "task-definition-arn",
  SCHEDULE_RULE_ARN: "schedule-rule-arn",
} as const;

export const SECURITY_OUTPUT_NAMES = {
  RESULTS_BUCKET_NAME: "ResultsBucketName",
  RESULTS_BUCKET_ARN: "ResultsBucketArn",
  CLUSTER_ARN: "ClusterArn",
  TASK_DEFINITION_ARN: "TaskDefinitionArn",
  LOG_GROUP_NAME: "LogGroupName",
  SCHEDULE_RULE_ARN: "ScheduleRuleArn",
  MANUAL_RUN_INFO: "ManualRunInfo",
} as const;
