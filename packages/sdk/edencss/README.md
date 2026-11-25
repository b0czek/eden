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

## Controls And Touch

`.eden-btn`, `.eden-input`, and `.eden-select` are at least
`--eden-layout-control-min-size` (44px) high on all devices. Buttons are also
at least that wide. Size classes such as `.eden-btn-sm` and `.eden-btn-xs` change
the text size and padding, but do not make a control smaller than this size.
`.eden-btn-square` is exactly this size, with its icon in the centre. Use
`eden-btn eden-btn-ghost eden-btn-square` for an icon button without a frame.

Use the token for app-specific controls that sit beside EdenCSS controls. Do not
repeat the 44px value. To change the size, set the token on `:root` for the full
app, or on a container for the controls in it.

Hover styles apply only when the device can hover (`@media (hover: hover)`), so a
tap does not leave a control in its hover state. Buttons, list items, sidebar
items, tabs, and interactive cards show a pressed state while they are pressed.

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

## Notices

`.eden-notice-region` floats at the top centre of the app window, below the app
frame. It holds a `.eden-notice-list` of `.eden-notice` items with a
`.eden-notice-danger`, `.eden-notice-warning`, or `.eden-notice-success`
variant (the default variant is info), and an optional `.eden-notice-more`
button. The region lets clicks through to the app; only the notices and the
button take them. Solid apps use `@edenapp/solid-kit/notices`, which owns the notice
state and markup; see the
[Solid Kit notices guide](../../solid-kit/README.md#notices).

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
- `--eden-layout-*`

## Maintenance

- Edit `tokens.json` and run the token build command when changing generated tokens.
- Keep this README short. Put detailed truth in the CSS source, not in duplicated prose.
