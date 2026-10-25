import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { UserProfile } from "@edenapp/types";
import * as Effect from "effect/Effect";
import { createDevelopmentAutostart } from "../../../src/applications/autostart/development";
import {
  AutostartConfig,
  AutostartProcesses,
  DevelopmentAutostart,
} from "../../../src/applications/autostart/ports";
import { createAutostartProcesses } from "../../../src/applications/autostart/processes";
import {
  Autostart,
  AutostartLive,
} from "../../../src/applications/autostart/service";
import { fromPromise } from "../../../src/core/effects/io";
import { ExecutionContext } from "../../../src/core/execution/context";
import { Operations } from "../../../src/core/operations/service";
import {
  SettingsCatalog,
  SettingsStorage,
} from "../../../src/core/settings/ports";
import { Settings, SettingsLive } from "../../../src/core/settings/service";
import { SqliteSettingsStorageLive } from "../../../src/core/settings/sqlite-storage";
import { SessionContext } from "../../../src/desktop/session/context";
import { Sessions } from "../../../src/desktop/session/service";
import { AppsDirectory } from "../../../src/runtime/inputs";
import { testApp } from "../../support/apps";
import { gate, tick } from "../../support/async";
import { createTestExecutionContext } from "../../support/callers";
import { createTestEden, type TestEden } from "../../support/create-test-eden";
import {
  buildService,
  createEffectRuntime,
} from "../../support/effect-runtime";

const vendor: UserProfile = {
  username: "setup",
  name: "Setup",
  role: "vendor",
  grants: [],
  createdAt: 0,
  updatedAt: 0,
};
const cleanups: Array<() => Promise<void>> = [];

async function environment(config?: Parameters<typeof createTestEden>[0]) {
  const eden = await createTestEden(config);
  cleanups.unshift(() => eden.dispose());
  return eden;
}

async function setAutostart(eden: TestEden, appId: string, enabled = true) {
  await eden.execute(
    "settings/set/su",
    { appId: "com.eden", key: `autostart.${appId}`, value: String(enabled) },
    { principal: { kind: "user", profile: vendor } },
  );
}

function launched(eden: TestEden, appId: string) {
  const processes = eden.runtime.services.processes;
  const result = gate();
  const stop = processes.launched.on(({ instance }) => {
    if (instance.manifest.id === appId) {
      stop();
      result.release();
    }
  });
  cleanups.unshift(async () => stop());
  return result.promise;
}

async function scopedAutostart(
  eden: TestEden,
  options: {
    development?: boolean;
    loginAppId?: string;
    stateDirectory?: string;
    beforeList?: () => Promise<void>;
    beforeLaunch?: (appId: string) => Promise<void>;
  } = {},
) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "eden-autostart-"));
  const effects = createEffectRuntime();
  cleanups.unshift(async () => {
    await effects.dispose();
    await fs.rm(directory, { recursive: true, force: true });
  });
  const storage = buildService(SettingsStorage, SqliteSettingsStorageLive).pipe(
    Effect.provideService(AppsDirectory, directory),
  );
  const settings = await effects.acquire(
    buildService(Settings, SettingsLive).pipe(
      Effect.provideServiceEffect(
        SettingsStorage,
        Effect.map(storage, (connection) => ({
          ...connection,
          keys: () =>
            Effect.gen(function* () {
              if (options.beforeList)
                yield* fromPromise(options.beforeList).pipe(Effect.orDie);
              return yield* connection.keys();
            }),
        })),
      ),
      Effect.provideService(SettingsCatalog, {
        getAppSettings: () => undefined,
      }),
      Effect.provideServiceEffect(
        ExecutionContext,
        createTestExecutionContext(() => false),
      ),
    ),
  );
  const processes = eden.runtime.services.processes;
  const autostartProcesses = createAutostartProcesses(
    {
      getAppInstance: (appId) => processes.getAppInstance(appId),
      launchApp: (appId, bounds, launchArgs, location) =>
        Effect.gen(function* () {
          const beforeLaunch = options.beforeLaunch;
          if (beforeLaunch)
            yield* fromPromise(() => beforeLaunch(appId)).pipe(Effect.orDie);
          return yield* processes.launchApp(
            appId,
            bounds,
            launchArgs,
            location,
          );
        }),
    },
    eden.runtime.services.catalog,
  );
  const sessions = eden.runtime.services.sessions;
  const autostart = await effects.acquire(
    buildService(Autostart, AutostartLive).pipe(
      Effect.provideService(AutostartConfig, {
        development: options.development ?? false,
        loginAppId: options.loginAppId,
      }),
      Effect.provideService(Settings, settings),
      Effect.provideService(Sessions, sessions),
      Effect.provideService(
        SessionContext,
        eden.runtime.services.sessionContext,
      ),
      Effect.provideService(Operations, eden.runtime.services.operations),
      Effect.provideService(AutostartProcesses, autostartProcesses),
      Effect.provideService(
        DevelopmentAutostart,
        createDevelopmentAutostart({
          hotReload: { stateDirectory: options.stateDirectory },
        }),
      ),
    ),
  );
  const set = (appId: string, enabled = true) =>
    effects.run(
      settings.set("com.eden", `autostart.${appId}`, String(enabled)),
    );
  return { effects, autostart, settings, set, processes };
}

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

