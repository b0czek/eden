import type {
  EdenKeyboardAction,
  EdenKeyboardFocusState,
  EdenKeyboardStartDragRequest,
  EdenKeyboardState,
  EdenKeyboardUpdateDragRequest,
} from "@edenapp/types";
import * as Effect from "effect/Effect";
import { log } from "../logging";
import type { RendererIpcPort } from "../platform/ports";
import { keyboardChannels as channel } from "./protocol";

interface KeyboardRequests {
  focus(
    sender: number,
    payload: EdenKeyboardFocusState | undefined,
  ): Effect.Effect<void, Error>;
  show(): Effect.Effect<{ success: boolean }, Error>;
  action(
    sender: number,
    payload: EdenKeyboardAction | undefined,
  ): Effect.Effect<{ success: boolean }, Error>;
  hide(sender: number): Effect.Effect<{ success: boolean }, Error>;
  startDrag(
    sender: number,
    payload: EdenKeyboardStartDragRequest | undefined,
  ): Effect.Effect<{ success: boolean }, Error>;
  updateDrag(
    sender: number,
    payload: EdenKeyboardUpdateDragRequest | undefined,
  ): Effect.Effect<void, Error>;
  endDrag(sender: number): Effect.Effect<{ success: boolean }, Error>;
  state(): EdenKeyboardState;
}

/** Interpret renderer requests at the native IPC boundary, retaining its protocol. */
export function bindKeyboardIpc(
  ipc: RendererIpcPort,
  requests: KeyboardRequests,
  run: <A>(work: Effect.Effect<A, Error>) => Promise<A>,
) {
  return Effect.acquireRelease(
    Effect.sync(() => {
      ipc.on<[EdenKeyboardFocusState | undefined]>(
        channel.focusState,
        (event, payload) => {
          void run(requests.focus(event.sender.id, payload)).catch((error) =>
            log.error("Failed to update keyboard focus:", error),
          );
        },
      );
      ipc.handle(channel.show, () => run(requests.show()));
      ipc.handle<[EdenKeyboardAction | undefined], { success: boolean }>(
        channel.sendAction,
        (event, action) => run(requests.action(event.sender.id, action)),
      );
      ipc.handle(channel.hide, (event) => run(requests.hide(event.sender.id)));
      ipc.handle<
        [EdenKeyboardStartDragRequest | undefined],
        { success: boolean }
      >(channel.startDrag, (event, payload) =>
        run(requests.startDrag(event.sender.id, payload)),
      );
      ipc.on<[EdenKeyboardUpdateDragRequest | undefined]>(
        channel.updateDrag,
        (event, payload) => {
          void run(requests.updateDrag(event.sender.id, payload)).catch(
            (error) => log.error("Failed to move keyboard overlay:", error),
          );
        },
      );
      ipc.handle(channel.endDrag, (event) =>
        run(requests.endDrag(event.sender.id)),
      );
      ipc.handle(channel.getState, () => requests.state());
    }),
    () =>
      Effect.sync(() => {
        for (const name of [
          channel.show,
          channel.getState,
          channel.sendAction,
          channel.hide,
          channel.startDrag,
          channel.endDrag,
        ])
          ipc.removeHandler(name);
        ipc.removeAllListeners(channel.focusState);
        ipc.removeAllListeners(channel.updateDrag);
      }),
  );
}
