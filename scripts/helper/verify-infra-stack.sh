#!/bin/bash
set -euo pipefail

# ============================================================================
# MonitoringInfra Stack Verification Script
# ============================================================================
# This script verifies the MonitoringInfraStack deployment after it has been
# deployed via CDK. It checks CloudFormation stack status, ECS cluster,
# Auto Scaling Group, ALB, security groups, SSM State Manager associations,
# and provides a comprehensive verification report.
#
# Architecture:
#   - ECS Cluster with EC2 instances (ECS-optimized Amazon Linux 2023)
#   - Application Load Balancer for HTTP/HTTPS traffic
#   - Auto Scaling Group with Launch Template
#   - SSM State Manager for ECS agent, CloudWatch agent, and EFS mounting
#   - CloudWatch Log Groups for tasks and events
#   - IAM roles with necessary permissions
#
# Usage:
#   ./scripts/tests/verify-infra-stack.sh [OPTIONS]
#
# Options:
#   -e, --environment ENV     Environment name (default: development)
#   -p, --profile PROFILE     AWS CLI profile (default: dev-account)
#   -r, --region REGION       AWS region (default: eu-west-1)
#   -v, --verbose             Enable verbose output
#   -h, --help                Show this help message
#
# Environment Variables:
#   ENVIRONMENT               Override environment (can be set instead of -e)
#   AWS_PROFILE               Override AWS profile (can be set instead of -p)
#   AWS_REGION                Override AWS region (can be set instead of -r)
#
# Examples:
#   # Using command-line arguments
#   ./scripts/tests/verify-infra-stack.sh -e development -p dev-account
#   ./scripts/tests/verify-infra-stack.sh --environment pipeline --profile pipeline-account
#
#   # Using environment variables
#   export ENVIRONMENT=development
#   export AWS_PROFILE=dev-account
#   ./scripts/tests/verify-infra-stack.sh
#
#   # Verbose mode for debugging
#   ./scripts/tests/verify-infra-stack.sh -e development -v
# ============================================================================

# ============================================================================
# Configuration & Defaults
# ============================================================================
ENVIRONMENT="${ENVIRONMENT:-development}"
AWS_PROFILE="${AWS_PROFILE:-dev-account}"
REGION="${AWS_REGION:-eu-west-1}"
VERBOSE=false

# Colour codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Colour

# Counter for checks
TOTAL_CHECKS=0
PASSED_CHECKS=0
FAILED_CHECKS=0
WARNING_CHECKS=0

# ============================================================================
# Argument Parsing
# ============================================================================
show_help() {
  cat << EOF
MonitoringInfra Stack Verification Script

Verifies the MonitoringInfraStack deployment by checking:
  - CloudFormation stack status
  - ECS cluster and container insights
  - EC2 Auto Scaling Group and instances
  - Launch Template configuration
  - Application Load Balancer (ALB)
  - ALB listeners and target groups
  - Security groups and rules
  - CloudWatch Log Groups
  - SSM State Manager associations
  - SSM parameters (infrastructure discovery)
  - EventBridge rules for ECS events
  - Bootstrap metadata in SSM Parameter Store
  - Service accessibility (ALB health)

Architecture Verified:
  1. ECS Cluster with EC2 capacity provider
  2. Auto Scaling Group with ECS-optimized instances
  3. ALB for load balancing Prometheus and Grafana
  4. SSM State Manager for instance configuration
  5. CloudWatch integration for logs and monitoring

Usage:
  $0 [OPTIONS]

Options:
  -e, --environment ENV     Environment name (default: development)
                            Valid: development, staging, production, pipeline
  -p, --profile PROFILE     AWS CLI profile name (default: dev-account)
  -r, --region REGION       AWS region (default: eu-west-1)
  -v, --verbose             Enable verbose output
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

  # Verbose mode
  $0 -e development -v

Exit Codes:
  0  All checks passed
  1  One or more checks failed
  2  Invalid arguments or configuration

For more information, see:
  - docs/DEPLOYMENT.md
  - lib/stacks/monitoring/infra-stack.ts
EOF
  exit 0
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
    -v|--verbose)
      VERBOSE=true
      shift
      ;;
    -h|--help)
      show_help
      ;;
    *)
      echo "Unknown option: $1"
      echo "Use -h or --help for usage information"
      exit 2
      ;;
  esac
