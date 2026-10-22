import * as Duration from "effect/Duration";
import * as TestClock from "effect/testing/TestClock";
import { createEffectRuntime } from "../../../tests/support/effect-runtime";
import { createPointerTracking } from "./pointer";

it("resumes polling after synchronous unsubscribe and resubscribe", async () => {
  const effects = createEffectRuntime(TestClock.layer());
  let position = { x: 0, y: 0 };
  const changed = jest.fn();
  try {
    const pointer = await effects.acquire(
      createPointerTracking({ getCursorScreenPoint: () => position }, 20),
    );
    pointer.subscribe("view", changed);
    pointer.unsubscribe("view");
    expect(pointer.isTracking()).toBe(false);
    pointer.subscribe("view", changed);
    expect(pointer.isTracking()).toBe(true);
    position = { x: 10, y: 20 };
    await effects.run(TestClock.adjust(Duration.millis(20)));
    expect(changed.mock.calls).toEqual([[{ x: 10, y: 20, deltaTime: 20 }]]);
    pointer.unsubscribe("view");
    position = { x: 30, y: 40 };
    await effects.run(TestClock.adjust(Duration.millis(20)));
    expect(changed.mock.calls).toHaveLength(1);
  } finally {
    await effects.dispose();
  }
});

it("measures pointer update deltas with the same clock that schedules polling", async () => {
  const effects = createEffectRuntime(TestClock.layer());
  let position = { x: 0, y: 0 };
  const changed = jest.fn();
  try {
    const pointer = await effects.acquire(
      createPointerTracking({ getCursorScreenPoint: () => position }, 20),
    );
    pointer.subscribe("view", changed);
    position = { x: 10, y: 20 };

    await effects.run(TestClock.adjust(Duration.millis(19)));
    expect(changed).not.toHaveBeenCalled();
    await effects.run(TestClock.adjust(Duration.millis(1)));
    expect(changed.mock.calls).toEqual([[{ x: 10, y: 20, deltaTime: 20 }]]);

    position = { x: 30, y: 40 };
    await effects.run(TestClock.adjust(Duration.millis(20)));
    expect(changed).toHaveBeenLastCalledWith({ x: 30, y: 40, deltaTime: 20 });
  } finally {
    await effects.dispose();
  }
});
