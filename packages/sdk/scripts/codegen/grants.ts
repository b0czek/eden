/**
 * Grant Type Generator
 *
 * Extracts permissions from EDEN_SETTINGS_SCHEMA and generates typed grants.
 */

import { Project, Node } from "ts-morph";
import * as path from "path";
import { generateHeader } from "./utils";

export interface GrantInfo {
  /** Key name in EdenGrants object (e.g., "USERS") */
  key: string;
  /** Permission key from schema (e.g., "users") */
  permission: string;
  /** Full grant string (e.g., "settings/com.eden/users") */
  grant: string;
  /** Category ID for documentation */
  categoryId: string;
}

/**
 * Extract grants from EDEN_SETTINGS_SCHEMA
 */
export function extractGrantsFromSchema(
  project: Project,
  srcDir: string,
): GrantInfo[] {
  const grants: GrantInfo[] = [];
  const settingsFile = project.getSourceFile(
    path.join(srcDir, "settings", "EdenSettings.ts"),
  );

  if (!settingsFile) {
    console.warn("  ⚠ EdenSettings.ts not found, skipping grant generation");
    return grants;
  }

  // Find EDEN_SETTINGS_SCHEMA variable
  const schemaVar = settingsFile.getVariableDeclaration("EDEN_SETTINGS_SCHEMA");
  if (!schemaVar) {
    console.warn("  ⚠ EDEN_SETTINGS_SCHEMA not found");
    return grants;
  }

  const initializer = schemaVar.getInitializer();
  if (!initializer || !Node.isArrayLiteralExpression(initializer)) {
    console.warn("  ⚠ EDEN_SETTINGS_SCHEMA is not an array literal");
    return grants;
  }

  // Parse each category in the array
  for (const element of initializer.getElements()) {
    if (!Node.isObjectLiteralExpression(element)) continue;

    let categoryId: string | null = null;
    let permission: string | null = null;

    for (const prop of element.getProperties()) {
      if (!Node.isPropertyAssignment(prop)) continue;

      const propName = prop.getName();
      const propInit = prop.getInitializer();

      if (propName === "id" && propInit && Node.isStringLiteral(propInit)) {
        categoryId = propInit.getLiteralText();
      }
      if (
        propName === "permission" &&
        propInit &&
        Node.isStringLiteral(propInit)
      ) {
        permission = propInit.getLiteralText();
      }
    }

    if (categoryId && permission) {
      // Convert category ID to uppercase key (e.g., "users" -> "USERS")
      const key = categoryId.toUpperCase().replace(/-/g, "_");
      const grant = `settings/com.eden/${permission}`;

      grants.push({ key, permission, grant, categoryId });
    }
  }

  return grants;
}

/**
 * Generate grants.generated.d.ts for @edenapp/types
 */
export function generateGrantsTypesCode(grants: GrantInfo[]): string {
  const lines: string[] = generateHeader(
    "This file contains typed Eden grants derived from EDEN_SETTINGS_SCHEMA.",
  );

  lines.push("/** Eden's app ID for settings namespace */");
  lines.push('export declare const EDEN_APP_ID = "com.eden";');
  lines.push("");
  lines.push("/**");
  lines.push(" * Eden Grants Registry");
  lines.push(" *");
  lines.push(" * Typed grants derived from EDEN_SETTINGS_SCHEMA.");
  lines.push(
    " * Each category with a `permission` field becomes a grant entry.",
  );
  lines.push(" */");
  lines.push("export declare const EdenGrants: {");

  for (const grant of grants) {
    lines.push(
      `  /** Grant for ${grant.categoryId} settings (${grant.grant}) */`,
    );
    lines.push(`  readonly ${grant.key}: "${grant.grant}";`);
  }

  lines.push("};");
  lines.push("");
  lines.push("/** Type for valid Eden grant values */");
  lines.push(
    "export type EdenGrant = (typeof EdenGrants)[keyof typeof EdenGrants];",
  );

  return lines.join("\n") + "\n";
}

/**
 * Generate grants runtime file for SDK
 */
export function generateGrantsRuntimeCode(grants: GrantInfo[]): string {
  const lines: string[] = generateHeader(
    "Runtime Eden grants derived from EDEN_SETTINGS_SCHEMA.",
  );

  lines.push("/** Eden's app ID for settings namespace */");
  lines.push('export const EDEN_APP_ID = "com.eden";');
  lines.push("");
  lines.push("/** Build a settings grant string for Eden settings */");
  lines.push(
    "export const buildEdenSettingsGrant = (permissionKey: string): string =>",
  );
  lines.push("  `settings/${EDEN_APP_ID}/${permissionKey}`;");
  lines.push("");
  lines.push("/**");
  lines.push(" * Eden Grants Registry");
  lines.push(" *");
  lines.push(" * Typed grants derived from EDEN_SETTINGS_SCHEMA.");
  lines.push(
    " * Each category with a `permission` field becomes a grant entry.",
  );
  lines.push(" */");
  lines.push("export const EdenGrants = {");

  for (const grant of grants) {
    lines.push(
      `  /** Grant for ${grant.categoryId} settings (${grant.grant}) */`,
    );
    lines.push(`  ${grant.key}: "${grant.grant}",`);
  }

  lines.push("} as const;");
  lines.push("");
  lines.push("/** Type for valid Eden grant values */");
  lines.push(
    "export type EdenGrant = (typeof EdenGrants)[keyof typeof EdenGrants];",
  );

  return lines.join("\n") + "\n";
}
