/** @format */

// infrastructure/scripts/deployment/__tests__/environment-checker.test.ts
import * as fs from "fs";
import * as path from "path";

import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

import { EnvironmentChecker } from "../utils/environment-checker.js";

describe("EnvironmentChecker", () => {
  describe("checkNodeJs", () => {
    it("should detect Node.js", () => {
      const result = EnvironmentChecker.checkNodeJs();
      expect(result.available).toBe(true);
      expect(result.version).toMatch(/v\d+\.\d+\.\d+/);
    });
  });

  describe("checkBuildArtifacts", () => {
    const testDir = path.join(__dirname, "test-dist");

    beforeEach(() => {
      // Create test directory
      if (!fs.existsSync(testDir)) {
        fs.mkdirSync(testDir, { recursive: true });
      }
    });

    afterEach(() => {
      // Cleanup test directory
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true });
      }
    });

    it("should detect no artifacts when directory empty", () => {
      const result = EnvironmentChecker.checkBuildArtifacts(testDir);
      expect(result.exists).toBe(false);
      expect(result.fileCount).toBe(0);
    });

    it("should detect JavaScript files", () => {
      // Create test files
      fs.writeFileSync(path.join(testDir, "test1.js"), "");
      fs.writeFileSync(path.join(testDir, "test2.js"), "");

      const result = EnvironmentChecker.checkBuildArtifacts(testDir);
      expect(result.exists).toBe(true);
      expect(result.fileCount).toBe(2);
    });

    it("should ignore non-JS files", () => {
      fs.writeFileSync(path.join(testDir, "test.ts"), "");
      fs.writeFileSync(path.join(testDir, "test.txt"), "");

      const result = EnvironmentChecker.checkBuildArtifacts(testDir);
      expect(result.exists).toBe(false);
    });
  });

  describe("runAllChecks", () => {
    it("should run all environment checks", () => {
      const results = EnvironmentChecker.runAllChecks();

      expect(results).toHaveLength(4);
      expect(results.map((r) => r.component)).toEqual([
        "Node.js",
        "Yarn",
        "AWS CLI",
        "CDK",
      ]);
    });
  });
});
