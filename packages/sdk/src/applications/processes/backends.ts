import * as path from "node:path";
import type { AppManifest, FilesystemLocation } from "@edenapp/types";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";
import { asError } from "../../core/effects/io";
import type { Event } from "../../core/events/event";
import { scopedEvent } from "../../core/events/scoped";
import { encodeLaunchContext } from "../../core/utils/app-launch-context";
import { log } from "../../platform/logging/logger";
import {
  type PlatformMessagePort,
  type PlatformUtilityProcess,
  UtilityProcessPort,
} from "../../platform/ports/types";

import { DistPath } from "../../runtime/inputs";
import { DlcResources } from "../packages/dlc-resources";
import {
  type BackendCreateError,
  BackendIoFailed,
  BackendRejected,
  BackendStartupFailed,
  type BackendTerminateError,
  BackendTerminationTimedOut,
} from "./errors";

export interface Backends {
  backendExit: Event<{
    appId: string;
    backend: PlatformUtilityProcess;
    code: number;
  }>;
  backendError: Event<{ appId: string; error: unknown }>;
  backendMessage: Event<{ appId: string; message: unknown }>;
  // @eden-effect-next-line unresolved-requirements -- Backend acquisition belongs to the caller-owned app instance scope.
  createBackend: (
    appId: string,
    manifest: AppManifest,
    installPath: string,
    launchArgs?: string[] | undefined,
    launchFile?: FilesystemLocation | undefined,
  ) => Effect.Effect<
    { backend: PlatformUtilityProcess },
    BackendCreateError,
    Scope.Scope
  >;
  sendMessage: (appId: string, message: unknown) => boolean;
  sendPortToBackend: (
    appId: string,
    message: unknown,
    ports: PlatformMessagePort[],
  ) => boolean;
  getFrontendPort: (appId: string) => PlatformMessagePort | undefined;
  terminateBackend: (
    appId: string,
    expected?: PlatformUtilityProcess,
    force?: boolean,
  ) => Effect.Effect<void, BackendTerminateError>;
  getBackend: (appId: string) => PlatformUtilityProcess | undefined;
  hasBackend: (appId: string) => boolean;
  getRunningBackends: () => string[];
  terminateAll: () => Effect.Effect<void, BackendTerminateError>;
}

export const Backends = Context.Service<"eden/Backends", Backends>(
  "eden/Backends",
);

