/** @format */

import * as cdk from "aws-cdk-lib";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as logs from "aws-cdk-lib/aws-logs";
import { Tags } from "aws-cdk-lib";
import { Construct } from "constructs";

import { EcsTaskExecutionRole } from "../../iam";

export interface NodeExporterConstructProps {
  cluster: ecs.ICluster;
  envName: string;
  serviceName?: string;
  memoryReservationMiB?: number;
  logRetention?: logs.RetentionDays;
  enableExecuteCommand?: boolean;
}

/**
 * Reusable construct for deploying Prometheus Node Exporter
 * Collects system-level metrics from ECS EC2 instances
 */
export class NodeExporterConstruct extends Construct {
  public readonly service: ecs.Ec2Service;
  public readonly taskDefinition: ecs.Ec2TaskDefinition;
  public readonly logGroup: logs.LogGroup;

  constructor(scope: Construct, id: string, props: NodeExporterConstructProps) {
    super(scope, id);

    // Create log group
    this.logGroup = new logs.LogGroup(this, "LogGroup", {
      logGroupName: `/ecs/${props.envName}-node-exporter`,
      retention: props.logRetention || logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Use centralized ECS task execution role construct with CloudWatch Logs permissions
    const executionRoleConstruct = new EcsTaskExecutionRole(
      this,
      "ExecutionRole",
      {
        envName: props.envName,
        enablePublicEcr: true, // Node Exporter uses public Docker Hub image
        logGroupArn: this.logGroup.logGroupArn, // Grants CloudWatch Logs permissions
      }
    );
    const executionRole = executionRoleConstruct.role;

    // Create task definition with HOST network mode
    this.taskDefinition = new ecs.Ec2TaskDefinition(this, "TaskDef", {
      networkMode: ecs.NetworkMode.HOST,
      executionRole: executionRole,
    });

    // Add volumes for host metrics collection
    this.taskDefinition.addVolume({
      name: "proc",
      host: { sourcePath: "/proc" },
    });
    this.taskDefinition.addVolume({
      name: "sys",
      host: { sourcePath: "/sys" },
    });
    this.taskDefinition.addVolume({
      name: "rootfs",
      host: { sourcePath: "/" },
    });

    // Add Node Exporter container
    const container = this.taskDefinition.addContainer("node-exporter", {
      image: ecs.ContainerImage.fromRegistry("prom/node-exporter:latest"),
      memoryReservationMiB: props.memoryReservationMiB || 64,
      // Use awslogs driver - enables ECS console "Logs" tab
      logging: ecs.LogDrivers.awsLogs({
        logGroup: this.logGroup,
        streamPrefix: "node-exporter",
      }),
      environment: {
        // Logging configuration - CRITICAL for awslogs driver
        // Node Exporter outputs to STDOUT/STDERR by default
        // The awslogs driver captures STDOUT/STDERR automatically
        // No additional configuration needed - Node Exporter logs to console by default
        // Force task definition update on each deployment
        // This ensures ECS creates a new task definition revision and deploys it
        DEPLOYMENT_TIMESTAMP: Date.now().toString(),
      },
      command: [
        "--path.procfs=/host/proc",
        "--path.sysfs=/host/sys",
        "--path.rootfs=/rootfs",
        "--collector.filesystem.mount-points-exclude=^/(sys|proc|dev|host|etc)($|/)",
      ],
    });

    // Add port mapping
    container.addPortMappings({
      containerPort: 9100,
      hostPort: 9100,
      protocol: ecs.Protocol.TCP,
    });

    // Add mount points
    container.addMountPoints(
      {
        sourceVolume: "proc",
        containerPath: "/host/proc",
        readOnly: true,
      },
      {
        sourceVolume: "sys",
        containerPath: "/host/sys",
        readOnly: true,
      },
      {
        sourceVolume: "rootfs",
        containerPath: "/rootfs",
        readOnly: true,
      }
    );

    // Create service with DAEMON scheduling strategy
    // This ensures exactly ONE Node Exporter per EC2 instance
    // Prevents port conflicts when using HOST network mode
    this.service = new ecs.Ec2Service(this, "Service", {
      cluster: props.cluster,
      taskDefinition: this.taskDefinition,
      serviceName: props.serviceName || `${props.envName}-node-exporter`,

      // DAEMON strategy: One task per EC2 instance (no desiredCount needed)
      // This prevents port 9100 conflicts
      daemon: true,

      enableExecuteCommand: props.enableExecuteCommand,

      // Deployment configuration for daemon services
      minHealthyPercent: 0, // Allow stopping all tasks during deployment
      maxHealthyPercent: 100, // Only one task per instance
    });

    // Grant CloudWatch Logs write permissions to execution role
    // This is required for the awslogs driver to create log streams and put log events
    this.logGroup.grantWrite(executionRole);

    // Tag resources
    Tags.of(this.service).add("Environment", props.envName);
    Tags.of(this.service).add("ManagedBy", "CDK");
    Tags.of(this.service).add("Service", "NodeExporter");
    Tags.of(this.taskDefinition).add("Environment", props.envName);
    Tags.of(this.taskDefinition).add("ManagedBy", "CDK");
  }

  /**
   * Get the port number for Node Exporter
   */
  public static readonly PORT = 9100;
}
