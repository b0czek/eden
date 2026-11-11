# @edenapp/types

## 0.15.1

### Patch Changes

- 7d204e5: Consumers can set `homeDirectory` to keep the Home volume in a folder outside `dataDirectory`, such as an existing data partition. Account folder restrictions apply inside it as before.

## 0.15.0

### Minor Changes

- 39e850b: Eden keeps all of its data under one `dataDirectory`, with the Home volume in `home`, installed packages in `apps`, and accounts, settings, app storage, and default apps in `system`. It replaces the `appsDirectory` and `userDirectory` options and defaults to `eden` in Electron's `userData` directory. Existing data in the previous locations is not migrated. Apps can no longer read or change system data through the Home volume, and package IDs that match system database names are now allowed.
- 2b43225: Files address bar search finds files and folders at any depth with case-insensitive fuzzy matching, and shows the best and nearest matches first. Results update while the search continues, with the number of searched items. Choosing a file result opens its folder with the file selected.

  **Breaking:** `fs/search` is now a stream command. It sends the best results so far and the number of searched entries until the search completes, instead of one result array. `limit` accepts at most 1000.

- b1eb229: Add a recoverable Trash for Home. Apps can move items to Trash, list the items the user can access, restore them to the original or another location, delete them permanently, and subscribe to Trash changes. Volumes report whether they support Trash. Files shows Trash in the sidebar with restore and permanent-delete controls.
- 41357aa: Support local, removable, and mounted network volumes that the consumer registers. Files and the file picker let users change between volumes, show Home and drive-type icons, keep read-only volumes read-only, and handle disconnected drives. Home addresses stay the same across accounts, and the consumer can restrict access to shared or overlapping folders.

  Files can safely remove drives through an OS operation that the consumer supplies. Safe removal requires a permission. It finishes running file operations, waits for open file handles to close, and tells the user when the drive can be unplugged. Volumes on the same physical device are removed together. Apps can keep file handles open across operations, and Eden closes them when their owner exits.

  `fs.lstat` inspects symbolic links without following them. `fs.delete` and `fs.move` act on the symbolic link itself, and copies keep the original link targets. A failed overwrite restores the destination, and a move across filesystems keeps the copied files if Eden cannot delete the source.

  **Breaking:** File commands that take one address now take a `location` property with the volume and path. Raw picker selections return `locations[]`, and single-selection picker helpers return the first selected location.

- 11c0e4a: Create Electron hosts with `createEden(config)`. Asynchronous host APIs return lazy Effects that compose before execution through `eden.runPromise` or `eden.runFork`; `dispose()` explicitly shuts down the host. Host settings and power providers also return Effects, with their contracts exported by the SDK. Sandboxed apps keep the Promise-based Eden client.
- 0153e67: Add typed long-running IPC operations with immediate acceptance and guaranteed capacity per app. Apps can observe progress, completion, and failures. Built-in apps display operation progress and status. Solid apps can use `createOperation` and `OperationStatus` for their own UI.
- 7a39b41: Add stream commands, which send results to the calling app while their work continues. Generated client methods return a stream that apps read with `for await`, with backpressure and cancellation. Eden stops a stream when its view or backend closes, or when its view reloads.
- 2484d8a: Remove the built-in Web Browser app and the `frontend.allowEmbedding` option that disabled response security headers.
- 80295f7: Context menu items can be checkable: set `checked` on a `button` to show a check mark, and use `section` to label a group of choices inside a menu.

## 0.14.0

### Minor Changes

- f878857: Replace host settings panel declarations and state overlays with complete validated resolved views, typed action envelopes, stable-ID reconciliation, resolved collection rows, and independently authorized same-owner nested panels. This intentionally replaces the pre-1.0 panel API without a compatibility adapter.

  Allow trusted hosts to register panels without an additional grant, so public parent panels and children that inherit their ancestors' access rules use the same registration API.

  Keep controls synchronized after rejected or unchanged actions, isolate radio selections between node instances, and discard dialog drafts and errors when fields disappear or change input kind.

  Keep settings navigation and management views usable in narrow spaces by collapsing the sidebar to labeled icon actions and reflowing daemon and package details around their available panel width. Render resolved settings in grouped, responsive rows instead of leaving the new panel markup unstyled, and match select pickers to their controls with consistent Eden styling, centered values, and option heights.

