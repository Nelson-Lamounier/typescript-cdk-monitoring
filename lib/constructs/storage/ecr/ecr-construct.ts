/** @format */

import * as cdk from "aws-cdk-lib";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as iam from "aws-cdk-lib/aws-iam";
import * as kms from "aws-cdk-lib/aws-kms";
import { Tags } from "aws-cdk-lib";
import { Construct } from "constructs";

import {
  DEFAULT_ECR_ENCRYPTION,
  DEFAULT_ECR_IMAGE_SCAN_ON_PUSH,
  DEFAULT_ECR_IMAGE_TAG_MUTABILITY,
  DEFAULT_ECR_LIFECYCLE_MAX_IMAGE_COUNT,
  DEFAULT_ECR_LIFECYCLE_RULE_PRIORITY,
  DEFAULT_ECR_REMOVAL_POLICY_NON_PROD,
  DEFAULT_ECR_REMOVAL_POLICY_PROD,
  MAX_ECR_LIFECYCLE_MAX_IMAGE_COUNT,
  MIN_ECR_LIFECYCLE_MAX_IMAGE_COUNT,
  PRODUCTION_ENV_NAMES,
} from "../../../shared/constants/storage-constants";
import {
  EcrConstructProps,
  EcrLifecycleRuleConfig,
  EcrReplicationDestination,
} from "../../../shared/types";
import {
  validateAccountId,
  validateEnvName,
  validateEcrLifecycleRules,
  validateEcrRepositoryName,
  validateRegion,
} from "../../../shared/utils/validation";

/**
 * Opinionated ECR repository construct with sensible defaults, validation, and tagging.
 */
export class EcrConstruct extends Construct {
  public readonly repository: ecr.Repository;

  constructor(scope: Construct, id: string, props: EcrConstructProps) {
    super(scope, id);

    validateEnvName(props.envName);
    validateEcrRepositoryName(props.repositoryName);
    validateEcrLifecycleRules(props.lifecycleRules);

    const isProd = PRODUCTION_ENV_NAMES.includes(props.envName.toLowerCase());
    const removalPolicy =
      props.removalPolicy ??
      (isProd ? DEFAULT_ECR_REMOVAL_POLICY_PROD : DEFAULT_ECR_REMOVAL_POLICY_NON_PROD);

    const encryption =
      props.encryption ??
      (props.kmsKeyArn ? ecr.RepositoryEncryption.KMS : DEFAULT_ECR_ENCRYPTION);

    const encryptionKey = props.kmsKeyArn
      ? kms.Key.fromKeyArn(this, "EcrKmsKey", props.kmsKeyArn)
      : undefined;

    const imageScanOnPush =
      props.imageScanOnPush ?? DEFAULT_ECR_IMAGE_SCAN_ON_PUSH;
    const imageTagMutability =
      props.imageTagMutability ?? DEFAULT_ECR_IMAGE_TAG_MUTABILITY;

    this.repository = new ecr.Repository(this, "Repository", {
      repositoryName: props.repositoryName,
      imageTagMutability,
      imageScanOnPush,
      encryption,
      encryptionKey,
      removalPolicy,
    });

    this.applyLifecycleRules(props.lifecycleRules);
    this.configureReplication(props.replicationDestinations);
    this.configureAccess(props);
    this.applyTags(props);
    this.addWarnings({ isProd, imageScanOnPush, imageTagMutability, removalPolicy, lifecycleRules: props.lifecycleRules });
  }

  private applyLifecycleRules(rules?: EcrLifecycleRuleConfig[]): void {
    const lifecycleRules =
      rules && rules.length > 0
        ? rules
        : [
            {
              maxImageCount: DEFAULT_ECR_LIFECYCLE_MAX_IMAGE_COUNT,
              rulePriority: DEFAULT_ECR_LIFECYCLE_RULE_PRIORITY,
              tagStatus: ecr.TagStatus.ANY,
              description: "Keep recent images to control storage costs",
            },
          ];

    lifecycleRules.forEach((rule, idx) => {
      this.repository.addLifecycleRule({
        description: rule.description,
        rulePriority: rule.rulePriority ?? idx + DEFAULT_ECR_LIFECYCLE_RULE_PRIORITY,
        maxImageCount: rule.maxImageCount,
        maxImageAge:
          rule.maxImageAgeDays !== undefined
            ? cdk.Duration.days(rule.maxImageAgeDays)
            : undefined,
        tagPrefixList: rule.tagPrefixList,
        tagStatus: rule.tagStatus,
      });
    });
  }

