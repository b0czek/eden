import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { UserRole } from "@edenapp/types";
import * as Effect from "effect/Effect";
import { fromPromise } from "../effects/io";
import {
  DirectoryRestrictionError,
  DirectoryRestrictionIoError,
} from "./errors";

export function normalizeDirectoryRestriction(
  directoryRestriction: string | null | undefined,
): string | undefined {
  const value = directoryRestriction?.trim();
  if (!value || value === ".") {
    return undefined;
  }

  if (value.includes("\0")) {
    throw new DirectoryRestrictionError({
      path: value,
      message: "Directory restriction contains an invalid character",
    });
  }

  const portablePath = value.replaceAll("\\", "/");
  if (path.posix.isAbsolute(portablePath) || path.win32.isAbsolute(value)) {
    throw new DirectoryRestrictionError({
      path: value,
      message: "Directory restriction must be relative to userDirectory",
    });
  }

  const normalized = path.posix.normalize(portablePath);
  if (normalized === ".." || normalized.startsWith("../")) {
    throw new DirectoryRestrictionError({
      path: value,
      message: "Directory restriction cannot leave userDirectory",
    });
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

export const ensureDirectoryRestriction = Effect.fn(function* (
  userDirectory: string,
  role: UserRole,
  directoryRestriction: string | null | undefined,
) {
  const normalized = yield* Effect.try({
    try: () => normalizeDirectoryRestriction(directoryRestriction),
    catch: directoryValidationFailure,
  });
  if (role === "vendor") {
    if (normalized) {
      return yield* Effect.fail(
        new DirectoryRestrictionError({
          path: normalized,
          message: "Vendor users always use the userDirectory root",
        }),
      );
    }
    return undefined;
  }

  if (!normalized) {
    return undefined;
  }

  const root = path.resolve(userDirectory);
  const directory = resolveDirectoryRestriction(root, normalized);
  yield* assertExistingPathWithin(root, directory);
  yield* fromPromise(
    () => fs.mkdir(directory, { recursive: true }),
    (cause) =>
      new DirectoryRestrictionIoError({
        path: directory,
        operation: "mkdir",
        cause,
      }),
  );
  yield* assertExistingPathWithin(root, directory);
  return normalized;
});

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
    throw new DirectoryRestrictionError({
      path: targetPath,
      message: `${label} is outside of the allowed directory`,
    });
  }
}

export const assertExistingPathWithin = Effect.fn(function* (
  rootPath: string,
  targetPath: string,
) {
  const resolvedRoot = path.resolve(rootPath);
  const resolvedTarget = path.resolve(targetPath);
  yield* Effect.try({
    try: () => assertPathWithin(resolvedRoot, resolvedTarget),
    catch: directoryValidationFailure,
  });
  const realRoot = yield* fromPromise(
    () => fs.realpath(resolvedRoot),
    (cause) =>
      new DirectoryRestrictionIoError({
        path: resolvedRoot,
        operation: "realpath",
        cause,
      }),
  );
  const relative = path.relative(resolvedRoot, resolvedTarget);
  let current = resolvedRoot;
  for (const component of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    const stats = yield* fromPromise(
      () => fs.lstat(current),
      (cause) =>
        new DirectoryRestrictionIoError({
          path: current,
          operation: "lstat",
          cause,
        }),
    ).pipe(
      Effect.catch((error) =>
        (error.cause as NodeJS.ErrnoException).code === "ENOENT"
          ? Effect.succeed(undefined)
          : Effect.fail(error),
      ),
    );
    if (!stats) return;
    const realCurrent = yield* fromPromise(
      () => fs.realpath(current),
      (cause) =>
        new DirectoryRestrictionIoError({
          path: current,
          operation: "realpath",
          cause,
        }),
    );
    yield* Effect.try({
      try: () => assertPathWithin(realRoot, realCurrent),
      catch: directoryValidationFailure,
    });
  }
});

// Validation helpers throw only this documented rejection; programmer failures remain defects.
export function directoryValidationFailure(
  cause: unknown,
): DirectoryRestrictionError {
  if (cause instanceof DirectoryRestrictionError) return cause;
  throw cause;
}
