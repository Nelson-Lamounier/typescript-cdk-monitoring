/** @format */

import * as cdk from "aws-cdk-lib";
import * as efs from "aws-cdk-lib/aws-efs";
import { Construct } from "constructs";

export interface EfsAccessPointConstructProps {
  /**
   * The EFS file system to create the access point for
   */
  fileSystem: efs.IFileSystem;

  /**
   * Environment name for resource naming and tagging
   */
  envName: string;

  /**
   * Path within the EFS file system
   * @default "/monitoring"
   */
  path?: string;

  /**
   * POSIX user for the access point
   * @default { uid: "0", gid: "0" }
   */
  posixUser?: {
    uid: string;
    gid: string;
  };

  /**
   * Creation ACL for the root directory
   * @default { ownerUid: "0", ownerGid: "0", permissions: "755" }
   */
  creationAcl?: {
    ownerUid: string;
    ownerGid: string;
    permissions: string;
  };
}

/**
 * Construct for creating an EFS access point with monitoring-specific configuration
 */
export class EfsAccessPointConstruct extends Construct {
  public readonly accessPoint: efs.AccessPoint;

  constructor(
    scope: Construct,
    id: string,
    props: EfsAccessPointConstructProps
  ) {
    super(scope, id);

    const {
      fileSystem,
      envName,
      path = "/monitoring",
      posixUser = { uid: "0", gid: "0" },
      creationAcl = { ownerUid: "0", ownerGid: "0", permissions: "755" },
    } = props;

    // Create EFS access point
    this.accessPoint = new efs.AccessPoint(this, "MonitoringEfsAccessPoint", {
      fileSystem,
      path,
      posixUser,
      createAcl: creationAcl,
    });

    // Add tags
    cdk.Tags.of(this.accessPoint).add(
      "Name",
      `${envName}-monitoring-access-point`
    );
    cdk.Tags.of(this.accessPoint).add("Environment", envName);
    cdk.Tags.of(this.accessPoint).add("Purpose", "MonitoringAccess");
    cdk.Tags.of(this.accessPoint).add("ManagedBy", "CDK");

    // Output access point ID and ARN
    new cdk.CfnOutput(this, "AccessPointId", {
      value: this.accessPoint.accessPointId,
      description: `EFS Access Point ID for ${envName} monitoring`,
      exportName: `${cdk.Stack.of(this).stackName}-access-point-id`,
    });

    new cdk.CfnOutput(this, "AccessPointArn", {
      value: this.accessPoint.accessPointArn,
      description: `EFS Access Point ARN for ${envName} monitoring`,
      exportName: `${cdk.Stack.of(this).stackName}-access-point-arn`,
    });
  }
}
