/** @format */

import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { Construct } from "constructs";

import { SuppressionManager } from "../../cdk-nag";
import { SsmParametersConstruct } from "../../constructs/config";
import { VpcConstruct } from "../../constructs/networking/vpc/vpc-construct";
import { VpcFlowLogsConstruct } from "../../constructs/networking/vpc/vpc-flow-logs-construct";
import {
  VPC_CIDR_BLOCKS,
  VPC_MAX_AZS,
  VPC_NAT_GATEWAYS,
  VPC_FLOW_LOG_TRAFFIC_TYPE,
  VPC_FLOW_LOG_RETENTION,
  NETWORKING_SSM_PREFIX,
} from "../../shared/constants/networking-constants";
import {
  SubnetConfigurationHelper,
  applyStackTags,
} from "../../shared/helpers";
import { NetworkingStackProps } from "../../shared/types";
import {
  isProductionEnvironment,
  validateEnvName,
  validateCidr,
} from "../../shared/utils";

/**
 * NetworkingStack - Foundation Layer: VPC and Network Infrastructure
 *
 * This stack creates the foundational network infrastructure for the entire account.
 * It should be deployed first and shared across all services.
 *
 * Components:
 * - VPC with configurable CIDR and availability zones
 * - Public and private subnets across multiple AZs
 * - NAT Gateways for private subnet internet access (optional)
 * - VPC Flow Logs for network traffic monitoring (optional)
 * - VPC Endpoints for AWS service access (S3, DynamoDB)
 * - Internet Gateway for public subnet internet access
 *
 * Architecture Pattern:
 * - ONE VPC per account/environment (shared across all services)
 * - Two-tier subnet design: Public (IGW) + Private (NAT)
 * - Multi-AZ for high availability
 * - Flow logs for security and troubleshooting
 * - Gateway endpoints (S3, DynamoDB) to reduce costs
 *
 * SSM Parameters Created:
 * - `/networking/${envName}/vpc-id` - VPC identifier
 * - `/networking/${envName}/vpc-cidr` - VPC CIDR block
 * - `/networking/${envName}/vpc-azs` - Availability zones (comma-separated)
 * - `/networking/${envName}/public-subnet-ids` - Public subnet IDs
 * - `/networking/${envName}/private-subnet-ids` - Private subnet IDs
 *
 * Production Recommendations:
 * - maxAzs: 2+ (high availability)
 * - natGateways: 1 (cost-optimized) or maxAzs (HA)
 * - enableVpcFlowLogs: true (security, compliance)
 * - enableVpcEndpoints: true (cost savings, performance)
 *
 * Cost Optimization:
 * - NAT Gateways: ~$32/month per gateway (set to 0 for dev)
 * - VPC Endpoints: Free for gateway endpoints (S3, DynamoDB)
 * - Flow Logs: ~$0.50 per GB ingested
 *
 * @example
 * ```typescript
 * // Development (cost-optimized)
 * const networkingStack = new NetworkingStack(app, 'dev-Networking', {
 *   envName: 'dev',
 *   vpcCidr: '10.0.0.0/16',
 *   maxAzs: 2,
 *   natGateways: 0, // No internet access for private subnets
 * });
 *
 * // Production (high availability)
 * const networkingStack = new NetworkingStack(app, 'prod-Networking', {
 *   envName: 'production',
 *   vpcCidr: '10.2.0.0/16',
 *   maxAzs: 2,
 *   natGateways: 2, // NAT gateway per AZ for HA
 *   enableVpcFlowLogs: true,
 *   enableVpcEndpoints: true,
 * });
 * ```
 */
export class NetworkingStack extends cdk.Stack {
  public readonly vpc: ec2.IVpc;
  public readonly vpcConstruct: VpcConstruct;
  public readonly flowLogs?: VpcFlowLogsConstruct;
  public readonly ssmParameters?: SsmParametersConstruct;

