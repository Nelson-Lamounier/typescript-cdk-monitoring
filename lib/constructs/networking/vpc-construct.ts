/**@format */

import * as ec2 from "aws-cdk-lib/aws-ec2";
import { Construct } from "constructs";

// Properties for VpcContruct
export interface VpcConstructProps {
  maxAzs?: number; //Maximum number of availability zones to use
  natGateways?: number; // Number of NAT gateways to create
}

export class VpcConstruct extends Construct {
  public readonly vpc: ec2.IVpc; // The VPC instance create by this construct

  constructor(scope: Construct, id: string, props?: VpcConstructProps) {
    super(scope, id);

    this.vpc = new ec2.Vpc(this, "Vpc", {
      maxAzs: props?.maxAzs ?? 2,
      natGateways: props?.natGateways ?? 0,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: "Public",
          subnetType: ec2.SubnetType.PUBLIC,
          mapPublicIpOnLaunch: true,
        },
        {
          cidrMask: 24,
          name: "Private",
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
      ],
    });
  }
}
