<!-- @format -->

# NetworkingStack Deployment Guide

This guide covers deploying the NetworkingStack for local development and testing, including AWS account bootstrapping, environment configuration, and troubleshooting.

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Why This Architecture](#why-this-architecture)
- [Prerequisites](#prerequisites)
- [Account Bootstrapping](#account-bootstrapping)
- [Environment Configuration](#environment-configuration)
- [Local Deployment](#local-deployment)
- [Verification](#verification)
- [Troubleshooting](#troubleshooting)
- [Cleanup](#cleanup)

## Architecture Overview

The NetworkingStack creates foundational VPC infrastructure that all other stacks depend on:

```
                         ┌─────────────────────────────────────────────────────────────┐
                         │                         VPC (10.x.0.0/16)                   │
                         │                                                             │
┌────────────────────────┼─────────────────────────────────────────────────────────────┼──────────────────────────┐
│                        │                                                             │                          │
│   Availability Zone A  │                    Availability Zone B                      │   (Optional) Zone C      │
│                        │                                                             │                          │
│  ┌──────────────────┐  │  ┌──────────────────┐        ┌──────────────────┐          │  ┌──────────────────┐    │
│  │  Public Subnet   │  │  │  Public Subnet   │        │  Private Subnet  │          │  │  Private Subnet  │    │
│  │   10.x.0.0/20    │  │  │   10.x.16.0/20   │        │   10.x.128.0/20  │          │  │   10.x.144.0/20  │    │
│  │                  │  │  │                  │        │                  │          │  │                  │    │
│  │  - ALB           │  │  │  - ALB           │        │  - ECS Tasks     │          │  │  - ECS Tasks     │    │
│  │  - NAT Gateway   │  │  │  - NAT Gateway   │        │  - RDS           │          │  │  - RDS           │    │
│  │  - Bastion       │  │  │                  │        │  - ElastiCache   │          │  │                  │    │
│  └────────┬─────────┘  │  └────────┬─────────┘        └────────┬─────────┘          │  └────────┬─────────┘    │
│           │            │           │                           │                    │           │              │
│           └────────────┼───────────┴───────────────────────────┘                    │           │              │
│                        │                       │                                    │           │              │
└────────────────────────┼───────────────────────┼────────────────────────────────────┼───────────┼──────────────┘
                         │                       │                                    │           │
                    ┌────┴────┐            ┌─────┴─────┐                              │     ┌─────┴─────┐
                    │Internet │            │    NAT    │                              │     │    NAT    │
                    │ Gateway │            │  Gateway  │                              │     │  Gateway  │
                    └────┬────┘            └─────┬─────┘                              │     └─────┬─────┘
                         │                       │                                    │           │
                    ┌────┴────────────────────────┴────────────────────────────────────┴───────────┴────┐
                    │                                   Internet                                        │
                    └───────────────────────────────────────────────────────────────────────────────────┘

                    ┌────────────────────────────────────────────────────────────────────────────────────┐
                    │                              VPC Endpoints (Gateway)                               │
                    │                                                                                    │
                    │   ┌────────────┐        ┌────────────┐        ┌────────────────────────────────┐  │
                    │   │     S3     │        │  DynamoDB  │        │   SSM Parameters (created)     │  │
                    │   │  (FREE)    │        │   (FREE)   │        │   /networking/{env}/vpc-id     │  │
                    │   └────────────┘        └────────────┘        │   /networking/{env}/vpc-cidr   │  │
                    │                                               │   /networking/{env}/subnet-ids │  │
                    └───────────────────────────────────────────────┴────────────────────────────────────┘
```

### Components Created

| Component                 | Description                                 | Cost                 |
| ------------------------- | ------------------------------------------- | -------------------- |
| VPC                       | Virtual Private Cloud with DNS support      | Free                 |
| Internet Gateway          | Allows public subnet internet access        | Free                 |
| Public Subnets            | For ALBs, NAT Gateways, bastion hosts       | Free                 |
| Private Subnets           | For ECS tasks, databases, internal services | Free                 |
| NAT Gateway(s)            | Private subnet outbound internet access     | ~$32/month each      |
| S3 Gateway Endpoint       | Private access to S3 without NAT            | Free                 |
| DynamoDB Gateway Endpoint | Private access to DynamoDB without NAT      | Free                 |
| VPC Flow Logs             | Network traffic monitoring to CloudWatch    | ~$0.50/GB            |
| SSM Parameters            | Cross-stack resource discovery              | Free (Standard tier) |

## Why This Architecture

### Design Decisions

**1. Two-Tier Subnet Architecture (Public + Private)**

- **Why**: Separates public-facing resources (load balancers) from internal resources (ECS tasks, databases)
- **Security**: Private subnets have no direct internet ingress
- **Cost**: Simpler than three-tier; add isolated subnets only when needed

**2. Multi-AZ Deployment (2+ Availability Zones)**

- **Why**: High availability - if one AZ fails, resources in other AZs continue operating
- **Trade-off**: More resources deployed, but critical for production resilience

**3. NAT Gateway Configuration**

- **Development (0 NAT)**: Lowest cost, but private subnets cannot reach internet
- **Non-Production (1 NAT)**: Cost-optimised, single point of failure acceptable
- **Production (2+ NAT)**: One per AZ for high availability

**4. VPC Endpoints (Gateway)**

- **Why**: S3 and DynamoDB traffic stays within AWS network
- **Benefits**: Lower latency, reduced NAT costs, improved security
- **Cost**: Gateway endpoints are free

**5. VPC Flow Logs**

- **Why**: Security monitoring, compliance, troubleshooting
- **Trade-off**: Storage costs vs visibility

**6. SSM Parameters for Cross-Stack References**

- **Why**: Avoids CloudFormation export limitations
- **Benefits**: Works across accounts, no circular dependency issues
- **Pattern**: `/networking/{environment}/{resource-type}`

### Environment-Specific CIDR Allocation

| Environment | CIDR Block  | Rationale                                  |
| ----------- | ----------- | ------------------------------------------ |
| Pipeline    | 10.0.0.0/16 | CI/CD infrastructure, monitoring hub       |
| Development | 10.1.0.0/16 | Frequent deploys, can overlap in isolation |
| Staging     | 10.2.0.0/16 | Pre-production testing                     |
| Production  | 10.3.0.0/16 | Live workloads (can peer with monitoring)  |

## Prerequisites

### Required Tools

```bash
# Node.js (v18+ recommended)
node --version
# v18.x.x or higher

# AWS CDK CLI
npm install -g aws-cdk
cdk --version
# 2.x.x or higher

# AWS CLI
aws --version
# aws-cli/2.x.x or higher

# Git
git --version
```

### AWS Credentials

Configure AWS credentials for your development account:

```bash
# Option 1: Environment variables (recommended for local dev)
export AWS_ACCESS_KEY_ID="your-access-key"
export AWS_SECRET_ACCESS_KEY="your-secret-key"
export AWS_REGION="eu-west-1"

# Option 2: AWS CLI profile
aws configure --profile dev
# Enter your credentials when prompted

# Verify credentials
aws sts get-caller-identity
```

### Required IAM Permissions

Your IAM user/role needs these permissions for CDK deployment:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "cloudformation:*",
        "ec2:*",
        "iam:*",
        "ssm:*",
        "logs:*",
        "s3:*",
        "sts:AssumeRole"
      ],
      "Resource": "*"
    }
  ]
}
```

For production, use more restrictive policies. For local development, `AdministratorAccess` simplifies testing.

## Account Bootstrapping

CDK requires a one-time bootstrap per account/region before deploying stacks.

### Step 1: Set Environment Variables

```bash
# Create .env file in project root
cat > .env << 'EOF'
# AWS Account IDs
AWS_ACCOUNT_ID_DEV=123456789012
AWS_PIPELINE_ACCOUNT_ID=123456789012

# AWS Region
AWS_REGION=eu-west-1

# Environment
ENVIRONMENT=development
EOF

# Load environment variables
source .env

# Or export directly
export AWS_ACCOUNT_ID_DEV="$(aws sts get-caller-identity --query Account --output text)"
export AWS_PIPELINE_ACCOUNT_ID="$AWS_ACCOUNT_ID_DEV"
export AWS_REGION="eu-west-1"
export ENVIRONMENT="development"
```

### Step 2: Bootstrap CDK

```bash
# Navigate to project directory
cd /path/to/monitoring-iac

# Install dependencies
npm install

# Bootstrap CDK (one-time per account/region)
cdk bootstrap aws://$AWS_ACCOUNT_ID_DEV/$AWS_REGION

# Expected output:
# CDKToolkit: creating CloudFormation changeset...
# CDKToolkit | 0/12 | ...
# CDKToolkit | 12/12 | CREATE_COMPLETE
```

### Step 3: Verify Bootstrap

```bash
# Check CDKToolkit stack exists
aws cloudformation describe-stacks \
  --stack-name CDKToolkit \
  --query 'Stacks[0].StackStatus'

# Expected: "CREATE_COMPLETE" or "UPDATE_COMPLETE"

# List bootstrap resources
aws cloudformation list-stack-resources \
  --stack-name CDKToolkit \
  --query 'StackResourceSummaries[*].[LogicalResourceId,ResourceType]' \
  --output table
```

### Bootstrap for Multiple Accounts (Production Setup)

```bash
# Bootstrap development account
cdk bootstrap aws://$AWS_ACCOUNT_ID_DEV/$AWS_REGION \
  --trust $AWS_PIPELINE_ACCOUNT_ID \
  --cloudformation-execution-policies arn:aws:iam::aws:policy/AdministratorAccess

# Bootstrap staging account
cdk bootstrap aws://$AWS_ACCOUNT_ID_STAGING/$AWS_REGION \
  --trust $AWS_PIPELINE_ACCOUNT_ID \
  --cloudformation-execution-policies arn:aws:iam::aws:policy/AdministratorAccess

# Bootstrap production account
cdk bootstrap aws://$AWS_ACCOUNT_ID_PROD/$AWS_REGION \
  --trust $AWS_PIPELINE_ACCOUNT_ID \
  --cloudformation-execution-policies arn:aws:iam::aws:policy/AdministratorAccess
```

## Environment Configuration

### Configuration File

The environment configuration is defined in `config/environments.ts`:

```typescript
export const environments: Record<string, EnvironmentConfig> = {
  development: {
    account: process.env.AWS_ACCOUNT_ID_DEV || "",
    region: process.env.AWS_REGION || "eu-west-1",
    vpcCidr: "10.1.0.0/16",
    natGateways: 0, // Cost-optimised: no NAT
    isProduction: false,
    envName: "development",
    enableMonitoring: false,
    enableEventBridge: true,
  },
  // ... other environments
};
```

### Override Configuration

You can override configuration via environment variables:

```bash
# Override VPC CIDR
export VPC_CIDR="10.99.0.0/16"

# Override NAT gateway count
export NAT_GATEWAYS=1

# Override environment
export ENVIRONMENT="staging"
```

## Local Deployment

### Step 1: Synthesise CloudFormation Template

```bash
# Ensure environment variables are set
export ENVIRONMENT=development
export AWS_ACCOUNT_ID_DEV="$(aws sts get-caller-identity --query Account --output text)"
export AWS_REGION="eu-west-1"

# Synthesise (generates CloudFormation template)
cdk synth development-Networking

# View generated template
cat cdk.out/development-Networking.template.json | jq '.Resources | keys'
```

### Step 2: Preview Changes

```bash
# Show what will be created/modified/deleted
cdk diff development-Networking

# Expected output for new deployment:
# Stack development-Networking
# Resources
# [+] AWS::EC2::VPC Vpc/MonitoringVpc ...
# [+] AWS::EC2::Subnet Vpc/MonitoringVpc/PublicSubnet1 ...
# [+] AWS::EC2::Subnet Vpc/MonitoringVpc/PrivateSubnet1 ...
# ...
```

### Step 3: Deploy

```bash
# Deploy the stack
cdk deploy development-Networking

# Deploy with approval prompt disabled (for CI/CD)
cdk deploy development-Networking --require-approval never

# Deploy with verbose output
cdk deploy development-Networking --verbose

# Deploy specific stacks only
cdk deploy development-Networking --exclusively
```

### Step 4: Monitor Deployment

```bash
# In another terminal, watch CloudFormation events
aws cloudformation describe-stack-events \
  --stack-name development-Networking \
  --query 'StackEvents[*].[Timestamp,LogicalResourceId,ResourceStatus]' \
  --output table

# Or use the AWS Console:
# CloudFormation > Stacks > development-Networking > Events
```

### Deployment Options

```bash
# Disable CDK Nag checks (faster deployment for testing)
ENABLE_CDK_NAG=false cdk deploy development-Networking

# Deploy with specific AWS profile
cdk deploy development-Networking --profile dev

# Deploy with role assumption
cdk deploy development-Networking \
  --role-arn arn:aws:iam::123456789012:role/CDKDeployRole

# Deploy all stacks (when multiple exist)
cdk deploy --all
```

## Verification

### Verify Stack Deployment

```bash
# Check stack status
aws cloudformation describe-stacks \
  --stack-name development-Networking \
  --query 'Stacks[0].{Status:StackStatus,Outputs:Outputs}'

# List all stack outputs
aws cloudformation describe-stacks \
  --stack-name development-Networking \
  --query 'Stacks[0].Outputs[*].[OutputKey,OutputValue]' \
  --output table
```

### Verify VPC Resources

```bash
# Get VPC ID from stack output
VPC_ID=$(aws cloudformation describe-stacks \
  --stack-name development-Networking \
  --query 'Stacks[0].Outputs[?OutputKey==`VpcId`].OutputValue' \
  --output text)

echo "VPC ID: $VPC_ID"

# Verify VPC configuration
aws ec2 describe-vpcs --vpc-ids $VPC_ID

# List subnets
aws ec2 describe-subnets \
  --filters "Name=vpc-id,Values=$VPC_ID" \
  --query 'Subnets[*].[SubnetId,CidrBlock,AvailabilityZone,Tags[?Key==`Name`].Value|[0]]' \
  --output table

# List route tables
aws ec2 describe-route-tables \
  --filters "Name=vpc-id,Values=$VPC_ID" \
  --query 'RouteTables[*].[RouteTableId,Tags[?Key==`Name`].Value|[0]]' \
  --output table
```

### Verify SSM Parameters

```bash
# List networking parameters
aws ssm get-parameters-by-path \
  --path "/networking/development" \
  --query 'Parameters[*].[Name,Value]' \
  --output table

# Get specific parameter
aws ssm get-parameter \
  --name "/networking/development/vpc-id" \
  --query 'Parameter.Value' \
  --output text
```

### Verify VPC Flow Logs

```bash
# List flow logs for VPC
aws ec2 describe-flow-logs \
  --filter "Name=resource-id,Values=$VPC_ID" \
  --query 'FlowLogs[*].[FlowLogId,LogGroupName,TrafficType,FlowLogStatus]' \
  --output table

# Check CloudWatch log group
aws logs describe-log-groups \
  --log-group-name-prefix "/aws/vpc/flowlogs/development"
```

### Verify VPC Endpoints

```bash
# List VPC endpoints
aws ec2 describe-vpc-endpoints \
  --filters "Name=vpc-id,Values=$VPC_ID" \
  --query 'VpcEndpoints[*].[VpcEndpointId,ServiceName,VpcEndpointType,State]' \
  --output table
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

**Issue: "VPC CIDR overlaps with existing VPC"**

```
Error: The CIDR '10.0.0.0/16' conflicts with another subnet
```

**Solution:**

```bash
# List existing VPCs
aws ec2 describe-vpcs --query 'Vpcs[*].[VpcId,CidrBlock]' --output table

# Choose a non-overlapping CIDR in environments.ts or via environment variable
export VPC_CIDR="10.99.0.0/16"
```

**Issue: "NAT Gateway creation timeout"**

**Solution:** NAT Gateways can take 5-10 minutes to provision. Wait for completion or check:

```bash
aws ec2 describe-nat-gateways \
  --filter "Name=vpc-id,Values=$VPC_ID" \
  --query 'NatGateways[*].[NatGatewayId,State]'
```

**Issue: "IAM role creation failed"**

**Solution:** Ensure your IAM user has `iam:CreateRole` and `iam:AttachRolePolicy` permissions.

**Issue: "Stack is in ROLLBACK_COMPLETE state"**

**Solution:**

```bash
# Delete the failed stack
aws cloudformation delete-stack --stack-name development-Networking

# Wait for deletion
aws cloudformation wait stack-delete-complete --stack-name development-Networking

# Redeploy
cdk deploy development-Networking
```

### Debug Commands

```bash
# Enable CDK debug output
export CDK_DEBUG=true
cdk deploy development-Networking

# Check CloudFormation events for errors
aws cloudformation describe-stack-events \
  --stack-name development-Networking \
  --query 'StackEvents[?ResourceStatus==`CREATE_FAILED`].[LogicalResourceId,ResourceStatusReason]' \
  --output table

# Validate CloudFormation template
aws cloudformation validate-template \
  --template-body file://cdk.out/development-Networking.template.json
```

### Logs and Monitoring

```bash
# View VPC Flow Logs (after traffic is generated)
aws logs filter-log-events \
  --log-group-name "/aws/vpc/flowlogs/development" \
  --limit 10

# View CloudFormation drift
aws cloudformation detect-stack-drift \
  --stack-name development-Networking
```

## Cleanup

### Destroy Stack

```bash
# Destroy the networking stack
cdk destroy development-Networking

# Confirm destruction when prompted
# Type 'y' and press Enter

# Verify stack is deleted
aws cloudformation describe-stacks \
  --stack-name development-Networking 2>&1 | grep -q "does not exist" && echo "Stack deleted"
```

### Manual Cleanup (if needed)

If stack deletion fails, manually remove resources:

```bash
# Delete NAT Gateways first (they prevent VPC deletion)
aws ec2 describe-nat-gateways \
  --filter "Name=vpc-id,Values=$VPC_ID" \
  --query 'NatGateways[*].NatGatewayId' \
  --output text | xargs -I {} aws ec2 delete-nat-gateway --nat-gateway-id {}

# Wait for NAT Gateway deletion
sleep 60

# Delete VPC endpoints
aws ec2 describe-vpc-endpoints \
  --filters "Name=vpc-id,Values=$VPC_ID" \
  --query 'VpcEndpoints[*].VpcEndpointId' \
  --output text | xargs -I {} aws ec2 delete-vpc-endpoints --vpc-endpoint-ids {}

# Detach and delete Internet Gateway
IGW_ID=$(aws ec2 describe-internet-gateways \
  --filters "Name=attachment.vpc-id,Values=$VPC_ID" \
  --query 'InternetGateways[0].InternetGatewayId' \
  --output text)
aws ec2 detach-internet-gateway --internet-gateway-id $IGW_ID --vpc-id $VPC_ID
aws ec2 delete-internet-gateway --internet-gateway-id $IGW_ID

# Delete subnets
aws ec2 describe-subnets \
  --filters "Name=vpc-id,Values=$VPC_ID" \
  --query 'Subnets[*].SubnetId' \
  --output text | xargs -I {} aws ec2 delete-subnet --subnet-id {}

# Delete VPC
aws ec2 delete-vpc --vpc-id $VPC_ID
```

### Remove CDK Bootstrap (optional)

Only do this if you no longer need CDK in the account:

```bash
# Empty the CDK staging bucket first
BUCKET=$(aws cloudformation describe-stack-resource \
  --stack-name CDKToolkit \
  --logical-resource-id StagingBucket \
  --query 'StackResourceDetail.PhysicalResourceId' \
  --output text)

aws s3 rm s3://$BUCKET --recursive

# Delete CDKToolkit stack
aws cloudformation delete-stack --stack-name CDKToolkit
```

## Quick Reference

### Common Commands

```bash
# Synthesise
cdk synth development-Networking

# Diff (preview changes)
cdk diff development-Networking

# Deploy
cdk deploy development-Networking

# Destroy
cdk destroy development-Networking

# List stacks
cdk list

# Get VPC ID
aws ssm get-parameter --name /networking/development/vpc-id --query Parameter.Value --output text
```

### Environment Variables

```bash
export ENVIRONMENT=development
export AWS_ACCOUNT_ID_DEV=123456789012
export AWS_REGION=eu-west-1
export ENABLE_CDK_NAG=false  # Disable CDK Nag for faster deploys
```

### Cost Estimation

| Configuration            | Monthly Cost (approx.) |
| ------------------------ | ---------------------- |
| Development (0 NAT)      | ~$5 (flow logs only)   |
| Non-Production (1 NAT)   | ~$37                   |
| Production (2 NAT, 2 AZ) | ~$69                   |

## Next Steps

After deploying the NetworkingStack:

1. **Deploy dependent stacks** that use the VPC (ECS, RDS, etc.)
2. **Set up VPC peering** if cross-account monitoring is needed
3. **Configure alarms** for VPC Flow Log anomalies
4. **Review security groups** for services deployed in subnets
