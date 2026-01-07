/** @format */

import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as logs from "aws-cdk-lib/aws-logs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as ssm from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";

// ============================================================================
// INTERFACES AND TYPES
// ============================================================================

/**
 * Subnet configuration interface for VPC subnet creation
 */
export interface SubnetConfiguration {
  name: string;
  subnetType: ec2.SubnetType;
  cidrMask: number;
  mapPublicIpOnLaunch?: boolean;
}

/**
 * Properties for VPC Flow Logs construct
 */
export interface VpcFlowLogsConstructProps {
  vpc: ec2.IVpc;
  envName: string;
  projectName?: string; // Project name for log group naming
  trafficType?: ec2.FlowLogTrafficType;
  logGroupName?: string;
  retentionDays?: number;
}

/**
 * Properties for VPC construct
 */
export interface VpcConstructProps {
  envName: string;
  projectName?: string; // Project name for resource naming and tagging
  vpcName?: string;
  cidr?: string;
  maxAzs?: number;
  natGateways?: number;
  subnetConfiguration?: SubnetConfiguration[];
  enableDnsHostnames?: boolean;
  enableDnsSupport?: boolean;
}

/**
 * Properties for NetworkingStack
 */
export interface NetworkingStackProps extends cdk.StackProps {
  envName: string;
  projectName?: string; // Project name for resource naming and tagging
  vpcCidr?: string;
  maxAzs?: number;
  natGateways?: number;
  enableVpcFlowLogs?: boolean;
  enableVpcEndpoints?: boolean;
}

// ============================================================================
// SUBNET CONFIGURATION HELPER
// ============================================================================

/**
 * Helper class for creating standard subnet configurations
 *
 * Provides factory methods for common subnet patterns used in VPC creation.
 * Supports public, private, and isolated subnet types with configurable CIDR masks.
 */
export class SubnetConfigurationHelper {
  /**
   * Create a standard public subnet configuration
   *
   * Public subnets have direct internet access via Internet Gateway
   * and automatically assign public IP addresses to launched instances.
   *
   * @param cidrMask - CIDR mask for subnet (default: 24)
   * @returns Subnet configuration for public subnet
   */
  static publicSubnet(cidrMask: number = 24): SubnetConfiguration {
    return {
      name: "Public",
      subnetType: ec2.SubnetType.PUBLIC,
      cidrMask,
      mapPublicIpOnLaunch: true,
    };
  }

  /**
   * Create a standard private subnet configuration with NAT
   *
   * Private subnets have internet access via NAT Gateway but instances
   * do not receive public IP addresses. Suitable for application servers
   * that need outbound internet access but should not be directly accessible.
   *
   * @param cidrMask - CIDR mask for subnet (default: 24)
   * @returns Subnet configuration for private subnet with egress
   */
  static privateSubnet(cidrMask: number = 24): SubnetConfiguration {
    return {
      name: "Private",
      subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      cidrMask,
    };
  }

  /**
   * Create an isolated subnet configuration (no internet access)
   *
   * Isolated subnets have no internet gateway or NAT gateway access.
   * Suitable for databases and other resources that should not have
   * any internet connectivity for security purposes.
   *
   * @param cidrMask - CIDR mask for subnet (default: 24)
   * @returns Subnet configuration for isolated subnet
   */
  static isolatedSubnet(cidrMask: number = 24): SubnetConfiguration {
    return {
      name: "Isolated",
      subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      cidrMask,
    };
  }

  /**
   * Create a standard 3-tier subnet configuration
   *
   * Returns public, private, and isolated subnet configurations.
   * Useful for applications requiring multiple security tiers.
   *
   * @returns Array of subnet configurations for 3-tier architecture
   */
  static threeTierConfiguration(): SubnetConfiguration[] {
    return [
      this.publicSubnet(24),
      this.privateSubnet(24),
      this.isolatedSubnet(24),
    ];
  }

  /**
   * Create a simple 2-tier subnet configuration (public + private)
   *
   * Most common configuration for standard web applications.
   * Public subnets for load balancers, private subnets for application servers.
   *
   * @returns Array of subnet configurations for 2-tier architecture
   */
  static twoTierConfiguration(): SubnetConfiguration[] {
    return [this.publicSubnet(24), this.privateSubnet(24)];
  }
}

// ============================================================================
// VPC CONSTRUCT
// ============================================================================

