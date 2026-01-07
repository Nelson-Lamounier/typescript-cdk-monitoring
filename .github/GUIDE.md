# Local Development Guide

## You Must Commit and Push to GitHub

Workflows run on GitHub's servers, not your local machine.

### Why You Need to Push

When you run:
```bash
gh workflow run deploy.yml -f environment=pipeline
```
Here's what happens:

1. GitHub Actions clones the repository from GitHub (not your local files)
2. Checks out the branch (default or specified)
3. Runs the workflow using code from GitHub's servers

Your local uncommitted changes are not included.

## Practical Alternatives

### Option 1: Quick Dev Branch Push (Recommended)

```bash
# Create development branch for testing
git checkout -b test/quick-deployment

# Make your changes
# ... edit files ...

# Quick commit and push
git add .
git commit -m "test: quick deployment test"
git push origin test/quick-deployment

# Run workflow on your test branch (deploys to development by default)
gh workflow run deploy.yml \
  --ref test/quick-deployment \
  -f environment=development \
  -f project=monitoring \
  -f stack=networking

# Watch the workflow
gh run watch

# If it works, merge to main
# If not, make more changes and force push
git commit --amend --no-edit
git push --force origin test/quick-deployment
```

**Benefits**:

- ✅ Fast iteration
- ✅ Don't pollute main branch
- ✅ Easy cleanup (`git branch -D test/quick-deployment`)
- ✅ Can test workflow changes

### Option 2: Run CDK Locally (Fastest for Testing)

Skip GitHub Actions entirely for quick tests:

```bash
# Test synthesis locally (with project context)
# Development is the first deployment target
PROJECT_NAME=monitoring ENVIRONMENT=development npx cdk synth

# Or using CDK context
npx cdk synth --context project=monitoring --context environment=development

# See what would change (project-specific stack name)
PROJECT_NAME=monitoring ENVIRONMENT=development npx cdk diff NetworkingStack-monitoring-development

# Or using CDK context
npx cdk diff NetworkingStack-monitoring-development \
  --context project=monitoring \
  --context environment=development

# Deploy directly (fastest!)
PROJECT_NAME=monitoring ENVIRONMENT=development npx cdk deploy NetworkingStack-monitoring-development \
  --require-approval never

# Or using CDK context
npx cdk deploy NetworkingStack-monitoring-development \
  --context project=monitoring \
  --context environment=development \
  --require-approval never

# Destroy when testing
PROJECT_NAME=monitoring ENVIRONMENT=development npx cdk destroy NetworkingStack-monitoring-development

# For different projects (e.g., webapp)
PROJECT_NAME=webapp ENVIRONMENT=development npx cdk deploy NetworkingStack-webapp-development

# Deploy to staging (second deployment target)
PROJECT_NAME=monitoring ENVIRONMENT=staging npx cdk deploy NetworkingStack-monitoring-staging

# Deploy to production (third deployment target, requires approval)
PROJECT_NAME=monitoring ENVIRONMENT=production npx cdk deploy NetworkingStack-monitoring-production
```

**When to use**:

- 🔥 Testing stack changes quickly
- 🔥 Debugging CDK errors
- 🔥 Validating configurations
- 🔥 Development iteration

**When NOT to use**:

- ❌ Testing GitHub Actions workflow changes
- ❌ Validating CI/CD pipeline
- ❌ Production deployments

### Option 3: Use act to Run Workflows Locally

`act` runs GitHub Actions on your local machine using Docker:

```bash
# Install act
brew install act  # macOS
# or
curl https://raw.githubusercontent.com/nektos/act/master/install.sh | sudo bash  # Linux

# Run workflow locally with your uncommitted changes
# Development is the first deployment target
act workflow_dispatch \
  --workflows .github/workflows/deploy.yml \
  --input environment=development \
  --input project=monitoring \
  --input stack=networking

# Test different projects
act workflow_dispatch \
  --workflows .github/workflows/deploy.yml \
  --input environment=development \
  --input project=webapp \
  --input stack=networking

# Test staging deployment
act workflow_dispatch \
  --workflows .github/workflows/deploy.yml \
  --input environment=staging \
  --input project=monitoring \
  --input stack=networking

# Run specific job
act -j deploy \
  --workflows .github/workflows/deploy.yml \
  --input environment=pipeline
```

