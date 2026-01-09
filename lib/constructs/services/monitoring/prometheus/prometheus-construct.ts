/** @format */

import * as cdk from "aws-cdk-lib";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";
import { NagSuppressions } from "cdk-nag";

import { EcsTaskDefinitionConstruct } from "../../compute/ecs/ecs-task-definition-construct";
import { EcsServiceConstruct } from "../../compute/ecs/ecs-service-construct";
import { EcsTaskExecutionRole } from "../../iam";

export interface PrometheusConstructProps {
  cluster: ecs.ICluster;
  envName: string;
  serviceName?: string;

  // Storage paths
  dataVolumePath: string;
  configVolumePath: string;

  // Resource configuration
  memoryReservationMiB?: number;
  cpu?: number;

  // Prometheus configuration
  retentionDays?: string;
  scrapeInterval?: string;
  enableLifecycle?: boolean;

  // Web configuration
  webRoutePrefix?: string;
  webExternalUrl?: string;

  // Service discovery
  enableEc2ServiceDiscovery?: boolean;
  region?: string;

  // Logging
  logRetention?: logs.RetentionDays;

  // ECS configuration
  enableExecuteCommand?: boolean;
  desiredCount?: number;
}

/**
 * Reusable construct for deploying Prometheus with ECS
 *
 * Uses EcsTaskDefinitionConstruct and EcsServiceConstruct internally
 * for consistency with other ECS deployments.
 *
 * Features:
 * - Persistent storage via host volumes
 * - EC2 service discovery for scraping
 * - Configurable retention and scraping
 * - Consistent with application ECS patterns

 */
export class PrometheusConstruct extends Construct {
  public readonly service: ecs.Ec2Service;
  public readonly taskDefinition: ecs.Ec2TaskDefinition;
  public readonly logGroup: logs.LogGroup;

  private readonly taskDefConstruct: EcsTaskDefinitionConstruct;
  private readonly serviceConstruct: EcsServiceConstruct;

  constructor(scope: Construct, id: string, props: PrometheusConstructProps) {
    super(scope, id);

    // Create log group
    this.logGroup = new logs.LogGroup(this, "LogGroup", {
      logGroupName: `/ecs/${props.envName}-prometheus`,
      retention: props.logRetention || logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Build Prometheus command
    const prometheusCommand = this.buildPrometheusCommand(props);

    // ========================================================================
    // 1. CREATE TASK DEFINITION USING EcsTaskDefinitionConstruct
    // ========================================================================
    // Create execution role with CloudWatch Logs permissions for awslogs driver
    const executionRoleConstruct = new EcsTaskExecutionRole(
      this,
      "ExecutionRole",
      {
        envName: props.envName,
        enablePublicEcr: true, // Prometheus uses public Docker Hub image
        enableCloudWatchLogs: true, // Required for awslogs driver
        logGroupArn: this.logGroup.logGroupArn, // Grant permissions to specific log group
      }
    );

    this.taskDefConstruct = new EcsTaskDefinitionConstruct(
      this,
      "TaskDefinition",
      {
        envName: props.envName,
        networkMode: ecs.NetworkMode.HOST, // HOST mode for static port 9090
        grantEcrReadAccess: false, // Using public registry
        executionRole: executionRoleConstruct.role, // Use execution role with log group permissions

        // Define volumes for persistent storage
        volumes: [
          {
            name: "prometheus-data",
            host: {
              sourcePath: props.dataVolumePath,
            },
          },
          {
            name: "prometheus-config",
            host: {
              sourcePath: props.configVolumePath,
            },
          },
        ],

        // Define Prometheus container
        containers: [
          {
            name: "prometheus",
            image: ecs.ContainerImage.fromRegistry("prom/prometheus:latest"),
            // Port 9090 - in HOST mode, this maps to the same port on host
            containerPort: 9090,
            memoryReservationMiB: props.memoryReservationMiB || 256,
            cpu: props.cpu,
            command: prometheusCommand,
            // Use awslogs driver - enables ECS console "Logs" tab
            logGroup: this.logGroup, // Use the log group created above
            logStreamPrefix: "prometheus", // Log stream prefix for CloudWatch Logs
            environment: {
              ENVIRONMENT: props.envName,
              // Logging configuration - CRITICAL for awslogs driver
              // Prometheus outputs to STDOUT/STDERR by default, but we can set log level
              // The awslogs driver captures STDOUT/STDERR automatically
              // No additional configuration needed - Prometheus logs to console by default
              // Force task definition update on each deployment
              // This ensures ECS creates a new task definition revision and deploys it
              DEPLOYMENT_TIMESTAMP: Date.now().toString(),
            },
            user: "65534:65534", // Run as nobody user (UID:GID 65534:65534) to match file permissions
          },
        ],
      }
    );

    this.taskDefinition = this.taskDefConstruct.taskDefinition;

    // Grant CloudWatch Logs write permissions to execution role
    // This is required for the awslogs driver to create log streams and put log events
    this.logGroup.grantWrite(executionRoleConstruct.role);

    // ========================================================================
    // 2. ADD MOUNT POINTS TO CONTAINER
    // ========================================================================
    this.taskDefConstruct.addMountPoints(
      "prometheus",
      {
        sourceVolume: "prometheus-data",
        containerPath: "/prometheus",
        readOnly: false,
      },
      {
        sourceVolume: "prometheus-config",
        containerPath: "/etc/prometheus",
        readOnly: true,
      }
    );

    // ========================================================================
    // 3. ADD IAM PERMISSIONS FOR EC2 SERVICE DISCOVERY
    // ========================================================================
    if (props.enableEc2ServiceDiscovery !== false) {
      // EC2 service discovery permissions (same account)
      this.taskDefinition.taskRole.addToPrincipalPolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            "ec2:DescribeInstances",
            "ec2:DescribeAvailabilityZones",
            "ec2:DescribeTags",
            "ec2:DescribeInstanceStatus",
            "ec2:DescribeRegions",
          ],
          resources: ["*"],
        })
      );

