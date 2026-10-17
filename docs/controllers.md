# Controllers and domain events

Each domain keeps its public boundaries beside its implementation:
`controller-edenapi.ts` exposes sandboxed app commands and events, while
`controller-sdk.ts` exposes trusted main-process SDK methods. Factories receive
their dependencies explicitly; services own domain behavior and state. The
runtime composes the controllers and registers the EdenAPI command contracts.

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

Keep single-service domains in `service.ts`, beside their controllers. Larger
domains keep cohesive services in focused adjacent modules. Stateless
domain rules and data use ordinary functions, such as wallpaper resolution in
[appearance/presets.ts](../packages/sdk/src/appearance/presets.ts). Service
closures own instance state and resource lifetimes.

Name services for the capabilities they expose: `Processes` from
`createProcesses`, `Volumes` from `createVolumes`, and `SettingsPanels` from
`createSettingsPanels`. Use lowercase filenames such as `service.ts`,
`volumes.ts`, and `panel-service.ts`. Reserve `controller` for API boundaries;
view behavior lives in modules such as `tiling.ts` and `rendering.ts`.

Dependencies describe domain capabilities using fully provided Effects for I/O.
Keep small contracts beside the factory; use `ports.ts` when the set of contracts
benefits from its own module:

```ts
import type { WallpaperConfig } from "@edenapp/types";
import type * as Effect from "effect/Effect";

export interface AppearanceSettings {
  readWallpaper(): Effect.Effect<string | undefined, Error>;
  saveWallpaper(config: WallpaperConfig): Effect.Effect<void, Error>;
}
```

The domain owns this contract. Adapt collaborating services to it at the
composition boundary, as in
[appearance/settings-adapter.ts](../packages/sdk/src/appearance/settings-adapter.ts)
and [i18n/settings.ts](../packages/sdk/src/i18n/settings.ts). Those adapters
translate persistence keys and notifications while composing the settings
service's Effects directly. Adapters for native Promise APIs defer work with
`fromPromise`, which forwards interruption through an `AbortSignal` and awaits
native cleanup. Converted services compose Effects without an intermediate
Promise or interpreter. Services receive neither a dependency container nor a
concrete settings implementation.

Controllers validate external inputs before passing domain values to services.
Share input schemas between EdenAPI and SDK controllers where their contracts
match. Host-only inputs, such as filesystem paths and callback providers, have
SDK-specific validation. Services enforce runtime invariants and validate data
arriving from other boundaries, such as persistence; they do not repeat the
controller's input parsing.

Reuse the small argument shapes in `controllers/schemas.ts` for plain string
keys and app namespaces. Keep domain constraints in the owning domain's schemas.
Persistence readers use those same domain schemas before passing stored data to
services; runtime checks depend on current state rather than repeating shape checks.

Register cleanup when acquiring a resource. For example, i18n acquires its local
event source and upstream subscription within the factory's scope:

```ts
import * as Effect from "effect/Effect";
import { listen, scopedEvent } from "../events/scoped";

interface I18nDependencies {
  settings: I18nSettings;
}

export const createI18n = Effect.fn(function* ({ settings }: I18nDependencies) {
  const localeChanged = yield* scopedEvent<{ locale: string }>();
  yield* listen(settings.localeChanged, localeChanged.emit);

  const getLocale = Effect.fn(function* () {
    return (yield* settings.readLocale()) || "en";
  });

  return { getLocale, localeChanged };
});
```

`Effect.fn` keeps workflow construction lazy and infers its result, failures and
requirements. `scopedEvent` acquires a local event source and clears its listeners
when the scope closes. `listen` registers a listener and removes it on scope close.
Both helpers use the shared event primitives and standard Effect resource ownership.

The complete [i18n service](../packages/sdk/src/i18n/service.ts) also exposes
ordinary synchronous translation lookup. The
[appearance service](../packages/sdk/src/appearance/service.ts) keeps wallpaper
state in a closure and composes storage Effects before updating state and
publishing notifications.

Use explicit `Duration` values for Effect waits and expiry: `Duration.seconds(5)`,
`Duration.millis(delayMs)`, `Duration.zero`, or `Duration.infinity`.

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
The command registry returns one Effect program; native IPC adapters execute it
through scoped fibers. Controllers return work rather than calling `runPromise`
themselves.

`permission: "manage"` on an appearance command requires `appearance/manage`.
Commands run through the existing registry's permission and grant checks.
Trusted caller context is supplied as the second handler argument, separately
from schema-validated public input.

