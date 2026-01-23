# Scripts Development Guide

This guide provides a comprehensive reference for creating and maintaining scripts in this repository. Scripts automate verification, deployment, troubleshooting, and operational tasks.

## Table of Contents

1. [Directory Structure](#directory-structure)
2. [Script Categories](#script-categories)
3. [TypeScript Verification Scripts](#typescript-verification-scripts)
4. [Shell Scripts](#shell-scripts)
5. [Shared Utilities](#shared-utilities)
6. [CLI Patterns](#cli-patterns)
7. [Testing Scripts](#testing-scripts)
8. [Best Practices Checklist](#best-practices-checklist)

---

## Directory Structure

```
scripts/
├── generate-suppressions-report.ts    # CDK Nag suppressions report
├── update-pricing.ts                  # AWS pricing updates
├── integration/                       # Integration and verification scripts
│   └── deployment/
│       ├── __tests__/                 # Script unit tests
│       │   ├── environment-checker.test.ts
│       │   └── validate-environment.test.ts
│       ├── deploy-stack.ts            # Deployment orchestration
│       ├── local-integration-test.ts  # Local testing
│       ├── validate-environment.ts    # Pre-deployment checks
│       ├── verify-bootstrap.ts        # CDK bootstrap verification
│       ├── verify-environment.ts      # Environment validation
│       ├── monitoring/                # Stack-specific verification
│       │   ├── README.md
│       │   ├── verify-datasource-connectivity.ts
│       │   ├── verify-efs-mount.ts
│       │   ├── verify-efs-stack.ts
│       │   ├── verify-health-checks.ts
│       │   ├── verify-infra-stack.ts
│       │   ├── verify-networking-stack.ts
│       │   ├── verify-prometheus-health.ts
│       │   └── verify-s3-creation.ts
│       ├── webapp/                    # WebApp stack verification
│       │   ├── verify-api-stack.ts
│       │   ├── verify-dynamodb-stack.ts
│       │   └── verify-ecr-stack.ts
│       ├── shared/                    # Shared script utilities
│       │   ├── aws-client-factory.ts
│       │   ├── aws-utilities.ts
│       │   ├── cli-base.ts
│       │   ├── formatters.ts
│       │   └── verification-framework.ts
│       ├── utils/                     # Common utilities
│       │   ├── aws-helpers.ts
│       │   ├── environment-checker.ts
│       │   ├── error-messages.ts
│       │   ├── logger.ts
│       │   └── types.ts
│       └── docs-integration-scripts/  # Script documentation
├── helper/                            # Quick helper scripts (bash)
│   ├── check-alb-instance-connectivity.sh
│   ├── check-alb-listener.sh
│   ├── check-sg-rules.sh
│   ├── debug-alb-health-check.sh
│   ├── fix-prometheus-health-check.sh
│   ├── infrastucture-audit.sh
│   ├── monitor-health-status.sh
│   ├── reset-grafana-password.sh
│   ├── sync-dashboards.sh
│   ├── test-alb-from-vpc.sh
│   ├── test-prometheus-health.sh
│   ├── troubleshoot-prometheus-connectivity.sh
│   ├── verify-efs-stack.sh
│   ├── verify-infra-stack.sh
│   └── README-PROFILE-UPDATE.md
└── repo/                              # Repository setup scripts
    └── setup-github-secrets.sh
```

---

## Script Categories

| Category | Location | Language | Purpose |
|----------|----------|----------|---------|
| **Verification** | `integration/deployment/{stack}/` | TypeScript | Validate stack deployments |
| **Helper** | `helper/` | Bash | Quick operational tasks |
| **Repo** | `repo/` | Bash | Repository setup |
| **Shared** | `integration/deployment/shared/` | TypeScript | Reusable script utilities |
| **Utils** | `integration/deployment/utils/` | TypeScript | Common functions |

### When to Use Each

```
TypeScript verification scripts → CI/CD pipelines, complex validation
Shell helper scripts           → Quick debugging, manual operations  
Shared utilities               → Common AWS operations across scripts
```

---

## TypeScript Verification Scripts

### File Anatomy

```typescript
#!/usr/bin/env node
/** @format */

// =============================================================================
// FILE HEADER
// =============================================================================
// scripts/integration/deployment/{category}/verify-{stack}-stack.ts

// =============================================================================
// IMPORTS
// =============================================================================
import * as fs from "fs";
import * as path from "path";

import { program } from "commander";
import { EC2Client } from "@aws-sdk/client-ec2";

import { Logger } from "../utils/logger";
import { AwsClientFactory, BaseAwsClients } from "../shared/aws-client-factory";
import { CloudFormationUtility, EC2Utility } from "../shared/aws-utilities";
import {
  VerificationRunner,
  CheckBuilder,
} from "../shared/verification-framework";
import { TableFormatter } from "../shared/formatters";

// =============================================================================
// INTERFACES
// =============================================================================
interface StackClients extends BaseAwsClients {
  cfn: any;
  ec2: EC2Client;
}

interface VerifyStackConfig {
  profile?: string;
  region: string;
  environment: string;
  outputsFile?: string;
  verbose?: boolean;
  reportFile?: string;
}

interface StackOutputs {
  resourceId?: string;
  // ... other outputs
}

interface StackContext {
  config: VerifyStackConfig;
  clients: StackClients;
  stackName: string;
  outputs: StackOutputs;
}

// =============================================================================
// CONSTANTS
// =============================================================================
const VALID_ENVIRONMENTS = ["development", "staging", "production", "pipeline"];

// =============================================================================
// MAIN FUNCTION
// =============================================================================
async function verifyStack(config: VerifyStackConfig): Promise<void> {
  if (config.verbose) {
    Logger.section("Verifying Stack");
  }

  const stackName = `${config.environment}-StackName`;
  
  if (config.verbose) {
    printConfiguration(config, stackName);
  }

  // Create AWS clients
  const clients = await AwsClientFactory.createCommonClients(
    {
      ...config,
      sessionName: `verify-stack-${Date.now()}`,
    },
    ["cfn", "ec2"]
  ) as StackClients;

  // Setup verification runner
  const runner = new VerificationRunner();
  const context: Partial<StackContext> = {
    config,
    clients,
    stackName,
    outputs: {},
  };

  // Add verification checks
  setupVerificationChecks(runner, context as StackContext);

  // Set metadata
  runner.setMetadata({
    stackName,
    environment: config.environment,
    region: config.region,
    timestamp: new Date().toISOString(),
    accountId: clients.accountId || "unknown",
  });

  // Run verifications
  const summary = await runner.run();

  if (config.verbose) {
    runner.printSummary();
  }

  // Write report
  await writeVerificationReport(config, summary, context.outputs!);

  // Exit with appropriate code
  const allPassed = runner.allChecksPassed();
  
  console.log("");
  if (allPassed) {
    Logger.success("STACK VERIFICATION PASSED");
    process.exit(0);
  } else {
    Logger.error("STACK VERIFICATION FAILED");
    process.exit(1);
  }
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================
function printConfiguration(
  config: VerifyStackConfig,
  stackName: string
): void {
  Logger.subsection("Configuration");
  Logger.keyValue("Stack Name", stackName);
  Logger.keyValue("Environment", config.environment);
  Logger.keyValue("Region", config.region);
  console.log("");
}

function setupVerificationChecks(
  runner: VerificationRunner,
  context: StackContext
): void {
  // Add checks using CheckBuilder
  runner.addCheck(
    CheckBuilder.create("CloudFormation Stack Status")
      .category("infrastructure")
      .critical(true)
      .execute(async () => {
        // Check implementation
        return {
          passed: true,
          message: "Stack is deployed",
        };
      })
  );

  // Add more checks...
}

async function writeVerificationReport(
  config: VerifyStackConfig,
  summary: any,
  outputs: StackOutputs
): Promise<void> {
  if (!config.reportFile) return;

  const reportDir = path.dirname(config.reportFile);
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true });
  }

  const report = {
    ...summary.metadata,
    success: summary.checksPassed === summary.totalChecks,
    outputs,
    generatedBy: "verify-stack.ts",
  };

  fs.writeFileSync(
    config.reportFile,
    JSON.stringify(report, null, 2),
    "utf8"
  );
}

// =============================================================================
// CLI CONFIGURATION
// =============================================================================
program
  .requiredOption("-e, --environment <env>", "Environment name")
  .requiredOption("-r, --aws-region <region>", "AWS region")
  .option("-p, --profile <profile>", "AWS profile")
  .option("-o, --outputs-file <path>", "Path to CDK stack outputs file")
  .option("--report-file <path>", "Path to write verification report")
  .option("-v, --verbose", "Enable verbose output")
  .parse();

const options = program.opts();

// Validate environment
if (!VALID_ENVIRONMENTS.includes(options.environment)) {
  Logger.error(`Invalid environment: ${options.environment}`);
  Logger.info(`Valid environments: ${VALID_ENVIRONMENTS.join(", ")}`);
  process.exit(1);
}

// Build config and run
const config: VerifyStackConfig = {
  environment: options.environment,
  region: options.awsRegion,
  profile: options.profile,
  outputsFile: options.outputsFile,
  verbose: options.verbose ?? false,
  reportFile: options.reportFile,
};

verifyStack(config).catch((error: any) => {
  Logger.error(`Verification failed: ${error.message}`);
  process.exit(1);
});
```

### Verification Framework

The `VerificationRunner` provides structured verification:

```typescript
import {
  VerificationRunner,
  CheckBuilder,
  CheckResult,
} from "../shared/verification-framework";

// Create runner
const runner = new VerificationRunner();

// Add checks using fluent builder
runner.addCheck(
  CheckBuilder.create("Check Name")
    .category("networking")      // Category for grouping
    .critical(true)              // Stop on failure
    .optional(false)             // Count in pass/fail
    .execute(async (): Promise<CheckResult> => {
      // Perform check
      const result = await someAsyncCheck();
      
      return {
        passed: result.success,
        message: result.success ? "Check passed" : "Check failed",
        details: {
          key: "value",           // Additional details
        },
      };
    })
);

// Run all checks
const summary = await runner.run();

// Print summary
runner.printSummary();

// Check results
if (runner.allChecksPassed()) {
  process.exit(0);
} else {
  process.exit(1);
}
```

---

## Shell Scripts

### File Anatomy

```bash
#!/bin/bash
set -euo pipefail

# ============================================================================
# SCRIPT NAME - Brief Description
# ============================================================================
# Longer description of what this script does.
#
# Architecture:
#   - Describe the architecture or flow
#
# Usage:
#   ./scripts/helper/script-name.sh [OPTIONS]
#
# Options:
#   -e, --environment ENV     Environment name (default: development)
#   -p, --profile PROFILE     AWS CLI profile (default: dev-account)
#   -r, --region REGION       AWS region (default: eu-west-1)
#   -h, --help                Show this help message
#
# Environment Variables:
#   ENVIRONMENT               Override environment
#   AWS_PROFILE               Override AWS profile
#   AWS_REGION                Override AWS region
#
# Examples:
#   # Basic usage
#   ./scripts/helper/script-name.sh
#
#   # With options
#   ./scripts/helper/script-name.sh -e production -p prod-account
# ============================================================================

# ============================================================================
# Configuration & Defaults
# ============================================================================
ENVIRONMENT="${ENVIRONMENT:-development}"
AWS_PROFILE="${AWS_PROFILE:-dev-account}"
REGION="${AWS_REGION:-eu-west-1}"

# ============================================================================
# Argument Parsing
# ============================================================================
show_help() {
  cat << EOF
Script Name - Brief Description

Usage:
  $0 [OPTIONS]

Options:
  -e, --environment ENV     Environment name (default: development)
  -p, --profile PROFILE     AWS CLI profile (default: dev-account)
  -r, --region REGION       AWS region (default: eu-west-1)
  -h, --help                Show this help message

EOF
}

while [[ $# -gt 0 ]]; do
  case $1 in
    -e|--environment)
      ENVIRONMENT="$2"
      shift 2
      ;;
    -p|--profile)
      AWS_PROFILE="$2"
      shift 2
      ;;
    -r|--region)
      REGION="$2"
      shift 2
      ;;
    -h|--help)
      show_help
      exit 0
      ;;
    *)
      echo "Error: Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

# ============================================================================
# Validation
# ============================================================================
VALID_ENVIRONMENTS=("development" "staging" "production" "pipeline")
if [[ ! " ${VALID_ENVIRONMENTS[@]} " =~ " ${ENVIRONMENT} " ]]; then
  echo "Error: Invalid environment '${ENVIRONMENT}'" >&2
  echo "Valid environments: ${VALID_ENVIRONMENTS[*]}" >&2
  exit 1
fi

# Check dependencies
if ! command -v aws &> /dev/null; then
  echo "Error: AWS CLI is not installed" >&2
  exit 1
fi

if ! command -v jq &> /dev/null; then
  echo "Error: jq is not installed" >&2
  exit 1
fi

# Verify AWS credentials
if ! aws sts get-caller-identity --profile "${AWS_PROFILE}" --region "${REGION}" &>/dev/null; then
  echo "Error: Failed to authenticate with AWS" >&2
  exit 1
fi

# ============================================================================
# Derived Configuration
# ============================================================================
STACK_NAME="${ENVIRONMENT}-StackName"

# ============================================================================
# Header
# ============================================================================
# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo "================================================================"
echo "Script Name - ${ENVIRONMENT}"
echo "================================================================"
echo "Profile: ${AWS_PROFILE}"
echo "Region: ${REGION}"
echo "Stack Name: ${STACK_NAME}"
echo "Timestamp: $(date -u +"%Y-%m-%d %H:%M:%S UTC")"
echo ""

# ============================================================================
# 1. FIRST CHECK
# ============================================================================
echo -e "${BLUE}1. First Check${NC}"
echo "--------------------------------------------------------------"

# Check implementation
RESULT=$(aws some-command --profile ${AWS_PROFILE} --region ${REGION} 2>/dev/null || echo "ERROR")

if [ "$RESULT" = "EXPECTED" ]; then
  echo -e "${GREEN}✅ Check passed${NC}"
else
  echo -e "${RED}❌ Check failed${NC}"
fi

# ============================================================================
# 2. SECOND CHECK
# ============================================================================
echo ""
echo -e "${BLUE}2. Second Check${NC}"
echo "--------------------------------------------------------------"

# More checks...

# ============================================================================
# SUMMARY
# ============================================================================
echo ""
echo "================================================================"
echo -e "${BLUE}VERIFICATION SUMMARY${NC}"
echo "================================================================"

CHECKS_PASSED=0
TOTAL_CHECKS=2

# Count passed checks
# ...

echo "Checks Passed: ${CHECKS_PASSED}/${TOTAL_CHECKS}"
echo ""

if [ $CHECKS_PASSED -eq $TOTAL_CHECKS ]; then
  echo -e "${GREEN}✅ All checks passed!${NC}"
  exit 0
else
  echo -e "${YELLOW}⚠️  Some checks failed. Review output above.${NC}"
  exit 1
fi
```

---

## Shared Utilities

### Logger (`utils/logger.ts`)

Consistent console output with colours:

```typescript
import { Logger } from "../utils/logger";

// Info messages
Logger.info("Informational message");

// Success/failure
Logger.success("Operation completed");
Logger.error("Operation failed");
Logger.warning("Warning message");

// Sections
Logger.section("MAIN SECTION");        // Bold cyan with dividers
Logger.subsection("Sub Section");      // Bold with underline

// Key-value pairs
Logger.keyValue("Key", "Value");
Logger.keyValue("Secret", "***", true); // Masked

// Code/commands
Logger.code("aws ecs describe-clusters");
```

### AWS Client Factory (`shared/aws-client-factory.ts`)

Create AWS SDK clients with consistent configuration:

```typescript
import { AwsClientFactory, BaseAwsClients } from "../shared/aws-client-factory";

interface MyClients extends BaseAwsClients {
  cfn: CloudFormationClient;
  ec2: EC2Client;
  ecs: ECSClient;
}

const clients = await AwsClientFactory.createCommonClients(
  {
    profile: "dev-account",
    region: "eu-west-1",
    sessionName: `my-script-${Date.now()}`,
  },
  ["cfn", "ec2", "ecs"]
) as MyClients;

// Access clients
const { cfn, ec2, ecs, accountId } = clients;
```

### AWS Utilities (`shared/aws-utilities.ts`)

Common AWS operations:

```typescript
import {
  CloudFormationUtility,
  EC2Utility,
  ECSUtility,
} from "../shared/aws-utilities";

// CloudFormation
const stackInfo = await CloudFormationUtility.getStackStatus(cfnClient, "stack-name");
const outputs = await CloudFormationUtility.getStackOutputs(cfnClient, "stack-name");

// EC2
const vpcExists = await EC2Utility.verifyVpc(ec2Client, "vpc-id");
const subnetResult = await EC2Utility.verifySubnets(ec2Client, ["subnet-1", "subnet-2"]);

// ECS
const clusterInfo = await ECSUtility.getClusterInfo(ecsClient, "cluster-name");
```

### Table Formatter (`shared/formatters.ts`)

Format data for console output:

```typescript
import { TableFormatter } from "../shared/formatters";

// Stack outputs table
TableFormatter.formatStackOutputs({
  VpcId: "vpc-123",
  SubnetId: "subnet-456",
});

// Generic table
TableFormatter.formatTable(
  ["Name", "Status", "ID"],
  [
    ["Cluster", "ACTIVE", "arn:aws:ecs:..."],
    ["Service", "RUNNING", "arn:aws:ecs:..."],
  ]
);
```

### Environment Checker (`utils/environment-checker.ts`)

Validate development environment:

```typescript
import { EnvironmentChecker } from "../utils/environment-checker";

// Individual checks
const nodeCheck = EnvironmentChecker.checkNodeJs();
const yarnCheck = EnvironmentChecker.checkYarn();
const awsCheck = EnvironmentChecker.checkAwsCli();
const cdkCheck = EnvironmentChecker.checkCdk();

// All checks at once
const checks = EnvironmentChecker.runAllChecks();

// Check build artifacts
const artifacts = EnvironmentChecker.checkBuildArtifacts("./dist");
```

---

## CLI Patterns

### Standard Options

All scripts should support these standard options:

```typescript
program
  // Required
  .requiredOption("-e, --environment <env>", "Environment name")
  .requiredOption("-r, --aws-region <region>", "AWS region")
  
  // Common optional
  .option("-p, --profile <profile>", "AWS profile")
  .option("-v, --verbose", "Enable verbose output")
  
  // Script-specific
  .option("-o, --outputs-file <path>", "CDK stack outputs file")
  .option("--report-file <path>", "Verification report path")
  .parse();
```

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success - all checks passed |
| 1 | Failure - one or more checks failed |
| 2 | Invalid arguments |

### Verbose Mode

Scripts should support verbose (`-v`) and quiet modes:

```typescript
if (config.verbose) {
  Logger.section("Detailed Section");
  Logger.keyValue("Detail", "Value");
}

// Always show final result
Logger.success("VERIFICATION PASSED");
```

---

## Testing Scripts

Scripts should have corresponding tests in `__tests__/`:

```typescript
// __tests__/environment-checker.test.ts
import { EnvironmentChecker } from "../utils/environment-checker";

describe("EnvironmentChecker", () => {
  describe("checkNodeJs", () => {
    it("should return available true when Node.js is installed", () => {
      const result = EnvironmentChecker.checkNodeJs();
      expect(result.available).toBe(true);
      expect(result.version).toMatch(/^v\d+\.\d+\.\d+$/);
    });
  });

  describe("checkBuildArtifacts", () => {
    it("should return exists false when dist directory is empty", () => {
      const result = EnvironmentChecker.checkBuildArtifacts("./nonexistent");
      expect(result.exists).toBe(false);
      expect(result.fileCount).toBe(0);
    });
  });
});
```

---

## Best Practices Checklist

### Before Creating a Script

- [ ] Determine script category (verification/helper/repo)
- [ ] Choose language (TypeScript for complex, Bash for quick)
- [ ] Check if similar functionality exists
- [ ] Plan CLI options and environment variables

### TypeScript Script Development

- [ ] Add shebang `#!/usr/bin/env node`
- [ ] Add file header with format pragma
- [ ] Use Commander for CLI parsing
- [ ] Use shared utilities (Logger, AwsClientFactory)
- [ ] Use VerificationRunner for structured checks
- [ ] Support verbose mode
- [ ] Write verification report to file
- [ ] Exit with appropriate code (0/1/2)
- [ ] Add unit tests in `__tests__/`

### Shell Script Development

- [ ] Add shebang `#!/bin/bash`
- [ ] Use `set -euo pipefail`
- [ ] Add comprehensive header documentation
- [ ] Support standard options (-e, -p, -r, -h)
- [ ] Support environment variables
- [ ] Validate inputs early
- [ ] Check dependencies (aws, jq)
- [ ] Use colour-coded output
- [ ] Number verification sections
- [ ] Print summary at end

### Documentation

- [ ] Add usage examples in header
- [ ] Document all options
- [ ] Add troubleshooting section
- [ ] Include CI/CD integration example
- [ ] Update category README.md

### CI/CD Integration

- [ ] Script can run without interactive input
- [ ] Supports environment variables for credentials
- [ ] Exits with appropriate code
- [ ] Writes machine-readable report (JSON)

---

## Quick Reference

### File Locations

| Script Type | Location | Extension |
|-------------|----------|-----------|
| Stack verification | `integration/deployment/{category}/` | `.ts` |
| Helper/debugging | `helper/` | `.sh` |
| Repository setup | `repo/` | `.sh` |
| Shared utilities | `integration/deployment/shared/` | `.ts` |

### Naming Conventions

| Type | Pattern | Example |
|------|---------|---------|
| Verification | `verify-{stack}-stack.ts` | `verify-networking-stack.ts` |
| Helper | `{action}-{resource}.sh` | `check-alb-listener.sh` |
| Utility | `{domain}-{type}.ts` | `aws-helpers.ts` |

### Running Scripts

```bash
# TypeScript scripts
npx ts-node scripts/integration/deployment/monitoring/verify-networking-stack.ts \
  -e development -r eu-west-1 -p dev-account -v

# Or compiled
node dist/scripts/integration/deployment/monitoring/verify-networking-stack.js \
  -e development -r eu-west-1 -p dev-account

# Shell scripts
./scripts/helper/verify-efs-stack.sh -e development -p dev-account

# With environment variables
ENVIRONMENT=production AWS_PROFILE=prod-account ./scripts/helper/verify-efs-stack.sh
```