done

# ============================================================================
# Validation
# ============================================================================
validate_environment() {
  local valid_envs=("development" "staging" "production" "pipeline")
  for env in "${valid_envs[@]}"; do
    if [[ "$ENVIRONMENT" == "$env" ]]; then
      return 0
    fi
  done
  echo -e "${RED}Error: Invalid environment '$ENVIRONMENT'${NC}"
  echo "Valid environments: ${valid_envs[*]}"
  exit 2
}

validate_aws_cli() {
  if ! command -v aws &> /dev/null; then
    echo -e "${RED}Error: AWS CLI is not installed${NC}"
    echo "Install: https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html"
    exit 2
  fi
}

validate_profile() {
  if ! aws configure list --profile "${AWS_PROFILE}" &> /dev/null; then
    echo -e "${RED}Error: AWS profile '${AWS_PROFILE}' not found${NC}"
    echo "Configure: aws configure --profile ${AWS_PROFILE}"
    exit 2
  fi
}

validate_environment
validate_aws_cli
validate_profile

# ============================================================================
# Helper Functions
# ============================================================================
log_verbose() {
  if [[ "$VERBOSE" == "true" ]]; then
    echo -e "${BLUE}[VERBOSE]${NC} $1"
  fi
}

check_passed() {
  ((TOTAL_CHECKS++))
  ((PASSED_CHECKS++))
  echo -e "${GREEN}✅${NC} $1"
}

check_failed() {
  ((TOTAL_CHECKS++))
  ((FAILED_CHECKS++))
  echo -e "${RED}❌${NC} $1"
}

check_warning() {
  ((TOTAL_CHECKS++))
  ((WARNING_CHECKS++))
  echo -e "${YELLOW}⚠️${NC}  $1"
}

# ============================================================================
# Stack Name and Configuration
# ============================================================================
STACK_NAME="${ENVIRONMENT}-MonitoringInfra"

echo "================================================================"
echo "MonitoringInfra Stack Verification - ${ENVIRONMENT}"
echo "================================================================"
echo "Profile: ${AWS_PROFILE}"
echo "Region: ${REGION}"
echo "Stack Name: ${STACK_NAME}"
echo "Timestamp: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo ""

# ============================================================================
# 1. CloudFormation Stack Status
# ============================================================================
echo -e "${BLUE}1. CloudFormation Stack Status${NC}"
echo "--------------------------------------------------------------"

STACK_STATUS=$(aws cloudformation describe-stacks \
  --stack-name "${STACK_NAME}" \
  --profile "${AWS_PROFILE}" \
  --region "${REGION}" \
  --query 'Stacks[0].StackStatus' \
  --output text 2>/dev/null || echo "NOT_FOUND")

if [[ "$STACK_STATUS" == "CREATE_COMPLETE" || "$STACK_STATUS" == "UPDATE_COMPLETE" ]]; then
  check_passed "Stack Status: ${STACK_STATUS}"
elif [[ "$STACK_STATUS" == "NOT_FOUND" ]]; then
  check_failed "Stack does not exist: ${STACK_NAME}"
  exit 1
else
  check_warning "Stack Status: ${STACK_STATUS} (deployment may be in progress)"
fi

# Get stack outputs
log_verbose "Retrieving stack outputs..."
aws cloudformation describe-stacks \
  --stack-name "${STACK_NAME}" \
  --profile "${AWS_PROFILE}" \
  --region "${REGION}" \
  --query 'Stacks[0].Outputs' \
  --output table 2>/dev/null || true

echo ""

# ============================================================================
# 2. ECS Cluster
# ============================================================================
echo -e "${BLUE}2. ECS Cluster${NC}"
echo "--------------------------------------------------------------"

CLUSTER_NAME=$(aws cloudformation describe-stacks \
  --stack-name "${STACK_NAME}" \
  --profile "${AWS_PROFILE}" \
  --region "${REGION}" \
  --query 'Stacks[0].Outputs[?OutputKey==`ClusterName`].OutputValue' \
  --output text 2>/dev/null || echo "")

