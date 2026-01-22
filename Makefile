# Monitoring Infrastructure Makefile
# 
# This Makefile provides convenient targets for common operations including:
# - Stack verification
# - CDK deployments
# - Testing (granular and domain-based for CI optimization)
# - Linting
#
# Usage: make <target>
# For help: make help

.PHONY: help
.DEFAULT_GOAL := help

# ============================================================================
# CONFIGURATION
# ============================================================================

# Default environment and AWS profile
ENVIRONMENT ?= development
AWS_PROFILE ?= dev-account
AWS_REGION ?= eu-west-1
PROJECT_NAME ?= monitoring
AWS_ACCOUNT_ID ?=

# Script paths
VERIFY_EFS_SCRIPT := scripts/tests/verify-efs-stack.sh
VERIFY_INFRA_SCRIPT := scripts/tests/verify-infra-stack.sh

# Stack names
NETWORKING_STACK := $(ENVIRONMENT)-Networking
EFS_STACK := $(ENVIRONMENT)-MonitoringEfs
INFRA_STACK := $(ENVIRONMENT)-MonitoringInfra
SERVICE_STACK := $(ENVIRONMENT)-MonitoringService

# Colours for output
BLUE := \033[0;34m
GREEN := \033[0;32m
YELLOW := \033[0;33m
RED := \033[0;31m
NC := \033[0m # No Colour

# Common test environment variables
TEST_ENV := CDK_DOCKER_VERBOSE=false CDK_DEBUG=false CDK_ASSET_VERBOSE=false DOCKER_BUILDKIT=1 BUILDKIT_PROGRESS=quiet

# ============================================================================
# HELP
# ============================================================================

help: ## Show this help message
	@echo ""
	@echo "$(BLUE)Monitoring Infrastructure - Available Targets$(NC)"
	@echo ""
	@echo "$(GREEN)Verification:$(NC)"
	@grep -E '^verify-.*:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  $(BLUE)%-32s$(NC) %s\n", $$1, $$2}'
	@echo ""
	@echo "$(GREEN)Deployment:$(NC)"
	@grep -E '^deploy-.*:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  $(BLUE)%-32s$(NC) %s\n", $$1, $$2}'
	@echo ""
	@echo "$(GREEN)CDK Operations:$(NC)"
	@grep -E '^(synth|diff|destroy|list):.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  $(BLUE)%-32s$(NC) %s\n", $$1, $$2}'
	@echo ""
	@echo "$(GREEN)Testing - Domain (CI Optimized):$(NC)"
	@grep -E '^test-domain-.*:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  $(BLUE)%-32s$(NC) %s\n", $$1, $$2}'
	@echo ""
	@echo "$(GREEN)Testing - General:$(NC)"
	@grep -E '^test(-coverage|-watch|-update-snapshots|-unit|-stacks)?:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  $(BLUE)%-32s$(NC) %s\n", $$1, $$2}'
	@echo ""
	@echo "$(GREEN)Testing - Security & Connectivity:$(NC)"
	@grep -E '^test-(security|connectivity)[^-]*:.*?## .*$$' $(MAKEFILE_LIST) | head -5 | awk 'BEGIN {FS = ":.*?## "}; {printf "  $(BLUE)%-32s$(NC) %s\n", $$1, $$2}'
	@echo "  ... (run 'make help-tests' for full list)"
	@echo ""
	@echo "$(GREEN)Linting & Build:$(NC)"
	@grep -E '^(lint|build|typecheck)(-ci|-fix)?:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  $(BLUE)%-32s$(NC) %s\n", $$1, $$2}'
	@echo ""
	@echo "$(GREEN)Utilities:$(NC)"
	@grep -E '^(clean|install|check-env|tree|get-):.*?## .*$$' $(MAKEFILE_LIST) | head -8 | awk 'BEGIN {FS = ":.*?## "}; {printf "  $(BLUE)%-32s$(NC) %s\n", $$1, $$2}'
	@echo ""
	@echo "$(YELLOW)Configuration:$(NC)"
	@echo "  ENVIRONMENT  = $(ENVIRONMENT)"
	@echo "  AWS_PROFILE  = $(AWS_PROFILE)"
	@echo "  AWS_REGION   = $(AWS_REGION)"
	@echo ""
	@echo "$(YELLOW)Examples:$(NC)"
	@echo "  make test-domain-webapp              # Run only webapp tests (fast CI)"
	@echo "  make test-domain-monitoring          # Run only monitoring tests (fast CI)"
	@echo "  make test-networking                 # Run granular networking tests"
	@echo "  make verify-webapp-all               # Verify all webapp stacks"
	@echo "  make deploy-all                      # Deploy all stacks in order"
	@echo "  make ENVIRONMENT=production deploy-efs  # Deploy to production"
	@echo ""

help-tests: ## Show all available test targets
	@echo ""
	@echo "$(BLUE)All Test Targets$(NC)"
	@echo ""
	@echo "$(GREEN)Domain Tests (CI Optimized):$(NC)"
	@grep -E '^test-domain-.*:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  $(BLUE)%-40s$(NC) %s\n", $$1, $$2}'
	@echo ""
	@echo "$(GREEN)General Tests:$(NC)"
	@grep -E '^test(-coverage|-watch|-update-snapshots|-unit|-stacks)?:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  $(BLUE)%-40s$(NC) %s\n", $$1, $$2}'
	@echo ""
	@echo "$(GREEN)Security Tests:$(NC)"
	@grep -E '^test-security.*:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  $(BLUE)%-40s$(NC) %s\n", $$1, $$2}'
	@echo ""
	@echo "$(GREEN)Connectivity Tests:$(NC)"
	@grep -E '^test-connectivity.*:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  $(BLUE)%-40s$(NC) %s\n", $$1, $$2}'
	@echo ""
	@echo "$(GREEN)Networking Tests:$(NC)"
	@grep -E '^test-networking.*:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  $(BLUE)%-40s$(NC) %s\n", $$1, $$2}'
	@echo ""
	@echo "$(GREEN)Monitoring Tests:$(NC)"
	@grep -E '^test-monitoring.*:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  $(BLUE)%-40s$(NC) %s\n", $$1, $$2}'
	@echo ""
	@echo "$(GREEN)Construct Tests:$(NC)"
	@grep -E '^test-constructs[^:]*:.*?## .*$$' $(MAKEFILE_LIST) | head -10 | awk 'BEGIN {FS = ":.*?## "}; {printf "  $(BLUE)%-40s$(NC) %s\n", $$1, $$2}'
	@echo "  ... (more construct tests available)"
	@echo ""
	@echo "$(GREEN)Helper Tests:$(NC)"
	@grep -E '^test-helpers.*:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  $(BLUE)%-40s$(NC) %s\n", $$1, $$2}'
	@echo ""

# ============================================================================
# VERIFICATION TARGETS
# ============================================================================

verify-networking: ## Verify Networking stack deployment and readiness
	@echo "$(BLUE)Verifying Networking Stack...$(NC)"
	@echo "Environment: $(ENVIRONMENT)"
	@echo "AWS Region: $(AWS_REGION)"
	@if [ -n "$(OUTPUTS_FILE)" ]; then \
		echo "Using outputs file: $(OUTPUTS_FILE)"; \
	fi
	@if [ -n "$(AWS_PROFILE)" ]; then \
		echo "AWS Profile: $(AWS_PROFILE)"; \
	else \
		echo "AWS Profile: (using default credentials)"; \
	fi
	@echo ""
	@if [ -n "$(AWS_PROFILE)" ] && [ -n "$(OUTPUTS_FILE)" ]; then \
		npx tsx scripts/integration/deployment/monitoring/verify-networking-stack.ts \
			-e $(ENVIRONMENT) \
			-r $(AWS_REGION) \
			-p $(AWS_PROFILE) \
			-o $(OUTPUTS_FILE) \
			-v; \
	elif [ -n "$(OUTPUTS_FILE)" ]; then \
		npx tsx scripts/integration/deployment/monitoring/verify-networking-stack.ts \
			-e $(ENVIRONMENT) \
			-r $(AWS_REGION) \
			-o $(OUTPUTS_FILE); \
	elif [ -n "$(AWS_PROFILE)" ]; then \
		npx tsx scripts/integration/deployment/monitoring/verify-networking-stack.ts \
			-e $(ENVIRONMENT) \
			-r $(AWS_REGION) \
			-p $(AWS_PROFILE) \
			-v; \
	else \
		npx tsx scripts/integration/deployment/monitoring/verify-networking-stack.ts \
			-e $(ENVIRONMENT) \
			-r $(AWS_REGION); \
	fi

verify-efs: ## Verify EFS stack deployment and readiness
	@echo "$(BLUE)Verifying EFS Stack...$(NC)"
	@echo "Environment: $(ENVIRONMENT)"
	@echo "AWS Profile: $(AWS_PROFILE)"
	@echo ""
	@npx tsx scripts/integration/deployment/monitoring/verify-efs-stack.ts -e $(ENVIRONMENT) -p $(AWS_PROFILE) -r $(AWS_REGION)

verify-infra: ## Verify Infrastructure stack deployment and readiness
	@echo "$(BLUE)Verifying Infrastructure Stack...$(NC)"
	@echo "Environment: $(ENVIRONMENT)"
	@echo "AWS Region: $(AWS_REGION)"
	@if [ -n "$(AWS_PROFILE)" ]; then \
		echo "AWS Profile: $(AWS_PROFILE)"; \
		npx tsx scripts/integration/deployment/monitoring/verify-infra-stack.ts -e $(ENVIRONMENT) -r $(AWS_REGION) -p $(AWS_PROFILE); \
	else \
		echo "AWS Profile: (using default credentials)"; \
		npx tsx scripts/integration/deployment/monitoring/verify-infra-stack.ts -e $(ENVIRONMENT) -r $(AWS_REGION); \
	fi

verify-s3: ## Verify S3 stack deployment and readiness
	@echo "$(BLUE)Verifying S3 Stack...$(NC)"
	@echo "Environment: $(ENVIRONMENT)"
	@echo "AWS Region: $(AWS_REGION)"
	@if [ -n "$(AWS_PROFILE)" ]; then \
		echo "AWS Profile: $(AWS_PROFILE)"; \
		if [ -n "$(BUCKET_NAME)" ]; then \
			npx tsx scripts/integration/deployment/monitoring/verify-s3-creation.ts \
				-e $(ENVIRONMENT) \
				-r $(AWS_REGION) \
				-p $(AWS_PROFILE) \
				-b $(BUCKET_NAME); \
		else \
			npx tsx scripts/integration/deployment/monitoring/verify-s3-creation.ts \
				-e $(ENVIRONMENT) \
				-r $(AWS_REGION) \
				-p $(AWS_PROFILE); \
		fi \
	elif [ -n "$(BUCKET_NAME)" ]; then \
		echo "AWS Profile: (using default credentials)"; \
		npx tsx scripts/integration/deployment/monitoring/verify-s3-creation.ts \
			-e $(ENVIRONMENT) \
			-r $(AWS_REGION) \
			-b $(BUCKET_NAME); \
	else \
		echo "AWS Profile: (using default credentials)"; \
		npx tsx scripts/integration/deployment/monitoring/verify-s3-creation.ts \
			-e $(ENVIRONMENT) \
			-r $(AWS_REGION); \
	fi

verify-service: ## Verify Service stack deployment and readiness
	@echo "$(BLUE)Verifying Service Stack...$(NC)"
	@echo "Environment: $(ENVIRONMENT)"
	@echo "AWS Region: $(AWS_REGION)"
	@if [ -n "$(AWS_PROFILE)" ]; then \
		echo "AWS Profile: $(AWS_PROFILE)"; \
		npx tsx scripts/integration/deployment/monitoring/verify-infra-stack.ts -e $(ENVIRONMENT) -r $(AWS_REGION) -p $(AWS_PROFILE) --service-only || true; \
	else \
		echo "AWS Profile: (using default credentials)"; \
		npx tsx scripts/integration/deployment/monitoring/verify-infra-stack.ts -e $(ENVIRONMENT) -r $(AWS_REGION) --service-only || true; \
	fi

verify-grafana-prometheus: ## Diagnose Grafana-Prometheus connectivity issues
	@echo "$(BLUE)Verifying Grafana-Prometheus Connectivity...$(NC)"
	@echo "Environment: $(ENVIRONMENT)"
	@echo "AWS Region: $(AWS_REGION)"
	@if [ -n "$(AWS_PROFILE)" ]; then \
		echo "AWS Profile: $(AWS_PROFILE)"; \
		npx tsx scripts/integration/deployment/monitoring/verify-datasource-connectivity.ts -e $(ENVIRONMENT) -r $(AWS_REGION) -p $(AWS_PROFILE); \
	else \
		echo "AWS Profile: (using default credentials)"; \
		npx tsx scripts/integration/deployment/monitoring/verify-datasource-connectivity.ts -e $(ENVIRONMENT) -r $(AWS_REGION); \
	fi

verify-all: verify-networking verify-s3 verify-efs verify-infra verify-service ## Verify all stacks in order
	@echo ""
	@echo "$(GREEN)✓ All verification checks completed$(NC)"

verify-bootstrap: ## Verify CDK bootstrap stack
	@echo "$(BLUE)Verifying CDK Bootstrap...$(NC)"
	@echo "Environment: $(ENVIRONMENT)"
	@echo "AWS Profile: $(AWS_PROFILE)"
	@echo "AWS Region: $(AWS_REGION)"
	@echo ""
	@if [ -z "$(AWS_ACCOUNT_ID)" ]; then \
		echo "$(RED)ERROR: AWS_ACCOUNT_ID not set$(NC)"; \
		echo "Usage: make verify-bootstrap AWS_ACCOUNT_ID=<account-id> ENVIRONMENT=$(ENVIRONMENT) AWS_REGION=$(AWS_REGION)"; \
		exit 1; \
	fi
	@npx tsx scripts/integration/deployment/verify-bootstrap.ts \
		--aws-account-id $(AWS_ACCOUNT_ID) \
		--aws-region $(AWS_REGION) \
		--environment $(ENVIRONMENT) \
		--project-name $(PROJECT_NAME)

verify-environment: ## Verify CDK deployment environment setup
	@echo "$(BLUE)Verifying CDK Deployment Environment...$(NC)"
	@echo "Environment: $(ENVIRONMENT)"
	@echo "AWS Region: $(AWS_REGION)"
	@echo ""
	@npx tsx scripts/integration/deployment/verify-environment.ts \
		--environment $(ENVIRONMENT) \
		--aws-region $(AWS_REGION) \
		--auto-build-on-failure

# ============================================================================
# WEBAPP VERIFICATION TARGETS
# ============================================================================

verify-webapp-ecr: ## Verify Webapp ECR repository deployment
	@echo "$(BLUE)Verifying Webapp ECR Repository...$(NC)"
	@echo "Environment: $(ENVIRONMENT)"
	@echo "AWS Region: $(AWS_REGION)"
	@if [ -n "$(AWS_PROFILE)" ]; then \
		echo "AWS Profile: $(AWS_PROFILE)"; \
		npx tsx scripts/integration/deployment/webapp/verify-ecr-stack.ts \
			--environment $(ENVIRONMENT) \
			--region $(AWS_REGION) \
			--profile $(AWS_PROFILE); \
	else \
		echo "AWS Profile: (using default credentials)"; \
		npx tsx scripts/integration/deployment/webapp/verify-ecr-stack.ts \
			--environment $(ENVIRONMENT) \
			--region $(AWS_REGION); \
	fi

verify-webapp-dynamodb: ## Verify Webapp DynamoDB table and S3 bucket deployment
	@echo "$(BLUE)Verifying Webapp DynamoDB Stack...$(NC)"
	@echo "Environment: $(ENVIRONMENT)"
	@echo "AWS Region: $(AWS_REGION)"
	@if [ -n "$(AWS_PROFILE)" ]; then \
		echo "AWS Profile: $(AWS_PROFILE)"; \
		npx tsx scripts/integration/deployment/webapp/verify-dynamodb-stack.ts \
			--environment $(ENVIRONMENT) \
			--region $(AWS_REGION) \
			--profile $(AWS_PROFILE); \
	else \
		echo "AWS Profile: (using default credentials)"; \
		npx tsx scripts/integration/deployment/webapp/verify-dynamodb-stack.ts \
			--environment $(ENVIRONMENT) \
			--region $(AWS_REGION); \
	fi

verify-webapp-api: ## Verify Webapp API Gateway and Lambda deployment
	@echo "$(BLUE)Verifying Webapp API Stack...$(NC)"
	@echo "Environment: $(ENVIRONMENT)"
	@echo "AWS Region: $(AWS_REGION)"
	@if [ -n "$(SKIP_SMOKE_TESTS)" ] && [ "$(SKIP_SMOKE_TESTS)" = "true" ]; then \
		echo "Smoke Tests: Skipped"; \
	else \
		echo "Smoke Tests: Enabled"; \
	fi
	@if [ -n "$(AWS_PROFILE)" ]; then \
		echo "AWS Profile: $(AWS_PROFILE)"; \
		if [ -n "$(SKIP_SMOKE_TESTS)" ] && [ "$(SKIP_SMOKE_TESTS)" = "true" ]; then \
			npx tsx scripts/integration/deployment/webapp/verify-api-stack.ts \
				--environment $(ENVIRONMENT) \
				--region $(AWS_REGION) \
				--profile $(AWS_PROFILE) \
				--skip-smoke-tests; \
		else \
			npx tsx scripts/integration/deployment/webapp/verify-api-stack.ts \
				--environment $(ENVIRONMENT) \
				--region $(AWS_REGION) \
				--profile $(AWS_PROFILE); \
		fi \
	else \
		echo "AWS Profile: (using default credentials)"; \
		if [ -n "$(SKIP_SMOKE_TESTS)" ] && [ "$(SKIP_SMOKE_TESTS)" = "true" ]; then \
			npx tsx scripts/integration/deployment/webapp/verify-api-stack.ts \
				--environment $(ENVIRONMENT) \
				--region $(AWS_REGION) \
				--skip-smoke-tests; \
		else \
			npx tsx scripts/integration/deployment/webapp/verify-api-stack.ts \
				--environment $(ENVIRONMENT) \
				--region $(AWS_REGION); \
		fi \
	fi

verify-webapp-all: verify-networking verify-webapp-ecr verify-webapp-dynamodb verify-webapp-api ## Verify all webapp stacks in order
	@echo ""
	@echo "$(GREEN)✓ All webapp verification checks completed$(NC)"

# ============================================================================
# DEPLOYMENT TARGETS
# ============================================================================

deploy-networking: ## Deploy Networking stack (foundational - must be deployed first)
	@echo "$(BLUE)Deploying Networking Stack...$(NC)"
	@echo "Stack: $(NETWORKING_STACK)"
	@echo "Profile: $(AWS_PROFILE)"
	@echo ""
	cdk deploy $(NETWORKING_STACK) --profile $(AWS_PROFILE) --require-approval never

deploy-efs: ## Deploy EFS stack (requires Networking stack)
	@echo "$(BLUE)Deploying EFS Stack...$(NC)"
	@echo "Stack: $(EFS_STACK)"
	@echo "Profile: $(AWS_PROFILE)"
	@echo ""
	cdk deploy $(EFS_STACK) --profile $(AWS_PROFILE) --require-approval never

deploy-infra: ## Deploy Infrastructure stack (requires EFS stack)
	@echo "$(BLUE)Deploying Infrastructure Stack...$(NC)"
	@echo "Stack: $(INFRA_STACK)"
	@echo "Profile: $(AWS_PROFILE)"
	@echo ""
	@echo "$(YELLOW)Note: This requires EFS stack to be deployed first$(NC)"
	@echo ""
	cdk deploy $(INFRA_STACK) --profile $(AWS_PROFILE) --require-approval never

deploy-service: ## Deploy Service stack (requires Infrastructure stack)
	@echo "$(BLUE)Deploying Service Stack...$(NC)"
	@echo "Stack: $(SERVICE_STACK)"
	@echo "Profile: $(AWS_PROFILE)"
	@echo ""
	@echo "$(YELLOW)Note: This requires Infrastructure stack to be deployed first$(NC)"
	@echo ""
	cdk deploy $(SERVICE_STACK) --profile $(AWS_PROFILE) --require-approval never

deploy-all: deploy-networking deploy-efs deploy-infra deploy-service ## Deploy all stacks in correct order
	@echo ""
	@echo "$(GREEN)✓ All stacks deployed successfully$(NC)"
	@echo ""
	@echo "$(YELLOW)Next steps:$(NC)"
	@echo "  1. Run 'make verify-all' to verify deployment"
	@echo "  2. Get ALB DNS: make get-alb-dns"
	@echo "  3. Access Prometheus at http://<ALB-DNS>:9090"
	@echo "  4. Access Grafana at http://<ALB-DNS>:3000"

# ============================================================================
# CDK OPERATIONS
# ============================================================================

synth: ## Synthesise CloudFormation templates
	@echo "$(BLUE)Synthesising CloudFormation templates...$(NC)"
	cdk synth --profile $(AWS_PROFILE)

diff: ## Show differences between deployed and local stacks
	@echo "$(BLUE)Showing stack differences...$(NC)"
	cdk diff --profile $(AWS_PROFILE)

diff-efs: ## Show differences for EFS stack
	@echo "$(BLUE)Showing EFS stack differences...$(NC)"
	cdk diff $(EFS_STACK) --profile $(AWS_PROFILE)

diff-infra: ## Show differences for Infrastructure stack
	@echo "$(BLUE)Showing Infrastructure stack differences...$(NC)"
	cdk diff $(INFRA_STACK) --profile $(AWS_PROFILE)

diff-service: ## Show differences for Service stack
	@echo "$(BLUE)Showing Service stack differences...$(NC)"
	cdk diff $(SERVICE_STACK) --profile $(AWS_PROFILE)

list: ## List all CDK stacks
	@echo "$(BLUE)Available CDK Stacks:$(NC)"
	cdk list --profile $(AWS_PROFILE)

destroy-service: ## Destroy Service stack
	@echo "$(RED)WARNING: This will destroy the Service stack$(NC)"
	@echo "Stack: $(SERVICE_STACK)"
	@echo ""
	cdk destroy $(SERVICE_STACK) --profile $(AWS_PROFILE)

destroy-infra: ## Destroy Infrastructure stack
	@echo "$(RED)WARNING: This will destroy the Infrastructure stack$(NC)"
	@echo "Stack: $(INFRA_STACK)"
	@echo ""
	cdk destroy $(INFRA_STACK) --profile $(AWS_PROFILE)

destroy-efs: ## Destroy EFS stack
	@echo "$(RED)WARNING: This will destroy the EFS stack and all data$(NC)"
	@echo "Stack: $(EFS_STACK)"
	@echo ""
	cdk destroy $(EFS_STACK) --profile $(AWS_PROFILE)

destroy-all: ## Destroy all stacks in reverse order (DANGEROUS)
	@echo "$(RED)WARNING: This will destroy ALL stacks$(NC)"
	@echo ""
	@read -p "Are you sure? Type 'yes' to confirm: " confirm; \
	if [ "$$confirm" = "yes" ]; then \
		$(MAKE) destroy-service || true; \
		$(MAKE) destroy-infra || true; \
		$(MAKE) destroy-efs || true; \
	else \
		echo "$(YELLOW)Destruction cancelled$(NC)"; \
	fi

# ============================================================================
# DOMAIN-SPECIFIC TEST TARGETS (CI OPTIMIZATION)
# These targets aggregate tests by deployment domain for faster CI runs
# ============================================================================

test-domain-monitoring: ## Run monitoring domain tests only (CI optimized)
	@echo "$(BLUE)Running monitoring domain tests...$(NC)"
	@echo "Includes: stacks/monitoring, constructs/services/monitoring"
	@$(TEST_ENV) yarn jest --testPathPattern="stacks/monitoring|constructs/services/monitoring" --passWithNoTests

test-domain-webapp: ## Run webapp domain tests only (CI optimized)
	@echo "$(BLUE)Running webapp domain tests...$(NC)"
	@echo "Includes: stacks/webapp, stacks/docs"
	@$(TEST_ENV) yarn jest --testPathPattern="stacks/webapp|stacks/docs" --passWithNoTests

test-domain-foundation: ## Run foundation/infrastructure tests only (CI optimized)
	@echo "$(BLUE)Running foundation domain tests...$(NC)"
	@echo "Includes: stacks/foundation, stacks/networking, stacks/security, stacks/storage, stacks/compute"
	@$(TEST_ENV) yarn jest --testPathPattern="stacks/foundation|stacks/networking|stacks/security|stacks/storage|stacks/compute" --passWithNoTests

test-domain-constructs: ## Run all construct tests (CI optimized)
	@echo "$(BLUE)Running construct domain tests...$(NC)"
	@echo "Includes: all tests under constructs/"
	@$(TEST_ENV) yarn jest --testPathPattern="constructs/" --passWithNoTests

test-domain-shared: ## Run shared utilities and helpers tests (CI optimized)
	@echo "$(BLUE)Running shared domain tests...$(NC)"
	@echo "Includes: shared/, helpers/, utils/, types/"
	@$(TEST_ENV) yarn jest --testPathPattern="shared/|helpers/|utils/|types/" --passWithNoTests

test-domain-all: test-domain-monitoring test-domain-webapp test-domain-foundation test-domain-constructs test-domain-shared ## Run all domain tests sequentially
	@echo ""
	@echo "$(GREEN)✓ All domain tests completed$(NC)"

# ============================================================================
# GENERAL TESTING & QUALITY
# ============================================================================

test: ## Run all tests
	@echo "$(BLUE)Running tests...$(NC)"
	@$(TEST_ENV) yarn test

test-watch: ## Run tests in watch mode
	@echo "$(BLUE)Running tests in watch mode...$(NC)"
	@$(TEST_ENV) yarn test:watch

test-coverage: ## Run tests with coverage report
	@echo "$(BLUE)Running tests with coverage...$(NC)"
	@$(TEST_ENV) yarn test --coverage
	@echo ""
	@echo "$(GREEN)Coverage report generated!$(NC)"
	@echo "$(YELLOW)To view HTML report:$(NC)"
	@echo "  - macOS: open coverage/lcov-report/index.html"
	@echo "  - Linux: xdg-open coverage/lcov-report/index.html"
	@echo "  - Windows: start coverage/lcov-report/index.html"
	@echo "  - Or run: make view-coverage"

test-update-snapshots: ## Update Jest snapshots
	@echo "$(BLUE)Updating Jest snapshots...$(NC)"
	@$(TEST_ENV) yarn test:update-snapshots

view-coverage: ## Open coverage HTML report in browser
	@echo "$(BLUE)Opening coverage report in browser...$(NC)"
	@if [ -f "coverage/lcov-report/index.html" ]; then \
		if command -v open > /dev/null; then \
			open coverage/lcov-report/index.html; \
		elif command -v xdg-open > /dev/null; then \
			xdg-open coverage/lcov-report/index.html; \
		elif command -v start > /dev/null; then \
			start coverage/lcov-report/index.html; \
		else \
			echo "$(YELLOW)Please open coverage/lcov-report/index.html in your browser$(NC)"; \
		fi \
	else \
		echo "$(RED)Coverage report not found. Run 'make test-coverage' first.$(NC)"; \
		exit 1; \
	fi

test-unit: ## Run unit tests only
	@echo "$(BLUE)Running unit tests...$(NC)"
	@$(TEST_ENV) yarn test tests/unit

test-stacks: test-networking test-monitoring-efs test-monitoring-infra test-monitoring-service ## Run all stack tests
	@echo "$(GREEN)All stack tests completed$(NC)"

# ============================================================================
# SECURITY TESTS
# ============================================================================

test-security: ## Run all security posture tests
	@echo "$(BLUE)Running security posture tests...$(NC)"
	@$(TEST_ENV) yarn test:security

test-security-network: ## Run network security tests
	@echo "$(BLUE)Running network security tests...$(NC)"
	@$(TEST_ENV) yarn test:security:network

test-security-instance: ## Run instance security tests
	@echo "$(BLUE)Running instance security tests...$(NC)"
	@$(TEST_ENV) yarn test:security:instance

test-security-storage: ## Run storage security tests
	@echo "$(BLUE)Running storage security tests...$(NC)"
	@$(TEST_ENV) yarn test:security:storage

test-security-iam: ## Run IAM security tests
	@echo "$(BLUE)Running IAM security tests...$(NC)"
	@$(TEST_ENV) yarn test:security:iam

test-security-monitoring: ## Run monitoring & logging security tests
	@echo "$(BLUE)Running monitoring & logging security tests...$(NC)"
	@$(TEST_ENV) yarn test:security:monitoring

test-security-application: ## Run application security tests
	@echo "$(BLUE)Running application security tests...$(NC)"
	@$(TEST_ENV) yarn test:security:application

test-security-compliance: ## Run compliance & governance tests
	@echo "$(BLUE)Running compliance & governance tests...$(NC)"
	@$(TEST_ENV) yarn test:security:compliance

test-security-posture: ## Run legacy security posture test file
	@echo "$(BLUE)Running legacy security posture tests...$(NC)"
	@$(TEST_ENV) yarn test:security-posture

# ============================================================================
# CONNECTIVITY TESTS
# ============================================================================

test-connectivity: ## Run connectivity integration tests
	@echo "$(BLUE)Running connectivity tests...$(NC)"
	@$(TEST_ENV) yarn test:connectivity

test-connectivity-coverage: ## Run connectivity integration tests with coverage
	@echo "$(BLUE)Running connectivity tests with coverage...$(NC)"
	@$(TEST_ENV) yarn test:connectivity:coverage

test-network-connectivity: ## Run network connectivity tests
	@echo "$(BLUE)Running network connectivity tests...$(NC)"
	@$(TEST_ENV) yarn test:network-connectivity

test-service-connectivity: ## Run service connectivity tests
	@echo "$(BLUE)Running service connectivity tests...$(NC)"
	@$(TEST_ENV) yarn test:service-connectivity

test-cross-stack-connectivity: ## Run cross-stack connectivity tests
	@echo "$(BLUE)Running cross-stack connectivity tests...$(NC)"
	@$(TEST_ENV) yarn test:cross-stack-connectivity

# ============================================================================
# NETWORKING TESTS
# ============================================================================

test-networking: ## Run networking stack tests
	@echo "$(BLUE)Running networking stack tests...$(NC)"
	@$(TEST_ENV) yarn test tests/unit/stacks/foundation/networking/

test-networking-creation: ## Run networking stack creation tests
	@echo "$(BLUE)Running networking stack creation tests...$(NC)"
	@$(TEST_ENV) yarn test tests/unit/stacks/foundation/networking/networking-stack.creation.test.ts

test-networking-vpc: ## Run networking stack VPC tests
	@echo "$(BLUE)Running networking stack VPC tests...$(NC)"
	@$(TEST_ENV) yarn test tests/unit/stacks/foundation/networking/networking-stack.vpc.test.ts

test-networking-subnets: ## Run networking stack subnet tests
	@echo "$(BLUE)Running networking stack subnet tests...$(NC)"
	@$(TEST_ENV) yarn test tests/unit/stacks/foundation/networking/networking-stack.subnets.test.ts

test-networking-nat: ## Run networking stack NAT gateway tests
	@echo "$(BLUE)Running networking stack NAT gateway tests...$(NC)"
	@$(TEST_ENV) yarn test tests/unit/stacks/foundation/networking/networking-stack.nat.test.ts

test-networking-flow-logs: ## Run networking stack flow logs tests
	@echo "$(BLUE)Running networking stack flow logs tests...$(NC)"
	@$(TEST_ENV) yarn test tests/unit/stacks/foundation/networking/networking-stack.flow-logs.test.ts

test-networking-endpoints: ## Run networking stack VPC endpoints tests
	@echo "$(BLUE)Running networking stack VPC endpoints tests...$(NC)"
	@$(TEST_ENV) yarn test tests/unit/stacks/foundation/networking/networking-stack.endpoints.test.ts

test-networking-ssm: ## Run networking stack SSM parameters tests
	@echo "$(BLUE)Running networking stack SSM parameters tests...$(NC)"
	@$(TEST_ENV) yarn test tests/unit/stacks/foundation/networking/networking-stack.ssm.test.ts

test-networking-validation: ## Run networking stack validation tests
	@echo "$(BLUE)Running networking stack validation tests...$(NC)"
	@$(TEST_ENV) yarn test tests/unit/stacks/foundation/networking/networking-stack.validation.test.ts

test-networking-advanced: ## Run networking stack advanced tests
	@echo "$(BLUE)Running networking stack advanced tests...$(NC)"
	@$(TEST_ENV) yarn test tests/unit/stacks/foundation/networking/networking-stack.advanced.test.ts

# ============================================================================
# MONITORING TESTS
# ============================================================================

test-monitoring-efs: ## Run monitoring EFS stack tests
	@echo "$(BLUE)Running monitoring EFS stack tests...$(NC)"
	@$(TEST_ENV) yarn test tests/unit/stacks/monitoring/monitoring-efs-stack.test.ts

test-monitoring-infra: ## Run monitoring infrastructure stack tests
	@echo "$(BLUE)Running monitoring infrastructure stack tests...$(NC)"
	@$(TEST_ENV) yarn test tests/unit/stacks/monitoring/infra/

test-monitoring-service: ## Run monitoring service stack tests
	@echo "$(BLUE)Running monitoring service stack tests...$(NC)"
	@$(TEST_ENV) yarn test tests/unit/stacks/monitoring/monitoring-service-stack.test.ts

# ============================================================================
# CONSTRUCT TESTS - ECS
# ============================================================================

test-constructs-ecs-asg: ## Run ECS AutoScalingGroup construct tests
	@echo "$(BLUE)Running ECS AutoScalingGroup construct tests...$(NC)"
	@$(TEST_ENV) yarn test tests/unit/constructs/compute/ecs/auto-scaling-group-construct.test.ts

test-constructs-ecs-cluster: ## Run ECS Cluster construct tests
	@echo "$(BLUE)Running ECS Cluster construct tests...$(NC)"
	@$(TEST_ENV) yarn test tests/unit/constructs/compute/ecs/ecs-cluster-construct.test.ts

test-constructs-ecs-service: ## Run ECS Service construct tests
	@echo "$(BLUE)Running ECS Service construct tests...$(NC)"
	@$(TEST_ENV) yarn test tests/unit/constructs/compute/ecs/ecs-service-construct.test.ts

test-constructs-ecs-task-definition: ## Run ECS TaskDefinition construct tests
	@echo "$(BLUE)Running ECS TaskDefinition construct tests...$(NC)"
	@$(TEST_ENV) yarn test tests/unit/constructs/compute/ecs/ecs-task-definition-construct.test.ts

test-constructs-ecs: test-constructs-ecs-asg test-constructs-ecs-cluster test-constructs-ecs-service test-constructs-ecs-task-definition ## Run all ECS construct tests
	@echo "$(GREEN)All ECS construct tests completed$(NC)"

# ============================================================================
# CONSTRUCT TESTS - STORAGE
# ============================================================================

test-constructs-ecr: ## Run ECR construct tests
	@echo "$(BLUE)Running ECR construct tests...$(NC)"
	@$(TEST_ENV) yarn test tests/unit/constructs/storage/ecr-construct.test.ts

test-constructs-efs-access-point: ## Run EFS Access Point construct tests
	@echo "$(BLUE)Running EFS Access Point construct tests...$(NC)"
	@$(TEST_ENV) yarn test tests/unit/constructs/storage/efs-access-point-construct.test.ts

test-constructs-efs-file-system: ## Run EFS File System construct tests
	@echo "$(BLUE)Running EFS File System construct tests...$(NC)"
	@$(TEST_ENV) yarn test tests/unit/constructs/storage/efs-file-system-construct.test.ts

test-constructs-storage: test-constructs-ecr test-constructs-efs-access-point test-constructs-efs-file-system ## Run all storage construct tests
	@echo "$(GREEN)All storage construct tests completed$(NC)"

# ============================================================================
# CONSTRUCT TESTS - NETWORKING
# ============================================================================

test-constructs-alb-listener: ## Run ALB Listener construct tests
	@echo "$(BLUE)Running ALB Listener construct tests...$(NC)"
	@$(TEST_ENV) yarn test tests/unit/constructs/networking/alb-listener-construct.test.ts

test-constructs-alb-target-group: ## Run ALB Target Group construct tests
	@echo "$(BLUE)Running ALB Target Group construct tests...$(NC)"
	@$(TEST_ENV) yarn test tests/unit/constructs/networking/alb-target-group-construct.test.ts

test-constructs-security-group: ## Run Security Group construct tests
	@echo "$(BLUE)Running Security Group construct tests...$(NC)"
	@$(TEST_ENV) yarn test tests/unit/constructs/networking/security-group-construct.test.ts

test-constructs-vpc-peering-creation: ## Run VPC Peering creation tests
	@echo "$(BLUE)Running VPC Peering creation tests...$(NC)"
	@$(TEST_ENV) yarn test tests/unit/constructs/networking/vpc-peering/vpc-peering-construct.creation.test.ts

test-constructs-vpc-peering-configuration: ## Run VPC Peering configuration tests
	@echo "$(BLUE)Running VPC Peering configuration tests...$(NC)"
	@$(TEST_ENV) yarn test tests/unit/constructs/networking/vpc-peering/vpc-peering-construct.configuration.test.ts

test-constructs-vpc-peering-resources: ## Run VPC Peering resources tests
	@echo "$(BLUE)Running VPC Peering resources tests...$(NC)"
	@$(TEST_ENV) yarn test tests/unit/constructs/networking/vpc-peering/vpc-peering-construct.resources.test.ts

test-constructs-vpc-peering: test-constructs-vpc-peering-creation test-constructs-vpc-peering-configuration test-constructs-vpc-peering-resources ## Run all VPC Peering construct tests
	@echo "$(GREEN)All VPC Peering construct tests completed$(NC)"

test-constructs-vpc-flow-logs-creation: ## Run VPC Flow Logs creation tests
	@echo "$(BLUE)Running VPC Flow Logs creation tests...$(NC)"
	@$(TEST_ENV) yarn test tests/unit/constructs/networking/vpc-flow-logs/vpc-flow-logs-construct.creation.test.ts

test-constructs-vpc-flow-logs-configuration: ## Run VPC Flow Logs configuration tests
	@echo "$(BLUE)Running VPC Flow Logs configuration tests...$(NC)"
	@$(TEST_ENV) yarn test tests/unit/constructs/networking/vpc-flow-logs/vpc-flow-logs-construct.configuration.test.ts

test-constructs-vpc-flow-logs-removal-policy: ## Run VPC Flow Logs removal policy tests
	@echo "$(BLUE)Running VPC Flow Logs removal policy tests...$(NC)"
	@$(TEST_ENV) yarn test tests/unit/constructs/networking/vpc-flow-logs/vpc-flow-logs-construct.removal-policy.test.ts

test-constructs-vpc-flow-logs: test-constructs-vpc-flow-logs-creation test-constructs-vpc-flow-logs-configuration test-constructs-vpc-flow-logs-removal-policy ## Run all VPC Flow Logs construct tests
	@echo "$(GREEN)All VPC Flow Logs construct tests completed$(NC)"

test-constructs-networking: test-constructs-alb-listener test-constructs-alb-target-group test-constructs-security-group test-constructs-vpc-flow-logs test-constructs-vpc-peering ## Run all networking construct tests
	@echo "$(GREEN)All networking construct tests completed$(NC)"

# ============================================================================
# CONSTRUCT TESTS - MONITORING SERVICES
# ============================================================================

test-constructs-grafana-creation: ## Run Grafana creation tests
	@echo "$(BLUE)Running Grafana creation tests...$(NC)"
	@$(TEST_ENV) yarn test tests/unit/constructs/services/monitoring/grafana/grafana-construct.creation.test.ts

test-constructs-grafana-launch-type: ## Run Grafana launch type tests
	@echo "$(BLUE)Running Grafana launch type tests...$(NC)"
	@$(TEST_ENV) yarn test tests/unit/constructs/services/monitoring/grafana/grafana-construct.launch-type.test.ts

test-constructs-grafana-service: ## Run Grafana service configuration tests
	@echo "$(BLUE)Running Grafana service configuration tests...$(NC)"
	@$(TEST_ENV) yarn test tests/unit/constructs/services/monitoring/grafana/grafana-construct.service.test.ts

test-constructs-grafana-datasource: ## Run Grafana datasource tests
	@echo "$(BLUE)Running Grafana datasource tests...$(NC)"
	@$(TEST_ENV) yarn test tests/unit/constructs/services/monitoring/grafana/grafana-construct.datasource.test.ts

test-constructs-grafana: test-constructs-grafana-creation test-constructs-grafana-launch-type test-constructs-grafana-service test-constructs-grafana-datasource ## Run all Grafana construct tests
	@echo "$(GREEN)All Grafana construct tests completed$(NC)"

test-constructs-prometheus-creation: ## Run Prometheus creation tests
	@echo "$(BLUE)Running Prometheus creation tests...$(NC)"
	@$(TEST_ENV) yarn test tests/unit/constructs/services/monitoring/prometheus/prometheus-construct.creation.test.ts

test-constructs-prometheus-launch-type: ## Run Prometheus launch type tests
	@echo "$(BLUE)Running Prometheus launch type tests...$(NC)"
	@$(TEST_ENV) yarn test tests/unit/constructs/services/monitoring/prometheus/prometheus-construct.launch-type.test.ts

test-constructs-prometheus-volumes: ## Run Prometheus volumes tests
	@echo "$(BLUE)Running Prometheus volumes tests...$(NC)"
	@$(TEST_ENV) yarn test tests/unit/constructs/services/monitoring/prometheus/prometheus-construct.volumes.test.ts

test-constructs-prometheus-service: ## Run Prometheus service configuration tests
	@echo "$(BLUE)Running Prometheus service configuration tests...$(NC)"
	@$(TEST_ENV) yarn test tests/unit/constructs/services/monitoring/prometheus/prometheus-construct.service.test.ts

test-constructs-prometheus-container: ## Run Prometheus container tests
	@echo "$(BLUE)Running Prometheus container tests...$(NC)"
	@$(TEST_ENV) yarn test tests/unit/constructs/services/monitoring/prometheus/prometheus-construct.container.test.ts

test-constructs-prometheus-alertmanager: ## Run Prometheus Alertmanager tests
	@echo "$(BLUE)Running Prometheus Alertmanager tests...$(NC)"
	@$(TEST_ENV) yarn test tests/unit/constructs/services/monitoring/prometheus/prometheus-construct.alertmanager.test.ts

test-constructs-prometheus-config: ## Run Prometheus configuration tests
	@echo "$(BLUE)Running Prometheus configuration tests...$(NC)"
	@$(TEST_ENV) yarn test tests/unit/constructs/services/monitoring/prometheus/prometheus-construct.config.test.ts

test-constructs-prometheus-validation: ## Run Prometheus validation tests
	@echo "$(BLUE)Running Prometheus validation tests...$(NC)"
	@$(TEST_ENV) yarn test tests/unit/constructs/services/monitoring/prometheus/prometheus-construct.validation.test.ts

test-constructs-prometheus: test-constructs-prometheus-creation test-constructs-prometheus-launch-type test-constructs-prometheus-volumes test-constructs-prometheus-service test-constructs-prometheus-container test-constructs-prometheus-alertmanager test-constructs-prometheus-config test-constructs-prometheus-validation ## Run all Prometheus construct tests
	@echo "$(GREEN)All Prometheus construct tests completed$(NC)"

test-constructs: test-constructs-ecs test-constructs-storage test-constructs-networking test-constructs-grafana test-constructs-prometheus ## Run all construct tests
	@echo "$(GREEN)All construct tests completed$(NC)"

# ============================================================================
# HELPER TESTS
# ============================================================================

test-helpers-subnet-config-basic: ## Run subnet configuration helper basic tests
	@echo "$(BLUE)Running subnet configuration helper basic tests...$(NC)"
	@$(TEST_ENV) yarn test tests/unit/helpers/subnet-configuration/subnet-configuration-helper.basic.test.ts

test-helpers-subnet-config-tiers: ## Run subnet configuration helper tier tests
	@echo "$(BLUE)Running subnet configuration helper tier tests...$(NC)"
	@$(TEST_ENV) yarn test tests/unit/helpers/subnet-configuration/subnet-configuration-helper.tiers.test.ts

test-helpers-subnet-config-eks: ## Run subnet configuration helper EKS tests
	@echo "$(BLUE)Running subnet configuration helper EKS tests...$(NC)"
	@$(TEST_ENV) yarn test tests/unit/helpers/subnet-configuration/subnet-configuration-helper.eks.test.ts

test-helpers-subnet-config-specialized: ## Run subnet configuration helper specialized tests
	@echo "$(BLUE)Running subnet configuration helper specialized tests...$(NC)"
	@$(TEST_ENV) yarn test tests/unit/helpers/subnet-configuration/subnet-configuration-helper.specialized.test.ts

test-helpers-subnet-config: test-helpers-subnet-config-basic test-helpers-subnet-config-tiers test-helpers-subnet-config-eks test-helpers-subnet-config-specialized ## Run all subnet configuration helper tests
	@echo "$(GREEN)All subnet configuration helper tests completed$(NC)"

test-helpers: test-helpers-subnet-config ## Run all helper tests
	@echo "$(GREEN)All helper tests completed$(NC)"

# ============================================================================
# LINTING & BUILD
# ============================================================================

lint: ## Run linter (ESLint with max-warnings 0)
	@echo "$(BLUE)Running linter...$(NC)"
	npx eslint lib/ bin/ tests/ --max-warnings 0

lint-ci: ## Run linter for CI (warnings reported but non-blocking)
	@echo "$(BLUE)Running linter (CI mode - warnings are informational)...$(NC)"
	@npx eslint lib/ bin/ tests/ || { \
		EXIT_CODE=$$?; \
		if [ $$EXIT_CODE -eq 1 ]; then \
			echo "$(YELLOW)Linting completed with warnings (non-blocking)$(NC)"; \
			exit 0; \
		else \
			echo "$(RED)Linting failed with errors$(NC)"; \
			exit $$EXIT_CODE; \
		fi; \
	}

lint-fix: ## Run linter with auto-fix
	@echo "$(BLUE)Running linter with auto-fix...$(NC)"
	yarn lint:fix

typecheck: ## Run TypeScript type checking
	@echo "$(BLUE)Running TypeScript type checking...$(NC)"
	yarn typecheck

build: ## Build TypeScript code
	@echo "$(BLUE)Building TypeScript...$(NC)"
	yarn build

# ============================================================================
# UTILITY TARGETS
# ============================================================================

install: ## Install dependencies
	@echo "$(BLUE)Installing dependencies...$(NC)"
	yarn install

clean: ## Clean build artifacts and dependencies
	@echo "$(BLUE)Cleaning build artifacts...$(NC)"
	rm -rf node_modules
	rm -rf dist
	rm -rf cdk.out
	rm -rf coverage
	rm -rf .nyc_output

check-env: ## Verify environment variables and AWS credentials
	@echo "$(BLUE)Checking environment configuration...$(NC)"
	@echo ""
	@echo "Environment Variables:"
	@echo "  ENVIRONMENT  = $(ENVIRONMENT)"
	@echo "  AWS_PROFILE  = $(AWS_PROFILE)"
	@echo "  AWS_REGION   = $(AWS_REGION)"
	@echo ""
	@echo "Checking AWS credentials for profile '$(AWS_PROFILE)'..."
	@aws sts get-caller-identity --profile $(AWS_PROFILE) > /dev/null 2>&1 && \
		echo "$(GREEN)✓ AWS credentials valid$(NC)" || \
		(echo "$(RED)✗ AWS credentials invalid or not configured$(NC)" && exit 1)
	@echo ""
	@echo "AWS Account Details:"
	@aws sts get-caller-identity --profile $(AWS_PROFILE) --query '{Account:Account,UserId:UserId,Arn:Arn}' --output table

get-alb-dns: ## Get Application Load Balancer DNS name
	@echo "$(BLUE)Retrieving ALB DNS name...$(NC)"
	@aws cloudformation describe-stacks \
		--stack-name $(INFRA_STACK) \
		--profile $(AWS_PROFILE) \
		--region $(AWS_REGION) \
		--query 'Stacks[0].Outputs[?OutputKey==`LoadBalancerDns`].OutputValue' \
		--output text 2>/dev/null || echo "$(RED)Stack not found or no ALB DNS output$(NC)"

get-cluster-name: ## Get ECS cluster name
	@echo "$(BLUE)Retrieving ECS cluster name...$(NC)"
	@aws ssm get-parameter \
		--name "/monitoring/$(ENVIRONMENT)/infra/config/cluster-name" \
		--profile $(AWS_PROFILE) \
		--region $(AWS_REGION) \
		--query 'Parameter.Value' \
		--output text 2>/dev/null || echo "$(RED)Parameter not found$(NC)"

get-efs-id: ## Get EFS file system ID
	@echo "$(BLUE)Retrieving EFS file system ID...$(NC)"
	@aws ssm get-parameter \
		--name "/monitoring/$(ENVIRONMENT)/efs/config/file-system-id" \
		--profile $(AWS_PROFILE) \
		--region $(AWS_REGION) \
		--query 'Parameter.Value' \
		--output text 2>/dev/null || echo "$(RED)Parameter not found$(NC)"

logs-ecs-agent: ## Tail ECS agent logs from CloudWatch
	@echo "$(BLUE)Tailing ECS agent logs...$(NC)"
	@aws logs tail "/ecs/$(ENVIRONMENT)-ecs-agent" \
		--profile $(AWS_PROFILE) \
		--region $(AWS_REGION) \
		--follow

logs-containers: ## Tail container logs from CloudWatch
	@echo "$(BLUE)Tailing container logs...$(NC)"
	@aws logs tail "/ecs/$(ENVIRONMENT)-containers" \
		--profile $(AWS_PROFILE) \
		--region $(AWS_REGION) \
		--follow

# ============================================================================
# DEVELOPMENT WORKFLOW TARGETS
# ============================================================================

dev-setup: install build ## Complete development setup
	@echo ""
	@echo "$(GREEN)✓ Development environment setup complete$(NC)"
	@echo ""
	@echo "$(YELLOW)Next steps:$(NC)"
	@echo "  1. Configure AWS credentials: aws configure --profile $(AWS_PROFILE)"
	@echo "  2. Verify configuration: make check-env"
	@echo "  3. Deploy infrastructure: make deploy-all"

bootstrap: ## Bootstrap CDK in AWS account
	@echo "$(BLUE)Bootstrapping CDK...$(NC)"
	@echo "Profile: $(AWS_PROFILE)"
	@echo "Region: $(AWS_REGION)"
	@echo ""
	cdk bootstrap aws://unknown-account/$(AWS_REGION) --profile $(AWS_PROFILE)

update: ## Update dependencies to latest versions
	@echo "$(BLUE)Updating dependencies...$(NC)"
	yarn upgrade-interactive --latest

# ============================================================================
# QUICK START TARGETS
# ============================================================================

quick-deploy: check-env deploy-all verify-all ## Quick deploy all stacks and verify
	@echo ""
	@echo "$(GREEN)✓ Quick deployment complete$(NC)"

quick-verify: verify-all get-alb-dns ## Quick verification of all stacks
	@echo ""
	@echo "$(GREEN)✓ Verification complete$(NC)"

# ============================================================================
# PROJECT STRUCTURE VISUALIZATION
# ============================================================================

tree: ## Show directory folder/files structure
	@echo "$(BLUE)Checking directory folder/files structure...$(NC)"
	@tree -I 'node_modules|cdk.out|dist|build|coverage|.git|.aws-sam' -L 4 --dirsfirst

tree-source: ## Show TypeScript source code structure only
	@echo "$(BLUE)Checking source code structure...$(NC)"
	@tree -I 'node_modules|cdk.out|dist|build|coverage|.git' -P '*.ts|*.tsx' --prune

tree-github: ## Show GitHub Actions structure
	@echo "$(BLUE)Checking GitHub Actions structure... $(NC)"
	@find .github -type f -name "*.yml" -o -name "*.yaml"

tree-dirs: ## Show folder organisation without files
	@echo "$(BLUE)Checking folder organisation (directories only)...$(NC)"
	@tree -I 'node_modules|cdk.out|dist|build|coverage|.git' -d -L 3

tree-save: ## Save project structure to file for analysis
	@echo "$(BLUE)Saving project structure to project-structure.txt...$(NC)"
	@tree -I 'node_modules|cdk.out|dist|build|coverage|.git|.aws-sam' \
		-L 4 \
		--dirsfirst \
		> project-structure.txt
	@echo "$(GREEN)✓ Project structure saved to project-structure.txt$(NC)"

tree-lib: ## Show lib/ and tests/ structure for CI planning
	@echo "$(BLUE)Checking lib/ and tests/ structure...$(NC)"
	@echo "=== CDK Lib Structure ===" && \
	find lib -type d -maxdepth 3 2>/dev/null && \
	echo "" && \
	echo "=== Test Structure ===" && \
	find tests -type d -maxdepth 3 2>/dev/null