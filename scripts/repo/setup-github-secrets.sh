#!/bin/bash
# =============================================================================
# GitHub Secrets & Variables Setup Script - Monitoring Stack
# =============================================================================
# Migrated from: portfolio monorepo
# Target repo:   monitoring-stack
#
# Your AWS Accounts:
#   - Dev:      771826808455
#   - Staging:  692738841103
#   - Prod:     607700977986
#   - Pipeline: 559780231478
#
# Usage:
#   ./scripts/setup-github-secrets.sh setup     # Interactive setup
#   ./scripts/setup-github-secrets.sh list      # Show current config
#   ./scripts/setup-github-secrets.sh migrate   # Copy from old repo
# =============================================================================

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# -----------------------------------------------------------------------------
# Configuration - UPDATE THESE
# -----------------------------------------------------------------------------
REPO_OWNER="Nelson-Lamounier"  # TODO: Update this
REPO_NAME="typescript-cdk-monitoring"
REPO="${REPO_OWNER}/${REPO_NAME}"

# Old repository (for migration)
OLD_REPO="${REPO_OWNER}/your-old-monorepo"  # TODO: Update this

# Known account IDs (from your variables - these are not secrets)
AWS_ACCOUNT_ID_DEV="771826808455"
AWS_ACCOUNT_ID_STAGING="692738841103"
AWS_ACCOUNT_ID_PROD="607700977986"
AWS_PIPELINE_ACCOUNT_ID="559780231478"

