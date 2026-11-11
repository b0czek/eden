# @edenapp/sdk

## 0.15.1

### Patch Changes

- 7d204e5: Consumers can set `homeDirectory` to keep the Home volume in a folder outside `dataDirectory`, such as an existing data partition. Account folder restrictions apply inside it as before.
- Updated dependencies [7d204e5]
  - @edenapp/types@0.15.1
  - @edenapp/genesis@0.15.1

## 0.15.0

### Minor Changes

- 8ab978e: Add `@edenapp/client` with generated, typed system commands and event subscriptions for frontend and backend apps, including positional required arguments, optional settings, and operation controls.
- 39e850b: Eden keeps all of its data under one `dataDirectory`, with the Home volume in `home`, installed packages in `apps`, and accounts, settings, app storage, and default apps in `system`. It replaces the `appsDirectory` and `userDirectory` options and defaults to `eden` in Electron's `userData` directory. Existing data in the previous locations is not migrated. Apps can no longer read or change system data through the Home volume, and package IDs that match system database names are now allowed.
- 2b43225: Files address bar search finds files and folders at any depth with case-insensitive fuzzy matching, and shows the best and nearest matches first. Results update while the search continues, with the number of searched items. Choosing a file result opens its folder with the file selected.

  **Breaking:** `fs/search` is now a stream command. It sends the best results so far and the number of searched entries until the search completes, instead of one result array. `limit` accepts at most 1000.

- 37c6acd: Files lets users pin folders with customizable color markers that remain recognizable in the folded sidebar. Ongoing operations appear in sidebar activity, with progress details and copy cancellation available in either sidebar mode.
- cf3eeea: Files and the file picker show display options as a menu with the current view, size, and sort order checked. In Files, New Folder and New File are grouped under one New menu.
- b1eb229: Add a recoverable Trash for Home. Apps can move items to Trash, list the items the user can access, restore them to the original or another location, delete them permanently, and subscribe to Trash changes. Volumes report whether they support Trash. Files shows Trash in the sidebar with restore and permanent-delete controls.
- 41357aa: Support local, removable, and mounted network volumes that the consumer registers. Files and the file picker let users change between volumes, show Home and drive-type icons, keep read-only volumes read-only, and handle disconnected drives. Home addresses stay the same across accounts, and the consumer can restrict access to shared or overlapping folders.

  Files can safely remove drives through an OS operation that the consumer supplies. Safe removal requires a permission. It finishes running file operations, waits for open file handles to close, and tells the user when the drive can be unplugged. Volumes on the same physical device are removed together. Apps can keep file handles open across operations, and Eden closes them when their owner exits.

  `fs.lstat` inspects symbolic links without following them. `fs.delete` and `fs.move` act on the symbolic link itself, and copies keep the original link targets. A failed overwrite restores the destination, and a move across filesystems keeps the copied files if Eden cannot delete the source.

  **Breaking:** File commands that take one address now take a `location` property with the volume and path. Raw picker selections return `locations[]`, and single-selection picker helpers return the first selected location.

- 11c0e4a: Create Electron hosts with `createEden(config)`. Asynchronous host APIs return lazy Effects that compose before execution through `eden.runPromise` or `eden.runFork`; `dispose()` explicitly shuts down the host. Host settings and power providers also return Effects, with their contracts exported by the SDK. Sandboxed apps keep the Promise-based Eden client.
- 0153e67: Add typed long-running IPC operations with immediate acceptance and guaranteed capacity per app. Apps can observe progress, completion, and failures. Built-in apps display operation progress and status. Solid apps can use `createOperation` and `OperationStatus` for their own UI.
- 7a39b41: Add stream commands, which send results to the calling app while their work continues. Generated client methods return a stream that apps read with `for await`, with backpressure and cancellation. Eden stops a stream when its view or backend closes, or when its view reloads.
- 2484d8a: Remove the built-in Web Browser app and the `frontend.allowEmbedding` option that disabled response security headers.
- 37c6acd: Add collapsible EdenCSS sidebars and Solid Kit sidebar components with accessible controls and responsive defaults. Files and Settings let users fold or expand their navigation while preserving their choice during window resizing.

### Patch Changes

