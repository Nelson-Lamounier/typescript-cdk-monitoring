/** @format */

import { Construct } from "constructs";
import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as iam from "aws-cdk-lib/aws-iam";
import { Tags } from "aws-cdk-lib";

import { SuppressionManager } from "../../cdk-nag";

export interface LaunchTemplateConstructProps {
  vpc: ec2.IVpc;
  envName: string;
  projectName?: string; // Project name for resource naming and tagging
  instanceType?: ec2.InstanceType;
  machineImage?: ec2.IMachineImage;
  /**
   * @deprecated Use `keyPair` instead
   */
  keyName?: string;
  /**
   * EC2 Key Pair for SSH access to instances.
   * If both `keyName` and `keyPair` are provided, `keyPair` takes precedence.
   */
  keyPair?: ec2.IKeyPair;
  securityGroups?: ec2.ISecurityGroup[];
  userData?: ec2.UserData;
  role?: iam.Role;
  enableMonitoring?: boolean;
  associatePublicIpAddress?: boolean;
  blockDevices?: ec2.BlockDevice[];
  /**
   * Add an SSH (22/tcp) ingress rule from anywhere.
   * Default false (least privilege).
   */
  allowSshFromAnywhere?: boolean;
  /**
   * Add an HTTP (80/tcp) ingress rule from anywhere.
   * Default false (least privilege).
   */
  allowHttpFromAnywhere?: boolean;
}

export class LaunchTemplateConstruct extends Construct {
  public readonly launchTemplate: ec2.LaunchTemplate;
  public readonly securityGroup: ec2.SecurityGroup;
  public readonly role: iam.Role; // Always concrete Role type

  constructor(
    scope: Construct,
    id: string,
    props: LaunchTemplateConstructProps
  ) {
    super(scope, id);

    // Create security group for the instances
    // CRITICAL: allowAllOutbound must be true for ECS container instances to register
    // This allows instances to communicate with ECS, SSM, ECR, CloudWatch, and other AWS services
    this.securityGroup = new ec2.SecurityGroup(this, "SecurityGroup", {
      vpc: props.vpc,
      description: "Security group for launch template instances",
      allowAllOutbound: true, // Required for ECS container instance registration
    });

    // Add explicit outbound HTTPS rule for visibility and documentation
    // Even though allowAllOutbound=true creates a default "allow all" rule,
    // adding this explicit rule makes it clear what ports are needed and ensures
    // the rule is visible in the AWS console
    this.securityGroup.addEgressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      "Allow outbound HTTPS for SSM/ECS/ECR/CloudWatch endpoints"
    );

