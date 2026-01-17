/** @format */

/**
 * Shared Test Fixtures for MonitoringInfraStack Tests
 *
 * Provides reusable test utilities, fixtures, and helpers
 * for all MonitoringInfraStack test files.
 *
 * @module tests/unit/stacks/monitoring/infra/shared-fixtures
 */

import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as efs from "aws-cdk-lib/aws-efs";
import * as ssm from "aws-cdk-lib/aws-ssm";

import { MonitoringInfraStack } from "../../../../../lib/stacks/monitoring/infra-stack";
import { MonitoringInfraStackProps } from "../../../../../lib/shared/types/stack-types";
import {
  BASE_TEST_CONSTANTS,
  createTestEnv,
} from "../../../utils/stack-test-utils";
import {
  EFS_TEST_CONSTANTS,
  MONITORING_INFRA_CONSTANTS,
  MONITORING_INFRA_RESOURCE_COUNTS,
  MONITORING_INFRA_SSM_PATHS,
} from "../../../shared/constants";

// ============================================================================
// TEST CONFIGURATION
// ============================================================================

/**
 * Stack-specific test constants
 * Extends base constants with Infra-specific values
 */
export const TEST_CONSTANTS = {
  ...BASE_TEST_CONSTANTS,
  VPC: {
    MAX_AZS: 2,
    NAT_GATEWAYS: 0,
  },
  EFS: EFS_TEST_CONSTANTS,
  RESOURCE_COUNTS: MONITORING_INFRA_RESOURCE_COUNTS,
  LOG_SUFFIXES: MONITORING_INFRA_CONSTANTS.LOG_SUFFIXES,
  DESCRIPTIONS: MONITORING_INFRA_CONSTANTS.DESCRIPTIONS,
  SSM_ASSOCIATION_NAMES: MONITORING_INFRA_CONSTANTS.SSM_ASSOCIATION_NAMES,
  SSM_PARAMETER_PATHS: MONITORING_INFRA_SSM_PATHS,
  EFS_STACK_NAME: MONITORING_INFRA_CONSTANTS.EFS_STACK_NAME,
  CERTIFICATE_ARN: MONITORING_INFRA_CONSTANTS.CERTIFICATE_ARN,
} as const;

// ============================================================================
// TEST FIXTURES
// ============================================================================

/**
 * EFS resources structure returned by TestFixtures
 */
export interface EfsResources {
  fileSystem: efs.FileSystem;
  accessPoint: efs.AccessPoint;
  securityGroup: ec2.SecurityGroup;
  initializationComplete: ssm.CfnAssociation;
  availabilityZone: string;
}

/**
 * Extended TestFixtures for MonitoringInfraStack
 * Adds stack-specific helper methods for EFS resources
 */
export class InfraTestFixtures {
  private static instances = new Map<cdk.App, InfraTestFixtures>();
  private vpc: ec2.IVpc | null = null;
  private efsResources: EfsResources | null = null;

  private constructor(private readonly app: cdk.App) {}

  static getInstance(app: cdk.App): InfraTestFixtures {
    if (!app) {
      throw new Error("CDK App instance is required to create TestFixtures");
    }

    if (!InfraTestFixtures.instances.has(app)) {
      InfraTestFixtures.instances.set(app, new InfraTestFixtures(app));
    }

    const instance = InfraTestFixtures.instances.get(app);
    if (!instance) {
      throw new Error("Failed to create TestFixtures instance");
    }
    return instance;
  }

  getVpc(): ec2.IVpc {
    if (!this.vpc) {
      // Create a unique ID to avoid conflicts
      const vpcId = `${TEST_CONSTANTS.STACK_IDS.VPC}-${Date.now()}`;
      const vpcStack = new cdk.Stack(this.app, vpcId, {
        env: createTestEnv(),
      });

      this.vpc = new ec2.Vpc(vpcStack, "Vpc", {
        maxAzs: TEST_CONSTANTS.VPC.MAX_AZS,
        natGateways: TEST_CONSTANTS.VPC.NAT_GATEWAYS,
      });
    }

    return this.vpc;
  }

