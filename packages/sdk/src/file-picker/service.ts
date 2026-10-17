import type {
  FilePickerOpenArgs,
  FilePickerOpenEvent,
  FilePickerResult,
} from "@edenapp/types";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import type * as Fiber from "effect/Fiber";
import * as FiberSet from "effect/FiberSet";
import * as v from "valibot";
import type { TargetedNotification } from "../controllers/events";
import { createEvent } from "../events/event";
import { filesystemLocationSchema } from "../filesystem/location-schema";
import { log } from "../logging";
import { createPickerDisplayProvider } from "./display-provider";
import type { FilePickerCaller, FilePickerDependencies } from "./ports";

interface Request {
  requestId: string;
  allowedVolumes?: string[];
  mode: "open" | "save";
  opener: { appId: string; viewId: number };
}

const asError = (error: unknown) =>
  error instanceof Error ? error : new Error(String(error));
const attempt = <A>(work: () => A) => Effect.try({ try: work, catch: asError });

export function createFilePicker({
  associations,
  views,
  processes,
  files,
  volumes,
  permissions,
  notifications,
}: FilePickerDependencies) {
  return Effect.gen(function* () {
    let idCounter = 0;
    let activeRequest: Request | null = null;
    let idleStop: Fiber.Fiber<void> | undefined;
    let disposed = false;
    const providers = createPickerDisplayProvider(views);
    const opened = yield* Effect.acquireRelease(
      Effect.sync(() =>
        createEvent<TargetedNotification<{ picker: FilePickerOpenEvent }>>(),
      ),
      (event) => Effect.sync(event.dispose),
    );
    const closed = yield* Effect.acquireRelease(
      Effect.sync(() => createEvent<TargetedNotification<FilePickerResult>>()),
      (event) => Effect.sync(event.dispose),
    );
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

    yield* Effect.acquireRelease(
      Effect.sync(() =>
        processes.stopped.on(({ appId }) => {
          if (providers.clearIfAppStopped(appId)) {
            cancelIdleStop();
            closeActiveRequest("close");
          } else if (activeRequest?.opener.appId === appId)
            closeActiveRequest("close");
        }),
      ),
      (stop) => Effect.sync(stop),
    );
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        disposed = true;
        closeActiveRequest("close");
        providers.dispose();
      }),
    );

    function registerDisplayProvider(caller: FilePickerCaller) {
      return attempt(() => {
        if (activeRequest) closeActiveRequest("close");
        const result = providers.register(caller);
        if (result.success) cancelIdleStop();
        return result;
      });
    }

    function ensureDisplayProvider() {
      return Effect.gen(function* () {
        if (providers.get()) return;
        const matches = yield* attempt(() =>
          associations.resolve("provider:file-picker", (app) =>
            permissions.hasPermission(app.id, "file-picker/display"),
          ),
        );
        if (matches.length === 0)
          return yield* Effect.fail(
            new Error(
              "No file picker display provider is installed or permitted",
            ),
          );
        if (matches.length > 1)
          return yield* Effect.fail(
            new Error(
              `Multiple file picker display providers are available: ${matches.map((provider) => provider.appId).join(", ")}`,
            ),
          );
        const [provider] = matches;
        yield* processes.ensureRunning(provider.appId);
        yield* providers.waitFor(provider.appId);
      });
    }

    function openPicker(
      args: FilePickerOpenArgs,
      caller?: FilePickerCaller,
    ): Effect.Effect<{ requestId: string }, Error> {
      return Effect.gen(function* () {
        yield* attempt(() => {
          if (disposed) throw new Error("File picker is disposed");
          pruneStaleState();
          if (
            args.allowedVolumes &&
            (!Array.isArray(args.allowedVolumes) || !args.allowedVolumes.length)
          )
            throw new Error("File picker requires at least one allowed volume");
          for (const id of args.allowedVolumes ?? []) volumes.get(id);
          if (args.initialLocation) {
            const location = args.initialLocation;
            if (
              typeof location.volume !== "string" ||
              typeof location.path !== "string"
            )
              throw new Error("Initial location requires volume and path");
            volumes.get(location.volume);
            if (
              args.allowedVolumes &&
              !args.allowedVolumes.includes(location.volume)
            )
              throw new Error("Initial volume is not allowed");
          }
        });
        if (args.initialLocation)
          yield* files.resolvePath(args.initialLocation);
        const identity = yield* attempt(() => {
          if (!caller?.appId)
            throw new Error("Caller app ID is required to open file pickers");
          const viewId = providers.resolveCallerViewId(caller.webContentsId);
          if (viewId === undefined)
            throw new Error(
              "File pickers can only be opened from a renderer view",
            );
          if (viewId === providers.get()?.viewId)
            throw new Error("Display provider cannot open file pickers");
          return { appId: caller.appId, viewId };
        });
        yield* ensureDisplayProvider();
        if (activeRequest) {
          yield* notifications.busy(
            forceOpenPicker({ ...args }, { ...(caller ?? {}) }),
          );
          return yield* Effect.fail(
            new Error(
              "File picker is busy. Resolve the current file picker before opening another.",
            ),
          );
        }
        const request = yield* attempt(() => {
          const provider = providers.get();
          if (!provider)
            throw new Error("File picker display provider is not registered");
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
        });
        yield* views.reveal(request.viewId);
        log.info(`File picker opened (${request.requestId})`);
        return { requestId: request.requestId };
      });
    }

    function forceOpenPicker(
      args: FilePickerOpenArgs,
      caller: FilePickerCaller,
    ): Effect.Effect<{ requestId: string }, Error> {
      return Effect.gen(function* () {
        yield* attempt(() => {
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
      return attempt((): { success: boolean } => {
        if (!providers.isProvider(caller ?? {}))
          throw new Error("Only the display provider can resolve file pickers");
        if (!activeRequest || activeRequest.requestId !== result.requestId)
          return { success: false };
        if (result.reason === "select") {
          if (!Array.isArray(result.locations) || !result.locations.length)
            throw new Error(
              "File picker selection requires a nonempty locations array",
            );
          for (const location of result.locations) {
            v.parse(filesystemLocationSchema, location);
            const volume = volumes.get(location.volume);
            if (volume.state !== "ready")
              throw new Error("Selected volume is being removed");
            if (
              activeRequest.allowedVolumes &&
              !activeRequest.allowedVolumes.includes(location.volume)
            )
              throw new Error("Selected volume is not allowed");
            if (activeRequest.mode === "save" && volume.readOnly)
              throw new Error("Selected volume is read-only");
          }
        }
        const openerViewId = activeRequest.opener.viewId;
        activeRequest = null;
        closed.emit({ payload: result, viewIds: targets(openerViewId) });
        scheduleIdleStop();
        return { success: true };
      });
    }

    function closePicker(
      requestId: string | undefined,
      caller?: FilePickerCaller,
    ) {
      return attempt((): { success: boolean } => {
        pruneStaleState();
        if (!activeRequest) return { success: false };
        const targetId = requestId ?? activeRequest.requestId;
        if (targetId !== activeRequest.requestId) return { success: false };
        if (!caller?.appId)
          throw new Error("Caller app ID is required to close file pickers");
        if (
          !providers.isProvider(caller) &&
          providers.resolveCallerViewId(caller.webContentsId) !==
            activeRequest.opener.viewId
        ) {
          log.warn(
            `File picker close denied for ${caller.appId} (request ${targetId})`,
          );
          throw new Error(
            "Only the original opener can close this file picker",
          );
        }
        closeActiveRequest("close");
        return { success: true };
      });
    }

    return {
      registerDisplayProvider,
      openPicker,
      resolvePicker,
      closePicker,
      opened,
      closed,
    };
  });
}

export type FilePicker = Effect.Success<ReturnType<typeof createFilePicker>>;
