# Main-process API

`@edenapp/sdk` exposes a stable, typed API from the `Eden` instance for trusted
Electron main-process integrations. These APIs are not available to sandboxed
apps or renderers.

```ts
import { Eden } from "@edenapp/sdk";

const eden = new Eden(config);

// Registration APIs are also available before operational startup completes.
const registration = eden.settings.registerPanel(definition, provider);
registration.setVisible(false);

// Operational APIs become available after startup has completed.
await eden.whenReady();

const apps = eden.apps.list({ showHidden: true });
const daemons = await eden.daemons.list();
```

## Lifecycle

`eden.state` reports `created`, `starting`, `ready`, `failed`, `stopping`, or
`stopped`. Await `eden.whenReady()` before accessing operational facades. The
promise rejects with the startup failure and never resolves while Eden is only
partially initialized.

Registration APIs, such as `eden.settings.registerPanel()`, are available both
during startup and later when a host integration is loaded dynamically.

## Domain facades

The main-process API is grouped by stable domain rather than exposing manager
implementations:

- `eden.apps` lists, inspects, installs, removes, and reloads apps.
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
Operations whose failure must affect the caller remain explicit async methods.

## Trust and permissions

The instance facades are a trusted host API. Calling them is equivalent to
letting the host control its Eden runtime, so they must never be copied onto a
preload bridge or exposed through a renderer-selected method name.

Sandboxed apps use the shell-command transport instead. Its handlers enforce
the caller app's manifest permission and, when applicable, the active user's
grant through `CommandRegistry` and `ExecutionContext`. The built-in Control
Plane must use those typed commands rather than importing or proxying the host
facades.

Settings panel providers are a special host extension boundary: declarations
are copied and validated, callbacks remain in the main process, and renderer
actions are authorized and routed by `SettingsPanelManager`.

## Logging

Hosts can configure Eden's shared logger before constructing the runtime and
can use the same logger for host messages:

```ts
import { configureLogger, Eden, log } from "@edenapp/sdk";

configureLogger({ minLevel: "info", format: "pretty" });
log.info("Starting host");

const eden = new Eden(config);
```
