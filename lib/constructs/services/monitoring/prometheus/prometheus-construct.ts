/** @format */

import * as cdk from "aws-cdk-lib";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as logs from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";

import { EcsServiceConstruct } from "../../../compute/ecs/ecs-service-construct";
import { EcsTaskDefinitionConstruct } from "../../../compute/ecs/ecs-task-definition-construct";
import {
  DEFAULT_ALERTMANAGER_IMAGE,
  DEFAULT_ALERTMANAGER_PORT,
  DEFAULT_PROMETHEUS_CPU_MIB,
  DEFAULT_PROMETHEUS_DESIRED_COUNT,
  DEFAULT_PROMETHEUS_HEALTH_GRACE_SECONDS,
  DEFAULT_PROMETHEUS_IMAGE,
  DEFAULT_PROMETHEUS_LOG_RETENTION,
  DEFAULT_PROMETHEUS_MAX_HEALTHY_PERCENT,
  DEFAULT_PROMETHEUS_MEMORY_MIB,
  DEFAULT_PROMETHEUS_MIN_HEALTHY_PERCENT,
  DEFAULT_PROMETHEUS_PORT,
  DEFAULT_PROMETHEUS_SERVICE_NAME_SUFFIX,
} from "../../../../shared/constants/service-constants";
import { PrometheusServiceConstructProps } from "../../../../shared/types/service-types";
import {
  validateClusterProvided,
  validateEnvName,
  validateLogGroupNameOptional,
} from "../../../../shared/utils/validation";

import { buildPrometheusConfig } from "./prometheus-config-builder";

export class PrometheusConstruct extends Construct {
  public readonly service: ecs.BaseService;
  public readonly taskDefinition: ecs.TaskDefinition;
  public readonly logGroup: logs.ILogGroup;

  private readonly taskDefConstruct: EcsTaskDefinitionConstruct;

