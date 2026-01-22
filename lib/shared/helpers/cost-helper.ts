/** @format */

/**
 * Cost Calculation and Estimation Helpers
 * 
 * This module provides utilities for calculating and displaying estimated
 * monthly costs for infrastructure resources based on project configuration.
 */

import { getProjectConfig, CostEstimate } from "../../../config/projects";
import { getEncryptionConfig } from "../../../config/security-baseline";

/**
 * Cost breakdown by category
 */
export interface CostBreakdown {
  compute: string;
  storage: string;
  networking: string;
  loadBalancer: string;
  encryption?: string;
  total: string;
  notes: string[];
}

/**
 * Region configuration for currency symbols
 */
export const REGION_CONFIG = {
  "eu-west-1": { currency: "EUR", symbol: "€" },
  "eu-west-2": { currency: "EUR", symbol: "€" },
  "eu-west-3": { currency: "EUR", symbol: "€" },
  "eu-central-1": { currency: "EUR", symbol: "€" },
  "eu-north-1": { currency: "EUR", symbol: "€" },
  "eu-south-1": { currency: "EUR", symbol: "€" },
  "us-east-1": { currency: "USD", symbol: "$" },
  "us-east-2": { currency: "USD", symbol: "$" },
  "us-west-1": { currency: "USD", symbol: "$" },
  "us-west-2": { currency: "USD", symbol: "$" },
} as const;

/**
 * AWS pricing constants for EU regions (EUR, eu-west-1)
 * Last updated: January 2025
 * Source: AWS Pricing Calculator (eu-west-1 region)
 * 
 * Note: These are approximate on-demand prices for Linux instances.
 * Actual costs may vary based on:
 * - Reserved instances or Savings Plans
 * - Spot instances
 * - Regional variations
 * - Promotional credits
 * 
 * To update pricing, run: npm run update-pricing
 */
export const AWS_PRICING_EUR = {
  // Compute (per month, on-demand, 730 hours)
  // Based on eu-west-1 pricing as of January 2025
  instances: {
    "t3.nano": 3.85,      // €0.0053/hour
    "t3.micro": 8.35,     // €0.0114/hour
    "t3.small": 16.70,    // €0.0228/hour
    "t3.medium": 33.41,   // €0.0456/hour
    "t3.large": 66.82,    // €0.0912/hour
    "t3.xlarge": 133.64,  // €0.1824/hour
    "t3.2xlarge": 267.28, // €0.3648/hour
    "t4g.nano": 3.10,     // €0.0042/hour
    "t4g.micro": 6.78,    // €0.0093/hour
    "t4g.small": 13.55,   // €0.0186/hour
    "t4g.medium": 27.10,  // €0.0371/hour
    "t4g.large": 54.20,   // €0.0742/hour
    "m5.large": 70.08,    // €0.096/hour
    "m5.xlarge": 140.16,  // €0.192/hour
    "c5.large": 62.05,    // €0.085/hour
    "c5.xlarge": 124.10,  // €0.17/hour
  },
  
  // Storage (per GB per month)
  ebs: {
    gp3: 0.088,  // €0.088/GB/month
    gp2: 0.11,   // €0.11/GB/month
    io1: 0.138,  // €0.138/GB/month
    io2: 0.138,  // €0.138/GB/month
  },
  
  // Networking
  natGateway: 38.10,     // €0.052/hour (~€38.10/month)
  dataTransfer: 0.09,    // €0.09/GB outbound (first 10TB)
  
  // Load Balancers
  alb: {
    base: 18.48,         // €0.0252/hour (~€18.48/month)
    lcu: 0.0073,         // €0.0073/LCU-hour (~€5.33/month per LCU)
  },
  
  // Other services
  containerInsights: 7.30,  // Approximate per cluster per month
  kmsKey: 1.0,             // €1/month per customer-managed key
  
  // CloudWatch
  logIngestion: 0.57,      // €0.57/GB ingested
  logStorage: 0.0334,      // €0.0334/GB per month
};

/**
 * AWS pricing constants for US regions (USD, us-east-1)
 * Last updated: January 2025
 */
export const AWS_PRICING_USD = {
  instances: {
    "t3.nano": 3.80,
    "t3.micro": 7.59,
    "t3.small": 15.18,
    "t3.medium": 30.37,
    "t3.large": 60.74,
    "t3.xlarge": 121.47,
    "t3.2xlarge": 242.93,
    "t4g.nano": 3.07,
    "t4g.micro": 6.13,
    "t4g.small": 12.26,
    "t4g.medium": 24.53,
    "t4g.large": 49.06,
    "m5.large": 70.08,
    "m5.xlarge": 140.16,
    "c5.large": 62.05,
    "c5.xlarge": 124.10,
  },
  ebs: {
    gp3: 0.08,
    gp2: 0.10,
    io1: 0.125,
    io2: 0.125,
  },
  natGateway: 32.85,
  dataTransfer: 0.09,
  alb: {
    base: 16.43,
    lcu: 0.008,
  },
  containerInsights: 7.0,
  kmsKey: 1.0,
  logIngestion: 0.50,
  logStorage: 0.03,
};

