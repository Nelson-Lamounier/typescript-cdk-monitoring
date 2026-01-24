/** @format */

import * as ec2 from "aws-cdk-lib/aws-ec2";
import {
  parseInstanceType,
  getInstanceTypeFromConfig,
  getInstanceTypeFromConfigWithEnvDefault,
  validateInstanceType,
} from "../../../lib/shared/helpers/instance-type-helper";
import { ProjectConfig, ProjectType } from "../../../config/projects";

describe("Instance Type Helper", () => {
  describe("parseInstanceType", () => {
    it("should parse t3.small correctly", () => {
      const result = parseInstanceType("t3.small");
      expect(result).toEqual(
        ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.SMALL)
      );
    });

    it("should parse t3.medium correctly", () => {
      const result = parseInstanceType("t3.medium");
      expect(result).toEqual(
        ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MEDIUM)
      );
    });

    it("should parse m5.large correctly", () => {
      const result = parseInstanceType("m5.large");
      expect(result).toEqual(
        ec2.InstanceType.of(ec2.InstanceClass.M5, ec2.InstanceSize.LARGE)
      );
    });

    it("should parse c6i.2xlarge correctly", () => {
      const result = parseInstanceType("c6i.2xlarge");
      expect(result).toEqual(
        ec2.InstanceType.of(ec2.InstanceClass.C6I, ec2.InstanceSize.XLARGE2)
      );
    });

    it("should throw error for invalid format", () => {
      expect(() => parseInstanceType("invalid")).toThrow(
        'Invalid instance type string: invalid. Expected format: "family.size"'
      );
    });

    it("should throw error for empty string", () => {
      expect(() => parseInstanceType("")).toThrow("Invalid instance type string");
    });

    it("should throw error for unknown instance class", () => {
      expect(() => parseInstanceType("xyz.small")).toThrow(
        "Unknown instance class: xyz"
      );
    });

    it("should throw error for unknown instance size", () => {
      expect(() => parseInstanceType("t3.unknown")).toThrow(
        "Unknown instance size: unknown"
      );
    });
  });

  describe("getInstanceTypeFromConfig", () => {
    it("should return instance type from config", () => {
      const projectConfig: ProjectConfig = {
        name: "test",
        type: ProjectType.WEBAPP,
        compute: {
          instanceType: "t3.medium",
        },
      };

      const result = getInstanceTypeFromConfig(projectConfig);
      expect(result).toEqual(
        ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MEDIUM)
      );
    });

    it("should use default when config has no instance type", () => {
      const projectConfig: ProjectConfig = {
        name: "test",
        type: ProjectType.WEBAPP,
      };

      const result = getInstanceTypeFromConfig(projectConfig);
      expect(result).toEqual(
        ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.SMALL)
      );
    });

    it("should use custom default when provided", () => {
      const projectConfig: ProjectConfig = {
        name: "test",
        type: ProjectType.WEBAPP,
      };

      const result = getInstanceTypeFromConfig(projectConfig, "m5.large");
      expect(result).toEqual(
        ec2.InstanceType.of(ec2.InstanceClass.M5, ec2.InstanceSize.LARGE)
      );
    });

    it("should use config value over default", () => {
      const projectConfig: ProjectConfig = {
        name: "test",
        type: ProjectType.WEBAPP,
        compute: {
          instanceType: "c5.xlarge",
        },
      };

      const result = getInstanceTypeFromConfig(projectConfig, "t3.micro");
      expect(result).toEqual(
        ec2.InstanceType.of(ec2.InstanceClass.C5, ec2.InstanceSize.XLARGE)
      );
    });
  });

  describe("getInstanceTypeFromConfigWithEnvDefault", () => {
    it("should use production default for production env", () => {
      const projectConfig: ProjectConfig = {
        name: "test",
        type: ProjectType.WEBAPP,
      };

      const result = getInstanceTypeFromConfigWithEnvDefault(
        projectConfig,
        true // isProduction
      );
      expect(result).toEqual(
        ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MEDIUM)
      );
    });

    it("should use non-production default for dev env", () => {
      const projectConfig: ProjectConfig = {
        name: "test",
        type: ProjectType.WEBAPP,
      };

      const result = getInstanceTypeFromConfigWithEnvDefault(
        projectConfig,
        false // isProduction
      );
      expect(result).toEqual(
        ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.SMALL)
      );
    });

    it("should use config value over environment defaults", () => {
      const projectConfig: ProjectConfig = {
        name: "test",
        type: ProjectType.WEBAPP,
        compute: {
          instanceType: "m5.2xlarge",
        },
      };

      const result = getInstanceTypeFromConfigWithEnvDefault(
        projectConfig,
        true // isProduction
      );
      expect(result).toEqual(
        ec2.InstanceType.of(ec2.InstanceClass.M5, ec2.InstanceSize.XLARGE2)
      );
    });

    it("should use custom production default when provided", () => {
      const projectConfig: ProjectConfig = {
        name: "test",
        type: ProjectType.WEBAPP,
      };

      const result = getInstanceTypeFromConfigWithEnvDefault(
        projectConfig,
        true, // isProduction
        "c5.large", // prodDefault
        "t3.micro" // nonProdDefault
      );
      expect(result).toEqual(
        ec2.InstanceType.of(ec2.InstanceClass.C5, ec2.InstanceSize.LARGE)
      );
    });

    it("should use custom non-production default when provided", () => {
      const projectConfig: ProjectConfig = {
        name: "test",
        type: ProjectType.WEBAPP,
      };

      const result = getInstanceTypeFromConfigWithEnvDefault(
        projectConfig,
        false, // isProduction
        "c5.large", // prodDefault
        "t3.micro" // nonProdDefault
      );
      expect(result).toEqual(
        ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO)
      );
    });
  });

  describe("validateInstanceType", () => {
    it("should validate correct instance type", () => {
      const result = validateInstanceType("t3.small");
      expect(result.isValid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("should return error for invalid format", () => {
      const result = validateInstanceType("invalid");
      expect(result.isValid).toBe(false);
      expect(result.error).toContain("Invalid instance type string");
    });

    it("should return error for unknown instance class", () => {
      const result = validateInstanceType("xyz.small");
      expect(result.isValid).toBe(false);
      expect(result.error).toContain("Unknown instance class");
    });

    it("should return error for unknown instance size", () => {
      const result = validateInstanceType("t3.unknown");
      expect(result.isValid).toBe(false);
      expect(result.error).toContain("Unknown instance size");
    });

    it("should validate various common instance types", () => {
      const validTypes = [
        "t3.micro",
        "t3.small",
        "t3.medium",
        "t3.large",
        "m5.xlarge",
        "c5.2xlarge",
        "r5.4xlarge",
      ];

      validTypes.forEach((type) => {
        const result = validateInstanceType(type);
        expect(result.isValid).toBe(true);
      });
    });
  });
});