    // Add explicit HTTP rule for package updates (yum/dnf)
    this.securityGroup.addEgressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      "Allow outbound HTTP for package updates"
    );

    // Optional ingress rules (disabled by default for least privilege)
    if (props.allowSshFromAnywhere) {
      this.securityGroup.addIngressRule(
        ec2.Peer.anyIpv4(),
        ec2.Port.tcp(22),
        "Allow SSH access"
      );
    }

    if (props.allowHttpFromAnywhere) {
      this.securityGroup.addIngressRule(
        ec2.Peer.anyIpv4(),
        ec2.Port.tcp(80),
        "Allow HTTP access"
      );
    }

    // Create IAM role for EC2 instances
    // Create IAM role for EC2 instances
    // If a role is passed in, it must be a concrete Role, not just IRole
    this.role =
      (props.role as iam.Role) ??
      new iam.Role(this, "InstanceRole", {
        assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
        description: "IAM role for EC2 instances launched from template",
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName(
            "AmazonSSMManagedInstanceCore"
          ),
          iam.ManagedPolicy.fromAwsManagedPolicyName(
            "CloudWatchAgentServerPolicy"
          ),
        ],
      });

    // CRITICAL: Create instance profile explicitly
    // Even though CDK creates one automatically when we pass role to LaunchTemplate,
    // we create our own to ensure we can reference it explicitly and it's not lost
    // when we override NetworkInterfaces
    const instanceProfile = new iam.InstanceProfile(this, "InstanceProfile", {
      role: this.role,
    });

    // Default user data - ensure SSM agent is installed and running
    const userData = props.userData || ec2.UserData.forLinux();
    if (!props.userData) {
      userData.addCommands(
        "#!/bin/bash",
        "# ==========================================================================",
        `# MINIMAL USER DATA - ${props.envName.toUpperCase()}`,
        "# Purpose: Infrastructure Registration Only (SSM + ECS)",
        "# Application setup handled by Lambda + SSM Run Command",
        "# ==========================================================================",
        "",
        "# Enable logging",
        "exec > >(tee /var/log/user-data.log|logger -t user-data -s 2>/dev/console) 2>&1",
        "",
        "echo '========================================='",
        `echo 'SSM Bootstrap - ${props.envName}'`,
        "echo 'Timestamp:' $(date)",
        "echo '========================================='",
        "",
        "# ==========================================================================",
        "# SSM AGENT INSTALLATION AND STARTUP",
        "# ==========================================================================",
        "# This is the ONLY thing UserData does - get SSM agent running",
        "# All other setup (ECS agent, CloudWatch Agent) is handled by SSM State Manager",
        "",
        "echo 'Installing and starting SSM agent...'",
        "",
        "# Choose package manager (AL2023 uses dnf, AL2 uses yum)",
        "PKG_MGR=yum",
        "command -v dnf >/dev/null 2>&1 && PKG_MGR=dnf",
        "",
        "# Install SSM agent",
        "$PKG_MGR -y install amazon-ssm-agent || echo 'WARNING: SSM agent installation failed'",
        "",
        "# Enable and start SSM agent",
        "systemctl enable amazon-ssm-agent || true",
        "systemctl start amazon-ssm-agent || true",
        "",
        "# Verify SSM agent is running (with retries)",
        "SSM_RETRY_COUNT=0",
        "SSM_MAX_RETRIES=12", // 2 minutes total (10s * 12)
        "while [ $SSM_RETRY_COUNT -lt $SSM_MAX_RETRIES ]; do",
        "  if systemctl is-active amazon-ssm-agent >/dev/null 2>&1; then",
        "    echo '✓ SSM agent is running'",
        "    break",
        "  else",
        "    SSM_RETRY_COUNT=$((SSM_RETRY_COUNT + 1))",
        '    echo "SSM agent not active yet (attempt $SSM_RETRY_COUNT/$SSM_MAX_RETRIES), waiting 10s..."',
        "    systemctl start amazon-ssm-agent >/dev/null 2>&1 || true",
        "    sleep 10",
        "  fi",
        "done",
        "",
        "if ! systemctl is-active amazon-ssm-agent >/dev/null 2>&1; then",
        "  echo 'WARNING: SSM agent not active after $SSM_MAX_RETRIES attempts'",
        "  echo 'SSM State Manager associations will not run until SSM agent is active'",
        "else",
        "  echo '✓ SSM agent is running and ready for State Manager'",
        "  echo 'SSM State Manager will now handle:'",
        "  echo '  - ECS agent setup and configuration'",
        "  echo '  - CloudWatch Agent installation and configuration'",
        "fi",
        "",
        "echo '========================================='",
        "echo '✓ SSM bootstrap completed!'",
        "echo 'SSM State Manager will handle remaining setup'",
        "echo 'Timestamp:' $(date)",
        "echo 'Log file: /var/log/user-data.log'",
        "echo '========================================='"
      );
    }
    // Default instance type
    const instanceType =
      props.instanceType ||
      ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO);

    // Default machine image - ECS-Optimized Amazon Linux 2023
    // This AMI includes Docker/container runtime + ECS agent (required for EC2 instances to register to ECS).
    const machineImage =
      props.machineImage || ecs.EcsOptimizedImage.amazonLinux2023();

    // Default block devices
    // Note: ECS-optimized AMI snapshots require at least 30GB, so default to 30GB
    const blockDevices = props.blockDevices || [
      {
        deviceName: "/dev/xvda",
        volume: ec2.BlockDeviceVolume.ebs(30, {
          volumeType: ec2.EbsDeviceVolumeType.GP3,
          encrypted: true,
          deleteOnTermination: true,
        }),
      },
    ];

    // Resolve key pair: prefer keyPair over keyName (for backward compatibility)
    const keyPair =
      props.keyPair ||
      (props.keyName
        ? ec2.KeyPair.fromKeyPairName(this, "KeyPair", props.keyName)
        : undefined);

    // Create the launch template
    // NOTE: We pass role (not instanceProfile) - CDK will create instance profile automatically
    // But we also created instanceProfile explicitly above to ensure it exists
    this.launchTemplate = new ec2.LaunchTemplate(this, "LaunchTemplate", {
      launchTemplateName: `${cdk.Stack.of(this).stackName}-template`,
      instanceType,
      machineImage,
      userData,
      role: this.role, // CDK will create instance profile automatically from this role
      ...(props.securityGroups && props.securityGroups.length > 0
        ? {
            securityGroups: [this.securityGroup, ...props.securityGroups],
          }
        : { securityGroup: this.securityGroup }),
      ...(keyPair ? { keyPair } : {}),
      detailedMonitoring: props.enableMonitoring ?? true,
      associatePublicIpAddress: props.associatePublicIpAddress ?? false,
      blockDevices,
      requireImdsv2: true, // Security best practice
      httpTokens: ec2.LaunchTemplateHttpTokens.REQUIRED, // IMDSv2 required
    });

    // CDK automatically compresses user data if it exceeds 16KB using gzip compression
    // and multi-part MIME format. No explicit configuration needed - CDK handles this.
    // The user data will be base64 encoded and gzip compressed automatically.

    // Explicitly enforce IMDSv2 requirement via CloudFormation property override
    // This ensures the setting is applied correctly in the generated template
    // Even though we set requireImdsv2 and httpTokens, the override guarantees it works
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

    // CRITICAL FIX: Explicitly set security groups in NetworkInterfaces
    // When multiple security groups are provided, they must be in NetworkInterfaces
    // Otherwise, AWS may fall back to the default VPC security group
    if (props.securityGroups && props.securityGroups.length > 0) {
      const allSecurityGroups = [this.securityGroup, ...props.securityGroups];
      cfnLaunchTemplate.addPropertyOverride(
        "LaunchTemplateData.NetworkInterfaces",
        [
          {
            DeviceIndex: 0,
            Groups: allSecurityGroups.map((sg) => sg.securityGroupId),
            AssociatePublicIpAddress: props.associatePublicIpAddress ?? false,
          },
        ]
      );
    } else {
      // For single security group, also explicitly set it in NetworkInterfaces to be safe
      cfnLaunchTemplate.addPropertyOverride(
        "LaunchTemplateData.NetworkInterfaces",
        [
          {
            DeviceIndex: 0,
            Groups: [this.securityGroup.securityGroupId],
            AssociatePublicIpAddress: props.associatePublicIpAddress ?? false,
          },
        ]
      );
    }

    // CRITICAL: Explicitly set IamInstanceProfile using our instance profile
    // We create the instance profile explicitly above, and now we reference it
    // This ensures it's set even when we override NetworkInterfaces
    const cfnInstanceProfile = instanceProfile.node
      .defaultChild as iam.CfnInstanceProfile;
    // Use the instance profile's ARN - this is the most reliable way
    // The ARN will be resolved at CloudFormation deployment time
    cfnLaunchTemplate.addPropertyOverride(
      "LaunchTemplateData.IamInstanceProfile",
      {
        Arn: cfnInstanceProfile.getAtt("Arn"),
      }
    );

    // Tag launch template (tags will propagate to instances via ASG)
    // Project-agnostic tagging: uses project name if provided
    Tags.of(this.launchTemplate).add("Environment", props.envName);
    if (props.projectName) {
      Tags.of(this.launchTemplate).add("Project", props.projectName);
    }
    // Service tag is optional - only add if project name is provided
    // This allows projects to use EC2 service discovery if needed
    if (props.projectName) {
      Tags.of(this.launchTemplate).add("Service", props.projectName);
    }
    Tags.of(this.launchTemplate).add("ManagedBy", "CDK");

    // Note: Outputs are created at the stack level, not here
    // to avoid duplicate outputs and maintain consistency
  }
  /**
   * Add custom security group ingress rules
   */
  public addIngressRule(
    peer: ec2.IPeer,
    connection: ec2.Port,
    description?: string
  ): void {
    this.securityGroup.addIngressRule(peer, connection, description);
  }
  /**
   * Grant additional IAM permissions to the instance role
   */
  public grantPermissions(policy: iam.PolicyStatement): void {
    this.role.addToPolicy(policy);
  }
}
// ============================================================================
// LAUNCH TEMPLATE STACK
// ============================================================================

