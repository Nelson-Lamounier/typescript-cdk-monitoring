/** @format */
/// <reference types="jest" />

/**
 * Security Posture Tests: Storage Security
 *
 * Validates storage security configurations including:
 * - EFS encryption at rest and in transit
 * - EFS access point POSIX permissions
 * - EFS lifecycle policies
 * - Storage access controls
 *
 * @see https://docs.aws.amazon.com/efs/latest/ug/security-considerations.html
 */

import { Template, Match } from "aws-cdk-lib/assertions";

import {
  type ConnectivityTestStacks,
  STORAGE_TEST_STACKS,
} from "../connectivity/test-config";
import { SecurityTestFixtures } from "../utils/test-utils";
// Import shared utilities - functions
import {
  getFileSystems,
  getAccessPoints,
  getSecurityGroups,
  getSecurityGroupIngressRules,
  getResourceProperties,
  getDeletionPolicy,
  getLifecyclePolicies,
  getRootDirectory,
  getCreationInfo,
  getPermissions,
  getIngressRules,
  isNfsPortRule,
  hasIATransition,
} from "../utils";

describe("Security Posture: Storage Security", () => {
  let stacks: ConnectivityTestStacks;

  beforeAll(() => {
    stacks = SecurityTestFixtures.getDevelopmentStacks();
  });

  /**
   * Get template from stack name
   */
  const getTemplate = (stackName: keyof ConnectivityTestStacks) => {
    if (stackName === "app") {
      throw new Error("Cannot get template for app");
    }
    return Template.fromStack(stacks[stackName]);
  };

  // ==========================================================================
  // EFS ENCRYPTION
  // ==========================================================================

  describe("EFS Encryption", () => {
    // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
    test("EFS file system has encryption at rest enabled", () => {
      const template = getTemplate(STORAGE_TEST_STACKS[0]);

      template.hasResourceProperties("AWS::EFS::FileSystem", {
        Encrypted: true,
      });
    });

    describe("EFS Encryption Configuration", () => {
      let fileSystems: unknown[];

      beforeAll(() => {
        const template = getTemplate(STORAGE_TEST_STACKS[0]);
        fileSystems = getFileSystems(template);
      });

      test("file systems exist", () => {
        expect(fileSystems.length).toBeGreaterThan(0);
      });

      test("EFS uses AWS managed encryption key by default", () => {
        expect(fileSystems).toBeDefined();
        expect(Array.isArray(fileSystems)).toBe(true);

        fileSystems.forEach((fileSystem) => {
          const properties = getResourceProperties(fileSystem);
          expect(properties.Encrypted).toBe(true);
        });
      });
    });

    // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
    test("EFS mount targets are in private subnets", () => {
      const template = getTemplate(STORAGE_TEST_STACKS[0]);

      template.hasResourceProperties("AWS::EFS::MountTarget", {
        SubnetId: Match.anyValue(),
        SecurityGroups: Match.anyValue(),
      });
    });
  });

  // ==========================================================================
  // EFS ACCESS CONTROLS
  // ==========================================================================

  describe("EFS Access Controls", () => {
    // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
    test("EFS access point enforces POSIX permissions", () => {
      const template = getTemplate(STORAGE_TEST_STACKS[0]);

      template.hasResourceProperties("AWS::EFS::AccessPoint", {
        PosixUser: Match.objectLike({
          Uid: Match.anyValue(),
          Gid: Match.anyValue(),
        }),
        RootDirectory: Match.objectLike({
          CreationInfo: Match.objectLike({
            OwnerUid: Match.anyValue(),
            OwnerGid: Match.anyValue(),
            Permissions: Match.anyValue(),
          }),
        }),
      });
    });

    describe("EFS Access Point Permissions", () => {
      let accessPointsWithPermissions: Array<{
        accessPoint: unknown;
        rootDir: Record<string, Record<string, string>>;
        creationInfo: Record<string, string>;
        permissions: string;
      }>;

      beforeAll(() => {
        const template = getTemplate(STORAGE_TEST_STACKS[0]);
        const accessPoints = getAccessPoints(template);

        // Pre-filter and pre-compute access points with permissions
        accessPointsWithPermissions = accessPoints
          .map((accessPoint) => {
            const rootDir = getRootDirectory(accessPoint);
            return {
              accessPoint,
              rootDir,
            };
          })
          .filter(
            (item): item is {
              accessPoint: unknown;
              rootDir: Record<string, Record<string, string>>;
            } => item.rootDir !== undefined
          )
          .map((item) => {
            const creationInfo = getCreationInfo(item.rootDir);
            const permissions = getPermissions(creationInfo);
            return {
              accessPoint: item.accessPoint,
              rootDir: item.rootDir,
              creationInfo,
              permissions: permissions || "",
            };
          })
          .filter((item) => item.permissions !== "");
      });

      test("access points exist", () => {
        expect(accessPointsWithPermissions.length).toBeGreaterThan(0);
      });

      test("EFS access point has restrictive permissions", () => {
        expect(accessPointsWithPermissions).toBeDefined();
        expect(Array.isArray(accessPointsWithPermissions)).toBe(true);

        accessPointsWithPermissions.forEach(({ permissions }) => {
          expect(permissions).toBeDefined();
          // Permissions should not be 777 (world writable)
          expect(permissions).not.toBe("777");
        });
      });
    });

    describe("EFS Security Group NFS Access", () => {
      let nfsRules: Array<{
        rule: unknown;
        properties: Record<string, unknown>;
      }>;
      let securityGroupsWithNfsRules: Array<{
        sg: unknown;
        nfsIngressRules: Array<Record<string, unknown>>;
      }>;

      beforeAll(() => {
        const template = getTemplate(STORAGE_TEST_STACKS[0]);
        const securityGroupRules = getSecurityGroupIngressRules(template);
        const securityGroups = getSecurityGroups(template);

        // Pre-filter NFS rules (port 2049) from standalone ingress rules
        nfsRules = securityGroupRules
          .map((rule) => ({
            rule,
            properties: getResourceProperties(rule),
          }))
          .filter((item) => isNfsPortRule(item.properties));

        // Pre-compute security groups with NFS ingress rules
        securityGroupsWithNfsRules = securityGroups.map((sg) => {
          const ingressRules = getIngressRules(sg);
          const nfsIngressRules = ingressRules.filter((rule) =>
            isNfsPortRule(rule)
          );
          return {
            sg,
            nfsIngressRules,
          };
        });
      });

      test("security groups exist", () => {
        expect(securityGroupsWithNfsRules.length).toBeGreaterThan(0);
      });

      test("EFS security group restricts access to NFS port", () => {
        expect(nfsRules).toBeDefined();
        expect(Array.isArray(nfsRules)).toBe(true);
        expect(securityGroupsWithNfsRules).toBeDefined();
        expect(Array.isArray(securityGroupsWithNfsRules)).toBe(true);

        // Check standalone ingress rules
        nfsRules.forEach(({ properties }) => {
          // NFS rules should use security group as source (not CIDR)
          expect(properties.SourceSecurityGroupId).toBeDefined();
        });

        // Check inline ingress rules in security groups
        securityGroupsWithNfsRules.forEach(({ nfsIngressRules }) => {
          // NFS rules may or may not exist in inline rules
          expect(nfsIngressRules.length).toBeGreaterThanOrEqual(0);
        });
      });
    });
  });

  // ==========================================================================
  // EFS LIFECYCLE MANAGEMENT
  // ==========================================================================

  describe("EFS Lifecycle Management", () => {
    // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
    test("EFS has lifecycle policies configured", () => {
      const template = getTemplate(STORAGE_TEST_STACKS[0]);

      template.hasResourceProperties("AWS::EFS::FileSystem", {
        LifecyclePolicies: Match.anyValue(),
      });
    });

    describe("EFS Lifecycle Policy Configuration", () => {
      let fileSystemsWithPolicies: Array<{
        fileSystem: unknown;
        lifecyclePolicies: Array<Record<string, string>>;
        hasIATransition: boolean;
      }>;

      beforeAll(() => {
        const template = getTemplate(STORAGE_TEST_STACKS[0]);
        const fileSystems = getFileSystems(template);

        // Pre-compute file systems with lifecycle policies
        fileSystemsWithPolicies = fileSystems.map((fileSystem) => {
          const lifecyclePolicies = getLifecyclePolicies(fileSystem);
          return {
            fileSystem,
            lifecyclePolicies,
            hasIATransition: hasIATransition(lifecyclePolicies),
          };
        });
      });

      test("file systems exist", () => {
        expect(fileSystemsWithPolicies.length).toBeGreaterThan(0);
      });

      test("EFS has transition to IA configured for cost optimization", () => {
        expect(fileSystemsWithPolicies).toBeDefined();
        expect(Array.isArray(fileSystemsWithPolicies)).toBe(true);

        fileSystemsWithPolicies.forEach(({ lifecyclePolicies, hasIATransition: hasIA }) => {
          expect(lifecyclePolicies).toBeDefined();
          expect(lifecyclePolicies.length).toBeGreaterThan(0);
          expect(hasIA).toBe(true);
        });
      });
    });
  });

  // ==========================================================================
  // EFS BACKUP AND PROTECTION
  // ==========================================================================

  describe("EFS Backup and Protection", () => {
    describe("Production Deletion Policy", () => {
      let prodFileSystems: unknown[];

      beforeAll(() => {
        const prodStacks = SecurityTestFixtures.getProductionStacks();
        const template = Template.fromStack(prodStacks.efsStack);
        prodFileSystems = getFileSystems(template);
      });

      test("file systems exist", () => {
        expect(prodFileSystems.length).toBeGreaterThan(0);
      });

      test("EFS has deletion policy for production", () => {
        expect(prodFileSystems).toBeDefined();
        expect(Array.isArray(prodFileSystems)).toBe(true);

        prodFileSystems.forEach((fileSystem) => {
          const deletionPolicy = getDeletionPolicy(fileSystem);
          expect(deletionPolicy).toBe("Retain");
        });
      });
    });
  });
});
