/** @format */

// infrastructure/scripts/deployment/utils/aws-helpers.ts
import {
  CloudFormationClient,
  DeleteChangeSetCommand,
  DescribeStackEventsCommand,
  DescribeStacksCommand,
  ListChangeSetsCommand,
} from "@aws-sdk/client-cloudformation";

import { Logger } from "./logger.js";
import type { BootstrapInfo } from "./types.js";

export class AWSHelpers {
  private cfnClient: CloudFormationClient;

  constructor(region: string) {
    this.cfnClient = new CloudFormationClient({ region });
  }

  async getBootstrapInfo(_accountId: string): Promise<BootstrapInfo> {
    try {
      const command = new DescribeStacksCommand({
        StackName: "CDKToolkit",
      });

      const response = await this.cfnClient.send(command);
      const stack = response.Stacks?.[0];

      if (!stack) {
        return { exists: false, needsUpgrade: true };
      }

      const versionParam = stack.Parameters?.find(
        (p: { ParameterKey?: string }) => p.ParameterKey === "BootstrapVersion"
      );

      const version = versionParam?.ParameterValue
        ? parseInt(versionParam.ParameterValue, 10)
        : undefined;

      const needsUpgrade = version ? version < 30 : true;

      return { exists: true, version, needsUpgrade };
    } catch (error: any) {
      if (
        error.name === "ValidationError" &&
        error.message.includes("does not exist")
      ) {
        return { exists: false, needsUpgrade: true };
      }
      throw error;
    }
  }

  async cleanupChangeSets(stackName: string): Promise<void> {
    try {
      // Check if stack exists
      const describeCommand = new DescribeStacksCommand({
        StackName: stackName,
      });

      await this.cfnClient.send(describeCommand);

      // List change sets
      const listCommand = new ListChangeSetsCommand({
        StackName: stackName,
      });

      const changeSets = await this.cfnClient.send(listCommand);

      if (!changeSets.Summaries || changeSets.Summaries.length === 0) {
        Logger.info("No existing change sets found");
        return;
      }

      Logger.info(
        `Found ${changeSets.Summaries.length} change set(s) to clean up`
      );

      // Delete each change set
      for (const cs of changeSets.Summaries) {
        if (cs.ChangeSetName) {
          Logger.info(`Deleting change set: ${cs.ChangeSetName}`);
          const deleteCommand = new DeleteChangeSetCommand({
            StackName: stackName,
            ChangeSetName: cs.ChangeSetName,
          });

          await this.cfnClient.send(deleteCommand).catch(() => {
            // Ignore errors - change set may already be deleted
          });
        }
      }

      // Wait for deletions to complete
      await new Promise((resolve) => setTimeout(resolve, 2000));
      Logger.success("Change set cleanup completed");
    } catch (error: any) {
      if (error.name === "ValidationError") {
        Logger.info("Stack does not exist yet, skipping change set cleanup");
        return;
      }
      throw error;
    }
  }

  async getStackEvents(
    stackName: string,
    limit: number = 10
  ): Promise<string[]> {
    try {
      const command = new DescribeStackEventsCommand({
        StackName: stackName,
      });

      const response = await this.cfnClient.send(command);
      const events = response.StackEvents?.slice(0, limit) || [];

      return events.map(
        (event: {
          Timestamp?: Date;
          ResourceStatus?: string;
          ResourceType?: string;
          ResourceStatusReason?: string;
        }) =>
          `${event.Timestamp?.toISOString()} - ${event.ResourceStatus} - ${
            event.ResourceType
          } - ${event.ResourceStatusReason || ""}`
      );
    } catch {
      return [];
    }
  }
}
