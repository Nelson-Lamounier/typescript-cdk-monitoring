/** @format */

import * as cdk from "aws-cdk-lib";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";

import { EcsTaskDefinitionConstruct } from "../../../constructs/compute/ecs/ecs-task-definition-construct";
import { EcsServiceConstruct } from "../../../constructs/compute/ecs/ecs-service-construct";
import {
  DEFAULT_GRAFANA_CONTAINER_PORT,
  DEFAULT_GRAFANA_CPU_MIB,
  DEFAULT_GRAFANA_DESIRED_COUNT,
  DEFAULT_GRAFANA_HEALTH_GRACE_SECONDS,
  DEFAULT_GRAFANA_IMAGE,
  DEFAULT_GRAFANA_LOG_RETENTION,
  DEFAULT_GRAFANA_MAX_HEALTHY_PERCENT,
  DEFAULT_GRAFANA_MEMORY_MIB,
  DEFAULT_GRAFANA_MIN_HEALTHY_PERCENT,
  DEFAULT_GRAFANA_PLUGINS,
  DEFAULT_GRAFANA_ROOT_URL,
  DEFAULT_GRAFANA_SERVICE_NAME_SUFFIX,
} from "../../../shared/constants/service-constants";
import { GrafanaServiceConstructProps } from "../../../shared/types/service-types";
import {
  validateAdminPasswordSecretArn,
  validateClusterProvided,
  validateEnvName,
  validateGrafanaVolumes,
  validateLogGroupNameOptional,
} from "../../../shared/utils/validation";

export class GrafanaServiceConstruct extends Construct {
  public readonly service: ecs.BaseService;
  public readonly taskDefinition: ecs.TaskDefinition;
  public readonly logGroup: logs.ILogGroup;

