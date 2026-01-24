/** @format */

// infrastructure/scripts/deployment/shared/verification-framework.ts

import { Logger } from "../utils/logger";

export interface VerificationCheck {
  name: string;
  category: string;
  execute: () => Promise<CheckResult>;
  critical?: boolean;
  optional?: boolean;
}

export interface CheckResult {
  passed: boolean;
  message?: string;
  details?: Record<string, any>;
}

export interface VerificationSummary {
  checksPassed: number;
  totalChecks: number;
  checksExecuted: number;
  failedChecks: string[];
  criticalFailure: boolean;
  categories: Record<string, { passed: number; total: number }>;
  metadata?: Record<string, any>;
}

export class VerificationRunner {
  private checks: VerificationCheck[] = [];
  private summary: VerificationSummary = {
    checksPassed: 0,
    totalChecks: 0,
    checksExecuted: 0,
    failedChecks: [],
    criticalFailure: false,
    categories: {},
  };

  /**
   * Adds a single verification check to the runner
   */
  addCheck(check: VerificationCheck): void {
    this.checks.push(check);
    this.summary.totalChecks++;
    
    if (!this.summary.categories[check.category]) {
      this.summary.categories[check.category] = { passed: 0, total: 0 };
    }
    this.summary.categories[check.category].total++;
  }

  /**
   * Adds multiple verification checks at once
   */
  addChecks(checks: VerificationCheck[]): void {
    checks.forEach((check) => this.addCheck(check));
  }

  /**
   * Executes all registered verification checks
   */
  async run(): Promise<VerificationSummary> {
    for (const check of this.checks) {
      Logger.subsection(`${this.summary.checksExecuted + 1}. ${check.name}`);
      
      try {
        const result = await check.execute();
        this.summary.checksExecuted++;

        if (result.passed) {
          this.handlePassedCheck(check, result);
        } else {
          this.handleFailedCheck(check, result);
          
          if (check.critical && !check.optional) {
            this.summary.criticalFailure = true;
            Logger.error("Critical check failed - stopping verification");
            break;
          }
        }
      } catch (error: any) {
        this.handleCheckError(check, error);
        
        if (check.critical && !check.optional) {
          this.summary.criticalFailure = true;
          break;
        }
      }
      
      console.log("");
    }

    return this.summary;
  }

  /**
   * Handles a passed verification check
   */
  private handlePassedCheck(check: VerificationCheck, result: CheckResult): void {
    this.summary.checksPassed++;
    this.summary.categories[check.category].passed++;
    
    if (result.message) {
      Logger.success(result.message);
    } else {
      Logger.success(`${check.name}: PASSED`);
    }
    
    if (result.details) {
      Object.entries(result.details).forEach(([key, value]) => {
        Logger.keyValue(key, String(value));
      });
    }
  }

  /**
   * Handles a failed verification check
   */
  private handleFailedCheck(check: VerificationCheck, result: CheckResult): void {
    this.summary.failedChecks.push(check.name);
    
    if (check.optional) {
      Logger.warning(`${check.name}: FAILED (optional)`);
    } else {
      Logger.error(`${check.name}: FAILED`);
    }
    
    if (result.message) {
      Logger.error(result.message);
    }
    
    if (result.details) {
      Object.entries(result.details).forEach(([key, value]) => {
        Logger.keyValue(key, String(value));
      });
    }
  }

  /**
   * Handles an error during check execution
   */
  private handleCheckError(check: VerificationCheck, error: any): void {
    Logger.error(`${check.name}: ERROR - ${error.message}`);
    this.summary.failedChecks.push(check.name);
    
    if (error.stack && process.env.VERBOSE) {
      console.log(error.stack);
    }
  }

  /**
   * Returns the current verification summary
   */
  getSummary(): VerificationSummary {
    return { ...this.summary };
  }

  /**
   * Sets metadata for the verification summary
   */
  setMetadata(metadata: Record<string, any>): void {
    this.summary.metadata = { ...this.summary.metadata, ...metadata };
  }

