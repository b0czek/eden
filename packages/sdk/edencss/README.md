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
