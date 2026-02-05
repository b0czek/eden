/**
 * Runtime Code Generator
 *
 * Generates runtime arrays for command and event names.
 */

import type { NamespaceCommands } from "./commands";
import type { NamespaceEvents } from "./events";
import { generateHeader } from "./utils";

/**
 * Generate TypeScript file with runtime arrays (for SDK bundling)
 */
export function generateRuntimeCode(
  namespaceCommands: NamespaceCommands[],
  namespaceEvents: NamespaceEvents[],
): string {
  const lines: string[] = generateHeader(
    "This file contains runtime arrays for command and event names.",
  );

  lines.push("// Command names array");
  lines.push("export const COMMAND_NAMES: readonly string[] = [");

  namespaceCommands.forEach((ns) => {
    ns.commands.forEach((cmd) => {
      lines.push(`  "${ns.namespace}/${cmd.command}",`);
    });
  });

  lines.push("] as const;");
  lines.push("");
  lines.push("// Event names array");
  lines.push("export const APP_EVENT_NAMES: readonly string[] = [");

  namespaceEvents.forEach((ns) => {
    ns.events.forEach((evt) => {
      lines.push(`  "${ns.namespace}/${evt.eventName}",`);
    });
  });

  lines.push("] as const;");

  return lines.join("\n") + "\n";
}
