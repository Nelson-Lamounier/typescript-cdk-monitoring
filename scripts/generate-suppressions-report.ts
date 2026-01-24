#!/usr/bin/env ts-node
/** @format */

/**
 * CDK Nag Suppressions Audit Report Generator
 * 
 * This script generates a comprehensive markdown report of all CDK Nag
 * suppressions defined in the SuppressionManager for security audit purposes.
 * 
 * Usage:
 *   ts-node scripts/generate-suppressions-report.ts
 * 
 * Output:
 *   docs/CDK-NAG-SUPPRESSIONS-AUDIT.md
 */

import * as fs from "fs";
import * as path from "path";

// Import the SuppressionManager to extract suppressions
import { SuppressionManager } from "../lib/cdk-nag";
import type { StackType } from "../lib/cdk-nag";

interface SuppressionInfo {
  id: string;
  reason: string;
  appliesTo?: string[];
  category: string;
}

/**
 * Extract suppressions from a suppression method
 */
function extractSuppressionsFromMethod(
  methodName: string,
  categoryName: string
): SuppressionInfo[] {
  try {
    // Get the method from SuppressionManager
    const method = (SuppressionManager as any)[methodName];
    if (typeof method !== "function") {
      return [];
    }

    // Call the method to get suppressions
    // Some methods require envName parameter
    const suppressions = methodName.includes("CloudWatchLogs")
      ? method.call(SuppressionManager, "development")
      : method.call(SuppressionManager);

    // Transform suppressions to include category
    return suppressions.map((s: any) => ({
      ...s,
      category: categoryName,
    }));
  } catch (error) {
    console.error(`Error extracting suppressions from ${methodName}:`, error);
    return [];
  }
}

/**
 * Generate markdown report content
 */
