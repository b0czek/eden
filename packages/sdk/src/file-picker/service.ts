import type {
  FilePickerOpenArgs,
  FilePickerOpenEvent,
  FilePickerResult,
} from "@edenapp/types";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import type * as Fiber from "effect/Fiber";
import * as FiberSet from "effect/FiberSet";
import * as Layer from "effect/Layer";
import * as v from "valibot";
import { AppAssociations } from "../app-associations/service";
import type { TargetedNotification } from "../controllers/events";
import type { Event } from "../events/event";
import { listen, scopedEvent } from "../events/scoped";
import { FilesystemAccessDenied } from "../filesystem/errors";
import { filesystemLocationSchema } from "../filesystem/location-schema";
import { VolumeUnavailable } from "../filesystem/volumes/errors";
import { Volumes } from "../filesystem/volumes/service";
import { Permissions } from "../ipc/permissions";
import { log } from "../logging/logger";
import { createPickerDisplayProvider } from "./display-provider";
import {
  type FilePickerOpenError,
  FilePickerProviderRejected,
  FilePickerProviderUnavailable,
  FilePickerRequestRejected,
  type FilePickerResolveError,
} from "./errors";
import {
  FilePickerFiles,
  FilePickerNotifications,
  FilePickerProcesses,
  FilePickerViews,
} from "./ports";
import type { FilePickerCaller, FilePickerRequest } from "./types";

export interface FilePicker {
  registerDisplayProvider: (
    caller: FilePickerCaller,
  ) => Effect.Effect<{ success: boolean }, FilePickerProviderRejected>;
  openPicker: (
    args: FilePickerOpenArgs,
    caller?: FilePickerCaller,
  ) => Effect.Effect<{ requestId: string }, FilePickerOpenError>;
  resolvePicker: (
    result: FilePickerResult,
    caller?: FilePickerCaller,
  ) => Effect.Effect<{ success: boolean }, FilePickerResolveError>;
  closePicker: (
    requestId: string | undefined,
    caller?: FilePickerCaller,
  ) => Effect.Effect<{ success: boolean }, FilePickerRequestRejected>;
  opened: Event<TargetedNotification<{ picker: FilePickerOpenEvent }>>;
  closed: Event<TargetedNotification<FilePickerResult>>;
}

export const FilePicker = Context.Service<"eden/FilePicker", FilePicker>(
  "eden/FilePicker",
);

// Only documented synchronous domain rejections enter the failure channel.
function check<A, E extends Error>(
  work: () => A,
  expected: (cause: unknown) => cause is E,
) {
  return Effect.try({ try: work, catch: (cause) => cause }).pipe(
    Effect.catch((cause) =>
      expected(cause) ? Effect.fail(cause) : Effect.die(cause),
    ),
  );
}

const requestRejection = (cause: unknown): cause is FilePickerRequestRejected =>
  cause instanceof FilePickerRequestRejected;
const selectionRejection = (cause: unknown): cause is FilePickerResolveError =>
  requestRejection(cause) || cause instanceof VolumeUnavailable;
const openRejection = (cause: unknown): cause is FilePickerOpenError =>
  selectionRejection(cause) ||
  cause instanceof FilePickerProviderUnavailable ||
  cause instanceof FilesystemAccessDenied;
const providerRejection = (
  cause: unknown,
): cause is FilePickerProviderRejected =>
  cause instanceof FilePickerProviderRejected;

