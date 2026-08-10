import { randomUUID } from "node:crypto";
import { type FSWatcher, watch as watchNative } from "node:fs";
import * as path from "node:path";
import type { FilesystemChangeKind } from "@edenapp/types";
import { log } from "../logging";

interface DirectoryWatch {
  watcher: FSWatcher;
  watchIds: Set<string>;
  debounce?: NodeJS.Timeout;
}

interface ViewWatch {
  viewId: number;
  hostPath: string;
}

interface FilesystemWatcherOptions {
  resolveViewId: (webContentsId: number) => number | undefined;
  onViewRemoved: (listener: (viewId: number) => void) => () => void;
  notify: (
    viewId: number,
    event: { watchId: string; kind: FilesystemChangeKind },
  ) => void;
}

export class FilesystemWatcher {
  private readonly directoryWatches = new Map<string, DirectoryWatch>();
  private readonly viewWatches = new Map<string, ViewWatch>();
  private readonly stopViewRemovalListener: () => void;

  constructor(private readonly options: FilesystemWatcherOptions) {
    this.stopViewRemovalListener = options.onViewRemoved((viewId) =>
      this.removeViewWatches(viewId),
    );
  }

  watch(
    hostPath: string,
    callerWebContentsId: number | undefined,
  ): { watchId: string } {
    const viewId = this.resolveCallerView(callerWebContentsId);
    let directoryWatch = this.directoryWatches.get(hostPath);
    if (!directoryWatch) {
      const watchIds = new Set<string>();
      const watcher = watchNative(hostPath, { persistent: false }, () => {
        this.scheduleChange(hostPath, "change");
      });
      directoryWatch = { watcher, watchIds };
      watcher.on("error", (error) => {
        log.warn(`Filesystem watch failed for ${hostPath}:`, error);
        this.scheduleChange(hostPath, "watch-error");
      });
      this.directoryWatches.set(hostPath, directoryWatch);
    }

    const watchId = randomUUID();
    directoryWatch.watchIds.add(watchId);
    this.viewWatches.set(watchId, { viewId, hostPath });
    return { watchId };
  }

  unwatch(watchId: string, callerWebContentsId: number | undefined): void {
    const viewId = this.resolveCallerView(callerWebContentsId);
    const ownedWatch = this.viewWatches.get(watchId);
    if (!ownedWatch || ownedWatch.viewId !== viewId) {
      throw new Error("Filesystem watch is not owned by the calling view");
    }
    this.removeWatch(watchId);
  }

  invalidate(hostPath: string): void {
    this.scheduleChange(path.resolve(hostPath), "change");
  }

  dispose(): void {
    this.stopViewRemovalListener();
    for (const directoryWatch of this.directoryWatches.values()) {
      if (directoryWatch.debounce) clearTimeout(directoryWatch.debounce);
      directoryWatch.watcher.close();
    }
    this.directoryWatches.clear();
    this.viewWatches.clear();
  }

  private resolveCallerView(callerWebContentsId: number | undefined): number {
    if (callerWebContentsId === undefined) {
      throw new Error("Filesystem watches are only available to app views");
    }
    const viewId = this.options.resolveViewId(callerWebContentsId);
    if (viewId === undefined) throw new Error("Calling view was not found");
    return viewId;
  }

  private scheduleChange(hostPath: string, kind: FilesystemChangeKind): void {
    const directoryWatch = this.directoryWatches.get(hostPath);
    if (!directoryWatch) return;
    if (directoryWatch.debounce) clearTimeout(directoryWatch.debounce);
    directoryWatch.debounce = setTimeout(() => {
      directoryWatch.debounce = undefined;
      for (const watchId of directoryWatch.watchIds) {
        const ownedWatch = this.viewWatches.get(watchId);
        if (ownedWatch) {
          this.options.notify(ownedWatch.viewId, { watchId, kind });
        }
      }
    }, 100);
  }

  private removeWatch(watchId: string): void {
    const ownedWatch = this.viewWatches.get(watchId);
    if (!ownedWatch) return;
    this.viewWatches.delete(watchId);
    const directoryWatch = this.directoryWatches.get(ownedWatch.hostPath);
    if (!directoryWatch) return;
    directoryWatch.watchIds.delete(watchId);
    if (directoryWatch.watchIds.size === 0) {
      if (directoryWatch.debounce) clearTimeout(directoryWatch.debounce);
      directoryWatch.watcher.close();
      this.directoryWatches.delete(ownedWatch.hostPath);
    }
  }

  private removeViewWatches(viewId: number): void {
    for (const [watchId, watch] of this.viewWatches) {
      if (watch.viewId === viewId) this.removeWatch(watchId);
    }
  }
}
