# Filesystem Access

Eden apps access files through typed shell commands. Filesystem operations are
restricted by the permissions declared in the app manifest:

- `fs/read` permits reading metadata and contents, listing and searching
  directories, and watching directories.
- `fs/write` permits creating, changing, copying, moving, and deleting files
  and directories.
- `fs/resolve` permits resolving a location for an external integration.
- `fs/*` grants all filesystem permissions.
- `volume/read` permits discovering volumes and subscribing to inventory changes.
- `volume/eject` permits safely ejecting devices.
- `volume/*` grants all volume permissions.

## File Addresses

A file address is a `FilesystemLocation`: `{ volume: string, path: string }`.
Both fields are required. Paths are virtual and `/` means the root of the selected
volume. Persist and exchange complete addresses so files with the same path on
different drives remain distinct.

Keep addresses in a `location: FilesystemLocation` property when combining them
with command options or file metadata. Single-address commands take `{ location }`.
Operations with multiple addresses use named properties such as
`from: FilesystemLocation` and `to: FilesystemLocation`.

The built-in `home` volume maps `/` to `EdenConfig.userDirectory` for every
caller. Account folder restrictions limit access without changing addresses.
For example, a restriction of `"projects/design"` allows
`home:/projects/design/notes.txt`.
Accounts may share the same folder or overlapping folders. Registered drives
are shared across users and are independent of Home restrictions.

`fs/access-scope({ volume })` returns the caller's accessible starting folder
as a `FilesystemLocation`. Files and File Picker use it for initial navigation,
Home actions, and fallback after drive removal. Explicit initial locations
remain full addresses and must be accessible to the caller.

```typescript
const content = await window.edenAPI.shellCommand("fs/read", {
  location: { volume: "home", path: "/Documents/notes.txt" },
});
```

Unknown or disconnected volumes fail explicitly. Missing files on an available
volume return `false` from `fs/exists`. Read-only volumes permit reads and copies
out, but reject writes, deletes, moves out, and transfers into them.

## Registering Mounted Drives

The Electron consumer registers already mounted directories through the
main-process API. It owns device discovery, mounting, network authentication,
and OS removal notifications:

```typescript
import { Eden } from "@edenapp/sdk";

const eden = new Eden();
await eden.whenReady();

await eden.volumes.register({
  id: "usb-work",
  label: "Work USB",
  kind: "removable",
  rootPath: "/media/operator/WORK",
  readOnly: false,
});

// When the consumer detects removal:
eden.volumes.unregister("usb-work");
```

IDs identify volumes independently of mount paths and labels. Reuse an ID when
the same drive reconnects. `home` is reserved, and duplicate registrations are
rejected. A registration root must already exist and be an absolute directory.
Registrations belong to one Eden runtime and are rebuilt after startup.

Volume kinds are `local`, `removable`, and `network`. A network registration
points to a share already mounted by the OS. All kinds use the same commands.
The consumer can set `readOnly` and `supportsWatch`; watch support defaults to
true for local/removable volumes and false for network volumes.

`eden.volumes.list()` returns metadata. `eden.volumes.onChanged(listener)` passes
updated inventories and returns an unsubscribe function. Apps receive metadata
without host mount paths:

```typescript
import { volume } from "@edenapp/client";

const volumes = await volume.list();
await volume.subscribe("changed", ({ volumes }) => {
  updateVolumeSelector(volumes);
});
```

## Safely Removing Volumes

The consumer can supply an `eject` callback as the second argument to registration.
It uses the consumer's device integration and must resolve only when the OS has
finished flushing cached writes and releasing the volume. For a mounted share,
this means unmounting it; for a USB drive, safely ejecting the device. Reject the
callback when the OS reports a failure, such as a busy device.

```typescript
await eden.volumes.register(
  {
    id: "usb-work",
    label: "Work USB",
    kind: "removable",
    rootPath: mountedDirectory,
  },
  { eject: () => volumeProvider.eject(deviceId) },
);

await eden.volumes.eject("usb-work");
// The OS has confirmed safe removal.
```