- acb1347: Apps that take their version from package.json now load at runtime, both from built packages and when mounted for development. App builds now run again when manifest.json or package.json changes.
- 6d30504: Keep app icon reads within their package directory, including symbolic links.
- 49e28ca: Preserve working AppBus services when duplicate registration is rejected, and allow retrying registrations that fail before completion.
- 36c9e32: Cancel unfinished autostart work and wait for cleanup before logout or account changes complete.
- b1eb229: Files adds file and folder details and clearer operation errors with expandable technical details.
- 5e1d8d7: Preserve installed packages when cleanup after a committed package change fails, and retry leftover cleanup on startup.
- 24a3659: Deliver settings change values only to apps authorized to read them, including after user grants change.
- 2b1dd09: Preserve setting keys such as `__proto__` in responses that return all settings.
- Updated dependencies [acb1347]
- Updated dependencies [39e850b]
- Updated dependencies [2b43225]
- Updated dependencies [b1eb229]
- Updated dependencies [41357aa]
- Updated dependencies [11c0e4a]
- Updated dependencies [0153e67]
- Updated dependencies [7a39b41]
- Updated dependencies [2484d8a]
- Updated dependencies [80295f7]
  - @edenapp/genesis@0.15.0
  - @edenapp/types@0.15.0

## 0.14.0

### Minor Changes

- f878857: Replace host settings panel declarations and state overlays with complete validated resolved views, typed action envelopes, stable-ID reconciliation, resolved collection rows, and independently authorized same-owner nested panels. This intentionally replaces the pre-1.0 panel API without a compatibility adapter.

  Allow trusted hosts to register panels without an additional grant, so public parent panels and children that inherit their ancestors' access rules use the same registration API.

  Keep controls synchronized after rejected or unchanged actions, isolate radio selections between node instances, and discard dialog drafts and errors when fields disappear or change input kind.

  Keep settings navigation and management views usable in narrow spaces by collapsing the sidebar to labeled icon actions and reflowing daemon and package details around their available panel width. Render resolved settings in grouped, responsive rows instead of leaving the new panel markup unstyled, and match select pickers to their controls with consistent Eden styling, centered values, and option heights.

### Patch Changes

- 835802b: Keep native window focus unchanged when sending on-screen keyboard actions to an app.
- a42bfbe: Allow the on-screen keyboard to insert and delete characters in native number inputs.
- Updated dependencies [f878857]
  - @edenapp/types@0.14.0
  - @edenapp/genesis@0.14.0

## 0.13.0

### Minor Changes

- 7ebd35d: Add app-bound DLC manifests, secure `.edenite` packaging and extraction, built-in DLC bundling, unified package installation and removal, transactional host-aware lifecycle handling, host-scoped JavaScript module resource URLs, trusted main-process inventory APIs with package-size details in Settings, optional host file-handler extensions, binary filesystem commands, editor-owned contracts for external language highlighters and custom document codecs, and a built-in HTTP request highlighter DLC.
- 9bd04f0: Open a compact spatial layout compass from tiled app titles when adjacent windows are available, with controls to swap positions or temporarily expand across compatible neighbors without persistent gutters or another renderer. Keep layout actions unavailable during an active expansion so they cannot implicitly restore or rearrange the covered split.

### Patch Changes

- a443e42: Scale the built-in file picker and toast notifications, including their overlay bounds, with the configured interface scale.
- d64ffce: Restrict the Foundation renderer to its required shell commands and event subscriptions, and reject shell commands from renderers that are not registered Eden views.
- 817b12b: Lift visible overlay views when the docked on-screen keyboard would obscure their focused field.
- 3ec2420: Open the on-screen keyboard for editable controls nested inside shadow DOM, inherit keyboard placement policies across shadow hosts, discard controls removed by dynamic interfaces, and deliver input to the focused control. Focus the PDF viewer search field whenever its sidebar opens so the keyboard appears without a second click.
- 6128a97: Resize floating app windows from their left, right, and bottom edges, including both bottom corners, with side handles beginning below the title bar so the full top frame remains available for window dragging.
- f9119b2: Add a renderer notification helper with automatically routed action callbacks, reliable cleanup after dismissal, and adoption across Eden's bundled apps.
- Updated dependencies [7ebd35d]
- Updated dependencies [a3fe6ef]
- Updated dependencies [6128a97]
- Updated dependencies [9bd04f0]
  - @edenapp/types@0.13.0
  - @edenapp/genesis@0.13.0

## 0.12.1

### Patch Changes