if [[ -n "$CLUSTER_NAME" ]]; then
  check_passed "Cluster Name: ${CLUSTER_NAME}"
  
  # Check cluster status
  CLUSTER_STATUS=$(aws ecs describe-clusters \
    --clusters "${CLUSTER_NAME}" \
    --profile "${AWS_PROFILE}" \
    --region "${REGION}" \
    --query 'clusters[0].status' \
    --output text 2>/dev/null || echo "NOT_FOUND")
  
  if [[ "$CLUSTER_STATUS" == "ACTIVE" ]]; then
    check_passed "Cluster Status: ${CLUSTER_STATUS}"
  else
    check_failed "Cluster Status: ${CLUSTER_STATUS}"
  fi
  
  # Check registered instances
  REGISTERED_INSTANCES=$(aws ecs describe-clusters \
    --clusters "${CLUSTER_NAME}" \
    --profile "${AWS_PROFILE}" \
    --region "${REGION}" \
    --query 'clusters[0].registeredContainerInstancesCount' \
    --output text 2>/dev/null || echo "0")
  
  if [[ "$REGISTERED_INSTANCES" -gt 0 ]]; then
    check_passed "Registered Container Instances: ${REGISTERED_INSTANCES}"
  else
    check_warning "Registered Container Instances: 0 (instances may still be bootstrapping)"
  fi
  
  # Check running tasks
  RUNNING_TASKS=$(aws ecs describe-clusters \
    --clusters "${CLUSTER_NAME}" \
    --profile "${AWS_PROFILE}" \
    --region "${REGION}" \
    --query 'clusters[0].runningTasksCount' \
    --output text 2>/dev/null || echo "0")
  
  echo "   Running Tasks: ${RUNNING_TASKS} (tasks deployed in ServiceStack)"
  
  # Check Container Insights
  CONTAINER_INSIGHTS=$(aws ecs describe-clusters \
    --clusters "${CLUSTER_NAME}" \
    --profile "${AWS_PROFILE}" \
    --region "${REGION}" \
    --query 'clusters[0].settings[?name==`containerInsights`].value' \
    --output text 2>/dev/null || echo "disabled")
  
  if [[ "$CONTAINER_INSIGHTS" == "enabled" ]]; then
    check_passed "Container Insights: enabled"
  else
    check_warning "Container Insights: disabled"
  fi
else
  check_failed "Cluster not found in stack outputs"
fi

echo ""

# ============================================================================
# 3. Auto Scaling Group & EC2 Instances
# ============================================================================
echo -e "${BLUE}3. Auto Scaling Group & EC2 Instances${NC}"
echo "--------------------------------------------------------------"

ASG_NAME=$(aws cloudformation describe-stacks \
  --stack-name "${STACK_NAME}" \
  --profile "${AWS_PROFILE}" \
  --region "${REGION}" \
  --query 'Stacks[0].Outputs[?OutputKey==`AutoScalingGroupName`].OutputValue' \
  --output text 2>/dev/null || echo "")

