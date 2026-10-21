import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { OperationHandle, OperationSubmission } from "@edenapp/types";
import type { EdenConfig } from "../../src/api/config";
import type { CommandCallerContext } from "../../src/execution";
import {
  createEdenRuntime,
  type EdenRuntime,
  type EdenRuntimePaths,
} from "../../src/runtime/runtime";
import type { ViewInfo } from "../../src/views/types";
import {
  InMemoryPlatform,
  type InMemoryPlatformOptions,
  type InMemoryUtilityProcess,
} from "./InMemoryPlatform";

export interface CreateTestEdenOptions {
  autoStart?: boolean;
  config?: EdenConfig;
  platform?: InMemoryPlatformOptions;
  root?: string;
}

export interface ExecuteFromViewOptions {
  submission?: OperationSubmission;
  waitForCompletion?: boolean;
}

export interface TestEden {
  readonly runtime: EdenRuntime;
  readonly platform: InMemoryPlatform;
  readonly paths: EdenRuntimePaths & { root: string };
  start(): Promise<void>;
  getAppView(appId: string): ViewInfo;
  getBackendProcess(appId: string): InMemoryUtilityProcess;
  /** Operation commands return their handle unless waitForCompletion is enabled. */
  executeFromView<TResult = unknown>(
    webContentsId: number,
    command: string,
    args?: unknown,
    options?: ExecuteFromViewOptions,
  ): Promise<TResult>;
  execute<TResult = unknown>(
    command: string,
    args?: unknown,
    caller?: CommandCallerContext,
  ): Promise<TResult>;
  /** Submit and explicitly await completion when exercising completed effects. */
  complete<TResult = unknown>(
    command: string,
    args?: unknown,
    caller?: CommandCallerContext,
  ): Promise<TResult>;
  dispose(): Promise<void>;
}

/**
 * Internal integration harness. It substitutes only the Electron platform
 * edge; all Eden services, handlers, permissions, persistence, and filesystem
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
  const runtime = createEdenRuntime({
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
    getAppView: (appId) => {
      const instance = runtime.services.processes.getAppInstance(appId);
      assert(instance, `App instance is missing: ${appId}`);
      const view = runtime.services.views.getViewInfo(instance.viewId);
      assert(view, `App view is missing: ${appId} (view ${instance.viewId})`);
      return view;
    },
    getBackendProcess: (appId) => {
      const backend = runtime.services.backends.getBackend(appId);
      assert(backend?.pid !== undefined, `Backend has no process: ${appId}`);
      const process = platform.utilityProcesses.get(backend.pid);
      assert(
        process,
        `Backend process is missing: ${appId} (pid ${backend.pid})`,
      );
      return process;
    },
    executeFromView: async <TResult>(
      webContentsId: number,
      command: string,
      args: unknown = {},
      options: ExecuteFromViewOptions = {},
    ) => {
      // Keep the submitting identity even if the operation closes its view or session.
      const appId =
        runtime.services.views.getAppIdByWebContentsId(webContentsId);
      const owner = appId
        ? runtime.services.runtimeContexts.get(appId)?.owner
        : undefined;
      const caller = {
        appId,
        sessionId:
          owner?.kind === "system"
            ? "runtime"
            : (owner?.sessionId ??
              runtime.services.sessionContext.getSessionId()),
      };
      const response = (await platform.rendererIpc.invoke(
        "shell-command",
        webContentsId,
        command,
        args,
        options.submission,
      )) as
        | { mode: "result"; result: TResult }
        | { mode: "operation"; handle: OperationHandle };
      if (response.mode === "result") return response.result;
      return (
        options.waitForCompletion
          ? await runtime.effects.run(
              runtime.services.operations.wait(response.handle, caller),
            )
          : response.handle
      ) as TResult;
    },
    execute: <TResult>(
      command: string,
      args: unknown = {},
      caller: CommandCallerContext = {},
    ) =>
      runtime.effects.run(
        runtime.services.commands.execute<TResult>(command, args, caller),
      ),
    complete: async <TResult>(
      command: string,
      args: unknown = {},
      caller: CommandCallerContext = {},
    ) => {
      const context = {
        ...caller,
        sessionId:
          caller.sessionId ?? runtime.services.sessionContext.getSessionId(),
      };
      const registry = runtime.services.commands;
      const result = await runtime.effects.run(
        registry.execute(command, args, context),
      );
      return (
        registry.getMode(command) === "operation"
          ? await runtime.effects.run(
              runtime.services.operations.wait(
                result as OperationHandle,
                context,
              ),
            )
          : result
      ) as TResult;
    },
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

  try {
    if (options.autoStart !== false) await harness.start();
    return harness;
  } catch (error) {
    await harness.dispose();
    throw error;
  }
}
