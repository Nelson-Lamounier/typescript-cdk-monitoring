#!/usr/bin/env node
/** @format */

import "source-map-support/register";

import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";

import { NetworkingStack } from "../lib/stacks/networking-stack";
import { LoadBalancerStack } from "../lib/stacks/elb-stack";
import { LaunchTemplateStack } from "../lib/stacks/compute/launch-template-stack";
import { EbsStorageStack } from "../lib/stacks/storage/ebs-storage-stack";
import { EcsStack } from "../lib/stacks/compute/ecs-stack";
import { EcsServicesStack } from "../lib/stacks/compute/ecs-services-stack";
import { environments, EnvironmentConfig } from "../config/environments";
import { getProjectConfig, ProjectConfig } from "../config/projects";
import {
  createMonitoringApplicationConfig,
  createNextJsApplicationConfig,
} from "../lib/config/ecs-applications";

// ============================================================================
// CDK APP INITIALISATION
// ============================================================================

const app = new cdk.App();

// ============================================================================
// PROJECT CONFIGURATION
// ============================================================================

// Get project name from CDK context or environment variable
// Usage: cdk deploy --context project=monitoring --context environment=development
// Or: PROJECT_NAME=monitoring ENVIRONMENT=development cdk deploy
const projectName =
  app.node.tryGetContext("project") || process.env.PROJECT_NAME || "monitoring"; // Default to monitoring for backward compatibility

// ============================================================================
// ENVIRONMENT CONFIGURATION
// ============================================================================

// Get environment name from CDK context or environment variable
// Usage: cdk deploy --context environment=development
// Or: export CDK_ENVIRONMENT=development && cdk deploy
const environmentName =
  app.node.tryGetContext("environment") ||
  process.env.CDK_ENVIRONMENT ||
  process.env.ENVIRONMENT ||
  "development";

// Validate environment exists in configuration
if (!environments[environmentName]) {
  const validEnvironments = Object.keys(environments).join(", ");
  throw new Error(
    `Invalid environment: ${environmentName}\n\n` +
      `Valid environments: ${validEnvironments}\n\n` +
      `Usage:\n` +
      `  PROJECT_NAME=${projectName} ENVIRONMENT=${
        validEnvironments.split(", ")[0]
      } cdk deploy\n` +
      `  Or: cdk deploy --context project=${projectName} --context environment=${
        validEnvironments.split(", ")[0]
      }`
  );
}

const config: EnvironmentConfig = environments[environmentName];

// Get project configuration with environment-specific overrides
const projectConfig: ProjectConfig = getProjectConfig(
  projectName,
  environmentName
);

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
// Project-specific CIDR can override this via projectConfig.networking.vpcCidr
const vpcCidrMap: Record<string, string> = {
  pipeline: "10.0.0.0/16",
  development: "10.1.0.0/16",
  staging: "10.2.0.0/16",
  production: "10.3.0.0/16",
};

// Use project-specific CIDR if provided, otherwise use environment default
const vpcCidr =
  projectConfig.networking?.vpcCidr ||
  vpcCidrMap[environmentName] ||
  "10.0.0.0/16";

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
// Production uses HA NAT gateways, others use cost-optimised configuration
// Project-specific config can override this via projectConfig.networking.natGateways
const natGatewaysConfig: Record<string, number> = {
  pipeline: 0, // Pipeline account - no internet access needed
  development: 0, // No NAT gateway for cost optimisation in development
  staging: 1, // Single NAT gateway for cost optimisation
  production: 2, // High availability NAT gateways across AZs
};

// Use project-specific NAT gateway count if provided, otherwise use environment default
const natGateways =
  projectConfig.networking?.natGateways ??
  natGatewaysConfig[environmentName] ??
  0;

// ============================================================================
// NETWORKING STACK
// ============================================================================

// NetworkingStack is foundational - must be deployed first
// Other stacks depend on VPC outputs and SSM parameters
// Uses project-agnostic naming: NetworkingStack-{project}-{environment}
// Note: Each project can have its own VPC, or projects can share a VPC
// by using the same project name or omitting project name for shared networking
const networkingStack = new NetworkingStack(
  app,
  `NetworkingStack-${projectConfig.name}-${config.envName}`,
  {
    ...stackProps,
    envName: config.envName,
    projectName: projectConfig.name, // Pass project name for resource naming and tagging
    vpcCidr: vpcCidr,
    maxAzs: projectConfig.networking?.maxAzs ?? 2,
    natGateways: natGateways,
    enableVpcFlowLogs: projectConfig.networking?.enableVpcFlowLogs ?? true,
    enableVpcEndpoints: projectConfig.networking?.enableVpcEndpoints ?? true,
  }
);

// ============================================================================
// LOAD BALANCER STACK
// ============================================================================

