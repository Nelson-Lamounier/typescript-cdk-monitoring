#!/bin/bash
# Reset Grafana admin password to match Secrets Manager secret

set -e

ENV_NAME="${ENV_NAME:-development}"
PROFILE="${PROFILE:-dev-account}"
REGION="${REGION:-eu-west-1}"

# Auto-detect cluster name if not provided
# Try common patterns: ${env}-monitoring-monitoring-cluster, ${env}-monitoring-cluster
if [ -z "$CLUSTER_NAME" ]; then
  echo "Auto-detecting cluster name..."
  CLUSTER_NAME=$(aws ecs list-clusters \
    --query "clusterArns[?contains(@, \`${ENV_NAME}\`) && contains(@, \`monitoring\`)].split('/')[1]" \
    --output text \
    --profile "${PROFILE}" \
    --region "${REGION}" | head -n1)
  
  if [ -z "$CLUSTER_NAME" ] || [ "$CLUSTER_NAME" == "None" ]; then
    # Fallback to common pattern
    CLUSTER_NAME="${ENV_NAME}-monitoring-monitoring-cluster"
    echo "Using fallback cluster name: ${CLUSTER_NAME}"
  else
    echo "Found cluster: ${CLUSTER_NAME}"
  fi
fi

# Auto-detect service name if not provided
# Try common patterns: ${env}-grafana, ${env}-grafana-service
if [ -z "$SERVICE_NAME" ]; then
  echo "Auto-detecting service name..."
  SERVICE_NAME=$(aws ecs list-services \
    --cluster "${CLUSTER_NAME}" \
    --query "serviceArns[?contains(@, \`${ENV_NAME}\`) && contains(@, \`grafana\`)].split('/')[1]" \
    --output text \
    --profile "${PROFILE}" \
    --region "${REGION}" | head -n1)
  
  if [ -z "$SERVICE_NAME" ] || [ "$SERVICE_NAME" == "None" ]; then
    # Fallback to common pattern
    SERVICE_NAME="${ENV_NAME}-grafana"
    echo "Using fallback service name: ${SERVICE_NAME}"
  else
    echo "Found service: ${SERVICE_NAME}"
  fi
fi

SECRET_NAME="${ENV_NAME}-grafana-admin-password"

echo "========================================="
echo "Grafana Password Reset"
echo "========================================="
echo "Environment: ${ENV_NAME}"
echo "Cluster: ${CLUSTER_NAME}"
echo "Service: ${SERVICE_NAME}"
echo "Secret: ${SECRET_NAME}"
echo ""

# Step 1: Get password from Secrets Manager
echo "Step 1: Retrieving password from Secrets Manager..."
PASSWORD=$(aws secretsmanager get-secret-value \
  --secret-id "${SECRET_NAME}" \
  --query SecretString \
  --output text \
  --profile "${PROFILE}" \
  --region "${REGION}" | jq -r '.password')

if [ -z "$PASSWORD" ] || [ "$PASSWORD" == "null" ]; then
  echo "ERROR: Failed to retrieve password from secret"
  exit 1
fi

echo "✓ Password retrieved (length: ${#PASSWORD})"
echo ""

# Step 2: Get running Grafana task
echo "Step 2: Finding running Grafana task..."
TASK_ARN=$(aws ecs list-tasks \
  --cluster "${CLUSTER_NAME}" \
  --service-name "${SERVICE_NAME}" \
  --desired-status RUNNING \
  --query 'taskArns[0]' \
  --output text \
  --profile "${PROFILE}" \
  --region "${REGION}")

if [ -z "$TASK_ARN" ] || [ "$TASK_ARN" == "None" ]; then
  echo "ERROR: No running Grafana task found"
  echo "Please ensure the Grafana service is running"
  exit 1
fi

echo "✓ Found task: ${TASK_ARN}"
echo ""

# Step 3: Reset password in Grafana
echo "Step 3: Resetting Grafana admin password..."
echo "This will update the password in Grafana's database to match the secret."
echo ""

aws ecs execute-command \
  --cluster "${CLUSTER_NAME}" \
  --task "${TASK_ARN}" \
  --container grafana \
  --command "grafana cli admin reset-admin-password '${PASSWORD}'" \
  --interactive \
  --profile "${PROFILE}" \
  --region "${REGION}"

echo ""
echo "========================================="
echo "Password Reset Complete"
echo "========================================="
echo ""
echo "You can now log in with:"
echo "  Username: admin"
echo "  Password: ${PASSWORD}"
echo ""

# Get ALB DNS for convenience
ALB_DNS=$(aws elbv2 describe-load-balancers \
  --query "LoadBalancers[?contains(LoadBalancerName, \`${ENV_NAME}-monitoring\`)].DNSName" \
  --output text \
  --profile "${PROFILE}" \
  --region "${REGION}" | head -n1)

if [ ! -z "$ALB_DNS" ]; then
  echo "Grafana URL: http://${ALB_DNS}/grafana"
fi
echo ""
