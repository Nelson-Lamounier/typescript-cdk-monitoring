/** @format */

import * as cdk from "aws-cdk-lib";
import * as autoscaling from "aws-cdk-lib/aws-autoscaling";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as kms from "aws-cdk-lib/aws-kms";
import * as logs from "aws-cdk-lib/aws-logs";
import { Tags } from "aws-cdk-lib";
import { NagSuppressions } from "cdk-nag";
import { Construct } from "constructs";

import {
  DEFAULT_ECS_ALLOW_INTERNAL_PORT_CIDR_FALLBACK,
  DEFAULT_ECS_BLOCK_DEVICE,
  DEFAULT_ECS_CAPACITY_STEP_SIZE,
  DEFAULT_ECS_CLUSTER_NAME_SUFFIX,
  DEFAULT_ECS_DESIRED_CAPACITY,
  DEFAULT_ECS_ENABLE_CONTAINER_INSIGHTS,
  DEFAULT_ECS_ENABLE_EXECUTE_COMMAND,
  DEFAULT_ECS_FARGATE_CAPACITY_PROVIDERS,
  DEFAULT_ECS_HEALTH_GRACE_PERIOD_SECONDS,
  DEFAULT_ECS_INSTANCE_TYPE,
  DEFAULT_ECS_LOG_GROUP_PREFIX,
  DEFAULT_ECS_LOG_RETENTION,
  DEFAULT_ECS_LOG_RETENTION_DEV,
  DEFAULT_ECS_MAX_CAPACITY,
  DEFAULT_ECS_MIN_CAPACITY,
  DEFAULT_ECS_SLOW_START_SECONDS,
  DEFAULT_ECS_STICKINESS_SECONDS,
  DEFAULT_ECS_TARGET_CAPACITY_PERCENT,
  DEFAULT_ECS_VOLUME_SIZE_GB,
} from "../../../shared/constants/compute-constants";
import { EcsClusterConstructProps } from "../../../shared/types/compute-types";
import {
  validateCapacityOrder,
  validateClusterName,
  validateEnvName,
  validateLogGroupName,
  validatePortInRange,
  validateVpcIdPresent,
} from "../../../shared/utils/validation";

/**
 * Construct for creating an ECS cluster with Auto Scaling Group for EC2 capacity
 */
export class EcsClusterConstruct extends Construct {
  public readonly cluster: ecs.Cluster;
  public readonly logGroup: logs.LogGroup;
  public readonly asg: autoscaling.AutoScalingGroup;
  public readonly launchTemplate: ec2.ILaunchTemplate;

