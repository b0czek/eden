# @edenapp/solid-kit

## 0.17.0

### Minor Changes

- 1bef4f3: Apps can let the user choose a date and time by touch with `DateTimeField` from `@edenapp/solid-kit/datetime`: steppers for the day, hour, and minute that repeat while held and stay within the given bounds, labelled in the app's language.
- 7f39f4c: Solid-kit components show their built-in text in the app's `@edenapp/babel` language, with English and Polish included. Apps add languages or change strings under `solidKit` in their own locale files. Dialogs no longer default to English buttons. `NoticeProvider` no longer takes `labels`, `Sidebar` no longer takes `toggleLabels`, and `KeyboardButton` no longer takes `label`.

### Patch Changes

- Updated dependencies [7f39f4c]
  - @edenapp/babel@0.17.0
  - @edenapp/client@0.17.0

## 0.16.0

### Minor Changes

- 72450f6: Apps can show notices inside their window with `NoticeProvider` and `useNotices` from `@edenapp/solid-kit/notices`: failures stay until dismissed, repeated reports are counted, and condition notices last while their cause is true. EdenCSS adds the matching `eden-notice` styles.

### Patch Changes

- @edenapp/client@0.16.0

## 0.15.2

### Patch Changes

- @edenapp/client@0.15.2

## 0.15.1

### Patch Changes

- @edenapp/client@0.15.1

## 0.15.0

### Minor Changes

- 0153e67: Add typed long-running IPC operations with immediate acceptance and guaranteed capacity per app. Apps can observe progress, completion, and failures. Built-in apps display operation progress and status. Solid apps can use `createOperation` and `OperationStatus` for their own UI.
- 37c6acd: Add collapsible EdenCSS sidebars and Solid Kit sidebar components with accessible controls and responsive defaults. Files and Settings let users fold or expand their navigation while preserving their choice during window resizing.

### Patch Changes

- b1eb229: Dialogs let users expand details with Enter without submitting or closing the dialog.
- Updated dependencies [8ab978e]
- Updated dependencies [b1eb229]
- Updated dependencies [41357aa]
- Updated dependencies [7a39b41]
  - @edenapp/client@0.15.0

## 0.14.0

## 0.13.0

## 0.12.1

## 0.12.0

### Patch Changes

- 8c90d1d: Preserve argument omission when custom dialog renderers call `submit()`, allowing forms to submit their current values.
- c5acf54: Add dialog options for disabling passive dismissal and selecting either the `dialog` or `alertdialog` accessibility role, with labelled titles.
- c8075b0: Centralize dependency versions shared by multiple workspace packages in the pnpm catalog and update dependencies to their latest releases.

## 0.11.1

## 0.11.0

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

## 0.7.0

## 0.6.5

## 0.6.4

## 0.6.3

## 0.6.2

### Patch Changes

- error while publishing

## 0.6.1
