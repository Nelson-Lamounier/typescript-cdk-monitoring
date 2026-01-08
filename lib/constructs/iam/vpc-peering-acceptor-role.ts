/** @format */

import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

export interface VpcPeeringAcceptorRoleProps {
  /**
   * AWS account ID that will be allowed to accept peering connections
   * (typically the pipeline account)
   */
  requesterAccountId: string;

  /**
   * Environment name for tagging
   */
  envName: string;
}

/**
 * VPC Peering Acceptor IAM Role
 *
 * Creates an IAM role in the peer account that allows the requester account
 * to accept VPC peering connections and update route tables.
 *
 * This role must be deployed in the PEER account (dev, staging, production)
 * BEFORE creating the VPC peering connection from the pipeline account.
 *
 * Permissions granted:
 * - Accept VPC peering connections
 * - Manage routes in route tables
 * - Describe VPCs and subnets
 *
 * Usage in peer account:
 * ```typescript
 * const role = new VpcPeeringAcceptorRole(this, 'PeeringAcceptorRole', {
 *   requesterAccountId: '559780231478', // Pipeline account
 *   envName: 'development',
 * });
 * ```
 */
export class VpcPeeringAcceptorRole extends Construct {
  public readonly role: iam.Role;
  public readonly roleArn: string;

  constructor(
    scope: Construct,
    id: string,
    props: VpcPeeringAcceptorRoleProps
  ) {
    super(scope, id);

    // Create IAM role that pipeline account can assume
    this.role = new iam.Role(this, "Role", {
      roleName: `${props.envName}-VpcPeeringAcceptorRole`,
      assumedBy: new iam.AccountPrincipal(props.requesterAccountId),
      description: `Allow ${props.requesterAccountId} (pipeline) to accept VPC peering and update routes in ${props.envName}`,
      maxSessionDuration: cdk.Duration.hours(1),
    });

    // Grant permissions to accept VPC peering connections
    this.role.addToPolicy(
      new iam.PolicyStatement({
        sid: "AcceptVpcPeeringConnection",
        effect: iam.Effect.ALLOW,
        actions: [
          "ec2:AcceptVpcPeeringConnection",
          "ec2:DescribeVpcPeeringConnections",
        ],
        resources: ["*"],
      })
    );

    // Grant permissions to manage routes
    this.role.addToPolicy(
      new iam.PolicyStatement({
        sid: "ManageRoutes",
        effect: iam.Effect.ALLOW,
        actions: [
          "ec2:CreateRoute",
          "ec2:DeleteRoute",
          "ec2:DescribeRouteTables",
          "ec2:DescribeVpcs",
        ],
        resources: ["*"],
      })
    );

    // Grant permissions to describe VPCs (for validation)
    this.role.addToPolicy(
      new iam.PolicyStatement({
        sid: "DescribeVpcs",
        effect: iam.Effect.ALLOW,
        actions: ["ec2:DescribeVpcs", "ec2:DescribeSubnets"],
        resources: ["*"],
      })
    );

    this.roleArn = this.role.roleArn;

    // ========================================================================
    // OUTPUTS
    // ========================================================================
    new cdk.CfnOutput(this, "RoleArn", {
      value: this.roleArn,
      description: `IAM role ARN for VPC peering acceptor in ${props.envName}`,
      exportName: `${props.envName}-vpc-peering-acceptor-role-arn`,
    });

    // ========================================================================
    // TAGS
    // ========================================================================
    cdk.Tags.of(this).add("Environment", props.envName);
    cdk.Tags.of(this).add("Purpose", "VpcPeering");
    cdk.Tags.of(this).add("ManagedBy", "CDK");
  }
}
