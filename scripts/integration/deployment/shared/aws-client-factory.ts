/** @format */

// infrastructure/scripts/deployment/shared/aws-client-factory.ts

import { STSClient, AssumeRoleCommand, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { CloudFormationClient } from "@aws-sdk/client-cloudformation";
import { SSMClient } from "@aws-sdk/client-ssm";
import { EC2Client } from "@aws-sdk/client-ec2";
import { EFSClient } from "@aws-sdk/client-efs";
import { ECSClient } from "@aws-sdk/client-ecs";
import { AutoScalingClient } from "@aws-sdk/client-auto-scaling";
import { ElasticLoadBalancingV2Client } from "@aws-sdk/client-elastic-load-balancing-v2";
import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
import { EventBridgeClient } from "@aws-sdk/client-eventbridge";
import { S3Client } from "@aws-sdk/client-s3";

import { Logger } from "../utils/logger";

export interface AwsClientConfig {
  region: string;
  profile?: string;
  environment: string;
  sessionName?: string;
}

export interface BaseAwsClients {
  sts: STSClient;
  accountId: string | null;
  baseAccountId: string | null;
  assumedRoleArn?: string;
}

export type ClientConfig = {
  region: string;
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
  };
};

export class AwsClientFactory {
  /**
   * Creates AWS clients with automatic role assumption and authentication handling
   * 
   * Supports:
   * - Local development with AWS profiles
   * - CI/CD with OIDC credentials
   * - Cross-account role assumption
   * 
   * @param config - Configuration for client creation
   * @param clientBuilder - Function to build specific clients from base config
   * @returns AWS clients with metadata (account IDs, assumed role ARN)
   */
  static async create<T extends BaseAwsClients>(
    config: AwsClientConfig,
    clientBuilder: (baseConfig: ClientConfig) => Omit<T, keyof BaseAwsClients>
  ): Promise<T> {
    const clientConfig: ClientConfig = { region: config.region };
    
    const isOidcAuth = !!process.env.AWS_SESSION_TOKEN;
    this.configureAuth(config.profile, isOidcAuth);

    const baseSts = new STSClient(clientConfig);
    const baseAccountId = await this.getAccountId(baseSts);
    
    const { roleArn, targetAccountId } = this.getAssumeRoleArn(
      config.environment,
      baseAccountId
    );

    if (roleArn) {
      return await this.createAssumedClients(
        roleArn,
        targetAccountId,
        config,
        baseSts,
        baseAccountId,
        clientBuilder
      );
    }

    const builtClients = clientBuilder(clientConfig);
    return {
      ...builtClients,
      sts: baseSts,
      accountId: baseAccountId,
      baseAccountId,
    } as T;
  }

  /**
   * Helper method to create commonly used client combinations
   */
  static async createCommonClients(
    config: AwsClientConfig,
    clientTypes: string[]
  ): Promise<BaseAwsClients & Record<string, any>> {
    return this.create(config, (baseConfig) => {
      const clients: Record<string, any> = {};
      
      clientTypes.forEach((type) => {
        switch (type) {
          case "cfn":
            clients.cfn = new CloudFormationClient(baseConfig);
            break;
          case "ssm":
            clients.ssm = new SSMClient(baseConfig);
            break;
          case "ec2":
            clients.ec2 = new EC2Client(baseConfig);
            break;
          case "efs":
            clients.efs = new EFSClient(baseConfig);
            break;
          case "ecs":
            clients.ecs = new ECSClient(baseConfig);
            break;
          case "asg":
            clients.asg = new AutoScalingClient(baseConfig);
            break;
          case "elbv2":
            clients.elbv2 = new ElasticLoadBalancingV2Client(baseConfig);
            break;
          case "logs":
            clients.logs = new CloudWatchLogsClient(baseConfig);
            break;
          case "eventBridge":
            clients.eventBridge = new EventBridgeClient(baseConfig);
            break;
          case "s3":
            clients.s3 = new S3Client(baseConfig);
            break;
        }
      });
      
      return clients;
    });
  }

  private static configureAuth(profile?: string, isOidc?: boolean): void {
    if (profile && !isOidc) {
      process.env.AWS_PROFILE = profile;
      Logger.info(`Using AWS profile: ${profile}`);
    } else if (isOidc) {
      delete process.env.AWS_PROFILE;
      Logger.info("Using OIDC credentials from environment variables");
    }
  }

  private static async getAccountId(stsClient: STSClient): Promise<string | null> {
    try {
      const response = await stsClient.send(new GetCallerIdentityCommand({}));
      return response.Account ?? null;
    } catch (error: any) {
      Logger.warning(`Unable to determine AWS account ID: ${error.message}`);
      return null;
    }
  }

  private static getAssumeRoleArn(
    environment: string,
    baseAccountId: string | null
  ): { roleArn?: string; targetAccountId?: string } {
    const explicitRoleArn = process.env.AWS_ASSUME_ROLE_ARN;
    if (explicitRoleArn) {
      return { roleArn: explicitRoleArn };
    }

    const targetAccountId = process.env.AWS_TARGET_ACCOUNT_ID || 
      this.getEnvironmentAccountId(environment);
    
    if (!targetAccountId || targetAccountId === baseAccountId) {
      return {};
    }

    const roleName = process.env.AWS_ASSUME_ROLE_NAME || "GitHubDeploymentRole";
    return {
      roleArn: `arn:aws:iam::${targetAccountId}:role/${roleName}`,
      targetAccountId,
    };
  }

  private static getEnvironmentAccountId(environment: string): string | undefined {
    const envKeyMap: Record<string, string> = {
      development: "AWS_ACCOUNT_ID_DEV",
      staging: "AWS_ACCOUNT_ID_STAGING",
      production: "AWS_ACCOUNT_ID_PROD",
    };
    const envVarName = envKeyMap[environment];
    return envVarName ? process.env[envVarName] : undefined;
  }

  private static async createAssumedClients<T extends BaseAwsClients>(
    roleArn: string,
    targetAccountId: string | undefined,
    config: AwsClientConfig,
    baseSts: STSClient,
    baseAccountId: string | null,
    clientBuilder: (config: ClientConfig) => Omit<T, keyof BaseAwsClients>
  ): Promise<T> {
    Logger.info(
      `Assuming role: ${roleArn}${targetAccountId ? ` (target: ${targetAccountId})` : ""}`
    );

    const sessionName = config.sessionName || `verify-stack-${Date.now()}`;
    const assumeResponse = await baseSts.send(
      new AssumeRoleCommand({
        RoleArn: roleArn,
        RoleSessionName: sessionName,
      })
    );

    const credentials = assumeResponse.Credentials;
    if (!credentials) {
      throw new Error("Failed to assume role: no credentials returned");
    }

    const assumedConfig: ClientConfig = {
      region: config.region,
      credentials: {
        accessKeyId: credentials.AccessKeyId ?? "",
        secretAccessKey: credentials.SecretAccessKey ?? "",
        sessionToken: credentials.SessionToken,
      },
    };

    const assumedSts = new STSClient(assumedConfig);
    const accountId = await this.getAccountId(assumedSts);

    const builtClients = clientBuilder(assumedConfig);
    return {
      ...builtClients,
      sts: assumedSts,
      accountId,
      baseAccountId,
      assumedRoleArn: roleArn,
    } as T;
  }
}