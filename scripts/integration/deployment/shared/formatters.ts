/** @format */

// infrastructure/scripts/deployment/shared/formatters.ts

import { Logger } from "../utils/logger";

export interface TableRow {
  Key: string;
  Value: string;
}

export class TableFormatter {
  /**
   * Formats data as a table with key-value pairs
   */
  static format(data: TableRow[]): void {
    if (data.length === 0) {
      console.log("  (no data)");
      return;
    }

    const maxKeyLength = Math.max(
      ...data.map((item) => item.Key.length),
      "Key".length
    );
    const maxValueLength = Math.max(
      ...data.map((item) => item.Value.length),
      "Value".length
    );

    const header = `| ${"Key".padEnd(maxKeyLength)} | ${"Value".padEnd(maxValueLength)} |`;
    const separator = `|${"-".repeat(maxKeyLength + 2)}|${"-".repeat(maxValueLength + 2)}|`;

    console.log(separator);
    console.log(header);
    console.log(separator);

    data.forEach((item) => {
      console.log(
        `| ${item.Key.padEnd(maxKeyLength)} | ${item.Value.padEnd(maxValueLength)} |`
      );
    });

    console.log(separator);
  }

  /**
   * Formats CloudFormation stack outputs as a table
   */
  static formatStackOutputs(outputs: Record<string, string | undefined>): void {
    const tableData = Object.entries(outputs)
      .filter(([_, value]) => value !== undefined)
      .map(([key, value]) => ({ Key: key, Value: value as string }));
    
    if (tableData.length === 0) {
      console.log("  (no outputs)");
      return;
    }
    
    this.format(tableData);
  }

  /**
   * Formats a list of items with custom key
   */
  static formatList(title: string, items: string[]): void {
    if (items.length === 0) {
      Logger.warning(`No ${title} found`);
      return;
    }

    console.log(`${title}:`);
    items.forEach((item, index) => {
      console.log(`  ${index + 1}. ${item}`);
    });
  }

  /**
   * Formats resource metadata as a table
   */
  static formatResourceInfo(resource: Record<string, any>, fields: string[]): void {
    const tableData: TableRow[] = [];
    
    fields.forEach((field) => {
      const value = resource[field];
      if (value !== undefined && value !== null) {
        tableData.push({
          Key: field,
          Value: typeof value === "object" ? JSON.stringify(value) : String(value),
        });
      }
    });
    
    this.format(tableData);
  }

  /**
   * Formats security group rules
   */
  static formatSecurityGroupRules(rules: any[], direction: "inbound" | "outbound"): void {
    console.log(`${direction.charAt(0).toUpperCase() + direction.slice(1)} Rules:`);
    
    if (!rules || rules.length === 0) {
      console.log("  (no rules)");
      return;
    }

    rules.forEach((rule) => {
      const protocol = rule.IpProtocol === "-1" ? "All" : rule.IpProtocol;
      const ports = rule.FromPort && rule.ToPort
        ? rule.FromPort === rule.ToPort
          ? rule.FromPort
          : `${rule.FromPort}-${rule.ToPort}`
        : "All";
      
      const source = direction === "inbound"
        ? rule.IpRanges?.[0]?.CidrIp || 
          rule.UserIdGroupPairs?.[0]?.GroupId || 
          rule.Ipv6Ranges?.[0]?.CidrIpv6 || 
          "N/A"
        : rule.IpRanges?.[0]?.CidrIp || 
          rule.Ipv6Ranges?.[0]?.CidrIpv6 || 
          "N/A";

      Logger.info(`  Protocol: ${protocol}, Ports: ${ports}, ${direction === "inbound" ? "Source" : "Destination"}: ${source}`);
    });
  }

  /**
   * Formats mount target information
   */
  static formatMountTargets(mountTargets: any[]): void {
    if (mountTargets.length === 0) {
      Logger.warning("No mount targets found");
      return;
    }

    Logger.success(`Mount Targets: ${mountTargets.length}`);
    console.log("");

    mountTargets.forEach((mt, index) => {
      console.log(`Mount Target ${index + 1}:`);
      Logger.keyValue("  Mount Target ID", mt.MountTargetId || "N/A");
      Logger.keyValue("  Subnet ID", mt.SubnetId || "N/A");
      Logger.keyValue("  IP Address", mt.IpAddress || "N/A");
      Logger.keyValue("  Availability Zone", mt.AvailabilityZoneName || "N/A");
      Logger.keyValue("  State", mt.LifeCycleState || "N/A");
      
      if (mt.SecurityGroups && mt.SecurityGroups.length > 0) {
        Logger.keyValue("  Security Groups", mt.SecurityGroups.join(", "));
      }
      
      if (index < mountTargets.length - 1) {
        console.log("---");
      }
    });
  }

