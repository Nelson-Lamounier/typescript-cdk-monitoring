/** @format */

import * as cdk from "aws-cdk-lib";
import { Token } from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as ssm from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";
import { Annotations } from "aws-cdk-lib";

import { VpcPeeringConstructProps } from "../../../shared/types/networking-types";
import {
  DEFAULT_VPC_PEERING_SSM_PREFIX,
  DEFAULT_VPC_PEERING_LAMBDA_TIMEOUT_SECONDS,
  VPC_PEERING_LAMBDA_HANDLERS,
} from "../../../shared/constants/networking-constants";
import {
  validateCidr,
  validateAccountId,
  validateRegion,
  cidrOverlaps,
} from "../../../shared/utils/validation";
import {
  createVpcPeeringProvider,
} from "../../../shared/utils/lambda-helpers";
import { getUniqueRouteTables } from "../../../shared/utils/route-table-helpers";

/**
 * VPC Peering Construct with Cross-Account Support
 *
 * Creates a VPC peering connection between two VPCs, supporting both
 * same-account and cross-account peering. Uses custom Lambda functions
 * to handle cross-account acceptance and route table updates.
 *
 * Features:
 * - Cross-account VPC peering support
 * - Automatic route table updates in both VPCs
 * - CIDR overlap validation
 * - DNS resolution configuration
 * - SSM parameter storage for connection ID
 * - Comprehensive validation (account ID, region, CIDR)
 * - Least-privilege IAM permissions
 * - Automatic tagging
 *
 * Security:
 * - Validates CIDR blocks don't overlap
 * - Validates AWS account IDs and regions
 * - Scoped IAM permissions where possible
 * - Explicit resource tagging
 *
 * Validation:
 * - CIDR format and overlap detection
 * - AWS account ID format (12 digits)
 * - AWS region format validation
 * - VPC ID format validation
 *
 * @example
 * ```typescript
 * const peering = new VpcPeeringConstruct(this, 'Peering', {
 *   vpc: requesterVpc,
 *   peerVpcId: 'vpc-1234567890abcdef0',
 *   peerAccountId: '123456789012',
 *   peerRegion: 'us-west-2',
 *   peerVpcCidr: '172.16.0.0/16',
 *   envName: 'production',
 *   peeringName: 'monitoring-to-shared',
 *   peerRoleArn: 'arn:aws:iam::123456789012:role/VpcPeeringAcceptRole',
 * });
 * ```
 */
export class VpcPeeringConstruct extends Construct {
  public readonly peeringConnectionId: string;
  public readonly ssmParameter: ssm.StringParameter;

