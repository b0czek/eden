import { log } from "../logging";
import type { ProcessManager } from "./ProcessManager";

export class IdleProcessStopper {
  private timer: NodeJS.Timeout | null = null;
  private targetAppId: string | null = null;

  constructor(
    private processManager: Pick<ProcessManager, "getAppInstance" | "stopApp">,
    private delayMs: number,
    private label: string = "process",
  ) {}

  setTarget(appId: string): void {
    this.targetAppId = appId;
  }

  clearTarget(appId?: string): void {
    if (appId !== undefined && this.targetAppId !== appId) return;
    this.targetAppId = null;
    this.cancel();
  }

  schedule(): void {
    this.cancel();
    const targetAppId = this.targetAppId;
    if (!targetAppId) return;

    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.targetAppId !== targetAppId) return;
      if (!this.processManager.getAppInstance(targetAppId)) return;

      void this.processManager.stopApp(targetAppId).catch((error) => {
        log.warn(`Failed to stop idle ${this.label} ${targetAppId}:`, error);
      });
    }, this.delayMs);
    this.timer.unref?.();
  }

  cancel(): void {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = null;
  }

  dispose(): void {
    this.cancel();
  }
}