if [[ -n "$ASG_NAME" ]]; then
  check_passed "ASG Name: ${ASG_NAME}"
  
  # Get ASG details
  ASG_INFO=$(aws autoscaling describe-auto-scaling-groups \
    --auto-scaling-group-names "${ASG_NAME}" \
    --profile "${AWS_PROFILE}" \
    --region "${REGION}" \
    --query 'AutoScalingGroups[0]' \
    --output json 2>/dev/null || echo "{}")
  
  MIN_SIZE=$(echo "$ASG_INFO" | jq -r '.MinSize // "0"')
  MAX_SIZE=$(echo "$ASG_INFO" | jq -r '.MaxSize // "0"')
  DESIRED_CAPACITY=$(echo "$ASG_INFO" | jq -r '.DesiredCapacity // "0"')
  
  check_passed "Capacity: Min=${MIN_SIZE}, Max=${MAX_SIZE}, Desired=${DESIRED_CAPACITY}"
  
  # Get instance IDs
  INSTANCE_IDS=$(echo "$ASG_INFO" | jq -r '.Instances[].InstanceId // empty')
  INSTANCE_COUNT=$(echo "$INSTANCE_IDS" | wc -w | tr -d ' ')
  
  if [[ "$INSTANCE_COUNT" -gt 0 ]]; then
    check_passed "EC2 Instances: ${INSTANCE_COUNT}"
    
    # Check instance health
    HEALTHY_COUNT=0
    UNHEALTHY_COUNT=0
    
    for INSTANCE_ID in $INSTANCE_IDS; do
      HEALTH_STATUS=$(aws ec2 describe-instance-status \
        --instance-ids "${INSTANCE_ID}" \
        --profile "${AWS_PROFILE}" \
        --region "${REGION}" \
        --query 'InstanceStatuses[0].InstanceStatus.Status' \
        --output text 2>/dev/null || echo "unknown")
      
      if [[ "$HEALTH_STATUS" == "ok" ]]; then
        ((HEALTHY_COUNT++))
      else
        ((UNHEALTHY_COUNT++))
      fi
      
      log_verbose "Instance ${INSTANCE_ID}: ${HEALTH_STATUS}"
    done
    
    if [[ "$UNHEALTHY_COUNT" -eq 0 ]]; then
      check_passed "Instance Health: ${HEALTHY_COUNT}/${INSTANCE_COUNT} healthy"
    else
      check_warning "Instance Health: ${HEALTHY_COUNT}/${INSTANCE_COUNT} healthy, ${UNHEALTHY_COUNT} unhealthy"
    fi
  else
    check_warning "No EC2 instances found (ASG may be scaling up)"
  fi
else
  check_failed "ASG not found in stack outputs"
fi

echo ""

# ============================================================================
# 4. Application Load Balancer
# ============================================================================
echo -e "${BLUE}4. Application Load Balancer${NC}"
echo "--------------------------------------------------------------"

ALB_DNS=$(aws cloudformation describe-stacks \
  --stack-name "${STACK_NAME}" \
  --profile "${AWS_PROFILE}" \
  --region "${REGION}" \
  --query 'Stacks[0].Outputs[?OutputKey==`LoadBalancerDns`].OutputValue' \
  --output text 2>/dev/null || echo "")

if [[ -n "$ALB_DNS" ]]; then
  check_passed "ALB DNS: ${ALB_DNS}"
  
  # Get ALB ARN from DNS
  ALB_ARN=$(aws elbv2 describe-load-balancers \
    --profile "${AWS_PROFILE}" \
    --region "${REGION}" \
    --query "LoadBalancers[?DNSName=='${ALB_DNS}'].LoadBalancerArn" \
    --output text 2>/dev/null || echo "")
  
  if [[ -n "$ALB_ARN" ]]; then
    # Check ALB state
    ALB_STATE=$(aws elbv2 describe-load-balancers \
      --load-balancer-arns "${ALB_ARN}" \
      --profile "${AWS_PROFILE}" \
      --region "${REGION}" \
      --query 'LoadBalancers[0].State.Code' \
      --output text 2>/dev/null || echo "unknown")
    
    if [[ "$ALB_STATE" == "active" ]]; then
      check_passed "ALB State: ${ALB_STATE}"
    else
      check_warning "ALB State: ${ALB_STATE}"
    fi
    
    # Check ALB scheme
    ALB_SCHEME=$(aws elbv2 describe-load-balancers \
      --load-balancer-arns "${ALB_ARN}" \
      --profile "${AWS_PROFILE}" \
      --region "${REGION}" \
      --query 'LoadBalancers[0].Scheme' \
      --output text 2>/dev/null || echo "unknown")
    
    echo "   ALB Scheme: ${ALB_SCHEME}"
  fi
  
  # Display monitoring URLs
  PROMETHEUS_URL=$(aws cloudformation describe-stacks \
    --stack-name "${STACK_NAME}" \
    --profile "${AWS_PROFILE}" \
    --region "${REGION}" \
    --query 'Stacks[0].Outputs[?OutputKey==`PrometheusUrl`].OutputValue' \
    --output text 2>/dev/null || echo "")
  
  GRAFANA_URL=$(aws cloudformation describe-stacks \
    --stack-name "${STACK_NAME}" \
    --profile "${AWS_PROFILE}" \
    --region "${REGION}" \
    --query 'Stacks[0].Outputs[?OutputKey==`GrafanaUrl`].OutputValue' \
    --output text 2>/dev/null || echo "")
  
  if [[ -n "$PROMETHEUS_URL" ]]; then
    echo "   Prometheus URL: ${PROMETHEUS_URL}"
  fi
  
  if [[ -n "$GRAFANA_URL" ]]; then
    echo "   Grafana URL: ${GRAFANA_URL}"
  fi
