import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";
import { AppearanceSettings } from "../../../src/appearance/ports";
import { Appearance, AppearanceLive } from "../../../src/appearance/service";
import { createAppearanceSettings } from "../../../src/appearance/settings";
import { ExecutionContext } from "../../../src/execution/context";
import { I18n, I18nLive, I18nSettings } from "../../../src/i18n/service";
import { createI18nSettings } from "../../../src/i18n/settings";
import { AppsDirectory } from "../../../src/runtime/inputs";
import { SettingsCatalog, SettingsStorage } from "../../../src/settings/ports";
import { Settings, SettingsLive } from "../../../src/settings/service";
import { SqliteSettingsStorageLive } from "../../../src/settings/sqlite-storage";
import { createTestExecutionContext } from "../../support/callers";
import {
  buildService,
  createEffectRuntime,
} from "../../support/effect-runtime";

function settingsFactory(
  storage: Effect.Effect<SettingsStorage, Error, Scope.Scope>,
) {
  return buildService(Settings, SettingsLive).pipe(
    Effect.provideServiceEffect(SettingsStorage, storage),
    Effect.provideService(SettingsCatalog, { getAppSettings: () => undefined }),
    Effect.provideServiceEffect(
      ExecutionContext,
      createTestExecutionContext(() => true),
    ),
  );
}

it("keeps a missing first SQLite value aligned with its default in bulk reads", async () => {
  const appsDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), "eden-settings-bulk-"),
  );
  const effects = createEffectRuntime();
  try {
    const settings = await effects.acquire(
      buildService(Settings, SettingsLive).pipe(
        Effect.provideServiceEffect(
          SettingsStorage,
          buildService(SettingsStorage, SqliteSettingsStorageLive).pipe(
            Effect.provideService(AppsDirectory, appsDirectory),
          ),
        ),
        Effect.provideService(SettingsCatalog, {
          getAppSettings: () => undefined,
        }),
        Effect.provideServiceEffect(
          ExecutionContext,
          createTestExecutionContext(
            (grant) =>
              grant === "settings/com.eden/general.locale" ||
              grant === "settings/com.eden/general.interfaceScale",
          ),
        ),
      ),
    );
    await effects.run(
      settings.set("com.eden", "general.interfaceScale", "1.5"),
    );
    await expect(effects.run(settings.getAll("com.eden"))).resolves.toEqual({
      "general.locale": "en",
      "general.interfaceScale": "1.5",
    });
  } finally {
    await effects.dispose();
    await fs.rm(appsDirectory, { recursive: true, force: true });
  }
});

