import type { LogLevel } from "./levels";
import { isLogLevelEnabled, parseLogLevel } from "./levels";

export type LogFormat = "pretty" | "raw";
export type LogPathMode = "short" | "full" | "file";

export interface LogContext {
  appId?: string;
  viewId?: number;
  webContentsId?: number;
  processType?: string;
  source?: string;
}

export interface CallsiteInfo {
  file: string;
  line: number;
  column?: number;
}

export interface LoggerConfig {
  minLevel: LogLevel;
  format: LogFormat;
  includeTimestamp: boolean;
  includeCallsite: boolean;
  pathMode: LogPathMode;
}

export interface Logger {
  trace: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  fatal: (...args: unknown[]) => void;
}

interface LogRecord {
  level: LogLevel;
  args: unknown[];
  context?: LogContext;
  callsite?: CallsiteInfo;
  timestamp?: number;
  skipCallsite?: boolean;
}

let globalContext: LogContext = {};

let config: LoggerConfig = resolveDefaultConfig();
const baseConsole = {
  debug: console.debug.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  info: console.log.bind(console),
};

export function configureLogger(next: Partial<LoggerConfig>): void {
  config = { ...config, ...next };
}

export function getLoggerConfig(): LoggerConfig {
  return config;
}

export function setLogContext(next: Partial<LogContext>): void {
  globalContext = { ...globalContext, ...next };
}

export function createLogger(context?: LogContext): Logger {
  return {
    trace: (...args) => emit({ level: "trace", args, context }),
    debug: (...args) => emit({ level: "debug", args, context }),
    info: (...args) => emit({ level: "info", args, context }),
    warn: (...args) => emit({ level: "warn", args, context }),
    error: (...args) => emit({ level: "error", args, context }),
    fatal: (...args) => emit({ level: "fatal", args, context }),
  };
}

export const log: Logger = createLogger();

export function logExternal(record: {
  level: LogLevel;
  message: string;
  context?: LogContext;
  callsite?: CallsiteInfo;
}): void {
  emit({
    level: record.level,
    args: [record.message],
    context: record.context,
    callsite: record.callsite,
    skipCallsite: true,
  });
}

export function logFromConsole(record: {
  level: LogLevel;
  args: unknown[];
  context?: LogContext;
  callsite?: CallsiteInfo;
}): void {
  emit({
    level: record.level,
    args: record.args,
    context: record.context,
    callsite: record.callsite,
    skipCallsite: true,
  });
}

function emit(record: LogRecord): void {
  const { level } = record;
  if (!isLogLevelEnabled(level, config.minLevel)) return;

  const timestamp = record.timestamp ?? Date.now();
  const context = mergeContext(record.context);
  const callsite =
    record.callsite ??
    (config.includeCallsite && !record.skipCallsite
      ? captureCallsite()
      : undefined);

  const prefix =
    config.format === "pretty"
      ? formatPrefix({ level, timestamp, context, callsite })
      : "";

  const target = consoleForLevel(level);
  if (prefix) {
    target(prefix, ...record.args);
  } else {
    target(...record.args);
  }
}

function mergeContext(context?: LogContext): LogContext {
  const base = getBaseContext();
  return { ...base, ...context };
}

function getBaseContext(): LogContext {
  const envAppId = getEnvValue("EDEN_APP_ID");
  const globalAppId = (globalThis as any).__EDEN_APP_ID__ as string | undefined;
  return {
    processType: detectProcessType(),
    appId: globalContext.appId ?? envAppId ?? globalAppId,
    viewId: globalContext.viewId,
    webContentsId: globalContext.webContentsId,
    source: globalContext.source,
  };
}

function detectProcessType(): string {
  const processObj = (globalThis as any).process as
    | { type?: string; env?: Record<string, string>; cwd?: () => string }
    | undefined;
  if (processObj) {
    const type = processObj.type;
    if (type === "browser") return "main";
    if (type === "utility") return "backend";
    if (type) return type;
  }
  if (typeof (globalThis as any).window !== "undefined") return "renderer";
  return "node";
}

function resolveDefaultConfig(): LoggerConfig {
  const envLevel = parseLogLevel(getEnvValue("EDEN_LOG_LEVEL"));
  const envFormat = getEnvValue("EDEN_LOG_FORMAT") as LogFormat | undefined;
  const envPathMode = getEnvValue("EDEN_LOG_PATH") as LogPathMode | undefined;
  const isTest = getEnvValue("NODE_ENV") === "test";
  const isRenderer = detectProcessType() === "renderer";

  return {
    minLevel: envLevel ?? "debug",
    format: envFormat ?? (isTest || isRenderer ? "raw" : "pretty"),
    includeTimestamp: getEnvBool("EDEN_LOG_TIMESTAMP", !isTest),
    includeCallsite: getEnvBool(
      "EDEN_LOG_CALLSITE",
      !isTest && !isRenderer
    ),
    pathMode: envPathMode ?? "short",
  };
}

