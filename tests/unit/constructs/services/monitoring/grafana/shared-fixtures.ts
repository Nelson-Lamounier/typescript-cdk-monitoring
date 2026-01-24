/** @format */

import * as cdk from "aws-cdk-lib";
import * as autoscaling from "aws-cdk-lib/aws-autoscaling";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as efs from "aws-cdk-lib/aws-efs";

import { GrafanaServiceConstruct } from "../../../../../../lib/constructs/services/monitoring/grafana";
import { GrafanaServiceConstructProps } from "../../../../../../lib/shared/types";
import {
  TEST_CONFIG,
  BASE_TEST_CONSTANTS,
  createTestApp,
} from "../../../../utils/stack-test-utils";

/**
 * Test constants - avoid magic numbers and strings
 * All hardcoded values used in tests should be defined here
 */
export const TEST_CONSTANTS = {
  ...BASE_TEST_CONSTANTS,
  GRAFANA: {
    DEFAULT_PORT: 3000,
    CUSTOM_PORT: 8080,
    DEFAULT_CONTAINER_NAME: "grafana",
    SERVICE_NAME: "custom-grafana-service",
    LOG_GROUP_PREFIX: "/ecs/",
    DATA_VOLUME_NAME: "grafana-data",
  },
  ADMIN_SECRET: {
    ARN: "arn:aws:secretsmanager:eu-west-1:123456789012:secret:grafana-admin-abc123",
    ENV_VAR_NAME: "GF_SECURITY_ADMIN_PASSWORD",
  },
  EFS: {
    PATH: "/grafana",
    POSIX_UID: "1000",
    POSIX_GID: "1000",
    ACL_PERMISSIONS: "750",
  },
  VOLUMES: {
    HOST_PATH: "/mnt/grafana/data",
  },
  SERVICE: {
    DESIRED_COUNT: 3,
    SINGLE_TASK_COUNT: 1,
    HEALTH_CHECK_GRACE_PERIOD: 300,
  },
  TASK_DEFINITION: {
    FARGATE_CPU: "512",
    FARGATE_MEMORY: "1024",
    DEFAULT_RETENTION_DAYS: 30,
    CUSTOM_RETENTION_DAYS: 7,
  },
  DATASOURCES: {
    PROMETHEUS: {
      NAME: "Prometheus",
      TYPE: "prometheus",
      URL: "http://prometheus:9090",
    },
    CLOUDWATCH: {
      NAME: "CloudWatch",
      TYPE: "cloudwatch",
      REGION: "eu-west-1",
    },
  },
  GRAFANA_ENV: {
    SERVE_FROM_SUB_PATH: "GF_SERVER_SERVE_FROM_SUB_PATH",
    ALLOW_SIGN_UP: "GF_USERS_ALLOW_SIGN_UP",
    LOG_MODE: "GF_LOG_MODE",
  },
} as const;

/**
 * Helper function to create a test stack
 */
export function createTestStack(): cdk.Stack {
  const app = createTestApp();
  return new cdk.Stack(app, "TestStack", {
    env: { account: TEST_CONFIG.account, region: TEST_CONFIG.region },
  });
}

/**
 * Helper function to create a VPC for testing
 */
export function createTestVpc(stack: cdk.Stack): ec2.Vpc {
  return new ec2.Vpc(stack, "Vpc", {
    maxAzs: BASE_TEST_CONSTANTS.VPC.MAX_AZS,
  });
}

/**
 * Helper function to create an ECS cluster for testing
 */
export function createTestCluster(stack: cdk.Stack, vpc: ec2.Vpc): ecs.Cluster {
  return new ecs.Cluster(stack, "Cluster", { vpc });
}

/**
 * Helper function to create a cluster with EC2 capacity for EC2 launch type tests
 */
export function createEc2Cluster(stack: cdk.Stack, vpc: ec2.Vpc): ecs.Cluster {
  const cluster = new ecs.Cluster(stack, "Ec2Cluster", { vpc });

  const asg = new autoscaling.AutoScalingGroup(stack, "ASG", {
    vpc,
    instanceType: ec2.InstanceType.of(
      ec2.InstanceClass.T3,
      ec2.InstanceSize.MICRO
    ),
    machineImage: ecs.EcsOptimizedImage.amazonLinux2(),
    minCapacity: 1,
    maxCapacity: 1,
  });

  const capacityProvider = new ecs.AsgCapacityProvider(stack, "CapacityProvider", {
    autoScalingGroup: asg,
  });

  cluster.addAsgCapacityProvider(capacityProvider);

  return cluster;
}

/**
 * Helper to get network configuration for Fargate
 */
export function getFargateNetworkConfig(vpc: ec2.Vpc) {
  return {
    awsvpcConfiguration: {
      subnets: vpc.privateSubnets.map((s) => s.subnetId),
      securityGroups: [],
    },
  };
}

/**
 * Helper to create EFS resources for testing
 */
export function createEfsResources(stack: cdk.Stack, vpc: ec2.Vpc) {
  const fileSystem = new efs.FileSystem(stack, "EfsFileSystem", {
    vpc,
  });

  const accessPoint = new efs.AccessPoint(stack, "EfsAccessPoint", {
    fileSystem,
    path: TEST_CONSTANTS.EFS.PATH,
    posixUser: {
      uid: TEST_CONSTANTS.EFS.POSIX_UID,
      gid: TEST_CONSTANTS.EFS.POSIX_GID,
    },
    createAcl: {
      ownerUid: TEST_CONSTANTS.EFS.POSIX_UID,
      ownerGid: TEST_CONSTANTS.EFS.POSIX_GID,
      permissions: TEST_CONSTANTS.EFS.ACL_PERMISSIONS,
    },
  });

  return { fileSystem, accessPoint };
}

/**
 * Create Grafana service construct with minimal required props
 */
export function createGrafanaConstruct(
  stack: cdk.Stack,
  props: Partial<GrafanaServiceConstructProps> & {
    cluster: ecs.ICluster;
    envName: string;
  }
): GrafanaServiceConstruct {
  const vpc = props.cluster.vpc as ec2.Vpc;

  return new GrafanaServiceConstruct(stack, "Grafana", {
    adminPasswordSecretArn: TEST_CONSTANTS.ADMIN_SECRET.ARN,
    launchType: "FARGATE",
    networkConfiguration: getFargateNetworkConfig(vpc),
    ...props,
  });
}
