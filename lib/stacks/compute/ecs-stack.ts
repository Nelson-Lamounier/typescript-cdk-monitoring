/** @format */

import * as path from "path";

import * as cdk from "aws-cdk-lib";
import * as autoscaling from "aws-cdk-lib/aws-autoscaling";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as efs from "aws-cdk-lib/aws-efs";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3_assets from "aws-cdk-lib/aws-s3-assets";
import * as cw from "aws-cdk-lib/aws-cloudwatch";
import { Tags } from "aws-cdk-lib";
import { NagSuppressions } from "cdk-nag";
import { Construct } from "constructs";

import { EcsTaskExecutionRole } from "../../iam/ecs-task-execution-role";
import { SuppressionManager } from "../../cdk-nag/suppression-manager";
import { CrossAccountTarget } from "../../types";

import { LaunchTemplateConstruct } from "./launch-template-stack";

export interface AutoScalingGroupConstructProps {
  /**
   * VPC where the Auto Scaling Group will be created
   */
  vpc: ec2.IVpc;

  /**
   * ECS cluster to associate with the Auto Scaling Group
   */
  cluster: ecs.ICluster;

  /**
   * Environment name for resource naming and tagging
   */
  envName: string;

  /**
   * EC2 instance type
   * @default t3.medium
   */
  instanceType?: ec2.InstanceType;

  /**
   * Minimum number of instances
   * @default 1
   */
  minCapacity?: number;

  /**
   * Maximum number of instances
   * @default 1
   */
  maxCapacity?: number;

  /**
   * Desired number of instances
   * @default 1
   */
  desiredCapacity?: number;

  /**
   * User data script for instance initialization
   */
  userData?: ec2.UserData;

  /**
   * Security groups for the instances
   */
  securityGroups?: ec2.ISecurityGroup[];

  /**
   * IAM role for the instances (must be a concrete Role, not IRole, to allow policy modifications)
   */
  role?: iam.Role;

  /**
   * @deprecated Use `keyPair` instead
   */
  keyName?: string;
  /**
   * EC2 Key Pair for SSH access to instances.
   * If both `keyName` and `keyPair` are provided, `keyPair` takes precedence.
   */
  keyPair?: ec2.IKeyPair;

  /**
   * Whether to enable detailed monitoring
   * @default true
   */
  enableDetailedMonitoring?: boolean;
}

/**
 * Construct for creating an Auto Scaling Group for ECS with monitoring-specific configuration
 */
export class AutoScalingGroupConstruct extends Construct {
  public readonly autoScalingGroup: autoscaling.AutoScalingGroup;
  public readonly launchTemplate: ec2.LaunchTemplate;
  public readonly instanceRole: iam.Role;
  public readonly instanceProfile: iam.InstanceProfile;

  constructor(
    scope: Construct,
    id: string,
    props: AutoScalingGroupConstructProps
  ) {
    super(scope, id);

    const {
      vpc,
      cluster,
      envName,
      instanceType = ec2.InstanceType.of(
        ec2.InstanceClass.T3,
        ec2.InstanceSize.SMALL
      ),
      minCapacity = 1,
      maxCapacity = 1,
      desiredCapacity = 1,
      userData,
      securityGroups = [],
      role,
      keyName,
      keyPair,
      enableDetailedMonitoring = true,
    } = props;

    // Create IAM role for EC2 instances if not provided
    this.instanceRole =
      role ||
      new iam.Role(this, "InstanceRole", {
        assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName(
            "AmazonSSMManagedInstanceCore"
          ),
          iam.ManagedPolicy.fromAwsManagedPolicyName(
            "CloudWatchAgentServerPolicy"
          ),
        ],
      });

    // Add ECS permissions to the role
    this.instanceRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonECS_FullAccess")
    );

    // Add EFS permissions to the role
    this.instanceRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "elasticfilesystem:ClientMount",
          "elasticfilesystem:ClientWrite",
          "elasticfilesystem:ClientRootAccess",
        ],
        resources: ["*"],
      })
    );

    // Add SSM permissions to the role
    this.instanceRole.addToPolicy(
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

    // Create instance profile
    this.instanceProfile = new iam.InstanceProfile(this, "InstanceProfile", {
      role: this.instanceRole,
    });

    // Resolve key pair: prefer keyPair over keyName (for backward compatibility)
    const resolvedKeyPair =
      keyPair ||
      (keyName
        ? ec2.KeyPair.fromKeyPairName(this, "KeyPair", keyName)
        : undefined);

    // Create launch template
    // Using Amazon Linux 2023 ECS-optimized AMI (Amazon Linux 2 reaches EOL June 30, 2026)
    this.launchTemplate = new ec2.LaunchTemplate(this, "LaunchTemplate", {
      instanceType,
      machineImage: ecs.EcsOptimizedImage.amazonLinux2023(),
      userData: userData || this.createDefaultUserData(cluster.clusterName),
      role: this.instanceRole,
      securityGroup: securityGroups[0], // Primary security group
      ...(resolvedKeyPair ? { keyPair: resolvedKeyPair } : {}),
      detailedMonitoring: enableDetailedMonitoring,
      blockDevices: [
        {
          deviceName: "/dev/xvda",
          volume: autoscaling.BlockDeviceVolume.ebs(30, {
            volumeType: autoscaling.EbsDeviceVolumeType.GP3,
            encrypted: true,
          }),
        },
      ],
      // Security: Require IMDSv2 (Instance Metadata Service Version 2)
      // This prevents SSRF attacks and is an AWS security best practice
      requireImdsv2: true,
    });

    // Explicitly set IMDSv2 to required via CloudFormation property override
    // This ensures the setting is applied correctly in the generated template
    const cfnLaunchTemplate = this.launchTemplate.node
      .defaultChild as ec2.CfnLaunchTemplate;
    cfnLaunchTemplate.addPropertyOverride(
      "LaunchTemplateData.MetadataOptions.HttpTokens",
      "required"
    );
    cfnLaunchTemplate.addPropertyOverride(
      "LaunchTemplateData.MetadataOptions.HttpEndpoint",
      "enabled"
    );
    cfnLaunchTemplate.addPropertyOverride(
      "LaunchTemplateData.MetadataOptions.HttpPutResponseHopLimit",
      2
    );

    // Create Auto Scaling Group
    this.autoScalingGroup = new autoscaling.AutoScalingGroup(
      this,
      "MonitoringCapacity",
      {
        vpc,
        launchTemplate: this.launchTemplate,
        minCapacity,
        maxCapacity,
        desiredCapacity,
        vpcSubnets: {
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
        healthChecks: autoscaling.HealthChecks.ec2({
          gracePeriod: cdk.Duration.seconds(300),
        }),
        updatePolicy: autoscaling.UpdatePolicy.rollingUpdate({
          maxBatchSize: 1,
          minInstancesInService: 0,
          pauseTime: cdk.Duration.minutes(5),
        }),
      }
    );

    // Add additional security groups
    securityGroups.slice(1).forEach((sg) => {
      this.autoScalingGroup.addSecurityGroup(sg);
    });

    // Add capacity provider to cluster (if cluster is a concrete Cluster, not ICluster)
    const capacityProvider = new ecs.AsgCapacityProvider(
      this,
      "CapacityProvider",
      {
        autoScalingGroup: this.autoScalingGroup,
        enableManagedScaling: false,
        enableManagedTerminationProtection: false,
      }
    );

    // Only add capacity provider if cluster is a concrete Cluster instance
    if (cluster instanceof ecs.Cluster) {
      cluster.addAsgCapacityProvider(capacityProvider);
    }

    // Add tags
    cdk.Tags.of(this.autoScalingGroup).add("Name", `${envName}-monitoring-asg`);
    cdk.Tags.of(this.autoScalingGroup).add("Environment", envName);
    cdk.Tags.of(this.autoScalingGroup).add("Purpose", "MonitoringCompute");
    cdk.Tags.of(this.autoScalingGroup).add("ManagedBy", "CDK");

    // Output Auto Scaling Group information
    new cdk.CfnOutput(this, "AutoScalingGroupName", {
      value: this.autoScalingGroup.autoScalingGroupName,
      description: `Auto Scaling Group name for ${envName} monitoring`,
      exportName: `${cdk.Stack.of(this).stackName}-asg-name`,
    });
  }

  private createDefaultUserData(clusterName: string): ec2.UserData {
    const userData = ec2.UserData.forLinux();

    userData.addCommands(
      // Configure ECS agent
      `echo ECS_CLUSTER=${clusterName} >> /etc/ecs/ecs.config`,
      "echo ECS_ENABLE_CONTAINER_METADATA=true >> /etc/ecs/ecs.config",
      "echo ECS_ENABLE_TASK_IAM_ROLE=true >> /etc/ecs/ecs.config",

      // Install required agents/utilities (AL2023 uses dnf, AL2 uses yum)
      "PKG_MGR=yum",
      "command -v dnf >/dev/null 2>&1 && PKG_MGR=dnf",
      "$PKG_MGR -y update",
      "$PKG_MGR -y install amazon-ssm-agent amazon-cloudwatch-agent",

      // Install EFS utilities
      "$PKG_MGR -y install amazon-efs-utils",

      // Start services
      "systemctl enable ecs",
      "systemctl start ecs",
      "systemctl enable --now amazon-ssm-agent",
      "systemctl enable amazon-cloudwatch-agent",
      "systemctl start amazon-cloudwatch-agent"
    );

    return userData;
  }
}


export interface EcsClusterConstructProps {
  /**
   * VPC where the ECS cluster will be created
   */
  vpc: ec2.IVpc;

