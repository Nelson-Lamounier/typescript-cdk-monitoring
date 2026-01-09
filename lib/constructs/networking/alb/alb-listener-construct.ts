/** @format */

import * as cdk from "aws-cdk-lib";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { Construct } from "constructs";

export interface AlbListenerConstructProps {
  /**
   * The Application Load Balancer to add the listener to
   */
  loadBalancer: elbv2.IApplicationLoadBalancer;

  /**
   * Whether to enable HTTP listener
   * @default true
   */
  enableHttp?: boolean;

  /**
   * Whether to enable HTTPS listener
   * @default false
   */
  enableHttps?: boolean;

  /**
   * SSL certificate ARN for HTTPS listeners
   */
  certificateArn?: string;

  /**
   * Whether to redirect HTTP to HTTPS
   * @default false
   */
  redirectHttpToHttps?: boolean;

  /**
   * SSL policy for HTTPS listeners
   * @default ELBSecurityPolicy-TLS-1-2-2017-01
   */
  sslPolicy?: elbv2.SslPolicy;
}

/**
 * Construct for creating ALB listeners (HTTP and HTTPS)
 */
export class AlbListenerConstruct extends Construct {
  public readonly httpListener?: elbv2.ApplicationListener;
  public readonly httpsListener?: elbv2.ApplicationListener;
  public readonly listener: elbv2.ApplicationListener; // Primary listener for backward compatibility

  constructor(scope: Construct, id: string, props: AlbListenerConstructProps) {
    super(scope, id);

    const {
      loadBalancer,
      enableHttp = true,
      enableHttps = false,
      certificateArn,
      redirectHttpToHttps = false,
      sslPolicy = elbv2.SslPolicy.TLS12,
    } = props;

    // Create HTTP listener if enabled
    if (enableHttp) {
      const httpAction =
        redirectHttpToHttps && enableHttps
          ? elbv2.ListenerAction.redirect({
              protocol: "HTTPS",
              port: "443",
              permanent: true,
            })
          : elbv2.ListenerAction.fixedResponse(404, {
              contentType: "text/plain",
              messageBody: "Not Found",
            });

      this.httpListener = loadBalancer.addListener("HttpListener", {
        port: 80,
        protocol: elbv2.ApplicationProtocol.HTTP,
        defaultAction: httpAction,
      });
    }

    // Create HTTPS listener if enabled
    if (enableHttps && certificateArn) {
      this.httpsListener = loadBalancer.addListener("HttpsListener", {
        port: 443,
        protocol: elbv2.ApplicationProtocol.HTTPS,
        defaultAction: elbv2.ListenerAction.fixedResponse(404, {
          contentType: "text/plain",
          messageBody: "Not Found",
        }),
        certificates: [elbv2.ListenerCertificate.fromArn(certificateArn)],
        sslPolicy,
      });
    }

    // Set primary listener (HTTPS if available, otherwise HTTP)
    this.listener = this.httpsListener || this.httpListener!;

    // Output listener information
    if (this.httpListener) {
      new cdk.CfnOutput(this, "HttpListenerArn", {
        value: this.httpListener.listenerArn,
        description: "HTTP Listener ARN",
        exportName: `${cdk.Stack.of(this).stackName}-http-listener-arn`,
      });
    }

    if (this.httpsListener) {
      new cdk.CfnOutput(this, "HttpsListenerArn", {
        value: this.httpsListener.listenerArn,
        description: "HTTPS Listener ARN",
        exportName: `${cdk.Stack.of(this).stackName}-https-listener-arn`,
      });
    }
  }

  /**
   * Add a target group to the primary listener
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
   * Get the primary listener (HTTPS if available, otherwise HTTP)
   */
  public get primaryListener(): elbv2.ApplicationListener {
    return this.listener;
  }
}
