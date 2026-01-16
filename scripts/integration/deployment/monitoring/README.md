<!-- @format -->

# Monitoring Stack Verification Scripts

This directory contains verification scripts for testing and validating CDK stack deployments and diagnosing runtime issues.

## Available Scripts

### `verify-efs-stack.sh`
Validates the MonitoringEfsStack deployment (storage layer)

### `verify-networking-stack.ts`
Validates the NetworkingStack deployment (VPC, subnets, security groups)

### `verify-infra-stack.ts`
Validates the MonitoringInfraStack deployment (ECS cluster, ALB, Auto Scaling)

### `verify-grafana-prometheus-connectivity.ts`
**NEW**: Diagnoses Grafana-Prometheus connectivity issues

---

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

---

## `verify-grafana-prometheus-connectivity.ts`

A comprehensive TypeScript diagnostic script that troubleshoots Grafana-Prometheus connectivity issues in the monitoring infrastructure.

### What It Checks

The script performs 10 comprehensive checks:

1. **Prometheus Service Status** - Verifies Prometheus ECS task is running
2. **Grafana Service Status** - Verifies Grafana ECS task is running  
3. **Network Mode Configuration** - Ensures both containers use bridge mode (not host)
4. **Port Mappings** - Validates Prometheus port 9090 is correctly mapped
5. **Security Group Rules** - Checks port 9090 is accessible within VPC
6. **Grafana Datasource Configuration** - Verifies HOST_IP_PLACEHOLDER was replaced
7. **Prometheus Accessibility** - Tests actual HTTP connectivity to Prometheus
8. **Datasource IP Match** - Ensures datasource uses correct EC2 instance IP
9. **Service Startup Order** - Checks if Prometheus started before Grafana
10. **Container Logs** - Analyses recent CloudWatch logs for errors

### Error Diagnosed

This script specifically addresses the error:

```
Post "http://10.1.0.202:9090/prometheus/api/v1/query": dial tcp 10.1.0.202:9090: connect: connection refused
```

### Prerequisites

- **Node.js** and **ts-node** installed
- **AWS CLI** configured with appropriate credentials
- **MonitoringServiceStack** deployed
- IAM permissions for:
  - ECS (DescribeClusters, DescribeTasks, ListTasks)
  - EC2 (DescribeInstances, DescribeSecurityGroups)
  - SSM (GetParameter, SendCommand, GetCommandInvocation)
  - CloudWatch Logs (FilterLogEvents)

### Usage

#### Basic Usage

```bash
# Run with TypeScript
ts-node scripts/integration/deployment/monitoring/verify-grafana-prometheus-connectivity.ts \
  --environment development \
  --profile dev-account

# Or if compiled to JavaScript
node dist/scripts/integration/deployment/monitoring/verify-grafana-prometheus-connectivity.js \
  --environment development \
  --profile dev-account
```

#### Command-Line Options

```bash
-e, --environment <env>  Environment name (development|staging|production|pipeline)
                         Default: development
                         
-r, --region <region>    AWS region
                         Default: eu-west-1
                         
-p, --profile <profile>  AWS CLI profile to use
                         Optional (uses default credentials if not specified)
                         
-v, --verbose           Enable verbose output with detailed diagnostics
                         Default: false
```

#### Examples

**Development Environment:**

```bash
ts-node scripts/integration/deployment/monitoring/verify-grafana-prometheus-connectivity.ts \
  -e development \
  -p dev-account
```

**With Verbose Output:**

```bash
ts-node scripts/integration/deployment/monitoring/verify-grafana-prometheus-connectivity.ts \
  -e development \
  -p dev-account \
  -v
```

**Production Environment:**

```bash
ts-node scripts/integration/deployment/monitoring/verify-grafana-prometheus-connectivity.ts \
  -e production \
  -p prod-account \
  -r eu-west-1
```

### Script Output

The script provides colour-coded output organised into 10 verification steps:

**Example Output:**