- d84a2fc: Scale app default, minimum, and maximum window sizes with the configured interface scale, and preserve the logical size of open floating apps when that scale changes.
  - @edenapp/types@0.12.1
  - @edenapp/genesis@0.12.1

## 0.12.0

### Minor Changes

- 41fcd6f: Add system-owned, supervised backend daemons with persistent grant-controlled configuration, fixed Eden execution principals, session-independent lifecycle controls, and a grant-aware Settings management tab.
- a156ad0: Add safe file and recursive-directory transfers with explicit replacement, plus reusable multi-selection explorer controls and in-app destination browsing for Files copy, move, and batch delete workflows.
- 656844d: Add permission-aware native directory watching and live file explorer refreshes, including automatic recovery when an open directory becomes unavailable.
- 01e622b: Add live, grant-aware Settings panels with declarative operation dialogs, an administrative grant catalog, and stable main-process control-plane APIs for apps, daemons, users, sessions, appearance, and app associations.

### Patch Changes

- dd335f4: Run host app catalog queries with the active user's authorization context.
- 14a2705: Keep Process Manager subsection headers visible beneath the floating table header while scrolling.
- e96012c: Preserve an autostarted app's authorized session identity when hot reload restarts it.
- 081155c: Apply the configured interface scale to views created while scale settings initialize.
- 92a61d3: Restore minimized floating app views to their previous bounds when focused again.
- ca788bf: Isolate each Eden host in an independently disposable runtime and add Node and
  real-Electron integration coverage for lifecycle, permissions, persistence,
  views, IPC, processes, and shutdown behavior. Enforce the Electron platform
  boundary through the SDK's Biome checks. Replace mock-heavy control-plane,
  settings, process, filesystem, and file-association tests with runtime
  integration scenarios that use real Eden services and persistence.
- 4bfae27: Display server validation errors beside their matching settings dialog fields.
- 4931d0a: Position system context menus correctly when their opener uses interface scaling.
- 01e622b: Declare Jest and Node types in package TypeScript configurations so test globals are available consistently in editors and type checks.
- 8438cb6: Load installed app sizes only when their detail view is selected.
- f2d7979: Refresh settings panel snapshots when daemon runtime state changes.
- 41aeba2: Skip invalid application settings panels instead of failing Eden startup.
- 14a2705: Add a typed host power provider with permission-gated restart and power-off
  commands, graceful managed-workload shutdown, and built-in eveshell and login
  screen controls.
- a156ad0: Restore all bundled Eden apps when running the SDK development environment.
- d4e77e2: Shut down Eden runtimes cleanly by aborting in-progress startup, draining queued autostarts, cancelling hot-reload watcher setup, and preventing disposed runtimes from restarting.
- 92b2bb8: Keep settings value inputs responsive by committing local drafts after editing.
- fa2c2ad: Account for app interface scaling when lifting web contents above the docked on-screen keyboard.
- 11846b2: Preserve settings control state when an action grant disables the control.
- ac5b8eb: Limit SDK development app bundling to the built-in apps declared in the development configuration, avoiding example apps and the PDF viewer while retaining complete app bundles for SDK builds.
- c8075b0: Centralize dependency versions shared by multiple workspace packages in the pnpm catalog and update dependencies to their latest releases.
- Updated dependencies [41fcd6f]
- Updated dependencies [c7c4e33]
- Updated dependencies [a156ad0]
- Updated dependencies [01e622b]
- Updated dependencies [f2d7979]
- Updated dependencies [14a2705]
- Updated dependencies [656844d]
- Updated dependencies [01e622b]
- Updated dependencies [c8075b0]
  - @edenapp/types@0.12.0
  - @edenapp/genesis@0.12.0

## 0.11.1

### Patch Changes

- fa86d1d: Seed a demo development user in `eden-build dev` so the standalone host no longer opens the login screen with no users. Adds an optional `seedPath` to `EdenConfig` (also settable via `EDEN_DEV_SEED_PATH` in the dev host) to override the location of the seed config JSON file.
- Updated dependencies [fa86d1d]
  - @edenapp/types@0.11.1
  - @edenapp/genesis@0.11.1

## 0.11.0

### Minor Changes

- 826e23c: Add consumer-controlled product branding for SDK-owned interfaces and the
  main Electron window.
- 0c50cbc: Add a cached standalone Eden development host and `eden-build dev` source-app workflow.

### Patch Changes

