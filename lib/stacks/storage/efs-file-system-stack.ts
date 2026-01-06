/** @format */

import { Construct } from "constructs";
import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as efs from "aws-cdk-lib/aws-efs";
import * as ssm from "aws-cdk-lib/aws-ssm";

import { SuppressionManager } from "../../cdk-nag/suppression-manager";

// ============================================================================
// CROSS-ACCOUNT TARGET TYPE
// ============================================================================

/**
 * Configuration for cross-account monitoring targets
 */
export interface CrossAccountTarget {
  envName: string;
  accountId?: string;
  roleArn?: string;
  targetType: string;
  port: number;
  privateIp?: string;
  useEc2ServiceDiscovery?: boolean;
  metricsPath?: string;
}

// ============================================================================
// EFS ACCESS POINT CONSTRUCT
// ============================================================================

export interface EfsAccessPointConstructProps {
  /**
   * The EFS file system to create the access point for
   */
  fileSystem: efs.IFileSystem;

  /**
   * Environment name for resource naming and tagging
   */
  envName: string;

  /**
   * Path within the EFS file system
   * @default "/monitoring"
   */
  path?: string;

  /**
   * POSIX user for the access point
   * @default { uid: "0", gid: "0" }
   */
  posixUser?: {
    uid: string;
    gid: string;
  };

  /**
   * Creation ACL for the root directory
   * @default { ownerUid: "0", ownerGid: "0", permissions: "755" }
   */
  creationAcl?: {
    ownerUid: string;
    ownerGid: string;
    permissions: string;
  };
}

/**
 * Construct for creating an EFS access point with monitoring-specific configuration
 */
export class EfsAccessPointConstruct extends Construct {
  public readonly accessPoint: efs.AccessPoint;

  constructor(
    scope: Construct,
    id: string,
    props: EfsAccessPointConstructProps
  ) {
    super(scope, id);

    const {
      fileSystem,
      envName,
      path = "/monitoring",
      posixUser = { uid: "0", gid: "0" },
      creationAcl = { ownerUid: "0", ownerGid: "0", permissions: "755" },
    } = props;

    // Create EFS access point
    this.accessPoint = new efs.AccessPoint(this, "MonitoringEfsAccessPoint", {
      fileSystem,
      path,
      posixUser,
      createAcl: creationAcl,
    });

    // Add tags
    cdk.Tags.of(this.accessPoint).add(
      "Name",
      `${envName}-monitoring-access-point`
    );
    cdk.Tags.of(this.accessPoint).add("Environment", envName);
    cdk.Tags.of(this.accessPoint).add("Purpose", "MonitoringAccess");
    cdk.Tags.of(this.accessPoint).add("ManagedBy", "CDK");

    // Note: Outputs are created at the stack level, not here
    // to avoid duplicate outputs and maintain consistency
  }
}

// ============================================================================
// EFS FILE SYSTEM CONSTRUCT
// ============================================================================

export interface EfsFileSystemConstructProps {
  /**
   * VPC where the EFS file system will be created
   */
  vpc: ec2.IVpc;

  /**
   * Environment name for resource naming and tagging
   */
  envName: string;

  /**
   * Whether to enable encryption at rest
   * @default true
   */
  enableEncryption?: boolean;

  /**
   * Lifecycle policy for transitioning files to IA storage
   * @default AFTER_30_DAYS
   */
  lifecyclePolicy?: efs.LifecyclePolicy;

  /**
   * Performance mode for the file system
   * @default GENERAL_PURPOSE
   */
  performanceMode?: efs.PerformanceMode;

  /**
   * Throughput mode for the file system
   * @default ELASTIC (cheapest for spiky/low-average workloads)
   */
  throughputMode?: efs.ThroughputMode;

  /**
   * Provisioned throughput in MiB/s (only used with PROVISIONED mode)
   * @default 10
   */
  provisionedThroughputPerSecond?: cdk.Size;

  /**
   * Removal policy for the file system
   * @default RETAIN
   */
  removalPolicy?: cdk.RemovalPolicy;

  /**
   * Security group for the file system
   */
  securityGroup?: ec2.ISecurityGroup;

  /**
   * Optional subnet selection to control where mount targets are placed
   * (e.g., single public subnet/AZ to align with ECS EC2 instances).
   */
  mountTargetSubnetSelection?: ec2.SubnetSelection;
}

/**
 * Construct for creating an EFS file system with monitoring-specific configuration
 */
export class EfsFileSystemConstruct extends Construct {
  public readonly fileSystem: efs.FileSystem;
  public readonly availabilityZone: string;

