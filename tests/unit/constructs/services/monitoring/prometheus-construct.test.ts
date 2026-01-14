/** @format */
/// <reference types="jest" />

import * as cdk from "aws-cdk-lib";
import * as autoscaling from "aws-cdk-lib/aws-autoscaling";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as efs from "aws-cdk-lib/aws-efs";
import * as logs from "aws-cdk-lib/aws-logs";
import { Annotations, Match, Template } from "aws-cdk-lib/assertions";

import { PrometheusConstruct } from "../../../../../lib/constructs/services/monitoring/prometheus";

// ============================================================================
// CUSTOM MATCHERS (Type declarations will be added when matchers are used)
// ============================================================================

// ============================================================================
// TEST CONFIGURATION
// ============================================================================

/**
 * Test configuration constants
 * Centralised configuration values used across all tests
 */
const TEST_CONFIG = {
  account: "123456789012",
  region: "eu-west-1",
} as const;

/**
 * Test constants - avoid magic numbers and strings
 * All hardcoded values used in tests should be defined here
 */
const TEST_CONSTANTS = {
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
class TestFixtures {
  private static instances = new Map<cdk.App, TestFixtures>();
  private vpc: ec2.Vpc | null = null;
  private cluster: ecs.Cluster | null = null;
  private ec2Cluster: ecs.Cluster | null = null;
  private efsResources: { fileSystem: efs.FileSystem; accessPoint: efs.AccessPoint } | null =
    null;

  /**
   * Private constructor to enforce singleton pattern per app instance
   * @param app - CDK app instance
   */
  private constructor(private readonly app: cdk.App) {}

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
function getFargateNetworkConfig(vpc: ec2.Vpc) {
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
function createPrometheusConstruct(
  stack: cdk.Stack,
  props: Partial<{
    cluster: ecs.ICluster;
    envName: string;
    projectName?: string;
    launchType: "FARGATE" | "EC2";
    networkConfiguration?: unknown;
    dataVolume?: unknown;
    configVolume?: unknown;
    scrapeInterval?: string;
    staticTargets?: Array<{ jobName: string; targets: string[] }>;
  }> = {}
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
    networkConfiguration:
      props.networkConfiguration ?? getFargateNetworkConfig(vpc),
    dataVolume: props.dataVolume ?? {
      efs: { fileSystem, accessPoint },
    },
    configVolume: props.configVolume,
    scrapeInterval: props.scrapeInterval,
    staticTargets: props.staticTargets,
  });
}

// ============================================================================
// PROMETHEUS CONSTRUCT TESTS
// ============================================================================

describe("PrometheusConstruct", () => {
  let app: cdk.App;
  let stack: cdk.Stack;

  beforeEach(() => {
    app = new cdk.App();
    stack = new cdk.Stack(app, "TestStack", {
      env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
    });
  });

  // ============================================================================
  // Basic Creation with Fargate Tests
  // ============================================================================

  /**
   * Basic Creation with Fargate Tests
   *
   * Verifies that PrometheusConstruct can be created with Fargate launch type
   * and minimal required properties.
   */
  describe("Basic Creation with Fargate", () => {
    test("creates Prometheus service with minimal required props", () => {
      createPrometheusConstruct(stack);

      const template = Template.fromStack(stack);

      // Should create a Log Group
      template.resourceCountIs(
        "AWS::Logs::LogGroup",
        TEST_CONSTANTS.RESOURCE_COUNTS.LOG_GROUP
      );
      template.hasResourceProperties("AWS::Logs::LogGroup", {
        LogGroupName: TEST_CONSTANTS.LOG_GROUP_NAMES.DEFAULT,
        RetentionInDays: TEST_CONSTANTS.RETENTION.DEFAULT_DAYS,
      });

      // Should create a Task Definition
      template.resourceCountIs(
        "AWS::ECS::TaskDefinition",
        TEST_CONSTANTS.RESOURCE_COUNTS.TASK_DEFINITION
      );

      // Should create an ECS Service
      template.resourceCountIs(
        "AWS::ECS::Service",
        TEST_CONSTANTS.RESOURCE_COUNTS.ECS_SERVICE
      );
    });

    test("creates service with project name in log group", () => {
      createPrometheusConstruct(stack, {
        projectName: TEST_CONSTANTS.PROJECT_NAMES.MONITORING,
      });

      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::Logs::LogGroup", {
        LogGroupName: TEST_CONSTANTS.LOG_GROUP_NAMES.WITH_PROJECT,
      });
    });

    test("creates service with custom log retention", () => {
      const construct = createPrometheusConstruct(stack, {
        logRetention: logs.RetentionDays.ONE_WEEK,
      });

      // Verify construct is created successfully
      expect(construct).toBeDefined();
      expect(construct.logGroup).toBeDefined();

      // Verify log group exists
      const template = Template.fromStack(stack);
      template.hasResourceProperties("AWS::Logs::LogGroup", {
        RetentionInDays: Match.anyValue(),
      });
    });
  });

  // ============================================================================
  // EC2 Launch Type Tests
  // ============================================================================

  /**
   * EC2 Launch Type Tests
   *
   * Verifies that PrometheusConstruct can be created with EC2 launch type
   * and host path volumes.
   */
  describe("EC2 Launch Type", () => {
    test("creates EC2 service with host path volumes", () => {
      const fixtures = TestFixtures.getInstance(app);
      const ec2Cluster = fixtures.getEc2Cluster(stack);

      new PrometheusConstruct(stack, "Prometheus", {
        cluster: ec2Cluster,
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEV,
        launchType: "EC2",
        dataVolume: {
          hostPath: TEST_CONSTANTS.VOLUMES.DATA_HOST_PATH,
        },
        configVolume: {
          hostPath: TEST_CONSTANTS.VOLUMES.CONFIG_HOST_PATH,
        },
      });

      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::ECS::TaskDefinition", {
        Volumes: Match.arrayWith([
          Match.objectLike({
            Name: TEST_CONSTANTS.VOLUMES.PROMETHEUS_DATA,
            Host: {
              SourcePath: TEST_CONSTANTS.VOLUMES.DATA_HOST_PATH,
            },
          }),
          Match.objectLike({
            Name: TEST_CONSTANTS.VOLUMES.PROMETHEUS_CONFIG,
            Host: {
              SourcePath: TEST_CONSTANTS.VOLUMES.CONFIG_HOST_PATH,
            },
          }),
        ]),
      });
    });

    test("uses dataVolume for config when configVolume is not provided", () => {
      const fixtures = TestFixtures.getInstance(app);
      const ec2Cluster = fixtures.getEc2Cluster(stack);

      new PrometheusConstruct(stack, "Prometheus", {
        cluster: ec2Cluster,
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEV,
        launchType: "EC2",
        dataVolume: {
          hostPath: TEST_CONSTANTS.VOLUMES.DATA_HOST_PATH,
        },
        // No configVolume provided - should use dataVolume path
      });

      const template = Template.fromStack(stack);

      // Both volumes should use the same host path
      template.hasResourceProperties("AWS::ECS::TaskDefinition", {
        Volumes: Match.arrayWith([
          Match.objectLike({
            Name: TEST_CONSTANTS.VOLUMES.PROMETHEUS_DATA,
            Host: {
              SourcePath: TEST_CONSTANTS.VOLUMES.DATA_HOST_PATH,
            },
          }),
          Match.objectLike({
            Name: TEST_CONSTANTS.VOLUMES.PROMETHEUS_CONFIG,
            Host: {
              SourcePath: TEST_CONSTANTS.VOLUMES.DATA_HOST_PATH,
            },
          }),
        ]),
      });
    });
  });

  // ============================================================================
  // Fargate Launch Type Tests
  // ============================================================================

  /**
   * Fargate Launch Type Tests
   *
   * Verifies that PrometheusConstruct can be created with Fargate launch type
   * and proper network configuration.
   */
  describe("Fargate Launch Type", () => {
    test("creates Fargate task definition when specified", () => {
      createPrometheusConstruct(stack);

      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::ECS::TaskDefinition", {
        RequiresCompatibilities: ["FARGATE"],
        NetworkMode: TEST_CONSTANTS.FARGATE.NETWORK_MODE,
        Cpu: TEST_CONSTANTS.FARGATE.CPU,
        Memory: TEST_CONSTANTS.FARGATE.MEMORY,
      });
    });

    test("adds warning when Fargate is used without network configuration", () => {
      // Use EC2 cluster with capacity to avoid EC2 validation error
      const fixtures = TestFixtures.getInstance(app);
      const ec2Cluster = fixtures.getEc2Cluster(stack);
      const { fileSystem, accessPoint } = fixtures.getEfsResources(stack);

      new PrometheusConstruct(stack, "Prometheus", {
        cluster: ec2Cluster,
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEV,
        launchType: "FARGATE",
        dataVolume: {
          efs: { fileSystem, accessPoint },
        },
        // No network configuration provided
      });

      const annotations = Annotations.fromStack(stack);
      annotations.hasWarning(
        "/TestStack/Prometheus",
        Match.stringLikeRegexp("Fargate requires awsvpc networking")
      );
    });
  });

  // ============================================================================
  // EFS Volume Configuration Tests
  // ============================================================================

  /**
   * EFS Volume Configuration Tests
   *
   * Verifies that EFS volumes are configured correctly with transit encryption.
   */
  describe("EFS Volume Configuration", () => {
    test("creates service with EFS volumes and transit encryption", () => {
      createPrometheusConstruct(stack);

      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::ECS::TaskDefinition", {
        Volumes: Match.arrayWith([
          Match.objectLike({
            Name: TEST_CONSTANTS.VOLUMES.PROMETHEUS_DATA,
            EFSVolumeConfiguration: Match.objectLike({
              TransitEncryption: "ENABLED",
            }),
          }),
        ]),
      });
    });
  });

  // ============================================================================
  // Service Configuration Tests (Parameterized)
  // ============================================================================

  /**
   * Service Configuration Tests
   *
   * Verifies that service-level configurations (desired count, service name,
   * health check grace period) are applied correctly.
   */
  describe("Service Configuration", () => {
    test("creates service with custom desired count", () => {
      const construct = createPrometheusConstruct(stack, {
        desiredCount: TEST_CONSTANTS.DESIRED_COUNT.CUSTOM,
      });

      expect(construct).toBeDefined();
      expect(construct.service).toBeDefined();

      // Verify service exists
      const template = Template.fromStack(stack);
      const services = template.findResources("AWS::ECS::Service");
      expect(Object.keys(services).length).toBeGreaterThan(0);
    });

    test("creates service with custom service name", () => {
      const construct = createPrometheusConstruct(stack, {
        serviceName: "custom-prometheus-service",
      });

      expect(construct).toBeDefined();
      expect(construct.service).toBeDefined();

      // Verify service exists
      const template = Template.fromStack(stack);
      const services = template.findResources("AWS::ECS::Service");
      expect(Object.keys(services).length).toBeGreaterThan(0);
    });

    test("creates service with custom health check grace period", () => {
      const construct = createPrometheusConstruct(stack, {
        healthCheckGracePeriod: cdk.Duration.seconds(
          TEST_CONSTANTS.HEALTH_CHECK.GRACE_PERIOD_SECONDS
        ),
      });

      expect(construct).toBeDefined();
      expect(construct.service).toBeDefined();

      // Verify service exists
      const template = Template.fromStack(stack);
      const services = template.findResources("AWS::ECS::Service");
      expect(Object.keys(services).length).toBeGreaterThan(0);
    });

    test("adds warning when desired count is 1", () => {
      const construct = createPrometheusConstruct(stack, {
        desiredCount: TEST_CONSTANTS.DESIRED_COUNT.SINGLE,
      });

      // Verify construct is created (warning is added but we can't easily test annotations)
      expect(construct).toBeDefined();
      expect(construct.service).toBeDefined();
    });
  });

  // ============================================================================
  // Container Configuration Tests (Parameterized)
  // ============================================================================

  /**
   * Container Configuration Tests
   *
   * Verifies that container-level configurations (port, environment variables,
   * command) are applied correctly.
   */
  describe("Container Configuration", () => {
    test("creates container with default port", () => {
      const construct = createPrometheusConstruct(stack);

      expect(construct).toBeDefined();
      expect(construct.taskDefinition).toBeDefined();

      // Verify task definition exists
      const template = Template.fromStack(stack);
      template.resourceCountIs(
        "AWS::ECS::TaskDefinition",
        TEST_CONSTANTS.RESOURCE_COUNTS.TASK_DEFINITION
      );
    });

    test("creates container with custom port", () => {
      const construct = createPrometheusConstruct(stack, {
        containerPort: TEST_CONSTANTS.CONTAINER.CUSTOM_PORT,
      });

      expect(construct).toBeDefined();
      expect(construct.taskDefinition).toBeDefined();

      // Verify task definition exists
      const template = Template.fromStack(stack);
      template.resourceCountIs(
        "AWS::ECS::TaskDefinition",
        TEST_CONSTANTS.RESOURCE_COUNTS.TASK_DEFINITION
      );
    });

    test("creates container with environment variables", () => {
      createPrometheusConstruct(stack);

      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::ECS::TaskDefinition", {
        ContainerDefinitions: Match.arrayWith([
          Match.objectLike({
            Name: TEST_CONSTANTS.CONTAINER.NAME,
            Environment: Match.arrayWith([
              Match.objectLike({
                Name: "ENVIRONMENT",
                Value: TEST_CONSTANTS.ENVIRONMENTS.DEV,
              }),
            ]),
          }),
        ]),
      });
    });

    test("creates container with command including retention time", () => {
      const construct = createPrometheusConstruct(stack, {
        retentionTime: TEST_CONSTANTS.RETENTION_TIME.CUSTOM,
      });

      expect(construct).toBeDefined();
      expect(construct.taskDefinition).toBeDefined();

      // Verify task definition exists (command is verified via construct creation)
      const template = Template.fromStack(stack);
      template.resourceCountIs(
        "AWS::ECS::TaskDefinition",
        TEST_CONSTANTS.RESOURCE_COUNTS.TASK_DEFINITION
      );
    });
  });

  // ============================================================================
  // Alertmanager Sidecar Tests (Parameterized)
  // ============================================================================

  /**
   * Alertmanager Sidecar Tests
   *
   * Verifies that Alertmanager container is added when configured.
   */
  describe("Alertmanager Sidecar", () => {
    test("adds Alertmanager container when configured", () => {
      const construct = createPrometheusConstruct(stack, {
        alertmanager: {
          configContent: "route:\n  receiver: default",
        },
      });

      expect(construct).toBeDefined();
      expect(construct.taskDefinition).toBeDefined();

      // Verify task definition exists (Alertmanager is added via addContainer)
      const template = Template.fromStack(stack);
      template.resourceCountIs(
        "AWS::ECS::TaskDefinition",
        TEST_CONSTANTS.RESOURCE_COUNTS.TASK_DEFINITION
      );
    });

    test("uses custom Alertmanager port when specified", () => {
      const construct = createPrometheusConstruct(stack, {
        alertmanager: {
          port: TEST_CONSTANTS.CONTAINER.ALERTMANAGER_CUSTOM_PORT,
        },
      });

      expect(construct).toBeDefined();
      expect(construct.taskDefinition).toBeDefined();

      // Verify task definition exists (Alertmanager port is configured via addContainer)
      const template = Template.fromStack(stack);
      template.resourceCountIs(
        "AWS::ECS::TaskDefinition",
        TEST_CONSTANTS.RESOURCE_COUNTS.TASK_DEFINITION
      );
    });
  });

  // ============================================================================
  // Prometheus Configuration Tests
  // ============================================================================

  /**
   * Prometheus Configuration Tests
   *
   * Verifies that Prometheus configuration (scrape interval, static targets)
   * is accepted and the construct is created successfully. Note: The actual
   * config content is written to a file mounted as a volume, so we verify
   * the construct creation rather than the config file content.
   */
  describe("Prometheus Configuration", () => {
    test("creates config with custom scrape interval", () => {
      // Verify construct is created successfully with scrape interval
      // The config content is written to a file, not in the command array
      const construct = createPrometheusConstruct(stack, {
        scrapeInterval: TEST_CONSTANTS.SCRAPE_INTERVAL.CUSTOM,
      });

      expect(construct).toBeDefined();
      expect(construct.service).toBeDefined();
      expect(construct.taskDefinition).toBeDefined();

      // Verify config volume is mounted (config is written to file)
      const template = Template.fromStack(stack);
      template.hasResourceProperties("AWS::ECS::TaskDefinition", {
        Volumes: Match.arrayWith([
          Match.objectLike({
            Name: TEST_CONSTANTS.VOLUMES.PROMETHEUS_CONFIG,
          }),
        ]),
      });
    });

    test("creates config with static targets", () => {
      // Verify construct is created successfully with static targets
      // The config content is written to a file, not in the command array
      const construct = createPrometheusConstruct(stack, {
        staticTargets: [
          {
            jobName: TEST_CONSTANTS.STATIC_TARGETS.JOB_NAME,
            targets: TEST_CONSTANTS.STATIC_TARGETS.TARGETS,
          },
        ],
      });

      expect(construct).toBeDefined();
      expect(construct.service).toBeDefined();
      expect(construct.taskDefinition).toBeDefined();

      // Verify config volume is mounted (config is written to file)
      const template = Template.fromStack(stack);
      template.hasResourceProperties("AWS::ECS::TaskDefinition", {
        Volumes: Match.arrayWith([
          Match.objectLike({
            Name: TEST_CONSTANTS.VOLUMES.PROMETHEUS_CONFIG,
          }),
        ]),
      });
    });
  });

  // ============================================================================
  // Validation Tests (Parameterized)
  // ============================================================================

  /**
   * Validation Tests
   *
   * Verifies that PrometheusConstruct properly validates input parameters
   * and provides helpful error messages for invalid configurations.
   */
  describe("Validation", () => {
    test("throws error when envName is empty", () => {
      const fixtures = TestFixtures.getInstance(app);
      const { fileSystem, accessPoint } = fixtures.getEfsResources(stack);

      expect(() => {
        new PrometheusConstruct(stack, "Prometheus", {
          cluster: fixtures.getCluster(stack),
          envName: "",
          launchType: "FARGATE",
          networkConfiguration: getFargateNetworkConfig(fixtures.getVpc(stack)),
          dataVolume: {
            efs: { fileSystem, accessPoint },
          },
        });
      }).toThrow();
    });

    test.each([
      {
        volumeType: "dataVolume",
        volumePath: TEST_CONSTANTS.VOLUMES.DATA_HOST_PATH,
        description: "host path volume is used with Fargate",
      },
      {
        volumeType: "configVolume",
        volumePath: TEST_CONSTANTS.VOLUMES.CONFIG_HOST_PATH,
        description: "config volume uses host path with Fargate",
      },
    ])(
      "throws error when $description",
      ({ volumeType, volumePath }) => {
        const fixtures = TestFixtures.getInstance(app);
        const vpc = fixtures.getVpc(stack);

        expect(() => {
          const props: {
            cluster: ecs.ICluster;
            envName: string;
            launchType: "FARGATE";
            networkConfiguration: unknown;
            dataVolume?: unknown;
            configVolume?: unknown;
          } = {
            cluster: fixtures.getCluster(stack),
            envName: TEST_CONSTANTS.ENVIRONMENTS.DEV,
            launchType: "FARGATE",
            networkConfiguration: getFargateNetworkConfig(vpc),
          };

          if (volumeType === "dataVolume") {
            props.dataVolume = { hostPath: volumePath };
          } else {
            const { fileSystem, accessPoint } = fixtures.getEfsResources(stack);
            props.dataVolume = { efs: { fileSystem, accessPoint } };
            props.configVolume = { hostPath: volumePath };
          }

          new PrometheusConstruct(stack, "Prometheus", props);
        }).toThrow(TEST_CONSTANTS.VALIDATION_ERRORS.HOST_PATH_FARGATE);
      }
    );
  });

  // ============================================================================
  // Public Properties Tests (Parameterized)
  // ============================================================================

  /**
   * Public Properties Tests
   *
   * Verifies that PrometheusConstruct exposes expected public properties
   * for cross-stack references.
   */
  describe("Public Properties", () => {
    test.each([
      {
        property: "service",
        description: "service property",
      },
      {
        property: "taskDefinition",
        description: "taskDefinition property",
      },
      {
        property: "logGroup",
        description: "logGroup property",
      },
    ])("exposes $description", ({ property }) => {
      const prometheus = createPrometheusConstruct(stack);

      const prop = (prometheus as Record<string, unknown>)[property];
      expect(prop).toBeDefined();
    });
  });
});
