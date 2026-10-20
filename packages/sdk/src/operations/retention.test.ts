import type { OperationHandle } from "@edenapp/types";
import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as TestClock from "effect/testing/TestClock";
import {
  buildService,
  createEffectRuntime,
} from "../../tests/support/effect-runtime";
import { ExecutionContext, ExecutionContextLive } from "../execution/context";
import { RuntimeConfig } from "../runtime/inputs";
import { SessionContext, SessionContextLive } from "../session/context";
import { OperationAdmissionClosed } from "./errors";
import { OperationsFilesystem } from "./ports";
import { operationQuotaLimits } from "./quota";
import { Operations, OperationsLive, operationRetentionMs } from "./service";
import { type OperationTask, operationTask } from "./task";

const serviceEffects = createEffectRuntime();
afterAll(() => serviceEffects.dispose());

describe("operation retention and admission capacity", () => {
  let effects: ReturnType<typeof createEffectRuntime>;
  let operations: Operations;
  let prepareWork: (args: { value: string }) => OperationTask<unknown>;
  const owner = { appId: "work.app", principal: { kind: "system" as const } };
  beforeEach(async () => {
    effects = createEffectRuntime(TestClock.layer());
    operations = await effects.acquire(
      buildService(Operations, OperationsLive).pipe(
        Effect.provideService(
          ExecutionContext,
          serviceEffects.acquireSync(
            buildService(ExecutionContext, ExecutionContextLive).pipe(
              Effect.provideService(RuntimeConfig, {}),
            ),
          ),
        ),
        Effect.provideService(
          SessionContext,
          serviceEffects.acquireSync(
            buildService(SessionContext, SessionContextLive),
          ),
        ),
        Effect.provideService(OperationsFilesystem, {
          releaseHandles: () => Effect.void,
        }),
      ),
    );
  });
  afterEach(() => effects.dispose());
  const register = (prepare: typeof prepareWork) => {
    prepareWork = prepare;
  };
  const submit = (value = "value", requestKey?: string) =>
    effects.run(
      Effect.sync(() =>
        operations.submit(
          "integration/work",
          { value },
          owner,
          () => prepareWork({ value }),
          { requestKey },
        ),
      ),
    );

  it("preserves tagged host preparation rejections without accepting work", async () => {
    const rejection = new OperationAdmissionClosed({
      sessionId: "closing-session",
    });
    const exit = await effects.run(
      Effect.exit(
        operations.runHost("host/work", {}, () => {
          throw rejection;
        }),
      ),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const failure = Cause.findErrorOption(exit.cause);
      expect(Option.isSome(failure) && failure.value).toBe(rejection);
      expect(Cause.hasDies(exit.cause)).toBe(false);
    }
    expect(operations.inspectAll()).toEqual([]);
  });

  it("keeps unexpected host preparation throws as defects", async () => {
    const defect = new Error("Invalid preparation state");
    const exit = await effects.run(
      Effect.exit(
        operations.runHost("host/work", {}, () => {
          throw defect;
        }),
      ),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasDies(exit.cause)).toBe(true);
      expect(Cause.hasFails(exit.cause)).toBe(false);
    }
    expect(operations.inspectAll()).toEqual([]);
  });

  it("timestamps admission, execution and completion with the service clock", async () => {
    const started = Deferred.makeUnsafe<void>();
    const finish = Deferred.makeUnsafe<string>();
    register(() =>
      operationTask(() =>
        Deferred.succeed(started, undefined).pipe(
          Effect.andThen(Deferred.await(finish)),
        ),
      ),
    );
    try {
      const handle = await submit();
      expect(operations.get(handle, owner)).toMatchObject({
        status: "queued",
        createdAt: 0,
        updatedAt: 0,
      });
      await effects.run(Deferred.await(started));
      expect(operations.get(handle, owner)).toMatchObject({
        status: "running",
        startedAt: 0,
      });
      await effects.run(TestClock.adjust(Duration.seconds(2)));
      Deferred.doneUnsafe(finish, Effect.succeed("done"));
      await effects.run(operations.wait(handle, owner));
      expect(operations.get(handle, owner)).toMatchObject({
        status: "succeeded",
        createdAt: 0,
        startedAt: 0,
        completedAt: 2000,
        updatedAt: 2000,
      });
    } finally {
      Deferred.doneUnsafe(finish, Effect.succeed("cleanup"));
    }
  });

  it("reserves capacity before preparation and retains results and keys until expiry", async () => {
    const blocked = Deferred.makeUnsafe<string>();
    let preparations = 0;
    register(({ value }) => {
      preparations++;
      return operationTask(() =>
        value === "active" ? Deferred.await(blocked) : Effect.succeed(value),
      );
    });
    try {
      const active = await submit("active", "active-key");
      const handles: OperationHandle[] = [];
      for (let i = 1; i < operationQuotaLimits.perAppLimit; i++) {
        const handle = await submit(String(i), `key-${i}`);
        handles.push(handle);
        await effects.run(operations.wait(handle, owner));
      }
      await expect(submit("rejected")).rejects.toMatchObject({
        _tag: "OperationCapacityExhausted",
        appId: owner.appId,
        capacity: "caller",
      });
      expect(preparations).toBe(operationQuotaLimits.perAppLimit);
      expect(await submit("active", "active-key")).toEqual(active);
      expect(await submit("1", "key-1")).toEqual(handles[0]);
      await expect(submit("different", "key-1")).rejects.toThrow(
        "different command or arguments",
      );
      // Session changes cannot multiply an app's allowance.
      await expect(
        effects.run(
          Effect.sync(() =>
            operations.submit(
              "integration/work",
              { value: "other-session" },
              { ...owner, sessionId: "other-session" },
              () => prepareWork({ value: "other-session" }),
            ),
          ),
        ),
      ).rejects.toThrow("capacity exhausted");
      await effects.run(
        TestClock.adjust(Duration.millis(operationRetentionMs - 1)),
      );
      expect(operations.list(owner)).toHaveLength(
        operationQuotaLimits.perAppLimit,
      );
      expect(await effects.run(operations.wait(handles[0], owner))).toBe("1");
      await expect(submit("still-full")).rejects.toThrow("capacity exhausted");
      await effects.run(TestClock.adjust(Duration.millis(1)));
      expect(operations.list(owner)).toHaveLength(1);
      expect(operations.get(active, owner).status).toBe("running");
      expect(() => operations.get(handles[0], owner)).toThrow("not found");
      const next = await submit("new-value", "key-1");
      expect(next.id).not.toBe(handles[0].id);
      await expect(effects.run(operations.wait(next, owner))).resolves.toBe(
        "new-value",
      );
      Deferred.doneUnsafe(blocked, Effect.succeed("active"));
      await effects.run(operations.wait(active, owner));
      await effects.run(
        TestClock.adjust(Duration.millis(operationRetentionMs - 1)),
      );
      expect(operations.get(active, owner).status).toBe("succeeded");
      await effects.run(TestClock.adjust(Duration.millis(1)));
      expect(operations.list(owner)).toEqual([]);
    } finally {
      Deferred.doneUnsafe(blocked, Effect.succeed("active"));
    }
  });

  it("preserves app and host allowances with a full shared pool and reclaims expired burst capacity", async () => {
    const blocked = Deferred.makeUnsafe<string>();
    register(({ value }) =>
      operationTask(() =>
        value === "active" ? Deferred.await(blocked) : Effect.succeed(value),
      ),
    );
    const callers = [
      owner,
      ...["busy.app", "burst.app", "quiet.app"].map((appId) => ({
        ...owner,
        appId,
      })),
    ];
    const submitFor = (
      caller: typeof owner | { principal: typeof owner.principal },
      value = "active",
    ) =>
      effects.run(
        Effect.sync(() =>
          operations.submit("integration/work", { value }, caller, () =>
            prepareWork({ value }),
          ),
        ),
      );
    try {
      let remainingShared = operationQuotaLimits.sharedLimit;
      for (const caller of callers.slice(0, 3)) {
        const burst = Math.min(
          remainingShared,
          operationQuotaLimits.perAppLimit -
            operationQuotaLimits.reservedPerApp,
        );
        remainingShared -= burst;
        for (let i = 0; i < operationQuotaLimits.reservedPerApp + burst; i++) {
          const handle = await submitFor(
            caller,
            caller === owner ? "done" : "active",
          );
          if (caller === owner)
            await effects.run(operations.wait(handle, caller));
        }
      }
      expect(remainingShared).toBe(0);
      await expect(submitFor(callers[2])).rejects.toThrow(
        "Shared operation capacity exhausted",
      );
      // A new app and the host still get their entire reserved allowance.
      const host = { principal: owner.principal };
      for (const caller of [callers[3], host]) {
        for (let i = 0; i < operationQuotaLimits.reservedPerApp; i++)
          await submitFor(caller);
        expect(operations.list(caller)).toHaveLength(
          operationQuotaLimits.reservedPerApp,
        );
        expect(
          operations
            .list(caller)
            .every((snapshot) => snapshot.status === "queued"),
        ).toBe(true);
        await expect(submitFor(caller)).rejects.toThrow(
          "Shared operation capacity exhausted",
        );
      }
      await effects.run(
        TestClock.adjust(Duration.millis(operationRetentionMs)),
      );
      // Only the first app's completed records expire; active records stay.
      expect(operations.list(owner)).toEqual([]);
      expect(operations.list(callers[1])).toHaveLength(
        operationQuotaLimits.perAppLimit,
      );
      for (
        let i = operationQuotaLimits.reservedPerApp;
        i < operationQuotaLimits.perAppLimit;
        i++
      )
        await submitFor(callers[3]);
      expect(operations.list(callers[3])).toHaveLength(
        operationQuotaLimits.perAppLimit,
      );
      await expect(submitFor(callers[2])).rejects.toThrow(
        "Shared operation capacity exhausted",
      );
      // Reading or expiring another app's records never removes active work.
      expect(operations.list(callers[2])).toHaveLength(
        operationQuotaLimits.reservedPerApp +
          operationQuotaLimits.sharedLimit -
          2 *
            (operationQuotaLimits.perAppLimit -
              operationQuotaLimits.reservedPerApp),
      );
    } finally {
      Deferred.doneUnsafe(blocked, Effect.succeed("active"));
    }
    await effects.run(operations.drain());
  });
});
