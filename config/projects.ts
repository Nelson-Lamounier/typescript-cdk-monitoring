/** @format */

/**
 * Multi-Project Infrastructure Configuration
 * 
 * This file defines project-specific configurations that can be reused
 * across different portfolio projects while maintaining shared infrastructure.
 */

/**
 * Project types supported by the infrastructure
 */
export enum ProjectType {
  MONITORING = "monitoring",
  WEBAPP = "webapp",
  API = "api",
  DATABASE = "database",
  ANALYTICS = "analytics",
}

/**
 * Networking configuration for a project
 */
export interface ProjectNetworkingConfig {
  vpcCidr?: string; // Optional: project-specific VPC CIDR (defaults to environment CIDR)
  maxAzs?: number; // Number of availability zones
  natGateways?: number; // Number of NAT gateways (defaults to environment config)
  enableVpcFlowLogs?: boolean;
  enableVpcEndpoints?: boolean;
}

/**
 * Compute configuration for a project
 */
export interface ProjectComputeConfig {
  instanceType?: string; // EC2 instance type for ECS
  minCapacity?: number; // Minimum ECS tasks/instances
  maxCapacity?: number; // Maximum ECS tasks/instances
  desiredCapacity?: number; // Desired ECS tasks/instances
  enableContainerInsights?: boolean;
}

/**
 * Storage configuration for a project
 */
export interface ProjectStorageConfig {
  ebsVolumes?: Array<{
    deviceName: string;
    sizeGB: number;
    mountPath: string;
    volumeType?: "gp3" | "gp2" | "io1" | "io2";
    deleteOnTermination?: boolean;
  }>;
}

/**
 * Load balancer configuration for a project
 */
export interface ProjectLoadBalancerConfig {
  internetFacing?: boolean;
  enableHttps?: boolean;
  certificateArn?: string;
  allowedIpRanges?: string[];
}

/**
 * Project configuration interface
 */
export interface ProjectConfig {
  /**
   * Project name (used for resource naming and tagging)
   */
  name: string;
  
  /**
   * Project type (determines default configurations)
   */
  type: ProjectType;
  
  /**
   * Project description
   */
  description?: string;
  
  /**
   * Networking configuration
   */
  networking?: ProjectNetworkingConfig;
  
  /**
   * Compute configuration
   */
  compute?: ProjectComputeConfig;
  
  /**
   * Storage configuration
   */
  storage?: ProjectStorageConfig;
  
  /**
   * Load balancer configuration
   */
  loadBalancer?: ProjectLoadBalancerConfig;
  
  /**
   * Environment-specific overrides
   * Key: environment name (e.g., "development", "production")
   * Value: Partial project config to override defaults
   */
  environmentOverrides?: Record<string, Partial<ProjectConfig>>;
}

/**
 * Project configurations
 * Add new projects here following the pattern
 */
export const projects: Record<string, ProjectConfig> = {
  /**
   * Monitoring project - Centralised monitoring infrastructure
   * Deployed in pipeline account to monitor all environments
   */
  monitoring: {
    name: "monitoring",
    type: ProjectType.MONITORING,
    description: "Centralised monitoring infrastructure (Prometheus, Grafana, Node Exporter)",
    networking: {
      maxAzs: 2,
      enableVpcFlowLogs: true,
      enableVpcEndpoints: true,
    },
    compute: {
      instanceType: "t3.medium",
      minCapacity: 1,
      maxCapacity: 2,
      desiredCapacity: 1,
      enableContainerInsights: true,
    },
    storage: {
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
    },
    loadBalancer: {
      internetFacing: true,
      enableHttps: false,
      allowedIpRanges: [], // Allow all IPs by default for monitoring
    },
    environmentOverrides: {
      pipeline: {
        networking: {
          natGateways: 0, // Pipeline account - no internet access needed
        },
      },
      production: {
        compute: {
          instanceType: "t3.large",
          minCapacity: 2,
          maxCapacity: 4,
        },
        networking: {
          natGateways: 2, // High availability NAT gateways
        },
      },
    },
  },

  /**
   * Example: Web application project
   * Uncomment and customize for your web application
   */
  // webapp: {
  //   name: "webapp",
  //   type: ProjectType.WEBAPP,
  //   description: "Next.js web application",
  //   networking: {
  //     maxAzs: 2,
  //     enableVpcFlowLogs: true,
  //     enableVpcEndpoints: true,
  //   },
  //   compute: {
  //     instanceType: "t3.small",
  //     minCapacity: 1,
  //     maxCapacity: 3,
  //     desiredCapacity: 1,
  //     enableContainerInsights: false,
  //   },
  //   storage: {
  //     ebsVolumes: [
  //       {
  //         deviceName: "/dev/xvdf",
  //         sizeGB: 20,
  //         mountPath: "/mnt/app-data",
  //         volumeType: "gp3",
  //         deleteOnTermination: false,
  //       },
  //     ],
  //   },
  //   loadBalancer: {
  //     internetFacing: true,
  //     enableHttps: true,
  //     allowedIpRanges: [], // Configure IP restrictions as needed
  //   },
  //   environmentOverrides: {
  //     production: {
  //       compute: {
  //         instanceType: "t3.medium",
  //         minCapacity: 2,
  //         maxCapacity: 5,
  //       },
  //     },
  //   },
  // },
};

/**
 * Get project configuration with environment-specific overrides applied
 */
export function getProjectConfig(
  projectName: string,
  environmentName: string
): ProjectConfig {
  const project = projects[projectName];
  
  if (!project) {
    const validProjects = Object.keys(projects).join(", ");
    throw new Error(
      `Invalid project: ${projectName}\n\n` +
        `Valid projects: ${validProjects}\n\n` +
        `Usage:\n` +
        `  PROJECT_NAME=${validProjects.split(", ")[0]} ENVIRONMENT=${environmentName} cdk deploy\n` +
        `  Or set PROJECT_NAME environment variable`
    );
  }

  // Apply environment-specific overrides
  const overrides = project.environmentOverrides?.[environmentName];
  if (overrides) {
    return {
      ...project,
      ...overrides,
      networking: {
        ...project.networking,
        ...overrides.networking,
      },
      compute: {
        ...project.compute,
        ...overrides.compute,
      },
      storage: {
        ...project.storage,
        ...overrides.storage,
      },
      loadBalancer: {
        ...project.loadBalancer,
        ...overrides.loadBalancer,
      },
    };
  }

  return project;
}