  constructor(
    scope: Construct,
    id: string,
    props: PrometheusServiceConstructProps
  ) {
    super(scope, id);

    validateEnvName(props.envName);
    validateClusterProvided(props.cluster);

    const launchType = props.launchType ?? "EC2";

    // Validate host path volumes are not used with Fargate
    if (launchType === "FARGATE") {
      if (props.dataVolume?.hostPath || props.configVolume?.hostPath) {
        throw new Error(
          "Host path volumes are not supported for Fargate. Use EFS volumes instead."
        );
      }
    }
    const isFargate = launchType === "FARGATE";

    const logGroupName = `/ecs/${
      props.projectName ?? props.envName
    }-prometheus`;
    validateLogGroupNameOptional(logGroupName);

    this.logGroup = new logs.LogGroup(this, "LogGroup", {
      logGroupName,
      retention: props.logRetention ?? DEFAULT_PROMETHEUS_LOG_RETENTION,
      encryptionKey: props.logGroupKmsKey,
      removalPolicy:
        props.envName === "production"
          ? cdk.RemovalPolicy.RETAIN
          : cdk.RemovalPolicy.DESTROY,
    });

    const configArtifacts = buildPrometheusConfig(props);

    const volumes: ecs.Volume[] = [];
    const mountPoints: ecs.MountPoint[] = [];

    const addVolume = (
      name: string,
      cfg: PrometheusServiceConstructProps["dataVolume"],
      containerPath: string,
      readOnly: boolean
    ) => {
      if (!cfg) return;
      if (cfg.efs) {
        volumes.push({
          name,
          efsVolumeConfiguration: {
            fileSystemId: cfg.efs.fileSystem.fileSystemId,
            transitEncryption: "ENABLED",
            authorizationConfig: {
              accessPointId: cfg.efs.accessPoint?.accessPointId,
            },
          },
        });
        mountPoints.push({
          sourceVolume: name,
          containerPath,
          readOnly: cfg.efs.readOnly ?? readOnly,
        });
      } else if (cfg.hostPath) {
        volumes.push({
          name,
          host: { sourcePath: cfg.hostPath },
        });
        mountPoints.push({
          sourceVolume: name,
          containerPath,
          readOnly,
        });
      }
    };

    addVolume("prometheus-data", props.dataVolume, "/prometheus", false);
    addVolume(
      "prometheus-config",
      props.configVolume ?? props.dataVolume,
      "/etc/prometheus",
      true
    );

    const cpu = props.cpu ?? DEFAULT_PROMETHEUS_CPU_MIB;
    const memoryMiB = props.memoryMiB ?? DEFAULT_PROMETHEUS_MEMORY_MIB;

    this.taskDefConstruct = new EcsTaskDefinitionConstruct(
      this,
      "TaskDefinition",
      {
        envName: props.envName,
        launchType,
        networkMode: isFargate ? ecs.NetworkMode.AWS_VPC : undefined,
        cpu: isFargate ? cpu : undefined,
        memoryMiB: isFargate ? memoryMiB : undefined,
        grantEcrReadAccess: false,
        volumes,
        containers: [
          {
            name: "prometheus",
            image: ecs.ContainerImage.fromRegistry(DEFAULT_PROMETHEUS_IMAGE),
            containerPort: props.containerPort ?? DEFAULT_PROMETHEUS_PORT,
            cpu: isFargate ? cpu : props.cpu,
            memoryLimitMiB: isFargate ? undefined : memoryMiB,
            memoryReservationMiB: isFargate ? undefined : memoryMiB,
            command: configArtifacts.command,
            logGroup: this.logGroup,
            logStreamPrefix: "prometheus",
            environment: {
              ENVIRONMENT: props.envName,
            },
            portProtocol: ecs.Protocol.TCP,
          },
        ],
      }
    );

    this.taskDefinition = this.taskDefConstruct.taskDefinition;

    if (mountPoints.length > 0) {
      this.taskDefConstruct.addMountPoints("prometheus", ...mountPoints);
    }

    if (props.alertmanager) {
      this.taskDefinition.addContainer("alertmanager", {
        image: ecs.ContainerImage.fromRegistry(
          props.alertmanager.image ?? DEFAULT_ALERTMANAGER_IMAGE
        ),
        portMappings: [
          {
            containerPort: props.alertmanager.port ?? DEFAULT_ALERTMANAGER_PORT,
            hostPort: props.alertmanager.port ?? DEFAULT_ALERTMANAGER_PORT,
            protocol: ecs.Protocol.TCP,
          },
        ],
        command: props.alertmanager.configContent
          ? [
              "/bin/sh",
              "-c",
              `cat <<'EOF' >/etc/alertmanager/alertmanager.yml\n${props.alertmanager.configContent}\nEOF\nexec /bin/alertmanager --config.file=/etc/alertmanager/alertmanager.yml`,
            ]
          : undefined,
        logging: ecs.LogDriver.awsLogs({
          logGroup: this.logGroup,
          streamPrefix: "alertmanager",
        }),
      });
    }

    this.service = new EcsServiceConstruct(this, "Service", {
      cluster: props.cluster,
      taskDefinition: this.taskDefinition,
      envName: props.envName,
      projectName: props.projectName,
      serviceName:
        props.serviceName ??
        `${props.envName}-${DEFAULT_PROMETHEUS_SERVICE_NAME_SUFFIX}`,
      desiredCount: props.desiredCount ?? DEFAULT_PROMETHEUS_DESIRED_COUNT,
      minHealthyPercent:
        props.minHealthyPercent ?? DEFAULT_PROMETHEUS_MIN_HEALTHY_PERCENT,
      maxHealthyPercent:
        props.maxHealthyPercent ?? DEFAULT_PROMETHEUS_MAX_HEALTHY_PERCENT,
      healthCheckGracePeriod:
        props.healthCheckGracePeriod ??
        cdk.Duration.seconds(DEFAULT_PROMETHEUS_HEALTH_GRACE_SECONDS),
      enableExecuteCommand: props.enableExecuteCommand,
      enableCircuitBreaker: props.enableCircuitBreaker,
      loadBalancerTargets: props.loadBalancerTarget
        ? [props.loadBalancerTarget]
        : undefined,
      networkConfiguration: props.networkConfiguration,
      launchType,
    }).service;

    if (isFargate && !props.networkConfiguration) {
      cdk.Annotations.of(this).addWarning(
        "Fargate requires awsvpc networking; provide subnets and security groups."
      );
    }

    if (props.desiredCount === 1) {
      cdk.Annotations.of(this).addWarning(
        "Prometheus is running with a single task. Consider multiple tasks for HA."
      );
    }
  }
}
