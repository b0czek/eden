import type { WebContents } from "electron";
import type { LogLevel } from "./levels";
import type { LogContext, CallsiteInfo } from "./logger";
import { logExternal } from "./logger";

function mapConsoleLevel(level: number): LogLevel {
  switch (level) {
    case 1:
      return "warn";
    case 2:
      return "error";
    case 3:
      return "debug";
    case 0:
    default:
      return "info";
  }
}

export function attachWebContentsLogger(
  webContents: WebContents,
  context: LogContext
): void {
  webContents.on("console-message", (_event, ...args: any[]) => {
    const details = args[0];

    let level: number;
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
