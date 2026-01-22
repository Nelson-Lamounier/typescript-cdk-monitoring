/** @format */

/**
 * Configuration Integration Tests
 *
 * Validates that all configuration files work together correctly and
 * that all environment/project combinations are valid. These tests
 * catch configuration drift and ensure consistency across the codebase.
 *
 * @module tests/unit/config/config-integration
 */

import {
  validateConfiguration,
  validateAllProjects,
} from "../../../config/validation";
import { environments } from "../../../config/environments";
import { projects, getProjectConfig } from "../../../config/projects";
import {
  getSecurityBaseline,
  getEncryptionConfig,
} from "../../../config/security-baseline";
import {
  getDefaultTags,
  validateTags,
  COST_CENTRES,
  DATA_CLASSIFICATION,
} from "../../../config/tagging";

// ============================================================================
// ENVIRONMENT CONFIGURATION TESTS
// ============================================================================

describe("Environment Configuration Integration", () => {
  describe("All environments validate successfully with project", () => {
    const environmentNames = Object.keys(environments);

    environmentNames.forEach((envName) => {
      // Test with a project name since production requires Owner tag
      // which comes from the project configuration
      test(`${envName} environment with monitoring project is valid`, () => {
        const result = validateConfiguration(envName, "monitoring");

        // Validation should pass (no blocking errors)
        // Production may have warnings about IP ranges, certificates, etc.
        // but these are not blocking errors
        expect(result.valid).toBe(true);

        // Log warnings for visibility in test output
        if (result.warnings.length > 0) {
          // Warnings are expected for some environments (especially production)
          // They indicate areas for improvement but don't block deployment
        }
      });
    });
  });

  describe("Non-production environments validate without project", () => {
    const nonProdEnvironments = Object.keys(environments).filter(
      (envName) => !environments[envName].isProduction
    );

    nonProdEnvironments.forEach((envName) => {
      test(`${envName} environment is valid without project`, () => {
        const result = validateConfiguration(envName);

        expect(result.valid).toBe(true);
      });
    });
  });

  describe("Environment config consistency", () => {
    test("all environments have unique VPC CIDRs", () => {
      const cidrs = Object.values(environments).map((e) => e.vpcCidr);
      const uniqueCidrs = new Set(cidrs);

      expect(uniqueCidrs.size).toBe(cidrs.length);
    });

    test("all environments have valid VPC CIDR format", () => {
      const cidrPattern = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;

      Object.entries(environments).forEach(([name, config]) => {
        expect(config.vpcCidr).toMatch(cidrPattern);
      });
    });

    test("all environments have envName matching their key", () => {
      Object.entries(environments).forEach(([key, config]) => {
        expect(config.envName).toBe(key);
      });
    });

    test("NAT gateway counts are non-negative", () => {
      Object.entries(environments).forEach(([name, config]) => {
        const natGateways = config.natGateways ?? 0;
        expect(natGateways).toBeGreaterThanOrEqual(0);
      });
    });
  });

  describe("Production environment requirements", () => {
    const prodEnv = environments.production;

    test("production is marked as production", () => {
      expect(prodEnv.isProduction).toBe(true);
    });

    test("production has at least 1 NAT gateway", () => {
      expect(prodEnv.natGateways).toBeGreaterThanOrEqual(1);
    });

    test("production has valid VPC CIDR", () => {
      expect(prodEnv.vpcCidr).toBeDefined();
      expect(prodEnv.vpcCidr).not.toBe("");
    });
  });

  describe("Development environment requirements", () => {
    const devEnv = environments.development;

    test("development is not marked as production", () => {
      expect(devEnv.isProduction).toBe(false);
    });

    test("development has cost-optimised NAT gateway config", () => {
      // Development should have 0 or 1 NAT gateways for cost optimisation
      expect(devEnv.natGateways).toBeLessThanOrEqual(1);
    });
  });
});

// ============================================================================
// PROJECT CONFIGURATION TESTS
// ============================================================================