  constructor(
    scope: Construct,
    id: string,
    props: GrafanaServiceConstructProps
  ) {
    super(scope, id);

    validateEnvName(props.envName);
    validateClusterProvided(props.cluster);
    validateAdminPasswordSecretArn(props.adminPasswordSecretArn);
    validateGrafanaVolumes(props);

    const launchType = props.launchType ?? "EC2";
    const isFargate = launchType === "FARGATE";

    const logGroupName =
      props.logGroupKmsKey || props.logRetention || props.projectName
        ? `/ecs/${props.projectName ?? props.envName}-grafana`
        : `/ecs/${props.envName}-grafana`;

    validateLogGroupNameOptional(logGroupName);

    this.logGroup = new logs.LogGroup(this, "LogGroup", {
      logGroupName,
      retention: props.logRetention ?? DEFAULT_GRAFANA_LOG_RETENTION,
      encryptionKey: props.logGroupKmsKey,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const adminSecret = secretsmanager.Secret.fromSecretCompleteArn(
      this,
      "AdminPasswordSecret",
      props.adminPasswordSecretArn
    );

    const containerName = "grafana";

    const volumes: ecs.Volume[] = [];
    const mountPoints: ecs.MountPoint[] = [];

    const addVolume = (
      name: string,
      volumeConfig: GrafanaServiceConstructProps["dataVolume"]
    ) => {
      if (!volumeConfig) {
        return;
      }
      if (volumeConfig.efs) {
        volumes.push({
          name,
          efsVolumeConfiguration: {
            fileSystemId: volumeConfig.efs.fileSystem.fileSystemId,
            transitEncryption: "ENABLED",
            authorizationConfig: {
              accessPointId: volumeConfig.efs.accessPoint?.accessPointId,
            },
          },
        });
        mountPoints.push({
          containerPath: volumeMountPath(name),
          sourceVolume: name,
          readOnly: volumeConfig.efs.readOnly ?? false,
        });
      } else if (volumeConfig.hostPath) {
        volumes.push({
          name,
          host: {
            sourcePath: volumeConfig.hostPath,
          },
        });
        mountPoints.push({
          containerPath: volumeMountPath(name),
          sourceVolume: name,
          readOnly: false,
        });
      }
    };

    const volumeMountPath = (name: string): string => {
      switch (name) {
        case "grafana-data":
          return "/var/lib/grafana";
        case "grafana-provisioning":
          return "/etc/grafana/provisioning";
        case "grafana-dashboards":
          return "/var/lib/grafana/dashboards";
        default:
          return "/";
      }
    };

    addVolume("grafana-data", props.dataVolume);
    addVolume("grafana-provisioning", props.provisioningVolume);
    addVolume("grafana-dashboards", props.dashboardsVolume);

    const cpu = props.cpu ?? DEFAULT_GRAFANA_CPU_MIB;
    const memoryMiB = props.memoryMiB ?? DEFAULT_GRAFANA_MEMORY_MIB;

    const taskDefinitionConstruct = new EcsTaskDefinitionConstruct(
      this,
      "TaskDefinition",
      {
        envName: props.envName,
        launchType,
        networkMode: isFargate ? ecs.NetworkMode.AWS_VPC : undefined,
        cpu: isFargate ? cpu : undefined,
        memoryMiB: isFargate ? memoryMiB : undefined,
        taskRole: props.cluster.defaultCloudMapNamespace
          ? undefined
          : undefined,
        executionRole: undefined,
        volumes,
        containers: [
          {
            name: containerName,
            image: ecs.ContainerImage.fromRegistry(DEFAULT_GRAFANA_IMAGE),
            containerPort: props.containerPort ?? DEFAULT_GRAFANA_CONTAINER_PORT,
            cpu: isFargate ? cpu : props.cpu,
            memoryLimitMiB: isFargate ? undefined : memoryMiB,
            memoryReservationMiB: isFargate ? undefined : memoryMiB,
            logGroup: this.logGroup,
            logStreamPrefix: "grafana",
            environment: {
              GF_SECURITY_ADMIN_USER:
                props.adminUser ?? "admin",
              GF_SERVER_ROOT_URL: props.rootUrl ?? DEFAULT_GRAFANA_ROOT_URL,
              GF_SERVER_SERVE_FROM_SUB_PATH: "true",
              GF_USERS_ALLOW_SIGN_UP: "false",
              GF_PATHS_PROVISIONING: "/etc/grafana/provisioning",
              GF_PATHS_DATA: "/var/lib/grafana",
              GF_PATHS_PLUGINS: "/var/lib/grafana/plugins",
              GF_PATHS_LOGS: "/var/log/grafana",
              GF_LOG_MODE: "console",
              GF_LOG_LEVEL: "info",
              GF_INSTALL_PLUGINS: props.installPlugins ?? DEFAULT_GRAFANA_PLUGINS,
            },
            secrets: {
              GF_SECURITY_ADMIN_PASSWORD: ecs.Secret.fromSecretsManager(
                adminSecret
              ),
            },
            portProtocol: ecs.Protocol.TCP,
          },
        ],
      }
    );

    this.taskDefinition = taskDefinitionConstruct.taskDefinition;

    if (mountPoints.length > 0) {
      taskDefinitionConstruct.addMountPoints(containerName, ...mountPoints);
    }

    this.service = new EcsServiceConstruct(this, "Service", {
      cluster: props.cluster,
      taskDefinition: this.taskDefinition,
      envName: props.envName,
      projectName: props.projectName,
      serviceName:
        props.serviceName ??
        `${props.envName}-${DEFAULT_GRAFANA_SERVICE_NAME_SUFFIX}`,
      desiredCount: props.desiredCount ?? DEFAULT_GRAFANA_DESIRED_COUNT,
      minHealthyPercent:
        props.minHealthyPercent ?? DEFAULT_GRAFANA_MIN_HEALTHY_PERCENT,
      maxHealthyPercent:
        props.maxHealthyPercent ?? DEFAULT_GRAFANA_MAX_HEALTHY_PERCENT,
      healthCheckGracePeriod:
        props.healthCheckGracePeriod ??
        cdk.Duration.seconds(DEFAULT_GRAFANA_HEALTH_GRACE_SECONDS),
      enableExecuteCommand: props.enableExecuteCommand,
      loadBalancerTargets: props.loadBalancerTarget
        ? [props.loadBalancerTarget]
        : undefined,
      scalingConfig: props.scalingConfig,
      networkConfiguration: props.networkConfiguration,
      launchType,
    }).service;

    if (launchType === "FARGATE" && !props.networkConfiguration) {
      cdk.Annotations.of(this).addWarning(
        "Fargate services require awsvpc networking; ensure networkConfiguration is provided with subnets and security groups."
      );
    }

    if (props.desiredCount === 1) {
      cdk.Annotations.of(this).addWarning(
        "Grafana is running with a single task. Consider at least two tasks for high availability."
      );
    }
  }
}
