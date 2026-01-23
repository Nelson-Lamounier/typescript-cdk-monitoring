<!-- @format -->

# Local Development Guide

This guide covers how to develop and test CDK infrastructure locally before pushing to GitHub.

## Table of Contents

- [Key Concepts](#key-concepts)
- [Prerequisites](#prerequisites)
- [Local CDK Commands](#local-cdk-commands)
- [Workflow Testing](#workflow-testing)
- [Environment Setup](#environment-setup)
- [Quick Reference](#quick-reference)

---

## Key Concepts

### Why Push to GitHub?

GitHub Actions workflows run on GitHub's servers, not your local machine. When you trigger a workflow:

1. GitHub clones the repository from GitHub (not your local files)
2. Checks out the specified branch
3. Runs the workflow using code from GitHub

**Your local uncommitted changes are not included in workflow runs.**

### Development Approaches

| Scenario | Best Approach | Speed |
|----------|---------------|-------|
| Testing CDK stack changes | Local `cdk deploy` | ⚡⚡⚡ Fastest |
| Testing CDK syntax | Local `cdk synth` | ⚡⚡⚡ Fastest |
| Testing workflow changes | Push to test branch | ⚡⚡ Fast |
| Full pipeline validation | Merge to target branch | ⚡ Slower |

---

## Prerequisites

### Required Tools

```bash
# Node.js 22+
node --version  # v22.x.x

# Yarn (via Corepack)
corepack enable
yarn --version  # 4.x.x

# AWS CLI v2
aws --version  # aws-cli/2.x.x

# CDK CLI (via project dependencies)
npx cdk --version
```

### AWS Authentication

Configure AWS credentials using SSO or IAM:

```bash
# Option 1: AWS SSO (recommended)
aws configure sso
aws sso login --profile your-profile

# Option 2: Environment variables
export AWS_ACCESS_KEY_ID=xxx
export AWS_SECRET_ACCESS_KEY=xxx
export AWS_REGION=eu-west-1
```

---

## Local CDK Commands

### Stack Naming Convention

Stacks follow the pattern: `{environment}-{StackName}`

Examples:
- `development-Networking`
- `staging-MonitoringInfra`
- `production-MonitoringService`

### List Available Stacks

```bash
# List all stacks
npx cdk list

# List stacks for specific environment
ENVIRONMENT=development npx cdk list
```

### Synthesize (Validate)

```bash
# Synthesize all stacks
npx cdk synth --all

# Synthesize specific stack
npx cdk synth development-Networking

# With verbose output
npx cdk synth development-Networking --verbose
```

### Diff (Preview Changes)

```bash
# See what would change
npx cdk diff development-Networking

# Diff all stacks
npx cdk diff --all
```

### Deploy

```bash
# Deploy single stack
npx cdk deploy development-Networking

# Deploy without approval prompts
npx cdk deploy development-Networking --require-approval never

# Deploy with outputs file
npx cdk deploy development-Networking --outputs-file outputs.json

# Deploy all stacks (use with caution)
npx cdk deploy --all --require-approval never
```

### Destroy

```bash
# Destroy single stack
npx cdk destroy development-Networking

# Force destroy without prompts
npx cdk destroy development-Networking --force
```

---

## Workflow Testing

### Option 1: Test Branch (Recommended)

```bash
# 1. Create test branch
git checkout -b test/my-changes

# 2. Make changes and commit
git add .
git commit -m "test: my changes"

# 3. Push to remote
git push origin test/my-changes

# 4. Trigger workflow manually
gh workflow run deploy-monitoring-dev.yml --ref test/my-changes

# 5. Watch the workflow
gh run watch

# 6. Iterate if needed
git commit --amend --no-edit
git push --force origin test/my-changes
gh workflow run deploy-monitoring-dev.yml --ref test/my-changes

# 7. Clean up when done
git checkout develop
git branch -D test/my-changes
git push origin --delete test/my-changes
```

### Option 2: Using `act` (Local Workflow Testing)

[act](https://github.com/nektos/act) runs GitHub Actions locally using Docker:

```bash
# Install act
brew install act  # macOS

# Run workflow locally
act workflow_dispatch \
  --workflows .github/workflows/deploy-monitoring-dev.yml \
  --input skip_verification=true

# Run specific job
act -j setup --workflows .github/workflows/ci.yml
```

**Limitations**:
- Requires Docker
- OIDC authentication doesn't work locally
- Some GitHub features not fully supported

### Option 3: Draft Pull Request

```bash
# Create draft PR
gh pr create --draft --title "test: deployment updates"

# CI runs automatically on PRs
# Iterate on the branch

# Convert to ready when done
gh pr ready
```

---

## Environment Setup

### Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `ENVIRONMENT` | Target environment | `development` |
| `AWS_REGION` | AWS region | `eu-west-1` |
| `AWS_PROFILE` | AWS CLI profile | `dev-account` |

### Using Environment Variables

```bash
# Set environment for CDK
export ENVIRONMENT=development
export AWS_REGION=eu-west-1

# Or inline with command
ENVIRONMENT=development npx cdk deploy development-Networking
```

### Multiple Accounts

```bash
# Development account
export AWS_PROFILE=dev-account
npx cdk deploy development-Networking

# Staging account
export AWS_PROFILE=staging-account
npx cdk deploy staging-Networking

# Production account
export AWS_PROFILE=prod-account
npx cdk deploy production-Networking
```

---

## Quick Reference

### CDK Commands

| Command | Description |
|---------|-------------|
| `npx cdk list` | List all stacks |
| `npx cdk synth <stack>` | Generate CloudFormation template |
| `npx cdk diff <stack>` | Show pending changes |
| `npx cdk deploy <stack>` | Deploy stack |
| `npx cdk destroy <stack>` | Delete stack |
| `npx cdk doctor` | Check CDK setup |

### GitHub CLI Commands

| Command | Description |
|---------|-------------|
| `gh workflow list` | List workflows |
| `gh workflow run <name>` | Trigger workflow |
| `gh run list` | List recent runs |
| `gh run watch` | Watch current run |
| `gh run view <id>` | View run details |
| `gh run view <id> --log` | View run logs |
| `gh run cancel <id>` | Cancel running workflow |
| `gh run rerun <id>` | Rerun failed workflow |

### Makefile Targets

```bash
# Build
make build

# Lint
make lint
make lint-fix

# Tests
make test
make test-domain-monitoring
make test-domain-webapp

# Verification
make verify-networking ENVIRONMENT=development
make verify-efs ENVIRONMENT=development
make verify-service ENVIRONMENT=development

# CDK
make synth
make deploy STACK=development-Networking
make destroy STACK=development-Networking
```

### Pre-Push Checklist

```bash
# 1. Validate YAML syntax
yamllint .github/workflows/*.yml

# 2. Check TypeScript compilation
yarn build

# 3. Run linter
yarn lint

# 4. Run tests
yarn test

# 5. Synthesize CDK
npx cdk synth --all

# 6. Diff changes
npx cdk diff development-Networking
```

---

## CDK Bootstrap

### Check Bootstrap Status

```bash
aws cloudformation describe-stacks \
  --stack-name CDKToolkit \
  --query 'Stacks[0].Parameters[?ParameterKey==`BootstrapVersion`].ParameterValue' \
  --output text
```

### Bootstrap New Account

```bash
# Using SSO profile
aws sso login --profile your-profile

npx cdk bootstrap aws://ACCOUNT_ID/REGION \
  --profile your-profile
```

### Update Existing Bootstrap

```bash
# Re-run bootstrap to update (safe to run multiple times)
npx cdk bootstrap aws://ACCOUNT_ID/REGION \
  --profile your-profile
```

---

## Troubleshooting

### CDK Issues

**"Stack not found"**
```bash
# Verify stack name pattern: {environment}-{StackName}
npx cdk list | grep -i networking
```

**"No credentials"**
```bash
# Check AWS credentials
aws sts get-caller-identity
```

**"Bootstrap required"**
```bash
npx cdk bootstrap aws://ACCOUNT_ID/REGION
```

### Workflow Issues

**"Workflow not triggering"**
- Check branch name matches workflow trigger
- Verify path filters include changed files
- Check for `[skip ci]` in commit message

**"OIDC authentication failed"**
- Verify secret `AWS_OIDC_ROLE_*` is set correctly
- Check IAM role trust policy

---

## Related Documentation

- [GitHub Actions README](./README.md) - Workflow documentation
- [CDK Patterns Guide](../.cursor/rules/cdk-patterns.md) - CDK coding standards
- [Scripts Guide](../docs/SCRIPTS_GUIDE.md) - Verification and helper scripts