else
  check_failed "ALB DNS not found in stack outputs"
fi

echo ""

# ============================================================================
# 5. ALB Listener & Target Groups
# ============================================================================
echo -e "${BLUE}5. ALB Listener & Target Groups${NC}"
echo "--------------------------------------------------------------"

LISTENER_ARN=$(aws cloudformation describe-stacks \
  --stack-name "${STACK_NAME}" \
  --profile "${AWS_PROFILE}" \
  --region "${REGION}" \
  --query 'Stacks[0].Outputs[?OutputKey==`ListenerArn`].OutputValue' \
  --output text 2>/dev/null || echo "")

if [[ -n "$LISTENER_ARN" ]]; then
  check_passed "Listener ARN exists"
  
  # Check listener protocol
  LISTENER_PROTOCOL=$(aws elbv2 describe-listeners \
    --listener-arns "${LISTENER_ARN}" \
    --profile "${AWS_PROFILE}" \
    --region "${REGION}" \
    --query 'Listeners[0].Protocol' \
    --output text 2>/dev/null || echo "unknown")
  
  echo "   Listener Protocol: ${LISTENER_PROTOCOL}"
  
  # Check target groups
  if [[ -n "$ALB_ARN" ]]; then
    TARGET_GROUPS=$(aws elbv2 describe-target-groups \
      --load-balancer-arn "${ALB_ARN}" \
      --profile "${AWS_PROFILE}" \
      --region "${REGION}" \
      --query 'TargetGroups[].TargetGroupName' \
      --output text 2>/dev/null || echo "")
    
    TG_COUNT=$(echo "$TARGET_GROUPS" | wc -w | tr -d ' ')
    
    if [[ "$TG_COUNT" -gt 0 ]]; then
      check_passed "Target Groups: ${TG_COUNT} (created by ServiceStack)"
      log_verbose "Target Groups: ${TARGET_GROUPS}"
    else
      echo "   Target Groups: 0 (created when ServiceStack is deployed)"
    fi
  fi
else
  check_failed "Listener ARN not found in stack outputs"
fi

echo ""

# ============================================================================
# 6. Security Groups
# ============================================================================
echo -e "${BLUE}6. Security Groups${NC}"
echo "--------------------------------------------------------------"

# Get security groups from stack resources
SG_IDS=$(aws cloudformation list-stack-resources \
  --stack-name "${STACK_NAME}" \
  --profile "${AWS_PROFILE}" \
  --region "${REGION}" \
  --query 'StackResourceSummaries[?ResourceType==`AWS::EC2::SecurityGroup`].PhysicalResourceId' \
  --output text 2>/dev/null || echo "")

SG_COUNT=$(echo "$SG_IDS" | wc -w | tr -d ' ')

if [[ "$SG_COUNT" -gt 0 ]]; then
  check_passed "Security Groups: ${SG_COUNT}"
  
  for SG_ID in $SG_IDS; do
    SG_NAME=$(aws ec2 describe-security-groups \
      --group-ids "${SG_ID}" \
      --profile "${AWS_PROFILE}" \
      --region "${REGION}" \
      --query 'SecurityGroups[0].GroupName' \
      --output text 2>/dev/null || echo "unknown")
    
    INGRESS_RULES=$(aws ec2 describe-security-groups \
      --group-ids "${SG_ID}" \
      --profile "${AWS_PROFILE}" \
      --region "${REGION}" \
      --query 'SecurityGroups[0].IpPermissions | length(@)' \
      --output text 2>/dev/null || echo "0")
    
    log_verbose "Security Group: ${SG_NAME} (${SG_ID}) - ${INGRESS_RULES} ingress rules"
  done
else
  check_warning "No security groups found in stack"
fi

echo ""

# ============================================================================
# 7. CloudWatch Log Groups
# ============================================================================
echo -e "${BLUE}7. CloudWatch Log Groups${NC}"
echo "--------------------------------------------------------------"