```
================================================================
Grafana-Prometheus Connectivity Verification - development
================================================================

Initialising AWS clients...
ℹ️  INFO: Using AWS profile: dev-account
ℹ️  INFO: AWS Account: 123456789012
ℹ️  INFO: Region: eu-west-1
ℹ️  INFO: Environment: development

Step 1: Retrieving cluster information...
────────────────────────────────────────
✅ Cluster: development-monitoring-monitoring-cluster

Step 2: Retrieving EC2 instance information...
────────────────────────────────────────
✅ Instance ID: i-0123456789abcdef0
ℹ️  INFO: Private IP: 10.1.0.202
ℹ️  INFO: Security Groups: sg-0123456789abcdef0

Step 3: Checking Prometheus service...
────────────────────────────────────────
✅ Prometheus container is running
ℹ️  INFO: Network Mode: bridge
ℹ️  INFO: Port Mappings: [{"hostPort":9090,"containerPort":9090}]

Step 4: Checking Grafana service...
────────────────────────────────────────
✅ Grafana container is running
ℹ️  INFO: Network Mode: bridge

Step 5: Verifying network mode configuration...
────────────────────────────────────────
✅ ✓ Container Network Mode: Prometheus (bridge) and Grafana (bridge) network modes configured correctly

Step 6: Verifying port mappings...
────────────────────────────────────────
✅ ✓ Port Mappings: Prometheus port 9090 correctly mapped to host port 9090

Step 7: Checking security group rules...
────────────────────────────────────────
✅ ✓ Security Group Rules: Security group allows traffic on port 9090 from VPC

Step 8: Verifying Grafana datasource configuration...
────────────────────────────────────────
❌ ✗ Datasource Configuration: HOST_IP_PLACEHOLDER was NOT replaced with actual EC2 private IP

Details:
────────────────────────────────────────────────────────────────
apiVersion: 1
datasources:
  - name: Prometheus
    type: prometheus
    access: proxy
    url: "http://HOST_IP_PLACEHOLDER:9090/prometheus"
    isDefault: true
────────────────────────────────────────────────────────────────

ℹ️  INFO: Remediation:
The EFS initialization script should replace HOST_IP_PLACEHOLDER with the EC2 instance's private IP. Check if the EFS init association executed successfully. 

Run manually: PRIVATE_IP=$(curl -s http://169.254.169.254/latest/meta-data/local-ipv4) && sed -i "s/HOST_IP_PLACEHOLDER/$PRIVATE_IP/g" /mnt/efs/config/grafana/provisioning/datasources/prometheus.yml

Step 9: Testing Prometheus accessibility...
────────────────────────────────────────
✅ ✓ Prometheus Accessibility: Prometheus is accessible on both localhost and private IP (port 9090)

Step 10: Checking service startup order...
────────────────────────────────────────
✅ ✓ Service Startup Order: Prometheus started before Grafana (or at similar time), which is correct

================================================================
VERIFICATION SUMMARY
================================================================
Total Checks: 10
✅ Passed: 9
❌ Failed: 1

Overall Status: UNHEALTHY

Failed Checks - Action Required:

1. Datasource Configuration
   Issue: HOST_IP_PLACEHOLDER was NOT replaced with actual EC2 private IP
   Action: The EFS initialization script should replace HOST_IP_PLACEHOLDER with the EC2 instance's private IP. Check if the EFS init association executed successfully. 
           
           Run manually: PRIVATE_IP=$(curl -s http://169.254.169.254/latest/meta-data/local-ipv4) && sed -i "s/HOST_IP_PLACEHOLDER/$PRIVATE_IP/g" /mnt/efs/config/grafana/provisioning/datasources/prometheus.yml

❌ ERROR: CONNECTIVITY VERIFICATION FAILED - Critical issues detected
```

### Common Issues Detected

#### Issue 1: HOST_IP_PLACEHOLDER Not Replaced

**Symptom:**
```
Datasource Configuration: HOST_IP_PLACEHOLDER was NOT replaced
```

**Root Cause:**
The EFS initialization SSM Association hasn't executed successfully, or the sed replacement command failed.

**Fix:**
1. Check EFS init association status:
   ```bash
   aws ssm describe-association-executions \
     --association-id <assoc-id> \
     --profile dev-account \
     --region eu-west-1
   ```

2. Manually replace placeholder:
   ```bash
   # Via SSM Session Manager
   aws ssm start-session \
     --target i-0123456789abcdef0 \
     --profile dev-account \
     --region eu-west-1
   
   # Inside the instance:
   PRIVATE_IP=$(curl -s http://169.254.169.254/latest/meta-data/local-ipv4)
   sed -i "s/HOST_IP_PLACEHOLDER/$PRIVATE_IP/g" /mnt/efs/config/grafana/provisioning/datasources/prometheus.yml
   
   # Restart Grafana
   docker restart $(docker ps -q --filter name=grafana)
   ```

3. Force EFS init association re-execution:
   ```bash
   aws ssm start-associations-once \
     --association-ids <efs-init-assoc-id> \
     --profile dev-account \
     --region eu-west-1
   ```

#### Issue 2: Prometheus Not Accessible

**Symptom:**
```
Prometheus Accessibility: Prometheus not accessible on localhost:9090
```

**Possible Causes:**
- Prometheus container not running
- Port 9090 not bound to host
- Network mode misconfiguration

