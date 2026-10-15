import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { UserRole } from "@edenapp/types";

export function normalizeDirectoryRestriction(
  directoryRestriction: string | null | undefined,
): string | undefined {
  const value = directoryRestriction?.trim();
  if (!value || value === ".") {
    return undefined;
  }

  if (value.includes("\0")) {
    throw new Error("Directory restriction contains an invalid character");
  }

  const portablePath = value.replaceAll("\\", "/");
  if (path.posix.isAbsolute(portablePath) || path.win32.isAbsolute(value)) {
    throw new Error("Directory restriction must be relative to userDirectory");
  }

  const normalized = path.posix.normalize(portablePath);
  if (normalized === ".." || normalized.startsWith("../")) {
    throw new Error("Directory restriction cannot leave userDirectory");
  }

  return normalized === "." ? undefined : normalized;
}

export function resolveDirectoryRestriction(
  userDirectory: string,
  directoryRestriction: string,
): string {
  const resolvedRoot = path.resolve(userDirectory);
  const resolvedDirectory = path.resolve(
    resolvedRoot,
    ...directoryRestriction.split("/"),
  );
  assertPathWithin(resolvedRoot, resolvedDirectory, "Directory restriction");
  return resolvedDirectory;
}

export async function ensureDirectoryRestriction(
  userDirectory: string,
  role: UserRole,
  directoryRestriction: string | null | undefined,
): Promise<string | undefined> {
  const normalized = normalizeDirectoryRestriction(directoryRestriction);
  if (role === "vendor") {
    if (normalized) {
      throw new Error("Vendor users always use the userDirectory root");
    }
    return undefined;
  }

  if (!normalized) {
    return undefined;
  }

  const root = path.resolve(userDirectory);
  const directory = resolveDirectoryRestriction(root, normalized);
  await assertExistingPathWithin(root, directory);
  await fs.mkdir(directory, { recursive: true });
  await assertExistingPathWithin(root, directory);
  return normalized;
}

export function assertPathWithin(
  rootPath: string,
  targetPath: string,
  label: string = "Path",
): void {
  const relative = path.relative(rootPath, targetPath);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`${label} is outside of the allowed directory`);
  }
}

export async function assertExistingPathWithin(
  rootPath: string,
  targetPath: string,
): Promise<void> {
  const resolvedRoot = path.resolve(rootPath);
  const resolvedTarget = path.resolve(targetPath);
  assertPathWithin(resolvedRoot, resolvedTarget);

  const realRoot = await fs.realpath(resolvedRoot);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  let current = resolvedRoot;

  for (const component of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    try {
      await fs.lstat(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return;
      }
      throw error;
    }

    const realCurrent = await fs.realpath(current);
    assertPathWithin(realRoot, realCurrent);
  }
}
