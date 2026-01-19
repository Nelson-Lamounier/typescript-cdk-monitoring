/** @format */

import * as cdk from "aws-cdk-lib";

import { NetworkingStack } from "../../lib/stacks/foundation/networking-stack";
import { WebappEcrStack } from "../../lib/stacks/webapp/ecr-stack";
import { EnvironmentConfig } from "../../config/environments";

/**
 * Create all webapp stacks for a single environment
 *
 * Architecture:
 * 1. WebappEcrStack - Container registry (ECR repository)
 *
 * Future stacks (to be added):
 * 2. WebappInfraStack - Compute layer (EC2, ECS cluster, ALB)
 * 3. WebappServiceStack - Application layer (webapp containers)
 *
 * Dependencies:
 * - Requires NetworkingStack (VPC, subnets, security groups)
 * - ECR stack is standalone (no dependencies on other webapp stacks yet)
 *
 * @param app CDK app
 * @param envName Environment name (e.g., 'development', 'staging', 'production')
 * @param envConfig Environment configuration
 * @param networkingStack The networking stack (for VPC reference)
 * @param stackProps Stack properties including env (account/region)
 * @param projectName Project name (default: 'webapp')
 */
export function createWebappStacks(
  app: cdk.App,
  envName: string,
  envConfig: EnvironmentConfig,
  networkingStack: NetworkingStack,
  stackProps: cdk.StackProps,
  projectName: string = "webapp"
): {
  ecrStack: WebappEcrStack;
} {
  const stackNamePrefix = `${envName}-Webapp`;

  // ============================================================================
  // 1. WEBAPP ECR STACK (Container Registry)
  // ============================================================================

  const ecrStack = new WebappEcrStack(app, `${stackNamePrefix}Ecr`, {
    ...stackProps,
    envName,
    projectName,
    envConfig,
    pipelineAccount: envConfig.pipelineAccount,
  });

  // Add dependency on networking (for consistency, though ECR doesn't require VPC)
  ecrStack.addDependency(networkingStack);

  return {
    ecrStack,
  };
}
