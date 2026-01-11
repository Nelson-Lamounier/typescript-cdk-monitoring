<!-- @format -->

# EFS Stack Verification Script

This directory contains verification scripts for testing and validating CDK stack deployments.

## `verify-efs-stack.sh`

A comprehensive verification script that validates the `MonitoringEfsStack` deployment after it has been deployed via CDK.

### Overview

The script performs the following checks:

1. **CloudFormation Stack Status** - Verifies stack is in `CREATE_COMPLETE` or `UPDATE_COMPLETE` state
2. **SSM Automation Document** - Validates the automation document exists and is active
3. **SSM Parameters** - Validates all expected SSM parameters are created (JSON configs, YAML configs, discovery params)
4. **SSM Automation Executions** - Checks automation document execution history and status
5. **EFS File System** - Verifies EFS file system exists and is properly configured
6. **EFS Mount Targets** - Checks mount targets are created in all availability zones
7. **EFS Access Point** - Validates access point configuration and POSIX permissions
8. **Security Group** - Reviews security group rules for EFS access
9. **Configuration Samples** - Displays sample configuration files from SSM

### Architecture

The EFS Stack uses SSM Automation Documents for initialization instead of Lambda functions:

1. **EFS Stack Deployment**:

   - Creates EFS resources (file system, access points, security groups)
   - Creates JSON configuration parameters in SSM
   - Creates SSM Automation Document for configuration conversion
   - Executes the automation document once

2. **SSM Automation Document**:

   - Converts JSON configurations to YAML format
   - Generates EFS setup scripts
   - Stores all outputs in SSM Parameter Store

3. **Benefits over Lambda**:
   - No cold starts
   - No VPC dependencies
   - Native CloudFormation integration
   - No Lambda function packaging
   - Better integration with SSM State Manager

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
Timestamp: 2026-01-11 10:30:00 UTC

1. CloudFormation Stack Status
--------------------------------------------------------------
✅ Stack Status: CREATE_COMPLETE

Stack Outputs:
--------------------------------------------------------------
|         Key          |                    Value                    |
|----------------------|--------------------------------------------|
|  FileSystemId        |  fs-0123456789abcdef0                       |
|  AccessPointId       |  fsap-0123456789abcdef0                     |
|  SecurityGroupId     |  sg-0123456789abcdef0                       |
...

2. SSM Automation Document
--------------------------------------------------------------
✅ SSM Automation Document: Active
   Document Name: development-MonitoringEfs-development-efs-init
   Document Type: Automation
   Document Version: 1

SSM Automation Executions:
--------------------------------------------------------------
✅ Execution: 12345678-abcd-efgh-ijkl-123456789012
   Status: Success
   Started: 2026-01-11T10:25:00Z

3. SSM Parameters
--------------------------------------------------------------
JSON Configuration Parameters (created by EFS Stack):
✅ /monitoring/development/prometheus-config (1234 chars)
✅ /monitoring/development/grafana-datasource-config (567 chars)
✅ /monitoring/development/grafana-dashboard-config (890 chars)

YAML Configuration Parameters (created by SSM Automation Document):
✅ /monitoring/development/prometheus-config-yaml (1345 chars)
✅ /monitoring/development/grafana-datasource-config-yaml (678 chars)
✅ /monitoring/development/grafana-dashboard-config-yaml (901 chars)
✅ /monitoring/development/efs-setup-script (2345 chars)
...
```

### Verification Checks

#### 1. CloudFormation Stack

- Verifies stack exists and is in a valid state
- Retrieves stack outputs (FileSystemId, AccessPointId, SecurityGroupId)
- Displays stack status and outputs in a table

#### 2. SSM Automation Document

- Verifies the automation document exists and is Active
- Displays document name, type, and version
- Lists recent automation executions with status (Success/Failed/In Progress)
- Shows execution timestamps

#### 3. SSM Parameters

Validates three categories of SSM parameters:

**JSON Configuration Parameters** (created by EFS Stack during deployment):

- `/monitoring/{environment}/prometheus-config`
- `/monitoring/{environment}/grafana-datasource-config`
- `/monitoring/{environment}/grafana-dashboard-config`

**YAML Configuration Parameters** (created by SSM Automation Document):

- `/monitoring/{environment}/prometheus-config-yaml`
- `/monitoring/{environment}/grafana-datasource-config-yaml`
- `/monitoring/{environment}/grafana-dashboard-config-yaml`
- `/monitoring/{environment}/efs-setup-script`

**EFS Discovery Parameters** (created by EFS Stack):

- `/monitoring/{environment}/efs/file-system-id`
- `/monitoring/{environment}/efs/access-point-id`
- `/monitoring/{environment}/efs/security-group-id`
- `/monitoring/{environment}/efs/availability-zone`

For each parameter, displays:

- Parameter name and status (✅ exists or ❌ missing)
- Value size in characters
- Parameter value (for discovery parameters)

#### 4. EFS File System

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

#### Automation Document Not Found

```
❌ SSM Automation Document: NOT_FOUND
```

**Solution:**

1. Verify the document name matches: `{StackName}-{environment}-efs-init`
2. Check the document exists:
   ```bash
   aws ssm describe-document \
     --name "${STACK_NAME}-${ENVIRONMENT}-efs-init" \
     --profile ${AWS_PROFILE} \
     --region ${REGION}
   ```
3. If missing, the stack deployment may have failed. Check CloudFormation events
4. Re-deploy the stack if necessary

#### Automation Execution Failed

```
❌ Execution: 12345678-abcd-efgh-ijkl-123456789012
   Status: Failed
