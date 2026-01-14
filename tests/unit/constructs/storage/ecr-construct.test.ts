/** @format */

import * as cdk from "aws-cdk-lib";
import { Template, Match } from "aws-cdk-lib/assertions";

import { EcrConstruct } from "../../../../lib/constructs/storage/ecr/ecr-construct";

describe("EcrConstruct", () => {
  let app: cdk.App;
  let stack: cdk.Stack;

  beforeEach(() => {
    app = new cdk.App();
    stack = new cdk.Stack(app, "TestStack", {
      env: { account: "123456789012", region: "eu-west-1" },
    });
  });

  test("creates repository with defaults, tagging, and lifecycle rule", () => {
    new EcrConstruct(stack, "EcrRepo", {
      envName: "dev",
      projectName: "proj",
      repositoryName: "my-repo",
    });

    const template = Template.fromStack(stack);

    template.resourceCountIs("AWS::ECR::Repository", 1);
    template.hasResourceProperties("AWS::ECR::Repository", {
      RepositoryName: "my-repo",
      ImageScanningConfiguration: { ScanOnPush: true },
      ImageTagMutability: "IMMUTABLE",
    });

    template.hasResourceProperties("AWS::ECR::Repository", {
      LifecyclePolicy: {
        LifecyclePolicyText: Match.serializedJson(
          Match.objectLike({
            rules: Match.arrayWith([
              Match.objectLike({
                rulePriority: 1,
                selection: Match.objectLike({
                  tagStatus: "any",
                  countNumber: 10,
                }),
              }),
            ]),
          })
        ),
      },
    });
  });

  test("creates replication configuration when destinations provided", () => {
    new EcrConstruct(stack, "EcrWithReplication", {
      envName: "dev",
      repositoryName: "my-repo",
      replicationDestinations: [
        {
          region: "eu-west-2",
        },
      ],
    });

    const template = Template.fromStack(stack);

    template.resourceCountIs("AWS::ECR::ReplicationConfiguration", 1);
    template.hasResourceProperties("AWS::ECR::ReplicationConfiguration", {
      ReplicationConfiguration: {
        Rules: [
          Match.objectLike({
            Destinations: [
              Match.objectLike({
                Region: "eu-west-2",
                RegistryId: "123456789012",
              }),
            ],
            RepositoryFilters: [
              Match.objectLike({
                FilterType: "PREFIX",
              }),
            ],
          }),
        ],
      },
    });
  });
});
