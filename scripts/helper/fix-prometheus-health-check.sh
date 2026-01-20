#!/bin/bash
set -e

# ============================================================================
# Prometheus Health Check Fix Script
# ============================================================================
# This script updates the Prometheus target group health check configuration
# to ensure the correct health check path is configured.
#
# IMPORTANT: Prometheus is configured with --web.route-prefix=/prometheus
# This means all endpoints (including health) are served under /prometheus/*
# The ALB forwards the FULL path to the target, so the health check path
# must be /prometheus/-/healthy (not /-/healthy).
#
# Usage:
#   ./fix-prometheus-health-check.sh <environment>
#
# Example:
#   ./fix-prometheus-health-check.sh development
#
# What it does:
#   1. Finds the Prometheus target group
#   2. Shows current health check configuration
#   3. Updates health check path to /prometheus/-/healthy (correct path)
#   4. Updates health check timings for faster detection
#   5. Verifies the changes
#   6. Tests the health check endpoint
# ============================================================================

# Colour codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Colour

# Function to print coloured output
print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_header() {
    echo ""
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}========================================${NC}"
}

# Check if environment is provided
if [ -z "$1" ]; then
    print_error "Environment parameter is required"
    echo "Usage: $0 <environment>"
    echo "Example: $0 development"
    exit 1
fi

ENVIRONMENT=$1
AWS_REGION=${AWS_REGION:-eu-west-1}
AWS_PROFILE=${AWS_PROFILE:-dev-account}

print_header "Prometheus Health Check Fix Script"
print_info "Environment: $ENVIRONMENT"
print_info "Region: $AWS_REGION"
print_info "Profile: $AWS_PROFILE"
echo ""

# ============================================================================
# Step 1: Find the Prometheus Target Group
# ============================================================================
print_header "Step 1: Finding Prometheus Target Group"

# Try different naming patterns
TG_PATTERNS=(
    "${ENVIRONMENT}-monitoring-prom"
    "${ENVIRONMENT}-prometheus"
    "monitoring-prom-${ENVIRONMENT}"
)

TARGET_GROUP_ARN=""
for PATTERN in "${TG_PATTERNS[@]}"; do
    print_info "Searching for target group: $PATTERN"
    TG_ARN=$(aws elbv2 describe-target-groups \
        --profile "$AWS_PROFILE" \
        --region "$AWS_REGION" \
        --query "TargetGroups[?TargetGroupName=='$PATTERN'].TargetGroupArn" \
        --output text 2>/dev/null || echo "")
    
    if [ -n "$TG_ARN" ]; then
        TARGET_GROUP_ARN=$TG_ARN
        print_success "Found target group: $PATTERN"
        print_info "ARN: $TARGET_GROUP_ARN"
        break
    fi
done

if [ -z "$TARGET_GROUP_ARN" ]; then
    print_error "Could not find Prometheus target group"
    print_info "Listing all target groups in region:"
    aws elbv2 describe-target-groups \
        --profile "$AWS_PROFILE" \
        --region "$AWS_REGION" \
        --query 'TargetGroups[*].[TargetGroupName,TargetGroupArn]' \
        --output table
    exit 1
fi

# ============================================================================
# Step 2: Show Current Health Check Configuration
# ============================================================================
print_header "Step 2: Current Health Check Configuration"

CURRENT_CONFIG=$(aws elbv2 describe-target-groups \
    --profile "$AWS_PROFILE" \
    --region "$AWS_REGION" \
    --target-group-arns "$TARGET_GROUP_ARN" \
    --query 'TargetGroups[0]' \
    --output json)

CURRENT_PATH=$(echo "$CURRENT_CONFIG" | jq -r '.HealthCheckPath')
CURRENT_INTERVAL=$(echo "$CURRENT_CONFIG" | jq -r '.HealthCheckIntervalSeconds')
CURRENT_TIMEOUT=$(echo "$CURRENT_CONFIG" | jq -r '.HealthCheckTimeoutSeconds')
CURRENT_HEALTHY=$(echo "$CURRENT_CONFIG" | jq -r '.HealthyThresholdCount')
CURRENT_UNHEALTHY=$(echo "$CURRENT_CONFIG" | jq -r '.UnhealthyThresholdCount')

