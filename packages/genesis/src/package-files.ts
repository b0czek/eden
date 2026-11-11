import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { PackageManifest } from "@edenapp/types";

export function shouldExcludeFile(
  filePath: string,
  manifest?: PackageManifest,
): boolean {
  if (manifest?.kind !== "dlc" && manifest?.include) {
    const normalizedFile = filePath.replace(/\\/g, "/");
    if (
      manifest.include.some((included) => {
        const normalized = included.replace(/\\/g, "/");
        return (
          normalizedFile === normalized ||
          normalizedFile.startsWith(`${normalized}/`)
        );
      })
    ) {
      return false;
    }
  }
  return [
    /(?:^|\/)node_modules(?:\/|$)/,
    /^src(?:\/|$)/,
    /^tsconfig(?:\..+)?\.json$/,
    /^vite\.config\..+$/,
    /^\.eslintrc/,
    /^\.prettierrc/,
    /^\.git(?:ignore|\/)/,
    /^\.DS_Store$/,
    /^(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/,
    /^\.(?:vite|cache)\//,
    /^__tests__\//,
    /\.(?:test|spec)\.[jt]sx?$/,
  ].some((pattern) => pattern.test(filePath));
}

export const MANIFEST_FILE = "manifest.json";

/** Serializes the resolved manifest that a built package ships with. */
export function serializeManifest(manifest: PackageManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export async function listPackageFiles(
  packageDirectory: string,
  manifest: PackageManifest,
): Promise<string[]> {
  const files = await fs.readdir(packageDirectory, { recursive: true });
  const included: string[] = [];
  for (const file of files) {
    const relative = String(file);
    if (shouldExcludeFile(relative, manifest)) continue;
    const stat = await fs.lstat(path.join(packageDirectory, relative));
    if (stat.isSymbolicLink()) {
      throw new Error(`Package source contains unsupported link: ${relative}`);
    }
    if (stat.isFile()) included.push(relative);
  }
  return included;
}

export async function copyPackageFiles(
  packageDirectory: string,
  targetDirectory: string,
  manifest: PackageManifest,
  verbose?: boolean,
): Promise<void> {
  for (const relative of await listPackageFiles(packageDirectory, manifest)) {
    const target = path.join(path.resolve(targetDirectory), relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    if (relative === MANIFEST_FILE) {
      await fs.writeFile(target, serializeManifest(manifest), "utf-8");
    } else {
      await fs.copyFile(path.join(packageDirectory, relative), target);
    }
    if (verbose) console.log(`  + ${relative}`);
  }
}
