/** @format */

import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as ssm from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";

/**
 * Properties for EFS Initialization Document construct
 */
export interface EfsInitializationDocumentProps {
  /**
   * Environment name (e.g., development, production)
   */
  envName: string;

  /**
   * Optional project name for namespacing
   */
  projectName?: string;

  /**
   * AWS region where the document will run
   * @default Current stack region
   */
  region?: string;

  /**
   * IAM role for the automation document to assume
   * If not provided, a role will be created with necessary permissions
   */
  automationRole?: iam.IRole;
}

/**
 * EFS Initialization SSM Automation Document Construct
 *
 * Creates an SSM Automation Document that initializes EFS configuration by:
 * - Reading JSON configurations from SSM Parameter Store
 * - Converting JSON to YAML format
 * - Storing YAML configurations back to SSM for EC2 instances
 * - Creating EFS setup scripts
 *
 * Benefits over Lambda:
 * - No cold starts
 * - Direct SSM integration
 * - No VPC dependencies
 * - Better for infrastructure automation
 * - Can be invoked by CloudFormation or SSM State Manager
 *
 * Architecture:
 * This document executes Python scripts in automation steps to:
 * 1. Retrieve existing JSON configurations from SSM
 * 2. Convert JSON to YAML using PyYAML
 * 3. Store converted YAML configurations
 * 4. Generate and store EFS setup script
 *
 * Usage:
 * - Can be executed manually via SSM console
 * - Can be invoked by CloudFormation custom resource
 * - Can be triggered by EventBridge rules
 * - Can be part of SSM State Manager associations
 *
 * @example
 * ```typescript
 * const efsInitDoc = new EfsInitializationDocumentConstruct(
 *   this,
 *   'EfsInitDocument',
 *   {
 *     envName: 'production',
 *     projectName: 'monitoring',
 *   }
 * );
 *
 * // Use in CloudFormation custom resource
 * new cdk.CustomResource(this, 'EfsInit', {
 *   serviceToken: efsInitDoc.documentArn,
 *   properties: {
 *     FileSystemId: fileSystem.fileSystemId,
 *     AccessPointId: accessPoint.accessPointId,
 *   },
 * });
 * ```
 */
export class EfsInitializationDocumentConstruct extends Construct {
  /**
   * The SSM Automation Document
   */
  public readonly document: ssm.CfnDocument;

  /**
   * IAM role used by the automation
   */
  public readonly automationRole: iam.IRole;

  /**
   * Document ARN for reference
   */
  public readonly documentArn: string;

  /**
   * Document name for reference
   */
  public readonly documentName: string;

  private readonly stack = cdk.Stack.of(this);
  private readonly props: EfsInitializationDocumentProps;

  constructor(
    scope: Construct,
    id: string,
    props: EfsInitializationDocumentProps
  ) {
    super(scope, id);

    this.props = props;
    const region = props.region ?? this.stack.region;

    // Create or use provided automation role
    this.automationRole = props.automationRole ?? this.createAutomationRole();

    // Create the automation document
    this.documentName = `${this.stack.stackName}-${props.envName}-efs-init`;
    this.document = this.createAutomationDocument(region);

    this.documentArn = `arn:aws:ssm:${region}:${this.stack.account}:document/${this.documentName}`;

    // Apply tags
    cdk.Tags.of(this).add("Environment", props.envName);
    cdk.Tags.of(this).add("Component", "EFS-Initialization");
    cdk.Tags.of(this).add("ManagedBy", "CDK");

    if (props.projectName) {
      cdk.Tags.of(this).add("Project", props.projectName);
    }
  }

