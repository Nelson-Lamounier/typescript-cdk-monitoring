/** @format */

import { Construct } from "constructs";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as cdk from "aws-cdk-lib";

export interface AcmCertificateConstructProps {
  domainName: string;
  subjectAlternativeNames?: string[];
  hostedZone?: route53.IHostedZone;
  validationMethod?: acm.ValidationMethod;
  envName: string;
  existingCertificateArn?: string;
  enableDnsValidation?: boolean;
}

/**
 * Reusable construct for creating and managing ACM certificates
 *
 * This construct handles:
 * - Creating ACM certificates with DNS validation
 * - Automatic validation via Route 53 (if hosted zone provided)
 * - Importing existing certificates
 * - Proper tagging and lifecycle management
 *
 * Features:
 * - DNS validation with Route 53 (automatic)
 * - Email validation (manual)
 * - Support for wildcard certificates
 * - Multiple subject alternative names
 * - Certificate import for existing certificates
 * - Automatic resource tagging
 *
 * Usage Examples:
 *
 * @example
 * // Create new certificate with automatic DNS validation
 * const cert = new AcmCertificateConstruct(this, 'Certificate', {
 *   domainName: 'example.com',
 *   subjectAlternativeNames: ['*.example.com'],
 *   hostedZone: route53.HostedZone.fromLookup(this, 'Zone', {
 *     domainName: 'example.com'
 *   }),
 *   envName: 'production',
 * });
 *
 * @example
 * // Import existing certificate
 * const cert = new AcmCertificateConstruct(this, 'Certificate', {
 *   domainName: 'example.com',
 *   existingCertificateArn: 'arn:aws:acm:us-east-1:123456789012:certificate/abc123',
 *   envName: 'production',
 * });
 *
 * @example
 * // Create certificate with email validation (manual process)
 * const cert = new AcmCertificateConstruct(this, 'Certificate', {
 *   domainName: 'example.com',
 *   validationMethod: acm.ValidationMethod.EMAIL,
 *   envName: 'production',
 * });
 */
export class AcmCertificateConstruct extends Construct {
  public readonly certificate: acm.ICertificate;
  public readonly certificateArn: string;

  constructor(
    scope: Construct,
    id: string,
    props: AcmCertificateConstructProps
  ) {
    super(scope, id);

    const {
      domainName,
      subjectAlternativeNames,
      hostedZone,
      validationMethod = acm.ValidationMethod.DNS,
      envName,
      existingCertificateArn,
      enableDnsValidation = !!hostedZone,
    } = props;

    // Import existing certificate if ARN is provided
    if (existingCertificateArn) {
      this.certificate = acm.Certificate.fromCertificateArn(
        this,
        "ImportedCertificate",
        existingCertificateArn
      );
      this.certificateArn = existingCertificateArn;

      // Output certificate info
      new cdk.CfnOutput(this, "CertificateArnOutput", {
        value: this.certificateArn,
        description: `ACM Certificate ARN (imported) for ${domainName}`,
        exportName: `${envName}-certificate-arn`,
      });

      return;
    }

    // Create new certificate
    const certificateConfig: acm.CertificateProps = {
      domainName,
      subjectAlternativeNames,
    };

    // Configure validation method
    if (validationMethod === acm.ValidationMethod.DNS && enableDnsValidation) {
      if (!hostedZone) {
        throw new Error(
          "hostedZone is required for DNS validation. Either provide a hosted zone or set validationMethod to EMAIL."
        );
      }

      // Automatic DNS validation with Route 53
      this.certificate = new acm.Certificate(this, "Certificate", {
        ...certificateConfig,
        validation: acm.CertificateValidation.fromDns(hostedZone),
      });
    } else if (validationMethod === acm.ValidationMethod.DNS) {
      // DNS validation without automatic Route 53 validation
      // User must manually create DNS records
      this.certificate = new acm.Certificate(this, "Certificate", {
        ...certificateConfig,
        validation: acm.CertificateValidation.fromDns(),
      });
    } else {
      // Email validation
      this.certificate = new acm.Certificate(this, "Certificate", {
        ...certificateConfig,
        validation: acm.CertificateValidation.fromEmail(),
      });
    }

    this.certificateArn = this.certificate.certificateArn;

    // Add tags
    cdk.Tags.of(this.certificate).add("Environment", envName);
    cdk.Tags.of(this.certificate).add("ManagedBy", "CDK");
    cdk.Tags.of(this.certificate).add("DomainName", domainName);

    // Output certificate ARN
    new cdk.CfnOutput(this, "CertificateArnOutput", {
      value: this.certificateArn,
      description: `ACM Certificate ARN for ${domainName}`,
      exportName: `${envName}-certificate-arn`,
    });

    // Output domain name
    new cdk.CfnOutput(this, "CertificateDomainName", {
      value: domainName,
      description: "Primary domain name for the certificate",
      exportName: `${envName}-certificate-domain`,
    });

    // Output validation method info
    if (validationMethod === acm.ValidationMethod.DNS && !enableDnsValidation) {
      new cdk.CfnOutput(this, "ValidationInstructions", {
        value:
          "Manual DNS validation required. Check ACM console for DNS records to create.",
        description: "Certificate validation instructions",
      });
    }
  }

  /**
   * Get the certificate ARN
   */
  public getCertificateArn(): string {
    return this.certificateArn;
  }

  /**
   * Get the certificate resource
   */
  public getCertificate(): acm.ICertificate {
    return this.certificate;
  }
}
