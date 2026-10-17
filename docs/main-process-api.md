# Main-process API

`@edenapp/sdk` exposes a typed API from the host returned by `createEden()` for
trusted Electron main-process integrations. These APIs are not available to sandboxed
apps or renderers.

```ts
import { createEden } from "@edenapp/sdk";

const eden = createEden(config);

// Registration APIs are also available before operational startup completes.
const registration = eden.settings.registerPanel(definition, provider);
registration.setVisible(false);
registration.invalidate();

// Operational APIs become available after startup has completed.
await eden.whenReady();

const packages = eden.packages.list({ showHidden: true });
const daemons = await eden.runPromise(eden.daemons.list());
```

## Lifecycle

`eden.state` reports `created`, `starting`, `ready`, `failed`, `stopping`, or
`stopped`. Await `eden.whenReady()` before accessing operational facades. The
promise rejects with the startup failure and never resolves while Eden is only
partially initialized.

`createEden(config)` starts the runtime when Electron is ready. Application quit
requests await runtime disposal. Hosts can also call `await eden.dispose()` for
explicit teardown; repeated calls await the same cleanup and release application
lifecycle subscriptions. Disposing before Electron is ready prevents startup.

Registration APIs, such as `eden.settings.registerPanel()`, are available both
during startup and later when a host integration is loaded dynamically. Disposal
releases those registrations even when startup has not begun; new registrations
and attempts to invalidate or change their visibility then throw.

## Domain facades

The main-process API is grouped by stable domain rather than exposing manager
implementations:

- `eden.packages` inventories, inspects, installs, and uninstalls both apps and
  DLCs, and controls app-specific reload behavior.
- `eden.daemons` reads and controls daemon definitions and runtime state.
- `eden.users` manages user profiles, grants, defaults, and passwords.
- `eden.sessions` reads and changes the interactive session.
- `eden.appearance` reads and changes appearance configuration.
- `eden.associations` manages configured capability providers.
- `eden.settings` registers host-owned Settings panels.

Returned manifests, profiles, statuses, settings declarations, and other DTOs
are detached copies. Mutating one does not mutate Eden's internal state. Change
subscriptions return idempotent unsubscribe functions:

```ts
const unsubscribe = eden.daemons.onChanged((status) => {
  console.info(status.appId, status.state);
});

unsubscribe();
unsubscribe(); // safe
```

Local event listeners are notifications and are not awaited transactionally.
Async domain methods return lazy Effects. Constructing one does not validate
inputs, admit an operation, or start I/O. Execute work through the owning host:

```ts
import * as Effect from "effect/Effect";

await eden.runPromise(Effect.gen(function* () {
  const user = yield* eden.users.create({ name: "Operator", password: "secret" });
  yield* eden.users.setDefaultUsername(user.username);
}));
```

`eden.runFork(work)` starts owned background work and returns its fiber. Runtime
shutdown interrupts and awaits owned work after the explicit operation drain.
Lifecycle methods (`whenReady` and `dispose`) remain Promise execution boundaries.
The sandboxed `@edenapp/client` keeps its Promise API.

## Trust and permissions

The instance facades are a trusted host API. Calling them is equivalent to
letting the host control its Eden runtime, so they must never be copied onto a
preload bridge or exposed through a renderer-selected method name.

SDK methods and change callbacks execute with host authority independently of
any app caller active in the surrounding main-process code. Inputs are validated
at the SDK controller boundary before mutation or operation admission. Malformed
arguments fail asynchronous Effects during execution or throw from synchronous methods;
runtime failures retain the method's existing error and operation behavior.
See [Controllers and domain events](controllers.md#sdk-controllers) for boundary
ownership and schema sharing.

Sandboxed apps use the shell-command transport instead. Its handlers enforce
the caller app's manifest permission and, when applicable, the active user's
grant through `Commands` and `ExecutionContext`. The built-in Control
Plane must use those typed commands rather than importing or proxying the host
facades.

Settings panel providers are a special host extension boundary: declarations
are copied and validated, callbacks remain in the main process, and renderer
actions are authorized and routed by `SettingsPanels`.

## Logging

Hosts can configure Eden's shared logger before constructing the runtime and
can use the same logger for host messages:

```ts
import { configureLogger, createEden, log } from "@edenapp/sdk";

configureLogger({ minLevel: "info", format: "pretty" });
log.info("Starting host");

const eden = createEden(config);
```
