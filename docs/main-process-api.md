# Use the host API

[Handbook](README.md) · Prerequisite: [Create a consumer](consumer-development.md)

`createEden()` returns the host API for trusted Electron main-process code.
Use it to manage your desktop and connect product integrations.
Apps use the [client API](ipc-architecture.md) instead.

## Wait for startup

```ts
import { createEden } from "@edenapp/sdk";

const eden = createEden();
await eden.whenReady();

const packages = eden.packages.list({ showHidden: true });
const daemons = await eden.runPromise(eden.daemons.list());
```

Call `createEden()` before Electron readiness. It starts Eden when Electron is ready.
`whenReady()` resolves only after startup completes. It rejects if startup fails.
Wait for it before using operational APIs.

`eden.state` is `created`, `starting`, `ready`, `failed`, `stopping`, or `stopped`.
Settings panel registration is available before readiness and while Eden is running.

## Execute host work

Snapshot reads return values immediately. Asynchronous methods return lazy Effects.
Creating an Effect does not perform the work. Pass it to `eden.runPromise()`:

```ts
const work = eden.users.list();
const users = await eden.runPromise(work);
```

For host code that imports Effect, install it as a direct dependency.
Use a version compatible with the SDK; the current source uses Effect 4:

```bash
npm install effect@^4.0.5
```

Compose related steps before executing them:

```ts
import * as Effect from "effect/Effect";

const user = await eden.runPromise(Effect.gen(function* () {
  const profile = yield* eden.users.create({
    name: "Operator",
    password: "local-example-only",
    grants: ["apps/launch/*", "settings/*"],
  });
  yield* eden.users.setDefaultUsername(profile.username);
  return profile;
}));
```

Execution is sequential here. The steps do not form a storage transaction.
Expected failures use the Effect error channel. Use Effect recovery operators
when the host needs to handle a particular domain failure.
Input validation also runs when the Effect executes.

Use `eden.runFork(work)` for background work owned by this runtime.
It returns a fiber. Eden interrupts and awaits owned background work during shutdown.
Use the host runners so the work uses the owning runtime's resources and lifetime.

## Select a domain

| API | Supported work |
| --- | --- |
| `eden.packages` | List, inspect, install, remove, and reload apps or DLCs |
| `eden.daemons` | Read definitions and start, stop, or restart services |
| `eden.users` | Manage accounts, passwords, grants, and the default user |
| `eden.sessions` | Read the current user, log in, and log out |
| `eden.appearance` | Read presets and change wallpaper |
| `eden.associations` | Read and configure capability providers |
| `eden.settings` | Register host-owned Settings panels |
| `eden.volumes` | Register mounted directories and coordinate safe removal |
| `eden.operations` | Observe accepted work across the runtime |

See the [public domain contracts](../packages/sdk/src/api/control-plane.ts)
for method signatures and failure types.
See [Settings contracts](../packages/sdk/src/api/settings.ts) for panel registration.

For example, install an archive from a host filesystem path:

```ts
const manifest = await eden.runPromise(
  eden.packages.install("/srv/packages/notes.edenite"),
);
```

Stop an installed app before replacement or removal.
Built-in apps and development apps cannot be replaced through package installation.

## Observe changes

Change subscriptions return an unsubscribe function:

```ts
const unsubscribe = eden.daemons.onChanged((status) => {
  console.info(status.appId, status.state);
});

// When this integration stops:
unsubscribe();
```

Repeated unsubscribe calls are safe.
Callbacks receive notifications. Eden does not wait for asynchronous callback work before continuing an operation.
Use an explicit host operation when later work must wait for completion.

Returned profiles, manifests, and snapshots are copies.
Change state through API methods. Editing a returned object does not update Eden.

## Keep host authority in the main process

Host methods run with host authority. They do not inherit an app caller's permissions.
Keep the host object out of preload bridges and renderer-selected method dispatch.
Apps request authorized work through typed shell commands.

Configure capability providers through `eden.associations`.
Use declared capability permissions to find defaults, such as `file-picker/display`.
Provider selection lets a consumer replace a system app without changing the integration.

For host extensions, see [Settings panels](settings.md#host-registered-panels),
[mounted drives](filesystem.md#registering-mounted-drives), and [power providers](power-management.md).

## Stop the runtime

```ts
await eden.dispose();
```

Electron quit already waits for Eden cleanup.
Use explicit disposal when your host needs to stop Eden itself.
Repeated calls await the same cleanup.
Disposal before Electron readiness prevents startup.
Eden drains accepted operations and stops apps before releasing runtime resources.

## Configure logging

Configure logging before constructing Eden:

```ts
import { configureLogger, createEden, log } from "@edenapp/sdk";

configureLogger({ minLevel: "info", format: "pretty" });
log.info("Starting desktop");
const eden = createEden();
```