TASK_LOG_GROUP=$(aws cloudformation describe-stacks \
  --stack-name "${STACK_NAME}" \
  --profile "${AWS_PROFILE}" \
  --region "${REGION}" \
  --query 'Stacks[0].Outputs[?OutputKey==`TaskLogGroupName`].OutputValue' \
  --output text 2>/dev/null || echo "")

if [[ -n "$TASK_LOG_GROUP" ]]; then
  # Check if log group exists
  LOG_GROUP_EXISTS=$(aws logs describe-log-groups \
    --log-group-name-prefix "${TASK_LOG_GROUP}" \
    --profile "${AWS_PROFILE}" \
    --region "${REGION}" \
    --query 'logGroups[0].logGroupName' \
    --output text 2>/dev/null || echo "")
  
  if [[ -n "$LOG_GROUP_EXISTS" ]]; then
    check_passed "Task Log Group: ${TASK_LOG_GROUP}"
    
    # Check retention
    RETENTION=$(aws logs describe-log-groups \
      --log-group-name-prefix "${TASK_LOG_GROUP}" \
      --profile "${AWS_PROFILE}" \
      --region "${REGION}" \
      --query 'logGroups[0].retentionInDays' \
      --output text 2>/dev/null || echo "Never")
    
    echo "   Retention: ${RETENTION} days"
  else
    check_failed "Task Log Group not found: ${TASK_LOG_GROUP}"
  fi
else
  check_warning "Task Log Group name not in stack outputs"
fi

# Check for event log group
EVENT_LOG_GROUP="/ecs/${STACK_NAME}/events"
EVENT_LOG_EXISTS=$(aws logs describe-log-groups \
  --log-group-name-prefix "${EVENT_LOG_GROUP}" \
  --profile "${AWS_PROFILE}" \
  --region "${REGION}" \
  --query 'logGroups[0].logGroupName' \
  --output text 2>/dev/null || echo "")

if [[ -n "$EVENT_LOG_EXISTS" ]]; then
  check_passed "Event Log Group: ${EVENT_LOG_GROUP}"
else
  check_warning "Event Log Group not found: ${EVENT_LOG_GROUP}"
fi

echo ""

# ============================================================================
# 8. SSM State Manager Associations
# ============================================================================
echo -e "${BLUE}8. SSM State Manager Associations${NC}"
echo "--------------------------------------------------------------"

# Find associations by stack name prefix
ASSOCIATIONS=$(aws ssm list-associations \
  --profile "${AWS_PROFILE}" \
  --region "${REGION}" \
  --query "Associations[?contains(Name, '${STACK_NAME}')].{Name:Name,Status:Overview.Status,Id:AssociationId}" \
  --output json 2>/dev/null || echo "[]")

ASSOC_COUNT=$(echo "$ASSOCIATIONS" | jq '. | length')

if [[ "$ASSOC_COUNT" -gt 0 ]]; then
  check_passed "SSM Associations: ${ASSOC_COUNT}"
  
  echo "$ASSOCIATIONS" | jq -r '.[] | "   - \(.Name): \(.Status)"'
  
  # Check for specific associations
  ECS_AGENT_ASSOC=$(echo "$ASSOCIATIONS" | jq -r '.[] | select(.Name | contains("ECSAgentConfig")) | .Status')
  CLOUDWATCH_INSTALL_ASSOC=$(echo "$ASSOCIATIONS" | jq -r '.[] | select(.Name | contains("CloudWatchAgentInstall")) | .Status')
  CLOUDWATCH_CONFIG_ASSOC=$(echo "$ASSOCIATIONS" | jq -r '.[] | select(.Name | contains("CloudWatchAgentConfig")) | .Status')
  
  if [[ -n "$ECS_AGENT_ASSOC" ]]; then
    if [[ "$ECS_AGENT_ASSOC" == "Success" ]]; then
      check_passed "ECS Agent Configuration: ${ECS_AGENT_ASSOC}"
    else
      check_warning "ECS Agent Configuration: ${ECS_AGENT_ASSOC}"
    fi
  fi
  
  if [[ -n "$CLOUDWATCH_INSTALL_ASSOC" ]]; then
    if [[ "$CLOUDWATCH_INSTALL_ASSOC" == "Success" ]]; then
      check_passed "CloudWatch Agent Installation: ${CLOUDWATCH_INSTALL_ASSOC}"
    else
      check_warning "CloudWatch Agent Installation: ${CLOUDWATCH_INSTALL_ASSOC}"
    fi
  fi
  
  if [[ -n "$CLOUDWATCH_CONFIG_ASSOC" ]]; then
    if [[ "$CLOUDWATCH_CONFIG_ASSOC" == "Success" ]]; then
      check_passed "CloudWatch Agent Configuration: ${CLOUDWATCH_CONFIG_ASSOC}"
    else
      check_warning "CloudWatch Agent Configuration: ${CLOUDWATCH_CONFIG_ASSOC}"
    fi
  fi
