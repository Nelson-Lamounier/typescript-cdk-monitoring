#!/usr/bin/env node
/** @format */

import "source-map-support/register";
import "dotenv/config";
import * as cdk from "aws-cdk-lib";
import { Aspects } from "aws-cdk-lib";
import { AwsSolutionsChecks } from "cdk-nag";

import { environments } from "../config/environments";

import {
  resolveCertificate,
  resolveDomainConfig,
} from "./helpers/certificate-helper";
import { deployFoundationStacks } from "./stacks/foundation-stack";

// ============================================================================
// INITIALIZE CDK APP
// ============================================================================
const app = new cdk.App();

// ============================================================================
// ENVIRONMENT CONFIGURATION
// ============================================================================
const envName = process.env.ENVIRONMENT || "development";
const config = environments[envName];

if (!config) {
  throw new Error(
    `Unknown environment: ${envName}. ` +
      `Valid options: ${Object.keys(environments).join(", ")}`
  );
}

if (!config.account) {
  throw new Error(
    `Account ID not configured for ${envName}. ` +
      `Set AWS_PIPELINE_ACCOUNT_ID environment variable.`
  );
}

const stackProps: cdk.StackProps = {
  env: {
    account: config.account,
    region: config.region,
  },
};

// ============================================================================
// RESOLVE CERTIFICATE (for HTTPS)
// ============================================================================
const { rootDomainName, hostedZoneId } = resolveDomainConfig(app);
// Certificate config will be used when HTTPS services are added
const certificateConfig = resolveCertificate(
  app,
  config.envName,
  stackProps,
  rootDomainName,
  hostedZoneId
);
void certificateConfig; // Will be used for ALB HTTPS listeners

// ============================================================================
// 1. FOUNDATION: NETWORKING
// ============================================================================
// networkingStack will be used for cross-stack dependencies (VPC peering, etc.)
const { networkingStack } = deployFoundationStacks(app, config, stackProps);
void networkingStack; // Will be used for VPC peering and dependent stacks

// ============================================================================
// 4. VPC PEERING (for cross-account monitoring)
// ============================================================================
// TODO: Implement VPC peering helper and stack deployment

// ============================================================================
// CDK NAG INTEGRATION
// ============================================================================
if (process.env.ENABLE_CDK_NAG !== "false") {
  Aspects.of(app).add(
    new AwsSolutionsChecks({
      verbose: true,
      logIgnores: !config.isProduction,
    })
  );
}

// ============================================================================
// SYNTHESIZE
// ============================================================================
app.synth();
