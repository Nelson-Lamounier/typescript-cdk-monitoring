# GitHub Actions Documentation

This directory contains reusable composite actions for CDK infrastructure deployment, drift detection, and pipeline orchestration. All actions are designed for reliability, error handling, and comprehensive troubleshooting guidance.

## Table of Contents

- [Overview](#overview)
- [Actions](#actions)
  - [setup-infrastructure](#setup-infrastructure)
  - [setup-cdk-deployment](#setup-cdk-deployment)
  - [deploy-cdk-stack](#deploy-cdk-stack)
  - [drift-detection](#drift-detection)
  - [parallel-execution-manager](#parallel-execution-manager)
- [Common Usage Patterns](#common-usage-patterns)
- [Troubleshooting](#troubleshooting)

## Overview

These composite actions provide a complete workflow for:
- Setting up Node.js, Yarn, and CDK environments
- Deploying CDK stacks with comprehensive error handling
- Detecting infrastructure drift between code and deployed resources
- Managing parallel job execution for optimal pipeline performance

All actions include:
- Input validation with clear error messages
- Comprehensive error handling and recovery
- Detailed troubleshooting guidance
- Support for cross-account deployments
- Environment-specific configuration

## Actions

### setup-infrastructure

Sets up the Node.js environment, package manager, and dependency caching for infrastructure operations.

**Purpose**: Provides a consistent environment for all infrastructure-related jobs with optimised caching to reduce build times.

**Inputs**:

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `node-version` | Node.js version to use | No | `22` |
| `cache-key` | Cache key for build artifacts | No | `""` |

**Outputs**:

| Output | Description |
|--------|-------------|
| `cache-hit` | Whether dependency cache was hit |

**Usage Example**:

```yaml
- name: Setup Infrastructure
  uses: ./.github/actions/setup-infrastructure
  with:
    node-version: '22'
```

**Key Features**:
- Enables Corepack for Yarn v4+ package management
- Caches Turbo build artifacts for faster subsequent runs
- Caches Yarn dependencies based on lockfile hash
- Always runs `yarn install` to ensure binaries (like CDK) are available

---

### setup-cdk-deployment

Sets up the complete environment for CDK deployment including AWS credentials, build cache restoration, and environment verification.

**Purpose**: Prepares the deployment environment with all prerequisites validated before attempting CDK operations.

**Inputs**:

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `node-version` | Node.js version to use | No | `22` |
| `aws-role` | AWS IAM role ARN for OIDC authentication | Yes | - |
| `aws-region` | AWS region for deployment | Yes | - |
| `build-cache-key` | Build cache key from build job | Yes | - |
| `environment-name` | Environment name for deployment | No | `pipeline` |

**Usage Example**:

```yaml
- name: Setup CDK Deployment
  uses: ./.github/actions/setup-cdk-deployment
  with:
    node-version: '22'
    aws-role: ${{ secrets.AWS_ROLE_ARN }}
    aws-region: 'eu-west-1'
    build-cache-key: ${{ needs.build.outputs.cache-key }}
    environment-name: 'pipeline'
```

**Key Features**:
- Configures AWS credentials via OIDC (no long-lived credentials)
- Restores build cache from previous build job
- Verifies Node.js, Yarn, AWS CLI, and CDK availability
- Falls back to building infrastructure if cache is missing
- Validates AWS credentials are active before proceeding

**Verification Checks**:
- Node.js and Yarn installation
- AWS CLI availability and credentials
- CDK CLI availability via npx
- Build artifacts presence (or triggers fallback build)

---

### deploy-cdk-stack

Deploys a CDK stack with comprehensive validation, error handling, and troubleshooting guidance.

**Purpose**: Provides a battle-tested deployment workflow that handles common CDK deployment issues, validates prerequisites, and provides actionable error messages.

**Inputs**:

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `stack-name` | Name of the CDK stack to deploy | Yes | - |
| `environment` | Environment name (e.g., pipeline, development, production) | Yes | - |
| `aws-account-id` | AWS Account ID for deployment | Yes | - |
| `aws-region` | AWS Region for deployment | Yes | - |
| `dev-vpc-id` | Development VPC ID (optional, for cross-account peering) | No | `""` |
| `dev-account-id` | Development Account ID (optional) | No | `""` |
| `additional-args` | Additional CDK deploy arguments | No | `--require-approval never` |

**Outputs**:

| Output | Description |
|--------|-------------|
| `deployment-status` | Status of the deployment (`success` or `failure`) |

**Usage Example**:

```yaml
- name: Deploy Networking Stack
  uses: ./.github/actions/deploy-cdk-stack
  with:
    stack-name: 'NetworkingStack-pipeline'
    environment: 'pipeline'
    aws-account-id: ${{ needs.validate-setup.outputs.aws-account-id }}
    aws-region: 'eu-west-1'
    dev-vpc-id: ${{ secrets.DEV_VPC_ID }}
    dev-account-id: ${{ secrets.DEV_ACCOUNT_ID }}
```

**Key Features**:
- Validates all required environment variables before deployment
- Verifies stack exists in CDK application (handles EPIPE errors gracefully)
- Cleans up existing change sets to prevent conflicts
- Handles EPIPE (broken pipe) errors common in GitHub Actions
- Detects and provides guidance for CloudFormation export dependency errors
- Retries deployment on change set conflicts
- Comprehensive error analysis with troubleshooting steps

**Error Handling**:
- **EPIPE Errors**: Automatically retries without piping to avoid broken pipe issues
- **Change Set Conflicts**: Cleans up conflicting change sets and retries
- **Export Dependencies**: Provides ordered deployment guidance when exports are in use
- **Stack Not Found**: Validates stack name and provides available stack list

**Common Error Scenarios**:
1. **Stack Not Found**: Verifies stack name format and environment configuration
2. **CDK CLI Missing**: Checks setup-cdk-deployment job completion
3. **Change Set Conflicts**: Automatically cleans up and retries
4. **Export Dependencies**: Guides ordered deployment of dependent stacks

---

### drift-detection

Detects infrastructure drift between deployed CloudFormation stacks and CDK code configuration.

**Purpose**: Identifies when deployed infrastructure has been manually modified or differs from the CDK code, enabling infrastructure-as-code compliance.

**Inputs**:

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `stack-name` | Name of the CDK stack to check for drift | Yes | - |
| `environment` | Environment name (e.g., pipeline, development, production) | Yes | - |
| `aws-account-id` | AWS Account ID for deployment | Yes | - |
| `aws-region` | AWS Region for deployment | Yes | - |
| `dev-vpc-id` | Development VPC ID (optional) | No | `""` |
| `dev-account-id` | Development Account ID (optional) | No | `""` |
| `drift-threshold` | Maximum number of drifted resources before failing (0 = fail on any drift) | No | `0` |
| `check-mode` | Drift check mode: `full` (CloudFormation + CDK diff) or `quick` (CDK diff only) | No | `full` |

**Outputs**:

| Output | Description |
|--------|-------------|
| `drift-detected` | Whether drift was detected (`true` or `false`) |
| `drift-count` | Number of resources with detected drift |
| `drift-severity` | Severity of drift: `none`, `low`, `medium`, `high`, `critical` |

**Usage Example**:

```yaml
- name: Detect Infrastructure Drift
  uses: ./.github/actions/drift-detection
  with:
    stack-name: 'NetworkingStack-pipeline'
    environment: 'pipeline'
    aws-account-id: ${{ needs.validate-setup.outputs.aws-account-id }}
    aws-region: 'eu-west-1'
    drift-threshold: '2'
    check-mode: 'full'
```

**Key Features**:
- Validates all inputs including drift threshold and check mode
- Verifies stack exists and is in stable state before drift detection
- Performs CDK diff analysis to detect code vs deployment differences
- Optionally performs CloudFormation drift detection (full mode)
- Categorises drift by type (additions, deletions, modifications)
- Calculates drift severity based on resource count
- Generates comprehensive drift reports as artifacts
- Configurable threshold allows tolerance for non-critical drift

**Check Modes**:
- **Full Mode**: Performs both CDK diff and CloudFormation drift detection for comprehensive analysis
- **Quick Mode**: Only performs CDK diff for faster execution (skips CloudFormation API calls)

**Drift Severity Levels**:
- `none`: No drift detected
- `low`: 1-2 drifted resources
- `medium`: 3-5 drifted resources
- `high`: 6-10 drifted resources
- `critical`: 11+ drifted resources

**Artifacts Generated**:
- `drift-report/drift-summary.md`: Markdown summary of drift detection results
- `drift-report/cdk-diff-output.txt`: Full CDK diff output (if changes detected)
- `drift-report/cf-drift-details.txt`: CloudFormation drift details (full mode only)

**Remediation Guidance**:
When drift is detected, the action provides guidance on:
- Reviewing and approving intentional changes
- Updating CDK code to align with manual changes
- Reverting manual changes through AWS Console/CLI
- Force deploying CDK to override manual changes

---

### parallel-execution-manager

Manages parallel job execution and dependency optimisation for pipeline workflows.

**Purpose**: Analyses job dependencies and generates optimised execution plans to minimise pipeline duration while respecting resource constraints.

**Inputs**:

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `execution-strategy` | Execution strategy: `parallel`, `sequential`, or `adaptive` | No | `parallel` |
| `max-parallel-jobs` | Maximum number of parallel jobs to run simultaneously | No | `5` |
| `dependency-mode` | Dependency handling: `strict` (wait for all deps) or `optimistic` (proceed if critical deps succeed) | No | `optimistic` |

**Outputs**:

| Output | Description |
|--------|-------------|
| `execution-plan` | Generated execution plan for the pipeline (JSON) |
| `parallel-groups` | JSON array of parallel execution groups |
| `estimated-duration` | Estimated pipeline duration in minutes |

**Usage Example**:

```yaml
- name: Generate Execution Plan
  uses: ./.github/actions/parallel-execution-manager
  with:
    execution-strategy: 'parallel'
    max-parallel-jobs: '5'
    dependency-mode: 'optimistic'
```

**Key Features**:
- Models pipeline as directed acyclic graph (DAG) with dependencies
- Groups jobs into parallel execution groups based on dependencies
- Calculates estimated duration for different execution strategies
- Validates execution plan for circular dependencies
- Checks resource constraints against max parallel jobs
- Identifies critical path jobs that must succeed

**Execution Strategies**:
- **Parallel**: Maximises parallel execution for fastest completion
- **Sequential**: Executes jobs one at a time (useful for debugging or resource constraints)
- **Adaptive**: Balances critical path execution with parallel opportunities

**Job Dependency Model**:
The action includes a predefined dependency model for common pipeline jobs:
- `determine-jobs`: Foundation job with no dependencies
- `security-scan`: Depends on determine-jobs
- `lint-and-quality`: Depends on determine-jobs and security-scan
- `build`: Depends on determine-jobs, security-scan, and lint-and-quality
- `validate-setup`: Depends on determine-jobs, security-scan, and lint-and-quality
- Deployment jobs: Depend on build and validate-setup
- Drift detection jobs: Depend on respective deployment jobs

**Optimisation Metrics**:
- Sequential duration: Sum of all job durations
- Parallel duration: Sum of maximum durations per parallel group
- Time saved: Difference between sequential and parallel execution
- Efficiency gain: Percentage improvement from parallel execution

---

## Common Usage Patterns

### Complete Deployment Workflow

```yaml
jobs:
  setup:
    runs-on: ubuntu-latest
    steps:
      - uses: ./.github/actions/setup-infrastructure
        with:
          node-version: '22'

  build:
    needs: setup
    runs-on: ubuntu-latest
    steps:
      - uses: ./.github/actions/setup-infrastructure
      - name: Build
        run: yarn build
      - name: Cache Build
        uses: actions/cache@v4
        with:
          path: infrastructure/dist
          key: build-${{ runner.os }}-${{ github.sha }}

  deploy:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: ./.github/actions/setup-cdk-deployment
        with:
          aws-role: ${{ secrets.AWS_ROLE_ARN }}
          aws-region: 'eu-west-1'
          build-cache-key: build-${{ runner.os }}-${{ github.sha }}
      
      - uses: ./.github/actions/deploy-cdk-stack
        with:
          stack-name: 'NetworkingStack-pipeline'
          environment: 'pipeline'
          aws-account-id: ${{ secrets.AWS_ACCOUNT_ID }}
          aws-region: 'eu-west-1'

  drift-check:
    needs: deploy
    runs-on: ubuntu-latest
    steps:
      - uses: ./.github/actions/setup-cdk-deployment
        with:
          aws-role: ${{ secrets.AWS_ROLE_ARN }}
          aws-region: 'eu-west-1'
          build-cache-key: build-${{ runner.os }}-${{ github.sha }}
      
      - uses: ./.github/actions/drift-detection
        with:
          stack-name: 'NetworkingStack-pipeline'
          environment: 'pipeline'
          aws-account-id: ${{ secrets.AWS_ACCOUNT_ID }}
          aws-region: 'eu-west-1'
          drift-threshold: '0'
          check-mode: 'full'
```

### Cross-Account Deployment

```yaml
- uses: ./.github/actions/deploy-cdk-stack
  with:
    stack-name: 'MonitoringStack-pipeline'
    environment: 'pipeline'
    aws-account-id: ${{ secrets.PIPELINE_ACCOUNT_ID }}
    aws-region: 'eu-west-1'
    dev-vpc-id: ${{ secrets.DEV_VPC_ID }}
    dev-account-id: ${{ secrets.DEV_ACCOUNT_ID }}
```

### Quick Drift Check

```yaml
- uses: ./.github/actions/drift-detection
  with:
    stack-name: 'NetworkingStack-pipeline'
    environment: 'pipeline'
    aws-account-id: ${{ secrets.AWS_ACCOUNT_ID }}
    aws-region: 'eu-west-1'
    check-mode: 'quick'  # Faster, CDK diff only
    drift-threshold: '2'  # Allow up to 2 drifted resources
```

---

## Troubleshooting

### Deployment Failures

**Stack Not Found Error**:
- Verify stack name format: `[StackName]-[environment]`
- Check `infrastructure/bin/app.ts` for stack definitions
- Ensure `ENVIRONMENT` variable matches input environment
- Run `cd infrastructure && ENVIRONMENT=pipeline npx cdk list` locally

**CDK CLI Not Found**:
- Verify `setup-cdk-deployment` action completed successfully
- Check Node.js and Yarn installation
- Ensure dependencies are installed: `yarn install`
- Verify CDK is in `package.json` dependencies

**EPIPE (Broken Pipe) Errors**:
- Action automatically retries without piping
- If persistent, check GitHub Actions runner logs
- Verify CDK version compatibility

**Change Set Conflicts**:
- Action automatically cleans up conflicting change sets
- If manual intervention needed: `aws cloudformation delete-change-set --stack-name <stack> --change-set-name cdk-deploy-change-set`

**CloudFormation Export Dependencies**:
- Update dependent stacks first, then the exporting stack
- For NetworkingStack: Update MonitoringInfraStack → MonitoringEfsStack → NetworkingStack
- See `infrastructure/CLOUDFORMATION_EXPORT_DEPENDENCY_FIX.md` for details

### Drift Detection Issues

**Stack Not in Stable State**:
- Wait for stack operations to complete (CREATE/UPDATE/DELETE)
- Check CloudFormation console for stack status
- Re-run drift detection after stack stabilises

**Drift Detection Timeout**:
- Large stacks may exceed 5-minute timeout
- Consider using `quick` mode for faster checks
- Check AWS service health dashboard

**False Positives**:
- Review CDK diff output in artifacts
- Verify environment variables match deployment
- Check for SSM parameter lookup differences

### Setup Issues

**Cache Misses**:
- Verify cache keys are consistent across jobs
- Check `yarn.lock` and `package.json` haven't changed unexpectedly
- Build job must complete before deployment jobs

**AWS Credentials Not Configured**:
- Verify OIDC role ARN in repository secrets
- Check IAM role trust relationship includes GitHub OIDC provider
- Ensure role has necessary permissions for deployment

**Build Artifacts Missing**:
- Action automatically falls back to building infrastructure
- Check build job completed successfully
- Verify cache key matches between build and deployment jobs

---

## Best Practices

1. **Always use setup-infrastructure first**: Ensures consistent environment across all jobs
2. **Cache build artifacts**: Reduces deployment time by reusing compiled code
3. **Validate before deploy**: Use `validate-setup` job to verify AWS account and credentials
4. **Run drift detection post-deployment**: Ensures infrastructure matches code
5. **Use appropriate check modes**: `quick` for frequent checks, `full` for comprehensive analysis
6. **Set drift thresholds appropriately**: Allow tolerance for non-critical drift in non-production
7. **Handle errors gracefully**: All actions provide detailed troubleshooting guidance
8. **Use parallel execution manager**: Optimise pipeline duration for large workflows

---

## Related Documentation

- [AWS CDK Documentation](https://docs.aws.amazon.com/cdk/)
- [GitHub Actions Composite Actions](https://docs.github.com/en/actions/creating-actions/creating-a-composite-action)
- [AWS CloudFormation Drift Detection](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-cfn-stack-drift.html)
