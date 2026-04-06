import type { WebContents } from "electron";
import type { LogLevel } from "./levels";
import type { CallsiteInfo, LogContext } from "./logger";
import { logExternal } from "./logger";

interface ConsoleMessageDetails {
  level?: number | string;
  message?: string;
  lineNumber?: number;
  sourceId?: string;
}

function mapConsoleLevel(level: number | string): LogLevel {
  if (typeof level === "string") {
    const normalized = level.toLowerCase();
    if (normalized.includes("warn")) return "warn";
    if (normalized.includes("error")) return "error";
    if (normalized.includes("debug")) return "debug";
    if (normalized.includes("trace")) return "trace";
    return "info";
  }

  // Shifted mapping:
  // 1=info/log, 2=warn, 3=error, 4=debug
  switch (level) {
    case 2:
      return "warn";
    case 3:
      return "error";
    case 4:
      return "debug";
    case 1:
    default:
      return "info";
  }
}

export function attachWebContentsLogger(
  webContents: WebContents,
  context: LogContext,
): void {
  webContents.on("console-message", (_event, ...args: unknown[]) => {
    const details = args[0];

    let level: number | string;
    let message: string;
    let lineNumber: number | undefined;
    let sourceId: string | undefined;

    if (details && typeof details === "object" && "message" in details) {
      const consoleDetails = details as ConsoleMessageDetails;
      level = consoleDetails.level ?? 0;
      message = consoleDetails.message ?? "";
      lineNumber = consoleDetails.lineNumber;
      sourceId = consoleDetails.sourceId;
    } else {
      level = typeof details === "number" ? details : 0;
      message = typeof args[1] === "string" ? args[1] : "";
      lineNumber = typeof args[2] === "number" ? args[2] : undefined;
      sourceId = typeof args[3] === "string" ? args[3] : undefined;
    }

    const callsite: CallsiteInfo | undefined =
      sourceId && typeof lineNumber === "number"
        ? { file: sourceId, line: lineNumber }
        : undefined;

    logExternal({
      level: mapConsoleLevel(level),
      message,
      context: {
        ...context,
        processType: context.processType ?? "renderer",
        webContentsId: context.webContentsId ?? webContents.id,
      },
      callsite,
    });
  });
}
