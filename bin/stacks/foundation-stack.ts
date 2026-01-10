/** @format */

import * as cdk from "aws-cdk-lib";

import { NetworkingStack } from "../../lib/stacks/foundation/networking-stack";
import { EnvironmentConfig } from "../../config/environments";

/**
 * Deploy foundation infrastructure (VPC)
 */
export function deployFoundationStacks(
  app: cdk.App,
  config: EnvironmentConfig,
  stackProps: cdk.StackProps
) {
  // Networking Stack (VPC)
  const networkingStack = new NetworkingStack(
    app,
    `${config.envName}-Networking`,
    {
      ...stackProps,
      envName: config.envName,
      projectName: "portfolio",
      vpcCidr: config.vpcCidr,
      maxAzs: 2,
      natGateways: config.natGateways ?? 0,
      enableVpcFlowLogs: true,
      enableVpcEndpoints: true,
    }
  );

  return {
    networkingStack,
  };
}
