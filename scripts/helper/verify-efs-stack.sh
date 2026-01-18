#!/bin/bash
set -euo pipefail

# ============================================================================
# EFS Stack Verification Script
# ============================================================================
# This script verifies the MonitoringEfsStack deployment after it has been
# deployed via CDK. It checks CloudFormation stack status, SSM Automation
# Document, SSM parameters, EFS resources, and provides a comprehensive
# verification report.
#
# Architecture:
#   - EFS Stack creates EFS resources and JSON config parameters
#   - SSM Automation Document converts JSON to YAML and creates setup scripts
#   - SSM State Manager (in InfraStack) executes setup scripts on EC2 instances
#
# Usage:
#   ./scripts/tests/verify-efs-stack.sh [OPTIONS]
#
# Options:
#   -e, --environment ENV     Environment name (default: development)
#   -p, --profile PROFILE     AWS CLI profile (default: dev-account)
#   -r, --region REGION       AWS region (default: eu-west-1)
#   -h, --help                Show this help message
#
# Environment Variables:
#   ENVIRONMENT               Override environment (can be set instead of -e)
#   AWS_PROFILE               Override AWS profile (can be set instead of -p)
#   AWS_REGION                Override AWS region (can be set instead of -r)
#
# Examples:
#   # Using command-line arguments
#   ./scripts/tests/verify-efs-stack.sh -e development -p dev-account
#   ./scripts/tests/verify-efs-stack.sh --environment pipeline --profile pipeline-account
#
#   # Using environment variables
#   export ENVIRONMENT=development
#   export AWS_PROFILE=dev-account
#   ./scripts/tests/verify-efs-stack.sh
#
#   # Mix of both (CLI args take precedence)
#   export AWS_PROFILE=dev-account
#   ./scripts/tests/verify-efs-stack.sh -e production
# ============================================================================

# ============================================================================
# Configuration & Defaults
# ============================================================================
ENVIRONMENT="${ENVIRONMENT:-development}"
AWS_PROFILE="${AWS_PROFILE:-dev-account}"
REGION="${AWS_REGION:-eu-west-1}"

# ============================================================================
# Argument Parsing
# ============================================================================
show_help() {
  cat << EOF
EFS Stack Verification Script

Verifies the MonitoringEfsStack deployment by checking:
  - CloudFormation stack status
  - SSM Automation Document existence and status
  - SSM parameters (JSON configs, YAML configs, setup scripts)
  - SSM Automation executions (initialization status)
  - EFS file system and mount targets
  - EFS access point
  - Security group configuration

Architecture Verified:
  1. EFS Stack creates EFS resources and JSON configuration parameters
  2. SSM Automation Document converts JSON to YAML (runs once during deployment)
  3. SSM State Manager (InfraStack) mounts EFS on EC2 instances

Usage:
  $0 [OPTIONS]

Options:
  -e, --environment ENV     Environment name (default: development)
                            Valid: development, staging, production, pipeline
  -p, --profile PROFILE     AWS CLI profile name (default: dev-account)
  -r, --region REGION       AWS region (default: eu-west-1)
  -h, --help                Show this help message

Environment Variables:
  ENVIRONMENT               Override environment name
  AWS_PROFILE               Override AWS CLI profile
  AWS_REGION                Override AWS region

Examples:
  # Basic usage with defaults
  $0

  # Specify environment and profile
  $0 -e development -p dev-account

  # Use environment variables
  export ENVIRONMENT=production
  export AWS_PROFILE=prod-account
  $0

  # Full example
  $0 --environment pipeline --profile pipeline-account --region eu-west-1

EOF
}

# Parse command-line arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    -e|--environment)
      ENVIRONMENT="$2"
      shift 2
      ;;
    -p|--profile)
      AWS_PROFILE="$2"
      shift 2
      ;;
    -r|--region)
      REGION="$2"
      shift 2
      ;;
    -h|--help)
      show_help
      exit 0
      ;;
    *)
      echo "Error: Unknown option: $1" >&2
      echo "Run '$0 --help' for usage information." >&2
      exit 1
      ;;
  esac
done