Here `volumeProvider` is the consumer's OS adapter. The callback is optional.
Public metadata advertises `supportsEject` when it is supplied. Home cannot be
ejected.

Apps with `volume/eject` permission use the corresponding command:

```typescript
const eject = await window.edenAPI.shellCommand("volume/eject", { volume: "usb-work" });
await eject.result();
```

Removal first changes the volume's `state` from `ready` to `ejecting`, closes its
directory watches, and rejects new filesystem operations on it. Already admitted
operations finish before the OS callback runs. Subscribe to `volume/changed`
to show pending state while the OS flushes its caches; this may take minutes.
Frontend and backend eject commands return an operation object promptly. Use
`eject.watch(listener)` to observe phases and `eject.result()` to await safe removal.
The volume leaves the inventory after success.

Repeated requests share the same removal. If the callback rejects, the operation
retains that error and the volume returns to `ready`; apps can resume access,
recreate watches, and retry removal with a new submission. Read-only volumes can also be ejected.

`eden.volumes.unregister(id)` removes a registration after the consumer observes
disconnection. For safe removal, await `eject(id)`, which removes the registration
after the OS callback completes.

## Files navigation

The Places sidebar folds to an icon rail and expands again using its toggle.
It folds automatically in narrow windows until the user chooses a state, then
keeps that choice during resizing.

Pin a folder from its context menu or use **Pin current folder** in the sidebar.
Files keeps up to eight pinned folders, with editable names and color markers
that remain visible when folded. A pinned folder's action menu lets users edit
or unpin it. Pins on disconnected drives stay listed and become available when
their volume reconnects.

Ongoing operations appear in the sidebar's activity area. The folded view shows
a compact progress indicator; selecting it opens operation details. Copy
cancellation is available from the expanded activity area or the details dialog.

## Reading and Writing

Use `fs/readdir` to list entry names and `fs/stat` for metadata:

```typescript
const directory = { volume: "usb-work", path: "/Documents" };
const names = await window.edenAPI.shellCommand("fs/readdir", {
  location: directory,
});
const stats = await window.edenAPI.shellCommand("fs/stat", {
  location: { volume: directory.volume, path: `${directory.path}/${names[0]}` },
});
```

Text reads and writes default to UTF-8 and accept another Node encoding.
Writes create missing parent directories within an available volume:

```typescript
await window.edenAPI.shellCommand("fs/write", {
  location: { volume: "home", path: "/Documents/notes.txt" },
  content: "Notes\n",
});
```

Binary commands transfer whole files as `Uint8Array` values:

```typescript
const location = { volume: "usb-work", path: "/archive.bin" };
const bytes = await window.edenAPI.shellCommand("fs/read-binary", {
  location: location,
});
await window.edenAPI.shellCommand("fs/write-binary", {
  location: { volume: "home", path: "/archive-copy.bin" },
  content: bytes,
});
```

### File handles

The generated client accepts either a location or an open handle for `fs.read`,
`fs.readBinary`, and `fs.stat`. Location-based reads acquire access for one
operation and release it automatically. Open a handle when several operations
must use the same opened file:

```typescript
import { fs } from "@edenapp/client";

const location = { volume: "usb-work", path: "/notes.txt" };
const handle = await fs.open(location, { mode: "read" });
try {
  const metadata = await fs.stat(handle);
  const content = await fs.readBinary(handle);
} finally {
  await fs.close(handle);
}
```

`fs.open` opens a regular file and returns a serializable `{ handleId }` value
with no methods. The example above selects `"read"`, which is also the default
mode. Whole-file reads start at byte zero on every call, including concurrent
reads. The opened file survives pathname replacement or deletion, while a location-based read
uses the current file at that address. Handles do not provide a content snapshot
or block another writer from modifying the opened file.

Handles belong to the opening app, account, and session. They can be used by
that app's frontend or backend under the same identity; passing the value to
another app does not grant access. A frontend-created handle closes when its
view is removed. App stop closes remaining handles. Session transitions release
the outgoing session's handles before waiting for accepted operations, so a
pending eject can finish before apps stop. Power transitions release all retained
handles before waiting; runtime shutdown also closes remaining handles. Each
runtime permits at most 1,024 open handles. Reading, querying, or closing an
unknown or closed handle fails explicitly.

