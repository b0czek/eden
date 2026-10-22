import type {
  EdenKeyboardDragInput,
  EdenKeyboardDragPoint,
  EdenKeyboardStartDragRequest,
  EdenKeyboardUpdateDragRequest,
  ViewBounds,
} from "@edenapp/types";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FiberHandle from "effect/FiberHandle";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import type { DisplayPort } from "../../platform/ports/types";
import { type KeyboardNativeFailure, KeyboardSenderRejected } from "./errors";
import { effectivePlacement } from "./placement";
import type { KeyboardDragState, KeyboardState } from "./state";
import type { KeyboardOverlay } from "./window";

interface DragDependencies {
  state: KeyboardState;
  overlay: KeyboardOverlay;
  display: DisplayPort;
  schedule(
    work: Effect.Effect<void, KeyboardNativeFailure>,
    label: string,
  ): void;
}

function isValidDragInput(input: unknown): input is EdenKeyboardDragInput {
  return input === "system-cursor" || input === "renderer-events";
}

function isValidDragPoint(
  point: EdenKeyboardDragPoint | undefined,
): point is EdenKeyboardDragPoint {
  return Boolean(
    point &&
      typeof point.x === "number" &&
      typeof point.y === "number" &&
      Number.isFinite(point.x) &&
      Number.isFinite(point.y) &&
      (point.space === "screen" || point.space === "keyboard-client"),
  );
}

export function createKeyboardDrag({
  state,
  overlay,
  display,
  schedule,
}: DragDependencies) {
  return Effect.gen(function* () {
    let current: KeyboardDragState | null = null;
    const polling = yield* FiberHandle.make<void, never>();
    const forkPolling = yield* FiberHandle.runtime(polling)<never>();

    function end() {
      Option.getOrUndefined(FiberHandle.getUnsafe(polling))?.interruptUnsafe();
      const bounds = overlay.bounds();
      if (current && bounds) state.floatingBounds = bounds;
      current = null;
    }

    function resolvePoint(point: EdenKeyboardDragPoint) {
      const bounds = overlay.bounds();
      if (point.space === "screen" || !bounds)
        return { x: point.x, y: point.y };
      return {
        x: bounds.x + Math.round(point.x * state.preferences.interfaceScale),
        y: bounds.y + Math.round(point.y * state.preferences.interfaceScale),
      };
    }

    function constrain(bounds: ViewBounds): ViewBounds {
      const area = display.getDisplayMatching(bounds).workArea;
      const maxX = area.x + Math.max(0, area.width - bounds.width);
      const maxY = area.y + Math.max(0, area.height - bounds.height);
      return {
        ...bounds,
        x: Math.min(Math.max(bounds.x, area.x), maxX),
        y: Math.min(Math.max(bounds.y, area.y), maxY),
      };
    }

    function apply(screenX: number, screenY: number) {
      return Effect.gen(function* () {
        if (!current || !overlay.bounds()) return;
        const bounds = constrain({
          ...current.startBounds,
          x: Math.round(current.startBounds.x + screenX - current.startPoint.x),
          y: Math.round(current.startBounds.y + screenY - current.startPoint.y),
        });
        if (current.lastX === bounds.x && current.lastY === bounds.y) return;
        current.lastX = bounds.x;
        current.lastY = bounds.y;
        yield* overlay.position(bounds);
        state.floatingBounds = bounds;
      });
    }

    function start(
      sender: number,
      payload: EdenKeyboardStartDragRequest | undefined,
    ) {
      return Effect.gen(function* () {
        if (!overlay.isSender(sender))
          return yield* Effect.fail(
            new KeyboardSenderRejected({ sender, operation: "start-drag" }),
          );
        const bounds = overlay.bounds();
        if (
          effectivePlacement(state) !== "floating" ||
          !bounds ||
          !payload ||
          !isValidDragInput(payload.input) ||
          !isValidDragPoint(payload.point)
        )
          return { success: false };
        const startPoint = resolvePoint(payload.point);
        end();
        current = { input: payload.input, startPoint, startBounds: bounds };
        if (payload.input === "system-cursor") {
          let lastPosition = display.getCursorScreenPoint();
          forkPolling(
            Effect.sync(() => {
              const position = display.getCursorScreenPoint();
              if (
                Math.abs(position.x - lastPosition.x) < 1 &&
                Math.abs(position.y - lastPosition.y) < 1
              )
                return;
              lastPosition = position;
              schedule(
                apply(position.x, position.y),
                "Failed to move keyboard overlay:",
              );
            }).pipe(
              Effect.schedule(Schedule.spaced(Duration.millis(8))),
              Effect.asVoid,
            ),
          );
        }
        return { success: true };
      });
    }

    function update(
      sender: number,
      payload: EdenKeyboardUpdateDragRequest | undefined,
    ) {
      return Effect.gen(function* () {
        if (
          !overlay.isSender(sender) ||
          !current ||
          !payload ||
          !isValidDragPoint(payload.point) ||
          current.input !== "renderer-events"
        )
          return;
        const point = resolvePoint(payload.point);
        yield* apply(point.x, point.y);
      });
    }

    function finish(sender: number) {
      return Effect.gen(function* () {
        if (!overlay.isSender(sender))
          return yield* Effect.fail(
            new KeyboardSenderRejected({ sender, operation: "end-drag" }),
          );
        end();
        return { success: true };
      });
    }

    yield* Effect.addFinalizer(() => Effect.sync(end));
    return { start, update, finish, end, active: () => current !== null };
  });
}
