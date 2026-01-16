/** @format */

// infrastructure/scripts/deployment/utils/types.ts

export interface DeploymentConfig {
  stackName: string;
  environment: string;
  projectName: string;
  awsAccountId: string;
  awsRegion: string;
  devVpcId?: string;
  devAccountId?: string;
  additionalArgs?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface BootstrapInfo {
  exists: boolean;
  version?: number;
  needsUpgrade: boolean;
}

export interface DeploymentResult {
  success: boolean;
  stackOutputs?: Record<string, string>;
  error?: string;
}

export enum DeploymentStatus {
  SUCCESS = "success",
  FAILURE = "failure",
  RETRY = "retry",
}

export interface EnvironmentCheckResult {
  component: string;
  available: boolean;
  version?: string;
  message?: string;
}

export interface EnvironmentVerification {
  passed: boolean;
  checks: EnvironmentCheckResult[];
  errors: string[];
  warnings: string[];
}

export interface BuildArtifactInfo {
  exists: boolean;
  fileCount: number;
  paths: string[];
}