**Benefits**:

- ✅ Test uncommitted changes
- ✅ No GitHub API rate limits
- ✅ Faster iteration
- ✅ Test workflow changes locally

**Limitations**:

- ⚠️ Requires Docker
- ⚠️ Some GitHub Actions features not fully supported
- ⚠️ OIDC authentication won't work (can't assume AWS roles the same way)
- ⚠️ Secrets management is different

### Option 4: Workflow Development Pattern

Use this pattern for rapid workflow development:

```bash
# 1. Create feature branch
git checkout -b feat/update-deployment-workflow

# 2. Make changes to workflow
vim .github/workflows/deploy.yml

# 3. Quick commit
git add .github/workflows/deploy.yml
git commit -m "test: update deployment logic"

# 4. Push to remote
git push origin feat/update-deployment-workflow

# 5. Run immediately (deploys to development)
gh workflow run deploy.yml \
  --ref feat/update-deployment-workflow \
  -f environment=development \
  -f project=monitoring \
  -f stack=networking

# 6. Watch in real-time
gh run watch

# 7. Iterate quickly
# Edit workflow → git commit --amend → git push --force → gh workflow run
gh workflow run deploy.yml \
  --ref test/workflow-update \
  -f environment=pipeline \
  -f project=monitoring \
  -f stack=networking

# 8. When satisfied, merge to main
git checkout main
git merge feat/update-deployment-workflow
git push origin main
```

## Recommended Development Workflow

Here's my recommended approach for your situation:

### For Stack Changes (CDK Code)

```bash
# 1. Test locally first (fastest) - use project-specific stack name
PROJECT_NAME=monitoring ENVIRONMENT=development npx cdk diff NetworkingStack-monitoring-development

# Or using CDK context
npx cdk diff NetworkingStack-monitoring-development \
  --context project=monitoring \
  --context environment=development

# 2. If synthesis works, test deployment locally
# Development is the first deployment target
PROJECT_NAME=monitoring ENVIRONMENT=development npx cdk deploy NetworkingStack-monitoring-development

# Or using CDK context
npx cdk deploy NetworkingStack-monitoring-development \
  --context project=monitoring \
  --context environment=development

# For different projects
PROJECT_NAME=webapp ENVIRONMENT=development npx cdk deploy NetworkingStack-webapp-development

# 3. If local deployment works, commit and push
git add .
git commit -m "feat(networking): add VPC flow logs"
git push origin main

# 4. Let GitHub Actions deploy to other environments
# (GitHub Actions handles pipeline → dev → prod progression)
# Stack names follow pattern: StackName-${project}-${environment}
```

### For Workflow Changes

```bash
# 1. Create test branch
git checkout -b test/workflow-update

# 2. Make workflow changes
vim .github/workflows/deploy.yml

# 3. Commit and push
git add .github/workflows/deploy.yml
git commit -m "ci: improve error handling in deploy action"
git push origin test/workflow-update

# 4. Test the workflow (deploys to development)
gh workflow run deploy.yml \
  --ref test/workflow-update \
  -f environment=development \
  -f project=monitoring \
  -f stack=networking

# 5. Watch results
gh run watch

# 6. Iterate until working
# ... make changes ...
git commit --amend --no-edit
git push --force origin test/workflow-update
gh workflow run deploy.yml \
  --ref test/workflow-update \
  -f environment=development \
  -f project=monitoring \
  -f stack=networking

# 7. Merge when ready
git checkout main
git merge test/workflow-update
git push origin main
```

## Quick Reference Commands

### Check Workflow Status

```bash
# List recent runs
gh run list --workflow=deploy.yml

# Watch current run
gh run watch

# View specific run
gh run view <run-id>

# View logs
gh run view <run-id> --log

# Cancel running workflow
gh run cancel <run-id>

# Re-run failed workflow
gh run rerun <run-id>
```

### Test Before Pushing

