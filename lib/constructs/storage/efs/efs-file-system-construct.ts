/** @format */

import * as cdk from "aws-cdk-lib";
import * as efs from "aws-cdk-lib/aws-efs";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

import {
  DEFAULT_EFS_BACKUP_ENABLED,
  DEFAULT_EFS_LIFECYCLE_TO_IA,
  DEFAULT_EFS_PERFORMANCE_MODE,
  DEFAULT_EFS_PROVISIONED_THROUGHPUT,
  DEFAULT_EFS_PURPOSE,
  DEFAULT_EFS_REMOVAL_POLICY_NON_PROD,
  DEFAULT_EFS_REMOVAL_POLICY_PROD,
  DEFAULT_EFS_THROUGHPUT_MODE,
  PRODUCTION_ENV_NAMES,
} from "../../../shared/constants/storage-constants";
import {
  EfsFileSystemConstructProps,
  EfsLifecycleConfig,
} from "../../../shared/types/storage-types";
import {
  validateEnvName,
  validateEfsEncryptionConfig,
  validateEfsLifecycleConfiguration,
  validateEfsMountTargetConfig,
  validateEfsReplicationConfig,
  validateEfsThroughputConfiguration,
  validateRegion,
  validateVpcIdPresent,
  validateVpcProvided,
} from "../../../shared/utils/validation";

/**
 * Construct for creating a reusable EFS file system with secure defaults.
 */
export class EfsFileSystemConstruct extends Construct {
  public readonly fileSystem: efs.FileSystem;

