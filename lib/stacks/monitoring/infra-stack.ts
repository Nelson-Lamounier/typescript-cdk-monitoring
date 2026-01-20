/** @format */

import * as cdk from "aws-cdk-lib";
import * as autoscaling from "aws-cdk-lib/aws-autoscaling";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as events from "aws-cdk-lib/aws-events";
import * as events_targets from "aws-cdk-lib/aws-events-targets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import { NagSuppressions } from "cdk-nag";
import { Construct } from "constructs";

import { SuppressionManager } from "../../cdk-nag";
import { UserDataConstruct } from "../../shared/helpers/user-data-construct";
import { EcsClusterConstruct } from "../../constructs/compute/ecs";
import { LaunchTemplateConstruct } from "../../constructs/compute/launch-template";
import { SsmStateManagerConstruct } from "../../constructs/compute/ssm";
import {
  AlbConstruct,
  AlbListenerConstruct,
} from "../../constructs/networking/alb";
import { SsmParametersConstruct } from "../../constructs/config";
import { applyStackTags } from "../../shared/helpers/stack-tagging-helper";
import { MonitoringInfraStackProps } from "../../shared/types/stack-types";
import {
  MONITORING_PORTS,
  BRIDGE_NETWORK_DYNAMIC_PORT_RANGE,
  MONITORING_TASK_LOG_RETENTION,
  MONITORING_EVENT_LOG_RETENTION,
  MONITORING_ALB_IDLE_TIMEOUT,
  MONITORING_CAPACITY_DEFAULTS,
} from "../../shared/constants/monitoring-constants";
import { DEFAULT_ASG_BLOCK_DEVICE_SIZE_GB } from "../../shared/constants/compute-constants";
import {
  validateEnvName,
  validateSecurityGroupCidr,
  validateCapacityOrder,
} from "../../shared/utils/validation";
import { isProductionEnvironment } from "../../shared/utils/environment";

