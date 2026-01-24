<!-- @format -->

# Prometheus Configuration: JSON to YAML Conversion

## Overview

This document explains the Prometheus configuration architecture, including what's stored in the configuration files, why we maintain both JSON and YAML formats, and how the conversion process works.

---

## What's in the Prometheus Config JSON File?

The `prometheus-config` JSON file contains the **complete Prometheus server configuration** with three main sections:

### 1. Global Settings (`global`)

```json
{
  "scrape_interval": "15s", // How often to scrape metrics from targets
  "evaluation_interval": "15s", // How often to evaluate alerting rules
  "external_labels": {
    // Labels added to all metrics
    "environment": "development",
    "cluster": "development-monitoring"
  }
}
```

**Purpose**: Defines default behaviour for all scrape jobs and adds cluster-wide labels to all metrics.

### 2. Rule Files (`rule_files`)

```json
["/etc/prometheus/alerts.yml"] // Alerting rules location
```

**Purpose**: Specifies where Prometheus should look for alerting and recording rules.

### 3. Scrape Configurations (`scrape_configs`)

This is the most important part - it defines **what metrics to collect and from where**:

#### a) Prometheus Self-Monitoring

```json
{
  "job_name": "prometheus",
  "static_configs": [{ "targets": ["localhost:9090"] }],
  "metrics_path": "/prometheus/metrics"
}
```

**Purpose**: Monitors Prometheus itself - memory usage, scrape duration, rule evaluation time, etc.

#### b) Node Exporter (Local)

```json
{
  "job_name": "node-exporter",
  "static_configs": [{ "targets": ["localhost:9100"] }]
}
```

**Purpose**: Collects system metrics (CPU, memory, disk, network) from the local EC2 instance running Prometheus.

#### c) EC2 Service Discovery (Pipeline)

```json
{
  "job_name": "node-exporter-pipeline",
  "ec2_sd_configs": [
    {
      "region": "eu-west-1",
      "port": 9100,
      "filters": [
        { "name": "tag:Environment", "values": ["development"] },
        { "name": "tag:Service", "values": ["NodeExporter", "monitoring"] },
        { "name": "instance-state-name", "values": ["running"] }
      ]
    }
  ],
  "relabel_configs": [
    {
      "source_labels": ["__meta_ec2_private_ip"],
      "target_label": "__address__",
      "replacement": "${1}:9100"
    },
    {
      "source_labels": ["__meta_ec2_tag_Environment"],
      "target_label": "environment"
    }
    // ... more relabel configs
  ]
}
```

**Purpose**: **Automatically discovers** EC2 instances in your account based on tags and dynamically adds/removes scrape targets as instances are created or terminated.

**Benefits**:

- No manual target management
- Auto-scaling friendly
- Automatic cleanup when instances terminate
- Rich metadata from EC2 tags becomes metric labels

#### d) Cross-Account Targets (Optional)

If configured via `crossAccountTargets` prop, Prometheus can scrape metrics from EC2 instances in **other AWS accounts** using IAM role assumption.

```json
{
  "job_name": "node-exporter-production",
  "ec2_sd_configs": [
    {
      "region": "eu-west-1",
      "role_arn": "arn:aws:iam::123456789012:role/PrometheusMonitoringRole",
      "port": 9100,
      "filters": [
        { "name": "tag:Environment", "values": ["production"] },
        { "name": "instance-state-name", "values": ["running"] }
      ]
    }
  ]
}
```

---

## Why Convert JSON to YAML?

### The Problem

**Prometheus only accepts YAML configuration files**, not JSON.

When the Prometheus container starts, it reads `/etc/prometheus/prometheus.yml` (YAML format). The official Prometheus configuration file format is YAML:

```yaml
global:
  scrape_interval: 15s
  evaluation_interval: 15s
  external_labels:
    environment: development
    cluster: development-monitoring

scrape_configs:
  - job_name: prometheus
    static_configs:
      - targets: ["localhost:9090"]
    metrics_path: /prometheus/metrics
```

If you try to provide JSON, Prometheus will fail to start with a parsing error.

### Why We Store Both Formats

We maintain both JSON and YAML versions of the configuration in SSM Parameter Store:

| Format                                                | Purpose                                    | Used By                                                                                                                              |
| ----------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| **JSON** (`/monitoring/{env}/prometheus-config`)      | Easy to work with in TypeScript/JavaScript | - CDK code for building config<br>- Testing and validation<br>- API integrations<br>- Future automation tools                        |
| **YAML** (`/monitoring/{env}/prometheus-config-yaml`) | Required by Prometheus                     | - ECS containers at runtime<br>- SSM documents for file generation<br>- Direct file mounting on EFS<br>- Manual inspection/debugging |

### Benefits of This Approach

