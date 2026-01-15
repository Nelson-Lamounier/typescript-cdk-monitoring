# Monitoring Infrastructure Makefile
# 
# This Makefile provides convenient targets for common operations including:
# - Stack verification
# - CDK deployments
# - Testing
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

# ============================================================================
# HELP
# ============================================================================

help: ## Show this help message
	@echo ""
	@echo "$(BLUE)Monitoring Infrastructure - Available Targets$(NC)"
	@echo ""
	@echo "$(GREEN)Verification:$(NC)"
	@grep -E '^verify-.*:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  $(BLUE)%-20s$(NC) %s\n", $$1, $$2}'
	@echo ""
	@echo "$(GREEN)Deployment:$(NC)"
	@grep -E '^deploy-.*:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  $(BLUE)%-20s$(NC) %s\n", $$1, $$2}'
	@echo ""
	@echo "$(GREEN)CDK Operations:$(NC)"
	@grep -E '^(synth|diff|destroy|list):.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  $(BLUE)%-20s$(NC) %s\n", $$1, $$2}'
	@echo ""
	@echo "$(GREEN)Testing & Quality:$(NC)"
	@grep -E '^(test|lint|build):.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  $(BLUE)%-20s$(NC) %s\n", $$1, $$2}'
	@echo ""
	@echo "$(GREEN)Utilities:$(NC)"
	@grep -E '^(clean|install|check-env):.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  $(BLUE)%-20s$(NC) %s\n", $$1, $$2}'
	@echo ""
	@echo "$(YELLOW)Configuration:$(NC)"
	@echo "  ENVIRONMENT  = $(ENVIRONMENT)"
	@echo "  AWS_PROFILE  = $(AWS_PROFILE)"
	@echo "  AWS_REGION   = $(AWS_REGION)"
	@echo ""
	@echo "$(YELLOW)Examples:$(NC)"
	@echo "  make verify-efs                    # Verify EFS stack with defaults"
	@echo "  make verify-infra                  # Verify Infrastructure stack"
	@echo "  make deploy-all                    # Deploy all stacks in order"
	@echo "  make ENVIRONMENT=production deploy-efs  # Deploy to production"
	@echo ""

# ============================================================================
# VERIFICATION TARGETS
# ============================================================================

verify-networking: ## Verify Networking stack deployment and readiness
	@echo "$(BLUE)Verifying Networking Stack...$(NC)"
	@echo "Environment: $(ENVIRONMENT)"
	@echo "AWS Region: $(AWS_REGION)"
	@if [ -n "$(AWS_PROFILE)" ]; then \
		echo "AWS Profile: $(AWS_PROFILE)"; \
	else \
		echo "AWS Profile: (using default credentials)"; \
	fi
	@echo ""
	@if [ -n "$(AWS_PROFILE)" ]; then \
		npx tsx scripts/deployment/monitoring/verify-networking-stack.ts -e $(ENVIRONMENT) -r $(AWS_REGION) -p $(AWS_PROFILE); \
	else \
		npx tsx scripts/deployment/monitoring/verify-networking-stack.ts -e $(ENVIRONMENT) -r $(AWS_REGION); \
	fi

verify-efs: ## Verify EFS stack deployment and readiness
	@echo "$(BLUE)Verifying EFS Stack...$(NC)"
	@echo "Environment: $(ENVIRONMENT)"
	@echo "AWS Profile: $(AWS_PROFILE)"
	@echo ""
	@npx tsx scripts/deployment/monitoring/verify-efs-stack.ts -e $(ENVIRONMENT) -p $(AWS_PROFILE) -r $(AWS_REGION)

verify-infra: ## Verify Infrastructure stack deployment and readiness
	@echo "$(BLUE)Verifying Infrastructure Stack...$(NC)"
	@echo "Environment: $(ENVIRONMENT)"
	@echo "AWS Region: $(AWS_REGION)"
	@if [ -n "$(AWS_PROFILE)" ]; then \
		echo "AWS Profile: $(AWS_PROFILE)"; \
		npx tsx scripts/deployment/monitoring/verify-infra-stack.ts -e $(ENVIRONMENT) -r $(AWS_REGION) -p $(AWS_PROFILE); \
	else \
		echo "AWS Profile: (using default credentials)"; \
		npx tsx scripts/deployment/monitoring/verify-infra-stack.ts -e $(ENVIRONMENT) -r $(AWS_REGION); \
	fi

