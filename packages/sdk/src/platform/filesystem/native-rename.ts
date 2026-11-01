import { createRequire } from "node:module";
import * as path from "node:path";
import { getSystemErrorName } from "node:util";

type Rename = (source: string, destination: string) => Promise<void>;
let binding: Rename | undefined;
const requireNative = createRequire(__filename);

function loadRename(): Rename {
  const koffi: typeof import("koffi") = requireNative("koffi");
  const library = koffi.load(
    process.platform === "win32" ? "kernel32.dll" : null,
  );
  const windowsErrors: Record<number, string> = {
    2: "ENOENT",
    3: "ENOENT",
    5: "EACCES",
    17: "EXDEV",
    32: "EBUSY",
    80: "EEXIST",
    87: "EINVAL",
    123: "EINVAL",
    145: "ENOTEMPTY",
    183: "EEXIST",
    206: "ENAMETOOLONG",
  };
  const getLastError =
    process.platform === "win32"
      ? library.func("uint32_t __stdcall GetLastError()")
      : undefined;
  const native =
    process.platform === "linux"
      ? library.func(
          "int renameat2(int olddirfd, const char *oldpath, int newdirfd, const char *newpath, unsigned int flags)",
        )
      : process.platform === "darwin"
        ? library.func(
            "int renamex_np(const char *oldpath, const char *newpath, unsigned int flags)",
          )
        : process.platform === "win32"
          ? library.func(
              "int __stdcall MoveFileExW(const char16_t *oldpath, const char16_t *newpath, uint32_t flags)",
            )
          : undefined;
  if (!native) {
    throw Object.assign(
      new Error("Exclusive rename is unsupported on this platform"),
      {
        code: "ENOSYS",
      },
    );
  }
  return (source, destination) =>
    new Promise<void>((resolve, reject) => {
      const done = (error: unknown, result: number) => {
        if (error) return reject(error);
        if (process.platform === "win32" ? result !== 0 : result === 0)
          return resolve();
        // Koffi restores the worker's errno / last-error for this callback.
        const errno = getLastError ? getLastError() : koffi.errno();
        const code = getLastError
          ? (windowsErrors[errno] ?? `WIN32_${errno}`)
          : getSystemErrorName(-errno);
        reject(
          Object.assign(
            new Error(`${code}: cannot rename '${source}' to '${destination}'`),
            {
              code,
              errno,
              syscall: "rename",
              path: source,
              dest: destination,
            },
          ),
        );
      };
      switch (process.platform) {
        case "linux":
          // AT_FDCWD, RENAME_NOREPLACE
          native.async(-100, source, -100, destination, 1, done);
          break;
        case "darwin":
          // RENAME_EXCL
          native.async(source, destination, 4, done);
          break;
        case "win32":
          // No replacement and no cross-volume copy fallback.
          native.async(
            path.toNamespacedPath(source),
            path.toNamespacedPath(destination),
            0,
            done,
          );
          break;
      }
    });
}

/** Rename the entry itself, refusing an existing destination or another filesystem. */
export async function renameNoReplace(
  source: string,
  destination: string,
): Promise<void> {
  if (source.includes("\0") || destination.includes("\0")) {
    throw Object.assign(
      new Error("Filesystem paths cannot contain null bytes"),
      { code: "EINVAL" },
    );
  }
  if (!binding) binding = loadRename();
  return binding(source, destination);
}