1. **Type Safety**: Building config in TypeScript gives compile-time checking and auto-completion
2. **Testability**: JSON is easy to parse, validate, and test in TypeScript/JavaScript
3. **Runtime Requirements**: Prometheus needs YAML, we provide YAML
4. **Single Source of Truth**: Both formats generated during CDK deployment (not at runtime)
5. **No Runtime Dependencies**: No need for YAML parsers in Lambda functions or containers
6. **Version Control**: Both formats tracked in SSM, easy to compare and audit
7. **Flexibility**: Different tools can use the format that works best for them

---

## The Conversion Flow

```
┌─────────────────────────────────────────────────────────────┐
│  CDK Stack (TypeScript)                                     │
│  lib/shared/helpers/prometheus-config-builder.ts            │
│  ─────────────────────────────────────────────              │
│  1. buildPrometheusConfig() builds JavaScript object        │
│     - Adds global settings                                  │
│     - Adds scrape jobs (local + EC2 discovery)              │
│     - Adds cross-account targets if configured              │
│                                                             │
│  2. JSON.stringify() → JSON format                          │
│  3. convertToYaml() → YAML format                           │
│     (lib/shared/utils/yaml-converter.ts)                    │
│                                                             │
│  4. Store both in SSM Parameter Store                       │
└─────────────────────────────────────────────────────────────┘
                           │
                           ↓
┌─────────────────────────────────────────────────────────────┐
│  SSM Parameter Store                                        │
│  ────────────────────                                       │
│  • /monitoring/{env}/prometheus-config (JSON)               │
│  • /monitoring/{env}/prometheus-config-yaml (YAML) ✓        │
│                                                             │
│  Both parameters created during CDK deployment              │
└─────────────────────────────────────────────────────────────┘
                           │
                           ↓
┌─────────────────────────────────────────────────────────────┐
│  SSM Automation Document (EFS Initialisation)               │
│  ──────────────────────────────────────────                 │
│  1. Reads YAML from SSM Parameter Store                     │
│  2. Generates EFS setup script                              │
│  3. Stores script in SSM                                    │
└─────────────────────────────────────────────────────────────┘
                           │
                           ↓
┌─────────────────────────────────────────────────────────────┐
│  SSM State Manager (EC2 Bootstrap)                          │
│  ───────────────────────────────────                        │
│  1. Executes EFS setup script                               │
│  2. Creates directory structure on EFS                      │
│  3. Writes YAML config to /mnt/efs/config/prometheus/       │
└─────────────────────────────────────────────────────────────┘
                           │
                           ↓
┌─────────────────────────────────────────────────────────────┐
│  ECS Container (Runtime)                                    │
│  ────────────────────                                       │
│  1. Mounts EFS at /mnt/efs                                  │
│  2. Prometheus container starts with:                       │
│     --config.file=/etc/prometheus/prometheus.yml            │
│  3. Config file is bind-mounted from EFS                    │
│  4. Prometheus reads YAML and starts scraping metrics       │
└─────────────────────────────────────────────────────────────┘
```

---

## Architecture Evolution: Before vs After

### Before Our Fix (Failed ❌)

```
┌─────────────┐
│ CDK Stack   │
│ (TypeScript)│
└──────┬──────┘
       │ Builds JS object
       │ Converts to JSON only
       ↓
┌─────────────────┐
│ SSM Parameter   │
│ (JSON only)     │
└──────┬──────────┘
       │
       ↓
┌──────────────────────┐
│ SSM Automation Doc   │
│ (Python script)      │
│                      │
│ import yaml          │ ← PyYAML not available!
│ yaml.dump(...)       │ ← ModuleNotFoundError
└──────────────────────┘
       │
       ✗ FAILURE
```

**Problem**: SSM Automation's Python 3.11 runtime doesn't include PyYAML library by default.

### After Our Fix (Works ✅)

```
┌─────────────┐
│ CDK Stack   │
│ (TypeScript)│
└──────┬──────┘
       │ Builds JS object
       │ Converts to JSON
       │ Converts to YAML (TypeScript)
       ↓
┌─────────────────┐
│ SSM Parameters  │
│ - JSON ✓        │
│ - YAML ✓        │
└──────┬──────────┘
       │
       ↓
┌──────────────────────┐
│ SSM Automation Doc   │
│ (Simplified)         │
│                      │
│ Just reads YAML ✓    │
│ No conversion needed │
└──────┬───────────────┘
       │
       ✓ SUCCESS
       ↓
┌──────────────────┐
│ Prometheus       │
│ Uses YAML ✓      │
└──────────────────┘
```

**Solution**: Generate both formats at CDK deployment time using TypeScript. No runtime dependencies needed!

---

## Implementation Details

### YAML Converter

Location: `lib/shared/utils/yaml-converter.ts`

