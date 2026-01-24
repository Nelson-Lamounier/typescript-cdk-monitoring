/** @format */

/**
 * =============================================================================
 * CONSTRUCT TEMPLATE
 * =============================================================================
 *
 * This template provides a starting point for creating new CDK constructs.
 * Replace placeholder values and uncomment sections as needed.
 *
 * FILE LOCATION:
 * - Place in: lib/constructs/{category}/{resource-name}-construct.ts
 * - Example:  lib/constructs/compute/ecs/my-service-construct.ts
 *
 * NAMING CONVENTIONS:
 * - File:      kebab-case-construct.ts
 * - Class:     PascalCaseConstruct
 * - Props:     PascalCaseConstructProps
 *
 * AFTER CREATING:
 * 1. Add types to lib/shared/types/{category}-types.ts
 * 2. Add constants to lib/shared/constants/{category}-constants.ts
 * 3. Add validations to lib/shared/utils/validation.ts
 * 4. Update index.ts in the construct directory
 *
 * =============================================================================
 */

// =============================================================================
// SECTION 1: IMPORTS
// =============================================================================
// Organise imports in this order:
// 1. AWS CDK core imports (alphabetical)
// 2. CDK service-specific imports (alphabetical)
// 3. Third-party imports
// 4. Internal imports: constants, types, utils (in that order)

// import * as cdk from "aws-cdk-lib";
// import * as ec2 from "aws-cdk-lib/aws-ec2";
// import * as ecs from "aws-cdk-lib/aws-ecs";
// import * as iam from "aws-cdk-lib/aws-iam";
// import * as kms from "aws-cdk-lib/aws-kms";
// import * as logs from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";

// Internal imports - uncomment and adjust paths as needed
// import {
//   DEFAULT_RESOURCE_VALUE,
//   ANOTHER_CONSTANT,
// } from "../../shared/constants/{category}-constants";
// import { MyConstructProps } from "../../shared/types/{category}-types";
// import {
//   validateEnvName,
//   validateSomeInput,
// } from "../../shared/utils/validation";

// =============================================================================
// SECTION 2: PROPS INTERFACE
// =============================================================================
// RECOMMENDATION: Define props in lib/shared/types/{category}-types.ts
// for reusability. Only define locally for self-contained constructs.
// This interface serves as a template - move it to shared/types/ when ready.

/**
 * Props for MyConstruct
 *
 * NOTE: Move this interface to lib/shared/types/{category}-types.ts
 * and import it instead for better maintainability.
 */
export interface MyConstructProps {
  // ========================================
  // REQUIRED PROPERTIES
  // ========================================
  // Document each required property with JSDoc

  /**
   * Environment name (e.g., development, staging, production)
   * Used for resource naming, tagging, and environment-specific configuration
   */
  envName: string;

  // TODO: Add your required properties here
  // Example:
  // /**
  //  * VPC to deploy resources into
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

  /**
   * Custom resource name (overrides generated name)
   * @default {envName}-{projectName}-resource
   */
  resourceName?: string;

  // ========================================
  // OPTIONAL PROPERTIES - Configuration
  // ========================================
  // Add configuration properties with defaults

  // TODO: Add your optional configuration properties here
  // Example:
  // /**
  //  * Instance type for compute resources
  //  * @default ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.SMALL)
  //  */
  // instanceType?: ec2.InstanceType;

  /**
   * Minimum capacity
   * @default 1
   */
  minCapacity?: number;

  /**
   * Maximum capacity
   * @default 2
   */
  maxCapacity?: number;

  // ========================================
  // OPTIONAL PROPERTIES - Security
  // ========================================

  // TODO: Add security-related properties
  // Example:
  // /**
  //  * IAM role for the resource
  //  * @default A new role is created with minimal permissions
  //  */
  // role?: iam.IRole;

  // /**
  //  * KMS key for encryption
  //  * @default AWS managed key
  //  */
  // kmsKey?: kms.IKey;

  // ========================================
  // OPTIONAL PROPERTIES - Logging
  // ========================================

  // TODO: Add logging properties
  // /**
  //  * Log retention period
  //  * @default logs.RetentionDays.ONE_MONTH for production, TWO_WEEKS otherwise
  //  */
  // logRetention?: logs.RetentionDays;

  // ========================================
  // OPTIONAL PROPERTIES - Feature Flags
  // ========================================

  // TODO: Add feature flag properties
  // /**
  //  * Enable detailed monitoring
  //  * @default false
  //  */
  // enableDetailedMonitoring?: boolean;
}

// =============================================================================
// SECTION 3: CONSTRUCT CLASS
// =============================================================================

