/** @format */

import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

export interface EventBridgeCrossAccountRoleProps {
  /**
   * Environment name for tagging
   */
  envName: string;

  /**
   * Target event bus ARN in the pipeline account
   */
  targetEventBusArn: string;
}

/**
 * EventBridge Cross-Account IAM Role
 *
 * Creates an IAM role that allows EventBridge to send events to another account's event bus.
 *
 * This role is used by EventBridge rules in application accounts to forward events
 * to the centralized monitoring in the pipeline account.
 *
 * Permissions granted:
 * - PutEvents to target event bus
 *
 * Usage:
 * ```typescript
 * const role = new EventBridgeCrossAccountRole(this, 'EventBridgeRole', {
 *   envName: 'development',
 *   targetEventBusArn: 'arn:aws:events:eu-west-1:123456789012:event-bus/default',
 * });
 * ```
 */
export class EventBridgeCrossAccountRole extends Construct {
  public readonly role: iam.Role;
  public readonly roleArn: string;

  constructor(
    scope: Construct,
    id: string,
    props: EventBridgeCrossAccountRoleProps
  ) {
    super(scope, id);

    // Create IAM role for EventBridge to send events cross-account
    this.role = new iam.Role(this, "Role", {
      roleName: `eventbridge-cross-account-${props.envName}`,
      assumedBy: new iam.ServicePrincipal("events.amazonaws.com"),
      description: `Allow EventBridge to send events from ${props.envName} to pipeline account`,
    });

    // Grant permission to put events to target event bus
    this.role.addToPolicy(
      new iam.PolicyStatement({
        sid: "PutEventsToTargetBus",
        effect: iam.Effect.ALLOW,
        actions: ["events:PutEvents"],
        resources: [props.targetEventBusArn],
      })
    );

    this.roleArn = this.role.roleArn;

    // ========================================================================
    // OUTPUTS
    // ========================================================================
    new cdk.CfnOutput(this, "RoleArn", {
      value: this.roleArn,
      description: `EventBridge cross-account role ARN for ${props.envName}`,
      exportName: `${props.envName}-eventbridge-cross-account-role-arn`,
    });

    // ========================================================================
    // TAGS
    // ========================================================================
    cdk.Tags.of(this).add("Environment", props.envName);
    cdk.Tags.of(this).add("Purpose", "EventBridgeCrossAccount");
    cdk.Tags.of(this).add("ManagedBy", "CDK");
  }
}
