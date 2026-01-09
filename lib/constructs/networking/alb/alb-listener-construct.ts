/** @format */

import * as cdk from "aws-cdk-lib";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { Construct } from "constructs";

import { AlbListenerConstructProps } from "../../../shared/types/networking-types";
import {
  validateCertificateForHttps,
  validateRedirectPrerequisites,
  validateAtLeastOneListener,
} from "../../../shared/utils/validation";
import {
  DEFAULT_ALB_HTTP_PORT,
  DEFAULT_ALB_HTTPS_PORT,
  DEFAULT_ALB_FIXED_RESPONSE_STATUS_CODE,
  DEFAULT_ALB_FIXED_RESPONSE_CONTENT_TYPE,
  DEFAULT_ALB_FIXED_RESPONSE_MESSAGE,
} from "../../../shared/constants/networking-constants";

/**
 * Reusable construct for creating ALB listeners (HTTP and HTTPS) with enhanced security and validation
 *
 * This construct creates ALB listeners with:
 * - Comprehensive input validation
 * - Security best practices (TLS 1.3 by default)
 * - Production environment warnings
 * - Support for SNI (multiple certificates)
 * - Configurable default actions
 * - Enhanced listener rule support
 *
 * Features:
 * - HTTP and/or HTTPS listeners
 * - HTTP to HTTPS redirect support
 * - Multiple SSL certificates (SNI)
 * - Configurable ports
 * - Production security warnings
 * - Environment and project tagging
 *
 * @example
 * ```typescript
 * const listener = new AlbListenerConstruct(this, 'Listener', {
 *   loadBalancer: alb,
 *   envName: 'production',
 *   projectName: 'monitoring',
 *   enableHttp: true,
 *   enableHttps: true,
 *   certificateArn: 'arn:aws:acm:...',
 *   redirectHttpToHttps: true,
 * });
 * ```
 */
export class AlbListenerConstruct extends Construct {
  public readonly httpListener?: elbv2.ApplicationListener;
  public readonly httpsListener?: elbv2.ApplicationListener;
  public readonly listener: elbv2.ApplicationListener; // Primary listener (HTTPS if available, otherwise HTTP)