  constructor(scope: Construct, id: string, props: VpcPeeringConstructProps) {
    super(scope, id);

    const {
      vpc,
      peerVpcId,
      peerAccountId,
      peerRegion,
      peerVpcCidr,
      envName,
      peeringName,
      peerRoleArn,
      projectName,
      ssmParameterPath,
      lambdaTimeoutSeconds = DEFAULT_VPC_PEERING_LAMBDA_TIMEOUT_SECONDS,
      enableDnsResolution = true,
    } = props;

    // ========================================================================
    // VALIDATION
    // ========================================================================

    // Validate CIDR blocks (skip validation for CDK tokens - they'll be validated at runtime)
    validateCidr(peerVpcCidr);
    
    // Only validate VPC CIDR if it's a resolved string (not a token)
    // VPC CIDR from existing VPC constructs may be a token during synthesis
    const requesterVpcCidr = vpc.vpcCidrBlock;
    if (!Token.isUnresolved(requesterVpcCidr)) {
      validateCidr(requesterVpcCidr);
      
      // Validate CIDR blocks don't overlap (only if both are resolved strings)
      if (!Token.isUnresolved(peerVpcCidr)) {
        if (cidrOverlaps(requesterVpcCidr, peerVpcCidr)) {
          throw new Error(
            `VPC CIDR blocks overlap. Cannot create peering connection between ` +
              `VPCs with overlapping CIDRs.\n\n` +
              `Requester VPC CIDR: ${requesterVpcCidr}\n` +
              `Peer VPC CIDR: ${peerVpcCidr}\n\n` +
              `Troubleshooting:\n` +
              `  1. Ensure VPCs use non-overlapping CIDR blocks\n` +
              `  2. Common non-overlapping ranges: 10.0.0.0/16, 172.16.0.0/16, 192.168.0.0/16\n` +
              `  3. Or use different /16 ranges: 10.0.0.0/16, 10.1.0.0/16, 10.2.0.0/16`
          );
        }
      }
    } else {
      // If VPC CIDR is a token, add a warning that overlap validation will happen at runtime
      Annotations.of(this).addWarning(
        `VPC CIDR block is unresolved (token). CIDR overlap validation will occur at runtime. ` +
          `Ensure requester VPC CIDR and peer VPC CIDR (${peerVpcCidr}) do not overlap.`
      );
    }

    // Validate AWS account ID
    validateAccountId(peerAccountId);

    // Validate region if provided
    const region = peerRegion || cdk.Stack.of(this).region;
    if (peerRegion) {
      validateRegion(peerRegion);
    }

    // Validate VPC ID format
    if (!peerVpcId || !peerVpcId.startsWith("vpc-")) {
      throw new Error(
        `Invalid VPC ID format: "${peerVpcId}". ` +
          `VPC IDs must start with "vpc-" (e.g., "vpc-1234567890abcdef0").`
      );
    }

    // Validate peer role ARN format
    if (!peerRoleArn || !peerRoleArn.startsWith("arn:aws:iam::")) {
      throw new Error(
        `Invalid IAM role ARN format: "${peerRoleArn}". ` +
          `Role ARNs must follow format: "arn:aws:iam::ACCOUNT_ID:role/ROLE_NAME".`
      );
    }

    // Warn if Lambda timeout is too long
    if (lambdaTimeoutSeconds > 120) {
      Annotations.of(this).addWarning(
        `Lambda timeout is set to ${lambdaTimeoutSeconds} seconds. ` +
          `VPC peering operations typically complete in under 60 seconds. ` +
          `Consider reducing timeout to optimise costs.`
      );
    }

    // ========================================================================
    // 1. CREATE AND ACCEPT VPC PEERING (via Custom Resource)
    // ========================================================================
    // Use a single custom resource that creates AND accepts the peering
    // This avoids CloudFormation trying to verify the peering state
    const peeringProvider = createVpcPeeringProvider(
      this,
      "PeeringProvider",
      VPC_PEERING_LAMBDA_HANDLERS.CREATE_ACCEPT,
      "create-accept-peering",
      peerRoleArn,
      lambdaTimeoutSeconds,
      [
        // Scoped EC2 permissions for peering operations
        // Note: Some wildcard permissions are required because peering
        // connection IDs are not known at deploy time
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            "ec2:CreateVpcPeeringConnection",
            "ec2:DeleteVpcPeeringConnection",
            "ec2:DescribeVpcPeeringConnections",
            "ec2:AcceptVpcPeeringConnection",
            "ec2:RejectVpcPeeringConnection",
            "ec2:ModifyVpcPeeringConnectionOptions",
            "ec2:CreateTags",
            "ec2:DescribeVpcs",
            "ec2:DescribeTags",
          ],
          resources: ["*"], // Required: peering connection IDs unknown at deploy time
        }),
      ]
    );

    const peeringResource = new cdk.CustomResource(this, "PeeringConnection", {
      serviceToken: peeringProvider.serviceToken,
      properties: {
        VpcId: vpc.vpcId,
        PeerVpcId: peerVpcId,
        PeerOwnerId: peerAccountId,
        PeerRegion: region,
        PeerRoleArn: peerRoleArn,
        PeeringName: peeringName,
        EnvName: envName,
        EnableDnsResolution: enableDnsResolution,
      },
    });

    this.peeringConnectionId = peeringResource.getAttString(
      "PeeringConnectionId"
    );

    // ========================================================================
    // 2. STORE PEERING CONNECTION ID IN SSM PARAMETER STORE
    // ========================================================================
    const finalSsmPath =
      ssmParameterPath ||
      `${DEFAULT_VPC_PEERING_SSM_PREFIX}/${envName}${
        projectName ? `-${projectName}` : ""
      }/connection-id`;

    this.ssmParameter = new ssm.StringParameter(this, "PeeringIdParameter", {
      parameterName: finalSsmPath,
      stringValue: this.peeringConnectionId,
      description: `VPC Peering connection ID for ${peeringName} (${envName})`,
      tier: ssm.ParameterTier.STANDARD,
    });

    // ========================================================================
    // 3. UPDATE ROUTE TABLES IN REQUESTER VPC
    // ========================================================================
    const uniqueRouteTables = getUniqueRouteTables(vpc);

    uniqueRouteTables.forEach((routeTable, index) => {
      const route = new ec2.CfnRoute(this, `Route${index}`, {
        routeTableId: routeTable.routeTableId,
        destinationCidrBlock: peerVpcCidr,
        vpcPeeringConnectionId: this.peeringConnectionId,
      });

      route.node.addDependency(peeringResource);
    });

    // ========================================================================
    // 4. UPDATE ROUTE TABLES IN PEER VPC (CROSS-ACCOUNT)
    // ========================================================================
    const updateRoutesProvider = createVpcPeeringProvider(
      this,
      "UpdateRoutesProvider",
      VPC_PEERING_LAMBDA_HANDLERS.UPDATE_ROUTES,
      "update-routes",
      peerRoleArn,
      lambdaTimeoutSeconds,
      [
        // Scoped EC2 permissions for route table updates
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            "ec2:DescribeRouteTables",
            "ec2:CreateRoute",
            "ec2:DeleteRoute",
            "ec2:DescribeVpcs",
            "ec2:DescribeVpcPeeringConnections",
          ],
          resources: ["*"], // Required: route table IDs unknown at deploy time
        }),
      ]
    );

    const updateRoutes = new cdk.CustomResource(this, "UpdatePeerRoutes", {
      serviceToken: updateRoutesProvider.serviceToken,
      properties: {
        VpcPeeringConnectionId: this.peeringConnectionId,
        PeerVpcId: peerVpcId,
        RequesterVpcCidr: vpc.vpcCidrBlock,
        PeerRoleArn: peerRoleArn,
        Region: region,
      },
    });

    updateRoutes.node.addDependency(peeringResource);

    // ========================================================================
    // 5. CONFIGURE DNS RESOLUTION (if enabled)
    // ========================================================================
    // DNS resolution allows resources in peered VPCs to resolve each other's
    // private DNS hostnames. This is enabled by default for convenience.
    if (enableDnsResolution) {
      // Note: DNS resolution is configured via the peering connection options
      // which are handled by the Lambda function in the custom resource
      // This is documented in the Lambda handler implementation
    }

    // ========================================================================
    // 6. TAGS
    // ========================================================================
    cdk.Tags.of(this).add("Environment", envName);
    cdk.Tags.of(this).add("PeeringName", peeringName);
    cdk.Tags.of(this).add("ManagedBy", "CDK");
    if (projectName) {
      cdk.Tags.of(this).add("Project", projectName);
    }

    // ========================================================================
    // 7. OUTPUTS
    // ========================================================================
    // Create outputs in the stack scope to ensure they're accessible
    // Outputs enable cross-stack references within the same account
    // For cross-account access, use SSM parameters instead
    const stack = cdk.Stack.of(this);
    
    // Shortened export name format: vpc-peering-{env} or vpc-peering-{project}-{env}
    // Examples: "vpc-peering-prod" or "vpc-peering-monitoring-prod"
    const envShort = envName === "production" ? "prod" : 
                     envName === "staging" ? "staging" : 
                     envName === "development" ? "dev" : envName;
    const exportName = projectName
      ? `vpc-peering-${projectName}-${envShort}`
      : `vpc-peering-${envShort}`;
    
    new cdk.CfnOutput(stack, `${id}PeeringConnectionId`, {
      value: this.peeringConnectionId,
      description: `VPC Peering connection ID for ${peeringName}`,
      exportName: exportName,
    });

    new cdk.CfnOutput(stack, `${id}PeerVpcCidr`, {
      value: peerVpcCidr,
      description: `Peer VPC CIDR block for ${peeringName}`,
    });

    new cdk.CfnOutput(stack, `${id}SsmParameterPath`, {
      value: finalSsmPath,
      description: `SSM Parameter Store path for peering connection ID`,
    });
  }
}
