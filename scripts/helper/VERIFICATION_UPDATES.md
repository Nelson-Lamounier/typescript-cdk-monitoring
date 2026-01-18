# Infrastructure Verification Script Updates

## Overview

Updated `verify-infra-stack.sh` to comprehensively verify the MonitoringInfraStack is ready for MonitoringServiceStack deployment, with special focus on EFS mounting and SSM State Manager associations.

## Latest Updates (2026-01-12)

### Critical Bug Fixes

#### 1. SSM Parameter Path Correction
**Issue**: Script was checking wrong paths for infrastructure and storage parameters.

**Root Cause**: The `SsmParametersConstruct` adds a `/config/` category to all custom parameters:
```typescript
// In config-constants.ts
CUSTOM: "config",  // Adds /config/ to parameter path
```

**Impact**: All infrastructure and EFS parameters were being created at paths like:
- `/monitoring/development/infra/config/cluster-name` (actual)
- `/monitoring/development/efs/config/file-system-id` (actual)

But the script was checking:
- `/monitoring/development/infra/cluster-name` (wrong)
- `/monitoring/development/storage/efs-id` (wrong)

**Fix**: Updated parameter paths in sections 10 and 14:
```bash
# Infrastructure parameters now use correct path:
SSM_PREFIX="/monitoring/${ENVIRONMENT}/infra/config"

# Storage parameters now check EFS stack path:
STORAGE_PARAMS_EFS_PATH=(
  "/monitoring/${ENVIRONMENT}/efs/config/file-system-id"
  "/monitoring/${ENVIRONMENT}/efs/config/access-point-id"
  # ...
)
```

#### 2. New Section 13: Actual EFS Mount Verification
**Issue**: Script relied on SSM Association status which can be stale/incomplete.

**Problem**: 
- SSM Association status of "Pending" or "Failed" doesn't mean EFS isn't mounted
- Association status is point-in-time and may not reflect current instance state
- Users were seeing false negatives like "EFS not mounted" when it was actually working

**Solution**: Added new section that runs actual SSM commands to verify EFS mount:
```bash
# Section 13 now sends SSM Run Command to check:
1. df -h /mnt/efs           # Is EFS in the filesystem?
2. mountpoint -q /mnt/efs   # Is it a valid mount point?
3. ls -la /mnt/efs          # What directories exist?
```

**Output**: Shows actual command output with directory structure:
```
✅ EFS is mounted at /mnt/efs
   ├─ prometheus-data/ exists
   ├─ grafana-data/ exists
   └─ config/ exists
```

#### 3. Smarter Readiness Check (Section 15)
**Issue**: Readiness check was too strict, failing deployment when infrastructure was ready.

**Changes**:
- Changed from hard failures to warnings for SSM Association status
- Now trusts actual mount verification (section 13) over association status
- Provides helpful context messages:
  ```
  ⚠️  EFS mount association status: Pending
      This may be normal - check actual mount status in section 13 above
  ```

**Philosophy**: 
- **OLD**: Association must show "Success" → blocks deployment
- **NEW**: Check actual state, warn about association → allows deployment if verified

### Technical Details

#### Why SSM Associations Can Be Misleading

SSM State Manager associations have lifecycle states:
- `Pending`: Initial state or waiting to run
- `Success`: Last execution succeeded
- `Failed`: Last execution failed

However:
- Association can show `Pending` while EFS is already mounted from previous run
- Association can show `Failed` if one instance failed but others succeeded
- Association status doesn't reflect current real-time instance state

#### The Right Way to Verify EFS

Run actual SSM commands to check instance state:
```bash
aws ssm send-command \
  --document-name "AWS-RunShellScript" \
  --instance-ids "$INSTANCE_ID" \
  --parameters 'commands=["df -h /mnt/efs && ls -la /mnt/efs"]' \
  --profile dev-account --region eu-west-1
```

This provides:
- Real-time mount status
- Directory structure verification
- Actual filesystem state

---

## Changes Made

### 1. EFS Mount Target & Subnet Verification (New Section 8)

