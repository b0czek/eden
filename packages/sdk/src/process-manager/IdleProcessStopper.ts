import { log } from "../logging";
export function createIdleProcessStopper(
  processManager: {
    getAppInstance(appId: string): unknown;
    stopApp(appId: string): Promise<void>;
  },
  delayMs: number,
  label: string = "process",
) {
  let _timer: NodeJS.Timeout | null = null;
  let _targetAppId: string | null = null;
  const _processManager = processManager;
  const _delayMs = delayMs;
  const _label = label;

  function setTarget(appId: string): void {
    _targetAppId = appId;
  }

  function clearTarget(appId?: string): void {
    if (appId !== undefined && _targetAppId !== appId) return;
    _targetAppId = null;
    cancel();
  }

  function schedule(): void {
    cancel();
    const targetAppId = _targetAppId;
    if (!targetAppId) return;

    _timer = setTimeout(() => {
      _timer = null;
      if (_targetAppId !== targetAppId) return;
      if (!_processManager.getAppInstance(targetAppId)) return;

      void _processManager.stopApp(targetAppId).catch((error) => {
        log.warn(`Failed to stop idle ${_label} ${targetAppId}:`, error);
      });
    }, _delayMs);
    _timer.unref?.();
  }

  function cancel(): void {
    if (!_timer) return;
    clearTimeout(_timer);
    _timer = null;
  }

  function dispose(): void {
    cancel();
  }
  return { setTarget, clearTarget, schedule, cancel, dispose };
}

export type IdleProcessStopper = ReturnType<typeof createIdleProcessStopper>;
