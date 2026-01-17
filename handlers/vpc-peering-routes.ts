/**
 * VPC Peering Route Update Lambda Function
 *
 * This Lambda function updates route tables in the peer VPC to route traffic
 * back to the requester VPC. It assumes a role in the peer account to perform
 * the route table updates.
 *
 * Features:
 * - Finds all route tables in peer VPC
 * - Adds routes to requester VPC CIDR via peering connection
 * - Handles route table updates in cross-account scenarios
 * - Removes routes on delete
 *
 * @format
 */

import * as https from "https";
import * as url from "url";

import {
  CloudFormationCustomResourceEvent,
  CloudFormationCustomResourceResponse,
  Context,
} from "aws-lambda";
import {
  EC2Client,
  DescribeRouteTablesCommand,
  CreateRouteCommand,
  DeleteRouteCommand,
  DescribeVpcPeeringConnectionsCommand,
} from "@aws-sdk/client-ec2";
import {
  STSClient,
  AssumeRoleCommand,
} from "@aws-sdk/client-sts";

const ec2Client = new EC2Client({ region: process.env.AWS_REGION });
const stsClient = new STSClient({ region: process.env.AWS_REGION });

export const handler = async (
  event: CloudFormationCustomResourceEvent,
  context: Context
): Promise<CloudFormationCustomResourceResponse> => {
  console.log(
    "VPC Peering Route Update Lambda started",
    JSON.stringify(event, null, 2)
  );

  try {
    const requestType = event.RequestType;
    console.log(`Request type: ${requestType}`);

    let response: CloudFormationCustomResourceResponse;

    if (requestType === "Create" || requestType === "Update") {
      response = await updatePeerRoutes(event, context);
    } else if (requestType === "Delete") {
      response = await deletePeerRoutes(event, context);
    } else {
      throw new Error(`Unknown request type: ${requestType}`);
    }

    await sendResponse(event, context, response);
    return response;
  } catch (error) {
    console.error("Error in handler:", error);
    const physicalResourceId =
      "PhysicalResourceId" in event
        ? event.PhysicalResourceId
        : "route-update-failed";

    const failureResponse: CloudFormationCustomResourceResponse = {
      Status: "FAILED",
      Reason: error instanceof Error ? error.message : String(error),
      PhysicalResourceId: physicalResourceId,
      StackId: event.StackId,
      RequestId: event.RequestId,
      LogicalResourceId: event.LogicalResourceId,
      Data: {},
    };
    await sendResponse(event, context, failureResponse);
    return failureResponse;
  }
};

interface RouteUpdateProperties {
  VpcPeeringConnectionId: string;
  PeerVpcId: string;
  RequesterVpcCidr: string;
  PeerRoleArn: string;
  Region: string;
}

