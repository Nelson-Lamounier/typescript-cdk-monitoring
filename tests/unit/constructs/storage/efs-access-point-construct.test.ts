/** @format */
/// <reference types="jest" />

import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { Match, Template } from "aws-cdk-lib/assertions";

import {
  EfsAccessPointConstruct,
  EfsFileSystemConstruct,
} from "../../../../lib/constructs/storage/efs";

// ============================================================================
// TEST CONFIGURATION
// ============================================================================

/**
 * Test configuration constants
 * Centralised configuration values used across all tests
 */
const TEST_CONFIG = {
  account: "123456789012",
  region: "eu-west-1",
  stackName: "TestStack",
} as const;

/**
 * Test constants - avoid magic numbers and strings
 * All hardcoded values used in tests should be defined here
 */
const TEST_CONSTANTS = {
  ENVIRONMENTS: {
    DEV: "dev",
    PRODUCTION: "prod",
  },
  PURPOSES: {
    SHARED_STORAGE: "shared-storage",
    DATA: "data",
  },
  PATHS: {
    ROOT: "/",
    DATA: "/data",
  },
  POSIX_DEFAULTS: {
    UID: "1000",
    GID: "1000",
    SECONDARY_GIDS: [] as string[],
    PERMISSIONS: "750",
  },
  POSIX_CUSTOM: {
    UID: "2000",
    GID: "2000",
    SECONDARY_GIDS: ["3000"] as string[],
    PERMISSIONS: "755",
  },
  RESOURCE_COUNTS: {
    ACCESS_POINT: 1,
  },
  TAG_KEYS: {
    NAME: "Name",
    PURPOSE: "Purpose",
    OWNER: "Owner",
  },
  TAG_VALUES: {
    DEV_SHARED_STORAGE: "dev-shared-storage-access-point",
    PROD_DATA: "prod-data-access-point",
    TEAM_A: "team-a",
  },
  EXPORTS: {
    ACCESS_POINT_ID: "TestStack-access-point-id",
    ACCESS_POINT_ARN: "TestStack-access-point-arn",
  },
  IAM: {
    POLICY_VERSION: "2012-10-17",
    EFFECT_ALLOW: "Allow",
    ACTION_CLIENT_MOUNT: "elasticfilesystem:ClientMount",
    RESOURCE_ANY: "*",
  },
} as const;

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Create a sample IAM policy for EFS access
 *
 * @param account - AWS account number
 * @returns IAM policy document
 */
function createSamplePolicy(account: string) {
  return {
    Version: TEST_CONSTANTS.IAM.POLICY_VERSION,
    Statement: [
      {
        Effect: TEST_CONSTANTS.IAM.EFFECT_ALLOW,
        Principal: { AWS: `arn:aws:iam::${account}:role/Example` },
        Action: [TEST_CONSTANTS.IAM.ACTION_CLIENT_MOUNT],
        Resource: TEST_CONSTANTS.IAM.RESOURCE_ANY,
      },
    ],
  };
}

// ============================================================================
// EFS ACCESS POINT CONSTRUCT TESTS
// ============================================================================

