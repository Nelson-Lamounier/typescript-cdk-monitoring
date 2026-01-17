/** @format */
/// <reference types="jest" />

/**
 * MonitoringInfraStack Outputs and SSM Parameters Tests
 *
 * Tests CloudFormation outputs and SSM parameter configuration.
 */

import { Template, Match } from "aws-cdk-lib/assertions";

import {
  createTestApp,
  extendExpectWithCdkMatchers,
} from "../../../utils/stack-test-utils";

import { TEST_CONSTANTS, createTestStack } from "./shared-fixtures";

// ============================================================================
// CUSTOM MATCHERS SETUP
// ============================================================================

extendExpectWithCdkMatchers();

// ============================================================================
// TESTS
// ============================================================================

describe("MonitoringInfraStack - Outputs and SSM Parameters", () => {
  // ==========================================================================
  // SSM Parameters
  // ==========================================================================

  describe("SSM Parameters", () => {
    let defaultStack: any;
    let defaultTemplate: Template;
    let disabledStack: any;
    let disabledTemplate: Template;

    beforeAll(() => {
      const app = createTestApp();

      // Create all stacks first
      defaultStack = createTestStack(app, "SSM-Default", {
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
      });
      disabledStack = createTestStack(app, "SSM-Disabled", {
        createSsmParameters: false,
      });

      // Then create templates
      defaultTemplate = Template.fromStack(defaultStack);
      disabledTemplate = Template.fromStack(disabledStack);
    });

    test("creates SSM parameters by default", () => {
      expect(defaultStack.ssmParameters).toBeDefined();

      expect(() => {
        defaultTemplate.resourceCountIs(
          "AWS::SSM::Parameter",
          TEST_CONSTANTS.RESOURCE_COUNTS.SSM_PARAMETERS
        );
      }).not.toThrow();
    });

    test("does not create SSM parameters when disabled", () => {
      expect(disabledStack.ssmParameters).toBeUndefined();

      expect(() => {
        disabledTemplate.resourceCountIs("AWS::SSM::Parameter", 0);
      }).not.toThrow();
    });
  });

  // ==========================================================================
  // SSM Parameter Paths and Descriptions
  // ==========================================================================

  describe("SSM Parameter Paths and Descriptions", () => {
    let clusterNameTemplate: Template;
    let clusterArnTemplate: Template;
    let albDnsTemplate: Template;
    let listenerArnTemplate: Template;
    let asgNameTemplate: Template;

    beforeAll(() => {
      const app = createTestApp();

      // Create all stacks first
      const clusterNameStack = createTestStack(app, "SSMPath-ClusterName", {
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
      });
      const clusterArnStack = createTestStack(app, "SSMPath-ClusterArn", {
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
      });
      const albDnsStack = createTestStack(app, "SSMPath-AlbDns", {
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
      });
      const listenerArnStack = createTestStack(app, "SSMPath-ListenerArn", {
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
      });
      const asgNameStack = createTestStack(app, "SSMPath-AsgName", {
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
      });

      // Then create templates
      clusterNameTemplate = Template.fromStack(clusterNameStack);
      clusterArnTemplate = Template.fromStack(clusterArnStack);
      albDnsTemplate = Template.fromStack(albDnsStack);
      listenerArnTemplate = Template.fromStack(listenerArnStack);
      asgNameTemplate = Template.fromStack(asgNameStack);
    });

    test("creates cluster-name parameter with correct path and description", () => {
      expect(() => {
        clusterNameTemplate.hasResourceProperties("AWS::SSM::Parameter", {
          Name: TEST_CONSTANTS.SSM_PARAMETER_PATHS.CLUSTER_NAME,
          Type: "String",
          Description: Match.stringLikeRegexp("cluster name"),
        });
      }).not.toThrow();
    });

    test("creates cluster-arn parameter with correct path and description", () => {
      expect(() => {
        clusterArnTemplate.hasResourceProperties("AWS::SSM::Parameter", {
          Name: TEST_CONSTANTS.SSM_PARAMETER_PATHS.CLUSTER_ARN,
          Type: "String",
          Description: Match.stringLikeRegexp("cluster ARN"),
        });
      }).not.toThrow();
    });

    test("creates alb-dns parameter with correct path and description", () => {
      expect(() => {
        albDnsTemplate.hasResourceProperties("AWS::SSM::Parameter", {
          Name: TEST_CONSTANTS.SSM_PARAMETER_PATHS.ALB_DNS,
          Type: "String",
          Description: Match.stringLikeRegexp("ALB DNS"),
        });
      }).not.toThrow();
    });

    test("creates listener-arn parameter with correct path and description", () => {
      expect(() => {
        listenerArnTemplate.hasResourceProperties("AWS::SSM::Parameter", {
          Name: TEST_CONSTANTS.SSM_PARAMETER_PATHS.LISTENER_ARN,
          Type: "String",
          Description: Match.stringLikeRegexp("listener ARN"),
        });
      }).not.toThrow();
    });

    test("creates asg-name parameter with correct path and description", () => {
      expect(() => {
        asgNameTemplate.hasResourceProperties("AWS::SSM::Parameter", {
          Name: TEST_CONSTANTS.SSM_PARAMETER_PATHS.ASG_NAME,
          Type: "String",
          Description: Match.stringLikeRegexp("Auto Scaling Group"),
        });
      }).not.toThrow();
    });
  });

  // ==========================================================================
  // CloudFormation Outputs
  // ==========================================================================

  describe("CloudFormation Outputs", () => {
    let defaultTemplate: Template;
    let exportsTemplate: Template;
    let noExportsTemplate: Template;
    let noOutputsTemplate: Template;
    let defaultOutputs: Record<string, any>;
    let noExportsOutputs: Record<string, any>;
    let noOutputsOutputs: Record<string, any> | undefined;

    beforeAll(() => {
      const app1 = createTestApp();
      const app2 = createTestApp();
      const app3 = createTestApp();
      const app4 = createTestApp();

      // Create all stacks first
      const defaultStack = createTestStack(app1, "Outputs-Default");
      const exportsStack = createTestStack(app2, "Outputs-Exports", {
        envName: TEST_CONSTANTS.ENVIRONMENTS.DEVELOPMENT,
        projectName: "mon",
        enableExports: true,
      });
      const noExportsStack = createTestStack(app3, "Outputs-NoExports", {
        enableExports: false,
      });
      const noOutputsStack = createTestStack(app4, "Outputs-NoOutputs", {
        createOutputs: false,
        createSsmParameters: false,
      });

      // Then create templates
      defaultTemplate = Template.fromStack(defaultStack);
      exportsTemplate = Template.fromStack(exportsStack);
      noExportsTemplate = Template.fromStack(noExportsStack);
      noOutputsTemplate = Template.fromStack(noOutputsStack);

      // Pre-compute outputs
      defaultOutputs = defaultTemplate.toJSON().Outputs;
      noExportsOutputs = noExportsTemplate.toJSON().Outputs;
      noOutputsOutputs = noOutputsTemplate.toJSON().Outputs;
    });

    test("creates all required outputs by default", () => {
      const outputNames = [
        "ClusterName",
        "ClusterArn",
        "LoadBalancerDns",
        "ListenerArn",
        "MonitoringUrl",
        "PrometheusUrl",
        "GrafanaUrl",
        "AutoScalingGroupName",
        "TaskLogGroupName",
      ];

      outputNames.forEach((outputName) => {
        expect(defaultOutputs[outputName]).toBeDefined();
        expect(defaultOutputs[outputName].Value).toBeDefined();
      });
    });

    test("exports outputs when enableExports is true", () => {
      expect(() => {
        exportsTemplate.hasOutput("ClusterName", {
          Export: {
            Name: "development-mon-monitoring-cluster-name",
          },
        });
      }).not.toThrow();
    });

    test("does not export outputs when enableExports is false", () => {
      expect(noExportsOutputs.ClusterName.Export).toBeUndefined();
    });

    test("does not create outputs when createOutputs is false", () => {
      expect(noOutputsOutputs).toBeDefined();
      expect(noOutputsOutputs?.ClusterName).toBeUndefined();
      expect(noOutputsOutputs?.ClusterArn).toBeUndefined();
      expect(noOutputsOutputs?.LoadBalancerDns).toBeUndefined();
    });

    test("includes SSM parameter prefix in outputs when parameters enabled", () => {
      expect(() => {
        defaultTemplate.hasOutput("SsmParameterPrefix", {});
      }).not.toThrow();
    });
  });

  // ==========================================================================
  // Monitoring URL Protocol
  // ==========================================================================

  describe("Monitoring URL Protocol", () => {
    let httpOutputs: Record<string, any>;
    let httpsOutputs: Record<string, any>;

    beforeAll(() => {
      const app1 = createTestApp();
      const app2 = createTestApp();

      // Create all stacks first
      const httpStack = createTestStack(app1, "URLs-HTTP", {
        enableHttps: false,
      });
      const httpsStack = createTestStack(app2, "URLs-HTTPS", {
        enableHttps: true,
        certificateArn: TEST_CONSTANTS.CERTIFICATE_ARN,
      });

      // Then create templates and extract outputs
      const httpTemplate = Template.fromStack(httpStack);
      const httpsTemplate = Template.fromStack(httpsStack);

      httpOutputs = httpTemplate.toJSON().Outputs;
      httpsOutputs = httpsTemplate.toJSON().Outputs;
    });

    test("generates correct monitoring URLs with HTTP", () => {
      const monitoringUrl = httpOutputs.MonitoringUrl.Value["Fn::Join"][1];
      expect(monitoringUrl[0]).toBe("http://");
    });

    test("generates correct monitoring URLs with HTTPS", () => {
      const monitoringUrl = httpsOutputs.MonitoringUrl.Value["Fn::Join"][1];
      expect(monitoringUrl[0]).toBe("https://");
    });
  });
});
