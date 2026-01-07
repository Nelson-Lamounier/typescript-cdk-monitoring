/** @format */

import * as cdk from "aws-cdk-lib";
import * as autoscaling from "aws-cdk-lib/aws-autoscaling";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as cw from "aws-cdk-lib/aws-cloudwatch";
import { Tags } from "aws-cdk-lib";
import { NagSuppressions } from "cdk-nag";
import { Construct } from "constructs";

import { EcsTaskExecutionRole } from "../../iam/ecs-task-execution-role";
import { SuppressionManager } from "../../cdk-nag/suppression-manager";
import { CrossAccountTarget } from "../../types";
import {
  EcsApplicationConfig,
  EcsServiceConfig,
} from "../../types/ecs-service-config";

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

    // EBS volumes are attached via launch template - no additional IAM permissions needed

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
    // Capacity provider name must not start with "aws", "ecs", or "fargate"
    // and can only contain letters, numbers, underscores, and hyphens
    const capacityProviderName = `${envName}-monitoring-capacity-provider`
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "-")
      .substring(0, 255);

    const capacityProvider = new ecs.AsgCapacityProvider(
      this,
      "CapacityProvider",
      {
        autoScalingGroup: this.autoScalingGroup,
        enableManagedScaling: false,
        enableManagedTerminationProtection: false,
      }
    );

    // Override the capacity provider name using escape hatch
    // CDK auto-generated names may start with "ecs" which is not allowed
    const cfnCapacityProvider = capacityProvider.node
      .defaultChild as ecs.CfnCapacityProvider;
    if (cfnCapacityProvider) {
      cfnCapacityProvider.name = capacityProviderName;
    }

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
    const cfnAsg = this.asg.node
      .defaultChild as autoscaling.CfnAutoScalingGroup;
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
    // Capacity provider name must not start with "aws", "ecs", or "fargate"
    // and can only contain letters, numbers, underscores, and hyphens
    const capacityProviderName = `${envName}-${clusterName.replace(
      "ecs-",
      ""
    )}-capacity-provider`
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "-")
      .replace(/^ecs-/, "") // Remove "ecs-" prefix if present
      .substring(0, 255);

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

    // Override the capacity provider name using escape hatch
    // CDK auto-generated names may start with "ecs" which is not allowed
    const cfnCapacityProvider = capacityProvider.node
      .defaultChild as ecs.CfnCapacityProvider;
    if (cfnCapacityProvider) {
      cfnCapacityProvider.name = capacityProviderName;
    }

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
    // Create CloudWatch Log Group for Node Exporter
    const logGroup = new logs.LogGroup(this, "NodeExporterLogGroup", {
      logGroupName: `/ecs/${envName}-app-node-exporter`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Create task execution role for CloudWatch Logs access
    // Required for tasks that use awslogs log driver
    // Pass log group ARN for specific permissions
    const executionRole = new EcsTaskExecutionRole(
      this,
      "NodeExporterExecutionRole",
      {
        envName,
        logGroupArn: logGroup.logGroupArn,
        enablePublicEcr: true, // Node Exporter uses public Docker Hub image
      }
    ).role;

    // Task definition with HOST network mode
    const taskDefinition = new ecs.Ec2TaskDefinition(
      this,
      "NodeExporterTaskDef",
      {
        networkMode: ecs.NetworkMode.HOST,
        executionRole, // Required for CloudWatch Logs
      }
    );

    // Container definition
    const container = taskDefinition.addContainer("node-exporter", {
      image: ecs.ContainerImage.fromRegistry("prom/node-exporter:latest"),
      memoryReservationMiB: 64,
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: "node-exporter",
        logGroup: logGroup,
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

    // Create service with circuit breaker disabled for Node Exporter
    // Node Exporter uses HOST network mode and may have port conflicts
    // Circuit breaker can be too aggressive for system-level services
    const service = new ecs.Ec2Service(this, "NodeExporterService", {
      cluster: this.cluster,
      taskDefinition,
      serviceName: `${envName}-app-node-exporter`,
      desiredCount: 1,
      enableExecuteCommand: true,
      // Disable circuit breaker for Node Exporter
      // HOST network mode can have port conflicts that trigger false positives
      circuitBreaker: {
        enable: false,
        rollback: false,
      },
      // Allow service to start even if previous deployment failed
      minHealthyPercent: 0,
      maxHealthyPercent: 200,
      // Extended health check grace period for system-level service
      healthCheckGracePeriod: cdk.Duration.seconds(300),
      // Placement constraints: one per instance to avoid port conflicts
      placementConstraints: [ecs.PlacementConstraint.distinctInstances()],
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

export interface EcsStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
  envName: string;
  /**
   * Application configuration defining services, volumes, and load balancer
   */
  applicationConfig: EcsApplicationConfig;
  /**
   * Cross-account targets for monitoring (optional, used for Prometheus scrape config)
   */
  crossAccountTargets?: CrossAccountTarget[];
  /**
   * Custom user data script (optional, will use default if not provided)
   */
  customUserData?: string[];
}

export class EcsStack extends cdk.Stack {
  public readonly cluster: ecs.Cluster;
  public readonly services: Map<string, ecs.Ec2Service>; // Empty - services created in separate stack
  public readonly loadBalancer?: elbv2.ApplicationLoadBalancer;
  public readonly serviceUrls: Map<string, string>; // Empty - services created in separate stack
  public readonly autoScalingGroup: autoscaling.AutoScalingGroup; // Exposed for use by services stack
  private readonly applicationConfig: EcsApplicationConfig;

  constructor(scope: Construct, id: string, props: EcsStackProps) {
    super(scope, id, props);

    const {
      vpc,
      envName,
      applicationConfig,
      crossAccountTargets,
      customUserData,
    } = props;

    this.applicationConfig = applicationConfig;

    // Extract EBS volume configuration
    const ebsVolumes = applicationConfig.ebsVolumes || [];
    const volumeConfigs = ebsVolumes.map(
      (vol: {
        deviceName: string;
        sizeGB: number;
        mountPath: string;
        volumeType?: "gp3" | "gp2" | "io1" | "io2";
        deleteOnTermination?: boolean;
      }) => ({
        deviceName: vol.deviceName,
        sizeGB: vol.sizeGB,
        mountPath: vol.mountPath,
        volumeType:
          vol.volumeType === "gp3"
            ? ec2.EbsDeviceVolumeType.GP3
            : vol.volumeType === "gp2"
            ? ec2.EbsDeviceVolumeType.GP2
            : vol.volumeType === "io1"
            ? ec2.EbsDeviceVolumeType.IO1
            : ec2.EbsDeviceVolumeType.GP3,
        deleteOnTermination: vol.deleteOnTermination ?? false,
      })
    );

    // Create ECS Cluster with dynamic EBS volumes
    const { cluster, autoScalingGroup } = this.createEcsCluster(
      vpc,
      envName,
      applicationConfig.applicationName,
      crossAccountTargets,
      volumeConfigs,
      customUserData
    );
    this.cluster = cluster;
    this.autoScalingGroup = autoScalingGroup;

    // Create CloudWatch Log Groups for application services
    const taskLogGroup = new logs.LogGroup(this, "TaskLogs", {
      logGroupName: `/ecs/${this.stackName}/tasks`,
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const eventLogGroup = new logs.LogGroup(this, "EcsEvents", {
      logGroupName: `/ecs/${this.stackName}/events`,
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Configure ECS to send events to CloudWatch Logs
    new cdk.aws_events.Rule(this, "EcsEventRule", {
      description: `Capture ECS events for ${envName} ${applicationConfig.applicationName} cluster`,
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
      targets: [new cdk.aws_events_targets.CloudWatchLogGroup(eventLogGroup)],
    });

    // Create Application Load Balancer if configured
    // Note: Services will be created in a separate stack (MonitoringServicesStack)
    // This stack only creates infrastructure (cluster, capacity, load balancer)
    const lbConfig = applicationConfig.loadBalancer;
    if (lbConfig) {
      this.loadBalancer = this.createLoadBalancer(
        vpc,
        envName,
        applicationConfig.applicationName,
        lbConfig.allowedIpRanges
      );
    }

    // Initialize services map (empty - services created in separate stack)
    this.services = new Map();
    this.serviceUrls = new Map();

    // Create outputs (cluster and load balancer for use by services stack)
    this.createOutputs(taskLogGroup, eventLogGroup, envName);

    // ========================================================================
    // CDK NAG SUPPRESSIONS
    // ========================================================================
    SuppressionManager.applyToStack(this, "ComputeStack", envName);

    // ========================================================================
    // RESOURCE TAGGING
    // ========================================================================
    cdk.Tags.of(this).add("Stack", "EcsStack");
    cdk.Tags.of(this).add("Application", applicationConfig.applicationName);
    cdk.Tags.of(this).add("Environment", envName);
    cdk.Tags.of(this).add("ManagedBy", "CDK");
  }

  /**
   * Create a service from configuration
   */
  private createServiceFromConfig(
    cluster: ecs.Cluster,
    envName: string,
    serviceConfig: EcsServiceConfig
  ): ecs.Ec2Service {
    // Create log group if not provided
    let logGroup = serviceConfig.container.logGroup;
    if (!logGroup) {
      logGroup = new logs.LogGroup(this, `${serviceConfig.name}LogGroup`, {
        logGroupName: `/ecs/${envName}/${serviceConfig.name}`,
        retention: logs.RetentionDays.TWO_WEEKS,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });
    }

    // Create task definition
    const taskDef = new EcsTaskDefinitionConstruct(
      this,
      `${serviceConfig.name}TaskDef`,
      {
        envName,
        networkMode: serviceConfig.networkMode || ecs.NetworkMode.BRIDGE,
        containers: [
          {
            name: serviceConfig.container.name,
            image: ecs.ContainerImage.fromRegistry(
              serviceConfig.container.image
            ),
            containerPort: serviceConfig.container.containerPort,
            hostPort: serviceConfig.container.hostPort,
            memoryReservationMiB: serviceConfig.container.memoryReservationMiB,
            memoryLimitMiB: serviceConfig.container.memoryLimitMiB,
            cpu: serviceConfig.container.cpu,
            user: serviceConfig.container.user,
            command: serviceConfig.container.command,
            environment: serviceConfig.container.environment,
            logGroup: logGroup,
            logStreamPrefix:
              serviceConfig.container.logStreamPrefix || serviceConfig.name,
          },
        ],
        volumes: serviceConfig.volumes?.map((vol) => ({
          name: vol.name,
          host: { sourcePath: vol.hostPath },
        })),
      }
    );

    // Add mount points
    if (serviceConfig.volumes) {
      for (const vol of serviceConfig.volumes) {
        taskDef.addMountPoints(serviceConfig.container.name, {
          sourceVolume: vol.name,
          containerPath: vol.containerPath,
          readOnly: vol.readOnly ?? false,
        });
      }
    }

    // Create service
    const service = new EcsServiceConstruct(
      this,
      `${serviceConfig.name}Service`,
      {
        cluster,
        taskDefinition: taskDef.taskDefinition,
        envName,
        serviceName: `${envName}-${serviceConfig.name}`,
        desiredCount: serviceConfig.desiredCount ?? 1,
        enableExecuteCommand: serviceConfig.enableExecuteCommand ?? false,
      }
    );

    return service.service;
  }

  /**
   * Create target group for a service
   */
  private createTargetGroup(
    vpc: ec2.IVpc,
    serviceConfig: EcsServiceConfig,
    envName: string
  ): elbv2.ApplicationTargetGroup {
    if (!serviceConfig.loadBalancer) {
      throw new Error(
        "Service must have loadBalancer configuration to create target group"
      );
    }

    const targetGroup = new elbv2.ApplicationTargetGroup(
      this,
      `${serviceConfig.name}TargetGroup`,
      {
        port:
          serviceConfig.container.hostPort ||
          serviceConfig.container.containerPort,
        protocol: elbv2.ApplicationProtocol.HTTP,
        vpc,
        targetType: elbv2.TargetType.INSTANCE,
        healthCheck: {
          path: serviceConfig.loadBalancer.healthCheckPath || "/",
          interval: cdk.Duration.seconds(30),
          timeout: cdk.Duration.seconds(5),
          healthyThresholdCount: 2,
          unhealthyThresholdCount: 3,
        },
      }
    );

    cdk.Tags.of(targetGroup).add("Service", serviceConfig.name);
    cdk.Tags.of(targetGroup).add("Environment", envName);

    return targetGroup;
  }

  /**
   * Create ECS cluster with EC2 capacity and dynamic EBS volumes
   * Uses LaunchTemplateConstruct for consistent, secure launch template configuration
   * EBS volumes are attached via launch template for persistent storage
   */
  private createEcsCluster(
    vpc: ec2.IVpc,
    envName: string,
    applicationName: string,
    crossAccountTargets?: CrossAccountTarget[],
    ebsVolumes?: Array<{
      deviceName: string;
      sizeGB: number;
      volumeType: ec2.EbsDeviceVolumeType;
      deleteOnTermination: boolean;
    }>,
    customUserData?: string[]
  ): { cluster: ecs.Cluster; autoScalingGroup: autoscaling.AutoScalingGroup } {
    // Constrain ECS capacity to the first public AZ
    const publicAz0Subnets = vpc.selectSubnets({
      subnetType: ec2.SubnetType.PUBLIC,
      availabilityZones: [vpc.availabilityZones[0]],
      onePerAz: true,
    });

    const clusterName = `${envName}-${applicationName}-cluster`;
    const cluster = new ecs.Cluster(this, "ApplicationCluster", {
      vpc,
      clusterName,
    });

    // Enable Container Insights if configured
    const enableContainerInsights =
      this.applicationConfig.cluster?.enableContainerInsights ?? false;
    if (enableContainerInsights) {
      const cfnCluster = cluster.node.defaultChild as ecs.CfnCluster;
      cfnCluster.clusterSettings = [
        {
          name: "containerInsights",
          value: "enabled",
        },
      ];
    }

    // Create ECS-compatible user data for the launch template
    const ecsUserData = ec2.UserData.forLinux();
    if (customUserData && customUserData.length > 0) {
      ecsUserData.addCommands(...customUserData);
    } else {
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
    }

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
            volume: ec2.BlockDeviceVolume.ebs(30, {
              volumeType: ec2.EbsDeviceVolumeType.GP3,
              encrypted: true,
              deleteOnTermination: true,
            }),
          },
          // Add dynamic EBS volumes from configuration
          ...(ebsVolumes?.map((vol) => ({
            deviceName: vol.deviceName,
            volume: ec2.BlockDeviceVolume.ebs(vol.sizeGB, {
              volumeType: vol.volumeType,
              encrypted: true,
              deleteOnTermination: vol.deleteOnTermination,
            }),
          })) || []),
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
    // Capacity provider name must not start with "aws", "ecs", or "fargate"
    // and can only contain letters, numbers, underscores, and hyphens
    const capacityProviderName =
      `${envName}-${applicationName}-capacity-provider`
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, "-")
        .substring(0, 255);

    const capacityProvider = new ecs.AsgCapacityProvider(
      this,
      "AsgCapacityProvider",
      {
        autoScalingGroup,
        enableManagedScaling: false,
        enableManagedTerminationProtection: false,
      }
    );

    // Override the capacity provider name using escape hatch
    // CDK auto-generated names may start with "ecs" which is not allowed
    const cfnCapacityProvider = capacityProvider.node
      .defaultChild as ecs.CfnCapacityProvider;
    if (cfnCapacityProvider) {
      cfnCapacityProvider.name = capacityProviderName;
    }

    cluster.addAsgCapacityProvider(capacityProvider);

    // Build and apply UserData with dynamic EBS volume configuration
    const userDataCommands = this.buildUserData(
      envName,
      applicationName,
      (this.applicationConfig.ebsVolumes || []).map((vol) => ({
        deviceName: vol.deviceName,
        sizeGB: vol.sizeGB,
        mountPath: vol.mountPath,
      })),
      crossAccountTargets
    );
    autoScalingGroup.addUserData(...userDataCommands);

    // Security group rules
    autoScalingGroup.connections.allowToAnyIpv4(
      ec2.Port.tcp(443),
      "Allow HTTPS outbound for ECS agent and S3"
    );

    // Allow internal communication between services (if needed)
    // This is application-specific and can be configured per service

    cdk.Tags.of(cluster).add("Environment", envName);
    cdk.Tags.of(cluster).add("Application", applicationName);

    return { cluster, autoScalingGroup };
  }

  /**
   * Build UserData script that:
   * 1. Formats and mounts EBS volumes dynamically from configuration
   * 2. Creates necessary directories
   * 3. Starts ECS agent after setup completes
   */
  private buildUserData(
    envName: string,
    applicationName: string,
    ebsVolumes: Array<{
      deviceName: string;
      sizeGB: number;
      mountPath: string;
    }>,
    _crossAccountTargets?: CrossAccountTarget[]
  ): string[] {
    const region = cdk.Stack.of(this).region;

    // EBS volume setup commands (dynamic based on configuration)
    const ebsCommands = this.buildEbsVolumeCommands(ebsVolumes);

    return [
      "#!/bin/bash",
      "set -ex",
      "",
      "# ==========================================================================",
      "# APPLICATION STACK PROVISIONING SCRIPT",
      "# This script is generated by CDK and runs on EC2 instance startup",
      "# ==========================================================================",
      "",
      `exec > >(tee -a /var/log/${applicationName}-setup.log) 2>&1`,
      "",
      "echo '========================================='",
      `echo '${applicationName} Setup Started'`,
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
      "# EBS VOLUME SETUP",
      "# ==========================================================================",
      ...ebsCommands,
      "",
      "# ==========================================================================",
      "# CREATE REQUIRED DIRECTORIES",
      "# ==========================================================================",
      "echo 'Creating required directories...'",
      // Create directories for all EBS volume mount points
      ...ebsVolumes.map((vol) => `mkdir -p ${vol.mountPath}`),
      "",
      "# ==========================================================================",
      "# VERIFICATION",
      "# ==========================================================================",
      "echo '=== Verifying setup ==='",
      "",
      "echo '--- Directory Structure ---'",
      "ls -la /mnt/",
      "",
      "echo '--- EBS Volume Status ---'",
      "df -h | grep -E '(xvdf|xvdg|xvdh|xvdi)' || echo 'No EBS volumes found'",
      "",
      "# Create completion marker",
      `touch /var/lib/cloud/instance/${applicationName}-setup-complete`,
      "",
      "echo '========================================='",
      `echo '✓ ${applicationName} setup completed successfully!'`,
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
      `echo 'Setup log available at: /var/log/${applicationName}-setup.log'`,
    ];
  }

  /**
   * Build EBS volume setup commands for persistent storage
   * Formats and mounts EBS volumes attached via launch template
   * Dynamic based on volume configuration
   */
  private buildEbsVolumeCommands(
    ebsVolumes: Array<{
      deviceName: string;
      sizeGB: number;
      mountPath: string;
    }>
  ): string[] {
    if (ebsVolumes.length === 0) {
      return [
        "echo '=== No EBS volumes configured ==='",
        "echo 'Skipping EBS volume setup'",
      ];
    }

    const commands: string[] = [
      "echo '=== Setting up EBS volumes for persistent storage ==='",
      "",
      "# Wait for EBS volumes to be attached (volumes are attached via launch template)",
      "echo 'Waiting for EBS volumes to be available...'",
      "sleep 5",
      "",
    ];

    // Generate commands for each volume
    for (const volume of ebsVolumes) {
      const deviceName = volume.deviceName;
      const mountPath = volume.mountPath;
      const volumeName = mountPath.split("/").pop() || "volume";

      commands.push(
        `# Check if ${volumeName} volume (${deviceName}) exists and format if needed`,
        `if [ -b ${deviceName} ]; then`,
        `  echo 'Found ${volumeName} volume at ${deviceName}'`,
        "  # Check if volume is already formatted",
        `  if ! blkid ${deviceName} > /dev/null 2>&1; then`,
        `    echo 'Formatting ${volumeName} volume with ext4...'`,
        `    mkfs.ext4 -F ${deviceName}`,
        `    echo '✓ ${volumeName} volume formatted'`,
        "  else",
        `    echo '${volumeName} volume already formatted'`,
        "  fi",
        "  ",
        "  # Create mount point and mount volume",
        `  mkdir -p ${mountPath}`,
        `  mount ${deviceName} ${mountPath}`,
        "  ",
        "  # Add to fstab for persistence across reboots",
        `  if ! grep -q '${deviceName}' /etc/fstab; then`,
        `    echo '${deviceName} ${mountPath} ext4 defaults,nofail 0 2' >> /etc/fstab`,
        "  fi",
        "  ",
        `  echo '✓ ${volumeName} volume mounted at ${mountPath}'`,
        "else",
        `  echo 'WARNING: ${volumeName} volume ${deviceName} not found'`,
        `  mkdir -p ${mountPath}`,
        "fi",
        ""
      );
    }

    commands.push(
      "# Verify volumes are mounted",
      "echo '=== Verifying EBS volume mounts ==='",
      "df -h | grep -E '(xvdf|xvdg|xvdh|xvdi)' || echo 'No EBS volumes mounted'",
      "echo '✓ EBS volume setup completed'"
    );

    return commands;
  }

  private createLoadBalancer(
    vpc: ec2.IVpc,
    envName: string,
    applicationName: string,
    allowedIpRanges?: string[]
  ): elbv2.ApplicationLoadBalancer {
    const albSecurityGroup = new ec2.SecurityGroup(this, "ApplicationAlbSg", {
      vpc,
      description: `Security group for ${applicationName} ALB`,
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
      "ApplicationAlb",
      {
        vpc,
        internetFacing: true,
        loadBalancerName: `${envName}-${applicationName}-alb`,
        securityGroup: albSecurityGroup,
      }
    );

    cdk.Tags.of(loadBalancer).add("Name", `${envName}-${applicationName}-alb`);
    cdk.Tags.of(loadBalancer).add("Environment", envName);
    cdk.Tags.of(loadBalancer).add("Application", applicationName);

    return loadBalancer;
  }

  private createOutputs(
    taskLogGroup: logs.LogGroup,
    eventLogGroup: logs.LogGroup,
    envName: string
  ): void {
    const appName = this.applicationConfig.applicationName;
    const exportPrefix = `${envName}-${appName}`;

    // Output cluster information (exported for use by services stack)
    new cdk.CfnOutput(this, "ClusterName", {
      value: this.cluster.clusterName,
      description: "ECS Cluster Name",
      exportName: `${exportPrefix}-cluster-name`,
    });

    new cdk.CfnOutput(this, "ClusterArn", {
      value: this.cluster.clusterArn,
      description: "ECS Cluster ARN",
      exportName: `${exportPrefix}-cluster-arn`,
    });

    // Output ALB DNS if load balancer exists (exported for use by services stack)
    if (this.loadBalancer) {
      new cdk.CfnOutput(this, "ApplicationAlbDns", {
        value: this.loadBalancer.loadBalancerDnsName,
        description: `${appName} ALB DNS name`,
        exportName: `${exportPrefix}-alb-dns`,
      });

      new cdk.CfnOutput(this, "ApplicationAlbArn", {
        value: this.loadBalancer.loadBalancerArn,
        description: `${appName} ALB ARN`,
        exportName: `${exportPrefix}-alb-arn`,
      });
    }

    // Output log groups for reference
    new cdk.CfnOutput(this, "TaskLogGroupName", {
      value: taskLogGroup.logGroupName,
      description: "CloudWatch Log Group for Task Logs",
    });

    new cdk.CfnOutput(this, "EventLogGroupName", {
      value: eventLogGroup.logGroupName,
      description: "CloudWatch Log Group for ECS Events",
    });
  }
}