  /**
   * Environment name for resource naming and tagging
   */
  envName: string;

  /**
   * Whether to enable Container Insights
   * @default true
   */
  enableContainerInsights?: boolean;

  /**
   * Whether to enable execute command capability
   * @default true
   */
  enableExecuteCommand?: boolean;

  /**
   * CloudWatch log group retention period
   * @default logs.RetentionDays.TWO_WEEKS
   */
  logRetention?: logs.RetentionDays;

  /**
   * Custom cluster name
   * @default `${envName}-monitoring-cluster`
   */
  clusterName?: string;

  /**
   * EC2 instance type for the Auto Scaling Group
   * @default t3.micro
   */
  instanceType?: ec2.InstanceType;

  /**
   * Minimum number of instances
   * @default 1
   */
  minCapacity?: number;

  /**
   * Maximum number of instances
   * @default 1
   */
  maxCapacity?: number;

  /**
   * Desired number of instances
   * @default 1
   */
  desiredCapacity?: number;

  /**
   * Whether to use public subnets
   * @default false
   */
  usePublicSubnets?: boolean;

  /**
   * Additional security groups to attach to the instances
   * @default []
   */
  additionalSecurityGroups?: ec2.ISecurityGroup[];

  /**
   * Custom launch template to use instead of creating a default one
   * If provided, instanceType and other launch template related props are ignored
   * @default undefined (creates default launch template)
   */
  customLaunchTemplate?: ec2.ILaunchTemplate;

  /**
   * Custom user data to use instead of creating default ECS user data
   * If provided, the construct will not create default ECS configuration user data
   * @default undefined (creates default ECS user data)
   */
  customUserData?: ec2.UserData;
}

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
      enableContainerInsights = true,
      enableExecuteCommand = true,
      logRetention = logs.RetentionDays.TWO_WEEKS,
      clusterName = `${envName}-cluster`,
      instanceType = new ec2.InstanceType("t3.micro"),
      minCapacity = 1,
      maxCapacity = 1,
      desiredCapacity = 1,
      usePublicSubnets = false,
      additionalSecurityGroups = [],
      customLaunchTemplate,
      customUserData,
    } = props;

    // Create CloudWatch log group for cluster
    this.logGroup = new logs.LogGroup(this, "ClusterLogGroup", {
      logGroupName: `/aws/ecs/cluster/${clusterName}`,
      retention: logRetention,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Create ECS cluster
    this.cluster = new ecs.Cluster(this, "Cluster", {
      vpc,
      clusterName,
      containerInsightsV2: enableContainerInsights
        ? ecs.ContainerInsights.ENABLED
        : ecs.ContainerInsights.DISABLED,
      enableFargateCapacityProviders: false, // Using EC2 for compute
      executeCommandConfiguration: enableExecuteCommand
        ? {
            logging: ecs.ExecuteCommandLogging.OVERRIDE,
            logConfiguration: {
              cloudWatchLogGroup: this.logGroup,
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
          allowAllOutbound: true,
        }
      );

      // Even though allowAllOutbound=true adds a default egress rule, we add an explicit
      // outbound HTTPS rule because SSM/ECS/ECR all require outbound 443 and it's a
      // common source of “SSM not working” confusion when reviewing SG rules.
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
            `arn:aws:logs:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:log-group:/ecs/*:*`,
            `arn:aws:logs:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:log-group:/aws/ecs/*:*`,
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
            `Resource::arn:aws:logs:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:log-group:/ecs/*:*`,
            `Resource::arn:aws:logs:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:log-group:/aws/ecs/*:*`,
            {
              regex: "/^Resource::arn:aws:logs:.*:.*:log-group:\\/ecs\\/.*:\\*$/",
            },
            {
              regex: "/^Resource::arn:aws:logs:.*:.*:log-group:\\/aws\\/ecs\\/.*:\\*$/",
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
        role: instanceRole,
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
            deviceName: "/dev/xvda",
            volume: autoscaling.BlockDeviceVolume.ebs(30, {
              volumeType: autoscaling.EbsDeviceVolumeType.GP3,
              encrypted: true,
            }),
          },
        ],
        // Security: Require IMDSv2 (Instance Metadata Service Version 2)
        // This prevents SSRF attacks and is an AWS security best practice
        requireImdsv2: true,
      });

      // Explicitly set IMDSv2 to required via CloudFormation property override
      // This ensures the setting is applied correctly in the generated template
      const cfnLaunchTemplate = this.launchTemplate.node
        .defaultChild as ec2.CfnLaunchTemplate;
      cfnLaunchTemplate.addPropertyOverride(
        "LaunchTemplateData.MetadataOptions.HttpTokens",
        "required"
      );
      cfnLaunchTemplate.addPropertyOverride(
        "LaunchTemplateData.MetadataOptions.HttpEndpoint",
        "enabled"
      );
      cfnLaunchTemplate.addPropertyOverride(
        "LaunchTemplateData.MetadataOptions.HttpPutResponseHopLimit",
        2
      );
    }

    // Create Auto Scaling Group
    this.asg = new autoscaling.AutoScalingGroup(this, "AutoScalingGroup", {
      vpc,
      launchTemplate: this.launchTemplate,
      minCapacity,
      maxCapacity,
      desiredCapacity,
      vpcSubnets: {
        subnetType: usePublicSubnets
          ? ec2.SubnetType.PUBLIC
          : ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      healthChecks: autoscaling.HealthChecks.ec2({
        gracePeriod: cdk.Duration.seconds(300),
      }),
    });

    // Tag ASG - tags will propagate to EC2 instances automatically
    // These tags are required for Prometheus EC2 service discovery
    // Access the CloudFormation resource to set tags with PropagateAtLaunch
    const cfnAsg = this.asg.node.defaultChild as autoscaling.CfnAutoScalingGroup;
    // Use addPropertyOverride to ensure tags are set correctly in CloudFormation
    cfnAsg.addPropertyOverride("Tags", [
      {
        Key: "Name",
        Value: `${props.envName}-asg`,
        PropagateAtLaunch: true,
      },
      {
        Key: "Environment",
        Value: props.envName,
        PropagateAtLaunch: true,
      },
      {
        Key: "Service",
        Value: "monitoring",
        PropagateAtLaunch: true,
      },
      {
        Key: "ManagedBy",
        Value: "CDK",
        PropagateAtLaunch: true,
      },
    ]);

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
    const capacityProvider = new ecs.AsgCapacityProvider(
      this,
      "CapacityProvider",
      {
        autoScalingGroup: this.asg,
        // Enable managed scaling - ECS will scale based on task demand
        // The ASG will still launch instances based on desiredCapacity initially
        // If you need instances to launch immediately regardless of tasks, consider
        // setting enableManagedScaling: false temporarily for troubleshooting
        enableManagedScaling: false,
        enableManagedTerminationProtection: false,
      }
    );

    this.cluster.addAsgCapacityProvider(capacityProvider);

    // Add tags to cluster
    Tags.of(this.cluster).add("Name", clusterName);
    Tags.of(this.cluster).add("Environment", envName);
    Tags.of(this.cluster).add("ManagedBy", "CDK");


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
    // Use provided CIDR or a default to avoid cyclic dependencies
    const vpcCidr = cidr || "10.0.0.0/16";
    // Use ASG connections rather than a construct-owned SG so this continues to
    // work even when the launch template is responsible for the security groups.
    this.asg.connections.allowFrom(
      ec2.Peer.ipv4(vpcCidr),
      ec2.Port.tcp(port),
      description
    );
  }
}


export interface EcsConstructProps {
  vpc: ec2.IVpc;
  envName: string; // Environment name for tagging
  containerImage: ecs.ContainerImage; // ECR image (required)
  instanceType?: ec2.InstanceType;
  minCapacity?: number;
  maxCapacity?: number;
  desiredCapacity?: number;
  containerPort?: number;
  cpu?: number;
  memoryLimitMiB?: number; // Hard limit - task killed if exceeded
  memoryReservationMiB?: number; // Soft limit - minimum memory reserved
  targetGroup?: elbv2.IApplicationTargetGroup;
}

export class EcsConstruct extends Construct {
  public readonly cluster: ecs.Cluster;
  public readonly asg: autoscaling.AutoScalingGroup;
  public readonly service: ecs.Ec2Service;
  public readonly taskDefinition: ecs.Ec2TaskDefinition;
  public readonly nodeExporterService: ecs.Ec2Service;

  constructor(scope: Construct, id: string, props: EcsConstructProps) {
    super(scope, id);

    // 1. Create ECS Cluster
    this.cluster = new ecs.Cluster(this, "Cluster", {
      vpc: props.vpc,
      clusterName: `ecs-cluster-${props.envName}`,
    });

    // Tag cluster
    Tags.of(this.cluster).add("Environment", props.envName);
    Tags.of(this.cluster).add("ManagedBy", "CDK");

    // 2. Add EC2 Capacity in PUBLIC subnets
    this.asg = this.cluster.addCapacity("DefaultAutoScalingGroup", {
      instanceType: props.instanceType || new ec2.InstanceType("t3.micro"),
      minCapacity: props.minCapacity || 1,
      maxCapacity: props.maxCapacity || 2,
      desiredCapacity: props.desiredCapacity || 1,

      // Place in PUBLIC subnets (no NAT gateway needed)
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC,
      },

      // Auto-assign public IP for internet access
      associatePublicIpAddress: true,
    });

    // Tag Auto Scaling Group
    Tags.of(this.asg).add("Environment", props.envName);
    Tags.of(this.asg).add("ManagedBy", "CDK");