/**
 * Get pricing constants for a specific region
 * Defaults to EUR pricing for European regions
 */
export function getPricingForRegion(region: string = "eu-west-1") {
  // European regions use EUR pricing
  if (region.startsWith("eu-")) {
    return { pricing: AWS_PRICING_EUR, ...REGION_CONFIG["eu-west-1"] };
  }
  // US regions use USD pricing
  if (region.startsWith("us-")) {
    return { pricing: AWS_PRICING_USD, ...REGION_CONFIG["us-east-1"] };
  }
  // Default to EUR for unknown regions
  return { pricing: AWS_PRICING_EUR, ...REGION_CONFIG["eu-west-1"] };
}

/**
 * Legacy export for backwards compatibility
 * Uses EUR pricing by default
 */
export const AWS_PRICING = AWS_PRICING_EUR;

/**
 * Calculate estimated monthly cost for an instance type
 * 
 * @param instanceType - EC2 instance type (e.g., "t3.small")
 * @param count - Number of instances
 * @param region - AWS region for pricing (defaults to eu-west-1)
 * @returns Estimated monthly cost
 */
export function calculateInstanceCost(
  instanceType: string,
  count: number = 1,
  region: string = "eu-west-1"
): number {
  const { pricing } = getPricingForRegion(region);
  const instancePrice = pricing.instances[instanceType as keyof typeof pricing.instances];
  if (!instancePrice) {
    console.warn(`Unknown instance type pricing: ${instanceType}. Using t3.small as estimate.`);
    return pricing.instances["t3.small"] * count;
  }
  return instancePrice * count;
}

/**
 * Calculate estimated monthly cost for EBS volumes
 * 
 * @param volumes - Array of volume configurations
 * @param region - AWS region for pricing (defaults to eu-west-1)
 * @returns Estimated monthly cost
 */
export function calculateEbsCost(
  volumes: Array<{ sizeGB: number; volumeType?: string }>,
  region: string = "eu-west-1"
): number {
  const { pricing } = getPricingForRegion(region);
  return volumes.reduce((total, vol) => {
    const volumeType = vol.volumeType || "gp3";
    const pricePerGB = pricing.ebs[volumeType as keyof typeof pricing.ebs] || pricing.ebs.gp3;
    return total + (vol.sizeGB * pricePerGB);
  }, 0);
}

/**
 * Calculate total estimated monthly cost for a project
 * 
 * @param projectName - Name of the project
 * @param envName - Environment name
 * @param region - AWS region for pricing (defaults to eu-west-1)
 * @returns Cost breakdown with estimates
 */
export function calculateProjectCost(
  projectName: string,
  envName: string,
  region: string = "eu-west-1"
): CostBreakdown {
  const projectConfig = getProjectConfig(projectName, envName);
  const { pricing, symbol } = getPricingForRegion(region);
  const notes: string[] = [];
  
  // Compute costs
  let computeCost = 0;
  if (projectConfig.compute) {
    const instanceType = projectConfig.compute.instanceType || "t3.small";
    const instanceCount = projectConfig.compute.desiredCapacity || 1;
    computeCost = calculateInstanceCost(instanceType, instanceCount, region);
    
    if (projectConfig.compute.enableContainerInsights) {
      computeCost += pricing.containerInsights;
      notes.push(`Includes Container Insights (~${symbol}${pricing.containerInsights.toFixed(2)}/month)`);
    }
    
    notes.push(`${instanceCount} x ${instanceType} instances`);
  }
  
  // Storage costs
  let storageCost = 0;
  if (projectConfig.storage?.ebsVolumes) {
    storageCost = calculateEbsCost(projectConfig.storage.ebsVolumes, region);
    const totalGB = projectConfig.storage.ebsVolumes.reduce((sum, vol) => sum + vol.sizeGB, 0);
    notes.push(`${totalGB}GB EBS storage`);
  }
  
  // Networking costs (NAT gateway if applicable)
  let networkingCost = 0;
  if (projectConfig.networking?.natGateways) {
    networkingCost = pricing.natGateway * projectConfig.networking.natGateways;
    notes.push(`${projectConfig.networking.natGateways} NAT Gateway(s) (~${symbol}${pricing.natGateway.toFixed(2)}/month each)`);
  }
  
  // Load balancer costs
  let lbCost = pricing.alb.base;
  const estimatedLcus = envName === "production" ? 2 : 1;
  lbCost += pricing.alb.lcu * 730 * estimatedLcus; // 730 hours per month
  notes.push(`ALB with ~${estimatedLcus} LCU(s)`);
  
  // Encryption costs (customer-managed KMS keys)
  let encryptionCost = 0;
  const encConfig = getEncryptionConfig(envName);
  const kmKeys = [
    encConfig.ebsKmsKeyArn,
    encConfig.efsKmsKeyArn,
    encConfig.ecrKmsKeyArn,
    encConfig.s3KmsKeyArn,
    encConfig.dynamoDbKmsKeyArn,
    encConfig.logsKmsKeyArn,
  ].filter(Boolean);
  
  if (kmKeys.length > 0) {
    encryptionCost = kmKeys.length * pricing.kmsKey;
    notes.push(`${kmKeys.length} customer-managed KMS key(s)`);
  }
  
  // Calculate total
  const total = computeCost + storageCost + networkingCost + lbCost + encryptionCost;
  
  return {
    compute: `${symbol}${computeCost.toFixed(2)}`,
    storage: `${symbol}${storageCost.toFixed(2)}`,
    networking: networkingCost > 0 ? `${symbol}${networkingCost.toFixed(2)}` : `${symbol}0 (no NAT)`,
    loadBalancer: `${symbol}${lbCost.toFixed(2)}`,
    encryption: encryptionCost > 0 ? `${symbol}${encryptionCost.toFixed(2)}` : undefined,
    total: `${symbol}${total.toFixed(2)}/month`,
    notes,
  };
}

