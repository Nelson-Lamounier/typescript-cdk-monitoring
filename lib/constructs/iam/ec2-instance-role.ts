/** @format */

import * as iam from "aws-cdk-lib/aws-iam";
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";

export interface Ec2InstanceRoleProps {
  envName: string;
  projectName?: string;
  attachEcsInstancePolicy?: boolean;
}

/**
 * Centralised EC2 instance role construct for ECS/SSM-enabled instances.
 */
export class Ec2InstanceRole extends Construct {
  public readonly role: iam.Role;

  constructor(scope: Construct, id: string, props: Ec2InstanceRoleProps) {
    super(scope, id);

    const { envName, projectName, attachEcsInstancePolicy = false } = props;

    const managedPolicies = [
      iam.ManagedPolicy.fromAwsManagedPolicyName(
        "AmazonSSMManagedInstanceCore"
      ),
      iam.ManagedPolicy.fromAwsManagedPolicyName("CloudWatchAgentServerPolicy"),
    ];

    if (attachEcsInstancePolicy) {
      managedPolicies.push(
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AmazonEC2ContainerServiceforEC2Role"
        )
      );
    }

    this.role = new iam.Role(this, "Role", {
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
      managedPolicies,
      description: `EC2 instance role for ${envName}`,
    });

    cdk.Tags.of(this.role).add("Environment", envName);
    cdk.Tags.of(this.role).add("ManagedBy", "CDK");
    if (projectName) {
      cdk.Tags.of(this.role).add("Project", projectName);
    }
  }
}