An open handle retains its volume's access until it closes. Safe eject blocks
new opens and location-based reads, waits for existing handles, and lets those
handles continue reading during removal. Close handles promptly when work
finishes. Physical removal or replacement of the registered volume makes reads
fail; the old handle does not attach to a reconnected volume.

Raw shell commands keep the `location` argument for reads and stat, accepting
either a location or handle there. Opening uses
`fs/open({ location, mode })`; closing uses `fs/close({ handle })`.

`fs/search` searches the selected volume beneath its given path. Each search
result includes a `location` with its volume and virtual path.

Resolve a host path only when an external integration needs it:

```typescript
const { realPath } = await window.edenAPI.shellCommand("fs/resolve", {
  location: { volume: "usb-work", path: "/Documents/report.txt" },
});
```

## Removing related volumes

Volumes registered with the same `ejectGroup` key are removed together. Ejecting
one member blocks new access to every member, waits for their existing I/O, and
calls the requested member's host eject callback once. That callback removes the
complete physical group. Failed removal restores access to remaining members.

## Opening Files and Picking Locations

`file/open` selects a configured handler using the file's type:

```typescript
const open = await window.edenAPI.shellCommand("file/open", {
  location: { volume: "usb-work", path: "/Documents/report.txt" },
});
const result = await open.result();
```

Handlers retrieve the initial address with `getLaunchFile()` and receive further
addresses in `file/opened` events:

```typescript
import { file } from "@edenapp/client";

const initial = window.edenAPI.getLaunchFile();
if (initial) await openDocument(initial);
await file.subscribe("opened", ({ location, isDirectory }) => {
  if (!isDirectory) void openDocument(location);
});
```

The file picker helpers return addresses rather than strings:

```typescript
import { filePicker } from "@edenapp/tablets";

const location = await filePicker.openFile({
  initialLocation: { volume: "home", path: "/Documents" },
});
if (location) {
  const text = await window.edenAPI.shellCommand("fs/read", {
    location: location,
  });
}
```

Pickers start at Home when no initial location is supplied. `allowedVolumes`
restricts the selector; if it is supplied without an initial location, the picker
starts at the first allowed volume. Save pickers cannot select read-only volumes
as write destinations. Raw picker selections use a nonempty `locations` array.

## Copying and Moving

`fs/cp` and `fs/mv` take independent source and destination addresses, supporting
transfers between volumes. They reject existing destinations by default:

```typescript
const copy = await window.edenAPI.shellCommand("fs/cp", {
  from: { volume: "home", path: "/Documents/report.txt" },
  to: { volume: "usb-work", path: "/report.txt" },
});
await copy.result();
```

`overwrite: true` replaces the complete destination, including directories;
it does not merge their previous contents. Self-transfers and overlapping
source/destination trees are rejected. Volume roots cannot be deleted, moved,
or replaced.

Copies keep symbolic links and their original targets verbatim. Access through
copied links remains restricted to the destination volume's sandbox.

If an overwrite fails, the original destination is restored while its volume
remains available, even if the source disconnects.

Moves across filesystem boundaries copy before deleting the source. If source
deletion fails, the completed destination is retained and the command reports
an incomplete move.

## Watching Directories

Apps with `fs/read` can watch non-recursive directories on volumes advertising
`supportsWatch`. Subscribe before creating the watch and take the initial
snapshot after watch creation:

```typescript
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
const watch = await fs.watch({ volume: "home", path: "/Documents" });
watchId = watch.watchId;
await refreshDirectory();

// On cleanup:
if (watchId) await fs.unwatch(watchId);
fs.unsubscribe("changed", handleChanged);
```

Each watch belongs to the creating view. Eden releases watches when the owning
view, volume, or runtime closes. Provide manual refresh for volumes without
watching.

Package inspection and installation hold their source-volume access throughout
archive reads, so safe removal waits until those reads and admitted package work
finish.
