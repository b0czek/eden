/**
 * Command Type Generator
 * 
 * Scans TypeScript files for @CommandHandler decorators and automatically
 * generates the AppCommands interface and related command types.
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

/**
 * Extract command handlers from a TypeScript source file
 */
function extractCommandHandlers(sourceFile: ts.SourceFile): CommandInfo[] {
  const commands: CommandInfo[] = [];
  let currentNamespace = "";

  function visit(node: ts.Node) {
    // Look for class declarations with @CommandNamespace decorator
    if (ts.isClassDeclaration(node)) {
      const namespaceDecorator = ts.getDecorators(node)?.find((dec) => {
        if (ts.isCallExpression(dec.expression)) {
          const expr = dec.expression;
          if (ts.isIdentifier(expr.expression) && expr.expression.text === "CommandNamespace") {
            return true;
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
              if (ts.isIdentifier(expr.expression) && expr.expression.text === "CommandHandler") {
                return true;
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
      lines.push(`  "${ns.namespace}/${cmd.command}": ${cmd.argsType};`);
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

  return lines.join("\n") + "\n";
}

/**
 * Main execution function
 */
export function generateCommands() {
  console.log("🔍 Scanning for @CommandHandler decorators...");

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
  tsFiles.forEach((file) => {
    const sourceFile = program.getSourceFile(file);
    if (sourceFile) {
      const commands = extractCommandHandlers(sourceFile);
      allCommands.push(...commands);
      
      if (commands.length > 0) {
        console.log(`  ✓ ${path.relative(projectRoot, file)}: ${commands.length} commands`);
      }
    }
  });

  console.log(`\n📦 Found ${allCommands.length} total command handlers`);

  // Group by namespace
  const namespaceCommands = groupByNamespace(allCommands);
  console.log(`📋 Grouped into ${namespaceCommands.length} namespaces:`);
  namespaceCommands.forEach((ns) => {
    console.log(`  - ${ns.namespace}: ${ns.commands.length} commands`);
  });

  // Generate code
  const generatedCode = generateInterfaceCode(namespaceCommands);

  // Write to file
  const outputPath = path.join(projectRoot, "src", "types", "commands.generated.ts");
  fs.writeFileSync(outputPath, generatedCode);

  console.log(`\n✅ Generated ${path.relative(projectRoot, outputPath)}`);
}


