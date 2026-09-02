# @edenapp/sdk

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
