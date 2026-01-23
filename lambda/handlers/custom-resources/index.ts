/** @format */

/**
 * Custom Resource Handlers Barrel Export
 *
 * CloudFormation Custom Resource Lambda handlers for operations
 * that require custom logic beyond standard CloudFormation resources.
 */

// VPC Peering handlers
export * from "./vpc-peering-create-accept";
export * from "./vpc-peering-routes";

// EFS handlers
export * from "./efs-initialisation";
