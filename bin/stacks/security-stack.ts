/** @format */

import * as cdk from "aws-cdk-lib";
import * as ecs from "aws-cdk-lib/aws-ecs";

import { NetworkingStack } from "../../lib/stacks/foundation/networking-stack";
import { ProwlerStack } from "../../lib/stacks/security/prowler-stack";
import { EnvironmentConfig } from "../../config/environments";

/**
 * Create security compliance stacks for an environment
 *
 * Architecture:
 * 1. ProwlerStack - Security compliance scanning (Prowler container, S3 results, EventBridge schedule)
 *
 * Security Checks Include:
 * - Security Groups: Unrestricted ingress (0.0.0.0/0), sensitive ports, default SGs
 * - ELB/ALB: SSL policies, WAF attachment, access logging, security group rules
 * - VPC: Flow logs, default security group, NACLs
 * - IAM: Overly permissive policies, MFA, access keys
 * - S3: Public access, encryption, versioning
 * - And 300+ more checks across all AWS services
 *
 * Dependencies:
 * - Requires NetworkingStack (VPC)
 * - Requires existing ECS cluster (from MonitoringInfraStack)
 *
 * Cost Optimisation:
 * - Uses existing EC2-based ECS cluster (no additional Fargate costs)
 * - Scheduled scans (not continuous) to minimise compute costs
 * - Development: Weekly scans (~£0.50/month API calls only)
 * - Production: Daily scans (~£5/month API calls only)
 *
 * @param app CDK app
 * @param envName Environment name (e.g., 'development', 'staging', 'production')
 * @param envConfig Environment configuration
 * @param networkingStack The networking stack (for VPC reference)
 * @param cluster The existing ECS cluster from MonitoringInfraStack
 * @param stackProps Stack properties including env (account/region)
 */
export function createSecurityStacks(
  app: cdk.App,
  envName: string,
  envConfig: EnvironmentConfig,
  networkingStack: NetworkingStack,
  cluster: ecs.ICluster,
  stackProps: cdk.StackProps
): {
  prowlerStack: ProwlerStack;
} {
  const stackNamePrefix = `${envName}-Security`;
  const projectName = "security";

  // ============================================================================
  // 1. PROWLER SECURITY COMPLIANCE STACK
  // ============================================================================

  const prowlerStack = new ProwlerStack(app, `${stackNamePrefix}Prowler`, {
    ...stackProps,
    envName,
    projectName,

    // Use existing EC2-based ECS cluster from MonitoringInfraStack
    cluster,

    // VPC (for security group lookups, not for Fargate)
    vpc: networkingStack.vpc,

    // Prowler Configuration
    prowlerConfig: {
      // Use CIS framework for development (minimal, fast scans)
      // Production will use expanded frameworks via defaults
      frameworks: envConfig.isProduction
        ? undefined // Use defaults (CIS, PCI-DSS, AWS Foundational)
        : ["cis_aws"],

      // Development: Exclude noisy checks to reduce scan time
      excludeChecks: envConfig.isProduction
        ? undefined
        : [
            // Exclude checks that require specific setups not present in dev
            "accessanalyzer_enabled", // Access Analyzer might not be enabled in dev
            "guardduty_is_enabled", // GuardDuty might not be enabled in dev
            "securityhub_enabled", // Security Hub might not be enabled in dev
          ],

      // Enable Security Hub integration for production
      enableSecurityHub: envConfig.isProduction,

      // Enable ECS Exec for debugging in development
      enableExecuteCommand: !envConfig.isProduction,
    },
  });

  // Add dependency on networking
  prowlerStack.addDependency(networkingStack);

  return {
    prowlerStack,
  };
}
