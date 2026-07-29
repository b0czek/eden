# @edenapp/sdk

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
