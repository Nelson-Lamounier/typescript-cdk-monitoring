/** @format */

import * as cdk from "aws-cdk-lib";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as cw from "aws-cdk-lib/aws-cloudwatch";
import { Tags } from "aws-cdk-lib";
import { Construct } from "constructs";

export interface LoadBalancerTargetConfig {
  targetGroup: elbv2.IApplicationTargetGroup;
  containerName: string;
  containerPort: number;
}

export interface ServiceAlarmConfig {
  enabled: boolean;
  cpuThreshold?: number;
  memoryThreshold?: number;
  alarmBehavior?: ecs.AlarmBehavior;
}

export interface EcsServiceConstructProps {
  cluster: ecs.ICluster;
  taskDefinition: ecs.TaskDefinition;
  envName: string;
  serviceName?: string;
  desiredCount?: number;
  minHealthyPercent?: number;
  maxHealthyPercent?: number;
  healthCheckGracePeriod?: cdk.Duration;
  enableCircuitBreaker?: boolean;
  enableExecuteCommand?: boolean;
  loadBalancerTarget?: LoadBalancerTargetConfig;
  alarmConfig?: ServiceAlarmConfig;
  placementStrategies?: ecs.PlacementStrategy[];
}

/**
 * Reusable construct for creating ECS Services
 * Handles service configuration, load balancer attachment, and alarms
 */
export class EcsServiceConstruct extends Construct {
  public readonly service: ecs.Ec2Service;
  public cpuAlarm?: cw.Alarm;
  public memoryAlarm?: cw.Alarm;

  constructor(scope: Construct, id: string, props: EcsServiceConstructProps) {
    super(scope, id);

    // Create ECS Service
    this.service = new ecs.Ec2Service(this, "Service", {
      cluster: props.cluster,
      taskDefinition: props.taskDefinition as ecs.Ec2TaskDefinition,
      desiredCount: props.desiredCount || 1,
      serviceName: props.serviceName || `ecs-service-${props.envName}`,

      // Placement strategy for better distribution
      placementStrategies: props.placementStrategies || [
        ecs.PlacementStrategy.spreadAcrossInstances(),
        ecs.PlacementStrategy.packedByCpu(),
      ],

      // Circuit breaker configuration
      circuitBreaker: {
        enable: props.enableCircuitBreaker !== false,
        rollback: props.enableCircuitBreaker !== false,
      },

      // Deployment configuration
      minHealthyPercent: props.minHealthyPercent ?? 0,
      maxHealthyPercent: props.maxHealthyPercent ?? 200,

      // Health check grace period
      healthCheckGracePeriod:
        props.healthCheckGracePeriod || cdk.Duration.seconds(120),

      // Enable ECS Exec
      enableExecuteCommand: props.enableExecuteCommand,
    });

    // Attach to load balancer if configured
    if (props.loadBalancerTarget) {
      this.attachToLoadBalancer(props.loadBalancerTarget);
    }

    // Create alarms if configured
    if (props.alarmConfig?.enabled) {
      this.createAlarms(props.alarmConfig, props.envName);
    }

    // Tag service
    Tags.of(this.service).add("Environment", props.envName);
    Tags.of(this.service).add("ManagedBy", "CDK");
    Tags.of(this.service).add("Service", "ECS");
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
  public enableAutoScaling(
    minCapacity: number,
    maxCapacity: number
  ): ecs.ScalableTaskCount {
    return this.service.autoScaleTaskCount({
      minCapacity,
      maxCapacity,
    });
  }

  /**
   * Add target tracking scaling policy based on CPU
   */
  public addCpuScaling(targetUtilizationPercent: number): void {
    const scaling = this.enableAutoScaling(1, 10);
    scaling.scaleOnCpuUtilization("CpuScaling", {
      targetUtilizationPercent,
    });
  }

  /**
   * Add target tracking scaling policy based on memory
   */
  public addMemoryScaling(targetUtilizationPercent: number): void {
    const scaling = this.enableAutoScaling(1, 10);
    scaling.scaleOnMemoryUtilization("MemoryScaling", {
      targetUtilizationPercent,
    });
  }
}
