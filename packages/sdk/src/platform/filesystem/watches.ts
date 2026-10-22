import { randomUUID } from "node:crypto";
import * as path from "node:path";
import type { FilesystemChangeKind } from "@edenapp/types";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FiberMap from "effect/FiberMap";
import * as Option from "effect/Option";
import type { Event } from "../../core/events/event";
import { listen } from "../../core/events/scoped";
import { log } from "../logging/logger";

import { FilesystemWatchRejected, watchRejection } from "./errors";
import { io, type NativeWatch } from "./native-io";

interface DirectoryWatch {
  watcher: NativeWatch;
  watchIds: Set<string>;
}

interface ViewWatch {
  viewId: number;
  volume: string;
  hostPath: string;
}

interface FilesystemWatchesOptions {
  resolveViewId: (webContentsId: number) => number | undefined;
  viewRemoved: Pick<Event<{ viewId: number }>, "on">;
  notify: (
    viewId: number,
    event: { watchId: string; kind: FilesystemChangeKind },
  ) => void;
}

export const createFilesystemWatches = Effect.fn(function* (
  options: FilesystemWatchesOptions,
) {
  const debounces = yield* FiberMap.make<string, void, never>();
  const forkDebounce = yield* FiberMap.runtime(debounces)<never>();
  const directoryWatches = new Map<string, DirectoryWatch>();
  const viewWatches = new Map<string, ViewWatch>();

  yield* listen(options.viewRemoved, ({ viewId }) => removeViewWatches(viewId));

  const watch = Effect.fn(function* (
    hostPath: string,
    callerWebContentsId: number | undefined,
    volume: string,
  ) {
    const viewId = yield* Effect.try({
      try: () => resolveCallerView(callerWebContentsId),
      catch: watchRejection,
    });
    let directoryWatch = directoryWatches.get(hostPath);
    if (!directoryWatch) {
      const watchIds = new Set<string>();
      const watcher = yield* io.watch(
        hostPath,
        () => scheduleChange(hostPath, "change"),
        (error) => {
          log.warn(`Filesystem watch failed for ${hostPath}:`, error);
          scheduleChange(hostPath, "watch-error");
        },
      );
      directoryWatch = { watcher, watchIds };
      directoryWatches.set(hostPath, directoryWatch);
    }

    const watchId = randomUUID();
    directoryWatch.watchIds.add(watchId);
    viewWatches.set(watchId, { viewId, hostPath, volume });
    return { watchId };
  }, Effect.uninterruptible);

  function unwatch(
    watchId: string,
    callerWebContentsId: number | undefined,
  ): void {
    const viewId = resolveCallerView(callerWebContentsId);
    const ownedWatch = viewWatches.get(watchId);
    if (!ownedWatch || ownedWatch.viewId !== viewId) {
      throw new FilesystemWatchRejected({
        watchId,
        message: "Filesystem watch is not owned by the calling view",
      });
    }
    removeWatch(watchId);
  }

  function removeUnavailableVolumes(available: ReadonlySet<string>): void {
    for (const [watchId, watch] of viewWatches) {
      if (available.has(watch.volume)) continue;
      options.notify(watch.viewId, { watchId, kind: "volume-removed" });
      removeWatch(watchId);
    }
  }

  function invalidate(hostPath: string): void {
    scheduleChange(path.resolve(hostPath), "change");
  }

  function dispose(): void {
    for (const directoryWatch of directoryWatches.values()) {
      directoryWatch.watcher.close();
    }
    directoryWatches.clear();
    viewWatches.clear();
  }

  function resolveCallerView(callerWebContentsId: number | undefined): number {
    if (callerWebContentsId === undefined) {
      throw new FilesystemWatchRejected({
        message: "Filesystem watches are only available to app views",
      });
    }
    const viewId = options.resolveViewId(callerWebContentsId);
    if (viewId === undefined)
      throw new FilesystemWatchRejected({
        message: "Calling view was not found",
      });
    return viewId;
  }

  function scheduleChange(hostPath: string, kind: FilesystemChangeKind): void {
    const directoryWatch = directoryWatches.get(hostPath);
    if (!directoryWatch) return;
    forkDebounce(
      hostPath,
      Effect.sleep(Duration.millis(100)).pipe(
        Effect.andThen(
          Effect.sync(() => {
            for (const watchId of directoryWatch.watchIds) {
              const ownedWatch = viewWatches.get(watchId);
              if (ownedWatch) {
                options.notify(ownedWatch.viewId, { watchId, kind });
              }
            }
          }),
        ),
      ),
    );
  }

  function removeWatch(watchId: string): void {
    const ownedWatch = viewWatches.get(watchId);
    if (!ownedWatch) return;
    viewWatches.delete(watchId);
    const directoryWatch = directoryWatches.get(ownedWatch.hostPath);
    if (!directoryWatch) return;
    directoryWatch.watchIds.delete(watchId);
    if (directoryWatch.watchIds.size === 0) {
      const debounce = FiberMap.getUnsafe(debounces, ownedWatch.hostPath);
      if (Option.isSome(debounce)) debounce.value.interruptUnsafe();
      directoryWatch.watcher.close();
      directoryWatches.delete(ownedWatch.hostPath);
    }
  }

  function removeViewWatches(viewId: number): void {
    for (const [watchId, watch] of viewWatches) {
      if (watch.viewId === viewId) removeWatch(watchId);
    }
  }
  yield* Effect.addFinalizer(() => Effect.sync(dispose));
  return { watch, unwatch, removeUnavailableVolumes, invalidate };
});
