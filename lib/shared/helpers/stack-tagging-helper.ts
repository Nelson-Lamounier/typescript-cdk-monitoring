/** @format */

import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";

/**
 * Apply standard tags to a stack
 *
 * Adds consistent tagging across all resources in the stack:
 * - Environment: The deployment environment (development, staging, production)
 * - ManagedBy: CDK
 * - Project: Optional project name
 * - Custom tags: Any additional tags provided
 *
 * @param scope - The construct scope (typically `this` in a stack)
 * @param envName - Environment name for tagging
 * @param projectName - Optional project name
 * @param customTags - Optional additional tags
 *
 * @example
 * ```typescript
 * export class MyStack extends cdk.Stack {
 *   constructor(scope: Construct, id: string, props: MyStackProps) {
 *     super(scope, id, props);
 *
 *     applyStackTags(this, props.envName, props.projectName, {
 *       CostCenter: 'Engineering'
 *     });
 *   }
 * }
 * ```
 */
export function applyStackTags(
  scope: Construct,
  envName: string,
  projectName?: string,
  customTags?: Record<string, string>
): void {
  // Standard tags applied to all resources
  cdk.Tags.of(scope).add("Environment", envName);
  cdk.Tags.of(scope).add("ManagedBy", "CDK");

  if (projectName) {
    cdk.Tags.of(scope).add("Project", projectName);
  }

  // Apply custom tags
  if (customTags) {
    Object.entries(customTags).forEach(([key, value]) => {
      cdk.Tags.of(scope).add(key, value);
    });
  }
}

/**
 * Apply cost allocation tags for billing analysis
 *
 * @param scope - The construct scope
 * @param costCenter - Cost center identifier
 * @param team - Team name for cost attribution
 */
export function applyCostAllocationTags(
  scope: Construct,
  costCenter: string,
  team?: string
): void {
  cdk.Tags.of(scope).add("CostCenter", costCenter);

  if (team) {
    cdk.Tags.of(scope).add("Team", team);
  }
}

/**
 * Apply compliance tags for audit and governance
 *
 * @param scope - The construct scope
 * @param dataClassification - Data sensitivity level
 * @param complianceFramework - Applicable compliance framework(s)
 */
export function applyComplianceTags(
  scope: Construct,
  dataClassification: "public" | "internal" | "confidential" | "restricted",
  complianceFramework?: string
): void {
  cdk.Tags.of(scope).add("DataClassification", dataClassification);

  if (complianceFramework) {
    cdk.Tags.of(scope).add("ComplianceFramework", complianceFramework);
  }
}