  constructor(scope: Construct, id: string, props: AlbListenerConstructProps) {
    super(scope, id);

    const {
      loadBalancer,
      envName,
      projectName,
      enableHttp = true,
      enableHttps = false,
      httpPort = DEFAULT_ALB_HTTP_PORT,
      httpsPort = DEFAULT_ALB_HTTPS_PORT,
      certificateArn,
      additionalCertificates = [],
      redirectHttpToHttps = false,
      sslPolicy = elbv2.SslPolicy.TLS13_RES, // TLS 1.3 by default
      httpDefaultAction,
      httpsDefaultAction,
      preserveXForwardedFor: _preserveXForwardedFor = true, // Note: ALB preserves X-Forwarded-For by default
      preserveXForwardedProto: _preserveXForwardedProto = true, // Note: ALB preserves X-Forwarded-Proto by default
      loadBalancerName,
    } = props;

    // ========================================
    // Input Validation
    // ========================================

    // Validate environment name
    if (
      !envName ||
      typeof envName !== "string" ||
      envName.trim().length === 0
    ) {
      throw new Error(
        "Environment name (envName) is required for AlbListenerConstruct.\n\n" +
          "Troubleshooting Steps:\n" +
          " 1. Ensure envName property is provided in AlbListenerConstructProps\n" +
          " 2. Use standard environment names: 'development', 'staging', 'production', 'pipeline'\n" +
          " 3. The environment name is used for tagging and resource identification"
      );
    }

    // Validate at least one listener is enabled
    validateAtLeastOneListener(enableHttp, enableHttps);

    // Validate certificate when HTTPS is enabled
    validateCertificateForHttps(enableHttps, certificateArn);

    // Validate redirect prerequisites
    validateRedirectPrerequisites(redirectHttpToHttps, enableHttp, enableHttps);

    // ========================================
    // Production Warnings
    // ========================================

    // Warn about HTTPS not enabled in production
    if (
      !enableHttps &&
      (envName === "production" || envName === "prod")
    ) {
      cdk.Annotations.of(this).addWarning(
        "SECURITY WARNING: HTTPS is disabled in production environment.\n" +
          "HTTPS should be enabled in production for secure communication.\n" +
          "Consider setting enableHttps: true and providing a certificateArn."
      );
    }

    // Warn about weak SSL policy in production
    if (
      enableHttps &&
      (envName === "production" || envName === "prod") &&
      sslPolicy !== elbv2.SslPolicy.TLS13_RES &&
      sslPolicy !== elbv2.SslPolicy.TLS13_EXT1 &&
      sslPolicy !== elbv2.SslPolicy.TLS13_EXT2
    ) {
      cdk.Annotations.of(this).addWarning(
        `SECURITY WARNING: Using SSL policy ${String(sslPolicy)} in production.\n` +
          "TLS 1.3 is recommended for production environments.\n" +
          "Consider using SslPolicy.TLS13_RES, SslPolicy.TLS13_EXT1, or SslPolicy.TLS13_EXT2 for better security."
      );
    }

    // ========================================
    // Default Actions
    // ========================================

    // Create default action for HTTP listener
    const defaultHttpAction =
      httpDefaultAction ||
      (redirectHttpToHttps && enableHttps
        ? elbv2.ListenerAction.redirect({
            protocol: "HTTPS",
            port: String(httpsPort),
            permanent: true,
          })
        : elbv2.ListenerAction.fixedResponse(
            DEFAULT_ALB_FIXED_RESPONSE_STATUS_CODE,
            {
              contentType: DEFAULT_ALB_FIXED_RESPONSE_CONTENT_TYPE,
              messageBody: DEFAULT_ALB_FIXED_RESPONSE_MESSAGE,
            }
          ));

    // Create default action for HTTPS listener
    const defaultHttpsAction =
      httpsDefaultAction ||
      elbv2.ListenerAction.fixedResponse(
        DEFAULT_ALB_FIXED_RESPONSE_STATUS_CODE,
        {
          contentType: DEFAULT_ALB_FIXED_RESPONSE_CONTENT_TYPE,
          messageBody: DEFAULT_ALB_FIXED_RESPONSE_MESSAGE,
        }
      );

    // ========================================
    // HTTP Listener
    // ========================================

    if (enableHttp) {
      this.httpListener = loadBalancer.addListener("HttpListener", {
        port: httpPort,
        protocol: elbv2.ApplicationProtocol.HTTP,
        defaultAction: defaultHttpAction,
      });

      // Tag HTTP listener
      cdk.Tags.of(this.httpListener).add("Environment", envName);
      cdk.Tags.of(this.httpListener).add("ManagedBy", "CDK");
      cdk.Tags.of(this.httpListener).add("ResourceType", "ApplicationListener");
      cdk.Tags.of(this.httpListener).add("Protocol", "HTTP");

      if (projectName) {
        cdk.Tags.of(this.httpListener).add("Project", projectName);
      }
    }

    // ========================================
    // HTTPS Listener
    // ========================================

    if (enableHttps && certificateArn) {
      // Build certificate list (primary + additional for SNI)
      const certificates = [
        elbv2.ListenerCertificate.fromArn(certificateArn),
        ...additionalCertificates.map((arn) =>
          elbv2.ListenerCertificate.fromArn(arn)
        ),
      ];

      this.httpsListener = loadBalancer.addListener("HttpsListener", {
        port: httpsPort,
        protocol: elbv2.ApplicationProtocol.HTTPS,
        defaultAction: defaultHttpsAction,
        certificates,
        sslPolicy,
      });

      // Tag HTTPS listener
      cdk.Tags.of(this.httpsListener).add("Environment", envName);
      cdk.Tags.of(this.httpsListener).add("ManagedBy", "CDK");
      cdk.Tags.of(this.httpsListener).add("ResourceType", "ApplicationListener");
      cdk.Tags.of(this.httpsListener).add("Protocol", "HTTPS");

      if (projectName) {
        cdk.Tags.of(this.httpsListener).add("Project", projectName);
      }
    }

    // ========================================
    // Primary Listener Selection
    // ========================================

    // Set primary listener (HTTPS preferred, fallback to HTTP)
    // Explicitly validate that at least one exists
    if (this.httpsListener) {
      this.listener = this.httpsListener;
    } else if (this.httpListener) {
      this.listener = this.httpListener;
    } else {
      // This should never happen due to validation, but provides safety
      throw new Error(
        "No listeners were created. This indicates a validation error."
      );
    }

    // ========================================
    // CloudFormation Outputs
    // ========================================

    // Create unique export names to avoid conflicts
    const stackName = cdk.Stack.of(this).stackName;
    const uniqueSuffix = loadBalancerName
      ? `${loadBalancerName}-`
      : `${stackName}-`;

    if (this.httpListener) {
      new cdk.CfnOutput(this, "HttpListenerArn", {
        value: this.httpListener.listenerArn,
        description: "HTTP Listener ARN",
        exportName: `${uniqueSuffix}http-listener-arn`,
      });
    }

    if (this.httpsListener) {
      new cdk.CfnOutput(this, "HttpsListenerArn", {
        value: this.httpsListener.listenerArn,
        description: "HTTPS Listener ARN",
        exportName: `${uniqueSuffix}https-listener-arn`,
      });
    }
  }

  /**
   * Add a target group to the primary listener
   *
   * @param id - Unique identifier for the rule
   * @param targetGroup - Target group to forward traffic to
   * @param priority - Rule priority (lower numbers = higher priority)
   * @param conditions - Conditions for the rule (path, host, header, etc.)
   */
  public addTargetGroup(
    id: string,
    targetGroup: elbv2.IApplicationTargetGroup,
    priority: number,
    conditions: elbv2.ListenerCondition[]
  ): void {
    this.listener.addTargetGroups(id, {
      targetGroups: [targetGroup],
      priority,
      conditions,
    });
  }

