/** @format */

import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { getDefaultTags, getResourceTags, toTagsRecord } from "../../../config/tagging";

/**
 * Apply standard tags to a stack using centralised configuration
 *
 * Adds consistent tagging across all resources in the stack:
 * - Environment: The deployment environment (development, staging, production)
 * - ManagedBy: CDK
 * - Repository: monitoring-iac
 * - Project: Optional project name
 * - CostCentre: Cost center for billing
 * - Owner: Team responsible for the resource
 * - Compliance: Compliance requirements (production only)
 * - DataClassification: Data sensitivity level
 * - Custom tags: Any additional tags provided
 *
 * @param scope - The construct scope (typically `this` in a stack)
 * @param envName - Environment name for tagging
 * @param projectName - Optional project name
 * @param customTags - Optional additional tags (overrides defaults)
 *
 * @example
 * ```typescript
 * export class MyStack extends cdk.Stack {
 *   constructor(scope: Construct, id: string, props: MyStackProps) {
 *     super(scope, id, props);
 *
 *     applyStackTags(this, props.envName, props.projectName, {
 *       Application: 'api-gateway'
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
  // Get tags from centralised configuration
  const tags = getDefaultTags(envName, projectName, customTags);
  const tagsRecord = toTagsRecord(tags);

  // Apply all tags to the scope
  Object.entries(tagsRecord).forEach(([key, value]) => {
    cdk.Tags.of(scope).add(key, value);
  });
}

/**
 * Apply tags to a specific resource with resource-type context
 * 
 * Use this for resources that need additional context beyond stack-level tags.
 * Automatically adds backup policies for storage resources.
 *
 * @param scope - The construct scope
 * @param envName - Environment name
 * @param projectName - Project name
 * @param resourceType - Type of resource (e.g., "efs", "ecr", "dynamodb")
 * @param customTags - Optional additional tags
 *
 * @example
 * ```typescript
 * const fileSystem = new efs.FileSystem(this, 'EFS', { ... });
 * 
 * applyResourceTags(fileSystem, envName, 'monitoring', 'efs', {
 *   BackupPolicy: 'custom-daily-backup'
 * });
 * ```
 */
export function applyResourceTags(
  scope: Construct,
  envName: string,
  projectName: string,
  resourceType: string,
  customTags?: Record<string, string>
): void {
  const tags = getResourceTags(envName, projectName, resourceType, customTags);
  const tagsRecord = toTagsRecord(tags);

  Object.entries(tagsRecord).forEach(([key, value]) => {
    cdk.Tags.of(scope).add(key, value);
  });
}

/**
 * Apply cost allocation tags for billing analysis
 *
 * @param scope - The construct scope
 * @param costCenter - Cost center identifier
 * @param team - Team name for cost attribution
 * 
 * @deprecated Use applyStackTags() instead, which includes cost allocation tags from centralised config
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
 * 
 * @deprecated Use applyStackTags() instead, which includes compliance tags from centralised config
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
