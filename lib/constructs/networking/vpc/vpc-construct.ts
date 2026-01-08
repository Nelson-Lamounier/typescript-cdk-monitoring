/** @format */

import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as cdk from "aws-cdk-lib";
import { Annotations } from "aws-cdk-lib";
import { Construct } from "constructs";

import { SubnetConfiguration } from "../../../shared/types/networking-types";
import {
  DEFAULT_VPC_CIDR,
  DEFAULT_MAX_AZS,
  DEFAULT_NAT_GATEWAYS,
  DEFAULT_SUBNET_CIDR_MASK,
} from "../../../shared/constants/networking-constants";
import { validateCidr } from "../../../shared/utils/validation";

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
 * Enhanced VPC Construct with additional features
 *
 * This construct extends the basic VPC with:
 * - Custom CIDR configuration with validation
 * - Flexible subnet configuration with tag support
 * - DNS settings
 * - Better tagging
 * - Production-ready warnings
 *
 * Features:
 * - Configurable CIDR block with format validation
 * - Multiple availability zones
 * - Optional NAT gateways with production warnings
 * - Custom subnet configurations with automatic tag application
 * - DNS hostname and support
 * - Automatic tagging
 *
 * Note: VPC Flow Logs should be created separately using VpcFlowLogsConstruct
 * for better separation of concerns and flexibility.
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
      cidr = DEFAULT_VPC_CIDR,
      maxAzs = DEFAULT_MAX_AZS,
      natGateways = DEFAULT_NAT_GATEWAYS,
      subnetConfiguration = [
        {
          name: "Public",
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: DEFAULT_SUBNET_CIDR_MASK,
          mapPublicIpOnLaunch: true,
        },
        {
          name: "Private",
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: DEFAULT_SUBNET_CIDR_MASK,
        },
      ],
      enableDnsHostnames = true,
      enableDnsSupport = true,
    } = props;

    // Validate CIDR block format
    validateCidr(cidr);

    // Clean subnet configurations: remove mapPublicIpOnLaunch from private/isolated subnets
    // CDK does not allow this property for non-public subnets
    const cleanedSubnetConfiguration = subnetConfiguration.map((config) => {
      const isPrivateOrIsolated =
        config.subnetType === ec2.SubnetType.PRIVATE_WITH_EGRESS ||
        config.subnetType === ec2.SubnetType.PRIVATE_ISOLATED;

      if (isPrivateOrIsolated && config.mapPublicIpOnLaunch !== undefined) {
        // Remove mapPublicIpOnLaunch for private/isolated subnets
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { mapPublicIpOnLaunch: _unused, ...cleanedConfig } = config;
        return cleanedConfig;
      }

      return config;
    });

    // Warn about single NAT Gateway in production environments
    if (natGateways === 1 && (envName === "production" || envName === "prod")) {
      Annotations.of(this).addWarning(
        "Single NAT Gateway detected in production environment. " +
          "This creates a single point of failure. Consider using at least 2 NAT Gateways " +
          "across different availability zones for high availability."
      );
    }

    // Warn about zero NAT Gateways if private subnets are configured
    if (natGateways === 0) {
      const hasPrivateSubnets = cleanedSubnetConfiguration.some(
        (config) =>
          config.subnetType === ec2.SubnetType.PRIVATE_WITH_EGRESS ||
          config.subnetType === ec2.SubnetType.PRIVATE_ISOLATED
      );

      if (hasPrivateSubnets) {
        Annotations.of(this).addWarning(
          "NAT Gateways are set to 0 but private subnets are configured. " +
            "Private subnets will not have internet access. " +
            "This is acceptable for isolated workloads but may cause issues for services " +
            "requiring outbound internet connectivity."
        );
      }
    }

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
      subnetConfiguration: cleanedSubnetConfiguration,
      enableDnsHostnames,
      enableDnsSupport,
      // Restrict default security group - prevents unrestricted access
      restrictDefaultSecurityGroup: true,
    });

    // Store subnet references for easy access
    this.publicSubnets = this.vpc.publicSubnets;
    this.privateSubnets = this.vpc.privateSubnets;
    this.isolatedSubnets = this.vpc.isolatedSubnets;

    // Apply tags from subnet configurations
    // CDK VPC construct creates subnets automatically, so we apply tags to the VPC
    // and they will be inherited by subnets
    this.applySubnetTags(cleanedSubnetConfiguration);

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
   * Get VPC CIDR
   */
  public get vpcCidrBlock(): string {
    return this.vpc.vpcCidrBlock;
  }

  /**
   * Get availability zones
   */
  public get availabilityZones(): string[] {
    return this.vpc.availabilityZones;
  }

  /**
   * Add interface VPC endpoint with security best practices
   *
   * Interface endpoints provide private connectivity to AWS services using PrivateLink.
   * They have hourly costs but provide better security and performance than public endpoints.
   *
   * Security features:
   * - Automatically placed in private subnets for isolation
   * - Uses PrivateLink for encrypted communication
   * - No internet gateway required
   *
   * @param id - Logical ID for the endpoint
   * @param service - VPC endpoint service to connect to
   * @param subnets - Subnet selection for endpoint placement (defaults to private subnets)
   * @param privateDnsEnabled - Enable private DNS for the endpoint (default: true)
   * @returns Created interface VPC endpoint
   */
  public addInterfaceEndpoint(
    id: string,
    service: ec2.IInterfaceVpcEndpointService,
    subnets?: ec2.SubnetSelection,
    privateDnsEnabled: boolean = true
  ): ec2.InterfaceVpcEndpoint {
    // Default to private subnets if not specified for security
    const endpointSubnets = subnets || {
      subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
    };

    return this.vpc.addInterfaceEndpoint(id, {
      service,
      subnets: endpointSubnets,
      privateDnsEnabled,
      // Security: Open only to VPC CIDR by default
      // Users can add additional security group rules if needed
    });
  }

  /**
   * Add gateway VPC endpoint with security best practices
   *
   * Gateway endpoints are free and provide private connectivity to S3 and DynamoDB.
   * They are implemented as route table entries rather than network interfaces.
   *
   * Security features:
   * - Automatically routes traffic through AWS backbone
   * - No internet gateway required
   * - Can be restricted with endpoint policies
   *
   * @param id - Logical ID for the endpoint
   * @param service - Gateway endpoint service (S3 or DynamoDB)
   * @param subnets - Subnet selection for endpoint routes (defaults to all subnets)
   * @param policy - Optional endpoint policy to restrict access
   * @returns Created gateway VPC endpoint
   */
  public addGatewayEndpoint(
    id: string,
    service: ec2.IGatewayVpcEndpointService,
    subnets?: ec2.SubnetSelection[],
    policy?: iam.PolicyDocument
  ): ec2.GatewayVpcEndpoint {
    return this.vpc.addGatewayEndpoint(id, {
      service,
      subnets,
      // Apply endpoint policy if provided for additional security
      // Example: Restrict S3 access to specific buckets
      ...(policy && { policy }),
    });
  }

  /**
   * Apply tags from subnet configurations to VPC subnets
   *
   * Since CDK's VPC construct creates subnets automatically, we apply tags
   * at the VPC level which are inherited by subnets. For more granular control,
   * tags can be applied directly to subnets after VPC creation.
   *
   * @param subnetConfigurations - Array of subnet configurations with optional tags
   */
  private applySubnetTags(subnetConfigurations: SubnetConfiguration[]): void {
    for (const config of subnetConfigurations) {
      if (config.tags) {
        // Apply tags to VPC - they will be inherited by matching subnets
        // Note: For more precise tagging, you may need to tag subnets directly
        // after VPC creation using this.vpc.publicSubnets, etc.
        Object.entries(config.tags).forEach(([key, value]) => {
          cdk.Tags.of(this.vpc).add(key, value);
        });
      }
    }
  }
}
