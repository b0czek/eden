# Eden App Patterns

Use these apps as the first source of truth for frontend structure in this repo. Pick the closest match to the current task instead of borrowing from random apps.

## Recommended References

### Settings

- `packages/sdk/apps/com/eden/settings/src/components/SettingsSidebar.tsx`
  - Reuse for `.eden-sidebar` structure, sections, disabled states, and scrollable sidebars.
- `packages/sdk/apps/com/eden/settings/src/components/apps/AppDetail.tsx`
  - Reuse for detail panes, card-based metadata, toggle rows, compact actions, and list/detail admin UI.
- `packages/sdk/apps/com/eden/settings/src/components/apps/AppsTab.tsx`
  - Reuse for searchable or selectable management lists.

### Users

- `packages/sdk/apps/com/eden/users/src/components/Modal.tsx`
  - Reuse as the simplest shared modal wrapper around `.eden-modal-*`.
- `packages/sdk/apps/com/eden/users/src/components/users/UsersList.tsx`
  - Reuse for dense list rows with metadata and row actions.
- `packages/sdk/apps/com/eden/users/src/components/users/UserDetail.tsx`
  - Reuse for card + tabs detail pages.
- `packages/sdk/apps/com/eden/users/src/components/users/GrantsEasyMode.tsx`
  - Reuse for long, scrollable admin forms and grouped permissions UIs.
- `packages/sdk/apps/com/eden/users/src/components/users/GrantsRawMode.tsx`
  - Reuse for textarea-heavy or code-ish editor panels.

### Files

- `packages/sdk/apps/com/eden/files/src/components/FileExplorerHeader.tsx`
  - Reuse for compact square toolbar actions.
- `packages/sdk/apps/com/eden/files/src/dialogs/DisplayOptionsModal.tsx`
  - Reuse for small setting dialogs, button groups, and icon-choice controls.
- `packages/sdk/apps/com/eden/files/src/components/Omnibox.tsx`
  - Reuse for overlay search or suggestion panels layered over existing content.

### Login

- `packages/sdk/apps/com/eden/login/src/App.tsx`
  - Reuse for centered glass cards, selection-plus-form flows, and lightweight auth layouts.

### Context Menus

- `packages/tablets/README.md`
  - Read first for the renderer-side API: `menu`, `button`, `title`, `separator`, `when`, `.show(...)`, and `.handler(...)`.
- `packages/sdk/apps/com/eden/files/src/features/useExplorerContextMenus.ts`
  - Reuse for file/item/background context menu construction in app code.
- `packages/sdk/apps/com/eden/eveshell/src/context-menu.ts`
  - Reuse for conditional items and menu factory functions.
- `packages/sdk/apps/com/eden/context-menu/src/context-menu.ts`
  - Read only when changing the display provider app itself. This is the renderer for context menu events, not the normal app-side authoring pattern.

## Practical Rules

- Prefer EdenCSS classes for the first pass; only add app-local CSS when layout or behavior requires it.
- Verify each shared class in `references/edencss-surface.md` before using it. Several apps also carry local `eden-*` helper names that are not part of shared EdenCSS.
- For context menus, prefer `@edenapp/tablets` over custom menu DOM/CSS in app code.
- When changing layout, copy the skeleton from the nearest app first and then simplify or extend it.
- When changing user-facing copy, also follow `docs/localizing-apps.md`.
