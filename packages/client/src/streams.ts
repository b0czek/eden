import type {
  CommandArgs,
  CommandName,
  CommandStream,
  StreamReader,
} from "@edenapp/types";
import { invoke } from "./invoke.js";

/** Context bridges drop symbol keys, so iteration is attached on the app side. */
export function toCommandStream<C extends string>(
  reader: StreamReader<C>,
): CommandStream<C> {
  const next = () => reader.next();
  const cancel = () => reader.cancel();
  return {
    handle: reader.handle,
    next,
    cancel,
    [Symbol.asyncIterator]: () => ({
      next,
      return: async () => {
        await cancel();
        return { done: true, value: undefined };
      },
    }),
  };
}

export async function openStream<C extends CommandName>(
  command: C,
  args: CommandArgs<C>,
): Promise<CommandStream<C>> {
  return toCommandStream((await invoke(command, args)) as StreamReader<C>);
}
