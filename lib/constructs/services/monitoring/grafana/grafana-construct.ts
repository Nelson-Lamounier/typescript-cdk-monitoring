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

export interface GrafanaConstructProps {
  // Required parameters
  cluster: ecs.ICluster;
  envName: string;

  // Strage paths
  dataVolumePath: string;
  provisioningVolumePath: string;
  dashboardsVolumePath: string;

  // Optional service configuration
  serviceName?: string;
  desiredCount?: number;

  // Optional resource configuration
  memoryReservationMiB?: number;
  cpu?: number;

  // Optional Grafana configuration
  adminUser?: string;
  adminPassword?: string;
  installPlugins?: string;
  rootUrl?: string;

  // Optional logging
  logRetention?: logs.RetentionDays;

  // Optional ECS configuration
  enableExecuteCommand?: boolean;

  // Optional CloudWatch integration
  enableCloudWatch?: boolean;
  awsRegion?: string;
}

/**
 * Reusable construct for deploy Grafana with ECS
 *
 *  Uses EcsTaskDefinitionConstruct and EcsServiceConstruct internally
 * for consistency with other ECS deployments.
 *
 * Fetures"
 * - Persistent store for dashborad and config
 * - CloudWatch datasource support
 * - Prometheus datasource pre-provisioning
 * - Configurable admin credencials
 * - Consistence with application ECS patters
 *
 *
 */

export class GrafanaConstruct extends Construct {
  public readonly service: ecs.Ec2Service;
  public readonly taskDefinition: ecs.Ec2TaskDefinition;
  public readonly logGroup?: logs.LogGroup;

  private readonly taskDefConstruct: EcsTaskDefinitionConstruct;
  private readonly serviceConstruct: EcsServiceConstruct;