describe("autostart session, settings and process composition", () => {
  it("waits for a cancelled settings read on logout and starts the next session under its own authority", async () => {
    const eden = await environment();
    const aliceApp = testApp("com.example.alice-autostart");
    const bobApp = testApp("com.example.bob-autostart");
    const { installedPackages, operations, processes, sessionContext } =
      eden.runtime.services;
    for (const app of [aliceApp, bobApp]) installedPackages.register(app);
    const reading = gate();
    const resume = gate();
    const s = await scopedAutostart(eden, {
      beforeList: async () => {
        reading.release();
        await resume.promise;
      },
    });
    await s.set(aliceApp.id);
    await s.set(bobApp.id);
    await eden.runtime.effects.run(
      eden.runtime.users.create({
        username: "alice",
        name: "Alice",
        password: "password",
        grants: [`apps/launch/${aliceApp.id}`, `apps/launch/${bobApp.id}`],
        directoryRestriction: "alice",
      }),
    );
    await eden.runtime.effects.run(
      eden.runtime.users.create({
        username: "bob",
        name: "Bob",
        password: "password",
        grants: [`apps/launch/${bobApp.id}`],
      }),
    );
    s.autostart.onFoundationReady();
    try {
      await eden.complete("session/login", {
        username: "alice",
        password: "password",
      });
      await reading.promise;
      const startup = operations
        .inspectAll()
        .find(
          (operation) =>
            operation.command === "autostart/session" &&
            operation.status === "running",
        );
      expect(startup).toBeDefined();
      let loggedOut = false;
      const logout = eden.complete("session/logout").then(() => {
        loggedOut = true;
      });
      await tick();
      expect(loggedOut).toBe(false);
      expect(sessionContext.getCurrentUser()?.username).toBe("alice");
      if (startup)
        expect(operations.inspect(startup)).toMatchObject({
          phase: "cancelling",
        });
      resume.release();
      await logout;
      if (startup)
        expect(operations.inspect(startup)).toMatchObject({
          status: "cancelled",
        });
      expect(processes.getAppInstance(aliceApp.id)).toBeUndefined();
      const bobStarted = launched(eden, bobApp.id);
      await eden.complete("session/login", {
        username: "bob",
        password: "password",
      });
      await bobStarted;
      expect(processes.getAppInstance(aliceApp.id)).toBeUndefined();
      expect(processes.getAppInstance(bobApp.id)).toMatchObject({
        owner: {
          kind: "session",
          username: "bob",
          sessionId: sessionContext.getSessionId(),
        },
        principal: { kind: "user", username: "bob" },
      });
    } finally {
      resume.release();
      await s.effects.run(s.autostart.shutdown());
    }
  });

  it("cancels a starting autostart backend on logout without waiting for backend readiness", async () => {
    const eden = await environment();
    const first = testApp("com.example.starting-private", {
      backend: { entry: "backend.js" },
    });
    const second = testApp("com.example.late-private");
    const { installedPackages, processes, views, sessionContext, operations } =
      eden.runtime.services;
    for (const app of [first, second]) {
      installedPackages.register(app);
      await setAutostart(eden, app.id);
    }
    const user = await eden.runtime.effects.run(
      eden.runtime.users.create({
        username: "private-user",
        name: "Private User",
        password: "password",
        grants: ["apps/launch/*"],
        directoryRestriction: "private-user",
      }),
    );
    const native = gate();
    const fork = eden.platform.utilityProcesses.fork.bind(
      eden.platform.utilityProcesses,
    );
    const observe = jest
      .spyOn(eden.platform.utilityProcesses, "fork")
      .mockImplementation((...args) => {
        const process = fork(...args);
        native.release();
        return process;
      });
    let logout: Promise<unknown> | undefined;
    try {
      await eden.complete("session/login", {
        username: user.username,
        password: "password",
      });
      await native.promise;
      expect(eden.runtime.services.backends.hasBackend(first.id)).toBe(true);
      const startup = operations
        .inspectAll()
        .find(
          (operation) =>
            operation.command === "autostart/session" &&
            operation.status === "running",
        );
      expect(startup).toBeDefined();
      logout = eden.complete("session/logout");
      await logout;
      await tick();
      expect(sessionContext.getCurrentUser()).toBeNull();
      expect(processes.getRunningApps(true)).toEqual([]);
      expect(views.getAllViews()).toEqual([]);
      expect(eden.runtime.services.backends.hasBackend(first.id)).toBe(false);
      if (startup)
        expect(operations.inspect(startup)).toMatchObject({
          status: "cancelled",
        });
    } finally {
      observe.mockRestore();
      eden.runtime.services.backends.getBackend(first.id)?.kill();
      await logout;
    }
  });

  it("launches an enabled app under the user principal after a real session transition", async () => {
    const eden = await environment();
    const app = testApp("com.example.autostart");
    eden.runtime.services.installedPackages.register(app);
    await setAutostart(eden, app.id);
    const user = await eden.runtime.effects.run(
      eden.runtime.users.create({
        username: "autostart-user",
        name: "Autostart User",
        password: "password",
        grants: [`apps/launch/${app.id}`],
      }),
    );
    const started = launched(eden, app.id);
    await eden.runtime.effects.run(
      eden.runtime.sessions.login(user.username, "password"),
    );
    await started;
    expect(
      eden.runtime.services.processes.getAppInstance(app.id),
    ).toMatchObject({ principal: { kind: "user", username: user.username } });
  });

  it("drains a pending Settings read and prevents its app launch before shutdown", async () => {
    const eden = await environment();
    const app = testApp("com.example.delayed-autostart");
    eden.runtime.services.installedPackages.register(app);
    const listStarted = gate();
    const settingsPending = gate();
    const s = await scopedAutostart(eden, {
      beforeList: async () => {
        listStarted.release();
        await settingsPending.promise;
      },
    });
    await s.set(app.id);
    const user = await eden.runtime.effects.run(
      eden.runtime.users.create({
        username: "delayed-user",
        name: "Delayed User",
        password: "password",
        grants: [`apps/launch/${app.id}`],
      }),
    );
    s.autostart.onFoundationReady();
    await eden.runtime.effects.run(
      eden.runtime.sessions.login(user.username, "password"),
    );
    await listStarted.promise;
    let settled = false;
    const shutdown = s.effects.run(s.autostart.shutdown()).then(() => {
      settled = true;
    });
    try {
      await tick();
      expect(settled).toBe(false);
    } finally {
      settingsPending.release();
      await shutdown;
    }
    expect(s.processes.getAppInstance(app.id)).toBeUndefined();
    s.autostart.onFoundationReady();
    await tick();
    expect(s.processes.getAppInstance(app.id)).toBeUndefined();
  });

  it("waits for a launch already admitted by the process adapter before shutdown completes", async () => {
    const eden = await environment();
    const app = testApp("com.example.starting-autostart");
    eden.runtime.services.installedPackages.register(app);
    const started = gate();
    const finish = gate();
    const s = await scopedAutostart(eden, {
      beforeLaunch: async () => {
        started.release();
        await finish.promise;
      },
    });
    await s.set(app.id);
    const user = await eden.runtime.effects.run(
      eden.runtime.users.create({
        username: "starting-user",
        name: "Starting User",
        password: "password",
        grants: [`apps/launch/${app.id}`],
      }),
    );
    s.autostart.onFoundationReady();
    await eden.runtime.effects.run(
      eden.runtime.sessions.login(user.username, "password"),
    );
    await started.promise;
    let settled = false;
    const shutdown = s.effects.run(s.autostart.shutdown()).then(() => {
      settled = true;
    });
    try {
      await tick();
      expect(settled).toBe(false);
    } finally {
      finish.release();
      await shutdown;
    }
    expect(s.processes.getAppInstance(app.id)).toBeUndefined();
  });

  it("launches development apps before login, ignores disabled entries and running apps", async () => {
    const stateDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), "eden-autostart-state-"),
    );
    cleanups.push(() =>
      fs.rm(stateDirectory, { recursive: true, force: true }),
    );
    const eden = await environment({
      config: {
        development: true,
        hotReload: {
          enabled: false,
          stateDirectory: path.join(stateDirectory, "runtime"),
        },
      },
    });
    const registry = eden.runtime.services.installedPackages;
    const dev = testApp("com.example.development-autostart", {
      isDevelopment: true,
    });
    const ignored = testApp("com.example.development-disabled", {
      isDevelopment: true,
    });
    const login = testApp("com.example.development-login", {
      isDevelopment: true,
    });
    const existing = testApp("com.example.development-running", {
      isDevelopment: true,
    });
    for (const app of [dev, ignored, login, existing]) {
      const sourcePath = path.join(stateDirectory, app.id);
      await fs.mkdir(sourcePath);
      await fs.writeFile(
        path.join(sourcePath, "index.html"),
        "<!doctype html><title>Development app</title>",
      );
      registry.register(app, { sourcePath });
    }
    await eden.runtime.effects.run(
      eden.runtime.services.processes.launchApp(existing.id),
    );
    await fs.writeFile(
      path.join(stateDirectory, "apps.json"),
      JSON.stringify({
        protocolVersion: 1,
        apps: [
          {
            id: dev.id,
            sourcePath: path.join(stateDirectory, dev.id),
            launchOnStart: true,
          },
          {
            id: ignored.id,
            sourcePath: path.join(stateDirectory, ignored.id),
            launchOnStart: false,
          },
          {
            id: existing.id,
            sourcePath: path.join(stateDirectory, existing.id),
            launchOnStart: true,
          },
        ],
      }),
    );
    const developmentStarted = gate();
    const finishDevelopment = gate();
    const s = await scopedAutostart(eden, {
      development: true,
      loginAppId: login.id,
      stateDirectory,
      beforeLaunch: async (appId) => {
        if (appId === dev.id) {
          developmentStarted.release();
          await finishDevelopment.promise;
        }
      },
    });
    const readyForLogin = launched(eden, login.id);
    s.autostart.onFoundationReady();
    s.autostart.onFoundationReady();
    await developmentStarted.promise;
    try {
      expect(s.processes.getAppInstance(login.id)).toBeUndefined();
    } finally {
      finishDevelopment.release();
    }
    await readyForLogin;
    expect(s.processes.getAppInstance(dev.id)).toBeDefined();
    expect(s.processes.getAppInstance(ignored.id)).toBeUndefined();
    await s.effects.run(s.autostart.shutdown());
    const startedApps = eden.platform.effects.filter(
      (effect) => effect.type === "view-created",
    );
    expect(startedApps).toHaveLength(3);
  });

  it("skips disabled and headless entries and continues after an unauthorized launch", async () => {
    const eden = await environment();
    const registry = eden.runtime.services.installedPackages;
    const allowed = testApp("com.example.allowed-autostart");
    const denied = testApp("com.example.denied-autostart");
    const headless = testApp("com.example.headless-autostart", {
      frontend: undefined,
      backend: { entry: "backend.js" },
    });
    const disabled = testApp("com.example.disabled-autostart");
    for (const app of [headless, denied, disabled, allowed])
      registry.register(app);
    const s = await scopedAutostart(eden);
    await s.set(headless.id);
    await s.set(denied.id);
    await s.set(disabled.id, false);
    await s.set(allowed.id);
    const user = await eden.runtime.effects.run(
      eden.runtime.users.create({
        username: "grant-user",
        name: "Grant User",
        password: "password",
        grants: [
          `apps/launch/${allowed.id}`,
          `apps/launch/${headless.id}`,
          `apps/launch/${disabled.id}`,
        ],
      }),
    );
    s.autostart.onFoundationReady();
    const started = launched(eden, allowed.id);
    await eden.runtime.effects.run(
      eden.runtime.sessions.login(user.username, "password"),
    );
    await started;
    await s.effects.run(s.autostart.shutdown());
    expect(s.processes.getAppInstance(denied.id)).toBeUndefined();
    expect(s.processes.getAppInstance(headless.id)).toBeUndefined();
    expect(s.processes.getAppInstance(disabled.id)).toBeUndefined();
  });
});
