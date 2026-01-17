/** @format */

/**
 * Security Validation Utilities
 *
 * Common security validation functions used across security test files
 */

import { stringifyResource } from "./template-helpers";
import {
  getManagedPolicyArns,
  getAssumeRoleStatements,
  getSubnetTags,
} from "./resource-extractors";
import type {
  ValidNetworkMode,
  ValidDeletionPolicy,
  ValidComplianceSeverity,
  ValidLogDriver,
  ValidationResult,
  PreparedContainerData,
  PreparedTargetGroupData,
  PreparedSecretData,
  ContainerDefinition,
} from "./types";

// =============================================================================
// Constants (defined here to avoid import issues)
// =============================================================================

export const VALID_NETWORK_MODES: readonly ValidNetworkMode[] = [
  "awsvpc",
  "bridge",
  "host",
  "none",
];

export const VALID_DELETION_POLICIES: readonly ValidDeletionPolicy[] = [
  "Retain",
  "Delete",
  "Snapshot",
];

export const VALID_COMPLIANCE_SEVERITIES: readonly ValidComplianceSeverity[] = [
  "CRITICAL",
  "HIGH",
  "MEDIUM",
  "LOW",
  "UNSPECIFIED",
];

export const VALID_LOG_DRIVERS: readonly ValidLogDriver[] = [
  "awslogs",
  "fluentd",
  "gelf",
  "journald",
  "json-file",
  "splunk",
  "syslog",
];

// =============================================================================
// Secrets Detection
// =============================================================================

/**
 * Check if resource contains hardcoded secrets patterns
 */
