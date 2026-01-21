/** @format */

// Single source of truth for environment configuration
// Environment variables keep account IDs out of source control
//
// DEPLOYMENT STRATEGY:
// All services deploy sequentially: development → staging → production
// - Development: First deployment target for all services
// - Staging: Pre-production testing environment (mirrors production config)
// - Production: Live environment (requires approval)
// - Pipeline: CI/CD infrastructure only (not a deployment target)

export interface EnvironmentConfig {
  account?: string; // AWS Account ID for deployment target (optional - will auto-detect from credentials)
  region?: string; // AWS Region for resources (optional - will auto-detect from credentials)
  envName: string; // Used for resource naming and tagging
  pipelineAccount?: string; // CI/CD account for cross-account access
  enableMonitoring?: boolean; // Enable CloudWatch monitoring and alarms
  enableEventBridge?: boolean; // Enable cross-account EventBridge monitoring
  alertEmail?: string; // Email address for CloudWatch alarms
  isMonitoringAccount?: boolean; // True if this account hosts centralized monitoring
  monitoredAccounts?: string[]; // List of account IDs to monitor (for monitoring account)
  vpcCidr: string; // ADD THIS
  natGateways?: number; // ADD THIS
  isProduction: boolean; // ADD THIS
}

// Record type provides type-safe access with autocomplete
// Empty string or undefined allows CDK to auto-detect from AWS credentials
export const environments: Record<string, EnvironmentConfig> = {
  // Frequent deployments, lower cost, can be destroyed/recreated
  development: {
    account: process.env.AWS_ACCOUNT_ID_DEV, // Auto-detect if not set
    region: process.env.AWS_REGION || "eu-west-1",
    vpcCidr: "10.1.0.0/16", // ADD
    natGateways: 0, // ADD
    isProduction: false, // ADD
    envName: "development",
    pipelineAccount: process.env.AWS_PIPELINE_ACCOUNT_ID,
    enableMonitoring: false, // Using centralised monitoring in pipeline account
    enableEventBridge: true, // Allows pipeline account to collect metrics
    isMonitoringAccount: false, // ADD
  },

  // SECOND DEPLOYMENT TARGET: All services deploy here after development
  // Pre-production testing, mirrors production config
  staging: {
    account: process.env.AWS_ACCOUNT_ID_STAGING, // Auto-detect if not set
    region: process.env.AWS_REGION || "eu-west-1",
    vpcCidr: "10.2.0.0/16",
    // SECURITY: Set to 1 if using private subnets for compute resources
    // Cost: ~£30/month per NAT Gateway
    natGateways: 0,
    isProduction: false,
    envName: "staging",
    pipelineAccount: process.env.AWS_PIPELINE_ACCOUNT_ID,
    enableMonitoring: false, // Using centralised monitoring in pipeline account
    enableEventBridge: true, // Allows pipeline account to collect metrics
    alertEmail: process.env.ALERT_EMAIL,
  },

  // Live environment, requires approval, highest security
  production: {
    account: process.env.AWS_ACCOUNT_ID_PROD, // Auto-detect if not set
    region: process.env.AWS_REGION || "eu-west-1",
    vpcCidr: "10.3.0.0/16", // Unique CIDR to avoid conflicts
    // SECURITY RECOMMENDATION: Set to 1 minimum for private subnet usage
    // For high availability across AZs, set to 2
    // Cost: ~£30/month per NAT Gateway
    natGateways: 1, // Enables private subnet usage for EC2 instances
    isProduction: true,
    envName: "production",
    pipelineAccount: process.env.AWS_PIPELINE_ACCOUNT_ID,
    enableMonitoring: false, // Using centralised monitoring in pipeline account
    enableEventBridge: true, // Cross-account monitoring
    alertEmail: process.env.ALERT_EMAIL,
  },

  // CI/CD INFRASTRUCTURE ONLY: Not a deployment target
  // Pipeline account - hosts centralised monitoring for all environments
  // Note: Services are NOT deployed to this account, only CI/CD infrastructure
  pipeline: {
    account: process.env.AWS_PIPELINE_ACCOUNT_ID, // Auto-detect if not set
    region: process.env.AWS_REGION || "eu-west-1",
    vpcCidr: "10.0.0.0/16", // ADD
    natGateways: 0, // ADD
    isProduction: false, // ADD
    envName: "pipeline",
    enableMonitoring: true, // Centralised monitoring enabled
    enableEventBridge: true, // Receives events from all accounts
    alertEmail: process.env.ALERT_EMAIL,
    isMonitoringAccount: true, // This is the centralized monitoring account
    monitoredAccounts: [
      process.env.AWS_ACCOUNT_ID_DEV,
      process.env.AWS_ACCOUNT_ID_STAGING,
      process.env.AWS_ACCOUNT_ID_PROD,
    ].filter((id): id is string => typeof id === "string" && id.length > 0), // Type-safe filter
  },
};
