/** @format */

import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as kms from "aws-cdk-lib/aws-kms";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cdk from "aws-cdk-lib";

/**
 * Subnet configuration interface for VPC subnet creation
 */
export interface SubnetConfiguration {
  name: string;
  subnetType: ec2.SubnetType;
  cidrMask: number;
  mapPublicIpOnLaunch?: boolean;
  tags?: Record<string, string>;
}

/**
 * VPC Flow Logs configuration properties
 */
export interface VpcFlowLogsConstructProps {
  vpc: ec2.IVpc;
  envName: string;
  projectName?: string; // Project name for log group naming
  trafficType?: ec2.FlowLogTrafficType;
  logGroupName?: string;
  retentionDays?: number;
  encryptionKey?: kms.IKey; // KMS key for log encryption
  logFormat?: ec2.LogFormat[]; // Custom log format fields for cost optimisation (e.g., [ec2.LogFormat.VERSION, ec2.LogFormat.SRC_ADDR])
  maxAggregationInterval?: ec2.FlowLogMaxAggregationInterval; // 1min vs 10min granularity
  removalPolicy?: cdk.RemovalPolicy; // Configurable removal policy
}

/**
 * VPC Peering configuration properties
 */
export interface VpcPeeringConstructProps {
  vpc: ec2.IVpc;
  peerVpcId: string;
  peerAccountId: string;
  peerRegion?: string;
  peerVpcCidr: string;
  envName: string;
  peeringName: string;
  peerRoleArn: string;
  projectName?: string;
  ssmParameterPath?: string;
  lambdaTimeoutSeconds?: number;
  enableDnsResolution?: boolean;
}

/**
 * Security Group rule configuration
 */
export interface SecurityGroupRule {
  peer: ec2.IPeer;
  port: ec2.Port;
  description?: string;
}

/**
 * Security Group construct properties
 */
export interface SecurityGroupConstructProps {
  vpc: ec2.IVpc;
  groupName: string;
  description: string;
  envName: string;
  projectName?: string;
  allowAllOutbound?: boolean;
  ingressRules?: SecurityGroupRule[];
  egressRules?: SecurityGroupRule[];
}

/**
 * Application Load Balancer construct properties
 */
export interface AlbConstructProps {
  vpc: ec2.IVpc;
  envName: string;
  loadBalancerName: string;
  projectName?: string;
  internetFacing?: boolean;
  securityGroup?: ec2.ISecurityGroup;
  deletionProtection?: boolean;
  accessLogEnabled?: boolean;
  accessLogBucket?: s3.IBucket;
  accessLogPrefix?: string;
  accessLogBucketEncryptionKey?: kms.IKey;
  accessLogRetentionDays?: number;
  accessLogTransitionToIADays?: number;
  serverAccessLogsBucket?: s3.IBucket;
  idleTimeout?: cdk.Duration;
  crossZoneLoadBalancing?: boolean;
  http2Enabled?: boolean;
  dropInvalidHeaderFields?: boolean;
  desyncMitigationMode?: elbv2.DesyncMitigationMode;
  vpcSubnets?: ec2.SubnetSelection;
}

/**
 * Application Load Balancer Listener construct properties
 */
export interface AlbListenerConstructProps {
  loadBalancer: elbv2.IApplicationLoadBalancer;
  envName: string;
  projectName?: string;
  enableHttp?: boolean;
  enableHttps?: boolean;
  httpPort?: number;
  httpsPort?: number;
  certificateArn?: string;
  additionalCertificates?: string[];
  redirectHttpToHttps?: boolean;
  sslPolicy?: elbv2.SslPolicy;
  httpDefaultAction?: elbv2.ListenerAction;
  httpsDefaultAction?: elbv2.ListenerAction;
  preserveXForwardedFor?: boolean;
  preserveXForwardedProto?: boolean;
  loadBalancerName?: string;
}

/**
 * Matcher configuration for ALB target group health checks
 */
export interface AlbTargetGroupHealthCheckMatcher {
  httpCodes?: string;
  grpcCodes?: string;
}

/**
 * CloudWatch alarm configuration for target groups
 */
export interface TargetGroupAlarmConfig {
  createUnhealthyHostAlarm?: boolean;
  unhealthyHostThreshold: number;
  evaluationPeriods?: number;
  datapointsToAlarm?: number;
  comparisonOperator?: cloudwatch.ComparisonOperator;
  treatMissingData?: cloudwatch.TreatMissingData;
  metricPeriod?: cdk.Duration;
  alarmName?: string;
  alarmDescription?: string;
}

/**
 * Application Load Balancer Target Group construct properties
 */
export interface AlbTargetGroupConstructProps {
  vpc?: ec2.IVpc;
  envName: string;
  projectName?: string;
  component?: string;
  name: string;
  port?: number;
  protocol?: elbv2.ApplicationProtocol;
  protocolVersion?: elbv2.ApplicationProtocolVersion;
  targetType?: elbv2.TargetType;
  healthCheckPath?: string;
  healthCheckProtocol?: elbv2.Protocol;
  healthCheckPort?: string;
  healthCheckIntervalSeconds?: number;
  healthCheckTimeoutSeconds?: number;
  healthyThresholdCount?: number;
  unhealthyThresholdCount?: number;
  healthCheckMatcher?: AlbTargetGroupHealthCheckMatcher;
  deregistrationDelaySeconds?: number;
  stickinessEnabled?: boolean;
  stickinessCookieDurationSeconds?: number;
  slowStartDurationSeconds?: number;
  loadBalancingAlgorithm?: elbv2.TargetGroupLoadBalancingAlgorithmType;
  targetGroupAttributes?: Record<string, string>;
  lambdaMultiValueHeadersEnabled?: boolean;
  alarmConfig?: TargetGroupAlarmConfig;
}
