# Processes and Daemons

`ProcessManager` manages the lifecycle of every Eden app process.
`DaemonManager` adds persistent configuration and supervision policy for
backend-only processes and delegates their lifecycle operations to
`ProcessManager`.

## Responsibilities

`ProcessManager` owns process mechanics:

- the authoritative map of running `AppInstance` objects;
- the one-running-instance-per-app-ID invariant;
- backend creation and termination through `BackendManager`;
- frontend view creation and removal through `ViewManager`;
- appbus service cleanup;
- runtime execution-context registration;
- process launch, stop, exit, reload, metrics, and shutdown events;
- filtering and stopping processes by lifetime owner.

`DaemonManager` owns daemon policy:

- discovering installed backend-only apps;
- loading and persisting daemon definitions;
- boot enablement;
- fixed execution-principal selection;
- start, stop, and restart commands;
- restart policy, failure state, and bounded exponential backoff;
- presenting daemon status to management UI.

All daemon process creation, view handling, runtime-instance tracking, and
termination remain within `ProcessManager` and its existing collaborators.

## Classifying Apps

An installed app is treated as a daemon when its manifest has a backend entry
and no frontend entry:

```ts
!!manifest.backend?.entry && !manifest.frontend?.entry
```

`process/launch` may launch any installed app directly. Such a process belongs
to the interactive session. Starting a backend-only app through `daemon/start`
instead gives it system ownership and daemon supervision. Session autostart
filters out backend-only apps. Apps with a frontend remain session-owned when
launched normally, even when they also have a backend.

## Ownership and Principal

Ownership and authorization identity are separate concepts.

`AppInstance.owner` controls lifetime:

- `{ kind: "session", sessionId, username }` means the process belongs to an
  interactive session and must stop when that session is replaced.
- `{ kind: "system" }` means the process survives login and logout transitions
  and stops only through daemon management, reload, or Eden shutdown.

`AppInstance.principal` controls Eden authorization and managed filesystem
resolution:

- `{ kind: "system" }` uses manifest base permissions.
- `{ kind: "user", username }` uses a launch-time snapshot of that Eden
  account's role, grants, and home configuration.

Every daemon is system-owned, regardless of its principal. A daemon configured
to run as an Eden user keeps that launch-time identity across session changes.
Account or home changes take effect after the daemon restarts.

These principals affect Eden command authorization and Eden-managed filesystem
paths. System principals use the configured `userDirectory`; user principals
use the account home rules described in
[Filesystem Homes](users.md#filesystem-homes). Backend code remains trusted
Node.js code and retains its host-process UID and GID.

### Execution Context

`ExecutionContext.run(context, task)` establishes the caller identity for one
asynchronous operation. Code reached from `task`, including code after an
`await`, can use `getPrincipal()`, `hasGrant()`, and the other execution-context
checks without passing the caller through every method:

```ts
await executionContext.run(
  { principal: { kind: "user", profile } },
  async () => {
    await processManager.launchApp("com.example.app");
  },
);
```

The context uses Node.js `AsyncLocalStorage`. Concurrent operations may carry
different principals without changing each other, and the context stops being
active when its task finishes. It does not change `SessionContext` or the
logged-in user. IPC commands establish it in `CommandRegistry`;
system-triggered work such as session autostart establishes it explicitly
before calling code that performs authorization checks.

## Sessions and Autostart

Session IDs are opaque and change when the interactive identity changes.
`SessionManager` stops all processes owned by the old session before committing
the new session. System-owned daemons remain outside that selection.

`AutostartManager` handles frontend-bearing session applications after a
session is committed. It ignores backend-only apps. `DaemonManager` handles
backend-only boot services independently and initializes before the first
interactive session is committed.

Daemon boot launch belongs to `DaemonManager`; interactive application launch
belongs to `AutostartManager`. Process ownership is assigned at launch.

## Definitions and Runtime Behavior

A daemon definition contains:

```ts
{
  appId: string;
  enabled: boolean;
  runAs: { kind: "user"; username: string } | null;
  restart: "never" | "on-failure" | "always";
}
```

Definitions are stored in the Eden settings namespace and adopted immediately
when saved. There is no separate “reload definitions” phase.

- `enabled` controls launch during the next Eden boot. Toggling it does not
  implicitly start or stop the current process.
- `runAs` selects the Eden account used when the process launches. A daemon
  must have an account before it can be enabled or started. Changing it on a
  running daemon marks the daemon as requiring restart.
- `restart` is supervisor policy and applies to subsequent exits.
- Start, stop, and restart are explicit current-boot operations.

Daemon definitions can be included in the normal first-run settings seed. Use
the `com.eden` namespace and the key `daemon.<appId>`; the value is the
JSON-encoded definition:

```json
{
  "settings": {
    "com.eden": {
      "daemon.com.example.worker": "{\"appId\":\"com.example.worker\",\"enabled\":true,\"runAs\":{\"kind\":\"user\",\"username\":\"worker\"},\"restart\":\"on-failure\"}"
    }
  }
}
```

Seed the referenced account in `users` as well. The daemon app must be
installed when daemon initialization runs. Settings seeding is a first-run
operation and does not overwrite definitions changed by the user.

Unexpected exits follow the configured restart policy. Restarts use bounded
exponential backoff. Intentional stops, reloads, and Eden shutdown are excluded
from failure restart handling.
