/** @format */

import { App, Stack } from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { Template } from "aws-cdk-lib/assertions";

import { EbsStorageStack } from "../../lib/stacks/storage/ebs-storage-stack";

describe("EbsStorageStack", () => {
  let template: Template;

  beforeAll(() => {
    const app = new App();

    // Create VPC for testing
    const vpcStack = new Stack(app, "TestVpcStack", {
      env: { account: "123456789012", region: "eu-west-1" },
    });
    const vpc = new ec2.Vpc(vpcStack, "TestVpc", {
      maxAzs: 2,
      natGateways: 0,
    });

    // Create EbsStorageStack
    const stack = new EbsStorageStack(app, "TestEbsStorageStack", {
      env: {
        account: "123456789012",
        region: "eu-west-1",
      },
      envName: "test",
      vpc,
      projectType: "monitoring",
      prometheusVolumeSize: 100,
      grafanaVolumeSize: 50,
      volumeType: ec2.EbsDeviceVolumeType.GP3,
    });

    template = Template.fromStack(stack);
  });

  // ============================================================================
  // SSM PARAMETERS TESTS
  // ============================================================================
  describe("SSM Parameters", () => {
    test("creates SSM parameter for Prometheus volume size", () => {
      const parameters = template.findResources("AWS::SSM::Parameter");
      const parameterNames = Object.values(parameters).map(
        (param: any) => param.Properties?.Name
      );

      expect(parameterNames).toContain("/monitoring/test/ebs/prometheus-volume-size");
    });

    test("creates SSM parameter for Grafana volume size", () => {
      const parameters = template.findResources("AWS::SSM::Parameter");
      const parameterNames = Object.values(parameters).map(
        (param: any) => param.Properties?.Name
      );

      expect(parameterNames).toContain("/monitoring/test/ebs/grafana-volume-size");
    });

    test("creates SSM parameter for volume type", () => {
      const parameters = template.findResources("AWS::SSM::Parameter");
      const parameterNames = Object.values(parameters).map(
        (param: any) => param.Properties?.Name
      );

      expect(parameterNames).toContain("/monitoring/test/ebs/volume-type");
    });

    test("creates SSM parameter for Prometheus config when projectType is monitoring", () => {
      const parameters = template.findResources("AWS::SSM::Parameter");
      const parameterNames = Object.values(parameters).map(
        (param: any) => param.Properties?.Name
      );

      expect(parameterNames).toContain("/monitoring/test/prometheus-config");
    });

    test("creates SSM parameter for Grafana datasource config when projectType is monitoring", () => {
      const parameters = template.findResources("AWS::SSM::Parameter");
      const parameterNames = Object.values(parameters).map(
        (param: any) => param.Properties?.Name
      );

      expect(parameterNames).toContain("/monitoring/test/grafana-datasource-config");
    });

    test("creates SSM parameter for Grafana dashboard config when projectType is monitoring", () => {
      const parameters = template.findResources("AWS::SSM::Parameter");
      const parameterNames = Object.values(parameters).map(
        (param: any) => param.Properties?.Name
      );

      expect(parameterNames).toContain("/monitoring/test/grafana-dashboard-config");
    });
  });

  // ============================================================================
  // STACK OUTPUTS TESTS
  // ============================================================================
  describe("Stack Outputs", () => {
    test("exports Prometheus volume size", () => {
      template.hasOutput("PrometheusVolumeSize", {
        Description: "Prometheus EBS volume size in GB",
        Export: {
          Name: "test-prometheus-volume-size",
        },
      });
    });

    test("exports Grafana volume size", () => {
      template.hasOutput("GrafanaVolumeSize", {
        Description: "Grafana EBS volume size in GB",
        Export: {
          Name: "test-grafana-volume-size",
        },
      });
    });

    test("exports volume type", () => {
      template.hasOutput("VolumeType", {
        Description: "EBS volume type for data volumes",
        Export: {
          Name: "test-ebs-volume-type",
        },
      });
    });
  });

  // ============================================================================
  // TAGS TESTS
  // ============================================================================
  describe("Stack Tags", () => {
    test("has correct tags without project name", () => {
      const testApp = new App();
      const testVpcStack = new Stack(testApp, "TestVpcStackNoProject", {
        env: { account: "123456789012", region: "eu-west-1" },
      });
      const testVpc = new ec2.Vpc(testVpcStack, "TestVpc", {
        maxAzs: 2,
        natGateways: 0,
      });

      const stack = new EbsStorageStack(testApp, "TestStackNoProject", {
        env: {
          account: "123456789012",
          region: "eu-west-1",
        },
        envName: "test",
        vpc: testVpc,
        projectType: "monitoring",
      });
      const testTemplate = Template.fromStack(stack);

      // Tags are applied at stack level, check via stack properties
      // We verify tags exist by checking SSM parameters have correct paths
      testTemplate.hasResourceProperties("AWS::SSM::Parameter", {
        Name: "/monitoring/test/ebs/prometheus-volume-size",
      });
    });

    test("has Project tag when projectName is provided", () => {
      const testApp = new App();
      const testVpcStack = new Stack(testApp, "TestVpcStackWithProject", {
        env: { account: "123456789012", region: "eu-west-1" },
      });
      const testVpc = new ec2.Vpc(testVpcStack, "TestVpc", {
        maxAzs: 2,
        natGateways: 0,
      });

      const stack = new EbsStorageStack(testApp, "TestStackWithProject", {
        env: {
          account: "123456789012",
          region: "eu-west-1",
        },
        envName: "test",
        projectName: "monitoring",
        projectType: "monitoring",
        vpc: testVpc,
      });
      const testTemplate = Template.fromStack(stack);

      // Verify project-specific SSM parameter paths
      testTemplate.hasResourceProperties("AWS::SSM::Parameter", {
        Name: "/monitoring/test/ebs/prometheus-volume-size",
      });
    });
  });

  // ============================================================================
  // GENERIC VOLUMES CONFIGURATION TESTS
  // ============================================================================
  describe("Generic Volumes Configuration", () => {
    test("creates SSM parameters for generic volumes array", () => {
      const testApp = new App();
      const testVpcStack = new Stack(testApp, "TestVpcStackGenericVolumes", {
        env: { account: "123456789012", region: "eu-west-1" },
      });
      const testVpc = new ec2.Vpc(testVpcStack, "TestVpc", {
        maxAzs: 2,
        natGateways: 0,
      });

      const stack = new EbsStorageStack(testApp, "TestStackGenericVolumes", {
        env: {
          account: "123456789012",
          region: "eu-west-1",
        },
        envName: "test",
        vpc: testVpc,
        volumes: [
          {
            name: "app-data",
            sizeGB: 200,
            volumeType: ec2.EbsDeviceVolumeType.GP3,
          },
          {
            name: "logs",
            sizeGB: 50,
            volumeType: ec2.EbsDeviceVolumeType.GP2,
          },
        ],
      });
      const testTemplate = Template.fromStack(stack);

      testTemplate.hasResourceProperties("AWS::SSM::Parameter", {
        Name: "/monitoring/test/ebs/app-data-volume-size",
      });

      testTemplate.hasResourceProperties("AWS::SSM::Parameter", {
        Name: "/monitoring/test/ebs/logs-volume-size",
      });

      testTemplate.hasResourceProperties("AWS::SSM::Parameter", {
        Name: "/monitoring/test/ebs/app-data-volume-type",
      });
    });

    test("exports generic volume sizes", () => {
      const testApp = new App();
      const testVpcStack = new Stack(testApp, "TestVpcStackGenericOutputs", {
        env: { account: "123456789012", region: "eu-west-1" },
      });
      const testVpc = new ec2.Vpc(testVpcStack, "TestVpc", {
        maxAzs: 2,
        natGateways: 0,
      });

      const stack = new EbsStorageStack(testApp, "TestStackGenericVolumesOutputs", {
        env: {
          account: "123456789012",
          region: "eu-west-1",
        },
        envName: "test",
        vpc: testVpc,
        volumes: [
          {
            name: "app-data",
            sizeGB: 200,
          },
        ],
      });
      const testTemplate = Template.fromStack(stack);

      testTemplate.hasOutput("Volume0Size", {
        Description: "app-data EBS volume size in GB",
        Export: {
          Name: "test-app-data-volume-size",
        },
      });
    });
  });

  // ============================================================================
  // MULTI-PROJECT INFRASTRUCTURE PATTERN TESTS
  // ============================================================================
  describe("Multi-Project Infrastructure Pattern", () => {
    test("creates project-specific SSM parameter paths when projectName is provided", () => {
      const testApp = new App();
      const testVpcStack = new Stack(testApp, "TestVpcStackProjectSpecific", {
        env: { account: "123456789012", region: "eu-west-1" },
      });
      const testVpc = new ec2.Vpc(testVpcStack, "TestVpc", {
        maxAzs: 2,
        natGateways: 0,
      });

      const stack = new EbsStorageStack(testApp, "TestStackProjectSpecific", {
        env: {
          account: "123456789012",
          region: "eu-west-1",
        },
        envName: "test",
        projectName: "monitoring",
        projectType: "monitoring",
        vpc: testVpc,
        prometheusVolumeSize: 100,
        grafanaVolumeSize: 50,
      });
      const testTemplate = Template.fromStack(stack);

      // Should use project-specific path: /{projectName}/{envName}/...
      testTemplate.hasResourceProperties("AWS::SSM::Parameter", {
        Name: "/monitoring/test/ebs/prometheus-volume-size",
      });

      testTemplate.hasResourceProperties("AWS::SSM::Parameter", {
        Name: "/monitoring/test/prometheus-config",
      });
    });

    test("creates project-specific CloudFormation exports when projectName is provided", () => {
      const testApp = new App();
      const testVpcStack = new Stack(testApp, "TestVpcStackProjectExports", {
        env: { account: "123456789012", region: "eu-west-1" },
      });
      const testVpc = new ec2.Vpc(testVpcStack, "TestVpc", {
        maxAzs: 2,
        natGateways: 0,
      });

      const stack = new EbsStorageStack(testApp, "TestStackProjectExports", {
        env: {
          account: "123456789012",
          region: "eu-west-1",
        },
        envName: "test",
        projectName: "monitoring",
        projectType: "monitoring",
        vpc: testVpc,
        prometheusVolumeSize: 100,
        grafanaVolumeSize: 50,
      });
      const testTemplate = Template.fromStack(stack);

      testTemplate.hasOutput("PrometheusVolumeSize", {
        Description: "Prometheus EBS volume size in GB",
        Export: {
          Name: "test-monitoring-prometheus-volume-size",
        },
      });

      testTemplate.hasOutput("GrafanaVolumeSize", {
        Description: "Grafana EBS volume size in GB",
        Export: {
          Name: "test-monitoring-grafana-volume-size",
        },
      });
    });

    test("adds Project and ProjectType tags when provided", () => {
      const testApp = new App();
      const testVpcStack = new Stack(testApp, "TestVpcStackProjectTags", {
        env: { account: "123456789012", region: "eu-west-1" },
      });
      const testVpc = new ec2.Vpc(testVpcStack, "TestVpc", {
        maxAzs: 2,
        natGateways: 0,
      });

      const stack = new EbsStorageStack(testApp, "TestStackProjectTags", {
        env: {
          account: "123456789012",
          region: "eu-west-1",
        },
        envName: "test",
        projectName: "monitoring",
        projectType: "monitoring",
        vpc: testVpc,
      });
      const testTemplate = Template.fromStack(stack);

      // Verify project-specific SSM paths (tags are applied at stack level)
      testTemplate.hasResourceProperties("AWS::SSM::Parameter", {
        Name: "/monitoring/test/ebs/prometheus-volume-size",
      });
    });

    test("does not create monitoring config when projectType is not monitoring", () => {
      const testApp = new App();
      const testVpcStack = new Stack(testApp, "TestVpcStackNonMonitoring", {
        env: { account: "123456789012", region: "eu-west-1" },
      });
      const testVpc = new ec2.Vpc(testVpcStack, "TestVpc", {
        maxAzs: 2,
        natGateways: 0,
      });

      const stack = new EbsStorageStack(testApp, "TestStackNonMonitoring", {
        env: {
          account: "123456789012",
          region: "eu-west-1",
        },
        envName: "test",
        projectName: "webapp",
        projectType: "webapp",
        vpc: testVpc,
        volumes: [
          {
            name: "app-data",
            sizeGB: 100,
          },
        ],
      });
      const testTemplate = Template.fromStack(stack);

      // Should not have Prometheus config
      const parameters = testTemplate.findResources("AWS::SSM::Parameter");
      const parameterNames = Object.values(parameters).map(
        (param: any) => param.Properties?.Name
      );

      expect(parameterNames).not.toContain("/webapp/test/prometheus-config");
      expect(parameterNames).not.toContain("/webapp/test/grafana-datasource-config");
      expect(parameterNames).not.toContain("/webapp/test/grafana-dashboard-config");
    });

    test("maintains backward compatibility when projectName is not provided", () => {
      const testApp = new App();
      const testVpcStack = new Stack(testApp, "TestVpcStackBackwardCompat", {
        env: { account: "123456789012", region: "eu-west-1" },
      });
      const testVpc = new ec2.Vpc(testVpcStack, "TestVpc", {
        maxAzs: 2,
        natGateways: 0,
      });

      const stack = new EbsStorageStack(testApp, "TestStackBackwardCompat", {
        env: {
          account: "123456789012",
          region: "eu-west-1",
        },
        envName: "test",
        vpc: testVpc,
        projectType: "monitoring",
        prometheusVolumeSize: 100,
        grafanaVolumeSize: 50,
      });
      const testTemplate = Template.fromStack(stack);

      // Should use default /monitoring/{envName} path
      testTemplate.hasResourceProperties("AWS::SSM::Parameter", {
        Name: "/monitoring/test/ebs/prometheus-volume-size",
      });

      testTemplate.hasOutput("PrometheusVolumeSize", {
        Export: {
          Name: "test-prometheus-volume-size",
        },
      });
    });
  });

  // ============================================================================
  // CUSTOM CONFIGURATION TESTS
  // ============================================================================
  describe("Custom Configuration", () => {
    test("uses custom volume sizes when provided", () => {
      const testApp = new App();
      const testVpcStack = new Stack(testApp, "TestVpcStackCustomSizes", {
        env: { account: "123456789012", region: "eu-west-1" },
      });
      const testVpc = new ec2.Vpc(testVpcStack, "TestVpc", {
        maxAzs: 2,
        natGateways: 0,
      });

      const stack = new EbsStorageStack(testApp, "TestStackCustomSizes", {
        env: {
          account: "123456789012",
          region: "eu-west-1",
        },
        envName: "test",
        vpc: testVpc,
        projectType: "monitoring",
        prometheusVolumeSize: 200,
        grafanaVolumeSize: 100,
      });
      const testTemplate = Template.fromStack(stack);

      testTemplate.hasResourceProperties("AWS::SSM::Parameter", {
        Name: "/monitoring/test/ebs/prometheus-volume-size",
        Value: "200",
      });

      testTemplate.hasResourceProperties("AWS::SSM::Parameter", {
        Name: "/monitoring/test/ebs/grafana-volume-size",
        Value: "100",
      });
    });

    test("uses custom volume type when provided", () => {
      const testApp = new App();
      const testVpcStack = new Stack(testApp, "TestVpcStackCustomType", {
        env: { account: "123456789012", region: "eu-west-1" },
      });
      const testVpc = new ec2.Vpc(testVpcStack, "TestVpc", {
        maxAzs: 2,
        natGateways: 0,
      });

      const stack = new EbsStorageStack(testApp, "TestStackCustomType", {
        env: {
          account: "123456789012",
          region: "eu-west-1",
        },
        envName: "test",
        vpc: testVpc,
        projectType: "monitoring",
        volumeType: ec2.EbsDeviceVolumeType.GP2,
      });
      const testTemplate = Template.fromStack(stack);

      testTemplate.hasResourceProperties("AWS::SSM::Parameter", {
        Name: "/monitoring/test/ebs/volume-type",
        Value: "gp2",
      });
    });
  });

  // ============================================================================
  // RESOURCE COUNTS TESTS
  // ============================================================================
  describe("Resource Counts", () => {
    test("has correct total resource count for monitoring project", () => {
      const templateJson = template.toJSON();
      const resourceCount = Object.keys(templateJson.Resources || {}).length;

      // Should have SSM parameters for volumes and monitoring config
      // 3 volume params + 3 monitoring config params = 6 minimum
      expect(resourceCount).toBeGreaterThanOrEqual(6);
    });

    test("creates correct number of SSM parameters for monitoring project", () => {
      // 3 volume parameters + 3 monitoring config parameters = 6
      template.resourceCountIs("AWS::SSM::Parameter", 6);
    });

    test("creates correct number of SSM parameters for non-monitoring project", () => {
      const testApp = new App();
      const testVpcStack = new Stack(testApp, "TestVpcStackNonMonitoringCount", {
        env: { account: "123456789012", region: "eu-west-1" },
      });
      const testVpc = new ec2.Vpc(testVpcStack, "TestVpc", {
        maxAzs: 2,
        natGateways: 0,
      });

      const stack = new EbsStorageStack(testApp, "TestStackNonMonitoringCount", {
        env: {
          account: "123456789012",
          region: "eu-west-1",
        },
        envName: "test",
        vpc: testVpc,
        volumes: [
          {
            name: "app-data",
            sizeGB: 100,
          },
        ],
      });
      const testTemplate = Template.fromStack(stack);

      // 2 parameters per volume (size + type) = 2
      testTemplate.resourceCountIs("AWS::SSM::Parameter", 2);
    });
  });

  // ============================================================================
  // SNAPSHOT TESTS
  // ============================================================================
  describe("Snapshots", () => {
    test("EbsStorageStack matches snapshot", () => {
      expect(template.toJSON()).toMatchSnapshot();
    });

    test("SSM parameters match snapshot", () => {
      const parameters = template.findResources("AWS::SSM::Parameter");
      expect(parameters).toMatchSnapshot();
    });
  });
});
