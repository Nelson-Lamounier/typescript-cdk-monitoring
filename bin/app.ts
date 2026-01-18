#!/usr/bin/env node
/** @format */

import "source-map-support/register";
import * as cdk from "aws-cdk-lib";

import { environments } from "../config/environments";

import { deployFoundationStacks } from "./stacks/foundation-stack";
import { createMonitoringStacks } from "./stacks/monitoring-stack";

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

console.log(`Deploying to environment: ${envName}`);
console.log(`Region: ${envConfig.region || "auto-detect"}`);
console.log(`Account: ${envConfig.account || "auto-detect"}`);

// Stack props
const stackProps: cdk.StackProps = {
  env: {
    account: envConfig.account,
    region: envConfig.region,
  },
};

// ============================================================================
// FOUNDATION STACKS
// ============================================================================

const { networkingStack } = deployFoundationStacks(app, envConfig, stackProps);

// ============================================================================
// MONITORING STACKS
// ============================================================================

createMonitoringStacks(app, envName, envConfig, networkingStack);

// ============================================================================
// STACK TAGGING
// ============================================================================

cdk.Tags.of(app).add("Environment", envName);
cdk.Tags.of(app).add("ManagedBy", "CDK");
cdk.Tags.of(app).add("Repository", "monitoring-iac");

app.synth();