verify-service: ## Verify Service stack deployment and readiness
	@echo "$(BLUE)Verifying Service Stack...$(NC)"
	@echo "Environment: $(ENVIRONMENT)"
	@echo "AWS Region: $(AWS_REGION)"
	@if [ -n "$(AWS_PROFILE)" ]; then \
		echo "AWS Profile: $(AWS_PROFILE)"; \
		npx tsx scripts/deployment/monitoring/verify-infra-stack.ts -e $(ENVIRONMENT) -r $(AWS_REGION) -p $(AWS_PROFILE) --service-only || true; \
	else \
		echo "AWS Profile: (using default credentials)"; \
		npx tsx scripts/deployment/monitoring/verify-infra-stack.ts -e $(ENVIRONMENT) -r $(AWS_REGION) --service-only || true; \
	fi

verify-all: verify-networking verify-efs verify-infra verify-service ## Verify all stacks in order
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
	@npx tsx scripts/deployment/verify-bootstrap.ts \
		--aws-account-id $(AWS_ACCOUNT_ID) \
		--aws-region $(AWS_REGION) \
		--environment $(ENVIRONMENT) \
		--project-name $(PROJECT_NAME)

verify-environment: ## Verify CDK deployment environment setup
	@echo "$(BLUE)Verifying CDK Deployment Environment...$(NC)"
	@echo "Environment: $(ENVIRONMENT)"
	@echo "AWS Region: $(AWS_REGION)"
	@echo ""
	@npx tsx scripts/deployment/verify-environment.ts \
		--environment $(ENVIRONMENT) \
		--aws-region $(AWS_REGION) \
		--auto-build-on-failure

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
# TESTING & QUALITY
# ============================================================================

test: ## Run all tests
	@echo "$(BLUE)Running tests...$(NC)"
	CDK_DOCKER_VERBOSE=false CDK_DEBUG=false CDK_ASSET_VERBOSE=false DOCKER_BUILDKIT=1 BUILDKIT_PROGRESS=quiet yarn test

test-watch: ## Run tests in watch mode
	@echo "$(BLUE)Running tests in watch mode...$(NC)"
	CDK_DOCKER_VERBOSE=false CDK_DEBUG=false CDK_ASSET_VERBOSE=false DOCKER_BUILDKIT=1 BUILDKIT_PROGRESS=quiet yarn test:watch

test-coverage: ## Run tests with coverage report
	@echo "$(BLUE)Running tests with coverage...$(NC)"
	CDK_DOCKER_VERBOSE=false CDK_DEBUG=false CDK_ASSET_VERBOSE=false DOCKER_BUILDKIT=1 BUILDKIT_PROGRESS=quiet yarn test --coverage
	@echo ""
	@echo "$(GREEN)Coverage report generated!$(NC)"
	@echo "$(YELLOW)To view HTML report:$(NC)"
	@echo "  - macOS: open coverage/lcov-report/index.html"
	@echo "  - Linux: xdg-open coverage/lcov-report/index.html"
	@echo "  - Windows: start coverage/lcov-report/index.html"
	@echo "  - Or run: make view-coverage"

test-update-snapshots: ## Update Jest snapshots
	@echo "$(BLUE)Updating Jest snapshots...$(NC)"
	CDK_DOCKER_VERBOSE=false CDK_DEBUG=false CDK_ASSET_VERBOSE=false DOCKER_BUILDKIT=1 BUILDKIT_PROGRESS=quiet yarn test:update-snapshots

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
	yarn test tests/unit

test-integration: ## Run integration tests
	@echo "$(BLUE)Running integration tests...$(NC)"
	yarn test:integration