  constructor(scope: Construct, id: string, props: EcsClusterConstructProps) {
    super(scope, id);

    const {
      vpc,
      envName,
      projectName,
      enableContainerInsights = DEFAULT_ECS_ENABLE_CONTAINER_INSIGHTS,
      enableFargateCapacityProviders = DEFAULT_ECS_FARGATE_CAPACITY_PROVIDERS,
      enableExecuteCommand = DEFAULT_ECS_ENABLE_EXECUTE_COMMAND,
      executeCommandConfig,
      logRetention,
      logGroupKmsKey,
      logRemovalPolicy,
      clusterName = `${envName}-${DEFAULT_ECS_CLUSTER_NAME_SUFFIX}`,
      instanceType = new ec2.InstanceType(DEFAULT_ECS_INSTANCE_TYPE),
      minCapacity = DEFAULT_ECS_MIN_CAPACITY,
      maxCapacity = DEFAULT_ECS_MAX_CAPACITY,
      desiredCapacity = DEFAULT_ECS_DESIRED_CAPACITY,
      usePublicSubnets = false,
      additionalSecurityGroups = [],
      customLaunchTemplate,
      customUserData,
      capacityProviderManagedScaling,
      spotOptions,
      detailedMonitoring = false,
      launchTemplateRole,
    } = props;

    validateEnvName(envName);
    validateClusterName(clusterName);
    validateCapacityOrder(minCapacity, desiredCapacity, maxCapacity);
    validateVpcIdPresent(vpc);

    const logGroupName = `${DEFAULT_ECS_LOG_GROUP_PREFIX}${clusterName}`;
    validateLogGroupName(logGroupName);

    const retention =
      logRetention ??
      (envName === "production" || envName === "prod"
        ? DEFAULT_ECS_LOG_RETENTION
        : DEFAULT_ECS_LOG_RETENTION_DEV);
    const removalPolicy =
      logRemovalPolicy ??
      (envName === "production" || envName === "prod"
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY);

    // Create CloudWatch log group for cluster
    this.logGroup = new logs.LogGroup(this, "ClusterLogGroup", {
      logGroupName,
      retention,
      encryptionKey: logGroupKmsKey,
      removalPolicy,
    });

    // Create ECS cluster
    this.cluster = new ecs.Cluster(this, "Cluster", {
      vpc,
      clusterName,
      containerInsights: enableContainerInsights,
      enableFargateCapacityProviders,
      executeCommandConfiguration:
        enableExecuteCommand || executeCommandConfig?.enable
          ? {
              logging:
                executeCommandConfig?.logging ?? ecs.ExecuteCommandLogging.OVERRIDE,
              kmsKey: executeCommandConfig?.kmsKey,
              logConfiguration: {
                cloudWatchLogGroup: this.logGroup,
                s3Bucket: executeCommandConfig?.logBucket,
              },
            }
          : undefined,
    });

    // Use custom launch template if provided, otherwise create default one
    if (customLaunchTemplate) {
      this.launchTemplate = customLaunchTemplate;
    } else {
      // NOTE: If you prefer the “launch template owns the security group” approach,
      // pass a custom launch template and avoid this default path.
      const instanceSecurityGroup = new ec2.SecurityGroup(
        this,
        "InstanceSecurityGroup",
        {
          vpc,
          description: `Security group for ${envName} ECS instances`,
          allowAllOutbound: false,
        }
      );

      instanceSecurityGroup.addEgressRule(
        ec2.Peer.anyIpv4(),
        ec2.Port.tcp(443),
        "Allow outbound HTTPS for SSM/ECS/ECR endpoints"
      );

      // Create IAM role for EC2 instances
      const instanceRole = new iam.Role(this, "InstanceRole", {
        assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName(
            "AmazonSSMManagedInstanceCore"
          ),
          iam.ManagedPolicy.fromAwsManagedPolicyName(
            "CloudWatchAgentServerPolicy"
          ),
          iam.ManagedPolicy.fromAwsManagedPolicyName(
            "service-role/AmazonEC2ContainerServiceforEC2Role"
          ),
        ],
      });

      // Add CloudWatch Logs permissions to the INSTANCE role
      // Required for ECS container instances to create log streams and put log events
      // This is required even though tasks use the task execution role, because the
      // ECS agent on the container instance also needs these permissions
      instanceRole.addToPrincipalPolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            "logs:CreateLogStream",
            "logs:PutLogEvents",
            "logs:DescribeLogStreams", // Required for log stream discovery
          ],
          resources: [
            `arn:aws:logs:${cdk.Stack.of(this).region}:${
              cdk.Stack.of(this).account
            }:log-group:/ecs/*:*`,
            `arn:aws:logs:${cdk.Stack.of(this).region}:${
              cdk.Stack.of(this).account
            }:log-group:/aws/ecs/*:*`,
          ],
        })
      );

      // Suppress CDK Nag warnings for AWS managed policies
      // These are standard AWS managed policies required for ECS instances
      NagSuppressions.addResourceSuppressions(instanceRole, [
        {
          id: "AwsSolutions-IAM4",
          reason:
            "AWS managed policies are required for ECS instances to function properly",
          appliesTo: [
            "Policy::arn:<AWS::Partition>:iam::aws:policy/AmazonSSMManagedInstanceCore",
            "Policy::arn:<AWS::Partition>:iam::aws:policy/CloudWatchAgentServerPolicy",
            "Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AmazonEC2ContainerServiceforEC2Role",
          ],
        },
        {
          id: "AwsSolutions-IAM5",
          reason:
            "CloudWatch Logs wildcard permissions are required for ECS container instances to create log streams for tasks. Log group names are determined at runtime when tasks start.",
          appliesTo: [
            // CloudWatch Logs wildcard permissions for ECS container instances
            `Resource::arn:aws:logs:${cdk.Stack.of(this).region}:${
              cdk.Stack.of(this).account
            }:log-group:/ecs/*:*`,
            `Resource::arn:aws:logs:${cdk.Stack.of(this).region}:${
              cdk.Stack.of(this).account
            }:log-group:/aws/ecs/*:*`,
            {
              regex:
                "/^Resource::arn:aws:logs:.*:.*:log-group:\\/ecs\\/.*:\\*$/",
            },
            {
              regex:
                "/^Resource::arn:aws:logs:.*:.*:log-group:\\/aws\\/ecs\\/.*:\\*$/",
            },
          ],
        },
      ]);

      // Use custom user data if provided, otherwise create default ECS user data
      const userData = customUserData || ec2.UserData.forLinux();
      if (!customUserData) {
        // Only add default ECS configuration if custom user data is not provided
        userData.addCommands(
          `echo ECS_CLUSTER=${clusterName} >> /etc/ecs/ecs.config`,
          "echo ECS_ENABLE_CONTAINER_METADATA=true >> /etc/ecs/ecs.config",
          "echo ECS_ENABLE_TASK_IAM_ROLE=true >> /etc/ecs/ecs.config",
          "yum update -y",
          "yum install -y amazon-cloudwatch-agent",
          "systemctl enable ecs",
          "systemctl start ecs"
        );
      }

      // Create default launch template
      // Using Amazon Linux 2023 ECS-optimized AMI (Amazon Linux 2 reaches EOL June 30, 2026)
      this.launchTemplate = new ec2.LaunchTemplate(this, "LaunchTemplate", {
        instanceType,
        machineImage: ecs.EcsOptimizedImage.amazonLinux2023(),
        userData,
        role: launchTemplateRole ?? instanceRole,
        // Use securityGroup (singular) if no additional groups, securityGroups (plural) if additional groups
        ...(additionalSecurityGroups.length > 0
          ? {
              securityGroups: [
                instanceSecurityGroup,
                ...additionalSecurityGroups,
              ],
            }
          : { securityGroup: instanceSecurityGroup }),
        blockDevices: [
          {
            deviceName: DEFAULT_ECS_BLOCK_DEVICE,
            volume: autoscaling.BlockDeviceVolume.ebs(DEFAULT_ECS_VOLUME_SIZE_GB, {
              volumeType: autoscaling.EbsDeviceVolumeType.GP3,
              encrypted: true,
            }),
          },
        ],
        // Security: Require IMDSv2 (Instance Metadata Service Version 2)
        // This prevents SSRF attacks and is an AWS security best practice
        requireImdsv2: true,
      });

    }

    // Create Auto Scaling Group
    this.asg = new autoscaling.AutoScalingGroup(this, "AutoScalingGroup", {
      vpc,
      launchTemplate: this.launchTemplate,
      minCapacity,
      maxCapacity,
      desiredCapacity,
      spotPrice: spotOptions?.spotPrice,
      vpcSubnets: {
        subnetType: usePublicSubnets
          ? ec2.SubnetType.PUBLIC
          : ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      healthChecks: autoscaling.HealthChecks.ec2({
        gracePeriod: cdk.Duration.seconds(DEFAULT_ECS_HEALTH_GRACE_PERIOD_SECONDS),
      }),
      instanceMonitoring: detailedMonitoring
        ? autoscaling.Monitoring.DETAILED
        : autoscaling.Monitoring.BASIC,
    });

    Tags.of(this.asg).add("Name", `${envName}-asg`, { applyToLaunchedInstances: true });
    Tags.of(this.asg).add("Environment", envName, { applyToLaunchedInstances: true });
    Tags.of(this.asg).add("ManagedBy", "CDK", { applyToLaunchedInstances: true });
    if (projectName) {
      Tags.of(this.asg).add("Project", projectName, {
        applyToLaunchedInstances: true,
      });
    }

    // CDK Nag suppressions for Auto Scaling Group and its resources
    // Apply recursively to child resources (including Lambda function and its role policy)
    NagSuppressions.addResourceSuppressions(
      this.asg,
      [
        {
          id: "AwsSolutions-IAM5",
          reason:
            "Auto Scaling Group lifecycle hook Lambda (DrainECSHook) requires permissions to manage Auto Scaling lifecycle actions. The wildcard is scoped to the specific Auto Scaling Group name pattern and is necessary for proper instance lifecycle management during ECS task draining. This is a CDK-managed resource.",
          appliesTo: [
            {
              regex:
                "/^Resource::arn:(aws|<AWS::Partition>):autoscaling:.*:.*:autoScalingGroup:\\*:autoScalingGroupName\\/<.*>$/",
            },
          ],
        },
        {
          id: "AwsSolutions-SNS3",
          reason:
            "SNS topic SSL/TLS enforcement is not configured for CDK-managed topics used by Auto Scaling lifecycle hooks. These topics are internal to AWS services and use AWS's internal secure communication. For custom SNS topics, SSL/TLS should be enforced.",
        },
      ],
      true // Apply recursively to child resources
    );

    // Add capacity provider to cluster
    // IMPORTANT: With managed scaling enabled, ECS controls ASG scaling based on task demand.
    // However, the ASG will still launch instances based on desiredCapacity initially.
    //
    // If container instances aren't appearing in ECS:
    // 1. Check ASG in EC2 console - verify instances are launching (desiredCapacity > 0)
    // 2. Check instance status - instances must pass health checks
    // 3. Verify ECS agent is running on instances (check /var/log/ecs/ecs-agent.log)
    // 4. Verify ECS_CLUSTER environment variable matches cluster name
    // 5. Check security groups allow outbound traffic (for ECS agent communication)
    // 6. For public subnets: verify instances have public IPs
    // 7. For private subnets: verify NAT gateway is configured
    const capacityProvider = new ecs.AsgCapacityProvider(this, "CapacityProvider", {
      autoScalingGroup: this.asg,
      enableManagedScaling:
        capacityProviderManagedScaling?.enableManagedScaling ?? true,
      managedScalingTargetCapacity:
        capacityProviderManagedScaling?.targetCapacityPercent ??
        DEFAULT_ECS_TARGET_CAPACITY_PERCENT,
      minimumScalingStepSize:
        capacityProviderManagedScaling?.minimumScalingStepSize ??
        DEFAULT_ECS_CAPACITY_STEP_SIZE,
      maximumScalingStepSize:
        capacityProviderManagedScaling?.maximumScalingStepSize ??
        DEFAULT_ECS_CAPACITY_STEP_SIZE,
      enableManagedTerminationProtection: false,
    });

    this.cluster.addAsgCapacityProvider(capacityProvider);

    // Add tags to cluster
    Tags.of(this.cluster).add("Name", clusterName);
    Tags.of(this.cluster).add("Environment", envName);
    Tags.of(this.cluster).add("ManagedBy", "CDK");
    if (projectName) {
      Tags.of(this.cluster).add("Project", projectName);
    }

    if (
      (envName === "production" || envName === "prod") &&
      minCapacity < 2
    ) {
      cdk.Annotations.of(this).addWarning(
        "Minimum capacity is below 2 in production. Consider at least two instances for high availability."
      );
    }

    if (
      (envName === "production" || envName === "prod") &&
      instanceType.toString().includes("t3.micro")
    ) {
      cdk.Annotations.of(this).addWarning(
        "Instance type t3.micro is small for production ECS clusters. Consider larger sizes for reliability."
      );
    }

    if (
      (envName === "production" || envName === "prod") &&
      !logGroupKmsKey
    ) {
      cdk.Annotations.of(this).addWarning(
        "Cluster log group does not use a customer-managed KMS key in production. Consider providing logGroupKmsKey."
      );
    }

    if (
      enableContainerInsights &&
      (envName === "production" || envName === "prod")
    ) {
      cdk.Annotations.of(this).addWarning(
        "Container Insights is enabled. Review potential cost impact in production."
      );
    }

    // Note: Outputs are handled at the stack level to avoid cyclic dependencies
    // The stack that uses this construct should create the necessary outputs
  }

  /**
   * Allow internal traffic on a specific port
   */
  public allowInternalPort(
    port: number,
    description: string,
    cidr?: string
  ): void {
    validatePortInRange(port, "Internal port");
    // Use provided CIDR or the VPC CIDR as the default
    const vpcCidr =
      cidr || this.asg.vpc.vpcCidrBlock || DEFAULT_ECS_ALLOW_INTERNAL_PORT_CIDR_FALLBACK;
    // Use ASG connections rather than a construct-owned SG so this continues to
    // work even when the launch template is responsible for the security groups.
    this.asg.connections.allowFrom(
      ec2.Peer.ipv4(vpcCidr),
      ec2.Port.tcp(port),
      description
    );
  }
}
