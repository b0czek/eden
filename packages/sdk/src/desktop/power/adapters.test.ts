import assert from "node:assert/strict";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { createPowerHost } from "./adapters";

it.each(["poweroff", "reboot"] as const)(
  "fails unavailable host %s through the Effect error channel",
  (action) => {
    const host = createPowerHost({});
    assert(host);
    expect(host.getCapabilities()[action]).toBe(false);
    const exit = Effect.runSync(Effect.exit(host.perform(action)));
    assert(Exit.isFailure(exit));
    expect(Cause.hasDies(exit.cause)).toBe(false);
    expect(Cause.squash(exit.cause)).toMatchObject({
      _tag: "PowerUnavailable",
      action,
      reason: "action",
    });
  },
);
