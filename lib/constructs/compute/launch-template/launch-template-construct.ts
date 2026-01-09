/** @format */

// lib/constructs/launch-template-construct.ts
import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as iam from "aws-cdk-lib/aws-iam";
import { Tags } from "aws-cdk-lib";
import { Construct } from "constructs";

export interface LaunchTemplateConstructProps {
  vpc: ec2.IVpc;
  envName: string;
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
        "set -e",
        "",
        "# Choose package manager (AL2023 uses dnf, AL2 uses yum)",
        "PKG_MGR=yum",
        "command -v dnf >/dev/null 2>&1 && PKG_MGR=dnf",
        "$PKG_MGR -y update",
        "$PKG_MGR -y install amazon-ssm-agent amazon-cloudwatch-agent",
        "systemctl enable --now amazon-ssm-agent",

        // Install Node Exporter for Prometheus monitoring
        "useradd --no-create-home --shell /bin/false node_exporter",
        "cd /tmp",
        "curl -LO https://github.com/prometheus/node_exporter/releases/download/v1.7.0/node_exporter-1.7.0.linux-amd64.tar.gz",
        "tar -xvf node_exporter-1.7.0.linux-amd64.tar.gz",
        "cp node_exporter-1.7.0.linux-amd64/node_exporter /usr/local/bin/",
        "chown node_exporter:node_exporter /usr/local/bin/node_exporter",

        // Create systemd service for Node Exporter
        "cat <<EOF > /etc/systemd/system/node_exporter.service",
        "[Unit]",
        "Description=Node Exporter",
        "After=network.target",
        "",
        "[Service]",
        "User=node_exporter",
        "Group=node_exporter",
        "Type=simple",
        "ExecStart=/usr/local/bin/node_exporter",
        "",
        "[Install]",
        "WantedBy=multi-user.target",
        "EOF",

        "systemctl daemon-reload",
        "systemctl start node_exporter",
        "systemctl enable node_exporter",

        // Signal completion
        'echo "User data execution completed"'
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
    Tags.of(this.launchTemplate).add("Environment", props.envName);
    Tags.of(this.launchTemplate).add("Service", "monitoring"); // Required for EC2 service discovery
    Tags.of(this.launchTemplate).add("ManagedBy", "CDK");

    // Output the launch template ID
    new cdk.CfnOutput(this, "LaunchTemplateId", {
      value: this.launchTemplate.launchTemplateId ?? "",
      description: "Launch Template ID",
      exportName: `${cdk.Stack.of(this).stackName}-LaunchTemplateId`,
    });

    new cdk.CfnOutput(this, "LaunchTemplateName", {
      value:
        this.launchTemplate.launchTemplateName ||
        `${cdk.Stack.of(this).stackName}-template`,
      description: "Launch Template Name",
    });
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
