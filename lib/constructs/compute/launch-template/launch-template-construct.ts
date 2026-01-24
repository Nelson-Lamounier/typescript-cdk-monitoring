/** @format */

import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import type * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

// Import types
import type { LaunchTemplateConstructProps } from "../../../shared/types";
// Import helpers
import { UserDataConstruct } from "../ec2";
import { Ec2InstanceRole } from "../../iam/ec2-instance-role";

/**
 * Launch Template Construct
 *
 * Creates EC2 launch templates with flexible user data strategies:
 *
 * **User Data Strategies:**
 *
 * 1. **Minimal (SSM Bootstrap)** - RECOMMENDED for production
 *    - Installs SSM agent only
 *    - Fast boot (~30 seconds)
 *    - Rest handled by SSM State Manager
 *    - Use: `userDataStrategy: 'minimal'`
 *
 * 2. **Comprehensive (All-in-One)** - For standalone instances
 *    - Installs everything in user data
 *    - Slower boot (3-5 minutes)
 *    - No SSM dependency
 *    - Use: `userDataStrategy: 'comprehensive'`
 *
 * 3. **Custom** - Full control
 *    - Provide your own userData
 *    - Use: `userData: ec2.UserData.forLinux()`
 *
 * @example
 * ```typescript
 * // Minimal user data (SSM approach)
 * const lt = new LaunchTemplateConstruct(this, 'LT', {
 *   vpc: myVpc,
 *   envName: 'production',
 *   userDataStrategy: 'minimal',
 *   ecsConfig: {
 *     clusterName: 'my-cluster',
 *   },
 * });
 *
 * // Comprehensive user data (standalone)
 * const lt = new LaunchTemplateConstruct(this, 'LT', {
 *   vpc: myVpc,
 *   envName: 'dev',
 *   userDataStrategy: 'comprehensive',
 *   monitoring: {
 *     installNodeExporter: true,
 *   },
 * });
 *
 * // Custom user data
 * const customUserData = ec2.UserData.forLinux();
 * customUserData.addCommands('echo "Hello World"');
 *
 * const lt = new LaunchTemplateConstruct(this, 'LT', {
 *   vpc: myVpc,
 *   envName: 'dev',
 *   userData: customUserData,
 * });
 * ```
 */
export class LaunchTemplateConstruct extends Construct {
  public readonly launchTemplate: ec2.LaunchTemplate;
  public readonly securityGroup: ec2.SecurityGroup;
  public readonly role: Ec2InstanceRole["role"];

  constructor(
    scope: Construct,
    id: string,
    props: LaunchTemplateConstructProps
  ) {
    super(scope, id);

    // Validate inputs
    this.validateInputs(props);

    // Create security group
    this.securityGroup = this.createSecurityGroup(props);

    // Create IAM role
    this.role = this.createInstanceRole(props);

    // Build user data based on strategy
    const userData = this.buildUserData(props);

    // Create launch template
    this.launchTemplate = this.createLaunchTemplate(props, userData);

    // Apply tags
    this.applyTags(props);

    // Create outputs
    this.createOutputs(props.envName);
  }

  /**
   * Validate inputs
   */
  private validateInputs(props: LaunchTemplateConstructProps): void {
    if (!props.vpc || !props.vpc.vpcId) {
      throw new Error("VPC is required and must have a valid VPC ID");
    }

    if (!props.envName || props.envName.trim().length === 0) {
      throw new Error("Environment name is required");
    }

    // Validate strategy
    if (props.userDataStrategy && props.userData) {
      throw new Error(
        "Cannot specify both userDataStrategy and userData. " +
          "Use userDataStrategy for predefined strategies, or userData for custom scripts."
      );
    }
  }

  /**
   * Create security group
   */
  private createSecurityGroup(
    props: LaunchTemplateConstructProps
  ): ec2.SecurityGroup {
    // Use custom security group if provided
    if (props.securityGroup) {
      return props.securityGroup as ec2.SecurityGroup;
    }

    const sg = new ec2.SecurityGroup(this, "SecurityGroup", {
      vpc: props.vpc,
      description: `Security group for ${props.envName} instances`,
      allowAllOutbound: false, // Least privilege
    });

    // Add required egress rules
    sg.addEgressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      "Allow HTTPS for AWS API endpoints (ECR, ECS, SSM, CloudWatch)"
    );

