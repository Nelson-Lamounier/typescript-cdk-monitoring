/** @format */

import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ssm from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";

import { VpcConstruct, VpcFlowLogsConstruct } from "../constructs/networking/vpc";
import { SubnetConfigurationHelper } from "../shared/helpers";

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
