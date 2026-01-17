/** @format */

import * as cdk from "aws-cdk-lib";
import * as autoscaling from "aws-cdk-lib/aws-autoscaling";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as efs from "aws-cdk-lib/aws-efs";

import { PrometheusConstruct } from "../../../../../../lib/constructs/services/monitoring/prometheus";
import type { PrometheusServiceConstructProps } from "../../../../../../lib/shared/types/service-types";

// ============================================================================
// TEST CONFIGURATION
// ============================================================================

/**
 * Test configuration constants
 * Centralised configuration values used across all tests
 */
export const TEST_CONFIG = {
  account: "123456789012",
  region: "eu-west-1",
} as const;

/**
 * Test constants - avoid magic numbers and strings
 * All hardcoded values used in tests should be defined here
 */
export const TEST_CONSTANTS = {
  ENVIRONMENTS: {
    DEV: "dev",
    PRODUCTION: "production",
  },
  PROJECT_NAMES: {
    MONITORING: "monitoring",
  },
  RESOURCE_COUNTS: {
    LOG_GROUP: 1,
    TASK_DEFINITION: 1,
    ECS_SERVICE: 1,
  },
  LOG_GROUP_NAMES: {
    DEFAULT: "/ecs/dev-prometheus",
    WITH_PROJECT: "/ecs/monitoring-prometheus",
  },
  CONTAINER: {
    NAME: "prometheus",
    DEFAULT_PORT: 9090,
    CUSTOM_PORT: 8080,
    ALERTMANAGER_NAME: "alertmanager",
    ALERTMANAGER_DEFAULT_PORT: 9093,
    ALERTMANAGER_CUSTOM_PORT: 9094,
  },
  VOLUMES: {
    PROMETHEUS_DATA: "prometheus-data",
    PROMETHEUS_CONFIG: "prometheus-config",
    DATA_HOST_PATH: "/mnt/prometheus/data",
    CONFIG_HOST_PATH: "/mnt/prometheus/config",
  },
  MOUNT_PATHS: {
    DATA: "/prometheus",
    CONFIG: "/etc/prometheus",
  },
  FARGATE: {
    CPU: "512",
    MEMORY: "1024",
    NETWORK_MODE: "awsvpc",
  },
  RETENTION: {
    DEFAULT_DAYS: 30,
    ONE_WEEK_DAYS: 7,
  },
  DESIRED_COUNT: {
    DEFAULT: 1,
    CUSTOM: 3,
    SINGLE: 1,
  },
  HEALTH_CHECK: {
    GRACE_PERIOD_SECONDS: 300,
  },
  RETENTION_TIME: {
    DEFAULT: "30d",
    CUSTOM: "30d",
  },
  SCRAPE_INTERVAL: {
    DEFAULT: "15s",
    CUSTOM: "15s",
  },
  STATIC_TARGETS: {
    JOB_NAME: "node-exporter",
    TARGETS: ["localhost:9100", "10.0.0.1:9100"],
  },
  VALIDATION_ERRORS: {
    HOST_PATH_FARGATE: "Host path volumes are not supported for Fargate",
  },
  EFS: {
    POSIX_UID: "65534",
    POSIX_GID: "65534",
    PERMISSIONS: "750",
    PATH: "/prometheus",
  },
  INSTANCE: {
    CLASS: ec2.InstanceClass.T3,
    SIZE: ec2.InstanceSize.MICRO,
  },
  ASG: {
    MIN_CAPACITY: 1,
    MAX_CAPACITY: 1,
  },
} as const;

// ============================================================================
// TEST FIXTURES CACHING CLASS
// ============================================================================

/**
 * TestFixtures caching class
 *
 * Provides cached test fixtures (VPC, Cluster, EFS) to improve test performance
 * and reduce resource creation overhead. Each app instance gets its own cached fixtures.
 *
 * @example
 * ```typescript
 * const fixtures = TestFixtures.getInstance(app);
 * const { vpc, cluster } = fixtures.getBasicResources();
 * ```
 */
export class TestFixtures {
  private static instances = new Map<cdk.App, TestFixtures>();
  private vpc: ec2.Vpc | null = null;
  private cluster: ecs.Cluster | null = null;
  private ec2Cluster: ecs.Cluster | null = null;
  private efsResources: { fileSystem: efs.FileSystem; accessPoint: efs.AccessPoint } | null =
    null;

  /**
   * Private constructor to enforce singleton pattern per app instance
   * @param _app - CDK app instance (used as Map key, not stored)
   */
  private constructor(_app: cdk.App) {
    // App is used as Map key in getInstance, not stored in instance
    void _app;
  }

  /**
   * Get or create TestFixtures instance for the given app
   *
   * Each app instance gets its own TestFixtures singleton to avoid
   * construct name conflicts across different test suites.
   *
   * @param app - CDK app instance
   * @returns TestFixtures instance for the app
   */
  static getInstance(app: cdk.App): TestFixtures {
    if (!app) {
      throw new Error("CDK App instance is required to create TestFixtures");
    }

    if (!TestFixtures.instances.has(app)) {
      TestFixtures.instances.set(app, new TestFixtures(app));
    }

    const instance = TestFixtures.instances.get(app);
    if (!instance) {
      throw new Error("Failed to create TestFixtures instance");
    }
    return instance;
  }

  /**
   * Get or create VPC for testing
   *
   * VPC is cached per app instance to avoid recreating it for each test.
   *
   * @param stack - Stack instance
   * @returns VPC instance for testing
   */
  getVpc(stack: cdk.Stack): ec2.Vpc {
    if (!this.vpc) {
      this.vpc = new ec2.Vpc(stack, "Vpc", { maxAzs: 2 });
    }
    return this.vpc;
  }

