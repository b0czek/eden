import type {
  AppearanceState,
  EdenAppearanceConfig,
  WallpaperConfig,
  WallpaperPreset,
} from "@edenapp/types";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import { createTestExecutionContext } from "../../../tests/support/callers";
import { buildService } from "../../../tests/support/effect-runtime";
import { ExecutionContext } from "../../core/execution/context";
import { SettingsCatalog, SettingsStorage } from "../../core/settings/ports";
import { Settings, SettingsLive } from "../../core/settings/service";
import { ThemeStatePort } from "../../platform/ports/types";
import {
  StorageReadError,
  StorageWriteError,
} from "../../platform/storage/errors";
import { RuntimeConfig } from "../../runtime/inputs";
import { defaultWallpaper } from "./presets";
import { Appearance, AppearanceLive } from "./service";

const DEFAULT_WALLPAPER_PRESET = defaultWallpaper("dark");

function createThemeState() {
  const applied: Array<"light" | "dark"> = [];
  const port: ThemeStatePort = {
    get colorScheme() {
      return applied.at(-1) ?? "system";
    },
    setColorScheme: (colorScheme) => {
      applied.push(colorScheme);
    },
    onChanged: () => () => {},
  };
  return { applied, port };
}

function appearanceWithStorage(
  storage: Pick<SettingsStorage, "read" | "write">,
  options: {
    appearance?: EdenAppearanceConfig;
    themeState?: ThemeStatePort;
  } = {},
) {
  return buildService(Appearance, AppearanceLive).pipe(
    Effect.provideService(
      ThemeStatePort,
      options.themeState ?? createThemeState().port,
    ),
    Effect.provideService(RuntimeConfig, { appearance: options.appearance }),
    Effect.provideServiceEffect(
      Settings,
      buildService(Settings, SettingsLive).pipe(
        Effect.provide(Layer.mock(SettingsStorage, storage)),
        Effect.provideService(SettingsCatalog, {
          getAppSettings: () => undefined,
        }),
        Effect.provideServiceEffect(
          ExecutionContext,
          createTestExecutionContext(() => true),
        ),
      ),
    ),
  );
}

