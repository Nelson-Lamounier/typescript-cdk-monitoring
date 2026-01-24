#!/bin/bash
set -e

# ============================================================================
# Quick Prometheus Health Check Test
# ============================================================================
# This script tests the Prometheus health check endpoint on a running instance
#
# Usage:
#   ./test-prometheus-health.sh <environment> [instance-id]
#
# Example:
#   ./test-prometheus-health.sh development
#   ./test-prometheus-health.sh development i-0f806003ed570c462
# ============================================================================

# Colour codes
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_success() { echo -e "${GREEN}✓${NC} $1"; }
print_error() { echo -e "${RED}✗${NC} $1"; }
print_info() { echo -e "${BLUE}ℹ${NC} $1"; }
print_warning() { echo -e "${YELLOW}⚠${NC} $1"; }

# Check parameters
if [ -z "$1" ]; then
    print_error "Environment parameter required"
    echo "Usage: $0 <environment> [instance-id]"
    exit 1
fi

ENVIRONMENT=$1
AWS_REGION=${AWS_REGION:-eu-west-1}
AWS_PROFILE=${AWS_PROFILE:-dev-account}
INSTANCE_ID=$2

echo ""
echo "=========================================="
echo "Prometheus Health Check Test"
echo "=========================================="
print_info "Environment: $ENVIRONMENT"
print_info "Region: $AWS_REGION"
print_info "Profile: $AWS_PROFILE"
echo ""

# Find target group
TG_PATTERNS=(
    "${ENVIRONMENT}-monitoring-prom"
    "${ENVIRONMENT}-prometheus"
)

TARGET_GROUP_ARN=""
for PATTERN in "${TG_PATTERNS[@]}"; do
    TG_ARN=$(aws elbv2 describe-target-groups \
        --profile "$AWS_PROFILE" \
        --region "$AWS_REGION" \
        --query "TargetGroups[?TargetGroupName=='$PATTERN'].TargetGroupArn" \
        --output text 2>/dev/null || echo "")
    
    if [ -n "$TG_ARN" ]; then
        TARGET_GROUP_ARN=$TG_ARN
        print_success "Found target group: $PATTERN"
        break
    fi
done

if [ -z "$TARGET_GROUP_ARN" ]; then
    print_error "Could not find Prometheus target group"
    exit 1
fi

# Get instance if not provided
if [ -z "$INSTANCE_ID" ]; then
    INSTANCE_ID=$(aws elbv2 describe-target-health \
        --profile "$AWS_PROFILE" \
        --region "$AWS_REGION" \
        --target-group-arn "$TARGET_GROUP_ARN" \
        --query 'TargetHealthDescriptions[0].Target.Id' \
        --output text)
fi

if [ -z "$INSTANCE_ID" ] || [ "$INSTANCE_ID" = "null" ]; then
    print_error "No instance found in target group"
    exit 1
fi

print_success "Testing instance: $INSTANCE_ID"
echo ""

# Get health check configuration
HEALTH_CONFIG=$(aws elbv2 describe-target-groups \
    --profile "$AWS_PROFILE" \
    --region "$AWS_REGION" \
    --target-group-arns "$TARGET_GROUP_ARN" \
    --query 'TargetGroups[0]' \
    --output json)

HEALTH_PATH=$(echo "$HEALTH_CONFIG" | jq -r '.HealthCheckPath')
HEALTH_PORT=$(echo "$HEALTH_CONFIG" | jq -r '.HealthCheckPort')

echo "Target Group Health Check Configuration:"
echo "  Path: $HEALTH_PATH"
echo "  Port: $HEALTH_PORT"
echo ""

# Get instance IP
INSTANCE_IP=$(aws ec2 describe-instances \
    --profile "$AWS_PROFILE" \
    --region "$AWS_REGION" \
    --instance-ids "$INSTANCE_ID" \
    --query 'Reservations[0].Instances[0].PrivateIpAddress' \
    --output text)

print_info "Instance IP: $INSTANCE_IP"
echo ""

# Check current health status
HEALTH_STATUS=$(aws elbv2 describe-target-health \
    --profile "$AWS_PROFILE" \
    --region "$AWS_REGION" \
    --target-group-arn "$TARGET_GROUP_ARN" \
    --query 'TargetHealthDescriptions[0].TargetHealth' \
    --output json)

STATE=$(echo "$HEALTH_STATUS" | jq -r '.State')
REASON=$(echo "$HEALTH_STATUS" | jq -r '.Reason // "N/A"')

echo "Current Health Status: $STATE"
if [ "$STATE" = "healthy" ]; then
    print_success "Target is healthy"
else
    print_error "Target is $STATE - Reason: $REASON"
fi
echo ""

# Test endpoints via SSM
print_info "Testing endpoints via SSM Session Manager..."
echo ""

# Test the route-prefix path (what the ALB uses)
# When Prometheus is configured with --web.route-prefix=/prometheus, this is the correct path
echo "Testing: http://localhost:9090/prometheus/-/healthy (ALB health check path)"
RESULT=$(aws ssm send-command \
    --profile "$AWS_PROFILE" \
    --region "$AWS_REGION" \
    --instance-ids "$INSTANCE_ID" \
    --document-name "AWS-RunShellScript" \
    --parameters 'commands=["curl -s -o /dev/null -w \"%{http_code}\" http://localhost:9090/prometheus/-/healthy"]' \
    --output json)