describe("Project Configuration Integration", () => {
  describe("All projects validate successfully", () => {
    const projectNames = Object.keys(projects);
    const environmentNames = Object.keys(environments);

    projectNames.forEach((projectName) => {
      environmentNames.forEach((envName) => {
        test(`${projectName} in ${envName} is valid`, () => {
          const result = validateConfiguration(envName, projectName);

          expect(result.valid).toBe(true);
          expect(result.errors).toHaveLength(0);
        });
      });
    });
  });

  describe("Project config consistency", () => {
    test("all projects have unique names", () => {
      const names = Object.values(projects).map((p) => p.name);
      const uniqueNames = new Set(names);

      expect(uniqueNames.size).toBe(names.length);
    });

    test("all projects have valid type", () => {
      Object.values(projects).forEach((project) => {
        expect(project.type).toBeDefined();
      });
    });

    test("project names match their keys", () => {
      Object.entries(projects).forEach(([key, project]) => {
        expect(project.name).toBe(key);
      });
    });
  });

  describe("Project compute configuration", () => {
    test("monitoring project has service resource allocations", () => {
      const config = getProjectConfig("monitoring", "development");

      expect(config.compute?.services).toBeDefined();
      expect(config.compute?.services?.prometheus).toBeDefined();
      expect(config.compute?.services?.grafana).toBeDefined();
    });

    test("capacity settings are valid", () => {
      Object.entries(projects).forEach(([name, project]) => {
        if (project.compute) {
          const min = project.compute.minCapacity ?? 0;
          const max = project.compute.maxCapacity ?? 0;
          const desired = project.compute.desiredCapacity ?? 0;

          expect(min).toBeLessThanOrEqual(desired);
          expect(desired).toBeLessThanOrEqual(max);
        }
      });
    });
  });

  describe("Environment overrides", () => {
    test("production overrides are applied correctly", () => {
      const devConfig = getProjectConfig("monitoring", "development");
      const prodConfig = getProjectConfig("monitoring", "production");

      // Production should have different (larger) instance type
      if (prodConfig.compute?.instanceType && devConfig.compute?.instanceType) {
        expect(prodConfig.compute.instanceType).not.toBe(
          devConfig.compute.instanceType
        );
      }
    });
  });
});

// ============================================================================
// SECURITY BASELINE TESTS
// ============================================================================

describe("Security Baseline Integration", () => {
  describe("All environments have security baselines", () => {
    const environmentNames = Object.keys(environments);

    environmentNames.forEach((envName) => {
      test(`${envName} has a security baseline`, () => {
        const baseline = getSecurityBaseline(envName);

        expect(baseline).toBeDefined();
        expect(baseline.network).toBeDefined();
        expect(baseline.transport).toBeDefined();
        expect(baseline.audit).toBeDefined();
        expect(baseline.protection).toBeDefined();
      });
    });
  });

  describe("Production security requirements", () => {
    const prodBaseline = getSecurityBaseline("production");

    test("production requires HTTPS", () => {
      expect(prodBaseline.transport.enableHttps).toBe(true);
    });

    test("production enables access logs", () => {
      expect(prodBaseline.audit.enableAccessLogs).toBe(true);
    });

    test("production enables VPC flow logs", () => {
      expect(prodBaseline.audit.enableVpcFlowLogs).toBe(true);
    });

    test("production enables deletion protection", () => {
      expect(prodBaseline.protection.enableDeletionProtection).toBe(true);
    });

    test("production uses private subnets", () => {
      expect(prodBaseline.network.usePrivateSubnets).toBe(true);
    });
  });

  describe("Development security settings", () => {
    const devBaseline = getSecurityBaseline("development");

    test("development allows HTTP for ease of development", () => {
      expect(devBaseline.transport.enableHttps).toBe(false);
    });

    test("development disables deletion protection", () => {
      expect(devBaseline.protection.enableDeletionProtection).toBe(false);
    });
  });

  describe("Encryption configuration", () => {
    test("production can have customer-managed KMS keys", () => {
      const encConfig = getEncryptionConfig("production");

      // Encryption config should be defined (may be empty if using AWS-managed keys)
      expect(encConfig).toBeDefined();
    });

    test("development uses AWS-managed keys (no explicit KMS ARNs)", () => {
      const encConfig = getEncryptionConfig("development");

      // Development should not have explicit KMS key ARNs
      expect(encConfig.ebsKmsKeyArn).toBeUndefined();
      expect(encConfig.efsKmsKeyArn).toBeUndefined();
    });
  });
});

