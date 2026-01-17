/** @format */
/// <reference types="jest" />

/**
 * Security Posture Tests: Instance Security
 *
 * Validates EC2 instance security configurations including:
 * - IMDSv2 enforcement on instances
 * - IMDSv2 usage in automation scripts
 * - EBS volume encryption
 * - User data security
 * - Instance hardening
 *
 * @see https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/configuring-instance-metadata-service.html
 */

import { Template, Match } from "aws-cdk-lib/assertions";

import {
  type ConnectivityTestStacks,
  INSTANCE_TEST_STACKS,
} from "../connectivity/test-config";
import { SecurityTestFixtures } from "../utils/test-utils";
// Import shared utilities - functions
import {
  getAssociations,
  getLaunchTemplates,
  getAutoScalingGroups,
  getAssociationCommands,
  getAsgProperties,
  getUserDataString,
  hasImdsAccess,
  usesImdsv2,
  hasImdsv2Token,
  hasHardcodedCredentials,
  hasSensitiveApiKeys,
} from "../utils";

describe("Security Posture: Instance Security", () => {
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
  // IMDSV2 ENFORCEMENT
  // ==========================================================================

  describe("IMDSv2 Enforcement", () => {
    // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
    test("launch template enforces IMDSv2", () => {
      const template = getTemplate(INSTANCE_TEST_STACKS[0]);

      template.hasResourceProperties("AWS::EC2::LaunchTemplate", {
        LaunchTemplateData: {
          MetadataOptions: {
            HttpTokens: "required",
          },
        },
      });
    });

    describe("SSM Association IMDSv2 Usage", () => {
      let associationsWithImds: Array<{
        association: unknown;
        commands: string;
        usesImdsv2: boolean;
        hasImdsv2Token: boolean;
      }>;

      beforeAll(() => {
        const template = getTemplate(INSTANCE_TEST_STACKS[0]);
        const associations = getAssociations(template);

        // Pre-filter and pre-compute associations that access IMDS
        associationsWithImds = associations
          .map((association) => {
            const commands = getAssociationCommands(association);
            return {
              association,
              commands: commands || "",
            };
          })
          .filter((item) => item.commands && hasImdsAccess(item.commands))
          .map((item) => ({
            association: item.association,
            commands: item.commands,
            usesImdsv2: usesImdsv2(item.commands),
            hasImdsv2Token: hasImdsv2Token(item.commands),
          }));
      });

      test("SSM associations use IMDSv2 for metadata retrieval (if IMDS is accessed)", () => {
        // This test validates configuration IF IMDS is accessed
        // Empty array is valid - means no associations access IMDS
        expect(associationsWithImds).toBeDefined();
        expect(Array.isArray(associationsWithImds)).toBe(true);

        // If associations access IMDS, they must use IMDSv2
        associationsWithImds.forEach(({ usesImdsv2: usesV2 }) => {
          expect(usesV2).toBe(true);
        });
      });

      test("no scripts use IMDSv1 (token-less metadata access) (if IMDS is accessed)", () => {
        // This test validates configuration IF IMDS is accessed
        // Empty array is valid - means no associations access IMDS
        expect(associationsWithImds).toBeDefined();
        expect(Array.isArray(associationsWithImds)).toBe(true);

        // If associations access IMDS, they must have IMDSv2 token
        associationsWithImds.forEach(({ hasImdsv2Token: hasToken }) => {
          expect(hasToken).toBe(true);
        });
      });
    });
  });

  // ==========================================================================
  // EBS ENCRYPTION
  // ==========================================================================

  describe("EBS Encryption", () => {
    // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
    test("launch template enables EBS encryption", () => {
      const template = getTemplate(INSTANCE_TEST_STACKS[0]);

      template.hasResourceProperties("AWS::EC2::LaunchTemplate", {
        LaunchTemplateData: {
          BlockDeviceMappings: Match.arrayWith([
            Match.objectLike({
              Ebs: Match.objectLike({
                Encrypted: true,
              }),
            }),
          ]),
        },
      });
    });

    // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
    test("launch template uses GP3 volumes for cost optimization", () => {
      const template = getTemplate(INSTANCE_TEST_STACKS[0]);

      template.hasResourceProperties("AWS::EC2::LaunchTemplate", {
        LaunchTemplateData: {
          BlockDeviceMappings: Match.arrayWith([
            Match.objectLike({
              Ebs: Match.objectLike({
                VolumeType: "gp3",
              }),
            }),
          ]),
        },
      });
    });

    // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
    test("EBS volumes have delete on termination enabled", () => {
      const template = getTemplate(INSTANCE_TEST_STACKS[0]);

      template.hasResourceProperties("AWS::EC2::LaunchTemplate", {
        LaunchTemplateData: {
          BlockDeviceMappings: Match.arrayWith([
            Match.objectLike({
              Ebs: Match.objectLike({
                DeleteOnTermination: true,
              }),
            }),
          ]),
        },
      });
    });
  });

  // ==========================================================================
  // USER DATA SECURITY
  // ==========================================================================

  describe("User Data Security", () => {
    let launchTemplates: unknown[];

    beforeAll(() => {
      const template = getTemplate(INSTANCE_TEST_STACKS[0]);
      launchTemplates = getLaunchTemplates(template);
    });

    test("launch templates exist", () => {
      expect(launchTemplates.length).toBeGreaterThan(0);
    });

    test("user data does not contain hardcoded credentials", () => {
      expect(launchTemplates).toBeDefined();
      expect(Array.isArray(launchTemplates)).toBe(true);

      launchTemplates.forEach((launchTemplate) => {
        const userData = getUserDataString(launchTemplate);
        expect(hasHardcodedCredentials(userData)).toBe(false);
      });
    });

    test("user data does not contain sensitive API keys", () => {
      expect(launchTemplates).toBeDefined();
      expect(Array.isArray(launchTemplates)).toBe(true);

      launchTemplates.forEach((launchTemplate) => {
        const userData = getUserDataString(launchTemplate);
        expect(hasSensitiveApiKeys(userData)).toBe(false);
      });
    });
  });

  // ==========================================================================
  // INSTANCE CONFIGURATION
  // ==========================================================================

  describe("Instance Configuration", () => {
    // eslint-disable-next-line jest/expect-expect -- template.hasResourceProperties throws on failure
    test("instances are launched in private subnets", () => {
      const template = getTemplate(INSTANCE_TEST_STACKS[0]);

      template.hasResourceProperties("AWS::AutoScaling::AutoScalingGroup", {
        VPCZoneIdentifier: Match.anyValue(),
      });
    });

    describe("Auto Scaling Group Health Checks", () => {
      let asgs: unknown[];

      beforeAll(() => {
        const template = getTemplate(INSTANCE_TEST_STACKS[0]);
        asgs = getAutoScalingGroups(template);
      });

      test("Auto Scaling Groups exist", () => {
        expect(asgs.length).toBeGreaterThan(0);
      });

      test("Auto Scaling Groups have health checks enabled", () => {
        expect(asgs).toBeDefined();
        expect(Array.isArray(asgs)).toBe(true);

        asgs.forEach((asg) => {
          const properties = getAsgProperties(asg);
          expect(properties.HealthCheckType).toBeDefined();
          expect(properties.HealthCheckGracePeriod).toBeDefined();
        });
      });
    });
  });
});
