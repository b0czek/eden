import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { AppManifest, DlcManifest, PackageManifest } from "@edenapp/types";
import semver from "semver";

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const isRemoteEntry = (entry?: string): boolean =>
  !!entry && /^https?:\/\//i.test(entry);

function validateFileHandlers(
  value: unknown,
  field: string,
  errors: string[],
): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    errors.push(`${field} must be an array`);
    return;
  }

  for (const [index, candidate] of value.entries()) {
    const handlerField = `${field}[${index}]`;
    if (
      !candidate ||
      typeof candidate !== "object" ||
      Array.isArray(candidate)
    ) {
      errors.push(`${handlerField} must be an object`);
      continue;
    }
    const handler = candidate as Record<string, unknown>;
    if (typeof handler.name !== "string" || !handler.name.trim()) {
      errors.push(`Missing required field: ${handlerField}.name`);
    }
    const hasExtensions =
      Array.isArray(handler.extensions) && handler.extensions.length > 0;
    const hasMimeTypes =
      Array.isArray(handler.mimeTypes) && handler.mimeTypes.length > 0;
    if (!hasExtensions && !hasMimeTypes && handler.directories !== true) {
      errors.push(
        `${handlerField} must declare extensions, mimeTypes, or directories`,
      );
    }
  }
}

export function validateAppManifestObject(manifest: AppManifest): {
  valid: boolean;
  errors: string[];
  manifest?: AppManifest;
} {
  const errors: string[] = [];
  if (manifest.kind !== undefined && manifest.kind !== "app") {
    errors.push('App manifest kind must be "app" when specified');
  }
  if (!manifest.id) errors.push("Missing required field: id");
  if (!manifest.name) errors.push("Missing required field: name");
  if (!manifest.version) errors.push("Missing required field: version");
  if (manifest.id && !/^[a-z0-9.-]+$/.test(manifest.id)) {
    errors.push(
      "Invalid ID format. Use lowercase letters, numbers, dots, and hyphens only.",
    );
  }
  if (manifest.backend && !manifest.backend.entry) {
    errors.push("Missing required field: backend.entry");
  }
  if (manifest.frontend && !manifest.frontend.entry) {
    errors.push("Missing required field: frontend.entry");
  } else if (
    manifest.frontend &&
    !isRemoteEntry(manifest.frontend.entry) &&
    manifest.frontend.entry.startsWith("http")
  ) {
    errors.push("Invalid frontend.entry URL");
  }
  if (
    manifest.build?.concurrent !== undefined &&
    typeof manifest.build.concurrent !== "boolean"
  ) {
    errors.push("build.concurrent must be a boolean");
  }
  validateFileHandlers(manifest.fileHandlers, "fileHandlers", errors);
  for (const [categoryIndex, category] of (manifest.settings ?? []).entries()) {
    for (const [settingIndex, setting] of category.settings.entries()) {
      if (setting.sharedWith === undefined) continue;
      if (!Array.isArray(setting.sharedWith)) {
        errors.push(
          `settings[${categoryIndex}].settings[${settingIndex}].sharedWith must be an array`,
        );
        continue;
      }
      const seenReaders = new Set<string>();
      for (const [readerIndex, readerAppId] of setting.sharedWith.entries()) {
        const field =
          `settings[${categoryIndex}].settings[${settingIndex}]` +
          `.sharedWith[${readerIndex}]`;
        if (!/^[a-z0-9.-]+$/.test(readerAppId)) {
          errors.push(`${field} must be a valid app ID`);
        } else if (readerAppId === manifest.id) {
          errors.push(`${field} cannot reference the owning app`);
        } else if (seenReaders.has(readerAppId)) {
          errors.push(`${field} duplicates app ID "${readerAppId}"`);
        }
        seenReaders.add(readerAppId);
      }
    }
  }
  if (manifest.dlc) {
    const points = manifest.dlc.extensionPoints;
    if (!Array.isArray(points) || points.length === 0) {
      errors.push(
        "dlc.extensionPoints must contain at least one extension point",
      );
    } else {
      const seen = new Set<string>();
      for (const [index, point] of points.entries()) {
        const field = `dlc.extensionPoints[${index}]`;
        if (!point?.id?.trim()) errors.push(`${field}.id is required`);
        else if (seen.has(point.id)) {
          errors.push(`${field}.id duplicates "${point.id}"`);
        }
        if (!semver.valid(point?.version)) {
          errors.push(`${field}.version must be strict SemVer`);
        }
        if (point?.id) seen.add(point.id);
      }
    }
  }
  if (!manifest.frontend && !manifest.backend) {
    errors.push("App must have at least a frontend or backend entry");
  }
  return {
    valid: errors.length === 0,
    errors,
    manifest: errors.length === 0 ? manifest : undefined,
  };
}

