import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import { log } from "../logging";
import type { FilePickerCaller, FilePickerViews } from "./ports";

interface Provider {
  appId: string;
  viewId: number;
}

export function createPickerDisplayProvider(views: FilePickerViews) {
  let provider: Provider | null = null;
  const waiters = new Set<{
    appId: string;
    complete: (error?: Error) => void;
  }>();

  function resolveCallerViewId(webContentsId?: number) {
    const viewId = views.resolve(webContentsId);
    if (webContentsId !== undefined && viewId === undefined)
      log.warn(
        `File picker caller view not found for webContents ${webContentsId}`,
      );
    return viewId;
  }

  function isAlive() {
    return provider !== null && views.get(provider.viewId)?.alive === true;
  }

  function get() {
    return isAlive() ? provider : null;
  }

  function register(caller: FilePickerCaller): { success: boolean } {
    const viewId = resolveCallerViewId(caller.webContentsId);
    if (viewId === undefined || !caller.appId)
      throw new Error("File picker display provider must be a valid view");
    for (const waiter of waiters) {
      if (waiter.appId !== caller.appId)
        throw new Error(
          `File picker display provider registration from ${caller.appId} does not match expected app ${waiter.appId}`,
        );
    }
    provider = { appId: caller.appId, viewId };
    for (const waiter of [...waiters]) waiter.complete();
    log.info(`File picker display provider registered: ${caller.appId}`);
    return { success: true };
  }

  function isProvider(caller: FilePickerCaller) {
    const current = get();
    return Boolean(
      current &&
        caller.appId &&
        resolveCallerViewId(caller.webContentsId) === current.viewId,
    );
  }

  function clearIfStale() {
    if (!provider || isAlive()) return false;
    provider = null;
    return true;
  }

  function clearIfAppStopped(appId: string) {
    if (provider?.appId !== appId) return false;
    provider = null;
    return true;
  }

  function waitFor(appId: string) {
    return Effect.callback<void, Error>((resume) => {
      if (get()?.appId === appId) {
        resume(Effect.void);
        return;
      }
      const waiter = {
        appId,
        complete(error?: Error) {
          waiters.delete(waiter);
          resume(error ? Effect.fail(error) : Effect.void);
        },
      };
      waiters.add(waiter);
      return Effect.sync(() => {
        waiters.delete(waiter);
      });
    }).pipe(
      Effect.timeoutOrElse({
        duration: Duration.seconds(5),
        orElse: () =>
          Effect.fail(
            new Error("Timed out waiting for File picker display provider"),
          ),
      }),
    );
  }

  function dispose() {
    provider = null;
    for (const waiter of [...waiters])
      waiter.complete(new Error("File picker display provider disposed"));
  }

  return {
    get,
    register,
    isProvider,
    clearIfStale,
    clearIfAppStopped,
    resolveCallerViewId,
    waitFor,
    dispose,
  };
}
