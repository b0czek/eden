# Work with files and volumes

[Handbook](README.md) · Related: [Operations](ipc-architecture.md#operations), [Users](users.md)

Apps use virtual file addresses and typed filesystem commands.
Consumers register host directories as volumes.
This keeps app file references independent of operating-system mount paths.

## Declare access

Add the permissions your app needs to `manifest.json`:

| Permission | Access |
| --- | --- |
| `fs/read` | Read contents and metadata; list, search, and watch directories |
| `fs/write` | Create, change, copy, move, and delete files or directories |
| `fs/resolve` | Resolve a host path for an external integration |
| `volume/read` | List volumes and subscribe to volume changes |
| `volume/eject` | Request safe removal |

`fs/*` includes all filesystem permissions. `volume/*` includes all volume permissions.
User grants and account folder restrictions also apply.
A read-only volume permits reading and copying out, but rejects changes, including moves out.

## File addresses

A `FilesystemLocation` contains both a volume ID and a virtual path:

```ts
import type { FilesystemLocation } from "@edenapp/types";

const location: FilesystemLocation = { volume: "home", path: "/Documents/notes.txt" };
```

`/` means the selected volume's root.
Store and exchange both fields. The same path on another volume identifies a different file.

The built-in `home` volume maps `/` to the `home` folder in the consumer's `dataDirectory` for every account.
A folder restriction limits access without changing the address.
For example, a restriction of `projects/design` permits `home:/projects/design/notes.txt`.
See [shared folders](users.md#shared-filesystem-and-folder-restrictions).

Use `fs.accessScope("home")` to find the caller's accessible starting folder.
Unknown or disconnected volumes fail explicitly.
On an available volume, `fs.exists(location)` returns `false` for a missing file.

## Read and write

Install `@edenapp/client` in the app:

```ts
import { fs } from "@edenapp/client";

const location = { volume: "home", path: "/Documents/notes.txt" };
await fs.write(location, "Notes\n", { encoding: "utf8" });
const text = await fs.read(location);
const metadata = await fs.stat(location);
const names = await fs.readdir({ volume: "home", path: "/Documents" });
```

Text commands default to UTF-8 and accept other Node encodings.
Writes create missing parent directories within an available volume.
`readdir` returns entry names. Combine each name with the directory address before querying metadata.

`fs.stat` follows symbolic links. Use `fs.lstat(location)` to inspect the link itself,
including a dangling link. Its result also includes `isSymbolicLink`.
Moves and deletions operate on the link itself; access through parent folders
still follows volume and account restrictions.

Use `readBinary` and `writeBinary` for whole-file `Uint8Array` values:

```ts
const bytes = await fs.readBinary(location);
await fs.writeBinary({ volume: "home", path: "/notes-copy.bin" }, bytes);
```

`fs.search` searches file and folder names beneath a path on one volume.
Matching ignores case and accepts characters in order with gaps, so `nts` finds `Notes.md`.
Results put the best and nearest matches first. Each result includes its complete `location`.
An empty pattern lists the folder's own entries.
Search skips hidden entries and `node_modules` folders, and does not follow symbolic links.
On very large folder trees, it checks a limited number of entries, nearest folders first.

Search is a [stream](ipc-architecture.md#streams). Each chunk contains the best `results` found
so far and the number of entries `searched`. The last chunk contains the final results.
`limit` sets the number of results in each chunk, from 0 to 1000. The default is 10.

```ts
const search = await fs.search(location, "notes", { limit: 20 });
for await (const { results, searched } of search) {
  showResults(results, searched);
}
```

Stop reading when you no longer need more results, for example when the user changes the query.

### File handles

Open a handle when several reads must use the same opened file:

```ts
const handle = await fs.open(location, { mode: "read" });
try {
  const metadata = await fs.stat(handle);
  const bytes = await fs.readBinary(handle);
} finally {
  await fs.close(handle);
}
```

A handle is a serializable `{ handleId }` value.
`read`, `readBinary`, and `stat` accept a location or handle.
Location-based calls acquire and release access automatically.

Each whole-file read starts at byte zero.
A handle continues to refer to the opened file after pathname replacement or deletion.
It does not create a content snapshot or prevent another writer from changing that file.

Handles belong to the opening app, account, and session.
The same app's frontend and backend can share them under that identity.
Frontend-created handles close when their view closes. App stop and session teardown release remaining handles.
An unknown or closed handle fails explicitly. A runtime permits at most 1,024 open handles.

Close handles promptly. An open handle prevents safe removal from completing.
During safe removal, existing handles can continue reading until they close.
Physical removal makes reads fail. Reconnecting the volume does not reconnect old handles.

For raw shell commands, reads and stat use `{ location }`, where the value may also be a handle.
Open uses `fs/open({ location, mode })`. Close uses `fs/close({ handle })`.

## Opening files and picking locations

Ask Eden to open a file with its configured handler:

```ts
import { file } from "@edenapp/client";

const open = await file.open({ volume: "home", path: "/Documents/notes.txt" });
await open.result();
```

An app that handles files declares their extensions or MIME types:

```json
{
  "fileHandlers": [{ "name": "Text documents", "extensions": ["txt", "md"] }]
}
```

Read the first address from `getLaunchFile()`.
Listen for `file/opened` when an existing instance receives another file:

```ts
const initial = window.edenAPI.getLaunchFile();
if (initial) await openDocument(initial);

const handleOpened = ({ location, isDirectory }: import("@edenapp/types").EventData<"file/opened">) => {
  if (!isDirectory) void openDocument(location);
};
await file.subscribe("opened", handleOpened);

// On cleanup:
file.unsubscribe("opened", handleOpened);
```

Here `openDocument` is your app's loading function.

For a file selection dialog, install `@edenapp/tablets` and use its helper:

```ts
import { filePicker } from "@edenapp/tablets";

const location = await filePicker.openFile({
  initialLocation: { volume: "home", path: "/Documents" },
});
if (location) {
  const text = await fs.read(location);
}
```

The helper returns a complete address or no selection.
Pickers start at Home unless an initial location is supplied.
`allowedVolumes` limits the selector. Without an initial location, it selects the first allowed volume.
Save pickers exclude read-only destinations.
Picker calls require `file-picker/display`; file reads also require `fs/read`.
See [Tablets](../packages/tablets/README.md) for options.

## Copy and move

Source and destination can use different volumes:

```ts
const copy = await fs.cp(
  { volume: "home", path: "/Documents/notes.txt" },
  { volume: "usb-work", path: "/notes.txt" },
);
await copy.result();
```

`fs.mv` moves instead of copying.
Both commands reject existing destinations unless `overwrite: true` is supplied.
Overwrite replaces the complete destination, including directories; it does not merge contents.
Volume roots and overlapping source/destination trees cannot be transfer targets.

Copies preserve symbolic links and their targets.
Access through a copied link remains limited to the destination volume.
If an overwrite fails, Eden restores the original destination while its volume remains available.
A cross-filesystem move copies before deleting its source.
If source deletion fails, the destination remains and the operation reports an incomplete move.

See [operations](ipc-architecture.md#operations) for progress, cancellation, and repeated submissions.

## Trash

`fs.delete` permanently removes an item.
To let the user recover a Home item, move it to Trash instead:

```ts
const trashing = await fs.trash({ volume: "home", path: "/Documents/draft.txt" });
await trashing.result();
```

Only volumes with `supportsTrash: true` accept Trash. Currently, this is only Home.
Delete items on other volumes with `fs.delete`, after the user confirms.

Each item in `fs.trashEntries()` has an `id`, its `original` location, and `deletedAt`.
The list contains only items from folders that the caller can access, newest first.

| Command | Result |
| --- | --- |
| `fs.trashRestore(id)` | Moves the item back to its original location and creates missing parent folders |
| `fs.trashRestore(id, { location })` | Restores the item to another location |
| `fs.trashDelete(id)` | Permanently deletes one item |
| `fs.trashEmpty()` | Permanently deletes every item in the list |

These commands return [operations](ipc-architecture.md#operations).
If the destination is occupied, the restore result is `{ status: "occupied" }` and the item stays in Trash.
Ask the user for another name, then restore to that location.

Subscribe to `trash-changed` to refresh a Trash view. It requires `fs/read`.
Eden stores Trash in the `trash` folder of its data directory, outside every volume.
Use the Trash commands to read or change it.

## Watch a directory

Directory watching requires `fs/read` and a volume with `supportsWatch`.
Watches are non-recursive. Subscribe before creating the watch, then read the initial directory state:

```ts
import { fs } from "@edenapp/client";
import type { EventData } from "@edenapp/types";

let watchId: string | undefined;
const handleChanged = (event: EventData<"fs/changed">) => {
  if (event.watchId !== watchId) return;
  if (event.kind === "change") void refreshDirectory();
  else if (event.kind === "volume-removed") {
    watchId = undefined;
    reportDisconnected();
  } else reportLiveUpdateFailure();
};

await fs.subscribe("changed", handleChanged);
try {
  const watch = await fs.watch({ volume: "home", path: "/Documents" });
  watchId = watch.watchId;
  await refreshDirectory();
} catch (error) {
  fs.unsubscribe("changed", handleChanged);
  if (watchId) await fs.unwatch(watchId);
  throw error;
}

// On cleanup:
fs.unsubscribe("changed", handleChanged);
if (watchId) await fs.unwatch(watchId);
```

The refresh and reporting functions belong to your UI.
A watch belongs to the creating view. Eden releases it when the view, volume, or runtime closes.
Offer manual refresh on volumes without watch support.
Recreate watches if an eject attempt fails and the volume becomes ready again.

## Registering mounted drives

The consumer registers an already mounted directory through the host API:

```ts
await eden.whenReady();
await eden.runPromise(eden.volumes.register({
  id: "usb-work",
  label: "Work USB",
  kind: "removable",
  rootPath: "/media/operator/WORK",
  readOnly: false,
}));
```

The consumer owns device discovery, mounting, network authentication, and removal detection.
The root must be an existing absolute directory.
Use `local`, `removable`, or `network` for `kind`.
Network volumes refer to shares already mounted by the operating system.

Reuse the same stable ID when a drive reconnects.
`home` is reserved. Duplicate IDs are rejected.
Registrations last for one runtime; rebuild them after startup.
Watch support defaults to enabled for local/removable volumes and disabled for network volumes.
Set `supportsWatch` explicitly when needed.

Apps with `volume/read` use `volume.list()` and `volume.subscribe("changed", callback)`.
They receive volume metadata without host mount paths.
Hosts use `eden.volumes.list()` and `eden.volumes.onChanged(callback)`.

Use `fs.resolve(location)` only when an external integration needs a host path.
It requires `fs/resolve` and returns `{ realPath }`.

## Safely remove a volume

Supply an eject provider when registering the volume:

```ts
await eden.runPromise(eden.volumes.register(
  {
    id: "usb-work",
    label: "Work USB",
    kind: "removable",
    rootPath: mountedDirectory,
  },
  { eject: () => volumeProvider.eject(deviceId) },
));

await eden.runPromise(eden.volumes.eject("usb-work"));
```

In this example, `volumeProvider.eject()` is your OS adapter and returns an Effect.
It must succeed only after the OS flushes writes and releases the device or mounted share.
Fail the Effect if the device is busy or removal fails.
The volume advertises `supportsEject` when a provider is present.

Apps with `volume/eject` can request the same work:

```ts
import { volume } from "@edenapp/client";

const eject = await volume.eject("usb-work");
await eject.result();
```

The volume changes from `ready` to `ejecting`.
Eden closes watches, blocks new access, and waits for admitted I/O and open handles.
It then calls the provider. Observe volume changes or operation progress while waiting.
Success removes the volume. Failure restores `ready` so apps can resume access and retry.

Give related registrations the same `ejectGroup` option to remove them together.
The requested member's callback runs once and must release the complete physical group.
Home cannot be ejected.

After physical disconnection, call `eden.volumes.unregister(id)` to remove stale metadata.
For planned removal, await `eject()` so the OS can finish first.
