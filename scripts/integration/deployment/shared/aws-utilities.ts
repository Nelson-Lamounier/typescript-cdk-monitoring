/** @format */

// infrastructure/scripts/deployment/shared/aws-utilities.ts

import {
  CloudFormationClient,
  DescribeStacksCommand,
  Stack,
} from "@aws-sdk/client-cloudformation";
import {
  SSMClient,
  GetParameterCommand,
  DescribeDocumentCommand,
  DescribeAutomationExecutionsCommand,
  ListAssociationsCommand,
  DescribeAssociationExecutionsCommand,
  DescribeInstanceInformationCommand,
} from "@aws-sdk/client-ssm";
import {
  EFSClient,
  DescribeFileSystemsCommand,
  DescribeMountTargetsCommand,
  DescribeAccessPointsCommand,
} from "@aws-sdk/client-efs";
import {
  EC2Client,
  DescribeSecurityGroupsCommand,
  DescribeVpcsCommand,
  DescribeSubnetsCommand,
  DescribeInstanceStatusCommand,
} from "@aws-sdk/client-ec2";
import {
  ECSClient,
  DescribeClustersCommand,
  DescribeServicesCommand,
  DescribeTasksCommand,
  ListTasksCommand,
  ListContainerInstancesCommand,
  DescribeContainerInstancesCommand,
} from "@aws-sdk/client-ecs";
import {
  ElasticLoadBalancingV2Client,
  DescribeLoadBalancersCommand,
  DescribeTargetGroupsCommand,
  DescribeListenersCommand,
  DescribeTargetHealthCommand,
} from "@aws-sdk/client-elastic-load-balancing-v2";

import { Logger } from "../utils/logger";

export interface StackOutputs {
  [key: string]: string | undefined;
}

export interface StackInfo {
  status: string;
  outputs: StackOutputs;
  stack: Stack;
}

export interface ParameterResult {
  exists: boolean;
  value?: string;
  valueSize?: number;
}

export interface DocumentInfo {
  status: string;
  documentType?: string;
  documentVersion?: string;
}

export interface AutomationExecution {
  id: string;
  status: string;
  startTime?: Date;
}

export class CloudFormationUtility {
  /**
   * Retrieves CloudFormation stack information with optional output filtering
   */
  static async getStackStatus(
    client: CloudFormationClient,
    stackName: string,
    outputKeys?: string[]
  ): Promise<StackInfo | null> {
    try {
      const response = await client.send(
        new DescribeStacksCommand({ StackName: stackName })
      );
      
      const stack = response.Stacks?.[0];
      if (!stack) return null;

      const outputs: StackOutputs = {};
      
      if (outputKeys) {
        stack.Outputs?.forEach((output) => {
          if (outputKeys.includes(output.OutputKey || "")) {
            outputs[output.OutputKey || ""] = output.OutputValue;
          }
        });
      } else {
        stack.Outputs?.forEach((output) => {
          if (output.OutputKey) {
            outputs[output.OutputKey] = output.OutputValue;
          }
        });
      }

      return {
        status: stack.StackStatus || "UNKNOWN",
        outputs,
        stack,
      };
    } catch (error: any) {
      if (error.name === "ValidationError" || error.name === "DoesNotExistException") {
        return null;
      }
      throw error;
    }
  }

  /**
   * Checks if a stack is in a ready state (CREATE_COMPLETE or UPDATE_COMPLETE)
   */
  static isStackReady(status: string): boolean {
    return ["CREATE_COMPLETE", "UPDATE_COMPLETE"].includes(status);
  }

  /**
   * Checks if a stack is in a failed state
   */
  static isStackFailed(status: string): boolean {
    return status.includes("FAILED") || status.includes("ROLLBACK");
  }
}

export class SSMUtility {
  /**
   * Retrieves a single SSM parameter
   */
  static async getParameter(
    client: SSMClient,
    paramName: string
  ): Promise<ParameterResult> {
    try {
      const response = await client.send(
        new GetParameterCommand({ Name: paramName })
      );
      
      return {
        exists: true,
        value: response.Parameter?.Value,
        valueSize: response.Parameter?.Value?.length,
      };
    } catch (error: any) {
      if (error.name === "ParameterNotFound") {
        return { exists: false };
      }
      throw error;
    }
  }