- Updated dependencies [826e23c]
- Updated dependencies [0c50cbc]
  - @edenapp/types@0.11.0
  - @edenapp/genesis@0.11.0

## 0.10.2

### Patch Changes

- eveshell now scales with interface scale
  - @edenapp/types@0.10.2
  - @edenapp/genesis@0.10.2

## 0.10.1

### Patch Changes

- fix reflect import
- Updated dependencies
  - @edenapp/genesis@0.10.1
  - @edenapp/types@0.10.1

## 0.10.0

### Minor Changes

- Release 0.10.0.
  - Add file picker app with backend manager and overlay UI for capability-based file selection.
  - Extract reusable `@edenapp/files-core` package for shared file explorer primitives.
  - Add file picker API to `@edenapp/tablets`.
  - Add app association manager for resolving capability providers without hardcoding app IDs.
  - Add shared settings support across Eden apps.
  - Add overlay priority system for layered UI elements.
  - Add actionful notifications.
  - Improve PDF viewer with embedded PDF UI, i18n, and unified welcome screen styling.
  - Show minimize control in the app frame.
  - Touch scrolling and hitbox fixes for file picker and files app.

### Patch Changes

- @edenapp/types@0.10.0
- @edenapp/genesis@0.10.0

## 0.9.0

### Minor Changes

- Add on-screen keyboard with text and number layouts, focus autodetection, and shell integration.
- Accessibility fixes across Eden apps, Biome lint cleanup, and flat EdenCSS sidebar/list selection styling.

### Patch Changes

- @edenapp/types@0.9.0
- @edenapp/genesis@0.9.0

## 0.8.0

### Minor Changes

- Release 0.8.0.

### Patch Changes

- Updated dependencies
  - @edenapp/types@0.8.0
  - @edenapp/genesis@0.8.0

## 0.7.3

### Patch Changes

- Pipe app backend stdout and stderr into Eden's main console output.
  - @edenapp/types@0.7.3
  - @edenapp/genesis@0.7.3

## 0.7.2

### Patch Changes

- make tiling layout respect app's window minimum size
  - @edenapp/types@0.7.2
  - @edenapp/genesis@0.7.2

## 0.7.1

### Patch Changes

- add default window mdoe
- Updated dependencies
  - @edenapp/types@0.7.1
  - @edenapp/genesis@0.7.1

## 0.7.0

### Minor Changes

- fileopen using mimetypes, open with, smart layout grid

### Patch Changes

- Updated dependencies
  - @edenapp/types@0.7.0
  - @edenapp/genesis@0.7.0

## 0.6.5

### Patch Changes

- update icons of files and editor app into more consistent ones
  - @edenapp/types@0.6.5
  - @edenapp/genesis@0.6.5

## 0.6.4

### Patch Changes

- fs/resolve command added
  - @edenapp/types@0.6.4
  - @edenapp/genesis@0.6.4

## 0.6.3

### Patch Changes

- submenus in ctx menus and open with... in files app
- Updated dependencies
  - @edenapp/types@0.6.3
  - @edenapp/genesis@0.6.3

## 0.6.2

### Patch Changes

- error while publishing
- Updated dependencies
  - @edenapp/genesis@0.6.2
  - @edenapp/types@0.6.2

## 0.6.1

### Patch Changes

- process metrics are now sorted by process name, not cpu usage
  - @edenapp/types@0.6.1
  - @edenapp/genesis@0.6.1

## 0.6.0

### Minor Changes

- add fs/mv fs/cp
  unify dialogs api through solid-kit
  add process manager app

### Patch Changes

- Updated dependencies
  - @edenapp/types@0.6.0
  - @edenapp/genesis@0.6.0

## 0.5.2

### Patch Changes

- gate view and process endpoints and add "window-only" inejction mode to appframe
- Updated dependencies
  - @edenapp/types@0.5.2
  - @edenapp/genesis@0.5.2

## 0.5.1

### Patch Changes

- make window minimum dimensions configurable with 800x600 enforced floor
  - @edenapp/types@0.5.1
  - @edenapp/genesis@0.5.1

## 0.5.0

### Minor Changes

- major ui refinement

### Patch Changes

- Updated dependencies
  - @edenapp/genesis@0.5.0
  - @edenapp/types@0.5.0

## 0.4.1

### Patch Changes

- fix dependencies
- Updated dependencies
  - @edenapp/genesis@0.4.1
  - @edenapp/types@0.4.1
