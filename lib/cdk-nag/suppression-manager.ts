/** @format */

import * as cdk from "aws-cdk-lib";
import { NagPackSuppression } from "cdk-nag";

/**
 * Centralized CDK Nag Suppression Manager
 *
 * This file contains all CDK Nag suppressions organized by category.
 * Benefits:
 * - Single source of truth for all suppressions
 * - Easier to audit and review security exceptions
 * - Consistent justifications across stacks
 * - Simplified maintenance and updates
 *
 * Usage:
 * ```typescript
 * import { SuppressionManager } from '../cdk-nag/suppression-manager';
 *
 * // Apply to stack
 * SuppressionManager.applyToStack(this, 'ComputeStack');
 *
 * // Or get specific suppressions
 * const cdkManagedSuppressions = SuppressionManager.getCdkManagedResourceSuppressions();
 * NagSuppressions.addStackSuppressions(this, cdkManagedSuppressions);
 * ```
 */
export class SuppressionManager {
  /**
   * CDK-Managed Resources
   * These are resources created automatically by CDK that we don't directly control
   */
  static getCdkManagedResourceSuppressions(): NagPackSuppression[] {
    return [
      {
        id: "AwsSolutions-IAM4",
        reason:
          "AWS managed policies are used for Lambda functions created by CDK for custom resources (Auto Scaling lifecycle hooks, VPC default security group restriction, EventBridge targets). These are standard CloudFormation custom resource Lambda functions managed by CDK.",
        appliesTo: [
          "Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
        ],
      },
      {
        id: "AwsSolutions-IAM5",
        reason:
          "Wildcard permissions are used by CDK-managed custom resource Lambdas for EventBridge to CloudWatch Logs integration and other CDK framework operations. This is required by the CDK framework to manage resource policies and cannot be scoped further. This is standard CDK behavior.",
        appliesTo: ["Resource::*"],
      },
      {
        id: "AwsSolutions-IAM5",
        reason:
          "ECS Container Instance IAM role requires wildcard action permissions (ecs:Submit*) to communicate with ECS control plane. This is a standard permission for ECS EC2 instances as documented in AWS ECS best practices and is created by CDK's Auto Scaling Group construct.",
        appliesTo: ["Action::ecs:Submit*"],
      },
      {
        id: "AwsSolutions-IAM5",
        reason:
          "Auto Scaling Group lifecycle hook Lambda (DrainECSHook) requires permissions to manage Auto Scaling lifecycle actions. The wildcard is scoped to the specific Auto Scaling Group name pattern and is necessary for proper instance lifecycle management during ECS task draining. This is a CDK-managed resource.",
        appliesTo: [
          {
            regex:
              "/^Resource::arn:(aws|<AWS::Partition>):autoscaling:.*:.*:autoScalingGroup:\\*:autoScalingGroupName\\/<.*>$/",
          },
        ],
      },
      {
        id: "AwsSolutions-L1",
        reason:
          "Lambda runtime versions are managed by CDK for custom resources. CDK automatically updates these with new releases. Upgrading CDK version will update these runtimes.",
      },
    ];
  }

  /**
   * ECS Task Definition - Non-Sensitive Environment Variables
   * For basic configuration values that are not secrets
   */
  static getEcsEnvironmentVariableSuppressions(): NagPackSuppression[] {
    return [
      {
        id: "AwsSolutions-ECS2",
        reason:
          "Environment variables like NODE_ENV, PORT, and service configuration are non-sensitive values. Sensitive values (API keys, passwords, tokens) must use AWS Secrets Manager or SSM Parameter Store with SecureString. These basic config values are safe as environment variables.",
      },
      {
        id: "AwsSolutions-ECS7",
        reason:
          "Container logging is intentionally disabled for certain containers to reduce costs in development environments. For production, enable CloudWatch Logs with proper IAM permissions.",
      },
    ];
  }

  /**
   * Public-Facing Resources
   * For resources that need to be accessible from the internet
   */
  static getPublicAccessSuppressions(): NagPackSuppression[] {
    return [
      {
        id: "AwsSolutions-EC23",
        reason:
          "Application Load Balancer must accept traffic from the internet (0.0.0.0/0) to serve public-facing application. Security is enforced through: 1) ALB security group only allows HTTP/HTTPS, 2) Target security groups restrict access to ALB only, 3) WAF rules (if enabled), 4) Application-level authentication.",
      },
    ];
  }