  /**
   * Checks multiple SSM parameters in parallel
   */
  static async checkParameterBatch(
    client: SSMClient,
    params: string[]
  ): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();
    
    await Promise.all(
      params.map(async (param) => {
        const result = await this.getParameter(client, param);
        results.set(param, result.exists);
      })
    );
    
    return results;
  }

  /**
   * Validates a group of parameters and returns missing ones
   */
  static async validateParameters(
    client: SSMClient,
    params: string[],
    logMissing: boolean = true
  ): Promise<{ allExist: boolean; missing: string[]; existing: string[] }> {
    const results = await this.checkParameterBatch(client, params);
    const missing: string[] = [];
    const existing: string[] = [];

    results.forEach((exists, param) => {
      if (exists) {
        existing.push(param);
      } else {
        missing.push(param);
        if (logMissing) {
          Logger.error(`Parameter missing: ${param}`);
        }
      }
    });

    return {
      allExist: missing.length === 0,
      missing,
      existing,
    };
  }

  /**
   * Retrieves SSM document status
   */
  static async getDocumentStatus(
    client: SSMClient,
    documentName: string
  ): Promise<DocumentInfo | null> {
    try {
      const response = await client.send(
        new DescribeDocumentCommand({ Name: documentName })
      );
      
      return {
        status: response.Document?.Status || "UNKNOWN",
        documentType: response.Document?.DocumentType,
        documentVersion: response.Document?.DocumentVersion,
      };
    } catch (error: any) {
      if (error.name === "InvalidDocument") {
        return null;
      }
      throw error;
    }
  }

  /**
   * Retrieves recent automation executions for a document
   */
  static async getAutomationExecutions(
    client: SSMClient,
    documentName: string,
    maxResults: number = 5
  ): Promise<AutomationExecution[]> {
    try {
      const response = await client.send(
        new DescribeAutomationExecutionsCommand({
          Filters: [
            { Key: "DocumentNamePrefix", Values: [documentName] },
          ],
          MaxResults: maxResults,
        })
      );

      return (response.AutomationExecutionMetadataList || []).map((exec) => ({
        id: exec.AutomationExecutionId || "",
        status: exec.AutomationExecutionStatus || "UNKNOWN",
        startTime: exec.ExecutionStartTime,
      }));
    } catch {
      return [];
    }
  }

  /**
   * Retrieves SSM associations for a specific document
   */
  static async getAssociations(
    client: SSMClient,
    documentName: string
  ): Promise<any[]> {
    try {
      const response = await client.send(
        new ListAssociationsCommand({
          AssociationFilterList: [
            {
              key: "Name",
              value: documentName,
            },
          ],
        })
      );
      return response.Associations || [];
    } catch (error: any) {
      Logger.warning(`Failed to list associations: ${error.message}`);
      return [];
    }
  }

  /**
   * Retrieves execution status for an SSM association
   */
  static async getAssociationExecutions(
    client: SSMClient,
    associationId: string,
    maxResults: number = 5
  ): Promise<any[]> {
    try {
      const response = await client.send(
        new DescribeAssociationExecutionsCommand({
          AssociationId: associationId,
          MaxResults: maxResults,
        })
      );
      return response.AssociationExecutions || [];
    } catch (error: any) {
      Logger.warning(`Failed to describe association executions: ${error.message}`);
      return [];
    }
  }

  /**
   * Describes instance information for SSM managed instances
   */
  static async describeInstanceInformation(
    client: SSMClient,
    instanceIds: string[]
  ): Promise<any[]> {
    if (!instanceIds || instanceIds.length === 0) {
      return [];
    }

    try {
      const response = await client.send(
        new DescribeInstanceInformationCommand({
          Filters: [
            {
              Key: "InstanceIds",
              Values: instanceIds,
            },
          ],
        })
      );
      return response.InstanceInformationList || [];
    } catch (error: any) {
      Logger.warning(`Failed to describe instance information: ${error.message}`);
      return [];
    }
  }
}

