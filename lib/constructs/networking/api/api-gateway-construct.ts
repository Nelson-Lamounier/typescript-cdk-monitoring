/** @format */

import * as cdk from "aws-cdk-lib";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import * as wafv2 from "aws-cdk-lib/aws-wafv2";
import { Construct } from "constructs";
import { NagSuppressions } from "cdk-nag";

/**
 * Configuration for API Gateway CORS
 */
export interface ApiGatewayCorsConfig {
  /**
   * Allowed origins for CORS
   * @example ['https://example.com', 'http://localhost:3000']
   */
  allowOrigins: string[];

  /**
   * Allowed HTTP methods
   * @default ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
   */
  allowMethods?: string[];

  /**
   * Allowed headers
   * @default ['Content-Type', 'Authorization', 'X-Api-Key']
   */
  allowHeaders?: string[];

  /**
   * Allow credentials
   * @default true
   */
  allowCredentials?: boolean;

  /**
   * Max age for preflight cache (seconds)
   * @default 3600
   */
  maxAge?: number;
}

/**
 * Configuration for API Gateway throttling
 */
export interface ApiGatewayThrottleConfig {
  /**
   * Rate limit (requests per second)
   * @default 1000
   */
  rateLimit?: number;

  /**
   * Burst limit
   * @default 2000
   */
  burstLimit?: number;
}

/**
 * Configuration for API Gateway usage plan
 */
export interface ApiGatewayUsagePlanConfig {
  /**
   * Usage plan name
   */
  name: string;

  /**
   * Usage plan description
   */
  description?: string;

  /**
   * Throttle settings
   */
  throttle?: ApiGatewayThrottleConfig;

  /**
   * Quota settings (requests per period)
   */
  quota?: {
    limit: number;
    period: apigateway.Period;
  };

  /**
   * API keys to associate with this usage plan
   */
  apiKeys?: apigateway.IApiKey[];
}

/**
 * Properties for ApiGatewayConstruct
 */
export interface ApiGatewayConstructProps {
  /**
   * Environment name (e.g., 'development', 'production')
   * Used for resource naming and configuration
   */
  envName: string;

  /**
   * Project name (e.g., 'webapp', 'api')
   * Used for resource naming and tagging
   */
  projectName: string;

  /**
   * API name
   * @example 'articles-api', 'user-api'
   */
  apiName: string;

  /**
   * API description
   */
  description?: string;

  /**
   * Enable CloudWatch logging
   * @default true
   */
  enableLogging?: boolean;

  /**
   * CloudWatch log retention
   * @default RetentionDays.ONE_WEEK (dev), RetentionDays.ONE_MONTH (prod)
   */
  logRetention?: logs.RetentionDays;

  /**
   * Enable request/response logging
   * @default false (enable in production for audit)
   */
  enableDetailedMetrics?: boolean;

  /**
   * Enable API key requirement
   * @default false
   */
  requireApiKey?: boolean;

  /**
   * CORS configuration
   */
  cors?: ApiGatewayCorsConfig;

  /**
   * Throttle configuration
   */
  throttle?: ApiGatewayThrottleConfig;

  /**
   * Usage plans for rate limiting
   */
  usagePlans?: ApiGatewayUsagePlanConfig[];

  /**
   * Enable WAF for DDoS protection
   * @default false (enable in production)
   */
  enableWaf?: boolean;

  /**
   * Custom domain configuration
   */
  customDomain?: {
    domainName: string;
    certificateArn: string;
    basePath?: string;
  };

  /**
   * Deployment stage name
   * @default 'api'
   */
  stageName?: string;

  /**
   * Enable X-Ray tracing
   * @default false (enable in production)
   */
  enableTracing?: boolean;

  /**
   * Removal policy
   * @default RETAIN (production), DESTROY (non-production)
   */
  removalPolicy?: cdk.RemovalPolicy;
}