  constructor(scope: Construct, id: string, props: NetworkingStackProps) {
    super(scope, id, props);

    // ========================================================================
    // VALIDATION
    // ========================================================================
    validateEnvName(props.envName);

    // Environment-aware defaults
    const isProduction = isProductionEnvironment(props.envName);
    const isPipeline = props.envName.toLowerCase().includes("pipeline");

    // VPC CIDR defaults
    let defaultCidr: string = VPC_CIDR_BLOCKS.DEV;
    if (isPipeline) {
      defaultCidr = VPC_CIDR_BLOCKS.PIPELINE;
    } else if (isProduction) {
      defaultCidr = VPC_CIDR_BLOCKS.PRODUCTION;
    } else if (props.envName.toLowerCase().includes("staging")) {
      defaultCidr = VPC_CIDR_BLOCKS.STAGING;
    }

    const vpcCidr = props.vpcCidr ?? defaultCidr;
    validateCidr(vpcCidr);

    const maxAzs = props.maxAzs ?? VPC_MAX_AZS;
    if (maxAzs < 1 || maxAzs > 3) {
      throw new Error(
        `maxAzs must be between 1 and 3, got: ${maxAzs}\n\n` +
          "Typical values:\n" +
          "- 1 AZ: Development (not recommended - no HA)\n" +
          "- 2 AZs: Production (recommended)\n" +
          "- 3 AZs: High availability requirements"
      );
    }

    // NAT Gateway defaults
    let defaultNatGateways: number = VPC_NAT_GATEWAYS.DEV;
    if (isProduction) {
      defaultNatGateways = Math.min(VPC_NAT_GATEWAYS.PRODUCTION, maxAzs);
    }

    const natGateways = props.natGateways ?? defaultNatGateways;
    if (natGateways < 0 || natGateways > maxAzs) {
      throw new Error(
        `natGateways must be between 0 and maxAzs (${maxAzs}), got: ${natGateways}\n\n` +
          "NAT Gateway options:\n" +
          "- 0: No internet access for private subnets (lowest cost)\n" +
          "- 1: Single NAT gateway (cost-optimized, not HA)\n" +
          `- ${maxAzs}: One NAT gateway per AZ (high availability, highest cost)`
      );
    }

    const flowLogTrafficType =
      props.flowLogTrafficType ?? VPC_FLOW_LOG_TRAFFIC_TYPE;
    const flowLogRetention = props.flowLogRetention ?? VPC_FLOW_LOG_RETENTION;

    // ========================================================================
    // PRODUCTION WARNINGS
    // ========================================================================
    if (props.enableProductionWarnings !== false && isProduction) {
      this.logProductionWarnings(props, maxAzs, natGateways);
    }

    // ========================================================================
    // 1. CREATE VPC
    // ========================================================================
    const vpcName =
      props.vpcName ||
      (props.projectName
        ? `${props.envName}-${props.projectName}-vpc`
        : `${props.envName}-vpc`);

    this.vpcConstruct = new VpcConstruct(this, "Vpc", {
      envName: props.envName,
      vpcName,
      cidr: vpcCidr,
      maxAzs,
      natGateways,
      subnetConfiguration:
        props.subnetConfiguration ??
        SubnetConfigurationHelper.twoTierConfiguration(),
      enableDnsHostnames: props.enableDnsHostnames ?? true,
      enableDnsSupport: props.enableDnsSupport ?? true,
    });

    this.vpc = this.vpcConstruct.vpc;

    // ========================================================================
    // 2. VPC FLOW LOGS (Security & Compliance)
    // ========================================================================
    if (props.enableVpcFlowLogs !== false) {
      // Environment-aware removal policy
      const flowLogRemovalPolicy =
        props.flowLogRemovalPolicy ??
        (isProduction ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY);

      this.flowLogs = new VpcFlowLogsConstruct(this, "FlowLogs", {
        vpc: this.vpc,
        envName: props.envName,
        projectName: props.projectName,
        trafficType: flowLogTrafficType,
        retentionDays: flowLogRetention,
        removalPolicy: flowLogRemovalPolicy,
      });
    }

    // ========================================================================
    // 3. VPC ENDPOINTS (Cost Optimization)
    // ========================================================================
    if (props.enableVpcEndpoints !== false) {
      // S3 Gateway Endpoint (FREE - no hourly charges)
      // Allows private subnet access to S3 without NAT gateway
      this.vpc.addGatewayEndpoint("S3Endpoint", {
        service: ec2.GatewayVpcEndpointAwsService.S3,
      });

      // DynamoDB Gateway Endpoint (FREE - no hourly charges)
      // Allows private subnet access to DynamoDB without NAT gateway
      this.vpc.addGatewayEndpoint("DynamoDbEndpoint", {
        service: ec2.GatewayVpcEndpointAwsService.DYNAMODB,
      });

      // ========================================================================
      // SSM INTERFACE ENDPOINTS (Required for EC2 SSM Agent connectivity)
      // ========================================================================
      // CRITICAL: These endpoints are required for SSM Agent on EC2 instances
      // to communicate with AWS Systems Manager service, regardless of whether
      // instances are in public or private subnets.
      //
      // Why needed even for public subnets:
      // - More reliable than Internet Gateway routing
      // - Works if IGW route is misconfigured
      // - Lower latency (stays within AWS network)
      // - Better security (traffic never leaves AWS)
      //
      // Cost: ~£7/month per endpoint = £21/month total for all 3
      // ========================================================================

      // SSM endpoint (required for Systems Manager agent registration)
      // Allows EC2 instances to register with Systems Manager
      this.vpc.addInterfaceEndpoint("SsmEndpoint", {
        service: ec2.InterfaceVpcEndpointAwsService.SSM,
        privateDnsEnabled: true,
      });

      // SSM Messages endpoint (required for Session Manager)
      // Enables AWS Session Manager for secure shell access
      this.vpc.addInterfaceEndpoint("SsmMessagesEndpoint", {
        service: ec2.InterfaceVpcEndpointAwsService.SSM_MESSAGES,
        privateDnsEnabled: true,
      });

      // EC2 Messages endpoint (required for Run Command and State Manager)
      // Enables SSM Run Command and SSM State Manager associations
      this.vpc.addInterfaceEndpoint("Ec2MessagesEndpoint", {
        service: ec2.InterfaceVpcEndpointAwsService.EC2_MESSAGES,
        privateDnsEnabled: true,
      });

      cdk.Annotations.of(this).addInfo(
        "Created SSM VPC endpoints for reliable Systems Manager connectivity. " +
          "Cost: ~£21/month for 3 interface endpoints. " +
          "These endpoints work for both public and private subnets and ensure " +
          "EC2 instances can communicate with Systems Manager service."
      );
    }

    // ========================================================================
    // 4. SSM PARAMETERS (Cross-Stack Discovery)
    // ========================================================================
    if (props.createSsmParameters !== false) {
      this.ssmParameters = new SsmParametersConstruct(this, "Parameters", {
        envName: props.envName,
        projectName: props.projectName,
        pathPrefix: `${NETWORKING_SSM_PREFIX}/${props.envName}`,
        customParameters: [
          {
            name: "vpc-id",
            value: this.vpc.vpcId,
            description: `VPC ID for ${props.envName} environment`,
          },
          {
            name: "vpc-cidr",
            value: this.vpc.vpcCidrBlock,
            description: `VPC CIDR block for ${props.envName} environment`,
          },
          {
            name: "vpc-azs",
            value: this.vpc.availabilityZones.join(","),
            description: `Availability zones for ${props.envName} environment`,
          },
          {
            name: "public-subnet-ids",
            value: this.vpcConstruct.publicSubnets
              .map((s) => s.subnetId)
              .join(","),
            description: `Public subnet IDs for ${props.envName} environment`,
          },
          {
            name: "private-subnet-ids",
            value: this.vpcConstruct.privateSubnets
              .map((s) => s.subnetId)
              .join(","),
            description: `Private subnet IDs for ${props.envName} environment`,
          },
        ],
      });
    }

    // ========================================================================
    // 5. CLOUDFORMATION OUTPUTS
    // ========================================================================
    if (props.createOutputs !== false) {
      this.createOutputs(props);
    }

    // ========================================================================
    // 6. RESOURCE TAGGING
    // ========================================================================
    applyStackTags(this, props.envName, props.projectName, {
      ...props.customTags,
      Layer: "Foundation",
      NetworkType: "SharedVpc",
      StackName: "Networking",
    });

    // ========================================================================
    // 7. CDK NAG SUPPRESSIONS
    // ========================================================================
    SuppressionManager.applyToStack(this, "NetworkingStack", props.envName);
  }