export interface LaunchTemplateStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
  envName: string;
  projectName?: string; // Project name for resource naming and tagging
  keyPairName?: string;
  instanceType?: ec2.InstanceType; // Optional: override default instance type
  enableMonitoring?: boolean; // Optional: enable detailed monitoring
}

export class LaunchTemplateStack extends cdk.Stack {
  public readonly launchTemplate: ec2.LaunchTemplate;

  constructor(scope: Construct, id: string, props: LaunchTemplateStackProps) {
    super(scope, id, props);

    const {
      vpc,
      envName,
      projectName,
      keyPairName,
      instanceType,
      enableMonitoring = true,
    } = props;

    // Create ECS-compatible user data
    // Project-agnostic: Uses project name for cluster naming if provided
    const clusterName = projectName
      ? `${envName}-${projectName}-cluster`
      : `${envName}-cluster`;

    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      "#!/bin/bash",
      // ECS configuration - CRITICAL for ECS cluster integration
      // Project-agnostic cluster naming
      `echo ECS_CLUSTER=${clusterName} >> /etc/ecs/ecs.config`,
      "echo ECS_ENABLE_CONTAINER_METADATA=true >> /etc/ecs/ecs.config",
      "echo ECS_ENABLE_TASK_IAM_ROLE=true >> /etc/ecs/ecs.config",

      // System updates and ECS agent
      "yum update -y",
      "yum install -y amazon-cloudwatch-agent",
      "systemctl enable ecs",
      "systemctl start ecs",

      // Custom application setup (optional)
      // Note: Project-specific setup (e.g., Node Exporter for monitoring)
      // should be handled by ECS task definitions or SSM State Manager
      'echo "ECS-compatible launch template initialized"'
    );

