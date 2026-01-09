/** @format */

# ECS Constructs

This directory contains reusable AWS CDK constructs for creating and managing Amazon ECS (Elastic Container Service) infrastructure. The constructs follow a modular design pattern that separates concerns and promotes reusability across different projects and environments.

## Architecture Overview

```
+---------------------------+
|   EcsClusterConstruct     |  <-- Creates cluster + ASG + capacity provider
+---------------------------+
            |
            v
+---------------------------+
| EcsTaskDefinitionConstruct|  <-- Defines containers, volumes, IAM roles
+---------------------------+
            |
            v
+---------------------------+
|   EcsServiceConstruct     |  <-- Manages service, scaling, load balancer
+---------------------------+
```

## Design Choices

### 1. Separation of Concerns

The ECS infrastructure is split into three primary constructs rather than one monolithic construct:

| Construct | Responsibility |
|-----------|----------------|
| `EcsClusterConstruct` | Cluster creation, EC2 capacity, networking, security groups |
| `EcsTaskDefinitionConstruct` | Task definition, containers, volumes, IAM execution role |
| `EcsServiceConstruct` | Service deployment, scaling, load balancer attachment |

**Rationale:**
- Different teams may own different parts of the infrastructure
- Task definitions can be shared across multiple services
- Clusters can host multiple services with different configurations
- Each construct can be tested and validated independently

### 2. Launch Type Support

Both EC2 and Fargate launch types are supported with appropriate defaults:

| Feature | EC2 | Fargate |
|---------|-----|---------|
| Network Mode | BRIDGE (default) | AWS_VPC (required) |
| CPU/Memory | Optional | Required |
| Volumes | Host paths, EFS | EFS only |
| Port Mapping | Dynamic (hostPort: 0) | Static (hostPort = containerPort) |

**Note:** When using Fargate, you must provide `networkConfiguration` with subnets and security groups.

### 3. Default Security Configuration

The constructs include security best practices by default:

- IMDSv2 required on EC2 instances
- Encrypted EBS volumes
- Minimal IAM permissions with CDK Nag suppressions documented
- Circuit breaker enabled with rollback
- Container Insights available (disabled by default for cost)

### 4. Validation

Input validation occurs at construct instantiation to fail fast:

- Environment name validation
- Capacity ordering (min <= desired <= max)
- VPC and cluster presence checks
- Fargate resource requirements (cpu/memory)
- Port range validation

## Constructs Reference

### EcsClusterConstruct

Creates an ECS cluster with EC2 capacity provider, Auto Scaling Group, and associated networking.

```typescript
import { EcsClusterConstruct } from "../constructs/compute/ecs";

const cluster = new EcsClusterConstruct(this, "MonitoringCluster", {
  vpc: myVpc,
  envName: "production",
  projectName: "monitoring",
  
  // Cluster configuration
  clusterName: "monitoring-cluster",
  enableContainerInsights: true,
  enableFargateCapacityProviders: false,
  
  // EC2 capacity
  instanceType: new ec2.InstanceType("t3.medium"),
  minCapacity: 2,
  maxCapacity: 10,
  desiredCapacity: 2,
  
  // Networking
  usePublicSubnets: false,
  additionalSecurityGroups: [mySecurityGroup],
  
  // Logging
  logRetention: logs.RetentionDays.ONE_MONTH,
  logGroupKmsKey: myKmsKey,
  
  // Execute command for debugging
  enableExecuteCommand: true,
});

// Allow internal traffic for Prometheus scraping
cluster.allowInternalPort(9090, "Allow Prometheus scraping");
```

**Key Properties Exposed:**
- `cluster` - The ECS Cluster
- `logGroup` - CloudWatch Log Group for cluster logs
- `asg` - Auto Scaling Group for EC2 capacity
- `launchTemplate` - EC2 Launch Template

### EcsTaskDefinitionConstruct

Creates an ECS task definition with flexible container configuration supporting multiple containers.

