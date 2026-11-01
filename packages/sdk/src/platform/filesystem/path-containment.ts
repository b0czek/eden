import * as path from "node:path";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import { isPathWithin } from "./lexical-path";
import type { FilesystemIoFailed } from "./native-errors";
import { io } from "./native-io";

export class PathOutsideRoot extends Data.TaggedError("PathOutsideRoot")<{
  readonly path: string;
  readonly message: string;
}> {}

export type PathContainmentFailure = PathOutsideRoot | FilesystemIoFailed;

export function assertPathWithin(
  rootPath: string,
  targetPath: string,
  label: string = "Path",
): void {
  if (!isPathWithin(rootPath, targetPath)) {
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
  const realRoot = yield* io.realpath(resolvedRoot);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  let current = resolvedRoot;
  for (const component of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    const stats = yield* io
      .lstat(current)
      .pipe(
        Effect.catch((error) =>
          error.code === "ENOENT"
            ? Effect.succeed(undefined)
            : Effect.fail(error),
        ),
      );
    if (!stats) return;
    const realCurrent = yield* io.realpath(current);
    yield* Effect.try({
      try: () => assertPathWithin(realRoot, realCurrent),
      catch: containmentRejection,
    });
  }
});
