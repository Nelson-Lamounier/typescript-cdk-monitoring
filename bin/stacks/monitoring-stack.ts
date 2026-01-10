/** @format */

import * as cdk from "aws-cdk-lib";

import { MonitoringEfsStack } from "../../lib/stacks/monitoring/efs-stack";
import { NetworkingStack } from "../../lib/stacks/foundation/networking-stack";
import { CrossAccountTarget } from "../../lib/shared/types/monitoring-types";
import { EnvironmentConfig } from "../../config/environments";

/**
 * Deploy monitoring infrastructure (Prometheus + Grafana)
 * Can be deployed in any environment (pipeline, dev, staging, production)
 */
export function deployMonitoringStacks(
  app: cdk.App,
  config: EnvironmentConfig,
  stackProps: cdk.StackProps,
  networkingStack: NetworkingStack,
  _certificateArn?: string
) {
  // Get cross-account targets from CDK context (set by pipeline)
  const crossAccountTargets: CrossAccountTarget[] =
    app.node.tryGetContext("crossAccountTargets") || [];

  // Layer 0: EFS Storage
  const efsStack = new MonitoringEfsStack(
    app,
    `${config.envName}-MonitoringEfs`,
    {
      ...stackProps,
      envName: config.envName,
      projectName: "monitoring",
      vpc: networkingStack.vpc,
      crossAccountTargets,
      enableEncryption: true,
      lifecyclePolicy: config.isProduction
        ? cdk.aws_efs.LifecyclePolicy.AFTER_30_DAYS
        : cdk.aws_efs.LifecyclePolicy.AFTER_7_DAYS,
      removalPolicy: config.isProduction
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
    }
  );

  efsStack.addDependency(networkingStack);

  //   // Layer 1: Infrastructure
  //   const infraStack = new MonitoringInfraStack(
  //     app,
  //     `${config.envName}-MonitoringInfra`,
  //     {
  //       ...stackProps,
  //       envName: config.envName,
  //       projectName: "monitoring",
  //       vpc: networkingStack.vpc,
  //       efsStackName: efsStack.stackName,
  //       fileSystem: efsStack.fileSystem,
  //       efsAccessPoint: efsStack.accessPoint,
  //       efsAvailabilityZone: efsStack.efsAvailabilityZone,
  //       efsSecurityGroup: efsStack.mountTargetSecurityGroup,
  //       efsInitializationComplete: efsStack.efsInitializationComplete,
  //       enableHttps: !!certificateArn,
  //       certificateArn,
  //       allowedIpRanges: ["0.0.0.0/0"], // TODO: Restrict in production
  //       enableAccessLogs: config.isProduction,
  //       minCapacity: config.isProduction ? 2 : 1,
  //       maxCapacity: config.isProduction ? 3 : 1,
  //       desiredCapacity: config.isProduction ? 2 : 1,
  //       enableDeletionProtection: config.isProduction,
  //     }
  //   );

  //   infraStack.addDependency(efsStack);

  //   // Layer 2: Services
  //   const serviceStack = new MonitoringServiceStack(
  //     app,
  //     `${config.envName}-MonitoringService`,
  //     {
  //       ...stackProps,
  //       envName: config.envName,
  //       projectName: "monitoring",
  //       cluster: infraStack.cluster,
  //       autoScalingGroup: infraStack.autoScalingGroup,
  //       loadBalancer: infraStack.loadBalancer,
  //       listener: infraStack.listener,
  //     }
  //   );

  //   serviceStack.addDependency(infraStack);

  return {
    efsStack,
    // infraStack,
    // serviceStack,
  };
}
