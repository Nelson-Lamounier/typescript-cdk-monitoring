/** @format */
/// <reference types="jest" />

import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { Match, Template } from "aws-cdk-lib/assertions";

import { EfsFileSystemConstruct } from "../../../../lib/constructs/storage/efs";

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
  },
  PURPOSES: {
    SHARED_STORAGE: "shared-storage",
  },
  REGIONS: {
    PRIMARY: "eu-west-1",
    SECONDARY: "eu-west-2",
    AVAILABILITY_ZONE: "eu-west-2a",
  },
  RESOURCE_COUNTS: {
    FILE_SYSTEM: 1,
    REPLICATION_CONFIG: 1,
  },
  PERFORMANCE: {
    MODE: "generalPurpose",
    THROUGHPUT_MODE: "provisioned",
    THROUGHPUT_MIBPS: 10,
  },
  LIFECYCLE: {
    TRANSITION_TO_IA: "AFTER_30_DAYS",
  },
  BACKUP: {
    STATUS_ENABLED: "ENABLED",
  },
  TAG_KEYS: {
    NAME: "Name",
    PURPOSE: "Purpose",
  },
  TAG_VALUES: {
    DEV_SHARED_STORAGE: "dev-shared-storage-efs",
  },
  EXPORTS: {
    EFS_ID: "TestStack-efs-id",
    EFS_ARN: "TestStack-efs-arn",
    EFS_DNS: "TestStack-efs-dns",
  },
  KMS: {
    KEY_ARN: "kms-arn",
  },
} as const;

// ============================================================================
// EFS FILE SYSTEM CONSTRUCT TESTS
// ============================================================================

describe("EfsFileSystemConstruct", () => {
  let app: cdk.App;
  let stack: cdk.Stack;
  let vpc: ec2.Vpc;

  beforeEach(() => {
    app = new cdk.App();
    stack = new cdk.Stack(app, TEST_CONFIG.stackName, {
      env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
    });
    vpc = new ec2.Vpc(stack, "Vpc");
  });

  /**
   * Default Configuration Tests
   *
   * Verifies that EFS file system is created with secure defaults including
   * encryption, performance mode, throughput settings, lifecycle policies,
   * backup configuration, and CloudFormation outputs.
   */
  describe("Default Configuration", () => {
    test("creates EFS with secure defaults, tags, and outputs", () => {
      const construct = new EfsFileSystemConstruct(stack, "EfsDefault", {
        vpc,
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEV,
      });

      // Verify construct is created
      expect(construct).toBeDefined();
      expect(construct.fileSystem).toBeDefined();

      const template = Template.fromStack(stack);

      template.resourceCountIs(
        "AWS::EFS::FileSystem",
        TEST_CONSTANTS.RESOURCE_COUNTS.FILE_SYSTEM
      );
      template.hasResourceProperties("AWS::EFS::FileSystem", {
        Encrypted: true,
        PerformanceMode: TEST_CONSTANTS.PERFORMANCE.MODE,
        ThroughputMode: TEST_CONSTANTS.PERFORMANCE.THROUGHPUT_MODE,
        ProvisionedThroughputInMibps: TEST_CONSTANTS.PERFORMANCE.THROUGHPUT_MIBPS,
        LifecyclePolicies: [
          { TransitionToIA: TEST_CONSTANTS.LIFECYCLE.TRANSITION_TO_IA },
        ],
        BackupPolicy: { Status: TEST_CONSTANTS.BACKUP.STATUS_ENABLED },
        FileSystemTags: Match.arrayWith([
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
          expect.objectContaining({ Export: { Name: TEST_CONSTANTS.EXPORTS.EFS_ID } }),
          expect.objectContaining({ Export: { Name: TEST_CONSTANTS.EXPORTS.EFS_ARN } }),
          expect.objectContaining({ Export: { Name: TEST_CONSTANTS.EXPORTS.EFS_DNS } }),
        ])
      );
    });
  });

  /**
   * Replication Configuration Tests
   *
   * Verifies that EFS replication is configured correctly when
   * replication destinations are provided with region, KMS key, and availability zone.
   */
  describe("Replication Configuration", () => {
    test("creates replication configuration when destinations are provided", () => {
      const construct = new EfsFileSystemConstruct(stack, "EfsWithReplication", {
        vpc,
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEV,
        replication: {
          destinations: [
            {
              region: TEST_CONSTANTS.REGIONS.SECONDARY,
              kmsKeyId: TEST_CONSTANTS.KMS.KEY_ARN,
              availabilityZoneName: TEST_CONSTANTS.REGIONS.AVAILABILITY_ZONE,
            },
          ],
        },
      });

      // Verify construct is created
      expect(construct).toBeDefined();
      expect(construct.fileSystem).toBeDefined();

      const template = Template.fromStack(stack);

      template.resourceCountIs(
        "AWS::EFS::ReplicationConfiguration",
        TEST_CONSTANTS.RESOURCE_COUNTS.REPLICATION_CONFIG
      );
      template.hasResourceProperties("AWS::EFS::ReplicationConfiguration", {
        SourceFileSystemId: Match.anyValue(),
        Destinations: [
          Match.objectLike({
            Region: TEST_CONSTANTS.REGIONS.SECONDARY,
            KmsKeyId: TEST_CONSTANTS.KMS.KEY_ARN,
            AvailabilityZoneName: TEST_CONSTANTS.REGIONS.AVAILABILITY_ZONE,
          }),
        ],
      });
    });
  });
});