**Fix:**
1. Check Prometheus container status:
   ```bash
   docker ps | grep prometheus
   ```

2. Check port bindings:
   ```bash
   docker inspect <container-id> | grep HostPort
   netstat -tulpn | grep 9090
   ```

3. View Prometheus logs:
   ```bash
   aws logs tail /aws/ecs/development-prometheus \
     --follow \
     --profile dev-account \
     --region eu-west-1
   ```

4. Restart Prometheus service:
   ```bash
   aws ecs update-service \
     --cluster development-monitoring-monitoring-cluster \
     --service development-prometheus \
     --force-new-deployment \
     --profile dev-account \
     --region eu-west-1
   ```

#### Issue 3: Network Mode Mismatch

**Symptom:**
```
Container Network Mode: Prometheus is using HOST network mode (should be BRIDGE)
```

**Root Cause:**
Task definition configured with incorrect network mode.

**Fix:**
Update the Prometheus task definition in the MonitoringServiceStack:
1. Ensure `networkMode: ecs.NetworkMode.BRIDGE` is set
2. Verify port mappings include `containerPort: 9090, hostPort: 9090`
3. Redeploy the service stack:
   ```bash
   cdk deploy development-MonitoringService \
     --profile dev-account
   ```

#### Issue 4: Security Group Blocking Traffic

**Symptom:**
```
Security Group Rules: No explicit rule found allowing port 9090 within VPC
```

**Fix:**
Add ingress rule to the ECS instance security group:
```bash
aws ec2 authorize-security-group-ingress \
  --group-id sg-0123456789abcdef0 \
  --protocol tcp \
  --port 9090 \
  --source-group sg-0123456789abcdef0 \
  --profile dev-account \
  --region eu-west-1
```

Or in CDK:
```typescript
securityGroup.addIngressRule(
  ec2.Peer.securityGroupId(securityGroup.securityGroupId),
  ec2.Port.tcp(9090),
  'Allow Prometheus scraping from same security group'
);
```

#### Issue 5: Grafana Started Before Prometheus

**Symptom:**
```
Service Startup Order: Grafana may have started before Prometheus
```

**Fix:**
Restart Grafana to re-establish connection:
```bash
aws ecs update-service \
  --cluster development-monitoring-monitoring-cluster \
  --service development-grafana \
  --force-new-deployment \
  --profile dev-account \
  --region eu-west-1
```

### Exit Codes

- **0** - All checks passed (healthy or degraded with warnings)
- **1** - One or more critical checks failed (unhealthy)
- **2** - Invalid command-line arguments

### Integration with CI/CD

```yaml
# Example GitHub Actions workflow step
- name: Verify Grafana-Prometheus Connectivity
  run: |
    npm run build
    node dist/scripts/integration/deployment/monitoring/verify-grafana-prometheus-connectivity.js \
      --environment ${{ env.ENVIRONMENT }} \
      --region ${{ env.AWS_REGION }}
  env:
    AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
    AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
    AWS_SESSION_TOKEN: ${{ secrets.AWS_SESSION_TOKEN }}
```

### Related Documentation

- [MonitoringEfsStack](../../../../lib/stacks/monitoring/efs-stack.ts)
- [MonitoringServiceStack](../../../../lib/stacks/monitoring/service-stack.ts)
- [EFS Initialization Document](../../../../lib/constructs/ssm/efs-initialization-document.ts)
- [Grafana Datasource Troubleshooting](../../../../docs/GRAFANA_DATASOURCE_TROUBLESHOOTING.md)
- [Prometheus Configuration](../../../../lib/shared/helpers/prometheus-config-builder.ts)

### Support

For issues or questions:

1. Run this script first to identify the root cause
2. Follow the remediation steps provided in the output
3. Check CloudWatch Logs for Prometheus and Grafana
4. Review SSM State Manager association execution logs
5. Verify EFS is mounted: `mountpoint -q /mnt/efs`
6. Check container networking: `docker network ls && docker inspect <container-id>`

---

## Related Documentation

- [MonitoringEfsStack](../../../../lib/stacks/monitoring/efs-stack.ts)
- [EFS Initialization Document Construct](../../../../lib/constructs/ssm/efs-initialization-document.ts)
- [SSM Automation Document Migration Guide](../../../../MIGRATION_EFS_LAMBDA_TO_SSM.md)
- [CDK Application Deployment Guide](../../../../bin/README.md)

## Support

For issues or questions:

1. Check the troubleshooting section above
2. Review CloudFormation stack events
3. Check SSM Automation execution logs
4. Verify AWS credentials and permissions
5. Ensure all prerequisites are installed
6. Review the SSM Automation Document in the AWS Console
