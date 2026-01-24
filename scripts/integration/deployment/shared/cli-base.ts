// infrastructure/scripts/shared/cli-base.ts

import { program, Command } from "commander";

import { Logger } from "../utils/logger";

export interface BaseCliOptions {
  environment: string;
  region: string;
  profile?: string;
}

export const VALID_ENVIRONMENTS = ["development", "staging", "production", "pipeline"];

export class CliBuilder {
  static create(
    name: string,
    description: string,
    defaultEnv: string = "development"
  ): Command {
    return program
      .name(name)
      .description(description)
      .option(
        "-e, --environment <env>",
        `Environment name (default: ${defaultEnv})`,
        defaultEnv
      )
      .option(
        "-r, --region <region>",
        "AWS region (default: eu-west-1)",
        "eu-west-1"
      )
      .option("-p, --profile <profile>", "AWS CLI profile");
  }

  static validateEnvironment(environment: string): void {
    if (!VALID_ENVIRONMENTS.includes(environment)) {
      Logger.error(`Invalid environment: ${environment}`);
      Logger.info(`Valid environments: ${VALID_ENVIRONMENTS.join(", ")}`);
      process.exit(1);
    }
  }

  static parseOptions(): BaseCliOptions {
    program.parse();
    const options = program.opts() as BaseCliOptions;
    this.validateEnvironment(options.environment);
    return options;
  }
}

