# Controllers and domain events

[Handbook](README.md) · Audience: SDK contributors

Use this chapter when changing the SDK itself.
For a consumer integration, use the [host API](main-process-api.md).
For app code, use [APIs and messages](ipc-architecture.md).

## Choose the owner

A service owns domain state, rules, operations, and local events.
A controller validates public input and exposes selected service behavior.
The composition root selects implementations and connects dependencies.

| File | Responsibility |
| --- | --- |
| `service.ts` | Service interface, `Context.Service` key, and Layer implementation |
| `controller-edenapi.ts` | App commands and public event names |
| `controller-sdk.ts` | Trusted host methods |
| `runtime.ts` | Domain integration and API registration, when needed |
| `types.ts`, `errors.ts`, `ports.ts` | Shared values, expected failures, and external capability contracts, when needed |

Keep small domains small. Extract a file when it owns a separate responsibility.
Import internal capabilities directly from their owning modules.
`packages/sdk/src/index.ts` is the package export boundary.

Under `packages/sdk/src`, `platform/` contains host adapters, filesystems,
persistence, and logging. `core/` contains shared service primitives,
authorization, commands, operations, settings, and localization.
`applications/` contains package management, processes, daemons, app channels,
and associations. `desktop/` contains views, sessions, and desktop interactions.
Keep each domain's controllers, ports, service, and unit tests together.
`runtime/` composes these domains, while `api/` exposes the trusted host API.

## Define a service

Declare the interface first, the same-named key second, and the implementation third.
Use capability names such as `Processes`, `Volumes`, and `SettingsPanels`.
Name their implementations `ProcessesLive`, `VolumesLive`, and `SettingsPanelsLive`.

This small example keeps state and its event source in one scope:

```ts
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { Event } from "../events/event";
import { scopedEvent } from "../events/scoped";

export interface Counter {
  get(): number;
  increment(): Effect.Effect<number>;
  changed: Event<{ value: number }>;
}

export const Counter = Context.Service<"eden/Counter", Counter>("eden/Counter");

export const CounterLive = Layer.effect(Counter, Effect.gen(function* () {
  let value = 0;
  const changed = yield* scopedEvent<{ value: number }>();
  return {
    get: () => value,
    increment: () => Effect.sync(() => {
      value += 1;
      changed.emit({ value });
      return value;
    }),
    changed,
  } satisfies Counter;
}));
```

Acquire dependencies with `yield*` inside the Layer.
Keep mutable instance state inside acquisition.
Use synchronous methods for current in-memory snapshots.
Use lazy Effects for I/O and workflows; construction must not start work.
Ordinary service methods return fully provided Effects with no outstanding requirements.
Layer acquisition can require dependencies and a scope.

Register cleanup beside resource acquisition with `Effect.acquireRelease` or scoped helpers.
Use explicit `Duration` values for waits and expiry.
Services compose work; the owning runtime executes it.
See [i18n](../packages/sdk/src/core/i18n/service.ts) and
[appearance](../packages/sdk/src/desktop/appearance/service.ts) for production examples.

## Adapt dependencies and failures

Use an existing service key when its capability fits.
Introduce a domain port when the domain needs a distinct external contract or adapter.
Declare the port beside its contract and bind it at composition time.
A domain Layer declares dependencies without choosing their implementations.

Use domain-owned `Data.TaggedError` classes for expected, actionable failures.
Declare each method's actual failure union.
Keep relevant IDs and preserve the original cause when adapting another failure.
Programming mistakes remain defects; cancellation remains interruption.
Preserve cleanup failures alongside the original failure or interruption.

Compose existing Effects directly.
Adapt native Promise producers with the SDK's `fromPromise(evaluate, onError)` helper
when interruption and native cleanup must settle together.
Translate an error where its meaning changes.

For main-process filesystem work, use the [native I/O facade](../packages/sdk/src/platform/filesystem/native-io.ts).
Use `io.writeFileAtomic` for complete-file replacement; the caller owns serialization and parent creation.
Synchronous pre-runtime hooks use the [sync adapter](../packages/sdk/src/platform/filesystem/native-sync.ts).
Preloads must remain free of runtime Effect dependencies.

## Add commands

An EdenAPI controller assigns the public namespace and validates inputs:

