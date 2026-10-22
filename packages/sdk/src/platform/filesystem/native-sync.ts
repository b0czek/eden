import {
  existsSync,
  type MakeDirectoryOptions,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { nativeFailure } from "./native-errors";

function synchronous<A>(operation: string, run: () => A): A {
  try {
    return run();
  } catch (cause) {
    throw nativeFailure(operation, cause);
  }
}

/** Synchronous module hooks and pre-runtime setup have no Effect dependency. */
export const syncIo = {
  realpath: (hostPath: string) =>
    synchronous("realpath", () => realpathSync(hostPath)),
  stat: (hostPath: string) => synchronous("stat", () => statSync(hostPath)),
  readFile: (hostPath: string) =>
    synchronous("readFile", () => readFileSync(hostPath)),
  mkdir: (
    hostPath: string,
    options: MakeDirectoryOptions = { recursive: true },
  ) =>
    synchronous("mkdir", () => {
      mkdirSync(hostPath, options);
    }),
  exists: (hostPath: string) => existsSync(hostPath),
};
