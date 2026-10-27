import type { WallpaperConfig, WallpaperPreset } from "@edenapp/types";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import { createTestExecutionContext } from "../../../tests/support/callers";
import { buildService } from "../../../tests/support/effect-runtime";
import { ExecutionContext } from "../../core/execution/context";
import { SettingsCatalog, SettingsStorage } from "../../core/settings/ports";
import { Settings, SettingsLive } from "../../core/settings/service";
import {
  StorageReadError,
  StorageWriteError,
} from "../../platform/storage/errors";
import { DEFAULT_WALLPAPER_PRESET } from "./presets";
import { Appearance, AppearanceLive } from "./service";

function appearanceWithStorage(
  storage: Pick<SettingsStorage, "read" | "write">,
) {
  return buildService(Appearance, AppearanceLive).pipe(
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
