import type { WebContents } from "electron";
import type { LogLevel } from "./levels";
import type { LogContext, CallsiteInfo } from "./logger";
import { logExternal } from "./logger";

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
  webContents.on("console-message", (_event, ...args: any[]) => {
    const details = args[0];

    let level: number | string;
    let message: string;
    let lineNumber: number | undefined;
    let sourceId: string | undefined;

    if (details && typeof details === "object" && "message" in details) {
      level = details.level ?? 0;
      message = details.message ?? "";
      lineNumber = details.lineNumber;
      sourceId = details.sourceId;
    } else {
      level = typeof details === "number" ? details : 0;
      message = args[1] ?? "";
      lineNumber = args[2];
      sourceId = args[3];
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
