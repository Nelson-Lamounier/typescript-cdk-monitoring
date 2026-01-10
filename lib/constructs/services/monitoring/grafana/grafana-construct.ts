/** @format */

import * as cdk from "aws-cdk-lib";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";

import { EcsServiceConstruct } from "../../../compute/ecs/ecs-service-construct";
import { EcsTaskDefinitionConstruct } from "../../../compute/ecs/ecs-task-definition-construct";
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
  DEFAULT_GRAFANA_SERVICE_NAME_SUFFIX,
} from "../../../../shared/constants/service-constants";
import {
  GrafanaDatasourceConfig,
  GrafanaServiceConstructProps,
} from "../../../../shared/types/service-types";
import {
  validateAdminPasswordSecretArn,
  validateClusterProvided,
  validateEnvName,
  validateGrafanaVolumes,
  validateLogGroupNameOptional,
} from "../../../../shared/utils/validation";

import {
  buildGrafanaEnvironment,
  generateDashboardProvisioningYaml,
  generateDatasourceProvisioningYaml,
} from "./grafana-config-builder";

export class GrafanaServiceConstruct extends Construct {
  public readonly service: ecs.BaseService;
  public readonly taskDefinition: ecs.TaskDefinition;
  public readonly logGroup: logs.ILogGroup;
  public readonly datasourceProvisioning?: string;
  public readonly dashboardProvisioning?: string;

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
      removalPolicy:
        props.envName === "production"
          ? cdk.RemovalPolicy.RETAIN
          : cdk.RemovalPolicy.DESTROY,
    });

    // Lookup secret by name
    // The adminPasswordSecretArn property can be either:
    // - A secret name (e.g., "grafana-admin-password")
    // - A complete ARN with the 6-character suffix
    const adminSecret = props.adminPasswordSecretArn.startsWith("arn:")
      ? secretsmanager.Secret.fromSecretCompleteArn(
          this,
          "AdminPasswordSecret",
          props.adminPasswordSecretArn
        )
      : secretsmanager.Secret.fromSecretNameV2(
          this,
          "AdminPasswordSecret",
          props.adminPasswordSecretArn
        );
    const adminSecretForEcs = ecs.Secret.fromSecretsManager(adminSecret);

    const smtpSecret = props.smtp?.passwordArn
      ? ecs.Secret.fromSecretsManager(
          secretsmanager.Secret.fromSecretCompleteArn(
            this,
            "GrafanaSmtpSecret",
            props.smtp.passwordArn
          )
        )
      : undefined;

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

    this.datasourceProvisioning = generateDatasourceProvisioningYaml(
      props.datasources as GrafanaDatasourceConfig[] | undefined
    );
    this.dashboardProvisioning = generateDashboardProvisioningYaml(undefined);

    const grafanaEnv = buildGrafanaEnvironment(
      props,
      adminSecretForEcs,
      smtpSecret
    );

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
            containerPort:
              props.containerPort ?? DEFAULT_GRAFANA_CONTAINER_PORT,
            cpu: isFargate ? cpu : props.cpu,
            memoryLimitMiB: isFargate ? undefined : memoryMiB,
            memoryReservationMiB: isFargate ? undefined : memoryMiB,
            logGroup: this.logGroup,
            logStreamPrefix: "grafana",
            environment: grafanaEnv.environment,
            secrets: grafanaEnv.secrets,
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
