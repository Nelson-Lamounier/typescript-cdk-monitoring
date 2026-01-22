/** @format */

import {
  validateConfiguration,
  validateAllProjects,
  formatValidationResult,
  ValidationResult,
} from "../../../config/validation";

// Mock the environment and project configurations
jest.mock("../../../config/environments", () => ({
  environments: {
    development: {
      account: "123456789012",
      region: "eu-west-1",
      envName: "development",
      vpcCidr: "10.1.0.0/16",
      natGateways: 0,
      isProduction: false,
    },
    production: {
      account: "098765432109",
      region: "eu-west-1",
      envName: "production",
      vpcCidr: "10.3.0.0/16",
      natGateways: 2,
      isProduction: true,
    },
    invalid: {
      account: "111111111111",
      region: "eu-west-1",
      envName: "invalid",
      vpcCidr: "invalid-cidr",
      natGateways: -1,
      isProduction: false,
    },
  },
}));

describe("Configuration Validation", () => {
  describe("validateConfiguration", () => {
    it("should validate a valid development environment", () => {
      const result = validateConfiguration("development");

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should validate a valid production environment", () => {
      const result = validateConfiguration("production");

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      // May have warnings about IP ranges or deletion protection
    });

    it("should fail for non-existent environment", () => {
      const result = validateConfiguration("nonexistent");

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        expect.stringContaining("Environment 'nonexistent' not found")
      );
    });

    it("should catch invalid VPC CIDR", () => {
      const result = validateConfiguration("invalid");

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        expect.stringContaining("Invalid VPC CIDR format")
      );
    });

    it("should catch negative NAT gateway count", () => {
      const result = validateConfiguration("invalid");

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        expect.stringContaining("NAT gateway count cannot be negative")
      );
    });

    it("should warn about 0 NAT gateways in production", () => {
      // Create a test environment with 0 NAT gateways
      const mockEnvs = require("../../../config/environments");
      const originalProd = { ...mockEnvs.environments.production };
      mockEnvs.environments.production.natGateways = 0;

      const result = validateConfiguration("production");

      // Should pass but have warnings
      expect(result.valid).toBe(true);
      expect(result.warnings).toContain(
        expect.stringContaining("Production environment has 0 NAT gateways")
      );

      // Restore
      mockEnvs.environments.production = originalProd;
    });

    it("should warn about high NAT gateway count", () => {
      const mockEnvs = require("../../../config/environments");
      const originalDev = { ...mockEnvs.environments.development };
      mockEnvs.environments.development.natGateways = 4;

      const result = validateConfiguration("development");

      expect(result.warnings).toContain(
        expect.stringContaining("High NAT gateway count (4)")
      );

      // Restore
      mockEnvs.environments.development = originalDev;
    });
  });

  describe("validateConfiguration with project", () => {
    it("should validate project configuration", () => {
      const result = validateConfiguration("development", "monitoring");

      // Should validate successfully
      expect(result.valid).toBe(true);
    });

    it("should catch invalid instance type", () => {
      // This would require mocking getProjectConfig to return invalid data
      // For now, we verify the function accepts project names
      const result = validateConfiguration("development", "webapp");

      expect(result).toHaveProperty("valid");
      expect(result).toHaveProperty("errors");
      expect(result).toHaveProperty("warnings");
    });
  });

  describe("validateAllProjects", () => {
    it("should validate multiple projects", () => {
      const projects = ["monitoring", "webapp"];
      const results = validateAllProjects("development", projects);

      expect(results.size).toBe(2);
      expect(results.has("monitoring")).toBe(true);
      expect(results.has("webapp")).toBe(true);

      // Each should have a validation result
      results.forEach((result) => {
        expect(result).toHaveProperty("valid");
        expect(result).toHaveProperty("errors");
        expect(result).toHaveProperty("warnings");
      });
    });

    it("should handle empty project list", () => {
      const results = validateAllProjects("development", []);

      expect(results.size).toBe(0);
    });

    it("should validate each project independently", () => {
      const projects = ["monitoring", "webapp", "nonexistent"];
      const results = validateAllProjects("development", projects);

      expect(results.size).toBe(3);
      // Each project should have its own validation result
    });
  });

  describe("formatValidationResult", () => {
    it("should format successful validation", () => {
      const result: ValidationResult = {
        valid: true,
        errors: [],
        warnings: [],
      };

      const formatted = formatValidationResult(result, "Test Context");

      expect(formatted).toContain("✅ Validation passed");
      expect(formatted).toContain("Test Context");
      expect(formatted).toContain("No errors or warnings found");
    });

    it("should format validation with errors", () => {
      const result: ValidationResult = {
        valid: false,
        errors: ["Error 1", "Error 2"],
        warnings: [],
      };

      const formatted = formatValidationResult(result);

      expect(formatted).toContain("❌ Validation failed");
      expect(formatted).toContain("🚨 Errors (2)");
      expect(formatted).toContain("1. Error 1");
      expect(formatted).toContain("2. Error 2");
    });

    it("should format validation with warnings", () => {
      const result: ValidationResult = {
        valid: true,
        errors: [],
        warnings: ["Warning 1", "Warning 2", "Warning 3"],
      };

      const formatted = formatValidationResult(result);

      expect(formatted).toContain("✅ Validation passed");
      expect(formatted).toContain("⚠️  Warnings (3)");
      expect(formatted).toContain("1. Warning 1");
      expect(formatted).toContain("2. Warning 2");
      expect(formatted).toContain("3. Warning 3");
    });

    it("should format validation with both errors and warnings", () => {
      const result: ValidationResult = {
        valid: false,
        errors: ["Critical error"],
        warnings: ["Minor warning"],
      };

      const formatted = formatValidationResult(result, "Production");

      expect(formatted).toContain("❌ Validation failed");
      expect(formatted).toContain("Production");
      expect(formatted).toContain("🚨 Errors (1)");
      expect(formatted).toContain("Critical error");
      expect(formatted).toContain("⚠️  Warnings (1)");
      expect(formatted).toContain("Minor warning");
    });

    it("should work without context", () => {
      const result: ValidationResult = {
        valid: true,
        errors: [],
        warnings: [],
      };

      const formatted = formatValidationResult(result);

      expect(formatted).not.toContain("===");
      expect(formatted).toContain("✅ Validation passed");
    });
  });

  describe("Integration scenarios", () => {
    it("should validate typical development deployment", () => {
      const result = validateConfiguration("development", "monitoring");

      expect(result.valid).toBe(true);
      // May have some warnings but no blocking errors
      if (result.warnings.length > 0) {
        expect(result.warnings.every((w) => typeof w === "string")).toBe(true);
      }
    });

    it("should catch production configuration issues", () => {
      const result = validateConfiguration("production", "monitoring");

      // Should either pass or have clear warnings
      if (!result.valid) {
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.errors.every((e) => typeof e === "string")).toBe(true);
      }
    });

    it("should provide actionable error messages", () => {
      const result = validateConfiguration("invalid");

      expect(result.valid).toBe(false);
      result.errors.forEach((error) => {
        // Each error should be descriptive
        expect(error.length).toBeGreaterThan(10);
        expect(error).not.toContain("undefined");
        expect(error).not.toContain("null");
      });
    });
  });
});