/**
 * MyConstruct - Brief description of what this construct creates
 *
 * This construct creates:
 * - Primary resource with configuration
 * - Secondary resource (if applicable)
 * - Security settings and IAM permissions
 *
 * Features:
 * - Feature 1: Description
 * - Feature 2: Description
 * - Feature 3: Description
 *
 * Dependencies:
 * - VPC (required)
 * - List any other required external resources
 *
 * Cost Considerations:
 * - Resource 1: Estimated cost information
 * - Resource 2: Estimated cost information
 *
 * Security:
 * - Uses encryption at rest (KMS)
 * - Follows principle of least privilege for IAM
 * - Environment-specific security warnings for production
 *
 * @example
 * ```typescript
 * const myResource = new MyConstruct(this, 'MyResource', {
 *   envName: 'production',
 *   projectName: 'monitoring',
 *   vpc: myVpc,
 * });
 *
 * // Access the underlying resource
 * console.log(myResource.resourceId);
 * ```
 *
 * @see https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_service-readme.html
 */
export class MyConstruct extends Construct {
  // ========================================
  // PUBLIC PROPERTIES
  // ========================================
  // Expose resources that consumers may need to reference
  // Use readonly to prevent external modification

  /**
   * The primary resource created by this construct
   *
   * TODO: Replace 'unknown' with the actual resource type
   * Example: public readonly cluster: ecs.Cluster;
   */
  public readonly primaryResource: unknown;

  // TODO: Add additional public properties as needed
  // /**
  //  * The secondary resource (if applicable)
  //  */
  // public readonly secondaryResource: SomeType;

