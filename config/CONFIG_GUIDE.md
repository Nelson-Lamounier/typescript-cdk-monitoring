# Configuration Module Guide

This guide provides a comprehensive reference for the `config/` directory, the centralised configuration layer for all CDK deployments. It covers environments, projects, tagging, security baselines, and validation.

## Table of Contents

1. [Directory Structure](#directory-structure)
2. [File Organisation](#file-organisation)
3. [Configuration Modules](#configuration-modules)
4. [Environments Configuration](#environments-configuration)
5. [Projects Configuration](#projects-configuration)
6. [Tagging Configuration](#tagging-configuration)
7. [Security Baseline](#security-baseline)
8. [Validation Module](#validation-module)
9. [ECS Applications](#ecs-applications)
10. [Integration with bin/ and lib/](#integration-with-bin-and-lib)
11. [Best Practices Checklist](#best-practices-checklist)

---

## Directory Structure

```
config/
├── environments.ts           # Environment definitions (dev, staging, prod)
├── projects.ts               # Project-specific configurations
├── tagging.ts                # Centralised tagging strategy
├── security-baseline.ts      # Security requirements per environment
├── validation.ts             # Pre-deployment validation
├── ecs-applications.ts       # ECS application configurations
└── grafana/                  # Service-specific configuration files
    └── dashboards/
        ├── application-overview.json
        ├── cloudwatch-overview.json
        ├── ecs-container-metrics.json
        ├── node-exporter-full.json
        ├── prometheus-stats.json
        └── security-compliance.json
```

### Relationship to Other Directories

```
config/                       # Centralised configuration
  ↓ consumed by
bin/app.ts                    # Entry point reads config
lib/stacks/                   # Stacks receive config via props
lib/constructs/               # Constructs receive config via props
lib/shared/                   # Helpers/utils may reference config
```

---

## File Organisation

### When to Create New Files

| Create | When |
|--------|------|
| New environment | Adding staging, DR, or regional deployment |
| New project | Adding a new application domain (api, analytics) |
| New config module | Adding a new cross-cutting concern (cost, compliance) |
| Service config | Adding service-specific files (dashboards, templates) |

### Naming Conventions

| Type | Pattern | Example |
|------|---------|---------|
| Core config | `{domain}.ts` | `environments.ts` |
| Service config | `{service}/{type}/` | `grafana/dashboards/` |
| Config files | `{descriptor}.json` | `node-exporter-full.json` |

---

## Configuration Modules

| Module | Purpose | Used By |
|--------|---------|---------|
| `environments.ts` | AWS account/region, VPC config, feature flags | `bin/app.ts`, all stacks |
| `projects.ts` | Project-specific compute, storage, networking | `bin/stacks/`, stack props |
| `tagging.ts` | Cost allocation, compliance, ownership tags | `bin/app.ts`, constructs |
| `security-baseline.ts` | Security requirements per environment | Validation, stacks |
| `validation.ts` | Pre-deployment checks | `bin/app.ts` |
| `ecs-applications.ts` | ECS service configurations | Service stacks |

---

## Environments Configuration

### File: `environments.ts`

Defines AWS account, region, and environment-specific settings.

### Interface

```typescript
export interface EnvironmentConfig {
  // AWS targeting (optional - auto-detect from credentials)
  account?: string;
  region?: string;
  
  // Identity
  envName: string;
  
  // Networking
  vpcCidr: string;
  natGateways?: number;
  
  // Environment type
  isProduction: boolean;
  
  // Cross-account
  pipelineAccount?: string;
  
  // Monitoring
  enableMonitoring?: boolean;
  enableEventBridge?: boolean;
  alertEmail?: string;
  isMonitoringAccount?: boolean;
  monitoredAccounts?: string[];
}
```

### Pattern

```typescript
/** @format */

export const environments: Record<string, EnvironmentConfig> = {
  development: {
    account: process.env.AWS_ACCOUNT_ID_DEV,
    region: process.env.AWS_REGION || "eu-west-1",
    vpcCidr: "10.1.0.0/16",
    natGateways: 0,
    isProduction: false,
    envName: "development",
    pipelineAccount: process.env.AWS_PIPELINE_ACCOUNT_ID,
    enableMonitoring: false,
    enableEventBridge: true,
  },

  staging: {
    account: process.env.AWS_ACCOUNT_ID_STAGING,
    region: process.env.AWS_REGION || "eu-west-1",
    vpcCidr: "10.2.0.0/16",
    natGateways: 0,
    isProduction: false,
    envName: "staging",
    pipelineAccount: process.env.AWS_PIPELINE_ACCOUNT_ID,
    enableMonitoring: false,
    enableEventBridge: true,
    alertEmail: process.env.ALERT_EMAIL,
  },

  production: {
    account: process.env.AWS_ACCOUNT_ID_PROD,
    region: process.env.AWS_REGION || "eu-west-1",
    vpcCidr: "10.3.0.0/16",
    natGateways: 1,
    isProduction: true,
    envName: "production",
    pipelineAccount: process.env.AWS_PIPELINE_ACCOUNT_ID,
    enableMonitoring: false,
    enableEventBridge: true,
    alertEmail: process.env.ALERT_EMAIL,
  },

  pipeline: {
    account: process.env.AWS_PIPELINE_ACCOUNT_ID,
    region: process.env.AWS_REGION || "eu-west-1",
    vpcCidr: "10.0.0.0/16",
    natGateways: 0,
    isProduction: false,
    envName: "pipeline",
    enableMonitoring: true,
    isMonitoringAccount: true,
    monitoredAccounts: [
      process.env.AWS_ACCOUNT_ID_DEV,
      process.env.AWS_ACCOUNT_ID_STAGING,
      process.env.AWS_ACCOUNT_ID_PROD,
    ].filter((id): id is string => typeof id === "string" && id.length > 0),
  },
};
```

### Key Patterns

1. **Environment variables for secrets**: Account IDs use `process.env`
2. **Unique VPC CIDRs**: Prevent conflicts for VPC peering
3. **isProduction flag**: Drives security/retention decisions
4. **Type-safe filtering**: `filter((id): id is string => ...)`

---

## Projects Configuration

### File: `projects.ts`

Defines project-specific compute, storage, and networking settings.

### Interfaces

```typescript
export enum ProjectType {
  MONITORING = "monitoring",
  WEBAPP = "webapp",
  API = "api",
  DATABASE = "database",
  ANALYTICS = "analytics",
}

export interface ProjectConfig {
  name: string;
  type: ProjectType;
  description?: string;
  networking?: ProjectNetworkingConfig;
  compute?: ProjectComputeConfig;
  storage?: ProjectStorageConfig;
  loadBalancer?: ProjectLoadBalancerConfig;
  environmentOverrides?: Record<string, Partial<ProjectConfig>>;
}

export interface ProjectComputeConfig {
  instanceType?: string;
  minCapacity?: number;
  maxCapacity?: number;
  desiredCapacity?: number;
  enableContainerInsights?: boolean;
  services?: Record<string, ServiceResourceConfig>;
  estimatedMonthlyCost?: CostEstimate;
}

export interface ServiceResourceConfig {
  memoryMiB?: number;
  cpu?: number;
}

export interface CostEstimate {
  development?: string;
  staging?: string;
  production?: string;
  notes?: string[];
}
```

### Pattern

```typescript
export const projects: Record<string, ProjectConfig> = {
  monitoring: {
    name: "monitoring",
    type: ProjectType.MONITORING,
    description: "Centralised monitoring infrastructure",
    networking: {
      maxAzs: 2,
      enableVpcFlowLogs: true,
      enableVpcEndpoints: true,
    },
    compute: {
      instanceType: "t3.small",
      minCapacity: 1,
      maxCapacity: 2,
      desiredCapacity: 1,
      enableContainerInsights: true,
      services: {
        prometheus: { memoryMiB: 1024, cpu: 512 },
        grafana: { memoryMiB: 512, cpu: 256 },
        nodeExporter: { memoryMiB: 128, cpu: 128 },
      },
      estimatedMonthlyCost: {
        development: "€17-22 (1 x t3.small, no NAT)",
        production: "€105-120 (2 x t3.medium, 1 NAT gateway)",
        notes: [
          "t3.small: ~€16.70/month per instance",
          "NAT Gateway: ~€38.10/month",
        ],
      },
    },
    environmentOverrides: {
      development: {
        compute: {
          services: {
            prometheus: { memoryMiB: 384, cpu: 256 },
            grafana: { memoryMiB: 384, cpu: 256 },
          },
        },
      },
      production: {
        compute: {
          instanceType: "t3.medium",
          minCapacity: 2,
          desiredCapacity: 2,
          maxCapacity: 4,
        },
        networking: {
          natGateways: 2,
        },
      },
    },
  },
};
```

### Helper Function

```typescript
/**
 * Get project configuration with environment-specific overrides applied
 */
export function getProjectConfig(
  projectName: string,
  environmentName: string
): ProjectConfig {
  const project = projects[projectName];
  
  if (!project) {
    throw new Error(`Invalid project: ${projectName}`);
  }

  // Apply environment-specific overrides
  const overrides = project.environmentOverrides?.[environmentName];
  if (overrides) {
    return {
      ...project,
      ...overrides,
      networking: { ...project.networking, ...overrides.networking },
      compute: { ...project.compute, ...overrides.compute },
      storage: { ...project.storage, ...overrides.storage },
      loadBalancer: { ...project.loadBalancer, ...overrides.loadBalancer },
    };
  }

  return project;
}
```

### Key Patterns

1. **Environment overrides**: Override defaults per environment
2. **Deep merge**: Merge nested objects (compute, networking)
3. **Cost estimates**: Include estimated costs for budget planning
4. **Service-level configuration**: Per-service memory/CPU

---

## Tagging Configuration

### File: `tagging.ts`

Defines standard tags for cost allocation, compliance, and organisation.

### Interface

```typescript
export interface TagConfig {
  Environment: string;
  ManagedBy: "CDK";
  Repository: string;
  Project?: string;
  CostCentre?: string;
  Owner?: string;
  Compliance?: string;
  DataClassification?: "public" | "internal" | "confidential" | "restricted";
  Application?: string;
  BackupPolicy?: string;
}
```

### Constants

```typescript
export const COST_CENTRES = {
  development: "DEV-001",
  staging: "STG-001",
  production: "PROD-001",
  pipeline: "PIPELINE-001",
} as const;

export const PROJECT_OWNERS = {
  monitoring: "Platform Team",
  webapp: "Application Team",
  api: "Backend Team",
} as const;

export const COMPLIANCE_REQUIREMENTS = {
  development: undefined,
  staging: "pre-compliance-testing",
  production: "SOC2,GDPR",
} as const;

export const DATA_CLASSIFICATION = {
  development: "internal" as const,
  staging: "internal" as const,
  production: "confidential" as const,
};
```

### Functions

```typescript
/**
 * Get default tags for environment and project
 */
export function getDefaultTags(
  envName: string,
  projectName?: string,
  customTags?: Partial<TagConfig>
): TagConfig;

/**
 * Get tags with resource-specific additions
 */
export function getResourceTags(
  envName: string,
  projectName: string,
  resourceType: string,
  customTags?: Partial<TagConfig>
): TagConfig;

/**
 * Convert TagConfig to CDK-compatible record
 */
export function toTagsRecord(tagConfig: TagConfig): Record<string, string>;

/**
 * Validate tag configuration
 */
export function validateTags(tags: TagConfig): {
  isValid: boolean;
  errors: string[];
};

/**
 * Get cost allocation tags only
 */
export function getCostAllocationTags(
  envName: string,
  projectName?: string
): Record<string, string>;
```

### Key Patterns

1. **`as const`**: Type-safe constants
2. **Production requirements**: More tags required in production
3. **Resource-specific tags**: BackupPolicy for storage resources
4. **Validation**: Check required tags are present

---

## Security Baseline

### File: `security-baseline.ts`

Defines security requirements per environment.

### Interfaces

```typescript
export interface SecurityBaseline {
  network: NetworkSecurityConfig;
  transport: TransportSecurityConfig;
  audit: AuditSecurityConfig;
  protection: ResourceProtectionConfig;
  encryption?: EncryptionConfig;
}

export interface NetworkSecurityConfig {
  allowedIpRanges: string[];
  usePrivateSubnets: boolean;
  natGateways: number;
  disablePublicIps: boolean;
}

export interface TransportSecurityConfig {
  enableHttps: boolean;
  certificateArn?: string;
  redirectHttpToHttps: boolean;
  minimumTlsVersion: "TLS_1_2" | "TLS_1_3";
}

export interface EncryptionConfig {
  ebsKmsKeyArn?: string;
  efsKmsKeyArn?: string;
  ecrKmsKeyArn?: string;
  s3KmsKeyArn?: string;
  dynamoDbKmsKeyArn?: string;
  logsKmsKeyArn?: string;
}
```

### Environment Baselines

```typescript
export const developmentSecurityBaseline: SecurityBaseline = {
  network: {
    allowedIpRanges: ["0.0.0.0/0"],
    usePrivateSubnets: false,
    natGateways: 0,
    disablePublicIps: false,
  },
  transport: {
    enableHttps: false,
    redirectHttpToHttps: false,
    minimumTlsVersion: "TLS_1_2",
  },
  audit: {
    enableAccessLogs: false,
    accessLogRetentionDays: 30,
    enableVpcFlowLogs: true,
    logRetention: logs.RetentionDays.ONE_WEEK,
  },
  protection: {
    enableDeletionProtection: false,
    efsRemovalPolicy: cdk.RemovalPolicy.DESTROY,
    enableSystemUpdates: false,
  },
};

export const productionSecurityBaseline: SecurityBaseline = {
  network: {
    allowedIpRanges: ["0.0.0.0/0"], // TODO: Replace with corporate IPs
    usePrivateSubnets: true,
    natGateways: 1,
    disablePublicIps: true,
  },
  transport: {
    enableHttps: true,
    redirectHttpToHttps: true,
    minimumTlsVersion: "TLS_1_2",
  },
  audit: {
    enableAccessLogs: true,
    accessLogRetentionDays: 90,
    enableVpcFlowLogs: true,
    logRetention: logs.RetentionDays.THREE_MONTHS,
  },
  protection: {
    enableDeletionProtection: true,
    efsRemovalPolicy: cdk.RemovalPolicy.RETAIN,
    enableSystemUpdates: true,
  },
  encryption: {
    ebsKmsKeyArn: process.env.PROD_EBS_KMS_KEY_ARN,
    efsKmsKeyArn: process.env.PROD_EFS_KMS_KEY_ARN,
  },
};
```

### Functions

```typescript
/**
 * Get security baseline for environment
 */
export function getSecurityBaseline(envName: string): SecurityBaseline;

/**
 * Get encryption configuration for environment
 */
export function getEncryptionConfig(envName: string): EncryptionConfig;

/**
 * Validate production security requirements
 */
export function validateProductionSecurity(
  envName: string,
  config: Partial<{
    allowedIpRanges: string[];
    enableHttps: boolean;
    certificateArn: string;
  }>
): void;
```

### Key Patterns

1. **Progressive security**: Development relaxed, production strict
2. **KMS key references**: Via environment variables
3. **Validation throws**: Block insecure production deployments
4. **Corporate IP placeholder**: Remind to configure before prod

---

## Validation Module

### File: `validation.ts`

Pre-deployment validation orchestration.

### Interface

```typescript
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}
```

### Validation Categories

| Category | Checks |
|----------|--------|
| Environment | VPC CIDR format, NAT gateway count |
| Project | Instance type, capacity settings, EBS volumes |
| Memory | Service memory vs instance capacity |
| Security | IP restrictions, HTTPS, deletion protection |
| Encryption | KMS key ARN formats |
| Tags | Required tags present |

### Functions

```typescript
/**
 * Validate complete configuration
 */
export function validateConfiguration(
  envName: string,
  projectName?: string
): ValidationResult;

/**
 * Validate all projects in environment
 */
export function validateAllProjects(
  envName: string,
  projectNames: string[]
): Map<string, ValidationResult>;

/**
 * Format validation result for console
 */
export function formatValidationResult(
  result: ValidationResult,
  context?: string
): string;
```

### Pattern

```typescript
export function validateConfiguration(
  envName: string,
  projectName?: string
): ValidationResult {
  const allErrors: string[] = [];
  const allWarnings: string[] = [];

  // Check environment exists
  const envConfig = environments[envName];
  if (!envConfig) {
    return {
      valid: false,
      errors: [`Environment '${envName}' not found`],
      warnings: [],
    };
  }

  // Build context
  const ctx: ValidationContext = {
    envName,
    projectName,
    envConfig,
    projectConfig: projectName ? getProjectConfig(projectName, envName) : undefined,
  };

  // Run all validators
  const validators = [
    validateEnvironmentConfig,
    validateProjectConfig,
    validateMemoryCapacity,
    validateSecurityBaseline,
    validateEncryptionConfig,
    validateTagConfiguration,
  ];

  validators.forEach((validator) => {
    const result = validator(ctx);
    allErrors.push(...result.errors);
    allWarnings.push(...result.warnings);
  });

  return {
    valid: allErrors.length === 0,
    errors: allErrors,
    warnings: allWarnings,
  };
}
```

### Key Patterns

1. **Errors vs warnings**: Errors block deployment, warnings inform
2. **Composable validators**: Each returns ValidationResult
3. **Context object**: Pass all needed data to validators
4. **Formatted output**: Console-friendly with emojis

---

## ECS Applications

### File: `ecs-applications.ts`

Pre-configured ECS application definitions.

### Pattern

```typescript
export function createMonitoringApplicationConfig(
  envName: string,
  crossAccountTargets?: CrossAccountTarget[]
): EcsApplicationConfig {
  return {
    applicationName: "monitoring",
    description: "Monitoring stack with Prometheus, Grafana, Node Exporter",
    services: [
      {
        name: "prometheus",
        container: {
          name: "prometheus",
          image: "prom/prometheus:latest",
          containerPort: 9090,
          hostPort: 9090,
          memoryReservationMiB: 512,
          memoryLimitMiB: 1024,
          command: [
            "--config.file=/etc/prometheus/prometheus.yml",
            "--storage.tsdb.path=/prometheus",
          ],
        },
        desiredCount: 1,
        volumes: [
          {
            name: "prometheus-data",
            hostPath: "/mnt/prometheus-data",
            containerPath: "/prometheus",
            readOnly: false,
          },
        ],
        loadBalancer: {
          path: "/prometheus/*",
          priority: 100,
          healthCheckPath: "/prometheus/-/healthy",
        },
        networkMode: ecs.NetworkMode.BRIDGE,
      },
      // ... more services
    ],
    ebsVolumes: [
      {
        deviceName: "/dev/xvdf",
        sizeGB: 100,
        mountPath: "/mnt/prometheus-data",
        volumeType: "gp3",
        deleteOnTermination: false,
      },
    ],
  };
}
```

### Key Patterns

1. **Factory functions**: Create configs dynamically
2. **Environment-aware**: Adjust settings per environment
3. **Complete service definition**: Container, volumes, load balancer
4. **Reusable template**: Generic `createApplicationConfig` helper

---

## Integration with bin/ and lib/

### In bin/app.ts

```typescript
import { environments } from "../config/environments";
import { getDefaultTags, toTagsRecord } from "../config/tagging";
import {
  validateConfiguration,
  validateAllProjects,
  formatValidationResult,
} from "../config/validation";

const app = new cdk.App();

// Get environment
const envName = app.node.tryGetContext("environment") || "development";
const envConfig = environments[envName];

// Validate before synthesis
const validation = validateConfiguration(envName);
console.log(formatValidationResult(validation, `Environment: ${envName}`));

if (!validation.valid) {
  throw new Error("Configuration validation failed");
}

// Apply tags
const appTags = getDefaultTags(envName);
const tagsRecord = toTagsRecord(appTags);

Object.entries(tagsRecord).forEach(([key, value]) => {
  cdk.Tags.of(app).add(key, value);
});
```

### In bin/stacks/{project}-stack.ts

```typescript
import { EnvironmentConfig } from "../../config/environments";
import { getProjectConfig } from "../../config/projects";

export function createMonitoringStacks(
  app: cdk.App,
  envName: string,
  envConfig: EnvironmentConfig,
  ...
) {
  const projectConfig = getProjectConfig("monitoring", envName);

  const infraStack = new MonitoringInfraStack(app, `${envName}-MonitoringInfra`, {
    minCapacity: projectConfig.compute?.minCapacity || 1,
    maxCapacity: projectConfig.compute?.maxCapacity || 2,
    enableContainerInsights: projectConfig.compute?.enableContainerInsights,
  });
}
```

### In lib/stacks/

```typescript
import { getSecurityBaseline } from "../../config/security-baseline";

export class MyStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: MyStackProps) {
    super(scope, id, props);

    const security = getSecurityBaseline(props.envName);

    const alb = new elbv2.ApplicationLoadBalancer(this, "ALB", {
      deletionProtection: security.protection.enableDeletionProtection,
    });
  }
}
```

---

## Best Practices Checklist

### Environments

- [ ] Use `process.env` for account IDs
- [ ] Unique VPC CIDRs per environment
- [ ] Set `isProduction: true` only for production
- [ ] Configure `pipelineAccount` for cross-account
- [ ] Type-safe filtering for optional arrays

### Projects

- [ ] Define all projects in `projects` record
- [ ] Include cost estimates with notes
- [ ] Use `environmentOverrides` for env-specific values
- [ ] Deep merge nested objects in `getProjectConfig`

### Tagging

- [ ] Use `as const` for constant objects
- [ ] Stricter requirements for production
- [ ] Include CostCentre, Owner for all environments
- [ ] Validate tags before deployment

### Security Baseline

- [ ] Separate baselines per environment
- [ ] HTTPS required in production
- [ ] Deletion protection in production
- [ ] Replace `0.0.0.0/0` with corporate IPs before prod
- [ ] Customer-managed KMS keys for production

### Validation

- [ ] Run validation in `bin/app.ts` before synthesis
- [ ] Check all projects with `validateAllProjects`
- [ ] Fail fast on errors, warn on warnings
- [ ] Format output for clear console display

### Service Configuration

- [ ] Use grafana/dashboards for JSON configs
- [ ] Create factory functions for ECS apps
- [ ] Include volume and load balancer config
- [ ] Support environment-aware settings

---

## Quick Reference

### File Purposes

| File | Purpose |
|------|---------|
| `environments.ts` | AWS account/region configuration |
| `projects.ts` | Project-specific settings |
| `tagging.ts` | Cost allocation and compliance tags |
| `security-baseline.ts` | Security requirements |
| `validation.ts` | Pre-deployment validation |
| `ecs-applications.ts` | ECS service configurations |

### Common Functions

| Function | Returns | Purpose |
|----------|---------|---------|
| `getProjectConfig(project, env)` | `ProjectConfig` | Project config with overrides |
| `getDefaultTags(env, project)` | `TagConfig` | Standard tags |
| `getSecurityBaseline(env)` | `SecurityBaseline` | Security config |
| `validateConfiguration(env, project)` | `ValidationResult` | Validation result |
| `toTagsRecord(tagConfig)` | `Record<string, string>` | CDK-compatible tags |

### Adding a New Environment

1. Add to `environments.ts`:
```typescript
newenv: {
  account: process.env.AWS_ACCOUNT_ID_NEWENV,
  region: "eu-west-1",
  vpcCidr: "10.4.0.0/16",
  natGateways: 0,
  isProduction: false,
  envName: "newenv",
},
```

2. Add to `COST_CENTRES`, `COMPLIANCE_REQUIREMENTS`, `DATA_CLASSIFICATION` in `tagging.ts`

3. Add to security baseline if needed in `security-baseline.ts`

### Adding a New Project

1. Add to `projects.ts`:
```typescript
newproject: {
  name: "newproject",
  type: ProjectType.API,
  description: "My new project",
  compute: { ... },
  storage: { ... },
  environmentOverrides: { ... },
},
```

2. Add to `PROJECT_OWNERS` in `tagging.ts`

3. Add validation rules if needed in `validation.ts`