/**
 * MonitoringInfraStack - Layer 1: Long-lived Infrastructure
 *
 * This stack provisions the foundational infrastructure for monitoring services.
 * It should only be deployed when infrastructure changes (rare).
 *
 * Components:
 * - ECS Cluster with Container Insights
 * - EC2 Auto Scaling Group with ECS-optimised Amazon Linux 2023 AMI
 * - Launch Template with IMDSv2 enforcement
 * - Application Load Balancer with HTTP/HTTPS listeners
 * - Security Groups for ALB and ECS instances
 * - CloudWatch Log Groups for task logs and ECS events
 * - SSM State Manager associations for ECS agent and application setup
 * - IAM roles and policies
 * - S3 bucket for monitoring configuration
 *
 * Dependencies:
 * - NetworkingStack (for VPC)
 * - MonitoringEfsStack (for persistent storage)
 *
 * Architecture Pattern:
 * - Enhanced User Data: SSM agent bootstrap with CloudFormation signalling (~30-180s)
 * - SSM State Manager: Application setup after instance registers with retry logic
 * - Bootstrap Metadata: Tracked in SSM Parameter Store for auditing
 * - EFS: Persistent storage for Prometheus/Grafana data
 * - ALB: Path-based routing to Grafana (/grafana) and Prometheus (/prometheus)
 *
 * Bootstrap Process:
 * 1. User Data: Install SSM agent, collect metadata, optional system updates
 * 2. CloudFormation Signal: Instance reports readiness to CloudFormation
 * 3. SSM State Manager: Configure ECS agent, CloudWatch agent, log collection
 * 4. ECS Registration: Instance joins cluster and becomes available for tasks
 *
 * SSM Parameters Created:
 * - `/monitoring/${envName}/infra/cluster-name` - ECS cluster name
 * - `/monitoring/${envName}/infra/cluster-arn` - ECS cluster ARN
 * - `/monitoring/${envName}/infra/alb-dns` - Load balancer DNS
 * - `/monitoring/${envName}/infra/listener-arn` - ALB listener ARN
 * - `/monitoring/${envName}/infra/asg-name` - Auto Scaling Group name
 * - `/bootstrap/${envName}/instances/{instanceId}` - Bootstrap metadata (if enabled)
 *
 * Production Recommendations:
 * - enableHttps: true (with valid ACM certificate)
 * - allowedIpRanges: Restrict to corporate IPs
 * - enableAccessLogs: true (with S3 bucket)
 * - minCapacity: 2+ (high availability)
 * - desiredCapacity: 2+ (zero-downtime deployments)
 * - enableDeletionProtection: true (prevent accidental ALB deletion)
 * - enableSystemUpdates: true (apply security patches during boot)
 * - enableMetadataTracking: true (audit trail and troubleshooting)
 *
 * @example
 * ```typescript
 * // Development
 * const infraStack = new MonitoringInfraStack(app, 'MonitoringInfra', {
 *   envName: 'dev',
 *   vpc: networkingStack.vpc,
 *   fileSystem: efsStack.fileSystem,
 *   efsAccessPoint: efsStack.accessPoint,
 *   efsAvailabilityZone: efsStack.availabilityZone,
 *   efsSecurityGroup: efsStack.securityGroup,
 *   efsInitializationComplete: efsStack.initializationComplete,
 *   efsStackName: efsStack.stackName,
 *   // Optional: Disable system updates for faster boots in dev
 *   enableSystemUpdates: false,
 * });
 *
 * // Production
 * const infraStack = new MonitoringInfraStack(app, 'MonitoringInfra', {
 *   envName: 'production',
 *   vpc: networkingStack.vpc,
 *   fileSystem: efsStack.fileSystem,
 *   efsAccessPoint: efsStack.accessPoint,
 *   efsAvailabilityZone: efsStack.availabilityZone,
 *   efsSecurityGroup: efsStack.securityGroup,
 *   efsInitializationComplete: efsStack.initializationComplete,
 *   efsStackName: efsStack.stackName,
 *   enableHttps: true,
 *   certificateArn: 'arn:aws:acm:...',
 *   allowedIpRanges: ['10.0.0.0/8'], // Corporate network
 *   enableAccessLogs: true,
 *   accessLogsBucket: logsBucket,
 *   minCapacity: 2,
 *   maxCapacity: 3,
 *   desiredCapacity: 2,
 *   enableDeletionProtection: true,
 *   // Production: Enable system updates and metadata tracking
 *   enableSystemUpdates: true,
 *   enableMetadataTracking: true,
 *   // Optional: Custom SSM State Manager schedules
 *   ssmEcsAgentConfig: {
 *     scheduleExpression: 'rate(3 days)',
 *     complianceSeverity: 'CRITICAL',
 *   },
 * });
 * ```
 */
export class MonitoringInfraStack extends cdk.Stack {
  /**
   * ECS cluster
   */
  public readonly cluster: ecs.Cluster;

  /**
   * Auto Scaling Group
   */
  public readonly autoScalingGroup: autoscaling.AutoScalingGroup;

  /**
   * Application Load Balancer
   */
  public readonly loadBalancer: elbv2.ApplicationLoadBalancer;

  /**
   * ALB Listener
   */
  public readonly listener: elbv2.ApplicationListener;

  /**
   * Task log group
   */
  public readonly taskLogGroup: logs.LogGroup;

  /**
   * Event log group
   */
  public readonly eventLogGroup: logs.LogGroup;

  /**
   * SSM Parameters construct (if enabled)
   */
  public readonly ssmParameters?: SsmParametersConstruct;