/**
 * Format cost breakdown for console display
 * 
 * @param projectName - Name of the project
 * @param envName - Environment name
 * @param breakdown - Cost breakdown object
 * @param region - AWS region (for currency display)
 * @returns Formatted string
 */
export function formatCostBreakdown(
  projectName: string,
  envName: string,
  breakdown: CostBreakdown,
  region: string = "eu-west-1"
): string {
  const { currency } = getPricingForRegion(region);
  const lines: string[] = [];
  
  lines.push(`\n💰 Estimated Monthly Cost: ${projectName} (${envName})`);
  lines.push("=".repeat(60));
  lines.push(`  Compute:        ${breakdown.compute}`);
  lines.push(`  Storage:        ${breakdown.storage}`);
  lines.push(`  Networking:     ${breakdown.networking}`);
  lines.push(`  Load Balancer:  ${breakdown.loadBalancer}`);
  
  if (breakdown.encryption) {
    lines.push(`  Encryption:     ${breakdown.encryption}`);
  }
  
  lines.push("─".repeat(60));
  lines.push(`  TOTAL:          ${breakdown.total}`);
  lines.push("");
  
  if (breakdown.notes.length > 0) {
    lines.push("  Notes:");
    breakdown.notes.forEach((note) => {
      lines.push(`    • ${note}`);
    });
  }
  
  lines.push("");
  lines.push(`  ⚠️  These are estimates in ${currency}. Actual costs may vary based on:`);
  lines.push("     - Data transfer volumes");
  lines.push("     - Actual instance usage hours");
  lines.push("     - CloudWatch logs volume");
  lines.push("     - Regional pricing differences");
  lines.push("     - Reserved Instances or Savings Plans");
  
  return lines.join("\n");
}

/**
 * Compare costs between environments
 * 
 * @param projectName - Name of the project
 * @param environments - Array of environment names to compare
 * @param region - AWS region for pricing (defaults to eu-west-1)
 * @returns Formatted comparison string
 */
export function compareCosts(
  projectName: string,
  environments: string[],
  region: string = "eu-west-1"
): string {
  const lines: string[] = [];
  
  lines.push(`\n💰 Cost Comparison: ${projectName}`);
  lines.push("=".repeat(60));
  
  const breakdowns = environments.map((env) => ({
    env,
    breakdown: calculateProjectCost(projectName, env, region),
  }));
  
  breakdowns.forEach(({ env, breakdown }) => {
    lines.push(`  ${env.padEnd(15)} ${breakdown.total}`);
  });
  
  lines.push("─".repeat(60));
  
  return lines.join("\n");
}

/**
 * Get cost estimate from project configuration
 * 
 * Falls back to calculated costs if not explicitly defined
 * 
 * @param projectName - Name of the project
 * @param envName - Environment name
 * @param category - Cost category (compute, storage, loadBalancer)
 * @returns Cost estimate string
 */
export function getCostEstimate(
  projectName: string,
  envName: string,
  category: "compute" | "storage" | "loadBalancer"
): string {
  const projectConfig = getProjectConfig(projectName, envName);
  
  let estimate: CostEstimate | undefined;
  
  switch (category) {
    case "compute":
      estimate = projectConfig.compute?.estimatedMonthlyCost;
      break;
    case "storage":
      estimate = projectConfig.storage?.estimatedMonthlyCost;
      break;
    case "loadBalancer":
      estimate = projectConfig.loadBalancer?.estimatedMonthlyCost;
      break;
  }
  
  if (!estimate) {
    return "Not estimated";
  }
  
  const envCost = estimate[envName as keyof CostEstimate];
  return envCost || "Not specified for this environment";
}