    // 3. Create Task Definition (EC2 type)
    this.taskDefinition = new ecs.Ec2TaskDefinition(this, "TaskDef", {
      networkMode: ecs.NetworkMode.BRIDGE, // Default for EC2
    });

    // Tag task definition
    Tags.of(this.taskDefinition).add("Environment", props.envName);
    Tags.of(this.taskDefinition).add("ManagedBy", "CDK");

    // 4. Add Container to Task Definition
    const container = this.taskDefinition.addContainer("app", {
      image: props.containerImage, // Use ECR image
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: `ecs-${props.envName}`,
      }),
      // Memory configuration
      // Soft limit: minimum memory reserved for the container
      // Task won't be killed if it exceeds this, but may be throttled
      memoryReservationMiB: props.memoryReservationMiB || 512,
      // Hard limit: task is killed if memory exceeds this (optional)
      memoryLimitMiB: props.memoryLimitMiB,
      // CPU units (1024 = 1 vCPU)
      cpu: props.cpu,
    });

    // Add port mapping with DYNAMIC host port
    // hostPort: 0 allows multiple containers on same EC2 instance
    container.addPortMappings({
      containerPort: props.containerPort || 80,
      hostPort: 0, // Dynamic port mapping
      protocol: ecs.Protocol.TCP,
    });

    // 5. Create ECS Service
    this.service = new ecs.Ec2Service(this, "Service", {
      cluster: this.cluster,
      taskDefinition: this.taskDefinition,
      desiredCount: props.desiredCapacity || 1,
      serviceName: `ecs-service-${props.envName}`,

      // Placement strategy for better distribution
      placementStrategies: [
        ecs.PlacementStrategy.spreadAcrossInstances(),
        ecs.PlacementStrategy.packedByCpu(),
      ],

      // Circuit breaker DISABLED for debugging
      // Must explicitly set enable: false to disable it
      // Re-enable after debugging: circuitBreaker: { enable: true, rollback: true }
      circuitBreaker: {
        enable: false,
        rollback: false, // Completely disable circuit breaker
      },

      // Deployment configuration
      minHealthyPercent: 0, // Allow all tasks to be stopped (for initial deployment)
      maxHealthyPercent: 200, // Allow up to 200% of tasks during deployment
    });
    // Attach service to target group if provided
    if (props.targetGroup) {
      // Use loadBalancerTarget to ensure correct target type
      props.targetGroup.addTarget(
        this.service.loadBalancerTarget({
          containerName: "app",
          containerPort: 3000,
        })
      );
    }
    // Tag service
    Tags.of(this.service).add("Environment", props.envName);
    Tags.of(this.service).add("ManagedBy", "CDK");
    Tags.of(this.service).add("Service", "ECS");

    // 4. Add Node Exporter for monitoring
    this.nodeExporterService = this.createNodeExporterService(props.envName);

    // Allow Node Exporter port for Prometheus scraping
    this.asg.connections.allowInternally(
      ec2.Port.tcp(9100),
      "Allow Prometheus to scrape Node Exporter"
    );
  }

  private createNodeExporterService(envName: string): ecs.Ec2Service {
    // Task definition with HOST network mode
    const taskDefinition = new ecs.Ec2TaskDefinition(
      this,
      "NodeExporterTaskDef",
      {
        networkMode: ecs.NetworkMode.HOST,
      }
    );

    // Container definition
    const container = taskDefinition.addContainer("node-exporter", {
      image: ecs.ContainerImage.fromRegistry("prom/node-exporter:latest"),
      memoryReservationMiB: 64,
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: "node-exporter",
        logGroup: new logs.LogGroup(this, "NodeExporterLogGroup", {
          logGroupName: `/ecs/${envName}-app-node-exporter`,
          retention: logs.RetentionDays.ONE_WEEK,
          removalPolicy: cdk.RemovalPolicy.DESTROY,
        }),
      }),
      command: [
        "--path.procfs=/host/proc",
        "--path.sysfs=/host/sys",
        "--path.rootfs=/rootfs",
        "--collector.filesystem.mount-points-exclude=^/(sys|proc|dev|host|etc)($|/)",
      ],
    });

    container.addPortMappings({
      containerPort: 9100,
      hostPort: 9100,
      protocol: ecs.Protocol.TCP,
    });

    // Mount host paths for metrics collection
    taskDefinition.addVolume({
      name: "proc",
      host: { sourcePath: "/proc" },
    });
    taskDefinition.addVolume({
      name: "sys",
      host: { sourcePath: "/sys" },
    });
    taskDefinition.addVolume({
      name: "rootfs",
      host: { sourcePath: "/" },
    });

    container.addMountPoints(
      {
        sourceVolume: "proc",
        containerPath: "/host/proc",
        readOnly: true,
      },
      {
        sourceVolume: "sys",
        containerPath: "/host/sys",
        readOnly: true,
      },
      {
        sourceVolume: "rootfs",
        containerPath: "/rootfs",
        readOnly: true,
      }
    );

    // Create service
    const service = new ecs.Ec2Service(this, "NodeExporterService", {
      cluster: this.cluster,
      taskDefinition,
      serviceName: `${envName}-app-node-exporter`,
      desiredCount: 1,
      enableExecuteCommand: true,
    });

    // Tag service
    Tags.of(service).add("Environment", envName);
    Tags.of(service).add("ManagedBy", "CDK");
    Tags.of(service).add("Service", "NodeExporter");

    return service;
  }
}


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


export interface ContainerConfig {
  name: string;
  image: ecs.ContainerImage;
  containerPort?: number; // Optional - not needed for HOST mode without explicit port mapping
  hostPort?: number; // Optional - if set, uses static host port mapping (required for metrics scraping)
  cpu?: number;
  memoryLimitMiB?: number;
  memoryReservationMiB?: number;
  environment?: { [key: string]: string };
  secrets?: { [key: string]: ecs.Secret };
  command?: string[];
  logStreamPrefix?: string;
  logGroup?: logs.ILogGroup; // Optional - specific log group to use (if not provided, ECS will auto-create)
  user?: string; // Optional - run container as specific user (e.g., "472" for Grafana)
}

export interface EcsTaskDefinitionConstructProps {
  envName: string;
  networkMode?: ecs.NetworkMode;
  containers: ContainerConfig[];
  grantEcrReadAccess?: boolean;
  taskRole?: iam.IRole;
  executionRole?: iam.IRole;
  volumes?: ecs.Volume[];
}

/**
 * Reusable construct for creating ECS Task Definitions with containers
 * Supports multiple containers and flexible configuration
 */
export class EcsTaskDefinitionConstruct extends Construct {
  public readonly taskDefinition: ecs.Ec2TaskDefinition;
  public readonly containers: Map<string, ecs.ContainerDefinition>;

  constructor(
    scope: Construct,
    id: string,
    props: EcsTaskDefinitionConstructProps
  ) {
    super(scope, id);

    this.containers = new Map();

    // Create or use provided execution role
    let executionRole = props.executionRole;
    if (!executionRole && props.grantEcrReadAccess !== false) {
      // Collect all log group ARNs from containers that specify them
      const logGroupArns = props.containers
        .map((c) => c.logGroup?.logGroupArn)
        .filter((arn): arn is string => arn !== undefined);

      // Use centralized ECS task execution role construct
      const executionRoleConstruct = new EcsTaskExecutionRole(
        this,
        "ExecutionRole",
        {
          envName: props.envName,
          enablePublicEcr: false, // Only enable if needed
          // If all containers use the same log group, pass it for more specific permissions
          // Otherwise, use the default pattern matching
          logGroupArn: logGroupArns.length === 1 ? logGroupArns[0] : undefined,
        }
      );
      executionRole = executionRoleConstruct.role;
    }

    // Create Task Definition
    this.taskDefinition = new ecs.Ec2TaskDefinition(this, "TaskDef", {
      networkMode: props.networkMode || ecs.NetworkMode.BRIDGE,
      taskRole: props.taskRole,
      executionRole: executionRole,
    });

    // Add volumes if provided
    if (props.volumes) {
      props.volumes.forEach((volume) => {
        this.taskDefinition.addVolume(volume);
      });
    }

    // Add containers
    props.containers.forEach((containerConfig) => {
      this.addContainer(containerConfig, props.envName);
    });

    // Tag task definition
    Tags.of(this.taskDefinition).add("Environment", props.envName);
    Tags.of(this.taskDefinition).add("ManagedBy", "CDK");

    // CDK Nag suppressions for task definition
    if (this.taskDefinition.taskRole) {
      NagSuppressions.addResourceSuppressions(
        this.taskDefinition.taskRole,
        [
          {
            id: "AwsSolutions-IAM5",
            reason:
              "CloudWatch Logs permissions use wildcard for log streams within log groups. This allows ECS to create log streams dynamically for containers.",
            appliesTo: [
              "Resource::arn:aws:logs:*:*:log-group:*:*",
              "Resource::arn:aws:logs:*:*:log-group:<*>:*",
            ],
          },
        ],
        true
      );
    }
  }