/** Backward-compatible app-specific validation API. */
export const validateManifestObject = validateAppManifestObject;

export function validateDlcManifestObject(manifest: DlcManifest): {
  valid: boolean;
  errors: string[];
  manifest?: DlcManifest;
} {
  const errors: string[] = [];
  if (manifest.kind !== "dlc") errors.push('DLC manifest kind must be "dlc"');
  if (!manifest.id) errors.push("Missing required field: id");
  if (!manifest.name) errors.push("Missing required field: name");
  if (!manifest.version) errors.push("Missing required field: version");
  if (!manifest.hostAppId) errors.push("Missing required field: hostAppId");
  for (const [field, value] of [
    ["id", manifest.id],
    ["hostAppId", manifest.hostAppId],
  ] as const) {
    if (value && !/^[a-z0-9.-]+$/.test(value)) {
      errors.push(
        `${field} must use lowercase letters, numbers, dots, and hyphens only`,
      );
    }
  }
  if (manifest.id && manifest.id === manifest.hostAppId) {
    errors.push("A DLC id must differ from its hostAppId");
  }
  validateFileHandlers(manifest.fileHandlers, "fileHandlers", errors);
  for (const field of [
    "frontend",
    "backend",
    "permissions",
    "services",
    "grants",
    "settings",
    "window",
    "overlay",
    "hidden",
    "development",
    "build",
    "include",
    "dlc",
  ] as const) {
    if (field in manifest) {
      errors.push(`DLC manifests cannot declare ${field}`);
    }
  }
  if (
    !Array.isArray(manifest.contributions) ||
    manifest.contributions.length === 0
  ) {
    errors.push("contributions must contain at least one contribution");
  } else {
    const seen = new Set<string>();
    for (const [index, contribution] of manifest.contributions.entries()) {
      const field = `contributions[${index}]`;
      if (!contribution?.extensionPoint?.trim()) {
        errors.push(`${field}.extensionPoint is required`);
      } else if (seen.has(contribution.extensionPoint)) {
        errors.push(
          `${field}.extensionPoint duplicates "${contribution.extensionPoint}"`,
        );
      }
      if (
        !contribution?.requires ||
        !semver.validRange(contribution.requires)
      ) {
        errors.push(`${field}.requires must be a valid SemVer range`);
      }
      if (
        contribution &&
        "metadata" in contribution &&
        !isJsonValue(contribution.metadata)
      ) {
        errors.push(`${field}.metadata must be JSON data`);
      }
      if (contribution?.extensionPoint) seen.add(contribution.extensionPoint);
    }
  }
  return {
    valid: errors.length === 0,
    errors,
    manifest: errors.length === 0 ? manifest : undefined,
  };
}

function isJsonValue(value: unknown): boolean {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value !== "object" || value === null) return false;
  return Object.values(value).every(isJsonValue);
}

