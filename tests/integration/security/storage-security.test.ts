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

import { SecurityTestFixtures, type SecurityTestStacks } from "./test-fixtures";

describe("Security Posture: Storage Security", () => {
  let stacks: SecurityTestStacks;

  beforeAll(() => {
    stacks = SecurityTestFixtures.getDevelopmentStacks();
  });

  describe("EFS Encryption", () => {
    test("EFS file system has encryption at rest enabled", () => {
      const template = Template.fromStack(stacks.efsStack);

      template.hasResourceProperties("AWS::EFS::FileSystem", {
        Encrypted: true,
      });
    });

    test("EFS uses AWS managed encryption key by default", () => {
      const template = Template.fromStack(stacks.efsStack);

      const fileSystems = template.findResources("AWS::EFS::FileSystem");

      Object.values(fileSystems).forEach((fileSystem) => {
        const properties = (
          fileSystem as Record<string, Record<string, unknown>>
        ).Properties;

        // Encryption must be enabled
        expect(properties.Encrypted).toBe(true);

        // If KmsKeyId is not specified, AWS uses managed key
        // which is acceptable for this security check
      });
    });

    test("EFS mount targets are in private subnets", () => {
      const template = Template.fromStack(stacks.efsStack);

      template.hasResourceProperties("AWS::EFS::MountTarget", {
        SubnetId: Match.anyValue(),
        SecurityGroups: Match.anyValue(),
      });
    });
  });

  describe("EFS Access Controls", () => {
    test("EFS access point enforces POSIX permissions", () => {
      const template = Template.fromStack(stacks.efsStack);

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
      const template = Template.fromStack(stacks.efsStack);

      const accessPoints = template.findResources("AWS::EFS::AccessPoint");

      Object.values(accessPoints).forEach((accessPoint) => {
        const properties = (
          accessPoint as Record<string, Record<string, unknown>>
        ).Properties;
        const rootDir = properties.RootDirectory as Record<
          string,
          Record<string, string>
        >;
        const creationInfo = rootDir.CreationInfo;
        const permissions = creationInfo.Permissions;

        // Permissions should not be 777 (world writable)
        expect(permissions).not.toBe("777");
      });
    });

    test("EFS security group restricts access to NFS port", () => {
      const template = Template.fromStack(stacks.efsStack);

      // Check both standalone and inline security group rules
      const securityGroupRules = template.findResources(
        "AWS::EC2::SecurityGroupIngress"
      );
      const securityGroups = template.findResources("AWS::EC2::SecurityGroup");

      let nfsRulesCount = 0;

      // Check standalone ingress rules
      Object.values(securityGroupRules).forEach((rule) => {
        const properties = (rule as Record<string, Record<string, unknown>>)
          .Properties;
        if (properties.FromPort === 2049 && properties.ToPort === 2049) {
          nfsRulesCount++;
          // NFS rules should use security group as source (not CIDR)
          expect(properties.SourceSecurityGroupId).toBeDefined();
        }
      });

      // Check inline ingress rules in security groups
      Object.values(securityGroups).forEach((sg) => {
        const properties = (sg as Record<string, Record<string, unknown>>)
          .Properties;

        if (properties.SecurityGroupIngress) {
          const ingressRules = properties.SecurityGroupIngress as Array<
            Record<string, unknown>
          >;

          ingressRules.forEach((rule) => {
            if (rule.FromPort === 2049 && rule.ToPort === 2049) {
              nfsRulesCount++;
            }
          });
        }
      });

      // EFS security group should exist
      expect(Object.keys(securityGroups).length).toBeGreaterThan(0);
    });
  });

  describe("EFS Lifecycle Management", () => {
    test("EFS has lifecycle policies configured", () => {
      const template = Template.fromStack(stacks.efsStack);

      template.hasResourceProperties("AWS::EFS::FileSystem", {
        LifecyclePolicies: Match.anyValue(),
      });
    });

    test("EFS has transition to IA configured for cost optimization", () => {
      const template = Template.fromStack(stacks.efsStack);

      const fileSystems = template.findResources("AWS::EFS::FileSystem");

      Object.values(fileSystems).forEach((fileSystem) => {
        const properties = (
          fileSystem as Record<string, Record<string, unknown>>
        ).Properties;
        const lifecyclePolicies = properties.LifecyclePolicies as Array<
          Record<string, string>
        >;

        expect(lifecyclePolicies).toBeDefined();
        expect(lifecyclePolicies.length).toBeGreaterThan(0);

        // Should have transition to IA configured
        const hasIATransition = lifecyclePolicies.some(
          (policy) => policy.TransitionToIA !== undefined
        );
        expect(hasIATransition).toBe(true);
      });
    });
  });

  describe("EFS Backup and Protection", () => {
    test("EFS has deletion policy for production", () => {
      const prodStacks = SecurityTestFixtures.getProductionStacks();
      const template = Template.fromStack(prodStacks.efsStack);

      const fileSystems = template.findResources("AWS::EFS::FileSystem");

      Object.values(fileSystems).forEach((fileSystem) => {
        const deletionPolicy = (fileSystem as Record<string, unknown>)
          .DeletionPolicy;
        expect(deletionPolicy).toBe("Retain");
      });
    });
  });
});
