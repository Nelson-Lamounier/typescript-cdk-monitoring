/** @format */
/// <reference types="jest" />

/**
 * MonitoringInfraStack Creation & Validation Tests
 *
 * Tests basic stack creation, property validation, and error handling.
 */

import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as efs from "aws-cdk-lib/aws-efs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as ssm from "aws-cdk-lib/aws-ssm";
import { Template } from "aws-cdk-lib/assertions";

import { MonitoringInfraStack } from "../../../../../lib/stacks/monitoring/infra-stack";
import { MONITORING_CAPACITY_DEFAULTS } from "../../../../../lib/shared/constants/monitoring-constants";
import {
  createTestApp,
  createTestEnv,
  extendExpectWithCdkMatchers,
} from "../../../utils/stack-test-utils";

import {
  TEST_CONSTANTS,
  InfraTestFixtures,
  createTestStack,
} from "./shared-fixtures";

// ============================================================================
// CUSTOM MATCHERS SETUP
// ============================================================================

extendExpectWithCdkMatchers();

// ============================================================================
// TESTS
// ============================================================================

describe("MonitoringInfraStack - Creation & Validation", () => {
  // ==========================================================================
  // Stack Creation
  // ==========================================================================

  describe("Stack Creation", () => {
    let app: cdk.App;
    let minimalStack: MonitoringInfraStack;
    let allPropertiesStack: MonitoringInfraStack;
    let minimalTemplate: Template;
    let allPropertiesTemplate: Template;

    beforeAll(() => {
      app = createTestApp();

      // Create all stacks before calling Template.fromStack()
      minimalStack = createTestStack(app, "Creation-Minimal");

      const s3Stack = new cdk.Stack(app, "S3StackAllProps", {
        env: createTestEnv(),
      });
      const logsBucket = new s3.Bucket(s3Stack, "LogsBucket", {
        bucketName: cdk.PhysicalName.GENERATE_IF_NEEDED,
      });

      allPropertiesStack = createTestStack(app, "Creation-AllProps", {
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        projectName: "monitoring",
        allowedIpRanges: ["10.0.0.0/8"],
        enableHttps: true,
        certificateArn: TEST_CONSTANTS.CERTIFICATE_ARN,
        enableAccessLogs: true,
        accessLogsBucket: logsBucket,
        minCapacity: MONITORING_CAPACITY_DEFAULTS.DEV.minCapacity,
        maxCapacity: MONITORING_CAPACITY_DEFAULTS.DEV.maxCapacity,
        desiredCapacity: MONITORING_CAPACITY_DEFAULTS.DEV.desiredCapacity,
        instanceType: ec2.InstanceType.of(
          ec2.InstanceClass.T3,
          ec2.InstanceSize.SMALL
        ),
        enableContainerInsights: true,
        enableExecuteCommand: true,
        enableDeletionProtection: true,
        enableSystemUpdates: true,
        enableMetadataTracking: true,
        taskLogRetention: logs.RetentionDays.ONE_WEEK,
        eventLogRetention: logs.RetentionDays.ONE_WEEK,
        albIdleTimeout: cdk.Duration.seconds(120),
        createSsmParameters: true,
        createOutputs: true,
        enableExports: true,
      });

      // Now create templates
      minimalTemplate = Template.fromStack(minimalStack);
      allPropertiesTemplate = Template.fromStack(allPropertiesStack);
    });

    test("creates stack with minimal required properties", () => {
      expect(() => {
        minimalTemplate.resourceCountIs(
          "AWS::ECS::Cluster",
          TEST_CONSTANTS.RESOURCE_COUNTS.ECS_CLUSTER
        );
      }).not.toThrow();

      expect(() => {
        minimalTemplate.resourceCountIs(
          "AWS::ElasticLoadBalancingV2::LoadBalancer",
          TEST_CONSTANTS.RESOURCE_COUNTS.LOAD_BALANCER
        );
      }).not.toThrow();

      expect(() => {
        minimalTemplate.resourceCountIs(
          "AWS::AutoScaling::AutoScalingGroup",
          TEST_CONSTANTS.RESOURCE_COUNTS.AUTO_SCALING_GROUP
        );
      }).not.toThrow();

      const logGroups = minimalTemplate.findResources("AWS::Logs::LogGroup");
      expect(Object.keys(logGroups).length).toBeGreaterThanOrEqual(
        TEST_CONSTANTS.RESOURCE_COUNTS.LOG_GROUPS
      );
    });

    test("exposes public properties correctly", () => {
      expect(minimalStack.cluster).toBeDefined();
      expect(minimalStack.autoScalingGroup).toBeDefined();
      expect(minimalStack.loadBalancer).toBeDefined();
      expect(minimalStack.listener).toBeDefined();
      expect(minimalStack.taskLogGroup).toBeDefined();
      expect(minimalStack.eventLogGroup).toBeDefined();
    });

    test("creates stack with all optional properties", () => {
      expect(() => {
        allPropertiesTemplate.resourceCountIs("AWS::ECS::Cluster", 1);
      }).not.toThrow();

      expect(() => {
        allPropertiesTemplate.resourceCountIs(
          "AWS::ElasticLoadBalancingV2::LoadBalancer",
          1
        );
      }).not.toThrow();
    });
  });

  // ==========================================================================
  // Validation
  // ==========================================================================

  describe("Validation", () => {
    test("throws error when envName is empty", () => {
      const app = createTestApp();
      expect(() => {
        createTestStack(app, TEST_CONSTANTS.STACK_IDS.DEFAULT, { envName: "" });
      }).toThrow(/environment name/i);
    });

    test("throws error when VPC is missing", () => {
      const testApp = createTestApp();
      const fixtures = InfraTestFixtures.getInstance(testApp);
      const efsResources = fixtures.getEfsResources();

      expect(() => {
        new MonitoringInfraStack(testApp, TEST_CONSTANTS.STACK_IDS.DEFAULT, {
          env: createTestEnv(),
          envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
          vpc: null as unknown as ec2.IVpc,
          efsStackName: TEST_CONSTANTS.EFS_STACK_NAME,
          fileSystem: efsResources.fileSystem,
          efsAccessPoint: efsResources.accessPoint,
          efsAvailabilityZone: efsResources.availabilityZone,
          efsSecurityGroup: efsResources.securityGroup,
          efsInitializationComplete: efsResources.initializationComplete,
        });
      }).toThrow(/VPC is required/);
    });

    test("throws error when file system is missing", () => {
      const testApp = createTestApp();
      const fixtures = InfraTestFixtures.getInstance(testApp);
      const vpc = fixtures.getVpc();
      const efsResources = fixtures.getEfsResources();

      expect(() => {
        new MonitoringInfraStack(testApp, TEST_CONSTANTS.STACK_IDS.DEFAULT, {
          env: createTestEnv(),
          envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
          vpc,
          efsStackName: TEST_CONSTANTS.EFS_STACK_NAME,
          fileSystem: null as unknown as efs.FileSystem,
          efsAccessPoint: efsResources.accessPoint,
          efsAvailabilityZone: efsResources.availabilityZone,
          efsSecurityGroup: efsResources.securityGroup,
          efsInitializationComplete: efsResources.initializationComplete,
        });
      }).toThrow(/EFS file system is required/);
    });

    test("throws error when EFS security group is missing", () => {
      const testApp = createTestApp();
      const fixtures = InfraTestFixtures.getInstance(testApp);
      const vpc = fixtures.getVpc();
      const efsResources = fixtures.getEfsResources();

      expect(() => {
        new MonitoringInfraStack(testApp, TEST_CONSTANTS.STACK_IDS.DEFAULT, {
          env: createTestEnv(),
          envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
          vpc,
          efsStackName: TEST_CONSTANTS.EFS_STACK_NAME,
          fileSystem: efsResources.fileSystem,
          efsAccessPoint: efsResources.accessPoint,
          efsAvailabilityZone: efsResources.availabilityZone,
          efsSecurityGroup: null as unknown as ec2.SecurityGroup,
          efsInitializationComplete: efsResources.initializationComplete,
        });
      }).toThrow(/EFS security group is required/);
    });

    test("throws error when EFS initialization complete is missing", () => {
      const testApp = createTestApp();
      const fixtures = InfraTestFixtures.getInstance(testApp);
      const vpc = fixtures.getVpc();
      const efsResources = fixtures.getEfsResources();

      expect(() => {
        new MonitoringInfraStack(testApp, TEST_CONSTANTS.STACK_IDS.DEFAULT, {
          env: createTestEnv(),
          envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
          vpc,
          efsStackName: TEST_CONSTANTS.EFS_STACK_NAME,
          fileSystem: efsResources.fileSystem,
          efsAccessPoint: efsResources.accessPoint,
          efsAvailabilityZone: efsResources.availabilityZone,
          efsSecurityGroup: efsResources.securityGroup,
          efsInitializationComplete: null as unknown as ssm.CfnAssociation,
        });
      }).toThrow(/EFS initialization complete resource is required/);
    });

    test("throws error when enableHttps is true but certificateArn is missing", () => {
      const app = createTestApp();
      expect(() => {
        createTestStack(app, {
          enableHttps: true,
          certificateArn: undefined,
        });
      }).toThrow(/certificateArn is required when enableHttps is true/);
    });

    test("throws error when enableAccessLogs is true but accessLogsBucket is missing", () => {
      const app = createTestApp();
      expect(() => {
        createTestStack(app, {
          enableAccessLogs: true,
          accessLogsBucket: undefined,
        });
      }).toThrow(/accessLogsBucket is required when enableAccessLogs is true/);
    });

    test("throws error for invalid CIDR in allowedIpRanges", () => {
      const app = createTestApp();
      expect(() => {
        createTestStack(app, {
          allowedIpRanges: ["invalid-cidr"],
        });
      }).toThrow(/CIDR/i);
    });

    test("throws error when minCapacity > maxCapacity", () => {
      const app = createTestApp();
      expect(() => {
        createTestStack(app, {
          minCapacity: 3,
          maxCapacity: 2,
        });
      }).toThrow(/capacity/i);
    });

    test("throws error when desiredCapacity > maxCapacity", () => {
      const app = createTestApp();
      expect(() => {
        createTestStack(app, {
          desiredCapacity: 4,
          maxCapacity: 3,
        });
      }).toThrow(/capacity/i);
    });

    test("throws error when desiredCapacity < minCapacity", () => {
      const app = createTestApp();
      expect(() => {
        createTestStack(app, {
          minCapacity: 2,
          desiredCapacity: 1,
        });
      }).toThrow(/capacity/i);
    });
  });

  // ==========================================================================
  // Error Handling
  // ==========================================================================

  describe("Error Handling", () => {
    test("provides helpful error message for HTTPS misconfiguration", () => {
      const app = createTestApp();
      expect(() => {
        createTestStack(app, {
          enableHttps: true,
          certificateArn: undefined,
        });
      }).toThrow(/certificateArn is required when enableHttps is true/i);
    });

    test("provides helpful error message for access logs misconfiguration", () => {
      const app = createTestApp();
      expect(() => {
        createTestStack(app, {
          enableAccessLogs: true,
          accessLogsBucket: undefined,
        });
      }).toThrow(/accessLogsBucket is required when enableAccessLogs is true/i);
    });

    test("validates capacity configuration with helpful error", () => {
      const app = createTestApp();
      expect(() => {
        createTestStack(app, {
          minCapacity: 3,
          maxCapacity: 2,
          desiredCapacity: 2,
        });
      }).toThrow(/capacity/i);
    });
  });
});