  /**
   * Log production warnings
   */
  private logProductionWarnings(
    props: NetworkingStackProps,
    maxAzs: number,
    natGateways: number
  ): void {
    // Warn about single AZ
    if (maxAzs < 2) {
      cdk.Annotations.of(this).addWarning(
        "PRODUCTION: Single availability zone configured. " +
          "For high availability, deploy across 2+ AZs. " +
          "Single AZ is a single point of failure."
      );
    }

    // Warn about no NAT gateways
    if (natGateways === 0) {
      cdk.Annotations.of(this).addWarning(
        "PRODUCTION: No NAT gateways configured. " +
          "Private subnets cannot access the internet (no package downloads, no AWS API calls). " +
          "Set natGateways to 1+ for production workloads."
      );
    }

    // Warn about single NAT gateway (not HA)
    if (natGateways === 1 && maxAzs > 1) {
      cdk.Annotations.of(this).addWarning(
        "PRODUCTION: Single NAT gateway with multi-AZ VPC. " +
          "NAT gateway is a single point of failure for internet access. " +
          `Set natGateways to ${maxAzs} (one per AZ) for high availability.`
      );
    }

    // Warn about flow logs disabled
    if (props.enableVpcFlowLogs === false) {
      cdk.Annotations.of(this).addWarning(
        "PRODUCTION: VPC flow logs disabled. " +
          "This reduces security visibility and may violate compliance requirements. " +
          "Enable flow logs for audit trail and troubleshooting."
      );
    }

    // Warn about VPC endpoints disabled
    if (props.enableVpcEndpoints === false) {
      cdk.Annotations.of(this).addWarning(
        "PRODUCTION: VPC endpoints disabled. " +
          "All S3 and DynamoDB traffic will route through NAT gateways or IGW, " +
          "increasing costs and reducing performance. Enable VPC endpoints."
      );
    }
  }

