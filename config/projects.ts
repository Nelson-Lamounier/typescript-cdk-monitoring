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
 * Service-specific resource configuration
 * 
 * Use this to define memory and CPU allocations for individual services
 * within a project. These can be overridden per environment using
 * environmentOverrides.
 * 
 * Example:
 * ```typescript
 * services: {
 *   prometheus: { memoryMiB: 1024, cpu: 512 },
 *   grafana: { memoryMiB: 512, cpu: 256 },
 * }
 * ```
 */
export interface ServiceResourceConfig {
  memoryMiB?: number; // Memory allocation in MiB
  cpu?: number; // CPU units (1024 = 1 vCPU)
}

/**
 * Cost estimate for a resource or project
 * 
 * Provides estimated monthly costs per environment to help with:
 * - Budget planning
 * - Cost comparison between environments
 * - Understanding cost drivers
 * - Cost optimization decisions
 */
export interface CostEstimate {
  /** Estimated monthly cost for development environment */
  development?: string;
  /** Estimated monthly cost for staging environment */
  staging?: string;
  /** Estimated monthly cost for production environment */
  production?: string;
  /** Additional notes about cost drivers and variables */
  notes?: string[];
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
  services?: Record<string, ServiceResourceConfig>; // Service-specific resource allocations
  estimatedMonthlyCost?: CostEstimate; // Estimated compute costs
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
  estimatedMonthlyCost?: CostEstimate; // Estimated storage costs
}

/**
 * Networking configuration costs
 */
export interface NetworkingCostConfig {
  estimatedMonthlyCost?: CostEstimate; // Estimated networking costs (NAT, data transfer, etc.)
}

/**
 * Load balancer configuration for a project
 */
export interface ProjectLoadBalancerConfig {
  internetFacing?: boolean;
  enableHttps?: boolean;
  certificateArn?: string;
  allowedIpRanges?: string[];
  estimatedMonthlyCost?: CostEstimate; // Estimated ALB/NLB costs
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
      instanceType: "t3.small",
      minCapacity: 1,
      maxCapacity: 2,
      desiredCapacity: 1,
      enableContainerInsights: true,
      services: {
        prometheus: { memoryMiB: 1024, cpu: 512 },
        grafana: { memoryMiB: 512, cpu: 256 },
        nodeExporter: { memoryMiB: 128, cpu: 128 },
      },
      estimatedMonthlyCost: {
        development: "€17-22 (1 x t3.small, no NAT)",
        production: "€105-120 (2 x t3.medium, 1 NAT gateway)",
        notes: [
          "t3.small: ~€16.70/month per instance",
          "t3.medium: ~€33.41/month per instance",
          "NAT Gateway: ~€38.10/month",
          "Container Insights: ~€7.30/month",
          "Data transfer costs not included",
        ],
      },
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
      estimatedMonthlyCost: {
        development: "€1.75-2.50 (20GB gp3 for Prometheus)",
        production: "€13-16 (150GB gp3 total)",
        notes: [
          "gp3 storage: ~€0.088/GB/month",
          "Development uses smaller volumes for cost savings",
          "Production: 100GB Prometheus + 50GB Grafana",
        ],
      },
    },
    loadBalancer: {
      internetFacing: true,
      enableHttps: false,
      allowedIpRanges: [], // Allow all IPs by default for monitoring
      estimatedMonthlyCost: {
        development: "€18-20 (ALB)",
        production: "€18-30 (ALB + data transfer)",
        notes: [
          "ALB: ~€18.48/month base cost",
          "LCU pricing: ~€0.0073/hour per LCU",
          "Data transfer: ~€0.09/GB outbound",
          "Typical monitoring: 1-2 LCUs",
        ],
      },
    },
    environmentOverrides: {
      pipeline: {
        networking: {
          natGateways: 0, // Pipeline account - no internet access needed
        },
      },
      development: {
        compute: {
          services: {
            prometheus: { memoryMiB: 384, cpu: 256 },
            grafana: { memoryMiB: 384, cpu: 256 },
            nodeExporter: { memoryMiB: 128, cpu: 128 },
          },
        },
      },
      production: {
        compute: {
          instanceType: "t3.medium", // Production uses larger instances
          minCapacity: 2,
          desiredCapacity: 2, // Must be >= minCapacity
          maxCapacity: 4,
        },
        networking: {
          natGateways: 2, // High availability NAT gateways
        },
      },
    },
  },

  /**
   * Web application project
   * Containerised web application with ECR repository
   */
  webapp: {
    name: "webapp",
    type: ProjectType.WEBAPP,
    description: "Web application with container registry",
    networking: {
      maxAzs: 2,
      enableVpcFlowLogs: true,
      enableVpcEndpoints: true,
    },
    compute: {
      instanceType: "t3.small",
      minCapacity: 1,
      maxCapacity: 3,
      desiredCapacity: 1,
      enableContainerInsights: false,
      estimatedMonthlyCost: {
        development: "€17-20 (1 x t3.small, no NAT)",
        production: "€67-75 (2 x t3.medium, no NAT)",
        notes: [
          "t3.small: ~€16.70/month per instance",
          "t3.medium: ~€33.41/month per instance",
          "Production runs 2 instances minimum for HA",
          "No Container Insights = cost savings",
        ],
      },
    },
    storage: {
      ebsVolumes: [
        {
          deviceName: "/dev/xvdf",
          sizeGB: 20,
          mountPath: "/mnt/app-data",
          volumeType: "gp3",
          deleteOnTermination: false,
        },
      ],
      estimatedMonthlyCost: {
        development: "€1.75 (20GB gp3)",
        production: "€1.75 (20GB gp3)",
        notes: [
          "gp3 storage: ~€0.088/GB/month",
          "20GB sufficient for application data",
          "Container images stored in ECR (separate cost)",
        ],
      },
    },
    loadBalancer: {
      internetFacing: true,
      enableHttps: true,
      allowedIpRanges: [], // Configure IP restrictions as needed
      estimatedMonthlyCost: {
        development: "€18-22 (ALB + ACM certificate)",
        production: "€18-35 (ALB + certificate + traffic)",
        notes: [
          "ALB: ~€18.48/month base cost",
          "ACM certificate: Free",
          "LCU pricing: ~€0.0073/hour per LCU",
          "Data transfer: ~€0.09/GB outbound",
          "Production traffic: 2-5 LCUs estimated",
        ],
      },
    },
    environmentOverrides: {
      production: {
        compute: {
          instanceType: "t3.medium",
          minCapacity: 2,
          desiredCapacity: 2, // Must be >= minCapacity
          maxCapacity: 5,
        },
      },
    },
  },
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
