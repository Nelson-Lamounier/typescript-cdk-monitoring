/** @format */

/**
 * =============================================================================
 * STACK TEMPLATE
 * =============================================================================
 *
 * This template provides a starting point for creating new CDK stacks.
 * Replace placeholder values and uncomment sections as needed.
 *
 * FILE LOCATION:
 * - Place in: lib/stacks/{category}/{stack-name}-stack.ts
 * - Example:  lib/stacks/monitoring/my-service-stack.ts
 *
 * NAMING CONVENTIONS:
 * - File:      kebab-case-stack.ts
 * - Class:     PascalCaseStack
 * - Props:     PascalCaseStackProps
 *
 * AFTER CREATING:
 * 1. Add props interface to lib/shared/types/stack-types.ts
 * 2. Update bin/app.ts with stack instantiation
 * 3. Add stack to deployment documentation
 * 4. Update lib/stacks/{category}/index.ts if exists
 *
 * =============================================================================
 */

// =============================================================================
// SECTION 1: IMPORTS
// =============================================================================
// Organise imports in this order:
// 1. AWS CDK core imports (alphabetical)
// 2. CDK service-specific imports (alphabetical)
// 3. Third-party imports (cdk-nag)
// 4. Internal constructs
// 5. Internal shared utilities (helpers, types, constants, utils)

import * as cdk from "aws-cdk-lib";
// import * as ec2 from "aws-cdk-lib/aws-ec2";
// import * as ecs from "aws-cdk-lib/aws-ecs";
// import * as iam from "aws-cdk-lib/aws-iam";
// import * as logs from "aws-cdk-lib/aws-logs";
// import { NagSuppressions } from "cdk-nag";
import { Construct } from "constructs";

// Internal constructs - uncomment and adjust paths as needed
// import { VpcConstruct } from "../../constructs/networking/vpc";
// import { EcsClusterConstruct } from "../../constructs/compute/ecs";
// import { SsmParametersConstruct } from "../../constructs/config";

// Internal shared utilities
// import { SuppressionManager } from "../../cdk-nag";
// import { applyStackTags } from "../../shared/helpers/stack-tagging-helper";
// import { MyStackProps } from "../../shared/types/stack-types";
// import { DEFAULT_VALUE } from "../../shared/constants/my-constants";
// import { validateEnvName } from "../../shared/utils/validation";
// import { isProductionEnvironment } from "../../shared/utils/environment";

// =============================================================================
// SECTION 2: PROPS INTERFACE
// =============================================================================
// RECOMMENDATION: Define props in lib/shared/types/stack-types.ts
// This interface serves as a template - move it to shared/types/ when ready.

/**
 * Props for MyStack
 *
 * NOTE: Move this interface to lib/shared/types/stack-types.ts
 * and import it instead for better maintainability.
 */
export interface MyStackProps extends cdk.StackProps {
  // ========================================
  // REQUIRED PROPERTIES
  // ========================================

  /**
   * Environment name (e.g., development, staging, production)
   * Used for resource naming, tagging, and environment-specific configuration
   */
  envName: string;

  // TODO: Add required dependencies from other stacks
  // /**
  //  * VPC from NetworkingStack
  //  */
  // vpc: ec2.IVpc;

  // ========================================
  // OPTIONAL PROPERTIES - Naming
  // ========================================

  /**
   * Project name for resource naming and tagging
   * @default undefined
   */
  projectName?: string;

  // ========================================
  // OPTIONAL PROPERTIES - Configuration
  // ========================================

  // TODO: Add stack-specific configuration
  // /**
  //  * Instance type for compute resources
  //  * @default t3.small for dev, t3.medium for production
  //  */
  // instanceType?: ec2.InstanceType;

  // ========================================
  // OPTIONAL PROPERTIES - Features
  // ========================================

  /**
   * Create SSM parameters for cross-stack discovery
   * @default true
   */
  createSsmParameters?: boolean;

  /**
   * Create CloudFormation outputs
   * @default true
   */
  createOutputs?: boolean;

  /**
   * Enable CloudFormation exports for cross-stack references
   * @default false
   */
  enableExports?: boolean;

  /**
   * Enable production warnings for risky configurations
   * @default true
   */
  enableProductionWarnings?: boolean;

  /**
   * Custom tags to apply to all resources in this stack
   */
  customTags?: Record<string, string>;
}

// =============================================================================
// SECTION 3: STACK CLASS
// =============================================================================

/**
 * MyStack - Layer X: Brief description of what this stack provisions
 *
 * This stack provisions:
 * - Resource 1 with description
 * - Resource 2 with description
 * - Related security and IAM configuration
 *
 * Dependencies:
 * - NetworkingStack (for VPC)
 * - List any other required stacks
 *
 * Architecture Pattern:
 * - Describe the architecture pattern this stack implements
 *
 * SSM Parameters Created:
 * - `/prefix/${envName}/resource-id` - Resource identifier
 * - `/prefix/${envName}/resource-arn` - Resource ARN
 *
 * Production Recommendations:
 * - enableHttps: true (with valid ACM certificate)
 * - minCapacity: 2+ (high availability)
 * - List other production recommendations
 *
 * Cost Considerations:
 * - Resource 1: ~$X/month
 * - Resource 2: ~$X/month
 *
 * @example
 * ```typescript
 * // Development
 * const stack = new MyStack(app, 'MyStack-dev', {
 *   envName: 'development',
 *   vpc: networkingStack.vpc,
 * });
 *
 * // Production
 * const stack = new MyStack(app, 'MyStack-prod', {
 *   envName: 'production',
 *   vpc: networkingStack.vpc,
 *   enableHttps: true,
 *   minCapacity: 2,
 * });
 * ```
 */