describe("EfsAccessPointConstruct", () => {
  let app: cdk.App;
  let stack: cdk.Stack;
  let vpc: ec2.Vpc;
  let fileSystem: EfsFileSystemConstruct;

  beforeEach(() => {
    app = new cdk.App();
    stack = new cdk.Stack(app, TEST_CONFIG.stackName, {
      env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
    });
    vpc = new ec2.Vpc(stack, "Vpc");
    fileSystem = new EfsFileSystemConstruct(stack, "Efs", {
      vpc,
      envName: TEST_CONSTANTS.ENVIRONMENTS.DEV,
    });
  });

  /**
   * Default Configuration Tests
   *
   * Verifies that EFS Access Point is created with correct default configuration,
   * including non-root POSIX user, permissions, and CloudFormation outputs.
   */
  describe("Default Configuration", () => {
    test("creates access point with non-root defaults and outputs", () => {
      new EfsAccessPointConstruct(stack, "AccessPoint", {
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEV,
        fileSystem: fileSystem.fileSystem,
      });

      const template = Template.fromStack(stack);

      template.resourceCountIs(
        "AWS::EFS::AccessPoint",
        TEST_CONSTANTS.RESOURCE_COUNTS.ACCESS_POINT
      );
      template.hasResourceProperties("AWS::EFS::AccessPoint", {
        FileSystemId: Match.anyValue(),
        PosixUser: {
          Uid: TEST_CONSTANTS.POSIX_DEFAULTS.UID,
          Gid: TEST_CONSTANTS.POSIX_DEFAULTS.GID,
          SecondaryGids: TEST_CONSTANTS.POSIX_DEFAULTS.SECONDARY_GIDS,
        },
        RootDirectory: {
          CreationInfo: {
            OwnerUid: TEST_CONSTANTS.POSIX_DEFAULTS.UID,
            OwnerGid: TEST_CONSTANTS.POSIX_DEFAULTS.GID,
            Permissions: TEST_CONSTANTS.POSIX_DEFAULTS.PERMISSIONS,
          },
          Path: TEST_CONSTANTS.PATHS.ROOT,
        },
        AccessPointTags: Match.arrayWith([
          Match.objectLike({
            Key: TEST_CONSTANTS.TAG_KEYS.NAME,
            Value: TEST_CONSTANTS.TAG_VALUES.DEV_SHARED_STORAGE,
          }),
          Match.objectLike({
            Key: TEST_CONSTANTS.TAG_KEYS.PURPOSE,
            Value: TEST_CONSTANTS.PURPOSES.SHARED_STORAGE,
          }),
        ]),
      });

      const outputs = template.findOutputs("*");
      expect(Object.values(outputs)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            Export: { Name: TEST_CONSTANTS.EXPORTS.ACCESS_POINT_ID },
          }),
          expect.objectContaining({
            Export: { Name: TEST_CONSTANTS.EXPORTS.ACCESS_POINT_ARN },
          }),
        ])
      );
    });
  });

  /**
   * Custom Configuration Tests
   *
   * Verifies that EFS Access Point supports custom POSIX settings,
   * custom paths, purposes, file system policies, and additional tags.
   */
  describe("Custom Configuration", () => {
    test("supports custom POSIX settings, path, purpose, and policy", () => {
      const policy = createSamplePolicy(TEST_CONFIG.account);

      const construct = new EfsAccessPointConstruct(stack, "AccessPointCustom", {
        envName: TEST_CONSTANTS.ENVIRONMENTS.PRODUCTION,
        purpose: TEST_CONSTANTS.PURPOSES.DATA,
        fileSystem: fileSystem.fileSystem,
        path: TEST_CONSTANTS.PATHS.DATA,
        posixUser: {
          uid: TEST_CONSTANTS.POSIX_CUSTOM.UID,
          gid: TEST_CONSTANTS.POSIX_CUSTOM.GID,
          secondaryGids: TEST_CONSTANTS.POSIX_CUSTOM.SECONDARY_GIDS,
        },
        creationAcl: {
          ownerUid: TEST_CONSTANTS.POSIX_CUSTOM.UID,
          ownerGid: TEST_CONSTANTS.POSIX_CUSTOM.GID,
          permissions: TEST_CONSTANTS.POSIX_CUSTOM.PERMISSIONS,
        },
        fileSystemPolicy: policy,
        additionalTags: { [TEST_CONSTANTS.TAG_KEYS.OWNER]: TEST_CONSTANTS.TAG_VALUES.TEAM_A },
      });

      // Verify construct is created
      expect(construct).toBeDefined();
      expect(construct.accessPoint).toBeDefined();

      const template = Template.fromStack(stack);

      template.resourceCountIs(
        "AWS::EFS::AccessPoint",
        TEST_CONSTANTS.RESOURCE_COUNTS.ACCESS_POINT
      );
      template.hasResourceProperties("AWS::EFS::AccessPoint", {
        RootDirectory: {
          CreationInfo: {
            OwnerUid: TEST_CONSTANTS.POSIX_CUSTOM.UID,
            OwnerGid: TEST_CONSTANTS.POSIX_CUSTOM.GID,
            Permissions: TEST_CONSTANTS.POSIX_CUSTOM.PERMISSIONS,
          },
          Path: TEST_CONSTANTS.PATHS.DATA,
        },
        PosixUser: {
          Uid: TEST_CONSTANTS.POSIX_CUSTOM.UID,
          Gid: TEST_CONSTANTS.POSIX_CUSTOM.GID,
          SecondaryGids: TEST_CONSTANTS.POSIX_CUSTOM.SECONDARY_GIDS,
        },
        AccessPointTags: Match.arrayWith([
          Match.objectLike({
            Key: TEST_CONSTANTS.TAG_KEYS.NAME,
            Value: TEST_CONSTANTS.TAG_VALUES.PROD_DATA,
          }),
          Match.objectLike({
            Key: TEST_CONSTANTS.TAG_KEYS.PURPOSE,
            Value: TEST_CONSTANTS.PURPOSES.DATA,
          }),
        ]),
        FileSystemPolicy: policy,
      });
    });
  });
});