    sg.addEgressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.udp(123),
      "Allow NTP for time synchronization"
    );

    // Optional: HTTP for package updates (only if comprehensive strategy)
    if (props.userDataStrategy === "comprehensive") {
      sg.addEgressRule(
        ec2.Peer.anyIpv4(),
        ec2.Port.tcp(80),
        "Allow HTTP for package updates"
      );
    }

    return sg;
  }

  /**
   * Create IAM role
   */
  private createInstanceRole(
    props: LaunchTemplateConstructProps
  ): Ec2InstanceRole["role"] {
    if (props.role) {
      return props.role as Ec2InstanceRole["role"];
    }
    const roleConstruct = new Ec2InstanceRole(this, "InstanceRole", {
      envName: props.envName,
      projectName: props.projectName,
      attachEcsInstancePolicy: !!props.ecsConfig,
    });
    return roleConstruct.role;
  }

  /**
   * Build user data based on strategy
   */
  private buildUserData(props: LaunchTemplateConstructProps): ec2.UserData {
    // 1. Custom user data takes precedence
    if (props.userData) {
      return props.userData;
    }

    // 2. Strategy-based user data
    const strategy = props.userDataStrategy || "minimal"; // Default to minimal

    switch (strategy) {
      case "minimal":
        return this.buildMinimalUserData(props);

      case "comprehensive":
        return this.buildComprehensiveUserData(props);

      default:
        throw new Error(`Unknown user data strategy: ${strategy}`);
    }
  }

  /**
   * Build minimal user data (SSM bootstrap only)
   */
  private buildMinimalUserData(
    props: LaunchTemplateConstructProps
  ): ec2.UserData {
    const minimalUserData = new UserDataConstruct(this, "MinimalUserData", {
      envName: props.envName,
      clusterName: props.ecsConfig?.clusterName || "",
    });

    return minimalUserData.userData;
  }

  /**
   * Build comprehensive user data (all-in-one)
   */
  private buildComprehensiveUserData(
    props: LaunchTemplateConstructProps
  ): ec2.UserData {
    const userData = ec2.UserData.forLinux();
    const commands: string[] = [
      "#!/bin/bash",
      "set -e",
      "",
      "# Enable logging",
      "exec > >(tee /var/log/user-data.log|logger -t user-data -s 2>/dev/console) 2>&1",
      "",
      "echo '========================================='",
      `echo 'Comprehensive Setup - ${props.envName}'`,
      "echo 'Timestamp:' $(date)",
      "echo '========================================='",
      "",
      "# Choose package manager",
      "PKG_MGR=yum",
      "command -v dnf >/dev/null 2>&1 && PKG_MGR=dnf",
      "",
      "# Update system",
      "echo 'Updating system packages...'",
      "$PKG_MGR -y update",
      "",
      "# Install SSM agent",
      "echo 'Installing SSM agent...'",
      "$PKG_MGR -y install amazon-ssm-agent",
      "systemctl enable amazon-ssm-agent",
      "systemctl start amazon-ssm-agent",
    ];

    // Add ECS configuration if provided
    if (props.ecsConfig) {
      commands.push(
        "",
        "# Configure ECS",
        "echo 'Configuring ECS agent...'",
        `echo ECS_CLUSTER=${props.ecsConfig.clusterName} >> /etc/ecs/ecs.config`,
        "echo ECS_ENABLE_CONTAINER_METADATA=true >> /etc/ecs/ecs.config",
        "echo ECS_ENABLE_TASK_IAM_ROLE=true >> /etc/ecs/ecs.config",
        "systemctl enable ecs",
        "systemctl start ecs"
      );
    }

    // Add CloudWatch agent if requested
    if (props.monitoring?.installCloudWatchAgent) {
      commands.push(
        "",
        "# Install CloudWatch Agent",
        "echo 'Installing CloudWatch agent...'",
        "$PKG_MGR -y install amazon-cloudwatch-agent"
      );
    }

    // Add Node Exporter if requested
    if (props.monitoring?.installNodeExporter) {
      commands.push(
        "",
        "# Install Node Exporter",
        "echo 'Installing Node Exporter...'",
        "useradd --no-create-home --shell /bin/false node_exporter",
        "cd /tmp",
        "curl -LO https://github.com/prometheus/node_exporter/releases/download/v1.7.0/node_exporter-1.7.0.linux-amd64.tar.gz",
        "tar -xvf node_exporter-1.7.0.linux-amd64.tar.gz",
        "cp node_exporter-1.7.0.linux-amd64/node_exporter /usr/local/bin/",
        "chown node_exporter:node_exporter /usr/local/bin/node_exporter",
        "",
        "# Create systemd service",
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
        "",
        "systemctl daemon-reload",
        "systemctl enable node_exporter",
        "systemctl start node_exporter"
      );
    }

    commands.push(
      "",
      "echo '========================================='",
      "echo '✓ Comprehensive setup completed!'",
      "echo 'Timestamp:' $(date)",
      "echo '========================================='"
    );

    userData.addCommands(...commands);
    return userData;
  }

  /**
   * Create launch template
   */
  private createLaunchTemplate(
    props: LaunchTemplateConstructProps,
    userData: ec2.UserData
  ): ec2.LaunchTemplate {
    const instanceType = props.instanceType || new ec2.InstanceType("t3.micro");

    const machineImage =
      props.machineImage || ecs.EcsOptimizedImage.amazonLinux2023();

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

    // Build security groups list
    const allSecurityGroups = props.additionalSecurityGroups
      ? [this.securityGroup, ...props.additionalSecurityGroups]
      : [this.securityGroup];

    const launchTemplate = new ec2.LaunchTemplate(this, "LaunchTemplate", {
      launchTemplateName:
        props.launchTemplateName || `${cdk.Stack.of(this).stackName}-template`,
      instanceType,
      machineImage,
      userData,
      role: this.role,
      securityGroup: allSecurityGroups[0],
      keyPair: props.keyPair,
      detailedMonitoring: props.enableDetailedMonitoring ?? false,
      associatePublicIpAddress: props.associatePublicIpAddress ?? false,
      blockDevices,
      requireImdsv2: true,
      httpTokens: ec2.LaunchTemplateHttpTokens.REQUIRED,
    });

    // Apply additional security groups if needed
    if (allSecurityGroups.length > 1) {
      const cfnLt = launchTemplate.node.defaultChild as ec2.CfnLaunchTemplate;
      cfnLt.addPropertyOverride(
        "LaunchTemplateData.SecurityGroupIds",
        allSecurityGroups.map((sg) => sg.securityGroupId)
      );
    }

    return launchTemplate;
  }

  /**
   * Apply tags
   */
  private applyTags(props: LaunchTemplateConstructProps): void {
    cdk.Tags.of(this.launchTemplate).add("Environment", props.envName);
    cdk.Tags.of(this.launchTemplate).add("ManagedBy", "CDK");

    if (props.projectName) {
      cdk.Tags.of(this.launchTemplate).add("Project", props.projectName);
    }

    if (props.ecsConfig) {
      cdk.Tags.of(this.launchTemplate).add("Service", "ecs");
    }

    // Custom tags
    if (props.customTags) {
      Object.entries(props.customTags).forEach(([key, value]) => {
        cdk.Tags.of(this.launchTemplate).add(key, value);
      });
    }
  }

  /**
   * Create outputs
   */
  private createOutputs(envName: string): void {
    new cdk.CfnOutput(this, "LaunchTemplateId", {
      value: this.launchTemplate.launchTemplateId || "",
      description: "Launch Template ID",
      exportName: `${envName}-launch-template-id`,
    });
  }

  /**
   * Add ingress rule to security group
   */
  public addIngressRule(
    peer: ec2.IPeer,
    connection: ec2.Port,
    description?: string
  ): void {
    this.securityGroup.addIngressRule(peer, connection, description);
  }

  /**
   * Add egress rule to security group
   */
  public addEgressRule(
    peer: ec2.IPeer,
    connection: ec2.Port,
    description?: string
  ): void {
    this.securityGroup.addEgressRule(peer, connection, description);
  }

  /**
   * Grant additional IAM permissions
   */
  public grantPermissions(policy: iam.PolicyStatement): void {
    this.role.addToPolicy(policy);
  }
}