  /**
   * Add a listener rule with path-based routing
   *
   * @param id - Unique identifier for the rule
   * @param targetGroup - Target group to forward traffic to
   * @param pathPattern - Path pattern to match (e.g., "/api/*")
   * @param priority - Rule priority (lower numbers = higher priority)
   */
  public addPathRule(
    id: string,
    targetGroup: elbv2.IApplicationTargetGroup,
    pathPattern: string,
    priority: number
  ): void {
    this.listener.addTargetGroups(id, {
      targetGroups: [targetGroup],
      priority,
      conditions: [elbv2.ListenerCondition.pathPatterns([pathPattern])],
    });
  }

  /**
   * Add a listener rule with host-based routing
   *
   * @param id - Unique identifier for the rule
   * @param targetGroup - Target group to forward traffic to
   * @param hostPattern - Host pattern to match (e.g., "*.example.com")
   * @param priority - Rule priority (lower numbers = higher priority)
   */
  public addHostRule(
    id: string,
    targetGroup: elbv2.IApplicationTargetGroup,
    hostPattern: string,
    priority: number
  ): void {
    this.listener.addTargetGroups(id, {
      targetGroups: [targetGroup],
      priority,
      conditions: [elbv2.ListenerCondition.hostHeaders([hostPattern])],
    });
  }

  /**
   * Add a listener rule with header-based routing
   *
   * @param id - Unique identifier for the rule
   * @param targetGroup - Target group to forward traffic to
   * @param headerName - Header name to match
   * @param headerValues - Header values to match
   * @param priority - Rule priority (lower numbers = higher priority)
   */
  public addHeaderRule(
    id: string,
    targetGroup: elbv2.IApplicationTargetGroup,
    headerName: string,
    headerValues: string[],
    priority: number
  ): void {
    this.listener.addTargetGroups(id, {
      targetGroups: [targetGroup],
      priority,
      conditions: [
        elbv2.ListenerCondition.httpHeader(headerName, headerValues),
      ],
    });
  }

  /**
   * Add a listener rule with weighted target groups (for blue/green or canary deployments)
   *
   * @param id - Unique identifier for the rule
   * @param targetGroups - Array of target groups with weights
   * @param priority - Rule priority (lower numbers = higher priority)
   * @param conditions - Optional conditions for the rule
   */
  public addWeightedTargetGroups(
    id: string,
    targetGroups: Array<{
      targetGroup: elbv2.IApplicationTargetGroup;
      weight: number;
    }>,
    priority: number,
    conditions?: elbv2.ListenerCondition[]
  ): void {
    // Calculate total weight for validation
    const totalWeight = targetGroups.reduce(
      (sum, tg) => sum + tg.weight,
      0
    );

    if (totalWeight === 0) {
      throw new Error(
        "Total weight of target groups must be greater than 0.\n\n" +
          "Troubleshooting Steps:\n" +
          " 1. Ensure at least one target group has a weight > 0\n" +
          " 2. Weights determine the percentage of traffic sent to each target group"
      );
    }

    // Create forward action with weighted target groups
    const forwardAction = elbv2.ListenerAction.weightedForward(
      targetGroups.map((tg) => ({
        targetGroup: tg.targetGroup,
        weight: tg.weight,
      }))
    );

    this.listener.addAction(id, {
      action: forwardAction,
      priority,
      conditions: conditions || [],
    });
  }

  /**
   * Add authentication action (Cognito or OIDC)
   *
   * This method allows you to add authentication before forwarding to a target group.
   * Create the authentication action using ListenerAction.authenticateOidc() and include
   * the forward action in the 'next' property.
   *
   * @param id - Unique identifier for the rule
   * @param authenticateAction - Authentication action created with ListenerAction.authenticateOidc()
   *                             Must include 'next' property with forward action to target group
   * @param _targetGroup - Target group parameter (kept for API compatibility, but should be included in authenticateAction)
   * @param priority - Rule priority (lower numbers = higher priority)
   * @param conditions - Optional conditions for the rule
   *
   * @example
   * ```typescript
   * const authAction = elbv2.ListenerAction.authenticateOidc({
   *   authorizationEndpoint: 'https://example.com/auth',
   *   tokenEndpoint: 'https://example.com/token',
   *   userInfoEndpoint: 'https://example.com/userinfo',
   *   clientId: 'client-id',
   *   clientSecret: cdk.SecretValue.secretsManager('secret'),
   *   next: elbv2.ListenerAction.forward([targetGroup]), // Include target group here
   * });
   *
   * listener.addAuthentication('AuthRule', authAction, targetGroup, 100);
   * ```
   */
  public addAuthentication(
    id: string,
    authenticateAction: elbv2.ListenerAction,
    _targetGroup: elbv2.IApplicationTargetGroup, // Kept for API compatibility
    priority: number,
    conditions?: elbv2.ListenerCondition[]
  ): void {
    // Note: The authenticateAction should already include the 'next' forward action
    // This method just adds it to the listener with the specified priority and conditions
    this.listener.addAction(id, {
      action: authenticateAction,
      priority,
      conditions: conditions || [],
    });
  }

  /**
   * Get the primary listener (HTTPS if available, otherwise HTTP)
   */
  public get primaryListener(): elbv2.ApplicationListener {
    return this.listener;
  }
}