  constructor(
    scope: Construct,
    id: string,
    props: EfsFileSystemConstructProps
  ) {
    super(scope, id);

    const {
      vpc,
      envName,
      enableEncryption = true,
      lifecyclePolicy = efs.LifecyclePolicy.AFTER_30_DAYS,
      performanceMode = efs.PerformanceMode.GENERAL_PURPOSE,
      throughputMode = efs.ThroughputMode.ELASTIC,
      provisionedThroughputPerSecond = cdk.Size.mebibytes(10),
      removalPolicy = cdk.RemovalPolicy.RETAIN,
      securityGroup,
      mountTargetSubnetSelection,
    } = props;

    const selectedSubnets = mountTargetSubnetSelection
      ? vpc.selectSubnets(mountTargetSubnetSelection)
      : undefined;

    // Create EFS file system
    this.fileSystem = new efs.FileSystem(this, `MonitoringEfs-${envName}`, {
      vpc,
      lifecyclePolicy,
      performanceMode,
      throughputMode,
      provisionedThroughputPerSecond:
        throughputMode === efs.ThroughputMode.PROVISIONED
          ? provisionedThroughputPerSecond
          : undefined,
      encrypted: enableEncryption,
      removalPolicy,
      securityGroup,
      vpcSubnets: selectedSubnets,
      fileSystemName: `${envName}-monitoring-efs`,
    });

    // Get the selected availability zone (or fallback to first VPC AZ)
    this.availabilityZone =
      selectedSubnets?.availabilityZones?.[0] ?? vpc.availabilityZones[0];

    // Configure backup policy
    const cfnFileSystem = this.fileSystem.node
      .defaultChild as efs.CfnFileSystem;
    cfnFileSystem.backupPolicy = {
      status: "ENABLED",
    };

    // Only use One Zone EFS if a single subnet is provided
    // If multiple subnets are provided, use standard multi-AZ EFS to allow
    // mount targets in all AZs where instances can be placed
    const isSingleSubnet = selectedSubnets?.subnets.length === 1;
    if (isSingleSubnet) {
      // Setting availabilityZoneName makes this a One Zone file system
      // This is more cost-effective when instances are constrained to a single AZ
      cfnFileSystem.availabilityZoneName = this.availabilityZone;
    }
    // If multiple subnets, don't set availabilityZoneName - this creates a standard
    // multi-AZ EFS with mount targets in all provided subnets/AZs

    // Add tags
    cdk.Tags.of(this.fileSystem).add("Name", `${envName}-monitoring-efs`);
    cdk.Tags.of(this.fileSystem).add("Environment", envName);
    cdk.Tags.of(this.fileSystem).add("Purpose", "MonitoringStorage");
    cdk.Tags.of(this.fileSystem).add("ManagedBy", "CDK");

    // Note: Outputs are created at the stack level, not here
    // to avoid duplicate outputs and maintain consistency
  }
}

// ============================================================================
// EFS SECURITY GROUP CONSTRUCT
// ============================================================================

export interface EfsSecurityGroupConstructProps {
  /**
   * VPC where the security group will be created
   */
  vpc: ec2.IVpc;

  /**
   * Environment name for resource naming and tagging
   */
  envName: string;

  /**
   * CIDR blocks allowed to access EFS
   * @default [vpc.vpcCidrBlock]
   */
  allowedCidrs?: string[];

  /**
   * Security groups allowed to access EFS
   */
  allowedSecurityGroups?: ec2.ISecurityGroup[];

  /**
   * Whether to allow all outbound traffic
   * @default false
   */
  allowAllOutbound?: boolean;
}

/**
 * Construct for creating a security group for EFS access
 */
export class EfsSecurityGroupConstruct extends Construct {
  public readonly securityGroup: ec2.SecurityGroup;

