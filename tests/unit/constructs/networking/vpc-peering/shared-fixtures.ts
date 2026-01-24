/** @format */

import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";

import { VpcConstruct } from "../../../../../lib/constructs/networking/vpc/vpc-construct";
import { VpcPeeringConstruct } from "../../../../../lib/constructs/networking/vpc/vpc-peering-construct";
import { VpcPeeringConstructProps } from "../../../../../lib/shared/types/networking-types";
import {
  DEFAULT_VPC_PEERING_SSM_PREFIX,
  DEFAULT_VPC_PEERING_LAMBDA_TIMEOUT_SECONDS,
} from "../../../../../lib/shared/constants/networking-constants";
import {
  BASE_TEST_CONSTANTS,
  createTestEnv,
} from "../../../utils/stack-test-utils";

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
  PEER_VPC: {
    ID: "vpc-1234567890abcdef0",
    CIDR: "172.16.0.0/16",
    NON_OVERLAPPING_CIDR: "192.168.0.0/16",
    OVERLAPPING_CIDR: "10.0.0.0/16",
  },
  PEER_ACCOUNT: {
    ID: "987654321098",
    ROLE_ARN: "arn:aws:iam::987654321098:role/VpcPeeringAcceptRole",
    VALID_ROLE_ARN: "arn:aws:iam::987654321098:role/ValidRole",
    INVALID_ID_SHORT: "123",
    INVALID_ID_NON_NUMERIC: "invalid-account",
  },
  PEER_REGION: {
    VALID: "us-west-2",
    INVALID: "invalid-region",
    CUSTOM: "us-west-2",
  },
  PEERING: {
    NAME: "test-peering",
    PROD_NAME: "prod-peering",
  },
  VPC_ID: {
    INVALID: "invalid-vpc-id",
    EMPTY: "",
  },
  ROLE_ARN: {
    INVALID: "invalid-arn",
  },
  SSM: {
    CUSTOM_PATH: "/custom/path/to/peering-id",
    DEFAULT_PREFIX: DEFAULT_VPC_PEERING_SSM_PREFIX,
  },
  LAMBDA: {
    DEFAULT_TIMEOUT: DEFAULT_VPC_PEERING_LAMBDA_TIMEOUT_SECONDS,
    CUSTOM_TIMEOUT: 90,
    WARNING_TIMEOUT: 180,
  },
  PROJECT_NAME: "monitoring",
  RESOURCE_COUNTS: {
    CUSTOM_RESOURCES: 2,
    SSM_PARAMETERS: 1,
    MIN_ROUTES: 1,
    MIN_LAMBDA_FUNCTIONS: 2,
    MIN_OUTPUTS: 3,
  },
} as const;

/**
 * Create test infrastructure (VPC)
 * Each test needs its own isolated VPC
 */
export function createTestVpc(stack: cdk.Stack, id: string = "TestVpc"): ec2.IVpc {
  const vpcConstruct = new VpcConstruct(stack, id, {
    envName: TEST_CONSTANTS.ENVIRONMENTS.TEST,
  });
  return vpcConstruct.vpc;
}

/**
 * Create test VPC with explicit CIDR
 */
export function createTestVpcWithCidr(
  stack: cdk.Stack,
  cidr: string,
  id: string = "TestVpcOverlap"
): ec2.IVpc {
  const vpcConstruct = new VpcConstruct(stack, id, {
    envName: TEST_CONSTANTS.ENVIRONMENTS.TEST,
    cidr,
  });
  return vpcConstruct.vpc;
}

/**
 * Create test stack with default configuration
 */
export function createTestStack(app: cdk.App, id: string = "TestStack"): cdk.Stack {
  return new cdk.Stack(app, id, {
    env: createTestEnv(),
  });
}

/**
 * Create VPC peering construct with default test configuration
 */
export function createPeeringConstruct(
  stack: cdk.Stack,
  vpc: ec2.IVpc,
  id: string = "Peering",
  props?: Partial<VpcPeeringConstructProps>
): VpcPeeringConstruct {
  return new VpcPeeringConstruct(stack, id, {
    vpc,
    peerVpcId: TEST_CONSTANTS.PEER_VPC.ID,
    peerAccountId: TEST_CONSTANTS.PEER_ACCOUNT.ID,
    peerVpcCidr: TEST_CONSTANTS.PEER_VPC.CIDR,
    envName: TEST_CONSTANTS.ENVIRONMENTS.TEST,
    peeringName: TEST_CONSTANTS.PEERING.NAME,
    peerRoleArn: TEST_CONSTANTS.PEER_ACCOUNT.ROLE_ARN,
    ...props,
  });
}
