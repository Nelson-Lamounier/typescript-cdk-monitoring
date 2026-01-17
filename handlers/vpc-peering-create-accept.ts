/**
 * VPC Peering Create and Accept Lambda Function
 *
 * This Lambda function handles creating and accepting VPC peering connections,
 * including cross-account scenarios. It uses the peer account's IAM role to
 * accept the peering connection.
 *
 * Features:
 * - Creates VPC peering connection request
 * - Accepts peering connection (cross-account via assumed role)
 * - Configures DNS resolution if enabled
 * - Tags the peering connection
 * - Returns peering connection ID for use in route tables
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
  CreateVpcPeeringConnectionCommand,
  AcceptVpcPeeringConnectionCommand,
  DescribeVpcPeeringConnectionsCommand,
  ModifyVpcPeeringConnectionOptionsCommand,
  CreateTagsCommand,
  DeleteVpcPeeringConnectionCommand,
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
    "VPC Peering Create/Accept Lambda started",
    JSON.stringify(event, null, 2)
  );

  try {
    const requestType = event.RequestType;
    console.log(`Request type: ${requestType}`);

    let response: CloudFormationCustomResourceResponse;

    if (requestType === "Create" || requestType === "Update") {
      response = await createAndAcceptPeering(event, context);
    } else if (requestType === "Delete") {
      response = await deletePeering(event, context);
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
        : "peering-connection-failed";

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

interface VpcPeeringProperties {
  VpcId: string;
  PeerVpcId: string;
  PeerOwnerId: string;
  PeerRegion: string;
  PeerRoleArn: string;
  PeeringName: string;
  EnvName: string;
  EnableDnsResolution?: boolean;
}

async function createAndAcceptPeering(
  event: CloudFormationCustomResourceEvent,
  _context: Context
): Promise<CloudFormationCustomResourceResponse> {
  const props = event.ResourceProperties as unknown as VpcPeeringProperties;
  const {
    VpcId,
    PeerVpcId,
    PeerOwnerId,
    PeerRegion,
    PeerRoleArn,
    PeeringName,
    EnvName,
    EnableDnsResolution = true,
  } = props;

  // Validate required properties
  if (!VpcId || !PeerVpcId || !PeerOwnerId || !PeerRoleArn) {
    throw new Error(
      `Missing required properties: VpcId=${VpcId}, PeerVpcId=${PeerVpcId}, PeerOwnerId=${PeerOwnerId}, PeerRoleArn=${PeerRoleArn}`
    );
  }

  console.log(
    `Creating VPC peering connection: ${VpcId} -> ${PeerVpcId} (account: ${PeerOwnerId}, region: ${PeerRegion})`
  );

  // Step 1: Create peering connection request
  const createCommand = new CreateVpcPeeringConnectionCommand({
    VpcId,
    PeerVpcId,
    PeerOwnerId,
    PeerRegion: PeerRegion || undefined,
  });

  const createResponse = await ec2Client.send(createCommand);
  const peeringConnectionId =
    createResponse.VpcPeeringConnection?.VpcPeeringConnectionId;

  if (!peeringConnectionId) {
    throw new Error("Failed to create VPC peering connection - no connection ID returned");
  }

  console.log(`Created peering connection: ${peeringConnectionId}`);

  // Step 2: Assume role in peer account and accept the connection
  const assumeRoleResponse = await stsClient.send(
    new AssumeRoleCommand({
      RoleArn: PeerRoleArn,
      RoleSessionName: `vpc-peering-accept-${Date.now()}`,
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
    region: PeerRegion || process.env.AWS_REGION || "us-east-1",
    credentials: {
      accessKeyId: assumeRoleResponse.Credentials.AccessKeyId,
      secretAccessKey: assumeRoleResponse.Credentials.SecretAccessKey,
      sessionToken: assumeRoleResponse.Credentials.SessionToken,
    },
  });

  // Accept the peering connection
  const acceptCommand = new AcceptVpcPeeringConnectionCommand({
    VpcPeeringConnectionId: peeringConnectionId,
  });

  await peerEc2Client.send(acceptCommand);
  console.log(`Accepted peering connection: ${peeringConnectionId}`);

  // Step 3: Wait for peering connection to be active
  await waitForPeeringConnectionActive(peeringConnectionId);

  // Step 4: Configure DNS resolution if enabled
  if (EnableDnsResolution) {
    const modifyCommand = new ModifyVpcPeeringConnectionOptionsCommand({
      VpcPeeringConnectionId: peeringConnectionId,
      RequesterPeeringConnectionOptions: {
        AllowDnsResolutionFromRemoteVpc: true,
      },
      AccepterPeeringConnectionOptions: {
        AllowDnsResolutionFromRemoteVpc: true,
      },
    });

    await ec2Client.send(modifyCommand);
    console.log(`Enabled DNS resolution for peering connection: ${peeringConnectionId}`);
  }

  // Step 5: Tag the peering connection
  const tagsCommand = new CreateTagsCommand({
    Resources: [peeringConnectionId],
    Tags: [
      { Key: "Name", Value: PeeringName },
      { Key: "Environment", Value: EnvName },
      { Key: "ManagedBy", Value: "CDK" },
    ],
  });

  await ec2Client.send(tagsCommand);
  console.log(`Tagged peering connection: ${peeringConnectionId}`);

  return {
    Status: "SUCCESS",
    PhysicalResourceId: peeringConnectionId,
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
    Data: {
      PeeringConnectionId: peeringConnectionId,
    },
  };
}

async function deletePeering(
  event: CloudFormationCustomResourceEvent,
  _context: Context
): Promise<CloudFormationCustomResourceResponse> {
  const physicalResourceId =
    "PhysicalResourceId" in event
      ? event.PhysicalResourceId
      : "peering-connection-delete";

  if (!physicalResourceId || physicalResourceId === "peering-connection-failed") {
    console.log("No peering connection to delete");
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
    const deleteCommand = new DeleteVpcPeeringConnectionCommand({
      VpcPeeringConnectionId: physicalResourceId,
    });

    await ec2Client.send(deleteCommand);
    console.log(`Deleted peering connection: ${physicalResourceId}`);
  } catch (error: any) {
    // Ignore errors if connection doesn't exist or is already deleted
    if (
      error.name === "InvalidVpcPeeringConnectionId.NotFound" ||
      error.name === "InvalidVpcPeeringConnectionId.Malformed"
    ) {
      console.log(`Peering connection ${physicalResourceId} not found - already deleted`);
    } else {
      throw error;
    }
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

async function waitForPeeringConnectionActive(
  peeringConnectionId: string,
  maxAttempts: number = 30
): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const describeCommand = new DescribeVpcPeeringConnectionsCommand({
      VpcPeeringConnectionIds: [peeringConnectionId],
    });

    const response = await ec2Client.send(describeCommand);
    const connection = response.VpcPeeringConnections?.[0];

    if (!connection) {
      throw new Error(`Peering connection ${peeringConnectionId} not found`);
    }

    const state = connection.Status?.Code;

    if (state === "active") {
      console.log(`Peering connection ${peeringConnectionId} is active`);
      return;
    }

    if (state === "failed") {
      throw new Error(
        `Peering connection ${peeringConnectionId} failed to become active`
      );
    }

    if (state === "rejected") {
      throw new Error(
        `Peering connection ${peeringConnectionId} was rejected`
      );
    }

    console.log(
      `Waiting for peering connection ${peeringConnectionId} to become active (attempt ${attempt}/${maxAttempts}, state: ${state})`
    );

    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait 2 seconds
    }
  }

  throw new Error(
    `Peering connection ${peeringConnectionId} did not become active within ${maxAttempts * 2} seconds`
  );
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
