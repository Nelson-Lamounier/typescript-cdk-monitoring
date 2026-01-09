/** @format */

import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { Match, Template } from "aws-cdk-lib/assertions";

import {
  EfsAccessPointConstruct,
  EfsFileSystemConstruct,
} from "../../../../lib/constructs/storage/efs";

describe("EfsAccessPointConstruct", () => {
  let app: cdk.App;
  let stack: cdk.Stack;
  let vpc: ec2.Vpc;
  let fileSystem: EfsFileSystemConstruct;

  beforeEach(() => {
    app = new cdk.App();
    stack = new cdk.Stack(app, "TestStack", {
      env: { account: "123456789012", region: "eu-west-1" },
    });
    vpc = new ec2.Vpc(stack, "Vpc");
    fileSystem = new EfsFileSystemConstruct(stack, "Efs", {
      vpc,
      envName: "dev",
    });
  });

  test("creates access point with non-root defaults and outputs", () => {
    new EfsAccessPointConstruct(stack, "AccessPoint", {
      envName: "dev",
      fileSystem: fileSystem.fileSystem,
    });

    const template = Template.fromStack(stack);

    template.resourceCountIs("AWS::EFS::AccessPoint", 1);
    template.hasResourceProperties("AWS::EFS::AccessPoint", {
      FileSystemId: Match.anyValue(),
      PosixUser: {
        Uid: "1000",
        Gid: "1000",
        SecondaryGids: [],
      },
      RootDirectory: {
        CreationInfo: {
          OwnerUid: "1000",
          OwnerGid: "1000",
          Permissions: "750",
        },
        Path: "/",
      },
      AccessPointTags: Match.arrayWith([
        Match.objectLike({
          Key: "Name",
          Value: "dev-shared-storage-access-point",
        }),
        Match.objectLike({ Key: "Purpose", Value: "shared-storage" }),
      ]),
    });

    const outputs = template.findOutputs("*");
    expect(Object.values(outputs)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ Export: { Name: "TestStack-access-point-id" } }),
        expect.objectContaining({ Export: { Name: "TestStack-access-point-arn" } }),
      ])
    );
  });

  test("supports custom POSIX settings, path, purpose, and policy", () => {
    const policy = {
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Principal: { AWS: "arn:aws:iam::123456789012:role/Example" },
          Action: ["elasticfilesystem:ClientMount"],
          Resource: "*",
        },
      ],
    };

    new EfsAccessPointConstruct(stack, "AccessPointCustom", {
      envName: "prod",
      purpose: "data",
      fileSystem: fileSystem.fileSystem,
      path: "/data",
      posixUser: { uid: "2000", gid: "2000", secondaryGids: ["3000"] },
      creationAcl: { ownerUid: "2000", ownerGid: "2000", permissions: "755" },
      fileSystemPolicy: policy,
      additionalTags: { Owner: "team-a" },
    });

    const template = Template.fromStack(stack);

    template.hasResourceProperties("AWS::EFS::AccessPoint", {
      RootDirectory: {
        CreationInfo: {
          OwnerUid: "2000",
          OwnerGid: "2000",
          Permissions: "755",
        },
        Path: "/data",
      },
      PosixUser: {
        Uid: "2000",
        Gid: "2000",
        SecondaryGids: ["3000"],
      },
      AccessPointTags: Match.arrayWith([
        Match.objectLike({ Key: "Name", Value: "prod-data-access-point" }),
        Match.objectLike({ Key: "Purpose", Value: "data" }),
      ]),
      FileSystemPolicy: policy,
    });
  });
});