      // STS AssumeRole permissions for cross-account EC2 service discovery
      // Prometheus needs this to assume roles in other accounts for EC2 service discovery
      // The role ARNs will be in the format: arn:aws:iam::ACCOUNT:role/env-PipelineMonitoringAccess
      this.taskDefinition.taskRole.addToPrincipalPolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ["sts:AssumeRole"],
          resources: [
            // Allow assuming cross-account monitoring roles
            // Pattern: arn:aws:iam::*:role/*-PipelineMonitoringAccess
            "arn:aws:iam::*:role/*-PipelineMonitoringAccess",
          ],
        })
      );
    }

    // ========================================================================
    // CDK NAG SUPPRESSIONS
    // ========================================================================
    if (this.taskDefinition.taskRole) {
      NagSuppressions.addResourceSuppressions(
        this.taskDefinition.taskRole,
        [
          {
            id: "AwsSolutions-IAM5",
            reason:
              "Prometheus requires wildcard permissions for cross-account EC2 service discovery. " +
              "The sts:AssumeRole action uses a wildcard resource pattern to allow Prometheus to assume " +
              "cross-account monitoring roles in application accounts (dev, staging, production). " +
              "The pattern 'arn:aws:iam::*:role/*-PipelineMonitoringAccess' is scoped to only monitoring roles " +
              "created by the CrossAccountMonitoringRole construct, which are explicitly designed for this purpose. " +
              "EC2 service discovery requires cross-account role assumption to discover and scrape metrics from " +
              "instances in other AWS accounts. " +
              "See: https://prometheus.io/docs/prometheus/latest/configuration/configuration/#ec2_sd_config",
            appliesTo: [
              "Resource::arn:aws:iam::*:role/*-PipelineMonitoringAccess",
            ],
          },
          {
            id: "AwsSolutions-IAM5",
            reason:
              "EC2 Describe actions do not support resource-level permissions. " +
              "Prometheus EC2 service discovery requires these permissions to discover instances for scraping. " +
              "These are read-only actions required for EC2 service discovery functionality. " +
              "See: https://docs.aws.amazon.com/service-authorization/latest/reference/list_amazonec2.html",
            appliesTo: [
              "Action::ec2:DescribeInstances",
              "Action::ec2:DescribeAvailabilityZones",
              "Action::ec2:DescribeTags",
              "Action::ec2:DescribeInstanceStatus",
              "Action::ec2:DescribeRegions",
              "Resource::*",
            ],
          },
        ],
        true // Apply to children (default policy)
      );
    }

    // ========================================================================
    // 4. CREATE SERVICE USING EcsServiceConstruct
    // ========================================================================
    this.serviceConstruct = new EcsServiceConstruct(this, "Service", {
      cluster: props.cluster,
      taskDefinition: this.taskDefinition,
      envName: props.envName,
      serviceName: props.serviceName || `${props.envName}-prometheus`,
      desiredCount: props.desiredCount || 1,

      // Deployment configuration
      // minHealthyPercent: 0 allows stopping old tasks even if new ones aren't healthy yet
      // This is critical for preventing credential exhaustion from old tasks
      minHealthyPercent: 0, // Allow stopping old tasks immediately
      maxHealthyPercent: 100, // Single instance (don't allow more than desired count)
      healthCheckGracePeriod: cdk.Duration.seconds(180), // Increased from 60s to 180s to allow Prometheus time to start and load configuration

      // Enable circuit breaker
      enableCircuitBreaker: false,

      // Enable ECS Exec
      enableExecuteCommand: props.enableExecuteCommand,

      // No load balancer target (configured externally if needed)
      loadBalancerTarget: undefined,

      // No alarms by default (can be added externally)
      alarmConfig: undefined,
    });

    this.service = this.serviceConstruct.service;
  }

  /**
   * Build Prometheus command with configuration
   */
  private buildPrometheusCommand(props: PrometheusConstructProps): string[] {
    const command = [
      "--config.file=/etc/prometheus/prometheus.yml",
      "--storage.tsdb.path=/prometheus",
      `--storage.tsdb.retention.time=${props.retentionDays || "7d"}`,
      "--web.console.libraries=/usr/share/prometheus/console_libraries",
      "--web.console.templates=/usr/share/prometheus/consoles",
    ];

    // Add web route prefix if provided
    if (props.webRoutePrefix) {
      command.push(`--web.route-prefix=${props.webRoutePrefix}`);
    }

    // Add external URL if provided
    if (props.webExternalUrl) {
      command.push(`--web.external-url=${props.webExternalUrl}`);
    }

    // Enable lifecycle API if requested
    if (props.enableLifecycle !== false) {
      command.push("--web.enable-lifecycle");
    }

    return command;
  }

  /**
   * Get the Prometheus container port
   */
  public static readonly PORT = 9090;

  /**
   * Add a custom IAM policy to the task role
   */
  public addToTaskRolePolicy(statement: iam.PolicyStatement): void {
    this.taskDefinition.taskRole.addToPrincipalPolicy(statement);
  }

  /**
   * Get the container definition
   */
  public get container(): ecs.ContainerDefinition | undefined {
    return this.taskDefConstruct.getContainer("prometheus");
  }
}
