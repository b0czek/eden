import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";
import { createEvent } from "../events/event";
import { createI18n } from "./service";
import { createI18nSettings } from "./settings";

describe("i18n service ownership", () => {
  it("releases its settings subscription without disconnecting another instance", () => {
    const changed = createEvent<{
      appId: string;
      key: string;
      value: string;
    }>();
    const settings = {
      get: () => Effect.succeed(undefined),
      changed,
    };
    const firstScope = Scope.makeUnsafe();
    const secondScope = Scope.makeUnsafe();
    const first = Effect.runSync(
      Scope.provide(
        createI18n({ settings: createI18nSettings(settings) }),
        firstScope,
      ),
    );
    const second = Effect.runSync(
      Scope.provide(
        createI18n({ settings: createI18nSettings(settings) }),
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
    const changed = createEvent<{ locale: string }>();
    const failure = new Error("Startup failed");

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          yield* createI18n({
            settings: {
              readLocale: () => Effect.succeed(undefined),
              localeChanged: changed,
            },
          });
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
    let readFailure: Error | undefined;
    const reads: string[][] = [];
    const settings = createI18nSettings({
      get: (appId, key) =>
        Effect.suspend(() => {
          reads.push([appId, key]);
          return readFailure
            ? Effect.fail(readFailure)
            : Effect.succeed(locale);
        }),
      changed: createEvent<{ appId: string; key: string; value: string }>(),
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const i18n = yield* createI18n({ settings });
          const read = i18n.getLocale();
          expect(reads).toEqual([]);
          expect(yield* read).toBe("en");
          locale = "pl";
          expect(yield* read).toBe("pl");
          expect(reads).toEqual([
            ["com.eden", "general.locale"],
            ["com.eden", "general.locale"],
          ]);

          readFailure = new Error("Settings unavailable");
          const error = yield* Effect.match(i18n.getLocale(), {
            onFailure: (failure) => failure,
            onSuccess: () => undefined,
          });
          expect(error).toBe(readFailure);
        }),
      ),
    );
  });

  it("forwards only locale-key changes with the existing app-independent filtering", async () => {
    const changed = createEvent<{
      appId: string;
      key: string;
      value: string;
    }>();
    const locales: string[] = [];

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const i18n = yield* createI18n({
            settings: createI18nSettings({
              get: () => Effect.succeed(undefined),
              changed,
            }),
          });
          i18n.localeChanged.on(({ locale }) => {
            locales.push(locale);
          });

          changed.emit({ appId: "com.eden", key: "other", value: "ignored" });
          changed.emit({
            appId: "com.eden",
            key: "general.locale",
            value: "pl",
          });
          changed.emit({
            appId: "other.app",
            key: "general.locale",
            value: "en",
          });
        }),
      ),
    );

    expect(locales).toEqual(["pl", "en"]);
  });
});