echo "Current Configuration:"
echo "  Health Check Path:       $CURRENT_PATH"
echo "  Interval:                ${CURRENT_INTERVAL}s"
echo "  Timeout:                 ${CURRENT_TIMEOUT}s"
echo "  Healthy Threshold:       $CURRENT_HEALTHY"
echo "  Unhealthy Threshold:     $CURRENT_UNHEALTHY"
echo ""

# Check if path needs fixing
if [ "$CURRENT_PATH" = "/-/healthy" ]; then
    print_success "Health check path is already correct!"
    print_info "Current path: $CURRENT_PATH"
else
    print_warning "Health check path needs updating"
    print_info "Current:  $CURRENT_PATH"
    print_info "Expected: /-/healthy"
fi

# ============================================================================
# Step 3: Get Target Instance Details (for testing)
# ============================================================================
print_header "Step 3: Getting Target Instance Details"

TARGET_HEALTH=$(aws elbv2 describe-target-health \
    --profile "$AWS_PROFILE" \
    --region "$AWS_REGION" \
    --target-group-arn "$TARGET_GROUP_ARN" \
    --output json)

INSTANCE_ID=$(echo "$TARGET_HEALTH" | jq -r '.TargetHealthDescriptions[0].Target.Id')
INSTANCE_PORT=$(echo "$TARGET_HEALTH" | jq -r '.TargetHealthDescriptions[0].Target.Port')
HEALTH_STATE=$(echo "$TARGET_HEALTH" | jq -r '.TargetHealthDescriptions[0].TargetHealth.State')
HEALTH_REASON=$(echo "$TARGET_HEALTH" | jq -r '.TargetHealthDescriptions[0].TargetHealth.Reason // "N/A"')

echo "Target Instance:"
echo "  Instance ID:    $INSTANCE_ID"
echo "  Port:           $INSTANCE_PORT"
echo "  Health State:   $HEALTH_STATE"
echo "  Reason:         $HEALTH_REASON"
echo ""

# Get instance IP
if [ "$INSTANCE_ID" != "null" ] && [ -n "$INSTANCE_ID" ]; then
    INSTANCE_IP=$(aws ec2 describe-instances \
        --profile "$AWS_PROFILE" \
        --region "$AWS_REGION" \
        --instance-ids "$INSTANCE_ID" \
        --query 'Reservations[0].Instances[0].PrivateIpAddress' \
        --output text)
    print_info "Instance Private IP: $INSTANCE_IP"
fi

# ============================================================================
# Step 4: Test Current Health Check Endpoint
# ============================================================================
print_header "Step 4: Testing Current Health Check Endpoint"

if [ -n "$INSTANCE_IP" ] && [ "$INSTANCE_IP" != "null" ]; then
    print_info "Testing health check endpoints on instance..."
    echo ""
    
    # Test the wrong path (current configuration)
    echo "Testing CURRENT path: http://${INSTANCE_IP}:${INSTANCE_PORT}${CURRENT_PATH}"
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
        --max-time 5 \
        "http://${INSTANCE_IP}:${INSTANCE_PORT}${CURRENT_PATH}" 2>/dev/null || echo "000")
    
    if [ "$HTTP_CODE" = "200" ]; then
        print_success "Current path responds with: $HTTP_CODE"
    else
        print_error "Current path responds with: $HTTP_CODE (Expected 200)"
    fi
    echo ""
    
    # Test the correct path
    echo "Testing CORRECT path: http://${INSTANCE_IP}:${INSTANCE_PORT}/-/healthy"
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
        --max-time 5 \
        "http://${INSTANCE_IP}:${INSTANCE_PORT}/-/healthy" 2>/dev/null || echo "000")
    
    if [ "$HTTP_CODE" = "200" ]; then
        print_success "Correct path responds with: $HTTP_CODE"
    else
        print_error "Correct path responds with: $HTTP_CODE (Expected 200)"
    fi
    echo ""
    
    # Test Prometheus UI
    echo "Testing Prometheus UI: http://${INSTANCE_IP}:${INSTANCE_PORT}/prometheus/"
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
        --max-time 5 \
        "http://${INSTANCE_IP}:${INSTANCE_PORT}/prometheus/" 2>/dev/null || echo "000")
    
    if [ "$HTTP_CODE" = "200" ]; then
        print_success "Prometheus UI responds with: $HTTP_CODE"
    else
        print_warning "Prometheus UI responds with: $HTTP_CODE"
    fi
