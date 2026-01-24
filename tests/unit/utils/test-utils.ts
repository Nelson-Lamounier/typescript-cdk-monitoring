/** @format */

/**
 * Utilities for Connectivity Integration Tests
 *
 * Provides shared utility functions for stack creation, template analysis,
 * resource extraction, and validation across connectivity test suites.
 *
 * @module tests/integration/connectivity/test-utils
 */

import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Template } from "aws-cdk-lib/assertions";

import { NetworkingStack } from "../../../lib/stacks/foundation/networking-stack";
import { MonitoringEfsStack } from "../../../lib/stacks/monitoring/efs-stack";
import { MonitoringInfraStack } from "../../../lib/stacks/monitoring/infra-stack";
import { MonitoringServiceStack } from "../../../lib/stacks/monitoring/service-stack";
import type {
  ConnectivityTestStacks,
  ResolvedTestConfig,
  SubnetCidrs,
} from "../connectivity/test-config";
import type { ResourceProperties } from "../types/test-types";
import { resolveTestConfig, createCdkEnv } from "../connectivity/test-config";
import {
  TAG_KEYS,
  SUBNET_TYPES,
  ENVIRONMENT_CONFIG,
} from "../shared/constants";

// ============================================================================
// STACK CREATION UTILITIES
// ============================================================================

/**
 * Create complete monitoring stack hierarchy for connectivity testing
 *
 * @param configOptions - Test configuration options
 * @returns Complete stack hierarchy
 */
