# GitHub Actions Refactor - Migration Guide

This document describes the refactored GitHub Actions pipeline architecture and how to migrate from the existing setup.

## Architecture Overview

```
.github/
├── actions/
│   ├── setup-node-yarn/           # Node.js + Yarn + caching (replaces setup-infrastructure)
│   │   └── action.yml
│   └── deploy-cdk-stack/          # CDK stack deployment (simplified)
│       └── action.yml
│
├── workflows/
│   ├── ci.yml                     # Continuous Integration (refactored)
│   ├── _deploy-stack.yml          # Reusable: deploy single stack
│   ├── _run-integration-tests.yml # Reusable: run integration tests
│   ├── deploy-monitoring-dev.yml  # Monitoring → dev (auto on develop)
│   └── deploy-monitoring-prod.yml # Monitoring → staging → prod (manual)

tests/
├── unit/                          # Existing unit tests
└── integration/
    ├── jest.integration.config.ts # Jest config for integration tests
    ├── setup.ts                   # Test setup and utilities
    └── monitoring/                # Monitoring service tests
        ├── networking.test.ts
        ├── efs.test.ts
        ├── infra.test.ts
        └── service.test.ts
```

## Key Changes

### 1. Renamed Action: `setup-infrastructure` → `setup-node-yarn`

The action now has a clearer name reflecting its purpose. Functionality is the same.

### 2. Simplified `deploy-cdk-stack` Action

- Removed project-specific inputs (`dev-vpc-id`, `dev-account-id`)
- Added `additional-context` for passing arbitrary CDK context
- Inline validation instead of external scripts
- Cleaner output handling

### 3. New Reusable Workflows

- `_deploy-stack.yml` - Deploys a single CDK stack
- `_run-integration-tests.yml` - Runs integration tests

### 4. Service-Specific Deployment Workflows

| Workflow | Trigger | Target |
|----------|---------|--------|
| `deploy-monitoring-dev.yml` | Push to `develop` | Dev (auto) |
| `deploy-monitoring-prod.yml` | Push to `main` | Staging → Prod (manual approval) |

### 5. Organized Integration Tests

Tests moved from `verify-*` make targets to structured TypeScript tests in `tests/integration/`.

## Migration Steps

### Step 1: Add New Files (Non-Breaking)

Copy all files from this refactor to your repository:

```bash
# Actions
cp -r .github/actions/setup-node-yarn your-repo/.github/actions/

# Workflows (new files, won't conflict)
cp .github/workflows/_deploy-stack.yml your-repo/.github/workflows/
cp .github/workflows/_run-integration-tests.yml your-repo/.github/workflows/
cp .github/workflows/deploy-monitoring-dev.yml your-repo/.github/workflows/
cp .github/workflows/deploy-monitoring-prod.yml your-repo/.github/workflows/

# Integration tests
cp -r tests/integration your-repo/tests/
```

### Step 2: Update package.json

Add the integration test scripts:

```json
{
  "scripts": {
    "test:integration": "jest --config tests/integration/jest.integration.config.ts",
    "test:integration:monitoring": "jest --config tests/integration/jest.integration.config.ts --testPathPattern=monitoring"
  }
}
```

Add required dependencies:

```bash
yarn add -D @aws-sdk/client-cloudformation @aws-sdk/client-ec2 @aws-sdk/client-ecs @aws-sdk/client-efs @aws-sdk/client-elastic-load-balancing-v2 jest-junit
```

### Step 3: Configure GitHub Environments

In your repository settings (Settings → Environments):

1. **development** - No protection rules (auto-deploy)
2. **staging** - No protection rules (auto-deploy after dev)
3. **production** - Enable "Required reviewers" (add yourself)

### Step 4: Test New Workflows

1. Create a feature branch
2. Push changes to trigger CI
3. Verify CI passes
4. Merge to `develop` to test dev deployment
5. Merge to `main` to test staging → prod pipeline

### Step 5: Remove Old Files (After Verification)

Once everything works:

```bash
# Remove deprecated workflows
rm .github/workflows/_deploy-cdk-stacks.yml
rm .github/workflows/deploy.yml
rm .github/workflows/deploy-monitoring.yml  # Old file

# Optionally rename setup-infrastructure to setup-node-yarn
# (or keep both during transition)
```

## Workflow Triggers

### CI (`ci.yml`)
- **All branches**: Push and PR
- Runs: lint, typecheck, tests, build, CDK validation

### Dev Deployment (`deploy-monitoring-dev.yml`)
- **develop branch**: Push (auto)
- **Manual**: workflow_dispatch
- Path filters: `lib/stacks/monitoring/**`, etc.

### Prod Deployment (`deploy-monitoring-prod.yml`)
- **main branch**: Push (with approval gate)
- **Manual**: workflow_dispatch with skip options
- Deploys: Staging first, then Production (requires approval)

## Adding New Services

To add a new service (e.g., `web`):

1. Create workflows:
   - `.github/workflows/deploy-web-dev.yml`
   - `.github/workflows/deploy-web-prod.yml`

2. Create integration tests:
   - `tests/integration/web/cdn.test.ts`
   - `tests/integration/web/api.test.ts`

3. Follow the same patterns from the monitoring workflows.

## Rollback

If issues occur:

1. Revert to old workflows by restoring from git
2. Old `deploy-monitoring.yml` will continue working
3. Remove new workflow files

## Environment Variables

Required repository variables:
- `AWS_REGION` (default: eu-west-1)
- `AWS_ACCOUNT_ID_DEV`
- `AWS_ACCOUNT_ID_STAGING`
- `AWS_ACCOUNT_ID_PROD`

Required secrets:
- `AWS_OIDC_ROLE` - ARN of the OIDC role in pipeline account

## Troubleshooting

### Integration tests fail with "stack not found"
- Ensure `ENVIRONMENT` env var is set correctly
- Verify stack naming convention: `{environment}-{StackName}`

### Deployment fails with "cannot assume role"
- Verify CDK bootstrap trust is configured
- Check pipeline account OIDC role has `sts:AssumeRole` permission

### Cache not restoring
- Check cache key generation
- Yarn lockfile changes invalidate cache (expected)
