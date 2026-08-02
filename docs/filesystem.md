# Filesystem Access

Eden apps access files through typed shell commands. Filesystem operations are
restricted by the permissions declared in the app manifest:

- `fs/read` permits reading metadata and contents, listing directories, and
  watching directories.
- `fs/write` permits creating, changing, copying, moving, and deleting files
  and directories.
- `fs/resolve` permits resolving a virtual path for an external integration.
- `fs/*` grants all filesystem permissions.

## Virtual Paths

Filesystem paths exposed to apps are virtual. `/` maps to the active user's
configured home directory, or to the configured `userDirectory` root when the
user has no home restriction. Vendor users always use the root.

Applications should persist and exchange virtual paths rather than resolved host
paths. Resolve a host path only when an external integration explicitly needs
one:

```typescript
const { realPath } = await window.edenAPI.shellCommand("fs/resolve", {
  path: "/Documents/report.txt",
});
```

## Reading a Directory

Use `fs/readdir` to list entry names, then request metadata with `fs/stat` when
needed:

```typescript
const names = await window.edenAPI.shellCommand("fs/readdir", {
  path: "/Documents",
});

const stats = await window.edenAPI.shellCommand("fs/stat", {
  path: `/Documents/${names[0]}`,
});
```

## Opening Files

Use `file/open` to open a file with its configured application:

```typescript
await window.edenAPI.shellCommand("file/open", {
  path: "/Documents/report.txt",
});
```

## Watching a Directory

Apps with `fs/read` can watch a virtual directory without polling. Watches are
non-recursive.

Subscribe before creating the watch so a change cannot occur between watch setup
and listener registration. Take the initial directory snapshot only after the
watch has been established:

```typescript
let watchId: string | undefined;

const handleChanged = ({ watchId: changedWatchId, kind }) => {
  if (changedWatchId !== watchId) return;
  if (kind === "change") void refreshDirectory();
  else reportLiveUpdateFailure();
};

await window.edenAPI.subscribe("fs/changed", handleChanged);
({ watchId } = await window.edenAPI.shellCommand("fs/watch", {
  path: "/Documents",
}));
await refreshDirectory();
```

Each watch ID belongs to the view that created it. When navigating to another
directory, unwatch the previous directory before replacing its watch. On view
cleanup, release the watch and event subscription:

```typescript
if (watchId) {
  await window.edenAPI.shellCommand("fs/unwatch", { watchId });
}
window.edenAPI.unsubscribe("fs/changed", handleChanged);
```

Eden also releases outstanding watches automatically when their owning view or
runtime closes.