/**
 * ApiGatewayConstruct - Reusable REST API Gateway with best practices
 *
 * Creates an API Gateway REST API with:
 * - CloudWatch logging and metrics
 * - CORS configuration
 * - Rate limiting and throttling
 * - Usage plans and API keys
 * - Optional WAF protection
 * - Optional custom domain
 * - X-Ray tracing
 *
 * Features:
 * - Automatic staging and deployment
 * - Environment-specific defaults
 * - Comprehensive error responses
 * - Request validation
 * - CDK Nag compliant
 *
 * Cost Optimisation:
 * - CloudWatch Logs retention based on environment
 * - Detailed metrics disabled in development
 * - WAF only in production
 *
 * @example Basic API
 * ```typescript
 * const api = new ApiGatewayConstruct(this, 'ArticlesApi', {
 *   envName: 'production',
 *   projectName: 'webapp',
 *   apiName: 'articles-api',
 *   description: 'Articles API for portfolio',
 *   cors: {
 *     allowOrigins: ['https://example.com'],
 *   },
 *   enableWaf: true,
 * });
 *
 * // Add Lambda integration
 * const getArticles = api.addLambdaIntegration('GET', '/articles', getArticlesFunction);
 * ```
 *
 * @example With Usage Plan
 * ```typescript
 * const api = new ApiGatewayConstruct(this, 'Api', {
 *   envName: 'production',
 *   projectName: 'webapp',
 *   apiName: 'api',
 *   usagePlans: [
 *     {
 *       name: 'basic',
 *       throttle: { rateLimit: 100, burstLimit: 200 },
 *       quota: { limit: 10000, period: apigateway.Period.DAY },
 *     },
 *   ],
 * });
 * ```
 */
export class ApiGatewayConstruct extends Construct {
  public readonly api: apigateway.RestApi;
  public readonly logGroup?: logs.LogGroup;
  public readonly webAcl?: wafv2.CfnWebACL;
  public readonly usagePlans: Map<string, apigateway.UsagePlan> = new Map();