describe("appearance effects", () => {
  it.each(["not JSON", JSON.stringify({ type: "custom", value: 42 })])(
    "keeps the default wallpaper when the saved config is corrupt: %s",
    async (savedConfig) => {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const appearance = yield* appearanceWithStorage({
              read: () => Effect.succeed(savedConfig),
              write: () => Effect.void,
            });

            yield* appearance.initialize();

            expect(appearance.getWallpaper()).toEqual(DEFAULT_WALLPAPER_PRESET);
          }),
        ),
      );
    },
  );

  it("resolves the persisted wallpaper without publishing an update", async () => {
    const notifications: WallpaperPreset[] = [];
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const appearance = yield* appearanceWithStorage({
            read: () =>
              Effect.succeed(
                JSON.stringify({ type: "preset", id: "midnight" }),
              ),
            write: () => Effect.void,
          });
          appearance.wallpaperChanged.on((wallpaper) => {
            notifications.push(wallpaper);
          });

          yield* appearance.initialize();

          expect(appearance.getWallpaper()).toEqual({
            id: "midnight",
            name: "Midnight",
            type: "color",
            value: "#1a1b26",
          });
          expect(notifications).toEqual([]);
        }),
      ),
    );
  });

  it("propagates a failed settings read instead of treating it as corrupt wallpaper", async () => {
    const failure = new StorageReadError({
      resource: "settings",
      operation: "read",
      keys: ["com.eden:appearance.wallpaper"],
      cause: new Error("Storage unavailable"),
    });
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const appearance = yield* appearanceWithStorage({
            read: () => Effect.fail(failure),
            write: () => Effect.void,
          });

          expect(yield* appearance.initialize().pipe(Effect.flip)).toBe(
            failure,
          );
          expect(appearance.getWallpaper()).toEqual(DEFAULT_WALLPAPER_PRESET);
        }),
      ),
    );
  });

  it("persists and publishes only when executed, and releases listeners with its scope", async () => {
    const writes: Array<{ key: string; value: string }> = [];
    const notifications: WallpaperPreset[] = [];
    const config: WallpaperConfig = { type: "custom", value: "#123456" };
    const appearance = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const appearance = yield* appearanceWithStorage({
            read: () => Effect.succeed(undefined),
            write: (key, value) =>
              Effect.sync(() => {
                writes.push({ key, value });
              }),
          });
          appearance.wallpaperChanged.on((wallpaper) => {
            notifications.push(wallpaper);
          });
          const update = appearance.setWallpaper(config);

          expect(writes).toEqual([]);
          expect(notifications).toEqual([]);
          expect(appearance.getWallpaper()).toEqual(DEFAULT_WALLPAPER_PRESET);

          yield* update;
          expect(writes).toEqual([
            {
              key: "com.eden:appearance.wallpaper",
              value: JSON.stringify(config),
            },
          ]);
          expect(notifications).toEqual([
            {
              id: "custom",
              name: "Custom",
              type: "custom",
              value: "#123456",
            },
          ]);
          expect(appearance.getWallpaper()).toEqual(notifications[0]);
          return appearance;
        }),
      ),
    );

    expect(appearance.wallpaperChanged.hasListeners()).toBe(false);
  });

  it("preserves storage failures without changing or publishing wallpaper", async () => {
    const failure = new StorageWriteError({
      resource: "settings",
      key: "wallpaper",
      cause: new Error("Storage unavailable"),
    });
    const notifications: WallpaperPreset[] = [];
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const appearance = yield* appearanceWithStorage({
            read: () => Effect.succeed(undefined),
            write: () => Effect.fail(failure),
          });
          appearance.wallpaperChanged.on((wallpaper) => {
            notifications.push(wallpaper);
          });

          const received = yield* appearance
            .setWallpaper({ type: "custom", value: "#abcdef" })
            .pipe(Effect.flip);

          expect(received).toBe(failure);
          expect(notifications).toEqual([]);
          expect(appearance.getWallpaper()).toEqual(DEFAULT_WALLPAPER_PRESET);
        }),
      ),
    );
  });

  it("finishes a started write and publishes its committed state before interruption completes", async () => {
    let signalSaveStarted!: () => void;
    const saveStarted = new Promise<void>((resolve) => {
      signalSaveStarted = resolve;
    });
    let releaseSave!: () => void;
    const saveReleased = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
    let persisted: string | undefined;
    const notifications: WallpaperPreset[] = [];
    let completedState:
      | {
          persisted: string | undefined;
          wallpaper: WallpaperPreset;
          notifications: WallpaperPreset[];
        }
      | undefined;

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const appearance = yield* appearanceWithStorage({
            read: () => Effect.sync(() => persisted),
            write: (_key, value) =>
              Effect.promise(async () => {
                signalSaveStarted();
                await saveReleased;
                persisted = value;
              }),
          });
          appearance.wallpaperChanged.on((wallpaper) => {
            notifications.push(wallpaper);
          });
          const fiber = yield* Effect.forkChild(
            appearance.setWallpaper({ type: "custom", value: "#123456" }),
          );
          fiber.addObserver(() => {
            completedState = {
              persisted,
              wallpaper: appearance.getWallpaper(),
              notifications: [...notifications],
            };
          });

          yield* Effect.promise(() => saveStarted);
          try {
            fiber.interruptUnsafe();
            expect(fiber.pollUnsafe()).toBeUndefined();
          } finally {
            releaseSave();
          }
          yield* Fiber.await(fiber);
        }),
      ),
    );

    const expected = {
      id: "custom",
      name: "Custom",
      type: "custom",
      value: "#123456",
    };
    expect(completedState).toEqual({
      persisted: JSON.stringify({ type: "custom", value: "#123456" }),
      wallpaper: expected,
      notifications: [expected],
    });
  });
});

/** Settings storage backed by a map, keyed like the real store. */
function mapStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    storage: {
      read: (key: string) => Effect.sync(() => values.get(key)),
      write: (key: string, value: string) =>
        Effect.sync(() => {
          values.set(key, value);
        }),
    },
  };
}

const ROSE: EdenAppearanceConfig = {
  themes: [
    {
      id: "rose",
      name: "Rose",
      colorScheme: "light",
      colors: { "accent-primary": "#ff69b4", "bg-primary": "#fff0f5" },
    },
  ],
};

