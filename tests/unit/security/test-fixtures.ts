/** @format */

/**
 * Shared Test Fixtures for Security Posture Tests
 *
 * Provides common test configuration, helpers, and utilities
 * for all security posture test suites.
 */

import * as cdk from "aws-cdk-lib";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";

import { NetworkingStack } from "../../../lib/stacks/foundation/networking-stack";
import { MonitoringEfsStack } from "../../../lib/stacks/monitoring/efs-stack";
import { MonitoringInfraStack } from "../../../lib/stacks/monitoring/infra-stack";
import { MonitoringServiceStack } from "../../../lib/stacks/monitoring/service-stack";

// ============================================================================
// TEST CONFIGURATION
// ============================================================================

export const TEST_CONSTANTS = {
  ACCOUNT: "123456789012",
  REGION: "eu-west-1",
  VPC_CIDR: "10.0.0.0/16",
  ALLOWED_CIDR: "10.0.0.0/8",
  ENVIRONMENTS: {
    DEVELOPMENT: "development",
    PRODUCTION: "production",
  },
} as const;

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface SecurityTestStacks {
  app: cdk.App;
  networkingStack: NetworkingStack;
  efsStack: MonitoringEfsStack;
  infraStack: MonitoringInfraStack;
  serviceStack: MonitoringServiceStack;
}

// ============================================================================
// STACK CREATION
// ============================================================================

/**
 * Create a complete monitoring stack for security testing
 *
 * @param environment - Environment name (development or production)
 * @returns Complete monitoring stack hierarchy
 */
export function createSecurityTestStacks(
  environment: string = TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT
): SecurityTestStacks {
  const app = new cdk.App();

  // Layer 1: Networking Stack
  const networkingStack = new NetworkingStack(app, "SecurityTestNetworking", {
    env: {
      account: TEST_CONSTANTS.ACCOUNT,
      region: TEST_CONSTANTS.REGION,
    },
    envName: environment,
    projectName: "monitoring",
    vpcCidr: TEST_CONSTANTS.VPC_CIDR,
    enableVpcFlowLogs: true,
    flowLogRetention: logs.RetentionDays.ONE_WEEK,
  });

  // Layer 2: EFS Stack
  const efsStack = new MonitoringEfsStack(app, "SecurityTestEfs", {
    env: {
      account: TEST_CONSTANTS.ACCOUNT,
      region: TEST_CONSTANTS.REGION,
    },
    envName: environment,
    projectName: "monitoring",
    vpc: networkingStack.vpc,
  });

  // Create a mock S3 bucket for dashboard storage (required by infra stack)
  const dashboardBucket = s3.Bucket.fromBucketName(
    app,
    "MockDashboardBucket",
    `monitoring-dashboards-${environment}-${TEST_CONSTANTS.REGION}`
  );

  // Layer 3: Infrastructure Stack
  const infraStack = new MonitoringInfraStack(app, "SecurityTestInfra", {
    env: {
      account: TEST_CONSTANTS.ACCOUNT,
      region: TEST_CONSTANTS.REGION,
    },
    envName: environment,
    projectName: "monitoring",
    vpc: networkingStack.vpc,
    efsStackName: efsStack.stackName,
    fileSystem: efsStack.fileSystem,
    efsAccessPoint: efsStack.accessPoint,
    efsAvailabilityZone: efsStack.efsAvailabilityZone,
    efsSecurityGroup: efsStack.mountTargetSecurityGroup,
    efsInitializationComplete: efsStack.efsInitializationExecution,
    dashboardBucket,
    minCapacity: 1,
    desiredCapacity: 1,
    maxCapacity: 2,
    allowedIpRanges: [TEST_CONSTANTS.ALLOWED_CIDR],
  });

  // Layer 4: Service Stack
  const serviceStack = new MonitoringServiceStack(app, "SecurityTestService", {
    env: {
      account: TEST_CONSTANTS.ACCOUNT,
      region: TEST_CONSTANTS.REGION,
    },
    envName: environment,
    projectName: "monitoring",
    cluster: infraStack.cluster,
    loadBalancer: infraStack.loadBalancer,
    listener: infraStack.listener,
  });

  return {
    app,
    networkingStack,
    efsStack,
    infraStack,
    serviceStack,
  };
}

/**
 * Singleton fixture cache to reuse stacks across tests
 */
class TestFixtureCache {
  private static instance: TestFixtureCache;
  private developmentStacks?: SecurityTestStacks;
  private productionStacks?: SecurityTestStacks;

  private constructor() {}

  static getInstance(): TestFixtureCache {
    if (!TestFixtureCache.instance) {
      TestFixtureCache.instance = new TestFixtureCache();
    }
    return TestFixtureCache.instance;
  }

  getDevelopmentStacks(): SecurityTestStacks {
    if (!this.developmentStacks) {
      this.developmentStacks = createSecurityTestStacks(
        TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT
      );
    }
    return this.developmentStacks;
  }

  getProductionStacks(): SecurityTestStacks {
    if (!this.productionStacks) {
      this.productionStacks = createSecurityTestStacks(
        TEST_CONSTANTS.ENVIRONMENTS.PRODUCTION
      );
    }
    return this.productionStacks;
  }

  clear(): void {
    this.developmentStacks = undefined;
    this.productionStacks = undefined;
  }
}

export const SecurityTestFixtures = TestFixtureCache.getInstance();
