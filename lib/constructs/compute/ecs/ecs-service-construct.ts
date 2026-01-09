/** @format */

import * as cdk from "aws-cdk-lib";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as cw from "aws-cdk-lib/aws-cloudwatch";
import { Tags } from "aws-cdk-lib";
import { Construct } from "constructs";

import {
  DEFAULT_ECS_SERVICE_AUTOSCALE_MAX_CAPACITY,
  DEFAULT_ECS_SERVICE_AUTOSCALE_MIN_CAPACITY,
  DEFAULT_ECS_SERVICE_DESIRED_COUNT,
  DEFAULT_ECS_SERVICE_HEALTH_GRACE_SECONDS,
  DEFAULT_ECS_SERVICE_MAX_HEALTHY_PERCENT,
  DEFAULT_ECS_SERVICE_MIN_HEALTHY_PERCENT,
} from "../../../shared/constants/compute-constants";
import {
  EcsServiceConstructProps,
  LoadBalancerTargetConfig,
  ServiceAlarmConfig,
} from "../../../shared/types";
import {
  validateCapacityOrder,
  validateClusterProvided,
  validateDesiredCount,
  validateDeploymentPercentages,
  validateEnvName,
} from "../../../shared/utils/validation";

/**
 * Reusable construct for creating ECS Services
 * Handles service configuration, load balancer attachment, and alarms
 */
export class EcsServiceConstruct extends Construct {
  public readonly service: ecs.BaseService;
  public cpuAlarm?: cw.Alarm;
  public memoryAlarm?: cw.Alarm;

  constructor(scope: Construct, id: string, props: EcsServiceConstructProps) {
    super(scope, id);

    validateEnvName(props.envName);
    validateClusterProvided(props.cluster);
    validateDesiredCount(props.desiredCount);

    const minHealthy =
      props.minHealthyPercent ?? DEFAULT_ECS_SERVICE_MIN_HEALTHY_PERCENT;
    const maxHealthy =
      props.maxHealthyPercent ?? DEFAULT_ECS_SERVICE_MAX_HEALTHY_PERCENT;
    validateDeploymentPercentages(minHealthy, maxHealthy);

    const desiredCount =
      props.desiredCount ?? DEFAULT_ECS_SERVICE_DESIRED_COUNT;

    const isFargate =
      props.launchType === "FARGATE" ||
      props.taskDefinition instanceof ecs.FargateTaskDefinition;

    if (isFargate) {
      const assignPublicIpSetting =
        props.networkConfiguration?.awsvpcConfiguration?.assignPublicIp;
      const assignPublicIp =
        typeof assignPublicIpSetting === "string"
          ? assignPublicIpSetting === "ENABLED"
          : assignPublicIpSetting;

      this.service = new ecs.FargateService(this, "Service", {
        cluster: props.cluster,
        taskDefinition: props.taskDefinition,
        desiredCount,
        serviceName: props.serviceName || `ecs-service-${props.envName}`,
        circuitBreaker: {
          enable: props.enableCircuitBreaker !== false,
          rollback: props.enableCircuitBreaker !== false,
        },
        minHealthyPercent: minHealthy,
        maxHealthyPercent: maxHealthy,
        healthCheckGracePeriod:
          props.healthCheckGracePeriod ||
          cdk.Duration.seconds(DEFAULT_ECS_SERVICE_HEALTH_GRACE_SECONDS),
        enableExecuteCommand: props.enableExecuteCommand,
        deploymentController: props.deploymentController,
        deploymentAlarms: props.deploymentAlarms,
        cloudMapOptions: props.cloudMapOptions,
        assignPublicIp,
        securityGroups:
          props.networkConfiguration?.awsvpcConfiguration?.securityGroups?.map(
            (sg) => ec2.SecurityGroup.fromSecurityGroupId(this, `Sg${sg}`, sg)
          ),
        vpcSubnets: props.networkConfiguration?.awsvpcConfiguration?.subnets
          ? {
              subnets: props.networkConfiguration.awsvpcConfiguration.subnets.map(
                (subnetId, index) =>
                  ec2.Subnet.fromSubnetId(this, `Subnet${index}${subnetId}`, subnetId)
              ),
            }
          : undefined,
      });
    } else {
      this.service = new ecs.Ec2Service(this, "Service", {
        cluster: props.cluster,
        taskDefinition: props.taskDefinition,
        desiredCount,
        serviceName: props.serviceName || `ecs-service-${props.envName}`,
        circuitBreaker: {
          enable: props.enableCircuitBreaker !== false,
          rollback: props.enableCircuitBreaker !== false,
        },
        minHealthyPercent: minHealthy,
        maxHealthyPercent: maxHealthy,
        healthCheckGracePeriod:
          props.healthCheckGracePeriod ||
          cdk.Duration.seconds(DEFAULT_ECS_SERVICE_HEALTH_GRACE_SECONDS),
        enableExecuteCommand: props.enableExecuteCommand,
        deploymentController: props.deploymentController,
        deploymentAlarms: props.deploymentAlarms,
        cloudMapOptions: props.cloudMapOptions,
        capacityProviderStrategies: props.capacityProviderStrategies,
        placementStrategies: props.placementStrategies,
      });
    }

    // Attach to load balancer if configured
    if (props.loadBalancerTargets) {
      props.loadBalancerTargets.forEach((target) =>
        this.attachToLoadBalancer(target)
      );
    }

    // Create alarms if configured
    if (props.alarmConfig?.enabled) {
      this.createAlarms(props.alarmConfig, props.envName);
    }

    // Tag service
    Tags.of(this.service).add("Environment", props.envName);
    Tags.of(this.service).add("ManagedBy", "CDK");
    Tags.of(this.service).add("Service", "ECS");
    if (props.projectName) {
      Tags.of(this.service).add("Project", props.projectName);
    }

    if (
      (props.envName === "production" || props.envName === "prod") &&
      desiredCount < 2
    ) {
      cdk.Annotations.of(this).addWarning(
        "Desired task count is below 2 in production. Consider running at least two tasks for availability."
      );
    }

    if (minHealthy < 50) {
      cdk.Annotations.of(this).addWarning(
        "minHealthyPercent is low. Values under 50 can cause downtime during deployments."
      );
    }

    this.configureAutoScaling(props);
  }

