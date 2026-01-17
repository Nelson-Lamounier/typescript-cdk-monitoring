/** @format */

import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { VpcConstruct } from "../../../../../lib/constructs/networking/vpc/vpc-construct";
import { VpcFlowLogsConstruct } from "../../../../../lib/constructs/networking/vpc/vpc-flow-logs-construct";
import { TEST_CONFIG, BASE_TEST_CONSTANTS } from "../../../utils/stack-test-utils";
import { MIN_PRODUCTION_FLOW_LOGS_RETENTION_DAYS } from "../../../../../lib/shared/constants/networking-constants";

/**
 * Test constants - avoid magic numbers and strings
 * All hardcoded values used in tests should be defined here
 */
export const TEST_CONSTANTS = {
  ...BASE_TEST_CONSTANTS,
  ENVIRONMENTS: {
    ...BASE_TEST_CONSTANTS.ENVIRONMENTS,
    TEST: "test",
  },
  PROJECT_NAMES: {
    MONITORING: "monitoring",
  },
  RESOURCE_COUNTS: {
    LOG_GROUP: 1,
    FLOW_LOG: 1,
    KMS_KEY: 1,
  },
  LOG_GROUP_NAMES: {
    DEFAULT: "/aws/vpc/flowlogs/development",
    WITH_PROJECT: "/aws/vpc/flowlogs/production-monitoring",
    CUSTOM: "/custom/flowlogs/test",
  },
  REMOVAL_POLICIES: {
    DELETE: "Delete",
    RETAIN: "Retain",
    SNAPSHOT: "Snapshot",
  },
  TRAFFIC_TYPES: {
    ALL: "ALL",
    ACCEPT: "ACCEPT",
    REJECT: "REJECT",
  },
  AGGREGATION_INTERVALS: {
    ONE_MINUTE: 60,
    TEN_MINUTES: 600,
  },
  RETENTION_DAYS: {
    ONE_DAY: 1,
    THREE_DAYS: 3,
    SEVEN_DAYS: 7,
    FOURTEEN_DAYS: 14,
    THIRTY_DAYS: 30,
    NINETY_DAYS: 90,
    THREE_SIXTY_FIVE_DAYS: 365,
    INVALID_TOO_LOW: 0,
    INVALID_TOO_HIGH: 10000,
    INVALID_NON_INTEGER: 7.5,
    PRODUCTION_MINIMUM: MIN_PRODUCTION_FLOW_LOGS_RETENTION_DAYS,
  },
  VALIDATION_ERRORS: {
    RETENTION_TOO_LOW: "Retention days must be at least 1",
    RETENTION_TOO_HIGH: "Retention days must not exceed 2555",
    RETENTION_NON_INTEGER: "Retention days must be an integer",
    INVALID_ENVIRONMENT: "Environment name (envName) is required",
    MISSING_VPC: "VPC is required for VpcFlowLogsConstruct",
  },
  TAG_KEYS: {
    NAME: "Name",
    ENVIRONMENT: "Environment",
    MANAGED_BY: "ManagedBy",
    PROJECT: "Project",
    RESOURCE_TYPE: "ResourceType",
  },
  TAG_VALUES: {
    MANAGED_BY: "CDK",
    RESOURCE_TYPE: "VpcFlowLogs",
  },
  IAM: {
    ...BASE_TEST_CONSTANTS.IAM,
    SERVICE_PRINCIPAL: "vpc-flow-logs.amazonaws.com",
    KMS_ACTIONS: {
      DECRYPT: "kms:Decrypt",
      ENCRYPT: "kms:Encrypt",
      REENCRYPT: "kms:ReEncrypt*",
      GENERATE_DATA_KEY: "kms:GenerateDataKey*",
      CREATE_GRANT: "kms:CreateGrant",
      DESCRIBE_KEY: "kms:DescribeKey",
    },
  },
} as const;

/**
 * Create a test VPC for flow logs testing
 *
 * @param stack - Stack instance
 * @param id - VPC construct ID
 * @returns VPC instance
 */
export function createTestVpc(stack: cdk.Stack, id: string = "TestVpc"): ec2.IVpc {
  const vpcConstruct = new VpcConstruct(stack, id, {
    envName: TEST_CONSTANTS.ENVIRONMENTS.TEST,
  });
  return vpcConstruct.vpc;
}

/**
 * Create a test stack with default configuration
 *
 * @param app - CDK app instance
 * @param id - Stack ID
 * @returns Stack instance for testing
 */
export function createTestStack(app: cdk.App, id: string): cdk.Stack {
  if (!app) {
    throw new Error("CDK App instance is required to create test stack");
  }

  return new cdk.Stack(app, id, {
    env: {
      account: TEST_CONFIG.account,
      region: TEST_CONFIG.region,
    },
  });
}

/**
 * Create VPC Flow Logs construct with default configuration
 *
 * @param stack - Stack instance
 * @param id - Construct ID
 * @param props - Optional construct properties
 * @returns VpcFlowLogsConstruct instance
 */
export function createFlowLogsConstruct(
  stack: cdk.Stack,
  id: string,
  props: Partial<{
    vpc: ec2.IVpc;
    envName: string;
    projectName?: string;
    retentionDays?: number;
    removalPolicy?: cdk.RemovalPolicy;
    logGroupName?: string;
    trafficType?: ec2.FlowLogTrafficType;
    logFormat?: ec2.LogFormat[];
    maxAggregationInterval?: ec2.FlowLogMaxAggregationInterval;
    encryptionKey?: any;
  }> = {}
): VpcFlowLogsConstruct {
  const vpc = props.vpc ?? createTestVpc(stack, `Vpc-${id}`);

  return new VpcFlowLogsConstruct(stack, id, {
    vpc,
    envName: props.envName ?? TEST_CONSTANTS.ENVIRONMENTS.TEST,
    projectName: props.projectName,
    retentionDays: props.retentionDays,
    removalPolicy: props.removalPolicy,
    logGroupName: props.logGroupName,
    trafficType: props.trafficType,
    logFormat: props.logFormat,
    maxAggregationInterval: props.maxAggregationInterval,
    encryptionKey: props.encryptionKey,
  });
}