async function updatePeerRoutes(
  event: CloudFormationCustomResourceEvent,
  _context: Context
): Promise<CloudFormationCustomResourceResponse> {
  const props = event.ResourceProperties as unknown as RouteUpdateProperties;
  const {
    VpcPeeringConnectionId,
    PeerVpcId,
    RequesterVpcCidr,
    PeerRoleArn,
    Region,
  } = props;

  // Validate required properties
  if (!VpcPeeringConnectionId || !PeerVpcId || !RequesterVpcCidr || !PeerRoleArn) {
    throw new Error(
      `Missing required properties: VpcPeeringConnectionId=${VpcPeeringConnectionId}, PeerVpcId=${PeerVpcId}, RequesterVpcCidr=${RequesterVpcCidr}, PeerRoleArn=${PeerRoleArn}`
    );
  }

  console.log(
    `Updating routes in peer VPC ${PeerVpcId} for peering connection ${VpcPeeringConnectionId}`
  );

  // Verify peering connection is active
  await verifyPeeringConnectionActive(VpcPeeringConnectionId);

  // Assume role in peer account
  const assumeRoleResponse = await stsClient.send(
    new AssumeRoleCommand({
      RoleArn: PeerRoleArn,
      RoleSessionName: `vpc-peering-routes-${Date.now()}`,
      DurationSeconds: 900, // 15 minutes
    })
  );

  if (!assumeRoleResponse.Credentials) {
    throw new Error("Failed to assume role in peer account");
  }

  if (
    !assumeRoleResponse.Credentials?.AccessKeyId ||
    !assumeRoleResponse.Credentials?.SecretAccessKey ||
    !assumeRoleResponse.Credentials?.SessionToken
  ) {
    throw new Error("Failed to get credentials from assumed role");
  }

  const peerEc2Client = new EC2Client({
    region: Region || process.env.AWS_REGION || "us-east-1",
    credentials: {
      accessKeyId: assumeRoleResponse.Credentials.AccessKeyId,
      secretAccessKey: assumeRoleResponse.Credentials.SecretAccessKey,
      sessionToken: assumeRoleResponse.Credentials.SessionToken,
    },
  });

  // Get all route tables in peer VPC
  const describeRouteTablesCommand = new DescribeRouteTablesCommand({
    Filters: [
      {
        Name: "vpc-id",
        Values: [PeerVpcId],
      },
    ],
  });

  const routeTablesResponse = await peerEc2Client.send(describeRouteTablesCommand);
  const routeTables = routeTablesResponse.RouteTables || [];

  if (routeTables.length === 0) {
    throw new Error(`No route tables found in peer VPC ${PeerVpcId}`);
  }

  console.log(`Found ${routeTables.length} route table(s) in peer VPC`);

  // Add route to each route table
  const routeTableIds: string[] = [];
  for (const routeTable of routeTables) {
    const routeTableId = routeTable.RouteTableId;
    if (!routeTableId) {
      continue;
    }

    routeTableIds.push(routeTableId);

    // Check if route already exists
    const existingRoute = routeTable.Routes?.find(
      (route) =>
        route.DestinationCidrBlock === RequesterVpcCidr &&
        route.VpcPeeringConnectionId === VpcPeeringConnectionId
    );

    if (existingRoute) {
      console.log(
        `Route to ${RequesterVpcCidr} already exists in route table ${routeTableId}`
      );
      continue;
    }

    // Create route
    const createRouteCommand = new CreateRouteCommand({
      RouteTableId: routeTableId,
      DestinationCidrBlock: RequesterVpcCidr,
      VpcPeeringConnectionId: VpcPeeringConnectionId,
    });

    await peerEc2Client.send(createRouteCommand);
    console.log(
      `Added route to ${RequesterVpcCidr} in route table ${routeTableId}`
    );
  }

  return {
    Status: "SUCCESS",
    PhysicalResourceId: `routes-${VpcPeeringConnectionId}`,
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
    Data: {
      RouteTableIds: routeTableIds,
      RoutesAdded: routeTableIds.length,
    },
  };
}

