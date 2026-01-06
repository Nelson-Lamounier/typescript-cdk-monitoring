# GitHub Actions Documentation

This directory contains reusable composite actions for CDK infrastructure deployment, drift detection, and pipeline orchestration. All actions are designed for reliability, error handling, and comprehensive troubleshooting guidance.

## Table of Contents

- [Overview](#overview)
- [Workflows](#workflows)
  - [CI Workflow (ci.yml)](#ci-workflow-ciyml)
  - [CD Workflow (deploy.yml)](#cd-workflow-deployyml)
  - [Determine Jobs to Run](#determine-jobs-to-run)
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

## Workflows

The repository uses two separate workflows to optimise performance, security, and maintainability:

### CI Workflow (`ci.yml`)

**Purpose**: Provides fast feedback on code quality for every commit and pull request.

**Triggers**:
- Push to any branch
- Pull requests to any branch
- Manual dispatch

**Jobs**:
1. **determine-jobs** - Determines which CI jobs to run based on inputs
2. **security-scan** - Validates workflow inputs and scans for secrets in code
3. **lint-and-quality** - TypeScript linting, type checking, CDK validation, tests, shell/YAML/JSON linting, documentation validation
4. **build** - Compiles infrastructure code and validates CDK synthesis
5. **validate-setup** - Read-only AWS environment validation (no deployment permissions)

**Key Features**:
- **Fast Execution**: Typically completes in < 5 minutes
- **Minimal Permissions**: Read-only access, no deployment capabilities
- **Early Feedback**: Runs on every commit to catch issues quickly
- **No Environment Protection**: Can run on any branch without approval gates

**Usage**:
```yaml
# Automatically runs on push/PR
# Or manually trigger via GitHub Actions UI
```

**Outputs**:
- Build cache key for use in CD workflow
- Test coverage reports
- Linting reports
- Validation results

---

### CD Workflow (`deploy.yml`)

**Purpose**: Controlled infrastructure deployments with comprehensive validation and error handling.

**Triggers**:
- Push to `main` branch (protected)
- Manual dispatch with stack selection

**Workflow Inputs** (Manual Dispatch):
- `stack`: Stack to deploy (networking, monitoring-efs, monitoring-infra, monitoring-services, vpc-peering, destroy-all)
- `jobs_to_run`: Comma-separated job list or 'all' or 'failed'
- `rerun_failed_from`: Run ID to re-run failed jobs from
- `enable_drift_detection`: Enable drift detection after deployment
- `drift_threshold`: Maximum drift count before failing
- `skip_validation`: Skip pre-deployment validation

**Jobs**:
1. **determine-jobs** - Determines which deployment jobs to run based on inputs and stack selection
2. **build** - Compiles infrastructure code (required for deployments)
3. **validate-setup** - AWS environment setup with deployment permissions
4. **deploy-networking** - Deploys NetworkingStack
5. **deploy-monitoring-efs** - Deploys MonitoringEfsStack
6. **deploy-vpc-peering** - Deploys VpcPeeringStack
7. **deploy-monitoring-infra** - Deploys MonitoringInfraStack
8. **deploy-monitoring-services** - Deploys MonitoringServiceStack
9. **health-checks** - Post-deployment health validation
10. **drift-detection-*** - Infrastructure drift detection for each stack
11. **destroy-all** - Stack destruction job (optional)

**Key Features**:
- **Environment Protection**: Requires approval for production deployments
- **Deployment Permissions**: Full AWS deployment access via OIDC
- **Comprehensive Validation**: Pre-deployment checks and post-deployment verification
- **Error Recovery**: Automatic retry logic and detailed troubleshooting guidance
- **Selective Execution**: Run specific jobs or re-run failed jobs only

**Usage**:
```yaml
# Automatically runs on merge to main
# Or manually trigger with stack selection:
# - Select stack to deploy
# - Optionally specify jobs_to_run
# - Optionally provide rerun_failed_from run ID
```

**Dependencies**:
- Requires successful CI workflow (or can run build/validate-setup internally)
- Uses build cache from CI when available
- Validates AWS credentials and account configuration

---

### Determine Jobs to Run

Both workflows include a `determine-jobs` job that intelligently selects which jobs to execute based on various inputs.

#### How It Works

**Three Execution Modes**:

1. **Rerun Failed Jobs** (`rerun_failed_from`)
   - Fetches failed jobs from a previous workflow run
   - Uses GitHub CLI to query run information
   - Automatically enables dependencies
   - Example: If `deploy-monitoring-infra` failed, it enables `build`, `validate-setup`, `deploy-networking`, `deploy-efs`, and `deploy-infra`

2. **Selective Jobs** (`jobs_to_run`)
   - Comma-separated list: `"build,deploy-networking"`
   - Case-insensitive keyword matching
   - Auto-enables dependencies for deployment jobs
   - Example: `"deploy-networking"` automatically enables `build` and `validate-setup`

3. **All Jobs** (`jobs_to_run: "all"` or empty)
   - Runs all standard jobs
   - Disables `destroy-all` and `rollback` by default (safety)
   - Respects `enable_drift_detection` input

#### Job Keywords

For selective execution, use these keywords (case-insensitive):
- `security` → Security scan
- `lint` → Lint and quality checks
- `build` → Build infrastructure
- `validate` or `setup` → Validate and setup
- `networking` → Deploy networking stack
- `efs` → Deploy EFS stack
- `peering` or `vpc` → Deploy VPC peering
- `infra` → Deploy monitoring infrastructure
- `services` → Deploy monitoring services
- `health` → Health checks
- `destroy` → Destroy all stacks
- `drift` → Drift detection

#### Stack-Specific Logic

When `stack: "destroy-all"` is selected:
- Enables `destroy-all` job
- Disables all deployment jobs
- Prevents accidental deployments during destruction

#### Usage Examples

```yaml
# Re-run failed jobs from a previous run
rerun_failed_from: "1234567890"

# Run specific jobs
jobs_to_run: "build,deploy-networking"

# Run all jobs (default)
jobs_to_run: "all"  # or leave empty

# Quick deployment without drift detection
jobs_to_run: "build,deploy-networking"
enable_drift_detection: false
```

#### Error Handling

The `determine-jobs` job includes comprehensive error handling:
- **Invalid Run ID**: Validates format and provides clear error messages
- **Run Not Found**: Falls back to running all jobs with helpful guidance
- **No Failed Jobs**: Handles case where all jobs succeeded
- **GitHub API Errors**: Graceful degradation with fallback behaviour

---

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

### CI/CD Workflow Integration

The CI and CD workflows work together to provide a complete pipeline:

```yaml
# CI Workflow (ci.yml) - Runs on every commit/PR
# Provides fast feedback on code quality
# Outputs: build cache key, test results, linting reports

# CD Workflow (deploy.yml) - Runs on merge to main
# Uses CI build cache when available
# Performs controlled deployments with validation
```

**Typical Flow**:
1. Developer pushes code → CI workflow runs
2. CI validates code quality, runs tests, builds infrastructure
3. Code is reviewed and merged to `main`
4. CD workflow runs automatically
5. CD uses CI build cache (if available) or rebuilds
6. CD validates AWS environment and deploys stacks
7. CD runs health checks and drift detection

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

### Workflow Best Practices

1. **Keep CI fast and frequent**: CI runs on every commit - optimise for speed
2. **Protect CD workflows**: Use environment protection for production deployments
3. **Use selective job execution**: Run only necessary jobs for faster iteration
4. **Leverage build cache**: CI builds artifacts that CD can reuse
5. **Re-run failed jobs**: Use `rerun_failed_from` to retry only failed jobs
6. **Enable drift detection**: Run drift detection after deployments to ensure compliance

### Action Best Practices

1. **Always use setup-infrastructure first**: Ensures consistent environment across all jobs
2. **Cache build artifacts**: Reduces deployment time by reusing compiled code
3. **Validate before deploy**: Use `validate-setup` job to verify AWS account and credentials
4. **Run drift detection post-deployment**: Ensures infrastructure matches code
5. **Use appropriate check modes**: `quick` for frequent checks, `full` for comprehensive analysis
6. **Set drift thresholds appropriately**: Allow tolerance for non-critical drift in non-production
7. **Handle errors gracefully**: All actions provide detailed troubleshooting guidance
8. **Use parallel execution manager**: Optimise pipeline duration for large workflows

---

## Workflow Architecture

### Separation of Concerns

The workflows are split to optimise for different requirements:

| Aspect | CI Workflow | CD Workflow |
|--------|-------------|-------------|
| **Frequency** | Every commit/PR | Merge to main or manual |
| **Speed** | Fast (< 5 min) | Comprehensive (15-30 min) |
| **Permissions** | Read-only | Deployment access |
| **Environment** | No protection | Protected (pipeline) |
| **Purpose** | Code quality feedback | Infrastructure deployment |
| **Jobs** | Security, lint, build, validate | Build, validate, deploy, health, drift |

### Workflow Dependencies

```
CI Workflow (ci.yml)
├── determine-jobs (CI)
├── security-scan
├── lint-and-quality
├── build → outputs cache-key
└── validate-setup (read-only)

CD Workflow (deploy.yml)
├── determine-jobs (CD)
├── build (uses CI cache if available)
├── validate-setup (with deployment permissions)
├── deploy-networking
├── deploy-monitoring-efs
├── deploy-vpc-peering
├── deploy-monitoring-infra
├── deploy-monitoring-services
├── health-checks
└── drift-detection-*
```

### Job Selection Logic

The `determine-jobs` job in both workflows supports:

1. **Automatic Selection**: Based on workflow trigger and inputs
2. **Selective Execution**: Specify exact jobs to run
3. **Failed Job Re-run**: Automatically detect and re-run failed jobs
4. **Dependency Resolution**: Auto-enables required dependencies

This provides flexibility for:
- Quick iterations (run specific jobs only)
- Debugging (re-run failed jobs)
- Full deployments (run all jobs)
- Selective updates (update single stack)

---

## Related Documentation

- [AWS CDK Documentation](https://docs.aws.amazon.com/cdk/)
- [GitHub Actions Composite Actions](https://docs.github.com/en/actions/creating-actions/creating-a-composite-action)
- [AWS CloudFormation Drift Detection](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-cfn-stack-drift.html)
- [Workflow Analysis](./WORKFLOW_ANALYSIS.md) - Detailed analysis of workflow structure
- [Split Workflows Summary](./SPLIT_WORKFLOWS_SUMMARY.md) - Migration guide for workflow split