export class MyStack extends cdk.Stack {
  // ========================================
  // PUBLIC PROPERTIES
  // ========================================
  // Expose resources for cross-stack references

  /**
   * The primary resource created by this stack
   *
   * TODO: Replace 'unknown' with actual resource type
   * Example: public readonly cluster: ecs.Cluster;
   */
  public readonly primaryResource: unknown;

  /**
   * SSM Parameters construct (if enabled)
   */
  // public readonly ssmParameters?: SsmParametersConstruct;

  // TODO: Add additional public properties as needed
  // public readonly secondaryResource: ResourceType;

  // ========================================
  // CONSTRUCTOR
  // ========================================
  constructor(scope: Construct, id: string, props: MyStackProps) {
    super(scope, id, props);

    // ========================================================================
    // STEP 1: VALIDATION (Fail Fast)
    // ========================================================================
    // Validate all inputs at the start

    // TODO: Uncomment and use centralised validation
    // validateEnvName(props.envName);

    // For now, inline validation (move to validation.ts later)
    if (
      !props.envName ||
      typeof props.envName !== "string" ||
      props.envName.trim().length === 0
    ) {
      throw new Error(
        "Environment name (envName) is required and must be a non-empty string.\n\n" +
          "Troubleshooting Steps:\n" +
          " 1. Provide envName in stack props\n" +
          " 2. Use standard values: 'development', 'staging', 'production'\n" +
          " 3. Ensure the value is not undefined or null",
      );
    }

    // TODO: Validate dependencies from other stacks
    // if (!props.vpc) {
    //   throw new Error(
    //     "VPC is required for MyStack.\n\n" +
    //       "Pass the VPC from NetworkingStack via props."
    //   );
    // }

    // ========================================================================
    // STEP 2: ENVIRONMENT-AWARE DEFAULTS
    // ========================================================================

    // TODO: Uncomment and use environment detection
    // const isProduction = isProductionEnvironment(props.envName);

    // Placeholder for template
    const isProduction =
      props.envName === "production" || props.envName === "prod";

    // TODO: Add environment-specific defaults
    // const minCapacity = props.minCapacity ?? (isProduction ? 2 : 1);
    // const logRetention = props.logRetention ?? (isProduction
    //   ? logs.RetentionDays.THREE_MONTHS
    //   : logs.RetentionDays.TWO_WEEKS);

    // ========================================================================
    // STEP 3: PRODUCTION WARNINGS
    // ========================================================================
    if (props.enableProductionWarnings !== false && isProduction) {
      this.logProductionWarnings(props);
    }

    // ========================================================================
    // 1. FIRST RESOURCE GROUP
    // ========================================================================
    // Use numbered sections for logical resource groupings
    // Each section should have a clear purpose

    // TODO: Create primary resources using constructs
    // const vpcConstruct = new VpcConstruct(this, "Vpc", {
    //   envName: props.envName,
    //   projectName: props.projectName,
    // });
    // this.primaryResource = vpcConstruct.vpc;

    // Placeholder for template compilation
    this.primaryResource = {
      resourceId: `placeholder-${props.envName}`,
    };

    // ========================================================================
    // 2. SECOND RESOURCE GROUP
    // ========================================================================

    // TODO: Add secondary resources
    // const clusterConstruct = new EcsClusterConstruct(this, "Cluster", {
    //   vpc: props.vpc,
    //   envName: props.envName,
    // });

    // ========================================================================
    // 3. SECURITY CONFIGURATION
    // ========================================================================

    // TODO: Add security groups, IAM roles, encryption
    // Example: this.configureSecurityGroups(props);

    // ========================================================================
    // 4. DEPENDENCIES
    // ========================================================================

    // TODO: Add explicit dependencies if needed
    // this.resource.node.addDependency(otherResource);

    // ========================================================================
    // N-2. SSM PARAMETERS (Cross-Stack Discovery)
    // ========================================================================

    // TODO: Uncomment and configure SSM parameters
    // if (props.createSsmParameters !== false) {
    //   this.ssmParameters = new SsmParametersConstruct(this, "Parameters", {
    //     envName: props.envName,
    //     projectName: props.projectName,
    //     pathPrefix: `/mystack/${props.envName}`,
    //     customParameters: [
    //       {
    //         name: "resource-id",
    //         value: this.primaryResource.resourceId,
    //         description: `Resource ID for ${props.envName}`,
    //       },
    //       {
    //         name: "resource-arn",
    //         value: this.primaryResource.resourceArn,
    //         description: `Resource ARN for ${props.envName}`,
    //       },
    //     ],
    //   });
    // }

    // ========================================================================
    // N-1. CLOUDFORMATION OUTPUTS
    // ========================================================================
    if (props.createOutputs !== false) {
      this.createOutputs(props);
    }

    // ========================================================================
    // N. RESOURCE TAGGING
    // ========================================================================

    // TODO: Uncomment and use stack tagging helper
    // applyStackTags(this, props.envName, props.projectName, {
    //   ...props.customTags,
    //   StackName: "MyStack",
    //   Layer: "Infrastructure", // or "Foundation", "Service"
    // });

    // ========================================================================
    // CDK NAG SUPPRESSIONS
    // ========================================================================

    // TODO: Add CDK Nag suppressions if needed
    // SuppressionManager.applyToStack(this, "MyStack", props.envName);

    // Or add individual suppressions:
    // NagSuppressions.addResourceSuppressions(
    //   this.primaryResource,
    //   [
    //     {
    //       id: "AwsSolutions-IAM5",
    //       reason: "Detailed justification for why this is acceptable",
    //       appliesTo: ["Resource::*"],
    //     },
    //   ],
    //   true
    // );
  }

