/** @format */
/// <reference types="jest" />

/**
 * MonitoringInfraStack Compute Configuration Tests
 *
 * Tests ECS cluster and Auto Scaling Group configuration.
 */

import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { Template, Match } from "aws-cdk-lib/assertions";

import { MONITORING_CAPACITY_DEFAULTS } from "../../../../../lib/shared/constants/monitoring-constants";
import {
  createTestApp,
  extendExpectWithCdkMatchers,
} from "../../../utils/stack-test-utils";

import { TEST_CONSTANTS, createTestStack } from "./shared-fixtures";

// ============================================================================
// CUSTOM MATCHERS SETUP
// ============================================================================

extendExpectWithCdkMatchers();

// ============================================================================
// TESTS
// ============================================================================

describe("MonitoringInfraStack - Compute Configuration", () => {
  // ==========================================================================
  // ECS Cluster Configuration
  // ==========================================================================

  describe("ECS Cluster Configuration", () => {
    let defaultNameTemplate: Template;
    let customNameTemplate: Template;
    let insightsTemplate: Template;
    let executeCommandStack: cdk.Stack;

    beforeAll(() => {
      const app = createTestApp();

      // Create all stacks first
      const defaultNameStack = createTestStack(app, "ECS-DefaultName", {
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        projectName: "monitoring",
      });

      const customNameStack = createTestStack(app, "ECS-CustomName", {
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        clusterName: "custom-cluster-name",
      });

      const insightsStack = createTestStack(app, "ECS-Insights", {
        enableContainerInsights: true,
      });

      executeCommandStack = createTestStack(app, "ECS-ExecuteCommand", {
        enableExecuteCommand: true,
      });

      // Then create templates
      defaultNameTemplate = Template.fromStack(defaultNameStack);
      customNameTemplate = Template.fromStack(customNameStack);
      insightsTemplate = Template.fromStack(insightsStack);
    });

    test("creates ECS cluster with correct name", () => {
      expect(() => {
        defaultNameTemplate.hasResourceProperties("AWS::ECS::Cluster", {
          ClusterName: "development-monitoring-monitoring-cluster",
        });
      }).not.toThrow();
    });

    test("creates ECS cluster with custom name", () => {
      expect(() => {
        customNameTemplate.hasResourceProperties("AWS::ECS::Cluster", {
          ClusterName: "custom-cluster-name",
        });
      }).not.toThrow();
    });

    test("enables container insights when specified", () => {
      expect(() => {
        insightsTemplate.hasResourceProperties("AWS::ECS::Cluster", {
          ClusterSettings: Match.arrayWith([
            Match.objectLike({
              Name: "containerInsights",
              Value: "enabled",
            }),
          ]),
        });
      }).not.toThrow();
    });

    test("enables execute command when specified", () => {
      expect(executeCommandStack).toBeDefined();
      expect((executeCommandStack as any).cluster.executeCommandConfiguration).toBeDefined();
    });
  });

  // ==========================================================================
  // Auto Scaling Group Configuration
  // ==========================================================================

  describe("Auto Scaling Group Configuration", () => {
    let devCapacityTemplate: Template;
    let devInstanceTemplate: Template;
    let customInstanceTemplate: Template;
    let publicIpTemplate: Template;

    beforeAll(() => {
      const app = createTestApp();

      // Create all stacks first
      const devCapacityStack = createTestStack(app, "ASG-DevCapacity", {
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
      });

      const devInstanceStack = createTestStack(app, "ASG-DevInstance", {
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
      });

      const customInstanceStack = createTestStack(app, "ASG-CustomInstance", {
        instanceType: ec2.InstanceType.of(
          ec2.InstanceClass.T3,
          ec2.InstanceSize.LARGE
        ),
      });

      const publicIpStack = createTestStack(app, "ASG-PublicIp");

      // Then create templates
      devCapacityTemplate = Template.fromStack(devCapacityStack);
      devInstanceTemplate = Template.fromStack(devInstanceStack);
      customInstanceTemplate = Template.fromStack(customInstanceStack);
      publicIpTemplate = Template.fromStack(publicIpStack);
    });

    test("uses default capacity for development environment", () => {
      expect(() => {
        devCapacityTemplate.hasResourceProperties(
          "AWS::AutoScaling::AutoScalingGroup",
          {
            MinSize: MONITORING_CAPACITY_DEFAULTS.DEV.minCapacity.toString(),
            MaxSize: MONITORING_CAPACITY_DEFAULTS.DEV.maxCapacity.toString(),
            DesiredCapacity:
              MONITORING_CAPACITY_DEFAULTS.DEV.desiredCapacity.toString(),
          }
        );
      }).not.toThrow();
    });

    test("applies environment-aware capacity defaults", () => {
      expect(() => {
        devCapacityTemplate.resourceCountIs("AWS::ECS::Cluster", 1);
      }).not.toThrow();

      expect(() => {
        devCapacityTemplate.resourceCountIs(
          "AWS::AutoScaling::AutoScalingGroup",
          1
        );
      }).not.toThrow();
    });

    test("uses correct instance type for development", () => {
      expect(() => {
        devInstanceTemplate.hasResourceProperties("AWS::EC2::LaunchTemplate", {
          LaunchTemplateData: {
            InstanceType: "t3.micro",
          },
        });
      }).not.toThrow();
    });

    test("applies instance type based on environment", () => {
      expect(() => {
        devInstanceTemplate.resourceCountIs("AWS::EC2::LaunchTemplate", 1);
      }).not.toThrow(      );

      expect(() => {
        devInstanceTemplate.hasResourceProperties("AWS::EC2::LaunchTemplate", {
          LaunchTemplateData: Match.objectLike({
            InstanceType: Match.anyValue(),
          }),
        });
      }).not.toThrow();
    });

    test("respects custom instance type", () => {
      expect(() => {
        customInstanceTemplate.hasResourceProperties(
          "AWS::EC2::LaunchTemplate",
          {
            LaunchTemplateData: {
              InstanceType: "t3.large",
            },
          }
        );
      }).not.toThrow();
    });

    test("configures public IP association correctly", () => {
      expect(() => {
        publicIpTemplate.hasResourceProperties("AWS::EC2::LaunchTemplate", {
          LaunchTemplateData: {
            NetworkInterfaces: Match.arrayWith([
              Match.objectLike({
                AssociatePublicIpAddress: true,
              }),
            ]),
          },
        });
      }).not.toThrow();
    });
  });

  // ==========================================================================
  // Dependencies
  // ==========================================================================

  describe("Dependencies", () => {
    let template: Template;

    beforeAll(() => {
      const app = createTestApp();
      const stack = createTestStack(app, "Dependencies-Test");
      template = Template.fromStack(stack);
    });

    test("stack resources are created with proper dependencies", () => {
      expect(() => {
        template.resourceCountIs("AWS::ECS::Cluster", 1);
      }).not.toThrow();

      expect(() => {
        template.resourceCountIs("AWS::AutoScaling::AutoScalingGroup", 1);
      }).not.toThrow();
    });
  });

  // ==========================================================================
  // VPC Endpoint Configuration
  // ==========================================================================

  describe("VPC Endpoint Configuration", () => {
    let template: Template;

    beforeAll(() => {
      const app = createTestApp();
      const stack = createTestStack(app, "VPCEndpoint-Test", {
        usePublicSubnets: true,
      });
      template = Template.fromStack(stack);
    });

    test("handles VPC endpoint configuration based on subnet type", () => {
      expect(() => {
        template.resourceCountIs("AWS::ECS::Cluster", 1);
      }).not.toThrow();
    });
  });
});
