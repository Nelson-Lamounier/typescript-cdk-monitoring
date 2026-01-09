/** @format */

// Encapsulates ECR best practices, ensures consistency, reduces boilerplate

import * as ecr from "aws-cdk-lib/aws-ecr";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

export interface EcrConstructProps {
  repositoryName: string; // Unique name for ECR repository
  imageTagMutability?: ecr.TagMutability; // IMMUTABLE prevents tag overwrites (security)
  lifecycleRules?: number; // Max images to keep (cost optimization)
  pipelineAccount?: string; // CI/CD account for cross-account access
}

export class EcrConstruct extends Construct {
  public readonly repository: ecr.Repository;

  constructor(scope: Construct, id: string, props: EcrConstructProps) {
    super(scope, id);

    this.repository = new ecr.Repository(this, "Repository", {
      repositoryName: props.repositoryName,

      // IMMUTABLE prevents tag overwrites, ensures image integrity
      imageTagMutability:
        props.imageTagMutability || ecr.TagMutability.IMMUTABLE,

      // RETAIN prevents accidental data loss when stack is deleted
      // removalPolicy: RemovalPolicy.RETAIN,  Enable for production only

      // Automatically detects vulnerabilities before deployment
      imageScanOnPush: true,
    });

    // Prevents unbounded storage costs from old images
    // Default 10 images balances history retention with cost
    this.repository.addLifecycleRule({
      maxImageCount: props.lifecycleRules || 10,
      description: "Keep only recent images",
      rulePriority: 1,
      tagStatus: ecr.TagStatus.ANY,
    });

    // Grant cross-account access only when needed (least privilege)
    // Allows CI/CD pipeline to push images and deployments to pull them
    if (props.pipelineAccount) {
      this.repository.grantPullPush(
        new iam.AccountPrincipal(props.pipelineAccount)
      );
    }
  }
}
