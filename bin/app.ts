#!/usr/bin/env node
/** @format */

import "source-map-support/register";
import * as cdk from "aws-cdk-lib";

import { environments } from "../config/environments";

import { deployFoundationStacks } from "./stacks/foundation-stack";
import { createMonitoringStacks } from "./stacks/monitoring-stack";
import { createSecurityStacks } from "./stacks/security-stack";
import { createWebappStacks } from "./stacks/webapp-stack";

const app = new cdk.App();

// Get environment from context or use default
const envName = app.node.tryGetContext("environment") || "development";
const envConfig = environments[envName];

if (!envConfig) {
  throw new Error(
    `Environment '${envName}' not found in configuration.\n\n` +
      `Available environments: ${Object.keys(environments).join(", ")}\n` +
      `Usage: cdk deploy --context environment=development`
  );
}

// Allow context override for CI/CD deployments
// This enables explicit account/region specification in GitHub Actions
const contextAccount = app.node.tryGetContext("accountId");
const contextRegion = app.node.tryGetContext("awsRegion");

const targetAccount = contextAccount || envConfig.account;
const targetRegion = contextRegion || envConfig.region;

console.log(`Deploying to environment: ${envName}`);
console.log(`Region: ${targetRegion || "auto-detect"}`);
console.log(`Account: ${targetAccount || "auto-detect"}`);

if (contextAccount) {
  console.log(`  (Account overridden via context)`);
}
if (contextRegion) {
  console.log(`  (Region overridden via context)`);
}

// Stack props
const stackProps: cdk.StackProps = {
  env: {
    account: targetAccount,
    region: targetRegion,
  },
};

// ============================================================================
// FOUNDATION STACKS
// ============================================================================

const { networkingStack } = deployFoundationStacks(app, envConfig, stackProps);

// ============================================================================
// MONITORING STACKS
// ============================================================================

const { infraStack: monitoringInfraStack } = createMonitoringStacks(
  app,
  envName,
  envConfig,
  networkingStack,
  stackProps
);

// ============================================================================
// SECURITY STACKS (Prowler Compliance Scanning)
// ============================================================================
// Uses the existing EC2-based ECS cluster from monitoring infrastructure
// Prowler checks include: Security Groups, ALB/ELB, VPC, IAM, S3, and 300+ more

createSecurityStacks(
  app,
  envName,
  envConfig,
  networkingStack,
  monitoringInfraStack.cluster,
  stackProps
);

// ============================================================================
// WEBAPP STACKS
// ============================================================================

createWebappStacks(app, envName, envConfig, networkingStack, stackProps);

// ============================================================================
// STACK TAGGING
// ============================================================================

cdk.Tags.of(app).add("Environment", envName);
cdk.Tags.of(app).add("ManagedBy", "CDK");
cdk.Tags.of(app).add("Repository", "monitoring-iac");

app.synth();