# ============================================================================
# Validation
# ============================================================================
VALID_ENVIRONMENTS=("development" "staging" "production" "pipeline")
if [[ ! " ${VALID_ENVIRONMENTS[@]} " =~ " ${ENVIRONMENT} " ]]; then
  echo "Error: Invalid environment '${ENVIRONMENT}'" >&2
  echo "Valid environments: ${VALID_ENVIRONMENTS[*]}" >&2
  exit 1
fi

# Check AWS CLI is installed
if ! command -v aws &> /dev/null; then
  echo "Error: AWS CLI is not installed" >&2
  echo "Install it from: https://aws.amazon.com/cli/" >&2
  exit 1
fi

# Check jq is installed
if ! command -v jq &> /dev/null; then
  echo "Error: jq is not installed" >&2
  echo "Install it with: brew install jq (macOS) or apt-get install jq (Linux)" >&2
  exit 1
fi

# Verify AWS profile exists
if ! aws configure list-profiles 2>/dev/null | grep -q "^${AWS_PROFILE}$"; then
  echo "Warning: AWS profile '${AWS_PROFILE}' not found in AWS config" >&2
  echo "Available profiles: $(aws configure list-profiles 2>/dev/null | tr '\n' ' ' || echo 'none')" >&2
  echo "Continuing anyway (profile may be set via environment variables)..." >&2
fi

# Verify AWS credentials
if ! aws sts get-caller-identity --profile "${AWS_PROFILE}" --region "${REGION}" &>/dev/null; then
  echo "Error: Failed to authenticate with AWS using profile '${AWS_PROFILE}'" >&2
  echo "Run 'aws configure --profile ${AWS_PROFILE}' to set up credentials" >&2
  exit 1
fi

# ============================================================================
# Derived Configuration
# ============================================================================
# Stack name pattern: ${envName}-MonitoringEfs
STACK_NAME="${ENVIRONMENT}-MonitoringEfs"

# ============================================================================
# Header
# ============================================================================
echo "================================================================"
echo "EFS Stack Verification - ${ENVIRONMENT}"
echo "================================================================"
echo "Profile: ${AWS_PROFILE}"
echo "Region: ${REGION}"
echo "Stack Name: ${STACK_NAME}"
echo "Timestamp: $(date -u +"%Y-%m-%d %H:%M:%S UTC")"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ============================================================================
# 1. VERIFY CLOUDFORMATION STACK
# ============================================================================
echo -e "${BLUE}1. CloudFormation Stack Status${NC}"
echo "--------------------------------------------------------------"

STACK_NAME="${ENVIRONMENT}-MonitoringEfs"
STACK_STATUS=$(aws cloudformation describe-stacks \
  --stack-name ${STACK_NAME} \
  --profile ${AWS_PROFILE} \
  --region ${REGION} \
  --query 'Stacks[0].StackStatus' \
  --output text 2>/dev/null || echo "NOT_FOUND")

if [ "$STACK_STATUS" = "CREATE_COMPLETE" ] || [ "$STACK_STATUS" = "UPDATE_COMPLETE" ]; then
  echo -e "${GREEN}✅ Stack Status: ${STACK_STATUS}${NC}"
else
  echo -e "${RED}❌ Stack Status: ${STACK_STATUS}${NC}"
  exit 1
fi

# Get stack outputs
echo ""
echo "Stack Outputs:"
aws cloudformation describe-stacks \
  --stack-name ${STACK_NAME} \
  --profile ${AWS_PROFILE} \
  --region ${REGION} \
  --query 'Stacks[0].Outputs[].{Key:OutputKey,Value:OutputValue}' \
  --output table

# Get resource IDs from stack outputs
FILE_SYSTEM_ID=$(aws cloudformation describe-stacks \
  --stack-name ${STACK_NAME} \
  --profile ${AWS_PROFILE} \
  --region ${REGION} \
  --query 'Stacks[0].Outputs[?OutputKey==`FileSystemId`].OutputValue' \
  --output text)

ACCESS_POINT_ID=$(aws cloudformation describe-stacks \
  --stack-name ${STACK_NAME} \
  --profile ${AWS_PROFILE} \
  --region ${REGION} \
  --query 'Stacks[0].Outputs[?OutputKey==`AccessPointId`].OutputValue' \
  --output text)