else
    print_warning "Cannot test endpoints - instance IP not available"
fi

# ============================================================================
# Step 5: Confirm Update
# ============================================================================
print_header "Step 5: Confirm Health Check Update"

echo "The following changes will be made:"
echo ""
echo "  Health Check Path:       ${CURRENT_PATH} → /prometheus/-/healthy"
echo "  Interval:                ${CURRENT_INTERVAL}s → 15s"
echo "  Timeout:                 ${CURRENT_TIMEOUT}s → 10s"
echo "  Healthy Threshold:       ${CURRENT_HEALTHY} → 2"
echo "  Unhealthy Threshold:     ${CURRENT_UNHEALTHY} → 2"
echo ""
echo "Why /prometheus/-/healthy?"
echo "  - ALB forwards the FULL path to the target (does NOT strip prefix)"
echo "  - Prometheus is configured with --web.route-prefix=/prometheus"
echo "  - So Prometheus serves /-/healthy at /prometheus/-/healthy"
echo ""
echo "Benefits:"
echo "  - Fixes health check 404 errors"
echo "  - Faster failure detection: 30s (was ${CURRENT_INTERVAL}s × ${CURRENT_UNHEALTHY} = $((CURRENT_INTERVAL * CURRENT_UNHEALTHY))s)"
echo "  - Faster recovery time: 30s (was ${CURRENT_INTERVAL}s × ${CURRENT_HEALTHY} = $((CURRENT_INTERVAL * CURRENT_HEALTHY))s)"
echo ""

read -p "Do you want to apply these changes? (yes/no): " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
    print_warning "Update cancelled by user"
    exit 0
fi

# ============================================================================
# Step 6: Apply Health Check Configuration
# ============================================================================
print_header "Step 6: Applying Health Check Configuration"

print_info "Updating target group health check settings..."

aws elbv2 modify-target-group \
    --profile "$AWS_PROFILE" \
    --region "$AWS_REGION" \
    --target-group-arn "$TARGET_GROUP_ARN" \
    --health-check-path "/prometheus/-/healthy" \
    --health-check-interval-seconds 15 \
    --health-check-timeout-seconds 10 \
    --healthy-threshold-count 2 \
    --unhealthy-threshold-count 2 \
    --output json > /dev/null

print_success "Health check configuration updated successfully!"

# ============================================================================
# Step 7: Verify Changes
# ============================================================================
print_header "Step 7: Verifying Changes"

sleep 2  # Give AWS API a moment to propagate

NEW_CONFIG=$(aws elbv2 describe-target-groups \
    --profile "$AWS_PROFILE" \
    --region "$AWS_REGION" \
    --target-group-arns "$TARGET_GROUP_ARN" \
    --query 'TargetGroups[0]' \
    --output json)

NEW_PATH=$(echo "$NEW_CONFIG" | jq -r '.HealthCheckPath')
NEW_INTERVAL=$(echo "$NEW_CONFIG" | jq -r '.HealthCheckIntervalSeconds')
NEW_TIMEOUT=$(echo "$NEW_CONFIG" | jq -r '.HealthCheckTimeoutSeconds')
NEW_HEALTHY=$(echo "$NEW_CONFIG" | jq -r '.HealthyThresholdCount')
NEW_UNHEALTHY=$(echo "$NEW_CONFIG" | jq -r '.UnhealthyThresholdCount')

echo "Updated Configuration:"
echo "  Health Check Path:       $NEW_PATH"
echo "  Interval:                ${NEW_INTERVAL}s"
echo "  Timeout:                 ${NEW_TIMEOUT}s"
echo "  Healthy Threshold:       $NEW_HEALTHY"
echo "  Unhealthy Threshold:     $NEW_UNHEALTHY"
echo ""

# Verify all settings are correct
ERRORS=0

if [ "$NEW_PATH" != "/prometheus/-/healthy" ]; then
    print_error "Path not updated correctly: $NEW_PATH"
    ERRORS=$((ERRORS + 1))
fi

