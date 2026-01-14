/** @format */

// infrastructure/scripts/deployment/__tests__/validate-environment.test.ts
import { describe, expect, it } from "@jest/globals";

import { validateEnvironment } from "../validate-environment.js";

describe("validateEnvironment", () => {
  it("should pass with valid config", () => {
    const config = {
      stackName: "NetworkingStack-pipeline",
      environment: "pipeline",
      projectName: "monitoring",
      awsAccountId: "123456789012",
      awsRegion: "eu-west-1",
    };

    const result = validateEnvironment(config);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("should fail without AWS account ID", () => {
    const config = {
      stackName: "NetworkingStack-pipeline",
      environment: "pipeline",
      projectName: "monitoring",
      awsAccountId: "",
      awsRegion: "eu-west-1",
    };

    const result = validateEnvironment(config);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("AWS Account ID is required");
  });
});