SECURITY_GROUP_ID=$(aws cloudformation describe-stacks \
  --stack-name ${STACK_NAME} \
  --profile ${AWS_PROFILE} \
  --region ${REGION} \
  --query 'Stacks[0].Outputs[?OutputKey==`SecurityGroupId`].OutputValue' \
  --output text)

echo ""
echo "Resource IDs:"
echo "  File System ID: ${FILE_SYSTEM_ID}"
echo "  Access Point ID: ${ACCESS_POINT_ID}"
echo "  Security Group ID: ${SECURITY_GROUP_ID}"

# ============================================================================
# 2. VERIFY SSM AUTOMATION DOCUMENT
# ============================================================================
echo ""
echo -e "${BLUE}2. SSM Automation Document${NC}"
echo "--------------------------------------------------------------"

# Document name pattern: {StackName}-{envName}-efs-init
DOCUMENT_NAME="${STACK_NAME}-${ENVIRONMENT}-efs-init"

DOCUMENT_STATUS=$(aws ssm describe-document \
  --name "${DOCUMENT_NAME}" \
  --profile ${AWS_PROFILE} \
  --region ${REGION} \
  --query 'Document.Status' \
  --output text 2>/dev/null || echo "NOT_FOUND")

if [ "$DOCUMENT_STATUS" = "Active" ]; then
  echo -e "${GREEN}✅ SSM Automation Document: ${DOCUMENT_STATUS}${NC}"
  echo "   Document Name: ${DOCUMENT_NAME}"
  
  # Get document details
  DOCUMENT_VERSION=$(aws ssm describe-document \
    --name "${DOCUMENT_NAME}" \
    --profile ${AWS_PROFILE} \
    --region ${REGION} \
    --query 'Document.DocumentVersion' \
    --output text 2>/dev/null)
  
  DOCUMENT_TYPE=$(aws ssm describe-document \
    --name "${DOCUMENT_NAME}" \
    --profile ${AWS_PROFILE} \
    --region ${REGION} \
    --query 'Document.DocumentType' \
    --output text 2>/dev/null)
  
  echo "   Document Type: ${DOCUMENT_TYPE}"
  echo "   Document Version: ${DOCUMENT_VERSION}"
else
  echo -e "${RED}❌ SSM Automation Document: ${DOCUMENT_STATUS}${NC}"
  echo "   Expected: ${DOCUMENT_NAME}"
fi

# Check for SSM Association execution (document invocation)
echo ""
echo "SSM Automation Executions:"
echo "--------------------------------------------------------------"

EXECUTIONS=$(aws ssm describe-automation-executions \
  --filters "Key=DocumentNamePrefix,Values=${DOCUMENT_NAME}" \
  --max-results 5 \
  --profile ${AWS_PROFILE} \
  --region ${REGION} \
  --query 'AutomationExecutionMetadataList[*].[ExecutionId,AutomationExecutionStatus,ExecutionStartTime]' \
  --output text 2>/dev/null || echo "")

if [ -n "$EXECUTIONS" ]; then
  echo "$EXECUTIONS" | while IFS=$'\t' read -r exec_id status start_time; do
    if [ "$status" = "Success" ]; then
      echo -e "${GREEN}✅${NC} Execution: ${exec_id}"
    elif [ "$status" = "Failed" ]; then
      echo -e "${RED}❌${NC} Execution: ${exec_id}"
    else
      echo -e "${YELLOW}⏳${NC} Execution: ${exec_id}"
    fi
    echo "   Status: ${status}"
    echo "   Started: ${start_time}"
  done
else
  echo -e "${YELLOW}⚠️  No automation executions found${NC}"
  echo "Note: Document may not have been executed yet, or executions have expired."
fi

# ============================================================================
# 3. VERIFY SSM PARAMETERS
# ============================================================================
echo ""
echo -e "${BLUE}3. SSM Parameters${NC}"
echo "--------------------------------------------------------------"

echo "JSON Configuration Parameters (created by EFS Stack):"
JSON_PARAMS=(
  "/monitoring/${ENVIRONMENT}/prometheus-config"
  "/monitoring/${ENVIRONMENT}/grafana-datasource-config"
  "/monitoring/${ENVIRONMENT}/grafana-dashboard-config"
)

