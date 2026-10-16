import * as Effect from "effect/Effect";
import { log } from "../logging";
import type { Views } from "./service";

export interface DisplayProviderCaller {
  appId?: string;
  webContentsId?: number;
}

export interface DisplayProvider {
  appId: string;
  viewId: number;
}

interface DisplayProviderWaiter {
  appId: string;
  resolve: () => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}
export function createDisplayProviders(
  views: Pick<Views, "getViewIdByWebContentsId" | "getViewInfo">,
  label: string,
) {
  let _provider: DisplayProvider | null = null;
  let _waiters = new Set<DisplayProviderWaiter>();
  const _views = views;
  const _label = label;

  function register(caller: DisplayProviderCaller): { success: boolean } {
    const viewId = resolveCallerViewId(caller.webContentsId);
    if (viewId === undefined || !caller.appId) {
      throw new Error(`${_label} display provider must be a valid view`);
    }

    for (const waiter of _waiters) {
      if (waiter.appId !== caller.appId) {
        throw new Error(
          `${_label} display provider registration from ${caller.appId} does not match expected app ${waiter.appId}`,
        );
      }
    }

    _provider = { appId: caller.appId, viewId };
    for (const waiter of Array.from(_waiters)) {
      if (waiter.appId === caller.appId) {
        waiter.resolve();
      }
    }
    log.info(`${_label} display provider registered: ${caller.appId}`);
    return { success: true };
  }

  function getProvider(): DisplayProvider | null {
    return _provider && isProviderAlive() ? _provider : null;
  }

  function clear(): void {
    _provider = null;
  }

  function clearIfAppStopped(appId: string): boolean {
    if (_provider?.appId !== appId) {
      return false;
    }

    _provider = null;
    return true;
  }

  function clearIfStale(): boolean {
    if (!_provider || isProviderAlive()) {
      return false;
    }

    _provider = null;
    return true;
  }

  function isProvider(caller: DisplayProviderCaller): boolean {
    const provider = getProvider();
    if (!provider || !caller.appId) return false;
    const callerViewId = resolveCallerViewId(caller.webContentsId);
    return callerViewId === provider.viewId;
  }

  function isProviderAlive(): boolean {
    if (!_provider) return false;
    const viewInfo = _views.getViewInfo(_provider.viewId);
    return Boolean(viewInfo && !viewInfo.view.webContents.isDestroyed());
  }

  const waitFor = Effect.fn(function* (appId: string, timeoutMs: number) {
    const provider = getProvider();
    if (provider?.appId === appId) {
      return;
    }

    yield* Effect.callback<void, Error>((resume) => {
      const cleanup = () => {
        clearTimeout(waiter.timer);
        _waiters.delete(waiter);
      };
      const waiter: DisplayProviderWaiter = {
        appId,
        resolve: () => {
          cleanup();
          resume(Effect.void);
        },
        reject: (error) => {
          cleanup();
          resume(Effect.fail(error));
        },
        timer: setTimeout(
          () =>
            waiter.reject(
              new Error(`Timed out waiting for ${_label} display provider`),
            ),
          timeoutMs,
        ),
      };
      waiter.timer.unref?.();
      _waiters.add(waiter);
      return Effect.sync(cleanup);
    });
  });

  function resolveCallerViewId(webContentsId?: number): number | undefined {
    if (webContentsId === undefined) return undefined;
    const viewId = _views.getViewIdByWebContentsId(webContentsId);
    if (viewId === undefined) {
      log.warn(
        `${_label} caller view not found for webContents ${webContentsId}`,
      );
    }
    return viewId;
  }

  function dispose(): void {
    _provider = null;
    for (const waiter of _waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error(`${_label} display provider disposed`));
    }
    _waiters.clear();
  }
  return {
    register,
    getProvider,
    clear,
    clearIfAppStopped,
    clearIfStale,
    isProvider,
    isProviderAlive,
    waitFor,
    resolveCallerViewId,
    dispose,
  };
}

export type DisplayProviders = ReturnType<typeof createDisplayProviders>;