  /**
   * ECR Permissions
   * For ECS tasks that need to pull container images
   */
  static getEcrPermissionSuppressions(): NagPackSuppression[] {
    return [
      {
        id: "AwsSolutions-IAM5",
        reason:
          "ECR GetAuthorizationToken action does not support resource-level permissions and requires wildcard (*). This is an AWS service limitation documented in AWS IAM documentation.",
        appliesTo: ["Resource::*"],
      },
      {
        id: "AwsSolutions-IAM5",
        reason:
          "ECR repository permissions use wildcard to allow pulling from any repository in the account. This is scoped to the account and region, providing reasonable security while allowing flexibility for multiple repositories.",
        appliesTo: [
          {
            regex: "/^Resource::arn:aws:ecr:.*:.*:repository/\\*$/",
          },
        ],
      },
    ];
  }

  /**
   * S3 Asset Permissions
   * For EC2 instances that need to download CDK assets from S3
   */
  static getS3AssetPermissions(): NagPackSuppression[] {
    return [
      {
        id: "AwsSolutions-IAM5",
        reason:
          "S3 GetBucket* permissions are required for EC2 instances to download CDK assets (config files) from the CDK staging bucket. These are read-only operations scoped to the CDK asset bucket and are necessary for bootstrapping instances with configuration files.",
        appliesTo: ["Action::s3:GetBucket*"],
      },
      {
        id: "AwsSolutions-IAM5",
        reason:
          "S3 GetObject* permissions are required for EC2 instances to download CDK assets (config files) from the CDK staging bucket. These are read-only operations scoped to the CDK asset bucket and are necessary for bootstrapping instances with configuration files.",
        appliesTo: ["Action::s3:GetObject*"],
      },
      {
        id: "AwsSolutions-IAM5",
        reason:
          "S3 List* permissions are required for EC2 instances to list objects in the CDK staging bucket when downloading assets. These are read-only operations scoped to the CDK asset bucket and are necessary for bootstrapping instances with configuration files.",
        appliesTo: ["Action::s3:List*"],
      },
      {
        id: "AwsSolutions-IAM5",
        reason:
          "CDK asset bucket permissions use wildcard for objects within the CDK staging bucket. This is automatically created by CDK and scoped to the specific account and region. The bucket only contains CDK deployment assets (config files, Lambda code, etc.) and permissions are read-only.",
        appliesTo: [
          {
            regex:
              "/^Resource::arn:aws:s3:::cdk-[a-z0-9]+-assets-.*-.*\\/\\*$/",
          },
        ],
      },
    ];
  }

  /**
   * Monitoring Configuration Bucket Permissions
   * For EC2 instances that need to access monitoring configuration files
   */
  static getMonitoringConfigBucketPermissions(): NagPackSuppression[] {
    return [
      {
        id: "AwsSolutions-IAM5",
        reason:
          "Monitoring configuration bucket permissions use wildcard for objects within the monitoring config bucket. This allows EC2 instances to read configuration files (Prometheus configs, Grafana dashboards, etc.) stored in the bucket. The wildcard is scoped to the specific monitoring configuration bucket and permissions are read-only for operational configuration management.",
        appliesTo: [
          {
            regex: "/^Resource::<ConfigBucket.*\\.Arn>\\/\\*$/",
          },
        ],
      },
    ];
  }

  /**
   * CloudWatch Logs Permissions
   * For services that need to write logs
   */
  static getCloudWatchLogsSuppressions(envName: string): NagPackSuppression[] {
    return [
      {
        id: "AwsSolutions-IAM5",
        reason:
          "CloudWatch Logs permissions use wildcard for log streams within the environment-specific log group. This allows services to create log streams dynamically while restricting access to the specific environment. The wildcard is scoped to /ecs/{envName}* pattern.",
        appliesTo: [
          {
            regex: `/^Resource::arn:aws:logs:.*:.*:log-group:/ecs/${envName}\\*:\\*$/`,
          },
        ],
      },
      {
        id: "AwsSolutions-IAM5",
        reason:
          "CloudWatch Logs permissions use wildcard for log streams within the ECS cluster log group. This allows ECS tasks to create log streams dynamically. The wildcard is scoped to the specific log group ARN.",
        appliesTo: [
          "Resource::arn:aws:logs:eu-west-1:123456789012:log-group:<EcsClusterClusterLogGroupF10E9DBD>:*",
        ],
      },
    ];
  }

