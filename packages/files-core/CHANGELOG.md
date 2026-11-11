# @edenapp/files-core

## 0.15.2

### Patch Changes

- @edenapp/tablets@0.15.2
- @edenapp/client@0.15.2

## 0.15.1

### Patch Changes

- @edenapp/client@0.15.1
- @edenapp/tablets@0.15.1

## 0.15.0

### Patch Changes

- 2b43225: Files address bar search finds files and folders at any depth with case-insensitive fuzzy matching, and shows the best and nearest matches first. Results update while the search continues, with the number of searched items. Choosing a file result opens its folder with the file selected.

  **Breaking:** `fs/search` is now a stream command. It sends the best results so far and the number of searched entries until the search completes, instead of one result array. `limit` accepts at most 1000.

- 0153e67: Add typed long-running IPC operations with immediate acceptance and guaranteed capacity per app. Apps can observe progress, completion, and failures. Built-in apps display operation progress and status. Solid apps can use `createOperation` and `OperationStatus` for their own UI.
- Updated dependencies [8ab978e]
- Updated dependencies [b1eb229]
- Updated dependencies [41357aa]
- Updated dependencies [7a39b41]
- Updated dependencies [80295f7]
  - @edenapp/client@0.15.0
  - @edenapp/tablets@0.15.0

## 0.11.0

### Minor Changes

- a156ad0: Add safe file and recursive-directory transfers with explicit replacement, plus reusable multi-selection explorer controls and in-app destination browsing for Files copy, move, and batch delete workflows.
- 656844d: Add permission-aware native directory watching and live file explorer refreshes, including automatic recovery when an open directory becomes unavailable.

### Patch Changes

- a16eccf: Show Edenite app packages with the package file icon.

## 0.10.1

### Patch Changes

- fix reflect import

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