Use `operation` for commands that synchronously validate and prepare retained work:

```ts
power: operation({
  permission: "power",
  input: powerActionSchema,
  transition: "runtime",
  prepare: (args) => {
    power.assertAvailable(args);
    return (reporter) => power.power(args, reporter);
  },
}),
```

`prepare` receives validated arguments and trusted caller context. It returns a
function that accepts the operation reporter and produces a fully provided Effect.
Preparation finishes before acceptance; execution starts afterward.
The operation runtime interprets Effects and retains their completion or failure
through the existing operation lifecycle. The reporter supplies progress updates;
work that declares `cancellable: true` is cancelled by fiber interruption.

Commands may also declare `mode: "operation"` and return an `OperationTask`
directly, for example when a filesystem capability prepares resource admission.

`OperationTask.run` returns only Effect. Adapt native Promise producers before
passing them into the task. A task that reserves resources during synchronous
admission supplies an idempotent `release` callback, so cancellation before
execution also releases that reservation.

Execution and completion belong to an owned fiber. Cancellation interrupts that
fiber, and terminal status is published after its finalizers complete. Draining
awaits fiber exits, including failed or cancelled work. The transport queues its
acceptance response before the execution fiber can run domain work.

For commands with a typed public failure response, supply `encodeFailure` at the
controller boundary. The execution fiber and internal waits still fail; only the
public failed snapshot carries the encoded response. Successful values, including
`false` or `{ success: false }`, remain successful operation results.

Codegen extracts the successful result from value, Promise, and Effect handlers,
and the completion value from an operation task. Effect failure types and service
requirements do not enter generated client declarations. Apps keep the existing
Promise-based client API, including operation controls and subscriptions, without
an Effect dependency.

## SDK controllers

SDK controllers return typed method objects with synchronous reads, lazy
Effect-based work, detached data and idempotent unsubscribe functions.
They validate inputs before mutating state or submitting retained work. See
[appearance](../packages/sdk/src/appearance/controller-sdk.ts) for native Effect
composition and [sessions](../packages/sdk/src/session/controller-sdk.ts) for
retained host transitions.

The runtime supplies one `SdkContext`. Its `run` method establishes host authority
with a system principal and no inherited app, renderer or operation identity.
`effect` defers validation and provides host authority to a fully provided service
Effect. `operation` submits through the existing operation ledger when executed
and awaits completion. Host runners interpret the completed SDK program. SDK event
callbacks also enter host context and receive detached payloads.

`createControlPlaneApis` composes these domain controllers; it contains no input
validation or domain workflow. The
[main-process API](main-process-api.md) owns the public host trust contract.

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
Operation notifications also carry an internal owner/session `scope`; forwarding
preserves that scope so only authorized subscribers receive them.

## Composition and generation

The desktop graph is acquired and initialized by one scoped Effect program,
exposed as a single `Desktop` service through a Layer. `ManagedRuntime` owns
that Layer, its resources, and work started by the host runners. Domain
factories retain explicit dependencies; each domain does not need its own tag.
See the [runtime boundary](../packages/sdk/src/runtime/runtime.ts).

Startup retains its fiber, and readiness follows its exit. Shutdown interrupts
pending startup and preserves native I/O settlement. After successful startup,
shutdown closes operation admission, drains accepted work, and stops processes
before disposing the managed graph. Failed acquisition releases partial resources
and preserves the startup error even when cleanup fails.

Host execution uses `eden.runPromise` or `eden.runFork`. Native IPC and protocol
adapters own their callback fibers in their acquisition scopes. Services compose
Effects and receive no outer runtime runner. Test fixtures can acquire standalone
services through their own scoped helper without adding an acquisition API to
the desktop runtime.

The desktop [composition program](../packages/sdk/src/runtime/composition.ts)
acquires the complete service graph in one scope. Dependencies are constructed
before their consumers; synchronous resource owners register disposal with
`Effect.acquireRelease` alongside construction. Shutdown explicitly closes
operation admission, drains accepted work, and stops processes before closing
the scope. Host settings registrations have a separate synchronous owner so
registration does not require starting the desktop services.

Controllers register their commands and selected event sources with one execution
registry. A command name has one owner; registering a duplicate is an error.
Codegen extracts command inputs, successful results, operation completions and
event payloads from the controllers' inferred TypeScript types. It never
constructs services or runs their workflows. Test files are excluded from
production contract discovery.

Regenerate declarations and the client after changing a public controller:

```sh
pnpm --filter @edenapp/sdk run codegen
pnpm --filter @edenapp/client run build
```