  /**
   * Create CloudFormation outputs
   */
  private createOutputs(props: NetworkingStackProps): void {
    const enableExports = props.enableExports ?? false;
    const exportPrefix = props.projectName
      ? `${props.envName}-${props.projectName}`
      : `${props.envName}`;

    // VPC outputs
    new cdk.CfnOutput(this, "VpcId", {
      value: this.vpc.vpcId,
      description: `VPC ID for ${props.envName} environment`,
      exportName: enableExports ? `${exportPrefix}-vpc-id` : undefined,
    });

    new cdk.CfnOutput(this, "VpcCidr", {
      value: this.vpc.vpcCidrBlock,
      description: "VPC CIDR block",
      exportName: enableExports ? `${exportPrefix}-vpc-cidr` : undefined,
    });

    new cdk.CfnOutput(this, "AvailabilityZones", {
      value: this.vpc.availabilityZones.join(","),
      description: "Availability zones (comma-separated)",
    });

    // Subnet outputs
    new cdk.CfnOutput(this, "PublicSubnetIds", {
      value: this.vpcConstruct.publicSubnets.map((s) => s.subnetId).join(","),
      description: "Public subnet IDs (comma-separated)",
    });

    new cdk.CfnOutput(this, "PrivateSubnetIds", {
      value: this.vpcConstruct.privateSubnets.map((s) => s.subnetId).join(","),
      description: "Private subnet IDs (comma-separated)",
    });

    // Flow logs output
    if (this.flowLogs) {
      new cdk.CfnOutput(this, "FlowLogsLogGroup", {
        value: this.flowLogs.logGroupName,
        description: "VPC Flow Logs CloudWatch Log Group",
      });
    }

    // SSM parameters info
    if (this.ssmParameters) {
      new cdk.CfnOutput(this, "SsmParameterPrefix", {
        value: this.ssmParameters.pathPrefix,
        description: "SSM Parameter Store path prefix for VPC resources",
      });
    }
  }

  /**
   * Get public subnets
   */
  public get publicSubnets(): ec2.ISubnet[] {
    return this.vpcConstruct.publicSubnets;
  }

  /**
   * Get private subnets
   */
  public get privateSubnets(): ec2.ISubnet[] {
    return this.vpcConstruct.privateSubnets;
  }

  /**
   * Get isolated subnets
   */
  public get isolatedSubnets(): ec2.ISubnet[] {
    return this.vpcConstruct.isolatedSubnets;
  }
}
