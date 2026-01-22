#!/usr/bin/env ts-node
/** @format */

/**
 * AWS Pricing Update Script
 * 
 * This script fetches current AWS pricing from the AWS Pricing API and updates
 * the pricing constants in lib/shared/helpers/cost-helper.ts
 * 
 * Usage:
 *   npm run update-pricing [--region eu-west-1] [--dry-run]
 * 
 * Options:
 *   --region  AWS region to fetch pricing for (default: eu-west-1)
 *   --dry-run  Show pricing without updating files
 * 
 * Requirements:
 *   - AWS credentials configured
 *   - Pricing API access (available in us-east-1 and ap-south-1)
 * 
 * Note: The AWS Pricing API is only available in us-east-1 and ap-south-1,
 * but it provides pricing for all regions.
 */

import { PricingClient, GetProductsCommand } from "@aws-sdk/client-pricing";

// Parse command line arguments
const args = process.argv.slice(2);
const targetRegion = args.find(arg => arg.startsWith("--region="))?.split("=")[1] || "eu-west-1";
const dryRun = args.includes("--dry-run");

// Pricing API is only available in us-east-1 and ap-south-1
const pricingClient = new PricingClient({ region: "us-east-1" });

/**
 * Fetch EC2 instance pricing
 */
async function fetchInstancePricing(instanceType: string): Promise<number | null> {
  try {
    const command = new GetProductsCommand({
      ServiceCode: "AmazonEC2",
      Filters: [
        { Type: "TERM_MATCH", Field: "instanceType", Value: instanceType },
        { Type: "TERM_MATCH", Field: "location", Value: getLocationName(targetRegion) },
        { Type: "TERM_MATCH", Field: "operatingSystem", Value: "Linux" },
        { Type: "TERM_MATCH", Field: "tenancy", Value: "Shared" },
        { Type: "TERM_MATCH", Field: "preInstalledSw", Value: "NA" },
        { Type: "TERM_MATCH", Field: "capacitystatus", Value: "Used" },
      ],
      MaxResults: 1,
    });

    const response = await pricingClient.send(command);
    
    if (!response.PriceList || response.PriceList.length === 0) {
      console.warn(`No pricing found for ${instanceType}`);
      return null;
    }

    const priceData = JSON.parse(response.PriceList[0]);
    const onDemand = priceData.terms.OnDemand;
    const termKey = Object.keys(onDemand)[0];
    const priceDimensions = onDemand[termKey].priceDimensions;
    const dimensionKey = Object.keys(priceDimensions)[0];
    const pricePerHour = parseFloat(priceDimensions[dimensionKey].pricePerUnit.USD);
    
    // Convert to monthly (730 hours)
    return pricePerHour * 730;
  } catch (error) {
    console.error(`Error fetching pricing for ${instanceType}:`, error);
    return null;
  }
}

/**
 * Fetch EBS volume pricing
 */
async function fetchEbsPricing(volumeType: string): Promise<number | null> {
  try {
    const command = new GetProductsCommand({
      ServiceCode: "AmazonEC2",
      Filters: [
        { Type: "TERM_MATCH", Field: "productFamily", Value: "Storage" },
        { Type: "TERM_MATCH", Field: "volumeApiName", Value: volumeType },
        { Type: "TERM_MATCH", Field: "location", Value: getLocationName(targetRegion) },
      ],
      MaxResults: 1,
    });

    const response = await pricingClient.send(command);
    
    if (!response.PriceList || response.PriceList.length === 0) {
      console.warn(`No pricing found for ${volumeType}`);
      return null;
    }

    const priceData = JSON.parse(response.PriceList[0]);
    const onDemand = priceData.terms.OnDemand;
    const termKey = Object.keys(onDemand)[0];
    const priceDimensions = onDemand[termKey].priceDimensions;
    const dimensionKey = Object.keys(priceDimensions)[0];
    
    return parseFloat(priceDimensions[dimensionKey].pricePerUnit.USD);
  } catch (error) {
    console.error(`Error fetching pricing for ${volumeType}:`, error);
    return null;
  }
}

/**
 * Convert region code to AWS location name
 */