```bash
# Validate YAML syntax
yamllint .github/workflows/deploy.yml

# Check for common issues
actionlint .github/workflows/deploy.yml

# Validate CDK synthesis (with project context)
# Development is the first deployment target
PROJECT_NAME=monitoring ENVIRONMENT=development npx cdk synth

# Or using CDK context
npx cdk synth --context project=monitoring --context environment=development

# List all stacks for a project
npx cdk list --context project=monitoring --context environment=development

# Run unit tests
yarn test

# Check TypeScript compilation
yarn run build
```

## Pro Tips

### 1. Use Branch Protection for Main

```yaml
# .github/workflows/deploy.yml
on:
  workflow_dispatch:
    inputs:
      environment:
        type: choice
        options:
          - pipeline
          - development
          - production
  push:
    branches:
      - main  # Only auto-deploy from main
    paths:
      - 'lib/**'
      - '.github/workflows/deploy.yml'
```

### 2. Create Development Environment

```bash
# Add a 'development' environment for testing
PROJECT_NAME=monitoring ENVIRONMENT=development npx cdk deploy --all

# Or deploy specific stack
PROJECT_NAME=monitoring ENVIRONMENT=development npx cdk deploy NetworkingStack-monitoring-development

# This way you can test without affecting pipeline/production
gh workflow run deploy.yml \
  -f environment=development \
  -f project=monitoring \
  -f stack=networking

# Test different projects in development
gh workflow run deploy.yml \
  -f environment=development \
  -f project=webapp \
  -f stack=networking
```

### 3. Use Draft Pull Requests

```bash
# Create draft PR for testing
gh pr create --draft --title "test: deployment updates"

# GitHub Actions will run on the PR
# Iterate on the PR branch
# Convert to ready when satisfied
gh pr ready
```

### 4. Enable Workflow Logs Locally

```bash
# Set environment variable for detailed CDK logs
export CDK_DEBUG=true

# Run with verbose output (project-specific stack)
# Development is the first deployment target
PROJECT_NAME=monitoring ENVIRONMENT=development npx cdk deploy NetworkingStack-monitoring-development --verbose

# Or using CDK context
npx cdk deploy NetworkingStack-monitoring-development \
  --context project=monitoring \
  --context environment=development \
  --verbose
```

## Summary

| Scenario | Best Approach | Speed |
|----------|--------------|-------|
| Testing CDK stack changes | Local CDK deploy | ⚡⚡⚡ Fastest |
| Testing workflow changes | Test branch + gh workflow run | ⚡⚡ Fast |
| Quick iteration | Local CDK diff/synth | ⚡⚡⚡ Fastest |
| Full pipeline test | Commit → Push → Trigger workflow | ⚡ Slower |
| Testing without push | act (limited AWS functionality) | ⚡⚡ Fast |

### My Recommendation for Your Workflow

```bash
# 1. Quick iteration (uncommitted changes) - use project-specific stack names
# Development is the first deployment target
PROJECT_NAME=monitoring ENVIRONMENT=development npx cdk diff NetworkingStack-monitoring-development

# Or using CDK context
npx cdk diff NetworkingStack-monitoring-development \
  --context project=monitoring \
  --context environment=development

# Deploy locally for testing
PROJECT_NAME=monitoring ENVIRONMENT=development npx cdk deploy NetworkingStack-monitoring-development

# 2. When satisfied, commit to test branch
git checkout -b test/networking-updates
git add .
git commit -m "feat(networking): add configuration"
git push origin test/networking-updates

# 3. Test full pipeline (include project parameter)
# Deploys to development account
gh workflow run deploy.yml \
  --ref test/networking-updates \
  -f environment=development \
  -f project=monitoring \
  -f stack=networking

# 4. Merge when confirmed working
git checkout main
git merge test/networking-updates
git push origin main
This gives you:

- ✅ Fast local iteration
- ✅ Safe testing in isolation
- ✅ Full pipeline validation
- ✅ Clean main branch

**The key insight**: Use local CDK for stack testing, use GitHub Actions for pipeline testing. Don't use GitHub Actions to test every small CDK change!

## Multi-Project Infrastructure Pattern

### Stack Naming Convention

All stacks follow the pattern: `[StackName]-[project]-[environment]`

**Examples**:
- `NetworkingStack-monitoring-development` (first deployment target)
- `EcsStack-webapp-staging` (second deployment target)
- `EbsStorageStack-monitoring-production` (third deployment target, requires approval)

### Local Development with Projects

**Default Project**: If no project is specified, defaults to `"monitoring"` for backward compatibility.

**Using Environment Variables**:
```bash
# Monitoring project - Development (first deployment target)
PROJECT_NAME=monitoring ENVIRONMENT=development npx cdk deploy NetworkingStack-monitoring-development