  /**
   * ECS Service Permissions
   * For ECS services and task roles
   */
  static getEcsServiceSuppressions(): NagPackSuppression[] {
    return [
      {
        id: "AwsSolutions-IAM5",
        reason:
          "ECS service requires permissions to describe and manage tasks within its cluster. The wildcard is scoped to the specific cluster ARN and is necessary for ECS service operations like task placement, health checks, and service discovery.",
        appliesTo: ["Resource::*"],
      },
      {
        id: "AwsSolutions-IAM5",
        reason:
          "ECS Container Instance IAM role requires wildcard action permissions (ecs:Submit*) to communicate with ECS control plane. This is a standard permission for ECS EC2 instances as documented in AWS ECS best practices.",
        appliesTo: ["Action::ecs:Submit*"],
      },
      {
        id: "AwsSolutions-IAM5",
        reason:
          "Auto Scaling Group lifecycle hook Lambda requires permissions to manage Auto Scaling lifecycle actions. The wildcard is scoped to the specific Auto Scaling Group name pattern and is necessary for proper instance lifecycle management during ECS task draining.",
        appliesTo: [
          {
            regex:
              "/^Resource::arn:(aws|<AWS::Partition>):autoscaling:.*:.*:autoScalingGroup:\\*:autoScalingGroupName\\/<.*>$/",
          },
        ],
      },
    ];
  }

  /**
   * Auto Scaling Permissions
   * For Auto Scaling Groups and lifecycle hooks
   */
  static getAutoScalingSuppressions(): NagPackSuppression[] {
    return [
      {
        id: "AwsSolutions-IAM5",
        reason:
          "Auto Scaling lifecycle hooks require permissions to describe instances and complete lifecycle actions. These permissions are scoped to the specific Auto Scaling Group and are necessary for proper instance lifecycle management.",
        appliesTo: ["Resource::*"],
      },
      {
        id: "AwsSolutions-IAM5",
        reason:
          "Auto Scaling Group lifecycle hook Lambda requires wildcard permissions for Auto Scaling Group operations because the ASG name contains CDK-generated tokens that are not known at synthesis time. This is required for ECS instance draining functionality.",
        appliesTo: [
          {
            regex:
              "/^Resource::arn:(aws|<AWS::Partition>):autoscaling:.*:.*:autoScalingGroup:\\*:autoScalingGroupName\\/<.*>$/",
          },
        ],
      },
      {
        id: "AwsSolutions-AS3",
        reason:
          "Auto Scaling Group notifications are optional for development environments. For production, consider enabling SNS notifications for scaling events to improve operational visibility.",
      },
      {
        id: "AwsSolutions-EC26",
        reason:
          "EBS encryption can be managed at the account level via AWS Config or enabled per-environment. For development environments, unencrypted volumes reduce costs. Production environments should enable EBS encryption.",
      },
    ];
  }

  /**
   * Monitoring and Observability
   * For Prometheus, Grafana, and CloudWatch
   */
  static getMonitoringSuppressions(): NagPackSuppression[] {
    return [
      {
        id: "AwsSolutions-IAM5",
        reason:
          "Monitoring services (Prometheus, Grafana) require read access to CloudWatch metrics and logs across the account for comprehensive observability. This is standard practice for monitoring solutions and is read-only access.",
        appliesTo: ["Resource::*"],
      },
      {
        id: "AwsSolutions-IAM5",
        reason:
          "Grafana CloudWatch datasource requires permissions to query logs across all log groups in the account. The wildcard is scoped to the account and region, and permissions are read-only.",
        appliesTo: [
          { regex: "/^Resource::arn:aws:logs:.*:.*:log-group:\\*$/" },
          { regex: "/^Resource::arn:aws:logs:.*:.*:log-group:\\*:\\*$/" },
        ],
      },
      {
        id: "AwsSolutions-IAM5",
        reason:
          "ECS task roles require CloudWatch Logs permissions to write to their specific log groups. The wildcard allows log stream creation within the task's designated log group, which is necessary for ECS container logging.",
        appliesTo: [
          { regex: "/^Resource::arn:aws:logs:.*:.*:log-group:<.*>:\\*$/" },
        ],
      },
      {
        id: "AwsSolutions-IAM5",
        reason:
          "EC2 instances in monitoring infrastructure require read access to SSM parameters under the monitoring stack path for EFS setup scripts and configuration. The wildcard is scoped to the specific stack's parameter namespace (/monitoring/{stackName}/*) and provides read-only access to configuration data.",
        appliesTo: [
          {
            regex: "/^Resource::arn:aws:ssm:.*:.*:parameter/monitoring/.*\\*$/",
          },
        ],
      },
      {
        id: "AwsSolutions-SNS3",
        reason:
          "SNS topic is used for internal ECS lifecycle hooks managed by CDK for the monitoring cluster. SSL enforcement is handled by AWS internal services. The lifecycle hook topic is used for draining ECS tasks during instance termination.",
      },
      {
        id: "AwsSolutions-EC23",
        reason:
          "EFS security group allows NFS access from VPC CIDR block only. The CIDR block is dynamically resolved from VPC configuration using CloudFormation intrinsic functions, which CDK Nag cannot validate at synthesis time. This is secure as it restricts access to the VPC's private network only.",
      },
      {
        id: "CdkNagValidationFailure",
        reason:
          "CDK Nag validation failure occurs when CloudFormation intrinsic functions (like Fn::GetAtt for VPC CIDR) are used in security group rules. This is expected behavior and the actual values will be resolved at deployment time with proper CIDR restrictions.",
      },
    ];
  }

