import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import { createTestExecutionContext } from "../../../tests/support/callers";
import {
  buildService,
  createEffectRuntime,
} from "../../../tests/support/effect-runtime";
import { StorageReadError } from "../../platform/storage/errors";
import { ExecutionContext } from "../execution/context";
import { SettingsCatalog, SettingsStorage } from "../settings/ports";
import { Settings, SettingsLive } from "../settings/service";
import { I18n, I18nLive } from "./service";

function settingsWithStorage(storage: Partial<SettingsStorage>) {
  return buildService(Settings, SettingsLive).pipe(
    Effect.provide(Layer.mock(SettingsStorage, storage)),
    Effect.provideService(SettingsCatalog, { getAppSettings: () => undefined }),
    Effect.provideServiceEffect(
      ExecutionContext,
      createTestExecutionContext(() => true),
    ),
  );
}

const serviceEffects = createEffectRuntime();
afterAll(() => serviceEffects.dispose());

describe("i18n service ownership", () => {
  it("releases its settings subscription without disconnecting another instance", () => {
    const settings = serviceEffects.acquireSync(settingsWithStorage({}));
    const changed = settings.changed;
    const firstScope = Scope.makeUnsafe();
    const secondScope = Scope.makeUnsafe();
    const first = serviceEffects.acquireSync(
      Scope.provide(
        buildService(I18n, I18nLive).pipe(
          Effect.provideService(Settings, settings),
        ),
        firstScope,
      ),
    );
    const second = serviceEffects.acquireSync(
      Scope.provide(
        buildService(I18n, I18nLive).pipe(
          Effect.provideService(Settings, settings),
        ),
        secondScope,
      ),
    );
    const firstLocales: string[] = [];
    const secondLocales: string[] = [];
    first.localeChanged.on(({ locale }) => {
      firstLocales.push(locale);
    });
    second.localeChanged.on(({ locale }) => {
      secondLocales.push(locale);
    });

    changed.emit({ appId: "com.eden", key: "general.locale", value: "pl" });
    expect(firstLocales).toEqual(["pl"]);
    expect(secondLocales).toEqual(["pl"]);

    Effect.runSync(Scope.close(firstScope, Exit.void));
    Effect.runSync(Scope.close(firstScope, Exit.void));
    expect(first.localeChanged.hasListeners()).toBe(false);
    expect(changed.hasListeners()).toBe(true);
    changed.emit({ appId: "com.eden", key: "general.locale", value: "en" });
    expect(firstLocales).toEqual(["pl"]);
    expect(secondLocales).toEqual(["pl", "en"]);

    Effect.runSync(Scope.close(secondScope, Exit.void));
    expect(changed.hasListeners()).toBe(false);
  });

  it("releases its subscription when startup fails after acquisition", async () => {
    const settings = await serviceEffects.acquire(settingsWithStorage({}));
    const changed = settings.changed;
    const failure = new Error("Startup failed");

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          yield* buildService(I18n, I18nLive).pipe(
            Effect.provideService(Settings, settings),
          );
          expect(changed.hasListeners()).toBe(true);
          return yield* Effect.fail(failure);
        }),
      ),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    expect(changed.hasListeners()).toBe(false);
  });
});

describe("i18n persisted settings", () => {
  it("reads the saved locale lazily, defaults missing values, and preserves read failures", async () => {
    let locale: string | undefined;
    let readFailure: StorageReadError | undefined;
    const reads: string[] = [];
    const settings = settingsWithStorage({
      read: (key) =>
        Effect.suspend(() => {
          reads.push(key);
          return readFailure
            ? Effect.fail(readFailure)
            : Effect.succeed(locale);
        }),
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const i18n = yield* buildService(I18n, I18nLive).pipe(
            Effect.provideServiceEffect(Settings, settings),
          );
          const read = i18n.getLocale();
          expect(reads).toEqual([]);
          expect(yield* read).toBe("en");
          locale = "pl";
          expect(yield* read).toBe("pl");
          expect(reads).toEqual([
            "com.eden:general.locale",
            "com.eden:general.locale",
          ]);

          readFailure = new StorageReadError({
            resource: "settings",
            operation: "read",
            keys: ["general.locale"],
            cause: new Error("Settings unavailable"),
          });
          const error = yield* Effect.match(i18n.getLocale(), {
            onFailure: (failure) => failure,
            onSuccess: () => undefined,
          });
          expect(error).toBe(readFailure);

          readFailure = undefined;
          locale = "en";
          expect(yield* read).toBe("en");
          locale = "";
          expect(yield* read).toBe("en");
        }),
      ),
    );
  });

  it("forwards only locale-key changes with the existing app-independent filtering", async () => {
    const locales: string[] = [];

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const settings = yield* settingsWithStorage({
            write: () => Effect.void,
          });
          const i18n = yield* buildService(I18n, I18nLive).pipe(
            Effect.provideService(Settings, settings),
          );
          i18n.localeChanged.on(({ locale }) => {
            locales.push(locale);
          });

          yield* settings.set("com.eden", "other", "ignored");
          yield* settings.set("com.eden", "general.locale", "pl");
          yield* settings.set("other.app", "general.locale", "en");
        }),
      ),
    );

    expect(locales).toEqual(["pl", "en"]);
  });
});