  constructor(scope: Construct, id: string, props: GrafanaConstructProps) {
    super(scope, id);

    const logGroupName = `/ecs/${props.envName}-grafana`;
    this.logGroup = new logs.LogGroup(this, "LogGroup", {
      logGroupName: logGroupName,
      retention: props.logRetention || logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Build environment varibles
    const environment = this.buildEnvironment(props);

    // Create a minimal task role without any permissions
    // CloudWatch permissions will be added if enableCloudWatch is true
    const taskRole = new iam.Role(this, "TaskRole", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      description: "Task role for Grafana",
    });

    // Add CloudWatch permissions if enabled (default: true)
    if (props.enableCloudWatch !== false) {
      // CloudWatch Metrics - these actions don't support resource-level permissions
      taskRole.addToPrincipalPolicy(
        new iam.PolicyStatement({
          sid: "CloudWatchMetricsReadOnly",
          effect: iam.Effect.ALLOW,
          actions: [
            "cloudwatch:DescribeAlarmsForMetric",
            "cloudwatch:DescribeAlarmHistory",
            "cloudwatch:DescribeAlarms",
            "cloudwatch:ListMetrics",
            "cloudwatch:GetMetricData",
            "cloudwatch:GetMetricStatistics",
          ],
          resources: ["*"], // Required - these actions don't support resource-level permissions
        })
      );

      // CloudWatch Logs - scope to specific log groups if possible
      taskRole.addToPrincipalPolicy(
        new iam.PolicyStatement({
          sid: "CloudWatchLogsReadOnly",
          effect: iam.Effect.ALLOW,
          actions: [
            "logs:DescribeLogGroups",
            "logs:GetLogGroupFields",
            "logs:StartQuery",
            "logs:StopQuery",
            "logs:GetQueryResults",
            "logs:GetLogEvents",
          ],
          resources: [
            `arn:aws:logs:${cdk.Stack.of(this).region}:${
              cdk.Stack.of(this).account
            }:log-group:*`,
          ],
        })
      );

      // EC2 describe for region discovery (read-only, low risk)
      taskRole.addToPrincipalPolicy(
        new iam.PolicyStatement({
          sid: "EC2DescribeReadOnly",
          effect: iam.Effect.ALLOW,
          actions: [
            "ec2:DescribeTags",
            "ec2:DescribeInstances",
            "ec2:DescribeRegions",
          ],
          resources: ["*"], // Required - EC2 Describe actions don't support resource-level permissions
        })
      );

      // Add CDK Nag suppressions
      NagSuppressions.addResourceSuppressions(
        taskRole,
        [
          {
            id: "AwsSolutions-IAM5",
            reason:
              "CloudWatch metrics and EC2 describe actions do not support resource-level permissions. " +
              "These are read-only actions required for Grafana CloudWatch datasource. " +
              "See: https://docs.aws.amazon.com/service-authorization/latest/reference/list_amazoncloudwatch.html",
            appliesTo: [
              "Resource::*",
              "Resource::arn:aws:logs:<AWS::Region>:<AWS::AccountId>:log-group:*",
            ],
          },
        ],
        true // Apply to children
      );
    }

    // ========================================================================
    // 1. CREATE TASK DEFINITION USING EcsTaskDefinitionConstruct
    // ========================================================================
    // Create execution role with CloudWatch Logs permissions for awslogs driver
    const executionRoleConstruct = new EcsTaskExecutionRole(
      this,
      "ExecutionRole",
      {
        envName: props.envName,
        enablePublicEcr: true, // Grafana uses public Docker Hub image
        enableCloudWatchLogs: true, // Required for awslogs driver
        logGroupArn: this.logGroup.logGroupArn, // Grant permissions to specific log group
      }
    );

    this.taskDefConstruct = new EcsTaskDefinitionConstruct(
      this,
      "TaskDefinition",
      {
        envName: props.envName,
        networkMode: ecs.NetworkMode.BRIDGE,
        grantEcrReadAccess: false,
        taskRole: taskRole,
        executionRole: executionRoleConstruct.role, // Use execution role with log group permissions

        // Volume
        volumes: [
          {
            name: "grafana-data",
            host: {
              sourcePath: props.dataVolumePath,
            },
          },
          {
            name: "grafana-provisioning",
            host: {
              sourcePath: props.provisioningVolumePath,
            },
          },
          {
            name: "grafana-dashboards",
            host: {
              sourcePath: props.dashboardsVolumePath,
            },
          },
        ],
        // Define Grafana container
        containers: [
          {
            name: "grafana",
            image: ecs.ContainerImage.fromRegistry("grafana/grafana:latest"),
            containerPort: 3000,
            // hostPort not specified = dynamic port (0)
            // ECS will automatically register the dynamic port with the target group via loadBalancerTarget()
            memoryReservationMiB: props.memoryReservationMiB || 256,
            cpu: props.cpu,
            // Use awslogs driver - enables ECS console "Logs" tab
            logGroup: this.logGroup, // Use the log group created above
            logStreamPrefix: "grafana", // Log stream prefix for CloudWatch Logs
            environment: environment,
            user: "472:0", // Run as grafana user (472) with root group (0) for write access
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
      "grafana",
      {
        sourceVolume: "grafana-data",
        containerPath: "/var/lib/grafana",
        readOnly: false,
      },
      {
        sourceVolume: "grafana-provisioning",
        containerPath: "/etc/grafana/provisioning",
        readOnly: true,
      },
      {
        sourceVolume: "grafana-dashboards",
        containerPath: "/var/lib/grafana/dashboards",
        readOnly: true,
      }
    );

    // ========================================================================
    // 4. CREATE SERVICE USING EcsServiceConstruct
    // ========================================================================
    this.serviceConstruct = new EcsServiceConstruct(this, "Service", {
      cluster: props.cluster,
      taskDefinition: this.taskDefinition,
      envName: props.envName,
      serviceName: props.serviceName || `${props.envName}-grafana`,
      desiredCount: props.desiredCount || 1,

      // Deployment configuration
      // minHealthyPercent: 0 allows stopping old tasks even if new ones aren't healthy yet
      // This is critical for preventing credential exhaustion from old tasks
      minHealthyPercent: 0, // Allow stopping old tasks immediately
      maxHealthyPercent: 100, // Single instance (don't allow more than desired count)
      healthCheckGracePeriod: cdk.Duration.seconds(180), // Increased from 60s to 180s to allow Grafana time to start and initialize database

      // Enable circuit breaker
      enableCircuitBreaker: false,

      // Enable ECS Exec
      enableExecuteCommand: props.enableExecuteCommand,

      // No load balancer target (configured externally if needed)
      loadBalancerTarget: undefined,

      // No alarms by defauld (can be added externally)
      alarmConfig: undefined,
    });

    // Expose the service
    this.service = this.serviceConstruct.service;
  }

  /**
   *  Build Grafana environment variables
   */

  private buildEnvironment(
    props: GrafanaConstructProps
  ): Record<string, string> {
    const env: Record<string, string> = {
      // Admin credentials
      GF_SECURITY_ADMIN_USER: props.adminUser || "admin",
      GF_SECURITY_ADMIN_PASSWORD: props.adminPassword || "admin",

      // Server configuration for ALB sub-path
      GF_SERVER_ROOT_URL: props.rootUrl || "/grafana",
      GF_SERVER_SERVE_FROM_SUB_PATH: "true",

      // Security
      GF_USERS_ALLOW_SIGN_UP: "false",

      // Provisioning path
      GF_PATHS_PROVISIONING: "/etc/grafana/provisioning",

      // Data paths - ensure Grafana can write to these
      GF_PATHS_DATA: "/var/lib/grafana",
      GF_PATHS_PLUGINS: "/var/lib/grafana/plugins",
      GF_PATHS_LOGS: "/var/log/grafana",

      // Logging configuration - CRITICAL for awslogs driver
      // Output logs to STDOUT/STDERR so awslogs driver can capture them
      GF_LOG_MODE: "console", // Output logs to console (STDOUT/STDERR)
      GF_LOG_LEVEL: "info", // Set log level (debug, info, warn, error)

      // Plugins - CloudWatch plugin is built-in, no need to install
      // GF_INSTALL_PLUGINS: props.installPlugins || "",

      // Telemetry
      GF_ANALYTICS_REPORTING_ENABLED: "false",
      GF_METRICS_ENABLED: "false",

      // Force task definition update on each deployment
      // This ensures ECS creates a new task definition revision and deploys it
      DEPLOYMENT_TIMESTAMP: Date.now().toString(),
    };

    // Add AWs region if CloudWatch is enabled
    if (props.enableCloudWatch !== false) {
      env.AWS_REGION = props.awsRegion || cdk.Stack.of(this).region;
    }
    return env;
  }

  /**
   * Get the Grafana container port
   */
  public static readonly PORT = 3000;

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
    return this.taskDefConstruct.getContainer("grafana");
  }
}