if [ "$NEW_INTERVAL" != "15" ]; then
    print_error "Interval not updated correctly: $NEW_INTERVAL"
    ERRORS=$((ERRORS + 1))
fi

if [ "$NEW_TIMEOUT" != "10" ]; then
    print_error "Timeout not updated correctly: $NEW_TIMEOUT"
    ERRORS=$((ERRORS + 1))
fi

if [ "$ERRORS" -eq 0 ]; then
    print_success "All settings verified successfully!"
else
    print_error "Some settings were not updated correctly"
    exit 1
fi

# ============================================================================
# Step 8: Monitor Health Status
# ============================================================================
print_header "Step 8: Monitoring Health Status"

print_info "Waiting for health checks to update (this may take up to 30 seconds)..."
echo ""

for i in {1..20}; do
    HEALTH_STATUS=$(aws elbv2 describe-target-health \
        --profile "$AWS_PROFILE" \
        --region "$AWS_REGION" \
        --target-group-arn "$TARGET_GROUP_ARN" \
        --query 'TargetHealthDescriptions[0].TargetHealth' \
        --output json)
    
    STATE=$(echo "$HEALTH_STATUS" | jq -r '.State')
    REASON=$(echo "$HEALTH_STATUS" | jq -r '.Reason // "N/A"')
    DESCRIPTION=$(echo "$HEALTH_STATUS" | jq -r '.Description // "N/A"')
    
    echo -ne "\rAttempt $i/20 - Health State: $STATE"
    
    if [ "$STATE" = "healthy" ]; then
        echo ""
        print_success "Target is now HEALTHY!"
        echo ""
        echo "Health Check Details:"
        echo "  State:        $STATE"
        echo "  Reason:       $REASON"
        echo "  Description:  $DESCRIPTION"
        break
    elif [ "$STATE" = "unhealthy" ]; then
        if [ $i -eq 20 ]; then
            echo ""
            print_error "Target is still UNHEALTHY after 20 attempts"
            echo ""
            echo "Health Check Details:"
            echo "  State:        $STATE"
            echo "  Reason:       $REASON"
            echo "  Description:  $DESCRIPTION"
        fi
    fi
    
    sleep 3
done

# ============================================================================
# Step 9: Summary and Next Steps
# ============================================================================
print_header "Step 9: Summary"

echo "Health check configuration has been updated!"
echo ""
echo "Changes Applied:"
echo "  ✓ Health check path: /prometheus/-/healthy"
echo "  ✓ Interval: 15 seconds"
echo "  ✓ Timeout: 10 seconds"
echo "  ✓ Healthy threshold: 2"
echo "  ✓ Unhealthy threshold: 2"
echo ""
echo "Next Steps:"
echo "  1. Monitor the target health in AWS Console:"
echo "     https://console.aws.amazon.com/ec2/v2/home?region=${AWS_REGION}#TargetGroups:"
echo ""
echo "  2. Verify Prometheus is accessible via ALB:"
echo "     Check your ALB DNS name in the console"
echo ""
echo "  3. Deploy CDK changes to make this permanent:"
echo "     cd /path/to/monitoring-iac"
echo "     PROJECT_NAME=monitoring ENVIRONMENT=${ENVIRONMENT} cdk deploy '*' --require-approval never"
echo ""

if [ "$STATE" = "healthy" ]; then
    print_success "Health check is working! The fix is confirmed."
else
    print_warning "Health check is not yet healthy. Check the logs above for details."
    echo ""
    echo "Troubleshooting Commands:"
    echo ""
    echo "  # Check Prometheus logs on the instance"
    echo "  aws ssm start-session --profile $AWS_PROFILE --target $INSTANCE_ID --region $AWS_REGION"
    echo "  docker logs \$(docker ps -q -f name=prometheus)"
    echo ""
    echo "  # Test health check manually from instance"
    echo "  curl -v http://localhost:9090/-/healthy"
    echo "  curl -v http://localhost:9090/prometheus/-/healthy"
    echo ""
    echo "  # Check security groups"
    echo "  aws ec2 describe-instances --profile $AWS_PROFILE --instance-ids $INSTANCE_ID --region $AWS_REGION \\"
    echo "    --query 'Reservations[0].Instances[0].SecurityGroups' --output table"
fi

print_success "Script completed!"