  /**
   * Get or create basic ECS cluster for testing
   *
   * Cluster is cached per app instance to avoid recreating it for each test.
   *
   * @param stack - Stack instance
   * @returns ECS Cluster instance for testing
   */
  getCluster(stack: cdk.Stack): ecs.Cluster {
    if (!this.cluster) {
      const vpc = this.getVpc(stack);
      this.cluster = new ecs.Cluster(stack, "Cluster", { vpc });
    }
    return this.cluster;
  }

  /**
   * Get or create EC2 cluster with capacity for EC2 launch type tests
   *
   * EC2 cluster is cached per app instance to avoid recreating it for each test.
   *
   * @param stack - Stack instance
   * @returns ECS Cluster instance with EC2 capacity
   */
  getEc2Cluster(stack: cdk.Stack): ecs.Cluster {
    if (!this.ec2Cluster) {
      const vpc = this.getVpc(stack);
      this.ec2Cluster = new ecs.Cluster(stack, "Ec2Cluster", { vpc });

      const asg = new autoscaling.AutoScalingGroup(stack, "ASG", {
        vpc,
        instanceType: ec2.InstanceType.of(
          TEST_CONSTANTS.INSTANCE.CLASS,
          TEST_CONSTANTS.INSTANCE.SIZE
        ),
        machineImage: ecs.EcsOptimizedImage.amazonLinux2(),
        minCapacity: TEST_CONSTANTS.ASG.MIN_CAPACITY,
        maxCapacity: TEST_CONSTANTS.ASG.MAX_CAPACITY,
      });

      const capacityProvider = new ecs.AsgCapacityProvider(stack, "CapacityProvider", {
        autoScalingGroup: asg,
      });

      this.ec2Cluster.addAsgCapacityProvider(capacityProvider);
    }
    return this.ec2Cluster;
  }

  /**
   * Get or create EFS file system and access point for testing
   *
   * EFS resources are cached per app instance to avoid recreating them for each test.
   *
   * @param stack - Stack instance
   * @returns EFS file system and access point
   */
  getEfsResources(
    stack: cdk.Stack
  ): { fileSystem: efs.FileSystem; accessPoint: efs.AccessPoint } {
    if (!this.efsResources) {
      const vpc = this.getVpc(stack);
      const fileSystem = new efs.FileSystem(stack, "EfsFileSystem", {
        vpc,
      });

      const accessPoint = new efs.AccessPoint(stack, "EfsAccessPoint", {
        fileSystem,
        path: TEST_CONSTANTS.EFS.PATH,
        posixUser: {
          uid: TEST_CONSTANTS.EFS.POSIX_UID,
          gid: TEST_CONSTANTS.EFS.POSIX_GID,
        },
        createAcl: {
          ownerUid: TEST_CONSTANTS.EFS.POSIX_UID,
          ownerGid: TEST_CONSTANTS.EFS.POSIX_GID,
          permissions: TEST_CONSTANTS.EFS.PERMISSIONS,
        },
      });

      this.efsResources = { fileSystem, accessPoint };
    }
    return this.efsResources;
  }

  /**
   * Clear cached fixtures for this app instance
   *
   * Useful for cleanup between test suites or when fixtures need to be recreated.
   */
  clear(): void {
    this.vpc = null;
    this.cluster = null;
    this.ec2Cluster = null;
    this.efsResources = null;
  }

  /**
   * Clear all cached fixtures across all app instances
   *
   * Useful for global cleanup after all tests complete.
   */
  static clearAll(): void {
    TestFixtures.instances.clear();
  }
}

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Get network configuration for Fargate
 *
 * @param vpc - VPC instance
 * @returns Fargate network configuration
 */
export function getFargateNetworkConfig(vpc: ec2.Vpc) {
  return {
    awsvpcConfiguration: {
      subnets: vpc.privateSubnets.map((s) => s.subnetId),
      securityGroups: [],
    },
  };
}

/**
 * Create Prometheus construct with default Fargate configuration
 *
 * @param stack - Stack instance
 * @param props - Optional construct properties
 * @returns PrometheusConstruct instance
 */
export function createPrometheusConstruct(
  stack: cdk.Stack,
  props: Partial<PrometheusServiceConstructProps> = {}
): PrometheusConstruct {
  const fixtures = TestFixtures.getInstance(stack.node.root as cdk.App);
  const vpc = fixtures.getVpc(stack);
  const cluster = props.cluster ?? fixtures.getCluster(stack);
  const { fileSystem, accessPoint } = fixtures.getEfsResources(stack);

  return new PrometheusConstruct(stack, "Prometheus", {
    cluster,
    envName: props.envName ?? TEST_CONSTANTS.ENVIRONMENTS.DEV,
    projectName: props.projectName,
    launchType: props.launchType ?? "FARGATE",
    serviceName: props.serviceName,
    desiredCount: props.desiredCount,
    minHealthyPercent: props.minHealthyPercent,
    maxHealthyPercent: props.maxHealthyPercent,
    healthCheckGracePeriod: props.healthCheckGracePeriod,
    logRetention: props.logRetention,
    networkConfiguration:
      props.networkConfiguration ?? getFargateNetworkConfig(vpc),
    dataVolume: props.dataVolume ?? {
      efs: { fileSystem, accessPoint },
    },
    configVolume: props.configVolume as PrometheusServiceConstructProps["configVolume"],
    scrapeInterval: props.scrapeInterval,
    staticTargets: props.staticTargets,
    retentionTime: props.retentionTime,
    containerPort: props.containerPort,
    alertmanager: props.alertmanager,
  });
}
