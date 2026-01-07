/** @format */

import * as ecs from "aws-cdk-lib/aws-ecs";
import { EcsApplicationConfig, EcsServiceConfig } from "../types/ecs-service-config";
import { CrossAccountTarget } from "../types";

/**
 * Pre-configured ECS application configurations
 * These can be used directly or customized per environment
 */

/**
 * Creates monitoring application configuration (Prometheus, Grafana, Node Exporter)
 */
export function createMonitoringApplicationConfig(
  _envName: string,
  _crossAccountTargets?: CrossAccountTarget[]
): EcsApplicationConfig {
  return {
    applicationName: "monitoring",
    description: "Monitoring stack with Prometheus, Grafana, and Node Exporter",
    services: [
      {
        name: "prometheus",
        container: {
          name: "prometheus",
          image: "prom/prometheus:latest",
          containerPort: 9090,
          hostPort: 9090, // Static port for ALB
          memoryReservationMiB: 512,
          memoryLimitMiB: 1024,
          command: [
            "--config.file=/etc/prometheus/prometheus.yml",
            "--storage.tsdb.path=/prometheus",
            "--web.console.libraries=/usr/share/prometheus/console_libraries",
            "--web.console.templates=/usr/share/prometheus/consoles",
            "--web.route-prefix=/prometheus",
            "--web.external-url=/prometheus",
          ],
        },
        desiredCount: 1,
        enableExecuteCommand: true,
        volumes: [
          {
            name: "prometheus-data",
            hostPath: "/mnt/prometheus-data",
            containerPath: "/prometheus",
            readOnly: false,
          },
          {
            name: "prometheus-config",
            hostPath: "/mnt/prometheus-config",
            containerPath: "/etc/prometheus",
            readOnly: true,
          },
        ],
        loadBalancer: {
          path: "/prometheus/*",
          priority: 100,
          healthCheckPath: "/prometheus/-/healthy",
        },
        albPort: 9090,
        networkMode: ecs.NetworkMode.BRIDGE,
      },
      {
        name: "grafana",
        container: {
          name: "grafana",
          image: "grafana/grafana:latest",
          containerPort: 3000,
          hostPort: 3000, // Static port for ALB
          memoryReservationMiB: 256,
          memoryLimitMiB: 512,
          user: "472", // Grafana runs as UID 472
          environment: {
            GF_PATHS_DATA: "/var/lib/grafana",
            GF_PATHS_LOGS: "/var/log/grafana",
            GF_PATHS_PLUGINS: "/var/lib/grafana/plugins",
            GF_PATHS_PROVISIONING: "/etc/grafana/provisioning",
            GF_SERVER_ROOT_URL: "/grafana",
            GF_SERVER_SERVE_FROM_SUB_PATH: "true",
          },
        },
        desiredCount: 1,
        enableExecuteCommand: true,
        volumes: [
          {
            name: "grafana-data",
            hostPath: "/mnt/grafana-data",
            containerPath: "/var/lib/grafana",
            readOnly: false,
          },
          {
            name: "grafana-provisioning",
            hostPath: "/mnt/grafana-provisioning",
            containerPath: "/etc/grafana/provisioning",
            readOnly: true,
          },
          {
            name: "grafana-dashboards",
            hostPath: "/mnt/grafana-dashboards",
            containerPath: "/var/lib/grafana/dashboards",
            readOnly: true,
          },
        ],
        loadBalancer: {
          path: "/grafana/*",
          priority: 200,
          healthCheckPath: "/grafana/api/health",
        },
        albPort: 3000,
        networkMode: ecs.NetworkMode.BRIDGE,
      },
      {
        name: "node-exporter",
        container: {
          name: "node-exporter",
          image: "prom/node-exporter:latest",
          containerPort: 9100,
          memoryReservationMiB: 64,
          command: [
            "--path.procfs=/host/proc",
            "--path.sysfs=/host/sys",
            "--path.rootfs=/rootfs",
            "--collector.filesystem.mount-points-exclude=^/(sys|proc|dev|host|etc)($|/)",
          ],
        },
        desiredCount: 1,
        enableExecuteCommand: true,
        volumes: [
          {
            name: "proc",
            hostPath: "/proc",
            containerPath: "/host/proc",
            readOnly: true,
          },
          {
            name: "sys",
            hostPath: "/sys",
            containerPath: "/host/sys",
            readOnly: true,
          },
          {
            name: "rootfs",
            hostPath: "/",
            containerPath: "/rootfs",
            readOnly: true,
          },
        ],
        networkMode: ecs.NetworkMode.HOST, // Node Exporter requires HOST mode
      },
    ],
    ebsVolumes: [
      {
        deviceName: "/dev/xvdf",
        sizeGB: 100,
        mountPath: "/mnt/prometheus-data",
        volumeType: "gp3",
        deleteOnTermination: false,
      },
      {
        deviceName: "/dev/xvdg",
        sizeGB: 50,
        mountPath: "/mnt/grafana-data",
        volumeType: "gp3",
        deleteOnTermination: false,
      },
    ],
    loadBalancer: {
      internetFacing: true,
      allowedIpRanges: ["0.0.0.0/0"],
    },
    cluster: {
      enableContainerInsights: false,
      enableExecuteCommand: true,
    },
  };
}

/**
 * Creates a generic application configuration template
 * Customize this for your specific application needs
 */
export function createApplicationConfig(
  applicationName: string,
  services: EcsServiceConfig[],
  options?: {
    description?: string;
    ebsVolumes?: Array<{
      deviceName: string;
      sizeGB: number;
      mountPath: string;
      volumeType?: "gp3" | "gp2" | "io1" | "io2";
      deleteOnTermination?: boolean;
    }>;
    loadBalancer?: {
      internetFacing?: boolean;
      allowedIpRanges?: string[];
      name?: string;
    };
    cluster?: {
      enableContainerInsights?: boolean;
      enableExecuteCommand?: boolean;
    };
  }
): EcsApplicationConfig {
  return {
    applicationName,
    description: options?.description || `${applicationName} application stack`,
    services,
    ebsVolumes: options?.ebsVolumes,
    loadBalancer: options?.loadBalancer,
    cluster: options?.cluster,
  };
}

/**
 * Example: Next.js application configuration
 */
export function createNextJsApplicationConfig(
  envName: string,
  imageTag: string = "latest"
): EcsApplicationConfig {
  return createApplicationConfig(
    "nextjs",
    [
      {
        name: "nextjs-app",
        container: {
          name: "nextjs",
          image: `your-ecr-repo/nextjs-app:${imageTag}`,
          containerPort: 3000,
          hostPort: 3000,
          memoryReservationMiB: 512,
          memoryLimitMiB: 1024,
          environment: {
            NODE_ENV: envName === "production" ? "production" : "development",
            PORT: "3000",
          },
        },
        desiredCount: envName === "production" ? 2 : 1,
        enableExecuteCommand: true,
        loadBalancer: {
          path: "/*",
          priority: 100,
          healthCheckPath: "/api/health",
        },
        albPort: 3000,
        networkMode: ecs.NetworkMode.BRIDGE,
      },
    ],
    {
      description: "Next.js application stack",
      ebsVolumes: [
        {
          deviceName: "/dev/xvdf",
          sizeGB: 20,
          mountPath: "/mnt/app-data",
          volumeType: "gp3",
          deleteOnTermination: false,
        },
      ],
      loadBalancer: {
        internetFacing: true,
        allowedIpRanges: ["0.0.0.0/0"],
      },
      cluster: {
        enableContainerInsights: envName === "production",
        enableExecuteCommand: true,
      },
    }
  );
}
