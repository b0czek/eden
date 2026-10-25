import * as path from "node:path";
import type { AppManifest, FilesystemLocation } from "@edenapp/types";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
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
  sendMessage: (
    appId: string,
    message: unknown,
    ports?: PlatformMessagePort[],
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

interface BackendRecord {
  backend: PlatformUtilityProcess;
  exited: Deferred.Deferred<number>;
  frontendPort?: PlatformMessagePort;
  cleanup(): void;
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
    const backendMessage = yield* scopedEvent<{
      appId: string;
      message: unknown;
    }>();
    const backends = new Map<string, BackendRecord>();

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
      if (backends.has(appId))
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
      const startup = yield* Deferred.make<void, BackendStartupFailed>();
      const record = yield* Effect.acquireRelease(
        Effect.try({
          try: () => {
            const binding = dlcResources.createBackendBinding(appId);
            let backend: PlatformUtilityProcess;
            try {
              backend = utilityProcesses.fork(
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
              dlcResources.revokeBackend(appId);
              throw error;
            }
            const record: BackendRecord = {
              backend,
              exited: Deferred.makeUnsafe<number>(),
              cleanup,
            };
            // Native events can arrive at the first Effect yield after fork.
            // Install both listeners here and retain the first startup result.
            const onMessage = (message: unknown) => {
              if (backends.get(appId) !== record) return;
              const type = getMessageType(message);
              if (type === "backend-ready")
                Deferred.doneUnsafe(startup, Effect.void);
              else if (type === "backend-error")
                Deferred.doneUnsafe(
                  startup,
                  Effect.fail(
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
                  ),
                );
              backendMessage.emit({ appId, message });
            };
            const onExit = (code: number) => {
              if (backends.get(appId) !== record) return;
              Deferred.doneUnsafe(record.exited, Effect.succeed(code));
              Deferred.doneUnsafe(
                startup,
                Effect.fail(
                  new BackendStartupFailed({
                    appId,
                    reason: "exited",
                    code,
                    message: `Backend ${appId} exited before becoming ready (${code})`,
                  }),
                ),
              );
              releaseBackend(appId, record);
              backendExit.emit({ appId, backend, code });
            };
            function cleanup() {
              backend.removeListener("message", onMessage);
              backend.removeListener("exit", onExit);
            }
            backends.set(appId, record);
            backend.on("message", onMessage);
            backend.on("exit", onExit);
            return record;
          },
          catch: (cause) =>
            new BackendIoFailed({
              appId,
              operation: "spawn",
              cause,
              message: `Failed to spawn backend ${appId}: ${asError(cause).message}`,
            }),
        }),
        ({ backend }) => terminateBackend(appId, backend).pipe(Effect.orDie),
      );
      const { backend } = record;
      yield* Effect.try({
        try: () => {
          if (backends.get(appId) !== record) return;
          pipeBackendOutput(backend);
          if (manifest.frontend?.entry) {
            const { port1, port2 } = utilityProcesses.createMessageChannel();
            record.frontendPort = port2;
            backend.postMessage({ type: "init-port" }, [port1]);
          }
        },
        catch: (cause) =>
          new BackendIoFailed({
            appId,
            operation: "connect",
            cause,
            message: `Failed to connect backend ${appId}: ${asError(cause).message}`,
          }),
      });
      yield* Deferred.await(startup).pipe(
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

    function sendMessage(
      appId: string,
      message: unknown,
      ports?: PlatformMessagePort[],
    ): boolean {
      const backend = backends.get(appId)?.backend;
      if (!backend) {
        log.warn(`No backend found for app ${appId}`);
        return false;
      }
      try {
        log.debug(
          `Sending message to backend ${appId}:`,
          getMessageType(message) ?? "unknown",
        );
        backend.postMessage(message, ports);
        return true;
      } catch (error) {
        log.error(`Failed to send message to backend ${appId}:`, error);
        return false;
      }
    }

    function getFrontendPort(appId: string): PlatformMessagePort | undefined {
      return backends.get(appId)?.frontendPort;
    }

    function releaseBackend(appId: string, record: BackendRecord) {
      if (backends.get(appId) !== record) return;
      backends.delete(appId);
      record.cleanup();
      record.frontendPort?.close();
      dlcResources.revokeBackend(appId);
    }

    const terminateBackend = Effect.fn(function* (
      appId: string,
      expected: PlatformUtilityProcess | undefined = backends.get(
        appId,
      )?.backend,
      force: boolean = false,
    ) {
      const record = backends.get(appId);
      if (!record || record.backend !== expected) return;
      const { backend, exited } = record;
      yield* Effect.gen(function* () {
        const requested = yield* Effect.sync(() =>
          Result.try({
            try: () => {
              if (Deferred.isDoneUnsafe(exited)) return;
              if (force) backend.kill();
              else backend.postMessage({ type: "shutdown" });
            },
            catch: (cause) =>
              new BackendIoFailed({
                appId,
                operation: "terminate",
                cause,
                message: `Failed to shut down backend ${appId}: ${asError(cause).message}`,
              }),
          }),
        );
        if (Result.isFailure(requested))
          yield* Effect.sync(() => backend.kill());
        yield* Deferred.await(exited).pipe(
          Effect.timeoutOrElse({
            duration: Duration.millis(500),
            orElse: () =>
              Effect.sync(() => backend.kill()).pipe(
                Effect.andThen(Deferred.await(exited)),
              ),
          }),
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
        yield* Effect.fromResult(requested);
      }).pipe(
        Effect.ensuring(Effect.sync(() => releaseBackend(appId, record))),
        Effect.uninterruptible,
      );
    });

    function getBackend(appId: string): PlatformUtilityProcess | undefined {
      return backends.get(appId)?.backend;
    }

    function hasBackend(appId: string): boolean {
      return backends.has(appId);
    }

    function getRunningBackends(): string[] {
      return Array.from(backends.keys());
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
      Effect.forEach([...backends.keys()], (appId) => terminateBackend(appId), {
        concurrency: "unbounded",
        discard: true,
      });
    const dispose = () =>
      terminateAll().pipe(
        Effect.ensuring(
          Effect.sync(() => {
            for (const [appId, record] of backends)
              releaseBackend(appId, record);
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
      backendMessage,
      createBackend,
      sendMessage,
      getFrontendPort,
      terminateBackend,
      getBackend,
      hasBackend,
      getRunningBackends,
      terminateAll,
    };
  }),
);
