/** @format */

/**
 * Cross-account target for Prometheus scraping
 */
export interface CrossAccountTarget {
  envName: string;
  targetType: string;
  port: number;
  privateIp?: string;
  accountId?: string;
  roleArn?: string;
  useEc2ServiceDiscovery?: boolean;
  metricsPath?: string;
  description?: string;
}