  // ========================================
  // PRIVATE METHODS
  // ========================================

  /**
   * Log production warnings for risky configurations
   */
  private logProductionWarnings(props: MyStackProps): void {
    // TODO: Add production-specific warnings

    // Example: HTTPS not enabled
    // if (!props.enableHttps) {
    //   cdk.Annotations.of(this).addWarning(
    //     "PRODUCTION: HTTPS not enabled. " +
    //       "Data will be transmitted in plaintext. " +
    //       "Enable HTTPS with a valid ACM certificate for production."
    //   );
    // }

    // Example: Single instance
    // if (props.minCapacity && props.minCapacity < 2) {
    //   cdk.Annotations.of(this).addWarning(
    //     `PRODUCTION: minCapacity is ${props.minCapacity}. ` +
    //       "For high availability, set minCapacity to 2+. " +
    //       "Single instance is a single point of failure."
    //   );
    // }

    // Log that this method was called (remove in production)
    console.log(`Production warnings checked for env: ${props.envName}`);
  }

  /**
   * Create CloudFormation outputs
   */
  private createOutputs(props: MyStackProps): void {
    const enableExports = props.enableExports ?? false;
    const exportPrefix = props.projectName
      ? `${props.envName}-${props.projectName}`
      : `${props.envName}`;

    // TODO: Add outputs for resources that other stacks may reference

    new cdk.CfnOutput(this, "ResourceId", {
      value: (this.primaryResource as { resourceId: string }).resourceId,
      description: `Primary resource ID for ${props.envName}`,
      exportName: enableExports ? `${exportPrefix}-resource-id` : undefined,
    });

    // Example: Multiple outputs
    // new cdk.CfnOutput(this, "ResourceArn", {
    //   value: this.primaryResource.resourceArn,
    //   description: `Primary resource ARN for ${props.envName}`,
    //   exportName: enableExports ? `${exportPrefix}-resource-arn` : undefined,
    // });

    // Example: SSM parameters info
    // if (this.ssmParameters) {
    //   new cdk.CfnOutput(this, "SsmParameterPrefix", {
    //     value: this.ssmParameters.pathPrefix,
    //     description: "SSM Parameter Store path prefix",
    //   });
    // }
  }

  // ========================================
  // PUBLIC GETTERS
  // ========================================

  /**
   * Get the resource identifier
   */
  public get resourceId(): string {
    return (this.primaryResource as { resourceId: string }).resourceId;
  }

  // TODO: Add additional public getters as needed
  // public get resourceArn(): string {
  //   return this.primaryResource.resourceArn;
  // }
}

// =============================================================================
// SECTION 4: NEXT STEPS CHECKLIST
// =============================================================================
/**
 * After creating your stack, complete these steps:
 *
 * [ ] 1. Move props interface to lib/shared/types/stack-types.ts
 * [ ] 2. Update bin/app.ts with stack instantiation
 * [ ] 3. Add stack dependencies (addDependency) in bin/app.ts
 * [ ] 4. Create or update lib/stacks/{category}/index.ts barrel export
 * [ ] 5. Update lib/stacks/README.md with stack documentation
 * [ ] 6. Create deployment documentation if complex
 * [ ] 7. Add to .cursor/rules/business-logic.md if domain-specific
 * [ ] 8. Rename this file to {your-stack-name}-stack.ts
 * [ ] 9. Replace all TODO comments with actual implementation
 * [ ] 10. Test deployment: npx cdk synth && npx cdk deploy
 *
 * DEPLOYMENT ORDER:
 * When adding to bin/app.ts, consider stack dependencies:
 *
 * const networkingStack = new NetworkingStack(app, 'Networking', {...});
 * const myStack = new MyStack(app, 'MyStack', {
 *   vpc: networkingStack.vpc,
 *   ...
 * });
 * myStack.addDependency(networkingStack);
 */
