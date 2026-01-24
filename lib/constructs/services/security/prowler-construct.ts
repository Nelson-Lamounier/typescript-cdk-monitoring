/** @format */

import * as cdk from "aws-cdk-lib";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import { NagSuppressions } from "cdk-nag";
import { Construct } from "constructs";

import {
  PROWLER_IMAGE,
  PROWLER_OUTPUT,
  PROWLER_IAM,
  PROWLER_CONTAINER,
  getProwlerResources,
  getProwlerSchedule,
  getProwlerTimeout,
  getProwlerLogRetention,
  getProwlerDefaultFrameworks,
} from "../../../shared/constants/security-constants";
import { ProwlerConstructProps } from "../../../shared/types/security-types";
import { validateEnvName } from "../../../shared/utils/validation";

/**
 * ProwlerConstruct - Scheduled ECS task for AWS security scanning
 *
 * Prowler is an open-source security tool that performs AWS security best practice
 * assessments, audits, incident response, continuous monitoring, and hardening.
 *
 * Architecture:
 * - Runs as a scheduled ECS task (EventBridge -> ECS) on existing EC2 cluster
 * - Stores results in S3 in JSON-OCSF format for Grafana integration
 * - Uses SecurityAudit managed policy for read-only access
 * - Supports cross-account scanning via AssumeRole
 *
 * Security Checks Include:
 * - Security Groups: Unrestricted ingress (0.0.0.0/0), sensitive ports, default SGs
 * - ELB/ALB: SSL policies, WAF attachment, access logging
 * - VPC: Flow logs, default security group, NACLs
 * - IAM: Overly permissive policies, MFA, access keys
 * - S3: Public access, encryption, versioning
 * - And 300+ more checks across all AWS services
 *
 * Cost Optimisation:
 * - Uses existing EC2 cluster (no additional Fargate costs)
 * - Scheduled execution (not continuous) to minimise compute costs
 * - API calls are the main cost driver (~$0.50 per full scan)
 *
 * Compliance Frameworks:
 * - CIS AWS Foundations Benchmark
 * - PCI-DSS 3.2.1
 * - HIPAA
 * - GDPR
 * - AWS Foundational Security Best Practices
 * - SOC2
 *
 * @example
 * ```typescript
 * const prowler = new ProwlerConstruct(this, 'Prowler', {
 *   cluster: monitoringInfraStack.cluster, // Use existing EC2 cluster
 *   envName: 'development',
 *   resultsBucket: bucket,
 *   frameworks: ['cis_aws'],
 * });
 * ```
 */
export class ProwlerConstruct extends Construct {
  /**
   * The ECS task definition for Prowler
   */
  public readonly taskDefinition: ecs.Ec2TaskDefinition;

  /**
   * The CloudWatch log group for Prowler logs
   */
  public readonly logGroup: logs.ILogGroup;

  /**
   * The EventBridge rule for scheduled execution
   */
  public readonly scheduleRule?: events.Rule;

  /**
   * The IAM role for the Prowler task
   */
  public readonly taskRole: iam.IRole;

  constructor(scope: Construct, id: string, props: ProwlerConstructProps) {
    super(scope, id);

    // ========================================================================
    // VALIDATION
    // ========================================================================
    validateEnvName(props.envName);

    if (!props.cluster) {
      throw new Error(
        "ECS cluster is required for ProwlerConstruct.\n\n" +
          "Provide an existing cluster or create one with Fargate capacity."
      );
    }

    if (!props.resultsBucket) {
      throw new Error(
        "S3 bucket is required for storing Prowler results.\n\n" +
          "Create a bucket with appropriate lifecycle policies for result retention."
      );
    }

    // ========================================================================
    // DEFAULTS
    // ========================================================================
    const resources = getProwlerResources(props.envName);
    const cpu = props.cpu ?? resources.CPU;
    const memoryMiB = props.memoryMiB ?? resources.MEMORY_MIB;
    // Timeout is captured for future use in task configuration
    const _timeoutSeconds = props.timeoutSeconds ?? getProwlerTimeout(props.envName);
    void _timeoutSeconds; // Suppress unused variable warning (reserved for future use)
    const logRetention = props.logRetention ?? getProwlerLogRetention(props.envName);
    const frameworks = props.frameworks ?? getProwlerDefaultFrameworks(props.envName);
    const outputFormats = props.outputFormats ?? [PROWLER_OUTPUT.FORMAT];
    const enableSchedule = props.enableSchedule ?? true;
    const scheduleExpression = props.scheduleExpression ?? getProwlerSchedule(props.envName);
    const enableExecuteCommand = props.enableExecuteCommand ?? props.envName === "development";
    const minSeverity = props.minSeverity ?? "low";

    // ========================================================================
    // LOG GROUP
    // ========================================================================
    const logGroupName = `/ecs/${props.envName}-prowler`;

    this.logGroup = new logs.LogGroup(this, "LogGroup", {
      logGroupName,
      retention: logRetention,
      removalPolicy:
        props.envName === "production"
          ? cdk.RemovalPolicy.RETAIN
          : cdk.RemovalPolicy.DESTROY,
    });

    // ========================================================================
    // TASK ROLE (Security Audit Permissions)
    // ========================================================================
    const taskRole = new iam.Role(this, "TaskRole", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      description: `Prowler security scanner task role for ${props.envName}`,
      roleName: `${props.envName}-prowler-task-role`,
    });

