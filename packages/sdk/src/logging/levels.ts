export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

export const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

export function parseLogLevel(value?: string | null): LogLevel | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized in LOG_LEVEL_ORDER) {
    return normalized as LogLevel;
  }
  return null;
}

export function isLogLevelEnabled(
  level: LogLevel,
  minLevel: LogLevel
): boolean {
  return LOG_LEVEL_ORDER[level] >= LOG_LEVEL_ORDER[minLevel];
}