export const hasHardcodedSecrets = (resource: unknown): boolean => {
  const resourceStr = stringifyResource(resource);

  // Check for obvious hardcoded secrets patterns
  const patterns = [
    /password\s*["']\s*:\s*["'][^'"]+["']/i,
    /secret\s*["']\s*:\s*["'][^'"]+["']/i,
    /AKIA[0-9A-Z]{16}/, // AWS Access Key pattern
    /(?:^|[^a-zA-Z0-9])sk_live_[a-zA-Z0-9]{24}/, // Stripe live key
    /(?:^|[^a-zA-Z0-9])sk_test_[a-zA-Z0-9]{24}/, // Stripe test key
  ];

  return patterns.some((pattern) => pattern.test(resourceStr));
};

/**
 * Check if resource uses Secrets Manager
 */
export const usesSecretsManager = (resource: unknown): boolean => {
  const resourceStr = stringifyResource(resource);
  return (
    resourceStr.includes("Secrets") ||
    resourceStr.includes("ValueFrom") ||
    resourceStr.includes("secretsmanager")
  );
};

/**
 * Check if resource references SSM Parameter Store
 */
export const usesParameterStore = (resource: unknown): boolean => {
  const resourceStr = stringifyResource(resource);
  return (
    resourceStr.includes("ssm:") ||
    resourceStr.includes("AWS::SSM::Parameter")
  );
};

// =============================================================================
// IMDS (Instance Metadata Service) Validation
// =============================================================================

/**
 * Check if commands access IMDS (Instance Metadata Service)
 */
export const hasImdsAccess = (commands: string): boolean => {
  return commands.includes("169.254.169.254");
};

/**
 * Check if commands use IMDSv2 (token-based auth)
 */
export const usesImdsv2 = (commands: string): boolean => {
  return (
    /X-aws-ec2-metadata-token/i.test(commands) &&
    /PUT.*api\/token/i.test(commands)
  );
};

/**
 * Check if commands have IMDSv2 token auth
 */
export const hasImdsv2Token = (commands: string): boolean => {
  return commands.includes("X-aws-ec2-metadata-token");
};

// =============================================================================
// User Data Security Validation
// =============================================================================

/**
 * Check if user data contains hardcoded credentials
 */
export const hasHardcodedCredentials = (userData: string): boolean => {
  return (
    /password\s*=\s*['"][^'"]+['"]/i.test(userData) ||
    /secret\s*=\s*['"][^'"]+['"]/i.test(userData) ||
    /AKIA[0-9A-Z]{16}/.test(userData)
  );
};

/**
 * Check if user data contains sensitive API keys
 */
export const hasSensitiveApiKeys = (userData: string): boolean => {
  return (
    /api_key\s*=\s*['"][^'"]+['"]/i.test(userData) ||
    /apikey\s*=\s*['"][^'"]+['"]/i.test(userData) ||
    /api-key\s*=\s*['"][^'"]+['"]/i.test(userData)
  );
};

// =============================================================================
// Security Group Rule Validation
// =============================================================================

/**
 * Check if rule is for specific port
 */
export const isPortRule = (
  rule: Record<string, unknown>,
  port: number
): boolean => {
  return rule.FromPort === port && rule.ToPort === port;
};

/**
 * Check if rule allows unrestricted access
 */
export const isUnrestrictedAccess = (
  rule: Record<string, unknown>
): boolean => {
  return rule.CidrIp === "0.0.0.0/0" || rule.CidrIpv6 === "::/0";
};

/**
 * Check if rule allows all protocols
 */
export const isAllProtocols = (rule: Record<string, unknown>): boolean => {
  return rule.IpProtocol === "-1";
};

// =============================================================================
// Subnet Validation
// =============================================================================

/**
 * Check if subnet is private
 */
export const isPrivateSubnet = (subnet: unknown): boolean => {
  const tags = getSubnetTags(subnet);
  return tags.some(
    (tag) => tag.Key === "aws-cdk:subnet-type" && tag.Value === "Private"
  );
};

// =============================================================================
// EFS Validation
// =============================================================================

/**
 * Check if rule is for NFS port (2049)
 */
export const isNfsPortRule = (rule: Record<string, unknown>): boolean => {
  return rule.FromPort === 2049 && rule.ToPort === 2049;
};

/**
 * Check if lifecycle policies have IA transition
 */
export const hasIATransition = (
  lifecyclePolicies: Array<Record<string, string>>
): boolean => {
  return lifecyclePolicies.some(
    (policy) => policy.TransitionToIA !== undefined
  );
};

// =============================================================================
// Environment Context
// =============================================================================

/**
 * Check if resource string contains environment context
 */
export const hasEnvironmentContext = (resourceStr: string): boolean => {
  const environmentPatterns = [
    "development",
    "production",
    "staging",
    "-dev-",
    "-prod-",
    "-stg-",
    "dev-",
    "prod-",
  ];
  return environmentPatterns.some((pattern) =>
    resourceStr.toLowerCase().includes(pattern)
  );
};

/**
 * Check if resource has environment context
 */
export const resourceHasEnvironmentContext = (resource: unknown): boolean => {
  const resourceStr = stringifyResource(resource);
  return hasEnvironmentContext(resourceStr);
};

// =============================================================================
// Validation Helpers
// =============================================================================

/**
 * Validate that a resource has all required properties
 */
export const validateResourceProperties = (
  resource: unknown,
  requiredProps: string[]
): ValidationResult => {
  const properties = (resource as Record<string, Record<string, unknown>>)
    .Properties;

  const missing = requiredProps.filter((prop) => properties[prop] === undefined);

  return {
    valid: missing.length === 0,
    missing,
  };
};

/**
 * Check if value is within acceptable range
 */
export const isInRange = (
  value: number,
  min: number,
  max: number
): boolean => {
  return value >= min && value <= max;
};

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Check if network mode is valid
 */
export const isValidNetworkMode = (mode: string): mode is ValidNetworkMode => {
  return VALID_NETWORK_MODES.includes(mode as ValidNetworkMode);
};

/**
 * Check if deletion policy is valid
 */
export const isValidDeletionPolicy = (
  policy: string
): policy is ValidDeletionPolicy => {
  return VALID_DELETION_POLICIES.includes(policy as ValidDeletionPolicy);
};

/**
 * Check if compliance severity is valid
 */
export const isValidComplianceSeverity = (
  severity: string
): severity is ValidComplianceSeverity => {
  return VALID_COMPLIANCE_SEVERITIES.includes(severity as ValidComplianceSeverity);
};

/**
 * Check if log driver is valid
 */
export const isValidLogDriver = (
  driver: string
): driver is ValidLogDriver => {
  return VALID_LOG_DRIVERS.includes(driver as ValidLogDriver);
};

// =============================================================================
// Pre-computation Helpers for Test Data Preparation
// =============================================================================

/**
 * Prepare container data with pre-computed security flags
 * Use this in beforeAll to avoid conditionals in tests
 */
export const prepareContainerData = (
  container: ContainerDefinition
): PreparedContainerData => {
  const user = container.User;
  const userStr = user !== undefined ? String(user) : undefined;

  return {
    container,
    hasMemoryLimits:
      container.Memory !== undefined ||
      container.MemoryReservation !== undefined,
    isPrivileged: container.Privileged === true,
    runsAsRoot:
      userStr !== undefined && (userStr === "0" || userStr === "root"),
    hasUser: user !== undefined,
    hasLogConfiguration: container.LogConfiguration !== undefined,
  };
};

/**
 * Prepare target group data with pre-computed health check flags
 */
export const prepareTargetGroupData = (
  targetGroup: unknown
): PreparedTargetGroupData => {
  const properties = (targetGroup as Record<string, Record<string, unknown>>)
    .Properties;

  return {
    targetGroup,
    hasHealthCheckPath: properties.HealthCheckPath !== undefined,
    hasHealthCheckProtocol: properties.HealthCheckProtocol !== undefined,
    hasHealthCheck:
      properties.HealthCheckPath !== undefined ||
      properties.HealthCheckProtocol !== undefined,
    healthyThreshold: properties.HealthyThresholdCount as number | undefined,
    unhealthyThreshold: properties.UnhealthyThresholdCount as number | undefined,
  };
};

/**
 * Prepare secret data with pre-computed flags
 */
export const prepareSecretData = (secret: unknown): PreparedSecretData => {
  const properties = (secret as Record<string, Record<string, unknown>>)
    .Properties;

  return {
    secret,
    hasGenerateSecretString: properties.GenerateSecretString !== undefined,
    hasSecretString: properties.SecretString !== undefined,
    hasSecretConfiguration:
      properties.GenerateSecretString !== undefined ||
      properties.SecretString !== undefined,
  };
};

// =============================================================================
// IAM Validation Helpers
// =============================================================================

/**
 * Extract actions from statement (normalize to array)
 */
export const getActions = (statement: Record<string, unknown>): unknown[] => {
  const action = statement.Action;
  return Array.isArray(action) ? action : action ? [action] : [];
};

/**
 * Check if statement has specific action
 */
export const hasAction = (
  statement: Record<string, unknown>,
  actionPattern: string
): boolean => {
  const actions = getActions(statement);
  return actions.some((action) => String(action).includes(actionPattern));
};

/**
 * Check if statement has wildcard action
 */
export const hasWildcardAction = (statement: Record<string, unknown>): boolean => {
  const actions = getActions(statement);
  return actions.some((action) => String(action) === "*");
};

/**
 * Check if action is read-only
 */
export const isReadOnlyAction = (action: string): boolean => {
  return (
    action.startsWith("Describe") ||
    action.startsWith("Get") ||
    action.startsWith("List")
  );
};

/**
 * Check if managed policy ARNs contain policy name
 */
export const hasManagedPolicy = (role: unknown, policyName: string): boolean => {
  const managedPolicies = getManagedPolicyArns(role);
  return managedPolicies.some((policy) => {
    return JSON.stringify(policy).includes(policyName);
  });
};

/**
 * Check if role trusts specific service
 */
export const hasServiceTrust = (role: unknown, service: string): boolean => {
  const statements = getAssumeRoleStatements(role);
  return statements.some((statement) => {
    const principal = statement.Principal as
      | Record<string, string>
      | undefined;
    return principal?.Service === service;
  });
};

/**
 * Check if role is for Lambda (by name)
 */
export const isLambdaRole = (role: unknown): boolean => {
  const roleJson = stringifyResource(role);
  return roleJson.toLowerCase().includes("lambda");
};