**Purpose**: Verify EFS is correctly configured and accessible from EC2 instances

**Checks**:
- EFS File System ID retrieved from SSM parameters
- EFS availability zone matches instance placement
- Mount targets exist and are in `available` state
- Mount targets are in the same AZ as EC2 instances (critical for performance)
- Cross-AZ warnings if mount targets and instances are misaligned

**Why This Matters**:
- EFS mounting MUST succeed for Prometheus and Grafana to persist data
- Cross-AZ data transfer incurs additional charges (~£0.01/GB)
- Mount targets must be in the same subnet group as instances

### 2. Enhanced SSM State Manager Verification (Updated Section 9)

**Purpose**: Verify all SSM associations have executed successfully on instances

**Critical Associations Checked**:

#### EFS Mount Association (`*-efs-mount`)
- **Status**: Must be `Success` for service deployment
- **Verification**: Checks individual instance execution results
- **Impact**: Services CANNOT start without EFS mounted
- **Script**: Mounts EFS at `/mnt/efs` using `amazon-efs-utils`

#### EFS Initialization Association (`*-efs-init`)
- **Status**: Must be `Success` for service deployment
- **Verification**: 
  - Checks association status
  - Validates directory structure exists on EFS
  - Verifies config files downloaded from SSM parameters
- **Impact**: Prometheus/Grafana config files MUST be present
- **Script**: Creates directories, sets permissions, downloads config files

#### ECS Agent Configuration (`*-ecs-agent-config`)
- **Status**: Should be `Success` (warning if pending)
- **Impact**: Instances won't join ECS cluster without this
- **Script**: Installs Docker, configures ECS agent, starts service with retry logic

#### CloudWatch Agent (`*-cloudwatch-agent-install`, `*-cloudwatch-agent-config`)
- **Status**: Optional (warning if not successful)
- **Impact**: Log collection won't work without this
- **Script**: Installs CloudWatch agent, configures log collection

**Execution Verification**:
- Checks association status at aggregate level
- Verifies execution results on individual instances
- Shows recent failures in verbose mode
- Performs live verification via SSM commands (checks if EFS directories exist)

### 3. Comprehensive SSM Parameter Verification (Updated Section 10)

**Purpose**: Ensure all parameters required by ServiceStack are present

**Parameter Categories**:

#### Infrastructure Parameters (`/monitoring/{env}/infra/*`)
- `cluster-name` - ECS cluster name (REQUIRED)
- `cluster-arn` - ECS cluster ARN (REQUIRED)
- `alb-dns` - Load balancer DNS (REQUIRED)
- `listener-arn` - ALB listener ARN (REQUIRED)
- `asg-name` - Auto Scaling Group name (REQUIRED)

#### Storage Parameters (`/monitoring/{env}/storage/*`)
- `efs-id` - EFS File System ID (REQUIRED)
- `access-point-id` - EFS Access Point ID (REQUIRED)
- `efs-sg-id` - EFS Security Group ID (REQUIRED)
- `efs-az` - EFS Availability Zone (REQUIRED)

#### Configuration Parameters (`/monitoring/{env}/*`)
- `prometheus-config-yaml` - Prometheus configuration file (REQUIRED)
- `grafana-datasource-config-yaml` - Grafana datasource config (REQUIRED)
- `grafana-dashboard-config-yaml` - Grafana dashboard config (REQUIRED)

**Verification**:
- Checks existence of all parameters
- Reports missing parameters as CRITICAL failures
- Provides count summary (e.g., "12/12 parameters found")

### 4. Service Stack Deployment Readiness (New Section 14)

**Purpose**: Final go/no-go decision for MonitoringServiceStack deployment

**Critical Prerequisites Checked**:
1. ✅ EFS mount association successful
2. ✅ EFS initialization association successful
3. ✅ ECS cluster active with registered instances
4. ✅ ALB active and operational
5. ✅ ALB listener configured
6. ✅ All required SSM parameters present

**Optional Checks**:
- ECS agent configuration (warning if not complete)
- CloudWatch agent configuration (informational)

