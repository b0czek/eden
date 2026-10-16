# Controllers and domain events

Controllers declare the public command and event contract for one domain. Keep
its factory beside the domain implementation, such as `i18n/controller.ts` or
`appearance/controller.ts`. Factories receive their dependencies explicitly;
services own domain behavior and state. The runtime composes and registers them.

## Services

Use classless factory functions for domain services. Pass dependencies explicitly,
keep instance state in closures, and return the operations and events consumers need.
Factories acquire resources in an Effect scope; I/O methods return Effects that
describe work without starting it. Infer the service type from the factory's
successful result:

```ts
import * as Effect from "effect/Effect";

export type I18n = Effect.Success<ReturnType<typeof createI18n>>;
```

Keep each service in its domain's `service.ts`, beside `controller.ts`. Stateless
domain rules and data use ordinary functions, such as wallpaper resolution in
[appearance/presets.ts](../packages/sdk/src/appearance/presets.ts). Service
closures own instance state and resource lifetimes.

Dependencies describe domain capabilities in `ports.ts`, using fully provided
Effects for I/O:

```ts
import type { WallpaperConfig } from "@edenapp/types";
import type * as Effect from "effect/Effect";

export interface AppearanceSettings {
  readWallpaper(): Effect.Effect<string | undefined, Error>;
  saveWallpaper(config: WallpaperConfig): Effect.Effect<void, Error>;
}
```

The domain owns this contract. Translate existing managers into it at the
composition boundary, as in
[appearance/settings-adapter.ts](../packages/sdk/src/appearance/settings-adapter.ts)
and [i18n/settings.ts](../packages/sdk/src/i18n/settings.ts). Those adapters
translate persistence keys and notifications while composing the settings
service's Effects directly. Adapters for legacy Promise APIs defer work with
`Effect.tryPromise`; converted services compose Effects without an intermediate
Promise or interpreter. Services receive neither a dependency container nor a
concrete settings manager.

Register cleanup when acquiring a resource. For example, i18n acquires its local
event source and upstream subscription within the factory's scope:

```ts
import * as Effect from "effect/Effect";
import { createEvent } from "../events/event";
import type { I18nSettings } from "./ports";

interface I18nDependencies {
  settings: I18nSettings;
}

export function createI18n({ settings }: I18nDependencies) {
  return Effect.gen(function* () {
    const localeChanged = yield* Effect.acquireRelease(
      Effect.sync(() => createEvent<{ locale: string }>()),
      (event) => Effect.sync(event.dispose),
    );
    yield* Effect.acquireRelease(
      Effect.sync(() => settings.localeChanged.on(localeChanged.emit)),
      (stop) => Effect.sync(stop),
    );

    function getLocale() {
      return Effect.map(settings.readLocale(), (locale) => locale || "en");
    }

    return { getLocale, localeChanged };
  });
}
```

The complete [i18n service](../packages/sdk/src/i18n/service.ts) also exposes
ordinary synchronous translation lookup. The
[appearance service](../packages/sdk/src/appearance/service.ts) keeps wallpaper
state in a closure and composes storage Effects before updating state and
publishing notifications.

Factory acquisition may require `Scope.Scope`. Effects returned by service
methods must have their dependencies provided, with no outstanding requirements
(the third `Effect.Effect` type parameter is `never`). Services compose those
Effects with `yield*`, `Effect.map`, or other Effect operators; they do not run
their own interpreter or register commands.

## Commands

```ts
import * as v from "valibot";
import * as Effect from "effect/Effect";
import { command, defineController } from "../controllers/controller";
import type { I18n } from "./service";

export function createI18nController(i18n: I18n) {
  return defineController("i18n", {
    commands: {
      "get-locale": command({
        handle: () => Effect.map(i18n.getLocale(), (locale) => ({ locale })),
      }),
      "get-common": command({
        input: v.object({ locale: v.string() }),
        handle: ({ locale }) => i18n.getCommon(locale),
      }),
    },
    events: { "locale-changed": i18n.localeChanged },
  });
}
```