  /**
   * Add a container to the task definition
   */
  private addContainer(config: ContainerConfig, _envName: string): void {
    // Configure logging: Use awslogs driver for ECS console integration
    // The awslogs driver automatically captures stdout/stderr from container processes
    // and sends them to CloudWatch Logs, enabling the ECS console "Logs" tab
    let logging: ecs.LogDriver | undefined;
    if (config.logStreamPrefix && config.logGroup) {
      // Use awslogs driver with explicit log group - enables ECS console "Logs" tab
      // Logs are sent directly to CloudWatch Logs via the awslogs driver
      // This captures stdout/stderr from the container process
      logging = ecs.LogDrivers.awsLogs({
        logGroup: config.logGroup,
        streamPrefix: config.logStreamPrefix,
      });
    } else if (config.logStreamPrefix) {
      // Fallback: Use awslogs with auto-created log group if logGroup not provided
      // Still captures stdout/stderr and enables ECS console integration
      logging = ecs.LogDrivers.awsLogs({
        streamPrefix: config.logStreamPrefix,
      });
    } else if (config.logGroup) {
      // If logGroup is provided but no prefix, use container name as prefix
      logging = ecs.LogDrivers.awsLogs({
        logGroup: config.logGroup,
        streamPrefix: config.name,
      });
    } else {
      // Default: Auto-create log group with container name as prefix
      // Ensures all containers have logging configured to capture stdout/stderr
      logging = ecs.LogDrivers.awsLogs({
        streamPrefix: config.name,
      });
    }

    const container = this.taskDefinition.addContainer(config.name, {
      image: config.image,
      logging: logging,
      memoryReservationMiB: config.memoryReservationMiB || 512,
      memoryLimitMiB: config.memoryLimitMiB,
      cpu: config.cpu,
      environment: config.environment,
      secrets: config.secrets,
      command: config.command,
      user: config.user, // Run container as specific user if specified
    });

    // Add port mapping only if containerPort is specified
    // For HOST mode, port mapping is optional as container uses host network directly
    if (config.containerPort !== undefined) {
      let hostPort: number;

      if (this.taskDefinition.networkMode === ecs.NetworkMode.HOST) {
        // HOST mode: container uses host network directly
        hostPort = config.containerPort;
      } else if (config.hostPort !== undefined) {
        // BRIDGE mode with static host port (for metrics scraping)
        hostPort = config.hostPort;
      } else {
        // BRIDGE mode with dynamic port (default)
        hostPort = 0;
      }

      container.addPortMappings({
        containerPort: config.containerPort,
        hostPort: hostPort,
        protocol: ecs.Protocol.TCP,
      });
    }

    this.containers.set(config.name, container);
  }

  /**
   * Get a specific container by name
   */
  public getContainer(name: string): ecs.ContainerDefinition | undefined {
    return this.containers.get(name);
  }

  /**
   * Add mount points to a specific container
   */
  public addMountPoints(
    containerName: string,
    ...mountPoints: ecs.MountPoint[]
  ): void {
    const container = this.containers.get(containerName);
    if (!container) {
      throw new Error(`Container ${containerName} not found`);
    }
    container.addMountPoints(...mountPoints);
  }
}

/** @format */


export interface MonitoringEcsStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
  envName: string;
  albDnsName?: string;
  allowedIpRanges?: string[];
  /** Cross-account targets to scrape via VPC peering */
  crossAccountTargets?: CrossAccountTarget[];
  /** Enable EFS for persistent storage (survives instance replacement) */
  enablePersistence?: boolean;
}

export class MonitoringEcsStack extends cdk.Stack {
  public readonly cluster: ecs.Cluster;
  public readonly prometheusService: ecs.Ec2Service;
  public readonly grafanaService: ecs.Ec2Service;
  public readonly nodeExporterService: ecs.Ec2Service;
  public readonly loadBalancer: elbv2.ApplicationLoadBalancer;
  public readonly grafanaUrl: string;
  public readonly prometheusUrl: string;
  private readonly autoScalingGroup: autoscaling.AutoScalingGroup;

  constructor(scope: Construct, id: string, props: MonitoringEcsStackProps) {
    super(scope, id, props);

    const {
      vpc,
      envName,
      albDnsName,
      allowedIpRanges,
      crossAccountTargets,
      // enablePersistence is deprecated - use MonitoringEfsStack for EFS
    } = props;

    // DEPRECATED: EFS creation moved to dedicated MonitoringEfsStack
    // This stack now assumes external EFS is provided if persistence is needed
    // For new deployments, use MonitoringEfsStack + MonitoringInfraStack instead
    // Note: enablePersistence flag is ignored - use MonitoringEfsStack for EFS
    const fileSystem: efs.FileSystem | undefined = undefined;

    // Create ECS Cluster for monitoring
    const { cluster, autoScalingGroup } = this.createEcsCluster(
      vpc,
      envName,
      crossAccountTargets,
      fileSystem
    );
    this.cluster = cluster;
    this.autoScalingGroup = autoScalingGroup;

    // Create CloudWatch Log Groups for monitoring services
    const monitoringTaskLogGroup = new logs.LogGroup(
      this,
      "MonitoringTaskLogs",
      {
        logGroupName: `/ecs/${this.stackName}/tasks`,
        retention: logs.RetentionDays.TWO_WEEKS,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }
    );

    const monitoringEventLogGroup = new logs.LogGroup(
      this,
      "MonitoringEcsEvents",
      {
        logGroupName: `/ecs/${this.stackName}/events`,
        retention: logs.RetentionDays.TWO_WEEKS,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }
    );

    // Configure ECS to send events to CloudWatch Logs
    new cdk.aws_events.Rule(this, "MonitoringEcsEventRule", {
      description: `Capture ECS events for ${envName} monitoring cluster`,
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
      targets: [
        new cdk.aws_events_targets.CloudWatchLogGroup(monitoringEventLogGroup),
      ],
    });

    // Create Application Load Balancer for monitoring services
    this.loadBalancer = this.createLoadBalancer(vpc, envName, allowedIpRanges);

    // Allow ALB to reach services on the instances
    this.configureSecurityGroupConnections();

    // Create Prometheus service
    this.prometheusService = this.createPrometheusService(
      this.cluster,
      envName,
      albDnsName
    );

    // Create Grafana service
    this.grafanaService = this.createGrafanaService(this.cluster, envName);

    // Create Node Exporter service
    this.nodeExporterService = this.createNodeExporterService(
      this.cluster,
      envName
    );

    // Configure load balancer routing
    this.configureLoadBalancerRouting();

    // Set URLs
    this.grafanaUrl = `http://${this.loadBalancer.loadBalancerDnsName}/grafana`;
    this.prometheusUrl = `http://${this.loadBalancer.loadBalancerDnsName}/prometheus`;

    // Create outputs
    this.createOutputs(monitoringTaskLogGroup, monitoringEventLogGroup);

    // ========================================================================
    // CDK NAG SUPPRESSIONS
    // ========================================================================
    SuppressionManager.applyToStack(this, "MonitoringStack", envName);

    // ========================================================================
    // RESOURCE TAGGING
    // ========================================================================
    cdk.Tags.of(this).add("Stack", "MonitoringEcs");
    cdk.Tags.of(this).add("Environment", envName);
    cdk.Tags.of(this).add("ManagedBy", "CDK");
  }


  /**
   * Create ECS cluster with EC2 capacity and S3-based config provisioning
   * Uses LaunchTemplateConstruct for consistent, secure launch template configuration
   */
  private createEcsCluster(
    vpc: ec2.IVpc,
    envName: string,
    crossAccountTargets?: CrossAccountTarget[],
    fileSystem?: efs.FileSystem
  ): { cluster: ecs.Cluster; autoScalingGroup: autoscaling.AutoScalingGroup } {
    // Constrain ECS capacity to the first public AZ to align with EFS mount target
    const publicAz0Subnets = vpc.selectSubnets({
      subnetType: ec2.SubnetType.PUBLIC,
      availabilityZones: [vpc.availabilityZones[0]],
      onePerAz: true,
    });

    const clusterName = `${envName}-monitoring-cluster`;
    const cluster = new ecs.Cluster(this, "MonitoringCluster", {
      vpc,
      clusterName,
    });

    // Enable Container Insights
    const cfnCluster = cluster.node.defaultChild as ecs.CfnCluster;
    cfnCluster.clusterSettings = [
      {
        name: "containerInsights",
        value: "enabled",
      },
    ];

    // Create ECS-compatible user data for the launch template
    const ecsUserData = ec2.UserData.forLinux();
    ecsUserData.addCommands(
      "#!/bin/bash",
      // ECS configuration - CRITICAL for ECS cluster integration
      `echo ECS_CLUSTER=${clusterName} >> /etc/ecs/ecs.config`,
      "echo ECS_ENABLE_CONTAINER_METADATA=true >> /etc/ecs/ecs.config",
      "echo ECS_ENABLE_TASK_IAM_ROLE=true >> /etc/ecs/ecs.config",
      "echo ECS_AWSVPC_BLOCK_IMDS=true >> /etc/ecs/ecs.config",
      // System updates and ECS agent
      "yum update -y",
      "yum install -y amazon-cloudwatch-agent",
      "systemctl enable ecs",
      "systemctl start ecs",
      // Security: Block container access to IMDS
      "iptables --insert FORWARD 1 --in-interface docker+ --destination 169.254.169.254/32 --jump DROP",
      "service iptables save"
    );

    // Create launch template using LaunchTemplateConstruct
    // This ensures IMDSv2 is required and follows security best practices
    const launchTemplateConstruct = new LaunchTemplateConstruct(
      this,
      "EcsLaunchTemplate",
      {
        vpc,
        envName,
        instanceType: ec2.InstanceType.of(
          ec2.InstanceClass.T3,
          ec2.InstanceSize.SMALL
        ),
        // Using Amazon Linux 2023 ECS-optimized AMI (Amazon Linux 2 reaches EOL June 30, 2026)
        machineImage: ecs.EcsOptimizedImage.amazonLinux2023(),
        userData: ecsUserData,
        enableMonitoring: true,
        associatePublicIpAddress: true,
        blockDevices: [
          {
            deviceName: "/dev/xvda",
            // ECS-optimized AMI snapshots require at least 30GB minimum
            // While persistent data is stored on EFS, the root volume must meet snapshot size requirements
            volume: ec2.BlockDeviceVolume.ebs(30, {
              volumeType: ec2.EbsDeviceVolumeType.GP3,
              encrypted: true,
              deleteOnTermination: true,
            }),
          },
        ],
      }
    );

    // Explicitly enforce IMDSv2 requirement via CloudFormation property override
    // This ensures the setting is applied correctly even if CDK property doesn't work
    const cfnLaunchTemplate = launchTemplateConstruct.launchTemplate.node
      .defaultChild as ec2.CfnLaunchTemplate;
    cfnLaunchTemplate.addPropertyOverride(
      "LaunchTemplateData.MetadataOptions.HttpTokens",
      "required"
    );
    cfnLaunchTemplate.addPropertyOverride(
      "LaunchTemplateData.MetadataOptions.HttpEndpoint",
      "enabled"
    );
    cfnLaunchTemplate.addPropertyOverride(
      "LaunchTemplateData.MetadataOptions.HttpPutResponseHopLimit",
      2
    );

    // Add ECS managed policy to the launch template's IAM role
    launchTemplateConstruct.role.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName(
        "service-role/AmazonEC2ContainerServiceforEC2Role"
      )
    );

