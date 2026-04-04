---
name: eden-frontend
description: Build or restyle Eden app frontends in this repository. Use when Codex needs to create a new Eden app UI, modify an existing app frontend, improve layout or visual design, choose and apply EdenCSS tokens/utilities/components, or inspect existing Eden apps for reusable frontend patterns.
---

# Eden Frontend

Use this skill to keep Eden frontend work anchored to the real design system and the actual app patterns already present in the repo.

## Start Here

- Read `AGENTS.md`.
- Read `docs/app-development.md`.
- Read `docs/localizing-apps.md` if the task adds or changes user-facing text.
- Read `packages/sdk/edencss/tokens.css`, `packages/sdk/edencss/utilities.css`, and the relevant files under `packages/sdk/edencss/components/`.
- Read `references/edencss-surface.md` for the generated source-backed inventory of tokens, utilities, components, imports, and current caveats.
- Read `references/app-patterns.md` and inspect the nearest matching app before editing.

## Workflow

1. Identify the job type: new app frontend, change to an existing screen, or targeted visual cleanup.
2. Find the nearest in-repo UI pattern before inventing structure.
3. Prefer EdenCSS first:
   - Use component classes for common controls.
   - Use utility classes for layout, spacing, and typography.
   - Use raw `var(--eden-...)` tokens before introducing custom colors, spacing, blur, or motion.
   - Do not add manual imports of `packages/sdk/edencss/*.css` in normal Eden app frontend work; EdenCSS is injected automatically.
4. Verify that each `eden-*` class you plan to use exists in `references/edencss-surface.md` or the `packages/sdk/edencss/` source.
5. Add app-local CSS only for app-specific layout, composition, or behaviors that EdenCSS does not already cover.
6. Keep scroll behavior deliberate:
   - Keep `body` and `#root` non-scrolling when the app is frame-based.
   - Put scrolling on an inner flex child with `min-height: 0` and `overflow-y: auto`.
7. Build the changed app package before finishing.

## Pattern Selection

- Use Settings for sidebars, list/detail management pages, and metadata panels.
- Use Users for modals, tabs, toggles, dense admin forms, and scrollable split layouts.
- Use Files for compact toolbars, square action buttons, explorer headers, and lightweight modals.
- Use `@edenapp/tablets` for app context menus; copy Files or Eveshell patterns instead of hand-building menu markup.
- Use Login for centered auth cards and selection-plus-form flows.

## EdenCSS Caveats

- Treat the source files under `packages/sdk/edencss/` as the contract.
- Treat `references/edencss-surface.md` as the fastest source-backed summary.
- Some repo apps use extra `eden-*` names that are app-local helpers or stale assumptions rather than shared EdenCSS classes.
- Context menus are a separate path: author them with `@edenapp/tablets`, not by inventing app-local EdenCSS popover/menu systems.

## Resources

- `scripts/build_edencss_inventory.py`: regenerate `references/edencss-surface.md` from the current EdenCSS source and compare real app usage against shared classes.
- `references/edencss-surface.md`: generated inventory of tokens, utilities, components, imports, and caveats.
- `references/app-patterns.md`: curated map of existing Eden apps worth copying for frontend structure.

## Verification

- Run `python3 skills/eden-frontend/scripts/build_edencss_inventory.py` after changing this skill's source-backed reference or when EdenCSS changes materially.
- Run `python3 /home/dariusz/.codex/skills/.system/skill-creator/scripts/quick_validate.py skills/eden-frontend` after editing the skill.
- Build the affected app with `pnpm run build` from the app package directory.
