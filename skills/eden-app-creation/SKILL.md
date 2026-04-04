---
name: eden-app-creation
description: Create new Eden apps. Use when Codex needs to start a new app package, choose the right creation path for the Eden SDK repo or a consumer project, scaffold the initial app files, add the initial app icon and manifest basics, or hand off the next frontend step to the right skill.
---

# Eden App Creation

Use this skill when the task is “create a new Eden app”.

Current scope: app creation starts from a minimal renderer-only Solid scaffold, then continues with the first app-setup tasks around metadata and icon.

## Start Here

- Read `AGENTS.md`.
- Read `docs/app-development.md` if the user needs manifest or app-structure context.
- Treat scaffolding as the current default way to start a new app.

## Mode Selection

- Use `sdk` mode when creating a new app inside this Eden repository.
  It defaults to `packages/sdk/apps/<app-id split into folders>`.
  It writes workspace dependencies and uses `pnpm run build` in `manifest.json`.
- Use `consumer` mode when creating a new app for a normal project that consumes the Eden SDK.
  It defaults to `apps/<app-id split into folders>`.
  It writes published semver dependencies and uses `npm run build` in `manifest.json`.
- Use `auto` only when the environment is obvious. Prefer an explicit mode when the user already said “SDK repo” or “consumer project”.

## Workflow

1. Confirm the app id and whether the target is `sdk` or `consumer`.
2. Run the scaffold command to create the initial app package.
3. Add or update the first app metadata that the scaffold does not cover yet, especially the app icon when the task expects a complete starter app.
4. Build the generated app package to verify the initial app base.
5. If the user wants actual UI implementation after the app exists, continue with the `eden-frontend` skill.

## Commands

Inside the Eden repository:

```bash
node packages/scripts/dist/cli.js scaffold-solid com.eden.my-app --mode sdk
```

For a consumer project with `@edenapp/scripts` installed:

```bash
pnpm exec eden-build scaffold-solid com.example.my-app --mode consumer
```

Useful flags:

- `--name "My App"` sets the display name in `manifest.json`.
- `[output-dir]` overrides the default target directory.
- `--force` allows writing into a non-empty directory.

## After Scaffolding

- Add `icon.svg` and wire `"icon": "icon.svg"` into `manifest.json` when the task expects a proper app starter rather than the absolute minimum files.
- Keep the icon language unified with the built-in Eden apps instead of inventing a different visual system.
- Use these existing icons as style anchors:
  `packages/sdk/apps/com/eden/files/icon.svg`
  `packages/sdk/apps/com/eden/settings/icon.svg`
  `packages/sdk/apps/com/eden/calculator/icon.svg`
  `packages/sdk/apps/com/eden/editor/icon.svg`
- The common pattern is a simple 64x64 SVG, rounded-rect background, restrained gradients, and a centered pictogram with clean strokes or solid fills.
- Match the family resemblance first; novelty is less important than staying coherent with the rest of Eden.
- If the next step is building the actual app screen, use the `eden-frontend` skill for that work.

## Current Starting Point

The current app-creation baseline creates:

- `manifest.json`
- `package.json`
- `tsconfig.json`
- `vite.config.mts`
- `index.html`
- `src/index.tsx`
- `src/App.tsx`

It is intentionally minimal:

- renderer-only
- Solid + Vite
- Eden-compatible manifest
- almost empty UI, so the user does not have to delete starter clutter later

## Current Limits

- App ids must use lowercase letters, numbers, dots, and hyphens.
- The implemented creation path is the current Solid renderer scaffold.
- If the user wants backend scaffolding, another frontend stack, or a richer starter template, state that this skill currently starts from the minimal Solid renderer base and extend from there deliberately.

## Verification

- Build `@edenapp/scripts` after changing the scaffold command or generator.
- Build the generated app package with `pnpm run build` or `npm run build`, depending on the scaffold mode.
- Run `python3 /home/dariusz/.codex/skills/.system/skill-creator/scripts/quick_validate.py skills/eden-app-creation` after editing this skill.
