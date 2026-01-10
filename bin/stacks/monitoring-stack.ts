/** @format */

import * as cdk from "aws-cdk-lib";

import { NetworkingStack } from "../../lib/stacks/foundation/networking-stack";
import { MonitoringEfsStack } from "../../lib/stacks/monitoring/efs-stack";
import { MonitoringInfraStack } from "../../lib/stacks/monitoring/infra-stack";
import { MonitoringServiceStack } from "../../lib/stacks/monitoring/service-stack";
import { EnvironmentConfig } from "../../config/environments";

/**
 * Create all monitoring stacks for a single environment
 *
 * Architecture:
 * 1. MonitoringEfsStack - Storage layer (EFS file system)
 * 2. MonitoringInfraStack - Compute layer (EC2, ECS cluster, ALB)
 * 3. MonitoringServiceStack - Application layer (Prometheus, Grafana, Node Exporter)
 *
 * Dependencies:
 * - Requires NetworkingStack (VPC, subnets, security groups)
 * - Each monitoring stack depends on the previous one
 *
 * @param app CDK app
 * @param envName Environment name (e.g., 'development', 'pipeline', 'production')
 * @param envConfig Environment configuration
 * @param networkingStack The networking stack (for VPC reference)
 */
export function createMonitoringStacks(
  app: cdk.App,
  envName: string,
  envConfig: EnvironmentConfig,
  networkingStack: NetworkingStack
): {
  efsStack: MonitoringEfsStack;
  infraStack: MonitoringInfraStack;
  serviceStack: MonitoringServiceStack;
} {
  const stackNamePrefix = `${envName}-Monitoring`;
  const projectName = "monitoring";

  // Stack props with environment configuration
  const stackProps: cdk.StackProps = {
    env: {
      account: envConfig.account,
      region: envConfig.region,
    },
  };

  // ============================================================================
  // 1. MONITORING EFS STACK (Storage Layer)
  // ============================================================================
  console.log(`Creating ${stackNamePrefix}Efs stack...`);

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
  // 2. MONITORING INFRASTRUCTURE STACK (Compute Layer)
  // ============================================================================
  console.log(`Creating ${stackNamePrefix}Infra stack...`);

  const infraStack = new MonitoringInfraStack(
    app,
    `${stackNamePrefix}Infra`,
    {
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
      efsInitializationComplete: efsStack.efsInitializationComplete,
      efsStackName: efsStack.stackName,

      // EC2 Configuration
      minCapacity: envConfig.isProduction ? 2 : 1,
      maxCapacity: envConfig.isProduction ? 3 : 1,
      desiredCapacity: envConfig.isProduction ? 2 : 1,

      // Container Insights
      enableContainerInsights: true,
      enableExecuteCommand: true,
    }
  );

  // Add dependencies
  infraStack.addDependency(networkingStack);
  infraStack.addDependency(efsStack);

  // ============================================================================
  // 3. MONITORING SERVICE STACK (Application Layer)
  // ============================================================================
  console.log(`Creating ${stackNamePrefix}Service stack...`);

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
    }
  );

  // Add dependencies
  serviceStack.addDependency(networkingStack);
  serviceStack.addDependency(efsStack);
  serviceStack.addDependency(infraStack);

  console.log(`✅ All monitoring stacks created for ${envName}`);

  return {
    efsStack,
    infraStack,
    serviceStack,
  };
}