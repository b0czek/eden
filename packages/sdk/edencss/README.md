# Eden CSS

Shared frontend styling for Eden apps.

## What To Assume

- Eden apps already have EdenCSS available. Do not manually import these CSS files in normal app frontend work.
- Prefer shared tokens, utilities, and component classes before adding app-local CSS.
- Treat the source files in this directory as the contract.

## Source Of Truth

- `tokens.css`: all defined `--eden-*` custom properties
- `utilities.css`: shared utility classes
- `components/`: shared component classes
- `eden.css`: authoritative full bundle for the design system in this repo

## Practical Usage

- Use raw `var(--eden-...)` tokens when you need custom styling that shared utilities or components do not cover.
- Verify any `eden-*` class in source before using it.
- Reuse nearby Eden apps under `packages/sdk/apps/com/eden/` before inventing new frontend patterns.
- Use `@edenapp/tablets` for app context menus; do not treat EdenCSS popover styles as the app-side context-menu authoring API.

## Sidebars

`.eden-sidebar` supports `.eden-sidebar-compact` and `.eden-sidebar-wide` sizes.
Add `.eden-sidebar-collapsed` to fold any size to a 72px icon rail, hiding section
headings and item labels while keeping navigation icons visible. Remove the
class to expand it again. `.eden-sidebar-controls` holds a heading and toggle;
`.eden-sidebar-scroll` keeps navigation scrollable independently of the toggle.
Folding and expanding animate smoothly and respect reduced-motion preferences.
Use `.eden-sidebar-row` and `.eden-sidebar-row-action` for an item with a separate
action control.

JavaScript owns the folded state and the toggle's accessible label and
`aria-expanded` value. Solid apps can use `@edenapp/solid-kit/sidebar` for these
behaviors and the corresponding EdenCSS markup; see the
[Solid Kit sidebar guide](../../solid-kit/README.md#sidebars).

## Tokens

All tokens are defined in `tokens.css`.

Common groups:

- `--eden-color-*`
- `--eden-space-*`
- `--eden-radius-*`
- `--eden-shadow-*`
- `--eden-glass-*`
- `--eden-font-*`
- `--eden-transition-*`
- `--eden-z-*`

## Maintenance

- Edit `tokens.json` and run the token build command when changing generated tokens.
- Keep this README short. Put detailed truth in the CSS source, not in duplicated prose.
