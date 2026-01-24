# CDK Application Deployment Guide

This directory contains the CDK application entry point for deploying the monitoring infrastructure using a layered architecture approach.

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Why This Architecture](#why-this-architecture)
- [Prerequisites](#prerequisites)
- [Deployment Guide](#deployment-guide)
- [Individual Stack Deployment](#individual-stack-deployment)
- [Troubleshooting](#troubleshooting)
- [Advanced Topics](#advanced-topics)

## Architecture Overview

The monitoring infrastructure is organised into three distinct layers, each deployed as a separate CloudFormation stack. This layered approach allows independent updates to different concerns without affecting the entire infrastructure.

### Three-Layer Architecture

```
Layer 0: Storage (MonitoringEfsStack)
└── EFS file system, access points, Lambda initialisation
└── Deployed when: Storage configuration changes

Layer 1: Infrastructure (MonitoringInfraStack)
└── ECS cluster, Auto Scaling Group, Load Balancer
└── Deployed when: Compute or networking infrastructure changes

Layer 2: Services (MonitoringServiceStack)
└── Prometheus, Grafana, Node Exporter ECS services
└── Deployed when: Container images or service configuration changes
```

### Foundation Layer

Before deploying monitoring stacks, the foundation layer must exist:

```
NetworkingStack (Foundation)
└── VPC, subnets, security groups, NAT gateways
└── Required by: All monitoring stacks
```

## Why This Architecture

### Problems Solved

#### 1. Minimise Deployment Frequency and Blast Radius

Traditional monolithic infrastructure requires redeploying everything for any change. This creates several problems:

- **Long Deployment Times**: A single change to a service container requires rebuilding the entire infrastructure, including EFS, ECS cluster, and services.
- **Increased Risk**: Every deployment touches all resources, increasing the chance of unintended changes or failures.
- **Downtime**: Updating service containers shouldn't require touching the underlying infrastructure.

**Solution**: By separating concerns into layers, you only deploy what changes:
- Storage configuration change? Deploy Layer 0 only (MonitoringEfsStack).
- Infrastructure scaling? Deploy Layer 1 only (MonitoringInfraStack).
- New container image? Deploy Layer 2 only (MonitoringServiceStack).

#### 2. Independent Update Cycles

Different components have different update frequencies:

- **Storage (EFS)**: Rarely changes once configured (maybe once per quarter).
- **Infrastructure (ECS Cluster, ALB)**: Changes occasionally for scaling or configuration (monthly).
- **Services (Containers)**: Changes frequently for updates, patches, or features (weekly or daily).

**Solution**: Each layer has its own CloudFormation stack with independent lifecycle:
- Layer 0 (Storage) remains stable for months.
- Layer 1 (Infrastructure) updates as needed for capacity.
- Layer 2 (Services) updates frequently without touching infrastructure.

#### 3. Clear Dependency Management

When everything is in one stack, dependencies are implicit and hard to reason about. This makes troubleshooting difficult and increases deployment complexity.

**Solution**: Explicit dependencies between stacks:
- MonitoringEfsStack depends on NetworkingStack (VPC required).
- MonitoringInfraStack depends on MonitoringEfsStack (EFS required for mounting).
- MonitoringServiceStack depends on MonitoringInfraStack (cluster and ALB required).

CDK enforces these dependencies automatically, preventing out-of-order deployments.

#### 4. Faster Iteration for Developers

When developing new features or testing configurations, developers need rapid feedback. Redeploying a monolithic stack takes 15-20 minutes. Deploying just the service layer takes 3-5 minutes.

**Solution**: Developers can iterate quickly on:
- Service configurations (Layer 2) without waiting for infrastructure provisioning.
- Infrastructure changes (Layer 1) without touching stable storage.
- Storage changes (Layer 0) in isolation when necessary.

#### 5. Safer Production Deployments

In production, you want to minimise the scope of changes. A container image update shouldn't risk modifying load balancer configuration or EFS settings.

**Solution**: Each layer deployment is scoped to specific resources:
- Updating Prometheus image? Only Layer 2 changes, ALB and EFS untouched.
- Scaling ECS cluster? Only Layer 1 changes, storage and services untouched.
- Adjusting EFS lifecycle policies? Only Layer 0 changes, compute and services untouched.

#### 6. Cost Optimisation Through Granular Control

When storage, compute, and services are in one stack, it's difficult to identify which resources drive costs. The layered approach makes cost attribution clear.

**Solution**:
- Layer 0 costs: EFS storage, Lambda executions.
- Layer 1 costs: EC2 instances, ALB, NAT gateway (if used).
- Layer 2 costs: CloudWatch Logs, container registry pulls.

You can optimise each layer independently based on actual usage patterns.

### How It Works

The `app.ts` file orchestrates all three layers:

1. **Environment Resolution**: Reads environment name from CDK context or defaults to development.
2. **Foundation Deployment**: Creates or references NetworkingStack (VPC required for all monitoring).
3. **Layer 0 Deployment**: Creates MonitoringEfsStack with persistent storage.
4. **Layer 1 Deployment**: Creates MonitoringInfraStack with ECS cluster and ALB.
5. **Layer 2 Deployment**: Creates MonitoringServiceStack with Prometheus and Grafana services.

Each layer explicitly depends on the previous layer, ensuring correct deployment order.

### What It Does

#### Layer 0: MonitoringEfsStack (Storage)

Creates persistent storage infrastructure:

- **EFS File System**: Encrypted storage for Prometheus time-series data and Grafana dashboards.
- **Access Point**: POSIX permissions allowing containers to read/write data.
- **Security Group**: NFS access from VPC CIDR.
- **Lambda Initialisation**: Creates directory structure on first deployment.
- **SSM Parameters**: Stores Prometheus configuration, Grafana datasource configuration, and EFS discovery information.

**Deployment Triggers**:
- Storage capacity changes.
- Lifecycle policy modifications.
- Access control changes.
- Cross-account target updates.

**Typical Deployment Frequency**: Once per quarter or when storage requirements change.

#### Layer 1: MonitoringInfraStack (Infrastructure)

Creates compute and networking infrastructure:

- **ECS Cluster**: Container orchestration with Container Insights enabled.
- **Auto Scaling Group**: EC2 instances with ECS-optimised Amazon Linux 2023 AMI.
- **Application Load Balancer**: HTTP/HTTPS routing to monitoring services.
- **Security Groups**: Controls traffic between ALB, ECS instances, and EFS.
- **CloudWatch Log Groups**: Captures ECS task logs and events.
- **SSM State Manager**: Configures ECS agents and application setup.

**Deployment Triggers**:
- Scaling requirements (min/max/desired capacity).
- Instance type changes.
- ALB configuration (idle timeout, deletion protection).
- Security group rule modifications.

**Typical Deployment Frequency**: Monthly or when infrastructure scaling is needed.

#### Layer 2: MonitoringServiceStack (Services)

Creates monitoring application services:

- **Prometheus Service**: Metrics collection with EC2 service discovery.
- **Grafana Service**: Dashboard and visualisation with CloudWatch integration.
- **Node Exporter Service**: Host-level metrics from ECS instances.
- **ALB Target Groups**: Health checks and routing rules for each service.
- **Path-Based Routing**: /prometheus and /grafana URL paths.

**Deployment Triggers**:
- Container image updates (new Prometheus or Grafana version).
- Service configuration changes (resource limits, environment variables).
- Health check modifications.
- Port mapping adjustments.

**Typical Deployment Frequency**: Weekly or daily for image updates and feature rollouts.

### Benefits in Practice

#### Scenario 1: Updating Grafana Version

**Without Layered Architecture** (Monolithic Stack):
1. Update Grafana container image tag.
2. Deploy entire stack (15-20 minutes).
3. CloudFormation updates EFS, ECS cluster, ALB, and services.
4. Risk: Unintended changes to infrastructure or storage.

**With Layered Architecture**:
1. Update Grafana container image tag in Layer 2.
2. Deploy only MonitoringServiceStack (3-5 minutes).
3. CloudFormation updates only the Grafana ECS service.
4. Infrastructure and storage remain untouched.

#### Scenario 2: Scaling ECS Cluster for Black Friday

**Without Layered Architecture**:
1. Update desired capacity.
2. Deploy entire stack.
3. Risk: Service definitions might change unintentionally.
4. Rollback requires redeploying entire stack.

**With Layered Architecture**:
1. Update capacity in Layer 1 (MonitoringInfraStack).
2. Deploy only infrastructure stack.
3. Services continue running on new capacity.
4. Rollback is isolated to infrastructure only.

#### Scenario 3: Adjusting EFS Lifecycle Policy

**Without Layered Architecture**:
1. Change lifecycle policy.
2. Deploy entire stack.
3. Risk: Service updates might occur during deployment.
4. No clear separation between storage and compute changes.

**With Layered Architecture**:
1. Update lifecycle policy in Layer 0.
2. Deploy only MonitoringEfsStack.
3. No impact on running services or infrastructure.
4. Clear audit trail of storage-specific changes.

## Prerequisites

### Required Tools

- **Node.js**: v18 or higher.
- **Yarn**: v4 or higher (this project uses Yarn, not npm).
- **AWS CDK CLI**: v2.x or higher.
- **AWS CLI**: v2.x or higher.
- **Docker**: Required for Lambda function bundling.

Verify installations:

```bash
node --version    # Should be v18+
yarn --version    # Should be v4+
cdk --version     # Should be v2.x+
aws --version     # Should be v2.x+
docker --version  # Required for asset bundling
```

### AWS Account Setup

1. **Configure AWS Credentials**:

```bash
aws configure
# Or use environment variables:
export AWS_ACCESS_KEY_ID="your-access-key"
export AWS_SECRET_ACCESS_KEY="your-secret-key"
export AWS_REGION="eu-west-1"
```

2. **Bootstrap CDK** (one-time per account/region):

```bash
export AWS_ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
export AWS_REGION="eu-west-1"

cdk bootstrap aws://$AWS_ACCOUNT_ID/$AWS_REGION
```

3. **Install Project Dependencies**:

```bash
yarn install
yarn build
```

## Deployment Guide

### Complete Monitoring Infrastructure Deployment

This section walks through deploying all three layers from scratch.

#### Step 1: Configure Environment

Set the environment you're deploying to:

```bash
export ENVIRONMENT=development
export AWS_ACCOUNT_ID_DEV="$(aws sts get-caller-identity --query Account --output text)"
export AWS_REGION="eu-west-1"
```

Or use CDK context (recommended):

```bash
# Via command line
cdk deploy --context environment=development

# Or via cdk.context.json
echo '{"environment": "development"}' > cdk.context.json
```

#### Step 2: Preview All Stacks

List all stacks that will be created:

```bash
cdk list

# Expected output:
# development-Networking
# development-MonitoringEfs
# development-MonitoringInfra
# development-MonitoringService
```

Preview changes for each stack:

```bash
cdk diff development-Networking
cdk diff development-MonitoringEfs
cdk diff development-MonitoringInfra
cdk diff development-MonitoringService
```

#### Step 3: Deploy Foundation (NetworkingStack)

Deploy the VPC and networking infrastructure first:

```bash
cdk deploy development-Networking

# Or with explicit approval bypass (CI/CD)
cdk deploy development-Networking --require-approval never
```

**What This Creates**:
- VPC with public and private subnets across 2 availability zones.
- Internet Gateway for public subnet internet access.
- NAT Gateway (optional, based on environment configuration).
- VPC Flow Logs for network traffic monitoring.
- VPC Endpoints for S3 and DynamoDB (cost optimisation).
- SSM parameters for VPC configuration discovery.

**Deployment Time**: Approximately 3-5 minutes.

#### Step 4: Deploy Layer 0 (MonitoringEfsStack)

Deploy persistent storage for monitoring data:

```bash
cdk deploy development-MonitoringEfs
```

**What This Creates**:
- EFS file system with encryption at rest.
- EFS access point with POSIX user/group configuration.
- Security group allowing NFS traffic from VPC.
- Lambda function that initialises EFS directory structure.
- SSM parameters with Prometheus configuration (prometheus.yml).
- SSM parameters with Grafana datasource configuration.

**Deployment Time**: Approximately 5-8 minutes (includes Lambda initialisation).

**Verification**:

```bash
# Check EFS is ready
aws efs describe-file-systems \
  --query 'FileSystems[?Tags[?Key==`Environment` && Value==`development`]].[FileSystemId,LifeCycleState]' \
  --output table

# Verify directory structure was created
aws ssm get-parameter \
  --name "/monitoring/development/efs/discovery" \
  --query 'Parameter.Value'
```

#### Step 5: Deploy Layer 1 (MonitoringInfraStack)

Deploy compute infrastructure and load balancer:

```bash
cdk deploy development-MonitoringInfra
```

**What This Creates**:
- ECS cluster with Container Insights enabled.
- Auto Scaling Group with ECS-optimised instances.
- Launch template with IMDSv2 enforcement and EFS mount permissions.
- Application Load Balancer for routing traffic to services.
- ALB listeners (HTTP, optionally HTTPS).
- Security groups for ALB and ECS instances.
- CloudWatch log groups for ECS task and event logs.
- SSM State Manager associations for ECS agent configuration.
- EventBridge rules for capturing ECS lifecycle events.

**Deployment Time**: Approximately 8-12 minutes (includes Auto Scaling Group and ALB provisioning).

**Verification**:

```bash
# Check ECS cluster is active
aws ecs describe-clusters \
  --clusters development-monitoring-cluster \
  --query 'clusters[0].status'

# Verify EC2 instances registered
aws ecs list-container-instances \
  --cluster development-monitoring-cluster

# Check ALB DNS name
aws cloudformation describe-stacks \
  --stack-name development-MonitoringInfra \
  --query 'Stacks[0].Outputs[?OutputKey==`LoadBalancerDns`].OutputValue' \
  --output text
```

#### Step 6: Deploy Layer 2 (MonitoringServiceStack)

Deploy monitoring application services:

```bash
cdk deploy development-MonitoringService
```

**What This Creates**:
- Prometheus ECS service with time-series database.
- Grafana ECS service with dashboards and visualisation.
- Node Exporter ECS service for host metrics collection.
- ALB target groups with health checks for each service.
- ALB listener rules for path-based routing (/prometheus, /grafana).
- Security group connections between ALB and services.
- SSM parameters for service discovery and monitoring.

**Deployment Time**: Approximately 5-8 minutes (includes service startup and health checks).

**Verification**:

```bash
# Check services are running
aws ecs list-services \
  --cluster development-monitoring-cluster \
  --query 'serviceArns'

# Get service URLs
ALB_DNS=$(aws cloudformation describe-stacks \
  --stack-name development-MonitoringInfra \
  --query 'Stacks[0].Outputs[?OutputKey==`LoadBalancerDns`].OutputValue' \
  --output text)

echo "Prometheus: http://$ALB_DNS/prometheus"
echo "Grafana: http://$ALB_DNS/grafana"

# Verify services are healthy
aws elbv2 describe-target-health \
  --target-group-arn <prometheus-target-group-arn>
```

#### Step 7: Access Monitoring Dashboards

After all layers are deployed:

```bash
# Get ALB DNS from infrastructure stack
ALB_DNS=$(aws cloudformation describe-stacks \
  --stack-name development-MonitoringInfra \
  --query 'Stacks[0].Outputs[?OutputKey==`LoadBalancerDns`].OutputValue' \
  --output text)

# Access monitoring services
echo "Prometheus UI: http://$ALB_DNS/prometheus"
echo "Grafana UI: http://$ALB_DNS/grafana (credentials: admin/admin)"
```

### Deploy All Layers at Once

For initial setup, you can deploy all layers sequentially:

```bash
# CDK automatically resolves dependencies
cdk deploy --all

# Or deploy specific stacks in order
cdk deploy development-Networking \
           development-MonitoringEfs \
           development-MonitoringInfra \
           development-MonitoringService
```

## Individual Stack Deployment

The layered architecture allows deploying, updating, or rolling back each layer independently.

### Layer 0: Storage Stack (MonitoringEfsStack)

**When to Deploy**:
- Initial setup.
- EFS lifecycle policy changes.
- Storage capacity adjustments.
- Cross-account target configuration changes.
- Security group rule modifications for NFS.

**Deploy Command**:

```bash
cdk deploy development-MonitoringEfs
```

**What Changes**:
- EFS file system configuration.
- Access point POSIX permissions.
- Lambda initialisation function.
- SSM parameters (Prometheus config, Grafana datasource).
- Security group rules for NFS access.

**What Doesn't Change**:
- Running ECS services continue operating.
- Load balancer configuration unchanged.
- No downtime for monitoring dashboards.

**Rollback**:

```bash
# If deployment fails, CloudFormation automatically rolls back
# Manual rollback to previous version:
aws cloudformation cancel-update-stack --stack-name development-MonitoringEfs
```

**Cost Impact**: Minimal. EFS storage costs are based on usage, not provisioning.

### Layer 1: Infrastructure Stack (MonitoringInfraStack)

**When to Deploy**:
- Initial setup.
- Scaling ECS cluster capacity (min/max/desired).
- Instance type changes.
- ALB configuration changes (idle timeout, deletion protection).
- Security group rule updates.
- SSM State Manager association changes.

**Deploy Command**:

```bash
cdk deploy development-MonitoringInfra
```

**What Changes**:
- Auto Scaling Group configuration (capacity, instance type).
- ECS cluster settings (Container Insights, execute command).
- ALB configuration (idle timeout, access logs).
- Security group rules between ALB and ECS.
- Launch template (user data, IAM permissions).
- CloudWatch log group retention.

**What Doesn't Change**:
- EFS file system remains untouched.
- Service definitions (container images, task definitions) unchanged.
- Existing data in EFS persists.

**Impact on Services**:
- Services may be restarted if ASG is updated (rolling update).
- Brief downtime possible during instance replacement.
- Use `desiredCapacity >= 2` for zero-downtime updates.

**Rollback**:

```bash
# CloudFormation automatic rollback on failure
# Manual rollback:
aws cloudformation cancel-update-stack --stack-name development-MonitoringInfra
```

**Cost Impact**: High. EC2 instances and ALB are primary cost drivers.

### Layer 2: Services Stack (MonitoringServiceStack)

**When to Deploy**:
- Initial setup.
- Container image updates (Prometheus, Grafana, Node Exporter).
- Service configuration changes (CPU, memory, environment variables).
- Health check adjustments.
- Target group modifications.
- Path-based routing rule changes.

**Deploy Command**:

```bash
cdk deploy development-MonitoringService
```

**What Changes**:
- ECS task definitions (container images, resource limits).
- ECS services (desired count, deployment configuration).
- ALB target groups (health check settings).
- ALB listener rules (path patterns, priorities).
- Service-to-service security group connections.

**What Doesn't Change**:
- EFS file system untouched (data persists).
- ECS cluster configuration unchanged.
- ALB itself unchanged (only target groups and rules).
- Auto Scaling Group untouched.

**Impact on Services**:
- ECS performs rolling update of tasks.
- Old tasks drain and new tasks start.
- Health checks ensure new tasks are healthy before old tasks terminate.
- Zero-downtime deployment with `desiredCount >= 2`.

**Rollback**:

```bash
# Automatic rollback on health check failures
# Manual rollback to previous image:
cdk deploy development-MonitoringService
# (with previous image tags in construct configuration)
```

**Cost Impact**: Low. Minimal cost difference for running containers.

### Selective Deployment Examples

#### Example 1: Update Only Grafana Image

Problem: New Grafana version available, need to update without touching Prometheus or infrastructure.

Solution:

1. Update Grafana image tag in `lib/constructs/services/monitoring/grafana/grafana-construct.ts`.
2. Deploy only Layer 2.

```bash
cdk deploy development-MonitoringService
```

Result:
- Only Grafana service is updated.
- Prometheus continues running on old version.
- Infrastructure and storage unchanged.
- Deployment completes in 3-5 minutes.

#### Example 2: Scale ECS Cluster for Increased Load

Problem: Prometheus is running out of memory, need to scale cluster without updating services.

Solution:

1. Update `minCapacity`, `maxCapacity`, or `instanceType` in `bin/stacks/monitoring-stack.ts`.
2. Deploy only Layer 1.

```bash
cdk deploy development-MonitoringInfra
```

Result:
- Auto Scaling Group scales to new capacity.
- ECS redistributes tasks across new instances.
- Service definitions unchanged (no image pulls).
- Storage unchanged.

#### Example 3: Adjust EFS Lifecycle Policy

Problem: EFS costs too high, need to transition data to Infrequent Access storage class sooner.

Solution:

1. Update `lifecyclePolicy` in `bin/stacks/monitoring-stack.ts`.
2. Deploy only Layer 0.

```bash
cdk deploy development-MonitoringEfs
```

Result:
- EFS lifecycle policy updated.
- Existing data transitions according to new policy.
- No service restarts required.
- Infrastructure unchanged.

## Troubleshooting

### Common Deployment Issues

#### Issue: Stack Dependencies Not Met

```
Error: development-MonitoringInfra depends on development-MonitoringEfs
```

**Cause**: Attempting to deploy a higher layer before lower layers exist.

**Solution**: Deploy stacks in order:

```bash
cdk deploy development-Networking      # Foundation first
cdk deploy development-MonitoringEfs   # Then Layer 0
cdk deploy development-MonitoringInfra # Then Layer 1
```

#### Issue: Services Not Healthy After Deployment

```
Error: Service tasks failing health checks
```

**Cause**: EFS not mounted, misconfigured volumes, or incorrect ALB routing.

**Diagnosis**:

```bash
# Check ECS service events
aws ecs describe-services \
  --cluster development-monitoring-cluster \
  --services development-monitoring-prometheus \
  --query 'services[0].events[0:5]'

# Check task logs
aws logs tail /ecs/development-MonitoringInfra/tasks --follow

# Verify EFS mount targets are available
aws efs describe-mount-targets \
  --file-system-id <efs-id> \
  --query 'MountTargets[*].[AvailabilityZoneName,LifeCycleState]'
```

**Solution**: Ensure Layer 0 (EFS) completed successfully and initialisation Lambda ran.

#### Issue: Lambda Initialisation Timeout

```
Error: Custom resource initialization timed out
```

**Cause**: EFS mount taking longer than expected or network connectivity issues.

**Diagnosis**:

```bash
# Check Lambda logs
aws logs tail /aws/lambda/development-monitoring-efs-init --follow

# Verify mount targets are ready
aws efs describe-mount-targets \
  --file-system-id <efs-id>
```

**Solution**: Redeploy MonitoringEfsStack. Lambda will retry initialisation.

#### Issue: ALB Health Checks Failing

```
Warning: Target group has no healthy targets
```

**Cause**: Incorrect health check path, services not started, or security group blocking traffic.

**Diagnosis**:

```bash
# Check target health
aws elbv2 describe-target-health \
  --target-group-arn <target-group-arn>

# Verify security group allows ALB to ECS
aws ec2 describe-security-group-rules \
  --filters "Name=group-id,Values=<ecs-sg-id>" \
  --query 'SecurityGroupRules[?IsEgress==`false`]'
```

**Solution**: Verify security group rules in Layer 1 allow ALB-to-ECS traffic on correct ports.

### Rollback Strategies

#### Rollback Entire Deployment

If issues arise across multiple layers:

```bash
# Destroy in reverse order
cdk destroy development-MonitoringService  # Layer 2 first
cdk destroy development-MonitoringInfra    # Then Layer 1
cdk destroy development-MonitoringEfs      # Then Layer 0
cdk destroy development-Networking         # Finally foundation
```

#### Rollback Single Layer

If only one layer has issues:

```bash
# Roll back service layer only
cdk destroy development-MonitoringService

# Infrastructure and storage remain intact
# Redeploy with fixes:
cdk deploy development-MonitoringService
```

### Debugging Commands

```bash
# View CloudFormation events in real-time
aws cloudformation describe-stack-events \
  --stack-name development-MonitoringService \
  --query 'StackEvents[0:10].[Timestamp,ResourceStatus,LogicalResourceId,ResourceStatusReason]' \
  --output table

# Check for failed resources
aws cloudformation describe-stack-resources \
  --stack-name development-MonitoringService \
  --query 'StackResources[?ResourceStatus!=`CREATE_COMPLETE` && ResourceStatus!=`UPDATE_COMPLETE`]'

# List all stack outputs
aws cloudformation describe-stacks \
  --stack-name development-MonitoringService \
  --query 'Stacks[0].Outputs[*].[OutputKey,OutputValue]' \
  --output table
```

## Advanced Topics

### Environment-Specific Configuration

Different environments have different requirements. The architecture supports environment-aware defaults:

**Development**:
- Single ECS instance (minCapacity: 1).
- EFS lifecycle: transition to IA after 7 days.
- Removal policy: DESTROY (allows cleanup).
- Container Insights: Enabled for debugging.

**Production**:
- Multiple ECS instances (minCapacity: 2, desiredCapacity: 2).
- EFS lifecycle: transition to IA after 30 days.
- Removal policy: RETAIN (protects data).
- ALB deletion protection: Enabled.
- Access logs: Enabled for audit trail.

Configuration is defined in `config/environments.ts`:

```typescript
development: {
  account: "123456789012",
  region: "eu-west-1",
  vpcCidr: "10.1.0.0/16",
  natGateways: 0,
  isProduction: false,
  envName: "development",
}

production: {
  account: "987654321098",
  region: "eu-west-1",
  vpcCidr: "10.2.0.0/16",
  natGateways: 1,
  isProduction: true,
  envName: "production",
}
```

The layered architecture automatically adjusts each layer based on `isProduction` flag.

### Multi-Environment Deployment

Deploy to multiple environments sequentially:

```bash
# Development first
cdk deploy --context environment=development --all

# Then staging
cdk deploy --context environment=staging --all

# Finally production
cdk deploy --context environment=production --all
```

Each environment has isolated stacks with no cross-contamination.

### Stack Update Strategies

#### Zero-Downtime Service Updates

For production environments:

1. Ensure `desiredCapacity >= 2` in Layer 1.
2. Update service configuration in Layer 2.
3. Deploy Layer 2 only.

ECS performs rolling update:
- Starts new tasks with updated configuration.
- Waits for new tasks to pass health checks.
- Drains and stops old tasks.
- No service interruption.

#### Infrastructure Scaling Without Downtime

For scaling ECS cluster:

1. Increase `maxCapacity` in Layer 1.
2. Deploy Layer 1 only.
3. Auto Scaling Group adds new instances.
4. ECS redistributes tasks across instances.
5. Services continue running throughout.

### Cost Optimisation Through Layers

The layered architecture makes cost optimisation transparent:

**Layer 0 Costs** (Storage):
- EFS storage: Pay per GB-month.
- EFS Infrequent Access: Lower cost for older data.
- Lambda executions: One-time initialisation, negligible cost.

**Cost Control**: Adjust lifecycle policy to transition data to IA storage sooner.

```bash
# Change from 30 days to 7 days
cdk deploy development-MonitoringEfs
```

**Layer 1 Costs** (Infrastructure):
- EC2 instances: Primary cost driver.
- Application Load Balancer: Fixed cost regardless of traffic.
- NAT Gateway: Per-hour and per-GB charges.

**Cost Control**: Scale down capacity in non-production environments.

```bash
# Reduce to single instance for dev
cdk deploy development-MonitoringInfra
```

**Layer 2 Costs** (Services):
- CloudWatch Logs: Pay per GB ingested and stored.
- Container registry pulls: Minimal for private ECR.
- Data transfer: Between ECS and EFS (free in same AZ).

**Cost Control**: Reduce log retention or adjust log verbosity.

### Disaster Recovery

The layered architecture simplifies disaster recovery:

#### Scenario: Complete Region Failure

1. **Foundation**: Deploy NetworkingStack to new region.
2. **Layer 0**: Deploy MonitoringEfsStack (restore from backup or start fresh).
3. **Layer 1**: Deploy MonitoringInfraStack (provisions new compute).
4. **Layer 2**: Deploy MonitoringServiceStack (starts services with existing data).

Each layer can be recreated independently, speeding recovery.

#### Scenario: Corrupted EFS Data

1. Destroy Layer 2 (services).
2. Destroy Layer 0 (EFS).
3. Redeploy Layer 0 (fresh EFS).
4. Redeploy Layer 2 (services reconnect to new EFS).
5. Layer 1 (infrastructure) remains untouched.

### Cross-Account Monitoring

For centralised monitoring across multiple AWS accounts:

1. Deploy NetworkingStack in monitoring account (pipeline).
2. Deploy MonitoringEfsStack in monitoring account.
3. Deploy MonitoringInfraStack in monitoring account.
4. Deploy MonitoringServiceStack with cross-account targets.

Prometheus in the monitoring account scrapes metrics from other accounts using IAM role assumption.

## Summary

### Key Takeaways

1. **Three Independent Layers**: Storage, Infrastructure, Services deployed separately.
2. **Minimised Blast Radius**: Only deploy what changes, reducing risk and deployment time.
3. **Clear Dependencies**: Explicit stack dependencies prevent out-of-order deployments.
4. **Faster Iteration**: Service updates take 3-5 minutes instead of 15-20 minutes.
5. **Cost Transparency**: Each layer's costs are clearly attributed and optimisable.
6. **Safer Production Deployments**: Reduced scope of changes per deployment.

### Deployment Order Reference

```
1. development-Networking         (Foundation - VPC)
2. development-MonitoringEfs      (Layer 0 - Storage)
3. development-MonitoringInfra    (Layer 1 - Infrastructure)
4. development-MonitoringService  (Layer 2 - Services)
```

### Quick Reference

| Task | Command | Duration | Affects |
|------|---------|----------|---------|
| Update Grafana image | `cdk deploy development-MonitoringService` | 3-5 min | Services only |
| Scale ECS cluster | `cdk deploy development-MonitoringInfra` | 8-12 min | Infrastructure only |
| Adjust EFS policy | `cdk deploy development-MonitoringEfs` | 2-4 min | Storage only |
| Full deployment | `cdk deploy --all` | 20-30 min | All layers |

### Support

For issues or questions:

1. Check CloudFormation stack events in AWS Console.
2. Review ECS service events for task failures.
3. Examine CloudWatch Logs for service logs.
4. Verify SSM parameters are created correctly.
5. Ensure stack dependencies are met (deploy in order).
6. Check security group rules allow required traffic.
