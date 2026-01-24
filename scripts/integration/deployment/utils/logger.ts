/** @format */

// infrastructure/scripts/deployment/utils/logger.ts
import chalk from "chalk";

export class Logger {
  static info(message: string): void {
    console.log(chalk.blue("ℹ️  INFO:"), message);
  }

  static success(message: string): void {
    console.log(chalk.green("✅"), message);
  }

  static warning(message: string): void {
    console.log(chalk.yellow("⚠️  WARNING:"), message);
  }

  static error(message: string): void {
    console.log(chalk.red("❌ ERROR:"), message);
  }

  static section(title: string): void {
    console.log("\n" + chalk.bold.cyan("═".repeat(60)));
    console.log(chalk.bold.cyan(title));
    console.log(chalk.bold.cyan("═".repeat(60)) + "\n");
  }

  static subsection(title: string): void {
    console.log("\n" + chalk.bold(title));
    console.log(chalk.gray("─".repeat(40)));
  }

  static code(command: string): void {
    console.log(chalk.gray("  $ ") + chalk.white(command));
  }

  static keyValue(key: string, value: string, mask: boolean = false): void {
    const displayValue = mask ? "***MASKED***" : value;
    console.log(`  ${chalk.cyan(key)}: ${displayValue}`);
  }
}
