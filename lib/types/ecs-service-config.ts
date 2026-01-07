/** @format */

import * as ecs from "aws-cdk-lib/aws-ecs";
import * as logs from "aws-cdk-lib/aws-logs";

/**
 * EBS Volume Configuration
 */
export interface EbsVolumeConfig {
  deviceName: string;
  sizeGB: number;
  mountPath: string;
  volumeType?: "gp3" | "gp2" | "io1" | "io2";
  deleteOnTermination?: boolean;
}

/**
 * Container Volume Mount Configuration
 */
export interface VolumeMountConfig {
  name: string;
  hostPath: string;
  containerPath: string;
  readOnly?: boolean;
}

/**
 * Container Environment Variable
 */
export interface ContainerEnvironment {
  [key: string]: string;
}

/**
 * Container Configuration for ECS Service
 */
export interface ContainerConfig {
  name: string;
  image: string;
  containerPort: number;
  hostPort?: number; // Optional: for static port mapping (required for ALB)
  memoryReservationMiB?: number;
  memoryLimitMiB?: number;
  cpu?: number;
  user?: string; // UID for container user
  command?: string[];
  environment?: ContainerEnvironment;
  logGroup?: logs.ILogGroup;
  logStreamPrefix?: string;
}

/**
 * ECS Service Configuration
 */
export interface EcsServiceConfig {
  /**
   * Service name (used for service name and resource IDs)
   */
  name: string;
  /**
   * Container configuration
   */
  container: ContainerConfig;
  /**
   * Desired task count
   * @default 1
   */
  desiredCount?: number;
  /**
   * Enable ECS Exec for debugging
   * @default false
   */
  enableExecuteCommand?: boolean;
  /**
   * Volumes to mount from host
   */
  volumes?: VolumeMountConfig[];
  /**
   * Load balancer target group configuration (optional)
   * Target group will be created automatically if this is provided
   */
  loadBalancer?: {
    path: string; // ALB path pattern (e.g., "/app/*", "/api/*")
    priority?: number; // Listener rule priority
    healthCheckPath?: string;
  };
  /**
   * Security group port to allow from ALB
   */
  albPort?: number;
  /**
   * Network mode for task definition
   * @default BRIDGE
   */
  networkMode?: ecs.NetworkMode;
}

/**
 * ECS Stack Application Configuration
 */
export interface EcsApplicationConfig {
  /**
   * Application name (used for cluster name, ALB name, etc.)
   */
  applicationName: string;
  /**
   * Application description
   */
  description?: string;
  /**
   * Services to deploy in this ECS stack
   */
  services: EcsServiceConfig[];
  /**
   * EBS volumes to attach to EC2 instances
   */
  ebsVolumes?: EbsVolumeConfig[];
  /**
   * ALB configuration
   */
  loadBalancer?: {
    internetFacing?: boolean;
    allowedIpRanges?: string[];
    name?: string;
  };
  /**
   * Cluster configuration
   */
  cluster?: {
    enableContainerInsights?: boolean;
    enableExecuteCommand?: boolean;
  };
}
