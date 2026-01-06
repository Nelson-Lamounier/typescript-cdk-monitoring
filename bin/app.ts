#!/usr/bin/env node
/** @format */

import "source-map-support/register";

import * as cdk from "aws-cdk-lib";
import * as efs from "aws-cdk-lib/aws-efs";

import { NetworkingStack } from "../lib/stacks/networking-stack";
import { LoadBalancerStack } from "../lib/stacks/elb-stack";
import { LaunchTemplateStack } from "../lib/stacks/compute/launch-template-stack";
import { MonitoringEfsStack } from "../lib/stacks/storage/efs-file-system-stack";
import { environments, EnvironmentConfig } from "../config/environments";

// ============================================================================
// CDK APP INITIALISATION
// ============================================================================

const app = new cdk.App();

// ============================================================================
// ENVIRONMENT CONFIGURATION
// ============================================================================

// Get environment name from CDK context or environment variable
// Usage: cdk deploy --context environment=development
// Or: export CDK_ENVIRONMENT=development && cdk deploy
const environmentName =
  app.node.tryGetContext("environment") ||
  process.env.CDK_ENVIRONMENT ||
  "development";

// Validate environment exists in configuration
if (!environments[environmentName]) {
  const validEnvironments = Object.keys(environments).join(", ");
  throw new Error(
    `Invalid environment: ${environmentName}\n\n` +
      `Valid environments: ${validEnvironments}\n\n` +
      `Usage:\n` +
      `  cdk deploy --context environment=${
        validEnvironments.split(", ")[0]
      }\n` +
      `  Or set CDK_ENVIRONMENT environment variable`
  );
}

const config: EnvironmentConfig = environments[environmentName];

// Validate required configuration values
if (!config.account) {
  throw new Error(
    `AWS Account ID is required for environment: ${environmentName}\n\n` +
      `Set the following environment variable:\n` +
      `  AWS_ACCOUNT_ID_${environmentName.toUpperCase()} or\n` +
      `  AWS_ACCOUNT_ID_DEV (for development)\n\n` +
      `Troubleshooting:\n` +
      `  1. Verify your .env file contains the account ID\n` +
      `  2. Export the environment variable before running CDK commands\n` +
      `  3. Check your CI/CD pipeline configuration`
  );
}

if (!config.region) {
  throw new Error(
    `AWS Region is required for environment: ${environmentName}\n\n` +
      `Set the AWS_REGION environment variable or update config/environments.ts`
  );
}

// ============================================================================
// VPC CIDR MAPPING
// ============================================================================

// VPC CIDR blocks per environment to avoid conflicts
// Ensure CIDRs don't overlap if VPC peering is planned
const vpcCidrMap: Record<string, string> = {
  pipeline: "10.0.0.0/16",
  development: "10.1.0.0/16",
  staging: "10.2.0.0/16",
  production: "10.3.0.0/16",
};

// ============================================================================
// STACK CONFIGURATION
// ============================================================================

// Common stack properties for all stacks
// Environment-specific account and region from configuration
const stackProps: cdk.StackProps = {
  env: {
    account: config.account,
    region: config.region,
  },
};

// Environment-specific NAT gateway configuration
// Production uses HA NAT gateways, others use cost-optimised single gateway
const natGatewaysConfig: Record<string, number> = {
  pipeline: 0, // Pipeline account - no internet access needed
  development: 1, // Single NAT gateway for cost optimisation
  staging: 1, // Single NAT gateway for cost optimisation
  production: 2, // High availability NAT gateways across AZs
};

// ============================================================================
// NETWORKING STACK
// ============================================================================

// NetworkingStack is foundational - must be deployed first
// Other stacks depend on VPC outputs and SSM parameters
const networkingStack = new NetworkingStack(
  app,
  `NetworkingStack-${config.envName}`,
  {
    ...stackProps,
    envName: config.envName,
    vpcCidr: vpcCidrMap[config.envName] || "10.0.0.0/16",
    maxAzs: 2, // Use 2 availability zones for high availability
    natGateways: natGatewaysConfig[config.envName] ?? 0,
    enableVpcFlowLogs: true, // Required for security monitoring and compliance
    enableVpcEndpoints: true, // Gateway endpoints for S3 and DynamoDB (free)
  }
);

// ============================================================================
// LOAD BALANCER STACK
// ============================================================================

// LoadBalancerStack depends on NetworkingStack for VPC
// Creates Application Load Balancer with HTTP/HTTPS listeners
const loadBalancerStack = new LoadBalancerStack(
  app,
  `LoadBalancerStack-${config.envName}`,
  {
    ...stackProps,
    envName: config.envName,
    vpc: networkingStack.vpc,
    internetFacing: true,
    enableHttps: false, // Set to true and provide certificateArn for HTTPS
    deletionProtection: config.envName === "production",
    accessLogEnabled: true,
  }
);

// Explicit dependency ensures NetworkingStack is deployed first
loadBalancerStack.addDependency(networkingStack);

// ============================================================================
// LAUNCH TEMPLATE STACK
// ============================================================================

// LaunchTemplateStack depends on NetworkingStack for VPC
// Creates EC2 Launch Template for ECS container instances
const launchTemplateStack = new LaunchTemplateStack(
  app,
  `LaunchTemplateStack-${config.envName}`,
  {
    ...stackProps,
    envName: config.envName,
    vpc: networkingStack.vpc,
    // keyPairName: optional - provide if SSH access is needed
  }
);

// Explicit dependency ensures NetworkingStack is deployed first
launchTemplateStack.addDependency(networkingStack);

// ============================================================================
// MONITORING EFS STACK
// ============================================================================

// MonitoringEfsStack depends on NetworkingStack for VPC
// Creates EFS file system for persistent monitoring data storage
const monitoringEfsStack = new MonitoringEfsStack(
  app,
  `MonitoringEfsStack-${config.envName}`,
  {
    ...stackProps,
    envName: config.envName,
    vpc: networkingStack.vpc,
    enableEncryption: true,
    lifecyclePolicy: efs.LifecyclePolicy.AFTER_30_DAYS,
    // crossAccountTargets: optional - provide for cross-account monitoring
  }
);

// Explicit dependency ensures NetworkingStack is deployed first
monitoringEfsStack.addDependency(networkingStack);

// ============================================================================
// ADDITIONAL STACKS
// ============================================================================

// Additional stacks can be added here as dependencies are created
// Available stacks:
// - networkingStack: VPC, subnets, security groups
// - loadBalancerStack: ALB, listeners, target groups
// - launchTemplateStack: EC2 Launch Template for ECS container instances
// - monitoringEfsStack: EFS file system for persistent monitoring data storage
//
// Example:
// const monitoringInfraStack = new MonitoringInfraStack(
//   app,
//   `MonitoringInfraStack-${config.envName}`,
//   {
//     ...stackProps,
//     vpc: networkingStack.vpc,
//     alb: loadBalancerStack.getLoadBalancer(),
//     launchTemplate: launchTemplateStack.launchTemplate,
//     efsFileSystem: monitoringEfsStack.fileSystem,
//     efsAccessPoint: monitoringEfsStack.accessPoint,
//     envName: config.envName,
//   }
// );

// ============================================================================
// TAGS
// ============================================================================

// Apply consistent tags to all resources in the app
// Tags enable cost allocation, resource management, and automation
cdk.Tags.of(app).add("Project", "Monitoring Infrastructure");
cdk.Tags.of(app).add("Environment", config.envName);
cdk.Tags.of(app).add("ManagedBy", "CDK");
