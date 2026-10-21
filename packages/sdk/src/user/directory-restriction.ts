import * as path from "node:path";
import type { UserRole } from "@edenapp/types";
import * as Effect from "effect/Effect";
import { FilesystemIoFailed } from "../filesystem/native-errors";
import { io } from "../filesystem/native-io";
import {
  assertExistingPathWithin,
  assertPathWithin,
  type PathContainmentFailure,
  PathOutsideRoot,
} from "../filesystem/path-containment";
import { DirectoryRestrictionError, type UserDirectoryFailure } from "./errors";

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
  try {
    assertPathWithin(resolvedRoot, resolvedDirectory, "Directory restriction");
  } catch (cause) {
    if (cause instanceof PathOutsideRoot)
      throw directoryContainmentFailure(cause);
    throw cause;
  }
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
  yield* assertExistingPathWithin(root, directory).pipe(
    Effect.mapError(directoryContainmentFailure),
  );
  yield* io.mkdir(directory, { recursive: true });
  yield* assertExistingPathWithin(root, directory).pipe(
    Effect.mapError(directoryContainmentFailure),
  );
  return normalized;
});

function directoryContainmentFailure(
  cause: PathContainmentFailure,
): UserDirectoryFailure {
  return cause instanceof FilesystemIoFailed
    ? cause
    : new DirectoryRestrictionError({
        path: cause.path,
        message: cause.message,
      });
}

// Validation helpers throw only this documented rejection; programmer failures remain defects.
export function directoryValidationFailure(
  cause: unknown,
): DirectoryRestrictionError {
  if (cause instanceof DirectoryRestrictionError) return cause;
  throw cause;
}
