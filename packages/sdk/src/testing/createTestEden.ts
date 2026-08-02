import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { EdenConfig } from "@edenapp/types";
import type { CommandCallerContext } from "../execution";
import { CommandRegistry, PermissionRegistry } from "../ipc";
import { EdenRuntime, type EdenRuntimePaths } from "../runtime/EdenRuntime";
import {
  InMemoryPlatform,
  type InMemoryPlatformOptions,
} from "./InMemoryPlatform";

export interface CreateTestEdenOptions {
  autoStart?: boolean;
  config?: EdenConfig;
  platform?: InMemoryPlatformOptions;
  root?: string;
}

export interface TestEden {
  readonly runtime: EdenRuntime;
  readonly platform: InMemoryPlatform;
  readonly paths: EdenRuntimePaths & { root: string };
  start(): Promise<void>;
  execute<TResult = unknown>(
    command: string,
    args?: unknown,
    caller?: CommandCallerContext,
  ): Promise<TResult>;
  dispose(): Promise<void>;
}

/**
 * Internal integration harness. It substitutes only the Electron platform
 * edge; all Eden managers, handlers, permissions, persistence, and filesystem
 * behavior are the production implementations.
 */
export async function createTestEden(
  options: CreateTestEdenOptions = {},
): Promise<TestEden> {
  const ownsRoot = options.root === undefined;
  const root =
    options.root ?? (await fs.mkdtemp(path.join(os.tmpdir(), "eden-runtime-")));
  const paths: TestEden["paths"] = {
    root,
    appsDirectory: path.join(root, "apps"),
    userDirectory: path.join(root, "users"),
    distPath: path.join(root, "dist"),
    appPath: root,
  };
  await Promise.all([
    fs.mkdir(paths.appsDirectory, { recursive: true }),
    fs.mkdir(paths.userDirectory, { recursive: true }),
    fs.mkdir(paths.distPath, { recursive: true }),
  ]);

  const platform = new InMemoryPlatform(root, options.platform);
  const runtime = new EdenRuntime({
    config: { loginAppId: "", ...options.config },
    paths,
    platform,
  });
  let cleanupPromise: Promise<void> | undefined;

  const harness: TestEden = {
    runtime,
    platform,
    paths,
    start: () => runtime.start(),
    execute: <TResult>(
      command: string,
      args: unknown = {},
      caller: CommandCallerContext = {},
    ) =>
      runtime.resolve(CommandRegistry).execute<TResult>(command, args, caller),
    dispose: () => {
      cleanupPromise ??= (async () => {
        await runtime.dispose();
        if (ownsRoot) {
          await fs.rm(root, { recursive: true, force: true });
        }
      })();
      return cleanupPromise;
    },
  };

  // Resolve it here so tests can register callers before or after startup and
  // so the registry's lifetime is always owned by the runtime.
  runtime.resolve(PermissionRegistry);

  try {
    if (options.autoStart !== false) await harness.start();
    return harness;
  } catch (error) {
    await harness.dispose();
    throw error;
  }
}