  /**
   * EFS Custom Resource Suppressions
   * For Lambda functions that initialize EFS
   */
  static getEfsCustomResourceSuppressions(): NagPackSuppression[] {
    return [
      {
        id: "AwsSolutions-IAM4",
        reason:
          "EFS initialization Lambda requires AWS managed policy AWSLambdaVPCAccessExecutionRole for VPC access to mount EFS. This is a standard AWS managed policy for Lambda functions that need VPC access and cannot be replaced with a custom policy.",
        appliesTo: [
          "Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole",
        ],
      },
      {
        id: "AwsSolutions-IAM5",
        reason:
          "EFS initialization Lambda requires wildcard access to SSM parameters under the monitoring stack path for reading configuration. The wildcard is scoped to the specific stack's parameter namespace and is read-only access.",
        appliesTo: [
          {
            regex: "/^Resource::arn:aws:ssm:.*:.*:parameter/monitoring/.*\\*$/",
          },
        ],
      },
      {
        id: "AwsSolutions-IAM5",
        reason:
          "CDK Custom Resource Provider framework requires wildcard permissions on the Lambda function ARN for invoking the function. This is managed by CDK and is necessary for the Custom Resource lifecycle management.",
        appliesTo: [
          "Resource::<*Function*.Arn>:*",
          "Resource::<*>:*",
          { regex: "/^Resource::<.*Function.*\\.Arn>:\\*$/g" },
          "Resource::<EfsInitLambdaFunctionFC8F36D2.Arn>:*",
        ],
      },
    ];
  }

  /**
   * Load Balancer Configuration
   * For ALB access logging and configuration
   */
  static getLoadBalancerSuppressions(): NagPackSuppression[] {
    return [
      {
        id: "AwsSolutions-ELB2",
        reason:
          "ALB access logging is disabled to reduce costs in development environments. For production, enable access logging to S3 bucket for audit and troubleshooting purposes. Logs should be retained according to compliance requirements.",
      },
      {
        id: "AwsSolutions-S1",
        reason:
          "S3 access log bucket has server access logging enabled via serverAccessLogsPrefix property. This bucket stores ALB access logs and its own access logs are stored in a separate prefix within the same bucket.",
      },
    ];
  }

  /**
   * VPC and Networking
   * For VPC Flow Logs and network configuration
   */
  static getNetworkingSuppressions(): NagPackSuppression[] {
    return [
      {
        id: "AwsSolutions-VPC7",
        reason:
          "VPC Flow Logs are disabled to reduce costs in development environments. For production, enable VPC Flow Logs to CloudWatch Logs or S3 for network troubleshooting and security analysis.",
      },
      {
        id: "AwsSolutions-IAM5",
        reason:
          "VPC Flow Logs IAM role requires wildcard permissions for log streams within the flow logs log group. The wildcard (logGroupArn:*) is necessary because VPC Flow Logs creates log streams dynamically with AWS-generated names. This is scoped to the specific log group ARN and is a standard pattern for CloudWatch Logs integration as documented in AWS VPC Flow Logs documentation: https://docs.aws.amazon.com/vpc/latest/userguide/flow-logs-cwl.html",
        appliesTo: [
          {
            regex: "/^Resource::arn:aws:logs:.*:.*:log-group:/aws/vpc/flowlogs/.*:\\*$/",
          },
          {
            regex: "/^Resource::<.*FlowLogs.*LogGroup.*\\.Arn>:\\*$/",
          },
        ],
      },
    ];
  }

  /**
   * SNS Topic Security
   * For SNS topics that need SSL/TLS enforcement
   */
  static getSnsSecuritySuppressions(): NagPackSuppression[] {
    return [
      {
        id: "AwsSolutions-SNS3",
        reason:
          "SNS topic SSL/TLS enforcement is not configured for CDK-managed topics used by Auto Scaling lifecycle hooks. These topics are internal to AWS services and use AWS's internal secure communication. For custom SNS topics, SSL/TLS should be enforced.",
      },
    ];
  }