// LoadBalancerStack depends on NetworkingStack for VPC
// Creates Application Load Balancer with HTTP/HTTPS listeners
// Uses project-agnostic naming: LoadBalancerStack-{project}-{environment}
const loadBalancerStack = new LoadBalancerStack(
  app,
  `LoadBalancerStack-${projectConfig.name}-${config.envName}`,
  {
    ...stackProps,
    envName: config.envName,
    projectName: projectConfig.name, // Pass project name for resource naming and tagging
    vpc: networkingStack.vpc,
    internetFacing: projectConfig.loadBalancer?.internetFacing ?? true,
    enableHttps: projectConfig.loadBalancer?.enableHttps ?? false,
    certificateArn: projectConfig.loadBalancer?.certificateArn,
    allowedCidrs: projectConfig.loadBalancer?.allowedIpRanges,
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
// Uses project-agnostic naming: LaunchTemplateStack-{project}-{environment}
const launchTemplateStack = new LaunchTemplateStack(
  app,
  `LaunchTemplateStack-${projectConfig.name}-${config.envName}`,
  {
    ...stackProps,
    envName: config.envName,
    projectName: projectConfig.name, // Pass project name for resource naming and tagging
    vpc: networkingStack.vpc,
    instanceType: projectConfig.compute?.instanceType
      ? (() => {
          // Parse instance type string (e.g., "t3.medium") into InstanceType
          const parts = projectConfig.compute.instanceType.split(".");
          const instanceClass = parts[0].toUpperCase();
          const instanceSize = parts[1]?.toUpperCase() || "MICRO";
          return ec2.InstanceType.of(
            (ec2.InstanceClass[
              instanceClass as keyof typeof ec2.InstanceClass
            ] || ec2.InstanceClass.T3) as ec2.InstanceClass,
            (ec2.InstanceSize[instanceSize as keyof typeof ec2.InstanceSize] ||
              ec2.InstanceSize.MICRO) as ec2.InstanceSize
          );
        })()
      : undefined, // Use project config instance type if provided
    // keyPairName: optional - provide if SSH access is needed
  }
);

// Explicit dependency ensures NetworkingStack is deployed first
launchTemplateStack.addDependency(networkingStack);

// ============================================================================
// MONITORING EBS STORAGE STACK
// ============================================================================

// EbsStorageStack depends on NetworkingStack for VPC
// Creates SSM parameters for storage configuration
// Note: EBS volumes are attached via launch template, not created in this stack
// Uses project-agnostic naming: EbsStorageStack-{project}-{environment}
// Only create if project has storage configuration
let ebsStorageStack: EbsStorageStack | undefined;
if (
  projectConfig.storage?.ebsVolumes &&
  projectConfig.storage.ebsVolumes.length > 0
) {
  // Extract volume sizes from project config (for monitoring projects)
  const prometheusVolume = projectConfig.storage.ebsVolumes.find((v) =>
    v.mountPath.includes("prometheus")
  );
  const grafanaVolume = projectConfig.storage.ebsVolumes.find((v) =>
    v.mountPath.includes("grafana")
  );

  ebsStorageStack = new EbsStorageStack(
    app,
    `EbsStorageStack-${projectConfig.name}-${config.envName}`,
    {
      ...stackProps,
      envName: config.envName,
      projectName: projectConfig.name, // Pass project name for SSM parameter paths
      projectType: projectConfig.type, // Pass project type for conditional configuration
      vpc: networkingStack.vpc,
      // Use generic volumes array if available, otherwise fall back to legacy Prometheus/Grafana
      volumes: projectConfig.storage.ebsVolumes?.map((vol) => ({
        name:
          vol.mountPath.split("/").pop() || vol.deviceName.replace("/dev/", ""),
        sizeGB: vol.sizeGB,
        volumeType:
          vol.volumeType === "gp3"
            ? ec2.EbsDeviceVolumeType.GP3
            : vol.volumeType === "gp2"
            ? ec2.EbsDeviceVolumeType.GP2
            : vol.volumeType === "io1"
            ? ec2.EbsDeviceVolumeType.IO1
            : ec2.EbsDeviceVolumeType.GP3,
      })),
      // Legacy: Keep for backward compatibility if volumes array is not used
      prometheusVolumeSize: prometheusVolume?.sizeGB ?? 100,
      grafanaVolumeSize: grafanaVolume?.sizeGB ?? 50,
      volumeType:
        prometheusVolume?.volumeType === "gp3"
          ? ec2.EbsDeviceVolumeType.GP3
          : prometheusVolume?.volumeType === "gp2"
          ? ec2.EbsDeviceVolumeType.GP2
          : ec2.EbsDeviceVolumeType.GP3,
      // crossAccountTargets: optional - provide for cross-account monitoring
    }
  );
  ebsStorageStack.addDependency(networkingStack);
}

// ============================================================================
// ECS STACK
// ============================================================================

// EcsStack depends on NetworkingStack for VPC
// Creates ECS cluster with dynamically configured services
// Uses EBS volumes for persistent storage (attached via launch template)
// Note: This stack creates its own ALB for application services routing
// (separate from LoadBalancerStack which is for general application traffic)
// Uses project-agnostic naming: EcsStack-{project}-{environment}

// Application configuration is controlled by project type
// For monitoring projects: use createMonitoringApplicationConfig
// For webapp projects: use createNextJsApplicationConfig
// For other projects: use createApplicationConfig with custom config
let ecsApplicationConfig;
if (projectConfig.type === "monitoring") {
  ecsApplicationConfig = createMonitoringApplicationConfig(config.envName);
} else if (projectConfig.type === "webapp") {
  ecsApplicationConfig = createNextJsApplicationConfig(
    config.envName,
    "latest"
  );
} else {
  // Generic application - can be extended for other project types
  ecsApplicationConfig = createNextJsApplicationConfig(
    config.envName,
    "latest"
  );
}

// Override EBS volumes from project config if provided
if (projectConfig.storage?.ebsVolumes) {
  ecsApplicationConfig.ebsVolumes = projectConfig.storage.ebsVolumes.map(
    (vol) => ({
      deviceName: vol.deviceName,
      sizeGB: vol.sizeGB,
      mountPath: vol.mountPath,
      volumeType: vol.volumeType,
      deleteOnTermination: vol.deleteOnTermination,
    })
  );
}

// Override compute settings from project config if provided
if (projectConfig.compute) {
  if (projectConfig.compute.enableContainerInsights !== undefined) {
    ecsApplicationConfig.cluster = {
      ...ecsApplicationConfig.cluster,
      enableContainerInsights: projectConfig.compute.enableContainerInsights,
    };
  }
}

const ecsStack = new EcsStack(
  app,
  `EcsStack-${projectConfig.name}-${config.envName}`,
  {
    ...stackProps,
    envName: config.envName,
    vpc: networkingStack.vpc,
    applicationConfig: ecsApplicationConfig,
    // crossAccountTargets: optional - provide for cross-account monitoring
    // customUserData: optional - provide custom user data script
  }
);

// Explicit dependency ensures NetworkingStack is deployed first
ecsStack.addDependency(networkingStack);

// Add dependency on EBS storage stack for SSM parameters (if storage configured)
if (ebsStorageStack) {
  ecsStack.addDependency(ebsStorageStack);
}

// ============================================================================
// ECS SERVICES STACK
// ============================================================================

// EcsServicesStack creates the actual ECS services dynamically from configuration
// It depends on EcsStack which provides the cluster and capacity providers
// This stack is generic and can be used for any application type
let ecsServicesStack: EcsServicesStack | undefined;
if (ecsApplicationConfig.services && ecsApplicationConfig.services.length > 0) {
  ecsServicesStack = new EcsServicesStack(
    app,
    `EcsServicesStack-${projectConfig.name}-${config.envName}`,
    {
      ...stackProps,
      envName: config.envName,
      projectName: projectConfig.name,
      applicationName: ecsApplicationConfig.applicationName,
      vpc: networkingStack.vpc,
      cluster: ecsStack.cluster,
      autoScalingGroup: ecsStack.autoScalingGroup,
      loadBalancer: ecsStack.loadBalancer,
      listener: ecsStack.listener, // Pass listener from EcsStack to avoid cyclic dependencies
      services: ecsApplicationConfig.services,
      enablePublicEcr: projectConfig.type === "monitoring", // Monitoring uses public Docker Hub images
    }
  );

  // Explicit dependency ensures EcsStack is deployed first
  ecsServicesStack.addDependency(ecsStack);
}

// ============================================================================
// ADDITIONAL STACKS
// ============================================================================

// Additional stacks can be added here as dependencies are created
// Available stacks:
// - networkingStack: VPC, subnets, security groups
// - loadBalancerStack: ALB, listeners, target groups (for application traffic)
// - launchTemplateStack: EC2 Launch Template for ECS container instances
// - ebsStorageStack: SSM parameters for monitoring configuration
// - ecsStack: ECS cluster with Prometheus, Grafana, Node Exporter
//
// Stack dependencies:
// - All stacks depend on networkingStack (VPC)
// - ecsStack depends on ebsStorageStack (for SSM parameters)
// - EBS volumes are attached via launch template in ecsStack

// ============================================================================
// TAGS
// ============================================================================

// ============================================================================
// TAGS
// ============================================================================

// Apply consistent tags to all resources in the app
// Tags enable cost allocation, resource management, and automation
// Project-agnostic tagging: uses project name from configuration
cdk.Tags.of(app).add("Project", projectConfig.name);
cdk.Tags.of(app).add("ProjectType", projectConfig.type);
cdk.Tags.of(app).add("Environment", config.envName);
cdk.Tags.of(app).add("ManagedBy", "CDK");
if (projectConfig.description) {
  // Sanitize description for IAM tag constraints
  // IAM tags only allow: letters, spaces, numbers, and: _ . : / = + - @
  // Remove or replace invalid characters like parentheses, commas, etc.
  const sanitizedDescription = projectConfig.description
    .replace(/[()]/g, "") // Remove parentheses
    .replace(/,/g, " ") // Replace commas with spaces
    .replace(/[^\p{L}\p{Z}\p{N}_.:/=+\-@]/gu, "") // Remove any other invalid characters
    .trim()
    .substring(0, 256); // IAM tag values have a 256 character limit

  if (sanitizedDescription) {
    cdk.Tags.of(app).add("Description", sanitizedDescription);
  }
}
