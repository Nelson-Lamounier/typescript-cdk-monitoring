# CDK Application Deployment Guide

This directory contains the CDK application entry point and deployment helpers for all infrastructure stacks, including foundation networking and monitoring infrastructure.

**Note**: This project uses **Yarn** (v4+) as the package manager, not npm. All dependency management commands should use `yarn` instead of `npm`.

## Table of Contents

- [Overview](#overview)
- [Directory Structure](#directory-structure)
- [Prerequisites](#prerequisites)
- [Environment Configuration](#environment-configuration)
- [Quick Start](#quick-start)
- [Deployment Guide](#deployment-guide)
- [Monitoring EFS Stack Deployment](#monitoring-efs-stack-deployment)
- [Stack Configuration](#stack-configuration)
- [Dynamic Stack Integration](#dynamic-stack-integration)
- [Manual Deployment Commands Reference](#manual-deployment-commands-reference)
- [Troubleshooting](#troubleshooting)
- [Next Steps](#next-steps)
- [Key Points Summary](#key-points-summary)
- [Additional Resources](#additional-resources)
- [Support](#support)

## Overview

The `bin/` directory is the entry point for deploying AWS CDK stacks. It orchestrates:

- **Foundation Infrastructure**: VPC, subnets, NAT gateways, VPC Flow Logs
- **Monitoring Infrastructure**: EFS storage for Prometheus and Grafana
- **Certificate Management**: ACM certificate resolution for HTTPS
- **Environment Configuration**: Multi-environment deployment support
- **CDK Nag Integration**: Security and best practices validation

### Stack Deployment Order

Stacks must be deployed in the following order due to dependencies:

```
1. NetworkingStack (Foundation)
   └── Provides: VPC, subnets, security groups
   └── Required by: All other stacks

2. MonitoringEfsStack (Storage Layer)
   └── Depends on: NetworkingStack (VPC)
   └── Provides: EFS file system, access points, SSM parameters
   └── Required by: MonitoringInfraStack (future)

3. MonitoringInfraStack (Infrastructure Layer - Future)
   └── Depends on: NetworkingStack, MonitoringEfsStack
   └── Provides: ECS cluster, load balancer

4. MonitoringServiceStack (Services Layer - Future)
   └── Depends on: MonitoringInfraStack
   └── Provides: Prometheus, Grafana services
```

### Application Flow (`app.ts`)

The `app.ts` file is the main CDK application entry point that orchestrates the entire deployment:

```
bin/app.ts Execution Flow:
  │
  ├── 1. Initialize CDK App
  │   └── Creates new cdk.App() instance
  │
  ├── 2. Load Environment Configuration
  │   ├── Reads ENVIRONMENT variable (default: "development")
  │   ├── Loads config from config/environments.ts
  │   └── Validates account ID is configured
  │
  ├── 3. Resolve Domain & Certificate (Optional)
  │   ├── resolveDomainConfig() - Gets domain from env vars or SSM
  │   └── resolveCertificate() - Resolves ACM certificate for HTTPS
  │
  ├── 4. Deploy Foundation Stacks
  │   └── deployFoundationStacks()
  │       └── Creates NetworkingStack with name: "${envName}-Networking"
  │           Example: "development-Networking", "production-Networking"
  │
  ├── 5. Deploy Monitoring Stacks (Optional - Manual)
  │   └── deployMonitoringStacks() - Not called in app.ts yet
  │       └── Creates MonitoringEfsStack with name: "${envName}-MonitoringEfs"
  │           Example: "development-MonitoringEfs", "pipeline-MonitoringEfs"
  │
  ├── 6. Apply CDK Nag Checks
  │   └── Adds AwsSolutionsChecks if ENABLE_CDK_NAG !== "false"
  │
  └── 7. Synthesize CloudFormation Templates
      └── app.synth() - Generates CloudFormation templates
```

**Note**: Currently, `app.ts` only deploys foundation stacks. Monitoring stacks must be deployed manually or integrated into `app.ts` (see [Dynamic Stack Integration](#dynamic-stack-integration) section).

### Stack Naming Convention

All stacks follow a consistent naming pattern: **`${envName}-${StackType}`**

| Stack Type | Pattern | Example Stack Names |
|------------|---------|---------------------|
| **NetworkingStack** | `${envName}-Networking` | `development-Networking`, `production-Networking` |
| **MonitoringEfsStack** | `${envName}-MonitoringEfs` | `development-MonitoringEfs`, `pipeline-MonitoringEfs` |
| **MonitoringInfraStack** (Future) | `${envName}-MonitoringInfra` | `development-MonitoringInfra` |
| **MonitoringServiceStack** (Future) | `${envName}-MonitoringService` | `development-MonitoringService` |

**Stack Name Sources**:
- **NetworkingStack**: Defined in `bin/stacks/foundation-stack.ts:19`
- **MonitoringEfsStack**: Defined in `bin/stacks/monitoring-stack.ts:28`
- **Future Stacks**: Follow the same pattern in their respective stack files

**Important**: The `ENVIRONMENT` variable must match one of the keys in `config/environments.ts` (`development`, `staging`, `production`, or `pipeline`).

### Integration with NetworkingStack

The `app.ts` integrates with the NetworkingStack through the `deployFoundationStacks()` function:

1. **Environment Configuration**: `app.ts` reads the environment from `ENVIRONMENT` variable and loads the corresponding config from `config/environments.ts`

2. **Stack Creation**: Calls `deployFoundationStacks(app, config, stackProps)` which:
   - Creates a new `NetworkingStack` instance
   - Passes environment-specific configuration (VPC CIDR, NAT gateways)
   - Returns the stack instance for potential cross-stack references

3. **Stack Props**: The stack receives:
   - `envName`: Environment identifier (e.g., "development")
   - `projectName`: "portfolio" (hardcoded)
   - `vpcCidr`: From environment config
   - `maxAzs`: 2 (fixed)
   - `natGateways`: From environment config (default: 0)
   - `enableVpcFlowLogs`: true (always enabled)
   - `enableVpcEndpoints`: true (S3, DynamoDB endpoints)

4. **CDK Nag Validation**: After stack creation, CDK Nag checks are applied to validate security best practices

## Directory Structure

```
bin/
├── app.ts                    # Main CDK application entry point
├── app-deprecated.ts         # Legacy app (not used)
├── stacks/
│   ├── foundation-stack.ts   # Foundation stack deployment (NetworkingStack)
│   └── monitoring-stack.ts   # Monitoring stack deployment (MonitoringEfsStack)
└── helpers/
    ├── certificate-helper.ts  # ACM certificate resolution
    └── vpc-peering-helper.ts # VPC peering (placeholder)
```

### Key Files

**`app.ts`** - Main entry point that:
- Initializes the CDK app
- Loads environment configuration from `config/environments.ts`
- Resolves certificates (if needed) via `helpers/certificate-helper.ts`
- Deploys foundation stacks via `stacks/foundation-stack.ts`
- Applies CDK Nag checks for security validation
- Synthesizes CloudFormation templates

**`stacks/foundation-stack.ts`** - Creates the NetworkingStack with:
- Stack name: `${envName}-Networking` (e.g., `development-Networking`)
- VPC with configurable CIDR from environment config
- Public and private subnets across 2 AZs
- NAT Gateways (configurable count from environment config)
- VPC Flow Logs (enabled by default)
- VPC Endpoints (S3, DynamoDB)
- Returns stack instance for cross-stack references

**`stacks/monitoring-stack.ts`** - Creates the MonitoringEfsStack with:
- Stack name: `${envName}-MonitoringEfs` (e.g., `development-MonitoringEfs`)
- EFS file system with encryption
- EFS access point with POSIX permissions
- Lambda function for EFS initialization
- SSM parameters for Prometheus and Grafana configuration
- Requires NetworkingStack (VPC dependency)
- Returns stack instance for future infrastructure stacks

**`helpers/certificate-helper.ts`** - Resolves ACM certificates:
- Priority: Environment variable → Create new → SSM lookup
- Supports wildcard certificates
- Stores certificate ARN in SSM Parameter Store
- Returns `CertificateConfig` with ARN and stack reference

## Application Integration (`app.ts`)

### How `app.ts` Works

The `app.ts` file serves as the orchestrator for all CDK stack deployments. Here's how it integrates with the NetworkingStack:

#### 1. Environment Resolution

```typescript
// Line 26: Read environment from ENVIRONMENT variable or default to "development"
const envName = process.env.ENVIRONMENT || "development";

// Line 27: Load environment-specific configuration
const config = environments[envName];
```

The environment configuration includes:
- AWS Account ID
- AWS Region
- VPC CIDR block
- NAT Gateway count
- Production flag

#### 2. Stack Properties Preparation

```typescript
// Lines 43-48: Prepare stack properties with account and region
const stackProps: cdk.StackProps = {
  env: {
    account: config.account,
    region: config.region,
  },
};
```

#### 3. Certificate Resolution (Optional)

```typescript
// Lines 53-62: Resolve domain and certificate configuration
const { rootDomainName, hostedZoneId } = resolveDomainConfig(app);
const certificateConfig = resolveCertificate(
  app,
  config.envName,
  stackProps,
  rootDomainName,
  hostedZoneId
);
```

**Note**: Certificates are resolved but not currently used. They will be used when HTTPS services (ALB listeners) are added.

#### 4. Foundation Stack Deployment

```typescript
// Lines 68-69: Deploy foundation stacks (NetworkingStack)
const { networkingStack } = deployFoundationStacks(app, config, stackProps);
```

This calls `bin/stacks/foundation-stack.ts` which:
- Creates a `NetworkingStack` instance
- Names it `${config.envName}-Networking`
- Passes environment-specific configuration
- Returns the stack for potential cross-stack references

#### 4b. Monitoring Stack Deployment (Manual)

**Note**: Monitoring stacks are not automatically deployed in `app.ts`. They must be deployed manually or integrated (see [Dynamic Stack Integration](#dynamic-stack-integration)).

The `deployMonitoringStacks()` function in `bin/stacks/monitoring-stack.ts`:
- Creates a `MonitoringEfsStack` instance
- Names it `${config.envName}-MonitoringEfs`
- Requires `networkingStack` as a dependency (for VPC)
- Configures EFS with encryption and lifecycle policies
- Sets up cross-account targets for Prometheus scraping
- Returns the stack for future infrastructure dependencies

#### 5. CDK Nag Integration

```typescript
// Lines 79-85: Apply security checks if enabled
if (process.env.ENABLE_CDK_NAG !== "false") {
  Aspects.of(app).add(
    new AwsSolutionsChecks({
      verbose: true,
      logIgnores: !config.isProduction,
    })
  );
}
```

CDK Nag validates:
- IAM policies for least privilege
- VPC Flow Logs enabled
- Encryption at rest
- Security group configurations
- And other AWS best practices

#### 6. Synthesis

```typescript
// Line 91: Generate CloudFormation templates
app.synth();
```

This generates CloudFormation templates in the `cdk.out/` directory.

### Stack Name Resolution

The NetworkingStack name is constructed as follows:

1. **Environment Name**: Read from `ENVIRONMENT` variable or defaults to `"development"`
2. **Stack Name Pattern**: `${envName}-Networking`
3. **Final Stack Name**: Examples:
   - `ENVIRONMENT=development` → Stack name: `development-Networking`
   - `ENVIRONMENT=staging` → Stack name: `staging-Networking`
   - `ENVIRONMENT=production` → Stack name: `production-Networking`

**Code Reference** (`bin/stacks/foundation-stack.ts:19`):
```typescript
const networkingStack = new NetworkingStack(
  app,
  `${config.envName}-Networking`,  // Stack ID/Name
  { /* props */ }
);
```

### Deployment Command Mapping

When you run CDK commands, the stack name must match the pattern:

```bash
# Development environment
export ENVIRONMENT=development
cdk deploy development-Networking

# Staging environment
export ENVIRONMENT=staging
cdk deploy staging-Networking

# Production environment
export ENVIRONMENT=production
cdk deploy production-Networking
```

**Important**: The `ENVIRONMENT` variable must match the stack name prefix. If `ENVIRONMENT=dev`, the stack name would be `dev-Networking`, but the environment config expects `development`, `staging`, `production`, or `pipeline`.

## Prerequisites

### Required Tools

```bash
# Node.js (v18+)
node --version

# Yarn (v4+ - project uses yarn, not npm)
yarn --version

# AWS CDK CLI (installed globally or via yarn)
yarn global add aws-cdk
# Or: npm install -g aws-cdk
cdk --version

# AWS CLI
aws --version

# Git
git --version
```

### AWS Account Setup

1. **Configure AWS Credentials**

```bash
# Option 1: Environment variables
export AWS_ACCESS_KEY_ID="your-access-key"
export AWS_SECRET_ACCESS_KEY="your-secret-key"
export AWS_REGION="eu-west-1"

# Option 2: AWS CLI profile
aws configure --profile dev

# Verify credentials
aws sts get-caller-identity
```

2. **Bootstrap CDK** (one-time per account/region)

```bash
export AWS_ACCOUNT_ID_DEV="$(aws sts get-caller-identity --query Account --output text)"
export AWS_REGION="eu-west-1"

cdk bootstrap aws://$AWS_ACCOUNT_ID_DEV/$AWS_REGION
```

### Project Dependencies

```bash
# Install dependencies (project uses yarn)
yarn install

# Build TypeScript
yarn build
```

## Environment Configuration

### Environment Variables

Create a `.env` file in the project root:

```bash
# AWS Account IDs
AWS_ACCOUNT_ID_DEV=123456789012
AWS_ACCOUNT_ID_STAGING=123456789012
AWS_ACCOUNT_ID_PROD=123456789012
AWS_PIPELINE_ACCOUNT_ID=123456789012

# AWS Region
AWS_REGION=eu-west-1

# Deployment Environment
ENVIRONMENT=development

# Optional: Certificate Configuration
CERTIFICATE_ARN=arn:aws:acm:eu-west-1:123456789012:certificate/...
ROOT_DOMAIN_NAME=example.com
HOSTED_ZONE_ID=Z1234567890ABC

# Optional: CDK Nag
ENABLE_CDK_NAG=true  # Set to "false" to disable CDK Nag checks
```

### Environment Configuration File

Environment-specific settings are defined in `config/environments.ts`:

| Environment | VPC CIDR | NAT Gateways | Purpose |
|-------------|----------|--------------|---------|
| `development` | `10.1.0.0/16` | `0` | Local development, cost-optimised |
| `staging` | `10.2.0.0/16` | `0` | Pre-production testing |
| `production` | `10.2.0.0/16` | `0` | Live environment |
| `pipeline` | `10.0.0.0/16` | `0` | CI/CD infrastructure |

**Note**: NAT Gateway count can be overridden via environment configuration. Set `natGateways: 1` or `2` for production environments requiring internet access from private subnets.

## Quick Start

### 1. Set Environment Variables

```bash
export ENVIRONMENT=development
export AWS_ACCOUNT_ID_DEV="$(aws sts get-caller-identity --query Account --output text)"
export AWS_REGION="eu-west-1"
```

### 2. Bootstrap CDK (if not already done)

```bash
cdk bootstrap aws://$AWS_ACCOUNT_ID_DEV/$AWS_REGION
```

### 3. Synthesise CloudFormation Template

```bash
cdk synth development-Networking
```

### 4. Deploy Networking Stack

```bash
cdk deploy development-Networking
```

### 5. Deploy Monitoring EFS Stack (After Networking)

```bash
# First, ensure NetworkingStack is deployed
cdk deploy development-Networking

# Then deploy MonitoringEfsStack
cdk deploy development-MonitoringEfs
```

## Deployment Guide

### Step-by-Step Deployment

#### 1. Verify Prerequisites

```bash
# Check Node.js version
node --version  # Should be v18+

# Check AWS credentials
aws sts get-caller-identity

# Check CDK version
cdk --version  # Should be 2.x+

# Verify project dependencies (project uses yarn)
yarn install
```

#### 2. Configure Environment

```bash
# Set environment variables
export ENVIRONMENT=development
export AWS_ACCOUNT_ID_DEV="$(aws sts get-caller-identity --query Account --output text)"
export AWS_REGION="eu-west-1"

# Or use .env file (loaded automatically via dotenv)
cat > .env << EOF
ENVIRONMENT=development
AWS_ACCOUNT_ID_DEV=$(aws sts get-caller-identity --query Account --output text)
AWS_REGION=eu-west-1
EOF
```

#### 3. Bootstrap CDK (First Time Only)

```bash
cdk bootstrap aws://$AWS_ACCOUNT_ID_DEV/$AWS_REGION

# Verify bootstrap
aws cloudformation describe-stacks \
  --stack-name CDKToolkit \
  --query 'Stacks[0].StackStatus'
```

#### 4. Preview Changes

```bash
# Synthesise CloudFormation template
cdk synth development-Networking

# Preview changes (diff)
cdk diff development-Networking
```

#### 5. Deploy Foundation Stack (Networking)

```bash
# Deploy with approval prompt
cdk deploy development-Networking

# Deploy without approval (for CI/CD)
cdk deploy development-Networking --require-approval never

# Deploy with verbose output
cdk deploy development-Networking --verbose
```

#### 5b. Deploy Monitoring EFS Stack

**Prerequisites**: NetworkingStack must be deployed first.

```bash
# Verify NetworkingStack is deployed
aws cloudformation describe-stacks \
  --stack-name development-Networking \
  --query 'Stacks[0].StackStatus'

# Deploy MonitoringEfsStack
cdk deploy development-MonitoringEfs

# Deploy with cross-account targets (via CDK context)
cdk deploy development-MonitoringEfs \
  --context crossAccountTargets='[{"envName":"staging","targetType":"node-exporter","port":9100,"accountId":"123456789012","roleArn":"arn:aws:iam::123456789012:role/prometheus-scraper"}]'

# Deploy without approval (for CI/CD)
cdk deploy development-MonitoringEfs --require-approval never
```

#### 6. Verify Deployment

**Verify NetworkingStack**:

```bash
# Check stack status
aws cloudformation describe-stacks \
  --stack-name development-Networking \
  --query 'Stacks[0].StackStatus'

# List stack outputs
aws cloudformation describe-stacks \
  --stack-name development-Networking \
  --query 'Stacks[0].Outputs[*].[OutputKey,OutputValue]' \
  --output table

# Verify SSM parameters
aws ssm get-parameters-by-path \
  --path "/networking/development" \
  --query 'Parameters[*].[Name,Value]' \
  --output table
```

**Verify MonitoringEfsStack**:

```bash
# Check stack status
aws cloudformation describe-stacks \
  --stack-name development-MonitoringEfs \
  --query 'Stacks[0].StackStatus'

# List stack outputs
aws cloudformation describe-stacks \
  --stack-name development-MonitoringEfs \
  --query 'Stacks[0].Outputs[*].[OutputKey,OutputValue]' \
  --output table

# Verify EFS resources
EFS_ID=$(aws cloudformation describe-stacks \
  --stack-name development-MonitoringEfs \
  --query 'Stacks[0].Outputs[?OutputKey==`FileSystemId`].OutputValue' \
  --output text)

aws efs describe-file-systems \
  --file-system-id $EFS_ID

# Verify SSM parameters for monitoring
aws ssm get-parameters-by-path \
  --path "/monitoring/development" \
  --query 'Parameters[*].[Name,Value]' \
  --output table

# Check Prometheus config
aws ssm get-parameter \
  --name "/monitoring/development/prometheus-config-yaml" \
  --query 'Parameter.Value' \
  --output text
```

### Deployment Options

#### Disable CDK Nag (Faster Deployment)

```bash
ENABLE_CDK_NAG=false cdk deploy development-Networking
```

#### Use Specific AWS Profile

```bash
cdk deploy development-Networking --profile dev
```

#### Deploy to Different Environment

```bash
export ENVIRONMENT=staging
export AWS_ACCOUNT_ID_STAGING="123456789012"

cdk deploy staging-Networking
```

#### Deploy with Role Assumption

```bash
cdk deploy development-Networking \
  --role-arn arn:aws:iam::123456789012:role/CDKDeployRole
```

## Stack Deployment

### Deploying All Stacks

To deploy all stacks in the correct order:

```bash
# 1. Set environment
export ENVIRONMENT=development
export AWS_ACCOUNT_ID_DEV="$(aws sts get-caller-identity --query Account --output text)"
export AWS_REGION="eu-west-1"

# 2. Deploy foundation (NetworkingStack)
cdk deploy development-Networking

# 3. Deploy monitoring storage (MonitoringEfsStack)
cdk deploy development-MonitoringEfs

# 4. Future: Deploy monitoring infrastructure
# cdk deploy development-MonitoringInfra

# 5. Future: Deploy monitoring services
# cdk deploy development-MonitoringService
```

### Deploying Individual Stacks

You can deploy stacks individually, but must respect dependencies:

```bash
# Foundation stack (no dependencies)
cdk deploy development-Networking

# Monitoring EFS stack (depends on NetworkingStack)
cdk deploy development-MonitoringEfs

# List all available stacks
cdk list
```

## Monitoring EFS Stack Deployment

### Overview

The `MonitoringEfsStack` provides persistent storage for Prometheus and Grafana monitoring services. It creates:

- **EFS File System**: Encrypted, persistent storage for monitoring data
- **EFS Access Point**: POSIX permissions for Prometheus/Grafana
- **Security Group**: Allows NFS access from VPC CIDR
- **Lambda Function**: One-time EFS initialization (creates directory structure)
- **SSM Parameters**: Prometheus and Grafana configuration files

### Prerequisites

**Required**: NetworkingStack must be deployed first.

```bash
# Verify NetworkingStack is deployed
aws cloudformation describe-stacks \
  --stack-name development-Networking \
  --query 'Stacks[0].StackStatus'

# Should return: "CREATE_COMPLETE" or "UPDATE_COMPLETE"
```

### Manual Deployment Steps

#### Step 1: Set Environment Variables

```bash
export ENVIRONMENT=development
export AWS_ACCOUNT_ID_DEV="$(aws sts get-caller-identity --query Account --output text)"
export AWS_REGION="eu-west-1"
```

#### Step 2: Prepare Cross-Account Targets (Optional)

If you need Prometheus to scrape metrics from other AWS accounts, prepare the cross-account targets configuration:

```bash
# Create cdk.json context (or pass via --context flag)
cat > cdk.json << 'EOF'
{
  "app": "npx ts-node --prefer-ts-exts bin/app.ts",
  "context": {
    "crossAccountTargets": [
      {
        "envName": "staging",
        "targetType": "node-exporter",
        "port": 9100,
        "accountId": "123456789012",
        "roleArn": "arn:aws:iam::123456789012:role/prometheus-scraper",
        "useEc2ServiceDiscovery": true
      }
    ]
  }
}
EOF
```

#### Step 3: Synthesise MonitoringEfsStack

```bash
cdk synth development-MonitoringEfs
```

#### Step 4: Preview Changes

```bash
cdk diff development-MonitoringEfs
```

#### Step 5: Deploy MonitoringEfsStack

```bash
# Basic deployment
cdk deploy development-MonitoringEfs

# With cross-account targets (if not in cdk.json)
cdk deploy development-MonitoringEfs \
  --context crossAccountTargets='[{"envName":"staging","targetType":"node-exporter","port":9100,"accountId":"123456789012","roleArn":"arn:aws:iam::123456789012:role/prometheus-scraper"}]'

# Without approval prompt (for CI/CD)
cdk deploy development-MonitoringEfs --require-approval never
```

#### Step 6: Verify Deployment

```bash
# Check stack status
aws cloudformation describe-stacks \
  --stack-name development-MonitoringEfs \
  --query 'Stacks[0].StackStatus'

# Get EFS file system ID
EFS_ID=$(aws cloudformation describe-stacks \
  --stack-name development-MonitoringEfs \
  --query 'Stacks[0].Outputs[?OutputKey==`FileSystemId`].OutputValue' \
  --output text)

echo "EFS ID: $EFS_ID"

# Verify EFS file system
aws efs describe-file-systems \
  --file-system-id $EFS_ID

# Check EFS access point
AP_ID=$(aws cloudformation describe-stacks \
  --stack-name development-MonitoringEfs \
  --query 'Stacks[0].Outputs[?OutputKey==`AccessPointId`].OutputValue' \
  --output text)

aws efs describe-access-points \
  --access-point-id $AP_ID

# Verify SSM parameters
aws ssm get-parameters-by-path \
  --path "/monitoring/development" \
  --query 'Parameters[*].[Name]' \
  --output table

# Check Prometheus config
aws ssm get-parameter \
  --name "/monitoring/development/prometheus-config-yaml" \
  --query 'Parameter.Value' \
  --output text | head -20
```

### MonitoringEfsStack Configuration Options

The stack can be configured via `bin/stacks/monitoring-stack.ts`:

```typescript
const efsStack = new MonitoringEfsStack(
  app,
  `${config.envName}-MonitoringEfs`,
  {
    envName: config.envName,
    projectName: "monitoring",
    vpc: networkingStack.vpc,
    crossAccountTargets: [],  // Or from CDK context
    enableEncryption: true,   // Always enabled
    lifecyclePolicy: config.isProduction
      ? efs.LifecyclePolicy.AFTER_30_DAYS
      : efs.LifecyclePolicy.AFTER_7_DAYS,
    removalPolicy: config.isProduction
      ? cdk.RemovalPolicy.RETAIN
      : cdk.RemovalPolicy.DESTROY,
  }
);
```

### Cross-Account Targets Configuration

Cross-account targets allow Prometheus to scrape metrics from EC2 instances in other AWS accounts:

**Via CDK Context** (Recommended):

```bash
# Inline JSON
cdk deploy development-MonitoringEfs \
  --context crossAccountTargets='[
    {
      "envName": "staging",
      "targetType": "node-exporter",
      "port": 9100,
      "accountId": "123456789012",
      "roleArn": "arn:aws:iam::123456789012:role/prometheus-scraper",
      "useEc2ServiceDiscovery": true
    }
  ]'
```

**Via cdk.json**:

```json
{
  "context": {
    "crossAccountTargets": [
      {
        "envName": "staging",
        "targetType": "node-exporter",
        "port": 9100,
        "accountId": "123456789012",
        "roleArn": "arn:aws:iam::123456789012:role/prometheus-scraper",
        "useEc2ServiceDiscovery": true
      }
    ]
  }
}
```

**Target Configuration Fields**:

| Field | Required | Description |
|-------|----------|-------------|
| `envName` | Yes | Environment name for the target |
| `targetType` | Yes | Type of target (e.g., "node-exporter") |
| `port` | Yes | Port number for metrics endpoint |
| `accountId` | No | AWS account ID (required for EC2 service discovery) |
| `roleArn` | No | IAM role ARN for cross-account access (required for EC2 service discovery) |
| `privateIp` | No | Static private IP address (fallback if service discovery not used) |
| `useEc2ServiceDiscovery` | No | Use EC2 service discovery (default: true) |
| `metricsPath` | No | Custom metrics path (default: "/metrics") |

### EFS Initialization

The stack includes a Lambda function that initializes the EFS file system:

- Creates directory structure: `/monitoring/prometheus-data`, `/monitoring/grafana-data`, etc.
- Sets POSIX permissions
- Runs as a CloudFormation Custom Resource
- Takes approximately 2-5 minutes to complete

**Monitor Initialization**:

```bash
# Check Lambda function logs
aws logs tail /aws/lambda/development-monitoring-efs-init --follow

# Check CloudFormation custom resource status
aws cloudformation describe-stack-resources \
  --stack-name development-MonitoringEfs \
  --logical-resource-id EfsInitialization \
  --query 'StackResources[0].ResourceStatus'
```

### Troubleshooting MonitoringEfsStack

**Issue: "Stack dependency error"**

```
Error: Stack development-MonitoringEfs depends on development-Networking
```

**Solution**:
```bash
# Deploy NetworkingStack first
cdk deploy development-Networking

# Then deploy MonitoringEfsStack
cdk deploy development-MonitoringEfs
```

**Issue: "EFS initialization timeout"**

**Solution**: The Lambda timeout is configurable. Check the initialization Lambda logs:
```bash
aws logs tail /aws/lambda/development-monitoring-efs-init --follow
```

**Issue: "Cross-account targets not working"**

**Solution**: Verify IAM role exists and has correct permissions:
```bash
# Check role exists
aws iam get-role --role-name prometheus-scraper

# Verify trust policy allows cross-account assumption
aws iam get-role --role-name prometheus-scraper \
  --query 'Role.AssumeRolePolicyDocument'
```

## Stack Configuration

### NetworkingStack Configuration

The NetworkingStack is configured in `bin/stacks/foundation-stack.ts`:

```typescript
const networkingStack = new NetworkingStack(
  app,
  `${config.envName}-Networking`,
  {
    envName: config.envName,
    projectName: "portfolio",
    vpcCidr: config.vpcCidr,        // From environments.ts
    maxAzs: 2,                       // Fixed: 2 availability zones
    natGateways: config.natGateways ?? 0,  // From environments.ts
    enableVpcFlowLogs: true,        // Always enabled
    enableVpcEndpoints: true,        // S3 and DynamoDB endpoints
  }
);
```

### Customising Configuration

To modify the NetworkingStack configuration:

1. **Edit `bin/stacks/foundation-stack.ts`**:

```typescript
const networkingStack = new NetworkingStack(
  app,
  `${config.envName}-Networking`,
  {
    ...stackProps,
    envName: config.envName,
    projectName: "portfolio",
    vpcCidr: config.vpcCidr,
    maxAzs: 3,                    // Change to 3 AZs
    natGateways: 2,               // Override: 2 NAT gateways
    enableVpcFlowLogs: true,
    enableVpcEndpoints: true,
    // Add custom tags
    customTags: {
      CostCenter: "Engineering",
      Team: "Platform",
    },
  }
);
```

2. **Or modify `config/environments.ts`**:

```typescript
development: {
  // ...
  natGateways: 1,  // Override default
  // ...
}
```

### MonitoringEfsStack Configuration

The MonitoringEfsStack is configured in `bin/stacks/monitoring-stack.ts`:

```typescript
const efsStack = new MonitoringEfsStack(
  app,
  `${config.envName}-MonitoringEfs`,
  {
    envName: config.envName,
    projectName: "monitoring",
    vpc: networkingStack.vpc,              // From NetworkingStack
    crossAccountTargets,                   // From CDK context or empty array
    enableEncryption: true,                // Always enabled
    lifecyclePolicy: config.isProduction
      ? efs.LifecyclePolicy.AFTER_30_DAYS  // Production: 30 days
      : efs.LifecyclePolicy.AFTER_7_DAYS,  // Non-prod: 7 days
    removalPolicy: config.isProduction
      ? cdk.RemovalPolicy.RETAIN          // Production: retain data
      : cdk.RemovalPolicy.DESTROY,        // Non-prod: allow deletion
  }
);
```

**Key Configuration Points**:
- **VPC Dependency**: Requires `networkingStack.vpc` from NetworkingStack
- **Cross-Account Targets**: Can be provided via CDK context (see below)
- **Encryption**: Always enabled for security
- **Lifecycle Policy**: Automatically set based on `config.isProduction`
- **Removal Policy**: Production retains data, non-prod allows deletion

**Cross-Account Targets Configuration**:

Cross-account targets can be provided via CDK context for Prometheus scraping:

```bash
# Via CDK context (JSON format)
cdk deploy development-MonitoringEfs \
  --context crossAccountTargets='[
    {
      "envName": "staging",
      "targetType": "node-exporter",
      "port": 9100,
      "accountId": "123456789012",
      "roleArn": "arn:aws:iam::123456789012:role/prometheus-scraper",
      "useEc2ServiceDiscovery": true
    }
  ]'

# Or via cdk.json
# {
#   "context": {
#     "crossAccountTargets": [
#       {
#         "envName": "staging",
#         "targetType": "node-exporter",
#         "port": 9100,
#         "accountId": "123456789012",
#         "roleArn": "arn:aws:iam::123456789012:role/prometheus-scraper"
#       }
#     ]
#   }
# }
```

### Certificate Configuration

Certificates are resolved automatically via `helpers/certificate-helper.ts`:

**Priority Order:**
1. `CERTIFICATE_ARN` environment variable (from CI/CD)
2. Create new certificate (if `ROOT_DOMAIN_NAME` and `HOSTED_ZONE_ID` provided)
3. SSM Parameter lookup (`/portfolio/domain/acm-arn`)

**To Skip Certificate Resolution:**

```bash
export SKIP_DOMAIN_LOOKUP=true
cdk deploy development-Networking
```

## Troubleshooting

### Common Issues

**Issue: "Account not bootstrapped"**

```
Error: This stack uses assets, but the environment ... doesn't have CDK bootstrap
```

**Solution:**
```bash
cdk bootstrap aws://$AWS_ACCOUNT_ID_DEV/$AWS_REGION
```

**Issue: "Unknown environment"**

```
Error: Unknown environment: dev. Valid options: development, staging, production, pipeline
```

**Solution:**
```bash
# Use correct environment name
export ENVIRONMENT=development  # Not "dev"
```

**Issue: "Account ID not configured"**

```
Error: Account ID not configured for development. Set AWS_PIPELINE_ACCOUNT_ID environment variable.
```

**Solution:**
```bash
# Set the correct account ID variable
export AWS_ACCOUNT_ID_DEV="123456789012"
# Or use .env file
```

**Issue: "VPC CIDR conflicts with existing VPC"**

```
Error: The CIDR '10.1.0.0/16' conflicts with another subnet
```

**Solution:**
```bash
# List existing VPCs
aws ec2 describe-vpcs --query 'Vpcs[*].[VpcId,CidrBlock]' --output table

# Update config/environments.ts with non-overlapping CIDR
vpcCidr: "10.99.0.0/16"
```

**Issue: "TypeScript compilation errors"**

```
Error: Unable to compile TypeScript
```

**Solution:**
```bash
# Clean and rebuild
rm -rf node_modules dist .yarn/cache
yarn install
yarn build

# Check for lint errors
yarn lint
```

**Issue: "CDK Nag errors"**

```
Error: AwsSolutions-IAM5: The IAM entity contains wildcard permissions
```

**Solution:**
```bash
# Temporarily disable CDK Nag for testing
ENABLE_CDK_NAG=false cdk deploy development-Networking

# Or review and add suppressions in lib/cdk-nag/suppression-manager.ts
```

### Debug Commands

```bash
# Enable CDK debug output
export CDK_DEBUG=true
cdk deploy development-Networking

# View CloudFormation events
aws cloudformation describe-stack-events \
  --stack-name development-Networking \
  --query 'StackEvents[*].[Timestamp,LogicalResourceId,ResourceStatus]' \
  --output table \
  --max-items 20

# Check for failed resources
aws cloudformation describe-stack-events \
  --stack-name development-Networking \
  --query 'StackEvents[?ResourceStatus==`CREATE_FAILED`].[LogicalResourceId,ResourceStatusReason]' \
  --output table

# Validate CloudFormation template
aws cloudformation validate-template \
  --template-body file://cdk.out/development-Networking.template.json
```

## Dynamic Stack Integration

### Adding New Stacks to `app.ts`

To integrate new stacks into the automatic deployment flow, follow this pattern:

#### Step 1: Create Stack Deployment Function

Create a new file in `bin/stacks/` (e.g., `compute-stack.ts`):

```typescript
import * as cdk from "aws-cdk-lib";
import { ComputeStack } from "../../lib/stacks/compute/compute-stack";
import { NetworkingStack } from "../../lib/stacks/foundation/networking-stack";
import { EnvironmentConfig } from "../../config/environments";

export function deployComputeStacks(
  app: cdk.App,
  config: EnvironmentConfig,
  stackProps: cdk.StackProps,
  networkingStack: NetworkingStack
) {
  const computeStack = new ComputeStack(
    app,
    `${config.envName}-Compute`,
    {
      ...stackProps,
      envName: config.envName,
      vpc: networkingStack.vpc,
      // ... other props
    }
  );

  computeStack.addDependency(networkingStack);

  return {
    computeStack,
  };
}
```

#### Step 2: Integrate into `app.ts`

Add the stack deployment after foundation stacks:

```typescript
// In bin/app.ts

// After foundation stacks
const { networkingStack } = deployFoundationStacks(app, config, stackProps);

// Add new stack deployment
const { computeStack } = deployComputeStacks(
  app,
  config,
  stackProps,
  networkingStack
);
void computeStack; // Mark as used for future dependencies
```

#### Step 3: Update Stack Naming Documentation

Add the new stack to the [Stack Naming Convention](#stack-naming-convention) table in this README.

### Stack Deployment Pattern

All stack deployment functions follow this pattern:

```typescript
export function deploy{StackType}Stacks(
  app: cdk.App,                    // CDK app instance
  config: EnvironmentConfig,      // Environment configuration
  stackProps: cdk.StackProps,      // Base stack properties
  ...dependencies                   // Required stack dependencies
) {
  const stack = new {StackType}Stack(
    app,
    `${config.envName}-{StackType}`,  // Consistent naming
    {
      ...stackProps,
      envName: config.envName,
      // ... stack-specific props
    }
  );

  // Add dependencies
  stack.addDependency(dependencyStack);

  return {
    stack,  // Return for future dependencies
  };
}
```

### Integrating Monitoring Stacks into `app.ts`

To automatically deploy monitoring stacks alongside foundation stacks, update `bin/app.ts`:

```typescript
// In bin/app.ts, after foundation stacks

import { deployMonitoringStacks } from "./stacks/monitoring-stack";

// ... existing code ...

// ============================================================================
// 1. FOUNDATION: NETWORKING
// ============================================================================
const { networkingStack } = deployFoundationStacks(app, config, stackProps);

// ============================================================================
// 2. MONITORING: EFS STORAGE
// ============================================================================
// Deploy monitoring stacks if enabled
if (process.env.DEPLOY_MONITORING !== "false") {
  const { efsStack } = deployMonitoringStacks(
    app,
    config,
    stackProps,
    networkingStack,
    certificateConfig.certificateArn
  );
  void efsStack; // Will be used for future infrastructure stacks
}

// ... rest of app.ts ...
```

**Environment Variable Control**:

```bash
# Deploy with monitoring stacks
export DEPLOY_MONITORING=true
cdk deploy --all

# Skip monitoring stacks
export DEPLOY_MONITORING=false
cdk deploy development-Networking
```

### Future Stack Examples

**MonitoringInfraStack** (Infrastructure Layer):
- Depends on: `NetworkingStack`, `MonitoringEfsStack`
- Provides: ECS cluster, Auto Scaling Group, Load Balancer
- Stack name: `${envName}-MonitoringInfra`
- Integration: Add to `deployMonitoringStacks()` function

**MonitoringServiceStack** (Services Layer):
- Depends on: `MonitoringInfraStack`
- Provides: Prometheus service, Grafana service
- Stack name: `${envName}-MonitoringService`
- Integration: Add to `deployMonitoringStacks()` function

**ComputeStack** (Application Layer):
- Depends on: `NetworkingStack`
- Provides: ECS services, task definitions
- Stack name: `${envName}-Compute`
- Integration: Create `bin/stacks/compute-stack.ts` and add to `app.ts`

## Next Steps

After successfully deploying the NetworkingStack:

### 1. Deploy Monitoring EFS Stack

The MonitoringEfsStack provides persistent storage for monitoring services:

```bash
# Ensure NetworkingStack is deployed first
cdk deploy development-Networking

# Deploy MonitoringEfsStack
cdk deploy development-MonitoringEfs

# Verify EFS is ready
aws efs describe-file-systems \
  --query 'FileSystems[?Tags[?Key==`Environment` && Value==`development`]]'
```

### 2. Deploy Future Dependent Stacks

As new stacks are added, deploy them in dependency order:

```bash
# Example deployment sequence
cdk deploy development-Networking          # Foundation
cdk deploy development-MonitoringEfs      # Storage
# cdk deploy development-MonitoringInfra  # Infrastructure (future)
# cdk deploy development-MonitoringService # Services (future)
```

### 2. Set Up VPC Peering (Optional)

For cross-account monitoring, configure VPC peering:

```bash
# TODO: Implement VPC peering helper
# See bin/helpers/vpc-peering-helper.ts
```

### 3. Configure Monitoring

The VPC Flow Logs are automatically enabled. Monitor them:

```bash
# View flow logs
aws logs tail /aws/vpc/flowlogs/development --follow
```

### 4. Review Stack Outputs

```bash
# Get VPC ID
aws cloudformation describe-stacks \
  --stack-name development-Networking \
  --query 'Stacks[0].Outputs[?OutputKey==`VpcId`].OutputValue' \
  --output text

# Get SSM parameter
aws ssm get-parameter \
  --name "/networking/development/vpc-id" \
  --query 'Parameter.Value' \
  --output text
```

### 5. Cost Optimisation

Review and adjust NAT Gateway configuration:

```bash
# Development: 0 NAT gateways (no internet from private subnets)
# Staging/Production: 1-2 NAT gateways (based on HA requirements)

# Update config/environments.ts
natGateways: 1  # Single NAT gateway for cost-optimised HA
```

## Key Points Summary

### Stack Naming

- **Stack Name Pattern**: `${envName}-{StackType}`
- **Current Stack Examples**:
  - `development-Networking` (when `ENVIRONMENT=development`)
  - `development-MonitoringEfs` (when `ENVIRONMENT=development`)
  - `pipeline-MonitoringEfs` (when `ENVIRONMENT=pipeline`)
- **Stack Name Sources**:
  - NetworkingStack: `bin/stacks/foundation-stack.ts:19`
  - MonitoringEfsStack: `bin/stacks/monitoring-stack.ts:28`
- **Important**: The `ENVIRONMENT` variable must match one of the keys in `config/environments.ts` (`development`, `staging`, `production`, or `pipeline`)

### Stack Dependencies

- **NetworkingStack**: No dependencies (foundation)
- **MonitoringEfsStack**: Depends on `NetworkingStack` (requires VPC)
- **Future Stacks**: Will follow the same dependency pattern

### Package Manager

- **This project uses Yarn (v4+), not npm**
- Use `yarn install` instead of `npm install`
- Use `yarn build` instead of `npm run build`
- Use `yarn lint` instead of `npm run lint`
- CDK CLI can be installed globally with either `yarn global add aws-cdk` or `npm install -g aws-cdk`

### Application Flow

1. `app.ts` reads `ENVIRONMENT` variable (defaults to `"development"`)
2. Loads configuration from `config/environments.ts`
3. Calls `deployFoundationStacks()` which creates `NetworkingStack`
4. Stack is named `${envName}-Networking`
5. Monitoring stacks are **not** automatically deployed (must be deployed manually)
6. CDK Nag validation is applied (unless disabled)
7. CloudFormation templates are synthesized

**To integrate monitoring stacks automatically**, see [Dynamic Stack Integration](#dynamic-stack-integration) section.

### Deployment Commands

**Foundation Stack (Networking)**:

```bash
# Always set ENVIRONMENT first
export ENVIRONMENT=development

# Deploy NetworkingStack
cdk deploy development-Networking

# List all stacks to verify naming
cdk list
```

**Monitoring EFS Stack**:

```bash
# Ensure NetworkingStack is deployed first
cdk deploy development-Networking

# Deploy MonitoringEfsStack
cdk deploy development-MonitoringEfs

# With cross-account targets (optional)
cdk deploy development-MonitoringEfs \
  --context crossAccountTargets='[{"envName":"staging","targetType":"node-exporter","port":9100,"accountId":"123456789012","roleArn":"arn:aws:iam::123456789012:role/prometheus-scraper"}]'
```

**Deploy All Stacks in Order**:

```bash
# Set environment
export ENVIRONMENT=development

# Deploy in dependency order
cdk deploy development-Networking
cdk deploy development-MonitoringEfs

# Or deploy all at once (CDK handles dependencies)
cdk deploy --all
```

## Manual Deployment Commands Reference

### NetworkingStack

```bash
# Synthesise
cdk synth development-Networking

# Preview changes
cdk diff development-Networking

# Deploy
cdk deploy development-Networking

# Destroy (use with caution)
cdk destroy development-Networking
```

### MonitoringEfsStack

```bash
# Prerequisite: NetworkingStack must be deployed
cdk deploy development-Networking

# Synthesise
cdk synth development-MonitoringEfs

# Preview changes
cdk diff development-MonitoringEfs

# Deploy
cdk deploy development-MonitoringEfs

# Deploy with cross-account targets
cdk deploy development-MonitoringEfs \
  --context crossAccountTargets='[{"envName":"staging","targetType":"node-exporter","port":9100,"accountId":"123456789012","roleArn":"arn:aws:iam::123456789012:role/prometheus-scraper"}]'

# Destroy (use with caution - data will be lost if removalPolicy is DESTROY)
cdk destroy development-MonitoringEfs
```

### Deploy All Stacks

```bash
# Deploy all stacks in dependency order
cdk deploy --all

# Or deploy specific stacks
cdk deploy development-Networking development-MonitoringEfs
```

### List Available Stacks

```bash
# List all stacks
cdk list

# Expected output:
# development-Networking
# development-MonitoringEfs
```

## Additional Resources

- [NetworkingStack Deployment Guide](../lib/stacks/foundation/DEPLOYMENT.md) - Detailed architecture and deployment guide
- [NetworkingStack README](../lib/stacks/README.md) - Stack documentation
- [MonitoringEfsStack](../lib/stacks/monitoring/monitoring-efs-stack.ts) - EFS stack implementation
- [AWS CDK Documentation](https://docs.aws.amazon.com/cdk/)
- [VPC Flow Logs Documentation](https://docs.aws.amazon.com/vpc/latest/userguide/flow-logs.html)
- [EFS Documentation](https://docs.aws.amazon.com/efs/latest/ug/whatisefs.html)
- [Yarn Documentation](https://yarnpkg.com/getting-started)

## Support

For issues or questions:

1. Check CloudFormation events in AWS Console
2. Review CloudWatch Logs for VPC Flow Logs
3. Verify environment configuration in `config/environments.ts`
4. Check CDK Nag suppressions in `lib/cdk-nag/suppression-manager.ts`
5. Verify stack name matches `${ENVIRONMENT}-Networking` pattern
6. Ensure yarn is used for all package management commands
