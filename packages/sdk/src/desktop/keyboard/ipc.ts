import type {
  EdenKeyboardAction,
  EdenKeyboardFocusState,
  EdenKeyboardStartDragRequest,
  EdenKeyboardState,
  EdenKeyboardUpdateDragRequest,
} from "@edenapp/types";
import * as Effect from "effect/Effect";
import * as FiberSet from "effect/FiberSet";
import { log } from "../../platform/logging/logger";
import type { RendererIpcPort } from "../../platform/ports/types";
import type { KeyboardNativeFailure, KeyboardSenderRejected } from "./errors";
import { keyboardChannels as channel } from "./protocol";

interface KeyboardRequests {
  focus(
    sender: number,
    payload: EdenKeyboardFocusState | undefined,
  ): Effect.Effect<void, KeyboardNativeFailure>;
  show(): Effect.Effect<{ success: boolean }, KeyboardNativeFailure>;
  action(
    sender: number,
    payload: EdenKeyboardAction | undefined,
  ): Effect.Effect<
    { success: boolean },
    KeyboardNativeFailure | KeyboardSenderRejected
  >;
  hide(
    sender: number,
  ): Effect.Effect<{ success: boolean }, KeyboardNativeFailure>;
  startDrag(
    sender: number,
    payload: EdenKeyboardStartDragRequest | undefined,
  ): Effect.Effect<
    { success: boolean },
    KeyboardNativeFailure | KeyboardSenderRejected
  >;
  updateDrag(
    sender: number,
    payload: EdenKeyboardUpdateDragRequest | undefined,
  ): Effect.Effect<void, KeyboardNativeFailure>;
  endDrag(
    sender: number,
  ): Effect.Effect<
    { success: boolean },
    KeyboardNativeFailure | KeyboardSenderRejected
  >;
  state(): EdenKeyboardState;
}

/** Interpret renderer requests at the native IPC boundary, retaining its protocol. */
export function bindKeyboardIpc(
  ipc: RendererIpcPort,
  requests: KeyboardRequests,
) {
  return Effect.gen(function* () {
    const run = yield* FiberSet.makeRuntimePromise<
      never,
      unknown,
      KeyboardNativeFailure | KeyboardSenderRejected
    >();
    yield* Effect.addFinalizer(() =>
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
    yield* Effect.sync(() => {
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
    });
  });
}
