/** @format */

/**
 * Centralised Tagging Configuration
 * 
 * This file defines standard tags applied to all resources across environments.
 * Tags are used for:
 * - Cost allocation and billing analysis
 * - Resource organization and filtering
 * - Compliance and audit requirements
 * - Operational management
 */

/**
 * Standard tag configuration for all resources
 */
export interface TagConfig {
  /** Deployment environment (development, staging, production) */
  Environment: string;
  /** Infrastructure management tool */
  ManagedBy: "CDK";
  /** Repository name */
  Repository: string;
  /** Project or service name */
  Project?: string;
  /** Cost center for billing allocation */
  CostCentre?: string;
  /** Team responsible for the resource */
  Owner?: string;
  /** Compliance requirements (e.g., "SOC2", "GDPR", "HIPAA") */
  Compliance?: string;
  /** Data classification level */
  DataClassification?: "public" | "internal" | "confidential" | "restricted";
  /** Application name for multi-app repositories */
  Application?: string;
  /** Backup policy identifier */
  BackupPolicy?: string;
}

/**
 * Cost center configuration per environment
 */
export const COST_CENTRES = {
  development: "DEV-001",
  staging: "STG-001",
  production: "PROD-001",
  pipeline: "PIPELINE-001",
} as const;

/**
 * Owner/team configuration per project
 */
export const PROJECT_OWNERS = {
  monitoring: "Platform Team",
  webapp: "Application Team",
  api: "Backend Team",
  database: "Data Team",
  analytics: "Analytics Team",
} as const;

/**
 * Compliance requirements per environment
 */
export const COMPLIANCE_REQUIREMENTS = {
  development: undefined, // No compliance requirements
  staging: "pre-compliance-testing",
  production: "SOC2,GDPR", // Comma-separated list
  pipeline: undefined,
} as const;

/**
 * Data classification per environment
 * 
 * - public: No sensitive data
 * - internal: Internal business data
 * - confidential: Sensitive business data
 * - restricted: Regulated/PII data
 */
export const DATA_CLASSIFICATION = {
  development: "internal" as const,
  staging: "internal" as const,
  production: "confidential" as const,
  pipeline: "internal" as const,
};

/**
 * Get default tags for an environment and project
 * 
 * Returns a complete TagConfig with all standard tags populated
 * based on environment and project configuration.
 * 
 * @param envName - Environment name (development, staging, production, pipeline)
 * @param projectName - Optional project name (monitoring, webapp, api, etc.)
 * @param customTags - Optional additional tags to merge
 * @returns Complete TagConfig with all applicable tags
 * 
 * @example
 * ```typescript
 * const tags = getDefaultTags('production', 'monitoring');
 * // Returns:
 * // {
 * //   Environment: 'production',
 * //   ManagedBy: 'CDK',
 * //   Repository: 'monitoring-iac',
 * //   Project: 'monitoring',
 * //   CostCentre: 'PROD-001',
 * //   Owner: 'Platform Team',
 * //   Compliance: 'SOC2,GDPR',
 * //   DataClassification: 'confidential'
 * // }
 * ```
 */
export function getDefaultTags(
  envName: string,
  projectName?: string,
  customTags?: Partial<TagConfig>
): TagConfig {
  const tags: TagConfig = {
    Environment: envName,
    ManagedBy: "CDK",
    Repository: "monitoring-iac",
  };

  // Add project name if provided
  if (projectName) {
    tags.Project = projectName;
    
    // Add project-specific owner
    const owner = PROJECT_OWNERS[projectName as keyof typeof PROJECT_OWNERS];
    if (owner) {
      tags.Owner = owner;
    }
  }

  // Add cost center based on environment
  const costCentre = COST_CENTRES[envName as keyof typeof COST_CENTRES];
  if (costCentre) {
    tags.CostCentre = costCentre;
  }

  // Add compliance requirements for staging/production
  const compliance = COMPLIANCE_REQUIREMENTS[envName as keyof typeof COMPLIANCE_REQUIREMENTS];
  if (compliance) {
    tags.Compliance = compliance;
  }

  // Add data classification
  const dataClassification = DATA_CLASSIFICATION[envName as keyof typeof DATA_CLASSIFICATION];
  if (dataClassification) {
    tags.DataClassification = dataClassification;
  }

  // Merge custom tags (allows overriding defaults)
  if (customTags) {
    Object.assign(tags, customTags);
  }

  return tags;
}