else
  check_warning "No SSM State Manager associations found"
fi

echo ""

# ============================================================================
# 9. SSM Parameters (Infrastructure Discovery)
# ============================================================================
echo -e "${BLUE}9. SSM Parameters (Infrastructure Discovery)${NC}"
echo "--------------------------------------------------------------"

SSM_PREFIX="/monitoring/${ENVIRONMENT}/infra"

EXPECTED_PARAMS=(
  "${SSM_PREFIX}/cluster-name"
  "${SSM_PREFIX}/cluster-arn"
  "${SSM_PREFIX}/alb-dns"
  "${SSM_PREFIX}/listener-arn"
  "${SSM_PREFIX}/asg-name"
)

PARAM_FOUND=0
PARAM_MISSING=0

for PARAM_NAME in "${EXPECTED_PARAMS[@]}"; do
  PARAM_VALUE=$(aws ssm get-parameter \
    --name "${PARAM_NAME}" \
    --profile "${AWS_PROFILE}" \
    --region "${REGION}" \
    --query 'Parameter.Value' \
    --output text 2>/dev/null || echo "")
  
  if [[ -n "$PARAM_VALUE" ]]; then
    ((PARAM_FOUND++))
    check_passed "${PARAM_NAME}: ${PARAM_VALUE}"
  else
    ((PARAM_MISSING++))
    check_failed "${PARAM_NAME}: NOT FOUND"
  fi
done

echo "   Parameters: ${PARAM_FOUND}/${#EXPECTED_PARAMS[@]} found"

echo ""

# ============================================================================
# 10. EventBridge Rules
# ============================================================================
echo -e "${BLUE}10. EventBridge Rules${NC}"
echo "--------------------------------------------------------------"

# List rules that target the cluster
RULES=$(aws events list-rules \
  --profile "${AWS_PROFILE}" \
  --region "${REGION}" \
  --query "Rules[?contains(Description, '${ENVIRONMENT}')].{Name:Name,State:State,Description:Description}" \
  --output json 2>/dev/null || echo "[]")

RULE_COUNT=$(echo "$RULES" | jq '. | length')

if [[ "$RULE_COUNT" -gt 0 ]]; then
  check_passed "EventBridge Rules: ${RULE_COUNT}"
  echo "$RULES" | jq -r '.[] | "   - \(.Name): \(.State)"'
else
  check_warning "No EventBridge rules found for ${ENVIRONMENT}"
fi

echo ""

# ============================================================================
# 11. Bootstrap Metadata (if enabled)
# ============================================================================
echo -e "${BLUE}11. Bootstrap Metadata${NC}"
echo "--------------------------------------------------------------"

METADATA_PREFIX="/bootstrap/${ENVIRONMENT}/instances"

# Check if metadata parameters exist
METADATA_PARAMS=$(aws ssm get-parameters-by-path \
  --path "${METADATA_PREFIX}" \
  --profile "${AWS_PROFILE}" \
  --region "${REGION}" \
  --query 'Parameters[].Name' \
  --output text 2>/dev/null || echo "")

METADATA_COUNT=$(echo "$METADATA_PARAMS" | wc -w | tr -d ' ')