  getEfsResources(): EfsResources {
    if (!this.efsResources) {
      const vpc = this.getVpc();
      // Create a unique ID to avoid conflicts
      const efsId = `EfsStack-${Date.now()}`;
      const efsStack = new cdk.Stack(this.app, efsId, {
        env: createTestEnv(),
      });

      const fileSystem = new efs.FileSystem(efsStack, "FileSystem", {
        vpc,
        encrypted: true,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });

      const accessPoint = fileSystem.addAccessPoint("AccessPoint", {
        path: TEST_CONSTANTS.EFS.MOUNT_PATH,
        createAcl: {
          ownerUid: TEST_CONSTANTS.EFS.OWNER_UID,
          ownerGid: TEST_CONSTANTS.EFS.OWNER_GID,
          permissions: TEST_CONSTANTS.EFS.PERMISSIONS,
        },
        posixUser: {
          uid: TEST_CONSTANTS.EFS.OWNER_UID,
          gid: TEST_CONSTANTS.EFS.OWNER_GID,
        },
      });

      const securityGroup = new ec2.SecurityGroup(efsStack, "SecurityGroup", {
        vpc,
        description: TEST_CONSTANTS.DESCRIPTIONS.EFS_SECURITY_GROUP,
      });

      const initializationComplete = new ssm.CfnAssociation(
        efsStack,
        "InitComplete",
        {
          name: TEST_CONSTANTS.SSM_ASSOCIATION_NAMES.RUN_SHELL_SCRIPT,
        }
      );

      this.efsResources = {
        fileSystem,
        accessPoint,
        securityGroup,
        initializationComplete,
        availabilityZone: TEST_CONSTANTS.EFS.AVAILABILITY_ZONE,
      };
    }

    return this.efsResources;
  }

  getMinimalProps(): MonitoringInfraStackProps {
    const vpc = this.getVpc();
    const efsResources = this.getEfsResources();

    return {
      env: createTestEnv(),
      envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
      vpc,
      efsStackName: TEST_CONSTANTS.EFS_STACK_NAME,
      fileSystem: efsResources.fileSystem,
      efsAccessPoint: efsResources.accessPoint,
      efsAvailabilityZone: efsResources.availabilityZone,
      efsSecurityGroup: efsResources.securityGroup,
      efsInitializationComplete: efsResources.initializationComplete,
    };
  }

  clear(): void {
    this.vpc = null;
    this.efsResources = null;
  }

  static clearAll(): void {
    InfraTestFixtures.instances.clear();
  }
}

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Create test stack with default configuration
 *
 * Uses InfraTestFixtures caching to improve performance. Each app instance
 * gets its own cached VPC and EFS resources.
 *
 * @param app - CDK app instance
 * @param idOrProps - Stack ID string, or props object if id is omitted
 * @param props - Optional stack properties to override defaults (only used if idOrProps is a string)
 * @returns MonitoringInfraStack instance for testing
 */
export function createTestStack(
  app: cdk.App,
  idOrProps?: string | Partial<MonitoringInfraStackProps>,
  props?: Partial<MonitoringInfraStackProps>
): MonitoringInfraStack {
  if (!app) {
    throw new Error("CDK App instance is required to create test stack");
  }

  let id: string;
  let stackProps: Partial<MonitoringInfraStackProps>;

  if (typeof idOrProps === "string") {
    id = idOrProps;
    stackProps = props ?? {};
  } else {
    id = TEST_CONSTANTS.STACK_IDS.DEFAULT;
    stackProps = idOrProps ?? {};
  }

  if (!id) {
    throw new Error("Stack ID is required to create test stack");
  }

  const fixtures = InfraTestFixtures.getInstance(app);
  const minimalProps = fixtures.getMinimalProps();

  // Filter out undefined values from stackProps to prevent overriding defaults
  const filteredStackProps = Object.fromEntries(
    Object.entries(stackProps).filter(([_, v]) => v !== undefined)
  ) as Partial<MonitoringInfraStackProps>;

  // Merge props, with filteredStackProps taking precedence
  return new MonitoringInfraStack(app, id, {
    ...minimalProps,
    ...filteredStackProps,
  });
}