  constructor(
    scope: Construct,
    id: string,
    props: EfsFileSystemConstructProps
  ) {
    super(scope, id);

    validateVpcProvided(props.vpc);
    validateVpcIdPresent(props.vpc);
    validateEnvName(props.envName);
    validateEfsMountTargetConfig(props.mountTargets);
    validateEfsLifecycleConfiguration(props.lifecycle);
    validateEfsEncryptionConfig(props.enableEncryption, props.kmsKey);

    const envName = props.envName;
    const isProduction = PRODUCTION_ENV_NAMES.includes(envName);
    const purpose = props.purpose ?? DEFAULT_EFS_PURPOSE;
    const fileSystemName = props.fileSystemName ?? `${envName}-${purpose}-efs`;
    const performanceMode =
      props.performanceMode ?? DEFAULT_EFS_PERFORMANCE_MODE;
    const throughputMode = props.throughputMode ?? DEFAULT_EFS_THROUGHPUT_MODE;
    const provisionedThroughputPerSecond =
      props.provisionedThroughputPerSecond ??
      DEFAULT_EFS_PROVISIONED_THROUGHPUT;
    const removalPolicy =
      props.removalPolicy ??
      (isProduction
        ? DEFAULT_EFS_REMOVAL_POLICY_PROD
        : DEFAULT_EFS_REMOVAL_POLICY_NON_PROD);
    const backupEnabled =
      props.backup?.enabled ?? DEFAULT_EFS_BACKUP_ENABLED;

    validateEfsThroughputConfiguration(
      throughputMode,
      throughputMode === efs.ThroughputMode.PROVISIONED
        ? provisionedThroughputPerSecond
        : undefined
    );
    validateEfsReplicationConfig(props.replication, validateRegion);

    // ================================
    // EFS File System
    // ================================
    const selectedSecurityGroup =
      props.securityGroup ?? props.mountTargets?.securityGroups?.[0];

    if (props.mountTargets?.securityGroups && props.mountTargets.securityGroups.length > 1) {
      cdk.Annotations.of(this).addWarning(
        "Multiple security groups provided for EFS; only the first entry is applied by the construct."
      );
    }

    this.fileSystem = new efs.FileSystem(this, `Efs-${envName}`, {
      vpc: props.vpc,
      lifecyclePolicy: props.lifecycle?.transitionToIa ?? DEFAULT_EFS_LIFECYCLE_TO_IA,
      performanceMode,
      throughputMode,
      provisionedThroughputPerSecond:
        throughputMode === efs.ThroughputMode.PROVISIONED
          ? provisionedThroughputPerSecond
          : undefined,
      encrypted: props.enableEncryption ?? true,
      kmsKey: props.kmsKey,
      removalPolicy,
      securityGroup: selectedSecurityGroup,
      vpcSubnets: props.mountTargets?.subnetSelection,
      oneZone: props.mountTargets?.oneZone,
      fileSystemName,
    });

    const cfnFileSystem = this.fileSystem.node
      .defaultChild as efs.CfnFileSystem;

    const lifecyclePolicies = this.buildLifecyclePolicies(props.lifecycle);
    if (lifecyclePolicies.length > 0) {
      cfnFileSystem.lifecyclePolicies = lifecyclePolicies;
    }

    if (props.mountTargets?.availabilityZoneName) {
      cfnFileSystem.availabilityZoneName =
        props.mountTargets.availabilityZoneName;
    }

    cfnFileSystem.backupPolicy = {
      status: backupEnabled ? "ENABLED" : "DISABLED",
    };

    if (props.fileSystemPolicy) {
      const policy =
        props.fileSystemPolicy instanceof iam.PolicyDocument
          ? props.fileSystemPolicy.toJSON()
          : props.fileSystemPolicy;
      cfnFileSystem.addPropertyOverride("FileSystemPolicy", policy);
    }

    if (props.replication) {
      new cdk.CfnResource(this, "EfsReplication", {
        type: "AWS::EFS::ReplicationConfiguration",
        properties: {
          SourceFileSystemId: this.fileSystem.fileSystemId,
          Destinations: props.replication.destinations.map((destination) => ({
            Region: destination.region,
            KmsKeyId: destination.kmsKeyId,
            AvailabilityZoneName: destination.availabilityZoneName,
          })),
        },
      });
    }

    // ================================
    // Tags
    // ================================
    cdk.Tags.of(this.fileSystem).add("Name", fileSystemName);
    cdk.Tags.of(this.fileSystem).add("Environment", envName);
    cdk.Tags.of(this.fileSystem).add("Purpose", purpose);
    cdk.Tags.of(this.fileSystem).add("ManagedBy", "CDK");

    Object.entries(props.additionalTags ?? {}).forEach(([key, value]) => {
      cdk.Tags.of(this.fileSystem).add(key, value);
    });

    // ================================
    // Operational Warnings
    // ================================
    if (isProduction && throughputMode === efs.ThroughputMode.BURSTING) {
      cdk.Annotations.of(this).addWarning(
        "Production EFS is using BURSTING throughput. Consider PROVISIONED or ELASTIC to avoid burst credit exhaustion."
      );
    }

    if (isProduction && performanceMode === efs.PerformanceMode.GENERAL_PURPOSE) {
      cdk.Annotations.of(this).addWarning(
        "Production EFS is using GENERAL_PURPOSE performance mode. Use MAX_IO for high-concurrency workloads."
      );
    }

    if (isProduction && !props.replication) {
      cdk.Annotations.of(this).addWarning(
        "EFS replication is not configured. Production workloads may require cross-region or cross-AZ replication for resilience."
      );
    }

    if (!props.fileSystemPolicy) {
      cdk.Annotations.of(this).addInfo(
        "No file system policy applied. Ensure access is restricted via mount target security groups and IAM where applicable."
      );
    }

    // ================================
    // Outputs
    // ================================
    new cdk.CfnOutput(this, "FileSystemId", {
      value: this.fileSystem.fileSystemId,
      description: `EFS File System ID for ${envName}`,
      exportName: `${cdk.Stack.of(this).stackName}-efs-id`,
    });

    new cdk.CfnOutput(this, "FileSystemArn", {
      value: this.fileSystem.fileSystemArn,
      description: `EFS File System ARN for ${envName}`,
      exportName: `${cdk.Stack.of(this).stackName}-efs-arn`,
    });

    new cdk.CfnOutput(this, "FileSystemDnsName", {
      value: `${this.fileSystem.fileSystemId}.efs.${
        cdk.Stack.of(this).region
      }.amazonaws.com`,
      description: `EFS DNS name for ${envName}`,
      exportName: `${cdk.Stack.of(this).stackName}-efs-dns`,
    });
  }

  /**
   * Convenience helper to add an access point against the created file system.
   */
  public addAccessPoint(
    id: string,
    options: efs.AccessPointOptions
  ): efs.AccessPoint {
    return this.fileSystem.addAccessPoint(id, options);
  }

  private buildLifecyclePolicies(
    lifecycle?: EfsLifecycleConfig
  ): efs.CfnFileSystem.LifecyclePolicyProperty[] {
    if (!lifecycle) {
      return [
        {
          transitionToIa: DEFAULT_EFS_LIFECYCLE_TO_IA,
        },
      ];
    }

    const policies: efs.CfnFileSystem.LifecyclePolicyProperty[] = [];

    if (lifecycle.transitionToIa) {
      policies.push({
        transitionToIa: lifecycle.transitionToIa,
      });
    }

    if (lifecycle.transitionToArchive) {
      policies.push({
        transitionToArchive: lifecycle.transitionToArchive,
      });
    }

    if (lifecycle.outOfInfrequentAccessPolicy) {
      policies.push({
        transitionToPrimaryStorageClass:
          lifecycle.outOfInfrequentAccessPolicy,
      });
    }

    return policies.length > 0
      ? policies
      : [
          {
            transitionToIa: DEFAULT_EFS_LIFECYCLE_TO_IA,
          },
        ];
  }
}