  constructor(
    scope: Construct,
    id: string,
    props: EfsSecurityGroupConstructProps
  ) {
    super(scope, id);

    const {
      vpc,
      envName,
      allowedCidrs = [vpc.vpcCidrBlock],
      allowedSecurityGroups = [],
      allowAllOutbound = false,
    } = props;

    // Create security group for EFS mount targets
    this.securityGroup = new ec2.SecurityGroup(this, "EfsMountTargetSg", {
      vpc,
      description: `EFS mount target security group for ${envName} monitoring`,
      allowAllOutbound,
    });

    // Add ingress rules for NFS traffic from allowed CIDRs
    allowedCidrs.forEach((cidr) => {
      this.securityGroup.addIngressRule(
        ec2.Peer.ipv4(cidr),
        ec2.Port.tcp(2049),
        `Allow NFS traffic from ${cidr}`
      );
    });

    // Add ingress rules for NFS traffic from allowed security groups
    allowedSecurityGroups.forEach((sg) => {
      this.securityGroup.addIngressRule(
        ec2.Peer.securityGroupId(sg.securityGroupId),
        ec2.Port.tcp(2049),
        `Allow NFS traffic from security group ${sg.securityGroupId}`
      );
    });

    // Add tags
    cdk.Tags.of(this.securityGroup).add(
      "Name",
      `${envName}-efs-mount-target-sg`
    );
    cdk.Tags.of(this.securityGroup).add("Environment", envName);
    cdk.Tags.of(this.securityGroup).add("Purpose", "EfsAccess");
    cdk.Tags.of(this.securityGroup).add("ManagedBy", "CDK");

    // Note: Outputs are created at the stack level, not here
    // to avoid duplicate outputs and maintain consistency
  }
}

// ============================================================================
// MONITORING EFS STACK
// ============================================================================

/**
 * LAYER 0: Monitoring EFS Stack (Refactored)
 *
 * This stack manages persistent storage and configuration for monitoring using
 * standardized constructs following DevOps best practices:
 * - EFS FileSystem for persistent data
 * - Configuration files (prometheus.yml, grafana configs)
 * - Directory structure setup
 * - Access points and security groups
 *
 * Deploy: When changing monitoring configuration or storage setup
 * Depends on: NetworkingStack
 */
export interface MonitoringEfsStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
  envName: string;
  crossAccountTargets?: CrossAccountTarget[];
  enableEncryption?: boolean;
  lifecyclePolicy?: efs.LifecyclePolicy;
}

export class MonitoringEfsStack extends cdk.Stack {
  public readonly fileSystem: efs.FileSystem;
  public readonly accessPoint: efs.AccessPoint;
  public readonly mountTargetSecurityGroup: ec2.SecurityGroup;
  public readonly efsAvailabilityZone: string;

  constructor(scope: Construct, id: string, props: MonitoringEfsStackProps) {
    super(scope, id, props);

    const {
      vpc,
      envName,
      crossAccountTargets,
      enableEncryption = true,
      lifecyclePolicy = efs.LifecyclePolicy.AFTER_30_DAYS,
    } = props;

    // Select all public subnets (one per AZ) to match where EC2 instances can be placed
    // This ensures EFS mount targets are available in the same subnets as the instances
    // Using dynamic subnet selection (not hardcoded) to avoid errors on redeployment
    const publicSubnets = vpc.selectSubnets({
      subnetType: ec2.SubnetType.PUBLIC,
      onePerAz: true, // One subnet per availability zone
    });

    // ========================================================================
    // EFS SECURITY GROUP
    // ========================================================================
    const efsSecurityGroupConstruct = new EfsSecurityGroupConstruct(
      this,
      "EfsSecurityGroup",
      {
        vpc,
        envName,
        allowedCidrs: [vpc.vpcCidrBlock],
        allowAllOutbound: false,
      }
    );

    this.mountTargetSecurityGroup = efsSecurityGroupConstruct.securityGroup;

    // ========================================================================
    // EFS FILE SYSTEM
    // ========================================================================
    // Use all public subnets (one per AZ) for mount targets to match instance placement
    // This ensures instances in any AZ can access EFS
    const efsFileSystemConstruct = new EfsFileSystemConstruct(
      this,
      "EfsFileSystem",
      {
        vpc,
        envName,
        enableEncryption,
        lifecyclePolicy,
        securityGroup: this.mountTargetSecurityGroup,
        removalPolicy: cdk.RemovalPolicy.RETAIN,
        mountTargetSubnetSelection: { subnets: publicSubnets.subnets },
      }
    );

    this.fileSystem = efsFileSystemConstruct.fileSystem;
    this.efsAvailabilityZone = efsFileSystemConstruct.availabilityZone;

    // ========================================================================
    // EFS ACCESS POINT
    // ========================================================================
    const efsAccessPointConstruct = new EfsAccessPointConstruct(
      this,
      "EfsAccessPoint",
      {
        fileSystem: this.fileSystem,
        envName,
        path: "/monitoring",
        posixUser: { uid: "0", gid: "0" },
        creationAcl: { ownerUid: "0", ownerGid: "0", permissions: "755" },
      }
    );

    this.accessPoint = efsAccessPointConstruct.accessPoint;

    // ========================================================================
    // SSM PARAMETERS FOR CONFIGURATION
    // ========================================================================
    this.createConfigurationParameters(envName, crossAccountTargets);

    // ========================================================================
    // CDK NAG SUPPRESSIONS & TAGS
    // ========================================================================
    SuppressionManager.applyToStack(this, "MonitoringEfsStack", envName);
    cdk.Tags.of(this).add("Stack", "MonitoringEfs");
    cdk.Tags.of(this).add("Environment", envName);
    cdk.Tags.of(this).add("Layer", "Storage");
    cdk.Tags.of(this).add("ManagedBy", "CDK");

    // ========================================================================
    // STACK OUTPUTS
    // ========================================================================
    // Stack outputs - only export for non-pipeline environments to avoid conflicts
    const shouldExport = !envName.includes("pipeline");

    new cdk.CfnOutput(this, "FileSystemId", {
      value: this.fileSystem.fileSystemId,
      description: "EFS File System ID for monitoring storage",
      ...(shouldExport && { exportName: `${envName}-efs-id` }),
    });

    new cdk.CfnOutput(this, "AccessPointId", {
      value: this.accessPoint.accessPointId,
      description: "EFS Access Point ID for monitoring",
      ...(shouldExport && { exportName: `${envName}-access-point-id` }),
    });

    new cdk.CfnOutput(this, "MountTargetSecurityGroupId", {
      value: this.mountTargetSecurityGroup.securityGroupId,
      description: "EFS Security Group ID",
      ...(shouldExport && { exportName: `${envName}-efs-sg-id` }),
    });

    new cdk.CfnOutput(this, "EfsAvailabilityZone", {
      value: this.efsAvailabilityZone,
      description: "EFS Availability Zone",
      ...(shouldExport && { exportName: `${envName}-efs-az` }),
    });
  }

