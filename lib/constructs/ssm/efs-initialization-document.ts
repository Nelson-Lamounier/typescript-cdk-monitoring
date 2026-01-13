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
 * Creates an SSM Automation Document that initializes EFS by generating
 * the directory setup script and storing it in SSM Parameter Store.
 *
 * Benefits over Lambda:
 * - No cold starts
 * - Direct SSM integration
 * - No VPC dependencies
 * - Better for infrastructure automation
 * - Can be invoked by CloudFormation or SSM State Manager
 *
 * Architecture:
 * This document executes a Python script in automation step to:
 * 1. Generate EFS directory setup script
 * 2. Store the script in SSM Parameter Store
 *
 * Note: YAML conversion is now done at CDK synthesis time, not runtime.
 * This eliminates the need for PyYAML dependency in SSM Automation.
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
 * // Create execution via SSM Association
 * const execution = efsInitDoc.createExecution(
 *   fileSystem.fileSystemId,
 *   accessPoint.accessPointId
 * );
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
        // Create and store EFS setup script
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
      outputs: ["CreateEfsSetupScript.OutputPayload"],
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
   * Python script for generating EFS setup script
   * This runs in the SSM Automation execution environment
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

# Download Prometheus config
aws ssm get-parameter --region ''' + region + ''' --name "/monitoring/''' + environment + '''/prometheus-config-yaml" --query "Parameter.Value" --output text > /mnt/efs/config/prometheus/prometheus.yml

# Replace HOST_IP_PLACEHOLDER in Prometheus config with EC2 instance's private IP address
# This is required because Prometheus (bridge networking) cannot access node-exporter (host networking) via localhost
PRIVATE_IP=$(curl -s http://169.254.169.254/latest/meta-data/local-ipv4)
if [ -z "$PRIVATE_IP" ]; then
  echo "ERROR: Failed to retrieve private IP from EC2 metadata service"
  exit 1
fi
sed -i "s/HOST_IP_PLACEHOLDER/$PRIVATE_IP/g" /mnt/efs/config/prometheus/prometheus.yml
echo "Replaced HOST_IP_PLACEHOLDER with $PRIVATE_IP in Prometheus config"

# Download Grafana datasource config
aws ssm get-parameter --region ''' + region + ''' --name "/monitoring/''' + environment + '''/grafana-datasource-config-yaml" --query "Parameter.Value" --output text > /mnt/efs/config/grafana/provisioning/datasources/prometheus.yml

# Replace HOST_IP_PLACEHOLDER with EC2 instance's private IP address
# This is required because Grafana (bridge networking) cannot access Prometheus via localhost
PRIVATE_IP=$(curl -s http://169.254.169.254/latest/meta-data/local-ipv4)
if [ -z "$PRIVATE_IP" ]; then
  echo "ERROR: Failed to retrieve private IP from EC2 metadata service"
  exit 1
fi
sed -i "s/HOST_IP_PLACEHOLDER/$PRIVATE_IP/g" /mnt/efs/config/grafana/provisioning/datasources/prometheus.yml
echo "Replaced HOST_IP_PLACEHOLDER with $PRIVATE_IP in Grafana datasource config"

# Download Grafana dashboard config
aws ssm get-parameter --region ''' + region + ''' --name "/monitoring/''' + environment + '''/grafana-dashboard-config-yaml" --query "Parameter.Value" --output text > /mnt/efs/config/grafana/provisioning/dashboards/dashboards.yml

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
            Description=f'EFS setup script for {environment} environment'
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
