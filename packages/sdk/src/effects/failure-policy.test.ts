import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { log } from "../logging/logger";
import { logBackgroundFailure, logCleanupFailure } from "./failure-policy";

afterEach(() => jest.restoreAllMocks());

it("preserves background cancellation without logging it", async () => {
  const report = jest.spyOn(log, "error").mockImplementation(() => {});
  const exit = await Effect.runPromiseExit(
    Effect.interrupt.pipe(logBackgroundFailure("background")),
  );
  expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(
    true,
  );
  expect(report).not.toHaveBeenCalled();
});

it.each([
  Cause.fail(new Error("expected failure")),
  Cause.die(new Error("defect")),
  Cause.combine(Cause.interrupt(), Cause.fail(new Error("cleanup failed"))),
])(
  "reports a background failure, including failures accompanying cancellation",
  async (cause) => {
    const report = jest.spyOn(log, "error").mockImplementation(() => {});
    await expect(
      Effect.runPromise(
        Effect.failCause(cause).pipe(logBackgroundFailure("background")),
      ),
    ).resolves.toBeUndefined();
    expect(report).toHaveBeenCalledWith("background", Cause.squash(cause));
  },
);

it("continues cleanup after a cancelled phase and reports its cause", async () => {
  const report = jest.spyOn(log, "error").mockImplementation(() => {});
  await expect(
    Effect.runPromise(
      Effect.interrupt.pipe(
        logCleanupFailure("cleanup"),
        Effect.andThen(Effect.succeed("next phase")),
      ),
    ),
  ).resolves.toBe("next phase");
  expect(report).toHaveBeenCalledTimes(1);
});