export const BackendsLive = Layer.effect(
  Backends,
  Effect.gen(function* () {
    const distPath = yield* DistPath;
    const utilityProcesses = yield* UtilityProcessPort;
    const dlcResources = yield* DlcResources;
    const backendExit = yield* scopedEvent<{
      appId: string;
      backend: PlatformUtilityProcess;
      code: number;
    }>();
    const backendError = yield* scopedEvent<{
      appId: string;
      error: unknown;
    }>();
    const backendMessage = yield* scopedEvent<{
      appId: string;
      message: unknown;
    }>();
    const _backends: Map<string, PlatformUtilityProcess> = new Map();
    const _backendPorts: Map<string, PlatformMessagePort> = new Map();
    const _utilityProcesses = utilityProcesses;
    const _dlcResources = dlcResources;

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
      if (_backends.has(appId))
        return yield* Effect.fail(
          new BackendRejected({
            appId,
            reason: "already-running",
            message: `Backend for app ${appId} already exists`,
          }),
        );
      if (!manifest.backend?.entry)
        return yield* Effect.fail(
          new BackendRejected({
            appId,
            reason: "missing-entry",
            message: `App ${appId} does not have a backend`,
          }),
        );
      const entry = manifest.backend.entry;
      const backend = yield* Effect.acquireRelease(
        Effect.try({
          try: () => {
            const binding = _dlcResources.createBackendBinding(appId);
            let backend: PlatformUtilityProcess;
            try {
              backend = _utilityProcesses.fork(
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
            } catch (error) {
              _dlcResources.revokeBackend(appId);
              throw error;
            }
            backend.on("exit", (code) => {
              if (_backends.get(appId) !== backend) return;
              releaseBackend(appId, backend);
              backendExit.emit({ appId, backend, code });
            });
            _backends.set(appId, backend);
            return backend;
          },
          catch: (cause) =>
            new BackendIoFailed({
              appId,
              operation: "spawn",
              cause,
              message: `Failed to spawn backend ${appId}: ${asError(cause).message}`,
            }),
        }),
        (backend) => terminateBackend(appId, backend).pipe(Effect.orDie),
      );
      yield* Effect.try({
        try: () => {
          pipeBackendOutput(backend);
          if (manifest.frontend?.entry) {
            const { port1, port2 } = _utilityProcesses.createMessageChannel();
            _backendPorts.set(appId, port2);
            backend.postMessage({ type: "init-port" }, [port1]);
          }
          backend.on("message", (message: unknown) => {
            if (_backends.get(appId) === backend)
              handleBackendMessage(appId, message);
          });
        },
        catch: (cause) =>
          new BackendIoFailed({
            appId,
            operation: "connect",
            cause,
            message: `Failed to connect backend ${appId}: ${asError(cause).message}`,
          }),
      });
      yield* Effect.callback<void, BackendStartupFailed>((resume) => {
        let completed = false;
        function finish(error?: BackendStartupFailed) {
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
              new BackendStartupFailed({
                appId,
                reason: "reported-error",
                message:
                  message &&
                  typeof message === "object" &&
                  "error" in message &&
                  typeof message.error === "string"
                    ? message.error
                    : "Unknown backend startup error",
              }),
            );
        };
        const onExit = (code: number) =>
          finish(
            new BackendStartupFailed({
              appId,
              reason: "exited",
              code,
              message: `Backend ${appId} exited before becoming ready (${code})`,
            }),
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
          duration: Duration.seconds(10),
          orElse: () =>
            Effect.fail(
              new BackendStartupFailed({
                appId,
                reason: "timeout",
                message: `Backend ${appId} startup timed out after 10 seconds`,
              }),
            ),
        }),
        Effect.onError(() =>
          terminateBackend(appId, backend, true).pipe(Effect.orDie),
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

    function releaseBackend(appId: string, backend: PlatformUtilityProcess) {
      if (_backends.get(appId) !== backend) return;
      _backends.delete(appId);
      _backendPorts.get(appId)?.close();
      _backendPorts.delete(appId);
      _dlcResources.revokeBackend(appId);
    }

    const terminateBackend = Effect.fn(function* (
      appId: string,
      expected: PlatformUtilityProcess | undefined = _backends.get(appId),
      force: boolean = false,
    ) {
      const candidate = _backends.get(appId);
      if (!candidate || candidate !== expected) return;
      const backend = candidate;
      yield* Effect.uninterruptible(
        Effect.scoped(
          Effect.gen(function* () {
            yield* Effect.forkScoped(
              Effect.sleep(Duration.millis(500)).pipe(
                Effect.andThen(
                  Effect.sync(() => {
                    if (_backends.get(appId) === backend) backend.kill();
                  }),
                ),
              ),
            );
            yield* Effect.callback<void, BackendIoFailed>((resume) => {
              let channelError: BackendIoFailed | undefined;
              const onExit = () =>
                resume(channelError ? Effect.fail(channelError) : Effect.void);
              backend.once("exit", onExit);
              try {
                if (force) backend.kill();
                else backend.postMessage({ type: "shutdown" });
              } catch (error) {
                channelError = new BackendIoFailed({
                  appId,
                  operation: "terminate",
                  cause: error,
                  message: `Failed to shut down backend ${appId}: ${asError(error).message}`,
                });
                backend.kill();
              }
              return Effect.sync(() => backend.removeListener("exit", onExit));
            }).pipe(
              Effect.timeoutOrElse({
                duration: Duration.seconds(5),
                orElse: () =>
                  Effect.fail(
                    new BackendTerminationTimedOut({
                      appId,
                      message: `Backend ${appId} termination timed out after 5 seconds`,
                    }),
                  ),
              }),
            );
          }),
        ),
      ).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            releaseBackend(appId, backend);
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
      Effect.forEach(
        [..._backends.keys()],
        (appId) => terminateBackend(appId),
        {
          concurrency: "unbounded",
          discard: true,
        },
      );
    const dispose = () =>
      terminateAll().pipe(
        Effect.ensuring(
          Effect.sync(() => {
            for (const port of _backendPorts.values()) port.close();
            _backendPorts.clear();
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
  }),
);