  /**
   * Attach service to load balancer target group
   */
  private attachToLoadBalancer(config: LoadBalancerTargetConfig): void {
    config.targetGroup.addTarget(
      this.service.loadBalancerTarget({
        containerName: config.containerName,
        containerPort: config.containerPort,
      })
    );
  }

  /**
   * Create CloudWatch alarms for the service
   */
  private createAlarms(config: ServiceAlarmConfig, envName: string): void {
    const alarmNames: string[] = [];

    // CPU Alarm
    if (config.cpuThreshold !== undefined) {
      const cpuAlarmName = `${envName}-ECS-CPU-Alarm`;
      this.cpuAlarm = new cw.Alarm(this, "CPUAlarm", {
        alarmName: cpuAlarmName,
        metric: this.service.metricCpuUtilization(),
        threshold: config.cpuThreshold,
        evaluationPeriods: 2,
        comparisonOperator: cw.ComparisonOperator.GREATER_THAN_THRESHOLD,
      });
      alarmNames.push(cpuAlarmName);
    }

    // Memory Alarm
    if (config.memoryThreshold !== undefined) {
      const memoryAlarmName = `${envName}-ECS-Memory-Alarm`;
      this.memoryAlarm = new cw.Alarm(this, "MemoryAlarm", {
        alarmName: memoryAlarmName,
        metric: this.service.metricMemoryUtilization(),
        threshold: config.memoryThreshold,
        evaluationPeriods: 2,
        comparisonOperator: cw.ComparisonOperator.GREATER_THAN_THRESHOLD,
      });
      alarmNames.push(memoryAlarmName);
    }

    // Enable deployment alarms if any alarms were created
    if (alarmNames.length > 0) {
      this.service.enableDeploymentAlarms(alarmNames, {
        behavior: config.alarmBehavior ?? ecs.AlarmBehavior.ROLLBACK_ON_ALARM,
      });
    }
  }

  /**
   * Enable auto scaling for the service
   */
  private configureAutoScaling(props: EcsServiceConstructProps): void {
    if (!props.scalingConfig) return;

    const min =
      props.scalingConfig.minCapacity ??
      DEFAULT_ECS_SERVICE_AUTOSCALE_MIN_CAPACITY;
    const max =
      props.scalingConfig.maxCapacity ??
      DEFAULT_ECS_SERVICE_AUTOSCALE_MAX_CAPACITY;
    validateCapacityOrder(min, min, max);

    const scaling = this.service.autoScaleTaskCount({
      minCapacity: min,
      maxCapacity: max,
    });

    if (props.scalingConfig.cpuTargetUtilizationPercent !== undefined) {
      scaling.scaleOnCpuUtilization("CpuScaling", {
        targetUtilizationPercent:
          props.scalingConfig.cpuTargetUtilizationPercent,
      });
    }

    if (props.scalingConfig.memoryTargetUtilizationPercent !== undefined) {
      scaling.scaleOnMemoryUtilization("MemoryScaling", {
        targetUtilizationPercent:
          props.scalingConfig.memoryTargetUtilizationPercent,
      });
    }
  }
}
