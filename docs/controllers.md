# Controllers and domain events

Each domain keeps its public boundaries beside its implementation:
`controller-edenapi.ts` exposes sandboxed app commands and events, while
`controller-sdk.ts` exposes trusted main-process SDK methods. Services acquire
their dependencies through Effect and own domain behavior and state. The
runtime composes the controllers and registers the EdenAPI command contracts.

Within the SDK, import services, contracts, and adapters directly from their
owning implementation modules. `packages/sdk/src/index.ts` is the package's
public export boundary; internal capabilities do not add their own barrels.

## Services

Declare an explicit service interface, its same-named `Context.Service` key,
and a `Layer.effect` implementation, in that order. The interface owns the
supported operations, events, and failure types. Check implementations against
that contract; infer types within private helpers where useful.

Layer implementations acquire dependencies with `yield*`, keep instance state
in closures, and register resource cleanup in their Effect scope. I/O methods
return Effects that describe work without starting it. Keep each port key beside
its contract. Layers declare requirements without selecting dependency
implementations. Acquire an existing collaborator key directly when its capability
fits. Introduce a separate domain port for meaningful isolation or adaptation;
avoid keys that merely rename an existing service.

Assembly modules such as `runtime.ts` bind domain ports to collaborating services
or platform adapters and register API controllers. Keep these modules where they
perform actual integration. Private assembly helpers do not need service keys.

Keep a domain's contracts and implementation together. A small domain needs only
`service.ts` and its API controllers. Extract files when they own a distinct
responsibility:

- `types.ts` holds shared domain values and event payloads.
- `errors.ts` owns named expected failures and operation-specific failure unions.
- `ports.ts` holds meaningful external capability contracts and their keys.
- Named implementation modules own substantial rules, workflows, or resources.
- `runtime.ts` adapts collaborating capabilities and registers the API.

Do not add empty files to match a template. Keep private helpers ordinary
functions. Give mutable state and native resources one owner: the Views
[registry](../packages/sdk/src/views/registry.ts) owns native view lifetime,
while [coordination](../packages/sdk/src/views/coordination.ts) owns layout and
presentation. Their [service](../packages/sdk/src/views/service.ts) acquires
dependencies, connects scoped events, and exposes the explicit contract. Nested
capabilities, such as Settings panels and filesystem volumes, keep their contracts,
behavior, and controllers together below their domain.

Filesystem owns caller path access and file operations. Its nested
[Volumes capability](../packages/sdk/src/filesystem/volumes/service.ts) owns
registrations, root availability, leases, and safe removal. Each capability
registers its API through its own `runtime.ts`. Filesystem consumes Volumes and
its failures; Volumes does not depend on file operations.

Main-process SDK runtime code uses the typed
[`io` facade](../packages/sdk/src/filesystem/native-io.ts) for host filesystem I/O,
including package loading, configuration and assets.
Call named operations such as `io.realpath(path)` and `io.readFile(path, "utf-8")`.
It owns native failure construction, interruption policy, stream cleanup and
descriptor acquisition in the caller's Effect scope. Native calls settle before
their resources are released. Copying owns directory traversal, file streams,
symlink preservation and file modes. Its `checkAccess` Effect hook enforces domain
access during traversal; `onBytes` reports progress without changing how files
are copied. Hook failures, defects and cancellation propagate directly. Watch
setup returns an Effect and a synchronous close handle owned by the watch
registry. Synchronous module hooks and pre-runtime setup use the separate
[`syncIo` adapter](../packages/sdk/src/filesystem/native-sync.ts). Both adapters
share the Effect-free native failure contract in
[`native-errors.ts`](../packages/sdk/src/filesystem/native-errors.ts).
Frontend and backend preloads must have no runtime dependency on Effect,
including through transitive imports. Their bundle build enforces this boundary.
Access decisions, volume leases and transfer rollback
stay in their domain modules. Native failures propagate as `FilesystemIoFailed`,
retaining the operation, path, descriptor, errno and original cause. Domain error
types describe refusals, invalid data or multi-step outcomes such as incomplete
rollback; they do not rename native I/O failures.

Use `io.writeFileAtomic(path, content, encoding?)` to replace a complete file:
it writes a unique sibling temporary file, renames it into place, and cleans up
on failure or interruption. Callers own serialization and parent-directory creation.

Shared lexical containment belongs to the Effect-free
[`filesystem/lexical-path.ts`](../packages/sdk/src/filesystem/lexical-path.ts).
Callers choose whether to allow the root itself and own existence and symlink
requirements. Symlink-aware ancestor checks belong to
[`filesystem/path-containment.ts`](../packages/sdk/src/filesystem/path-containment.ts).
These primitives have no account policy; the user domain owns restriction
normalization, role rules, and restricted-directory creation. Each domain adapts
path-access refusals to its own error contract and propagates native I/O failures.

View creation, removal, bounds, visibility, focus, mode and tile mutations return
lazy Effects with view-owned failure types. Native setup and presentation hooks
remain synchronous. The view registry owns destruction, including cleanup after
native failures; process scopes release views through the service. Pointer callbacks
submit bounds work through their acquisition scope's fibers.