```typescript
import { EcsTaskDefinitionConstruct } from "../constructs/compute/ecs";

// EC2 Task Definition
const ec2Task = new EcsTaskDefinitionConstruct(this, "AppTask", {
  envName: "production",
  launchType: "EC2",
  containers: [
    {
      name: "app",
      image: ecs.ContainerImage.fromEcrRepository(myRepo, "latest"),
      containerPort: 8080,
      memoryReservationMiB: 512,
      memoryLimitMiB: 1024,
      cpu: 256,
      environment: {
        NODE_ENV: "production",
      },
      secrets: {
        DATABASE_URL: ecs.Secret.fromSecretsManager(mySecret, "database_url"),
      },
      logGroup: myLogGroup,
      logStreamPrefix: "app",
      healthCheck: {
        command: ["CMD-SHELL", "curl -f http://localhost:8080/health || exit 1"],
        intervalSeconds: 30,
        retries: 3,
      },
    },
  ],
  volumes: [
    {
      name: "app-data",
      host: { sourcePath: "/mnt/data" },
    },
  ],
});

// Add mount points after creation
ec2Task.addMountPoints("app", {
  sourceVolume: "app-data",
  containerPath: "/data",
  readOnly: false,
});

// Fargate Task Definition
const fargateTask = new EcsTaskDefinitionConstruct(this, "FargateTask", {
  envName: "production",
  launchType: "FARGATE",
  cpu: 512,        // Required for Fargate
  memoryMiB: 1024, // Required for Fargate
  containers: [
    {
      name: "app",
      image: ecs.ContainerImage.fromEcrRepository(myRepo, "latest"),
      containerPort: 8080,
      logGroup: myLogGroup,
    },
  ],
});
```

**Key Properties Exposed:**
- `taskDefinition` - The ECS Task Definition
- `containers` - Map of container definitions by name

**Container Configuration Options:**

| Property | Description |
|----------|-------------|
| `name` | Container name (required) |
| `image` | Container image (required) |
| `containerPort` | Port exposed by container |
| `hostPort` | Host port mapping (EC2 only, 0 for dynamic) |
| `cpu` | CPU units (1024 = 1 vCPU) |
| `memoryLimitMiB` | Hard memory limit |
| `memoryReservationMiB` | Soft memory limit |
| `environment` | Environment variables |
| `secrets` | Secrets from Secrets Manager/SSM |
| `command` | Command override |
| `healthCheck` | Container health check |
| `logGroup` | CloudWatch Log Group |
| `linuxParameters` | Linux-specific settings |

### EcsServiceConstruct

Creates an ECS service with deployment configuration, auto-scaling, and load balancer integration.

```typescript
import { EcsServiceConstruct } from "../constructs/compute/ecs";

// EC2 Service
const ec2Service = new EcsServiceConstruct(this, "AppService", {
  cluster: myCluster,
  taskDefinition: myTaskDefinition,
  envName: "production",
  projectName: "my-app",
  
  // Service configuration
  serviceName: "app-service",
  desiredCount: 3,
  minHealthyPercent: 100,
  maxHealthyPercent: 200,
  healthCheckGracePeriod: cdk.Duration.seconds(60),
  
  // Deployment
  enableCircuitBreaker: true,
  
  // Load balancer
  loadBalancerTargets: [
    {
      targetGroup: myTargetGroup,
      containerName: "app",
      containerPort: 8080,
    },
  ],
  
  // Auto-scaling
  scalingConfig: {
    minCapacity: 2,
    maxCapacity: 10,
    cpuTargetUtilizationPercent: 70,
    memoryTargetUtilizationPercent: 80,
  },
  
  // Alarms
  alarmConfig: {
    enabled: true,
    cpuThreshold: 85,
    memoryThreshold: 90,
  },
});

// Fargate Service
const fargateService = new EcsServiceConstruct(this, "FargateService", {
  cluster: myCluster,
  taskDefinition: myFargateTaskDef,
  envName: "production",
  launchType: "FARGATE",
  
  // Required for Fargate
  networkConfiguration: {
    awsvpcConfiguration: {
      subnets: myVpc.privateSubnets.map(s => s.subnetId),
      securityGroups: [mySecurityGroup.securityGroupId],
      assignPublicIp: false,
    },
  },
});
```

**Key Properties Exposed:**
- `service` - The ECS Service (Ec2Service or FargateService)
- `cpuAlarm` - CloudWatch CPU alarm (if configured)
- `memoryAlarm` - CloudWatch memory alarm (if configured)

### AutoScalingGroupConstruct

Standalone Auto Scaling Group construct for advanced use cases where you need more control over capacity provisioning.