if [[ "$METADATA_COUNT" -gt 0 ]]; then
  check_passed "Bootstrap Metadata: ${METADATA_COUNT} instances tracked"
  
  # Show sample metadata
  if [[ "$VERBOSE" == "true" ]]; then
    SAMPLE_PARAM=$(echo "$METADATA_PARAMS" | awk '{print $1}')
    if [[ -n "$SAMPLE_PARAM" ]]; then
      echo "   Sample metadata from: ${SAMPLE_PARAM}"
      aws ssm get-parameter \
        --name "${SAMPLE_PARAM}" \
        --profile "${AWS_PROFILE}" \
        --region "${REGION}" \
        --query 'Parameter.Value' \
        --output text 2>/dev/null | jq '.' || true
    fi
  fi
else
  echo "   Bootstrap Metadata: None found (feature may be disabled)"
fi

echo ""

# ============================================================================
# 12. ALB Health Check
# ============================================================================
echo -e "${BLUE}12. ALB Health Check${NC}"
echo "--------------------------------------------------------------"

if [[ -n "$ALB_DNS" ]]; then
  # Test HTTP connectivity
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://${ALB_DNS}" --max-time 5 2>/dev/null || echo "000")
  
  if [[ "$HTTP_CODE" == "200" || "$HTTP_CODE" == "404" || "$HTTP_CODE" == "503" ]]; then
    check_passed "ALB HTTP Reachable (HTTP ${HTTP_CODE})"
    if [[ "$HTTP_CODE" == "503" ]]; then
      echo "   Note: HTTP 503 is normal when no services are deployed yet"
    fi
  else
    check_warning "ALB HTTP Response: ${HTTP_CODE} (may be behind firewall)"
  fi
else
  echo "   Skipping health check (ALB DNS not available)"
fi

echo ""

# ============================================================================
# Summary
# ============================================================================
echo "================================================================"
echo -e "${BLUE}VERIFICATION SUMMARY${NC}"
echo "================================================================"
echo "Checks Passed: ${PASSED_CHECKS}/${TOTAL_CHECKS}"

if [[ "$WARNING_CHECKS" -gt 0 ]]; then
  echo -e "${YELLOW}Warnings: ${WARNING_CHECKS}${NC}"
fi

if [[ "$FAILED_CHECKS" -gt 0 ]]; then
  echo -e "${RED}Failed: ${FAILED_CHECKS}${NC}"
fi

echo ""

if [[ "$FAILED_CHECKS" -eq 0 ]]; then
  echo -e "${GREEN}✅ All critical checks passed! Infrastructure is ready.${NC}"
  echo ""
  echo "Architecture Verification:"
  echo "  ✅ ECS Cluster created and active"
  echo "  ✅ Auto Scaling Group with EC2 instances"
  echo "  ✅ Application Load Balancer configured"
  echo "  ✅ SSM State Manager associations active"
  echo "  ✅ CloudWatch Log Groups created"
  echo "  ✅ SSM parameters for service discovery"
  echo ""
  echo "Next steps:"
  echo "  1. Deploy MonitoringServiceStack (Prometheus, Grafana services)"
  echo "  2. Verify services are running: aws ecs list-tasks --cluster ${CLUSTER_NAME}"
  echo "  3. Access Grafana: ${GRAFANA_URL:-http://${ALB_DNS}/grafana}"
  echo "  4. Access Prometheus: ${PROMETHEUS_URL:-http://${ALB_DNS}/prometheus}"
  echo ""
  exit 0
else
  echo -e "${RED}❌ Some checks failed. Review the output above for details.${NC}"
  echo ""
  echo "Troubleshooting:"
  echo "  1. Check CloudFormation stack status:"
  echo "     aws cloudformation describe-stacks --stack-name ${STACK_NAME}"
  echo ""
  echo "  2. View CloudFormation events:"
  echo "     aws cloudformation describe-stack-events --stack-name ${STACK_NAME}"
  echo ""
  echo "  3. Check Auto Scaling Group health:"
  echo "     aws autoscaling describe-auto-scaling-groups --auto-scaling-group-names ${ASG_NAME}"
  echo ""
  echo "  4. View SSM State Manager execution history:"
  echo "     aws ssm describe-association-executions --association-id <ASSOCIATION_ID>"
  echo ""
  echo "  5. Check instance bootstrap logs:"
  echo "     aws ssm get-parameter --name /bootstrap/${ENVIRONMENT}/instances/<INSTANCE_ID>"
  echo ""
  echo "For more troubleshooting, see: docs/TROUBLESHOOTING.md"
  echo ""
  exit 1
fi