MISSING_JSON_PARAMS=0
for PARAM in "${JSON_PARAMS[@]}"; do
  PARAM_EXISTS=$(aws ssm get-parameter \
    --name "${PARAM}" \
    --profile ${AWS_PROFILE} \
    --region ${REGION} \
    --query 'Parameter.Name' \
    --output text 2>/dev/null || echo "NOT_FOUND")
  
  if [ "$PARAM_EXISTS" != "NOT_FOUND" ]; then
    VALUE_SIZE=$(aws ssm get-parameter \
      --name "${PARAM}" \
      --profile ${AWS_PROFILE} \
      --region ${REGION} \
      --query 'length(Parameter.Value)' \
      --output text)
    
    echo -e "${GREEN}✅${NC} ${PARAM} (${VALUE_SIZE} chars)"
  else
    echo -e "${RED}❌${NC} ${PARAM}"
    ((MISSING_JSON_PARAMS++))
  fi
done

echo ""
echo "YAML Configuration Parameters (created by SSM Automation Document):"
YAML_PARAMS=(
  "/monitoring/${ENVIRONMENT}/prometheus-config-yaml"
  "/monitoring/${ENVIRONMENT}/grafana-datasource-config-yaml"
  "/monitoring/${ENVIRONMENT}/grafana-dashboard-config-yaml"
  "/monitoring/${ENVIRONMENT}/efs-setup-script"
)

MISSING_YAML_PARAMS=0
for PARAM in "${YAML_PARAMS[@]}"; do
  PARAM_EXISTS=$(aws ssm get-parameter \
    --name "${PARAM}" \
    --profile ${AWS_PROFILE} \
    --region ${REGION} \
    --query 'Parameter.Name' \
    --output text 2>/dev/null || echo "NOT_FOUND")
  
  if [ "$PARAM_EXISTS" != "NOT_FOUND" ]; then
    VALUE_SIZE=$(aws ssm get-parameter \
      --name "${PARAM}" \
      --profile ${AWS_PROFILE} \
      --region ${REGION} \
      --query 'length(Parameter.Value)' \
      --output text)
    
    echo -e "${GREEN}✅${NC} ${PARAM} (${VALUE_SIZE} chars)"
  else
    echo -e "${RED}❌${NC} ${PARAM}"
    ((MISSING_YAML_PARAMS++))
  fi
done

echo ""
echo "EFS Discovery Parameters (created by EFS Stack):"
DISCOVERY_PARAMS=(
  "/monitoring/${ENVIRONMENT}/efs/config/file-system-id"
  "/monitoring/${ENVIRONMENT}/efs/config/access-point-id"
  "/monitoring/${ENVIRONMENT}/efs/config/security-group-id"
  "/monitoring/${ENVIRONMENT}/efs/config/availability-zone"
)

MISSING_DISCOVERY_PARAMS=0
for PARAM in "${DISCOVERY_PARAMS[@]}"; do
  PARAM_EXISTS=$(aws ssm get-parameter \
    --name "${PARAM}" \
    --profile ${AWS_PROFILE} \
    --region ${REGION} \
    --query 'Parameter.Name' \
    --output text 2>/dev/null || echo "NOT_FOUND")
  
  if [ "$PARAM_EXISTS" != "NOT_FOUND" ]; then
    PARAM_VALUE=$(aws ssm get-parameter \
      --name "${PARAM}" \
      --profile ${AWS_PROFILE} \
      --region ${REGION} \
      --query 'Parameter.Value' \
      --output text)
    
    echo -e "${GREEN}✅${NC} ${PARAM}: ${PARAM_VALUE}"
  else
    echo -e "${RED}❌${NC} ${PARAM}"
    ((MISSING_DISCOVERY_PARAMS++))
  fi
done

MISSING_PARAMS=$((MISSING_JSON_PARAMS + MISSING_YAML_PARAMS + MISSING_DISCOVERY_PARAMS))

echo ""
echo "Summary:"
echo "  JSON Parameters: $((${#JSON_PARAMS[@]} - MISSING_JSON_PARAMS))/${#JSON_PARAMS[@]}"
echo "  YAML Parameters: $((${#YAML_PARAMS[@]} - MISSING_YAML_PARAMS))/${#YAML_PARAMS[@]}"
echo "  Discovery Parameters: $((${#DISCOVERY_PARAMS[@]} - MISSING_DISCOVERY_PARAMS))/${#DISCOVERY_PARAMS[@]}"