COMMAND_ID=$(echo "$RESULT" | jq -r '.Command.CommandId')
sleep 3

OUTPUT=$(aws ssm get-command-invocation \
    --profile "$AWS_PROFILE" \
    --region "$AWS_REGION" \
    --command-id "$COMMAND_ID" \
    --instance-id "$INSTANCE_ID" \
    --query 'StandardOutputContent' \
    --output text)

if [ "$OUTPUT" = "200" ]; then
    print_success "Route-prefix path (/prometheus/-/healthy) returns: $OUTPUT"
else
    print_error "Route-prefix path (/prometheus/-/healthy) returns: $OUTPUT (Expected 200 when --web.route-prefix=/prometheus is set)"
fi

# Test local path without prefix
# This returns 404 when Prometheus is configured with --web.route-prefix=/prometheus
echo "Testing: http://localhost:9090/-/healthy (root path - expects 404 with route prefix)"
RESULT=$(aws ssm send-command \
    --profile "$AWS_PROFILE" \
    --region "$AWS_REGION" \
    --instance-ids "$INSTANCE_ID" \
    --document-name "AWS-RunShellScript" \
    --parameters 'commands=["curl -s -o /dev/null -w \"%{http_code}\" http://localhost:9090/-/healthy"]' \
    --output json)

COMMAND_ID=$(echo "$RESULT" | jq -r '.Command.CommandId')
sleep 3

OUTPUT=$(aws ssm get-command-invocation \
    --profile "$AWS_PROFILE" \
    --region "$AWS_REGION" \
    --command-id "$COMMAND_ID" \
    --instance-id "$INSTANCE_ID" \
    --query 'StandardOutputContent' \
    --output text)

if [ "$OUTPUT" = "404" ]; then
    print_success "Root path (/-/healthy) returns: $OUTPUT (Expected 404 with route prefix)"
elif [ "$OUTPUT" = "200" ]; then
    print_warning "Root path (/-/healthy) returns: $OUTPUT - Prometheus may not have route prefix configured"
else
    print_warning "Root path (/-/healthy) returns: $OUTPUT"
fi

# Test Prometheus UI
echo "Testing: http://localhost:9090/prometheus/"
RESULT=$(aws ssm send-command \
    --profile "$AWS_PROFILE" \
    --region "$AWS_REGION" \
    --instance-ids "$INSTANCE_ID" \
    --document-name "AWS-RunShellScript" \
    --parameters 'commands=["curl -s -o /dev/null -w \"%{http_code}\" http://localhost:9090/prometheus/"]' \
    --output json)

COMMAND_ID=$(echo "$RESULT" | jq -r '.Command.CommandId')
sleep 3

OUTPUT=$(aws ssm get-command-invocation \
    --profile "$AWS_PROFILE" \
    --region "$AWS_REGION" \
    --command-id "$COMMAND_ID" \
    --instance-id "$INSTANCE_ID" \
    --query 'StandardOutputContent' \
    --output text)

if [ "$OUTPUT" = "200" ]; then
    print_success "Prometheus UI (/prometheus/) returns: $OUTPUT"
else
    print_error "Prometheus UI (/prometheus/) returns: $OUTPUT (Expected 200)"
fi

echo ""
echo "=========================================="
echo "Test Summary"
echo "=========================================="

# Determine if health check path is correct
# When Prometheus uses --web.route-prefix=/prometheus, the ALB health check
# must use /prometheus/-/healthy because ALB forwards the FULL path to the target
if [ "$HEALTH_PATH" = "/prometheus/-/healthy" ]; then
    print_success "Health check path is CORRECT: $HEALTH_PATH"
    echo ""
    print_info "The ALB health check path matches the Prometheus route prefix configuration."
    print_info "Target should become healthy once Prometheus is running and accepting requests."
elif [ "$HEALTH_PATH" = "/-/healthy" ]; then
    print_error "Health check path needs route prefix: $HEALTH_PATH"
    echo ""
    print_info "Prometheus is configured with --web.route-prefix=/prometheus"
    print_info "ALB forwards the FULL path, so health check must be /prometheus/-/healthy"
    print_info "Run the fix script to update:"
    echo "  ./scripts/helper/fix-prometheus-health-check.sh $ENVIRONMENT"
else
    print_warning "Unexpected health check path: $HEALTH_PATH"
    echo ""
    print_info "Expected: /prometheus/-/healthy (when using route prefix)"
    print_info "Run the fix script to update:"
    echo "  ./scripts/helper/fix-prometheus-health-check.sh $ENVIRONMENT"
fi

echo ""
print_info "To monitor health status continuously:"
echo "  watch -n 3 'aws elbv2 describe-target-health --profile $AWS_PROFILE --region $AWS_REGION --target-group-arn $TARGET_GROUP_ARN'"
echo ""
