/** @format */

import * as cdk from "aws-cdk-lib";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as sns from "aws-cdk-lib/aws-sns";
import * as logs from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";

import { EventBridgeCrossAccountRole } from "../../iam";

export interface EventBridgeConstructProps {
  envName: string;
  pipelineAccountId?: string; // For target accounts to send events to pipeline
  targetAccountIds?: string[]; // For pipeline account to receive from targets
  alarmTopic: sns.Topic;
  isPipelineAccount?: boolean; // True if this is the central monitoring account
}

export class EventBridgeConstruct extends Construct {
  public readonly eventBus: events.IEventBus;

  constructor(scope: Construct, id: string, props: EventBridgeConstructProps) {
    super(scope, id);

    if (props.isPipelineAccount) {
      // PIPELINE ACCOUNT: Create central event bus to receive events
      this.eventBus = this.createCentralEventBus(props);
    } else {
      // TARGET ACCOUNTS: Create rules to send events to pipeline account
      this.eventBus = this.createTargetAccountRules(props);
    }
  }

  private createCentralEventBus(
    props: EventBridgeConstructProps
  ): events.EventBus {
    // Create custom event bus for cross-account events
    const eventBus = new events.EventBus(this, "CentralEventBus", {
      eventBusName: "cross-account-monitoring",
    });

    // Grant target accounts permission to put events
    if (props.targetAccountIds && props.targetAccountIds.length > 0) {
      new events.CfnEventBusPolicy(this, "CrossAccountPolicy", {
        statementId: "AllowTargetAccountsToPutEvents",
        eventBusName: eventBus.eventBusName,
        statement: {
          Effect: "Allow",
          Principal: {
            AWS: props.targetAccountIds.map(
              (accountId) => `arn:aws:iam::${accountId}:root`
            ),
          },
          Action: "events:PutEvents",
          Resource: eventBus.eventBusArn,
        },
      });
    }

    // Create log group for all events
    const eventLogGroup = new logs.LogGroup(this, "EventLogGroup", {
      logGroupName: "/aws/events/cross-account-monitoring",
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Rule 1: ECS Task State Changes (all accounts)
    const ecsTaskRule = new events.Rule(this, "EcsTaskStateChangeRule", {
      eventBus: eventBus,
      ruleName: "ecs-task-state-changes",
      description: "Capture ECS task state changes from all accounts",
      eventPattern: {
        source: ["aws.ecs"],
        detailType: ["ECS Task State Change"],
        detail: {
          lastStatus: ["STOPPED"],
          stoppedReason: [{ exists: true }],
        },
      },
    });

    // Send to SNS for alerts
    ecsTaskRule.addTarget(new targets.SnsTopic(props.alarmTopic));
    // Log all events
    ecsTaskRule.addTarget(new targets.CloudWatchLogGroup(eventLogGroup));

    // Rule 2: ECS Service Deployment State Changes
    const ecsDeploymentRule = new events.Rule(
      this,
      "EcsDeploymentStateChangeRule",
      {
        eventBus: eventBus,
        ruleName: "ecs-deployment-state-changes",
        description: "Capture ECS deployment events from all accounts",
        eventPattern: {
          source: ["aws.ecs"],
          detailType: ["ECS Deployment State Change"],
        },
      }
    );

    ecsDeploymentRule.addTarget(new targets.SnsTopic(props.alarmTopic));
    ecsDeploymentRule.addTarget(new targets.CloudWatchLogGroup(eventLogGroup));

    // Rule 3: CloudFormation Stack Events (deployments)
    const cfnStackRule = new events.Rule(this, "CloudFormationStackRule", {
      eventBus: eventBus,
      ruleName: "cloudformation-stack-events",
      description: "Capture CloudFormation stack events from all accounts",
      eventPattern: {
        source: ["aws.cloudformation"],
        detailType: ["CloudFormation Stack Status Change"],
        detail: {
          "status-details": {
            status: [
              "CREATE_COMPLETE",
              "CREATE_FAILED",
              "UPDATE_COMPLETE",
              "UPDATE_FAILED",
              "DELETE_COMPLETE",
              "DELETE_FAILED",
              "ROLLBACK_COMPLETE",
              "ROLLBACK_FAILED",
            ],
          },
        },
      },
    });

    cfnStackRule.addTarget(new targets.CloudWatchLogGroup(eventLogGroup));

    // Rule 4: ECR Image Push Events
    const ecrPushRule = new events.Rule(this, "EcrImagePushRule", {
      eventBus: eventBus,
      ruleName: "ecr-image-push-events",
      description: "Capture ECR image push events from all accounts",
      eventPattern: {
        source: ["aws.ecr"],
        detailType: ["ECR Image Action"],
        detail: {
          "action-type": ["PUSH"],
          result: ["SUCCESS"],
        },
      },
    });

    ecrPushRule.addTarget(new targets.CloudWatchLogGroup(eventLogGroup));

    // Rule 5: Auto Scaling Events
    const asgRule = new events.Rule(this, "AutoScalingRule", {
      eventBus: eventBus,
      ruleName: "autoscaling-events",
      description: "Capture Auto Scaling events from all accounts",
      eventPattern: {
        source: ["aws.autoscaling"],
        detailType: [
          "EC2 Instance Launch Successful",
          "EC2 Instance Launch Unsuccessful",
          "EC2 Instance Terminate Successful",
          "EC2 Instance Terminate Unsuccessful",
        ],
      },
    });

    asgRule.addTarget(new targets.CloudWatchLogGroup(eventLogGroup));

    // Rule 6: Security Events (IAM, Security Groups)
    const securityRule = new events.Rule(this, "SecurityEventsRule", {
      eventBus: eventBus,
      ruleName: "security-events",
      description: "Capture security-related events from all accounts",
      eventPattern: {
        source: ["aws.iam", "aws.ec2"],
        detailType: [
          "AWS API Call via CloudTrail",
          "AWS Console Sign In via CloudTrail",
        ],
        detail: {
          eventName: [
            "CreateAccessKey",
            "DeleteAccessKey",
            "CreateUser",
            "DeleteUser",
            "AuthorizeSecurityGroupIngress",
            "RevokeSecurityGroupIngress",
          ],
        },
      },
    });

    securityRule.addTarget(new targets.SnsTopic(props.alarmTopic));
    securityRule.addTarget(new targets.CloudWatchLogGroup(eventLogGroup));

    // CloudFormation Outputs
    new cdk.CfnOutput(this, "EventBusArn", {
      value: eventBus.eventBusArn,
      description: "Central EventBridge bus ARN",
      exportName: "central-event-bus-arn",
    });

    new cdk.CfnOutput(this, "EventBusName", {
      value: eventBus.eventBusName,
      description: "Central EventBridge bus name",
      exportName: "central-event-bus-name",
    });

    return eventBus;
  }

  private createTargetAccountRules(
    props: EventBridgeConstructProps
  ): events.IEventBus {
    if (!props.pipelineAccountId) {
      throw new Error(
        "pipelineAccountId is required for target account configuration"
      );
    }

    // Use default event bus in target accounts
    const eventBus = events.EventBus.fromEventBusArn(
      this,
      "DefaultEventBus",
      `arn:aws:events:${cdk.Stack.of(this).region}:${
        cdk.Stack.of(this).account
      }:event-bus/default`
    );

    // Create IAM role for EventBridge to send events cross-account using centralized construct
    const targetEventBusArn = `arn:aws:events:${cdk.Stack.of(this).region}:${
      props.pipelineAccountId
    }:event-bus/cross-account-monitoring`;

    const crossAccountRoleConstruct = new EventBridgeCrossAccountRole(
      this,
      "EventBridgeCrossAccountRole",
      {
        envName: props.envName,
        targetEventBusArn,
      }
    );

    const crossAccountRole = crossAccountRoleConstruct.role;

    // Rule 1: Forward ECS events to pipeline account
    const ecsRule = new events.Rule(this, "ForwardEcsEvents", {
      ruleName: `forward-ecs-events-${props.envName}`,
      description: `Forward ECS events from ${props.envName} to pipeline account`,
      eventPattern: {
        source: ["aws.ecs"],
        detailType: ["ECS Task State Change", "ECS Deployment State Change"],
      },
    });

    ecsRule.addTarget(
      new targets.EventBus(
        events.EventBus.fromEventBusArn(
          this,
          "PipelineEventBus",
          `arn:aws:events:${cdk.Stack.of(this).region}:${
            props.pipelineAccountId
          }:event-bus/cross-account-monitoring`
        ),
        {
          role: crossAccountRole,
        }
      )
    );

    // Rule 2: Forward CloudFormation events
    const cfnRule = new events.Rule(this, "ForwardCloudFormationEvents", {
      ruleName: `forward-cfn-events-${props.envName}`,
      description: `Forward CloudFormation events from ${props.envName} to pipeline account`,
      eventPattern: {
        source: ["aws.cloudformation"],
        detailType: ["CloudFormation Stack Status Change"],
      },
    });

    cfnRule.addTarget(
      new targets.EventBus(
        events.EventBus.fromEventBusArn(
          this,
          "PipelineEventBusCfn",
          `arn:aws:events:${cdk.Stack.of(this).region}:${
            props.pipelineAccountId
          }:event-bus/cross-account-monitoring`
        ),
        {
          role: crossAccountRole,
        }
      )
    );

    // Rule 3: Forward ECR events
    const ecrRule = new events.Rule(this, "ForwardEcrEvents", {
      ruleName: `forward-ecr-events-${props.envName}`,
      description: `Forward ECR events from ${props.envName} to pipeline account`,
      eventPattern: {
        source: ["aws.ecr"],
        detailType: ["ECR Image Action"],
      },
    });

    ecrRule.addTarget(
      new targets.EventBus(
        events.EventBus.fromEventBusArn(
          this,
          "PipelineEventBusEcr",
          `arn:aws:events:${cdk.Stack.of(this).region}:${
            props.pipelineAccountId
          }:event-bus/cross-account-monitoring`
        ),
        {
          role: crossAccountRole,
        }
      )
    );

    // Rule 4: Forward Auto Scaling events
    const asgRule = new events.Rule(this, "ForwardAutoScalingEvents", {
      ruleName: `forward-asg-events-${props.envName}`,
      description: `Forward Auto Scaling events from ${props.envName} to pipeline account`,
      eventPattern: {
        source: ["aws.autoscaling"],
      },
    });

    asgRule.addTarget(
      new targets.EventBus(
        events.EventBus.fromEventBusArn(
          this,
          "PipelineEventBusAsg",
          `arn:aws:events:${cdk.Stack.of(this).region}:${
            props.pipelineAccountId
          }:event-bus/cross-account-monitoring`
        ),
        {
          role: crossAccountRole,
        }
      )
    );

    // CloudFormation Outputs
    new cdk.CfnOutput(this, "CrossAccountRoleArn", {
      value: crossAccountRole.roleArn,
      description: "IAM role for cross-account EventBridge",
      exportName: `${props.envName}-eventbridge-role-arn`,
    });

    return eventBus;
  }
}
