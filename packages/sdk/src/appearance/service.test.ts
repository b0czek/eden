import type { WallpaperConfig, WallpaperPreset } from "@edenapp/types";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { buildService } from "../../tests/support/effect-runtime";
import { StorageReadError, StorageWriteError } from "../storage/errors";
import { AppearanceSettings } from "./ports";
import { DEFAULT_WALLPAPER_PRESET } from "./presets";
import { Appearance, AppearanceLive } from "./service";
import { createAppearanceSettings } from "./settings-adapter";

describe("appearance effects", () => {
  it.each(["not JSON", JSON.stringify({ type: "custom", value: 42 })])(
    "keeps the default wallpaper when the saved config is corrupt: %s",
    async (savedConfig) => {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const appearance = yield* buildService(
              Appearance,
              AppearanceLive,
            ).pipe(
              Effect.provideService(
                AppearanceSettings,
                createAppearanceSettings({
                  get: () => Effect.succeed(savedConfig),
                  set: () => Effect.void,
                }),
              ),
            );

            yield* appearance.initialize();

            expect(yield* appearance.getWallpaper()).toEqual(
              DEFAULT_WALLPAPER_PRESET,
            );
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
          const appearance = yield* buildService(
            Appearance,
            AppearanceLive,
          ).pipe(
            Effect.provideService(
              AppearanceSettings,
              createAppearanceSettings({
                get: () =>
                  Effect.succeed(
                    JSON.stringify({ type: "preset", id: "midnight" }),
                  ),
                set: () => Effect.void,
              }),
            ),
          );
          appearance.wallpaperChanged.on((wallpaper) => {
            notifications.push(wallpaper);
          });

          yield* appearance.initialize();

          expect(yield* appearance.getWallpaper()).toEqual({
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
          const appearance = yield* buildService(
            Appearance,
            AppearanceLive,
          ).pipe(
            Effect.provideService(
              AppearanceSettings,
              createAppearanceSettings({
                get: () => Effect.fail(failure),
                set: () => Effect.void,
              }),
            ),
          );

          expect(yield* appearance.initialize().pipe(Effect.flip)).toBe(
            failure,
          );
          expect(yield* appearance.getWallpaper()).toEqual(
            DEFAULT_WALLPAPER_PRESET,
          );
        }),
      ),
    );
  });

  it("persists and publishes only when executed, and releases listeners with its scope", async () => {
    const writes: Array<{ appId: string; key: string; value: string }> = [];
    const notifications: WallpaperPreset[] = [];
    const config: WallpaperConfig = { type: "custom", value: "#123456" };
    const appearance = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const appearance = yield* buildService(
            Appearance,
            AppearanceLive,
          ).pipe(
            Effect.provideService(
              AppearanceSettings,
              createAppearanceSettings({
                get: () => Effect.succeed(undefined),
                set: (appId, key, value) =>
                  Effect.sync(() => {
                    writes.push({ appId, key, value });
                  }),
              }),
            ),
          );
          appearance.wallpaperChanged.on((wallpaper) => {
            notifications.push(wallpaper);
          });
          const update = appearance.setWallpaper(config);

          expect(writes).toEqual([]);
          expect(notifications).toEqual([]);
          expect(yield* appearance.getWallpaper()).toEqual(
            DEFAULT_WALLPAPER_PRESET,
          );

          yield* update;
          expect(writes).toEqual([
            {
              appId: "com.eden",
              key: "appearance.wallpaper",
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
          expect(yield* appearance.getWallpaper()).toEqual(notifications[0]);
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
          const appearance = yield* buildService(
            Appearance,
            AppearanceLive,
          ).pipe(
            Effect.provideService(
              AppearanceSettings,
              createAppearanceSettings({
                get: () => Effect.succeed(undefined),
                set: () => Effect.fail(failure),
              }),
            ),
          );
          appearance.wallpaperChanged.on((wallpaper) => {
            notifications.push(wallpaper);
          });

          const received = yield* appearance
            .setWallpaper({ type: "custom", value: "#abcdef" })
            .pipe(Effect.flip);

          expect(received).toBe(failure);
          expect(notifications).toEqual([]);
          expect(yield* appearance.getWallpaper()).toEqual(
            DEFAULT_WALLPAPER_PRESET,
          );
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
          const appearance = yield* buildService(
            Appearance,
            AppearanceLive,
          ).pipe(
            Effect.provideService(
              AppearanceSettings,
              createAppearanceSettings({
                get: () => Effect.sync(() => persisted),
                set: (_appId, _key, value) =>
                  Effect.promise(async () => {
                    signalSaveStarted();
                    await saveReleased;
                    persisted = value;
                  }),
              }),
            ),
          );
          appearance.wallpaperChanged.on((wallpaper) => {
            notifications.push(wallpaper);
          });
          const fiber = yield* Effect.forkChild(
            appearance.setWallpaper({ type: "custom", value: "#123456" }),
          );
          fiber.addObserver(() => {
            completedState = {
              persisted,
              wallpaper: Effect.runSync(appearance.getWallpaper()),
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
