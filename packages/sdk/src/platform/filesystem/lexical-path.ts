import * as path from "node:path";

/** Lexical containment only; callers own existence and symlink resolution. */
export function isPathWithin(
  rootPath: string,
  targetPath: string,
  { allowRoot = true }: { allowRoot?: boolean } = {},
): boolean {
  const relative = path.relative(rootPath, targetPath);
  return (
    (allowRoot || relative !== "") &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}