# -----------------------------------------------------------------------------
# Helper Functions
# -----------------------------------------------------------------------------
log_info()    { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
log_error()   { echo -e "${RED}[ERROR]${NC} $1"; }

check_gh_auth() {
    if ! gh auth status &>/dev/null; then
        log_error "GitHub CLI not authenticated. Run: gh auth login"
        exit 1
    fi
    log_success "GitHub CLI authenticated"
}

check_repo_exists() {
    if ! gh repo view "$REPO" &>/dev/null; then
        log_error "Repository $REPO not found. Create it first."
        exit 1
    fi
    log_success "Repository $REPO found"
}

prompt_secret() {
    local secret_name=$1
    local description=$2
    local env_name=${3:-}  # Optional environment
    local silent=${4:-true}  # Default to silent (true), set to false for visible input
    local value=""
    
    # Check if we can read from terminal
    if [[ ! -t 0 ]] && [[ ! -r /dev/tty ]]; then
        log_error "Not running in an interactive terminal. Cannot prompt for secrets."
        log_info "Tip: Run this script from a terminal, not from a pipe or non-interactive session."
        return 1
    fi
    
    # Always use /dev/tty for both input and output if available (handles case where stdout is not a TTY)
    if [[ -r /dev/tty ]] && [[ -w /dev/tty ]]; then
        # Use /dev/tty for direct terminal access (most reliable)
        echo "" > /dev/tty
        echo -e "${YELLOW}${description}${NC}" > /dev/tty
        if [[ "$silent" == "true" ]]; then
            printf "Enter value for %s (hidden): " "$secret_name" > /dev/tty
            read -rs value < /dev/tty
            echo "" > /dev/tty
        else
            printf "Enter value for %s: " "$secret_name" > /dev/tty
            read -r value < /dev/tty
        fi
    elif [[ -t 0 ]]; then
        # Fallback: use stdout for prompts, stdin for input
        echo ""
        echo -e "${YELLOW}${description}${NC}"
        if [[ "$silent" == "true" ]]; then
            printf "Enter value for %s (hidden): " "$secret_name"
            read -rs value
            echo ""
        else
            printf "Enter value for %s: " "$secret_name"
            read -r value
        fi
    else
        log_error "Cannot read input: no interactive terminal available"
        log_info "Debug: stdin isatty=$([[ -t 0 ]] && echo 'yes' || echo 'no')"
        log_info "Debug: stdout isatty=$([[ -t 1 ]] && echo 'yes' || echo 'no')"
        log_info "Debug: /dev/tty readable=$([[ -r /dev/tty ]] && echo 'yes' || echo 'no')"
        log_info "Debug: /dev/tty writable=$([[ -w /dev/tty ]] && echo 'yes' || echo 'no')"
        return 1
    fi
    
    if [[ -n "$value" ]]; then
        if [[ -n "$env_name" ]]; then
            echo "$value" | gh secret set "$secret_name" --repo "$REPO" --env "$env_name"
            log_success "Set secret: $secret_name (env: $env_name)"
        else
            echo "$value" | gh secret set "$secret_name" --repo "$REPO"
            log_success "Set secret: $secret_name (repository level)"
        fi
    else
        log_warning "Skipped: $secret_name (empty value)"
    fi
}

set_variable() {
    local var_name=$1
    local var_value=$2
    local env_name=${3:-}  # Optional environment
    
    if [[ -n "$env_name" ]]; then
        gh variable set "$var_name" --body "$var_value" --repo "$REPO" --env "$env_name"
        log_success "Set variable: $var_name = $var_value (env: $env_name)"
    else
        gh variable set "$var_name" --body "$var_value" --repo "$REPO"
        log_success "Set variable: $var_name = $var_value (repository level)"
    fi
}

create_environment() {
    local env_name=$1
    log_info "Creating environment: $env_name"
    gh api --method PUT "repos/${REPO}/environments/${env_name}" \
        --field wait_timer=0 2>/dev/null || \
        log_warning "Environment $env_name may already exist or requires admin access"
}

# -----------------------------------------------------------------------------
# Main Setup
# -----------------------------------------------------------------------------
setup() {
    echo "=============================================="
    echo "  GitHub Secrets & Variables Setup"
    echo "  Repository: $REPO"
    echo "=============================================="
    echo ""

    check_gh_auth
    check_repo_exists

    # -------------------------------------------------------------------------
    # Step 1: Create GitHub Environments
    # -------------------------------------------------------------------------
    echo ""
    echo "=============================================="
    echo "  STEP 1: Create GitHub Environments"
    echo "=============================================="
    
    create_environment "development"
    create_environment "pipeline"
    create_environment "production"

    # -------------------------------------------------------------------------
    # Step 2: Repository-Level Variables (visible, non-sensitive)
    # -------------------------------------------------------------------------
    echo ""
    echo "=============================================="
    echo "  STEP 2: Repository Variables"
    echo "=============================================="
    
    set_variable "ALERT_EMAIL" "lamounierleao@gmail.com"
    set_variable "AWS_REGION" "eu-west-1"
    set_variable "PROJECT_NAME" "monitoring-stack"

    # -------------------------------------------------------------------------
    # Step 3: Pipeline Environment Variables (Account IDs)
    # -------------------------------------------------------------------------
    echo ""
    echo "=============================================="
    echo "  STEP 3: Pipeline Environment Variables"
    echo "=============================================="
    
    set_variable "AWS_ACCOUNT_ID_DEV" "$AWS_ACCOUNT_ID_DEV" "pipeline"
    set_variable "AWS_ACCOUNT_ID_STAGING" "$AWS_ACCOUNT_ID_STAGING" "pipeline"
    set_variable "AWS_ACCOUNT_ID_PROD" "$AWS_ACCOUNT_ID_PROD" "pipeline"
    set_variable "AWS_PIPELINE_ACCOUNT_ID" "$AWS_PIPELINE_ACCOUNT_ID" "pipeline"

    # -------------------------------------------------------------------------
    # Step 4: Development Environment Variables
    # -------------------------------------------------------------------------
    echo ""
    echo "=============================================="
    echo "  STEP 4: Development Environment Variables"
    echo "=============================================="
    
    set_variable "ALERT_EMAIL" "lamounierleao@gmail.com" "development"

    # -------------------------------------------------------------------------
    # Step 5: Repository-Level Secrets
    # -------------------------------------------------------------------------
    echo ""
    echo "=============================================="
    echo "  STEP 5: Repository Secrets"
    echo "=============================================="
    echo ""
    log_info "These secrets need to be entered manually"
    log_info "You can find the values in AWS or your password manager"
    
    prompt_secret "AWS_ACCOUNT_ID_DEV" \
        "Dev Account ID (or press Enter to use: $AWS_ACCOUNT_ID_DEV)" \
        "" \
        "false"  # Not sensitive, show input
    
    prompt_secret "AWS_REGION" \
        "AWS Region (e.g., eu-west-1)" \
        "" \
        "false"  # Not sensitive, show input
    
    prompt_secret "AWS_OIDC_ROLE" \
        "OIDC Role ARN for GitHub Actions (arn:aws:iam::ACCOUNT:role/NAME)"

    # -------------------------------------------------------------------------
    # Step 6: Environment-Level Secrets (OIDC Roles)
    # -------------------------------------------------------------------------
    echo ""
    echo "=============================================="
    echo "  STEP 6: Environment Secrets (OIDC Roles)"
    echo "=============================================="
    echo ""
    log_info "Each environment needs its own OIDC role"
    
    prompt_secret "AWS_OIDC_ROLE" \
        "OIDC Role for DEVELOPMENT environment" \
        "development"
    
    prompt_secret "AWS_OIDC_ROLE" \
        "OIDC Role for PIPELINE environment" \
        "pipeline"
    
    prompt_secret "AWS_OIDC_ROLE" \
        "OIDC Role for PRODUCTION environment" \
        "production"
    
    prompt_secret "DEPLOYMENT_ROLE" \
        "Deployment Role for DEVELOPMENT environment" \
        "development"
    
    prompt_secret "DEPLOYMENT_ROLE" \
        "Deployment Role for PIPELINE environment" \
        "pipeline"

    # -------------------------------------------------------------------------
    # Step 7: Pipeline Environment Secrets (Account IDs as secrets too)
    # -------------------------------------------------------------------------
    echo ""
    echo "=============================================="
    echo "  STEP 7: Pipeline Environment Secrets"
    echo "=============================================="
    
    # These are duplicated as secrets in pipeline env in your old setup
    echo "$AWS_ACCOUNT_ID_DEV" | gh secret set "AWS_ACCOUNT_ID_DEV" --repo "$REPO" --env "pipeline"
    log_success "Set secret: AWS_ACCOUNT_ID_DEV (env: pipeline)"
    
    echo "$AWS_ACCOUNT_ID_PROD" | gh secret set "AWS_ACCOUNT_ID_PROD" --repo "$REPO" --env "pipeline"
    log_success "Set secret: AWS_ACCOUNT_ID_PROD (env: pipeline)"
    
    echo "$AWS_ACCOUNT_ID_STAGING" | gh secret set "AWS_ACCOUNT_ID_STAGING" --repo "$REPO" --env "pipeline"
    log_success "Set secret: AWS_ACCOUNT_ID_STAGING (env: pipeline)"
    
    echo "$AWS_PIPELINE_ACCOUNT_ID" | gh secret set "AWS_PIPELINE_ACCOUNT_ID" --repo "$REPO" --env "pipeline"
    log_success "Set secret: AWS_PIPELINE_ACCOUNT_ID (env: pipeline)"

    # -------------------------------------------------------------------------
    # Step 8: Optional - Domain/Certificate (if using custom domain)
    # -------------------------------------------------------------------------
    echo ""
    echo "=============================================="
    echo "  STEP 8: Optional - Domain Configuration"
    echo "=============================================="
    echo ""
    log_info "Skip these if not using a custom domain for Grafana"
    
    prompt_secret "ROOT_DOMAIN_NAME" \
        "Root domain (e.g., yourdomain.com) - press Enter to skip"
    
    prompt_secret "HOSTED_ZONE_ID" \
        "Route53 Hosted Zone ID - press Enter to skip"
    
    prompt_secret "CERTIFICATE_ARN" \
        "ACM Certificate ARN - press Enter to skip"

    # -------------------------------------------------------------------------
    # Summary
    # -------------------------------------------------------------------------
    echo ""
    echo "=============================================="
    echo "  Setup Complete!"
    echo "=============================================="
    
    list_config
}

# -----------------------------------------------------------------------------
# List Current Configuration
# -----------------------------------------------------------------------------
list_config() {
    echo ""
    echo "Repository Variables:"
    echo "---------------------"
    gh variable list --repo "$REPO" 2>/dev/null || echo "  (none)"
    
    echo ""
    echo "Repository Secrets:"
    echo "-------------------"
    gh secret list --repo "$REPO" 2>/dev/null || echo "  (none)"
    
    for env in "development" "pipeline" "production"; do
        echo ""
        echo "Environment: $env"
        echo "  Variables:"
        gh variable list --repo "$REPO" --env "$env" 2>/dev/null | sed 's/^/    /' || echo "    (none)"
        echo "  Secrets:"
        gh secret list --repo "$REPO" --env "$env" 2>/dev/null | sed 's/^/    /' || echo "    (none)"
    done
}

# -----------------------------------------------------------------------------
# Migrate from Old Repository (variables only - secrets must be re-entered)
# -----------------------------------------------------------------------------
migrate() {
    echo "=============================================="
    echo "  Migrate Variables from Old Repository"
    echo "  From: $OLD_REPO"
    echo "  To:   $REPO"
    echo "=============================================="
    echo ""
    
    check_gh_auth
    
    log_warning "Only VARIABLES can be migrated. SECRETS must be re-entered manually."
    echo ""
    
    # List what's in the old repo
    echo "Variables in old repository:"
    gh variable list --repo "$OLD_REPO" 2>/dev/null || log_error "Could not access $OLD_REPO"
    
    echo ""
    # Check if we can read from terminal
    if [[ ! -t 0 ]] && [[ ! -r /dev/tty ]]; then
        log_error "Not running in an interactive terminal. Cannot prompt for confirmation."
        return 1
    fi
    
    # Use /dev/tty if available (handles case where stdout is not a TTY)
    if [[ -r /dev/tty ]] && [[ -w /dev/tty ]]; then
        printf "Proceed with migration? (yes/no): " > /dev/tty
        read confirm < /dev/tty
    elif [[ -t 0 ]]; then
        printf "Proceed with migration? (yes/no): "
        read confirm
    else
        log_error "Cannot read input: no interactive terminal available"
        return 1
    fi
    
    if [[ "$confirm" == "yes" ]]; then
        # Migrate repository variables
        log_info "Migrating repository variables..."
        
        for var_name in $(gh variable list --repo "$OLD_REPO" --json name -q '.[].name' 2>/dev/null); do
            value=$(gh variable get "$var_name" --repo "$OLD_REPO" 2>/dev/null) || continue
            gh variable set "$var_name" --body "$value" --repo "$REPO"
            log_success "Migrated: $var_name"
        done
        
        log_success "Migration complete!"
        echo ""
        log_warning "Remember to manually set all SECRETS using: $0 setup"
    else
        log_info "Migration cancelled"
    fi
}

# -----------------------------------------------------------------------------
# Quick Setup (non-interactive, uses known values)
# -----------------------------------------------------------------------------
quick_setup() {
    echo "=============================================="
    echo "  Quick Setup (Non-Interactive)"
    echo "=============================================="
    
    check_gh_auth
    check_repo_exists
    
    # Create environments
    for env in "development" "pipeline" "production"; do
        create_environment "$env"
    done
    
    # Repository variables
    set_variable "ALERT_EMAIL" "lamounierleao@gmail.com"
    set_variable "AWS_REGION" "eu-west-1"
    set_variable "PROJECT_NAME" "monitoring-stack"
    
    # Pipeline environment variables
    set_variable "AWS_ACCOUNT_ID_DEV" "$AWS_ACCOUNT_ID_DEV" "pipeline"
    set_variable "AWS_ACCOUNT_ID_STAGING" "$AWS_ACCOUNT_ID_STAGING" "pipeline"
    set_variable "AWS_ACCOUNT_ID_PROD" "$AWS_ACCOUNT_ID_PROD" "pipeline"
    set_variable "AWS_PIPELINE_ACCOUNT_ID" "$AWS_PIPELINE_ACCOUNT_ID" "pipeline"
    
    # Development environment variables
    set_variable "ALERT_EMAIL" "lamounierleao@gmail.com" "development"
    
    # Pipeline environment secrets (account IDs)
    echo "$AWS_ACCOUNT_ID_DEV" | gh secret set "AWS_ACCOUNT_ID_DEV" --repo "$REPO" --env "pipeline"
    echo "$AWS_ACCOUNT_ID_PROD" | gh secret set "AWS_ACCOUNT_ID_PROD" --repo "$REPO" --env "pipeline"
    echo "$AWS_ACCOUNT_ID_STAGING" | gh secret set "AWS_ACCOUNT_ID_STAGING" --repo "$REPO" --env "pipeline"
    echo "$AWS_PIPELINE_ACCOUNT_ID" | gh secret set "AWS_PIPELINE_ACCOUNT_ID" --repo "$REPO" --env "pipeline"
    
    log_success "Quick setup complete!"
    echo ""
    log_warning "You still need to manually set OIDC roles and deployment roles:"
    echo "  - AWS_OIDC_ROLE (repo + each environment)"
    echo "  - DEPLOYMENT_ROLE (development, pipeline)"
    echo ""
    echo "Run: $0 setup   # to set remaining secrets interactively"
}

# -----------------------------------------------------------------------------
# Test Input Function (for debugging)
# -----------------------------------------------------------------------------
test_input() {
    echo "=============================================="
    echo "  Testing Input Functionality"
    echo "=============================================="
    echo ""
    
    echo "Test 1: Reading visible input..."
    printf "Enter some text (visible): "
    read -r test_value
    echo "You entered: '$test_value'"
    echo ""
    
    echo "Test 2: Reading hidden input..."
    printf "Enter some text (hidden): "
    read -rs test_value
    echo ""
    echo "You entered: '${test_value:0:2}***' (hidden for security)"
    echo ""
    
    if [[ -r /dev/tty ]]; then
        echo "Test 3: Reading from /dev/tty (visible)..."
        printf "Enter some text: " > /dev/tty
        read -r test_value < /dev/tty
        echo "You entered: '$test_value'"
        echo ""
        
        echo "Test 4: Reading from /dev/tty (hidden)..."
        printf "Enter some text (hidden): " > /dev/tty
        read -rs test_value < /dev/tty
        echo "" > /dev/tty
        echo "You entered: '${test_value:0:2}***' (hidden for security)"
    else
        echo "Test 3 & 4: /dev/tty not available"
    fi
    
    echo ""
    echo "Terminal checks:"
    echo "  stdin isatty:  $([[ -t 0 ]] && echo 'YES' || echo 'NO')"
    echo "  stdout isatty:  $([[ -t 1 ]] && echo 'YES' || echo 'NO')"
    echo "  /dev/tty readable: $([[ -r /dev/tty ]] && echo 'YES' || echo 'NO')"
    echo ""
    echo "If all tests worked, input should be functional."
}

# -----------------------------------------------------------------------------
# Entry Point
# -----------------------------------------------------------------------------
case "${1:-help}" in
    setup)
        setup
        ;;
    quick)
        quick_setup
        ;;
    list)
        check_gh_auth
        list_config
        ;;
    migrate)
        migrate
        ;;
    test)
        test_input
        ;;
    help|*)
        echo "Usage: $0 {setup|quick|list|migrate|test}"
        echo ""
        echo "Commands:"
        echo "  setup   - Full interactive setup (prompts for all values)"
        echo "  quick   - Quick setup using known account IDs (still need OIDC roles)"
        echo "  list    - Show current secrets and variables"
        echo "  migrate - Copy variables from old repository"
        echo "  test    - Test input functionality (for debugging)"
        echo ""
        echo "Before running, update these in the script:"
        echo "  REPO_OWNER  - Your GitHub username"
        echo "  OLD_REPO    - Your old monorepo name (for migrate)"
        ;;
esac