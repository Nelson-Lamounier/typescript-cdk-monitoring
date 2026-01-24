/** @format */

import * as cdk from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as ssm from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";

/**
 * Properties for the CertificateStack
 */
export interface CertificateStackProps extends cdk.StackProps {
  /** Environment name for resource naming and tagging */
  envName: string;
  /** Primary domain name for the certificate */
  DomainName: string;
  /** Optional subject alternative names (e.g., wildcard domains) */
  subjectAlternativeNames?: string[];
  /** Route53 Hosted Zone ID for DNS validation */
  hostedZoneId: string;
  /** Whether to store the certificate ARN in SSM Parameter Store */
  storeCertificateArnInSsm?: boolean;
  /** SSM parameter path for certificate ARN (default: /portfolio/domain/acm-arn) */
  ssmParameterPath?: string;
}

/**
 * CertificateStack - Creates ACM certificates with DNS validation
 *
 * This stack provisions:
 * - ACM certificate with DNS validation via Route53
 * - Optional SSM parameter for cross-stack reference
 * - CloudFormation exports for certificate ARN
 *
 * @example
 * ```typescript
 * const certStack = new CertificateStack(app, 'Certificate', {
 *   envName: 'production',
 *   DomainName: 'example.com',
 *   subjectAlternativeNames: ['*.example.com'],
 *   hostedZoneId: 'Z1234567890ABC',
 *   storeCertificateArnInSsm: true,
 * });
 * ```
 */
export class CertificateStack extends cdk.Stack {
  /** The ARN of the created certificate */
  public readonly certificateArn: string;

  /** The certificate construct */
  public readonly certificate: acm.ICertificate;

  constructor(scope: Construct, id: string, props: CertificateStackProps) {
    super(scope, id, props);

    // ========================================================================
    // Input Validation
    // ========================================================================
    if (!props.DomainName) {
      throw new Error(
        "DomainName is required for CertificateStack.\n\n" +
          "Provide the primary domain name for the certificate."
      );
    }

    if (!props.hostedZoneId) {
      throw new Error(
        "hostedZoneId is required for CertificateStack.\n\n" +
          "Provide the Route53 Hosted Zone ID for DNS validation."
      );
    }

    // ========================================================================
    // Lookup Hosted Zone
    // ========================================================================
    const hostedZone = route53.HostedZone.fromHostedZoneAttributes(
      this,
      "HostedZone",
      {
        hostedZoneId: props.hostedZoneId,
        zoneName: props.DomainName,
      }
    );

    // ========================================================================
    // Create ACM Certificate
    // ========================================================================
    this.certificate = new acm.Certificate(this, "Certificate", {
      domainName: props.DomainName,
      subjectAlternativeNames: props.subjectAlternativeNames,
      validation: acm.CertificateValidation.fromDns(hostedZone),
      certificateName: `${props.envName}-${props.DomainName.replace(/\./g, "-")}`,
    });

    this.certificateArn = this.certificate.certificateArn;

    // ========================================================================
    // SSM Parameter (optional)
    // ========================================================================
    if (props.storeCertificateArnInSsm) {
      const parameterPath =
        props.ssmParameterPath ?? "/portfolio/domain/acm-arn";

      new ssm.StringParameter(this, "CertificateArnParameter", {
        parameterName: parameterPath,
        stringValue: this.certificateArn,
        description: `ACM Certificate ARN for ${props.DomainName}`,
        tier: ssm.ParameterTier.STANDARD,
      });
    }

    // ========================================================================
    // CloudFormation Outputs
    // ========================================================================
    new cdk.CfnOutput(this, "CertificateArnOutput", {
      value: this.certificateArn,
      description: `ACM Certificate ARN for ${props.DomainName}`,
      exportName: `${props.envName}-certificate-arn`,
    });

    // ========================================================================
    // Stack Tags
    // ========================================================================
    cdk.Tags.of(this).add("Environment", props.envName);
    cdk.Tags.of(this).add("ManagedBy", "CDK");
    cdk.Tags.of(this).add("Purpose", "ACM-Certificate");
  }
}