/**
 * Enhanced VPC Construct with additional features
 *
 * This construct extends the basic VPC with:
 * - Custom CIDR configuration
 * - Flexible subnet configuration
 * - DNS settings
 * - Better tagging
 *
 * Features:
 * - Configurable CIDR block
 * - Multiple availability zones
 * - Optional NAT gateways
 * - Custom subnet configurations
 * - DNS hostname and support
 * - Automatic tagging
 */
export class VpcConstruct extends Construct {
  public readonly vpc: ec2.Vpc;
  public readonly publicSubnets: ec2.ISubnet[];
  public readonly privateSubnets: ec2.ISubnet[];
  public readonly isolatedSubnets: ec2.ISubnet[];

  constructor(scope: Construct, id: string, props: VpcConstructProps) {
    super(scope, id);

    const {
      envName,
      projectName,
      vpcName,
      cidr = "10.0.0.0/16",
      maxAzs = 2,
      natGateways = 0,
      subnetConfiguration = [
        {
          name: "Public",
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
          mapPublicIpOnLaunch: true,
        },
        {
          name: "Private",
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        },
      ],
      enableDnsHostnames = true,
      enableDnsSupport = true,
    } = props;

    // Project-agnostic VPC naming: includes project name if provided
    const finalVpcName =
      vpcName ||
      (projectName ? `${envName}-${projectName}-vpc` : `${envName}-vpc`);

    // Create VPC with configured settings
    // Cost Optimisation: Using minimal NAT gateways (0 for non-production)
    // to reduce costs. Production environments should use at least 1 NAT gateway
    this.vpc = new ec2.Vpc(this, "Vpc", {
      vpcName: finalVpcName,
      ipAddresses: ec2.IpAddresses.cidr(cidr),
      maxAzs,
      natGateways,
      subnetConfiguration,
      enableDnsHostnames,
      enableDnsSupport,
      // Restrict default security group - prevents unrestricted access
      restrictDefaultSecurityGroup: true,
    });

    // Store subnet references for easy access
    this.publicSubnets = this.vpc.publicSubnets;
    this.privateSubnets = this.vpc.privateSubnets;
    this.isolatedSubnets = this.vpc.isolatedSubnets;

    // Add standard tags for resource management (project-agnostic)
    cdk.Tags.of(this.vpc).add("Name", finalVpcName);
    cdk.Tags.of(this.vpc).add("Environment", envName);
    if (projectName) {
      cdk.Tags.of(this.vpc).add("Project", projectName);
    }
    cdk.Tags.of(this.vpc).add("ManagedBy", "CDK");
  }

  /**
   * Get VPC ID
   */
  public get vpcId(): string {
    return this.vpc.vpcId;
  }

  /**
   * Get VPC CIDR block
   */
  public get vpcCidrBlock(): string {
    return this.vpc.vpcCidrBlock;
  }

  /**
   * Get availability zones used by the VPC
   */
  public get availabilityZones(): string[] {
    return this.vpc.availabilityZones;
  }

  /**
   * Add interface VPC endpoint
   *
   * Interface endpoints provide private connectivity to AWS services
   * using PrivateLink. They have hourly costs but provide better security
   * and performance than public endpoints.
   *
   * @param id - Logical ID for the endpoint
   * @param service - VPC endpoint service to connect to
   * @param subnets - Subnet selection for endpoint placement
   * @returns Created interface VPC endpoint
   */
  public addInterfaceEndpoint(
    id: string,
    service: ec2.IInterfaceVpcEndpointService,
    subnets?: ec2.SubnetSelection
  ): ec2.InterfaceVpcEndpoint {
    return this.vpc.addInterfaceEndpoint(id, {
      service,
      subnets,
    });
  }

  /**
   * Add gateway VPC endpoint
   *
   * Gateway endpoints are free and provide private connectivity to
   * S3 and DynamoDB. They are implemented as route table entries
   * rather than network interfaces.
   *
   * @param id - Logical ID for the endpoint
   * @param service - Gateway endpoint service (S3 or DynamoDB)
   * @param subnets - Subnet selection for endpoint routes
   * @returns Created gateway VPC endpoint
   */
  public addGatewayEndpoint(
    id: string,
    service: ec2.IGatewayVpcEndpointService,
    subnets?: ec2.SubnetSelection[]
  ): ec2.GatewayVpcEndpoint {
    return this.vpc.addGatewayEndpoint(id, {
      service,
      subnets,
    });
  }
}

// ============================================================================
// VPC FLOW LOGS CONSTRUCT
// ============================================================================