```typescript
import { AutoScalingGroupConstruct } from "../constructs/compute/ecs";

const asg = new AutoScalingGroupConstruct(this, "CustomAsg", {
  vpc: myVpc,
  cluster: myCluster,
  envName: "production",
  launchTemplate: myLaunchTemplate,
  
  minCapacity: 1,
  maxCapacity: 5,
  desiredCapacity: 2,
  
  // Subnet selection
  subnetSelection: {
    subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
  },
  
  // Capacity provider settings
  enableManagedScaling: true,
  enableManagedTerminationProtection: false,
  
  // Update policy
  updateMaxBatchSize: 1,
  updateMinInstancesInService: 1,
});
```

## Usage Patterns

### Pattern 1: Simple EC2-Based Service

For cost-effective workloads that can tolerate EC2 instance management:

```typescript
// 1. Create cluster with EC2 capacity
const cluster = new EcsClusterConstruct(this, "Cluster", {
  vpc,
  envName: "dev",
  instanceType: new ec2.InstanceType("t3.small"),
  desiredCapacity: 1,
});

// 2. Create task definition
const taskDef = new EcsTaskDefinitionConstruct(this, "TaskDef", {
  envName: "dev",
  launchType: "EC2",
  containers: [{
    name: "app",
    image: ecs.ContainerImage.fromRegistry("nginx:latest"),
    containerPort: 80,
    memoryReservationMiB: 256,
  }],
});

// 3. Create service
const service = new EcsServiceConstruct(this, "Service", {
  cluster: cluster.cluster,
  taskDefinition: taskDef.taskDefinition,
  envName: "dev",
  desiredCount: 1,
});
```

### Pattern 2: Fargate Service with Load Balancer

For serverless container workloads with managed infrastructure:

```typescript
// Log group for the service
const logGroup = new logs.LogGroup(this, "LogGroup", {
  logGroupName: "/ecs/my-service",
  retention: logs.RetentionDays.ONE_WEEK,
});

// Task definition for Fargate
const taskDef = new EcsTaskDefinitionConstruct(this, "TaskDef", {
  envName: "production",
  launchType: "FARGATE",
  cpu: 256,
  memoryMiB: 512,
  containers: [{
    name: "app",
    image: ecs.ContainerImage.fromEcrRepository(repo, "v1.0.0"),
    containerPort: 8080,
    logGroup,
    environment: {
      PORT: "8080",
    },
  }],
});

// Service with network configuration
const service = new EcsServiceConstruct(this, "Service", {
  cluster: existingCluster,
  taskDefinition: taskDef.taskDefinition,
  envName: "production",
  launchType: "FARGATE",
  desiredCount: 2,
  networkConfiguration: {
    awsvpcConfiguration: {
      subnets: vpc.privateSubnets.map(s => s.subnetId),
      securityGroups: [serviceSg.securityGroupId],
    },
  },
  loadBalancerTargets: [{
    targetGroup: albTargetGroup,
    containerName: "app",
    containerPort: 8080,
  }],
  scalingConfig: {
    minCapacity: 2,
    maxCapacity: 10,
    cpuTargetUtilizationPercent: 70,
  },
});
```

### Pattern 3: Multi-Container Task (Sidecar Pattern)

For applications with auxiliary containers (logging, monitoring, proxies):

```typescript
const taskDef = new EcsTaskDefinitionConstruct(this, "TaskDef", {
  envName: "production",
  launchType: "FARGATE",
  cpu: 512,
  memoryMiB: 1024,
  containers: [
    // Main application container
    {
      name: "app",
      image: ecs.ContainerImage.fromEcrRepository(appRepo),
      containerPort: 8080,
      cpu: 384,
      memoryLimitMiB: 768,
      logGroup: appLogGroup,
    },
    // Sidecar for metrics
    {
      name: "metrics-exporter",
      image: ecs.ContainerImage.fromRegistry("prom/statsd-exporter:latest"),
      containerPort: 9102,
      cpu: 64,
      memoryLimitMiB: 128,
      logGroup: metricsLogGroup,
      dependencies: [{
        containerName: "app",
        condition: ecs.ContainerDependencyCondition.START,
      }],
    },
  ],
});
```

### Pattern 4: EFS Volume Integration

For stateful workloads requiring persistent storage:

