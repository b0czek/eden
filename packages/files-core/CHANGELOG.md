# @edenapp/files-core

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