```

**Solution:**

1. Get detailed execution information:
   ```bash
   aws ssm get-automation-execution \
     --automation-execution-id <ExecutionId> \
     --profile ${AWS_PROFILE} \
     --region ${REGION}
   ```
2. Check step-level execution details:
   ```bash
   aws ssm describe-automation-step-executions \
     --automation-execution-id <ExecutionId> \
     --profile ${AWS_PROFILE} \
     --region ${REGION}
   ```
3. Common failure reasons:
   - JSON configuration parameters missing or invalid
   - IAM role lacks permissions to read/write SSM parameters
   - Invalid JSON format in source parameters
4. Re-execute the automation manually:
   ```bash
   aws ssm start-automation-execution \
     --document-name "${STACK_NAME}-${ENVIRONMENT}-efs-init" \
     --parameters "FileSystemId=${FILE_SYSTEM_ID},AccessPointId=${ACCESS_POINT_ID},Environment=${ENVIRONMENT}" \
     --profile ${AWS_PROFILE} \
     --region ${REGION}
   ```

#### Missing YAML Parameters

```
⚠️  YAML parameters missing
Note: YAML parameters are created by SSM Automation Document.
      If they're missing, the automation may not have executed yet.
```

**Solution:**

1. **This is normal if automation hasn't executed yet** - The SSM Association may trigger on the next schedule
2. Check automation execution status (see section above)
3. Wait a few minutes and re-run the verification script
4. If execution failed, check the troubleshooting steps for "Automation Execution Failed"
5. Manually execute the automation if needed (command shown above)

#### Missing SSM Parameters

```
⚠️  X parameters missing
```

**Solution:**

1. Check JSON configuration parameters exist first (automation source):
   ```bash
   aws ssm get-parameter \
     --name "/monitoring/${ENVIRONMENT}/prometheus-config" \
     --profile ${AWS_PROFILE} \
     --region ${REGION}
   ```
2. Check automation document execution status:
   ```bash
   aws ssm describe-automation-executions \
     --filters "Key=DocumentNamePrefix,Values=${STACK_NAME}-${ENVIRONMENT}-efs-init" \
     --profile ${AWS_PROFILE} \
     --region ${REGION}
   ```
3. Review automation execution logs for errors
4. Verify the SSM Automation role has permissions to read source parameters and write output parameters
5. If automation hasn't run, manually trigger it (command shown in troubleshooting above)

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

- [MonitoringEfsStack](../../lib/stacks/monitoring/efs-stack.ts)
- [EFS Initialization Document Construct](../../lib/constructs/ssm/efs-initialization-document.ts)
- [SSM Automation Document Migration Guide](../../MIGRATION_EFS_LAMBDA_TO_SSM.md)
- [CDK Application Deployment Guide](../../bin/README.md)

### Support

For issues or questions:

1. Check the troubleshooting section above
2. Review CloudFormation stack events
3. Check SSM Automation execution logs
4. Verify AWS credentials and permissions
5. Ensure all prerequisites are installed
6. Review the SSM Automation Document in the AWS Console