function getLocationName(region: string): string {
  const locationMap: Record<string, string> = {
    "eu-west-1": "EU (Ireland)",
    "eu-west-2": "EU (London)",
    "eu-west-3": "EU (Paris)",
    "eu-central-1": "EU (Frankfurt)",
    "eu-north-1": "EU (Stockholm)",
    "eu-south-1": "EU (Milan)",
    "us-east-1": "US East (N. Virginia)",
    "us-east-2": "US East (Ohio)",
    "us-west-1": "US West (N. California)",
    "us-west-2": "US West (Oregon)",
  };
  
  return locationMap[region] || region;
}

/**
 * Get currency symbol for region
 */
function getCurrencyForRegion(region: string): { currency: string; symbol: string } {
  if (region.startsWith("eu-")) {
    return { currency: "EUR", symbol: "€" };
  }
  return { currency: "USD", symbol: "$" };
}

/**
 * Main function
 */
async function main() {
  console.log("=".repeat(80));
  console.log("AWS Pricing Update Script");
  console.log("=".repeat(80));
  console.log(`Target Region: ${targetRegion}`);
  console.log(`Dry Run: ${dryRun ? "Yes" : "No"}`);
  console.log("");

  const { currency, symbol } = getCurrencyForRegion(targetRegion);

  // Instance types to fetch
  const instanceTypes = [
    "t3.nano", "t3.micro", "t3.small", "t3.medium", "t3.large", "t3.xlarge", "t3.2xlarge",
    "t4g.nano", "t4g.micro", "t4g.small", "t4g.medium", "t4g.large",
    "m5.large", "m5.xlarge",
    "c5.large", "c5.xlarge",
  ];

  // EBS volume types
  const ebsTypes = ["gp3", "gp2", "io1", "io2"];

  console.log("Fetching pricing data...\n");

  // Fetch instance pricing
  const instances: Record<string, number> = {};
  for (const instanceType of instanceTypes) {
    process.stdout.write(`  ${instanceType.padEnd(15)} ... `);
    const price = await fetchInstancePricing(instanceType);
    if (price !== null) {
      instances[instanceType] = price;
      console.log(`${symbol}${price.toFixed(2)}/month`);
    } else {
      console.log("FAILED");
    }
  }

  // Fetch EBS pricing
  const ebs: Record<string, number> = {};
  console.log("");
  for (const volumeType of ebsTypes) {
    process.stdout.write(`  ${volumeType.padEnd(15)} ... `);
    const price = await fetchEbsPricing(volumeType);
    if (price !== null) {
      ebs[volumeType] = price;
      console.log(`${symbol}${price.toFixed(3)}/GB/month`);
    } else {
      console.log("FAILED");
    }
  }

  console.log("\n" + "=".repeat(80));
  console.log("Pricing Summary");
  console.log("=".repeat(80));
  console.log(`Currency: ${currency} (${symbol})`);
  console.log(`Region: ${targetRegion}`);
  console.log(`Date: ${new Date().toISOString()}`);
  console.log("");
  console.log("Sample Instance Costs:");
  console.log(`  t3.small:  ${symbol}${instances["t3.small"]?.toFixed(2)}/month`);
  console.log(`  t3.medium: ${symbol}${instances["t3.medium"]?.toFixed(2)}/month`);
  console.log("");
  console.log("Sample EBS Costs:");
  console.log(`  gp3: ${symbol}${ebs["gp3"]?.toFixed(3)}/GB/month`);
  console.log("");

  if (dryRun) {
    console.log("DRY RUN - No files updated");
    console.log("\nTo update cost-helper.ts, run without --dry-run flag");
  } else {
    console.log("⚠️  Automatic file update not yet implemented");
    console.log("\nTo update pricing:");
    console.log("  1. Review the pricing data above");
    console.log("  2. Manually update lib/shared/helpers/cost-helper.ts");
    console.log("  3. Update the 'Last updated' comment with today's date");
    console.log("");
    console.log("Future enhancement: Automatic file update with preserving structure");
  }

  console.log("=".repeat(80));
}

main().catch(console.error);