it("composes persisted settings with locale notifications and appearance state across restart", async () => {
  const appsDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), "eden-settings-composition-"),
  );
  const first = createEffectRuntime();
  const second = createEffectRuntime();
  try {
    const settings = await first.acquire(
      settingsFactory(
        buildService(SettingsStorage, SqliteSettingsStorageLive).pipe(
          Effect.provideService(AppsDirectory, appsDirectory),
        ),
      ),
    );
    const i18n = await first.acquire(
      buildService(I18n, I18nLive).pipe(
        Effect.provideService(I18nSettings, createI18nSettings(settings)),
      ),
    );
    const appearance = await first.acquire(
      buildService(Appearance, AppearanceLive).pipe(
        Effect.provideService(
          AppearanceSettings,
          createAppearanceSettings(settings),
        ),
      ),
    );
    await first.run(appearance.initialize());
    expect(await first.run(i18n.getLocale())).toBe("en");
    const locales: string[] = [];
    const wallpapers: string[] = [];
    i18n.localeChanged.on(({ locale }) => {
      locales.push(locale);
    });
    appearance.wallpaperChanged.on(({ id }) => {
      wallpapers.push(id);
    });

    await first.run(
      Effect.gen(function* () {
        yield* settings.set("com.eden", "general.locale", "pl");
        yield* appearance.setWallpaper({ type: "preset", id: "midnight" });
      }),
    );
    expect(locales).toEqual(["pl"]);
    expect(wallpapers).toEqual(["midnight"]);
    expect(await first.run(i18n.getLocale())).toBe("pl");
    expect(
      await first.run(settings.get("com.eden", "appearance.wallpaper")),
    ).toBe('{"type":"preset","id":"midnight"}');
    expect((await first.run(appearance.getWallpaper())).id).toBe("midnight");
    await first.dispose();
    expect(settings.changed.hasListeners()).toBe(false);
    expect(i18n.localeChanged.hasListeners()).toBe(false);
    expect(appearance.wallpaperChanged.hasListeners()).toBe(false);

    const reopened = await second.acquire(
      settingsFactory(
        buildService(SettingsStorage, SqliteSettingsStorageLive).pipe(
          Effect.provideService(AppsDirectory, appsDirectory),
        ),
      ),
    );
    const nextI18n = await second.acquire(
      buildService(I18n, I18nLive).pipe(
        Effect.provideService(I18nSettings, createI18nSettings(reopened)),
      ),
    );
    const nextAppearance = await second.acquire(
      buildService(Appearance, AppearanceLive).pipe(
        Effect.provideService(
          AppearanceSettings,
          createAppearanceSettings(reopened),
        ),
      ),
    );
    await second.run(nextAppearance.initialize());
    expect(await second.run(nextI18n.getLocale())).toBe("pl");
    expect((await second.run(nextAppearance.getWallpaper())).id).toBe(
      "midnight",
    );
  } finally {
    await first.dispose();
    await second.dispose();
    await fs.rm(appsDirectory, { recursive: true, force: true });
  }
});

it("finishes a pending appearance commit and its notifications before closing settings storage", async () => {
  const appsDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), "eden-settings-drain-"),
  );
  const first = createEffectRuntime();
  const second = createEffectRuntime();
  let releaseWrite!: () => void;
  let writeStarted!: () => void;
  const pending = new Promise<void>((resolve) => {
    releaseWrite = resolve;
  });
  const started = new Promise<void>((resolve) => {
    writeStarted = resolve;
  });
  const sqlite = buildService(SettingsStorage, SqliteSettingsStorageLive).pipe(
    Effect.provideService(AppsDirectory, appsDirectory),
  );
  const delayed: Effect.Effect<SettingsStorage, Error, Scope.Scope> =
    Effect.map(sqlite, (connection) => ({
      ...connection,
      write: (key, value) =>
        Effect.gen(function* () {
          writeStarted();
          yield* Effect.promise(() => pending);
          yield* connection.write(key, value);
        }),
    }));
  try {
    const settings = await first.acquire(settingsFactory(delayed));
    const appearance = await first.acquire(
      buildService(Appearance, AppearanceLive).pipe(
        Effect.provideService(
          AppearanceSettings,
          createAppearanceSettings(settings),
        ),
      ),
    );
    const commits: string[] = [];
    settings.changed.on(({ key }) => {
      commits.push(key);
    });
    appearance.wallpaperChanged.on(({ id }) => {
      commits.push(id);
    });
    const write = first.run(
      appearance.setWallpaper({ type: "preset", id: "aurora" }),
    );
    await started;
    const disposal = first.dispose();
    expect(commits).toEqual([]);
    releaseWrite();
    const results = await Promise.allSettled([write, disposal]);
    expect(results[1].status).toBe("fulfilled");
    expect(commits).toEqual(["appearance.wallpaper", "aurora"]);
    const reopened = await second.acquire(settingsFactory(sqlite));
    const nextAppearance = await second.acquire(
      buildService(Appearance, AppearanceLive).pipe(
        Effect.provideService(
          AppearanceSettings,
          createAppearanceSettings(reopened),
        ),
      ),
    );
    await second.run(nextAppearance.initialize());
    expect((await second.run(nextAppearance.getWallpaper())).id).toBe("aurora");
  } finally {
    releaseWrite();
    await first.dispose();
    await second.dispose();
    await fs.rm(appsDirectory, { recursive: true, force: true });
  }
});