```typescript
export function convertToYaml(obj: any, indent: number = 0): string {
  // Pure TypeScript implementation
  // No external dependencies
  // Handles: strings, numbers, booleans, arrays, objects
  // Proper indentation and formatting
}
```

**Features**:

- No external dependencies (no `js-yaml` or similar packages)
- Handles all Prometheus config data types
- Produces clean, readable YAML
- Works at CDK synthesis time (not runtime)

### Configuration Builder

Location: `lib/shared/helpers/prometheus-config-builder.ts`

```typescript
export function buildPrometheusConfig(
  envName: string,
  region: string,
  crossAccountTargets?: CrossAccountTarget[]
): object {
  // Builds complete Prometheus config
  // Returns JavaScript object
}
```

**Usage in EFS Stack**:

```typescript
// Build config
const prometheusConfig = buildPrometheusConfig(
  props.envName,
  region,
  props.crossAccountTargets
);

// Store JSON version
new ssm.StringParameter(this, "PrometheusConfig", {
  parameterName: `/monitoring/${props.envName}/prometheus-config`,
  stringValue: JSON.stringify(prometheusConfig, null, 2),
});

// Store YAML version
new ssm.StringParameter(this, "PrometheusConfigYaml", {
  parameterName: `/monitoring/${props.envName}/prometheus-config-yaml`,
  stringValue: convertToYaml(prometheusConfig),
});
```

---

## Configuration Updates

When you need to update the Prometheus configuration:

### 1. Update CDK Code

Modify `lib/shared/helpers/prometheus-config-builder.ts` or pass different `crossAccountTargets` props.

### 2. Deploy Stack

```bash
PROJECT_NAME=monitoring ENVIRONMENT=development \
  cdk deploy development-MonitoringEfs
```

**Result**:

- ✅ JSON parameter updated in SSM
- ✅ YAML parameter updated in SSM
- ✅ SSM Automation re-runs to update EFS

### 3. Restart Prometheus

SSM State Manager or ECS will pick up the new config on next container restart, or you can force a restart:

```bash
# Force ECS service update
aws ecs update-service \
  --cluster development-monitoring-cluster \
  --service prometheus-service \
  --force-new-deployment
```

Prometheus will reload with the new configuration automatically.

---

## Troubleshooting

### Config Not Loading

**Check SSM Parameters exist**:

```bash
aws ssm get-parameter \
  --name "/monitoring/development/prometheus-config-yaml" \
  --query 'Parameter.Value' \
  --output text
```

**Verify YAML syntax**:

```bash
aws ssm get-parameter \
  --name "/monitoring/development/prometheus-config-yaml" \
  --query 'Parameter.Value' \
  --output text | yq eval '.'
```

**Check Prometheus logs**:

```bash
# View ECS task logs
aws logs tail /ecs/prometheus --follow
```

### YAML Conversion Issues

If the YAML looks incorrect:

1. Check the source JavaScript object in `buildPrometheusConfig()`
2. Test the YAML converter with sample data
3. Compare JSON vs YAML output in SSM parameters
4. Validate YAML with Prometheus: `promtool check config prometheus.yml`

### EC2 Service Discovery Not Working

**Check IAM permissions**:

- Prometheus needs `ec2:DescribeInstances` permission
- For cross-account: Role assumption must be configured

**Verify filters**:

```bash
# Test EC2 discovery manually
aws ec2 describe-instances \
  --filters \
    "Name=tag:Environment,Values=development" \
    "Name=tag:Service,Values=NodeExporter,monitoring" \
    "Name=instance-state-name,Values=running"
```

---

## References

- [Prometheus Configuration Documentation](https://prometheus.io/docs/prometheus/latest/configuration/configuration/)
- [EC2 Service Discovery Config](https://prometheus.io/docs/prometheus/latest/configuration/configuration/#ec2_sd_config)
- [Relabeling Guide](https://prometheus.io/docs/prometheus/latest/configuration/configuration/#relabel_config)
- CDK Implementation: `lib/stacks/monitoring/efs-stack.ts`
- YAML Converter: `lib/shared/utils/yaml-converter.ts`
- Config Builder: `lib/shared/helpers/prometheus-config-builder.ts`

---

## Summary

- ✅ Prometheus requires YAML configuration files
- ✅ We store both JSON (for development) and YAML (for runtime)
- ✅ Conversion happens at CDK deployment time using TypeScript
- ✅ No runtime dependencies (no PyYAML, no js-yaml)
- ✅ Single source of truth: CDK code
- ✅ Automatic updates via SSM Parameter Store
- ✅ EC2 service discovery for dynamic target management
- ✅ Cross-account scraping support via IAM role assumption

This architecture provides a robust, maintainable, and scalable approach to managing Prometheus configuration across multiple environments and accounts.