    // Create ECS-compatible IAM role
    const ecsInstanceRole = new cdk.aws_iam.Role(this, "EcsInstanceRole", {
      assumedBy: new cdk.aws_iam.ServicePrincipal("ec2.amazonaws.com"),
      managedPolicies: [
        cdk.aws_iam.ManagedPolicy.fromAwsManagedPolicyName(
          "AmazonSSMManagedInstanceCore"
        ),
        cdk.aws_iam.ManagedPolicy.fromAwsManagedPolicyName(
          "CloudWatchAgentServerPolicy"
        ),
        cdk.aws_iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AmazonEC2ContainerServiceforEC2Role"
        ),
      ],
    });

    // Create the launch template construct with ECS-optimized settings
    // Project-agnostic: Instance type can be overridden via props
    const launchTemplateConstruct = new LaunchTemplateConstruct(
      this,
      "EcsLaunchTemplate",
      {
        vpc,
        envName,
        projectName: projectName, // Pass project name for tagging
        instanceType:
          instanceType ||
          ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
        // Using Amazon Linux 2023 ECS-optimized AMI (Amazon Linux 2 reaches EOL June 30, 2026)
        machineImage: cdk.aws_ecs.EcsOptimizedImage.amazonLinux2023(),
        ...(keyPairName
          ? {
              keyPair: ec2.KeyPair.fromKeyPairName(
                this,
                "KeyPair",
                keyPairName
              ),
            }
          : {}),
        userData,
        role: ecsInstanceRole, // Use ECS-compatible role
        enableMonitoring: enableMonitoring,
        associatePublicIpAddress: false, // Use private subnets
        blockDevices: [
          {
            deviceName: "/dev/xvda",
            volume: ec2.BlockDeviceVolume.ebs(30, {
              volumeType: ec2.EbsDeviceVolumeType.GP3,
              encrypted: true,
              deleteOnTermination: true,
            }),
          },
        ],
      }
    );
    this.launchTemplate = launchTemplateConstruct.launchTemplate;

    // ========================================================================
    // CLOUDFORMATION OUTPUTS
    // ========================================================================
    // Project-agnostic export naming: includes project name if provided
    const exportPrefix = projectName
      ? `${envName}-${projectName}`
      : `${envName}`;

    new cdk.CfnOutput(this, "LaunchTemplateId", {
      value: this.launchTemplate.launchTemplateId ?? "",
      description: "Launch Template ID",
      exportName: `${exportPrefix}-launch-template-id`,
    });

    new cdk.CfnOutput(this, "LaunchTemplateName", {
      value:
        this.launchTemplate.launchTemplateName || `${this.stackName}-template`,
      description: "Launch Template Name",
      exportName: `${exportPrefix}-launch-template-name`,
    });

    new cdk.CfnOutput(this, "SecurityGroupId", {
      value: launchTemplateConstruct.securityGroup.securityGroupId,
      description: "Launch Template Security Group ID",
      exportName: `${exportPrefix}-launch-template-sg-id`,
    });

    new cdk.CfnOutput(this, "InstanceRoleArn", {
      value: launchTemplateConstruct.role.roleArn,
      description: "EC2 Instance IAM Role ARN",
      exportName: `${exportPrefix}-launch-template-role-arn`,
    });

    // ========================================================================
    // CDK NAG SUPPRESSIONS
    // ========================================================================
    // Apply centralized CDK Nag suppressions using SuppressionManager
    SuppressionManager.applyToStack(this, "ComputeStack", envName);

    // ========================================================================
    // RESOURCE TAGGING
    // ========================================================================
    // Project-agnostic tagging: includes project name if provided
    cdk.Tags.of(this).add("Stack", "LaunchTemplate");
    if (projectName) {
      cdk.Tags.of(this).add("Project", projectName);
    }
    cdk.Tags.of(this).add("Environment", envName);
    cdk.Tags.of(this).add("ManagedBy", "CDK");
  }
}
