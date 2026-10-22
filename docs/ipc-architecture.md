# Call APIs and exchange messages

[Handbook](README.md) · Prerequisite: [Create an app](app-development.md)

Choose the connection by the work you need to do:

| Work | API | Frontend | Backend |
| --- | --- | --- | --- |
| Ask Eden to read files, manage apps, or change settings | EdenAPI / `@edenapp/client` | `window.edenAPI` | `worker.edenAPI` |
| Call your own backend or frontend | AppAPI | `window.getAppAPI()` | `worker.getAppAPI()` |
| Call another app's service | AppBus | `window.appBus` | `worker.appBus` |

The host injects these APIs when it starts the app.
AppAPI and AppBus share the same message and request methods.

## Call a system command

Install `@edenapp/client` and declare the command's permission in your manifest.
For example, `fs.stat` requires `fs/read`, and database access requires `db/rw`:

```ts
import { db, fs } from "@edenapp/client";

const stats = await fs.stat({ volume: "home", path: "/notes.txt" });
await db.set("theme", "dark");
const { value } = await db.get("theme");
```

Required fields become positional arguments. Optional fields use a final options object.
A namespace import helps when names overlap with local code:

```ts
import * as eden from "@edenapp/client";

const packages = await eden.package.list();
```

For the complete argument rules, see the [client guide](../packages/client/README.md).
The injected API also accepts the shell command name and an argument object:

```ts
const stats = await window.edenAPI.shellCommand("fs/stat", {
  location: { volume: "home", path: "/notes.txt" },
});
```

Both forms enforce the same manifest permissions and applicable user grants.
Handle rejected calls in the UI. A declared permission does not guarantee that
an account, resource, or operation is currently available.

## Subscribe to system events

Use a domain-local event name with the client:

```ts
import { settings } from "@edenapp/client";
import type { EventData } from "@edenapp/types";

const handleChanged = (event: EventData<"settings/changed">) => {
  console.info(event);
};

await settings.subscribe("changed", handleChanged);

// When the owner stops:
settings.unsubscribe("changed", handleChanged);
```

