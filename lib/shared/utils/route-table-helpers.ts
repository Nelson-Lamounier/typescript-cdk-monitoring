/** @format */

import * as ec2 from "aws-cdk-lib/aws-ec2";

/**
 * Get unique route tables from VPC subnets
 *
 * Extracts route tables from VPC subnets and deduplicates them.
 * This is useful when updating routes for VPC peering, as multiple
 * subnets may share the same route table.
 *
 * @param vpc - VPC to extract route tables from
 * @returns Array of unique route tables
 *
 * @example
 * ```typescript
 * const uniqueRouteTables = getUniqueRouteTables(vpc);
 * uniqueRouteTables.forEach((routeTable) => {
 *   // Add route to each unique route table
 * });
 * ```
 */
export function getUniqueRouteTables(vpc: ec2.IVpc): ec2.IRouteTable[] {
  // Collect route tables from all subnets
  const allSubnets = [
    ...vpc.privateSubnets,
    ...vpc.publicSubnets,
    ...vpc.isolatedSubnets,
  ];

  const routeTables = allSubnets.map((subnet) => subnet.routeTable);

  // Deduplicate by route table ID
  const seenIds = new Set<string>();
  const uniqueRouteTables: ec2.IRouteTable[] = [];

  for (const routeTable of routeTables) {
    const routeTableId = routeTable.routeTableId;
    if (!seenIds.has(routeTableId)) {
      seenIds.add(routeTableId);
      uniqueRouteTables.push(routeTable);
    }
  }

  return uniqueRouteTables;
}
