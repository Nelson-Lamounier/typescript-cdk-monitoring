<!-- @format -->

# EFS Stack Verification Script

This directory contains verification scripts for testing and validating CDK stack deployments.

## `verify-efs-stack.sh`

A comprehensive verification script that validates the `MonitoringEfsStack` deployment after it has been deployed via CDK.

### Overview

The script performs the following checks:

1. **CloudFormation Stack Status** - Verifies stack is in `CREATE_COMPLETE` or `UPDATE_COMPLETE` state
2. **SSM Parameters** - Validates all expected SSM parameters are created with correct tiers, including initialization status
3. **EFS File System** - Verifies EFS file system exists and is properly configured
4. **EFS Mount Targets** - Checks mount targets are created in all availability zones
5. **EFS Access Point** - Validates access point configuration and POSIX permissions
6. **Security Group** - Reviews security group rules for EFS access
7. **Configuration Samples** - Displays sample configuration files from SSM

**Note:** The Lambda function used for EFS initialization is a CloudFormation Custom Resource that runs during stack creation and is automatically cleaned up after successful execution. This is expected behavior, so the script does not verify the Lambda function itself, but instead checks the initialization status stored in SSM Parameter Store.

### Prerequisites

- **AWS CLI** installed and configured
- **jq** installed (for JSON parsing)
- **AWS credentials** configured for the target account
- **MonitoringEfsStack** deployed via CDK

#### Installing Prerequisites

**macOS:**

```bash
# Install AWS CLI (if not installed)
brew install awscli

# Install jq
brew install jq
```

**Linux (Ubuntu/Debian):**

```bash
# Install AWS CLI
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip
sudo ./aws/install

# Install jq
sudo apt-get update && sudo apt-get install -y jq
```

**Verify installations:**

```bash
aws --version
jq --version
```

### Usage

#### Basic Usage

```bash
# Run with defaults (development, dev-account, eu-west-1)
./scripts/tests/verify-efs-stack.sh
```

#### Command-Line Options

```bash
# Specify environment and profile
./scripts/tests/verify-efs-stack.sh -e development -p dev-account

# Use long-form options
./scripts/tests/verify-efs-stack.sh --environment pipeline --profile pipeline-account

# Specify region
./scripts/tests/verify-efs-stack.sh -e production -p prod-account -r eu-west-1

# Show help
./scripts/tests/verify-efs-stack.sh --help
```

#### Environment Variables

You can also use environment variables instead of command-line arguments:

```bash
# Set environment variables
export ENVIRONMENT=development
export AWS_PROFILE=dev-account
export AWS_REGION=eu-west-1

# Run script (uses environment variables)
./scripts/tests/verify-efs-stack.sh
```

**Note:** Command-line arguments take precedence over environment variables.

#### Examples

**Development Environment:**

```bash
./scripts/tests/verify-efs-stack.sh -e development -p dev-account
```

**Pipeline Environment:**

```bash
./scripts/tests/verify-efs-stack.sh --environment pipeline --profile pipeline-account
```

**Production Environment:**

```bash
export ENVIRONMENT=production
export AWS_PROFILE=prod-account
./scripts/tests/verify-efs-stack.sh
```

**Different Region:**

```bash
./scripts/tests/verify-efs-stack.sh -e development -p dev-account -r us-east-1
```

### Script Output

The script provides colour-coded output:

- **Green (✅)** - Check passed
- **Red (❌)** - Check failed
- **Yellow (⚠️)** - Warning or partial failure
- **Blue** - Section headers

#### Sample Output

```
================================================================
EFS Stack Verification - development
================================================================
Profile: dev-account
Region: eu-west-1
Stack Name: development-MonitoringEfs
Lambda Name: development-monitoring-efs-init
Timestamp: 2026-01-10 10:30:00 UTC

1. CloudFormation Stack Status
--------------------------------------------------------------
✅ Stack Status: CREATE_COMPLETE

Stack Outputs:
--------------------------------------------------------------
|         Key          |                    Value                    |
|----------------------|--------------------------------------------|
|  FileSystemId        |  fs-0123456789abcdef0                       |
|  AccessPointId      |  fsap-0123456789abcdef0                     |
|  SecurityGroupId    |  sg-0123456789abcdef0                       |
...

2. Lambda Initialization Status
--------------------------------------------------------------
✅ Lambda Function: Active
...
```

### Verification Checks

#### 1. CloudFormation Stack

- Verifies stack exists and is in a valid state
- Retrieves stack outputs (FileSystemId, AccessPointId, SecurityGroupId)
- Displays stack status and outputs in a table

#### 2. SSM Parameters

- Validates all expected SSM parameters exist
- Checks parameter tiers (Standard or Advanced)
- Verifies initialization status parameter (indicates Lambda execution completed)

#### 2. SSM Parameters

Validates the following SSM parameters exist:

- `/monitoring/{environment}/prometheus-config`
- `/monitoring/{environment}/prometheus-config-yaml`
- `/monitoring/{environment}/grafana-datasource-config`
- `/monitoring/{environment}/grafana-datasource-config-yaml`
- `/monitoring/{environment}/grafana-dashboard-config`
- `/monitoring/{environment}/grafana-dashboard-config-yaml`
- `/monitoring/{environment}/efs-setup-script`
- `/monitoring/{environment}/efs/config/file-system-id`
- `/monitoring/{environment}/efs/config/access-point-id`
- `/monitoring/{environment}/efs/config/security-group-id`
- `/monitoring/{environment}/efs/config/availability-zone`
- `/monitoring/{environment}/efs-initialization-status` (indicates Lambda execution completed)