export class EFSUtility {
  /**
   * Retrieves EFS file system information
   */
  static async getFileSystem(
    client: EFSClient,
    fileSystemId: string
  ): Promise<any | null> {
    try {
      const response = await client.send(
        new DescribeFileSystemsCommand({
          FileSystemId: fileSystemId,
        })
      );
      return response.FileSystems?.[0] || null;
    } catch (error: any) {
      Logger.warning(`Failed to describe EFS ${fileSystemId}: ${error.message}`);
      return null;
    }
  }

  /**
   * Retrieves mount targets for an EFS file system
   */
  static async getMountTargets(
    client: EFSClient,
    fileSystemId: string
  ): Promise<any[]> {
    try {
      const response = await client.send(
        new DescribeMountTargetsCommand({
          FileSystemId: fileSystemId,
        })
      );
      return response.MountTargets || [];
    } catch (error: any) {
      Logger.warning(`Failed to describe mount targets for ${fileSystemId}: ${error.message}`);
      return [];
    }
  }

  /**
   * Retrieves access point information
   */
  static async getAccessPoint(
    client: EFSClient,
    accessPointId: string
  ): Promise<any | null> {
    try {
      const response = await client.send(
        new DescribeAccessPointsCommand({
          AccessPointId: accessPointId,
        })
      );
      return response.AccessPoints?.[0] || null;
    } catch (error: any) {
      Logger.warning(`Failed to describe access point ${accessPointId}: ${error.message}`);
      return null;
    }
  }

  /**
   * Checks if EFS resources are ready for use
   */
  static isEfsReady(fileSystem: any, mountTargets: any[], accessPoint: any): boolean {
    const fsReady = fileSystem?.LifeCycleState === "available";
    const mtReady = mountTargets.every((mt) => mt.LifeCycleState === "available");
    const apReady = accessPoint?.LifeCycleState === "available";
    
    return fsReady && mtReady && apReady;
  }
}

export class EC2Utility {
  /**
   * Retrieves security group information
   */
  static async getSecurityGroup(
    client: EC2Client,
    securityGroupId: string
  ): Promise<any | null> {
    try {
      const response = await client.send(
        new DescribeSecurityGroupsCommand({
          GroupIds: [securityGroupId],
        })
      );
      return response.SecurityGroups?.[0] || null;
    } catch (error: any) {
      Logger.warning(`Failed to describe security group ${securityGroupId}: ${error.message}`);
      return null;
    }
  }

  /**
   * Verifies VPC existence
   */
  static async verifyVpc(
    client: EC2Client,
    vpcId: string
  ): Promise<boolean> {
    try {
      const response = await client.send(
        new DescribeVpcsCommand({
          VpcIds: [vpcId],
        })
      );
      return (response.Vpcs?.length ?? 0) > 0;
    } catch {
      return false;
    }
  }

  /**
   * Verifies subnet existence
   */
  static async verifySubnets(
    client: EC2Client,
    subnetIds: string[]
  ): Promise<{ valid: boolean; missing: string[] }> {
    if (!subnetIds || subnetIds.length === 0) {
      return { valid: false, missing: [] };
    }

    try {
      const response = await client.send(
        new DescribeSubnetsCommand({
          SubnetIds: subnetIds,
        })
      );
      
      const returnedIds = new Set(
        (response.Subnets || []).map((subnet) => subnet.SubnetId).filter(Boolean)
      );
      
      const missing = subnetIds.filter((id) => !returnedIds.has(id));
      
      return {
        valid: missing.length === 0,
        missing,
      };
    } catch (error: any) {
      Logger.warning(`Failed to verify subnets: ${error.message}`);
      return { valid: false, missing: subnetIds };
    }
  }

  /**
   * Retrieves instance status information
   */
  static async getInstanceStatus(
    client: EC2Client,
    instanceIds: string[]
  ): Promise<any[]> {
    if (!instanceIds || instanceIds.length === 0) {
      return [];
    }

    try {
      const response = await client.send(
        new DescribeInstanceStatusCommand({
          InstanceIds: instanceIds,
          IncludeAllInstances: true,
        })
      );
      return response.InstanceStatuses || [];
    } catch (error: any) {
      Logger.warning(`Failed to describe instance status: ${error.message}`);
      return [];
    }
  }

