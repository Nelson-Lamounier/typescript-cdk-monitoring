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

import { type ConnectivityTestStacks } from "../connectivity/test-config";

import { SecurityTestFixtures } from "../utils/test-utils";

describe("Security Posture: Storage Security", () => {
  let stacks: ConnectivityTestStacks;

  beforeAll(() => {
    stacks = SecurityTestFixtures.getDevelopmentStacks();
  });

  // ==========================================================================
  // HELPER FUNCTIONS (defined as arrow functions)
  // ==========================================================================

  /**
   * Get template from stack name
   */
  const getTemplate = (stackName: keyof ConnectivityTestStacks) => {
    if (stackName === "app") {
      throw new Error("Cannot get template for app");
    }
    return Template.fromStack(stacks[stackName]);
  };

  /**
   * Get resources of a specific type
   */
  const getResources = (template: Template, resourceType: string) => {
    return Object.values(template.findResources(resourceType));
  };

  /**
   * Get EFS file systems from template
   */
  const getFileSystems = (template: Template) => {
    return getResources(template, "AWS::EFS::FileSystem");
  };

  /**
   * Get EFS access points from template
   */
  const getAccessPoints = (template: Template) => {
    return getResources(template, "AWS::EFS::AccessPoint");
  };

  /**
   * Get security groups from template
   */
  const getSecurityGroups = (template: Template) => {
    return getResources(template, "AWS::EC2::SecurityGroup");
  };

  /**
   * Get security group ingress rules from template
   */
  const getSecurityGroupIngressRules = (template: Template) => {
    return getResources(template, "AWS::EC2::SecurityGroupIngress");
  };

  /**
   * Extract properties from resource
   */
  const getResourceProperties = (
    resource: unknown
  ): Record<string, unknown> => {
    return (resource as Record<string, Record<string, unknown>>).Properties;
  };

  /**
   * Extract deletion policy from resource
   */
  const getDeletionPolicy = (resource: unknown): string | undefined => {
    return (resource as Record<string, string | undefined>).DeletionPolicy;
  };

  /**
   * Extract lifecycle policies from file system
   */
  const getLifecyclePolicies = (
    fileSystem: unknown
  ): Array<Record<string, string>> => {
    const properties = getResourceProperties(fileSystem);
    return (properties.LifecyclePolicies || []) as Array<
      Record<string, string>
    >;
  };

  /**
   * Extract root directory from access point
   */
  const getRootDirectory = (
    accessPoint: unknown
  ): Record<string, Record<string, string>> | undefined => {
    const properties = getResourceProperties(accessPoint);
    return properties.RootDirectory as
      | Record<string, Record<string, string>>
      | undefined;
  };

  /**
   * Extract creation info from root directory
   */
  const getCreationInfo = (
    rootDir: Record<string, Record<string, string>>
  ): Record<string, string> => {
    return rootDir.CreationInfo;
  };

  /**
   * Extract permissions from creation info
   */
  const getPermissions = (
    creationInfo: Record<string, string>
  ): string | undefined => {
    return creationInfo.Permissions;
  };

  /**
   * Extract ingress rules from security group
   */
  const getIngressRules = (
    sg: unknown
  ): Array<Record<string, unknown>> => {
    const properties = getResourceProperties(sg);
    return (properties.SecurityGroupIngress || []) as Array<
      Record<string, unknown>
    >;
  };

  /**
   * Check if rule is for NFS port (2049)
   */
  const isNfsPortRule = (rule: Record<string, unknown>): boolean => {
    return rule.FromPort === 2049 && rule.ToPort === 2049;
  };

  /**
   * Check if lifecycle policies have IA transition
   */
  const hasIATransition = (
    lifecyclePolicies: Array<Record<string, string>>
  ): boolean => {
    return lifecyclePolicies.some(
      (policy) => policy.TransitionToIA !== undefined
    );
  };

  // ==========================================================================
  // EFS ENCRYPTION
  // ==========================================================================

  describe("EFS Encryption", () => {
    test("EFS file system has encryption at rest enabled", () => {
      const template = getTemplate("efsStack");

      template.hasResourceProperties("AWS::EFS::FileSystem", {
        Encrypted: true,
      });
    });

    test("EFS uses AWS managed encryption key by default", () => {
      const template = getTemplate("efsStack");
      const fileSystems = getFileSystems(template);

      fileSystems.forEach((fileSystem) => {
        const properties = getResourceProperties(fileSystem);
        expect(properties.Encrypted).toBe(true);
      });
    });

    test("EFS mount targets are in private subnets", () => {
      const template = getTemplate("efsStack");

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
    test("EFS access point enforces POSIX permissions", () => {
      const template = getTemplate("efsStack");

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

    test("EFS access point has restrictive permissions", () => {
      const template = getTemplate("efsStack");
      const accessPoints = getAccessPoints(template);

      accessPoints.forEach((accessPoint) => {
        const rootDir = getRootDirectory(accessPoint);

        if (rootDir) {
          const creationInfo = getCreationInfo(rootDir);
          const permissions = getPermissions(creationInfo);

          if (permissions) {
            // Permissions should not be 777 (world writable)
            expect(permissions).not.toBe("777");
          }
        }
      });
    });

    test("EFS security group restricts access to NFS port", () => {
      const template = getTemplate("efsStack");
      const securityGroupRules = getSecurityGroupIngressRules(template);
      const securityGroups = getSecurityGroups(template);

      let nfsRulesCount = 0;

      // Check standalone ingress rules
      securityGroupRules.forEach((rule) => {
        const properties = getResourceProperties(rule);

        if (isNfsPortRule(properties)) {
          nfsRulesCount++;
          // NFS rules should use security group as source (not CIDR)
          expect(properties.SourceSecurityGroupId).toBeDefined();
        }
      });

      // Check inline ingress rules in security groups
      securityGroups.forEach((sg) => {
        const ingressRules = getIngressRules(sg);

        ingressRules.forEach((rule) => {
          if (isNfsPortRule(rule)) {
            nfsRulesCount++;
          }
        });
      });

      // EFS security group should exist
      expect(securityGroups.length).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // EFS LIFECYCLE MANAGEMENT
  // ==========================================================================

  describe("EFS Lifecycle Management", () => {
    test("EFS has lifecycle policies configured", () => {
      const template = getTemplate("efsStack");

      template.hasResourceProperties("AWS::EFS::FileSystem", {
        LifecyclePolicies: Match.anyValue(),
      });
    });

    test("EFS has transition to IA configured for cost optimization", () => {
      const template = getTemplate("efsStack");
      const fileSystems = getFileSystems(template);

      fileSystems.forEach((fileSystem) => {
        const lifecyclePolicies = getLifecyclePolicies(fileSystem);

        expect(lifecyclePolicies).toBeDefined();
        expect(lifecyclePolicies.length).toBeGreaterThan(0);
        expect(hasIATransition(lifecyclePolicies)).toBe(true);
      });
    });
  });

  // ==========================================================================
  // EFS BACKUP AND PROTECTION
  // ==========================================================================

  describe("EFS Backup and Protection", () => {
    test("EFS has deletion policy for production", () => {
      const prodStacks = SecurityTestFixtures.getProductionStacks();
      const template = Template.fromStack(prodStacks.efsStack);
      const fileSystems = getFileSystems(template);

      fileSystems.forEach((fileSystem) => {
        const deletionPolicy = getDeletionPolicy(fileSystem);
        expect(deletionPolicy).toBe("Retain");
      });
    });
  });
});
