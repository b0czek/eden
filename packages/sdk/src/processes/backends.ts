import * as path from "node:path";
import type { AppManifest, FilesystemLocation } from "@edenapp/types";
import * as Effect from "effect/Effect";
import { asError } from "../effects/io";
import { scopedEvent } from "../events/scoped";

import { log } from "../logging";
import type { DlcResources } from "../packages/dlc-resources";
import {
  type PlatformMessagePort,
  type PlatformUtilityProcess,
  type UtilityProcessPort,
} from "../platform/ports";
import { encodeLaunchContext } from "../utils/app-launch-context";
export interface BackendsDependencies {
  distPath: string;
  utilityProcesses: UtilityProcessPort;
  dlcResources: Pick<DlcResources, "createBackendBinding" | "revokeBackend">;
}
export const createBackends = Effect.fn(function* ({
  distPath,
  utilityProcesses,
  dlcResources,
}: BackendsDependencies) {
  const backendExit = yield* scopedEvent<{ appId: string; code: number }>();
  const backendError = yield* scopedEvent<{ appId: string; error: unknown }>();
  const backendMessage = yield* scopedEvent<{
    appId: string;
    message: unknown;
  }>();
  let _backends: Map<string, PlatformUtilityProcess> = new Map();
  let _backendData: Map<
    string,
    { manifest: AppManifest; installPath: string }
  > = new Map();
  let _distPath: string;
  let _backendPorts: Map<string, PlatformMessagePort> = new Map();
  const _utilityProcesses = utilityProcesses;
  const _dlcResources = dlcResources;

  _distPath = distPath;

  function getMessageType(message: unknown): string | undefined {
    if (message && typeof message === "object" && "type" in message) {
      const type = (message as { type?: unknown }).type;
      return typeof type === "string" ? type : undefined;
    }

    return undefined;
  }

  const createBackend = Effect.fn(function* (
    appId: string,
    manifest: AppManifest,
    installPath: string,
    launchArgs?: string[],
    launchFile?: FilesystemLocation,
  ) {
    const backend = yield* Effect.try({
      try: () => {
        if (_backends.has(appId))
          throw new Error(`Backend for app ${appId} already exists`);
        const entry = manifest.backend?.entry;
        if (!entry) throw new Error(`App ${appId} does not have a backend`);
        const binding = _dlcResources.createBackendBinding(appId);
        const backend = _utilityProcesses.fork(
          path.join(distPath, "app-runtime/backend-preload.js"),
          encodeLaunchContext({
            appId,
            args: launchArgs ?? [],
            file: launchFile,
          }),
          {
            serviceName: `eden-backend-${appId}`,
            stdio: ["ignore", "pipe", "pipe"],
            env: {
              ...process.env,
              EDEN_BACKEND_ENTRY: path.join(installPath, entry),
              EDEN_INSTALL_PATH: installPath,
              EDEN_MANIFEST: JSON.stringify(manifest),
              EDEN_DLC_BINDING: JSON.stringify(binding),
            },
          },
        );
        pipeBackendOutput(backend);
        if (manifest.frontend?.entry) {
          const { port1, port2 } = _utilityProcesses.createMessageChannel();
          backend.postMessage({ type: "init-port" }, [port1]);
          _backendPorts.set(appId, port2);
        }
        backend.on("message", (message: unknown) =>
          handleBackendMessage(appId, message),
        );
        backend.on("exit", (code) => {
          _backends.delete(appId);
          _backendData.delete(appId);
          _backendPorts.get(appId)?.close();
          _backendPorts.delete(appId);
          _dlcResources.revokeBackend(appId);
          backendExit.emit({ appId, code });
        });
        _backends.set(appId, backend);
        _backendData.set(appId, { manifest, installPath });
        return backend;
      },
      catch: asError,
    });
    yield* Effect.callback<void, Error>((resume) => {
      let completed = false;
      function finish(error?: Error) {
        if (completed) return;
        completed = true;
        cleanup();
        resume(error ? Effect.fail(error) : Effect.void);
      }
      const onMessage = (message: unknown) => {
        const type = getMessageType(message);
        if (type === "backend-ready") finish();
        else if (type === "backend-error")
          finish(
            new Error(
              message &&
                typeof message === "object" &&
                "error" in message &&
                typeof message.error === "string"
                ? message.error
                : "Unknown backend startup error",
            ),
          );
      };
      const onExit = (code: number) =>
        finish(
          new Error(`Backend ${appId} exited before becoming ready (${code})`),
        );
      backend.on("message", onMessage);
      backend.once("exit", onExit);
      function cleanup() {
        backend.removeListener("message", onMessage);
        backend.removeListener("exit", onExit);
      }
      return Effect.sync(cleanup);
    }).pipe(
      Effect.timeoutOrElse({
        duration: "10 seconds",
        orElse: () =>
          Effect.fail(
            new Error(`Backend ${appId} startup timed out after 10 seconds`),
          ),
      }),
      Effect.onError(() =>
        Effect.sync(() => {
          _backends.delete(appId);
          _backendData.delete(appId);
          _backendPorts.get(appId)?.close();
          _backendPorts.delete(appId);
          _dlcResources.revokeBackend(appId);
          backend.kill();
        }),
      ),
    );
    log.info(`Backend started for app ${appId}`);
    return { backend };
  });

  function sendMessage(appId: string, message: unknown): boolean {
    const backend = _backends.get(appId);
    if (!backend) {
      log.warn(`No backend found for app ${appId}`);
      return false;
    }

    try {
      log.debug(
        `Sending message to backend ${appId}:`,
        getMessageType(message) ?? "unknown",
      );
      backend.postMessage(message);
      return true;
    } catch (error) {
      log.error(`Failed to send message to backend ${appId}:`, error);
      return false;
    }
  }

  function sendPortToBackend(
    appId: string,
    message: unknown,
    ports: PlatformMessagePort[],
  ): boolean {
    const backend = _backends.get(appId);
    if (!backend) {
      _dlcResources.revokeBackend(appId);
      log.warn(`No backend found for app ${appId}`);
      return false;
    }

    try {
      log.info(
        `Sending message with ${ports.length} ports to backend ${appId}:`,
        getMessageType(message) ?? "unknown",
      );
      backend.postMessage(message, ports);
      return true;
    } catch (error) {
      log.error(
        `Failed to send message with ports to backend ${appId}:`,
        error,
      );
      return false;
    }
  }

  function getFrontendPort(appId: string): PlatformMessagePort | undefined {
    return _backendPorts.get(appId);
  }

  const terminateBackend = Effect.fn(function* (appId: string) {
    const candidate = _backends.get(appId);
    if (!candidate) return;
    const backend = candidate;
    yield* Effect.scoped(
      Effect.gen(function* () {
        yield* Effect.forkScoped(
          Effect.sleep("500 millis").pipe(
            Effect.andThen(
              Effect.sync(() => {
                if (_backends.get(appId) === backend) backend.kill();
              }),
            ),
          ),
        );
        yield* Effect.callback<void, Error>((resume) => {
          const onExit = () => resume(Effect.void);
          backend.once("exit", onExit);
          try {
            backend.postMessage({ type: "shutdown" });
          } catch (error) {
            backend.removeListener("exit", onExit);
            resume(Effect.fail(asError(error)));
          }
          return Effect.sync(() => backend.removeListener("exit", onExit));
        }).pipe(
          Effect.timeoutOrElse({
            duration: "5 seconds",
            orElse: () =>
              Effect.fail(
                new Error(
                  `Backend ${appId} termination timed out after 5 seconds`,
                ),
              ),
          }),
        );
      }),
    ).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          _backends.delete(appId);
          _backendData.delete(appId);
          _backendPorts.get(appId)?.close();
          _backendPorts.delete(appId);
          _dlcResources.revokeBackend(appId);
        }),
      ),
    );
  });

  function getBackend(appId: string): PlatformUtilityProcess | undefined {
    return _backends.get(appId);
  }

  function hasBackend(appId: string): boolean {
    return _backends.has(appId);
  }

  function getRunningBackends(): string[] {
    return Array.from(_backends.keys());
  }

  function handleBackendMessage(appId: string, message: unknown): void {
    // Emit event for IPC bridge to handle
    backendMessage.emit({
      appId,
      message,
    });
  }

  function pipeBackendOutput(backend: PlatformUtilityProcess): void {
    backend.stdout?.on("data", (chunk: Buffer | string) => {
      process.stdout.write(chunk);
    });

    backend.stderr?.on("data", (chunk: Buffer | string) => {
      process.stderr.write(chunk);
    });
  }

  const terminateAll = () =>
    Effect.forEach([..._backends.keys()], terminateBackend, {
      concurrency: "unbounded",
      discard: true,
    });
  const dispose = () =>
    terminateAll().pipe(
      Effect.ensuring(
        Effect.sync(() => {
          for (const port of _backendPorts.values()) port.close();
          _backendPorts.clear();
          _backendData.clear();
          _backends.clear();
        }),
      ),
    );
  yield* Effect.addFinalizer(() =>
    dispose().pipe(
      Effect.catch((error) =>
        Effect.sync(() => log.error("Failed to terminate backends:", error)),
      ),
    ),
  );
  return {
    backendExit,
    backendError,
    backendMessage,
    createBackend,
    sendMessage,
    sendPortToBackend,
    getFrontendPort,
    terminateBackend,
    getBackend,
    hasBackend,
    getRunningBackends,
    terminateAll,
  };
});
export type Backends = Effect.Success<ReturnType<typeof createBackends>>;
