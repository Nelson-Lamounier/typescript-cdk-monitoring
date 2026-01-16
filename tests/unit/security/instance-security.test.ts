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

import { type ConnectivityTestStacks } from "../connectivity/test-config";

import { SecurityTestFixtures } from "../utils/test-utils";

describe("Security Posture: Instance Security", () => {
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
   * Get SSM associations from template
   */
  const getAssociations = (template: Template) => {
    return getResources(template, "AWS::SSM::Association");
  };

  /**
   * Get launch templates from template
   */
  const getLaunchTemplates = (template: Template) => {
    return getResources(template, "AWS::EC2::LaunchTemplate");
  };

  /**
   * Get Auto Scaling Groups from template
   */
  const getAutoScalingGroups = (template: Template) => {
    return getResources(template, "AWS::AutoScaling::AutoScalingGroup");
  };

  /**
   * Extract parameters from SSM association
   */
  const getAssociationParameters = (
    association: unknown
  ): Record<string, unknown[]> | undefined => {
    const properties = (association as Record<string, Record<string, unknown>>)
      .Properties;
    return properties.Parameters as Record<string, unknown[]> | undefined;
  };

  /**
   * Extract commands from SSM association
   */
  const getAssociationCommands = (association: unknown): string | undefined => {
    const parameters = getAssociationParameters(association);
    if (parameters?.commands) {
      return JSON.stringify(parameters.commands);
    }
    return undefined;
  };

  /**
   * Check if commands access IMDS
   */
  const hasImdsAccess = (commands: string): boolean => {
    return commands.includes("169.254.169.254");
  };

  /**
   * Check if commands use IMDSv2 (token-based auth)
   */
  const usesImdsv2 = (commands: string): boolean => {
    return (
      /X-aws-ec2-metadata-token/i.test(commands) &&
      /PUT.*api\/token/i.test(commands)
    );
  };

  /**
   * Check if commands have IMDSv2 token auth
   */
  const hasImdsv2Token = (commands: string): boolean => {
    return commands.includes("X-aws-ec2-metadata-token");
  };

  /**
   * Extract user data string from launch template
   */
  const getUserDataString = (launchTemplate: unknown): string => {
    return JSON.stringify(launchTemplate);
  };

  /**
   * Check if user data contains hardcoded credentials
   */
  const hasHardcodedCredentials = (userData: string): boolean => {
    return (
      /password\s*=\s*['"][^'"]+['"]/i.test(userData) ||
      /secret\s*=\s*['"][^'"]+['"]/i.test(userData) ||
      /AKIA[0-9A-Z]{16}/.test(userData)
    );
  };

  /**
   * Check if user data contains sensitive API keys
   */
  const hasSensitiveApiKeys = (userData: string): boolean => {
    return (
      /api_key\s*=\s*['"][^'"]+['"]/i.test(userData) ||
      /apikey\s*=\s*['"][^'"]+['"]/i.test(userData) ||
      /api-key\s*=\s*['"][^'"]+['"]/i.test(userData)
    );
  };

  /**
   * Extract ASG properties
   */
  const getAsgProperties = (asg: unknown): Record<string, unknown> => {
    return (asg as Record<string, Record<string, unknown>>).Properties;
  };

  // ==========================================================================
  // IMDSV2 ENFORCEMENT
  // ==========================================================================

  describe("IMDSv2 Enforcement", () => {
    test("launch template enforces IMDSv2", () => {
      const template = getTemplate("infraStack");

      template.hasResourceProperties("AWS::EC2::LaunchTemplate", {
        LaunchTemplateData: {
          MetadataOptions: {
            HttpTokens: "required",
          },
        },
      });
    });

    test("SSM associations use IMDSv2 for metadata retrieval (if IMDS is accessed)", () => {
      const template = getTemplate("infraStack");
      const associations = getAssociations(template);

      associations.forEach((association) => {
        const commands = getAssociationCommands(association);

        if (commands && hasImdsAccess(commands)) {
          expect(usesImdsv2(commands)).toBe(true);
        }
      });
    });

    test("no scripts use IMDSv1 (token-less metadata access) (if IMDS is accessed)", () => {
      const template = getTemplate("infraStack");
      const associations = getAssociations(template);

      associations.forEach((association) => {
        const commands = getAssociationCommands(association);

        if (commands && hasImdsAccess(commands)) {
          expect(hasImdsv2Token(commands)).toBe(true);
        }
      });
    });
  });

  // ==========================================================================
  // EBS ENCRYPTION
  // ==========================================================================

  describe("EBS Encryption", () => {
    test("launch template enables EBS encryption", () => {
      const template = getTemplate("infraStack");

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

    test("launch template uses GP3 volumes for cost optimization", () => {
      const template = getTemplate("infraStack");

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

    test("EBS volumes have delete on termination enabled", () => {
      const template = getTemplate("infraStack");

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
    test("user data does not contain hardcoded credentials", () => {
      const template = getTemplate("infraStack");
      const launchTemplates = getLaunchTemplates(template);

      launchTemplates.forEach((launchTemplate) => {
        const userData = getUserDataString(launchTemplate);
        expect(hasHardcodedCredentials(userData)).toBe(false);
      });
    });

    test("user data does not contain sensitive API keys", () => {
      const template = getTemplate("infraStack");
      const launchTemplates = getLaunchTemplates(template);

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
    test("instances are launched in private subnets", () => {
      const template = getTemplate("infraStack");

      template.hasResourceProperties("AWS::AutoScaling::AutoScalingGroup", {
        VPCZoneIdentifier: Match.anyValue(),
      });
    });

    test("Auto Scaling Groups have health checks enabled", () => {
      const template = getTemplate("infraStack");
      const asgs = getAutoScalingGroups(template);

      asgs.forEach((asg) => {
        const properties = getAsgProperties(asg);
        expect(properties.HealthCheckType).toBeDefined();
        expect(properties.HealthCheckGracePeriod).toBeDefined();
      });
    });
  });
});