  /**
   * Prints a formatted verification summary
   */
  printSummary(): void {
    Logger.section("VERIFICATION SUMMARY");
    
    Logger.keyValue(
      "Checks Passed",
      `${this.summary.checksPassed}/${this.summary.totalChecks}`
    );
    
    console.log("");
    Logger.subsection("Category Breakdown");
    Object.entries(this.summary.categories).forEach(([category, stats]) => {
      const percentage = stats.total > 0 
        ? Math.round((stats.passed / stats.total) * 100)
        : 0;
      Logger.keyValue(
        category,
        `${stats.passed}/${stats.total} (${percentage}%)`
      );
    });
    
    if (this.summary.failedChecks.length > 0) {
      console.log("");
      Logger.subsection("Failed Checks");
      this.summary.failedChecks.forEach((check) => {
        Logger.error(`  ${check}`);
      });
    }
    
    if (this.summary.metadata) {
      console.log("");
      Logger.subsection("Metadata");
      Object.entries(this.summary.metadata).forEach(([key, value]) => {
        Logger.keyValue(key, String(value));
      });
    }
    
    console.log("");
  }

  /**
   * Returns true if all checks passed
   */
  allChecksPassed(): boolean {
    return (
      this.summary.checksPassed === this.summary.totalChecks &&
      !this.summary.criticalFailure
    );
  }

  /**
   * Returns true if all critical checks passed
   */
  criticalChecksPassed(): boolean {
    return !this.summary.criticalFailure;
  }
}

/**
 * Helper class to build verification checks with a fluent API
 */
export class CheckBuilder {
  private check: Partial<VerificationCheck> = {};

  static create(name: string): CheckBuilder {
    return new CheckBuilder().name(name);
  }

  name(name: string): CheckBuilder {
    this.check.name = name;
    return this;
  }

  category(category: string): CheckBuilder {
    this.check.category = category;
    return this;
  }

  critical(critical: boolean = true): CheckBuilder {
    this.check.critical = critical;
    return this;
  }

  optional(optional: boolean = true): CheckBuilder {
    this.check.optional = optional;
    return this;
  }

  execute(executor: () => Promise<CheckResult>): VerificationCheck {
    if (!this.check.name) {
      throw new Error("Check name is required");
    }
    if (!this.check.category) {
      throw new Error("Check category is required");
    }
    if (!executor) {
      throw new Error("Check executor is required");
    }

    return {
      name: this.check.name,
      category: this.check.category,
      critical: this.check.critical || false,
      optional: this.check.optional || false,
      execute: executor,
    };
  }
}

/**
 * Readiness assessment for deployment stacks
 */
export interface ReadinessAssessment {
  ready: boolean;
  blockers: string[];
  warnings: string[];
  nextSteps: string[];
}

export class ReadinessChecker {
  private assessment: ReadinessAssessment = {
    ready: true,
    blockers: [],
    warnings: [],
    nextSteps: [],
  };

  addBlocker(blocker: string): void {
    this.assessment.ready = false;
    this.assessment.blockers.push(blocker);
  }

  addWarning(warning: string): void {
    this.assessment.warnings.push(warning);
  }

  addNextStep(step: string): void {
    this.assessment.nextSteps.push(step);
  }

  getAssessment(): ReadinessAssessment {
    return { ...this.assessment };
  }

  isReady(): boolean {
    return this.assessment.ready;
  }

  printAssessment(stackName: string): void {
    Logger.subsection(`${stackName} Deployment Readiness`);
    
    if (this.assessment.ready) {
      Logger.success(`${stackName} is ready for deployment`);
    } else {
      Logger.error(`${stackName} is NOT ready for deployment`);
    }
    
    if (this.assessment.blockers.length > 0) {
      console.log("");
      Logger.error("Blockers:");
      this.assessment.blockers.forEach((blocker) => {
        Logger.error(`  ${blocker}`);
      });
    }
    
    if (this.assessment.warnings.length > 0) {
      console.log("");
      Logger.warning("Warnings:");
      this.assessment.warnings.forEach((warning) => {
        Logger.warning(`  ${warning}`);
      });
    }
    
    if (this.assessment.nextSteps.length > 0) {
      console.log("");
      Logger.info("Next Steps:");
      this.assessment.nextSteps.forEach((step, index) => {
        Logger.info(`  ${index + 1}. ${step}`);
      });
    }
    
    console.log("");
  }
}