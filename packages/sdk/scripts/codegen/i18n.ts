/**
 * I18n Type Generator
 *
 * Generates TypeScript type definitions for common SDK translations.
 * Reads the English locale file and outputs flattened types with
 * interpolation argument extraction.
 */

import * as fs from "fs";
import * as path from "path";
import { generateHeader } from "./utils";

interface LocaleObject {
  [key: string]: string | LocaleObject;
}

interface FlattenedKey {
  key: string;
  value: string;
  args: string[];
}

/**
 * Extract interpolation argument names from a translation string.
 * Matches patterns like {name}, {count}, etc.
 */
function extractArgs(value: string): string[] {
  const matches = value.match(/\{(\w+)\}/g);
  if (!matches) return [];
  return matches.map((m) => m.slice(1, -1));
}

/**
 * Recursively flatten a nested locale object into dot-notation keys.
 */
function flattenLocale(obj: LocaleObject, prefix: string = ""): FlattenedKey[] {
  const results: FlattenedKey[] = [];

  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;

    if (typeof value === "string") {
      results.push({
        key: fullKey,
        value,
        args: extractArgs(value),
      });
    } else if (typeof value === "object" && value !== null) {
      results.push(...flattenLocale(value, fullKey));
    }
  }

  return results;
}

/**
 * Generate TypeScript interface code from flattened keys.
 */
function generateI18nTypeCode(keys: FlattenedKey[]): string {
  const lines: string[] = generateHeader(
    "Common translations from the Eden SDK.",
  );

  lines.push("/**");
  lines.push(
    " * Type-safe mapping of common translation keys to their argument requirements.",
  );
  lines.push(" * - `void` means no interpolation arguments needed");
  lines.push(
    " * - `{ argName: string | number }` means arguments are required",
  );
  lines.push(" */");
  lines.push("export interface I18nCommonTranslations {");

  for (const { key, args } of keys) {
    if (args.length === 0) {
      lines.push(`  "${key}": void;`);
    } else {
      const argsType = args.map((a) => `${a}: string | number`).join("; ");
      lines.push(`  "${key}": { ${argsType} };`);
    }
  }

  lines.push("}");
  lines.push("");
  lines.push("/**");
  lines.push(" * Union type of all common translation keys.");
  lines.push(" */");
  lines.push("export type I18nCommonKey = keyof I18nCommonTranslations;");
  lines.push("");

  return lines.join("\n");
}

/**
 * Generate i18n types from SDK locale files
 */
export function generateI18nTypes(projectRoot: string): void {
  console.log("\n🌐 Generating i18n types from SDK locale files...");

  const localeFile = path.join(projectRoot, "src/i18n/locales/en.ts");

  // Read and parse the locale file
  const localeContent = fs.readFileSync(localeFile, "utf-8");

  // Extract the exported object using regex
  const objectMatch = localeContent.match(
    /export\s+const\s+\w+\s*=\s*(\{[\s\S]*\});?\s*$/,
  );
  if (!objectMatch) {
    console.error("❌ Could not parse locale file");
    return;
  }

  // Parse the object
  let localeObj: LocaleObject;
  try {
    const jsonStr = objectMatch[1]
      .replace(/'/g, '"')
      .replace(/(\w+)\s*:/g, '"$1":')
      .replace(/,(\s*[}\]])/g, "$1");
    localeObj = JSON.parse(jsonStr);
  } catch (e) {
    console.error("❌ Could not parse locale object:", e);
    return;
  }

  // Flatten and generate types
  const flatKeys = flattenLocale(localeObj);
  console.log(`📦 Found ${flatKeys.length} translation keys`);

  const typeCode = generateI18nTypeCode(flatKeys);

  // Output to babel package
  const workspaceRoot = path.resolve(projectRoot, "../..");
  const outputDir = path.join(workspaceRoot, "packages/babel/src/generated");
  const outputFile = path.join(outputDir, "i18n.ts");

  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(outputFile, typeCode);
  console.log(`✅ Generated ${path.relative(projectRoot, outputFile)}`);

  // Log the keys for verification
  console.log("\n📋 Generated keys:");
  for (const { key, args } of flatKeys) {
    const argsStr = args.length > 0 ? ` (args: ${args.join(", ")})` : "";
    console.log(`   - ${key}${argsStr}`);
  }
}
