import type { RuntimeAppManifest, UserProfile } from "@edenapp/types";
import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";
import {
  createEffectRuntime,
  type EffectRuntime,
} from "../../tests/support/effect-runtime";
import { createDaemons, type Daemons } from "./service";

const manifest = {
  id: "com.example.daemon",
  name: "Example daemon",
  version: "1.0.0",
  backend: { entry: "backend.js" },
} as RuntimeAppManifest;

describe("Daemons", () => {
  const definitions = new Map<string, string>();
  let processes: {
    launchDaemon: jest.Mock;
    stopApp: jest.Mock;
    getAppInstance: jest.Mock;
  };
  let daemons: Daemons;
  let getUser: jest.Mock<Effect.Effect<UserProfile | null, Error>, [string]>;
  let effects: EffectRuntime;
  let catalogAvailable: boolean;

  beforeEach(async () => {
    definitions.clear();
    catalogAvailable = true;
    effects = createEffectRuntime(TestClock.layer());
    processes = {
      launchDaemon: jest.fn().mockReturnValue(
        Effect.succeed({
          success: true,
          appId: manifest.id,
          instanceId: "instance",
        }),
      ),
      stopApp: jest.fn().mockReturnValue(Effect.void),
      getAppInstance: jest.fn().mockReturnValue(undefined),
    };
    getUser = jest.fn().mockReturnValue(Effect.succeed(null));
    daemons = await effects.acquire(
      createDaemons({
        catalog: {
          allApps: () => (catalogAvailable ? [manifest] : []),
          getApp: (appId) =>
            catalogAvailable && appId === manifest.id ? manifest : undefined,
        },
        processes,
        settings: {
          list: (appId) =>
            Effect.sync(() =>
              [...definitions.keys()]
                .filter((key) => key.startsWith(`${appId}:`))
                .map((key) => key.slice(appId.length + 1)),
            ),
          get: (appId, key) =>
            Effect.sync(() => definitions.get(`${appId}:${key}`)),
          set: (appId, key, value) =>
            Effect.sync(() => {
              definitions.set(`${appId}:${key}`, value);
            }),
          delete: (appId, key) =>
            Effect.sync(() => {
              definitions.delete(`${appId}:${key}`);
            }),
        },
        users: { getUser },
      }),
    );
  });
  afterEach(() => effects.dispose());

  async function configure(restart: "never" | "always" = "always") {
    const operator: UserProfile = {
      username: "operator",
      name: "Operator",
      role: "standard",
      grants: [],
      createdAt: 1,
      updatedAt: 1,
    };
    getUser.mockReturnValue(Effect.succeed(operator));
    const definition = {
      appId: manifest.id,
      enabled: false,
      runAs: { kind: "user" as const, username: operator.username },
      restart,
    };
    await effects.run(daemons.updateDefinition(definition));
    return definition;
  }

  it("discovers backend-only apps as disabled unassigned daemons", async () => {
    await effects.run(daemons.initialize());
    await expect(effects.run(daemons.list())).resolves.toMatchObject([
      {
        appId: manifest.id,
        state: "inactive",
        definition: {
          enabled: false,
          runAs: null,
          restart: "on-failure",
        },
      },
    ]);
  });

  it("ignores malformed stored definitions before they enter daemon state", async () => {
    const key = `com.eden:daemon.${manifest.id}`;
    const definition = {
      appId: manifest.id,
      enabled: false,
      runAs: null,
      restart: "always",
    };
    definitions.set(
      key,
      JSON.stringify({ ...definition, restart: "sometimes" }),
    );

    await effects.run(daemons.initialize());
    expect((await effects.run(daemons.list()))[0]).toMatchObject({
      state: "inactive",
      definition: { enabled: false, runAs: null, restart: "on-failure" },
    });

    definitions.set(key, JSON.stringify(definition));
    expect((await effects.run(daemons.list()))[0].definition).toEqual(
      definition,
    );
  });

  it("adopts persisted edits immediately without restarting", async () => {
    const operator: UserProfile = {
      username: "operator",
      name: "Operator",
      role: "standard",
      grants: ["preset/daemon/manage"],
      createdAt: 1,
      updatedAt: 1,
    };
    getUser.mockReturnValue(Effect.succeed(operator));
    await effects.run(daemons.initialize());
    await effects.run(
      daemons.updateDefinition({
        appId: manifest.id,
        enabled: true,
        runAs: { kind: "user", username: operator.username },
        restart: "always",
      }),
    );

    expect(processes.launchDaemon).not.toHaveBeenCalled();
    expect((await effects.run(daemons.list()))[0]).toMatchObject({
      definition: {
        enabled: true,
        runAs: { kind: "user", username: operator.username },
        restart: "always",
      },
      restartRequired: false,
    });
    expect(processes.launchDaemon).not.toHaveBeenCalled();
  });

  it("requires an assigned account before enabling or starting", async () => {
    await effects.run(daemons.initialize());
    await expect(
      effects.run(daemons.setEnabled(manifest.id, true)),
    ).rejects.toThrow("requires a runAs account");
    await expect(effects.run(daemons.start(manifest.id))).rejects.toThrow(
      "requires a runAs account",
    );
  });

  it("applies restart policy when process/stop terminates a supervised daemon", async () => {
    const operator: UserProfile = {
      username: "operator",
      name: "Operator",
      role: "standard",
      grants: [],
      createdAt: 1,
      updatedAt: 1,
    };
    getUser.mockReturnValue(Effect.succeed(operator));
    await effects.run(daemons.initialize());
    await effects.run(
      daemons.updateDefinition({
        appId: manifest.id,
        enabled: true,
        runAs: { kind: "user", username: operator.username },
        restart: "always",
      }),
    );
    await effects.run(TestClock.adjust(Duration.seconds(5)));
    await effects.run(daemons.start(manifest.id));

    await effects.run(daemons.processStopped(manifest.id));

    expect((await effects.run(daemons.list()))[0]).toMatchObject({
      state: "backoff",
      restartCount: 1,
      nextRestartAt: 6000,
    });
    await effects.run(TestClock.adjust(Duration.millis(999)));
    expect(processes.launchDaemon).toHaveBeenCalledTimes(1);
    await effects.run(TestClock.adjust(Duration.millis(1)));
    expect(processes.launchDaemon).toHaveBeenCalledTimes(2);
    expect((await effects.run(daemons.list()))[0]).toMatchObject({
      state: "active",
      nextRestartAt: undefined,
    });
    await effects.run(daemons.shutdown());
  });

  it("suppresses restart policy for daemon/stop", async () => {
    const operator: UserProfile = {
      username: "operator",
      name: "Operator",
      role: "standard",
      grants: [],
      createdAt: 1,
      updatedAt: 1,
    };
    getUser.mockReturnValue(Effect.succeed(operator));
    await effects.run(daemons.initialize());
    await effects.run(
      daemons.updateDefinition({
        appId: manifest.id,
        enabled: true,
        runAs: { kind: "user", username: operator.username },
        restart: "always",
      }),
    );
    await effects.run(daemons.start(manifest.id));
    processes.getAppInstance.mockReturnValue({
      manifest,
      principal: { kind: "user", username: operator.username },
    });
    processes.stopApp.mockImplementation(() =>
      Effect.gen(function* () {
        processes.getAppInstance.mockReturnValue(undefined);
        yield* daemons.processStopped(manifest.id);
      }),
    );

    await effects.run(daemons.stop(manifest.id));

    expect((await effects.run(daemons.list()))[0]).toMatchObject({
      state: "inactive",
      restartCount: 0,
    });
  });

  it("retains an adopted process exit while its launch notification is queued", async () => {
    await configure();
    const adoption = daemons.processLaunched(manifest.id, "system");
    const exit = daemons.processExited(manifest.id, 1);
    await effects.run(adoption);
    await effects.run(exit);
    expect((await effects.run(daemons.list()))[0]).toMatchObject({
      state: "backoff",
      restartCount: 1,
    });
    await effects.run(TestClock.adjust(Duration.seconds(1)));
    expect(processes.launchDaemon).toHaveBeenCalledTimes(1);
  });

  it("uses saved restart-policy edits for the next exit of a running daemon", async () => {
    const definition = await configure();
    await effects.run(daemons.start(manifest.id));
    await effects.run(
      daemons.updateDefinition({ ...definition, restart: "never" }),
    );
    await effects.run(daemons.processExited(manifest.id, 1));
    expect((await effects.run(daemons.list()))[0]).toMatchObject({
      state: "failed",
      restartCount: 0,
    });
    await effects.run(TestClock.adjust(Duration.seconds(30)));
    expect(processes.launchDaemon).toHaveBeenCalledTimes(1);
  });

  it.each(["stop", "shutdown"] as const)(
    "cancels a pending retry during daemon %s",
    async (action) => {
      await configure();
      await effects.run(daemons.start(manifest.id));
      await effects.run(daemons.processExited(manifest.id, 1));
      if (action === "stop") await effects.run(daemons.stop(manifest.id));
      else await effects.run(daemons.shutdown());
      await effects.run(TestClock.adjust(Duration.seconds(31)));
      expect(processes.launchDaemon).toHaveBeenCalledTimes(1);
      if (action === "stop")
        expect((await effects.run(daemons.list()))[0]).toMatchObject({
          state: "inactive",
          restartCount: 0,
        });
    },
  );

  it("awaits interrupted startup cleanup before daemon shutdown completes", async () => {
    await configure();
    const starting = Deferred.makeUnsafe<void>();
    const cleaning = Deferred.makeUnsafe<void>();
    const cleaned = Deferred.makeUnsafe<void>();
    processes.launchDaemon.mockReturnValue(
      Effect.gen(function* () {
        yield* Effect.addFinalizer(() =>
          Effect.andThen(
            Deferred.succeed(cleaning, undefined),
            Deferred.await(cleaned),
          ),
        );
        yield* Deferred.succeed(starting, undefined);
        yield* Effect.never;
      }).pipe(Effect.scoped),
    );
    const launch = effects.fork(daemons.start(manifest.id));
    await effects.run(Deferred.await(starting));
    const shutdown = effects.fork(daemons.shutdown());
    await effects.run(Deferred.await(cleaning));
    try {
      expect(shutdown.pollUnsafe()).toBeUndefined();
    } finally {
      await effects.run(Deferred.succeed(cleaned, undefined));
    }
    await effects.run(Fiber.join(shutdown));
    const exit = await effects.run(Fiber.await(launch));
    expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(
      true,
    );
    await effects.run(TestClock.adjust(Duration.seconds(31)));
    expect(processes.launchDaemon).toHaveBeenCalledTimes(1);
  });
  it("removes daemon configuration and pending supervision after its package leaves the catalog", async () => {
    const operator: UserProfile = {
      username: "operator",
      name: "Operator",
      role: "standard",
      grants: [],
      createdAt: 1,
      updatedAt: 1,
    };
    getUser.mockReturnValue(Effect.succeed(operator));
    await effects.run(daemons.initialize());
    await effects.run(
      daemons.updateDefinition({
        appId: manifest.id,
        enabled: true,
        runAs: { kind: "user", username: operator.username },
        restart: "always",
      }),
    );
    await effects.run(daemons.start(manifest.id));
    await effects.run(daemons.processStopped(manifest.id));
    expect((await effects.run(daemons.list()))[0]).toMatchObject({
      state: "backoff",
      restartCount: 1,
    });
    catalogAvailable = false;
    await effects.run(daemons.packageUninstalled(manifest.id));
    expect(definitions.has(`com.eden:daemon.${manifest.id}`)).toBe(false);
    await effects.run(TestClock.adjust(Duration.seconds(31)));
    expect(processes.launchDaemon).toHaveBeenCalledTimes(1);
    catalogAvailable = true;
    expect((await effects.run(daemons.list()))[0]).toMatchObject({
      state: "inactive",
      restartCount: 0,
      definition: { enabled: false, runAs: null, restart: "on-failure" },
    });
  });
});
