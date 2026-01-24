/** @format */

import * as cdk from "aws-cdk-lib";
import * as efs from "aws-cdk-lib/aws-efs";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

import {
  DEFAULT_EFS_ACCESS_POINT_GID,
  DEFAULT_EFS_ACCESS_POINT_PATH,
  DEFAULT_EFS_ACCESS_POINT_PERMISSIONS,
  DEFAULT_EFS_ACCESS_POINT_UID,
  DEFAULT_EFS_PURPOSE,
} from "../../../shared/constants/storage-constants";
import { EfsAccessPointConstructProps } from "../../../shared/types/storage-types";
import {
  validateEfsAccessPointProps,
  validateEfsPath,
  validatePosixId,
  validatePosixPermissions,
} from "../../../shared/utils/validation";

/**
 * Construct for creating a reusable EFS access point with secure defaults.
 */
export class EfsAccessPointConstruct extends Construct {
  public readonly accessPoint: efs.AccessPoint;

  constructor(
    scope: Construct,
    id: string,
    props: EfsAccessPointConstructProps
  ) {
    super(scope, id);

    validateEfsAccessPointProps(props);

    const purpose = props.purpose ?? DEFAULT_EFS_PURPOSE;
    const name =
      props.accessPointName ?? `${props.envName}-${purpose}-access-point`;
    const path = props.path ?? DEFAULT_EFS_ACCESS_POINT_PATH;
    const posixUser = props.posixUser ?? {
      uid: DEFAULT_EFS_ACCESS_POINT_UID,
      gid: DEFAULT_EFS_ACCESS_POINT_GID,
      secondaryGids: [],
    };
    const creationAcl = props.creationAcl ?? {
      ownerUid: DEFAULT_EFS_ACCESS_POINT_UID,
      ownerGid: DEFAULT_EFS_ACCESS_POINT_GID,
      permissions: DEFAULT_EFS_ACCESS_POINT_PERMISSIONS,
    };

    // Defensive validation for overridden values
    validateEfsPath(path);
    validatePosixId(posixUser.uid, "posixUser.uid");
    validatePosixId(posixUser.gid, "posixUser.gid");
    (posixUser.secondaryGids ?? []).forEach((gid, index) =>
      validatePosixId(gid, `posixUser.secondaryGids[${index}]`)
    );
    validatePosixId(creationAcl.ownerUid, "creationAcl.ownerUid");
    validatePosixId(creationAcl.ownerGid, "creationAcl.ownerGid");
    validatePosixPermissions(creationAcl.permissions);

    // Create EFS access point
    this.accessPoint = new efs.AccessPoint(this, "EfsAccessPoint", {
      fileSystem: props.fileSystem,
      path,
      posixUser: {
        uid: posixUser.uid,
        gid: posixUser.gid,
        secondaryGids: posixUser.secondaryGids,
      },
      createAcl: {
        ownerUid: creationAcl.ownerUid,
        ownerGid: creationAcl.ownerGid,
        permissions: creationAcl.permissions,
      },
    });

    const cfnAccessPoint = this.accessPoint.node
      .defaultChild as efs.CfnAccessPoint;

    if (props.fileSystemPolicy) {
      const policy =
        props.fileSystemPolicy instanceof iam.PolicyDocument
          ? props.fileSystemPolicy.toJSON()
          : props.fileSystemPolicy;
      cfnAccessPoint.addPropertyOverride("FileSystemPolicy", policy);
    }

    // Tags
    cdk.Tags.of(this.accessPoint).add("Name", name);
    cdk.Tags.of(this.accessPoint).add("Environment", props.envName);
    cdk.Tags.of(this.accessPoint).add("Purpose", purpose);
    if (props.projectName) {
      cdk.Tags.of(this.accessPoint).add("Project", props.projectName);
    }
    cdk.Tags.of(this.accessPoint).add("ManagedBy", "CDK");
    Object.entries(props.additionalTags ?? {}).forEach(([key, value]) => {
      cdk.Tags.of(this.accessPoint).add(key, value);
    });

    // Security warnings
    if (posixUser.uid === "0" || posixUser.gid === "0") {
      cdk.Annotations.of(this).addWarning(
        "Access point is configured with root UID/GID (0). Use non-root POSIX IDs for least-privilege access."
      );
    }

    if (creationAcl.permissions.startsWith("77")) {
      cdk.Annotations.of(this).addWarning(
        `Access point root directory permissions are ${creationAcl.permissions}. Avoid world-writable directories in production.`
      );
    }

    // Outputs
    new cdk.CfnOutput(this, "AccessPointId", {
      value: this.accessPoint.accessPointId,
      description: `EFS Access Point ID for ${props.envName}`,
      exportName: `${cdk.Stack.of(this).stackName}-access-point-id`,
    });

    new cdk.CfnOutput(this, "AccessPointArn", {
      value: this.accessPoint.accessPointArn,
      description: `EFS Access Point ARN for ${props.envName}`,
      exportName: `${cdk.Stack.of(this).stackName}-access-point-arn`,
    });
  }

  /**
   * Grant read-only permissions (mount) to a principal for this access point.
   */
  public grantReadOnly(grantee: iam.IGrantable): iam.Grant {
    return iam.Grant.addToPrincipal({
      grantee,
      actions: ["elasticfilesystem:ClientMount"],
      resourceArns: [this.accessPoint.accessPointArn],
    });
  }

  /**
   * Grant read-write permissions (mount + write) to a principal for this access point.
   */
  public grantReadWrite(grantee: iam.IGrantable): iam.Grant {
    return iam.Grant.addToPrincipal({
      grantee,
      actions: [
        "elasticfilesystem:ClientMount",
        "elasticfilesystem:ClientWrite",
      ],
      resourceArns: [this.accessPoint.accessPointArn],
    });
  }

  /**
   * Add a resource policy statement if supported by the underlying L2/L1.
   */
  public addToResourcePolicy(
    statement: iam.PolicyStatement
  ): iam.AddToResourcePolicyResult {
    if (
      "addToResourcePolicy" in this.accessPoint &&
      typeof (this.accessPoint as unknown as { addToResourcePolicy: unknown })
        .addToResourcePolicy === "function"
    ) {
      return (this.accessPoint as unknown as {
        addToResourcePolicy: (
          s: iam.PolicyStatement
        ) => iam.AddToResourcePolicyResult;
      }).addToResourcePolicy(statement);
    }

    return { statementAdded: false };
  }
}