  /**
   * Formats ECS task information
   */
  static formatTasks(tasks: any[]): void {
    if (tasks.length === 0) {
      Logger.warning("No tasks found");
      return;
    }

    tasks.forEach((task) => {
      const shortId = task.taskArn?.split("/").pop()?.substring(0, 8) || "Unknown";
      Logger.info(`Task ${shortId}:`);
      Logger.keyValue("  Status", task.lastStatus || "Unknown");
      Logger.keyValue("  Desired Status", task.desiredStatus || "Unknown");
      Logger.keyValue("  Health Status", task.healthStatus || "N/A");
      
      if (task.containers) {
        console.log("  Containers:");
        task.containers.forEach((container: any) => {
          Logger.keyValue(`    ${container.name}`, container.lastStatus || "Unknown");
        });
      }
      
      console.log("");
    });
  }

  /**
   * Formats target health information
   */
  static formatTargetHealth(targets: any[]): void {
    if (targets.length === 0) {
      Logger.warning("No targets found");
      return;
    }

    const healthyCount = targets.filter(
      (t) => t.TargetHealth?.State === "healthy"
    ).length;
    
    Logger.info(`Target Health: ${healthyCount}/${targets.length} healthy`);
    console.log("");

    targets.forEach((target) => {
      const instanceId = target.Target?.Id || "Unknown";
      const shortId = instanceId.split("-").pop() || instanceId;
      const state = target.TargetHealth?.State || "Unknown";
      const reason = target.TargetHealth?.Reason || "";
      
      if (state === "healthy") {
        Logger.success(`  ${shortId}: ${state}`);
      } else if (state === "unhealthy") {
        Logger.error(`  ${shortId}: ${state}${reason ? ` (${reason})` : ""}`);
      } else {
        Logger.warning(`  ${shortId}: ${state}${reason ? ` (${reason})` : ""}`);
      }
    });
  }

  /**
   * Formats automation execution information
   */
  static formatAutomationExecutions(executions: any[]): void {
    if (executions.length === 0) {
      Logger.warning("No automation executions found");
      Logger.info("Note: Document may not have been executed yet, or executions have expired.");
      return;
    }

    executions.forEach((exec) => {
      const shortId = exec.id.substring(0, 8);
      
      if (exec.status === "Success") {
        Logger.success(`Execution: ${shortId}... (${exec.id})`);
      } else if (exec.status === "Failed") {
        Logger.error(`Execution: ${shortId}... (${exec.id})`);
      } else {
        Logger.warning(`Execution: ${shortId}... (${exec.id})`);
      }
      
      Logger.keyValue("Status", exec.status);
      
      if (exec.startTime) {
        Logger.keyValue("Started", exec.startTime.toISOString());
      }
      
      console.log("");
    });
  }

  /**
   * Formats parameter check results
   */
  static formatParameterResults(
    parameterGroups: Array<{
      name: string;
      params: string[];
      prefix: string;
    }>,
    results: Map<string, { exists: boolean; value?: string; valueSize?: number }>
  ): { totalMissing: number; groupResults: Record<string, number> } {
    const groupResults: Record<string, number> = {};
    let totalMissing = 0;

    parameterGroups.forEach((group) => {
      console.log(`${group.name}:`);
      let missing = 0;

      group.params.forEach((param) => {
        const fullPath = `${group.prefix}/${param}`;
        const result = results.get(fullPath);

        if (result?.exists) {
          const size = result.valueSize ? ` (${result.valueSize} chars)` : "";
          Logger.success(`  ${fullPath}${size}`);
        } else {
          Logger.error(`  ${fullPath}`);
          missing++;
        }
      });

      groupResults[group.name] = missing;
      totalMissing += missing;
      console.log("");
    });

    return { totalMissing, groupResults };
  }

  /**
   * Formats a summary of checks with percentages
   */
  static formatCheckSummary(
    passed: number,
    total: number,
    label: string
  ): void {
    const percentage = total > 0 ? Math.round((passed / total) * 100) : 0;
    const status = passed === total ? "success" : "warning";
    
    const message = `${label}: ${passed}/${total} (${percentage}%)`;
    
    if (status === "success") {
      Logger.success(message);
    } else {
      Logger.warning(message);
    }
  }

  /**
   * Formats deployment readiness summary
   */
  static formatReadinessSummary(
    stackName: string,
    ready: boolean,
    checks: string[],
    issues: string[] = []
  ): void {
    Logger.subsection(`${stackName} Deployment Readiness`);
    
    if (ready) {
      Logger.success(`${stackName} is ready for deployment`);
      console.log("");
      Logger.info("Prerequisites satisfied:");
      checks.forEach((check) => {
        Logger.success(`  ${check}`);
      });
    } else {
      Logger.error(`${stackName} is NOT ready for deployment`);
      console.log("");
      Logger.warning("Issues found:");
      issues.forEach((issue) => {
        Logger.error(`  ${issue}`);
      });
    }
    
    console.log("");
  }

  /**
   * Formats configuration preview (truncated)
   */
  static formatConfigPreview(
    title: string,
    content: string | undefined,
    maxLength: number = 500
  ): void {
    console.log(`${title}:`);
    
    if (!content) {
      Logger.warning("  (content not found)");
      return;
    }

    if (content.length > maxLength) {
      console.log(content.substring(0, maxLength));
      console.log("...");
      Logger.info(`  (${content.length - maxLength} more characters)`);
    } else {
      console.log(content);
    }
    
    console.log("");
  }
}