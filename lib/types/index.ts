/** @format */

/**
 * Configuration for cross-account monitoring targets
 */
export interface CrossAccountTarget {
  envName: string;
  accountId?: string;
  roleArn?: string;
  targetType: string;
  port: number;
  privateIp?: string;
  useEc2ServiceDiscovery?: boolean;
  metricsPath?: string;
}
