/** @format */

import {
  getDefaultTags,
  getResourceTags,
  toTagsRecord,
  validateTags,
  getCostAllocationTags,
  COST_CENTRES,
  PROJECT_OWNERS,
  DATA_CLASSIFICATION,
  TagConfig,
} from "../../../config/tagging";

describe("Tagging Configuration", () => {
  describe("getDefaultTags", () => {
    it("should return basic tags for development without project", () => {
      const tags = getDefaultTags("development");

      expect(tags.Environment).toBe("development");
      expect(tags.ManagedBy).toBe("CDK");
      expect(tags.Repository).toBe("monitoring-iac");
      expect(tags.CostCentre).toBe("DEV-001");
      expect(tags.DataClassification).toBe("internal");
      expect(tags.Project).toBeUndefined();
      expect(tags.Compliance).toBeUndefined(); // No compliance for dev
    });

    it("should include project and owner tags when project is specified", () => {
      const tags = getDefaultTags("production", "monitoring");

      expect(tags.Project).toBe("monitoring");
      expect(tags.Owner).toBe("Platform Team");
    });

    it("should include compliance tags for production", () => {
      const tags = getDefaultTags("production", "webapp");

      expect(tags.Environment).toBe("production");
      expect(tags.CostCentre).toBe("PROD-001");
      expect(tags.Compliance).toBe("SOC2,GDPR");
      expect(tags.DataClassification).toBe("confidential");
      expect(tags.Owner).toBe("Application Team");
    });

    it("should not include compliance tags for staging", () => {
      const tags = getDefaultTags("staging");

      expect(tags.Compliance).toBe("pre-compliance-testing");
      expect(tags.CostCentre).toBe("STG-001");
    });

    it("should merge custom tags", () => {
      const tags = getDefaultTags("production", "monitoring", {
        Application: "grafana",
        BackupPolicy: "custom-policy",
      });

      expect(tags.Application).toBe("grafana");
      expect(tags.BackupPolicy).toBe("custom-policy");
      expect(tags.Environment).toBe("production"); // Base tags still present
    });

    it("should allow custom tags to override defaults", () => {
      const tags = getDefaultTags("production", "monitoring", {
        CostCentre: "CUSTOM-001",
      });

      expect(tags.CostCentre).toBe("CUSTOM-001"); // Overridden
      expect(tags.Owner).toBe("Platform Team"); // Not overridden
    });
  });

  describe("getResourceTags", () => {
    it("should add Application tag for resource type", () => {
      const tags = getResourceTags("production", "monitoring", "efs");

      expect(tags.Application).toBe("efs");
      expect(tags.Project).toBe("monitoring");
    });

    it("should add backup policy for storage resources in production", () => {
      const storageTypes = ["efs", "ebs", "dynamodb", "s3"];

      storageTypes.forEach((type) => {
        const tags = getResourceTags("production", "monitoring", type);
        expect(tags.BackupPolicy).toBe("daily-30day-retention");
      });
    });

    it("should add backup policy for storage resources in development", () => {
      const tags = getResourceTags("development", "monitoring", "efs");

      expect(tags.BackupPolicy).toBe("weekly-7day-retention");
    });

    it("should not add backup policy for non-storage resources", () => {
      const tags = getResourceTags("production", "monitoring", "lambda");

      expect(tags.BackupPolicy).toBeUndefined();
    });

    it("should include all base tags", () => {
      const tags = getResourceTags("production", "monitoring", "ecr");

      expect(tags.Environment).toBe("production");
      expect(tags.ManagedBy).toBe("CDK");
      expect(tags.Repository).toBe("monitoring-iac");
      expect(tags.Project).toBe("monitoring");
      expect(tags.Owner).toBe("Platform Team");
    });
  });

  describe("toTagsRecord", () => {
    it("should filter out undefined values", () => {
      const tagConfig: TagConfig = {
        Environment: "development",
        ManagedBy: "CDK",
        Repository: "monitoring-iac",
        Project: "monitoring",
        CostCentre: "DEV-001",
        Owner: undefined,
        Compliance: undefined,
      };

      const record = toTagsRecord(tagConfig);

      expect(record.Environment).toBe("development");
      expect(record.CostCentre).toBe("DEV-001");
      expect(record.Owner).toBeUndefined();
      expect(record.Compliance).toBeUndefined();
      expect(Object.keys(record)).toHaveLength(5); // Only defined values
    });

    it("should preserve all defined values", () => {
      const tagConfig: TagConfig = {
        Environment: "production",
        ManagedBy: "CDK",
        Repository: "monitoring-iac",
        Project: "monitoring",
        CostCentre: "PROD-001",
        Owner: "Platform Team",
        Compliance: "SOC2,GDPR",
        DataClassification: "confidential",
      };

      const record = toTagsRecord(tagConfig);

      expect(Object.keys(record)).toHaveLength(8);
      expect(record.Compliance).toBe("SOC2,GDPR");
    });
  });

  describe("validateTags", () => {
    it("should validate complete production tags", () => {
      const tags = getDefaultTags("production", "monitoring");
      const validation = validateTags(tags);

      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it("should require Environment tag", () => {
      const tags: TagConfig = {
        Environment: "",
        ManagedBy: "CDK",
        Repository: "monitoring-iac",
      };

      const validation = validateTags(tags);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain("Environment tag is required");
    });

    it("should require production-specific tags", () => {
      const tags: TagConfig = {
        Environment: "production",
        ManagedBy: "CDK",
        Repository: "monitoring-iac",
        // Missing CostCentre, Owner, DataClassification
      };

      const validation = validateTags(tags);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain("CostCentre tag is required for production");
      expect(validation.errors).toContain("Owner tag is required for production");
      expect(validation.errors).toContain(
        "DataClassification tag is required for production"
      );
    });

    it("should not require production tags for development", () => {
      const tags: TagConfig = {
        Environment: "development",
        ManagedBy: "CDK",
        Repository: "monitoring-iac",
        // Missing CostCentre, Owner, DataClassification - OK for dev
      };

      const validation = validateTags(tags);

      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it("should validate DataClassification values", () => {
      const tags: TagConfig = {
        Environment: "production",
        ManagedBy: "CDK",
        Repository: "monitoring-iac",
        CostCentre: "PROD-001",
        Owner: "Platform Team",
        DataClassification: "invalid" as any,
      };

      const validation = validateTags(tags);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain(
        "Invalid DataClassification: invalid. Must be one of: public, internal, confidential, restricted"
      );
    });

    it("should accept valid DataClassification values", () => {
      const validClassifications = ["public", "internal", "confidential", "restricted"];

      validClassifications.forEach((classification) => {
        const tags: TagConfig = {
          Environment: "production",
          ManagedBy: "CDK",
          Repository: "monitoring-iac",
          CostCentre: "PROD-001",
          Owner: "Platform Team",
          DataClassification: classification as any,
        };

        const validation = validateTags(tags);
        expect(validation.isValid).toBe(true);
      });
    });
  });

  describe("getCostAllocationTags", () => {
    it("should return only cost-relevant tags", () => {
      const costTags = getCostAllocationTags("production", "monitoring");

      expect(costTags.Environment).toBe("production");
      expect(costTags.ManagedBy).toBe("CDK");
      expect(costTags.Project).toBe("monitoring");
      expect(costTags.CostCentre).toBe("PROD-001");
      expect(costTags.Owner).toBe("Platform Team");

      // Should not include these tags
      expect(costTags.Repository).toBeUndefined();
      expect(costTags.Compliance).toBeUndefined();
      expect(costTags.DataClassification).toBeUndefined();
    });

    it("should work without project name", () => {
      const costTags = getCostAllocationTags("development");

      expect(costTags.Environment).toBe("development");
      expect(costTags.ManagedBy).toBe("CDK");
      expect(costTags.Project).toBeUndefined();
      expect(costTags.Owner).toBeUndefined();
    });
  });

  describe("Configuration Constants", () => {
    it("should have cost centres for all environments", () => {
      expect(COST_CENTRES.development).toBe("DEV-001");
      expect(COST_CENTRES.staging).toBe("STG-001");
      expect(COST_CENTRES.production).toBe("PROD-001");
      expect(COST_CENTRES.pipeline).toBe("PIPELINE-001");
    });

    it("should have project owners defined", () => {
      expect(PROJECT_OWNERS.monitoring).toBe("Platform Team");
      expect(PROJECT_OWNERS.webapp).toBe("Application Team");
      expect(PROJECT_OWNERS.api).toBe("Backend Team");
    });

    it("should have data classification for all environments", () => {
      expect(DATA_CLASSIFICATION.development).toBe("internal");
      expect(DATA_CLASSIFICATION.staging).toBe("internal");
      expect(DATA_CLASSIFICATION.production).toBe("confidential");
      expect(DATA_CLASSIFICATION.pipeline).toBe("internal");
    });
  });
});
