/**
 * YAML Converter Utility
 *
 * Purpose:
 * - Converts JavaScript objects to YAML format for monitoring configurations
 * - Eliminates need for runtime YAML conversion in Lambda/SSM
 *
 * Implementation:
 * - Manual YAML generation (no external dependencies)
 * - Handles common data types: strings, numbers, booleans, arrays, objects
 * - Proper indentation and formatting
 *
 * Usage:
 * ```typescript
 * const jsonConfig = { apiVersion: 1, datasources: [...] };
 * const yamlConfig = convertToYaml(jsonConfig);
 * ```
 */

/**
 * Converts a JavaScript object to YAML format
 *
 * @param obj - Object to convert to YAML
 * @param indent - Current indentation level (default: 0)
 * @returns YAML formatted string
 */
export function convertToYaml(
  obj: unknown,
  indent: number = 0
): string {
  const indentStr = " ".repeat(indent);
  const lines: string[] = [];

  if (obj === null || obj === undefined) {
    return "null";
  }

  if (Array.isArray(obj)) {
    if (obj.length === 0) {
      return "[]";
    }
    for (const item of obj) {
      if (typeof item === "object" && item !== null && !Array.isArray(item)) {
        const objectLines = convertToYaml(item, indent + 2).split("\n");
        lines.push(`${indentStr}- ${objectLines[0]}`);
        for (let i = 1; i < objectLines.length; i++) {
          lines.push(`${indentStr}  ${objectLines[i]}`);
        }
      } else {
        lines.push(`${indentStr}- ${formatYamlValue(item)}`);
      }
    }
    return lines.join("\n");
  }

  if (typeof obj === "object") {
    const keys = Object.keys(obj);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const value = obj[key];

      if (value === null || value === undefined) {
        lines.push(`${indentStr}${key}: null`);
      } else if (Array.isArray(value)) {
        if (value.length === 0) {
          lines.push(`${indentStr}${key}: []`);
        } else {
          lines.push(`${indentStr}${key}:`);
          const arrayYaml = convertToYaml(value, indent + 2);
          lines.push(arrayYaml);
        }
      } else if (typeof value === "object") {
        lines.push(`${indentStr}${key}:`);
        const objectYaml = convertToYaml(value, indent + 2);
        lines.push(objectYaml);
      } else {
        lines.push(`${indentStr}${key}: ${formatYamlValue(value)}`);
      }
    }
    return lines.join("\n");
  }

  return formatYamlValue(obj);
}

/**
 * Formats a primitive value for YAML
 *
 * @param value - Value to format
 * @returns Formatted YAML value
 */
function formatYamlValue(value: unknown): string {
  if (typeof value === "string") {
    // Quote strings that contain special characters or start with special chars
    if (
      value.includes(":") ||
      value.includes("#") ||
      value.includes("'") ||
      value.includes('"') ||
      value.startsWith("-") ||
      value.startsWith("[") ||
      value.startsWith("{") ||
      value.trim() !== value
    ) {
      return `"${value.replace(/"/g, '\\"')}"`;
    }
    return value;
  }

  if (typeof value === "number") {
    return value.toString();
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  return String(value);
}
