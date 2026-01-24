/** @format */

import * as cdk from "aws-cdk-lib";

import { CertificateStack } from "../../lib/stacks/networking/security/acm-stack";

export interface CertificateConfig {
  certificateArn?: string;
  certificateStack?: CertificateStack;
  isConfigured: boolean;
}

/**
 * Resolve ACM certificate for HTTPS
 * Priority: Environment variable > Create new > SSM lookup
 */
export function resolveCertificate(
  app: cdk.App,
  envName: string,
  stackProps: cdk.StackProps,
  rootDomainName?: string,
  hostedZoneId?: string
): CertificateConfig {
  let certificateArn: string | undefined;
  let certificateStack: CertificateStack | undefined;

  // 1. Check environment variable (from CI/CD)
  if (process.env.CERTIFICATE_ARN) {
    certificateArn = process.env.CERTIFICATE_ARN;
    return {
      certificateArn,
      isConfigured: true,
    };
  }

  // 2. Create new certificate (if domain configured)
  if (rootDomainName && hostedZoneId) {
    certificateStack = new CertificateStack(app, `${envName}-Certificate`, {
      ...stackProps,
      envName,
      DomainName: rootDomainName,
      subjectAlternativeNames: [`*.${rootDomainName}`],
      hostedZoneId,
      storeCertificateArnInSsm: true,
    });

    return {
      certificateArn: certificateStack.certificateArn,
      certificateStack,
      isConfigured: true,
    };
  }

  // 3. Try SSM lookup (fallback for local development)
  if (process.env.SKIP_DOMAIN_LOOKUP !== "true") {
    try {
      certificateArn = cdk.aws_ssm.StringParameter.valueFromLookup(
        app,
        "/portfolio/domain/acm-arn"
      );

      if (!certificateArn?.includes("dummy-value")) {
        return {
          certificateArn,
          isConfigured: true,
        };
      }
    } catch {
      // SSM parameter doesn't exist
    }
  }

  // No certificate configured
  return {
    isConfigured: false,
  };
}

/**
 * Resolve domain configuration
 */
export function resolveDomainConfig(app: cdk.App): {
  rootDomainName?: string;
  hostedZoneId?: string;
} {
  let rootDomainName: string | undefined;
  let hostedZoneId: string | undefined;

  // Check environment variables first
  if (process.env.ROOT_DOMAIN_NAME && process.env.HOSTED_ZONE_ID) {
    return {
      rootDomainName: process.env.ROOT_DOMAIN_NAME,
      hostedZoneId: process.env.HOSTED_ZONE_ID,
    };
  }

  // Try SSM lookup
  if (process.env.SKIP_DOMAIN_LOOKUP !== "true") {
    try {
      rootDomainName = cdk.aws_ssm.StringParameter.valueFromLookup(
        app,
        "/portfolio/domain/root-domain-name"
      );
      hostedZoneId = cdk.aws_ssm.StringParameter.valueFromLookup(
        app,
        "/portfolio/domain/hosted-zone-id"
      );

      // Check for dummy values
      if (
        rootDomainName?.includes("dummy-value") ||
        hostedZoneId?.includes("dummy-value")
      ) {
        return {};
      }

      return { rootDomainName, hostedZoneId };
    } catch {
      // Parameters don't exist
    }
  }

  return {};
}