  constructor(
    scope: Construct,
    id: string,
    props: ApiGatewayConstructProps
  ) {
    super(scope, id);

    const {
      envName,
      projectName,
      apiName,
      description,
      enableLogging = true,
      logRetention,
      enableDetailedMetrics = false,
      requireApiKey = false,
      cors,
      throttle,
      usagePlans,
      enableWaf = false,
      customDomain,
      stageName = "api",
      enableTracing = false,
      removalPolicy,
    } = props;

    const isProduction = envName.toLowerCase() === "production";

    // ========================================================================
    // CLOUDWATCH LOG GROUP
    // ========================================================================

    if (enableLogging) {
      const defaultRetention = isProduction
        ? logs.RetentionDays.ONE_MONTH
        : logs.RetentionDays.ONE_WEEK;

      this.logGroup = new logs.LogGroup(this, "ApiLogs", {
        logGroupName: `/aws/apigateway/${envName}-${projectName}-${apiName}`,
        retention: logRetention || defaultRetention,
        removalPolicy:
          removalPolicy ||
          (isProduction ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY),
      });
    }

    // ========================================================================
    // REST API
    // ========================================================================

    this.api = new apigateway.RestApi(this, "RestApi", {
      restApiName: `${envName}-${projectName}-${apiName}`,
      description: description || `${apiName} for ${projectName}`,
      
      // Deployment configuration
      deploy: true,
      deployOptions: {
        stageName,
        loggingLevel: enableLogging
          ? apigateway.MethodLoggingLevel.INFO
          : apigateway.MethodLoggingLevel.OFF,
        dataTraceEnabled: enableDetailedMetrics,
        metricsEnabled: true,
        tracingEnabled: enableTracing,
        accessLogDestination: this.logGroup
          ? new apigateway.LogGroupLogDestination(this.logGroup)
          : undefined,
        accessLogFormat: this.logGroup
          ? apigateway.AccessLogFormat.clf()
          : undefined,
        throttlingRateLimit: throttle?.rateLimit || 1000,
        throttlingBurstLimit: throttle?.burstLimit || 2000,
      },

      // CORS configuration
      defaultCorsPreflightOptions: cors
        ? {
            allowOrigins: cors.allowOrigins,
            allowMethods: cors.allowMethods || [
              "GET",
              "POST",
              "PUT",
              "DELETE",
              "OPTIONS",
            ],
            allowHeaders: cors.allowHeaders || [
              "Content-Type",
              "Authorization",
              "X-Api-Key",
            ],
            allowCredentials: cors.allowCredentials ?? true,
            maxAge: cdk.Duration.seconds(cors.maxAge || 3600),
          }
        : undefined,

      // Default integration responses
      defaultIntegration: undefined, // Will be set per method

      // API key requirement
      apiKeySourceType: requireApiKey
        ? apigateway.ApiKeySourceType.HEADER
        : undefined,

      // CloudWatch role for logging
      cloudWatchRole: enableLogging,

      // Endpoint type (REGIONAL for CloudFront integration)
      endpointTypes: [apigateway.EndpointType.REGIONAL],

      // Fail on warnings during deployment
      failOnWarnings: false,

      // Minimum compression size (bytes)
      minimumCompressionSize: 1024,

      // Policy document for resource policy
      policy: undefined, // Can be added later for VPC/IP restrictions
    });

    // ========================================================================
    // CUSTOM DOMAIN (OPTIONAL)
    // ========================================================================

    if (customDomain) {
      // Custom domain requires ACM certificate
      const domain = new apigateway.DomainName(this, "CustomDomain", {
        domainName: customDomain.domainName,
        certificate: apigateway.Certificate.fromCertificateArn(
          this,
          "Certificate",
          customDomain.certificateArn
        ),
        endpointType: apigateway.EndpointType.REGIONAL,
        securityPolicy: apigateway.SecurityPolicy.TLS_1_2,
      });

      // Base path mapping
      new apigateway.BasePathMapping(this, "BasePathMapping", {
        domainName: domain,
        restApi: this.api,
        basePath: customDomain.basePath,
        stage: this.api.deploymentStage,
      });
    }

    // ========================================================================
    // USAGE PLANS (OPTIONAL)
    // ========================================================================

    if (usagePlans && usagePlans.length > 0) {
      usagePlans.forEach((planConfig) => {
        const usagePlan = this.api.addUsagePlan(planConfig.name, {
          name: `${envName}-${planConfig.name}`,
          description: planConfig.description,
          throttle: planConfig.throttle
            ? {
                rateLimit: planConfig.throttle.rateLimit,
                burstLimit: planConfig.throttle.burstLimit,
              }
            : undefined,
          quota: planConfig.quota,
          apiStages: [
            {
              api: this.api,
              stage: this.api.deploymentStage,
            },
          ],
        });

        // Associate API keys
        if (planConfig.apiKeys) {
          planConfig.apiKeys.forEach((apiKey) => {
            usagePlan.addApiKey(apiKey);
          });
        }

        this.usagePlans.set(planConfig.name, usagePlan);
      });
    }

    // ========================================================================
    // WAF (WEB APPLICATION FIREWALL) - OPTIONAL
    // ========================================================================

    if (enableWaf && isProduction) {
      this.webAcl = new wafv2.CfnWebACL(this, "WebAcl", {
        defaultAction: { allow: {} },
        scope: "REGIONAL",
        visibilityConfig: {
          sampledRequestsEnabled: true,
          cloudWatchMetricsEnabled: true,
          metricName: `${envName}-${projectName}-${apiName}-waf`,
        },
        rules: [
          // Rate limiting rule
          {
            name: "RateLimitRule",
            priority: 1,
            statement: {
              rateBasedStatement: {
                limit: 2000,
                aggregateKeyType: "IP",
              },
            },
            action: { block: {} },
            visibilityConfig: {
              sampledRequestsEnabled: true,
              cloudWatchMetricsEnabled: true,
              metricName: `${envName}-rate-limit`,
            },
          },
          // AWS managed rules - Common Rule Set
          {
            name: "AWSManagedRulesCommonRuleSet",
            priority: 2,
            statement: {
              managedRuleGroupStatement: {
                vendorName: "AWS",
                name: "AWSManagedRulesCommonRuleSet",
              },
            },
            overrideAction: { none: {} },
            visibilityConfig: {
              sampledRequestsEnabled: true,
              cloudWatchMetricsEnabled: true,
              metricName: `${envName}-common-rules`,
            },
          },
          // AWS managed rules - Known Bad Inputs
          {
            name: "AWSManagedRulesKnownBadInputsRuleSet",
            priority: 3,
            statement: {
              managedRuleGroupStatement: {
                vendorName: "AWS",
                name: "AWSManagedRulesKnownBadInputsRuleSet",
              },
            },
            overrideAction: { none: {} },
            visibilityConfig: {
              sampledRequestsEnabled: true,
              cloudWatchMetricsEnabled: true,
              metricName: `${envName}-bad-inputs`,
            },
          },
        ],
      });

      // Associate WAF with API Gateway
      new wafv2.CfnWebACLAssociation(this, "WebAclAssociation", {
        resourceArn: this.api.deploymentStage.stageArn,
        webAclArn: this.webAcl.attrArn,
      });
    }

    // ========================================================================
    // TAGGING
    // ========================================================================

    cdk.Tags.of(this.api).add("Environment", envName);
    cdk.Tags.of(this.api).add("Project", projectName);
    cdk.Tags.of(this.api).add("ManagedBy", "CDK");
    cdk.Tags.of(this.api).add("ApiName", apiName);

    // ========================================================================
    // CDK NAG SUPPRESSIONS
    // ========================================================================

    NagSuppressions.addResourceSuppressions(
      this.api,
      [
        {
          id: "AwsSolutions-APIG2",
          reason:
            "Request validation is implemented per-method basis using validators. Not all endpoints require request validation (e.g., GET requests without bodies).",
        },
        {
          id: "AwsSolutions-APIG4",
          reason:
            "API authorization is implemented per-method using IAM, API keys, or Lambda authorizers as needed. Not all endpoints require authorization (e.g., public read-only endpoints).",
        },
        {
          id: "AwsSolutions-IAM4",
          reason:
            "API Gateway CloudWatch role uses AWS managed policy for logging. This is the standard pattern recommended by AWS.",
          appliesTo: [
            "Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AmazonAPIGatewayPushToCloudWatchLogs",
          ],
        },
      ],
      true
    );
  }