Keep the callback reference for cleanup.
`subscribe()` resolves after setup and rejects if setup fails.
`unsubscribe()` stops local delivery immediately.
Register component cleanup before awaiting subscription setup.
See the [client subscription guide](../packages/client/README.md#event-subscriptions) for lifecycle details.

## Connect a frontend to its backend

Declare both entry points in the app manifest.
Add these types to the respective TypeScript configurations:

```json
{ "compilerOptions": { "types": ["@edenapp/types/global"] } }
```

```json
{ "compilerOptions": { "types": ["node", "@edenapp/types/worker"] } }
```

Keep a shared protocol file in your app.
Here, the backend is the host side and the frontend is the peer side:

```ts
// protocol.ts
export type NotesProtocol = {
  hostMessages: { saved: { title: string } };
  peerMessages: {};
  hostHandles: {
    uppercase: { args: { text: string }; result: { text: string } };
  };
  peerHandles: {};
};
```

Each request declares separate `args` and `result` types.
`hostMessages` are sent by the backend; `hostHandles` are handled by the backend.

Register a request handler in the backend:

```ts
import type { HostConnection } from "@edenapp/types";
import type { NotesProtocol } from "./protocol";

if (!worker) throw new Error("Eden backend API is unavailable");
const connection = worker.getAppAPI() as HostConnection<NotesProtocol>;

connection.handle("uppercase", ({ text }) => ({ text: text.toUpperCase() }));
```

Call the handler from the frontend:

```ts
import type { PeerConnection } from "@edenapp/types";
import type { NotesProtocol } from "./protocol";

const connection = window.getAppAPI() as PeerConnection<NotesProtocol>;
const result = await connection.request("uppercase", { text: "hello" });
console.info(result.text);
```

`getAppAPI()` returns the connection synchronously. It throws if no connection exists.
Use it in an app with both entries.
Requests reject on failure or timeout. The default request timeout is 30 seconds.
TypeScript protocols describe expected messages; validate untrusted payloads in handlers.

For notifications, use `send()` and `on()`.
Use `off()` with the same callback to remove a message listener.
Use `removeHandler()` when the owner of a request handler is disposed.

## Expose a service to another app

Add `appbus/expose` to the provider's permissions.
Add `appbus/connect` to the client's permissions.
An optional manifest `services` array describes the service, but the provider must still expose it at runtime.

```json
{
  "permissions": ["appbus/expose"],
  "services": [{
    "name": "notes",
    "description": "Note text tools",
    "allowedClients": ["com.example.reader"]
  }]
}
```

The provider can reuse the protocol above:

```ts
import type { HostConnection } from "@edenapp/types";
import type { NotesProtocol } from "./protocol";

const registration = await window.appBus.exposeService("notes", (raw) => {
  const connection = raw as HostConnection<NotesProtocol>;
  connection.handle("uppercase", ({ text }) => ({ text: text.toUpperCase() }));
}, { allowedClients: ["com.example.reader"] });

if (!registration.success) throw new Error(registration.error);
```

The client connects to the running provider:

```ts
import type { PeerConnection } from "@edenapp/types";
import type { NotesProtocol } from "./protocol";

const raw = await window.appBus.connect("com.example.notes", "notes");
if ("error" in raw) throw new Error(raw.error);

const connection = raw as PeerConnection<NotesProtocol>;
const result = await connection.request("uppercase", { text: "hello" });
console.info(result.text);

// When the client no longer needs the service:
connection.close();
```

Use `listServices()` or `listServicesByApp(appId)` to discover exposed services.
Use `unexposeService(name)` when the provider removes a service.
A failed duplicate registration leaves the existing service active.
Stopping a provider removes its services and closes connected peers.
Use `onClose()` to update client state and reconnect after the provider returns.

## Operations

Some system commands complete before their Promise resolves.
Others return an operation object after Eden accepts the request.
For an operation, await `result()` when later work needs the final outcome:

```ts
import { fs } from "@edenapp/client";

const copy = await fs.cp(
  { volume: "home", path: "/notes.txt" },
  { volume: "home", path: "/backup.txt" },
  { overwrite: true },
);
const stopWatching = await copy.watch((snapshot) => {
  console.info(snapshot.status, snapshot.phase, snapshot.progress);
});
try {
  await copy.result();
} finally {
  stopWatching();
}
```

`watch()` includes the current retained snapshot. Progress watching is optional.
`get()` reads one snapshot. `result()` waits for completion without progress updates.
Accepted work continues independently of the submitting view or backend.

### Cancel work

Check `snapshot.cancellable` before offering a cancel control.
Call `cancel()` to request cancellation, then continue observing until cleanup finishes.
For a cancelled operation, `result()` rejects with an `AbortError`.
Cancellation can be refused after work reaches its commit boundary.

A cancelled filesystem copy removes its incomplete destination.
When replacing a file, it restores the previous destination while the volume remains available.
The source remains intact.

### Prevent duplicate submission

Set an optional request key when repeated submission should refer to the same work:

```ts
const copy = await fs.cp(
  { volume: "home", path: "/notes.txt" },
  { volume: "home", path: "/backup.txt" },
  { submission: { requestKey: "backup-notes" } },
);
```

Within one app and login session, the same key and arguments return the retained operation.
Reusing the key for different arguments or another command fails.
The API does not retry automatically.

### Restore observation

An operation's `handle` is a serializable `{ command, id }` value.
Save that value when the app needs to resume observation after reopening:

```ts
const restored = window.edenAPI.operations.from(copy.handle);
const snapshot = await restored.get();
```

Apps can inspect only their own operations in the same login session.
Handles belong to one Eden runtime.
Completed results and request keys remain available for fifteen minutes.
Active work remains until completion.
Each app and the host have 32 reserved record slots and share 256 burst slots.
Each can retain 128 records, including completed work. Quotas span login sessions.
Full capacity rejects new work; a matching retained request key still returns its original operation.

### Handle completion and teardown

Most failed operations reject `result()` with a sanitized error.
Some commands define a typed failure response; inspect that response as well.
The command's result type states which form it uses.

IPC responses have a ten-second deadline. Accepted operation execution has no transport deadline.
Session changes and runtime shutdown drain accepted work before teardown.
A successful logout or self-exit can close the caller before it sees completion.
For self-exit, awaiting acceptance is sufficient.
Power operation completion records host handoff, not completion of the operating system's shutdown.

Hosts can observe all retained operations through `eden.operations`.
See the [host API](main-process-api.md) for trusted main-process work.