`input` validates incoming arguments before the handler runs and infers its
argument type. Omit it for commands without public arguments. The generated
client uses the schema's input type; a handler receives its validated output,
including defaults and transformations. Results are inferred from the handler.
Result handlers can return ordinary values, Promises, or fully provided Effects.
The command registry executes Effects through the owning runtime. Controllers
return work rather than calling `runPromise` themselves.

`permission: "manage"` on an appearance command requires `appearance/manage`.
Commands run through the existing registry's permission and grant checks.
Trusted caller context is supplied as the second handler argument, separately
from schema-validated public input. Operation commands declare
`mode: "operation"` and synchronously prepare an `OperationTask`, using the
existing operation lifecycle and client controls. Preparing that task is distinct
from executing its retained work.

Codegen extracts the successful result from value, Promise, and Effect handlers,
and the completion value from an operation task. Effect failure types and service
requirements do not enter generated client declarations. Apps keep the existing
Promise-based client API, including operation controls and subscriptions, without
an Effect dependency.

## Events

Services publish typed local notifications without knowing about app views,
command registration, namespaces, or IPC:

```ts
const localeChanged = createEvent<{ locale: string }>();

// Publish when domain state changes:
localeChanged.emit({ locale });

// Internal consumers observe the same source:
const stop = i18n.localeChanged.on(({ locale }) => updateLocale(locale));
```

A service scope owns its event sources and any upstream subscriptions.
`on` returns an idempotent removal function. Listener failures are logged and
isolated, including asynchronous failures. Local callbacks run synchronously when
`emit` is called; notifications do not await returned Promises. Use explicit
service operations when a caller must await a result.

The controller's `events` map exposes selected sources under public event names.
Runtime registration automatically forwards their notifications through existing
app subscription routing. Apps retain the generated `domain.subscribe` and
`domain.unsubscribe` methods. Controller registration creates no source-specific
subscription handlers. IPC forwarding is released during runtime disposal.

For notifications intended for specific views, publish a
`TargetedNotification<Payload>` containing `payload` and `viewIds`, and expose
the source through `targetedEvent(source)` from `controllers/events.ts` in the
controller's event map. Forwarding delivers the payload only to those subscribed
views; an empty audience delivers nothing. Routing metadata stays internal and
does not enter the generated event payload. The service scope owns the local
source, and runtime disposal releases its IPC forwarding.

Use `routedEvent(source)` with `RoutedNotification<Payload>` when a source also
supports broadcast delivery. Omit `viewIds` for a broadcast through the normal
subscriber routing; supply an array for selected views. An empty array still
delivers nothing. `targetedEvent` requires an explicit view audience.

## Composition and generation

One [Effect runtime](../packages/sdk/src/effects/runtime.ts) belongs to each Eden
runtime. Its `acquire` method constructs a scoped service; `run` executes a fully
provided Effect and returns a Promise. Use these methods only at composition,
IPC, and host-facing integration boundaries:

```ts
const effects = createEffectRuntime();
const appearance = await effects.acquire(
  createAppearance({ settings: createAppearanceSettings(settings) }),
);

ipcBridge.registerController(createAppearanceController(appearance));
await effects.run(appearance.initialize());

// During owner shutdown:
await effects.dispose();
```

The managed runtime owns a child scope for each acquisition. Failed acquisition
closes its child scope immediately; successful acquisitions stay owned until
runtime disposal closes their resources. Composition supplies adapters and
preserves startup ordering: appearance initializes after settings and sessions
are ready. Host and IPC boundaries execute service Effects while preserving
their existing Promise APIs.

Plain controller commands and decorated handlers use the same execution registry.
An explicit controller cannot replace an existing command, and decorated handlers
cannot replace explicit controller commands. Codegen extracts explicit
controller contracts through their inferred TypeScript types, alongside existing
decorated domains. It does not instantiate domain services. Test files are excluded
from production contract discovery.

Regenerate declarations and the client after changing a public controller:

```sh
pnpm --filter @edenapp/sdk run codegen
pnpm --filter @edenapp/client run build
```
