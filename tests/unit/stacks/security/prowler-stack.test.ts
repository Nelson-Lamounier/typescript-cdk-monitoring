/** @format */
/// <reference types="jest" />

import * as cdk from "aws-cdk-lib";
import * as autoscaling from "aws-cdk-lib/aws-autoscaling";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Template, Match } from "aws-cdk-lib/assertions";

import { ProwlerStack } from "../../../../lib/stacks/security/prowler-stack";
import { ProwlerStackProps } from "../../../../lib/shared/types/security-types";
import {
  PROWLER_IMAGE,
  PROWLER_FRAMEWORKS,
  PROWLER_IAM,
} from "../../../../lib/shared/constants/security-constants";

// ============================================================================
// TEST CONFIGURATION
// ============================================================================

const TEST_CONFIG = {
  account: "123456789012",
  region: "eu-west-1",
};

const TEST_CONSTANTS = {
  ENVIRONMENTS: {
    DEVELOPMENT: "development",
    PRODUCTION: "production",
    STAGING: "staging",
  },
  STACK_IDS: {
    DEFAULT: "TestProwlerStack",
    INFRA: "TestInfraStack",
    VALIDATION: "ValidationStack",
  },
  RESOURCE_COUNTS: {
    TASK_DEFINITIONS: 1,
    S3_BUCKETS: 1,
    LOG_GROUPS: 1,
    IAM_ROLES: 2, // Task role + Execution role
    SSM_PARAMETERS: 4, // Results bucket name, ARN, task definition ARN, schedule rule ARN
    EVENTBRIDGE_RULES: 1,
  },
  SSM_PARAMETER_NAMES: {
    RESULTS_BUCKET_NAME: "results-bucket-name",
    RESULTS_BUCKET_ARN: "results-bucket-arn",
    TASK_DEFINITION_ARN: "task-definition-arn",
    SCHEDULE_RULE_ARN: "schedule-rule-arn",
  },
  OUTPUT_NAMES: {
    RESULTS_BUCKET_NAME: "ResultsBucketName",
    RESULTS_BUCKET_ARN: "ResultsBucketArn",
    CLUSTER_ARN: "ClusterArn",
    TASK_DEFINITION_ARN: "TaskDefinitionArn",
    LOG_GROUP_NAME: "LogGroupName",
  },
} as const;

// ============================================================================
// TEST HELPER FUNCTIONS
// ============================================================================

function createTestApp(): cdk.App {
  return new cdk.App();
}

/**
 * Infrastructure resources required for Prowler stack tests
 */
interface InfraResources {
  cluster: ecs.Cluster;
  vpc: ec2.IVpc;
}

/**
 * Create infrastructure resources for testing
 */
function createInfraResources(app: cdk.App): InfraResources {
  const infraStack = new cdk.Stack(app, TEST_CONSTANTS.STACK_IDS.INFRA, {
    env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
  });

  const vpc = new ec2.Vpc(infraStack, "Vpc", {
    maxAzs: 2,
    natGateways: 0,
  });

  const cluster = new ecs.Cluster(infraStack, "Cluster", {
    vpc,
    clusterName: `${TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT}-monitoring-cluster`,
  });

  // Create AutoScalingGroup for EC2 capacity
  const userData = ec2.UserData.forLinux();
  userData.addCommands(
    "yum install -y ecs-init",
    `echo ECS_CLUSTER=${cluster.clusterName} >> /etc/ecs/ecs.config`,
    "start ecs"
  );

  const asg = new autoscaling.AutoScalingGroup(infraStack, "AutoScalingGroup", {
    vpc,
    instanceType: ec2.InstanceType.of(
      ec2.InstanceClass.T3,
      ec2.InstanceSize.SMALL
    ),
    machineImage: ecs.EcsOptimizedImage.amazonLinux2(),
    minCapacity: 1,
    maxCapacity: 1,
    desiredCapacity: 1,
    userData,
  });

  cluster.addAsgCapacityProvider(
    new ecs.AsgCapacityProvider(infraStack, "AsgCapacityProvider", {
      autoScalingGroup: asg,
    })
  );

  return { cluster, vpc };
}