function generateMarkdownReport(): string {
  const timestamp = new Date().toISOString().split("T")[0];

  let markdown = `<!-- @format -->

# CDK Nag Suppressions Audit Report

**Generated:** ${timestamp}  
**Purpose:** Security compliance audit and documentation

This report contains all CDK Nag suppressions defined in the SuppressionManager,
organised by category. Each suppression includes:
- AWS Solutions rule ID being suppressed
- Detailed justification
- Scope of application (if specified)

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [CDK-Managed Resources](#cdk-managed-resources)
3. [ECS Environment Variables](#ecs-environment-variables)
4. [Public Access](#public-access)
5. [ECR Permissions](#ecr-permissions)
6. [S3 Asset Permissions](#s3-asset-permissions)
7. [Monitoring Config Bucket](#monitoring-config-bucket)
8. [CloudWatch Logs](#cloudwatch-logs)
9. [ECS Service](#ecs-service)
10. [Auto Scaling](#auto-scaling)
11. [Monitoring](#monitoring)
12. [EFS Custom Resource](#efs-custom-resource)
13. [Load Balancer](#load-balancer)
14. [Networking](#networking)
15. [DynamoDB Permissions](#dynamodb-permissions)
16. [S3 Bucket Permissions](#s3-bucket-permissions)
17. [Lambda Function](#lambda-function)
18. [API Gateway](#api-gateway)

---

## Executive Summary

`;

  // Define suppression categories
  const categories = [
    {
      name: "CDK-Managed Resources",
      method: "getCdkManagedResourceSuppressions",
      description:
        "Suppressions for resources automatically created by CDK that we don't directly control.",
    },
    {
      name: "ECS Environment Variables",
      method: "getEcsEnvironmentVariableSuppressions",
      description:
        "Suppressions for non-sensitive environment variables in ECS task definitions.",
    },
    {
      name: "Public Access",
      method: "getPublicAccessSuppressions",
      description:
        "Suppressions for resources that need to be accessible from the internet.",
    },
    {
      name: "ECR Permissions",
      method: "getEcrPermissionSuppressions",
      description:
        "Suppressions for ECS tasks that need to pull container images from ECR.",
    },
    {
      name: "S3 Asset Permissions",
      method: "getS3AssetPermissions",
      description:
        "Suppressions for EC2 instances that need to download CDK assets from S3.",
    },
    {
      name: "Monitoring Config Bucket",
      method: "getMonitoringConfigBucketPermissions",
      description:
        "Suppressions for EC2 instances accessing monitoring configuration files.",
    },
    {
      name: "CloudWatch Logs",
      method: "getCloudWatchLogsSuppressions",
      description: "Suppressions for services that need to write logs.",
    },
    {
      name: "ECS Service",
      method: "getEcsServiceSuppressions",
      description: "Suppressions for ECS services and task roles.",
    },
    {
      name: "Auto Scaling",
      method: "getAutoScalingSuppressions",
      description:
        "Suppressions for Auto Scaling Groups and lifecycle hooks.",
    },
    {
      name: "Monitoring",
      method: "getMonitoringSuppressions",
      description:
        "Suppressions for Prometheus, Grafana, and CloudWatch monitoring.",
    },
    {
      name: "EFS Custom Resource",
      method: "getEfsCustomResourceSuppressions",
      description:
        "Suppressions for Lambda functions that initialize EFS file systems.",
    },
    {
      name: "Load Balancer",
      method: "getLoadBalancerSuppressions",
      description:
        "Suppressions for ALB access logging and configuration.",
    },
    {
      name: "Networking",
      method: "getNetworkingSuppressions",
      description: "Suppressions for VPC and networking configuration.",
    },
    {
      name: "DynamoDB Permissions",
      method: "getDynamoDbPermissionSuppressions",
      description:
        "Suppressions for Lambda functions accessing DynamoDB tables.",
    },
    {
      name: "S3 Bucket Permissions",
      method: "getS3BucketPermissionSuppressions",
      description: "Suppressions for S3 bucket operations.",
    },
    {
      name: "Lambda Function",
      method: "getLambdaFunctionSuppressions",
      description: "Suppressions for Lambda function permissions.",
    },
    {
      name: "API Gateway",
      method: "getApiGatewaySuppressions",
      description: "Suppressions for API Gateway configuration.",
    },
  ];

  // Collect all suppressions
  const allSuppressions: SuppressionInfo[] = [];
  const categoryStats: Record<string, number> = {};

  categories.forEach((category) => {
    const suppressions = extractSuppressionsFromMethod(
      category.method,
      category.name
    );
    allSuppressions.push(...suppressions);
    categoryStats[category.name] = suppressions.length;
  });

  // Generate executive summary
  markdown += `### Statistics

- **Total Suppression Categories:** ${categories.length}
- **Total Suppressions:** ${allSuppressions.length}
- **Most Common Rule:** ${getMostCommonRule(allSuppressions)}

### Suppression Breakdown by Category

| Category | Count |
|----------|-------|
`;

  categories.forEach((category) => {
    markdown += `| ${category.name} | ${categoryStats[category.name] || 0} |\n`;
  });

  markdown += "\n---\n\n";

  // Generate detailed sections for each category
  categories.forEach((category) => {
    const suppressions = extractSuppressionsFromMethod(
      category.method,
      category.name
    );

    markdown += `## ${category.name}\n\n`;
    markdown += `**Purpose:** ${category.description}\n\n`;
    markdown += `**Total Suppressions:** ${suppressions.length}\n\n`;

    if (suppressions.length === 0) {
      markdown += "*No suppressions defined for this category.*\n\n";
      markdown += "---\n\n";
      return;
    }

    suppressions.forEach((suppression, index) => {
      markdown += `### ${index + 1}. ${suppression.id}\n\n`;
      markdown += `**Justification:**  \n${suppression.reason}\n\n`;

      if (suppression.appliesTo && suppression.appliesTo.length > 0) {
        markdown += `**Applies To:**\n`;
        suppression.appliesTo.forEach((pattern) => {
          if (typeof pattern === "string") {
            markdown += `- \`${pattern}\`\n`;
          } else {
            markdown += `- Pattern: \`${JSON.stringify(pattern)}\`\n`;
          }
        });
        markdown += "\n";
      }
    });

    markdown += "---\n\n";
  });

  // Add stack mapping section
  markdown += generateStackMappingSection();

  // Add footer
  markdown += `
---

## Maintenance

### When to Update This Report

- After adding new suppressions to SuppressionManager
- During security audits (quarterly recommended)
- Before major CDK version upgrades
- When AWS service limitations are resolved

### How to Regenerate

\`\`\`bash
ts-node scripts/generate-suppressions-report.ts
\`\`\`

### Review Guidelines

1. **Verify Justifications:** Ensure each suppression has a clear, technical reason
2. **Check Scope:** Confirm \`appliesTo\` patterns are as specific as possible
3. **Validate Currency:** Remove suppressions for resolved AWS limitations
4. **Environment Alignment:** Ensure dev suppressions don't leak to production

---

**End of Report**
`;

  return markdown;
}

