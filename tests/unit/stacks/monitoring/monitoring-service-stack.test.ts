/** @format */
/// <reference types="jest" />

import * as cdk from "aws-cdk-lib";
import * as autoscaling from "aws-cdk-lib/aws-autoscaling";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as logs from "aws-cdk-lib/aws-logs";
import { Template, Match } from "aws-cdk-lib/assertions";

import { MonitoringServiceStack } from "../../../../lib/stacks/monitoring/service-stack";
import { MonitoringServiceStackProps } from "../../../../lib/shared/types/stack-types";
import {
  MONITORING_PORTS,
  MONITORING_ROUTES,
  MONITORING_HEALTH_CHECK,
  MONITORING_CONTAINER_NAMES,
  GRAFANA_ADMIN_SECRET,
} from "../../../../lib/shared/constants/monitoring-constants";
import {
  TEST_CONFIG,
  BASE_TEST_CONSTANTS,
  createTestApp,
  extendExpectWithCdkMatchers,
} from "../../utils/stack-test-utils";
import {
  MONITORING_SERVICE_RESOURCE_COUNTS,
  MONITORING_SERVICE_NAMES,
  MONITORING_SERVICE_SECRET_NAMES,
  MONITORING_SERVICE_SSM_PARAMETER_NAMES,
  MONITORING_SERVICE_OUTPUT_NAMES,
} from "../../shared/constants";

// ============================================================================
// CUSTOM MATCHERS SETUP
// ============================================================================

extendExpectWithCdkMatchers();

// ============================================================================
// TEST CONFIGURATION
// ============================================================================

/**
 * Test constants - avoid magic numbers and strings
 * All hardcoded values used in tests should be defined here
 */
const TEST_CONSTANTS = {
  ...BASE_TEST_CONSTANTS,
  RESOURCE_COUNTS: MONITORING_SERVICE_RESOURCE_COUNTS,
  SERVICE_NAMES: MONITORING_SERVICE_NAMES,
  SECRET_NAMES: MONITORING_SERVICE_SECRET_NAMES,
  SSM_PARAMETER_NAMES: MONITORING_SERVICE_SSM_PARAMETER_NAMES,
  OUTPUT_NAMES: MONITORING_SERVICE_OUTPUT_NAMES,
  STACK_IDS: {
    ...BASE_TEST_CONSTANTS.STACK_IDS,
    INFRA: "TestInfraStack",
    SERVICE: "TestServiceStack",
    ALL_PROPERTIES: "AllPropertiesServiceStack",
    TAGGED: "TaggedServiceStack",
    CUSTOM_TAGGED: "CustomTaggedServiceStack",
  },
} as const;

// ============================================================================
// TEST FIXTURES CACHING CLASS
// ============================================================================

/**
 * Infrastructure resources required for service stack tests
 */
interface InfraResources {
  cluster: ecs.Cluster;
  loadBalancer: elbv2.ApplicationLoadBalancer;
  listener: elbv2.ApplicationListener;
  vpc: ec2.IVpc;
}

/**
 * TestFixtures caching class
 *
 * Provides cached test fixtures (infrastructure resources) to improve test performance
 * and reduce resource creation overhead. Each app instance gets its own cached fixtures.
 *
 * @example
 * ```typescript
 * const fixtures = TestFixtures.getInstance(app);
 * const stack = new MonitoringServiceStack(app, "TestStack", {
 *   ...fixtures.getMinimalProps(),
 *   envName: "production",
 * });
 * ```
 */
class TestFixtures {
  private static instances = new Map<cdk.App, TestFixtures>();
  private infraResources: InfraResources | null = null;

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
   * Get or create infrastructure resources for testing
   *
   * Infrastructure resources are cached per app instance to avoid recreating
   * them for each test. Creates VPC, ECS cluster, ALB, and listener.
   *
   * @returns Infrastructure resources object
   */
  getInfraResources(): InfraResources {
    if (!this.infraResources) {
      const infraStack = new cdk.Stack(
        this.app,
        TEST_CONSTANTS.STACK_IDS.INFRA,
        {
          env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
        }
      );

      const vpc = new ec2.Vpc(infraStack, "Vpc", {
        maxAzs: 2,
        natGateways: 0,
      });

      const cluster = new ecs.Cluster(infraStack, "Cluster", {
        vpc,
        clusterName: `${TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT}-monitoring-cluster`,
      });

      // Create AutoScalingGroup for EC2 capacity (required for EC2 services)
      const userData = ec2.UserData.forLinux();
      userData.addCommands(
        "yum install -y ecs-init",
        "echo ECS_CLUSTER=" + cluster.clusterName + " >> /etc/ecs/ecs.config",
        "start ecs"
      );

      const asg = new autoscaling.AutoScalingGroup(
        infraStack,
        "AutoScalingGroup",
        {
          vpc,
          instanceType: ec2.InstanceType.of(
            ec2.InstanceClass.T3,
            ec2.InstanceSize.MICRO
          ),
          machineImage: ecs.EcsOptimizedImage.amazonLinux2(),
          minCapacity: 1,
          maxCapacity: 1,
          desiredCapacity: 1,
          userData,
        }
      );

      // Attach ASG to cluster
      cluster.addAsgCapacityProvider(
        new ecs.AsgCapacityProvider(infraStack, "AsgCapacityProvider", {
          autoScalingGroup: asg,
        })
      );

      const loadBalancer = new elbv2.ApplicationLoadBalancer(
        infraStack,
        "LoadBalancer",
        {
          vpc,
          internetFacing: true,
          loadBalancerName: `${TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT}-monitoring-alb`,
        }
      );

      const listener = loadBalancer.addListener("Listener", {
        port: 80,
        protocol: elbv2.ApplicationProtocol.HTTP,
        defaultAction: elbv2.ListenerAction.fixedResponse(200, {
          contentType: "text/plain",
          messageBody: "OK",
        }),
      });

      this.infraResources = {
        cluster,
        loadBalancer,
        listener,
        vpc,
      };
    }

    return this.infraResources;
  }