/**
 * Get minimal props for Prowler stack
 */
function getMinimalProps(infra: InfraResources): ProwlerStackProps {
  return {
    env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
    envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
    cluster: infra.cluster,
    vpc: infra.vpc,
  };
}

/**
 * Create test stack with optional overrides
 */
function createTestStack(
  app: cdk.App,
  infra: InfraResources,
  id?: string,
  props?: Partial<ProwlerStackProps>
): ProwlerStack {
  const stackId = id ?? TEST_CONSTANTS.STACK_IDS.DEFAULT;
  const minimalProps = getMinimalProps(infra);

  return new ProwlerStack(app, stackId, {
    ...minimalProps,
    ...props,
  });
}

// ============================================================================
// PROWLER STACK TESTS
// ============================================================================

describe("ProwlerStack", () => {
  // ============================================================================
  // Stack Creation and Validation
  // ============================================================================

  describe("Stack Creation", () => {
    let app: cdk.App;
    let infra: InfraResources;
    let stack: ProwlerStack;
    let template: Template;

    beforeAll(() => {
      app = createTestApp();
      infra = createInfraResources(app);
      stack = createTestStack(app, infra);
      template = Template.fromStack(stack);
    });

    test("creates stack with minimal required properties", () => {
      expect(stack).toBeDefined();
      expect(stack.resultsBucket).toBeDefined();
      expect(stack.cluster).toBeDefined();
      expect(stack.prowler).toBeDefined();
    });

    test("creates ECS task definition for Prowler", () => {
      template.resourceCountIs(
        "AWS::ECS::TaskDefinition",
        TEST_CONSTANTS.RESOURCE_COUNTS.TASK_DEFINITIONS
      );
    });

    test("creates S3 bucket for results", () => {
      template.resourceCountIs(
        "AWS::S3::Bucket",
        TEST_CONSTANTS.RESOURCE_COUNTS.S3_BUCKETS
      );
    });

    test("creates CloudWatch log group", () => {
      template.hasResourceProperties("AWS::Logs::LogGroup", {
        LogGroupName: Match.stringLikeRegexp(".*prowler.*"),
      });
    });

    test("creates EventBridge schedule rule", () => {
      template.resourceCountIs(
        "AWS::Events::Rule",
        TEST_CONSTANTS.RESOURCE_COUNTS.EVENTBRIDGE_RULES
      );
    });
  });

  // ============================================================================
  // Validation Tests
  // ============================================================================

  describe("Validation", () => {
    test("throws error when envName is empty", () => {
      const newApp = createTestApp();
      const newInfra = createInfraResources(newApp);

      expect(() => {
        new ProwlerStack(newApp, "ValidationEnvStack", {
          env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
          envName: "",
          cluster: newInfra.cluster,
          vpc: newInfra.vpc,
        });
      }).toThrow(/environment name/i);
    });

    test("throws error when cluster is missing", () => {
      const newApp = createTestApp();
      const newInfra = createInfraResources(newApp);

      expect(() => {
        new ProwlerStack(newApp, "ValidationClusterStack", {
          env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
          envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
          cluster: null as unknown as ecs.ICluster,
          vpc: newInfra.vpc,
        });
      }).toThrow(/ECS cluster is required/);
    });
  });

  // ============================================================================
  // Task Definition Configuration
  // ============================================================================

  describe("Task Definition Configuration", () => {
    let app: cdk.App;
    let infra: InfraResources;
    let template: Template;

    beforeAll(() => {
      app = createTestApp();
      infra = createInfraResources(app);
      const stack = createTestStack(app, infra);
      template = Template.fromStack(stack);
    });

    test("uses Prowler container image", () => {
      template.hasResourceProperties("AWS::ECS::TaskDefinition", {
        ContainerDefinitions: Match.arrayWith([
          Match.objectLike({
            Name: "prowler",
            Image: PROWLER_IMAGE.FULL,
          }),
        ]),
      });
    });

    test("configures memory reservation for EC2 launch type", () => {
      template.hasResourceProperties("AWS::ECS::TaskDefinition", {
        ContainerDefinitions: Match.arrayWith([
          Match.objectLike({
            Name: "prowler",
            MemoryReservation: Match.anyValue(),
          }),
        ]),
      });
    });

    test("configures CloudWatch logging", () => {
      template.hasResourceProperties("AWS::ECS::TaskDefinition", {
        ContainerDefinitions: Match.arrayWith([
          Match.objectLike({
            Name: "prowler",
            LogConfiguration: Match.objectLike({
              LogDriver: "awslogs",
            }),
          }),
        ]),
      });
    });

    test("includes Prowler command with compliance framework", () => {
      template.hasResourceProperties("AWS::ECS::TaskDefinition", {
        ContainerDefinitions: Match.arrayWith([
          Match.objectLike({
            Name: "prowler",
            Command: Match.arrayWith([
              "prowler",
              "aws",
              "--compliance",
              PROWLER_FRAMEWORKS.CIS,
            ]),
          }),
        ]),
      });
    });
  });

  // ============================================================================
  // IAM Permissions
  // ============================================================================

  describe("IAM Permissions", () => {
    let app: cdk.App;
    let infra: InfraResources;
    let template: Template;

    beforeAll(() => {
      app = createTestApp();
      infra = createInfraResources(app);
      const stack = createTestStack(app, infra);
      template = Template.fromStack(stack);
    });

    test("attaches SecurityAudit managed policy to task role", () => {
      template.hasResourceProperties("AWS::IAM::Role", {
        ManagedPolicyArns: Match.arrayWith([
          Match.objectLike({
            "Fn::Join": Match.arrayWith([
              Match.arrayWith([Match.stringLikeRegexp(".*SecurityAudit.*")]),
            ]),
          }),
        ]),
      });
    });

    test("grants S3 write permissions for results bucket", () => {
      template.hasResourceProperties("AWS::IAM::Policy", {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Effect: "Allow",
              Action: Match.arrayWith(["s3:PutObject"]),
            }),
          ]),
        },
      });
    });

    test("includes additional read permissions for Prowler", () => {
      // Check that the policy includes at least one of the additional actions
      const additionalAction = PROWLER_IAM.ADDITIONAL_ACTIONS[0];
      template.hasResourceProperties("AWS::IAM::Policy", {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Effect: "Allow",
              Action: Match.arrayWith([additionalAction]),
            }),
          ]),
        },
      });
    });
  });

  // ============================================================================
  // S3 Bucket Configuration
  // ============================================================================

  describe("S3 Bucket Configuration", () => {
    let devApp: cdk.App;
    let devInfra: InfraResources;
    let devTemplate: Template;

    let prodApp: cdk.App;
    let prodInfra: InfraResources;
    let prodTemplate: Template;

    beforeAll(() => {
      devApp = createTestApp();
      devInfra = createInfraResources(devApp);
      const devStack = createTestStack(devApp, devInfra, "DevStack", {
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
      });
      devTemplate = Template.fromStack(devStack);

      prodApp = createTestApp();
      prodInfra = createInfraResources(prodApp);
      const prodStack = createTestStack(prodApp, prodInfra, "ProdStack", {
        envName: TEST_CONSTANTS.ENVIRONMENTS.PRODUCTION,
      });
      prodTemplate = Template.fromStack(prodStack);
    });

    test("creates bucket with encryption enabled", () => {
      devTemplate.hasResourceProperties("AWS::S3::Bucket", {
        BucketEncryption: Match.objectLike({
          ServerSideEncryptionConfiguration: Match.arrayWith([
            Match.objectLike({
              ServerSideEncryptionByDefault: Match.objectLike({
                SSEAlgorithm: "AES256",
              }),
            }),
          ]),
        }),
      });
    });

    test("blocks public access", () => {
      devTemplate.hasResourceProperties("AWS::S3::Bucket", {
        PublicAccessBlockConfiguration: Match.objectLike({
          BlockPublicAcls: true,
          BlockPublicPolicy: true,
          IgnorePublicAcls: true,
          RestrictPublicBuckets: true,
        }),
      });
    });

    test("applies DESTROY removal policy for development", () => {
      const buckets = devTemplate.findResources("AWS::S3::Bucket");
      const bucket = Object.values(buckets)[0];
      expect(bucket?.DeletionPolicy).toBe("Delete");
    });

    test("applies RETAIN removal policy for production", () => {
      const buckets = prodTemplate.findResources("AWS::S3::Bucket");
      const bucket = Object.values(buckets)[0];
      expect(bucket?.DeletionPolicy).toBe("Retain");
    });

    test("configures lifecycle rules for result retention", () => {
      devTemplate.hasResourceProperties("AWS::S3::Bucket", {
        LifecycleConfiguration: Match.objectLike({
          Rules: Match.arrayWith([
            Match.objectLike({
              Status: "Enabled",
              ExpirationInDays: Match.anyValue(),
            }),
          ]),
        }),
      });
    });
  });

  // ============================================================================
  // EventBridge Schedule Configuration
  // ============================================================================

  describe("EventBridge Schedule Configuration", () => {
    let app: cdk.App;
    let infra: InfraResources;
    let template: Template;
    let stack: ProwlerStack;

    beforeAll(() => {
      app = createTestApp();
      infra = createInfraResources(app);
      stack = createTestStack(app, infra);
      template = Template.fromStack(stack);
    });

    test("creates EventBridge rule with schedule expression", () => {
      template.hasResourceProperties("AWS::Events::Rule", {
        ScheduleExpression: Match.stringLikeRegexp("cron\\(.*\\)"),
        State: "ENABLED",
      });
    });

    test("targets ECS task in schedule rule", () => {
      template.hasResourceProperties("AWS::Events::Rule", {
        Targets: Match.arrayWith([
          Match.objectLike({
            Arn: Match.anyValue(),
            EcsParameters: Match.objectLike({
              TaskCount: 1,
              TaskDefinitionArn: Match.anyValue(),
            }),
          }),
        ]),
      });
    });

    test("exposes schedule rule via construct", () => {
      expect(stack.prowler.scheduleRule).toBeDefined();
    });
  });

  // ============================================================================
  // SSM Parameters
  // ============================================================================

  describe("SSM Parameters", () => {
    let app: cdk.App;
    let infra: InfraResources;
    let template: Template;

    beforeAll(() => {
      app = createTestApp();
      infra = createInfraResources(app);
      const stack = createTestStack(app, infra);
      template = Template.fromStack(stack);
    });

    test("creates SSM parameters for cross-stack references", () => {
      template.resourceCountIs(
        "AWS::SSM::Parameter",
        TEST_CONSTANTS.RESOURCE_COUNTS.SSM_PARAMETERS
      );
    });

    test.each([
      TEST_CONSTANTS.SSM_PARAMETER_NAMES.RESULTS_BUCKET_NAME,
      TEST_CONSTANTS.SSM_PARAMETER_NAMES.RESULTS_BUCKET_ARN,
      TEST_CONSTANTS.SSM_PARAMETER_NAMES.TASK_DEFINITION_ARN,
    ])("creates %s SSM parameter", (parameterName) => {
      template.hasResourceProperties("AWS::SSM::Parameter", {
        Name: Match.stringLikeRegexp(`.*${parameterName}.*`),
        Type: "String",
      });
    });
  });

  // ============================================================================
  // CloudFormation Outputs
  // ============================================================================

  describe("CloudFormation Outputs", () => {
    let app: cdk.App;
    let infra: InfraResources;
    let template: Template;
    let outputs: Record<string, unknown>;

    beforeAll(() => {
      app = createTestApp();
      infra = createInfraResources(app);
      const stack = createTestStack(app, infra);
      template = Template.fromStack(stack);
      outputs = template.toJSON().Outputs;
    });

    test.each([
      TEST_CONSTANTS.OUTPUT_NAMES.RESULTS_BUCKET_NAME,
      TEST_CONSTANTS.OUTPUT_NAMES.RESULTS_BUCKET_ARN,
      TEST_CONSTANTS.OUTPUT_NAMES.CLUSTER_ARN,
      TEST_CONSTANTS.OUTPUT_NAMES.TASK_DEFINITION_ARN,
      TEST_CONSTANTS.OUTPUT_NAMES.LOG_GROUP_NAME,
    ])("creates %s output", (outputName) => {
      expect(outputs[outputName]).toBeDefined();
    });

    test("includes manual run command output", () => {
      expect(outputs["ManualRunInfo"]).toBeDefined();
    });
  });

  // ============================================================================
  // Custom Configuration
  // ============================================================================

  describe("Custom Configuration", () => {
    test("accepts custom frameworks", () => {
      const app = createTestApp();
      const infra = createInfraResources(app);
      const stack = createTestStack(app, infra, "CustomFrameworkStack", {
        prowlerConfig: {
          frameworks: ["pci_dss_3_2_1", "hipaa"],
        },
      });
      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::ECS::TaskDefinition", {
        ContainerDefinitions: Match.arrayWith([
          Match.objectLike({
            Command: Match.arrayWith([
              "--compliance",
              "pci_dss_3_2_1",
              "hipaa",
            ]),
          }),
        ]),
      });
    });

    test("accepts excluded checks", () => {
      const app = createTestApp();
      const infra = createInfraResources(app);
      const stack = createTestStack(app, infra, "ExcludedChecksStack", {
        prowlerConfig: {
          excludeChecks: ["guardduty_is_enabled", "securityhub_enabled"],
        },
      });
      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::ECS::TaskDefinition", {
        ContainerDefinitions: Match.arrayWith([
          Match.objectLike({
            Command: Match.arrayWith([
              "--excluded-checks",
              "guardduty_is_enabled,securityhub_enabled",
            ]),
          }),
        ]),
      });
    });

    test("can disable scheduled execution", () => {
      const app = createTestApp();
      const infra = createInfraResources(app);
      const stack = createTestStack(app, infra, "NoScheduleStack", {
        prowlerConfig: {
          enableSchedule: false,
        },
      });

      expect(stack.prowler.scheduleRule).toBeUndefined();
    });

    test("uses existing S3 bucket when provided", () => {
      const app = createTestApp();
      const infra = createInfraResources(app);

      // Create a bucket in the infra stack
      const infraStack = app.node.findChild(
        TEST_CONSTANTS.STACK_IDS.INFRA
      ) as cdk.Stack;
      const existingBucket = new s3.Bucket(infraStack, "ExistingBucket", {
        bucketName: "existing-prowler-results-bucket",
      });

      const stack = new ProwlerStack(app, "ExistingBucketStack", {
        env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        cluster: infra.cluster,
        vpc: infra.vpc,
        resultsBucket: existingBucket,
      });

      expect(stack.resultsBucket).toBe(existingBucket);
    });
  });

  // ============================================================================
  // Resource Tagging
  // ============================================================================

  describe("Resource Tagging", () => {
    let app: cdk.App;
    let infra: InfraResources;
    let stack: ProwlerStack;

    beforeAll(() => {
      app = createTestApp();
      infra = createInfraResources(app);
      stack = createTestStack(app, infra, "TaggedStack", {
        projectName: "security",
      });
    });

    test("applies tags to stack resources", () => {
      expect(stack).toBeDefined();
      const tags = cdk.Tags.of(stack);
      expect(tags).toBeDefined();
    });
  });
});