describe("themes", () => {
  it("applies the saved theme's scheme and shows each wallpaper preset in it", async () => {
    const themeState = createThemeState();
    const { storage } = mapStorage({
      "com.eden:appearance.theme": "eden-light",
      "com.eden:appearance.wallpaper": JSON.stringify({
        type: "preset",
        id: "pure-black",
      }),
    });
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const appearance = yield* appearanceWithStorage(storage, {
            themeState: themeState.port,
          });
          yield* appearance.initialize();

          expect(themeState.applied).toEqual(["light"]);
          expect(appearance.getState()).toMatchObject({
            colorScheme: "light",
            theme: { id: "eden-light" },
          });
          expect(appearance.getWallpaper()).toEqual({
            id: "pure-black",
            name: "Pure White",
            type: "color",
            value: "#ffffff",
          });
        }),
      ),
    );
  });

  it("selecting a theme of the other scheme switches the scheme and wallpaper variant", async () => {
    const themeState = createThemeState();
    const { storage, values } = mapStorage({
      "com.eden:appearance.wallpaper": JSON.stringify({
        type: "preset",
        id: "midnight",
      }),
    });
    const states: AppearanceState[] = [];
    const wallpapers: WallpaperPreset[] = [];
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const appearance = yield* appearanceWithStorage(storage, {
            appearance: ROSE,
            themeState: themeState.port,
          });
          yield* appearance.initialize();
          appearance.appearanceChanged.on((state) => {
            states.push(state);
          });
          appearance.wallpaperChanged.on((wallpaper) => {
            wallpapers.push(wallpaper);
          });
          expect(appearance.getThemeStylesheet()).toBe("");

          yield* appearance.setTheme("eden-light");
          yield* appearance.setTheme("rose");

          expect(values.get("com.eden:appearance.theme")).toBe("rose");
          expect(themeState.applied).toEqual(["dark", "light", "light"]);
          expect(states.map((state) => state.theme.id)).toEqual([
            "eden-light",
            "rose",
          ]);
          // Rose is light too, so only the first switch changes the wallpaper.
          expect(wallpapers).toEqual([
            {
              id: "midnight",
              name: "Midnight",
              type: "color",
              value: "#dfe3f0",
            },
          ]);
          expect(appearance.getThemeStylesheet()).toBe(
            "@media (prefers-color-scheme: light) {\n:root {\n" +
              "  --eden-color-bg-primary: #fff0f5;\n" +
              "  --eden-color-accent-primary: #ff69b4;\n}\n}",
          );
        }),
      ),
    );
  });

  it("rejects an unknown theme without saving anything", async () => {
    const { storage, values } = mapStorage();
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const appearance = yield* appearanceWithStorage(storage);
          yield* appearance.initialize();

          const error = yield* appearance.setTheme("missing").pipe(Effect.flip);

          expect(error._tag).toBe("UnknownTheme");
          expect(values.size).toBe(0);
          expect(appearance.getState().theme.id).toBe("eden-dark");
        }),
      ),
    );
  });

  it("falls back to the default theme when a saved theme is no longer configured", async () => {
    const themeState = createThemeState();
    const { storage } = mapStorage({ "com.eden:appearance.theme": "rose" });
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const appearance = yield* appearanceWithStorage(storage, {
            themeState: themeState.port,
          });
          yield* appearance.initialize();

          expect(appearance.getState().theme.id).toBe("eden-dark");
          expect(themeState.applied).toEqual(["dark"]);
        }),
      ),
    );
  });

  it("uses the configured default theme until the user chooses", async () => {
    const themeState = createThemeState();
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const appearance = yield* appearanceWithStorage(
            mapStorage().storage,
            {
              appearance: { ...ROSE, defaultTheme: "rose" },
              themeState: themeState.port,
            },
          );
          yield* appearance.initialize();

          expect(themeState.applied).toEqual(["light"]);
          expect(appearance.getState().theme.id).toBe("rose");
        }),
      ),
    );
  });

  it.each([
    [
      "an unknown color token",
      {
        themes: [
          { id: "x", name: "X", colorScheme: "dark", colors: { nope: "#000" } },
        ],
      },
    ],
    [
      "a value that would end the declaration",
      {
        themes: [
          {
            id: "x",
            name: "X",
            colorScheme: "dark",
            colors: { "bg-primary": "red; } body { display: none" },
          },
        ],
      },
    ],
    ...[
      "rgb(1, 2, 3",
      "red /* comment",
      'url("https://example.test/a.png")',
      "red !important",
      '"unclosed',
      "red [",
      "10px",
      "inherit",
      "rgb(1, 2, 3) 10px",
      "rgb(1, 2, 3))",
      "calc(1px)",
    ].map((value): [string, unknown] => [
      `the value ${value}`,
      {
        themes: [
          {
            id: "x",
            name: "X",
            colorScheme: "dark",
            colors: { "bg-primary": value },
          },
        ],
      },
    ]),
    [
      "an empty name",
      { themes: [{ id: "x", name: {}, colorScheme: "dark", colors: {} }] },
    ],
    [
      "a duplicate ID",
      {
        themes: [
          { id: "eden-dark", name: "X", colorScheme: "dark", colors: {} },
        ],
      },
    ],
    ["an unknown default theme", { defaultTheme: "missing" }],
  ])("refuses to start with %s", async (_case, appearance) => {
    const error = await Effect.runPromise(
      Effect.scoped(
        appearanceWithStorage(mapStorage().storage, {
          appearance: appearance as EdenAppearanceConfig,
        }).pipe(Effect.flip),
      ),
    );
    expect(error).toMatchObject({ _tag: "InvalidAppearanceConfig" });
  });
});