# Monitoring project - Staging (second deployment target)
PROJECT_NAME=monitoring ENVIRONMENT=staging npx cdk deploy NetworkingStack-monitoring-staging

# Monitoring project - Production (third deployment target, requires approval)
PROJECT_NAME=monitoring ENVIRONMENT=production npx cdk deploy NetworkingStack-monitoring-production

# Webapp project - Development
PROJECT_NAME=webapp ENVIRONMENT=development npx cdk deploy NetworkingStack-webapp-development
```

**Using CDK Context**:
```bash
# Monitoring project - Development (first deployment target)
npx cdk deploy NetworkingStack-monitoring-development \
  --context project=monitoring \
  --context environment=development

# Monitoring project - Staging (second deployment target)
npx cdk deploy NetworkingStack-monitoring-staging \
  --context project=monitoring \
  --context environment=staging

# Monitoring project - Production (third deployment target)
npx cdk deploy NetworkingStack-monitoring-production \
  --context project=monitoring \
  --context environment=production

# Webapp project - Development
npx cdk deploy NetworkingStack-webapp-development \
  --context project=webapp \
  --context environment=development
```

### Listing Stacks

```bash
# List all stacks for monitoring project in development
npx cdk list --context project=monitoring --context environment=development

# List all stacks for monitoring project in staging
npx cdk list --context project=monitoring --context environment=staging

# List all stacks for webapp project in development
npx cdk list --context project=webapp --context environment=development

# Using environment variables
PROJECT_NAME=monitoring ENVIRONMENT=development npx cdk list
```

### Common Local Development Commands

```bash
# Synthesize monitoring project (development - first deployment target)
PROJECT_NAME=monitoring ENVIRONMENT=development npx cdk synth

# Diff changes for monitoring project
PROJECT_NAME=monitoring ENVIRONMENT=development npx cdk diff NetworkingStack-monitoring-development

# Deploy monitoring project stack to development
PROJECT_NAME=monitoring ENVIRONMENT=development npx cdk deploy NetworkingStack-monitoring-development

# Deploy monitoring project stack to staging (second deployment target)
PROJECT_NAME=monitoring ENVIRONMENT=staging npx cdk deploy NetworkingStack-monitoring-staging

# Deploy monitoring project stack to production (third deployment target, requires approval)
PROJECT_NAME=monitoring ENVIRONMENT=production npx cdk deploy NetworkingStack-monitoring-production

# Deploy webapp project stack to development
PROJECT_NAME=webapp ENVIRONMENT=development npx cdk deploy NetworkingStack-webapp-development

# Destroy monitoring project stack
PROJECT_NAME=monitoring ENVIRONMENT=development npx cdk destroy NetworkingStack-monitoring-development
```

### SSM Parameter Paths

SSM parameters follow project-specific paths:
- Format: `/${project}/${environment}/[resource]/[parameter]`
- Example: `/monitoring/development/ebs/prometheus-volume-size` (first deployment target)
- Example: `/monitoring/staging/ebs/prometheus-volume-size` (second deployment target)
- Example: `/webapp/development/ecs/cluster-name`

### CloudFormation Exports

CloudFormation exports follow project-specific naming:
- Format: `${environment}-${project}-[resource]-[property]`
- Example: `development-monitoring-vpc-id` (first deployment target)
- Example: `staging-monitoring-vpc-id` (second deployment target)
- Example: `development-webapp-alb-arn` 