```ts
import * as v from "valibot";
import { command, defineController } from "../controllers/controller";
import type { Counter } from "./service";

export function createCounterController(counter: Counter) {
  return defineController("counter", {
    commands: {
      get: command({ handle: () => ({ value: counter.get() }) }),
      increment: command({ permission: "write", handle: () => counter.increment() }),
      echo: command({
        input: v.object({ text: v.string() }),
        handle: ({ text }) => ({ text }),
      }),
    },
    events: { changed: counter.changed },
  });
}
```

`permission: "write"` requires `counter/write` in this namespace.
The handler receives validated arguments and a separate trusted caller context.
Omit `input` for commands without public arguments.
Return an ordinary value or a fully provided Effect.

Share schemas between app and SDK controllers when their input contracts match.
Keep host-only path and provider validation at the SDK boundary.
Services enforce state-dependent invariants and validate persisted data.

Required schema fields become positional client arguments in declaration order.
Treat field reordering as a public API change.
Generated names are sorted; argument order is preserved.

## Add an operation command

Use `operation` for retained work that outlives its submitting caller:

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

This fragment follows the [power controller](../packages/sdk/src/desktop/power/controller-edenapi.ts).
Preparation validates and admits work synchronously before acceptance.
It returns a function that receives a reporter and produces a fully provided Effect.
For resource admission, a handler can return an `OperationTask` synchronously instead.
A task with a reservation supplies an idempotent `release` callback.

The operation runtime owns execution, progress, cancellation, and completion.
For cancellable work, yield `reporter.commit` at the transaction's commit boundary.
Keep it inside the rollback-protected region before discarding recovery data.
Cancellation interrupts the fiber; terminal status follows finalizer completion.

Supply `encodeFailure` only when a command has a typed public failure response.
Defects remain failures. A successful `false` or `{ success: false }` value is still a successful execution.
See [app operation behavior](ipc-architecture.md#operations) for the client contract.

## SDK controllers

Host controllers return synchronous snapshots, lazy Effects, and unsubscribe functions.
They validate input and use `SdkContext` to establish host authority.
Return detached public data and preserve service failure types.
Use the shared `effect`, `operation`, and `subscribe` boundaries for their respective work.

Caller authority belongs to the executing Effect fiber.
Use `ExecutionContext.provide` to bind work before execution or forking.
Keep host authority independent of an app caller active in surrounding code.
See [appearance](../packages/sdk/src/desktop/appearance/controller-sdk.ts) and
[sessions](../packages/sdk/src/desktop/session/controller-sdk.ts) for examples.

## Events

Use `scopedEvent()` for a scope-owned source and `listen()` for an upstream subscription.
For a synchronous owner, use `createEvent()` and dispose its source during owner cleanup.
Each source's `.on()` returns an idempotent unsubscribe function.

Publish a typed domain event after the relevant state changes.
Local callbacks run synchronously during emission, and listener failures are isolated and logged.
Returned Promises are not awaited.
Use an explicit service operation when a caller must wait for coordinated work.

Expose selected sources through the controller's `events` map.
Registration forwards them to authorized app subscriptions and releases forwarding on disposal.
Use `targetedEvent(source)` for `TargetedNotification<Payload>` with explicit `viewIds`.
Use `routedEvent(source)` for `RoutedNotification<Payload>` when broadcast is also needed.
An empty audience delivers nothing. Routing metadata stays out of public payloads.
Use `authorizedEvent(source, authorize)` for data whose read access varies by recipient.
The policy receives the payload and the recipient's current app identity and principal before delivery to a renderer or backend.

## Compose and verify

Bind Layers in the [composition root](../packages/sdk/src/runtime/composition.ts).
Domain integration modules acquire collaborator keys, then register their controllers.
Use the runtime's service projection for inspection rather than dependency assembly.

Ordered initialization and shutdown belong to the [runtime lifecycle](../packages/sdk/src/runtime/lifecycle.ts).
Shutdown closes operation admission, drains accepted work, stops processes, then releases the graph.
Partial startup failure releases acquired resources and preserves its failure.

After a public controller change, regenerate and build the client:

```bash
pnpm --filter @edenapp/sdk run codegen
pnpm --filter @edenapp/client run build
```

Run the checks appropriate to the domain, including `pnpm check:effects`.
See [contributor testing](testing.md) for suite boundaries and diagnostics.
