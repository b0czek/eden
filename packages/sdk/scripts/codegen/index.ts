/**
 * Codegen Orchestrator
 *
 * Main entry point that coordinates all code generation:
 * - Commands: Controller contracts → commands.generated.d.ts
 * - Client: Commands/events → @edenapp/client methods
 * - Events: Controller event sources → events.generated.d.ts
 * - Runtime: Command/event name arrays → runtime.ts
 * - I18n: SDK locale files → i18n.ts types
 *
 * Usage: pnpm run codegen
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { Project } from "ts-morph";
import { generateClientCode } from "./client";
import {
  type CommandInfo,
  generateCommandsCode,
  groupCommandsByNamespace,
} from "./commands";
import { extractControllers } from "./controllers";
import {
  type EventInfo,
  generateEventsCode,
  groupEventsByNamespace,
} from "./events";
import { generateI18nTypes } from "./i18n";
import { generateRuntimeCode } from "./runtime";

/**
 * Main code generation function
 */
export function generateAll(): void {
  console.log("Scanning controller definitions...");

  const projectRoot = path.resolve(__dirname, "../..");
  const srcDir = path.join(projectRoot, "src");
  const workspaceRoot = path.resolve(projectRoot, "../..");
  const typesDir = path.join(workspaceRoot, "packages", "types");

  const project = new Project({
    tsConfigFilePath: path.join(projectRoot, "tsconfig.json"),
    skipAddingFilesFromTsConfig: true,
  });

  // Add source files
  project.addSourceFilesAtPaths([
    path.join(srcDir, "**/*.ts"),
    `!${path.join(srcDir, "**/*.test.ts")}`,
    `!${path.join(srcDir, "**/*.spec.ts")}`,
    path.join(typesDir, "index.d.ts"),
  ]);

  console.log(`Found ${project.getSourceFiles().length} TypeScript files`);

  // Get exported types from types/index.d.ts
  const exportedTypes = new Set<string>();
  const indexFile = project.getSourceFile(path.join(typesDir, "index.d.ts"));
  if (indexFile) {
    indexFile.getExportedDeclarations().forEach((_, name) => {
      exportedTypes.add(name);
    });
    console.log(`Found ${exportedTypes.size} exported types from index.d.ts`);
  }

  // Extract contracts without constructing domain services.
  const allCommands: CommandInfo[] = [];
  const allEvents: EventInfo[] = [];

  project.getSourceFiles().forEach((sourceFile) => {
    if (sourceFile.getFilePath() === indexFile?.getFilePath()) return;

    const controllers = extractControllers(sourceFile);
    allCommands.push(...controllers.commands);
    allEvents.push(...controllers.events);

    if (controllers.commands.length || controllers.events.length) {
      console.log(
        `  ${path.relative(projectRoot, sourceFile.getFilePath())}: ${controllers.commands.length} commands, ${controllers.events.length} events`,
      );
    }
  });

  console.log(`\n📦 Found ${allCommands.length} total command handlers`);
  console.log(`📦 Found ${allEvents.length} total event declarations`);

  for (const entries of [
    allCommands.map((command) => `${command.namespace}/${command.command}`),
    allEvents.map((event) => `${event.namespace}/${event.eventName}`),
  ]) {
    const names = new Set<string>();
    for (const name of entries) {
      if (names.has(name))
        throw new Error(`Duplicate controller contract: ${name}`);
      names.add(name);
    }
  }

  // Group by namespace
  const namespaceCommands = groupCommandsByNamespace(allCommands);
  const namespaceEvents = groupEventsByNamespace(allEvents);
  // Validate the complete client contract before writing any generated files.
  const clientCode = generateClientCode(namespaceCommands, namespaceEvents);

  console.log(
    `📋 Grouped commands into ${namespaceCommands.length} namespaces:`,
  );
  namespaceCommands.forEach((ns) => {
    console.log(`  - ${ns.namespace}: ${ns.commands.length} commands`);
  });

  console.log(`📋 Grouped events into ${namespaceEvents.length} namespaces:`);
  namespaceEvents.forEach((ns) => {
    console.log(`  - ${ns.namespace}: ${ns.events.length} events`);
  });

  // Generate commands
  const commandsCode = generateCommandsCode(namespaceCommands, exportedTypes);
  const commandsOutputPath = path.join(typesDir, "commands.generated.d.ts");
  fs.writeFileSync(commandsOutputPath, commandsCode);
  console.log(
    `\n✅ Generated ${path.relative(projectRoot, commandsOutputPath)}`,
  );

  // Generate events
  const eventsCode = generateEventsCode(namespaceEvents, exportedTypes);
  const eventsOutputPath = path.join(typesDir, "events.generated.d.ts");
  fs.writeFileSync(eventsOutputPath, eventsCode);
  console.log(`✅ Generated ${path.relative(projectRoot, eventsOutputPath)}`);

  // Generate runtime
  const generatedDir = path.join(srcDir, "generated");
  if (!fs.existsSync(generatedDir)) {
    fs.mkdirSync(generatedDir, { recursive: true });
  }
  const runtimeCode = generateRuntimeCode(namespaceCommands, namespaceEvents);
  const runtimeOutputPath = path.join(generatedDir, "runtime.ts");
  fs.writeFileSync(runtimeOutputPath, runtimeCode);
  console.log(`✅ Generated ${path.relative(projectRoot, runtimeOutputPath)}`);

  const clientDir = path.join(workspaceRoot, "packages", "client", "src");
  fs.mkdirSync(clientDir, { recursive: true });
  const clientOutputPath = path.join(clientDir, "commands.generated.ts");
  fs.writeFileSync(clientOutputPath, clientCode);
  console.log(`✅ Generated ${path.relative(projectRoot, clientOutputPath)}`);

  // Generate i18n types
  generateI18nTypes(projectRoot);
}