  /**
   * Add Lambda integration to a resource path
   *
   * @param method - HTTP method (GET, POST, PUT, DELETE, etc.)
   * @param path - Resource path (e.g., '/articles', '/articles/{id}')
   * @param lambdaFunction - Lambda function to integrate
   * @param options - Integration options
   * @returns The created Method
   */
  public addLambdaIntegration(
    method: string,
    path: string,
    lambdaFunction: lambda.IFunction,
    options?: {
      requireApiKey?: boolean;
      authorizationType?: apigateway.AuthorizationType;
      requestParameters?: { [key: string]: boolean };
      requestValidator?: apigateway.IRequestValidator;
    }
  ): apigateway.Method {
    // Get or create resource
    const resource = this.getOrCreateResource(path);

    // Create Lambda integration
    const integration = new apigateway.LambdaIntegration(lambdaFunction, {
      proxy: true,
      allowTestInvoke: true,
    });

    // Add method to resource
    const apiMethod = resource.addMethod(method, integration, {
      apiKeyRequired: options?.requireApiKey,
      authorizationType:
        options?.authorizationType || apigateway.AuthorizationType.NONE,
      requestParameters: options?.requestParameters,
      requestValidator: options?.requestValidator,
    });

    return apiMethod;
  }

  /**
   * Get or create a resource path
   *
   * Handles nested paths like '/articles/{id}/comments'
   *
   * @param path - Resource path
   * @returns The resource
   */
  private getOrCreateResource(path: string): apigateway.Resource {
    const segments = path.split("/").filter((s) => s.length > 0);
    let resource: apigateway.IResource = this.api.root;

    for (const segment of segments) {
      const existing = resource.getResource(segment);
      if (existing) {
        resource = existing;
      } else {
        resource = resource.addResource(segment);
      }
    }

    return resource as apigateway.Resource;
  }

  /**
   * Create an API key for programmatic access
   *
   * @param keyName - API key name
   * @param description - API key description
   * @returns The created API key
   */
  public createApiKey(
    keyName: string,
    description?: string
  ): apigateway.ApiKey {
    return this.api.addApiKey(`${keyName}Key`, {
      apiKeyName: `${this.api.restApiName}-${keyName}`,
      description: description || `API key for ${keyName}`,
    });
  }

  /**
   * Create a request validator
   *
   * @param validatorName - Validator name
   * @param options - Validation options
   * @returns The created validator
   */
  public createRequestValidator(
    validatorName: string,
    options: {
      validateRequestBody?: boolean;
      validateRequestParameters?: boolean;
    }
  ): apigateway.RequestValidator {
    return new apigateway.RequestValidator(this, `${validatorName}Validator`, {
      restApi: this.api,
      requestValidatorName: validatorName,
      validateRequestBody: options.validateRequestBody ?? false,
      validateRequestParameters: options.validateRequestParameters ?? false,
    });
  }
}