    // Create Auto Scaling Group using the launch template from LaunchTemplateConstruct
    const autoScalingGroup = new autoscaling.AutoScalingGroup(
      this,
      "MonitoringCapacity",
      {
        vpc,
        launchTemplate: launchTemplateConstruct.launchTemplate,
        minCapacity: 1,
        maxCapacity: 1,
        desiredCapacity: 1,
        vpcSubnets: { subnets: publicAz0Subnets.subnets },
        healthChecks: autoscaling.HealthChecks.ec2({
          gracePeriod: cdk.Duration.seconds(300),
        }),
      }
    );

    // Add the Auto Scaling Group as a capacity provider to the cluster
    const capacityProvider = new ecs.AsgCapacityProvider(
      this,
      "AsgCapacityProvider",
      {
        autoScalingGroup,
        enableManagedScaling: false,
        enableManagedTerminationProtection: false,
      }
    );
    cluster.addAsgCapacityProvider(capacityProvider);

    // ========================================================================
    // S3 ASSETS FOR CONFIG FILES
    // CDK automatically uploads these to S3 and manages versioning
    // ========================================================================
    // Resolve path from compiled dist folder back to source config directory
    // __dirname points to: infrastructure/dist/lib/stacks/monitoring
    // We need to go up 4 levels to infrastructure root, then into config
    const configBasePath = path.resolve(__dirname, "../../../../config");

    const prometheusConfigAsset = new s3_assets.Asset(
      this,
      "PrometheusConfigAsset",
      {
        path: path.join(configBasePath, "prometheus"),
      }
    );

    const grafanaProvisioningAsset = new s3_assets.Asset(
      this,
      "GrafanaProvisioningAsset",
      {
        path: path.join(configBasePath, "grafana", "provisioning"),
      }
    );

    // Dashboard JSON files - pre-configured dashboards deployed with the stack
    const grafanaDashboardsAsset = new s3_assets.Asset(
      this,
      "GrafanaDashboardsAsset",
      {
        path: path.join(configBasePath, "grafana", "dashboards"),
      }
    );

    // Grant EC2 instances permission to read the S3 assets
    prometheusConfigAsset.grantRead(autoScalingGroup.role);
    grafanaProvisioningAsset.grantRead(autoScalingGroup.role);
    grafanaDashboardsAsset.grantRead(autoScalingGroup.role);

