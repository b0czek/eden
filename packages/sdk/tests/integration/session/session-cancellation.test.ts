import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Semaphore from "effect/Semaphore";
import type { CommandCallerContext } from "../../../src/core/execution/context";
import {
  type OperationTask,
  operationTask,
} from "../../../src/core/operations/task";
import { gate, tick } from "../../support/async";
import { createTestEden, type TestEden } from "../../support/create-test-eden";

describe("operation cancellation at session end", () => {
  let eden: TestEden;
  let caller: CommandCallerContext;
  beforeEach(async () => {
    eden = await createTestEden();
    const user = await eden.runtime.effects.run(
      eden.runtime.users.create({
        username: "alice",
        name: "Alice",
        password: "password",
      }),
    );
    await eden.complete("session/login", {
      username: user.username,
      password: "password",
    });
    caller = {
      sessionId: eden.runtime.services.sessionContext.getSessionId(),
      principal: { kind: "user", profile: user },
    };
  });
  afterEach(() => eden.dispose());

  function submit(name: string, run: OperationTask<void>["run"]) {
    return eden.runtime.services.operations.submit(
      `integration/${name}`,
      {},
      caller,
      () => operationTask(run, { cancellable: true }),
    );
  }

  it("cancels queued and running jobs and waits for finalizers before committing logout", async () => {
    const { operations, sessionContext } = eden.runtime.services;
    const started = Deferred.makeUnsafe<void>();
    const cleaning = Deferred.makeUnsafe<void>();
    const finish = Deferred.makeUnsafe<void>();
    const order = Semaphore.makeUnsafe(1);
    let queuedRan = false;
    const active = submit("active", () =>
      order.withPermit(
        Effect.scoped(
          Effect.acquireRelease(Deferred.succeed(started, undefined), () =>
            Effect.andThen(
              Deferred.succeed(cleaning, undefined),
              Deferred.await(finish),
            ),
          ).pipe(Effect.andThen(Effect.never)),
        ),
      ),
    );
    await eden.runtime.effects.run(Deferred.await(started));
    const queued = submit("queued", () =>
      order.withPermit(
        Effect.sync(() => {
          queuedRan = true;
        }),
      ),
    );
    let committed = false;
    const logout = eden.complete("session/logout").then(() => {
      committed = true;
    });
    try {
      await eden.runtime.effects.run(Deferred.await(cleaning));
      expect(committed).toBe(false);
      expect(sessionContext.getCurrentUser()?.username).toBe("alice");
      expect(operations.inspect(active)).toMatchObject({
        status: "running",
        phase: "cancelling",
      });
      expect(() => submit("late", () => Effect.void)).toThrow("draining");
    } finally {
      await eden.runtime.effects.run(Deferred.succeed(finish, undefined));
      await logout;
    }
    expect(operations.inspect(active)).toMatchObject({ status: "cancelled" });
    expect(operations.inspect(queued)).toMatchObject({ status: "cancelled" });
    expect(queuedRan).toBe(false);
    expect(sessionContext.getCurrentUser()).toBeNull();
    const bob = await eden.runtime.effects.run(
      eden.runtime.users.create({
        username: "bob",
        name: "Bob",
        password: "password",
      }),
    );
    await eden.complete("session/login", {
      username: "bob",
      password: "password",
    });
    const nextCaller = {
      sessionId: sessionContext.getSessionId(),
      principal: { kind: "user" as const, profile: bob },
    };
    const next = operations.submit(
      "integration/next-session",
      {},
      nextCaller,
      () =>
        operationTask(() =>
          Effect.sync(() => eden.runtime.services.execution.get()),
        ),
    );
    await expect(
      eden.runtime.effects.run(operations.wait(next, nextCaller)),
    ).resolves.toMatchObject({
      sessionId: sessionContext.getSessionId(),
      principal: { kind: "user", profile: { username: "bob" } },
    });
  });

  it("keeps startup work running after failed authentication", async () => {
    const { operations, sessionContext } = eden.runtime.services;
    const started = Deferred.makeUnsafe<void>();
    let stopped = false;
    const active = submit("startup", () =>
      Effect.andThen(Deferred.succeed(started, undefined), Effect.never).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            stopped = true;
          }),
        ),
      ),
    );
    await eden.runtime.effects.run(Deferred.await(started));
    await expect(
      eden.complete("session/login", { username: "alice", password: "wrong" }),
    ).rejects.toThrow("Invalid credentials");
    expect(stopped).toBe(false);
    expect(operations.inspect(active)).toMatchObject({ status: "running" });
    expect(sessionContext.getSessionId()).toBe(caller.sessionId);
    await eden.complete("session/logout");
    expect(stopped).toBe(true);
    expect(operations.inspect(active)).toMatchObject({ status: "cancelled" });
  });

  it("finishes committed work instead of cancelling it", async () => {
    const { operations, sessionContext } = eden.runtime.services;
    const committed = Deferred.makeUnsafe<void>();
    const finish = Deferred.makeUnsafe<void>();
    const active = submit("committed", (reporter) =>
      Effect.gen(function* () {
        yield* reporter.commit;
        yield* Deferred.succeed(committed, undefined);
        yield* Deferred.await(finish);
      }),
    );
    await eden.runtime.effects.run(Deferred.await(committed));
    let loggedOut = false;
    const logout = eden.complete("session/logout").then(() => {
      loggedOut = true;
    });
    try {
      await tick();
      expect(loggedOut).toBe(false);
      expect(sessionContext.getCurrentUser()?.username).toBe("alice");
      expect(operations.inspect(active)).toMatchObject({
        status: "running",
        cancellable: false,
      });
    } finally {
      await eden.runtime.effects.run(Deferred.succeed(finish, undefined));
      await logout;
    }
    expect(operations.inspect(active)).toMatchObject({ status: "succeeded" });
  });

  it("allows a startup operation to request logout without waiting on itself", async () => {
    const changed = gate();
    const off = eden.runtime.services.sessions.changed.on(({ currentUser }) => {
      if (!currentUser) changed.release();
    });
    try {
      const requester = submit("logout-requester", () =>
        eden.runtime.sessions.logout(),
      );
      await changed.promise;
      expect(eden.runtime.services.sessionContext.getCurrentUser()).toBeNull();
      expect(eden.runtime.services.operations.inspect(requester)).toMatchObject(
        { status: "cancelled" },
      );
    } finally {
      off();
    }
  });

  it("cancels pending jobs and awaits their cleanup during runtime shutdown", async () => {
    const { operations } = eden.runtime.services;
    const started = Deferred.makeUnsafe<void>();
    const cleaning = Deferred.makeUnsafe<void>();
    const finish = Deferred.makeUnsafe<void>();
    const active = submit("shutdown", () =>
      Effect.scoped(
        Effect.acquireRelease(Deferred.succeed(started, undefined), () =>
          Effect.andThen(
            Deferred.succeed(cleaning, undefined),
            Deferred.await(finish),
          ),
        ).pipe(Effect.andThen(Effect.never)),
      ),
    );
    await eden.runtime.effects.run(Deferred.await(started));
    let stopped = false;
    const shutdown = eden.runtime.effects
      .run(operations.shutdown())
      .then(() => {
        stopped = true;
      });
    try {
      await eden.runtime.effects.run(Deferred.await(cleaning));
      expect(stopped).toBe(false);
      expect(operations.inspect(active)).toMatchObject({ phase: "cancelling" });
    } finally {
      await eden.runtime.effects.run(Deferred.succeed(finish, undefined));
      await shutdown;
    }
    expect(operations.inspect(active)).toMatchObject({ status: "cancelled" });
  });
});
