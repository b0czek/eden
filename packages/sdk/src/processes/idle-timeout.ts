import { log } from "../logging";
export function createProcessIdleTimeout(
  processes: {
    getAppInstance(appId: string): unknown;
    stopApp(appId: string): Promise<void>;
  },
  delayMs: number,
  label: string = "process",
) {
  let _timer: NodeJS.Timeout | null = null;
  let _targetAppId: string | null = null;
  const _processes = processes;
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
      if (!_processes.getAppInstance(targetAppId)) return;

      void _processes.stopApp(targetAppId).catch((error) => {
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

export type ProcessIdleTimeout = ReturnType<typeof createProcessIdleTimeout>;
