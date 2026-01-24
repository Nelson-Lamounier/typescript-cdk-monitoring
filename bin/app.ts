#!/usr/bin/env node
/** @format */

import "source-map-support/register";
import * as cdk from "aws-cdk-lib";

import { environments } from "../config/environments";
import { getDefaultTags, toTagsRecord } from "../config/tagging";
import {
  validateConfiguration,
  validateAllProjects,
  formatValidationResult,
} from "../config/validation";
import {
  calculateProjectCost,
  formatCostBreakdown,
  compareCosts,
} from "../lib/shared/helpers/cost-helper";

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

// ============================================================================
// CONFIGURATION VALIDATION (Pre-Deployment Checks)
// ============================================================================

console.log(`\n${"=".repeat(80)}`);
console.log("CONFIGURATION VALIDATION");
console.log("=".repeat(80));

// Validate environment configuration
const envValidation = validateConfiguration(envName);
console.log(formatValidationResult(envValidation, `Environment: ${envName}`));

if (!envValidation.valid) {
  throw new Error(
    `\n❌ Environment configuration validation failed for '${envName}'.\n` +
    `Please fix the errors above before deploying.`
  );
}

// Validate all projects that will be deployed
const projectsToValidate = ["monitoring", "webapp"];
const projectValidations = validateAllProjects(envName, projectsToValidate);

let hasProjectErrors = false;
projectValidations.forEach((validation, projectName) => {
  console.log(formatValidationResult(validation, `Project: ${projectName}`));
  if (!validation.valid) {
    hasProjectErrors = true;
  }
});

if (hasProjectErrors) {
  throw new Error(
    `\n❌ Project configuration validation failed.\n` +
    `Please fix the errors above before deploying.`
  );
}

console.log(`\n✅ All configuration validation checks passed!`);
console.log("=".repeat(80) + "\n");

// ============================================================================
// COST ESTIMATION (Budget Planning)
// ============================================================================

console.log(`${"=".repeat(80)}`);
console.log("ESTIMATED MONTHLY COSTS");
console.log("=".repeat(80));

// Display cost estimates for each project
const projectsForCost = ["monitoring", "webapp"];

projectsForCost.forEach((projectName) => {
  const costBreakdown = calculateProjectCost(projectName, envName, targetRegion);
  console.log(formatCostBreakdown(projectName, envName, costBreakdown, targetRegion));
});

// Show cost comparison if not in production
if (envName !== "production") {
  console.log(compareCosts("monitoring", ["development", "production"], targetRegion));
  console.log(compareCosts("webapp", ["development", "production"], targetRegion));
}

console.log("=".repeat(80) + "\n");

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
// STACK TAGGING (Centralised Configuration)
// ============================================================================

// Get tags from centralised configuration
// Includes: Environment, ManagedBy, Repository, CostCentre, Owner, Compliance, DataClassification
const appTags = getDefaultTags(envName);
const tagsRecord = toTagsRecord(appTags);

// Apply all tags to the app
Object.entries(tagsRecord).forEach(([key, value]) => {
  cdk.Tags.of(app).add(key, value);
});

console.log(`\nApplied tags:`, JSON.stringify(tagsRecord, null, 2));

app.synth();