  /**
   * Checks if security group has a specific inbound rule
   */
  static hasInboundRule(
    securityGroup: any,
    port: number,
    protocol: string = "tcp"
  ): boolean {
    return securityGroup?.IpPermissions?.some(
      (rule: any) =>
        rule.FromPort === port &&
        rule.ToPort === port &&
        rule.IpProtocol === protocol
    ) || false;
  }
}

export class ECSUtility {
  /**
   * Retrieves ECS cluster information
   */
  static async getCluster(
    client: ECSClient,
    clusterName: string
  ): Promise<any | null> {
    try {
      const response = await client.send(
        new DescribeClustersCommand({
          clusters: [clusterName],
        })
      );
      return response.clusters?.[0] || null;
    } catch (error: any) {
      Logger.warning(`Failed to describe cluster ${clusterName}: ${error.message}`);
      return null;
    }
  }

  /**
   * Retrieves ECS service information
   */
  static async getService(
    client: ECSClient,
    clusterName: string,
    serviceName: string
  ): Promise<any | null> {
    try {
      const response = await client.send(
        new DescribeServicesCommand({
          cluster: clusterName,
          services: [serviceName],
        })
      );
      return response.services?.[0] || null;
    } catch (error: any) {
      Logger.warning(`Failed to describe service ${serviceName}: ${error.message}`);
      return null;
    }
  }

  /**
   * Lists tasks for an ECS service
   */
  static async listTasks(
    client: ECSClient,
    clusterName: string,
    serviceName?: string
  ): Promise<string[]> {
    try {
      const response = await client.send(
        new ListTasksCommand({
          cluster: clusterName,
          serviceName,
        })
      );
      return response.taskArns || [];
    } catch (error: any) {
      Logger.warning(`Failed to list tasks: ${error.message}`);
      return [];
    }
  }

  /**
   * Describes ECS tasks
   */
  static async describeTasks(
    client: ECSClient,
    clusterName: string,
    taskArns: string[]
  ): Promise<any[]> {
    if (!taskArns || taskArns.length === 0) {
      return [];
    }

    try {
      const response = await client.send(
        new DescribeTasksCommand({
          cluster: clusterName,
          tasks: taskArns,
        })
      );
      return response.tasks || [];
    } catch (error: any) {
      Logger.warning(`Failed to describe tasks: ${error.message}`);
      return [];
    }
  }

  /**
   * Checks if ECS cluster is active
   */
  static isClusterActive(cluster: any): boolean {
    return cluster?.status === "ACTIVE";
  }

  /**
   * Checks if ECS service is stable
   */
  static isServiceStable(service: any): boolean {
    return (
      service?.status === "ACTIVE" &&
      service?.runningCount === service?.desiredCount
    );
  }

  /**
   * Lists container instances in a cluster
   */
  static async listContainerInstances(
    client: ECSClient,
    clusterName: string
  ): Promise<string[]> {
    try {
      const response = await client.send(
        new ListContainerInstancesCommand({
          cluster: clusterName,
        })
      );
      return response.containerInstanceArns || [];
    } catch (error: any) {
      Logger.warning(`Failed to list container instances: ${error.message}`);
      return [];
    }
  }

  /**
   * Describes container instances
   */
  static async describeContainerInstances(
    client: ECSClient,
    clusterName: string,
    containerInstanceArns: string[]
  ): Promise<any[]> {
    if (!containerInstanceArns || containerInstanceArns.length === 0) {
      return [];
    }

    try {
      const response = await client.send(
        new DescribeContainerInstancesCommand({
          cluster: clusterName,
          containerInstances: containerInstanceArns,
        })
      );
      return response.containerInstances || [];
    } catch (error: any) {
      Logger.warning(`Failed to describe container instances: ${error.message}`);
      return [];
    }
  }
}