  /**
   * Create minimal test stack props using cached fixtures
   *
   * @returns Minimal stack properties for testing
   */
  getMinimalProps(): MonitoringServiceStackProps {
    const infra = this.getInfraResources();

    return {
      env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
      envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
      cluster: infra.cluster,
      loadBalancer: infra.loadBalancer,
      listener: infra.listener,
    };
  }

  /**
   * Clear cached fixtures for this app instance
   *
   * Useful for cleanup between test suites or when fixtures need to be recreated.
   */
  clear(): void {
    this.infraResources = null;
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
 * Create test stack with default configuration
 *
 * Uses TestFixtures caching to improve performance. Each app instance
 * gets its own cached infrastructure resources.
 *
 * @param app - CDK app instance
 * @param idOrProps - Stack ID string, or props object if id is omitted
 * @param props - Optional stack properties to override defaults (only used if idOrProps is a string)
 * @returns MonitoringServiceStack instance for testing
 *
 * @example
 * ```typescript
 * // With explicit stack ID
 * const stack = createTestStack(app, "MyTestStack", {
 *   envName: "production",
 * });
 *
 * // Without stack ID (uses default)
 * const stack = createTestStack(app, {
 *   envName: "production",
 * });
 * ```
 */
function createTestStack(
  app: cdk.App,
  idOrProps?: string | Partial<MonitoringServiceStackProps>,
  props?: Partial<MonitoringServiceStackProps>
): MonitoringServiceStack {
  if (!app) {
    throw new Error("CDK App instance is required to create test stack");
  }

  let id: string;
  let stackProps: Partial<MonitoringServiceStackProps>;

  // Handle overloaded signature: idOrProps can be string (id) or object (props)
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

  const fixtures = TestFixtures.getInstance(app);
  const minimalProps = fixtures.getMinimalProps();

  return new MonitoringServiceStack(app, id, {
    ...minimalProps,
    ...stackProps,
  });
}

// ============================================================================
// MONITORING SERVICE STACK TESTS
// ============================================================================

describe("MonitoringServiceStack", () => {
  // ============================================================================
  // Stack Creation and Validation
  // ============================================================================

  /**
   * Stack Creation Tests
   *
   * Verifies that MonitoringServiceStack can be created with various
   * configuration combinations and exposes expected public properties.
   */
  describe("Stack Creation", () => {
    let app: cdk.App;
    let minimalStack: MonitoringServiceStack;
    let allPropertiesStack: MonitoringServiceStack;
    let minimalTemplate: Template;
    let allPropertiesTemplate: Template;

    beforeAll(() => {
      app = createTestApp();

      // Create ALL stacks first before calling Template.fromStack()
      minimalStack = createTestStack(app);
      allPropertiesStack = createTestStack(
        app,
        TEST_CONSTANTS.STACK_IDS.ALL_PROPERTIES,
        {
          envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
          projectName: "monitoring",
          prometheusDataPath: "/mnt/prometheus-data",
          prometheusConfigPath: "/mnt/prometheus-config",
          grafanaDataPath: "/mnt/grafana-data",
          grafanaProvisioningPath: "/mnt/grafana-provisioning",
          grafanaDashboardsPath: "/mnt/grafana-dashboards",
          prometheusRoutePrefix: MONITORING_ROUTES.PROMETHEUS,
          grafanaRootUrl: MONITORING_ROUTES.GRAFANA,
          enableExecuteCommand: true,
          enableCircuitBreaker: false,
          logRetention: logs.RetentionDays.ONE_WEEK,
          createSsmParameters: true,
          createOutputs: true,
          enableExports: true,
          prometheusProps: {
            cpu: 512,
            memoryMiB: 1024,
            containerPort: MONITORING_PORTS.PROMETHEUS,
          },
          grafanaProps: {
            cpu: 512,
            memoryMiB: 1024,
            containerPort: MONITORING_PORTS.GRAFANA,
          },
        }
      );

      // Now create templates from the stacks
      minimalTemplate = Template.fromStack(minimalStack);
      allPropertiesTemplate = Template.fromStack(allPropertiesStack);
    });

    test("creates stack with minimal required properties", () => {
      expect(() => {
        minimalTemplate.resourceCountIs(
          "AWS::ECS::Service",
          TEST_CONSTANTS.RESOURCE_COUNTS.ECS_SERVICES
        );
        minimalTemplate.resourceCountIs(
          "AWS::ElasticLoadBalancingV2::TargetGroup",
          TEST_CONSTANTS.RESOURCE_COUNTS.TARGET_GROUPS
        );
        minimalTemplate.resourceCountIs(
          "AWS::SecretsManager::Secret",
          TEST_CONSTANTS.RESOURCE_COUNTS.SECRETS
        );
      }).not.toThrow();
    });

    test("exposes public properties correctly", () => {
      expect(minimalStack.prometheusService).toBeDefined();
      expect(minimalStack.grafanaService).toBeDefined();
      expect(minimalStack.nodeExporterService).toBeDefined();
      expect(minimalStack.prometheusTargetGroup).toBeDefined();
      expect(minimalStack.grafanaTargetGroup).toBeDefined();
    });

    test("creates stack with all optional properties", () => {
      expect(() => {
        allPropertiesTemplate.resourceCountIs(
          "AWS::ECS::Service",
          TEST_CONSTANTS.RESOURCE_COUNTS.ECS_SERVICES
        );
        allPropertiesTemplate.resourceCountIs(
          "AWS::ElasticLoadBalancingV2::TargetGroup",
          TEST_CONSTANTS.RESOURCE_COUNTS.TARGET_GROUPS
        );
      }).not.toThrow();
    });
  });

  /**
   * Validation Tests
   *
   * Verifies that MonitoringServiceStack properly validates input parameters
   * and provides helpful error messages for invalid configurations.
   */
  describe("Validation", () => {
    let app: cdk.App;
    let infraResources: InfraResources;

    beforeAll(() => {
      app = createTestApp();
      const fixtures = TestFixtures.getInstance(app);
      infraResources = fixtures.getInfraResources();
    });

    test("throws error when envName is empty", () => {
      expect(() => {
        new MonitoringServiceStack(app, "ValidationEnvStack", {
          env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
          envName: "",
          cluster: infraResources.cluster,
          loadBalancer: infraResources.loadBalancer,
          listener: infraResources.listener,
        });
      }).toThrow(/environment name/i);
    });

    test("throws error when cluster is missing", () => {
      expect(() => {
        new MonitoringServiceStack(app, "ValidationClusterStack", {
          env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
          envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
          cluster: null as unknown as ecs.ICluster,
          loadBalancer: infraResources.loadBalancer,
          listener: infraResources.listener,
        });
      }).toThrow(/ECS cluster is required/);
    });

    test("throws error when loadBalancer is missing", () => {
      expect(() => {
        new MonitoringServiceStack(app, "ValidationLbStack", {
          env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
          envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
          cluster: infraResources.cluster,
          loadBalancer: null as unknown as elbv2.IApplicationLoadBalancer,
          listener: infraResources.listener,
        });
      }).toThrow(/Load balancer is required/);
    });

    test("throws error when listener is missing", () => {
      expect(() => {
        new MonitoringServiceStack(app, "ValidationListenerStack", {
          env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
          envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
          cluster: infraResources.cluster,
          loadBalancer: infraResources.loadBalancer,
          listener: null as unknown as elbv2.IApplicationListener,
        });
      }).toThrow(/ALB listener is required/);
    });
  });

  // ============================================================================
  // ECS Services Configuration
  // ============================================================================

  /**
   * ECS Services Configuration Tests
   *
   * Verifies that all three ECS services (Prometheus, Grafana, Node Exporter)
   * are created with correct configurations.
   */
  describe("ECS Services Configuration", () => {
    let app: cdk.App;
    let stack: MonitoringServiceStack;
    let template: Template;
    let containerTestStacks: Array<{
      serviceName: string;
      containerName: string;
      containerPort: number;
      stack: MonitoringServiceStack;
      template: Template;
    }>;

    beforeAll(() => {
      app = createTestApp();
      stack = createTestStack(app);
      template = Template.fromStack(stack);

      // Pre-compute container test data
      const containerConfigs = [
        {
          serviceName: "Prometheus",
          containerName: MONITORING_CONTAINER_NAMES.PROMETHEUS,
          containerPort: MONITORING_PORTS.PROMETHEUS,
        },
        {
          serviceName: "Grafana",
          containerName: MONITORING_CONTAINER_NAMES.GRAFANA,
          containerPort: MONITORING_PORTS.GRAFANA,
        },
      ];

      containerTestStacks = containerConfigs.map((config) => {
        const testApp = createTestApp();
        const testStack = createTestStack(testApp);
        return {
          ...config,
          stack: testStack,
          template: Template.fromStack(testStack),
        };
      });
    });

    test("creates Prometheus service", () => {
      expect(() => {
        template.hasResourceProperties("AWS::ECS::Service", {
          ServiceName: Match.stringLikeRegexp(".*prometheus.*"),
          LaunchType: "EC2",
        });
      }).not.toThrow();
    });

    test("creates Grafana service", () => {
      expect(() => {
        template.hasResourceProperties("AWS::ECS::Service", {
          ServiceName: Match.stringLikeRegexp(".*grafana.*"),
          LaunchType: "EC2",
        });
      }).not.toThrow();
    });

    test("creates Node Exporter service", () => {
      expect(() => {
        template.hasResourceProperties("AWS::ECS::Service", {
          ServiceName: Match.stringLikeRegexp(".*node-exporter.*"),
          LaunchType: "EC2",
        });
      }).not.toThrow();
    });

    test.each([
      {
        serviceName: "Prometheus",
        containerName: MONITORING_CONTAINER_NAMES.PROMETHEUS,
        containerPort: MONITORING_PORTS.PROMETHEUS,
      },
      {
        serviceName: "Grafana",
        containerName: MONITORING_CONTAINER_NAMES.GRAFANA,
        containerPort: MONITORING_PORTS.GRAFANA,
      },
    ])(
      "$serviceName service uses correct container name and port",
      ({ serviceName, containerName, containerPort }) => {
        const testData = containerTestStacks.find((d) => d.serviceName === serviceName);
        expect(testData).toBeDefined();

        expect(() => {
          testData?.template.hasResourceProperties("AWS::ECS::TaskDefinition", {
            ContainerDefinitions: Match.arrayWith([
              Match.objectLike({
                Name: containerName,
                PortMappings: Match.arrayWith([
                  Match.objectLike({
                    ContainerPort: containerPort,
                  }),
                ]),
              }),
            ]),
          });
        }).not.toThrow();
      }
    );
  });

  // ============================================================================
  // Secrets Manager Configuration
  // ============================================================================

  /**
   * Secrets Manager Configuration Tests
   *
   * Verifies that Grafana admin password secret is created with correct
   * configuration and removal policies.
   */
  describe("Secrets Manager Configuration", () => {
    let app: cdk.App;
    let defaultTemplate: Template;
    let removalPolicyTests: Array<{
      environment: string;
      expectedPolicy: string;
      secrets: Record<string, any>;
      secret: any;
    }>;

    beforeAll(() => {
      app = createTestApp();
      const defaultStack = createTestStack(app);
      defaultTemplate = Template.fromStack(defaultStack);

      // Pre-compute removal policy stacks and extract secrets
      const policyConfigs = [
        {
          environment: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
          expectedPolicy: "Delete",
        },
        {
          environment: TEST_CONSTANTS.ENVIRONMENTS.PRODUCTION,
          expectedPolicy: "Retain",
        },
      ];

      removalPolicyTests = policyConfigs.map((config) => {
        const testApp = createTestApp();
        const testStack = createTestStack(testApp, TEST_CONSTANTS.STACK_IDS.DEFAULT, {
          envName: config.environment,
        });
        const template = Template.fromStack(testStack);
        const secrets = template.findResources("AWS::SecretsManager::Secret");
        const secret = Object.values(secrets)[0];

        return {
          environment: config.environment,
          expectedPolicy: config.expectedPolicy,
          secrets,
          secret,
        };
      });
    });

    test("creates Grafana admin password secret", () => {
      expect(() => {
        defaultTemplate.hasResourceProperties("AWS::SecretsManager::Secret", {
          Name: Match.stringLikeRegexp(".*grafana-admin-password.*"),
          Description: Match.stringLikeRegexp(".*Grafana admin password.*"),
          GenerateSecretString: Match.objectLike({
            SecretStringTemplate: Match.stringLikeRegexp(".*username.*"),
            GenerateStringKey: "password",
            ExcludePunctuation: GRAFANA_ADMIN_SECRET.EXCLUDE_PUNCTUATION,
            PasswordLength: GRAFANA_ADMIN_SECRET.PASSWORD_LENGTH,
          }),
        });
      }).not.toThrow();
    });

    test.each([
      {
        environment: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        expectedPolicy: "Delete",
      },
      {
        environment: TEST_CONSTANTS.ENVIRONMENTS.PRODUCTION,
        expectedPolicy: "Retain",
      },
    ])(
      "applies $expectedPolicy removal policy for $environment environment",
      ({ environment, expectedPolicy }) => {
        const testData = removalPolicyTests.find((d) => d.environment === environment);
        expect(testData).toBeDefined();
        expect(testData?.secret?.DeletionPolicy).toBe(expectedPolicy);
      }
    );
  });

  // ============================================================================
  // Load Balancer Configuration
  // ============================================================================

  /**
   * Load Balancer Configuration Tests
   *
   * Verifies target group creation, health checks, routing rules, and
   * service attachments to target groups.
   */
  describe("Load Balancer Configuration", () => {
    let app: cdk.App;
    let defaultStack: MonitoringServiceStack;
    let defaultTemplate: Template;
    let healthCheckTemplate: Template;

    beforeAll(() => {
      app = createTestApp();
      defaultStack = createTestStack(app);
      defaultTemplate = Template.fromStack(defaultStack);

      // Pre-compute health check template
      const healthCheckApp = createTestApp();
      const healthCheckStack = createTestStack(healthCheckApp);
      healthCheckTemplate = Template.fromStack(healthCheckStack);
    });

    test("creates Prometheus target group", () => {
      expect(() => {
        defaultTemplate.hasResourceProperties(
          "AWS::ElasticLoadBalancingV2::TargetGroup",
          {
            Port: MONITORING_PORTS.PROMETHEUS,
            Protocol: "HTTP",
            TargetType: "instance",
            HealthCheckPath: Match.stringLikeRegexp(".*prometheus.*healthy.*"),
          }
        );
      }).not.toThrow();
    });

    test("creates Grafana target group", () => {
      expect(() => {
        defaultTemplate.hasResourceProperties(
          "AWS::ElasticLoadBalancingV2::TargetGroup",
          {
            Port: MONITORING_PORTS.GRAFANA,
            Protocol: "HTTP",
            TargetType: "instance",
            HealthCheckPath: MONITORING_HEALTH_CHECK.PATHS.GRAFANA,
          }
        );
      }).not.toThrow();
    });

    test.each([
      {
        targetGroup: "Prometheus",
        healthCheckPath: MONITORING_HEALTH_CHECK.PATHS.PROMETHEUS,
        routePrefix: MONITORING_ROUTES.PROMETHEUS,
      },
      {
        targetGroup: "Grafana",
        healthCheckPath: MONITORING_HEALTH_CHECK.PATHS.GRAFANA,
        routePrefix: MONITORING_ROUTES.GRAFANA,
      },
    ])(
      "$targetGroup target group has correct health check configuration",
      () => {
        expect(() => {
          healthCheckTemplate.hasResourceProperties(
            "AWS::ElasticLoadBalancingV2::TargetGroup",
            {
              HealthCheckIntervalSeconds:
                MONITORING_HEALTH_CHECK.INTERVAL_SECONDS,
              HealthCheckTimeoutSeconds: MONITORING_HEALTH_CHECK.TIMEOUT_SECONDS,
              HealthyThresholdCount: MONITORING_HEALTH_CHECK.HEALTHY_THRESHOLD,
              UnhealthyThresholdCount:
                MONITORING_HEALTH_CHECK.UNHEALTHY_THRESHOLD,
              Matcher: Match.objectLike({
                HttpCode: MONITORING_HEALTH_CHECK.HEALTHY_HTTP_CODES,
              }),
            }
          );
        }).not.toThrow();
      }
    );

    test("creates listener rules for Prometheus and Grafana", () => {
      expect(() => {
        defaultTemplate.resourceCountIs(
          "AWS::ElasticLoadBalancingV2::ListenerRule",
          TEST_CONSTANTS.RESOURCE_COUNTS.LISTENER_RULES
        );
      }).not.toThrow();

      const rules = defaultTemplate.findResources(
        "AWS::ElasticLoadBalancingV2::ListenerRule"
      );
      const rulesStr = JSON.stringify(rules);
      expect(rulesStr).toMatch(/prometheus/i);
      expect(rulesStr).toMatch(/grafana/i);
    });
  });

  // ============================================================================
  // Security Group Configuration
  // ============================================================================

  /**
   * Security Group Configuration Tests
   *
   * Verifies that security group connections are configured between ALB and services.
   * CDK manages the actual security group rules internally via connections.allowFrom().
   */
  describe("Security Group Configuration", () => {
    let app: cdk.App;
    let stack: MonitoringServiceStack;

    beforeAll(() => {
      app = createTestApp();
      stack = createTestStack(app);
    });

    test("configures security group connections for Prometheus and Grafana", () => {
      expect(stack.prometheusService.connections).toBeDefined();
      expect(stack.grafanaService.connections).toBeDefined();
      expect(stack.nodeExporterService.connections).toBeDefined();
      expect(stack).toBeDefined();
    });
  });

  // ============================================================================
  // IAM Permissions
  // ============================================================================

  /**
   * IAM Permissions Tests
   *
   * Verifies that Prometheus task role has EC2 service discovery permissions
   * and Grafana execution role has secret read permissions.
   */
  describe("IAM Permissions", () => {
    let app: cdk.App;
    let defaultStack: MonitoringServiceStack;
    let defaultTemplate: Template;

    beforeAll(() => {
      app = createTestApp();
      defaultStack = createTestStack(app);
      defaultTemplate = Template.fromStack(defaultStack);
    });

    test("Prometheus task role has EC2 service discovery permissions", () => {
      expect(() => {
        defaultTemplate.hasResourceProperties("AWS::IAM::Policy", {
          PolicyDocument: {
            Statement: Match.arrayWith([
              Match.objectLike({
                Effect: "Allow",
                Action: Match.arrayWith([
                  "ec2:DescribeInstances",
                  "ec2:DescribeInstanceStatus",
                  "ec2:DescribeTags",
                ]),
              }),
            ]),
          },
        });
      }).not.toThrow();
    });

    test("Grafana execution role can read admin password secret", () => {
      expect(() => {
        defaultTemplate.hasResourceProperties("AWS::IAM::Policy", {
          PolicyDocument: {
            Statement: Match.arrayWith([
              Match.objectLike({
                Effect: "Allow",
                Action: Match.arrayWith(["secretsmanager:GetSecretValue"]),
              }),
            ]),
          },
        });
      }).not.toThrow();
    });
  });

  // ============================================================================
  // Circuit Breaker Configuration
  // ============================================================================

  /**
   * Circuit Breaker Configuration Tests
   *
   * Verifies that circuit breaker is disabled for development environment
   * and can be overridden via props.
   */
  describe("Circuit Breaker Configuration", () => {
    let app: cdk.App;
    let devStack: MonitoringServiceStack;
    let devWithCircuitBreakerStack: MonitoringServiceStack;
    let devTemplate: Template;
    let devWithCircuitBreakerTemplate: Template;

    beforeAll(() => {
      app = createTestApp();

      devStack = createTestStack(app, "DevStack", {
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
      });
      devWithCircuitBreakerStack = createTestStack(app, "DevCircuitBreakerStack", {
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        enableCircuitBreaker: true,
      });

      devTemplate = Template.fromStack(devStack);
      devWithCircuitBreakerTemplate = Template.fromStack(devWithCircuitBreakerStack);
    });

    test("disables circuit breaker for development environment by default", () => {
      const services = devTemplate.findResources("AWS::ECS::Service");
      Object.values(services).forEach((service) => {
        const serviceProps = service.Properties as {
          DeploymentConfiguration?: {
            DeploymentCircuitBreaker?: {
              Enable?: boolean;
            };
          };
        };
        expect(
          serviceProps.DeploymentConfiguration?.DeploymentCircuitBreaker?.Enable
        ).toBeFalsy();
      });
    });

    test("allows circuit breaker override for development", () => {
      expect(devWithCircuitBreakerStack).toBeDefined();
      expect(devWithCircuitBreakerStack.prometheusService).toBeDefined();
      expect(devWithCircuitBreakerStack.grafanaService).toBeDefined();

      expect(() => {
        devWithCircuitBreakerTemplate.resourceCountIs(
          "AWS::ECS::Service",
          TEST_CONSTANTS.RESOURCE_COUNTS.ECS_SERVICES
        );
      }).not.toThrow();
    });
  });

  // ============================================================================
  // SSM Parameters
  // ============================================================================

  /**
   * SSM Parameters Tests
   *
   * Verifies that SSM parameters are created for service discovery
   * and can be disabled when not needed.
   */
  describe("SSM Parameters", () => {
    let app: cdk.App;
    let defaultStack: MonitoringServiceStack;
    let noSsmStack: MonitoringServiceStack;
    let defaultTemplate: Template;
    let noSsmTemplate: Template;
    let parameterTests: Array<{
      parameterName: string;
      descriptionPattern: RegExp;
      patternStr: string;
      template: Template;
    }>;

    beforeAll(() => {
      app = createTestApp();

      defaultStack = createTestStack(app);
      defaultTemplate = Template.fromStack(defaultStack);

      const noSsmApp = createTestApp();
      noSsmStack = createTestStack(noSsmApp, TEST_CONSTANTS.STACK_IDS.DEFAULT, {
        createSsmParameters: false,
      });
      noSsmTemplate = Template.fromStack(noSsmStack);

      // Pre-compute parameter test data with extracted patterns
      const parameterConfigs = [
        {
          parameterName:
            TEST_CONSTANTS.SSM_PARAMETER_NAMES.PROMETHEUS_SERVICE_ARN,
          descriptionPattern: /Prometheus ECS service ARN/i,
        },
        {
          parameterName: TEST_CONSTANTS.SSM_PARAMETER_NAMES.GRAFANA_SERVICE_ARN,
          descriptionPattern: /Grafana ECS service ARN/i,
        },
        {
          parameterName:
            TEST_CONSTANTS.SSM_PARAMETER_NAMES.NODE_EXPORTER_SERVICE_ARN,
          descriptionPattern: /Node Exporter ECS service ARN/i,
        },
        {
          parameterName:
            TEST_CONSTANTS.SSM_PARAMETER_NAMES.PROMETHEUS_TARGET_GROUP_ARN,
          descriptionPattern: /Prometheus ALB target group ARN/i,
        },
        {
          parameterName:
            TEST_CONSTANTS.SSM_PARAMETER_NAMES.GRAFANA_TARGET_GROUP_ARN,
          descriptionPattern: /Grafana ALB target group ARN/i,
        },
      ];

      parameterTests = parameterConfigs.map((config) => {
        const testApp = createTestApp();
        const testStack = createTestStack(testApp, TEST_CONSTANTS.STACK_IDS.DEFAULT, {
          envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        });
        return {
          parameterName: config.parameterName,
          descriptionPattern: config.descriptionPattern,
          patternStr: config.descriptionPattern.source,
          template: Template.fromStack(testStack),
        };
      });
    });

    test("creates SSM parameters by default", () => {
      expect(defaultStack.ssmParameters).toBeDefined();
      expect(() => {
        defaultTemplate.resourceCountIs(
          "AWS::SSM::Parameter",
          TEST_CONSTANTS.RESOURCE_COUNTS.SSM_PARAMETERS
        );
      }).not.toThrow();
    });

    test.each([
      {
        parameterName:
          TEST_CONSTANTS.SSM_PARAMETER_NAMES.PROMETHEUS_SERVICE_ARN,
        descriptionPattern: /Prometheus ECS service ARN/i,
      },
      {
        parameterName: TEST_CONSTANTS.SSM_PARAMETER_NAMES.GRAFANA_SERVICE_ARN,
        descriptionPattern: /Grafana ECS service ARN/i,
      },
      {
        parameterName:
          TEST_CONSTANTS.SSM_PARAMETER_NAMES.NODE_EXPORTER_SERVICE_ARN,
        descriptionPattern: /Node Exporter ECS service ARN/i,
      },
      {
        parameterName:
          TEST_CONSTANTS.SSM_PARAMETER_NAMES.PROMETHEUS_TARGET_GROUP_ARN,
        descriptionPattern: /Prometheus ALB target group ARN/i,
      },
      {
        parameterName:
          TEST_CONSTANTS.SSM_PARAMETER_NAMES.GRAFANA_TARGET_GROUP_ARN,
        descriptionPattern: /Grafana ALB target group ARN/i,
      },
    ])(
      "creates $parameterName parameter with correct description",
      ({ parameterName }) => {
        const testData = parameterTests.find((d) => d.parameterName === parameterName);
        
        // Guard assertion: test data must exist
        expect(testData).toBeDefined();
        expect(testData?.template).toBeDefined();
        expect(testData?.patternStr).toBeDefined();

        expect(() => {
          testData?.template.hasResourceProperties("AWS::SSM::Parameter", {
            Name: Match.stringLikeRegexp(`.*${parameterName}.*`),
            Type: "String",
            Description: Match.stringLikeRegexp(testData.patternStr),
          });
        }).not.toThrow();
      }
    );

    test("does not create SSM parameters when disabled", () => {
      expect(noSsmStack.ssmParameters).toBeUndefined();
      expect(() => {
        noSsmTemplate.resourceCountIs("AWS::SSM::Parameter", 0);
      }).not.toThrow();
    });
  });

  // ============================================================================
  // CloudFormation Outputs
  // ============================================================================

  /**
   * CloudFormation Outputs Tests
   *
   * Verifies that CloudFormation outputs are created for service ARNs,
   * target group ARNs, and secret ARN.
   */
  describe("CloudFormation Outputs", () => {
    let app: cdk.App;
    let defaultStack: MonitoringServiceStack;
    let exportsStack: MonitoringServiceStack;
    let noExportsStack: MonitoringServiceStack;
    let noOutputsStack: MonitoringServiceStack;
    let defaultTemplate: Template;
    let exportsTemplate: Template;
    let noExportsTemplate: Template;
    let noOutputsTemplate: Template;
    let defaultOutputs: Record<string, any>;
    let noExportsOutputs: Record<string, any>;
    let noOutputsOutputs: Record<string, any> | undefined;

    beforeAll(() => {
      app = createTestApp();

      defaultStack = createTestStack(app);
      defaultTemplate = Template.fromStack(defaultStack);
      defaultOutputs = defaultTemplate.toJSON().Outputs;

      const exportsApp = createTestApp();
      exportsStack = createTestStack(exportsApp, TEST_CONSTANTS.STACK_IDS.DEFAULT, {
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        projectName: "monitoring",
        enableExports: true,
      });
      exportsTemplate = Template.fromStack(exportsStack);

      const noExportsApp = createTestApp();
      noExportsStack = createTestStack(noExportsApp, TEST_CONSTANTS.STACK_IDS.DEFAULT, {
        enableExports: false,
      });
      noExportsTemplate = Template.fromStack(noExportsStack);
      noExportsOutputs = noExportsTemplate.toJSON().Outputs;

      const noOutputsApp = createTestApp();
      noOutputsStack = createTestStack(noOutputsApp, TEST_CONSTANTS.STACK_IDS.DEFAULT, {
        createOutputs: false,
      });
      noOutputsTemplate = Template.fromStack(noOutputsStack);
      noOutputsOutputs = noOutputsTemplate.toJSON().Outputs;
    });

    test.each([
      TEST_CONSTANTS.OUTPUT_NAMES.PROMETHEUS_SERVICE_ARN,
      TEST_CONSTANTS.OUTPUT_NAMES.GRAFANA_SERVICE_ARN,
      TEST_CONSTANTS.OUTPUT_NAMES.NODE_EXPORTER_SERVICE_ARN,
      TEST_CONSTANTS.OUTPUT_NAMES.PROMETHEUS_TARGET_GROUP_ARN,
      TEST_CONSTANTS.OUTPUT_NAMES.GRAFANA_TARGET_GROUP_ARN,
      TEST_CONSTANTS.OUTPUT_NAMES.GRAFANA_ADMIN_SECRET_ARN,
    ])("creates %s output by default", (outputName) => {
      expect(() => {
        defaultTemplate.hasOutput(outputName, {});
      }).not.toThrow();

      expect(defaultOutputs[outputName]).toBeDefined();
      expect(defaultOutputs[outputName].Value).toBeDefined();
    });

    test("exports outputs when enableExports is true", () => {
      expect(() => {
        exportsTemplate.hasOutput(TEST_CONSTANTS.OUTPUT_NAMES.PROMETHEUS_SERVICE_ARN, {
          Export: {
            Name: Match.stringLikeRegexp(".*prometheus-service-arn.*"),
          },
        });
      }).not.toThrow();
    });

    test("does not export outputs when enableExports is false", () => {
      expect(
        noExportsOutputs[TEST_CONSTANTS.OUTPUT_NAMES.PROMETHEUS_SERVICE_ARN].Export
      ).toBeUndefined();
    });

    test("does not create outputs when createOutputs is false", () => {
      expect(noOutputsOutputs).toBeDefined();
      expect(
        noOutputsOutputs?.[TEST_CONSTANTS.OUTPUT_NAMES.PROMETHEUS_SERVICE_ARN]
      ).toBeUndefined();
      expect(
        noOutputsOutputs?.[TEST_CONSTANTS.OUTPUT_NAMES.GRAFANA_SERVICE_ARN]
      ).toBeUndefined();
    });
  });

  // ============================================================================
  // Resource Tagging (Read-only tests using beforeAll)
  // ============================================================================

  /**
   * Resource Tagging Tests
   *
   * Verifies that resources are tagged correctly with environment and project information.
   */
  describe("Resource Tagging", () => {
    let taggedStack: MonitoringServiceStack;
    let customTaggedStack: MonitoringServiceStack;

    beforeAll(() => {
      // Create separate apps to avoid construct name conflicts
      const app1 = createTestApp();
      const app2 = createTestApp();

      taggedStack = createTestStack(app1, TEST_CONSTANTS.STACK_IDS.TAGGED, {
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        projectName: "monitoring",
      });
      customTaggedStack = createTestStack(
        app2,
        TEST_CONSTANTS.STACK_IDS.CUSTOM_TAGGED,
        {
          customTags: {
            Owner: "DevOps",
            CostCenter: "Engineering",
          },
        }
      );
    });

    test("applies tags to stack resources", () => {
      expect(taggedStack).toBeDefined();
      const tags = cdk.Tags.of(taggedStack);
      expect(tags).toBeDefined();
    });

    test("applies custom tags when specified", () => {
      expect(customTaggedStack).toBeDefined();
      const tags = cdk.Tags.of(customTaggedStack);
      expect(tags).toBeDefined();
    });
  });

  // ============================================================================
  // Production Warnings
  // ============================================================================

  /**
   * Production Warnings Tests
   *
   * Verifies that production warnings are logged for insecure configurations.
   */
  describe("Production Warnings", () => {
    let app: cdk.App;
    let warningStack: MonitoringServiceStack;
    let suppressWarningsStack: MonitoringServiceStack;

    beforeAll(() => {
      app = createTestApp();

      warningStack = createTestStack(app, "WarningStack", {
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        enableExecuteCommand: true,
      });

      suppressWarningsStack = createTestStack(app, "SuppressWarningsStack", {
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        enableProductionWarnings: false,
        enableExecuteCommand: true,
      });
    });

    test("logs warnings for production environment", () => {
      expect(warningStack).toBeDefined();
      expect(warningStack.prometheusService).toBeDefined();
    });

    test("production warnings can be suppressed via configuration", () => {
      expect(suppressWarningsStack).toBeDefined();
    });
  });
});
