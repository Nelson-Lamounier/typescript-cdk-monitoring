/** @format */

import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as efs from "aws-cdk-lib/aws-efs";
import { Construct } from "constructs";

export interface EfsFileSystemConstructProps {
  /**
   * VPC where the EFS file system will be created
   */
  vpc: ec2.IVpc;

  /**
   * Environment name for resource naming and tagging
   */
  envName: string;

  /**
   * Whether to enable encryption at rest
   * @default true
   */
  enableEncryption?: boolean;

  /**
   * Lifecycle policy for transitioning files to IA storage
   * @default AFTER_30_DAYS
   */
  lifecyclePolicy?: efs.LifecyclePolicy;

  /**
   * Performance mode for the file system
   * @default GENERAL_PURPOSE
   */
  performanceMode?: efs.PerformanceMode;

  /**
   * Throughput mode for the file system
   * @default PROVISIONED with 10 MiB/s
   */
  throughputMode?: efs.ThroughputMode;

  /**
   * Provisioned throughput in MiB/s (only used with PROVISIONED mode)
   * @default 10
   */
  provisionedThroughputPerSecond?: cdk.Size;

  /**
   * Removal policy for the file system
   * @default RETAIN
   */
  removalPolicy?: cdk.RemovalPolicy;

  /**
   * Security group for the file system
   */
  securityGroup?: ec2.ISecurityGroup;
}

/**
 * Construct for creating an EFS file system with monitoring-specific configuration
 */
export class EfsFileSystemConstruct extends Construct {
  public readonly fileSystem: efs.FileSystem;
  public readonly availabilityZone: string;

  constructor(
    scope: Construct,
    id: string,
    props: EfsFileSystemConstructProps
  ) {
    super(scope, id);

    const {
      vpc,
      envName,
      enableEncryption = true,
      lifecyclePolicy = efs.LifecyclePolicy.AFTER_30_DAYS,
      performanceMode = efs.PerformanceMode.GENERAL_PURPOSE,
      throughputMode = efs.ThroughputMode.BURSTING,
      provisionedThroughputPerSecond = cdk.Size.mebibytes(10),
      removalPolicy = cdk.RemovalPolicy.RETAIN,
      securityGroup,
    } = props;

    // Create EFS file system
    this.fileSystem = new efs.FileSystem(this, `MonitoringEfs-${envName}`, {
      vpc,
      lifecyclePolicy,
      performanceMode,
      throughputMode,
      provisionedThroughputPerSecond:
        throughputMode === efs.ThroughputMode.PROVISIONED
          ? provisionedThroughputPerSecond
          : undefined,
      encrypted: enableEncryption,
      removalPolicy,
      securityGroup,
      fileSystemName: `${envName}-monitoring-efs`,
    });

    // Get the first availability zone for single-AZ mount targets
    this.availabilityZone = vpc.availabilityZones[0];

    // Configure backup policy
    const cfnFileSystem = this.fileSystem.node
      .defaultChild as efs.CfnFileSystem;
    cfnFileSystem.backupPolicy = {
      status: "ENABLED",
    };

    // Add tags
    cdk.Tags.of(this.fileSystem).add("Name", `${envName}-monitoring-efs`);
    cdk.Tags.of(this.fileSystem).add("Environment", envName);
    cdk.Tags.of(this.fileSystem).add("Purpose", "MonitoringStorage");
    cdk.Tags.of(this.fileSystem).add("ManagedBy", "CDK");

    // Enable CloudWatch Insights for EFS performance monitoring
    const cfnFileSystemInsights = this.fileSystem.node
      .defaultChild as efs.CfnFileSystem;
    cfnFileSystemInsights.addPropertyOverride("FileSystemPolicy", {
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Principal: {
            AWS: "*",
          },
          Action: [
            "elasticfilesystem:ClientMount",
            "elasticfilesystem:ClientWrite",
            "elasticfilesystem:ClientRootAccess",
          ],
          Resource: "*",
          Condition: {
            Bool: {
              "aws:SecureTransport": "true",
            },
          },
        },
      ],
    });

    // Output file system ID
    new cdk.CfnOutput(this, "FileSystemId", {
      value: this.fileSystem.fileSystemId,
      description: `EFS File System ID for ${envName} monitoring`,
      exportName: `${cdk.Stack.of(this).stackName}-efs-id`,
    });

    new cdk.CfnOutput(this, "FileSystemArn", {
      value: this.fileSystem.fileSystemArn,
      description: `EFS File System ARN for ${envName} monitoring`,
      exportName: `${cdk.Stack.of(this).stackName}-efs-arn`,
    });

    new cdk.CfnOutput(this, "FileSystemDnsName", {
      value: `${this.fileSystem.fileSystemId}.efs.${
        cdk.Stack.of(this).region
      }.amazonaws.com`,
      description: `EFS DNS name for ${envName} monitoring`,
      exportName: `${cdk.Stack.of(this).stackName}-efs-dns`,
    });
  }
}