For each parameter, displays:

- Parameter tier (Standard or Advanced)
- Value size in characters

#### 3. EFS File System

- Verifies file system exists
- Displays file system details:
  - File System ID
  - Name
  - Lifecycle State
  - Performance Mode
  - Throughput Mode
  - Encryption status
  - Size in bytes
  - Creation time

#### 4. EFS Mount Targets

- Lists all mount targets
- Displays for each mount target:
  - Mount Target ID
  - Subnet ID
  - IP Address
  - Availability Zone
  - Lifecycle State
  - Security Groups

#### 5. EFS Access Point

- Verifies access point exists
- Displays access point details:
  - Access Point ID
  - Name
  - Lifecycle State
  - Root Directory Path
  - POSIX User (UID, GID)
  - Owner (UID, GID)
  - Permissions

#### 6. Security Group

- Verifies security group exists
- Displays inbound and outbound rules
- Shows protocol, ports, and source/destination

#### 7. Configuration Samples

- Displays first 500 characters of:
  - Prometheus configuration YAML
  - EFS setup script

### Exit Codes

- **0** - All checks passed
- **1** - One or more checks failed

### Troubleshooting

#### Stack Not Found

```
Error: Stack Status: NOT_FOUND
```

**Solution:**

1. Verify the stack name matches: `${ENVIRONMENT}-MonitoringEfs`
2. Check the stack is deployed:
   ```bash
   aws cloudformation list-stacks \
     --profile ${AWS_PROFILE} \
     --region ${REGION} \
     --query 'StackSummaries[?contains(StackName, `MonitoringEfs`)]'
   ```
3. Ensure you're using the correct AWS profile and region

#### Initialization Status Not Found

```
⚠️  Initialization status parameter not found
```

**Solution:**

1. **This is normal if initialization is still in progress** - The Lambda Custom Resource may still be running
2. Check CloudFormation stack events for Custom Resource execution:
   ```bash
   aws cloudformation describe-stack-events \
     --stack-name ${ENVIRONMENT}-MonitoringEfs \
     --profile ${AWS_PROFILE} \
     --region ${REGION} \
     --query 'StackEvents[?ResourceType==`Custom::EfsInit`]' \
     --output table
   ```
3. Wait a few minutes and re-run the verification script
4. If initialization fails, check CloudFormation stack events for error details

#### Missing SSM Parameters

```
⚠️  X parameters missing
```

**Solution:**

1. Check EFS initialization status parameter:
   ```bash
   aws ssm get-parameter \
     --name "/monitoring/${ENVIRONMENT}/efs-initialization-status" \
     --profile ${AWS_PROFILE} \
     --region ${REGION} \
     --query 'Parameter.Value' \
     --output text | jq '.'
   ```
2. Check CloudFormation stack events for Custom Resource errors:
   ```bash
   aws cloudformation describe-stack-events \
     --stack-name ${ENVIRONMENT}-MonitoringEfs \
     --profile ${AWS_PROFILE} \
     --region ${REGION} \
     --query 'StackEvents[?ResourceType==`Custom::EfsInit` && ResourceStatus==`CREATE_FAILED`]' \
     --output table
   ```
3. Verify the Lambda Custom Resource has permissions to create SSM parameters
4. Review CloudFormation custom resource status in the AWS Console

#### EFS File System Not Found

```
Error: EFS File System not found
```

**Solution:**

1. Verify FileSystemId from stack outputs:
   ```bash
   aws cloudformation describe-stacks \
     --stack-name ${ENVIRONMENT}-MonitoringEfs \
     --profile ${AWS_PROFILE} \
     --region ${REGION} \
     --query 'Stacks[0].Outputs[?OutputKey==`FileSystemId`].OutputValue' \
     --output text
   ```
2. Check EFS file system exists:
   ```bash
   aws efs describe-file-systems \
     --file-system-id <FileSystemId> \
     --profile ${AWS_PROFILE} \
     --region ${REGION}
   ```

### Integration with CI/CD

The script can be integrated into CI/CD pipelines:

```yaml
# Example GitHub Actions workflow step
- name: Verify EFS Stack
  run: |
    chmod +x scripts/tests/verify-efs-stack.sh
    ./scripts/tests/verify-efs-stack.sh \
      -e ${{ env.ENVIRONMENT }} \
      -p ${{ secrets.AWS_PROFILE }} \
      -r ${{ env.AWS_REGION }}
```

### Related Documentation

- [MonitoringEfsStack Deployment Guide](../../../lib/stacks/monitoring/monitoring-efs-stack.ts)
- [CDK Application Deployment Guide](../../../bin/README.md)
- [EFS Initialization Lambda](../../../lambda/handlers/efs-initialisation.ts)

### Support

For issues or questions:

1. Check the troubleshooting section above
2. Review CloudFormation stack events
3. Check Lambda function logs
4. Verify AWS credentials and permissions
5. Ensure all prerequisites are installed