/**
 * Find the most common suppression rule
 */
function getMostCommonRule(suppressions: SuppressionInfo[]): string {
  const counts: Record<string, number> = {};

  suppressions.forEach((s) => {
    counts[s.id] = (counts[s.id] || 0) + 1;
  });

  let maxCount = 0;
  let mostCommon = "N/A";

  Object.entries(counts).forEach(([id, count]) => {
    if (count > maxCount) {
      maxCount = count;
      mostCommon = `${id} (${count} times)`;
    }
  });

  return mostCommon;
}

/**
 * Generate stack mapping section
 */
function generateStackMappingSection(): string {
  const stackTypes: StackType[] = [
    "ComputeStack",
    "MonitoringStack",
    "MonitoringInfraStack",
    "MonitoringEfsStack",
    "MonitoringServiceStack",
    "NetworkingStack",
    "LoadBalancerStack",
    "CertificateStack",
    "WebappEcrStack",
    "WebappDynamoDbStack",
    "WebappApiStack",
  ];

  let markdown = `## Stack Type Suppression Mapping\n\n`;
  markdown += `This section shows which suppression categories are applied to each stack type.\n\n`;
  markdown += `| Stack Type | Applied Suppression Categories |\n`;
  markdown += `|------------|--------------------------------|\n`;

  // Manual mapping based on applyToStack logic
  const stackMappings: Record<string, string[]> = {
    ComputeStack: [
      "CDK-Managed Resources",
      "ECS Environment Variables",
      "ECS Service",
      "Auto Scaling",
      "CloudWatch Logs",
    ],
    MonitoringStack: [
      "CDK-Managed Resources",
      "Monitoring",
      "ECS Environment Variables",
      "Auto Scaling",
      "Public Access",
      "Load Balancer",
      "S3 Asset Permissions",
      "Monitoring Config Bucket",
      "CloudWatch Logs",
    ],
    MonitoringInfraStack: [
      "CDK-Managed Resources",
      "Monitoring",
      "ECS Environment Variables",
      "Auto Scaling",
      "Public Access",
      "Load Balancer",
      "S3 Asset Permissions",
      "Monitoring Config Bucket",
      "CloudWatch Logs",
    ],
    MonitoringEfsStack: [
      "CDK-Managed Resources",
      "Monitoring",
      "EFS Custom Resource",
    ],
    MonitoringServiceStack: [
      "CDK-Managed Resources",
      "Monitoring",
      "ECS Environment Variables",
      "ECS Service",
      "CloudWatch Logs",
    ],
    NetworkingStack: ["CDK-Managed Resources", "Networking"],
    LoadBalancerStack: [
      "CDK-Managed Resources",
      "Public Access",
      "Load Balancer",
    ],
    CertificateStack: ["CDK-Managed Resources"],
    WebappEcrStack: ["CDK-Managed Resources", "ECR Permissions"],
    WebappDynamoDbStack: ["CDK-Managed Resources"],
    WebappApiStack: [
      "CDK-Managed Resources",
      "API Gateway",
      "Lambda Function",
      "DynamoDB Permissions",
      "S3 Bucket Permissions",
      "CloudWatch Logs",
    ],
  };

  stackTypes.forEach((stackType) => {
    const categories = stackMappings[stackType] || ["CDK-Managed Resources"];
    markdown += `| ${stackType} | ${categories.join(", ")} |\n`;
  });

  markdown += "\n---\n\n";
  return markdown;
}

/**
 * Main execution
 */
async function main() {
  console.log("Generating CDK Nag Suppressions Audit Report...\n");

  // Generate the report
  const reportContent = generateMarkdownReport();

  // Ensure docs directory exists
  const docsDir = path.join(__dirname, "../docs");
  if (!fs.existsSync(docsDir)) {
    fs.mkdirSync(docsDir, { recursive: true });
  }

  // Write the report
  const outputPath = path.join(docsDir, "CDK-NAG-SUPPRESSIONS-AUDIT.md");
  fs.writeFileSync(outputPath, reportContent, "utf-8");

  console.log(`✅ Report generated successfully!`);
  console.log(`📄 Location: ${outputPath}`);
  console.log(`📊 File size: ${(reportContent.length / 1024).toFixed(2)} KB\n`);
  console.log("Review the report for security audit and compliance purposes.");
}

// Run the script
main().catch((error) => {
  console.error("Error generating report:", error);
  process.exit(1);
});