Within a Layer, acquire dependencies first, establish state and its cleanup,
define workflows, connect scoped subscriptions, and return the public methods.
Register cleanup next to acquisition. Keep stateless rules outside the Layer and
avoid duplicating state in an extracted helper.

Name service interfaces and keys for their capabilities: `Processes`, `Volumes`,
and `SettingsPanels`. Name their implementations `ProcessesLive`, `VolumesLive`,
and `SettingsPanelsLive`. Use lowercase filenames such as `service.ts` and
`schemas.ts`. Reserve `controller` for API boundaries; view behavior lives in
modules such as `tiling.ts` and `rendering.ts`.

### Expected failures

Use domain-owned `Data.TaggedError` classes for failures callers can distinguish
and act on. Include relevant identifiers and retain the original `cause` when
adapting native or dependency failures. Each operation declares its actual
failure union; there is no global catch-all domain error. Successful refusal or
absence remains a value where that is the public contract.

Translate failures where their meaning changes. Native Promise boundaries can
use `fromPromise(evaluate, onError)` to produce a tagged failure while preserving
interruption and native cleanup settlement. Compose existing Effect failures
directly, or use `Effect.mapError` when a domain needs additional context. Do not
catch an entire workflow merely to rename every failure. Pure programming
mistakes remain defects, and cancellation remains interruption.
Recovery and cleanup may fail alongside cancellation or defects. Preserve the
combined causes so callers can distinguish ordinary cancellation from incomplete
recovery.

Synchronous reads and admission checks keep their timing. A synchronous check
may throw a documented tagged rejection when it must reject before operation
acceptance. Do not catch arbitrary thrown exceptions into an expected error
channel. Controllers preserve their public response shapes and encode typed
operation failures at the API boundary. Defects are not ordinary encoded
responses. Domain errors retain their structured data through execution; only
the transport boundary chooses the wire representation.

Dependencies describe domain capabilities using fully provided Effects for I/O.
Keep small contracts beside the implementation; use `ports.ts` when the set of
contracts benefits from its own module:

```ts
import type { WallpaperConfig } from "@edenapp/types";
import type * as Effect from "effect/Effect";
import type { StorageReadFailure, StorageWriteFailure } from "../storage/errors";
import type { SettingValueError } from "../settings/errors";

export interface AppearanceSettings {
  readWallpaper(): Effect.Effect<string | undefined, StorageReadFailure>;
  saveWallpaper(config: WallpaperConfig): Effect.Effect<
    void,
    StorageWriteFailure | SettingValueError
  >;
}
```

The domain owns this contract. Adapt collaborating services to it at the
composition boundary, as in
[appearance/settings.ts](../packages/sdk/src/appearance/settings.ts)
and [i18n/settings.ts](../packages/sdk/src/i18n/settings.ts). Those adapters
translate persistence keys and notifications while composing the settings
service's Effects directly. Adapters for native Promise APIs defer work with
`fromPromise`, which forwards interruption through an `AbortSignal` and awaits
native cleanup. Converted services compose Effects without an intermediate
Promise or interpreter. Services acquire their narrow port keys through Effect.

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
event source and upstream subscription within its acquisition scope, yielding
the local `I18nSettings` port key:

```ts
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { Event } from "../events/event";
import { listen, scopedEvent } from "../events/scoped";
import type { StorageReadFailure } from "../storage/errors";

export interface I18n {
  getLocale(): Effect.Effect<string, StorageReadFailure>;
  localeChanged: Event<{ locale: string }>;
}

export const I18n = Context.Service<"eden/I18n", I18n>("eden/I18n");

export const I18nLive = Layer.effect(
  I18n,
  Effect.gen(function* () {
    const settings = yield* I18nSettings;
    const localeChanged = yield* scopedEvent<{ locale: string }>();
    const getLocale = Effect.fn(function* () {
      return (yield* settings.readLocale()) || "en";
    });

    yield* listen(settings.localeChanged, localeChanged.emit);
    return { getLocale, localeChanged };
  }),
);
```

`Effect.gen` describes Layer acquisition. `Effect.fn` keeps individual workflows
lazy and infers their internal result, failures, and requirements. `scopedEvent`
acquires a local event source and clears its listeners
when the scope closes. `listen` registers a listener and removes it on scope close.
Both helpers use the shared event primitives and standard Effect resource ownership.

The complete [i18n service](../packages/sdk/src/i18n/service.ts) also exposes
ordinary synchronous translation lookup. The
[appearance service](../packages/sdk/src/appearance/service.ts) keeps wallpaper
state in a closure and composes storage Effects before updating state and
publishing notifications.

Use explicit `Duration` values for Effect waits and expiry: `Duration.seconds(5)`,
`Duration.millis(delayMs)`, `Duration.zero`, or `Duration.infinity`.

Service acquisition may require its dependency keys and `Scope.Scope`. Effects
returned by ordinary service methods must have their dependencies provided, with
no outstanding requirements (the third `Effect.Effect` type parameter is `never`).
Services compose those Effects with `yield*`, `Effect.map`, or other Effect
operators; they do not run their own interpreter or register commands.