if [ $MISSING_PARAMS -eq 0 ]; then
  echo -e "${GREEN}✅ All SSM parameters created successfully${NC}"
else
  echo -e "${YELLOW}⚠️  ${MISSING_PARAMS} parameters missing${NC}"
  
  if [ $MISSING_YAML_PARAMS -gt 0 ]; then
    echo ""
    echo -e "${YELLOW}Note: YAML parameters are created by SSM Automation Document.${NC}"
    echo "      If they're missing, the automation may not have executed yet."
    echo "      Check SSM Automation executions above."
  fi
fi

# ============================================================================
# 3. VERIFY EFS FILE SYSTEM
# ============================================================================
echo ""
echo -e "${BLUE}4. EFS File System${NC}"
echo "--------------------------------------------------------------"

EFS_INFO=$(aws efs describe-file-systems \
  --file-system-id ${FILE_SYSTEM_ID} \
  --profile ${AWS_PROFILE} \
  --region ${REGION} \
  2>/dev/null)

if [ $? -eq 0 ]; then
  echo -e "${GREEN}✅ EFS File System exists${NC}"
  echo ""
  echo "$EFS_INFO" | jq -r '.FileSystems[0] | 
    "  File System ID: \(.FileSystemId)
  Name: \(.Name // "N/A")
  State: \(.LifeCycleState)
  Performance Mode: \(.PerformanceMode)
  Throughput Mode: \(.ThroughputMode)
  Encrypted: \(.Encrypted)
  Size in Bytes: \(.SizeInBytes.Value)
  Creation Time: \(.CreationTime)"'
else
  echo -e "${RED}❌ EFS File System not found${NC}"
  exit 1
fi

# ============================================================================
# 4. VERIFY EFS MOUNT TARGETS
# ============================================================================
echo ""
echo -e "${BLUE}5. EFS Mount Targets${NC}"
echo "--------------------------------------------------------------"

# Get mount targets with error handling
MOUNT_TARGETS_RAW=$(aws efs describe-mount-targets \
  --file-system-id ${FILE_SYSTEM_ID} \
  --profile ${AWS_PROFILE} \
  --region ${REGION} \
  --output json 2>/dev/null)

if [ $? -ne 0 ] || [ -z "$MOUNT_TARGETS_RAW" ]; then
  echo -e "${RED}❌ Failed to retrieve mount targets${NC}"
  MOUNT_COUNT=0
else
  # Extract MountTargets array, defaulting to empty array if null
  MOUNT_TARGETS=$(echo "$MOUNT_TARGETS_RAW" | jq -r '.MountTargets // []')
  
  # Get count safely
  MOUNT_COUNT=$(echo "$MOUNT_TARGETS" | jq -r 'length // 0')
  
  if [ "$MOUNT_COUNT" -gt 0 ]; then
    echo -e "${GREEN}✅ Mount Targets: ${MOUNT_COUNT}${NC}"
    echo ""
    # Iterate over mount targets with null-safe handling
    echo "$MOUNT_TARGETS" | jq -r '.[] | 
      "  Mount Target ID: \(.MountTargetId // "N/A")
  Subnet ID: \(.SubnetId // "N/A")
  IP Address: \(.IpAddress // "N/A")
  Availability Zone: \(.AvailabilityZoneName // "N/A")
  State: \(.LifeCycleState // "N/A")
  Security Groups: \(if .SecurityGroups and (.SecurityGroups | length) > 0 then (.SecurityGroups | join(", ")) else "N/A" end)
  ---"'
  else
    echo -e "${RED}❌ No mount targets found${NC}"
  fi
fi

# ============================================================================
# 5. VERIFY EFS ACCESS POINT
# ============================================================================
echo ""
echo -e "${BLUE}6. EFS Access Point${NC}"
echo "--------------------------------------------------------------"

ACCESS_POINT_INFO=$(aws efs describe-access-points \
  --access-point-id ${ACCESS_POINT_ID} \
  --profile ${AWS_PROFILE} \
  --region ${REGION} \
  2>/dev/null)

if [ $? -eq 0 ]; then
  echo -e "${GREEN}✅ Access Point exists${NC}"
  echo ""
  echo "$ACCESS_POINT_INFO" | jq -r '.AccessPoints[0] | 
    "  Access Point ID: \(.AccessPointId)
  Name: \(.Name // "N/A")
  State: \(.LifeCycleState)
  Root Directory: \(.RootDirectory.Path)
  POSIX User - UID: \(.PosixUser.Uid), GID: \(.PosixUser.Gid)
  Owner - UID: \(.RootDirectory.CreationInfo.OwnerUid), GID: \(.RootDirectory.CreationInfo.OwnerGid)
  Permissions: \(.RootDirectory.CreationInfo.Permissions)"'
else
  echo -e "${RED}❌ Access Point not found${NC}"
fi

# ============================================================================
# 6. VERIFY SECURITY GROUP
# ============================================================================
echo ""
echo -e "${BLUE}7. EFS Security Group${NC}"
echo "--------------------------------------------------------------"

SG_INFO=$(aws ec2 describe-security-groups \
  --group-ids ${SECURITY_GROUP_ID} \
  --profile ${AWS_PROFILE} \
  --region ${REGION} \
  2>/dev/null)

if [ $? -eq 0 ]; then
  echo -e "${GREEN}✅ Security Group exists${NC}"
  echo ""
  echo "Inbound Rules:"
  echo "$SG_INFO" | jq -r '.SecurityGroups[0].IpPermissions[] | 
    "  Protocol: \(.IpProtocol), Ports: \(.FromPort)-\(.ToPort), Source: \(.IpRanges[0].CidrIp // .UserIdGroupPairs[0].GroupId // "N/A")"'
  
  echo ""
  echo "Outbound Rules:"
  echo "$SG_INFO" | jq -r '.SecurityGroups[0].IpPermissionsEgress[] | 
    "  Protocol: \(.IpProtocol), Ports: \(.FromPort // "All")-\(.ToPort // "All"), Destination: \(.IpRanges[0].CidrIp // "N/A")"'
else
  echo -e "${RED}❌ Security Group not found${NC}"
fi

# ============================================================================
# 7. SAMPLE CONFIGS
# ============================================================================
echo ""
echo -e "${BLUE}8. Sample Configuration Files${NC}"
echo "--------------------------------------------------------------"

echo "Prometheus Config (first 500 chars):"
aws ssm get-parameter \
  --name "/monitoring/${ENVIRONMENT}/prometheus-config-yaml" \
  --profile ${AWS_PROFILE} \
  --region ${REGION} \
  --query 'Parameter.Value' \
  --output text 2>/dev/null | head -c 500
echo ""
echo "..."
echo ""

echo "EFS Setup Script (first 500 chars):"
aws ssm get-parameter \
  --name "/monitoring/${ENVIRONMENT}/efs-setup-script" \
  --profile ${AWS_PROFILE} \
  --region ${REGION} \
  --query 'Parameter.Value' \
  --output text 2>/dev/null | head -c 500
echo ""
echo "..."

# ============================================================================
# 8. SUMMARY
# ============================================================================
echo ""
echo "================================================================"
echo -e "${BLUE}VERIFICATION SUMMARY${NC}"
echo "================================================================"

CHECKS_PASSED=0
TOTAL_CHECKS=7

# Check results
[ "$STACK_STATUS" = "CREATE_COMPLETE" ] || [ "$STACK_STATUS" = "UPDATE_COMPLETE" ] && ((CHECKS_PASSED++))
[ "$DOCUMENT_STATUS" = "Active" ] && ((CHECKS_PASSED++))
[ $MISSING_PARAMS -eq 0 ] && ((CHECKS_PASSED++))
[ ! -z "$FILE_SYSTEM_ID" ] && ((CHECKS_PASSED++))
[ "$MOUNT_COUNT" -gt 0 ] && ((CHECKS_PASSED++))
[ ! -z "$ACCESS_POINT_ID" ] && ((CHECKS_PASSED++))
[ ! -z "$SECURITY_GROUP_ID" ] && ((CHECKS_PASSED++))

echo "Checks Passed: ${CHECKS_PASSED}/${TOTAL_CHECKS}"
echo ""

if [ $CHECKS_PASSED -eq $TOTAL_CHECKS ]; then
  echo -e "${GREEN}✅ All checks passed! EFS stack is ready.${NC}"
  echo ""
  echo "Architecture Verification:"
  echo "  ✅ EFS resources created"
  echo "  ✅ SSM Automation Document deployed"
  echo "  ✅ JSON configurations stored in SSM"
  echo "  ✅ YAML configurations generated"
  echo "  ✅ EFS setup script created"
  echo ""
  echo "Next steps:"
  echo "  1. Deploy MonitoringInfraStack (EC2 instances + ALB + SSM State Manager)"
  echo "     → SSM State Manager will mount EFS on each EC2 instance"
  echo "  2. SSH to EC2 instance to verify EFS mount at /mnt/efs"
  echo "  3. Deploy MonitoringServiceStack (Prometheus, Grafana)"
  echo ""
  echo "Useful commands:"
  echo "  # Get EFS file system ID"
  echo "  aws cloudformation describe-stacks \\"
  echo "    --stack-name ${ENVIRONMENT}-MonitoringEfs \\"
  echo "    --profile ${AWS_PROFILE} \\"
  echo "    --region ${REGION} \\"
  echo "    --query 'Stacks[0].Outputs[?OutputKey==\`FileSystemId\`].OutputValue' \\"
  echo "    --output text"
  echo ""
  echo "  # View SSM Automation Document"
  echo "  aws ssm describe-document \\"
  echo "    --name \"${DOCUMENT_NAME}\" \\"
  echo "    --profile ${AWS_PROFILE} \\"
  echo "    --region ${REGION}"
  echo ""
  echo "  # View latest automation execution"
  echo "  aws ssm describe-automation-executions \\"
  echo "    --filters \"Key=DocumentNamePrefix,Values=${DOCUMENT_NAME}\" \\"
  echo "    --max-results 1 \\"
  echo "    --profile ${AWS_PROFILE} \\"
  echo "    --region ${REGION}"
  echo ""
  echo "  # View EFS setup script"
  echo "  aws ssm get-parameter \\"
  echo "    --name \"/monitoring/${ENVIRONMENT}/efs-setup-script\" \\"
  echo "    --profile ${AWS_PROFILE} \\"
  echo "    --region ${REGION} \\"
  echo "    --query 'Parameter.Value' \\"
  echo "    --output text"
  exit 0
else
  echo -e "${YELLOW}⚠️  Some checks failed. Review the output above.${NC}"
  echo ""
  echo "Troubleshooting:"
  echo "  1. Check CloudFormation stack events for errors:"
  echo "     aws cloudformation describe-stack-events \\"
  echo "       --stack-name ${ENVIRONMENT}-MonitoringEfs \\"
  echo "       --profile ${AWS_PROFILE} \\"
  echo "       --region ${REGION} \\"
  echo "       --max-items 20"
  echo ""
  echo "  2. Check SSM Automation Document status:"
  echo "     aws ssm describe-document \\"
  echo "       --name \"${DOCUMENT_NAME}\" \\"
  echo "       --profile ${AWS_PROFILE} \\"
  echo "       --region ${REGION}"
  echo ""
  echo "  3. Check SSM Automation execution logs:"
  echo "     aws ssm describe-automation-executions \\"
  echo "       --filters \"Key=DocumentNamePrefix,Values=${DOCUMENT_NAME}\" \\"
  echo "       --max-results 5 \\"
  echo "       --profile ${AWS_PROFILE} \\"
  echo "       --region ${REGION}"
  echo ""
  echo "  4. If YAML parameters are missing, manually execute automation:"
  echo "     aws ssm start-automation-execution \\"
  echo "       --document-name \"${DOCUMENT_NAME}\" \\"
  echo "       --parameters \"FileSystemId=${FILE_SYSTEM_ID},AccessPointId=${ACCESS_POINT_ID},Environment=${ENVIRONMENT}\" \\"
  echo "       --profile ${AWS_PROFILE} \\"
  echo "       --region ${REGION}"
  echo ""
  echo "  5. Verify stack is fully deployed:"
  echo "     aws cloudformation describe-stacks \\"
  echo "       --stack-name ${ENVIRONMENT}-MonitoringEfs \\"
  echo "       --profile ${AWS_PROFILE} \\"
  echo "       --region ${REGION} \\"
  echo "       --query 'Stacks[0].StackStatus' \\"
  echo "       --output text"
  exit 1
fi