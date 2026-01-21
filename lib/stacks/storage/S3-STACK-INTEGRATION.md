/** @format */

# S3 Stack Integration Example

This document shows how to integrate the new S3 stack into your deployment.

## Stack Architecture

The S3 stack is a Layer 0 stack (foundational), similar to the EFS stack. It should be deployed before the infrastructure stack.

### Deployment Order

```
1. NetworkingStack (Layer 0 - Foundation)
2. MonitoringS3Stack (Layer 0 - Storage) ← NEW
3. MonitoringEfsStack (Layer 0 - Storage)
4. MonitoringInfraStack (Layer 1 - Infrastructure)
5. MonitoringServiceStack (Layer 2 - Services)
```

## Example Integration

### bin/app.ts

```typescript
import * as cdk from "aws-cdk-lib";
import { NetworkingStack } from "../lib/stacks/foundation/networking-stack";
import { MonitoringS3Stack } from "../lib/stacks/storage/s3-stack";
import { MonitoringEfsStack } from "../lib/stacks/monitoring/efs-stack";
import { MonitoringInfraStack } from "../lib/stacks/monitoring/infra-stack";
import { MonitoringServiceStack } from "../lib/stacks/monitoring/service-stack";

const app = new cdk.App();

// Environment configuration
const envName = process.env.ENVIRONMENT || "development";
const projectName = process.env.PROJECT_NAME || "monitoring";
const account = process.env.CDK_DEFAULT_ACCOUNT;
const region = process.env.CDK_DEFAULT_REGION || "eu-west-1";

const env = { account, region };

// Layer 0: Networking
const networkingStack = new NetworkingStack(app, `${envName}-Networking`, {
  env,
  envName,
  projectName,
  vpcCidr: "10.0.0.0/16",
  enableVpcFlowLogs: true,
});

// Layer 0: S3 Storage (NEW!)
const s3Stack = new MonitoringS3Stack(app, `${envName}-MonitoringS3`, {
  env,
  envName,
  projectName,
  removalPolicy: envName === "production" 
    ? cdk.RemovalPolicy.RETAIN 
    : cdk.RemovalPolicy.DESTROY,
  enableVersioning: envName === "production",
  dashboardsPath: "./config/grafana/dashboards",
});

// Layer 0: EFS Storage
const efsStack = new MonitoringEfsStack(app, `${envName}-MonitoringEfs`, {
  env,
  envName,
  projectName,
  vpc: networkingStack.vpc,
});

// Layer 1: Infrastructure
const infraStack = new MonitoringInfraStack(app, `${envName}-MonitoringInfra`, {
  env,
  envName,
  projectName,
  vpc: networkingStack.vpc,
  efsStackName: efsStack.stackName,
  fileSystem: efsStack.fileSystem,
  efsAccessPoint: efsStack.accessPoint,
  efsAvailabilityZone: efsStack.efsAvailabilityZone,
  efsSecurityGroup: efsStack.mountTargetSecurityGroup,
  efsInitializationComplete: efsStack.efsInitializationExecution,
  dashboardBucket: s3Stack.dashboardBucket, // Use S3 stack bucket
});

// Layer 2: Services
const serviceStack = new MonitoringServiceStack(app, `${envName}-MonitoringService`, {
  env,
  envName,
  projectName,
  cluster: infraStack.cluster,
  loadBalancer: infraStack.loadBalancer,
  listener: infraStack.listener,
});

app.synth();
```

## Removal of Dashboard Bucket from EFS Stack

The dashboard bucket logic can now be removed from `MonitoringEfsStack` since it's handled by the dedicated S3 stack:

### Before (in efs-stack.ts)

```typescript
// This can be removed
private createDashboardBucket(props: MonitoringEfsStackProps): s3.Bucket {
  // ...
}

private deployDashboardsToS3(props: MonitoringEfsStackProps): s3deploy.BucketDeployment {
  // ...
}
```

### After (cleaner separation)

The EFS stack now focuses purely on EFS concerns, and S3 concerns are in the S3 stack.

## Deployment Commands

### Deploy All Stacks

```bash
# Development
PROJECT_NAME=monitoring ENVIRONMENT=development cdk deploy --all

# Production
PROJECT_NAME=monitoring ENVIRONMENT=production cdk deploy --all
```

### Deploy S3 Stack Only

```bash
PROJECT_NAME=monitoring ENVIRONMENT=development cdk deploy development-MonitoringS3
```

### Update Dashboards Only

```bash
# Make changes to config/grafana/dashboards/*.json
# Then redeploy S3 stack
PROJECT_NAME=monitoring ENVIRONMENT=development cdk deploy development-MonitoringS3
```

## Benefits of Separate S3 Stack

1. **Separation of Concerns**: S3 buckets are independent of EFS
2. **Reusability**: Easy to add more S3 buckets for different purposes
3. **Independent Deployment**: Update dashboards without touching EFS
4. **Scalability**: Add new buckets (logs, backups, configs) easily
5. **Testing**: Simpler to test S3 functionality in isolation

## Future Expansion

The S3 stack is designed to accommodate future S3 needs:

```typescript
// Future additions to MonitoringS3Stack
public readonly logsBucket: s3.IBucket;        // For ALB access logs
public readonly backupBucket: s3.IBucket;      // For Prometheus snapshots
public readonly configBucket: s3.IBucket;      // For configuration backups
```

## Reusing S3BucketConstruct

The `S3BucketConstruct` can be reused in other stacks:

```typescript
import { S3BucketConstruct } from "../../constructs/storage/s3";

// In any stack
const logsBucket = new S3BucketConstruct(this, "LogsBucket", {
  envName: "production",
  config: {
    bucketName: `application-logs-production-${this.account}`,
    purpose: "Application Logs",
    encryption: s3.BucketEncryption.KMS,
    encryptionKey: kmsKey,
    lifecycleRules: [{
      id: "ArchiveOldLogs",
      enabled: true,
      transitions: [{
        storageClass: s3.StorageClass.GLACIER,
        transitionAfter: cdk.Duration.days(90),
      }],
    }],
  },
});
```
