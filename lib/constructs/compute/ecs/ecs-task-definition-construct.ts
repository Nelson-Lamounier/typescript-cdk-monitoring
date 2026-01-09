/** @format */

import * as cdk from "aws-cdk-lib";
import * as ecs from "aws-cdk-lib/aws-ecs";
import { Tags } from "aws-cdk-lib";
import { NagSuppressions } from "cdk-nag";
import { Construct } from "constructs";

import {
  DEFAULT_ECS_TASK_HEALTHCHECK_INTERVAL_SECONDS,
  DEFAULT_ECS_TASK_HEALTHCHECK_RETRIES,
  DEFAULT_ECS_TASK_HEALTHCHECK_START_PERIOD_SECONDS,
  DEFAULT_ECS_TASK_HEALTHCHECK_TIMEOUT_SECONDS,
  DEFAULT_ECS_TASK_LOG_STREAM_PREFIX,
  DEFAULT_ECS_TASK_MEMORY_RESERVATION_MIB,
  DEFAULT_ECS_TASK_NETWORK_MODE_EC2,
} from "../../../shared/constants/compute-constants";
import {
  ContainerConfig,
  EcsLaunchType,
  EcsTaskDefinitionConstructProps,
} from "../../../shared/types";
import {
  validateContainers,
  validateEnvName,
  validateFargateResources,
} from "../../../shared/utils/validation";
import { EcsTaskExecutionRole } from "../../iam/ecs-task-execution-role";

/**
 * Reusable construct for creating ECS Task Definitions with containers
 * Supports multiple containers and flexible configuration
 */
export class EcsTaskDefinitionConstruct extends Construct {
  public readonly taskDefinition: ecs.TaskDefinition;
  public readonly containers: Map<string, ecs.ContainerDefinition>;

  constructor(
    scope: Construct,
    id: string,
    props: EcsTaskDefinitionConstructProps
  ) {
    super(scope, id);

    this.containers = new Map();

    validateEnvName(props.envName);
    validateContainers(props.containers);

    const launchType: EcsLaunchType = props.launchType ?? "EC2";
    validateFargateResources(launchType, props.cpu, props.memoryMiB);

    // Create or use provided execution role
    let executionRole = props.executionRole;
    if (!executionRole && props.grantEcrReadAccess !== false) {
      // Collect all log group ARNs from containers that specify them
      const logGroupArns = props.containers
        .map((c) => c.logGroup?.logGroupArn)
        .filter((arn): arn is string => arn !== undefined);

      // Use centralized ECS task execution role construct
      const executionRoleConstruct = new EcsTaskExecutionRole(
        this,
        "ExecutionRole",
        {
          envName: props.envName,
          enablePublicEcr: false, // Only enable if needed
          // If all containers use the same log group, pass it for more specific permissions
          // Otherwise, use the default pattern matching
          logGroupArn: logGroupArns.length === 1 ? logGroupArns[0] : undefined,
        }
      );
      executionRole = executionRoleConstruct.role;
    }

    // Create Task Definition
    if (launchType === "FARGATE") {
      const fargateCpu = props.cpu as number;
      const fargateMemoryMiB = props.memoryMiB as number;
      this.taskDefinition = new ecs.FargateTaskDefinition(this, "TaskDef", {
        cpu: fargateCpu,
        memoryLimitMiB: fargateMemoryMiB,
        taskRole: props.taskRole,
        executionRole: executionRole,
        ephemeralStorageGiB: props.ephemeralStorageGiB,
        runtimePlatform: props.runtimePlatform,
      });
    } else {
      this.taskDefinition = new ecs.Ec2TaskDefinition(this, "TaskDef", {
        networkMode:
          props.networkMode ||
          (DEFAULT_ECS_TASK_NETWORK_MODE_EC2 as ecs.NetworkMode.BRIDGE),
        taskRole: props.taskRole,
        executionRole: executionRole,
      });
    }

    // Add volumes if provided
    if (props.volumes) {
      props.volumes.forEach((volume) => {
        this.taskDefinition.addVolume(volume);
      });
    }

    // Add containers
    props.containers.forEach((containerConfig) => {
      this.addContainer(containerConfig, props.envName, launchType);
    });

    // Tag task definition
    Tags.of(this.taskDefinition).add("Environment", props.envName);
    Tags.of(this.taskDefinition).add("ManagedBy", "CDK");

    // CDK Nag suppressions for task definition
    if (this.taskDefinition.taskRole) {
      NagSuppressions.addResourceSuppressions(
        this.taskDefinition.taskRole,
        [
          {
            id: "AwsSolutions-IAM5",
            reason:
              "CloudWatch Logs permissions use wildcard for log streams within log groups. This allows ECS to create log streams dynamically for containers.",
            appliesTo: [
              "Resource::arn:aws:logs:*:*:log-group:*:*",
              "Resource::arn:aws:logs:*:*:log-group:<*>:*",
            ],
          },
        ],
        true
      );
    }
  }