async function deletePeerRoutes(
  event: CloudFormationCustomResourceEvent,
  _context: Context
): Promise<CloudFormationCustomResourceResponse> {
  const props = event.ResourceProperties as unknown as RouteUpdateProperties;
  const {
    VpcPeeringConnectionId,
    PeerVpcId,
    RequesterVpcCidr,
    PeerRoleArn,
    Region,
  } = props;

  const physicalResourceId =
    "PhysicalResourceId" in event
      ? event.PhysicalResourceId
      : `routes-${VpcPeeringConnectionId}`;

  if (!VpcPeeringConnectionId || !PeerVpcId || !RequesterVpcCidr || !PeerRoleArn) {
    console.log("Missing properties for route deletion - skipping");
    return {
      Status: "SUCCESS",
      PhysicalResourceId: physicalResourceId,
      StackId: event.StackId,
      RequestId: event.RequestId,
      LogicalResourceId: event.LogicalResourceId,
      Data: {},
    };
  }

  try {
    // Assume role in peer account
    const assumeRoleResponse = await stsClient.send(
      new AssumeRoleCommand({
        RoleArn: PeerRoleArn,
        RoleSessionName: `vpc-peering-routes-delete-${Date.now()}`,
        DurationSeconds: 900,
      })
    );

    if (!assumeRoleResponse.Credentials) {
      throw new Error("Failed to assume role in peer account");
    }

    const credentials = assumeRoleResponse.Credentials;
    if (!credentials.AccessKeyId || !credentials.SecretAccessKey || !credentials.SessionToken) {
      throw new Error("Failed to get credentials from assumed role");
    }

    const peerEc2Client = new EC2Client({
      region: Region || process.env.AWS_REGION || "us-east-1",
      credentials: {
        accessKeyId: credentials.AccessKeyId,
        secretAccessKey: credentials.SecretAccessKey,
        sessionToken: credentials.SessionToken,
      },
    });

    // Get all route tables in peer VPC
    const describeRouteTablesCommand = new DescribeRouteTablesCommand({
      Filters: [
        {
          Name: "vpc-id",
          Values: [PeerVpcId],
        },
      ],
    });

    const routeTablesResponse = await peerEc2Client.send(describeRouteTablesCommand);
    const routeTables = routeTablesResponse.RouteTables || [];

    // Delete routes from each route table
    for (const routeTable of routeTables) {
      const routeTableId = routeTable.RouteTableId;
      if (!routeTableId) {
        continue;
      }

      try {
        const deleteRouteCommand = new DeleteRouteCommand({
          RouteTableId: routeTableId,
          DestinationCidrBlock: RequesterVpcCidr,
        });

        await peerEc2Client.send(deleteRouteCommand);
        console.log(
          `Deleted route to ${RequesterVpcCidr} from route table ${routeTableId}`
        );
      } catch (error: any) {
        // Ignore errors if route doesn't exist
        if (
          error.name === "InvalidRoute.NotFound" ||
          error.name === "InvalidRouteTableId.NotFound"
        ) {
          console.log(
            `Route to ${RequesterVpcCidr} not found in route table ${routeTableId} - already deleted`
          );
        } else {
          throw error;
        }
      }
    }
  } catch (error: any) {
    // Log error but don't fail - routes may have been manually deleted
    console.error("Error deleting routes (non-fatal):", error);
  }

  return {
    Status: "SUCCESS",
    PhysicalResourceId: physicalResourceId,
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
    Data: {},
  };
}

async function verifyPeeringConnectionActive(
  peeringConnectionId: string
): Promise<void> {
  const describeCommand = new DescribeVpcPeeringConnectionsCommand({
    VpcPeeringConnectionIds: [peeringConnectionId],
  });

  const response = await ec2Client.send(describeCommand);
  const connection = response.VpcPeeringConnections?.[0];

  if (!connection) {
    throw new Error(`Peering connection ${peeringConnectionId} not found`);
  }

  const state = connection.Status?.Code;

  if (state !== "active") {
    throw new Error(
      `Peering connection ${peeringConnectionId} is not active (state: ${state})`
    );
  }
}

async function sendResponse(
  event: CloudFormationCustomResourceEvent,
  context: Context,
  response: CloudFormationCustomResourceResponse
): Promise<void> {
  const responseBody = JSON.stringify({
    Status: response.Status,
    Reason:
      response.Reason ||
      `See CloudWatch Logs for requestId: ${context.awsRequestId}`,
    PhysicalResourceId: response.PhysicalResourceId || context.logStreamName,
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
    Data: response.Data || {},
  });

  const parsedUrl = url.parse(event.ResponseURL);
  const options = {
    hostname: parsedUrl.hostname,
    port: 443,
    path: parsedUrl.path,
    method: "PUT",
    headers: {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(responseBody),
    },
  };

  await new Promise<void>((resolve, reject) => {
    const req = https.request(options, (res) => {
      res.on("data", () => undefined);
      res.on("end", resolve);
    });

    req.on("error", (err) => {
      console.error("sendResponse error:", err);
      reject(err);
    });

    req.write(responseBody);
    req.end();
  });
}
