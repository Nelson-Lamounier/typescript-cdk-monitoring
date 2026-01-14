/** @format */

// infrastructure/scripts/deployment/utils/environment-checker.ts
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

import type { BuildArtifactInfo, EnvironmentCheckResult } from "./types.js";

export class EnvironmentChecker {
  /**
   * Check if Node.js is available and get version
   */
  static checkNodeJs(): EnvironmentCheckResult {
    try {
      const version = execSync("node --version", { encoding: "utf-8" }).trim();
      return {
        component: "Node.js",
        available: true,
        version,
      };
    } catch {
      return {
        component: "Node.js",
        available: false,
        message:
          "Node.js not found - ensure setup-infrastructure action ran successfully",
      };
    }
  }

  /**
   * Check if Yarn is available and get version
   */
  static checkYarn(): EnvironmentCheckResult {
    try {
      const version = execSync("yarn --version", { encoding: "utf-8" }).trim();
      return {
        component: "Yarn",
        available: true,
        version,
      };
    } catch {
      return {
        component: "Yarn",
        available: false,
        message:
          "Yarn not found - ensure setup-infrastructure action ran successfully",
      };
    }
  }

  /**
   * Check if AWS CLI is available and credentials are configured
   */
  static checkAwsCli(): EnvironmentCheckResult {
    try {
      // Check AWS CLI version
      const version = execSync("aws --version 2>&1", { encoding: "utf-8" })
        .split("\n")[0]
        .trim();

      // Check if credentials work
      const identity = execSync(
        "aws sts get-caller-identity --query Account --output text",
        {
          encoding: "utf-8",
        }
      ).trim();

      const maskedAccount = `***${identity.slice(-4)}`;

      return {
        component: "AWS CLI",
        available: true,
        version: `${version} (Account: ${maskedAccount})`,
      };
    } catch {
      return {
        component: "AWS CLI",
        available: false,
        message: "AWS CLI not available or credentials not configured",
      };
    }
  }

  /**
   * Check if CDK is available and get version
   */
  static checkCdk(): EnvironmentCheckResult {
    try {
      const version = execSync("npx cdk --version 2>/dev/null", {
        encoding: "utf-8",
      }).trim();

      return {
        component: "CDK",
        available: true,
        version,
      };
    } catch {
      return {
        component: "CDK",
        available: false,
        message: "CDK not available - check package.json and node_modules",
      };
    }
  }

  /**
   * Check build artifacts in dist directory
   */
  static checkBuildArtifacts(distPath: string = "./dist"): BuildArtifactInfo {
    try {
      if (!fs.existsSync(distPath)) {
        return {
          exists: false,
          fileCount: 0,
          paths: [],
        };
      }

      const jsFiles: string[] = [];

      function walkDirectory(dir: string) {
        const files = fs.readdirSync(dir);

        for (const file of files) {
          const fullPath = path.join(dir, file);
          const stat = fs.statSync(fullPath);

          if (stat.isDirectory()) {
            walkDirectory(fullPath);
          } else if (file.endsWith(".js")) {
            jsFiles.push(fullPath);
          }
        }
      }

      walkDirectory(distPath);

      return {
        exists: jsFiles.length > 0,
        fileCount: jsFiles.length,
        paths: jsFiles.slice(0, 5), // First 5 files as sample
      };
    } catch {
      return {
        exists: false,
        fileCount: 0,
        paths: [],
      };
    }
  }

  /**
   * Attempt to build if artifacts are missing
   */
  static async attemptBuild(): Promise<boolean> {
    try {
      execSync("yarn build", {
        stdio: "inherit",
        encoding: "utf-8",
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Run all environment checks
   */
  static runAllChecks(): EnvironmentCheckResult[] {
    return [
      this.checkNodeJs(),
      this.checkYarn(),
      this.checkAwsCli(),
      this.checkCdk(),
    ];
  }
}
