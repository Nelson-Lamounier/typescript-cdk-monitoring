/** @format */

/**
 * Shared Template Helper Utilities
 *
 * Common functions for working with CDK Template assertions
 * Used across all security and unit test files
 */

import { Template } from "aws-cdk-lib/assertions";

import type { ResourceWithId } from "./types";

/**
 * Get resources of a specific type from a template
 */
export const getResources = (
  template: Template,
  resourceType: string
): unknown[] => {
  return Object.values(template.findResources(resourceType));
};

/**
 * Get resources with their logical IDs
 */
export const getResourcesWithIds = (
  template: Template,
  resourceType: string
): ResourceWithId[] => {
  const resources = template.findResources(resourceType);
  return Object.entries(resources).map(([logicalId, resource]) => ({
    logicalId,
    resource,
  }));
};

/**
 * Extract Properties from a CloudFormation resource
 */
export const getResourceProperties = <T = Record<string, unknown>>(
  resource: unknown
): T => {
  return (resource as Record<string, T>).Properties;
};

/**
 * Extract a specific property from a resource
 */
export const getResourceProperty = <T = unknown>(
  resource: unknown,
  propertyName: string
): T | undefined => {
  const properties = getResourceProperties(resource);
  return (properties as Record<string, T>)[propertyName];
};

/**
 * Get CloudFormation outputs from template
 */
export const getOutputs = (template: Template): Record<string, unknown> => {
  const templateJson = template.toJSON();
  return (templateJson.Outputs || {}) as Record<string, unknown>;
};

/**
 * Get deletion policy from a resource
 */
export const getDeletionPolicy = (resource: unknown): string | undefined => {
  return (resource as Record<string, string | undefined>).DeletionPolicy;
};

/**
 * Get update policy from a resource (typically ASG)
 */
export const getUpdatePolicy = (
  resource: unknown
): Record<string, unknown> | undefined => {
  return (resource as Record<string, Record<string, unknown>>).UpdatePolicy;
};

/**
 * Stringify resource for pattern matching
 */
export const stringifyResource = (resource: unknown): string => {
  return JSON.stringify(resource);
};

/**
 * Get IAM roles from template
 */
export const getRoles = (template: Template): unknown[] => {
  return getResources(template, "AWS::IAM::Role");
};

/**
 * Get IAM policies from template
 */
export const getPolicies = (template: Template): unknown[] => {
  return getResources(template, "AWS::IAM::Policy");
};

/**
 * Get SSM associations from template
 */
export const getAssociations = (template: Template): unknown[] => {
  return getResources(template, "AWS::SSM::Association");
};

/**
 * Get launch templates from template
 */
export const getLaunchTemplates = (template: Template): unknown[] => {
  return getResources(template, "AWS::EC2::LaunchTemplate");
};

/**
 * Get Auto Scaling Groups from template
 */
export const getAutoScalingGroups = (template: Template): unknown[] => {
  return getResources(template, "AWS::AutoScaling::AutoScalingGroup");
};

/**
 * Get log groups from template
 */
export const getLogGroups = (template: Template): unknown[] => {
  return getResources(template, "AWS::Logs::LogGroup");
};

/**
 * Get ECS clusters from template
 */
export const getClusters = (template: Template): unknown[] => {
  return getResources(template, "AWS::ECS::Cluster");
};

/**
 * Get EventBridge rules from template
 */
export const getEventBridgeRules = (template: Template): unknown[] => {
  return getResources(template, "AWS::Events::Rule");
};

/**
 * Get task definitions from template
 */
export const getTaskDefinitions = (template: Template): unknown[] => {
  return getResources(template, "AWS::ECS::TaskDefinition");
};

/**
 * Get security groups from template
 */
export const getSecurityGroups = (template: Template): unknown[] => {
  return getResources(template, "AWS::EC2::SecurityGroup");
};

/**
 * Get security group ingress rules from template
 */
export const getSecurityGroupIngressRules = (template: Template): unknown[] => {
  return getResources(template, "AWS::EC2::SecurityGroupIngress");
};

/**
 * Get subnets from template
 */
export const getSubnets = (template: Template): unknown[] => {
  return getResources(template, "AWS::EC2::Subnet");
};

/**
 * Get NAT gateways from template
 */
export const getNatGateways = (template: Template): unknown[] => {
  return getResources(template, "AWS::EC2::NatGateway");
};

/**
 * Get EFS file systems from template
 */
export const getFileSystems = (template: Template): unknown[] => {
  return getResources(template, "AWS::EFS::FileSystem");
};

/**
 * Get EFS access points from template
 */
export const getAccessPoints = (template: Template): unknown[] => {
  return getResources(template, "AWS::EFS::AccessPoint");
};