```typescript
const fileSystem = new efs.FileSystem(this, "EfsFileSystem", {
  vpc,
  encrypted: true,
});

const accessPoint = new efs.AccessPoint(this, "AccessPoint", {
  fileSystem,
  path: "/app-data",
  posixUser: { uid: "1000", gid: "1000" },
  createAcl: { ownerUid: "1000", ownerGid: "1000", permissions: "750" },
});

const taskDef = new EcsTaskDefinitionConstruct(this, "TaskDef", {
  envName: "production",
  launchType: "FARGATE",
  cpu: 512,
  memoryMiB: 1024,
  volumes: [{
    name: "app-storage",
    efsVolumeConfiguration: {
      fileSystemId: fileSystem.fileSystemId,
      transitEncryption: "ENABLED",
      authorizationConfig: {
        accessPointId: accessPoint.accessPointId,
      },
    },
  }],
  containers: [{
    name: "app",
    image: ecs.ContainerImage.fromEcrRepository(repo),
    containerPort: 8080,
    logGroup,
  }],
});

// Add mount point after creation
taskDef.addMountPoints("app", {
  sourceVolume: "app-storage",
  containerPath: "/data",
  readOnly: false,
});
```

## Best Practices

### 1. Environment-Specific Configuration

```typescript
const isProduction = props.envName === "production";

const cluster = new EcsClusterConstruct(this, "Cluster", {
  vpc,
  envName: props.envName,
  
  // Production settings
  enableContainerInsights: isProduction,
  minCapacity: isProduction ? 2 : 1,
  maxCapacity: isProduction ? 20 : 3,
  logGroupKmsKey: isProduction ? kmsKey : undefined,
  logRetention: isProduction 
    ? logs.RetentionDays.THREE_MONTHS 
    : logs.RetentionDays.ONE_WEEK,
});
```

### 2. Use Separate Log Groups

Create dedicated log groups for each service for better organisation and retention control:

```typescript
const prometheusLogGroup = new logs.LogGroup(this, "PrometheusLogs", {
  logGroupName: `/ecs/${envName}-prometheus`,
  retention: logs.RetentionDays.TWO_WEEKS,
});

const grafanaLogGroup = new logs.LogGroup(this, "GrafanaLogs", {
  logGroupName: `/ecs/${envName}-grafana`,
  retention: logs.RetentionDays.TWO_WEEKS,
});
```

### 3. Circuit Breaker Configuration

Always enable circuit breaker for production services:

```typescript
const service = new EcsServiceConstruct(this, "Service", {
  // ...
  enableCircuitBreaker: true, // Default is true
  alarmConfig: {
    enabled: true,
    cpuThreshold: 85,
    memoryThreshold: 90,
    alarmBehavior: ecs.AlarmBehavior.ROLLBACK_ON_ALARM,
  },
});
```

### 4. Health Check Configuration

Configure appropriate health checks for reliable deployments:

```typescript
{
  name: "app",
  image: appImage,
  healthCheck: {
    command: [
      "CMD-SHELL",
      "curl -f http://localhost:8080/health || exit 1"
    ],
    intervalSeconds: 30,
    timeoutSeconds: 5,
    retries: 3,
    startPeriodSeconds: 60, // Give app time to start
  },
}
```

## Troubleshooting

### Container Instances Not Appearing in Cluster

1. Check ASG in EC2 console - verify instances are launching
2. Check instance status - instances must pass health checks
3. Verify ECS agent is running: `systemctl status ecs`
4. Check ECS agent logs: `/var/log/ecs/ecs-agent.log`
5. Verify `ECS_CLUSTER` matches cluster name in `/etc/ecs/ecs.config`
6. Check security groups allow outbound traffic on port 443

### Fargate Tasks Failing to Start

1. Verify `networkConfiguration` is provided
2. Check subnets have routes to NAT Gateway or Internet Gateway
3. Ensure security groups allow egress to ECR/CloudWatch endpoints
4. Verify task execution role has ECR pull permissions

### Port Mapping Issues

- EC2 BRIDGE mode: Use `hostPort: 0` for dynamic port mapping
- Fargate/AWS_VPC mode: `hostPort` must equal `containerPort`
- HOST mode: `hostPort` must equal `containerPort`

## Related Constructs

- `LaunchTemplateConstruct` - Custom EC2 launch templates
- `SsmStateManagerConstruct` - SSM automation for ECS agents
- Service constructs (Prometheus, Grafana) - Higher-level monitoring services

## Additional Resources

- [Amazon ECS Best Practices Guide](https://docs.aws.amazon.com/AmazonECS/latest/bestpracticesguide)
- [AWS CDK ECS Patterns](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ecs_patterns-readme.html)
- [ECS Capacity Providers](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/cluster-capacity-providers.html)