  /**
   * Add a container to the task definition
   */
  private addContainer(
    config: ContainerConfig,
    _envName: string,
    _launchType: EcsLaunchType
  ): void {
    const logging = this.buildLogging(config);
    const linuxParameters = this.buildLinuxParameters(config);

    const container = this.taskDefinition.addContainer(config.name, {
      image: config.image,
      logging,
      memoryReservationMiB:
        config.memoryReservationMiB ?? DEFAULT_ECS_TASK_MEMORY_RESERVATION_MIB,
      memoryLimitMiB: config.memoryLimitMiB,
      cpu: config.cpu,
      environment: config.environment,
      environmentFiles: config.environmentFiles,
      secrets: config.secrets,
      command: config.command,
      entryPoint: config.entryPoint,
      user: config.user,
      healthCheck: this.buildHealthCheck(config),
      linuxParameters,
      ulimits: config.linuxParameters?.ulimits,
    });

    // Add port mapping only if containerPort is specified
    // For HOST and AWS_VPC modes, hostPort must equal containerPort
    if (config.containerPort !== undefined) {
      const networkMode = this.taskDefinition.networkMode;
      const hostPort =
        networkMode === ecs.NetworkMode.HOST ||
        networkMode === ecs.NetworkMode.AWS_VPC
          ? config.containerPort
          : config.hostPort ?? 0;

      container.addPortMappings({
        containerPort: config.containerPort,
        hostPort: hostPort,
        protocol: config.portProtocol ?? ecs.Protocol.TCP,
      });
    }

    if (config.dependencies) {
      config.dependencies.forEach((dep) => {
        const depContainer = this.containers.get(dep.containerName);
        if (!depContainer) {
          throw new Error(
            `Dependency container ${dep.containerName} not found`
          );
        }
        container.addContainerDependencies({
          container: depContainer,
          condition: dep.condition ?? ecs.ContainerDependencyCondition.START,
        });
      });
    }

    this.containers.set(config.name, container);
  }

  private buildLogging(config: ContainerConfig): ecs.LogDriver | undefined {
    const driver = config.logConfiguration?.driver ?? "awslogs";
    switch (driver) {
      case "awslogs":
        return ecs.LogDrivers.awsLogs({
          logGroup: config.logGroup,
          streamPrefix:
            config.logStreamPrefix ?? DEFAULT_ECS_TASK_LOG_STREAM_PREFIX,
          ...config.logConfiguration?.options,
        });
      case "fluentd":
        return ecs.LogDrivers.fluentd(config.logConfiguration?.options);
      case "splunk":
        if (!config.logConfiguration?.splunk) {
          throw new Error(
            "Splunk log driver requires 'splunk' configuration with url and token."
          );
        }
        return ecs.LogDrivers.splunk({
          url: config.logConfiguration.splunk.url,
          secretToken: config.logConfiguration.splunk.token,
          index: config.logConfiguration.splunk.index,
          source: config.logConfiguration.splunk.source,
          sourceType: config.logConfiguration.splunk.sourceType,
        });
      case "json-file":
        return ecs.LogDrivers.jsonFile(config.logConfiguration?.options);
      case "syslog":
        return ecs.LogDrivers.syslog(config.logConfiguration?.options);
      default:
        return ecs.LogDrivers.awsLogs({
          logGroup: config.logGroup,
          streamPrefix:
            config.logStreamPrefix ?? DEFAULT_ECS_TASK_LOG_STREAM_PREFIX,
        });
    }
  }

  private buildHealthCheck(
    config: ContainerConfig
  ): ecs.HealthCheck | undefined {
    if (!config.healthCheck) {
      return undefined;
    }
    return {
      command: config.healthCheck.command,
      interval: cdk.Duration.seconds(
        config.healthCheck.intervalSeconds ??
          DEFAULT_ECS_TASK_HEALTHCHECK_INTERVAL_SECONDS
      ),
      timeout: cdk.Duration.seconds(
        config.healthCheck.timeoutSeconds ??
          DEFAULT_ECS_TASK_HEALTHCHECK_TIMEOUT_SECONDS
      ),
      retries:
        config.healthCheck.retries ?? DEFAULT_ECS_TASK_HEALTHCHECK_RETRIES,
      startPeriod: cdk.Duration.seconds(
        config.healthCheck.startPeriodSeconds ??
          DEFAULT_ECS_TASK_HEALTHCHECK_START_PERIOD_SECONDS
      ),
    };
  }

  private buildLinuxParameters(
    config: ContainerConfig
  ): ecs.LinuxParameters | undefined {
    if (!config.linuxParameters) {
      return undefined;
    }

    const lp = new ecs.LinuxParameters(this, `${config.name}LinuxParams`, {
      initProcessEnabled: config.linuxParameters.initProcessEnabled,
      sharedMemorySize: config.linuxParameters.sharedMemorySize,
      maxSwap: config.linuxParameters.maxSwap
        ? cdk.Size.mebibytes(config.linuxParameters.maxSwap)
        : undefined,
      swappiness: config.linuxParameters.swappiness,
    });

    if (config.linuxParameters.capabilities?.add) {
      lp.addCapabilities(...config.linuxParameters.capabilities.add);
    }
    if (config.linuxParameters.capabilities?.drop) {
      lp.dropCapabilities(...config.linuxParameters.capabilities.drop);
    }

    if (config.linuxParameters.devices) {
      config.linuxParameters.devices.forEach((d) => lp.addDevices(d));
    }

    if (config.linuxParameters.tmpfs) {
      config.linuxParameters.tmpfs.forEach((t) => lp.addTmpfs(t));
    }

    return lp;
  }

  /**
   * Get a specific container by name
   */
  public getContainer(name: string): ecs.ContainerDefinition | undefined {
    return this.containers.get(name);
  }

  /**
   * Add mount points to a specific container
   */
  public addMountPoints(
    containerName: string,
    ...mountPoints: ecs.MountPoint[]
  ): void {
    const container = this.containers.get(containerName);
    if (!container) {
      throw new Error(`Container ${containerName} not found`);
    }
    container.addMountPoints(...mountPoints);
  }
}
