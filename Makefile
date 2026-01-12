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

# Script paths
VERIFY_EFS_SCRIPT := scripts/tests/verify-efs-stack.sh
VERIFY_INFRA_SCRIPT := scripts/tests/verify-infra-stack.sh

# Stack names
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

verify-efs: ## Verify EFS stack deployment and readiness
	@echo "$(BLUE)Verifying EFS Stack...$(NC)"
	@echo "Environment: $(ENVIRONMENT)"
	@echo "AWS Profile: $(AWS_PROFILE)"
	@echo ""
	@chmod +x $(VERIFY_EFS_SCRIPT)
	@$(VERIFY_EFS_SCRIPT) -e $(ENVIRONMENT) -p $(AWS_PROFILE)

verify-infra: ## Verify Infrastructure stack deployment and readiness
	@echo "$(BLUE)Verifying Infrastructure Stack...$(NC)"
	@echo "Environment: $(ENVIRONMENT)"
	@echo "AWS Profile: $(AWS_PROFILE)"
	@echo ""
	@chmod +x $(VERIFY_INFRA_SCRIPT)
	@$(VERIFY_INFRA_SCRIPT) -e $(ENVIRONMENT) -p $(AWS_PROFILE)

verify-all: verify-efs verify-infra ## Verify all stacks (EFS, then Infrastructure)
	@echo ""
	@echo "$(GREEN)✓ All verification checks completed$(NC)"

# ============================================================================
# DEPLOYMENT TARGETS
# ============================================================================

deploy-efs: ## Deploy EFS stack (must be deployed first)
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

deploy-all: deploy-efs deploy-infra deploy-service ## Deploy all stacks in correct order
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
	yarn test

test-watch: ## Run tests in watch mode
	@echo "$(BLUE)Running tests in watch mode...$(NC)"
	yarn test:watch

test-coverage: ## Run tests with coverage report
	@echo "$(BLUE)Running tests with coverage...$(NC)"
	yarn test --coverage

test-unit: ## Run unit tests only
	@echo "$(BLUE)Running unit tests...$(NC)"
	yarn test tests/unit

lint: ## Run linter
	@echo "$(BLUE)Running linter...$(NC)"
	yarn lint

lint-fix: ## Run linter with auto-fix
	@echo "$(BLUE)Running linter with auto-fix...$(NC)"
	yarn lint:fix

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
# COMMANDS TO RUN IN THE TERMINAL
# ============================================================================

tree: check directory folder/files structure ## Quick deploy all stacks and verify
	@echo "$(BLUE)Checking directory folder/files structure...$(NC)"
	tree -I 'node_modules|cdk.out|dist|build|coverage|.git|.aws-sam' -L 4 --dirsfirst

# ============================================================================
# -I = Ignore patterns (node_modules, build artifacts, etc.)
# -L 4 = Limit depth to 4 levels (prevents overwhelming output)
# --dirsfirst = Show directories before files (easier to read)
# ============================================================================

tree-source-code: verify-all get-alb-dns ## Most comprehensive - shows everything important
	@echo "$(BLUE)Checking source code structure...$(NC)"
	tree -I 'node_modules|cdk.out|dist|build|coverage|.git' -P '*.ts|*.tsx' --prune

tree-source-code: verify-all get-alb-dns ## Focus on source code structure
	@echo "$(BLUE)Checking source code structure...$(NC)"
	tree -I 'node_modules|cdk.out|dist|build|coverage|.git' -P '*.ts|*.tsx' --prune

tree-org-no-files: verify-all get-alb-dns ## See folder organisation without files
	@echo "$(BLUE)Checking folder organisation without files...$(NC)"
	tree -I 'node_modules|cdk.out|dist|build|coverage|.git' -d -L 3
# ============================================================================
# -d = Directories only (no files)
# -L 3 = Limit to 3 levels deep
# ============================================================================

tree-org-no-files: verify-all get-alb-dns ## Save to file for further analysis 
	@echo "$(BLUE)Saving project structure to file...$(NC)"
	tree -I 'node_modules|cdk.out|dist|build|coverage|.git|.aws-sam' \
     -L 4 \
     --dirsfirst \
     > project-structure.txt