  constructor(scope: Construct, id: string, props: MonitoringInfraStackProps) {
    super(scope, id, props);

    // ========================================================================
    // VALIDATION
    // ========================================================================
    validateEnvName(props.envName);

    if (!props.vpc) {
      throw new Error(
        "VPC is required for MonitoringInfraStack.\n\n" +
          "Pass the VPC from NetworkingStack via props."
      );
    }

    if (!props.fileSystem) {
      throw new Error(
        "EFS file system is required for MonitoringInfraStack.\n\n" +
          "Pass the file system from MonitoringEfsStack via props."
      );
    }

    if (!props.efsSecurityGroup) {
      throw new Error(
        "EFS security group is required for MonitoringInfraStack.\n\n" +
          "Pass the security group from MonitoringEfsStack via props."
      );
    }

    if (!props.efsInitializationComplete) {
      throw new Error(
        "EFS initialization complete resource is required.\n\n" +
          "Pass the custom resource from MonitoringEfsStack via props."
      );
    }

    // Validate HTTPS configuration
    if (props.enableHttps && !props.certificateArn) {
      throw new Error(
        "certificateArn is required when enableHttps is true.\n\n" +
          "Provide an ACM certificate ARN for HTTPS.\n" +
          "Example: arn:aws:acm:us-east-1:123456789012:certificate/..."
      );
    }

    // Validate access logs configuration
    if (props.enableAccessLogs && !props.accessLogsBucket) {
      throw new Error(
        "accessLogsBucket is required when enableAccessLogs is true.\n\n" +
          "Provide an S3 bucket for ALB access logs."
      );
    }

    // Validate allowed IP ranges
    const allowedIpRanges = props.allowedIpRanges || ["0.0.0.0/0"];
    allowedIpRanges.forEach((cidr: string) => {
      validateSecurityGroupCidr(cidr);
    });

    // Environment-aware defaults
    const isProduction = isProductionEnvironment(props.envName);
    const capacityDefaults = isProduction
      ? MONITORING_CAPACITY_DEFAULTS.PRODUCTION
      : MONITORING_CAPACITY_DEFAULTS.DEV;

    const minCapacity = props.minCapacity ?? capacityDefaults.minCapacity;
    const maxCapacity = props.maxCapacity ?? capacityDefaults.maxCapacity;
    const desiredCapacity =
      props.desiredCapacity ?? capacityDefaults.desiredCapacity;

    validateCapacityOrder(minCapacity, desiredCapacity, maxCapacity);

    // Instance type selection based on environment capacity requirements
    // Development/Staging: t3.small (2 GiB) - sufficient for reduced memory tasks
    // Production: t3.medium (4 GiB) - provides buffer for full memory allocation
    // See docs/CAPACITY_ANALYSIS.md for detailed memory planning
    const instanceType =
      props.instanceType ??
      (isProduction
        ? ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MEDIUM) // 4 GiB for production
        : ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.SMALL)); // 2 GiB for dev/staging

    // ========================================================================
    // PRODUCTION WARNINGS
    // ========================================================================
    if (props.enableProductionWarnings !== false && isProduction) {
      this.logProductionWarnings(
        props,
        allowedIpRanges,
        minCapacity,
        desiredCapacity
      );
    }

    // ========================================================================
    // 1. CLOUDWATCH LOG GROUPS
    // ========================================================================
    const taskLogRetention =
      props.taskLogRetention ?? MONITORING_TASK_LOG_RETENTION;
    const eventLogRetention =
      props.eventLogRetention ?? MONITORING_EVENT_LOG_RETENTION;

    this.taskLogGroup = new logs.LogGroup(this, "TaskLogGroup", {
      logGroupName: `/ecs/${this.stackName}/tasks`,
      retention: taskLogRetention,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.eventLogGroup = new logs.LogGroup(this, "EventLogGroup", {
      logGroupName: `/ecs/${this.stackName}/events`,
      retention: eventLogRetention,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ========================================================================
    // 2. ENHANCED USER DATA WITH CLOUDFORMATION SIGNALLING
    // ========================================================================
    const clusterName =
      props.clusterName ||
      (props.projectName
        ? `${props.envName}-${props.projectName}-monitoring-cluster`
        : `${props.envName}-monitoring-cluster`);

    // Enhanced UserData with CloudFormation signalling, metadata tracking, and optional system updates
    // This ensures the Auto Scaling Group doesn't report CREATE_COMPLETE until instances are actually ready
    const userDataConstruct = new UserDataConstruct(this, "UserData", {
      envName: props.envName,
      clusterName,
      // CloudFormation signalling configuration
      // Signals are sent after SSM agent is verified and running
      stackName: this.stackName,
      logicalResourceId: "EcsAutoScalingGroup", // Will be set as ASG logical ID
      region: this.region,
      // Enable system updates in production for security patches
      // Adds 1-3 minutes to boot time but ensures latest patches
      enableSystemUpdates: props.enableSystemUpdates ?? isProduction,
      // Enable bootstrap metadata tracking in SSM Parameter Store
      // Stores bootstrap version, timestamp, instance details for auditing
      enableMetadataTracking: props.enableMetadataTracking !== false,
      // Optional: Custom metadata parameter prefix
      metadataParameterPrefix: props.metadataParameterPrefix,
      // Optional: Custom bootstrap version for tracking configuration changes
      bootstrapVersion: props.bootstrapVersion,
    });

    // ========================================================================
    // 3. LAUNCH TEMPLATE
    // ========================================================================
    const ltConstruct = new LaunchTemplateConstruct(this, "LaunchTemplate", {
      vpc: props.vpc,
      envName: props.envName,
      projectName: props.projectName,
      instanceType,
      machineImage: ecs.EcsOptimizedImage.amazonLinux2023(),
      userData: userDataConstruct.userData,
      associatePublicIpAddress: true,
      blockDevices: [
        {
          deviceName: "/dev/xvda",
          volume: ec2.BlockDeviceVolume.ebs(DEFAULT_ASG_BLOCK_DEVICE_SIZE_GB, {
            volumeType: ec2.EbsDeviceVolumeType.GP3,
            encrypted: true,
            deleteOnTermination: true,
          }),
        },
      ],
    });

    // Add ECS managed policy
    ltConstruct.role.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName(
        "service-role/AmazonEC2ContainerServiceforEC2Role"
      )
    );

    // Add EFS permissions
    ltConstruct.role.addToPrincipalPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "elasticfilesystem:ClientMount",
          "elasticfilesystem:ClientWrite",
          "elasticfilesystem:ClientRootAccess",
        ],
        resources: [props.fileSystem.fileSystemArn],
      })
    );

    // Add SSM permissions
    ltConstruct.role.addToPrincipalPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "ssm:GetParameter",
          "ssm:GetParameters",
          "ssm:GetParametersByPath",
        ],
        resources: ["*"],
      })
    );

    // Add SSM Parameter Store write permissions for bootstrap metadata
    // Allows instances to store bootstrap information for auditing and troubleshooting
    if (props.enableMetadataTracking !== false) {
      const metadataPrefix = props.metadataParameterPrefix ?? "/bootstrap";
      ltConstruct.role.addToPrincipalPolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ["ssm:PutParameter", "ssm:AddTagsToResource"],
          resources: [
            `arn:aws:ssm:${this.region}:${this.account}:parameter${metadataPrefix}/${props.envName}/instances/*`,
          ],
        })
      );
    }

    // Add CloudWatch Logs permissions
    ltConstruct.role.addToPrincipalPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "logs:CreateLogStream",
          "logs:PutLogEvents",
          "logs:DescribeLogStreams",
        ],
        resources: [
          `arn:aws:logs:${this.region}:${this.account}:log-group:/ecs/*:*`,
          `arn:aws:logs:${this.region}:${this.account}:log-group:/aws/ecs/*:*`,
        ],
      })
    );

    // CDK Nag suppressions
    NagSuppressions.addResourceSuppressions(
      ltConstruct.role,
      [
        {
          id: "AwsSolutions-IAM4",
          reason:
            "AWS managed policies required for ECS monitoring instances (SSM, CloudWatch, ECS).",
          appliesTo: [
            "Policy::arn:<AWS::Partition>:iam::aws:policy/AmazonSSMManagedInstanceCore",
            "Policy::arn:<AWS::Partition>:iam::aws:policy/CloudWatchAgentServerPolicy",
            "Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AmazonEC2ContainerServiceforEC2Role",
          ],
        },
        {
          id: "AwsSolutions-IAM5",
          reason:
            "SSM parameter access, CloudWatch Logs, and bootstrap metadata wildcard permissions required for runtime operations.",
          appliesTo: [
            "Action::ssm:GetParameter",
            "Action::ssm:GetParameters",
            "Action::ssm:GetParametersByPath",
            "Action::ssm:PutParameter",
            "Action::ssm:AddTagsToResource",
            `Resource::arn:aws:logs:${this.region}:${this.account}:log-group:/ecs/*:*`,
            `Resource::arn:aws:logs:${this.region}:${this.account}:log-group:/aws/ecs/*:*`,
            `Resource::arn:aws:ssm:${this.region}:${this.account}:parameter${
              props.metadataParameterPrefix ?? "/bootstrap"
            }/${props.envName}/instances/*`,
          ],
        },
      ],
      true
    );

    // ========================================================================
    // 4. ECS CLUSTER
    // ========================================================================
    const ecsClusterConstruct = new EcsClusterConstruct(this, "EcsCluster", {
      vpc: props.vpc,
      envName: props.envName,
      enableContainerInsights: props.enableContainerInsights ?? true,
      enableExecuteCommand: props.enableExecuteCommand ?? true,
      logRetention: taskLogRetention,
      clusterName,
      customLaunchTemplate: ltConstruct.launchTemplate,
      minCapacity,
      maxCapacity,
      desiredCapacity,
      usePublicSubnets: props.usePublicSubnets ?? true,
      // Align with EFS availability zone for optimal performance
      availabilityZones: props.efsAvailabilityZone
        ? [props.efsAvailabilityZone]
        : undefined,
    });

    this.cluster = ecsClusterConstruct.cluster;
    this.autoScalingGroup = ecsClusterConstruct.asg;

    // ========================================================================
    // 5. VPC ENDPOINT FOR CLOUDWATCH LOGS
    // ========================================================================
    // Only create VPC endpoint if using private subnets
    // Public subnets use Internet Gateway (no additional cost)
    if (props.usePublicSubnets === false) {
      props.vpc.addInterfaceEndpoint("CloudWatchLogsEndpoint", {
        service: ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS,
        subnets: {
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
        privateDnsEnabled: true,
      });

      cdk.Annotations.of(this).addInfo(
        "Created CloudWatch Logs VPC endpoint for private subnet access (~£7/month)"
      );
    } else {
      cdk.Annotations.of(this).addInfo(
        "Skipping CloudWatch Logs VPC endpoint (instances in public subnets use Internet Gateway)"
      );
    }

    // ========================================================================
    // 6. SSM STATE MANAGER ASSOCIATIONS
    // ========================================================================
    // CRITICAL: SSM State Manager handles all post-boot configuration on EVERY EC2 instance:
    // - EFS mounting at /mnt/efs using the file system ID
    // - Executes EFS setup script (generated by SSM Automation Document during EFS stack deployment)
    // - ECS agent installation and configuration with retry logic
    // - CloudWatch Agent installation for log collection
    // - Log group configuration for containers, ECS agent, and init logs
    //
    // Configuration is applied on a schedule to correct drift automatically
    // Production: Every 7 days, Non-production: Every 30 days
    new SsmStateManagerConstruct(this, "SsmStateManager", {
      envName: props.envName,
      projectName: props.projectName,
      clusterName,
      instanceRole: ltConstruct.role,
      // CRITICAL: EFS mounting configuration
      // Without this, EC2 instances CANNOT access EFS!
      fileSystemId: props.fileSystem.fileSystemId,
      efsMountPoint: "/mnt/efs",
      // Optional: Override SSM association schedules
      ecsAgent: props.ssmEcsAgentConfig,
      cloudWatchAgent: props.ssmCloudWatchAgentConfig,
      // Optional: Custom SSM targets (defaults to Environment tag)
      targets: props.ssmTargets,
    });

    // ========================================
    // 7. APPLICATION LOAD BALANCER
    // ========================================
    const albConstruct = new AlbConstruct(this, "LoadBalancer", {
      vpc: props.vpc,
      envName: props.envName,
      projectName: props.projectName,
      internetFacing: true,
      accessLogEnabled: props.enableAccessLogs ?? false,
      accessLogBucket: props.accessLogsBucket,
      idleTimeout: props.albIdleTimeout ?? MONITORING_ALB_IDLE_TIMEOUT,
      deletionProtection: props.enableDeletionProtection ?? false,
      loadBalancerName: props.projectName
        ? `${props.envName}-${props.projectName}-mon-alb`
        : `${props.envName}-monitoring-alb`,
    });

    this.loadBalancer = albConstruct.loadBalancer;

    // Configure security group for allowed IP ranges
    const albSecurityGroup = this.loadBalancer.connections.securityGroups[0];
    allowedIpRanges.forEach((cidr: string) => {
      albSecurityGroup.addIngressRule(
        ec2.Peer.ipv4(cidr),
        ec2.Port.tcp(80),
        `Allow HTTP from ${cidr}`
      );
      if (props.enableHttps) {
        albSecurityGroup.addIngressRule(
          ec2.Peer.ipv4(cidr),
          ec2.Port.tcp(443),
          `Allow HTTPS from ${cidr}`
        );
      }
    });

    // ========================================
    // 8. ALB LISTENER
    // ========================================
    const listenerConstruct = new AlbListenerConstruct(this, "Listener", {
      envName: props.envName,
      loadBalancer: this.loadBalancer,
      enableHttp: true,
      enableHttps: props.enableHttps ?? false,
      certificateArn: props.certificateArn,
      redirectHttpToHttps: props.enableHttps ?? false,
    });

    this.listener = listenerConstruct.listener;

    // ========================================
    // 9. SECURITY GROUP RULES - ECS TO ALB AND EFS
    // ========================================
    // Note: ALB security group rules for allowed IPs configured above

    // Allow ALB to reach Grafana on dynamic ports (bridge networking)
    ltConstruct.securityGroup.addIngressRule(
      albSecurityGroup,
      ec2.Port.tcpRange(
        BRIDGE_NETWORK_DYNAMIC_PORT_RANGE.MIN,
        BRIDGE_NETWORK_DYNAMIC_PORT_RANGE.MAX
      ),
      "Allow ALB to reach Grafana on dynamic ports (bridge networking)"
    );

    // Allow ALB to reach Prometheus on fixed port
    ltConstruct.securityGroup.addIngressRule(
      albSecurityGroup,
      ec2.Port.tcp(MONITORING_PORTS.PROMETHEUS),
      "Allow ALB to reach Prometheus on port 9090"
    );

    // CRITICAL: Allow ECS instances to communicate with each other on Prometheus port
    // Required for Grafana (running on same EC2) to access Prometheus via private IP
    // Without this, Grafana cannot reach Prometheus datasource
    ltConstruct.securityGroup.addIngressRule(
      ltConstruct.securityGroup,
      ec2.Port.tcp(MONITORING_PORTS.PROMETHEUS),
      "Allow ECS instances to access Prometheus within VPC (Grafana datasource)"
    );

    // CRITICAL: Allow ECS instances to connect to EFS
    // Without this rule, EFS mounting will fail!
    // We add an egress rule from ECS to EFS instead of ingress on EFS
    // to avoid circular dependency (EFS stack cannot reference InfraStack resources)
    ltConstruct.securityGroup.addEgressRule(
      props.efsSecurityGroup,
      ec2.Port.tcp(2049),
      "Allow ECS instances to mount EFS via NFS"
    );

    // ========================================================================
    // 10. ECS EVENT RULE
    // ========================================================================
    new events.Rule(this, "EcsEventRule", {
      description: `Capture ECS events for ${props.envName} monitoring`,
      eventPattern: {
        source: ["aws.ecs"],
        detailType: [
          "ECS Task State Change",
          "ECS Container Instance State Change",
          "ECS Service Action",
        ],
        detail: {
          clusterArn: [this.cluster.clusterArn],
        },
      },
      targets: [new events_targets.CloudWatchLogGroup(this.eventLogGroup)],
    });

    // ========================================================================
    // 11. DEPENDENCIES
    // ========================================================================
    this.cluster.node.addDependency(props.efsInitializationComplete);
    this.autoScalingGroup.node.addDependency(props.efsInitializationComplete);

    // ========================================================================
    // 12. SSM PARAMETERS (for cross-stack discovery)
    // ========================================================================
    if (props.createSsmParameters !== false) {
      this.ssmParameters = new SsmParametersConstruct(this, "Parameters", {
        envName: props.envName,
        projectName: props.projectName,
        pathPrefix: `/monitoring/${props.envName}/infra`,
        customParameters: [
          {
            name: "cluster-name",
            value: this.cluster.clusterName,
            description: `ECS cluster name for ${props.envName} monitoring`,
          },
          {
            name: "cluster-arn",
            value: this.cluster.clusterArn,
            description: `ECS cluster ARN for ${props.envName} monitoring`,
          },
          {
            name: "alb-dns",
            value: this.loadBalancer.loadBalancerDnsName,
            description: `ALB DNS for ${props.envName} monitoring`,
          },
          {
            name: "listener-arn",
            value: this.listener.listenerArn,
            description: `ALB listener ARN for ${props.envName} monitoring`,
          },
          {
            name: "asg-name",
            value: this.autoScalingGroup.autoScalingGroupName,
            description: `Auto Scaling Group name for ${props.envName} monitoring`,
          },
        ],
      });
    }

    // ========================================================================
    // 13. CLOUDFORMATION OUTPUTS
    // ========================================================================
    if (props.createOutputs !== false) {
      this.createOutputs(props);
    }

    // ========================================
    // 14. RESOURCE TAGGING
    // ========================================
    applyStackTags(this, props.envName, props.projectName, {
      ...props.customTags,
      StackName: "MonitoringInfra",
      Layer: "Infrastructure",
    });

    // ========================================================================
    // 15. CDK NAG SUPPRESSIONS
    // ========================================================================
    SuppressionManager.applyToStack(
      this,
      "MonitoringInfraStack",
      props.envName
    );
  }

  /**
   * Log production warnings
   */
  private logProductionWarnings(
    props: MonitoringInfraStackProps,
    allowedIpRanges: string[],
    minCapacity: number,
    desiredCapacity: number
  ): void {
    // Warn about HTTP instead of HTTPS
    if (!props.enableHttps) {
      cdk.Annotations.of(this).addWarning(
        "PRODUCTION: HTTPS not enabled. " +
          "Grafana credentials and metrics will be transmitted in plaintext. " +
          "Enable HTTPS with a valid ACM certificate for production."
      );
    }

    // Warn about access logs
    if (!props.enableAccessLogs) {
      cdk.Annotations.of(this).addWarning(
        "PRODUCTION: ALB access logs disabled. " +
          "This reduces security visibility and may violate compliance requirements. " +
          "Enable access logs for audit trail and troubleshooting."
      );
    }

    // Warn about open access
    if (
      allowedIpRanges.includes("0.0.0.0/0") ||
      allowedIpRanges.includes("::/0")
    ) {
      cdk.Annotations.of(this).addWarning(
        "PRODUCTION: ALB allows access from 0.0.0.0/0 (entire internet). " +
          "Restrict allowedIpRanges to corporate IPs or VPN ranges. " +
          "Exposing monitoring dashboards publicly is a security risk."
      );
    }

    // Warn about single instance
    if (minCapacity < 2) {
      cdk.Annotations.of(this).addWarning(
        `PRODUCTION: minCapacity is ${minCapacity}. ` +
          "For high availability, set minCapacity to 2+ across multiple AZs. " +
          "Single instance is a single point of failure."
      );
    }

    if (desiredCapacity < 2) {
      cdk.Annotations.of(this).addWarning(
        `PRODUCTION: desiredCapacity is ${desiredCapacity}. ` +
          "For zero-downtime deployments, set desiredCapacity to 2+. " +
          "Single instance prevents rolling updates."
      );
    }

    // Warn about public subnets
    if (props.usePublicSubnets !== false) {
      cdk.Annotations.of(this).addInfo(
        "PRODUCTION: ECS instances in public subnets. " +
          "This is acceptable for monitoring infrastructure with proper security groups. " +
          "Consider private subnets with NAT Gateway for additional security layer."
      );
    }

    // Warn about deletion protection
    if (!props.enableDeletionProtection) {
      cdk.Annotations.of(this).addWarning(
        "PRODUCTION: ALB deletion protection disabled. " +
          "Enable deletion protection to prevent accidental ALB deletion. " +
          "ALB deletion causes service downtime."
      );
    }
  }

  /**
   * Create CloudFormation outputs
   */
  private createOutputs(props: MonitoringInfraStackProps): void {
    const enableExports = props.enableExports ?? false;
    const exportPrefix = props.projectName
      ? `${props.envName}-${props.projectName}`
      : `${props.envName}`;

    const protocol = props.enableHttps ? "https" : "http";

    // Essential outputs
    new cdk.CfnOutput(this, "ClusterName", {
      value: this.cluster.clusterName,
      description: `ECS cluster name for ${props.envName} monitoring`,
      exportName: enableExports
        ? `${exportPrefix}-monitoring-cluster-name`
        : undefined,
    });

    new cdk.CfnOutput(this, "ClusterArn", {
      value: this.cluster.clusterArn,
      description: `ECS cluster ARN for ${props.envName} monitoring`,
      exportName: enableExports
        ? `${exportPrefix}-monitoring-cluster-arn`
        : undefined,
    });

    new cdk.CfnOutput(this, "LoadBalancerDns", {
      value: this.loadBalancer.loadBalancerDnsName,
      description: "ALB DNS name for monitoring services",
      exportName: enableExports
        ? `${exportPrefix}-monitoring-alb-dns`
        : undefined,
    });

    new cdk.CfnOutput(this, "ListenerArn", {
      value: this.listener.listenerArn,
      description: "ALB listener ARN",
      exportName: enableExports
        ? `${exportPrefix}-monitoring-listener-arn`
        : undefined,
    });

    // Monitoring URLs
    new cdk.CfnOutput(this, "MonitoringUrl", {
      value: `${protocol}://${this.loadBalancer.loadBalancerDnsName}`,
      description: "Base URL for monitoring services",
    });

    new cdk.CfnOutput(this, "PrometheusUrl", {
      value: `${protocol}://${this.loadBalancer.loadBalancerDnsName}/prometheus`,
      description: "Prometheus URL",
    });

    new cdk.CfnOutput(this, "GrafanaUrl", {
      value: `${protocol}://${this.loadBalancer.loadBalancerDnsName}/grafana`,
      description: "Grafana URL (default credentials: admin/admin)",
    });

    // Diagnostic outputs
    new cdk.CfnOutput(this, "AutoScalingGroupName", {
      value: this.autoScalingGroup.autoScalingGroupName,
      description:
        "Auto Scaling Group name (check EC2 console to verify instances)",
    });

    new cdk.CfnOutput(this, "TaskLogGroupName", {
      value: this.taskLogGroup.logGroupName,
      description: "CloudWatch Log Group for ECS task logs",
    });

    // SSM parameters info
    if (this.ssmParameters) {
      new cdk.CfnOutput(this, "SsmParameterPrefix", {
        value: this.ssmParameters.pathPrefix,
        description:
          "SSM Parameter Store path prefix for monitoring infrastructure",
      });
    }
  }
}