// ============================================================================
// TAGGING CONFIGURATION TESTS
// ============================================================================

describe("Tagging Configuration Integration", () => {
  describe("Tags validate for all environments", () => {
    const environmentNames = Object.keys(environments);

    environmentNames.forEach((envName) => {
      test(`${envName} tags are valid`, () => {
        const tags = getDefaultTags(envName, "monitoring");
        const validation = validateTags(tags);

        expect(validation.isValid).toBe(true);
        expect(validation.errors).toHaveLength(0);
      });
    });
  });

  describe("Cost centres are defined", () => {
    test("all environments have cost centres", () => {
      expect(COST_CENTRES.development).toBeDefined();
      expect(COST_CENTRES.staging).toBeDefined();
      expect(COST_CENTRES.production).toBeDefined();
      expect(COST_CENTRES.pipeline).toBeDefined();
    });

    test("cost centres are unique", () => {
      const centres = Object.values(COST_CENTRES);
      const uniqueCentres = new Set(centres);

      expect(uniqueCentres.size).toBe(centres.length);
    });
  });

  describe("Data classification", () => {
    test("all environments have data classification", () => {
      expect(DATA_CLASSIFICATION.development).toBeDefined();
      expect(DATA_CLASSIFICATION.staging).toBeDefined();
      expect(DATA_CLASSIFICATION.production).toBeDefined();
      expect(DATA_CLASSIFICATION.pipeline).toBeDefined();
    });

    test("production has higher classification than development", () => {
      // Production should be confidential, development should be internal
      expect(DATA_CLASSIFICATION.production).toBe("confidential");
      expect(DATA_CLASSIFICATION.development).toBe("internal");
    });
  });

  describe("Required tags are present", () => {
    test("production tags include all required fields", () => {
      const tags = getDefaultTags("production", "monitoring");

      expect(tags.Environment).toBe("production");
      expect(tags.ManagedBy).toBe("CDK");
      expect(tags.Repository).toBeDefined();
      expect(tags.Project).toBe("monitoring");
      expect(tags.CostCentre).toBeDefined();
      expect(tags.Owner).toBeDefined();
      expect(tags.DataClassification).toBeDefined();
    });
  });
});

// ============================================================================
// CROSS-CONFIGURATION CONSISTENCY TESTS
// ============================================================================

describe("Cross-Configuration Consistency", () => {
  describe("VPC CIDR ranges do not overlap", () => {
    test("environment CIDRs use different /16 blocks", () => {
      const cidrs = Object.values(environments).map((e) => e.vpcCidr);

      // Extract the first two octets (network portion of /16)
      const networks = cidrs.map((cidr) =>
        cidr.split("/")[0].split(".").slice(0, 2).join(".")
      );

      const uniqueNetworks = new Set(networks);
      expect(uniqueNetworks.size).toBe(networks.length);
    });
  });

  describe("validateAllProjects function", () => {
    test("validates multiple projects at once", () => {
      const projectNames = Object.keys(projects);
      const results = validateAllProjects("development", projectNames);

      expect(results.size).toBe(projectNames.length);

      results.forEach((result, projectName) => {
        expect(result.valid).toBe(true);
      });
    });
  });

  describe("Configuration completeness", () => {
    test("every environment has all required fields", () => {
      Object.entries(environments).forEach(([name, config]) => {
        expect(config.envName).toBeDefined();
        expect(config.vpcCidr).toBeDefined();
        expect(typeof config.isProduction).toBe("boolean");
      });
    });

    test("every project has required fields", () => {
      Object.entries(projects).forEach(([name, config]) => {
        expect(config.name).toBeDefined();
        expect(config.type).toBeDefined();
      });
    });
  });
});

// ============================================================================
// VALIDATION ERROR HANDLING TESTS
// ============================================================================

describe("Validation Error Handling", () => {
  test("validateConfiguration returns error for non-existent environment", () => {
    const result = validateConfiguration("nonexistent");

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("not found");
  });

  test("getProjectConfig throws for non-existent project", () => {
    expect(() => {
      getProjectConfig("nonexistent", "development");
    }).toThrow();
  });
});
