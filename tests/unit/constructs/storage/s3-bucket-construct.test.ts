/** @format */
/// <reference types="jest" />

/**
 * S3BucketConstruct Unit Tests
 *
 * Tests the reusable S3 bucket construct with various configurations
 */

import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Template } from "aws-cdk-lib/assertions";

import { S3BucketConstruct } from "../../../../lib/constructs/storage/s3";

describe("S3BucketConstruct", () => {
  let app: cdk.App;
  let stack: cdk.Stack;

  beforeEach(() => {
    app = new cdk.App();
    stack = new cdk.Stack(app, "TestStack", {
      env: {
        account: "123456789012",
        region: "eu-west-1",
      },
    });
  });

  // ==========================================================================
  // Basic Creation Tests
  // ==========================================================================

  describe("Basic Creation", () => {
    test("should create S3 bucket with minimal configuration", () => {
      // Arrange & Act
      const construct = new S3BucketConstruct(stack, "TestBucket", {
        envName: "development",
        config: {
          bucketName: "test-bucket-development-123456789012",
          purpose: "Test Bucket",
        },
      });

      // Assert
      expect(construct.bucket).toBeDefined();
      expect(construct.bucketName).toBe(
        "test-bucket-development-123456789012"
      );
      expect(construct.bucketArn).toBeTruthy();

      const template = Template.fromStack(stack);
      template.resourceCountIs("AWS::S3::Bucket", 1);
    });

    test("should create bucket with all properties", () => {
      // Arrange & Act
      new S3BucketConstruct(stack, "FullBucket", {
        envName: "production",
        config: {
          bucketName: "full-bucket-production-123456789012",
          purpose: "Full Configuration Bucket",
          encryption: s3.BucketEncryption.S3_MANAGED,
          versioned: true,
          removalPolicy: cdk.RemovalPolicy.RETAIN,
          lifecycleRules: [
            {
              id: "TestRule",
              enabled: true,
              expiration: cdk.Duration.days(30),
            },
          ],
        },
      });

      // Assert
      const template = Template.fromStack(stack);
      template.hasResourceProperties("AWS::S3::Bucket", {
        BucketName: "full-bucket-production-123456789012",
        VersioningConfiguration: {
          Status: "Enabled",
        },
        BucketEncryption: {
          ServerSideEncryptionConfiguration: [
            {
              ServerSideEncryptionByDefault: {
                SSEAlgorithm: "AES256",
              },
            },
          ],
        },
      });
    });
  });

  // ==========================================================================
  // Environment-Specific Defaults
  // ==========================================================================

  describe("Environment-Specific Defaults", () => {
    test("should apply production defaults", () => {
      // Arrange & Act
      new S3BucketConstruct(stack, "ProdBucket", {
        envName: "production",
        config: {
          bucketName: "prod-bucket-production-123456789012",
          purpose: "Production Bucket",
        },
      });

      // Assert
      const template = Template.fromStack(stack);
      template.hasResourceProperties("AWS::S3::Bucket", {
        VersioningConfiguration: {
          Status: "Enabled",
        },
      });
    });

    test("should apply non-production defaults", () => {
      // Arrange & Act
      new S3BucketConstruct(stack, "DevBucket", {
        envName: "development",
        config: {
          bucketName: "dev-bucket-development-123456789012",
          purpose: "Development Bucket",
        },
      });

      // Assert
      const template = Template.fromStack(stack);
      const bucket = template.findResources("AWS::S3::Bucket");
      const bucketProperties = Object.values(bucket)[0].Properties;

      // Versioning should be disabled (or not specified) for non-production
      expect(
        bucketProperties.VersioningConfiguration?.Status
      ).not.toBe("Enabled");
    });
  });

  // ==========================================================================
  // Encryption Tests
  // ==========================================================================

  describe("Encryption", () => {
    test("should enable SSE-S3 encryption by default", () => {
      // Arrange & Act
      new S3BucketConstruct(stack, "EncryptedBucket", {
        envName: "development",
        config: {
          bucketName: "encrypted-bucket-development-123456789012",
          purpose: "Encrypted Bucket",
        },
      });

      // Assert
      const template = Template.fromStack(stack);
      template.hasResourceProperties("AWS::S3::Bucket", {
        BucketEncryption: {
          ServerSideEncryptionConfiguration: [
            {
              ServerSideEncryptionByDefault: {
                SSEAlgorithm: "AES256",
              },
            },
          ],
        },
      });
    });
  });

  // ==========================================================================
  // Public Access Block Tests
  // ==========================================================================

  describe("Public Access Block", () => {
    test("should block all public access by default", () => {
      // Arrange & Act
      new S3BucketConstruct(stack, "SecureBucket", {
        envName: "development",
        config: {
          bucketName: "secure-bucket-development-123456789012",
          purpose: "Secure Bucket",
        },
      });

      // Assert
      const template = Template.fromStack(stack);
      template.hasResourceProperties("AWS::S3::Bucket", {
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          BlockPublicPolicy: true,
          IgnorePublicAcls: true,
          RestrictPublicBuckets: true,
        },
      });
    });
  });

  // ==========================================================================
  // Lifecycle Rules Tests
  // ==========================================================================

  describe("Lifecycle Rules", () => {
    test("should apply lifecycle rules", () => {
      // Arrange & Act
      new S3BucketConstruct(stack, "LifecycleBucket", {
        envName: "development",
        config: {
          bucketName: "lifecycle-bucket-development-123456789012",
          purpose: "Lifecycle Bucket",
          lifecycleRules: [
            {
              id: "DeleteOldFiles",
              enabled: true,
              expiration: cdk.Duration.days(90),
            },
          ],
        },
      });

      // Assert
      const template = Template.fromStack(stack);
      template.hasResourceProperties("AWS::S3::Bucket", {
        LifecycleConfiguration: {
          Rules: [
            {
              Id: "DeleteOldFiles",
              Status: "Enabled",
              ExpirationInDays: 90,
            },
          ],
        },
      });
    });
  });

  // ==========================================================================
  // Validation Tests
  // ==========================================================================

  describe("Validation", () => {
    test("should throw error for invalid bucket name (too short)", () => {
      // Arrange, Act & Assert
      expect(() => {
        new S3BucketConstruct(stack, "InvalidBucket1", {
          envName: "development",
          config: {
            bucketName: "ab",
            purpose: "Invalid Bucket",
          },
        });
      }).toThrow(/must be between 3 and 63 characters/);
    });

    test("should throw error for invalid bucket name (uppercase)", () => {
      // Arrange, Act & Assert
      expect(() => {
        new S3BucketConstruct(stack, "InvalidBucket2", {
          envName: "development",
          config: {
            bucketName: "Invalid-Bucket-Name",
            purpose: "Invalid Bucket",
          },
        });
      }).toThrow(/must.*use only lowercase/i);
    });

    test("should throw error for bucket name with consecutive periods", () => {
      // Arrange, Act & Assert
      expect(() => {
        new S3BucketConstruct(stack, "InvalidBucket3", {
          envName: "development",
          config: {
            bucketName: "invalid..bucket..name",
            purpose: "Invalid Bucket",
          },
        });
      }).toThrow(/consecutive periods/);
    });
  });

  // ==========================================================================
  // IAM Permissions Tests
  // ==========================================================================

  describe("IAM Permissions", () => {
    test("should grant read permissions", () => {
      // Arrange
      const construct = new S3BucketConstruct(stack, "ReadBucket", {
        envName: "development",
        config: {
          bucketName: "read-bucket-development-123456789012",
          purpose: "Read Bucket",
        },
      });

      const role = new cdk.aws_iam.Role(stack, "TestRole", {
        assumedBy: new cdk.aws_iam.ServicePrincipal("ec2.amazonaws.com"),
      });

      // Act
      const grant = construct.grantRead(role);

      // Assert
      expect(grant.success).toBe(true);
    });

    test("should grant write permissions", () => {
      // Arrange
      const construct = new S3BucketConstruct(stack, "WriteBucket", {
        envName: "development",
        config: {
          bucketName: "write-bucket-development-123456789012",
          purpose: "Write Bucket",
        },
      });

      const role = new cdk.aws_iam.Role(stack, "TestRole", {
        assumedBy: new cdk.aws_iam.ServicePrincipal("ec2.amazonaws.com"),
      });

      // Act
      const grant = construct.grantWrite(role);

      // Assert
      expect(grant.success).toBe(true);
    });
  });

  // ==========================================================================
  // Tagging Tests
  // ==========================================================================

  describe("Tagging", () => {
    test("should apply standard tags", () => {
      // Arrange & Act
      new S3BucketConstruct(stack, "TaggedBucket", {
        envName: "development",
        config: {
          bucketName: "tagged-bucket-development-123456789012",
          purpose: "Dashboard Storage",
        },
      });

      // Assert
      const template = Template.fromStack(stack);
      template.hasResourceProperties("AWS::S3::Bucket", {
        Tags: [
          {
            Key: "Environment",
            Value: "development",
          },
          {
            Key: "Purpose",
            Value: "Dashboard Storage",
          },
          {
            Key: "ManagedBy",
            Value: "CDK",
          },
        ],
      });
    });
  });
});
