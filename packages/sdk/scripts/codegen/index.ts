/**
 * Codegen Orchestrator
 *
 * Main entry point that coordinates all code generation:
 * - Commands: @EdenHandler decorators → commands.generated.d.ts
 * - Client: Commands/events → @edenapp/client methods
 * - Events: EdenEmitter interfaces → events.generated.d.ts
 * - Runtime: Command/event name arrays → runtime.ts
 * - I18n: SDK locale files → i18n.ts types
 *
 * Usage: pnpm run codegen
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { Node, Project } from "ts-morph";
import { generateClientCode } from "./client";
import {
  type CommandInfo,
  extractCommandHandlers,
  generateCommandsCode,
  groupCommandsByNamespace,
} from "./commands";
import {
  type EventInfo,
  extractEventDeclarations,
  generateEventsCode,
  groupEventsByNamespace,
} from "./events";
import { generateI18nTypes } from "./i18n";
import { generateRuntimeCode } from "./runtime";

/**
 * Main code generation function
 */
export function generateAll(): void {
  console.log("🔍 Scanning for @EdenHandler and @EdenNamespace decorators...");

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

  // Extract commands and events from decorated classes
  const allCommands: CommandInfo[] = [];
  const allEvents: EventInfo[] = [];

  project.getSourceFiles().forEach((sourceFile) => {
    if (sourceFile.getFilePath() === indexFile?.getFilePath()) return;

    sourceFile.getClasses().forEach((classDec) => {
      const namespaceDecorator = classDec.getDecorator("EdenNamespace");
      if (namespaceDecorator) {
        const args = namespaceDecorator.getArguments();
        if (args.length > 0 && Node.isStringLiteral(args[0])) {
          const namespace = args[0].getLiteralText();

          const commands = extractCommandHandlers(classDec, namespace);
          const events = extractEventDeclarations(classDec, namespace);

          allCommands.push(...commands);
          allEvents.push(...events);

          if (commands.length > 0) {
            console.log(
              `  ✓ ${path.relative(projectRoot, sourceFile.getFilePath())}: ${commands.length} commands`,
            );
          }
          if (events.length > 0) {
            console.log(
              `  ✓ ${path.relative(projectRoot, sourceFile.getFilePath())}: ${events.length} events`,
            );
          }
        }
      }
    });
  });

  console.log(`\n📦 Found ${allCommands.length} total command handlers`);
  console.log(`📦 Found ${allEvents.length} total event declarations`);

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
