/** @format */

/**
 * Custom Resource Handlers Barrel Export
 *
 * CloudFormation Custom Resource Lambda handlers for operations
 * that require custom logic beyond standard CloudFormation resources.
 */

// VPC Peering handlers
export { handler as vpcPeeringCreateAcceptHandler } from "./vpc-peering-create-accept";
export { handler as vpcPeeringRoutesHandler } from "./vpc-peering-routes";

// EFS handlers
export { handler as efsInitialisationHandler } from "./efs-initialisation";