    // Attach SecurityAudit managed policy
    taskRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName("SecurityAudit")
    );

    // Attach ViewOnlyAccess for additional read permissions
    taskRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName("job-function/ViewOnlyAccess")
    );

    // Add additional permissions not covered by SecurityAudit
    taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: "ProwlerAdditionalReadPermissions",
        effect: iam.Effect.ALLOW,
        actions: [...PROWLER_IAM.ADDITIONAL_ACTIONS],
        resources: ["*"],
      })
    );

    // Grant S3 write access for results
    props.resultsBucket.grantWrite(taskRole, `${PROWLER_OUTPUT.S3_PREFIX}/*`);

    // Grant cross-account assume role if specified
    if (props.crossAccountRoleArns && props.crossAccountRoleArns.length > 0) {
      taskRole.addToPrincipalPolicy(
        new iam.PolicyStatement({
          sid: "ProwlerCrossAccountAssumeRole",
          effect: iam.Effect.ALLOW,
          actions: ["sts:AssumeRole"],
          resources: props.crossAccountRoleArns,
        })
      );
    }

    // Grant Security Hub access if enabled
    if (props.enableSecurityHub) {
      taskRole.addToPrincipalPolicy(
        new iam.PolicyStatement({
          sid: "ProwlerSecurityHub",
          effect: iam.Effect.ALLOW,
          actions: [
            "securityhub:BatchImportFindings",
            "securityhub:GetFindings",
          ],
          resources: ["*"],
        })
      );
    }

    this.taskRole = taskRole;

    // CDK Nag suppressions for security audit permissions
    NagSuppressions.addResourceSuppressions(
      taskRole,
      [
        {
          id: "AwsSolutions-IAM4",
          reason:
            "SecurityAudit and ViewOnlyAccess are AWS managed policies required for Prowler " +
            "to perform security assessments. These are read-only policies designed for security auditing.",
          appliesTo: [
            "Policy::arn:<AWS::Partition>:iam::aws:policy/SecurityAudit",
            "Policy::arn:<AWS::Partition>:iam::aws:policy/job-function/ViewOnlyAccess",
          ],
        },
        {
          id: "AwsSolutions-IAM5",
          reason:
            "Prowler requires wildcard permissions to scan all resources across the AWS account. " +
            "This is the nature of a security scanning tool - it must have visibility into all resources " +
            "to detect misconfigurations. All permissions are read-only except for S3 results storage.",
          appliesTo: ["Resource::*"],
        },
      ],
      true
    );

    // ========================================================================
    // EXECUTION ROLE
    // ========================================================================
    const executionRole = new iam.Role(this, "ExecutionRole", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      description: `Prowler task execution role for ${props.envName}`,
    });

    executionRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName(
        "service-role/AmazonECSTaskExecutionRolePolicy"
      )
    );

    NagSuppressions.addResourceSuppressions(
      executionRole,
      [
        {
          id: "AwsSolutions-IAM4",
          reason:
            "AmazonECSTaskExecutionRolePolicy is the standard AWS managed policy for ECS task execution. " +
            "It provides minimal permissions needed to pull images and write logs.",
          appliesTo: [
            "Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy",
          ],
        },
      ],
      true
    );

    // ========================================================================
    // TASK DEFINITION (EC2 Launch Type)
    // ========================================================================
    // Uses existing EC2 cluster instead of Fargate for cost optimisation
    this.taskDefinition = new ecs.Ec2TaskDefinition(this, "TaskDefinition", {
      taskRole,
      executionRole,
      family: `${props.envName}-prowler`,
      networkMode: ecs.NetworkMode.BRIDGE,
    });

    // ========================================================================
    // BUILD PROWLER COMMAND
    // ========================================================================
    const prowlerCommand = this.buildProwlerCommand({
      frameworks,
      outputFormats,
      minSeverity,
      regions: props.regions,
      services: props.services,
      excludeChecks: props.excludeChecks,
      resultsBucketName: props.resultsBucket.bucketName,
      envName: props.envName,
      enableSecurityHub: props.enableSecurityHub,
    });

    // ========================================================================
    // CONTAINER DEFINITION
    // ========================================================================
    const container = this.taskDefinition.addContainer(PROWLER_CONTAINER.NAME, {
      image: ecs.ContainerImage.fromRegistry(PROWLER_IMAGE.FULL),
      logging: ecs.LogDrivers.awsLogs({
        logGroup: this.logGroup,
        streamPrefix: "prowler",
      }),
      command: prowlerCommand,
      environment: {
        AWS_REGION: cdk.Stack.of(this).region,
        PROWLER_OUTPUT_DIR: PROWLER_OUTPUT.LOCAL_OUTPUT_DIR,
        ...props.environmentVariables,
      },
      // EC2 launch type: Use memory reservation instead of hard limits
      memoryReservationMiB: memoryMiB,
      cpu,
      // No port mappings needed - Prowler is a batch job, not a service
    });

    // Set ulimits for file handles (Prowler opens many files during scans)
    container.addUlimits({
      name: ecs.UlimitName.NOFILE,
      softLimit: 65536,
      hardLimit: 65536,
    });

    // ========================================================================
    // EVENTBRIDGE SCHEDULED RULE
    // ========================================================================
    if (enableSchedule) {
      this.scheduleRule = new events.Rule(this, "ScheduleRule", {
        ruleName: `${props.envName}-prowler-schedule`,
        description: `Scheduled Prowler security scan for ${props.envName}`,
        schedule: events.Schedule.expression(scheduleExpression),
        enabled: true,
      });

      // Use EC2 launch type on existing cluster
      this.scheduleRule.addTarget(
        new targets.EcsTask({
          cluster: props.cluster,
          taskDefinition: this.taskDefinition,
          taskCount: 1,
          enableExecuteCommand,
          propagateTags: cdk.aws_ecs.PropagatedTagSource.TASK_DEFINITION,
          // EC2 launch type uses the cluster's capacity provider
        })
      );
    }

    // ========================================================================
    // TAGS
    // ========================================================================
    cdk.Tags.of(this).add("Service", "Prowler");
    cdk.Tags.of(this).add("Purpose", "SecurityCompliance");
    if (props.tags) {
      Object.entries(props.tags).forEach(([key, value]) => {
        cdk.Tags.of(this).add(key, value);
      });
    }
  }

  /**
   * Build the Prowler CLI command
   */
  private buildProwlerCommand(config: {
    frameworks: string[];
    outputFormats: string[];
    minSeverity: string;
    regions?: string[];
    services?: string[];
    excludeChecks?: string[];
    resultsBucketName: string;
    envName: string;
    enableSecurityHub?: boolean;
  }): string[] {
    const command: string[] = [
      "prowler",
      "aws",
      // Compliance frameworks
      "--compliance",
      ...config.frameworks,
      // Output configuration
      "--output-formats",
      config.outputFormats.join(","),
      "--output-directory",
      PROWLER_OUTPUT.LOCAL_OUTPUT_DIR,
      // S3 upload
      "--output-bucket",
      config.resultsBucketName,
      "--output-bucket-prefix",
      `${PROWLER_OUTPUT.S3_PREFIX}/${config.envName}`,
      // Severity filter
      "--severity",
      config.minSeverity,
      // Status filter - only show failed checks to reduce noise
      "--status",
      "FAIL",
      // Disable ANSI colors for cleaner logs
      "--no-color",
    ];

    // Add region filter if specified
    if (config.regions && config.regions.length > 0) {
      command.push("--region", config.regions.join(","));
    }

    // Add service filter if specified
    if (config.services && config.services.length > 0) {
      command.push("--service", config.services.join(","));
    }

    // Add check exclusions if specified
    if (config.excludeChecks && config.excludeChecks.length > 0) {
      command.push("--excluded-checks", config.excludeChecks.join(","));
    }

    // Enable Security Hub integration if specified
    if (config.enableSecurityHub) {
      command.push("--send-sh-only-fails");
    }

    return command;
  }

  /**
   * Run Prowler scan immediately (manual trigger)
   *
   * Use this method to trigger an ad-hoc scan outside the schedule.
   * Returns the command to run via AWS CLI.
   *
   * Note: EC2 launch type uses the cluster's capacity provider and does not
   * require network configuration (uses BRIDGE networking mode).
   */
  public getManualRunCommand(): string {
    const stack = cdk.Stack.of(this);
    return (
      `aws ecs run-task \\
  --cluster ${this.taskDefinition.taskRole?.roleName?.replace("-task-role", "")} \\
  --task-definition ${this.taskDefinition.family} \\
  --launch-type EC2 \\
  --region ${stack.region}`
    );
  }
}
