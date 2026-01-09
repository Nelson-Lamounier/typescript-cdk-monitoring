/** @format */

import * as cdk from "aws-cdk-lib";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as logs from "aws-cdk-lib/aws-logs";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import { Construct } from "constructs";

export interface MonitoringConstructProps {
  envName: string;
  ecsClusterName: string;
  ecsServiceName: string;
  alertEmail?: string;
  enableDashboard?: boolean;
  logRetentionDays?: logs.RetentionDays;
}

export class MonitoringConstruct extends Construct {
  public readonly alarmTopic: sns.Topic;
  public readonly dashboard?: cloudwatch.Dashboard;

  constructor(scope: Construct, id: string, props: MonitoringConstructProps) {
    super(scope, id);

    // Create SNS topic for alerts
    this.alarmTopic = new sns.Topic(this, "AlarmTopic", {
      displayName: `${props.envName} Infrastructure Alerts`,
      topicName: `infrastructure-alerts-${props.envName}`,
    });

    // Enforce SSL/TLS for SNS topic publishers (CDK Nag: AwsSolutions-SNS3)
    this.alarmTopic.addToResourcePolicy(
      new cdk.aws_iam.PolicyStatement({
        sid: "AllowPublishThroughSSLOnly",
        effect: cdk.aws_iam.Effect.DENY,
        principals: [new cdk.aws_iam.AnyPrincipal()],
        actions: ["SNS:Publish"],
        resources: [this.alarmTopic.topicArn],
        conditions: {
          Bool: {
            "aws:SecureTransport": "false",
          },
        },
      })
    );

    // Add email subscription if provided
    if (props.alertEmail) {
      this.alarmTopic.addSubscription(
        new subscriptions.EmailSubscription(props.alertEmail)
      );
    }

    // Create deployment log group
    const deploymentLogGroup = new logs.LogGroup(this, "DeploymentLogs", {
      logGroupName: `/deployments/${props.envName}`,
      retention: props.logRetentionDays || logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Create metric filter for deployment failures
    deploymentLogGroup.addMetricFilter("DeploymentFailures", {
      filterPattern: logs.FilterPattern.anyTerm("ERROR", "FAILED", "FAILURE"),
      metricName: "DeploymentFailures",
      metricNamespace: "Deployments",
      metricValue: "1",
      defaultValue: 0,
    });

    // Create metric filter for successful deployments
    deploymentLogGroup.addMetricFilter("DeploymentSuccess", {
      filterPattern: logs.FilterPattern.anyTerm("SUCCESS", "COMPLETED"),
      metricName: "DeploymentSuccess",
      metricNamespace: "Deployments",
      metricValue: "1",
      defaultValue: 0,
    });

    // Alarm: Deployment Failures
    const deploymentFailureAlarm = new cloudwatch.Alarm(
      this,
      "DeploymentFailureAlarm",
      {
        alarmName: `${props.envName}-deployment-failures`,
        alarmDescription: `Alert when deployments fail in ${props.envName}`,
        metric: new cloudwatch.Metric({
          namespace: "Deployments",
          metricName: "DeploymentFailures",
          statistic: "Sum",
          period: cdk.Duration.minutes(5),
        }),
        threshold: 1,
        evaluationPeriods: 1,
        comparisonOperator:
          cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      }
    );
    deploymentFailureAlarm.addAlarmAction(
      new cdk.aws_cloudwatch_actions.SnsAction(this.alarmTopic)
    );

    // Alarm: ECS CPU Utilization
    const cpuAlarm = new cloudwatch.Alarm(this, "EcsCpuAlarm", {
      alarmName: `${props.envName}-ecs-high-cpu`,
      alarmDescription: `Alert when ECS CPU utilization is high in ${props.envName}`,
      metric: new cloudwatch.Metric({
        namespace: "AWS/ECS",
        metricName: "CPUUtilization",
        dimensionsMap: {
          ClusterName: props.ecsClusterName,
          ServiceName: props.ecsServiceName,
        },
        statistic: "Average",
        period: cdk.Duration.minutes(5),
      }),
      threshold: 80,
      evaluationPeriods: 2,
      comparisonOperator:
        cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    cpuAlarm.addAlarmAction(
      new cdk.aws_cloudwatch_actions.SnsAction(this.alarmTopic)
    );

    // Alarm: ECS Memory Utilization
    const memoryAlarm = new cloudwatch.Alarm(this, "EcsMemoryAlarm", {
      alarmName: `${props.envName}-ecs-high-memory`,
      alarmDescription: `Alert when ECS memory utilization is high in ${props.envName}`,
      metric: new cloudwatch.Metric({
        namespace: "AWS/ECS",
        metricName: "MemoryUtilization",
        dimensionsMap: {
          ClusterName: props.ecsClusterName,
          ServiceName: props.ecsServiceName,
        },
        statistic: "Average",
        period: cdk.Duration.minutes(5),
      }),
      threshold: 80,
      evaluationPeriods: 2,
      comparisonOperator:
        cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    memoryAlarm.addAlarmAction(
      new cdk.aws_cloudwatch_actions.SnsAction(this.alarmTopic)
    );

    // Create CloudWatch Dashboard (costs $3/month)
    if (props.enableDashboard) {
      this.dashboard = new cloudwatch.Dashboard(this, "Dashboard", {
        dashboardName: `${props.envName}-infrastructure`,
      });

      // Add ECS metrics widget
      this.dashboard.addWidgets(
        new cloudwatch.GraphWidget({
          title: "ECS CPU & Memory Utilization",
          left: [
            new cloudwatch.Metric({
              namespace: "AWS/ECS",
              metricName: "CPUUtilization",
              dimensionsMap: {
                ClusterName: props.ecsClusterName,
                ServiceName: props.ecsServiceName,
              },
              statistic: "Average",
              label: "CPU %",
            }),
          ],
          right: [
            new cloudwatch.Metric({
              namespace: "AWS/ECS",
              metricName: "MemoryUtilization",
              dimensionsMap: {
                ClusterName: props.ecsClusterName,
                ServiceName: props.ecsServiceName,
              },
              statistic: "Average",
              label: "Memory %",
            }),
          ],
        })
      );

      // Add deployment metrics widget
      this.dashboard.addWidgets(
        new cloudwatch.GraphWidget({
          title: "Deployment Success vs Failures",
          left: [
            new cloudwatch.Metric({
              namespace: "Deployments",
              metricName: "DeploymentSuccess",
              statistic: "Sum",
              label: "Successful",
              color: cloudwatch.Color.GREEN,
            }),
            new cloudwatch.Metric({
              namespace: "Deployments",
              metricName: "DeploymentFailures",
              statistic: "Sum",
              label: "Failed",
              color: cloudwatch.Color.RED,
            }),
          ],
        })
      );

      // Add task count widget
      this.dashboard.addWidgets(
        new cloudwatch.GraphWidget({
          title: "ECS Running Tasks",
          left: [
            new cloudwatch.Metric({
              namespace: "AWS/ECS",
              metricName: "RunningTasksCount",
              dimensionsMap: {
                ClusterName: props.ecsClusterName,
                ServiceName: props.ecsServiceName,
              },
              statistic: "Average",
              label: "Running Tasks",
            }),
          ],
        })
      );
    }

    // CloudFormation outputs
    new cdk.CfnOutput(this, "AlarmTopicArn", {
      value: this.alarmTopic.topicArn,
      description: "SNS Topic ARN for alarms",
      exportName: `${props.envName}-alarm-topic-arn`,
    });

    new cdk.CfnOutput(this, "DeploymentLogGroup", {
      value: deploymentLogGroup.logGroupName,
      description: "Log group for deployment tracking",
      exportName: `${props.envName}-deployment-log-group`,
    });

    if (this.dashboard) {
      new cdk.CfnOutput(this, "DashboardUrl", {
        value: `https://console.aws.amazon.com/cloudwatch/home?region=${
          cdk.Stack.of(this).region
        }#dashboards:name=${this.dashboard.dashboardName}`,
        description: "CloudWatch Dashboard URL",
      });
    }
  }
}