Generic combinators preserve their caller's environment requirements while
capturing their own infrastructure dependencies.

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
Result handlers return ordinary values or fully provided Effects. Adapt native
Promise producers with `fromPromise(evaluate, onError)` to declare their failures.
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
Operation-mode handlers must return that task synchronously.

`OperationTask.run` returns only Effect. Adapt native Promise producers before
passing them into the task. A task that reserves resources during synchronous
admission supplies an idempotent `release` callback, so cancellation before
execution also releases that reservation.

Execution and completion belong to an owned fiber. Cancellation interrupts that
fiber, and terminal status is published after its finalizers complete. Draining
awaits fiber exits, including failed or cancelled work. Reservation release and
failure encoding run inside that fiber; failures in either produce a terminal
failed snapshot and fail internal waits, preserving the original work's cause.
The transport queues its acceptance response before the execution fiber can run
domain work.

For commands with a typed public failure response, supply `encodeFailure` at the
controller boundary. The execution fiber and internal waits still fail; only the
public failed snapshot carries the encoded response. Defects are never encoded
as ordinary responses. Successful values, including
`false` or `{ success: false }`, remain successful operation results.

Codegen extracts the successful result from value and Effect handlers,
and the completion value from an operation task. Effect failure types and service
requirements do not enter generated client declarations. Apps keep the existing
Promise-based client API, including operation controls and subscriptions, without
an Effect dependency.

Generated namespaces and their command and event names are sorted alphabetically
using a locale-independent comparison. Argument fields retain declaration order
because required fields become positional parameters in the generated client.

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
callbacks also enter host context and receive detached payloads. `subscribe`
validates listeners and applies this boundary to subscription setup, payload
delivery and teardown; controllers supply event connections and payload mappings.

Caller authority is local to the executing Effect fiber. `ExecutionContext.current`
reads that caller in workflows; synchronous admission checks use `get` on the same
fiber. Bind work with `ExecutionContext.provide` before execution or forking.
The synchronous SDK boundary interprets host callbacks with system authority;
native transports start their scoped fibers with the validated caller provided.

Host operation preparation is a lazy Effect with its own typed rejection channel.
After preparation succeeds, admission and reservation cleanup are coordinated
without interruption. Rejected admission releases the prepared task's reservation;
accepted work retains its resources until its execution fiber settles.
SDK boundaries adapt Valibot input errors while preserving service failure types.
Unexpected exceptions constructing a workflow remain defects.

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

The desktop graph is assembled from domain Layers selected by the
[composition root](../packages/sdk/src/runtime/composition.ts). Each service's
Layer implementation acquires its declared dependencies. The composition root
selects
implementations and connects dependencies with `Layer.provide` and
`Layer.provideMerge`. Domain integration modules import collaborating service keys,
not their live Layers. Keep mutable state inside acquisition, never in the Layer
definition's module scope. Service operations have no outstanding requirements.

Persistence Layers acquire ready storage capabilities and own their connection
cleanup. Consumers yield the storage key and use its operations directly; they
do not open or manage the underlying connection.

Domains also own lazy API registration programs in their integration modules. After
the
service graph is acquired, the composition root runs these programs to assemble
domain controllers and register them with the shared IPC transport. Desktop
integrations and lifecycle operations consume service keys directly. The
`runtime.services` object is an inspection projection for host and test callers;
do not use it as a dependency container for runtime assembly.

`RuntimeEnvironment` supplies host configuration, paths, platform ports and
pre-start settings registrations to assembly modules. Seeding finishes before
the domain graph is acquired. The assembled `Desktop` publishes controllers and
connects lifecycle integrations before ordered initialization begins.
`ManagedRuntime` owns the graph, its resources, readiness, and work started by
the host runners. See the
[runtime boundary](../packages/sdk/src/runtime/runtime.ts).

Startup retains its fiber, and readiness follows its exit. Shutdown interrupts
pending startup and preserves native I/O settlement. After successful startup,
shutdown closes operation admission, drains accepted work, and stops processes
before disposing the managed graph. Failed acquisition releases partial resources
and preserves the startup error even when cleanup fails.

Daemon, process and autostart shutdown each share one terminal program between
explicit callers and scoped cleanup. Desktop startup-failure and disposal paths
share one ordered shutdown program. Every caller waits for settlement;
interrupting a caller does not abandon terminal cleanup. Operation drains remain
repeatable because they exclude the calling operation.

Host execution uses `eden.runPromise` or `eden.runFork`. Native IPC and protocol
adapters own their callback fibers in their acquisition scopes. Services compose
Effects and receive no outer runtime runner. Test fixtures can acquire standalone
services through their own scoped helper without adding an acquisition API to
the desktop runtime.

Layer dependencies determine acquisition order; resource owners register cleanup
with `Effect.acquireRelease` alongside construction. Ordered
[initialization and shutdown](../packages/sdk/src/runtime/lifecycle.ts) are
separate from graph construction. Shutdown explicitly closes operation
admission, drains accepted work, and stops processes before disposing the graph.
Host settings registrations have a separate synchronous owner so registration
does not require starting the desktop services.

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