export const FilePickerLive = Layer.effect(
  FilePicker,
  Effect.gen(function* () {
    const associations = yield* AppAssociations;
    const views = yield* FilePickerViews;
    const processes = yield* FilePickerProcesses;
    const files = yield* FilePickerFiles;
    const volumes = yield* Volumes;
    const permissions = yield* Permissions;
    const notifications = yield* FilePickerNotifications;
    let idCounter = 0;
    let activeRequest: FilePickerRequest | null = null;
    let idleStop: Fiber.Fiber<void> | undefined;
    let disposed = false;
    const providers = createPickerDisplayProvider(views);
    const opened =
      yield* scopedEvent<
        TargetedNotification<{ picker: FilePickerOpenEvent }>
      >();
    const closed = yield* scopedEvent<TargetedNotification<FilePickerResult>>();
    // Synchronous lifecycle callbacks can replace the delay; the scope still
    // owns any previous fiber finishing an uninterruptible stop.
    const forkIdleStop = yield* FiberSet.makeRuntime<never, void, never>();

    function cancelIdleStop() {
      const pending = idleStop;
      idleStop = undefined;
      pending?.interruptUnsafe();
    }

    function scheduleIdleStop() {
      cancelIdleStop();
      const provider = providers.get();
      if (!provider || disposed) return;
      idleStop = forkIdleStop(
        Effect.uninterruptibleMask((restore) =>
          Effect.gen(function* () {
            yield* restore(Effect.sleep(Duration.seconds(10)));
            if (
              disposed ||
              activeRequest ||
              providers.get() !== provider ||
              !processes.isRunning(provider.appId)
            )
              return;
            yield* Effect.match(processes.stop(provider.appId), {
              onFailure: (error) =>
                log.warn(
                  `Failed to stop idle file picker provider ${provider.appId}:`,
                  error,
                ),
              onSuccess: () => undefined,
            });
          }),
        ),
      );
    }

    function targets(openerViewId: number) {
      const provider = providers.get();
      return provider ? [provider.viewId, openerViewId] : [openerViewId];
    }

    function closeActiveRequest(reason: FilePickerResult["reason"]) {
      if (!activeRequest) return;
      const { requestId, opener } = activeRequest;
      activeRequest = null;
      closed.emit({
        payload: { requestId, reason },
        viewIds: targets(opener.viewId),
      });
      scheduleIdleStop();
    }

    function pruneStaleState() {
      if (providers.clearIfStale()) {
        cancelIdleStop();
        closeActiveRequest("close");
        return;
      }
      if (
        activeRequest &&
        views.get(activeRequest.opener.viewId)?.alive !== true
      )
        closeActiveRequest("close");
    }

    yield* listen(processes.stopped, ({ appId }) => {
      if (providers.clearIfAppStopped(appId)) {
        cancelIdleStop();
        closeActiveRequest("close");
      } else if (activeRequest?.opener.appId === appId)
        closeActiveRequest("close");
    });
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        disposed = true;
        closeActiveRequest("close");
        providers.dispose();
      }),
    );

    function registerDisplayProvider(caller: FilePickerCaller) {
      return check(() => {
        if (activeRequest) closeActiveRequest("close");
        const result = providers.register(caller);
        if (result.success) cancelIdleStop();
        return result;
      }, providerRejection);
    }

    function ensureDisplayProvider() {
      return Effect.gen(function* () {
        if (providers.get()) return;
        const matches = associations.resolve("provider:file-picker", (app) =>
          permissions.hasPermission(app.id, "file-picker/display"),
        );
        if (matches.length === 0)
          return yield* Effect.fail(
            new FilePickerProviderUnavailable({
              reason: "missing",
              message:
                "No file picker display provider is installed or permitted",
            }),
          );
        if (matches.length > 1)
          return yield* Effect.fail(
            new FilePickerProviderUnavailable({
              reason: "ambiguous",
              appIds: matches.map(({ appId }) => appId),
              message: `Multiple file picker display providers are available: ${matches.map((provider) => provider.appId).join(", ")}`,
            }),
          );
        const [provider] = matches;
        yield* processes.ensureRunning(provider.appId);
        yield* providers.waitFor(provider.appId);
      });
    }

    function openPicker(
      args: FilePickerOpenArgs,
      caller?: FilePickerCaller,
    ): Effect.Effect<{ requestId: string }, FilePickerOpenError> {
      return Effect.gen(function* () {
        yield* check(() => {
          if (disposed)
            throw new FilePickerRequestRejected({
              operation: "open",
              reason: "disposed",
              message: "File picker is disposed",
            });
          pruneStaleState();
          if (
            args.allowedVolumes &&
            (!Array.isArray(args.allowedVolumes) || !args.allowedVolumes.length)
          )
            throw new FilePickerRequestRejected({
              operation: "open",
              reason: "invalid-volumes",
              message: "File picker requires at least one allowed volume",
            });
          for (const id of args.allowedVolumes ?? []) volumes.get(id);
          if (args.initialLocation) {
            const location = args.initialLocation;
            if (
              typeof location.volume !== "string" ||
              typeof location.path !== "string"
            )
              throw new FilePickerRequestRejected({
                operation: "open",
                reason: "invalid-location",
                message: "Initial location requires volume and path",
              });
            volumes.get(location.volume);
            if (
              args.allowedVolumes &&
              !args.allowedVolumes.includes(location.volume)
            )
              throw new FilePickerRequestRejected({
                operation: "open",
                reason: "volume-not-allowed",
                message: "Initial volume is not allowed",
              });
          }
        }, openRejection);
        if (args.initialLocation)
          yield* files.resolvePath(args.initialLocation);
        const identity = yield* check(() => {
          if (!caller?.appId)
            throw new FilePickerRequestRejected({
              operation: "open",
              reason: "missing-caller",
              message: "Caller app ID is required to open file pickers",
            });
          const viewId = providers.resolveCallerViewId(caller.webContentsId);
          if (viewId === undefined)
            throw new FilePickerRequestRejected({
              operation: "open",
              reason: "missing-view",
              message: "File pickers can only be opened from a renderer view",
            });
          if (viewId === providers.get()?.viewId)
            throw new FilePickerRequestRejected({
              operation: "open",
              reason: "provider-caller",
              message: "Display provider cannot open file pickers",
            });
          return { appId: caller.appId, viewId };
        }, openRejection);
        yield* ensureDisplayProvider();
        if (activeRequest) {
          yield* notifications.busy(
            forceOpenPicker({ ...args }, { ...(caller ?? {}) }),
          );
          return yield* Effect.fail(
            new FilePickerRequestRejected({
              operation: "open",
              reason: "busy",
              requestId: activeRequest.requestId,
              message:
                "File picker is busy. Resolve the current file picker before opening another.",
            }),
          );
        }
        const request = yield* check(() => {
          const provider = providers.get();
          if (!provider)
            throw new FilePickerProviderUnavailable({
              reason: "unregistered",
              message: "File picker display provider is not registered",
            });
          const initialLocation =
            args.initialLocation ??
            files.accessScope(args.allowedVolumes?.[0] ?? "home");
          cancelIdleStop();
          const requestId = `file-picker-${Date.now()}-${++idCounter}`;
          activeRequest = {
            requestId,
            mode: args.mode,
            allowedVolumes: args.allowedVolumes
              ? [...args.allowedVolumes]
              : undefined,
            opener: identity,
          };
          const picker: FilePickerOpenEvent = {
            ...args,
            initialLocation,
            requestId,
            opener: { ...identity, bounds: views.get(identity.viewId)?.bounds },
          };
          opened.emit({
            payload: { picker },
            viewIds: targets(identity.viewId),
          });
          return { requestId, viewId: provider.viewId };
        }, openRejection);
        yield* views.reveal(request.viewId);
        log.info(`File picker opened (${request.requestId})`);
        return { requestId: request.requestId };
      });
    }

    function forceOpenPicker(
      args: FilePickerOpenArgs,
      caller: FilePickerCaller,
    ): Effect.Effect<{ requestId: string }, FilePickerOpenError> {
      return Effect.gen(function* () {
        yield* Effect.sync(() => {
          pruneStaleState();
          closeActiveRequest("close");
        });
        return yield* openPicker(args, caller);
      });
    }

    function resolvePicker(
      result: FilePickerResult,
      caller?: FilePickerCaller,
    ) {
      return check((): { success: boolean } => {
        if (!providers.isProvider(caller ?? {}))
          throw new FilePickerRequestRejected({
            operation: "resolve",
            requestId: result.requestId,
            reason: "unauthorized",
            message: "Only the display provider can resolve file pickers",
          });
        if (!activeRequest || activeRequest.requestId !== result.requestId)
          return { success: false };
        if (result.reason === "select") {
          if (!Array.isArray(result.locations) || !result.locations.length)
            throw new FilePickerRequestRejected({
              operation: "resolve",
              requestId: result.requestId,
              reason: "invalid-selection",
              message:
                "File picker selection requires a nonempty locations array",
            });
          for (const location of result.locations) {
            const parsed = v.safeParse(filesystemLocationSchema, location);
            if (!parsed.success)
              throw new FilePickerRequestRejected({
                operation: "resolve",
                requestId: result.requestId,
                reason: "invalid-selection",
                message: new v.ValiError(parsed.issues).message,
              });
            const volume = volumes.get(location.volume);
            if (volume.state !== "ready")
              throw new FilePickerRequestRejected({
                operation: "resolve",
                requestId: result.requestId,
                reason: "volume-removing",
                message: "Selected volume is being removed",
              });
            if (
              activeRequest.allowedVolumes &&
              !activeRequest.allowedVolumes.includes(location.volume)
            )
              throw new FilePickerRequestRejected({
                operation: "resolve",
                requestId: result.requestId,
                reason: "volume-not-allowed",
                message: "Selected volume is not allowed",
              });
            if (activeRequest.mode === "save" && volume.readOnly)
              throw new FilePickerRequestRejected({
                operation: "resolve",
                requestId: result.requestId,
                reason: "volume-read-only",
                message: "Selected volume is read-only",
              });
          }
        }
        const openerViewId = activeRequest.opener.viewId;
        activeRequest = null;
        closed.emit({ payload: result, viewIds: targets(openerViewId) });
        scheduleIdleStop();
        return { success: true };
      }, selectionRejection);
    }

    function closePicker(
      requestId: string | undefined,
      caller?: FilePickerCaller,
    ) {
      return check((): { success: boolean } => {
        pruneStaleState();
        if (!activeRequest) return { success: false };
        const targetId = requestId ?? activeRequest.requestId;
        if (targetId !== activeRequest.requestId) return { success: false };
        if (!caller?.appId)
          throw new FilePickerRequestRejected({
            operation: "close",
            requestId: targetId,
            reason: "missing-caller",
            message: "Caller app ID is required to close file pickers",
          });
        if (
          !providers.isProvider(caller) &&
          providers.resolveCallerViewId(caller.webContentsId) !==
            activeRequest.opener.viewId
        ) {
          log.warn(
            `File picker close denied for ${caller.appId} (request ${targetId})`,
          );
          throw new FilePickerRequestRejected({
            operation: "close",
            requestId: targetId,
            reason: "unauthorized",
            message: "Only the original opener can close this file picker",
          });
        }
        closeActiveRequest("close");
        return { success: true };
      }, requestRejection);
    }

    return {
      registerDisplayProvider,
      openPicker,
      resolvePicker,
      closePicker,
      opened,
      closed,
    };
  }),
);