  // ========================================
  // CONSTRUCTOR
  // ========================================
  constructor(scope: Construct, id: string, props: MyConstructProps) {
    super(scope, id);

    // ========================================
    // STEP 1: VALIDATION (Fail Fast)
    // ========================================
    // Validate all inputs at the start to provide clear error messages
    // Use validation functions from lib/shared/utils/validation.ts

    // TODO: Uncomment and use the centralized validation function
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
          " 1. Provide envName in construct props\n" +
          " 2. Use standard values such as 'development', 'staging', 'production', or 'pipeline'\n" +
          " 3. Ensure the value is not undefined or null",
      );
    }

    // TODO: Add custom validation for your construct's required inputs
    // Example:
    // if (!props.vpc) {
    //   throw new Error(
    //     "VPC is required for MyConstruct.\n\n" +
    //       "Troubleshooting Steps:\n" +
    //       " 1. Create a VPC using VpcConstruct or ec2.Vpc\n" +
    //       " 2. Pass the VPC instance in the props"
    //   );
    // }

    // ========================================
    // STEP 2: EXTRACT PROPS WITH DEFAULTS
    // ========================================
    // Destructure props with defaults from constants
    // Use constants from lib/shared/constants/{category}-constants.ts

    const {
      envName,
      projectName,
      resourceName,
      minCapacity = 1, // TODO: Replace with DEFAULT_MIN_CAPACITY from constants
      maxCapacity = 2, // TODO: Replace with DEFAULT_MAX_CAPACITY from constants
    } = props;

    // Resolve environment-specific defaults
    const isProduction = envName === "production" || envName === "prod";

    // TODO: Add more default resolutions as needed
    // const logRetention = props.logRetention ?? (isProduction
    //   ? logs.RetentionDays.THREE_MONTHS
    //   : logs.RetentionDays.TWO_WEEKS);

    // ========================================
    // STEP 3: PRODUCTION WARNINGS
    // ========================================
    // Warn about potential issues in production environments

    if (isProduction) {
      // TODO: Add environment-specific warnings
      // Example for single AZ warning:
      // if (props.singleAz) {
      //   cdk.Annotations.of(this).addWarning(
      //     "Single availability zone detected in production environment. " +
      //       "This creates a single point of failure. Consider deploying across " +
      //       "multiple availability zones for high availability."
      //   );
      // }
    }

    // ========================================
    // STEP 4: RESOURCE NAMING
    // ========================================
    // Generate consistent resource names

    const finalResourceName =
      resourceName ||
      (projectName
        ? `${envName}-${projectName}-resource`
        : `${envName}-resource`);

    // ========================================
    // STEP 5: CREATE PRIMARY RESOURCE
    // ========================================
    // Use L2 or L3 constructs where available
    // Only use L1 (Cfn*) constructs when L2/L3 doesn't exist

    // TODO: Replace with actual resource creation
    // Example using L2 construct:
    // this.primaryResource = new ec2.SecurityGroup(this, "SecurityGroup", {
    //   vpc: props.vpc,
    //   securityGroupName: finalResourceName,
    //   description: `Security group for ${envName} ${projectName ?? ""}`,
    //   allowAllOutbound: false, // Security best practice
    // });

    // Placeholder for template compilation
    this.primaryResource = {
      resourceId: `placeholder-${finalResourceName}`,
    };

    // Log capacity for debugging (remove in production code)
    console.log(
      `Creating resource with capacity: ${minCapacity}-${maxCapacity}`,
    );

    // ========================================
    // STEP 6: CREATE SECONDARY RESOURCES
    // ========================================
    // Create related resources that depend on primary resource

    // TODO: Add secondary resource creation if needed
    // Example:
    // this.logGroup = new logs.LogGroup(this, "LogGroup", {
    //   logGroupName: `/aws/my-service/${envName}`,
    //   retention: logRetention,
    //   removalPolicy: isProduction
    //     ? cdk.RemovalPolicy.RETAIN
    //     : cdk.RemovalPolicy.DESTROY,
    // });

    // ========================================
    // STEP 7: SECURITY CONFIGURATION
    // ========================================
    // Configure security settings, IAM permissions, encryption

    // TODO: Add security configuration
    // Example:
    // this.configureSecurityRules(props);
    // this.configureEncryption(props);

    // ========================================
    // STEP 8: TAGGING
    // ========================================
    // Apply consistent tags to all resources

    // TODO: Uncomment and apply to your actual resources
    // cdk.Tags.of(this.primaryResource).add("Name", finalResourceName);
    // cdk.Tags.of(this.primaryResource).add("Environment", envName);
    // cdk.Tags.of(this.primaryResource).add("ManagedBy", "CDK");
    // if (projectName) {
    //   cdk.Tags.of(this.primaryResource).add("Project", projectName);
    // }

    // ========================================
    // STEP 9: CLOUDFORMATION OUTPUTS
    // ========================================
    // Create outputs for cross-stack references

    // TODO: Uncomment and customise outputs
    // new cdk.CfnOutput(this, "ResourceId", {
    //   value: this.primaryResource.resourceId,
    //   description: `Resource ID for ${envName}`,
    //   exportName: `${cdk.Stack.of(this).stackName}-resource-id`,
    // });

    // ========================================
    // STEP 10: CDK NAG SUPPRESSIONS (if needed)
    // ========================================
    // Suppress CDK Nag warnings with documented justifications

    // TODO: Add suppressions only when necessary with clear justification
    // Example:
    // import { NagSuppressions } from "cdk-nag";
    //
    // NagSuppressions.addResourceSuppressions(
    //   this.primaryResource,
    //   [
    //     {
    //       id: "AwsSolutions-IAM5",
    //       reason:
    //         "Wildcard permissions required for dynamic resource discovery. " +
    //         "Limited to read-only actions on specific service.",
    //       appliesTo: ["Resource::*"],
    //     },
    //   ],
    //   true
    // );
  }

  // ========================================
  // PUBLIC METHODS
  // ========================================
  // Expose functionality for consumers

  /**
   * Get the resource identifier
   *
   * @returns The unique identifier of the primary resource
   */
  public get resourceId(): string {
    // TODO: Replace with actual property access
    return (this.primaryResource as { resourceId: string }).resourceId;
  }

  // TODO: Add additional public methods as needed
  // /**
  //  * Add an ingress rule to allow access from a source
  //  *
  //  * @param peer - The source peer (IP, security group, etc.)
  //  * @param port - The port to allow
  //  * @param description - Optional description for the rule
  //  *
  //  * @example
  //  * ```typescript
  //  * myConstruct.addIngressRule(
  //  *   ec2.Peer.ipv4("10.0.0.0/16"),
  //  *   ec2.Port.tcp(443),
  //  *   "Allow HTTPS from VPC"
  //  * );
  //  * ```
  //  */
  // public addIngressRule(
  //   peer: ec2.IPeer,
  //   port: ec2.Port,
  //   description?: string
  // ): void {
  //   this.securityGroup.addIngressRule(peer, port, description);
  // }

  // ========================================
  // PRIVATE METHODS
  // ========================================
  // Internal helper methods

  // TODO: Add private methods for complex logic
  // /**
  //  * Configure security rules for the resource
  //  */
  // private configureSecurityRules(props: MyConstructProps): void {
  //   // Security configuration logic
  // }

  // /**
  //  * Configure encryption settings
  //  */
  // private configureEncryption(props: MyConstructProps): void {
  //   // Encryption configuration logic
  // }

  // /**
  //  * Resolve environment-specific defaults
  //  */
  // private resolveDefault(envName: string): string {
  //   const isProduction = envName === "production" || envName === "prod";
  //   return isProduction ? "prod-value" : "dev-value";
  // }
}

// =============================================================================
// SECTION 4: NEXT STEPS CHECKLIST
// =============================================================================
/**
 * After creating your construct, complete these steps:
 *
 * [ ] 1. Move props interface to lib/shared/types/{category}-types.ts
 * [ ] 2. Add constants to lib/shared/constants/{category}-constants.ts
 * [ ] 3. Add validation functions to lib/shared/utils/validation.ts
 * [ ] 4. Update lib/constructs/{category}/index.ts with export
 * [ ] 5. Update lib/constructs/{category}/{subcategory}/index.ts if applicable
 * [ ] 6. Create unit tests in tests/unit/constructs/{category}/
 * [ ] 7. Rename this file to {your-resource}-construct.ts
 * [ ] 8. Replace all TODO comments with actual implementation
 * [ ] 9. Remove template comments once implementation is complete
 * [ ] 10. Add usage example to README.md if construct is complex
 */
