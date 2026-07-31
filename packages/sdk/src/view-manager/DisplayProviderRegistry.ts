import { log } from "../logging";
import type { ViewManager } from "./ViewManager";

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

export class DisplayProviderRegistry {
  private provider: DisplayProvider | null = null;
  private waiters = new Set<DisplayProviderWaiter>();

  constructor(
    private viewManager: Pick<
      ViewManager,
      "getViewIdByWebContentsId" | "getViewInfo"
    >,
    private label: string,
  ) {}

  register(caller: DisplayProviderCaller): { success: boolean } {
    const viewId = this.resolveCallerViewId(caller.webContentsId);
    if (viewId === undefined || !caller.appId) {
      throw new Error(`${this.label} display provider must be a valid view`);
    }

    for (const waiter of this.waiters) {
      if (waiter.appId !== caller.appId) {
        throw new Error(
          `${this.label} display provider registration from ${caller.appId} does not match expected app ${waiter.appId}`,
        );
      }
    }

    this.provider = { appId: caller.appId, viewId };
    for (const waiter of Array.from(this.waiters)) {
      if (waiter.appId === caller.appId) {
        waiter.resolve();
      }
    }
    log.info(`${this.label} display provider registered: ${caller.appId}`);
    return { success: true };
  }

  getProvider(): DisplayProvider | null {
    return this.provider && this.isProviderAlive() ? this.provider : null;
  }

  clear(): void {
    this.provider = null;
  }

  clearIfAppStopped(appId: string): boolean {
    if (this.provider?.appId !== appId) {
      return false;
    }

    this.provider = null;
    return true;
  }

  clearIfStale(): boolean {
    if (!this.provider || this.isProviderAlive()) {
      return false;
    }

    this.provider = null;
    return true;
  }

  isProvider(caller: DisplayProviderCaller): boolean {
    const provider = this.getProvider();
    if (!provider || !caller.appId) return false;
    const callerViewId = this.resolveCallerViewId(caller.webContentsId);
    return callerViewId === provider.viewId;
  }

  isProviderAlive(): boolean {
    if (!this.provider) return false;
    const viewInfo = this.viewManager.getViewInfo(this.provider.viewId);
    return Boolean(viewInfo && !viewInfo.view.webContents.isDestroyed());
  }

  async waitFor(appId: string, timeoutMs: number): Promise<void> {
    const provider = this.getProvider();
    if (provider?.appId === appId) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      let waiter: DisplayProviderWaiter;
      waiter = {
        appId,
        resolve: () => {
          clearTimeout(waiter.timer);
          this.waiters.delete(waiter);
          resolve();
        },
        reject: (error: Error) => {
          clearTimeout(waiter.timer);
          this.waiters.delete(waiter);
          reject(error);
        },
        timer: setTimeout(() => {
          waiter.reject(
            new Error(`Timed out waiting for ${this.label} display provider`),
          );
        }, timeoutMs),
      };
      waiter.timer.unref?.();
      this.waiters.add(waiter);
    });
  }

  resolveCallerViewId(webContentsId?: number): number | undefined {
    if (webContentsId === undefined) return undefined;
    const viewId = this.viewManager.getViewIdByWebContentsId(webContentsId);
    if (viewId === undefined) {
      log.warn(
        `${this.label} caller view not found for webContents ${webContentsId}`,
      );
    }
    return viewId;
  }

  dispose(): void {
    this.provider = null;
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error(`${this.label} display provider disposed`));
    }
    this.waiters.clear();
  }
}
