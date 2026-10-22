# Run apps and background services

[Handbook](README.md) · Related: [Users and sessions](users.md), [Host API](main-process-api.md)

Eden runs at most one instance of each app ID.
An app with a frontend normally belongs to the current login session.
A backend-only app can also run as a supervised daemon.

## Choose an app lifetime

| App | Start path | Lifetime |
| --- | --- | --- |
| Frontend, with or without a backend | Launcher, session autostart, or `process/launch` | Current session |
| Backend-only, launched directly | `process/launch` | Current session |
| Backend-only, managed as a daemon | Daemon boot configuration or `daemon/start` | Until stopped or Eden shuts down |

A daemon has `backend.entry` and no `frontend.entry`:

```json
{
  "id": "com.example.worker",
  "name": "Worker",
  "version": "1.0.0",
  "backend": { "entry": "dist/index.js" },
  "permissions": ["db/rw"]
}
```

Build and bundle the backend as described in [app development](app-development.md#add-a-backend-when-needed).

## Launch an app from app code

Declare `process/launch` permission, then await the launch operation:

```ts
import { process } from "@edenapp/client";

const launch = await process.launch("com.example.notes");
await launch.result();
```

Launch, stop, exit, and daemon start/stop/restart commands return operation objects.
Await `result()` when subsequent work needs completion.
For self-exit, await acceptance; the caller may close before it sees completion.

A launched instance becomes available after its backend is ready and its frontend exists.
Failed startup releases the resources it acquired.
Launch, stop, and reload for the same app are serialized.

## Sessions and autostart

On logout or account change, Eden stops apps owned by the outgoing session before committing the next session.
Managed daemons survive that transition.

Seed interactive startup apps in the `com.eden` settings namespace:

```json
{
  "settings": {
    "com.eden": { "autostart.com.example.notes": "true" }
  }
}
```

Session autostart ignores backend-only apps.
Configure those as daemons when they should start at boot.
Daemon startup happens before the first interactive session is committed.

## Configure a daemon from the host

Install or include the daemon app first.
Choose an existing Eden account for its authorization identity:

```ts
await eden.whenReady();
await eden.runPromise(eden.daemons.updateDefinition({
  appId: "com.example.worker",
  enabled: true,
  runAs: { kind: "user", username: "worker" },
  restart: "on-failure",
}));
await eden.runPromise(eden.daemons.start("com.example.worker"));
```

| Field | Meaning |
| --- | --- |
| `enabled` | Start during the next Eden boot |
| `runAs` | Eden account used when the daemon starts; `null` means unassigned |
| `restart` | `never`, `on-failure`, or `always` |

Assign an account before enabling or starting a daemon.
Changing `enabled` does not start or stop the current process.
Use `start`, `stop`, or `restart` for the current boot.
Definition changes are saved and adopted immediately.
A running daemon needs a restart to adopt a changed account.

Read state with `eden.runPromise(eden.daemons.list())`.
Subscribe with `eden.daemons.onChanged(callback)` and release the returned subscription when your integration stops.
App-based management uses `daemon/read` or `daemon/manage` permissions.

## Ownership and principal

An instance's **owner** controls its lifetime.
A session owner stops at session replacement; a system owner survives login and logout.
Managed daemons are system-owned.

An instance's **principal** controls Eden authorization.
A daemon running as a user keeps a launch-time snapshot of that account's grants and folder restriction.
Restart it after account changes to apply the new identity.
All accounts resolve Home against the same `userDirectory`.

This identity controls Eden commands. It does not change the backend's operating-system UID or GID.
Backend code remains trusted Node.js code with direct host API access.

## Seed a boot service

Put a daemon definition in the consumer's `eden.config.json` settings.
The key is `daemon.<appId>` and the value is a JSON-encoded definition:

```json
{
  "settings": {
    "com.eden": {
      "daemon.com.example.worker": "{\"appId\":\"com.example.worker\",\"enabled\":true,\"runAs\":{\"kind\":\"user\",\"username\":\"worker\"},\"restart\":\"on-failure\"}"
    }
  }
}
```

Seed the referenced account in `users` and include the daemon in the build's `apps` list.
Seed data applies only on first run. It does not overwrite later administrative changes.

Unexpected exits use the configured restart policy with bounded exponential backoff.
Intentional stops, reloads, and Eden shutdown do not trigger failure restarts.