export function validatePackageManifestObject(manifest: unknown): {
  valid: boolean;
  errors: string[];
  manifest?: PackageManifest;
} {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return { valid: false, errors: ["Manifest must be a JSON object"] };
  }
  const candidate = manifest as { kind?: unknown };
  if (candidate.kind === "dlc") {
    return validateDlcManifestObject(manifest as DlcManifest);
  }
  if (candidate.kind !== undefined && candidate.kind !== "app") {
    return {
      valid: false,
      errors: ['Manifest kind must be "app", "dlc", or omitted'],
    };
  }
  return validateAppManifestObject(manifest as AppManifest);
}

export async function validateManifest(
  manifestPath: string,
): Promise<{ valid: boolean; errors: string[]; manifest?: PackageManifest }> {
  try {
    const manifest = JSON.parse(
      await fs.readFile(manifestPath, "utf-8"),
    ) as PackageManifest;
    if (!manifest.version) {
      const kindLabel = manifest.kind === "dlc" ? "DLC" : "app";
      try {
        const packageJson = JSON.parse(
          await fs.readFile(
            path.join(path.dirname(manifestPath), "package.json"),
            "utf-8",
          ),
        ) as { version?: unknown };
        if (
          typeof packageJson.version !== "string" ||
          packageJson.version.trim().length === 0
        ) {
          throw new Error("version must be a non-empty string");
        }
        manifest.version = packageJson.version;
      } catch (error) {
        return {
          valid: false,
          errors: [
            `Could not infer ${kindLabel} version from package.json: ${errorMessage(error)}`,
          ],
        };
      }
    }
    return validatePackageManifestObject(manifest);
  } catch (error) {
    return {
      valid: false,
      errors: [`Failed to read/parse manifest: ${errorMessage(error)}`],
    };
  }
}

export async function validateAppManifest(
  manifestPath: string,
): Promise<{ valid: boolean; errors: string[]; manifest?: AppManifest }> {
  const result = await validateManifest(manifestPath);
  if (!result.valid || !result.manifest) {
    return { valid: false, errors: result.errors };
  }
  if (result.manifest.kind === "dlc") {
    return {
      valid: false,
      errors: ["Expected an app manifest, received a DLC"],
    };
  }
  return { valid: true, errors: [], manifest: result.manifest };
}

export async function verifyFiles(
  packageDirectory: string,
  manifest: PackageManifest,
): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];
  if (manifest.kind !== "dlc" && manifest.backend?.entry) {
    try {
      await fs.access(path.join(packageDirectory, manifest.backend.entry));
    } catch {
      errors.push(`Backend entry file not found: ${manifest.backend.entry}`);
    }
  }
  if (
    manifest.kind !== "dlc" &&
    manifest.frontend?.entry &&
    !isRemoteEntry(manifest.frontend.entry)
  ) {
    try {
      await fs.access(path.join(packageDirectory, manifest.frontend.entry));
    } catch {
      errors.push(`Frontend entry file not found: ${manifest.frontend.entry}`);
    }
  }
  return { valid: errors.length === 0, errors };
}

export function isDlcCompatible(
  host: AppManifest,
  dlc: DlcManifest,
): { compatible: boolean; errors: string[] } {
  if (dlc.hostAppId !== host.id) {
    return {
      compatible: false,
      errors: [`DLC requires host ${dlc.hostAppId}`],
    };
  }
  const points = new Map(
    (host.dlc?.extensionPoints ?? []).map((point) => [point.id, point.version]),
  );
  const errors: string[] = [];
  for (const contribution of dlc.contributions) {
    const version = points.get(contribution.extensionPoint);
    if (!version) {
      errors.push(
        `Host does not declare extension point ${contribution.extensionPoint}`,
      );
    } else if (!semver.satisfies(version, contribution.requires)) {
      errors.push(
        `Extension point ${contribution.extensionPoint} ${version} does not satisfy ${contribution.requires}`,
      );
    }
  }
  return { compatible: errors.length === 0, errors };
}