/**
 * VPC Flow Logs Construct
 *
 * Creates VPC Flow Logs for network traffic monitoring and security analysis.
 * Flow logs capture information about IP traffic going to and from network
 * interfaces in the VPC.
 *
 * Features:
 * - Configurable traffic type (ALL, ACCEPT, REJECT)
 * - CloudWatch Logs integration
 * - Configurable log retention
 * - Automatic IAM role creation
 *
 * CDK Nag Compliance:
 * - AwsSolutions-VPC7: VPC Flow Logs enabled for security monitoring
 */
export class VpcFlowLogsConstruct extends Construct {
  public readonly logGroup: logs.LogGroup;
  public readonly logGroupName: string;

  constructor(scope: Construct, id: string, props: VpcFlowLogsConstructProps) {
    super(scope, id);

    const {
      vpc,
      envName,
      projectName,
      trafficType = ec2.FlowLogTrafficType.ALL,
      logGroupName,
      retentionDays = 7,
    } = props;

    // Project-agnostic log group naming: includes project name if provided
    const finalLogGroupName =
      logGroupName ||
      (projectName
        ? `/aws/vpc/flowlogs/${envName}-${projectName}`
        : `/aws/vpc/flowlogs/${envName}`);

    // Map retention days to RetentionDays enum
    // Maps common retention periods to CDK RetentionDays enum values
    const getRetentionDays = (days: number): logs.RetentionDays => {
      if (days <= 1) return logs.RetentionDays.ONE_DAY;
      if (days <= 3) return logs.RetentionDays.THREE_DAYS;
      if (days <= 7) return logs.RetentionDays.ONE_WEEK;
      if (days <= 14) return logs.RetentionDays.TWO_WEEKS;
      if (days <= 30) return logs.RetentionDays.ONE_MONTH;
      if (days <= 60) return logs.RetentionDays.TWO_MONTHS;
      if (days <= 90) return logs.RetentionDays.THREE_MONTHS;
      if (days <= 120) return logs.RetentionDays.FOUR_MONTHS;
      if (days <= 150) return logs.RetentionDays.FIVE_MONTHS;
      if (days <= 180) return logs.RetentionDays.SIX_MONTHS;
      if (days <= 365) return logs.RetentionDays.ONE_YEAR;
      if (days <= 400) return logs.RetentionDays.THIRTEEN_MONTHS;
      if (days <= 545) return logs.RetentionDays.EIGHTEEN_MONTHS;
      if (days <= 731) return logs.RetentionDays.TWO_YEARS;
      if (days <= 1827) return logs.RetentionDays.FIVE_YEARS;
      return logs.RetentionDays.INFINITE;
    };

    // Create CloudWatch Log Group for flow logs
    // Cost Optimisation: Configurable retention balances cost with compliance requirements
    // Default 7-day retention for non-production, increase for production environments
    this.logGroup = new logs.LogGroup(this, "FlowLogsLogGroup", {
      logGroupName: finalLogGroupName,
      retention: getRetentionDays(retentionDays),
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.logGroupName = this.logGroup.logGroupName;

    // Create IAM role for VPC Flow Logs
    // Flow logs service needs permissions to write to CloudWatch Logs
    const flowLogsRole = new iam.Role(this, "FlowLogsRole", {
      assumedBy: new iam.ServicePrincipal("vpc-flow-logs.amazonaws.com"),
      description: `Role for VPC Flow Logs in ${envName} environment`,
    });

    // Grant permissions to write to CloudWatch Logs
    this.logGroup.grantWrite(flowLogsRole);

    // Create VPC Flow Log
    new ec2.FlowLog(this, "VpcFlowLog", {
      resourceType: ec2.FlowLogResourceType.fromVpc(vpc),
      destination: ec2.FlowLogDestination.toCloudWatchLogs(
        this.logGroup,
        flowLogsRole
      ),
      trafficType,
    });

    // Add tags for resource management (project-agnostic)
    cdk.Tags.of(this).add("Environment", envName);
    if (projectName) {
      cdk.Tags.of(this).add("Project", projectName);
    }
    cdk.Tags.of(this).add("ManagedBy", "CDK");
  }
}

// ============================================================================
// NETWORKING STACK
// ============================================================================

/**
 * NetworkingStack - Provisions core networking infrastructure
 *
 * This stack creates:
 * - VPC with public and private subnets across 2 AZs
 * - NAT Gateway for private subnet internet access (optional)
 * - VPC Flow Logs for network traffic monitoring (optional)
 * - VPC endpoints for AWS services (S3, DynamoDB - cost-optimised)
 * - CloudFormation exports for cross-stack references
 * - SSM parameters for cross-account discovery
 *
 * Dependencies:
 * - None (foundational stack)
 *
 * Exported Resources:
 * - VPC ID (export: `${envName}-vpc-id`)
 * - VPC CIDR (export: `${envName}-vpc-cidr`)
 * - Availability Zones (export: `${envName}-azs`)
 * - Public Subnet IDs (export: `${envName}-public-subnet-{n}-id`)
 * - Private Subnet IDs (export: `${envName}-private-subnet-{n}-id`)
 * - Flow Logs Log Group (export: `${envName}-flow-logs-log-group`)
 *
 * SSM Parameters:
 * - `/networking/${envName}/vpc-id` - VPC ID for cross-stack/cross-account access
 * - `/networking/${envName}/vpc-cidr` - VPC CIDR for network planning
 *
 * Cost Optimisation:
 * - Single NAT Gateway (not HA for non-production) - saves ~£30/month
 * - Gateway endpoints only (S3, DynamoDB - free) - avoids interface endpoint costs
 * - Flow logs with 7-day retention - balances compliance with cost
 *
 * CDK Nag Compliance:
 * - AwsSolutions-VPC7: VPC Flow Logs enabled (when enableVpcFlowLogs=true)
 */
export class NetworkingStack extends cdk.Stack {
  public readonly vpc: ec2.IVpc;
  public readonly vpcConstruct: VpcConstruct;
  public readonly flowLogs?: VpcFlowLogsConstruct;

  constructor(scope: Construct, id: string, props: NetworkingStackProps) {
    super(scope, id, props);

    const {
      envName,
      projectName,
      vpcCidr = "10.0.0.0/16",
      maxAzs = 2,
      natGateways = 0,
      enableVpcFlowLogs = true,
      enableVpcEndpoints = true,
    } = props;

    // ========================================================================
    // 1. CREATE VPC
    // ========================================================================
    // Project-agnostic VPC naming: includes project name if provided
    this.vpcConstruct = new VpcConstruct(this, "Vpc", {
      envName,
      projectName: projectName, // Pass project name for VPC naming and tagging
      vpcName: projectName
        ? `${envName}-${projectName}-vpc`
        : `${envName}-vpc`,
      cidr: vpcCidr,
      maxAzs,
      natGateways,
      subnetConfiguration: SubnetConfigurationHelper.twoTierConfiguration(),
      enableDnsHostnames: true,
      enableDnsSupport: true,
    });

    this.vpc = this.vpcConstruct.vpc;

    // ========================================================================
    // 2. ENABLE VPC FLOW LOGS (CDK Nag: AwsSolutions-VPC7)
    // ========================================================================
    // Flow logs enable network traffic monitoring for security and troubleshooting
    // Required for compliance in many environments
    if (enableVpcFlowLogs) {
      this.flowLogs = new VpcFlowLogsConstruct(this, "FlowLogs", {
        vpc: this.vpc,
        envName,
        projectName: projectName, // Pass project name for log group naming
        trafficType: ec2.FlowLogTrafficType.ALL,
      });
    }

    // ========================================================================
    // 3. ADD VPC ENDPOINTS (Optional - for private AWS service access)
    // ========================================================================
    // Gateway endpoints are free and provide private connectivity to S3 and DynamoDB
    // Interface endpoints have hourly costs - only enable if specifically needed
    if (enableVpcEndpoints) {
      // S3 Gateway Endpoint (free) - enables private S3 access without internet gateway
      this.vpc.addGatewayEndpoint("S3Endpoint", {
        service: ec2.GatewayVpcEndpointAwsService.S3,
      });

      // DynamoDB Gateway Endpoint (free) - enables private DynamoDB access
      this.vpc.addGatewayEndpoint("DynamoDbEndpoint", {
        service: ec2.GatewayVpcEndpointAwsService.DYNAMODB,
      });

      // ECR Interface Endpoints (costs ~£7/month per endpoint)
      // Uncomment if private ECR access is required without NAT Gateway
      // this.vpc.addInterfaceEndpoint("EcrApiEndpoint", {
      //   service: ec2.InterfaceVpcEndpointAwsService.ECR,
      // });

      // this.vpc.addInterfaceEndpoint("EcrDockerEndpoint", {
      //   service: ec2.InterfaceVpcEndpointAwsService.ECR_DOCKER,
      // });
    }

    // ========================================================================
    // 4. SSM PARAMETERS (for cross-stack/cross-account discovery)
    // ========================================================================
    // Use SSM Parameter Store instead of CloudFormation exports to avoid
    // circular dependencies when peering VPCs across accounts
    // Project-agnostic parameter paths: include project name if provided
    // Note: For shared networking, use `/networking/${envName}/vpc-id`
    // For project-specific networking, use `/networking/${projectName}/${envName}/vpc-id`
    const ssmPrefix = projectName
      ? `/networking/${projectName}/${envName}`
      : `/networking/${envName}`;

    new ssm.StringParameter(this, "VpcIdParameter", {
      parameterName: `${ssmPrefix}/vpc-id`,
      stringValue: this.vpc.vpcId,
      description: `VPC ID for ${projectName || "shared"} networking in ${envName} environment`,
      tier: ssm.ParameterTier.STANDARD,
    });

    new ssm.StringParameter(this, "VpcCidrParameter", {
      parameterName: `${ssmPrefix}/vpc-cidr`,
      stringValue: this.vpc.vpcCidrBlock,
      description: `VPC CIDR for ${projectName || "shared"} networking in ${envName} environment`,
      tier: ssm.ParameterTier.STANDARD,
    });

    // ========================================================================
    // 5. CLOUDFORMATION OUTPUTS
    // ========================================================================
    // CloudFormation exports enable cross-stack references within the same account
    // For cross-account access, use SSM parameters instead
    // Project-agnostic export naming: includes project name if provided
    const exportPrefix = projectName ? `${envName}-${projectName}` : `${envName}`;

    new cdk.CfnOutput(this, "VpcId", {
      value: this.vpc.vpcId,
      description: "VPC ID",
      exportName: `${exportPrefix}-vpc-id`,
    });

    new cdk.CfnOutput(this, "VpcCidr", {
      value: this.vpc.vpcCidrBlock,
      description: "VPC CIDR Block",
      exportName: `${exportPrefix}-vpc-cidr`,
    });

    new cdk.CfnOutput(this, "AvailabilityZones", {
      value: this.vpc.availabilityZones.join(","),
      description: "Availability Zones",
      exportName: `${exportPrefix}-azs`,
    });

    // Public subnet outputs - exported for use by load balancers and bastion hosts
    this.vpcConstruct.publicSubnets.forEach(
      (subnet: ec2.ISubnet, index: number) => {
        new cdk.CfnOutput(this, `PublicSubnet${index + 1}Id`, {
          value: subnet.subnetId,
          description: `Public Subnet ${index + 1} ID`,
          exportName: `${exportPrefix}-public-subnet-${index + 1}-id`,
        });
      }
    );

    // Private subnet outputs - exported for use by application servers and databases
    this.vpcConstruct.privateSubnets.forEach(
      (subnet: ec2.ISubnet, index: number) => {
        new cdk.CfnOutput(this, `PrivateSubnet${index + 1}Id`, {
          value: subnet.subnetId,
          description: `Private Subnet ${index + 1} ID`,
          exportName: `${exportPrefix}-private-subnet-${index + 1}-id`,
        });
      }
    );

    // Flow logs output - exported for monitoring and compliance dashboards
    if (this.flowLogs) {
      new cdk.CfnOutput(this, "FlowLogsLogGroup", {
        value: this.flowLogs.logGroup.logGroupName,
        description: "VPC Flow Logs CloudWatch Log Group",
        exportName: `${exportPrefix}-flow-logs-log-group`,
      });
    }

    // ========================================================================
    // 6. RESOURCE TAGGING
    // ========================================================================
    // Consistent tagging enables resource management, cost allocation, and automation
    // Project-agnostic tagging: includes project name if provided
    cdk.Tags.of(this).add("Stack", "Networking");
    if (projectName) {
      cdk.Tags.of(this).add("Project", projectName);
    }
    cdk.Tags.of(this).add("Environment", envName);
    cdk.Tags.of(this).add("ManagedBy", "CDK");
  }

  /**
   * Get public subnets
   *
   * Public subnets have direct internet access via Internet Gateway.
   * Suitable for load balancers, NAT gateways, and bastion hosts.
   */
  public get publicSubnets(): ec2.ISubnet[] {
    return this.vpcConstruct.publicSubnets;
  }

  /**
   * Get private subnets
   *
   * Private subnets have internet access via NAT Gateway but instances
   * do not receive public IP addresses. Suitable for application servers.
   */
  public get privateSubnets(): ec2.ISubnet[] {
    return this.vpcConstruct.privateSubnets;
  }

  /**
   * Get isolated subnets
   *
   * Isolated subnets have no internet gateway or NAT gateway access.
   * Suitable for databases and other resources requiring maximum security.
   */
  public get isolatedSubnets(): ec2.ISubnet[] {
    return this.vpcConstruct.isolatedSubnets;
  }
}
