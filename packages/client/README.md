# @edenapp/client

Typed system commands and event subscriptions for Eden frontend and backend apps.

```sh
npm install @edenapp/client
```

```ts
import { db, fs, system } from "@edenapp/client";

const location = { volume: "home", path: "/notes.txt" };
await fs.write(location, "Hello", { encoding: "utf8" });
const stats = await fs.stat(location);
await db.set("theme", "dark");
const { value } = await db.get("theme");
const info = await system.info();
```

Use a namespace import when local names overlap:

```ts
import * as eden from "@edenapp/client";

await eden.db.get("theme");
await eden.package.list();
```


## Arguments and results

Each command becomes a method on its namespace. Hyphens and slashes become
camelCase: `fs/read-binary` is `fs.readBinary`, `db/get/su` is `db.getSu`, and
`file-picker/open` is `filePicker.open`.

Required top-level fields become positional arguments in declaration order.
Optional fields go in a final optional options object. Nested values retain
their structure. Commands without public arguments take no arguments.

```ts
await fs.stat(location);
await fs.write(location, "contents", { encoding: "utf8" });
await eden.process.list({ showHidden: true });
await system.info();
```

Methods return promises with the existing command result types. Responses such
as `{ value }` keep their structure. Operation commands return controls for
progress, completion, and cancellation:

```ts
const copy = await fs.cp(
  { volume: "home", path: "/notes.txt" },
  { volume: "home", path: "/backup.txt" },
  { overwrite: true, submission: { requestKey: "backup-notes" } },
);
const stop = await copy.watch((snapshot) => console.log(snapshot));
try {
  await copy.result();
} finally {
  stop();
}
```

`submission` is available for operation commands and supports the existing
request-key deduplication behavior. See [IPC operations](../../docs/ipc-architecture.md#operations).

File reads accept locations for one-shot access or plain handles returned by
`fs.open`. See [file handles](../../docs/filesystem.md#file-handles)
for repeated reads, close, and safe-removal lifetimes.

## Event subscriptions

Domains that declare events expose `subscribe` and `unsubscribe`. Event names
are local to the domain: `settings/panels-changed` becomes
`settings.subscribe("panels-changed", callback)`. Callback payloads are inferred
from the selected event.

```ts
import { settings } from "@edenapp/client";
import type { EventData } from "@edenapp/types";

const handleChanged = (event: EventData<"settings/panels-changed">) => {
  console.log(event.reason, event.panelId);
};

await settings.subscribe("panels-changed", handleChanged);

// When the owner is disposed, remove the same callback reference.
settings.unsubscribe("panels-changed", handleChanged);
```

`subscribe` returns `Promise<void>` and rejects if setup fails. `unsubscribe`
returns immediately and stops local delivery synchronously; remote cleanup
follows asynchronously. It can be called while setup is still pending. Register
component cleanup before awaiting setup so disposal always removes the listener.
Removing one callback leaves other listeners for the event active.

## Frontend and backend

The same imports work in both runtimes. Methods use the frontend's
`window.edenAPI` or the backend's `worker.edenAPI`. Include the client in your
app bundle; for a Node backend, bundle its entry with dependencies:

```sh
esbuild src/backend.ts --bundle --platform=node --format=esm --outfile=dist/backend.js
```

Client imports do not require a running Eden environment. Calling a method
requires the injected API. Permissions and errors follow the shell-command
contract. AppBus, launch helpers, and restoring operation controls remain
available through the injected APIs.

For development in this repository, regenerate the client with
`pnpm --filter @edenapp/sdk run codegen`, then build it with
`pnpm --filter @edenapp/client run build`.