function consoleForLevel(level: LogLevel): (...args: unknown[]) => void {
  const useLiveConsole = getEnvValue("NODE_ENV") === "test";
  switch (level) {
    case "trace":
    case "debug":
      return useLiveConsole ? console.debug.bind(console) : baseConsole.debug;
    case "warn":
      return useLiveConsole ? console.warn.bind(console) : baseConsole.warn;
    case "error":
    case "fatal":
      return useLiveConsole ? console.error.bind(console) : baseConsole.error;
    case "info":
    default:
      return useLiveConsole ? console.log.bind(console) : baseConsole.info;
  }
}

function formatPrefix(record: {
  level: LogLevel;
  timestamp: number;
  context?: LogContext;
  callsite?: CallsiteInfo;
}): string {
  const parts: string[] = [];

  if (config.includeTimestamp) {
    parts.push(new Date(record.timestamp).toISOString());
  }

  parts.push(record.level.toUpperCase());

  if (record.context?.processType) {
    parts.push(record.context.processType);
  }
  if (record.context?.appId) {
    parts.push(`app=${record.context.appId}`);
  }
  if (record.context?.viewId !== undefined) {
    parts.push(`view=${record.context.viewId}`);
  }
  if (record.context?.webContentsId !== undefined) {
    parts.push(`wc=${record.context.webContentsId}`);
  }
  if (record.context?.source) {
    parts.push(record.context.source);
  }
  if (record.callsite) {
    const file = shortenPath(record.callsite.file, config.pathMode);
    parts.push(`${file}:${record.callsite.line}`);
  }

  return `[${parts.join("] [")}]`;
}

function captureCallsite(): CallsiteInfo | undefined {
  const err = new Error();
  (Error as any).captureStackTrace?.(err, captureCallsite);
  const stack = err.stack;
  if (!stack) return undefined;

  const lines = stack.split("\n").slice(1);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.includes("/logging/") || trimmed.includes("\\logging\\")) {
      continue;
    }

    const match =
      trimmed.match(/\(([^)]+):(\d+):(\d+)\)$/) ??
      trimmed.match(/at\s+([^\s]+):(\d+):(\d+)$/);

    if (!match) continue;

    const file = match[1];
    const lineNumber = Number(match[2]);
    const columnNumber = Number(match[3]);

    if (!file || Number.isNaN(lineNumber)) continue;

    return {
      file,
      line: lineNumber,
      column: Number.isNaN(columnNumber) ? undefined : columnNumber,
    };
  }

  return undefined;
}

function shortenPath(path: string, mode: LogPathMode): string {
  if (mode === "full") return path;
  if (mode === "file") {
    const cleaned = path.replace(/^[^:]*[\\/]/, "");
    return cleaned || path;
  }

  let normalized = path;
  if (normalized.startsWith("file://")) {
    normalized = normalized.slice("file://".length);
  }

  try {
    const processObj = (globalThis as any).process as
      | { cwd?: () => string }
      | undefined;
    if (processObj?.cwd) {
      const cwd = processObj.cwd();
      if (normalized.startsWith(cwd)) {
        return normalized.slice(cwd.length + 1);
      }
    }
  } catch {
    // Ignore errors resolving cwd
  }

  const normalizedPath = normalized.replace(/\\/g, "/");
  const distIndex = normalizedPath.lastIndexOf("/dist/");
  if (distIndex >= 0) {
    return normalizedPath.slice(distIndex + 1);
  }

  const sdkIndex = normalizedPath.lastIndexOf("/sdk/");
  if (sdkIndex >= 0) {
    return normalizedPath.slice(sdkIndex + 1);
  }

  const segments = normalizedPath.split("/").filter(Boolean);
  if (segments.length >= 2) {
    return segments.slice(-2).join("/");
  }

  return normalizedPath;
}

function getEnvValue(key: string): string | undefined {
  const processObj = (globalThis as any).process as
    | { env?: Record<string, string> }
    | undefined;
  if (processObj?.env?.[key]) {
    return processObj.env[key];
  }
  const globalValue = (globalThis as any)[key];
  if (typeof globalValue === "string") {
    return globalValue;
  }
  return undefined;
}

function getEnvBool(key: string, fallback: boolean): boolean {
  const value = getEnvValue(key);
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}