/**
 * Get tags for a specific resource type with additional context
 * 
 * Some resources may need additional tags beyond the defaults.
 * 
 * @param envName - Environment name
 * @param projectName - Project name
 * @param resourceType - Type of resource (e.g., "efs", "ecr", "dynamodb")
 * @param customTags - Optional additional tags
 * @returns TagConfig with resource-specific tags
 * 
 * @example
 * ```typescript
 * const efsTags = getResourceTags('production', 'monitoring', 'efs', {
 *   BackupPolicy: 'daily-7day-retention'
 * });
 * ```
 */
export function getResourceTags(
  envName: string,
  projectName: string,
  resourceType: string,
  customTags?: Partial<TagConfig>
): TagConfig {
  const baseTags = getDefaultTags(envName, projectName);

  // Add resource type for easier filtering
  const resourceTags = {
    ...baseTags,
    Application: resourceType,
  };

  // Add backup policy for storage resources
  if (["efs", "ebs", "dynamodb", "s3"].includes(resourceType.toLowerCase())) {
    if (envName === "production") {
      resourceTags.BackupPolicy = "daily-30day-retention";
    } else {
      resourceTags.BackupPolicy = "weekly-7day-retention";
    }
  }

  // Merge custom tags
  if (customTags) {
    Object.assign(resourceTags, customTags);
  }

  return resourceTags;
}

/**
 * Convert TagConfig to CDK Tags format
 * 
 * Filters out undefined values and returns a clean record
 * suitable for use with cdk.Tags.of().add()
 * 
 * @param tagConfig - TagConfig object
 * @returns Record of tag key-value pairs with undefined values removed
 * 
 * @example
 * ```typescript
 * const tags = getDefaultTags('production', 'monitoring');
 * const cdkTags = toTagsRecord(tags);
 * 
 * Object.entries(cdkTags).forEach(([key, value]) => {
 *   cdk.Tags.of(scope).add(key, value);
 * });
 * ```
 */
export function toTagsRecord(tagConfig: TagConfig): Record<string, string> {
  const tags: Record<string, string> = {};

  Object.entries(tagConfig).forEach(([key, value]) => {
    if (value !== undefined) {
      tags[key] = value;
    }
  });

  return tags;
}

/**
 * Validate tag configuration
 * 
 * Ensures all required tags are present and values are valid.
 * 
 * @param tags - TagConfig to validate
 * @returns Validation result with any errors
 * 
 * @example
 * ```typescript
 * const tags = getDefaultTags('production', 'monitoring');
 * const validation = validateTags(tags);
 * 
 * if (!validation.isValid) {
 *   console.error('Tag validation failed:', validation.errors);
 * }
 * ```
 */
export function validateTags(tags: TagConfig): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // Required tags
  if (!tags.Environment) {
    errors.push("Environment tag is required");
  }

  if (!tags.ManagedBy) {
    errors.push("ManagedBy tag is required");
  }

  if (!tags.Repository) {
    errors.push("Repository tag is required");
  }

  // Production-specific validations
  if (tags.Environment === "production") {
    if (!tags.CostCentre) {
      errors.push("CostCentre tag is required for production");
    }

    if (!tags.Owner) {
      errors.push("Owner tag is required for production");
    }

    if (!tags.DataClassification) {
      errors.push("DataClassification tag is required for production");
    }
  }

  // Validate data classification values
  if (tags.DataClassification) {
    const validClassifications = ["public", "internal", "confidential", "restricted"];
    if (!validClassifications.includes(tags.DataClassification)) {
      errors.push(
        `Invalid DataClassification: ${tags.DataClassification}. Must be one of: ${validClassifications.join(", ")}`
      );
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Get cost allocation tags for billing analysis
 * 
 * Returns only the tags relevant for AWS Cost Explorer and billing.
 * 
 * @param envName - Environment name
 * @param projectName - Project name
 * @returns Subset of tags used for cost allocation
 * 
 * @example
 * ```typescript
 * const costTags = getCostAllocationTags('production', 'monitoring');
 * // Returns: { Environment: 'production', Project: 'monitoring', CostCentre: 'PROD-001', Owner: 'Platform Team' }
 * ```
 */
export function getCostAllocationTags(
  envName: string,
  projectName?: string
): Record<string, string> {
  const allTags = getDefaultTags(envName, projectName);

  const costTags: Record<string, string> = {
    Environment: allTags.Environment,
    ManagedBy: allTags.ManagedBy,
  };

  if (allTags.Project) {
    costTags.Project = allTags.Project;
  }

  if (allTags.CostCentre) {
    costTags.CostCentre = allTags.CostCentre;
  }

  if (allTags.Owner) {
    costTags.Owner = allTags.Owner;
  }

  return costTags;
}
