/** @format */

import * as cdk from "aws-cdk-lib";
import * as autoscaling from "aws-cdk-lib/aws-autoscaling";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

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
