# @edenapp/types

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
