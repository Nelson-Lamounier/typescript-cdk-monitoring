/** @format */

import * as cdk from "aws-cdk-lib";
import * as autoscaling from "aws-cdk-lib/aws-autoscaling";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import { Tags } from "aws-cdk-lib";
import { NagSuppressions } from "cdk-nag";
import { Construct } from "constructs";

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