    // Allow EFS access from EC2 instances (if enabled)
    if (fileSystem) {
      fileSystem.connections.allowDefaultPortFrom(
        autoScalingGroup,
        "Allow ECS instances to mount EFS"
      );

      autoScalingGroup.role.addToPrincipalPolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            "elasticfilesystem:ClientMount",
            "elasticfilesystem:ClientWrite",
            "elasticfilesystem:ClientRootAccess",
          ],
          resources: [fileSystem.fileSystemArn],
        })
      );
    }

    // Build and apply UserData
    const userDataCommands = this.buildUserData(
      envName,
      fileSystem,
      prometheusConfigAsset,
      grafanaProvisioningAsset,
      grafanaDashboardsAsset,
      crossAccountTargets
    );
    autoScalingGroup.addUserData(...userDataCommands);

    // Security group rules
    autoScalingGroup.connections.allowToAnyIpv4(
      ec2.Port.tcp(443),
      "Allow HTTPS outbound for ECS agent and S3"
    );

    autoScalingGroup.connections.allowInternally(
      ec2.Port.tcp(9100),
      "Allow Prometheus to scrape Node Exporter"
    );

    autoScalingGroup.connections.allowInternally(
      ec2.Port.tcp(9090),
      "Allow Grafana to query Prometheus"
    );

    cdk.Tags.of(cluster).add("Environment", envName);
    cdk.Tags.of(cluster).add("Purpose", "Monitoring");

    return { cluster, autoScalingGroup };
  }

  /**
   * Build UserData script that:
   * 1. Mounts EFS (if enabled)
   * 2. Downloads config templates from S3
   * 3. Processes templates with environment-specific values
   * 4. Starts ECS agent after setup completes
   */
  private buildUserData(
    envName: string,
    fileSystem: efs.FileSystem | undefined,
    prometheusAsset: s3_assets.Asset,
    grafanaAsset: s3_assets.Asset,
    dashboardsAsset: s3_assets.Asset,
    crossAccountTargets?: CrossAccountTarget[]
  ): string[] {
    const region = cdk.Stack.of(this).region;

    // Generate cross-account scrape config if targets are provided
    const crossAccountConfig =
      crossAccountTargets && crossAccountTargets.length > 0
        ? this.generateCrossAccountScrapeConfig(crossAccountTargets)
        : [];

    // EFS mounting commands (conditional)
    const efsCommands = fileSystem
      ? this.buildEfsMountCommands(fileSystem, region)
      : this.buildLocalStorageCommands();

    // Cross-account config injection (if any)
    const crossAccountInjection =
      crossAccountConfig.length > 0
        ? [
            "",
            "echo '=== Injecting cross-account scrape targets ==='",
            "cat >> /mnt/prometheus-config/prometheus.yml << 'CROSSACCOUNT'",
            ...crossAccountConfig,
            "CROSSACCOUNT",
          ]
        : [];

    return [
      "#!/bin/bash",
      "set -ex",
      "",
      "# ==========================================================================",
      "# MONITORING STACK PROVISIONING SCRIPT",
      "# This script is generated by CDK and runs on EC2 instance startup",
      "# ==========================================================================",
      "",
      "exec > >(tee -a /var/log/monitoring-setup.log) 2>&1",
      "",
      "echo '========================================='",
      "echo 'Monitoring Setup Started'",
      `echo 'Environment: ${envName}'`,
      `echo 'Region: ${region}'`,
      "date",
      "echo '========================================='",
      "",
      "# Stop ECS agent until setup completes to prevent task scheduling",
      "echo 'Stopping ECS agent...'",
      "systemctl stop ecs || true",
      "",
      "# Add ec2-user to docker group",
      "usermod -a -G docker ec2-user",
      "",
      "# ==========================================================================",
      "# STORAGE SETUP (EFS or Local)",
      "# ==========================================================================",
      ...efsCommands,
      "",
      "# ==========================================================================",
      "# CREATE CONFIG DIRECTORIES",
      "# ==========================================================================",
      "echo 'Creating config directories...'",
      "mkdir -p /mnt/prometheus-config",
      "mkdir -p /mnt/grafana-provisioning/datasources",
      "mkdir -p /mnt/grafana-provisioning/dashboards",
      "mkdir -p /mnt/grafana-dashboards",
      "",
      "# ==========================================================================",
      "# DOWNLOAD CONFIGS FROM S3 (CDK Assets)",
      "# ==========================================================================",
      "echo '=== Downloading config templates from S3 ==='",
      "",
      "# Download and extract Prometheus config",
      `aws s3 cp s3://${prometheusAsset.s3BucketName}/${prometheusAsset.s3ObjectKey} /tmp/prometheus-config.zip --region ${region}`,
      "mkdir -p /tmp/prometheus-config",
      "unzip -o /tmp/prometheus-config.zip -d /tmp/prometheus-config",
      'echo "Prometheus config contents after unzip:"',
      "ls -laR /tmp/prometheus-config/",
      "",
      "# Download and extract Grafana provisioning",
      `aws s3 cp s3://${grafanaAsset.s3BucketName}/${grafanaAsset.s3ObjectKey} /tmp/grafana-provisioning.zip --region ${region}`,
      "mkdir -p /tmp/grafana-provisioning",
      "unzip -o /tmp/grafana-provisioning.zip -d /tmp/grafana-provisioning",
      'echo "Grafana provisioning contents:"',
      "find /tmp/grafana-provisioning -type f",
      "",
      "# Download and extract Grafana dashboards",
      `aws s3 cp s3://${dashboardsAsset.s3BucketName}/${dashboardsAsset.s3ObjectKey} /tmp/grafana-dashboards.zip --region ${region}`,
      "mkdir -p /tmp/grafana-dashboards",
      "unzip -o /tmp/grafana-dashboards.zip -d /tmp/grafana-dashboards",
      'echo "Grafana dashboards contents:"',
      "find /tmp/grafana-dashboards -name '*.json'",
      "",
      "# ==========================================================================",
      "# PROCESS CONFIG TEMPLATES",
      "# Replace placeholders with actual values",
      "# ==========================================================================",
      "echo '=== Processing config templates ==='",
      "",
      "# Get host private IP (needed for Grafana -> Prometheus communication)",
      "HOST_IP=$(curl -s http://169.254.169.254/latest/meta-data/local-ipv4)",
      'echo "Host Private IP: $HOST_IP"',
      "",
      "# Process Prometheus config template",
      "echo 'Processing Prometheus config...'",
      "",
      "# Find the prometheus.yml file (might be nested in subdirectory)",
      "PROM_CONFIG=$(find /tmp/prometheus-config -name 'prometheus.yml' -o -name 'prometheus.yml.template' | head -1)",
      'echo "Found Prometheus config at: $PROM_CONFIG"',
      "",
      'if [ -z "$PROM_CONFIG" ]; then',
      '  echo "ERROR: No Prometheus config found in S3 asset"',
      "  echo 'Directory structure:'",
      "  find /tmp/prometheus-config -type f",
      "  exit 1",
      "fi",
      "",
      "# Check if it's a template or regular file",
      'if [[ "$PROM_CONFIG" == *.template ]]; then',
      '  echo "Processing template file..."',
      `  sed -e 's/{{ENV_NAME}}/${envName}/g' \\`,
      `      -e 's/{{REGION}}/${region}/g' \\`,
      "      -e '/CROSS_ACCOUNT_TARGETS_PLACEHOLDER/d' \\",
      '      "$PROM_CONFIG" > /mnt/prometheus-config/prometheus.yml',
      "  echo '✓ Prometheus config processed from template'",
      "else",
      '  echo "Copying regular config file..."',
      '  cp "$PROM_CONFIG" /mnt/prometheus-config/prometheus.yml',
      "  echo '✓ Prometheus config copied'",
      "fi",
      "",
      "# Also copy alerts.yml if it exists",
      "ALERTS_FILE=$(find /tmp/prometheus-config -name 'alerts.yml' | head -1)",
      'if [ -n "$ALERTS_FILE" ]; then',
      '  cp "$ALERTS_FILE" /mnt/prometheus-config/alerts.yml',
      "  echo '✓ Alerts config copied'",
      "fi",
      ...crossAccountInjection,
      "",
      "# Process Grafana datasource template",
      "echo 'Processing Grafana datasource config...'",
      "",
      "# Find datasource config (might be nested)",
      "DATASOURCE_CONFIG=$(find /tmp/grafana-provisioning -path '*/datasources/prometheus.yml*' | head -1)",
      'echo "Found datasource config at: $DATASOURCE_CONFIG"',
      "",
      'if [ -n "$DATASOURCE_CONFIG" ]; then',
      '  if [[ "$DATASOURCE_CONFIG" == *.template ]]; then',
      '    echo "Processing datasource template..."',
      '    sed -e "s/{{HOST_IP}}/$HOST_IP/g" \\',
      '        "$DATASOURCE_CONFIG" > /mnt/grafana-provisioning/datasources/prometheus.yml',
      "    echo '✓ Grafana datasource config processed from template'",
      "  else",
      '    echo "Copying datasource config..."',
      "    # Replace HOST_IP placeholder if it exists",
      '    sed -e "s/HOST_IP/$HOST_IP/g" \\',
      '        "$DATASOURCE_CONFIG" > /mnt/grafana-provisioning/datasources/prometheus.yml',
      "    echo '✓ Grafana datasource config copied'",
      "  fi",
      "else",
      '  echo "WARNING: No Grafana datasource config found, creating default..."',
      "  cat > /mnt/grafana-provisioning/datasources/prometheus.yml << EOF",
      "apiVersion: 1",
      "datasources:",
      "  - name: Prometheus",
      "    type: prometheus",
      "    uid: prometheus",
      "    access: proxy",
      "    url: http://${HOST_IP}:9090/prometheus",
      "    isDefault: true",
      "    editable: true",
      "EOF",
      "fi",
      "",
      "# Copy dashboard provisioning config",
      "echo 'Processing Grafana dashboard provisioning...'",
      "",
      "# Find dashboard provisioning config (might be nested)",
      "DASHBOARD_PROV=$(find /tmp/grafana-provisioning -path '*/dashboards/*.yml' | head -1)",
      'if [ -n "$DASHBOARD_PROV" ]; then',
      '  cp "$DASHBOARD_PROV" /mnt/grafana-provisioning/dashboards/dashboards.yml',
      "  echo '✓ Dashboard provisioning config copied'",
      "else",
      '  echo "Creating default dashboard provisioning..."',
      "  cat > /mnt/grafana-provisioning/dashboards/dashboards.yml << 'EOF'",
      "apiVersion: 1",
      "providers:",
      "  - name: 'Default'",
      "    orgId: 1",
      "    folder: ''",
      "    type: file",
      "    disableDeletion: false",
      "    updateIntervalSeconds: 10",
      "    allowUiUpdates: true",
      "    options:",
      "      path: /var/lib/grafana/dashboards",
      "EOF",
      "fi",
      "",
      "# Copy pre-configured dashboards",
      "echo 'Copying pre-configured dashboards...'",
      "DASHBOARD_COUNT=0",
      "while IFS= read -r -d '' dashboard; do",
      '  cp "$dashboard" /mnt/grafana-dashboards/',
      "  ((DASHBOARD_COUNT++))",
      "done < <(find /tmp/grafana-dashboards -name '*.json' -print0)",
      "",
      "if [ $DASHBOARD_COUNT -gt 0 ]; then",
      '  echo "✓ Copied $DASHBOARD_COUNT dashboard(s)"',
      "  ls -la /mnt/grafana-dashboards/",
      "else",
      '  echo "No dashboard JSON files found in S3 asset"',
      "fi",
      "",
      "# ==========================================================================",
      "# SET PERMISSIONS",
      "# ==========================================================================",
      "echo '=== Setting file permissions ==='",
      "",
      "# Prometheus runs as 'nobody' user (UID 65534)",
      "chown -R 65534:65534 /mnt/prometheus-config",
      "chmod -R 755 /mnt/prometheus-config",
      "",
      "# Grafana runs as 'grafana' user (UID 472)",
      "chown -R 472:0 /mnt/grafana-provisioning /mnt/grafana-dashboards",
      "chmod -R 755 /mnt/grafana-provisioning /mnt/grafana-dashboards",
      "",
      "# Set permissions on data directories",
      "if [ -d /mnt/efs ]; then",
      "  echo 'Setting EFS data directory permissions...'",
      "  chown -R 65534:65534 /mnt/efs/prometheus-data",
      "  chown -R 472:0 /mnt/efs/grafana-data",
      "  chmod -R 755 /mnt/efs/prometheus-data",
      "  chmod -R 775 /mnt/efs/grafana-data",
      "else",
      "  echo 'Setting local data directory permissions...'",
      "  chown -R 65534:65534 /mnt/prometheus-data",
      "  chown -R 472:0 /mnt/grafana-data",
      "  chmod -R 755 /mnt/prometheus-data",
      "  chmod -R 775 /mnt/grafana-data",
      "fi",
      "",
      "# ==========================================================================",
      "# VERIFICATION",
      "# ==========================================================================",
      "echo '=== Verifying setup ==='",
      "",
      "echo '--- Prometheus Config ---'",
      "cat /mnt/prometheus-config/prometheus.yml",
      "echo ''",
      "",
      "echo '--- Grafana Datasource Config ---'",
      "cat /mnt/grafana-provisioning/datasources/prometheus.yml",
      "echo ''",
      "",
      "echo '--- Directory Structure ---'",
      "ls -la /mnt/ | grep -E '(prometheus|grafana|efs)'",
      "",
      "if [ -d /mnt/efs ]; then",
      "  echo '--- EFS Contents ---'",
      "  ls -la /mnt/efs/",
      "fi",
      "",
      "# Verify critical files exist",
      "echo '--- Verifying required files ---'",
      "REQUIRED_FILES=()",
      'REQUIRED_FILES+=("/mnt/prometheus-config/prometheus.yml")',
      'REQUIRED_FILES+=("/mnt/grafana-provisioning/datasources/prometheus.yml")',
      'REQUIRED_FILES+=("/mnt/grafana-provisioning/dashboards/dashboards.yml")',
      "",
      'for f in "${REQUIRED_FILES[@]}"; do',
      '  if [ -f "$f" ]; then',
      '    echo "✓ $f exists"',
      "  else",
      '    echo "✗ ERROR: Missing required file: $f"',
      "    exit 1",
      "  fi",
      "done",
      "",
      "# Check for dashboards (not required, but log status)",
      "DASHBOARD_COUNT=$(find /mnt/grafana-dashboards -name '*.json' 2>/dev/null | wc -l)",
      'echo "✓ Found $DASHBOARD_COUNT pre-configured dashboard(s)"',
      "",
      "# Create completion marker",
      "touch /var/lib/cloud/instance/monitoring-setup-complete",
      "",
      "echo '========================================='",
      "echo '✓ Monitoring setup completed successfully!'",
      "date",
      "echo '========================================='",
      "",
      "# ==========================================================================",
      "# START ECS AGENT",
      "# ==========================================================================",
      "echo 'Starting ECS agent...'",
      "systemctl start ecs",
      "systemctl enable ecs",
      "",
      "echo '✓ ECS agent started - ready for task scheduling'",
      "echo ''",
      "echo 'Setup log available at: /var/log/monitoring-setup.log'",
    ];
  }

  /**
   * Build EFS mount commands for persistent storage
   */
  private buildEfsMountCommands(
    fileSystem: efs.FileSystem,
    region: string
  ): string[] {
    return [
      "echo '=== Setting up EFS persistent storage ==='",
      "",
      "# Install EFS utilities",
      "yum install -y amazon-efs-utils nfs-utils",
      "",
      "# Create EFS mount point",
      "mkdir -p /mnt/efs",
      "",
      "# Resolve EFS mount target IP",
      `EFS_ID="${fileSystem.fileSystemId}"`,
      `EFS_DNS="$EFS_ID.efs.${region}.amazonaws.com"`,
      'echo "EFS ID: $EFS_ID"',
      'echo "EFS DNS: $EFS_DNS"',
      "",
      "EFS_IP=$(nslookup $EFS_DNS | grep \"Address:\" | tail -n1 | awk '{print $2}')",
      'echo "Resolved EFS IP: $EFS_IP"',
      "",
      "# Mount EFS (try NFS4 first, fallback to EFS helper)",
      'if [ -n "$EFS_IP" ] && [ "$EFS_IP" != "" ]; then',
      '  echo "Mounting EFS using NFS4 with IP: $EFS_IP"',
      "  mount -t nfs4 -o nfsvers=4.1,rsize=1048576,wsize=1048576,hard,timeo=600,retrans=2 $EFS_IP:/ /mnt/efs",
      "else",
      '  echo "DNS resolution failed, using EFS mount helper with TLS"',
      "  mount -t efs -o tls $EFS_ID:/ /mnt/efs",
      "fi",
      "",
      "# Verify mount succeeded",
      "if ! mountpoint -q /mnt/efs; then",
      '  echo "ERROR: Failed to mount EFS filesystem"',
      "  dmesg | tail -20",
      "  exit 1",
      "fi",
      "echo '✓ EFS mounted successfully at /mnt/efs'",
      "",
      "# Add to fstab for persistence across reboots",
      'echo "$EFS_ID:/ /mnt/efs efs defaults,_netdev,tls 0 0" >> /etc/fstab',
      "",
      "# Create persistent data directories on EFS",
      "echo 'Creating persistent directories on EFS...'",
      "mkdir -p /mnt/efs/prometheus-data",
      "mkdir -p /mnt/efs/grafana-data",
      "mkdir -p /mnt/efs/grafana-data/plugins",
      "mkdir -p /mnt/efs/grafana-data/logs",
      "",
      "# Remove any existing local directories and create symlinks to EFS",
      "rm -rf /mnt/prometheus-data /mnt/grafana-data 2>/dev/null || true",
      "ln -sf /mnt/efs/prometheus-data /mnt/prometheus-data",
      "ln -sf /mnt/efs/grafana-data /mnt/grafana-data",
      "",
      "# Verify symlinks",
      "if [ ! -L /mnt/prometheus-data ]; then",
      '  echo "ERROR: Failed to create prometheus-data symlink"',
      "  exit 1",
      "fi",
      "echo '✓ Data symlinks created successfully'",
    ];
  }

  /**
   * Build local storage commands (no EFS - data not persistent)
   */
  private buildLocalStorageCommands(): string[] {
    return [
      "echo '=== Setting up local storage (non-persistent) ==='",
      "echo 'WARNING: Data will not persist across instance replacement'",
      "",
      "# Create local data directories",
      "mkdir -p /mnt/prometheus-data",
      "mkdir -p /mnt/grafana-data",
      "mkdir -p /mnt/grafana-data/plugins",
      "mkdir -p /mnt/grafana-data/logs",
      "",
      "echo '✓ Local directories created'",
    ];
  }

  /**
   * Generate Prometheus scrape config for cross-account targets
   */
  private generateCrossAccountScrapeConfig(
    targets: CrossAccountTarget[]
  ): string[] {
    const lines: string[] = [];

    // Separate targets by type
    const nodeExporterTargets = targets.filter(
      (t) => !t.targetType || t.targetType === "node-exporter"
    );
    const applicationTargets = targets.filter(
      (t) => t.targetType === "application"
    );

    // Group node-exporter targets by environment
    const nodeExporterByEnv = nodeExporterTargets.reduce(
      (acc, target) => {
        if (!acc[target.envName]) {
          acc[target.envName] = [];
        }
        acc[target.envName].push(target);
        return acc;
      },
      {} as Record<string, CrossAccountTarget[]>
    );

    // Generate scrape config for node-exporter targets
    for (const [env, envTargets] of Object.entries(nodeExporterByEnv)) {
      lines.push("");
      lines.push(
        `  # Cross-Account: ${env} Environment - Node Exporter (via VPC Peering)`
      );
      lines.push(`  - job_name: 'node-exporter-${env}'`);
      lines.push("    static_configs:");
      lines.push("      - targets:");

      for (const target of envTargets) {
        const port = target.port;
        lines.push(`          - '${target.privateIp}:${port}'`);
      }

      lines.push("        labels:");
      lines.push(`          environment: '${env}'`);
      lines.push("          service: 'node-exporter'");
      lines.push(`          account: '${env}'`);
      lines.push("          source: 'cross-account'");
    }

    // Group application targets by environment
    const applicationByEnv = applicationTargets.reduce(
      (acc, target) => {
        if (!acc[target.envName]) {
          acc[target.envName] = [];
        }
        acc[target.envName].push(target);
        return acc;
      },
      {} as Record<string, CrossAccountTarget[]>
    );

    // Generate scrape config for application targets
    for (const [env, envTargets] of Object.entries(applicationByEnv)) {
      lines.push("");
      lines.push(
        `  # Cross-Account: ${env} Environment - Application (via VPC Peering)`
      );
      lines.push(`  - job_name: 'nextjs-${env}'`);
      lines.push("    metrics_path: '/api/metrics'");
      lines.push("    static_configs:");
      lines.push("      - targets:");

      for (const target of envTargets) {
        const port = target.port;
        lines.push(`          - '${target.privateIp}:${port}'`);
      }

      lines.push("        labels:");
      lines.push(`          environment: '${env}'`);
      lines.push("          service: 'nextjs'");
      lines.push("          app: 'portfolio'");
      lines.push(`          account: '${env}'`);
      lines.push("          source: 'cross-account'");
    }

    return lines;
  }

  private createLoadBalancer(
    vpc: ec2.IVpc,
    envName: string,
    allowedIpRanges?: string[]
  ): elbv2.ApplicationLoadBalancer {
    const albSecurityGroup = new ec2.SecurityGroup(this, "MonitoringAlbSg", {
      vpc,
      description: "Security group for monitoring ALB",
      allowAllOutbound: true,
    });

    const ipRanges = allowedIpRanges || ["0.0.0.0/0"];
    ipRanges.forEach((ipRange) => {
      albSecurityGroup.addIngressRule(
        ec2.Peer.ipv4(ipRange),
        ec2.Port.tcp(80),
        `Allow HTTP access from ${ipRange}`
      );
    });

    const loadBalancer = new elbv2.ApplicationLoadBalancer(
      this,
      "MonitoringAlb",
      {
        vpc,
        internetFacing: true,
        loadBalancerName: `${envName}-monitoring-alb`,
        securityGroup: albSecurityGroup,
      }
    );

    cdk.Tags.of(loadBalancer).add("Name", `${envName}-monitoring-alb`);
    cdk.Tags.of(loadBalancer).add("Environment", envName);
    cdk.Tags.of(loadBalancer).add("Purpose", "Monitoring");

    return loadBalancer;
  }

  private configureSecurityGroupConnections(): void {
    this.autoScalingGroup.connections.allowFrom(
      this.loadBalancer,
      ec2.Port.tcp(9090),
      "Allow ALB to reach Prometheus"
    );

    this.autoScalingGroup.connections.allowFrom(
      this.loadBalancer,
      ec2.Port.tcp(3000),
      "Allow ALB to reach Grafana"
    );
  }

  private createPrometheusService(
    cluster: ecs.Cluster,
    envName: string,
    _albDnsName?: string
  ): ecs.Ec2Service {
    // Create log group for Prometheus
    const prometheusLogGroup = new logs.LogGroup(this, "PrometheusLogGroup", {
      logGroupName: `/ecs/${envName}/prometheus`,
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Create task definition with Prometheus container
    const prometheusTaskDef = new EcsTaskDefinitionConstruct(this, "PrometheusTaskDef", {
      envName,
      networkMode: ecs.NetworkMode.BRIDGE,
      containers: [
        {
          name: "prometheus",
          image: ecs.ContainerImage.fromRegistry("prom/prometheus:latest"),
          containerPort: 9090,
          hostPort: 9090, // Static port for ALB target group
          memoryReservationMiB: 512,
          memoryLimitMiB: 1024,
          logStreamPrefix: "prometheus",
          logGroup: prometheusLogGroup,
          command: [
            "--config.file=/etc/prometheus/prometheus.yml",
            "--storage.tsdb.path=/prometheus",
            "--web.console.libraries=/usr/share/prometheus/console_libraries",
            "--web.console.templates=/usr/share/prometheus/consoles",
            "--web.route-prefix=/prometheus",
            "--web.external-url=/prometheus",
          ],
        },
      ],
      volumes: [
        {
          name: "prometheus-data",
          host: { sourcePath: "/mnt/prometheus-data" },
        },
        {
          name: "prometheus-config",
          host: { sourcePath: "/mnt/prometheus-config" },
        },
      ],
    });

    // Add mount points
    prometheusTaskDef.addMountPoints("prometheus", {
      sourceVolume: "prometheus-data",
      containerPath: "/prometheus",
      readOnly: false,
    });
    prometheusTaskDef.addMountPoints("prometheus", {
      sourceVolume: "prometheus-config",
      containerPath: "/etc/prometheus",
      readOnly: true,
    });

    // Create service
    const prometheusService = new EcsServiceConstruct(this, "PrometheusService", {
      cluster,
      taskDefinition: prometheusTaskDef.taskDefinition,
      envName,
      serviceName: `${envName}-prometheus`,
      desiredCount: 1,
      enableExecuteCommand: true,
    });

    return prometheusService.service;
  }

  private createGrafanaService(
    cluster: ecs.Cluster,
    envName: string
  ): ecs.Ec2Service {
    // Create log group for Grafana
    const grafanaLogGroup = new logs.LogGroup(this, "GrafanaLogGroup", {
      logGroupName: `/ecs/${envName}/grafana`,
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Create task definition with Grafana container
    const grafanaTaskDef = new EcsTaskDefinitionConstruct(this, "GrafanaTaskDef", {
      envName,
      networkMode: ecs.NetworkMode.BRIDGE,
      containers: [
        {
          name: "grafana",
          image: ecs.ContainerImage.fromRegistry("grafana/grafana:latest"),
          containerPort: 3000,
          hostPort: 3000, // Static port for ALB target group
          memoryReservationMiB: 256,
          memoryLimitMiB: 512,
          user: "472", // Grafana runs as UID 472
          logStreamPrefix: "grafana",
          logGroup: grafanaLogGroup,
          environment: {
            GF_PATHS_DATA: "/var/lib/grafana",
            GF_PATHS_LOGS: "/var/log/grafana",
            GF_PATHS_PLUGINS: "/var/lib/grafana/plugins",
            GF_PATHS_PROVISIONING: "/etc/grafana/provisioning",
            GF_SERVER_ROOT_URL: "/grafana",
            GF_SERVER_SERVE_FROM_SUB_PATH: "true",
          },
        },
      ],
      volumes: [
        {
          name: "grafana-data",
          host: { sourcePath: "/mnt/grafana-data" },
        },
        {
          name: "grafana-provisioning",
          host: { sourcePath: "/mnt/grafana-provisioning" },
        },
        {
          name: "grafana-dashboards",
          host: { sourcePath: "/mnt/grafana-dashboards" },
        },
      ],
    });

    // Add mount points
    grafanaTaskDef.addMountPoints("grafana", {
      sourceVolume: "grafana-data",
      containerPath: "/var/lib/grafana",
      readOnly: false,
    });
    grafanaTaskDef.addMountPoints("grafana", {
      sourceVolume: "grafana-provisioning",
      containerPath: "/etc/grafana/provisioning",
      readOnly: true,
    });
    grafanaTaskDef.addMountPoints("grafana", {
      sourceVolume: "grafana-dashboards",
      containerPath: "/var/lib/grafana/dashboards",
      readOnly: true,
    });

    // Create service
    const grafanaService = new EcsServiceConstruct(this, "GrafanaService", {
      cluster,
      taskDefinition: grafanaTaskDef.taskDefinition,
      envName,
      serviceName: `${envName}-grafana`,
      desiredCount: 1,
      enableExecuteCommand: true,
    });

    return grafanaService.service;
  }

  private createNodeExporterService(
    cluster: ecs.Cluster,
    envName: string
  ): ecs.Ec2Service {
    // Create log group for Node Exporter
    const nodeExporterLogGroup = new logs.LogGroup(this, "NodeExporterLogGroup", {
      logGroupName: `/ecs/${envName}/node-exporter`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Create task definition with Node Exporter container (HOST network mode)
    const nodeExporterTaskDef = new EcsTaskDefinitionConstruct(this, "NodeExporterTaskDef", {
      envName: `${envName}-monitoring`,
      networkMode: ecs.NetworkMode.HOST,
      containers: [
        {
          name: "node-exporter",
          image: ecs.ContainerImage.fromRegistry("prom/node-exporter:latest"),
          containerPort: 9100,
          memoryReservationMiB: 64,
          logStreamPrefix: "node-exporter",
          logGroup: nodeExporterLogGroup,
          command: [
            "--path.procfs=/host/proc",
            "--path.sysfs=/host/sys",
            "--path.rootfs=/rootfs",
            "--collector.filesystem.mount-points-exclude=^/(sys|proc|dev|host|etc)($|/)",
          ],
        },
      ],
      volumes: [
        {
          name: "proc",
          host: { sourcePath: "/proc" },
        },
        {
          name: "sys",
          host: { sourcePath: "/sys" },
        },
        {
          name: "rootfs",
          host: { sourcePath: "/" },
        },
      ],
    });

    // Add mount points
    nodeExporterTaskDef.addMountPoints("node-exporter", {
      sourceVolume: "proc",
      containerPath: "/host/proc",
      readOnly: true,
    });
    nodeExporterTaskDef.addMountPoints("node-exporter", {
      sourceVolume: "sys",
      containerPath: "/host/sys",
      readOnly: true,
    });
    nodeExporterTaskDef.addMountPoints("node-exporter", {
      sourceVolume: "rootfs",
      containerPath: "/rootfs",
      readOnly: true,
    });

    // Create service
    const nodeExporterService = new EcsServiceConstruct(this, "NodeExporterService", {
      cluster,
      taskDefinition: nodeExporterTaskDef.taskDefinition,
      envName: `${envName}-monitoring`,
      serviceName: `${envName}-monitoring-node-exporter`,
      desiredCount: 1,
      enableExecuteCommand: true,
    });

    return nodeExporterService.service;
  }

  private configureLoadBalancerRouting(): void {
    const listener = this.loadBalancer.addListener("MonitoringListener", {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
    });

    const grafanaTargetGroup = new elbv2.ApplicationTargetGroup(
      this,
      "GrafanaTargetGroup",
      {
        port: 3000,
        protocol: elbv2.ApplicationProtocol.HTTP,
        vpc: this.cluster.vpc,
        targetType: elbv2.TargetType.INSTANCE,
        healthCheck: {
          path: "/grafana/api/health",
          healthyHttpCodes: "200",
          interval: cdk.Duration.seconds(30),
          timeout: cdk.Duration.seconds(5),
          healthyThresholdCount: 2,
          unhealthyThresholdCount: 3,
        },
        deregistrationDelay: cdk.Duration.seconds(30),
      }
    );

    const prometheusTargetGroup = new elbv2.ApplicationTargetGroup(
      this,
      "PrometheusTargetGroup",
      {
        port: 9090,
        protocol: elbv2.ApplicationProtocol.HTTP,
        vpc: this.cluster.vpc,
        targetType: elbv2.TargetType.INSTANCE,
        healthCheck: {
          path: "/prometheus/-/healthy",
          healthyHttpCodes: "200",
          interval: cdk.Duration.seconds(30),
          timeout: cdk.Duration.seconds(5),
          healthyThresholdCount: 2,
          unhealthyThresholdCount: 3,
        },
        deregistrationDelay: cdk.Duration.seconds(30),
      }
    );

    this.prometheusService.connections.allowFrom(
      this.loadBalancer,
      ec2.Port.tcp(9090),
      "Allow ALB to reach Prometheus"
    );

    this.grafanaService.connections.allowFrom(
      this.loadBalancer,
      ec2.Port.tcp(3000),
      "Allow ALB to reach Grafana"
    );

    listener.addTargetGroups("GrafanaRule", {
      targetGroups: [grafanaTargetGroup],
      conditions: [elbv2.ListenerCondition.pathPatterns(["/grafana*"])],
      priority: 100,
    });

    listener.addTargetGroups("PrometheusRule", {
      targetGroups: [prometheusTargetGroup],
      conditions: [elbv2.ListenerCondition.pathPatterns(["/prometheus*"])],
      priority: 200,
    });

    listener.addAction("DefaultAction", {
      action: elbv2.ListenerAction.redirect({
        path: "/grafana",
        permanent: true,
      }),
    });

    grafanaTargetGroup.addTarget(
      this.grafanaService.loadBalancerTarget({
        containerName: "grafana",
        containerPort: 3000,
      })
    );

    prometheusTargetGroup.addTarget(
      this.prometheusService.loadBalancerTarget({
        containerName: "prometheus",
        containerPort: 9090,
      })
    );
  }

  private createOutputs(
    taskLogGroup: logs.LogGroup,
    eventLogGroup: logs.LogGroup
  ): void {
    new cdk.CfnOutput(this, "GrafanaUrl", {
      value: this.grafanaUrl,
      description: "Grafana Dashboard URL (default: admin/admin)",
      exportName: `${this.stackName}-grafana-url`,
    });

    new cdk.CfnOutput(this, "PrometheusUrl", {
      value: this.prometheusUrl,
      description: "Prometheus URL",
      exportName: `${this.stackName}-prometheus-url`,
    });

    new cdk.CfnOutput(this, "MonitoringAlbDns", {
      value: this.loadBalancer.loadBalancerDnsName,
      description: "Monitoring ALB DNS name",
      exportName: `${this.stackName}-alb-dns`,
    });

    new cdk.CfnOutput(this, "ClusterName", {
      value: this.cluster.clusterName,
      description: "ECS Cluster name for monitoring",
      exportName: `${this.stackName}-cluster-name`,
    });

    new cdk.CfnOutput(this, "MonitoringTaskLogGroupName", {
      value: taskLogGroup.logGroupName,
      description: "CloudWatch Log Group for Monitoring Task Logs",
      exportName: `${this.stackName}-task-log-group`,
    });

    new cdk.CfnOutput(this, "MonitoringEventLogGroupName", {
      value: eventLogGroup.logGroupName,
      description: "CloudWatch Log Group for Monitoring ECS Events",
      exportName: `${this.stackName}-event-log-group`,
    });
  }
}