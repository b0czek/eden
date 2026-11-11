# @edenapp/scripts

## 0.15.1

### Patch Changes

- Updated dependencies [7d204e5]
  - @edenapp/types@0.15.1
  - @edenapp/genesis@0.15.1

## 0.15.0

### Patch Changes

- b1eb229: Start Linux development hosts through XWayland so the on-screen keyboard opens without taking focus from the active app.
- acb1347: Apps that take their version from package.json now load at runtime, both from built packages and when mounted for development. App builds now run again when manifest.json or package.json changes.
- 26f78ac: Clean up standalone development processes and hot-reload state when startup fails or the launcher is interrupted.
- 39e850b: Eden keeps all of its data under one `dataDirectory`, with the Home volume in `home`, installed packages in `apps`, and accounts, settings, app storage, and default apps in `system`. It replaces the `appsDirectory` and `userDirectory` options and defaults to `eden` in Electron's `userData` directory. Existing data in the previous locations is not migrated. Apps can no longer read or change system data through the Home volume, and package IDs that match system database names are now allowed.
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

### Patch Changes

- Updated dependencies [f878857]
  - @edenapp/types@0.14.0
  - @edenapp/genesis@0.14.0

## 0.13.0

### Minor Changes

- 7ebd35d: Add app-bound DLC manifests, secure `.edenite` packaging and extraction, built-in DLC bundling, unified package installation and removal, transactional host-aware lifecycle handling, host-scoped JavaScript module resource URLs, trusted main-process inventory APIs with package-size details in Settings, optional host file-handler extensions, binary filesystem commands, editor-owned contracts for external language highlighters and custom document codecs, and a built-in HTTP request highlighter DLC.

### Patch Changes

- Updated dependencies [7ebd35d]
- Updated dependencies [a3fe6ef]
- Updated dependencies [6128a97]
- Updated dependencies [9bd04f0]
  - @edenapp/types@0.13.0
  - @edenapp/genesis@0.13.0

## 0.12.1

### Patch Changes

- @edenapp/types@0.12.1
- @edenapp/genesis@0.12.1

## 0.12.0

### Patch Changes

- 6a898c3: Fix the standalone `eden-build dev` seed generation to include default system autostart settings and to create the default demo user as a `vendor`, so dev hosts start with shell utilities and unrestricted access by default.
- c7c4e33: Build apps concurrently through Genesis while allowing apps with internally
  parallel builds to opt out using `build.concurrent: false`. Show compact,
  in-place build progress in interactive terminals.
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

- 0c50cbc: Add a cached standalone Eden development host and `eden-build dev` source-app workflow.

### Patch Changes

- Updated dependencies [826e23c]
- Updated dependencies [0c50cbc]
  - @edenapp/types@0.11.0
  - @edenapp/genesis@0.11.0

## 0.10.2

### Patch Changes

- @edenapp/types@0.10.2
- @edenapp/genesis@0.10.2

## 0.10.1

### Patch Changes

- fix reflect import
- Updated dependencies
  - @edenapp/genesis@0.10.1
  - @edenapp/types@0.10.1

## 0.10.0

### Patch Changes

- @edenapp/types@0.10.0
- @edenapp/genesis@0.10.0

## 0.9.0

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

- @edenapp/types@0.7.3
- @edenapp/genesis@0.7.3

## 0.7.2

### Patch Changes

- @edenapp/types@0.7.2
- @edenapp/genesis@0.7.2

## 0.7.1

### Patch Changes

- Updated dependencies
  - @edenapp/types@0.7.1
  - @edenapp/genesis@0.7.1

## 0.7.0

### Patch Changes

- Updated dependencies
  - @edenapp/types@0.7.0
  - @edenapp/genesis@0.7.0

## 0.6.5

### Patch Changes

- @edenapp/types@0.6.5
- @edenapp/genesis@0.6.5

## 0.6.4

### Patch Changes

- @edenapp/types@0.6.4
- @edenapp/genesis@0.6.4

## 0.6.3

### Patch Changes

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

- Updated dependencies
  - @edenapp/types@0.5.2
  - @edenapp/genesis@0.5.2

## 0.5.1

### Patch Changes

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