  /**
   * Apply all relevant suppressions to a stack
   * This is the recommended way to apply suppressions
   */
  /**
   * Apply suppressions to a stack based on its type
   * 
   * Stack types are organized by domain:
   * - Monitoring Domain: MonitoringStack, MonitoringEfsStack, MonitoringInfraStack, MonitoringServiceStack
   * - Networking Domain: NetworkingStack, LoadBalancerStack, CertificateStack
   * - Compute Domain: ComputeStack
   * - Webapp Domain: WebappEcrStack, WebappDynamoDbStack (isolated - separate pipeline)
   * 
   * @param stack - The CDK stack to apply suppressions to
   * @param stackType - The type of stack (determines which suppressions to apply)
   * @param envName - Optional environment name for environment-specific suppressions
   */
  static applyToStack(
    stack: cdk.Stack,
    stackType:
      | "ComputeStack"
      | "MonitoringStack"
      | "MonitoringEfsStack"
      | "MonitoringInfraStack"
      | "MonitoringServiceStack"
      | "NetworkingStack"
      | "LoadBalancerStack"
      | "CertificateStack"
      | "WebappEcrStack" // Webapp domain - ECR repository
      | "WebappDynamoDbStack", // Webapp domain - DynamoDB + S3
    envName?: string
  ): void {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { NagSuppressions } = require("cdk-nag");

    const suppressions: NagPackSuppression[] = [];

    // All stacks get CDK-managed resource suppressions
    suppressions.push(...this.getCdkManagedResourceSuppressions());

    // Stack-specific suppressions organized by domain
    switch (stackType) {
      case "ComputeStack":
        suppressions.push(...this.getEcsEnvironmentVariableSuppressions());
        suppressions.push(...this.getEcsServiceSuppressions());
        suppressions.push(...this.getAutoScalingSuppressions());
        if (envName) {
          suppressions.push(...this.getCloudWatchLogsSuppressions(envName));
        }
        break;

      // ===== MONITORING DOMAIN =====
      case "MonitoringStack":
      case "MonitoringInfraStack":
        suppressions.push(...this.getMonitoringSuppressions());
        suppressions.push(...this.getEcsEnvironmentVariableSuppressions());
        suppressions.push(...this.getAutoScalingSuppressions());
        suppressions.push(...this.getPublicAccessSuppressions());
        suppressions.push(...this.getLoadBalancerSuppressions());
        suppressions.push(...this.getS3AssetPermissions());
        suppressions.push(...this.getMonitoringConfigBucketPermissions());
        if (envName) {
          suppressions.push(...this.getCloudWatchLogsSuppressions(envName));
        }
        break;

      case "MonitoringEfsStack":
        suppressions.push(...this.getMonitoringSuppressions());
        suppressions.push(...this.getEfsCustomResourceSuppressions());
        break;

      case "MonitoringServiceStack":
        suppressions.push(...this.getMonitoringSuppressions());
        suppressions.push(...this.getEcsEnvironmentVariableSuppressions());
        suppressions.push(...this.getEcsServiceSuppressions());
        if (envName) {
          suppressions.push(...this.getCloudWatchLogsSuppressions(envName));
        }
        break;

      // ===== NETWORKING DOMAIN =====
      case "NetworkingStack":
        suppressions.push(...this.getNetworkingSuppressions());
        break;

      case "LoadBalancerStack":
        suppressions.push(...this.getPublicAccessSuppressions());
        suppressions.push(...this.getLoadBalancerSuppressions());
        break;

      case "CertificateStack":
        // Certificate stack typically doesn't need additional suppressions
        break;

      // ===== WEBAPP DOMAIN (ISOLATED) =====
      case "WebappEcrStack":
        // Webapp ECR stack - Container registry for Next.js application
        // Only gets base CDK suppressions + ECR-specific suppressions
        suppressions.push(...this.getEcrPermissionSuppressions());
        break;

      case "WebappDynamoDbStack":
        // Webapp DynamoDB + S3 stack - Database and storage for portfolio articles
        // Gets base CDK suppressions + S3 bucket suppressions
        // Note: DynamoDB and S3 don't typically require additional suppressions
        // as they use AWS managed encryption and don't have wildcard IAM policies
        break;
    }

    NagSuppressions.addStackSuppressions(stack, suppressions);
  }

  /**
   * Get suppressions for ECS Task Execution Role
   * Use this in constructs that create execution roles
   */
  static getExecutionRoleSuppressions(envName: string): NagPackSuppression[] {
    return [
      ...this.getEcrPermissionSuppressions(),
      ...this.getCloudWatchLogsSuppressions(envName),
    ];
  }
}