  /**
   * Create IAM role for SSM Automation execution
   */
  private createAutomationRole(): iam.Role {
    const role = new iam.Role(this, "AutomationRole", {
      assumedBy: new iam.ServicePrincipal("ssm.amazonaws.com"),
      description: `Automation role for EFS initialization in ${this.props.envName}`,
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AmazonSSMAutomationRole"
        ),
      ],
    });

    // Grant SSM Parameter Store permissions
    role.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "ssm:GetParameter",
          "ssm:GetParameters",
          "ssm:PutParameter",
          "ssm:AddTagsToResource",
        ],
        resources: [
          `arn:aws:ssm:${this.stack.region}:${this.stack.account}:parameter/monitoring/${this.props.envName}/*`,
        ],
      })
    );

    return role;
  }

  /**
   * Create the SSM Automation Document
   */
  private createAutomationDocument(region: string): ssm.CfnDocument {
    const { envName } = this.props;

    const documentContent = {
      schemaVersion: "0.3",
      description: `Initialize EFS configuration for ${envName} environment`,
      assumeRole: "{{ AutomationAssumeRole }}",
      parameters: {
        AutomationAssumeRole: {
          type: "AWS::IAM::Role::Arn",
          description: "IAM role for automation execution",
          default: this.automationRole.roleArn,
        },
        FileSystemId: {
          type: "String",
          description: "EFS File System ID",
        },
        AccessPointId: {
          type: "String",
          description: "EFS Access Point ID",
        },
        Environment: {
          type: "String",
          description: "Environment name",
          default: envName,
        },
      },
      mainSteps: [
        // Step 1: Convert Prometheus configuration
        {
          name: "ConvertPrometheusConfig",
          action: "aws:executeScript",
          description: "Convert Prometheus JSON config to YAML",
          inputs: {
            Runtime: "python3.11",
            Handler: "convert_config",
            Script: this.getPythonConversionScript(),
            InputPayload: {
              parameterName: `/monitoring/{{ Environment }}/prometheus-config`,
              outputParameterName: `/monitoring/{{ Environment }}/prometheus-config-yaml`,
              region,
            },
          },
        },
        // Step 2: Convert Grafana datasource configuration
        {
          name: "ConvertGrafanaDatasourceConfig",
          action: "aws:executeScript",
          description: "Convert Grafana datasource JSON config to YAML",
          inputs: {
            Runtime: "python3.11",
            Handler: "convert_config",
            Script: this.getPythonConversionScript(),
            InputPayload: {
              parameterName: `/monitoring/{{ Environment }}/grafana-datasource-config`,
              outputParameterName: `/monitoring/{{ Environment }}/grafana-datasource-config-yaml`,
              region,
            },
          },
        },
        // Step 3: Convert Grafana dashboard configuration
        {
          name: "ConvertGrafanaDashboardConfig",
          action: "aws:executeScript",
          description: "Convert Grafana dashboard JSON config to YAML",
          inputs: {
            Runtime: "python3.11",
            Handler: "convert_config",
            Script: this.getPythonConversionScript(),
            InputPayload: {
              parameterName: `/monitoring/{{ Environment }}/grafana-dashboard-config`,
              outputParameterName: `/monitoring/{{ Environment }}/grafana-dashboard-config-yaml`,
              region,
            },
          },
        },
        // Step 4: Create and store EFS setup script
        {
          name: "CreateEfsSetupScript",
          action: "aws:executeScript",
          description: "Create and store EFS directory setup script",
          inputs: {
            Runtime: "python3.11",
            Handler: "create_setup_script",
            Script: this.getSetupScriptGenerator(),
            InputPayload: {
              environment: "{{ Environment }}",
              region,
            },
          },
        },
      ],
      outputs: [
        "ConvertPrometheusConfig.OutputPayload",
        "ConvertGrafanaDatasourceConfig.OutputPayload",
        "ConvertGrafanaDashboardConfig.OutputPayload",
        "CreateEfsSetupScript.OutputPayload",
      ],
    };

    return new ssm.CfnDocument(this, "AutomationDocument", {
      documentType: "Automation",
      documentFormat: "YAML",
      name: this.documentName,
      content: documentContent,
      updateMethod: "NewVersion",
    });
  }

  /**
   * Python script for JSON to YAML conversion
   * This runs in the SSM Automation execution environment
   */
  private getPythonConversionScript(): string {
    return `
import json
import boto3
import yaml

def convert_config(events, context):
    """
    Convert JSON configuration from SSM to YAML and store back to SSM
    
    Args:
        events: Input payload with parameterName, outputParameterName, region
        context: Lambda context (unused)
    
    Returns:
        dict: Status and output parameter name
    """
    ssm_client = boto3.client('ssm', region_name=events['region'])
    
    parameter_name = events['parameterName']
    output_parameter_name = events['outputParameterName']
    
    try:
        # Get JSON configuration from SSM
        print(f"Retrieving parameter: {parameter_name}")
        response = ssm_client.get_parameter(Name=parameter_name)
        json_value = response['Parameter']['Value']
        
        if not json_value:
            raise ValueError(f"Parameter {parameter_name} is empty")
        
        # Parse JSON
        config_dict = json.loads(json_value)
        
        # Convert to YAML
        yaml_value = yaml.dump(
            config_dict,
            default_flow_style=False,
            sort_keys=False,
            allow_unicode=True,
            width=1000
        )
        
        if not yaml_value or not yaml_value.strip():
            raise ValueError("Generated YAML is empty")
        
        print(f"Generated YAML ({len(yaml_value)} characters)")
        
        # Store YAML configuration in SSM
        print(f"Storing YAML in parameter: {output_parameter_name}")
        ssm_client.put_parameter(
            Name=output_parameter_name,
            Value=yaml_value,
            Type='String',
            Overwrite=True,
            Description=f'YAML configuration converted from {parameter_name}',
            Tags=[
                {'Key': 'GeneratedBy', 'Value': 'SSM-Automation'},
                {'Key': 'Source', 'Value': parameter_name}
            ]
        )
        
        return {
            'statusCode': 200,
            'body': {
                'message': 'Configuration converted successfully',
                'sourceParameter': parameter_name,
                'outputParameter': output_parameter_name,
                'yamlSize': len(yaml_value)
            }
        }
        
    except ssm_client.exceptions.ParameterNotFound:
        error_msg = f"Parameter {parameter_name} not found. Ensure it exists before running initialization."
        print(f"ERROR: {error_msg}")
        raise Exception(error_msg)
    except json.JSONDecodeError as e:
        error_msg = f"Failed to parse JSON from {parameter_name}: {str(e)}"
        print(f"ERROR: {error_msg}")
        raise Exception(error_msg)
    except Exception as e:
        error_msg = f"Failed to convert configuration: {str(e)}"
        print(f"ERROR: {error_msg}")
        raise Exception(error_msg)
`.trim();
  }

  /**
   * Python script for generating EFS setup script
   */
  private getSetupScriptGenerator(): string {
    return `
import boto3

def create_setup_script(events, context):
    """
    Generate and store EFS directory setup script in SSM
    
    Args:
        events: Input payload with environment and region
        context: Lambda context (unused)
    
    Returns:
        dict: Status and parameter name
    """
    ssm_client = boto3.client('ssm', region_name=events['region'])
    environment = events['environment']
    region = events['region']
    
    # Generate setup script
    setup_script = f'''#!/bin/bash
set -e

echo "Setting up EFS directory structure and permissions..."

# Create directory structure with proper ownership from the start
mkdir -p /mnt/efs/prometheus-data
mkdir -p /mnt/efs/grafana-data/plugins
mkdir -p /mnt/efs/grafana-data/logs
mkdir -p /mnt/efs/grafana-data/csv
mkdir -p /mnt/efs/grafana-data/png
mkdir -p /mnt/efs/config/prometheus
mkdir -p /mnt/efs/config/grafana/provisioning/datasources
mkdir -p /mnt/efs/config/grafana/provisioning/dashboards
mkdir -p /mnt/efs/config/grafana/dashboards
mkdir -p /mnt/efs/config/alertmanager

# Set ownership and permissions for Prometheus (UID 65534)
chown -R 65534:65534 /mnt/efs/prometheus-data /mnt/efs/config/prometheus
chmod -R 755 /mnt/efs/prometheus-data /mnt/efs/config/prometheus

# Set ownership and permissions for Grafana (UID 472, GID 0)
chown -R 472:0 /mnt/efs/grafana-data /mnt/efs/config/grafana
chmod -R 755 /mnt/efs/grafana-data /mnt/efs/config/grafana

# Ensure Grafana can write to its data directories
chmod -R 777 /mnt/efs/grafana-data/plugins
chmod -R 777 /mnt/efs/grafana-data/logs
chmod -R 777 /mnt/efs/grafana-data/csv
chmod -R 777 /mnt/efs/grafana-data/png

# Create configuration files from SSM
echo "Creating configuration files from SSM parameters..."
echo "NOTE: HOST_IP_PLACEHOLDER in Grafana datasource config will be replaced at runtime on EC2 instance"

# Download Prometheus config
aws ssm get-parameter --region {region} --name "/monitoring/{environment}/prometheus-config-yaml" --query "Parameter.Value" --output text > /mnt/efs/config/prometheus/prometheus.yml

# Download Grafana datasource config (HOST_IP_PLACEHOLDER will be replaced by application-setup script on EC2)
aws ssm get-parameter --region {region} --name "/monitoring/{environment}/grafana-datasource-config-yaml" --query "Parameter.Value" --output text > /mnt/efs/config/grafana/provisioning/datasources/prometheus.yml

# Download Grafana dashboard config
aws ssm get-parameter --region {region} --name "/monitoring/{environment}/grafana-dashboard-config-yaml" --query "Parameter.Value" --output text > /mnt/efs/config/grafana/provisioning/dashboards/dashboards.yml

# Set proper ownership for config files
chown 65534:65534 /mnt/efs/config/prometheus/prometheus.yml
chown 472:0 /mnt/efs/config/grafana/provisioning/datasources/prometheus.yml
chown 472:0 /mnt/efs/config/grafana/provisioning/dashboards/dashboards.yml

# Verify directory structure and permissions
echo "Verifying directory structure:"
ls -la /mnt/efs/
ls -la /mnt/efs/grafana-data/
ls -la /mnt/efs/config/grafana/

echo "EFS setup completed successfully"
'''
    
    parameter_name = f"/monitoring/{environment}/efs-setup-script"
    
    try:
        # Store setup script in SSM
        print(f"Storing setup script in parameter: {parameter_name}")
        ssm_client.put_parameter(
            Name=parameter_name,
            Value=setup_script,
            Type='String',
            Overwrite=True,
            Description=f'EFS setup script for {environment} environment',
            Tags=[
                {'Key': 'GeneratedBy', 'Value': 'SSM-Automation'},
                {'Key': 'Environment', 'Value': environment}
            ]
        )
        
        return {
            'statusCode': 200,
            'body': {
                'message': 'Setup script created successfully',
                'parameterName': parameter_name,
                'scriptSize': len(setup_script)
            }
        }
        
    except Exception as e:
        error_msg = f"Failed to create setup script: {str(e)}"
        print(f"ERROR: {error_msg}")
        raise Exception(error_msg)
`.trim();
  }

  /**
   * Execute the automation document
   * Returns the execution ID for tracking
   */
  public createExecution(
    fileSystemId: string,
    accessPointId: string
  ): ssm.CfnAssociation {
    const association = new ssm.CfnAssociation(this, "AutomationExecution", {
      name: this.documentName,
      parameters: {
        FileSystemId: [fileSystemId],
        AccessPointId: [accessPointId],
        Environment: [this.props.envName],
        AutomationAssumeRole: [this.automationRole.roleArn],
      },
      // Run once on demand
      applyOnlyAtCronInterval: false,
    });

    // CRITICAL: Ensure the association waits for the document to be created
    // Without this, CloudFormation will try to create the association before the document exists
    association.addDependency(this.document);

    return association;
  }
}
