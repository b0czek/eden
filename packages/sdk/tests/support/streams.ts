import type { CommandName, StreamReader } from "@edenapp/types";
import { createEdenAPI } from "../../src/app-runtime/common/eden-api";
import type { ShellTransport } from "../../src/app-runtime/common/shell-transport";
import {
  STREAM_CHANNEL,
  type StreamMessage,
} from "../../src/core/streams/protocol";
import type { TestEden } from "./create-test-eden";

/** Opens stream commands from a launched app's view with the production app-side reader. */
export function connectViewStreams(eden: TestEden, appId: string) {
  const { webContents } = eden.getAppView(appId).view;
  const sent: StreamMessage[] = [];
  const transport: ShellTransport = {
    exec: (command, args, submission) =>
      eden.platform.rendererIpc.invoke(
        "shell-command",
        webContents.id,
        command,
        args,
        submission,
      ) as never,
  };
  const { api, dispatchStream } = createEdenAPI(transport);
  webContents.on("message-sent", (channel: string, message: StreamMessage) => {
    if (channel !== STREAM_CHANNEL) return;
    sent.push(message);
    dispatchStream(message);
  });
  return {
    sent,
    open: (command: string, args: unknown = {}) =>
      api.shellCommand(command as CommandName, args as never) as Promise<
        StreamReader<string>
      >,
  };
}

export async function readAll<T = unknown>(
  reader: StreamReader<string>,
): Promise<T[]> {
  const chunks: unknown[] = [];
  while (true) {
    const result = await reader.next();
    if (result.done) return chunks as T[];
    chunks.push(result.value);
  }
}
