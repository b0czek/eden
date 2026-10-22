import type { EdenConfig, UserProfile } from "@edenapp/types";
import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import {
  buildService,
  createEffectRuntime,
} from "../../../tests/support/effect-runtime";
import { RuntimeConfig } from "../../runtime/inputs";
import { ExecutionContext, ExecutionContextLive } from "./context";

const serviceEffects = createEffectRuntime();
afterAll(() => serviceEffects.dispose());

const createUser = (overrides: Partial<UserProfile> = {}): UserProfile => ({
  username: "operator",
  name: "Operator",
  role: "standard",
  grants: [],
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

describe("ExecutionContext authorization", () => {
  function acquireContext() {
    return serviceEffects.acquireSync(
      buildService(ExecutionContext, ExecutionContextLive).pipe(
        Effect.provideService(RuntimeConfig, {} as EdenConfig),
      ),
    );
  }

  it("restores the enclosing caller after a nested workflow defects", async () => {
    const context = acquireContext();
    const outer = { appId: "outer" };
    const inner = { appId: "inner" };
    const failure = new Error("callback failed");

    await serviceEffects.run(
      context.provide(
        Effect.gen(function* () {
          const exit = yield* Effect.exit(
            context.provide(
              Effect.sync(() => {
                expect(context.get()).toEqual(inner);
                throw failure;
              }),
              inner,
            ),
          );
          expect(Exit.isFailure(exit)).toBe(true);
          if (Exit.isFailure(exit))
            expect(Cause.squash(exit.cause)).toBe(failure);
          expect(yield* context.current).toEqual(outer);
        }),
        outer,
      ),
    );
    expect(context.get()).toBeUndefined();
  });

  it("binds lazy concurrent Effects without leaking or replacing their caller", async () => {
    const context = acquireContext();
    const result = await serviceEffects.run(
      Effect.gen(function* () {
        const firstStarted = yield* Deferred.make<void>();
        const releaseFirst = yield* Deferred.make<void>();
        const first = context.provide(
          Effect.gen(function* () {
            yield* Deferred.succeed(firstStarted, undefined);
            yield* Deferred.await(releaseFirst);
            return context.get()?.appId;
          }),
          { appId: "first" },
        );
        expect(context.get()).toBeUndefined();
        const second = context.provide(
          Effect.gen(function* () {
            yield* Deferred.await(firstStarted);
            const appId = context.get()?.appId;
            yield* Deferred.succeed(releaseFirst, undefined);
            return appId;
          }),
          { appId: "second" },
        );
        const values = yield* Effect.all([first, second], { concurrency: 2 });
        expect(context.get()).toBeUndefined();
        return values;
      }),
    );

    expect(result).toEqual(["first", "second"]);
  });

  it("denies authorization without a user principal", () => {
    const context = serviceEffects.acquireSync(
      buildService(ExecutionContext, ExecutionContextLive).pipe(
        Effect.provideService(RuntimeConfig, {} as EdenConfig),
      ),
    );

    expect(context.hasGrant("preset/files/read")).toBe(false);
    expect(context.canLaunchApp("app.one")).toBe(false);
  });

  it("applies grants and app launch policy to the effective principal", async () => {
    const context = serviceEffects.acquireSync(
      buildService(ExecutionContext, ExecutionContextLive).pipe(
        Effect.provideService(RuntimeConfig, {
          coreApps: ["app.core"],
          restrictedApps: ["app.restricted"],
        } as EdenConfig),
      ),
    );
    const profile = createUser({
      grants: ["apps/launch/app.allowed", "settings/com.eden/*"],
    });

    await serviceEffects.run(
      context.provide(
        Effect.sync(() => {
          expect(context.canLaunchApp("app.core")).toBe(true);
          expect(context.canLaunchApp("app.allowed")).toBe(true);
          expect(context.canLaunchApp("app.restricted")).toBe(false);
          expect(context.canLaunchApp("app.other")).toBe(false);
          expect(context.hasGrant("settings/com.eden/appearance.theme")).toBe(
            true,
          );
        }),
        { principal: { kind: "user", profile } },
      ),
    );
  });

  it("gives vendor principals unrestricted authorization", async () => {
    const context = serviceEffects.acquireSync(
      buildService(ExecutionContext, ExecutionContextLive).pipe(
        Effect.provideService(RuntimeConfig, {
          restrictedApps: ["app.restricted"],
        } as EdenConfig),
      ),
    );
    const profile = createUser({ role: "vendor" });

    await serviceEffects.run(
      context.provide(
        Effect.sync(() => {
          expect(context.hasGrant("anything")).toBe(true);
          expect(context.canLaunchApp("app.restricted")).toBe(true);
        }),
        { principal: { kind: "user", profile } },
      ),
    );
  });
});