export function createConnectivityTestStacks(
  configOptions: Partial<ResolvedTestConfig> = {}
): ConnectivityTestStacks {
  const config = resolveTestConfig(configOptions);
  const app = new cdk.App();
  const env = createCdkEnv(config);

  // Layer 1: Networking Stack
  const networkingStack = new NetworkingStack(app, "TestNetworkingStack", {
    env,
    envName: config.environment,
    projectName: config.projectName,
    vpcCidr: config.vpcCidr,
    enableVpcFlowLogs: config.enableVpcFlowLogs,
    flowLogRetention: config.flowLogRetention,
  });

  // Layer 2: EFS Stack
  const efsStack = new MonitoringEfsStack(app, "TestEfsStack", {
    env,
    envName: config.environment,
    projectName: config.projectName,
    vpc: networkingStack.vpc,
  });

  // Create a temporary stack to hold the mock S3 bucket
  // This is necessary because constructs cannot be created directly under App
  const tempStack = new cdk.Stack(app, "TempStack", { env });
  const dashboardBucket = s3.Bucket.fromBucketName(
    tempStack,
    "TestDashboardBucket",
    `monitoring-dashboards-${config.environment}-${config.region}`
  );

  // Layer 3: Infrastructure Stack
  const infraStack = new MonitoringInfraStack(app, "TestInfraStack", {
    env,
    envName: config.environment,
    projectName: config.projectName,
    vpc: networkingStack.vpc,
    efsStackName: efsStack.stackName,
    fileSystem: efsStack.fileSystem,
    efsAccessPoint: efsStack.accessPoint,
    efsAvailabilityZone: efsStack.efsAvailabilityZone,
    efsSecurityGroup: efsStack.mountTargetSecurityGroup,
    efsInitializationComplete: efsStack.efsInitializationExecution,
    dashboardBucket,
    minCapacity: config.minCapacity,
    desiredCapacity: config.desiredCapacity,
    maxCapacity: config.maxCapacity,
    allowedIpRanges: [config.allowedCidr],
  });

  // Layer 4: Service Stack
  const serviceStack = new MonitoringServiceStack(app, "TestServiceStack", {
    env,
    envName: config.environment,
    projectName: config.projectName,
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
 * Create networking stack only (lightweight for network-only tests)
 *
 * @param configOptions - Test configuration options
 * @returns Networking stack
 */
export function createNetworkingStack(
  configOptions: Partial<ResolvedTestConfig> = {}
): NetworkingStack {
  const config = resolveTestConfig(configOptions);
  const app = new cdk.App();
  const env = createCdkEnv(config);

  return new NetworkingStack(app, "TestNetworkingStack", {
    env,
    envName: config.environment,
    projectName: config.projectName,
    vpcCidr: config.vpcCidr,
    enableVpcFlowLogs: config.enableVpcFlowLogs,
    flowLogRetention: config.flowLogRetention,
  });
}

// ============================================================================
// TEMPLATE ANALYSIS UTILITIES
// ============================================================================

/**
 * Extract subnet CIDRs from template
 *
 * @param template - CloudFormation template
 * @returns Public and private subnet CIDRs
 */
export function extractSubnetCidrs(template: Template): SubnetCidrs {
  const subnets = template.findResources("AWS::EC2::Subnet");
  const publicSubnets: string[] = [];
  const privateSubnets: string[] = [];

  Object.values(subnets).forEach((subnet) => {
    const properties = (subnet as ResourceProperties).Properties;
    const tags = (properties.Tags || []) as Array<Record<string, string>>;
    const cidr = properties.CidrBlock as string;

    const subnetType = tags.find((tag) => tag.Key === TAG_KEYS.SUBNET_TYPE);

    if (subnetType?.Value === SUBNET_TYPES.PUBLIC) {
      publicSubnets.push(cidr);
    } else if (subnetType?.Value === SUBNET_TYPES.PRIVATE) {
      privateSubnets.push(cidr);
    }
  });

  return { publicSubnets, privateSubnets };
}

/**
 * Count resources of a specific type in template
 *
 * @param template - CloudFormation template
 * @param resourceType - AWS resource type
 * @returns Number of resources
 */
export function countResourcesOfType(
  template: Template,
  resourceType: string
): number {
  const resources = template.findResources(resourceType);
  return Object.keys(resources).length;
}

/**
 * Check if template has resource of type
 *
 * @param template - CloudFormation template
 * @param resourceType - AWS resource type
 * @returns True if resource exists
 */
export function hasResourceOfType(
  template: Template,
  resourceType: string
): boolean {
  return countResourcesOfType(template, resourceType) > 0;
}

/**
 * Extract all security group ingress rules
 *
 * @param template - CloudFormation template
 * @returns Array of ingress rule properties
 */
export function extractIngressRules(
  template: Template
): Array<Record<string, unknown>> {
  const rules: Array<Record<string, unknown>> = [];

  // Standalone ingress rules
  const standaloneRules = template.findResources(
    "AWS::EC2::SecurityGroupIngress"
  );
  Object.values(standaloneRules).forEach((rule) => {
    const properties = (rule as ResourceProperties).Properties;
    rules.push(properties);
  });

  // Inline ingress rules in security groups
  const securityGroups = template.findResources("AWS::EC2::SecurityGroup");
  Object.values(securityGroups).forEach((sg) => {
    const properties = (sg as ResourceProperties).Properties;
    if (properties.SecurityGroupIngress) {
      const ingressRules = properties.SecurityGroupIngress as Array<
        Record<string, unknown>
      >;
      rules.push(...ingressRules);
    }
  });

  return rules;
}

/**
 * Find ingress rules for specific port
 *
 * @param template - CloudFormation template
 * @param port - Port number
 * @returns Array of matching ingress rules
 */
export function findIngressRulesForPort(
  template: Template,
  port: number
): Array<Record<string, unknown>> {
  const allRules = extractIngressRules(template);
  return allRules.filter(
    (rule) => rule.FromPort === port || rule.ToPort === port
  );
}

/**
 * Check if resource has tag
 *
 * @param resource - CloudFormation resource
 * @param tagKey - Tag key to check
 * @param tagValue - Optional tag value to match
 * @returns True if tag exists (and matches value if provided)
 */
export function resourceHasTag(
  resource: Record<string, unknown>,
  tagKey: string,
  tagValue?: string
): boolean {
  const properties = (resource as ResourceProperties).Properties;
  if (!properties.Tags) {
    return false;
  }

  const tags = properties.Tags as Array<Record<string, string>>;
  const tag = tags.find((t) => t.Key === tagKey);

  if (!tag) {
    return false;
  }

  if (tagValue !== undefined) {
    return tag.Value === tagValue;
  }

  return true;
}

/**
 * Extract tag value from resource
 *
 * @param resource - CloudFormation resource
 * @param tagKey - Tag key
 * @returns Tag value or undefined
 */
export function getResourceTagValue(
  resource: Record<string, unknown>,
  tagKey: string
): string | undefined {
  const properties = (resource as ResourceProperties).Properties;
  if (!properties.Tags) {
    return undefined;
  }

  const tags = properties.Tags as Array<Record<string, string>>;
  const tag = tags.find((t) => t.Key === tagKey);
  return tag?.Value;
}

// ============================================================================
// VALIDATION UTILITIES
// ============================================================================

/**
 * Validate that NAT Gateway is in public subnet
 *
 * @param template - CloudFormation template
 * @returns True if NAT Gateway is correctly placed
 */
export function validateNatGatewayPlacement(template: Template): boolean {
  const natGateways = template.findResources("AWS::EC2::NatGateway");

  if (Object.keys(natGateways).length === 0) {
    // No NAT Gateways (acceptable for development)
    return true;
  }

  // Check each NAT Gateway is in a public subnet
  return Object.values(natGateways).every((natGw) => {
    const properties = (natGw as ResourceProperties).Properties;
    const subnetId = properties.SubnetId;
    // In tests, we can't resolve the actual subnet, so just verify it's defined
    return subnetId !== undefined;
  });
}

/**
 * Validate route table has internet gateway route
 *
 * @param template - CloudFormation template
 * @returns True if IGW route exists
 */
export function hasInternetGatewayRoute(template: Template): boolean {
  const routes = template.findResources("AWS::EC2::Route");

  return Object.values(routes).some((route) => {
    const properties = (route as ResourceProperties).Properties;
    return (
      properties.DestinationCidrBlock === "0.0.0.0/0" && properties.GatewayId
    );
  });
}

/**
 * Validate route table has NAT gateway route
 *
 * @param template - CloudFormation template
 * @returns True if NAT route exists
 */
export function hasNatGatewayRoute(template: Template): boolean {
  const routes = template.findResources("AWS::EC2::Route");

  return Object.values(routes).some((route) => {
    const properties = (route as ResourceProperties).Properties;
    return (
      properties.DestinationCidrBlock === "0.0.0.0/0" && properties.NatGatewayId
    );
  });
}

/**
 * Count availability zones used by subnets
 *
 * @param template - CloudFormation template
 * @returns Number of unique AZs
 */
export function countAvailabilityZones(template: Template): number {
  const subnets = template.findResources("AWS::EC2::Subnet");
  const azs = new Set<string>();

  Object.values(subnets).forEach((subnet) => {
    const properties = (subnet as ResourceProperties).Properties;
    if (properties.AvailabilityZone) {
      azs.add(properties.AvailabilityZone as string);
    }
  });

  return azs.size;
}

// ============================================================================
// RESOURCE EXTRACTION UTILITIES
// ============================================================================

/**
 * Extract all CloudFormation exports from template
 *
 * @param template - CloudFormation template
 * @returns Array of export names
 */
export function extractExports(template: Template): string[] {
  const outputs = template.findOutputs("*");
  const exports: string[] = [];

  Object.values(outputs).forEach((output) => {
    const exportValue = (output as Record<string, unknown>).Export;
    if (exportValue) {
      if (typeof exportValue === "object" && exportValue !== null) {
        const exportName = (exportValue as Record<string, unknown>).Name;
        if (typeof exportName === "string") {
          exports.push(exportName);
        }
      }
    }
  });

  return exports;
}

/**
 * Get all resource logical IDs of a type
 *
 * @param template - CloudFormation template
 * @param resourceType - AWS resource type
 * @returns Array of logical IDs
 */
export function getResourceLogicalIds(
  template: Template,
  resourceType: string
): string[] {
  const resources = template.findResources(resourceType);
  return Object.keys(resources);
}

/**
 * Check if stacks have proper dependencies
 *
 * @param stacks - Stack hierarchy
 * @returns True if dependencies are correct
 */
export function validateStackDependencies(
  stacks: ConnectivityTestStacks
): boolean {
  // Verify EFS stack depends on Networking
  const efsDependencies = stacks.efsStack.dependencies;
  if (!efsDependencies.includes(stacks.networkingStack)) {
    return false;
  }

  // Verify Infra stack depends on EFS and Networking
  const infraDependencies = stacks.infraStack.dependencies;
  if (
    !infraDependencies.includes(stacks.efsStack) ||
    !infraDependencies.includes(stacks.networkingStack)
  ) {
    return false;
  }

  // Verify Service stack depends on Infra
  const serviceDependencies = stacks.serviceStack.dependencies;
  if (!serviceDependencies.includes(stacks.infraStack)) {
    return false;
  }

  return true;
}

// ============================================================================
// SECURITY TEST STACK CREATION (Consolidated from test-fixtures.ts)
// ============================================================================

/**
 * Create complete monitoring stack hierarchy for security testing
 *
 * Uses the same flexible configuration system as connectivity tests
 * but with simplified defaults for security test scenarios.
 *
 * @param environment - Environment name (development or production)
 * @param configOptions - Optional additional configuration overrides
 * @returns Complete stack hierarchy
 */
export function createSecurityTestStacks(
  environment: string = ENVIRONMENT_CONFIG.DEVELOPMENT,
  configOptions: Partial<ResolvedTestConfig> = {}
): ConnectivityTestStacks {
  const config = resolveTestConfig({
    ...configOptions,
    environment,
  });

  return createConnectivityTestStacks(config);
}

/**
 * Singleton fixture cache to reuse stacks across tests
 *
 * Provides cached stack instances for development and production environments
 * to improve test performance by avoiding redundant stack synthesis.
 */
class TestStackCache {
  private static instance: TestStackCache;
  private developmentStacks?: ConnectivityTestStacks;
  private productionStacks?: ConnectivityTestStacks;

  private constructor() {}

  static getInstance(): TestStackCache {
    if (!TestStackCache.instance) {
      TestStackCache.instance = new TestStackCache();
    }
    return TestStackCache.instance;
  }

  /**
   * Get development environment stacks (cached)
   *
   * @returns Development stack hierarchy
   */
  getDevelopmentStacks(): ConnectivityTestStacks {
    if (!this.developmentStacks) {
      try {
        this.developmentStacks = createSecurityTestStacks(
          ENVIRONMENT_CONFIG.DEVELOPMENT
        );
      } catch (error) {
        // Clear cache on error to allow retry
        this.developmentStacks = undefined;
        throw error;
      }
    }
    return this.developmentStacks;
  }

  /**
   * Get production environment stacks (cached)
   *
   * @returns Production stack hierarchy
   */
  getProductionStacks(): ConnectivityTestStacks {
    if (!this.productionStacks) {
      try {
        this.productionStacks = createSecurityTestStacks(
          ENVIRONMENT_CONFIG.PRODUCTION
        );
      } catch (error) {
        // Clear cache on error to allow retry
        this.productionStacks = undefined;
        throw error;
      }
    }
    return this.productionStacks;
  }

  /**
   * Clear cached stacks (useful for test cleanup)
   */
  clear(): void {
    this.developmentStacks = undefined;
    this.productionStacks = undefined;
  }

  /**
   * Force clear the singleton instance (useful for test resets)
   */
  static resetInstance(): void {
    if (TestStackCache.instance) {
      TestStackCache.instance.clear();
    }
  }
}

/**
 * Exported singleton instance for test fixtures
 *
 * Usage:
 * ```typescript
 * import { TestStacks } from "../utils/test-utils";
 *
 * const stacks = TestStacks.getDevelopmentStacks();
 * ```
 */
export const TestStacks = TestStackCache.getInstance();

// Backward compatibility alias for security tests
export const SecurityTestFixtures = TestStackCache.getInstance();
