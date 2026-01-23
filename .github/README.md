<!-- @format -->

# GitHub Actions Documentation

This directory contains GitHub Actions workflows and reusable composite actions for CDK infrastructure deployment, CI/CD pipelines, and infrastructure security scanning.

## Table of Contents

- [Overview](#overview)
- [Directory Structure](#directory-structure)
- [Workflows](#workflows)
  - [CI Workflow](#ci-workflow-ciyml)
  - [Deployment Workflows](#deployment-workflows)
  - [Reusable Workflows](#reusable-workflows)
- [Composite Actions](#composite-actions)
  - [setup-node-yarn](#setup-node-yarn)
  - [setup-cdk-deployment](#setup-cdk-deployment)
  - [deploy-cdk-stack](#deploy-cdk-stack)
- [Stack Naming Convention](#stack-naming-convention)
- [Environment Configuration](#environment-configuration)
- [Troubleshooting](#troubleshooting)
- [Best Practices](#best-practices)

## Overview

The CI/CD pipeline is designed around:

- **Environment-specific workflows**: Separate workflows for development, staging, and production
- **OIDC Authentication**: Secure credential-less AWS authentication via GitHub OIDC
- **Immutable Artifacts**: Staging synthesizes artifacts that production reuses
- **Post-deployment Verification**: Automated validation after each stack deployment
- **Path-based Filtering**: CI/CD only runs on relevant code changes

## Directory Structure

```
.github/
├── actions/                          # Composite actions
│   ├── deploy-cdk-stack/             # CDK stack deployment
│   │   ├── action.yml
│   │   └── README.md
│   ├── setup-cdk-deployment/         # Full deployment environment setup
│   │   └── action.yml
│   └── setup-node-yarn/              # Node.js and Yarn setup with caching
│       ├── action.yml
│       └── README.md
│
├── workflows/
│   ├── _deploy-stack.yml             # Reusable stack deployment workflow
│   ├── _iac-security-scan.yml        # Reusable IaC security scanning
│   ├── ci.yml                        # Continuous Integration
│   │
│   ├── deploy-monitoring-dev.yml     # Monitoring → Development
│   ├── deploy-monitoring-staging.yml # Monitoring → Staging
│   ├── deploy-monitoring-prod.yml    # Monitoring → Production
│   │
│   ├── deploy-webapp-dev.yml         # Webapp → Development
│   └── deploy-dashboards.yml         # Dashboard deployments
│
├── CODEOWNERS                        # Code ownership for PR reviews
├── PULL_REQUEST_TEMPLATE.md          # PR template
├── ISSUE_TEMPLATE/                   # Issue templates
│   ├── bug_report.md
│   └── feature_request.md
├── dependabot.yml                    # Automated dependency updates
├── README.md                         # This file
└── GUIDE.md                          # Local development guide
```

---

## Workflows

### CI Workflow (`ci.yml`)

**Purpose**: Fast feedback on code quality for every commit and pull request.

**Triggers**:

- Push to any branch
- Pull requests to any branch

**Jobs**:

| Job | Description | Condition |
|-----|-------------|-----------|
| `detect-changes` | Identifies which code areas changed | Always |
| `setup` | Installs dependencies and caches | Always |
| `lint` | ESLint code linting | Source/test changes |
| `typecheck` | TypeScript type checking | Source/test changes |
| `test-monitoring` | Monitoring domain tests | Monitoring changes or shared changes |
| `test-webapp` | Webapp domain tests | Webapp changes or shared changes |
| `test-foundation` | Foundation/networking tests | Foundation changes or shared changes |
| `test-constructs` | CDK construct tests | Construct changes or shared changes |
| `test-shared` | Shared utility tests | Shared changes |
| `test-security` | Security tests | Security test changes or shared changes |
| `test-connectivity` | Connectivity tests | Foundation changes or shared changes |
| `test-snapshots` | Snapshot tests | Any source/test changes |
| `build` | TypeScript compilation | Source changes |
| `validate-cdk` | CDK synthesis validation | Source changes |
| `iac-security-scan` | Checkov/cfn-nag scanning | Source changes |

**Key Features**:

- **Smart Filtering**: Uses `dorny/paths-filter` to run only relevant tests
- **Parallel Execution**: Independent tests run concurrently
- **Continue on Error**: Test jobs don't block other tests
- **Snapshot Auto-Update**: Commits updated snapshots automatically

---

### Deployment Workflows

Each environment has its own deployment workflow for clear separation and different approval requirements.

#### Monitoring Project

| Workflow | Branch | Environment | Account |
|----------|--------|-------------|---------|
| `deploy-monitoring-dev.yml` | `develop` | development | Development |
| `deploy-monitoring-staging.yml` | `staging` | staging | Staging |
| `deploy-monitoring-prod.yml` | `main` | production | Production |

#### Webapp Project

| Workflow | Branch | Environment |
|----------|--------|-------------|
| `deploy-webapp-dev.yml` | `develop` | development |

#### Common Deployment Flow

Each deployment workflow follows this pattern:

```
Setup & Build → Deploy Networking → Verify Networking
              → Deploy S3 → Verify S3
              → Deploy EFS → Verify EFS
              → Deploy Infra → Verify Infra
              → Deploy Service → Verify Service
              → Deploy Security → Verify Security
              → Deployment Summary
```

**Triggers**:

- Push to designated branch with relevant path changes
- Manual dispatch via `workflow_dispatch`

**Path Filters** (what triggers deployments):

```yaml
paths:
  - "lib/stacks/**"
  - "lib/constructs/**"
  - "lib/shared/**"
  - "bin/**"
  - "config/**"
  - "lambda/**"
  - ".github/workflows/deploy-*.yml"
  - ".github/actions/**"
```

---

### Reusable Workflows

#### `_deploy-stack.yml`

Reusable workflow for deploying a single CDK stack. Called by environment-specific workflows.

**Inputs**:

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `stack-name` | Full CDK stack name | Yes | - |
| `environment` | Target environment | Yes | - |
| `aws-account-id` | Target AWS account ID | Yes | - |
| `aws-region` | AWS region | No | `eu-west-1` |
| `additional-context` | CDK context as JSON | No | `{}` |
| `require-approval` | CDK approval requirement | No | `never` |
| `verify-bootstrap` | Verify CDK bootstrap | No | `false` |
| `outputs-directory` | Directory for stack outputs | No | `""` |

**Usage**:

```yaml
deploy-networking:
  uses: ./.github/workflows/_deploy-stack.yml
  with:
    stack-name: "development-Networking"
    environment: "development"
    aws-account-id: ${{ needs.setup.outputs.aws-account-id }}
    aws-region: ${{ vars.AWS_REGION || 'eu-west-1' }}
    outputs-directory: "deployment-outputs"
  secrets:
    AWS_OIDC_ROLE: ${{ secrets.AWS_OIDC_ROLE_DEV }}
```

#### `_iac-security-scan.yml`

Reusable workflow for infrastructure-as-code security scanning using Checkov.

**Inputs**:

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `environment` | Target environment | Yes | - |
| `enforce-blocking` | Fail on findings | No | `false` |
| `cdk-output-path` | Path to CDK output | No | `cdk.out` |
| `skip-checks` | Checks to skip | No | `""` |
| `soft-fail-on` | Severity levels to soft-fail | No | `LOW,MEDIUM` |

---

## Composite Actions

### setup-node-yarn

Sets up Node.js, enables Corepack for Yarn v4+, and caches dependencies.

**Inputs**:

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `node-version` | Node.js version | No | `22` |
| `install-dependencies` | Run yarn install | No | `true` |
| `cache-dependency-path` | Lockfile path | No | `yarn.lock` |

**Outputs**:

| Output | Description |
|--------|-------------|
| `cache-hit` | Whether cache was hit |
| `cache-key` | Cache key used |
| `node-version` | Installed Node version |

**Usage**:

```yaml
- name: Setup Node.js and Yarn
  uses: ./.github/actions/setup-node-yarn
  with:
    node-version: "22"
```

---

### setup-cdk-deployment

Sets up the complete environment for CDK deployment including AWS credentials and build cache.

**Inputs**:

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `node-version` | Node.js version | No | `22` |
| `aws-role` | AWS OIDC role ARN | Yes | - |
| `aws-region` | AWS region | Yes | - |
| `build-cache-key` | Build cache key | Yes | - |
| `environment-name` | Environment name | No | `development` |

**Usage**:

```yaml
- name: Setup CDK Deployment
  uses: ./.github/actions/setup-cdk-deployment
  with:
    aws-role: ${{ secrets.AWS_OIDC_ROLE_DEV }}
    aws-region: "eu-west-1"
    build-cache-key: ${{ needs.build.outputs.cache-key }}
    environment-name: "development"
```

---

### deploy-cdk-stack

Deploys a CDK stack with validation, error handling, and output capture.

**Inputs**:

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `stack-name` | CDK stack name | Yes | - |
| `environment` | Target environment | Yes | - |
| `aws-account-id` | AWS account ID | Yes | - |
| `aws-region` | AWS region | Yes | - |
| `additional-context` | CDK context as JSON | No | `{}` |
| `additional-args` | Extra CDK arguments | No | `""` |
| `require-approval` | Approval requirement | No | `never` |
| `verify-bootstrap` | Verify CDK bootstrap | No | `false` |
| `outputs-directory` | Output save directory | No | `""` |

**Outputs**:

| Output | Description |
|--------|-------------|
| `deployment-status` | `success` or `failure` |
| `stack-outputs` | CloudFormation outputs (JSON) |
| `outputs-file` | Path to saved outputs file |

**Usage**:

```yaml
- name: Deploy Stack
  uses: ./.github/actions/deploy-cdk-stack
  with:
    stack-name: "development-Networking"
    environment: "development"
    aws-account-id: ${{ needs.setup.outputs.aws-account-id }}
    aws-region: "eu-west-1"
    outputs-directory: "deployment-outputs"
```

---

## Stack Naming Convention

Stacks follow the pattern: `{environment}-{StackName}`

| Stack | Development | Staging | Production |
|-------|-------------|---------|------------|
| Networking | `development-Networking` | `staging-Networking` | `production-Networking` |
| Monitoring S3 | `development-MonitoringS3` | `staging-MonitoringS3` | `production-MonitoringS3` |
| Monitoring EFS | `development-MonitoringEfs` | `staging-MonitoringEfs` | `production-MonitoringEfs` |
| Monitoring Infra | `development-MonitoringInfra` | `staging-MonitoringInfra` | `production-MonitoringInfra` |
| Monitoring Service | `development-MonitoringService` | `staging-MonitoringService` | `production-MonitoringService` |
| Security Prowler | `development-SecurityProwler` | `staging-SecurityProwler` | `production-SecurityProwler` |

### SSM Parameter Paths

SSM parameters follow: `/{project}/{environment}/{resource}/{parameter}`

Examples:
- `/monitoring/development/efs/filesystem-id`
- `/monitoring/staging/ecs/cluster-arn`
- `/webapp/development/dynamodb/table-name`

### CloudFormation Exports

Exports follow: `{environment}-{resource}-{property}`

Examples:
- `development-vpc-id`
- `staging-alb-arn`
- `production-ecs-cluster-name`

---

## Environment Configuration

### GitHub Environments

Configure these GitHub Environments in repository settings:

| Environment | Branch Protection | Required Reviewers |
|-------------|-------------------|-------------------|
| `development` | None | 0 |
| `staging` | `staging` branch | 0 |
| `production` | `main` branch | 1+ |

### Required Secrets (per environment)

| Secret | Description |
|--------|-------------|
| `AWS_OIDC_ROLE_DEV` | OIDC role ARN for development account |
| `AWS_OIDC_ROLE_STAGING` | OIDC role ARN for staging account |
| `AWS_OIDC_ROLE_PROD` | OIDC role ARN for production account |

### Required Variables (per environment)

| Variable | Description | Example |
|----------|-------------|---------|
| `AWS_ACCOUNT_ID_DEV` | Development account ID | `123456789012` |
| `AWS_ACCOUNT_ID_STAGING` | Staging account ID | `234567890123` |
| `AWS_ACCOUNT_ID_PROD` | Production account ID | `345678901234` |
| `AWS_REGION` | AWS region | `eu-west-1` |

---

## Troubleshooting

### Common Issues

#### Stack Not Found

```
Error: Stack development-Networking not found
```

**Solution**: Verify the stack name matches the pattern `{environment}-{StackName}` and exists in `bin/app.ts`.

#### CDK Bootstrap Not Found

```
Error: CDK bootstrap stack not found
```

**Solution**: Bootstrap the CDK environment:
```bash
npx cdk bootstrap aws://ACCOUNT_ID/REGION --profile YOUR_PROFILE
```

#### OIDC Authentication Failed

```
Error: Could not assume role with OIDC
```

**Solutions**:
1. Verify the OIDC role trust policy includes GitHub's OIDC provider
2. Check the role ARN in secrets is correct
3. Ensure the role has necessary permissions

#### Path Filter Not Triggering

If workflows don't trigger on code changes:
1. Check the `paths` filter includes your changed files
2. Verify you're pushing to the correct branch
3. Check for typos in path patterns

### Verification Script Failures

If post-deployment verification fails:
1. Check CloudFormation stack events for deployment issues
2. Verify AWS credentials have necessary read permissions
3. Check the verification script logs for specific errors

---

## Best Practices

### Workflow Development

1. **Test on feature branches first**: Create `test/workflow-update` branches
2. **Use manual dispatch**: Test with `workflow_dispatch` before automated triggers
3. **Check job summaries**: Review `$GITHUB_STEP_SUMMARY` for deployment details

### Security

1. **Never hardcode credentials**: Always use OIDC or GitHub secrets
2. **Use environment protection**: Require approvals for production
3. **Audit secrets regularly**: Rotate OIDC roles and verify permissions

### Performance

1. **Leverage caching**: Node modules and Turbo cache significantly speed up builds
2. **Use path filters**: Don't run tests for unrelated changes
3. **Parallel jobs**: Independent tests run concurrently

### Maintenance

1. **Keep actions updated**: Use Dependabot for action version updates
2. **Document changes**: Update this README when modifying workflows
3. **Monitor run times**: Investigate if builds become slower

---

## Related Documentation

- [Local Development Guide](./GUIDE.md) - Running CDK locally
- [CDK Patterns Guide](../.cursor/rules/cdk-patterns.md) - CDK coding standards
- [Scripts Guide](../docs/SCRIPTS_GUIDE.md) - Verification scripts
- [AWS CDK Documentation](https://docs.aws.amazon.com/cdk/)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
