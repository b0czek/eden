import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { UserProfile } from "@edenapp/types";
import * as Effect from "effect/Effect";
import { createDevelopmentAutostart } from "../../../src/autostart/development";
import {
  AutostartProcesses,
  AutostartSessions,
  DevelopmentAutostart,
} from "../../../src/autostart/ports";
import { createAutostartProcesses } from "../../../src/autostart/processes";
import {
  Autostart,
  AutostartDevelopment,
  AutostartLive,
  AutostartLoginAppId,
  AutostartSettings,
} from "../../../src/autostart/service";
import { fromPromise } from "../../../src/effects/io";
import { AppsDirectory } from "../../../src/runtime/inputs";
import {
  SettingsAuthorization,
  SettingsCatalog,
  SettingsStorage,
} from "../../../src/settings/ports";
import { Settings, SettingsLive } from "../../../src/settings/service";
import { SqliteSettingsStorageLive } from "../../../src/settings/sqlite-storage";
import { testApp } from "../../support/apps";
import { gate, tick } from "../../support/async";
import { createTestEden, type TestEden } from "../../support/createTestEden";
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
      Effect.provideService(SettingsAuthorization, { hasGrant: () => false }),
    ),
  );
  const processes = eden.runtime.services.processes;
  const autostartProcesses = createAutostartProcesses(
    {
      getAppInstance: (appId) => processes.getAppInstance(appId),
      getInstalledManifest: (appId) => processes.getInstalledManifest(appId),
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
    eden.runtime.services.execution,
  );
  const sessionContext = eden.runtime.services.sessionContext;
  const sessions = eden.runtime.services.sessions;
  const autostart = await effects.acquire(
    buildService(Autostart, AutostartLive).pipe(
      Effect.provideService(AutostartDevelopment, options.development ?? false),
      Effect.provideService(AutostartLoginAppId, options.loginAppId),
      Effect.provideService(AutostartSettings, settings),
      Effect.provideService(AutostartSessions, {
        currentUser: () => sessionContext.getCurrentUser(),
        changed: { on: (listener) => sessions.changed.on(listener) },
      }),
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
    expect(s.processes.getAppInstance(app.id)).toMatchObject({
      principal: { kind: "user", username: user.username },
    });
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