## 0.13.0

### Minor Changes

- 7ebd35d: Add app-bound DLC manifests, secure `.edenite` packaging and extraction, built-in DLC bundling, unified package installation and removal, transactional host-aware lifecycle handling, host-scoped JavaScript module resource URLs, trusted main-process inventory APIs with package-size details in Settings, optional host file-handler extensions, binary filesystem commands, editor-owned contracts for external language highlighters and custom document codecs, and a built-in HTTP request highlighter DLC.
- 9bd04f0: Open a compact spatial layout compass from tiled app titles when adjacent windows are available, with controls to swap positions or temporarily expand across compatible neighbors without persistent gutters or another renderer. Keep layout actions unavailable during an active expansion so they cannot implicitly restore or rearrange the covered split.

### Patch Changes

- 6128a97: Resize floating app windows from their left, right, and bottom edges, including both bottom corners, with side handles beginning below the title bar so the full top frame remains available for window dragging.

## 0.12.1

## 0.12.0

### Minor Changes

- 41fcd6f: Add system-owned, supervised backend daemons with persistent grant-controlled configuration, fixed Eden execution principals, session-independent lifecycle controls, and a grant-aware Settings management tab.
- a156ad0: Add safe file and recursive-directory transfers with explicit replacement, plus reusable multi-selection explorer controls and in-app destination browsing for Files copy, move, and batch delete workflows.
- 656844d: Add permission-aware native directory watching and live file explorer refreshes, including automatic recovery when an open directory becomes unavailable.
- 01e622b: Add live, grant-aware Settings panels with declarative operation dialogs, an administrative grant catalog, and stable main-process control-plane APIs for apps, daemons, users, sessions, appearance, and app associations.

### Patch Changes

- c7c4e33: Build apps concurrently through Genesis while allowing apps with internally
  parallel builds to opt out using `build.concurrent: false`. Show compact,
  in-place build progress in interactive terminals.
- f2d7979: Refresh settings panel snapshots when daemon runtime state changes.
- 14a2705: Add a typed host power provider with permission-gated restart and power-off
  commands, graceful managed-workload shutdown, and built-in eveshell and login
  screen controls.
- c8075b0: Centralize dependency versions shared by multiple workspace packages in the pnpm catalog and update dependencies to their latest releases.

## 0.11.1

### Patch Changes

- fa86d1d: Seed a demo development user in `eden-build dev` so the standalone host no longer opens the login screen with no users. Adds an optional `seedPath` to `EdenConfig` (also settable via `EDEN_DEV_SEED_PATH` in the dev host) to override the location of the seed config JSON file.

## 0.11.0

### Minor Changes

- 826e23c: Add consumer-controlled product branding for SDK-owned interfaces and the
  main Electron window.
- 0c50cbc: Add a cached standalone Eden development host and `eden-build dev` source-app workflow.

## 0.10.2

## 0.10.1

### Patch Changes

- fix reflect import

## 0.10.0

## 0.9.0

## 0.8.0

### Minor Changes

- Release 0.8.0.

## 0.7.3

## 0.7.2

## 0.7.1

### Patch Changes

- add default window mdoe

## 0.7.0

### Minor Changes

- fileopen using mimetypes, open with, smart layout grid

## 0.6.5

## 0.6.4

## 0.6.3

### Patch Changes

- submenus in ctx menus and open with... in files app

## 0.6.2

### Patch Changes

- error while publishing

## 0.6.1

## 0.6.0

### Minor Changes

- add fs/mv fs/cp
  unify dialogs api through solid-kit
  add process manager app

## 0.5.2

### Patch Changes

- gate view and process endpoints and add "window-only" inejction mode to appframe

## 0.5.1

## 0.5.0

### Minor Changes

- major ui refinement

## 0.4.1

### Patch Changes

- fix dependencies