  private configureReplication(destinations?: EcrReplicationDestination[]): void {
    if (!destinations || destinations.length === 0) return;

    destinations.forEach((dest) => {
      validateRegion(dest.region);
      if (dest.registryId) validateAccountId(dest.registryId);
    });

    const destinationProps =
      destinations.map<ecr.CfnReplicationConfiguration.ReplicationDestinationProperty>(
        (dest) => {
          const registryId =
            dest.registryId ?? cdk.Stack.of(this).account ?? "";
          validateAccountId(registryId);

          return {
            region: dest.region,
            registryId,
          };
        }
      );

    new ecr.CfnReplicationConfiguration(this, "Replication", {
      replicationConfiguration: {
        rules: [
          {
            destinations: destinationProps,
            repositoryFilters: [
              {
                filter: this.repository.repositoryName,
                filterType: "PREFIX",
              },
            ],
          },
        ],
      },
    });
  }

  private configureAccess(props: EcrConstructProps): void {
    const principals: iam.IPrincipal[] = [];

    if (props.pipelineAccounts && props.pipelineAccounts.length > 0) {
      props.pipelineAccounts.forEach((acct) => {
        validateAccountId(acct);
        principals.push(new iam.AccountPrincipal(acct));
      });
    }

    if (props.additionalPrincipals) {
      principals.push(...props.additionalPrincipals);
    }

    if (principals.length > 0) {
      // Repository policy is implicitly scoped to the repository
      // Adding resources: [this.repository.repositoryArn] creates circular dependency
      this.repository.addToResourcePolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          principals,
          actions: [
            "ecr:BatchGetImage",
            "ecr:BatchCheckLayerAvailability",
            "ecr:CompleteLayerUpload",
            "ecr:GetDownloadUrlForLayer",
            "ecr:InitiateLayerUpload",
            "ecr:PutImage",
            "ecr:UploadLayerPart",
          ],
          // resources field omitted - ECR repository policy is automatically scoped to this repository
        })
      );
    }

    props.customPolicyStatements?.forEach((stmt) => {
      this.repository.addToResourcePolicy(stmt);
    });
  }

  private applyTags(props: EcrConstructProps): void {
    Tags.of(this.repository).add("Environment", props.envName);
    Tags.of(this.repository).add("ManagedBy", "CDK");
    if (props.projectName) {
      Tags.of(this.repository).add("Project", props.projectName);
    }
    if (props.customTags) {
      Object.entries(props.customTags).forEach(([key, value]) => {
        Tags.of(this.repository).add(key, value);
      });
    }
  }

  private addWarnings(params: {
    isProd: boolean;
    imageScanOnPush: boolean;
    imageTagMutability: ecr.TagMutability;
    removalPolicy: cdk.RemovalPolicy;
    lifecycleRules?: EcrLifecycleRuleConfig[];
  }): void {
    const { isProd, imageScanOnPush, imageTagMutability, removalPolicy, lifecycleRules } =
      params;

    if (isProd && imageTagMutability === ecr.TagMutability.MUTABLE) {
      cdk.Annotations.of(this).addWarning(
        "ECR repository uses MUTABLE tags in production. Consider IMMUTABLE to prevent overwrites."
      );
    }

    if (isProd && removalPolicy === cdk.RemovalPolicy.DESTROY) {
      cdk.Annotations.of(this).addWarning(
        "RemovalPolicy is DESTROY in production. This can delete images on stack removal. Consider RETAIN."
      );
    }

    if (!imageScanOnPush) {
      cdk.Annotations.of(this).addWarning(
        "imageScanOnPush is disabled. Vulnerabilities may go undetected before deployment."
      );
    }

    if (!lifecycleRules || lifecycleRules.length === 0) {
      cdk.Annotations.of(this).addWarning(
        "No lifecycle rules configured. Repository storage costs may grow without bounds."
      );
    } else {
      const hasRuleWithCount = lifecycleRules.some(
        (r) =>
          r.maxImageCount &&
          r.maxImageCount >= MIN_ECR_LIFECYCLE_MAX_IMAGE_COUNT &&
          r.maxImageCount <= MAX_ECR_LIFECYCLE_MAX_IMAGE_COUNT
      );
      if (!hasRuleWithCount) {
        cdk.Annotations.of(this).addWarning(
          "Lifecycle rules do not define maxImageCount. Consider setting maxImageCount to control image retention."
        );
      }
    }
  }
}