import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import { asError, fromPromise } from "../effects/io";

export class PathOutsideRoot extends Data.TaggedError("PathOutsideRoot")<{
  readonly path: string;
  readonly message: string;
}> {}

export class PathContainmentIoError extends Data.TaggedError(
  "PathContainmentIoError",
)<{
  readonly path: string;
  readonly operation: "realpath" | "lstat";
  readonly cause: unknown;
}> {
  override get message() {
    return asError(this.cause).message;
  }
}

export type PathContainmentFailure = PathOutsideRoot | PathContainmentIoError;

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
    throw new PathOutsideRoot({
      path: targetPath,
      message: `${label} is outside of the allowed directory`,
    });
  }
}

function containmentRejection(cause: unknown): PathOutsideRoot {
  if (cause instanceof PathOutsideRoot) return cause;
  throw cause;
}

/** Check existing ancestors too, allowing missing descendants within the root. */
export const assertExistingPathWithin = Effect.fn(function* (
  rootPath: string,
  targetPath: string,
) {
  const resolvedRoot = path.resolve(rootPath);
  const resolvedTarget = path.resolve(targetPath);
  yield* Effect.try({
    try: () => assertPathWithin(resolvedRoot, resolvedTarget),
    catch: containmentRejection,
  });
  const realRoot = yield* fromPromise(
    () => fs.realpath(resolvedRoot),
    (cause) =>
      new PathContainmentIoError({
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
        new PathContainmentIoError({
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
        new PathContainmentIoError({
          path: current,
          operation: "realpath",
          cause,
        }),
    );
    yield* Effect.try({
      try: () => assertPathWithin(realRoot, realCurrent),
      catch: containmentRejection,
    });
  }
});