**Output**:
- **SUCCESS**: Green banner with deployment instructions
- **FAILURE**: Red banner with specific issues and troubleshooting steps

### 5. Updated Script Documentation

**Header**:
- Added comprehensive overview of critical checks
- Listed service stack prerequisites
- Added exit code documentation
- Referenced related documentation files

**Help Message**:
- Added detailed check list
- Explained critical prerequisites
- Included troubleshooting guidance
- Listed common issues and solutions

**Final Summary**:
- Clearer success/failure messaging
- Specific deployment readiness indication
- Comprehensive troubleshooting commands
- Links to documentation

## Script Architecture

```
verify-infra-stack.sh
├── 1. CloudFormation Stack Status
├── 2. ECS Cluster
├── 3. Auto Scaling Group & EC2 Instances
├── 4. Application Load Balancer
├── 5. ALB Listener & Target Groups
├── 6. Security Groups
├── 7. CloudWatch Log Groups
├── 8. EFS Mount Target & Subnet Verification (NEW)
├── 9. SSM State Manager Associations (ENHANCED)
│   ├── EFS Mount (CRITICAL)
│   ├── EFS Initialization (CRITICAL)
│   ├── ECS Agent Configuration
│   └── CloudWatch Agent (Install + Config)
├── 10. SSM Parameters (ENHANCED)
│    ├── Infrastructure Parameters
│    ├── Storage Parameters
│    └── Configuration Parameters
├── 11. EventBridge Rules
├── 12. Bootstrap Metadata
├── 13. ALB Health Check
├── 14. Service Stack Deployment Readiness (NEW)
└── Summary & Exit
```

## Usage

### Basic Verification
```bash
./scripts/tests/verify-infra-stack.sh -e development -p dev-account
```

### Verbose Mode (Recommended for Troubleshooting)
```bash
./scripts/tests/verify-infra-stack.sh -e development -p dev-account -v
```

### After Deployment Wait Time
SSM associations take 5-10 minutes to complete after initial deployment.
The script will show warnings if associations are still in progress.

## Exit Codes

- `0` - All checks passed, ready for service deployment
- `1` - Failed checks or infrastructure not ready
- `2` - Invalid arguments or AWS configuration

## Critical Failure Scenarios

### EFS Mount Failed
**Symptoms**:
- EFS mount association status: `Failed` or `Pending`
- Instances cannot mount `/mnt/efs`

**Troubleshooting**:
1. Check EFS security group allows NFS (port 2049) from ECS instances
2. Verify mount targets exist in instance availability zones
3. Review SSM association execution logs
4. Check instance IAM role has EFS permissions

### EFS Initialization Failed
**Symptoms**:
- EFS init association status: `Failed`
- Config files missing from `/mnt/efs/config`

**Troubleshooting**:
1. Verify EFS is mounted: `mountpoint -q /mnt/efs`
2. Check SSM parameters exist for config files
3. Verify instance IAM role can read SSM parameters
4. Review association execution logs

### No Container Instances Registered
**Symptoms**:
- ECS cluster shows 0 registered instances
- Tasks cannot be scheduled

**Troubleshooting**:
1. Check Auto Scaling Group health
2. Review ECS agent logs: `/var/log/ecs/ecs-agent.log`
3. Verify ECS agent configuration association succeeded
4. Check instance can reach ECS endpoint

## Service Stack Deployment

### When Ready
```bash
# All checks passed
cdk deploy development-MonitoringService --profile dev-account
```

### If Not Ready
Review specific failure messages in the verification output.
Each failure includes troubleshooting steps and AWS CLI commands.

## Related Files

- `scripts/tests/verify-efs-stack.sh` - Verifies EFS stack deployment
- `bin/README.md` - Deployment architecture and guide
- `lib/stacks/monitoring/infra-stack.ts` - Infrastructure stack code
- `lib/constructs/compute/ssm/ssm-state-manager-construct.ts` - SSM associations

## Future Enhancements

Potential additions:
- Service endpoint testing (curl ALB paths)
- EFS performance mode verification
- Security group rule validation
- IAM permission verification
- Cost estimation for current configuration