test-integration-coverage: ## Run integration tests with coverage
	@echo "$(BLUE)Running integration tests with coverage...$(NC)"
	yarn test:integration:coverage

test-integration-local: ## Run local integration tests (synthesise stacks)
	@echo "$(BLUE)Running local integration tests...$(NC)"
	yarn test:integration:local

test-integration-local-save: ## Run local integration tests and save templates
	@echo "$(BLUE)Running local integration tests and saving templates...$(NC)"
	yarn test:integration:local:save

test-integration-local-debug: ## Run local integration tests with detailed output
	@echo "$(BLUE)Running local integration tests with debug output...$(NC)"
	yarn test:integration:local:debug

test-security: ## Run all security posture tests
	@echo "$(BLUE)Running security posture tests...$(NC)"
	yarn test:security

test-security-network: ## Run network security tests
	@echo "$(BLUE)Running network security tests...$(NC)"
	yarn test:security:network

test-security-instance: ## Run instance security tests
	@echo "$(BLUE)Running instance security tests...$(NC)"
	yarn test:security:instance

test-security-storage: ## Run storage security tests
	@echo "$(BLUE)Running storage security tests...$(NC)"
	yarn test:security:storage

test-security-iam: ## Run IAM security tests
	@echo "$(BLUE)Running IAM security tests...$(NC)"
	yarn test:security:iam

test-security-monitoring: ## Run monitoring & logging security tests
	@echo "$(BLUE)Running monitoring & logging security tests...$(NC)"
	yarn test:security:monitoring

test-security-application: ## Run application security tests
	@echo "$(BLUE)Running application security tests...$(NC)"
	yarn test:security:application

test-security-compliance: ## Run compliance & governance tests
	@echo "$(BLUE)Running compliance & governance tests...$(NC)"
	yarn test:security:compliance

test-security-posture: ## Run legacy security posture test file
	@echo "$(BLUE)Running legacy security posture tests...$(NC)"
	yarn test:security-posture

test-connectivity: ## Run connectivity integration tests
	@echo "$(BLUE)Running connectivity tests...$(NC)"
	yarn test:connectivity

test-connectivity-coverage: ## Run connectivity integration tests with coverage
	@echo "$(BLUE)Running connectivity tests with coverage...$(NC)"
	yarn test:connectivity:coverage

test-network-connectivity: ## Run network connectivity tests
	@echo "$(BLUE)Running network connectivity tests...$(NC)"
	yarn test:network-connectivity

test-service-connectivity: ## Run service connectivity tests
	@echo "$(BLUE)Running service connectivity tests...$(NC)"
	yarn test:service-connectivity

test-cross-stack-connectivity: ## Run cross-stack connectivity tests
	@echo "$(BLUE)Running cross-stack connectivity tests...$(NC)"
	yarn test:cross-stack-connectivity

test-networking: ## Run networking stack tests
	@echo "$(BLUE)Running networking stack tests...$(NC)"
	yarn test tests/unit/stacks/foundation/networking-stack.test.ts

test-monitoring-efs: ## Run monitoring EFS stack tests
	@echo "$(BLUE)Running monitoring EFS stack tests...$(NC)"
	yarn test tests/unit/stacks/monitoring/monitoring-efs-stack.test.ts

test-monitoring-infra: ## Run monitoring infrastructure stack tests
	@echo "$(BLUE)Running monitoring infrastructure stack tests...$(NC)"
	yarn test tests/unit/stacks/monitoring/monitoring-infra-stack.test.ts

test-monitoring-service: ## Run monitoring service stack tests
	@echo "$(BLUE)Running monitoring service stack tests...$(NC)"
	yarn test tests/unit/stacks/monitoring/monitoring-service-stack.test.ts

test-stacks: test-networking test-monitoring-efs test-monitoring-infra test-monitoring-service ## Run all stack tests
	@echo "$(BLUE)All stack tests completed$(NC)"

lint: ## Run linter (ESLint with max-warnings 0)
	@echo "$(BLUE)Running linter...$(NC)"
	npx eslint lib/ bin/ tests/ --max-warnings 0

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