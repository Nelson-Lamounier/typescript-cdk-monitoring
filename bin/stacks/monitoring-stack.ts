/** @format */

import * as cdk from "aws-cdk-lib";

import { NetworkingStack } from "../../lib/stacks/foundation/networking-stack";
import { MonitoringS3Stack } from "../../lib/stacks/storage/s3-stack";
import { MonitoringEfsStack } from "../../lib/stacks/monitoring/efs-stack";
import { MonitoringInfraStack } from "../../lib/stacks/monitoring/infra-stack";
import { MonitoringServiceStack } from "../../lib/stacks/monitoring/service-stack";
import { EnvironmentConfig } from "../../config/environments";

/**
 * Create all monitoring stacks for a single environment
 *
 * Architecture:
 * 1. MonitoringS3Stack - S3 storage layer (dashboard bucket)
 * 2. MonitoringEfsStack - EFS storage layer (persistent data)
 * 3. MonitoringInfraStack - Compute layer (EC2, ECS cluster, ALB)
 * 4. MonitoringServiceStack - Application layer (Prometheus, Grafana, Node Exporter)
 *
 * Dependencies:
 * - Requires NetworkingStack (VPC, subnets, security groups)
 * - Each monitoring stack depends on the previous ones
 *
 * @param app CDK app
 * @param envName Environment name (e.g., 'development', 'pipeline', 'production')
 * @param envConfig Environment configuration
 * @param networkingStack The networking stack (for VPC reference)
 * @param stackProps Stack properties including env (account/region)
 */
export function createMonitoringStacks(
  app: cdk.App,
  envName: string,
  envConfig: EnvironmentConfig,
  networkingStack: NetworkingStack,
  stackProps: cdk.StackProps
): {
  s3Stack: MonitoringS3Stack;
  efsStack: MonitoringEfsStack;
  infraStack: MonitoringInfraStack;
  serviceStack: MonitoringServiceStack;
} {
  const stackNamePrefix = `${envName}-Monitoring`;
  const projectName = "monitoring";

  // ============================================================================
  // 1. MONITORING S3 STACK (Dashboard Storage Layer)
  // ============================================================================

  const s3Stack = new MonitoringS3Stack(app, `${stackNamePrefix}S3`, {
    ...stackProps,
    envName,
    projectName,

    // S3 Configuration
    removalPolicy: envConfig.isProduction
      ? cdk.RemovalPolicy.RETAIN
      : cdk.RemovalPolicy.DESTROY,
    enableVersioning: envConfig.isProduction,
    dashboardsPath: "./config/grafana/dashboards",
  });

  // ============================================================================
  // 2. MONITORING EFS STACK (Persistent Storage Layer)
  // ============================================================================

  const efsStack = new MonitoringEfsStack(app, `${stackNamePrefix}Efs`, {
    ...stackProps,
    envName,
    projectName,

    // VPC Configuration
    vpc: networkingStack.vpc,

    // EFS Configuration
    enableEncryption: true,
    lifecyclePolicy: envConfig.isProduction
      ? cdk.aws_efs.LifecyclePolicy.AFTER_30_DAYS
      : cdk.aws_efs.LifecyclePolicy.AFTER_7_DAYS,
    removalPolicy: envConfig.isProduction
      ? cdk.RemovalPolicy.RETAIN
      : cdk.RemovalPolicy.DESTROY,
  });

  // Add dependency on networking
  efsStack.addDependency(networkingStack);

  // ============================================================================
  // 3. MONITORING INFRASTRUCTURE STACK (Compute Layer)
  // ============================================================================

  const infraStack = new MonitoringInfraStack(app, `${stackNamePrefix}Infra`, {
    ...stackProps,
    envName,
    projectName,

    // Network Configuration
    vpc: networkingStack.vpc,

    // EFS Configuration (from EFS stack)
    fileSystem: efsStack.fileSystem,
    efsAccessPoint: efsStack.accessPoint,
    efsSecurityGroup: efsStack.mountTargetSecurityGroup,
    efsAvailabilityZone: efsStack.efsAvailabilityZone,
    efsInitializationComplete: efsStack.efsInitializationExecution,
    efsStackName: efsStack.stackName,

    // S3 Configuration (from S3 stack - dashboard storage)
    dashboardBucket: s3Stack.dashboardBucket,

    // EC2 Configuration
    minCapacity: envConfig.isProduction ? 2 : 1,
    maxCapacity: envConfig.isProduction ? 3 : 1,
    desiredCapacity: envConfig.isProduction ? 2 : 1,

    // Container Insights
    enableContainerInsights: true,
    enableExecuteCommand: true,
  });

  // Add dependencies
  infraStack.addDependency(networkingStack);
  infraStack.addDependency(s3Stack);
  infraStack.addDependency(efsStack);

  // ============================================================================
  // 4. MONITORING SERVICE STACK (Application Layer)
  // ============================================================================

  const serviceStack = new MonitoringServiceStack(
    app,
    `${stackNamePrefix}Service`,
    {
      ...stackProps,
      envName,
      projectName,

      // Infrastructure References (from Infra stack)
      cluster: infraStack.cluster,
      loadBalancer: infraStack.loadBalancer,
      listener: infraStack.listener,

      // Service Configuration
      enableExecuteCommand: true,

      // Memory allocation optimised for t3.micro (916 MiB available)
      // Default is 1024 MiB per service, which exceeds instance capacity
      // Development: Reduce to 384 MiB each (768 MiB total + 148 MiB buffer)
      // Production: Use t3.small or larger with default allocations
      prometheusProps: envConfig.isProduction
        ? undefined // Use defaults (1024 MiB) for production
        : { memoryMiB: 384 }, // Optimised for t3.micro in dev
      grafanaProps: envConfig.isProduction
        ? undefined // Use defaults (1024 MiB) for production
        : { memoryMiB: 384 }, // Optimised for t3.micro in dev
    }
  );

  // Add dependencies
  serviceStack.addDependency(networkingStack);
  serviceStack.addDependency(s3Stack);
  serviceStack.addDependency(efsStack);
  serviceStack.addDependency(infraStack);

  return {
    s3Stack,
    efsStack,
    infraStack,
    serviceStack,
  };
}
