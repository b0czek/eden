/**
 * Command and Event Type Generator
 * 
 * Scans TypeScript files for @EdenHandler and @EdenNamespace decorators 
 * and automatically generates command and event interfaces.
 * 
 * Usage: ts-node scripts/generate-commands.ts
 */

import * as ts from "typescript";
import * as fs from "fs";
import * as path from "path";

interface CommandInfo {
  namespace: string;
  command: string;
  argsType: string;
  returnType: string;
}

interface NamespaceCommands {
  namespace: string;
  interfaceName: string;
  commands: Array<{ command: string; argsType: string; returnType: string }>;
}

interface EventInfo {
  namespace: string;
  eventName: string;
  payloadType: string;
}

interface NamespaceEvents {
  namespace: string;
  interfaceName: string;
  events: Array<{ eventName: string; payloadType: string }>;
}

/**
 * Extract command handlers from a TypeScript source file
 */
function extractCommandHandlers(sourceFile: ts.SourceFile): CommandInfo[] {
  const commands: CommandInfo[] = [];
  let currentNamespace = "";

  function visit(node: ts.Node) {
    // Look for class declarations with @EdenNamespace decorator
    if (ts.isClassDeclaration(node)) {
      const namespaceDecorator = ts.getDecorators(node)?.find((dec) => {
        if (ts.isCallExpression(dec.expression)) {
          const expr = dec.expression;
          if (ts.isIdentifier(expr.expression)) {
            const decoratorName = expr.expression.text;
            return decoratorName === "EdenNamespace";
          }
        }
        return false;
      });

      if (namespaceDecorator && ts.isCallExpression(namespaceDecorator.expression)) {
        const args = namespaceDecorator.expression.arguments;
        if (args.length > 0 && ts.isStringLiteral(args[0])) {
          currentNamespace = args[0].text;
        }
      }

      // Visit class members
      node.members.forEach((member) => {
        if (ts.isMethodDeclaration(member)) {
          const decorators = ts.getDecorators(member);
          const commandDecorator = decorators?.find((dec) => {
            if (ts.isCallExpression(dec.expression)) {
              const expr = dec.expression;
              if (ts.isIdentifier(expr.expression)) {
                const decoratorName = expr.expression.text;
                return decoratorName === "EdenHandler";
              }
            }
            return false;
          });

          if (commandDecorator && ts.isCallExpression(commandDecorator.expression)) {
            const args = commandDecorator.expression.arguments;
            if (args.length > 0 && ts.isStringLiteral(args[0])) {
              const commandName = args[0].text;
              
              // Extract argument type from first parameter
              let argsType = "Record<string, never>";
              if (member.parameters.length > 0) {
                const param = member.parameters[0];
                if (param.type) {
                  argsType = param.type.getText(sourceFile);
                }
              }

              // Extract return type
              let returnType = "any";
              if (member.type) {
                const typeText = member.type.getText(sourceFile);
                // Extract T from Promise<T>
                const match = typeText.match(/Promise<(.+)>/);
                if (match) {
                  returnType = match[1];
                } else {
                  returnType = typeText;
                }
              }

              commands.push({
                namespace: currentNamespace,
                command: commandName,
                argsType,
                returnType,
              });
            }
          }
        }
      });
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return commands;
}

/**
 * Extract event declarations from a TypeScript source file
 */
function extractEventDeclarations(sourceFile: ts.SourceFile): EventInfo[] {
  const events: EventInfo[] = [];

  function visit(node: ts.Node) {
    // Look for class declarations with @EdenNamespace decorator
    if (ts.isClassDeclaration(node)) {
      let currentNamespace = "";
      let eventsInterfaceName: string | null = null;

      // Find EdenNamespace decorator and extract namespace and events interface name
      const namespaceDecorator = ts.getDecorators(node)?.find((dec) => {
        if (ts.isCallExpression(dec.expression)) {
          const expr = dec.expression;
          if (ts.isIdentifier(expr.expression) && expr.expression.text === "EdenNamespace") {
            return true;
          }
        }
        return false;
      });

      if (namespaceDecorator && ts.isCallExpression(namespaceDecorator.expression)) {
        const args = namespaceDecorator.expression.arguments;
        
        // First argument is the namespace
        if (args.length > 0 && ts.isStringLiteral(args[0])) {
          currentNamespace = args[0].text;
        }

        // Second argument is options object with events property
        if (args.length > 1 && ts.isObjectLiteralExpression(args[1])) {
          const eventsProperty = args[1].properties.find(
            (prop) => ts.isPropertyAssignment(prop) && 
                     ts.isIdentifier(prop.name) && 
                     prop.name.text === "events"
          );

          if (eventsProperty && ts.isPropertyAssignment(eventsProperty)) {
            if (ts.isStringLiteral(eventsProperty.initializer)) {
              eventsInterfaceName = eventsProperty.initializer.text;
            }
          }
        }
      }

      // If we found an events interface name, find the interface definition
      if (currentNamespace && eventsInterfaceName) {
        // Look for the interface definition in the same file
        const interfaceName = eventsInterfaceName;
        
        function findInterface(n: ts.Node): void {
          if (ts.isInterfaceDeclaration(n) && n.name.text === interfaceName) {
            // Extract each property from the interface
            n.members.forEach((member) => {
              if (ts.isPropertySignature(member) && ts.isStringLiteral(member.name)) {
                const eventName = member.name.text;
                let payloadType = "any";
                
                if (member.type) {
                  payloadType = member.type.getText(sourceFile);
                }

                events.push({
                  namespace: currentNamespace,
                  eventName,
                  payloadType,
                });
              }
            });
          }
          ts.forEachChild(n, findInterface);
        }

        findInterface(sourceFile);
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return events;
}

/**
 * Find all TypeScript files in a directory
 */
function findTypeScriptFiles(dir: string, fileList: string[] = []): string[] {
  const files = fs.readdirSync(dir);

  files.forEach((file) => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory() && !file.startsWith('.') && file !== 'node_modules') {
      findTypeScriptFiles(filePath, fileList);
    } else if (file.endsWith('.ts') && !file.endsWith('.d.ts')) {
      fileList.push(filePath);
    }
  });

  return fileList;
}

/**
 * Group commands by namespace
 */
function groupByNamespace(commands: CommandInfo[]): NamespaceCommands[] {
  const namespaceMap = new Map<string, NamespaceCommands>();

  commands.forEach((cmd) => {
    if (!namespaceMap.has(cmd.namespace)) {
      // Convert namespace to PascalCase for interface name
      const interfaceName = cmd.namespace
        .split('-')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join('') + 'Commands';

      namespaceMap.set(cmd.namespace, {
        namespace: cmd.namespace,
        interfaceName,
        commands: [],
      });
    }

    const nsCommands = namespaceMap.get(cmd.namespace)!;
    nsCommands.commands.push({
      command: cmd.command,
      argsType: cmd.argsType,
      returnType: cmd.returnType,
    });
  });

  return Array.from(namespaceMap.values());
}

/**
 * Group events by namespace
 */
function groupEventsByNamespace(events: EventInfo[]): NamespaceEvents[] {
  const namespaceMap = new Map<string, NamespaceEvents>();

  events.forEach((evt) => {
    if (!namespaceMap.has(evt.namespace)) {
      // Convert namespace to PascalCase for interface name
      const interfaceName = evt.namespace
        .split('-')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join('') + 'Events';

      namespaceMap.set(evt.namespace, {
        namespace: evt.namespace,
        interfaceName,
        events: [],
      });
    }

    const nsEvents = namespaceMap.get(evt.namespace)!;
    nsEvents.events.push({
      eventName: evt.eventName,
      payloadType: evt.payloadType,
    });
  });

  return Array.from(namespaceMap.values());
}

/**
 * Replace custom type references with inline imports
 */
function replaceTypesWithInlineImports(typeExpression: string): string {
  // Built-in types that should not be imported
  const builtInTypes = new Set([
    'Record', 'Array', 'Promise', 'Partial', 'Required', 'Readonly',
    'Pick', 'Omit', 'Exclude', 'Extract', 'NonNullable', 'ReturnType',
    'InstanceType', 'Parameters', 'ConstructorParameters', 'Awaited',
    'String', 'Number', 'Boolean', 'Object', 'Function', 'Date', 'RegExp',
    'any', 'unknown', 'never', 'void', 'null', 'undefined',
    'string', 'number', 'boolean', 'object', 'symbol', 'bigint'
  ]);

  // Replace custom types with inline imports
  // Match capitalized identifiers that look like type names
  return typeExpression.replace(/\b([A-Z][a-zA-Z0-9]*)\b/g, (match) => {
    if (builtInTypes.has(match)) {
      return match; // Keep built-in types as-is
    }
    return `import("./index").${match}`; // Replace with inline import
  });
}

/**
 * Generate TypeScript event interface code
 */
function generateEventCode(namespaceEvents: NamespaceEvents[]): string {
  const lines: string[] = [];
  
  lines.push("/**");
  lines.push(" * AUTO-GENERATED FILE - DO NOT EDIT");
  lines.push(" * ");
  lines.push(" * This file is automatically generated by scripts/generate-commands.ts");
  lines.push(" * Run 'npm run codegen' to regenerate.");
  lines.push(" */");
  lines.push("");

  // Generate interface for each namespace
  namespaceEvents.forEach((ns, index) => {
    lines.push("/**");
    lines.push(` * ${ns.interfaceName} - Events for the "${ns.namespace}" namespace`);
    lines.push(" */");
    lines.push(`export interface ${ns.interfaceName} {`);

    ns.events.forEach((evt) => {
      // Replace type references with inline imports
      const payloadType = replaceTypesWithInlineImports(evt.payloadType);
      lines.push(`  "${ns.namespace}/${evt.eventName}": ${payloadType};`);
    });

    lines.push("}");
    
    if (index < namespaceEvents.length - 1) {
      lines.push("");
    }
  });

  // Generate AppEvents interface
  lines.push("");
  lines.push("/**");
  lines.push(" * Global event map - merge all event namespaces");
  lines.push(" */");
  
  if (namespaceEvents.length > 0) {
    const allInterfaces = namespaceEvents.map(ns => ns.interfaceName).join(", ");
    lines.push(`export interface AppEvents extends ${allInterfaces} {}`);
  } else {
    lines.push("export interface AppEvents {}");
  }

  // Generate event names array
  lines.push("");
  lines.push("/**");
  lines.push(" * Array of all available event names");
  lines.push(" */");
  lines.push("export const APP_EVENT_NAMES = [");
  
  const allEventNames: string[] = [];
  namespaceEvents.forEach((ns) => {
    ns.events.forEach((evt) => {
      allEventNames.push(`"${ns.namespace}/${evt.eventName}"`);
    });
  });
  
  allEventNames.forEach((name, index) => {
    const comma = index < allEventNames.length - 1 ? "," : "";
    lines.push(`  ${name}${comma}`);
  });
  
  lines.push("] as const;");

  return lines.join("\n") + "\n";
}

/**
 * Generate TypeScript interface code
 */
function generateInterfaceCode(namespaceCommands: NamespaceCommands[]): string {
  const lines: string[] = [];
  
  lines.push("/**");
  lines.push(" * AUTO-GENERATED FILE - DO NOT EDIT");
  lines.push(" * ");
  lines.push(" * This file is automatically generated by scripts/generate-commands.ts");
  lines.push(" * Run 'npm run codegen' to regenerate.");
  lines.push(" */");
  lines.push("");

  // Generate interface for each namespace
  namespaceCommands.forEach((ns, index) => {
    lines.push("/**");
    lines.push(` * ${ns.interfaceName} - Commands for the "${ns.namespace}" namespace`);
    lines.push(" */");
    lines.push(`export interface ${ns.interfaceName} {`);

    ns.commands.forEach((cmd) => {
      // Replace type references with inline imports
      const argsType = replaceTypesWithInlineImports(cmd.argsType);
      lines.push(`  "${ns.namespace}/${cmd.command}": ${argsType};`);
    });

    lines.push("}");
    
    if (index < namespaceCommands.length - 1) {
      lines.push("");
    }
  });

  // Generate CommandMap
  lines.push("");
  lines.push("/**");
  lines.push(" * Global command map - merge all command namespaces");
  lines.push(" */");
  
  if (namespaceCommands.length > 0) {
    const allInterfaces = namespaceCommands.map(ns => ns.interfaceName).join(", ");
    lines.push(`export interface CommandMap extends ${allInterfaces} {}`);
  } else {
    lines.push("export interface CommandMap {}");
  }

  // Generate command names array
  lines.push("");
  lines.push("/**");
  lines.push(" * Array of all available command names");
  lines.push(" */");
  lines.push("export const COMMAND_NAMES = [");
  
  const allCommandNames: string[] = [];
  namespaceCommands.forEach((ns) => {
    ns.commands.forEach((cmd) => {
      allCommandNames.push(`"${ns.namespace}/${cmd.command}"`);
    });
  });
  
  allCommandNames.forEach((name, index) => {
    const comma = index < allCommandNames.length - 1 ? "," : "";
    lines.push(`  ${name}${comma}`);
  });
  
  lines.push("] as const;");

  return lines.join("\n") + "\n";
}

/**
 * Main execution function
 */
export function generateCommands() {
  console.log("🔍 Scanning for @EdenHandler and @EdenNamespace decorators...");

  const projectRoot = path.resolve(__dirname, "..");
  const srcDir = path.join(projectRoot, "src", "main");
  
  // Find all TypeScript files
  const tsFiles = findTypeScriptFiles(srcDir);
  console.log(`Found ${tsFiles.length} TypeScript files`);

  // Create TypeScript program
  const program = ts.createProgram(tsFiles, {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.CommonJS,
    experimentalDecorators: true,
  });

  // Extract command handlers from all files
  const allCommands: CommandInfo[] = [];
  const allEvents: EventInfo[] = [];
  
  tsFiles.forEach((file) => {
    const sourceFile = program.getSourceFile(file);
    if (sourceFile) {
      const commands = extractCommandHandlers(sourceFile);
      const events = extractEventDeclarations(sourceFile);
      
      allCommands.push(...commands);
      allEvents.push(...events);
      
      if (commands.length > 0) {
        console.log(`  ✓ ${path.relative(projectRoot, file)}: ${commands.length} commands`);
      }
      if (events.length > 0) {
        console.log(`  ✓ ${path.relative(projectRoot, file)}: ${events.length} events`);
      }
    }
  });

  console.log(`\n📦 Found ${allCommands.length} total command handlers`);
  console.log(`📦 Found ${allEvents.length} total event declarations`);

  // Group by namespace
  const namespaceCommands = groupByNamespace(allCommands);
  console.log(`📋 Grouped commands into ${namespaceCommands.length} namespaces:`);
  namespaceCommands.forEach((ns) => {
    console.log(`  - ${ns.namespace}: ${ns.commands.length} commands`);
  });

  const namespaceEvents = groupEventsByNamespace(allEvents);
  console.log(`📋 Grouped events into ${namespaceEvents.length} namespaces:`);
  namespaceEvents.forEach((ns) => {
    console.log(`  - ${ns.namespace}: ${ns.events.length} events`);
  });

  // Generate commands code
  const commandsCode = generateInterfaceCode(namespaceCommands);
  const commandsOutputPath = path.join(projectRoot, "src", "types", "commands.generated.ts");
  fs.writeFileSync(commandsOutputPath, commandsCode);
  console.log(`\n✅ Generated ${path.relative(projectRoot, commandsOutputPath)}`);

  // Generate events code
  const eventsCode = generateEventCode(namespaceEvents);
  const eventsOutputPath = path.join(projectRoot, "src", "types", "events.generated.ts");
  fs.writeFileSync(eventsOutputPath, eventsCode);
  console.log(`✅ Generated ${path.relative(projectRoot, eventsOutputPath)}`);
}