export class ELBUtility {
  /**
   * Retrieves load balancer information
   */
  static async getLoadBalancer(
    client: ElasticLoadBalancingV2Client,
    loadBalancerArn: string
  ): Promise<any | null> {
    try {
      const response = await client.send(
        new DescribeLoadBalancersCommand({
          LoadBalancerArns: [loadBalancerArn],
        })
      );
      return response.LoadBalancers?.[0] || null;
    } catch (error: any) {
      Logger.warning(`Failed to describe load balancer: ${error.message}`);
      return null;
    }
  }

  /**
   * Retrieves target group information
   */
  static async getTargetGroup(
    client: ElasticLoadBalancingV2Client,
    targetGroupArn: string
  ): Promise<any | null> {
    try {
      const response = await client.send(
        new DescribeTargetGroupsCommand({
          TargetGroupArns: [targetGroupArn],
        })
      );
      return response.TargetGroups?.[0] || null;
    } catch (error: any) {
      Logger.warning(`Failed to describe target group: ${error.message}`);
      return null;
    }
  }

  /**
   * Retrieves target health for a target group
   */
  static async getTargetHealth(
    client: ElasticLoadBalancingV2Client,
    targetGroupArn: string
  ): Promise<any[]> {
    try {
      const response = await client.send(
        new DescribeTargetHealthCommand({
          TargetGroupArn: targetGroupArn,
        })
      );
      return response.TargetHealthDescriptions || [];
    } catch (error: any) {
      Logger.warning(`Failed to describe target health: ${error.message}`);
      return [];
    }
  }

  /**
   * Retrieves listeners for a load balancer
   */
  static async getListeners(
    client: ElasticLoadBalancingV2Client,
    loadBalancerArn: string
  ): Promise<any[]> {
    try {
      const response = await client.send(
        new DescribeListenersCommand({
          LoadBalancerArn: loadBalancerArn,
        })
      );
      return response.Listeners || [];
    } catch (error: any) {
      Logger.warning(`Failed to describe listeners: ${error.message}`);
      return [];
    }
  }

  /**
   * Checks if load balancer is active
   */
  static isLoadBalancerActive(loadBalancer: any): boolean {
    return loadBalancer?.State?.Code === "active";
  }

  /**
   * Counts healthy targets in a target group
   */
  static countHealthyTargets(targetHealthDescriptions: any[]): number {
    return targetHealthDescriptions.filter(
      (target) => target.TargetHealth?.State === "healthy"
    ).length;
  }

  /**
   * Retrieves load balancer by DNS name
   */
  static async getLoadBalancerByDns(
    client: ElasticLoadBalancingV2Client,
    dnsName: string
  ): Promise<any | null> {
    try {
      const response = await client.send(
        new DescribeLoadBalancersCommand({})
      );
      return response.LoadBalancers?.find((lb) => lb.DNSName === dnsName) || null;
    } catch (error: any) {
      Logger.warning(`Failed to find load balancer by DNS: ${error.message}`);
      return null;
    }
  }

  /**
   * Retrieves target groups for a load balancer
   */
  static async getTargetGroupsByLoadBalancer(
    client: ElasticLoadBalancingV2Client,
    loadBalancerArn: string
  ): Promise<any[]> {
    try {
      const response = await client.send(
        new DescribeTargetGroupsCommand({
          LoadBalancerArn: loadBalancerArn,
        })
      );
      return response.TargetGroups || [];
    } catch (error: any) {
      Logger.warning(`Failed to get target groups: ${error.message}`);
      return [];
    }
  }
}

/**
 * Generic utility for handling AWS permission errors
 */
export class PermissionUtility {
  static logPermissionWarning(action: string, error: any): void {
    if (!error) {
      return;
    }
    const name = String(error.name || "");
    const message = String(error.message || "");
    const isDenied =
      name.includes("AccessDenied") ||
      name.includes("Unauthorized") ||
      message.includes("AccessDenied") ||
      message.includes("Unauthorized");

    if (isDenied) {
      Logger.warning(`Permission denied for ${action}: ${message}`);
    }
  }

  static isPermissionError(error: any): boolean {
    const name = String(error?.name || "");
    const message = String(error?.message || "");
    return (
      name.includes("AccessDenied") ||
      name.includes("Unauthorized") ||
      message.includes("AccessDenied") ||
      message.includes("Unauthorized")
    );
  }
}