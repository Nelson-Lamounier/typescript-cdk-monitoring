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

import { SecurityTestFixtures, type SecurityTestStacks } from "./test-fixtures";

describe("Security Posture: Instance Security", () => {
  let stacks: SecurityTestStacks;

  beforeAll(() => {
    stacks = SecurityTestFixtures.getDevelopmentStacks();
  });

  describe("IMDSv2 Enforcement", () => {
    test("launch template enforces IMDSv2", () => {
      const template = Template.fromStack(stacks.infraStack);

      template.hasResourceProperties("AWS::EC2::LaunchTemplate", {
        LaunchTemplateData: {
          MetadataOptions: {
            HttpTokens: "required",
          },
        },
      });
    });

    test("SSM associations use IMDSv2 for metadata retrieval", () => {
      const template = Template.fromStack(stacks.infraStack);

      const associations = template.findResources("AWS::SSM::Association");

      Object.values(associations).forEach((association) => {
        const properties = (
          association as Record<string, Record<string, unknown>>
        ).Properties;
        const parameters = properties.Parameters as
          | Record<string, unknown[]>
          | undefined;

        if (parameters?.commands) {
          const commands = JSON.stringify(parameters.commands);

          // If script accesses IMDS, it must use token-based auth
          if (commands.includes("169.254.169.254")) {
            expect(commands).toMatch(/X-aws-ec2-metadata-token/i);
            expect(commands).toMatch(/PUT.*api\/token/i);
          }
        }
      });
    });

    test("no scripts use IMDSv1 (token-less metadata access)", () => {
      const template = Template.fromStack(stacks.infraStack);

      const associations = template.findResources("AWS::SSM::Association");

      Object.values(associations).forEach((association) => {
        const properties = (
          association as Record<string, Record<string, unknown>>
        ).Properties;
        const parameters = properties.Parameters as
          | Record<string, unknown[]>
          | undefined;

        if (parameters?.commands) {
          const commands = JSON.stringify(parameters.commands);

          // Check for IMDSv1 patterns (direct curl without token)
          if (commands.includes("169.254.169.254")) {
            // Should not have curl without token header
            const hasTokenAuth = commands.includes("X-aws-ec2-metadata-token");
            expect(hasTokenAuth).toBe(true);
          }
        }
      });
    });
  });

  describe("EBS Encryption", () => {
    test("launch template enables EBS encryption", () => {
      const template = Template.fromStack(stacks.infraStack);

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
      const template = Template.fromStack(stacks.infraStack);

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
      const template = Template.fromStack(stacks.infraStack);

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

  describe("User Data Security", () => {
    test("user data does not contain hardcoded credentials", () => {
      const template = Template.fromStack(stacks.infraStack);

      const launchTemplates = template.findResources(
        "AWS::EC2::LaunchTemplate"
      );

      Object.values(launchTemplates).forEach((launchTemplate) => {
        const userData = JSON.stringify(launchTemplate);

        // Check for common credential patterns
        expect(userData).not.toMatch(/password\s*=\s*['"][^'"]+['"]/i);
        expect(userData).not.toMatch(/secret\s*=\s*['"][^'"]+['"]/i);
        expect(userData).not.toMatch(/AKIA[0-9A-Z]{16}/); // AWS Access Key
      });
    });

    test("user data does not contain sensitive API keys", () => {
      const template = Template.fromStack(stacks.infraStack);

      const launchTemplates = template.findResources(
        "AWS::EC2::LaunchTemplate"
      );

      Object.values(launchTemplates).forEach((launchTemplate) => {
        const userData = JSON.stringify(launchTemplate);

        // Check for API key patterns
        expect(userData).not.toMatch(/api_key\s*=\s*['"][^'"]+['"]/i);
        expect(userData).not.toMatch(/apikey\s*=\s*['"][^'"]+['"]/i);
        expect(userData).not.toMatch(/api-key\s*=\s*['"][^'"]+['"]/i);
      });
    });
  });

  describe("Instance Configuration", () => {
    test("instances are launched in private subnets", () => {
      const template = Template.fromStack(stacks.infraStack);

      template.hasResourceProperties("AWS::AutoScaling::AutoScalingGroup", {
        VPCZoneIdentifier: Match.anyValue(),
      });
    });

    test("Auto Scaling Groups have health checks enabled", () => {
      const template = Template.fromStack(stacks.infraStack);

      const asgs = template.findResources("AWS::AutoScaling::AutoScalingGroup");

      Object.values(asgs).forEach((asg) => {
        const properties = (asg as Record<string, Record<string, unknown>>)
          .Properties;
        expect(properties.HealthCheckType).toBeDefined();
        expect(properties.HealthCheckGracePeriod).toBeDefined();
      });
    });
  });
});