  private createConfigurationParameters(
    envName: string,
    crossAccountTargets?: CrossAccountTarget[]
  ): void {
    const region = cdk.Stack.of(this).region;

    // Prometheus scrape configuration type
    type ScrapeConfig = {
      job_name: string;
      static_configs?: Array<{
        targets: string[];
        labels?: Record<string, string>;
      }>;
      ec2_sd_configs?: Array<{
        region: string;
        role_arn?: string;
        port: number;
        filters: Array<{ name: string; values: string[] }>;
      }>;
      relabel_configs?: Array<{
        source_labels: string[];
        target_label: string;
        replacement?: string;
      }>;
      metrics_path?: string;
    };

    // Prometheus configuration
    const scrapeConfigs: ScrapeConfig[] = [
      {
        job_name: "prometheus",
        static_configs: [{ targets: ["localhost:9090"] }],
        // Use /prometheus/metrics because Prometheus is started with --web.route-prefix=/prometheus
        // This prefix applies to ALL endpoints, including when scraping from localhost
        metrics_path: "/prometheus/metrics",
      },
      {
        job_name: "node-exporter",
        static_configs: [{ targets: ["localhost:9100"] }],
      },
    ];

    // Add pipeline account EC2 service discovery (same account - no role_arn needed)
    scrapeConfigs.push({
      job_name: "node-exporter-pipeline",
      ec2_sd_configs: [
        {
          region: region,
          port: 9100,
          filters: [
            {
              name: "tag:Environment",
              values: [envName],
            },
            {
              name: "tag:Service",
              values: ["NodeExporter", "monitoring"],
            },
            {
              name: "instance-state-name",
              values: ["running"],
            },
          ],
        },
      ],
      relabel_configs: [
        {
          source_labels: ["__meta_ec2_private_ip"],
          target_label: "__address__",
          replacement: "${1}:9100",
        },
        {
          source_labels: ["__meta_ec2_tag_Environment"],
          target_label: "environment",
        },
        {
          source_labels: ["__meta_ec2_tag_Service"],
          target_label: "service",
        },
        {
          source_labels: ["__meta_ec2_instance_id"],
          target_label: "instance_id",
        },
        {
          source_labels: ["__meta_ec2_tag_Name"],
          target_label: "instance_name",
        },
      ],
    });

    // Add cross-account targets using EC2 service discovery or static configs
    if (crossAccountTargets && crossAccountTargets.length > 0) {
      // Group targets by environment and type
      const targetsByEnv = crossAccountTargets.reduce(
        (acc, target) => {
          const key = `${target.envName}-${target.targetType}`;
          if (!acc[key]) {
            acc[key] = [];
          }
          acc[key].push(target);
          return acc;
        },
        {} as Record<string, CrossAccountTarget[]>
      );

      // Generate scrape configs for each environment/type combination
      for (const targets of Object.values(targetsByEnv) as CrossAccountTarget[][]) {
        const firstTarget = targets[0];
        const useEc2Sd =
          firstTarget.useEc2ServiceDiscovery !== false &&
          firstTarget.accountId &&
          firstTarget.roleArn;

        if (useEc2Sd) {
          // Use EC2 service discovery for cross-account scraping
          scrapeConfigs.push({
            job_name: `${firstTarget.targetType}-${firstTarget.envName}`,
            ec2_sd_configs: [
              {
                region: region,
                role_arn: firstTarget.roleArn,
                port: firstTarget.port,
                filters: [
                  {
                    name: "tag:Environment",
                    values: [firstTarget.envName],
                  },
                  {
                    name: "instance-state-name",
                    values: ["running"],
                  },
                  ...(firstTarget.targetType === "node-exporter"
                    ? [
                        {
                          name: "tag:Service",
                          values: ["NodeExporter", "monitoring"],
                        },
                      ]
                    : []),
                ],
              },
            ],
            relabel_configs: [
              {
                source_labels: ["__meta_ec2_private_ip"],
                target_label: "__address__",
                replacement: `\${1}:${firstTarget.port}`,
              },
              {
                source_labels: ["__meta_ec2_tag_Environment"],
                target_label: "environment",
              },
              {
                source_labels: ["__meta_ec2_instance_id"],
                target_label: "instance_id",
              },
              {
                source_labels: ["__meta_ec2_tag_Name"],
                target_label: "instance_name",
              },
              {
                source_labels: ["__meta_ec2_tag_Service"],
                target_label: "service",
              },
            ],
            metrics_path: firstTarget.metricsPath || "/metrics",
          });
        } else if (firstTarget.privateIp) {
          // Fallback to static configs if EC2 SD not available
          scrapeConfigs.push({
            job_name: `${firstTarget.targetType}-${firstTarget.envName}`,
            static_configs: [
              {
                targets: targets.map((t: CrossAccountTarget) => `${t.privateIp}:${t.port}`),
                labels: {
                  environment: firstTarget.envName,
                  service: firstTarget.targetType,
                  account: firstTarget.accountId || firstTarget.envName,
                },
              },
            ],
            metrics_path: firstTarget.metricsPath || "/metrics",
          });
        }
      }
    }

    const prometheusConfig = {
      global: {
        scrape_interval: "15s",
        evaluation_interval: "15s",
        external_labels: {
          environment: envName,
          cluster: `${envName}-monitoring`,
        },
      },
      rule_files: ["/etc/prometheus/alerts.yml"],
      scrape_configs: scrapeConfigs,
    };

    new ssm.StringParameter(this, "PrometheusConfig", {
      parameterName: `/monitoring/${envName}/prometheus-config`,
      stringValue: JSON.stringify(prometheusConfig, null, 2),
      description: "Prometheus configuration for monitoring stack",
      tier: ssm.ParameterTier.STANDARD,
    });

    // Grafana datasource configuration
    // Use HOST_IP_PLACEHOLDER which will be replaced at runtime with the EC2 instance's private IP
    // This is necessary because Grafana runs in BRIDGE network mode and cannot access
    // Prometheus (which runs in HOST mode) via localhost
    const grafanaDatasourceConfig = {
      apiVersion: 1,
      datasources: [
        {
          name: "Prometheus",
          type: "prometheus",
          access: "proxy",
          url: "http://HOST_IP_PLACEHOLDER:9090/prometheus",
          isDefault: true,
        },
      ],
    };

    new ssm.StringParameter(this, "GrafanaDatasourceConfig", {
      parameterName: `/monitoring/${envName}/grafana-datasource-config`,
      stringValue: JSON.stringify(grafanaDatasourceConfig, null, 2),
      description: "Grafana datasource configuration",
      tier: ssm.ParameterTier.STANDARD,
    });

    // Grafana dashboard configuration
    const grafanaDashboardConfig = {
      apiVersion: 1,
      providers: [
        {
          name: "default",
          orgId: 1,
          folder: "",
          type: "file",
          disableDeletion: false,
          updateIntervalSeconds: 10,
          allowUiUpdates: true,
          options: {
            path: "/var/lib/grafana/dashboards",
          },
        },
      ],
    };

    new ssm.StringParameter(this, "GrafanaDashboardConfig", {
      parameterName: `/monitoring/${envName}/grafana-dashboard-config`,
      stringValue: JSON.stringify(grafanaDashboardConfig, null, 2),
      description: "Grafana dashboard provider configuration",
      tier: ssm.ParameterTier.STANDARD,
    });
  }
}
