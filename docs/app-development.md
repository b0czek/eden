# Writing Apps for Eden SDK

Eden apps are web applications that run within the Eden Desktop Environment. They can be simple frontend-only applications or full-stack applications with a Node.js backend.

## App Structure

An Eden app typically resides in its own directory and contains a `manifest.json` file which defines its metadata and entry points.

### Directory Layout

A standard app (frontend-only) looks like this:

```
my-app/
├── manifest.json       # App configuration
├── package.json        # Dependencies (if using npm/pnpm)
├── src/                # Source code
│   ├── index.tsx       # Entry point
│   └── ...
├── dist/               # Build output (after build)
└── ...
```

A full-stack app (frontend + backend) might look like this:

```
my-app/
├── manifest.json
├── frontend/
│   ├── src/
│   └── package.json
└── backend/
    ├── src/
    └── package.json
```

An app with a backend and no frontend is a [daemon](processes-and-daemons.md). 

## Manifest (`manifest.json`)

The `manifest.json` is the heart of an Eden app. It tells the system how to run your application.

```json
{
  "id": "com.example.myapp",
  "name": "My App",
  "version": "1.0.0",
  "description": "My first Eden app",
  "author": "Your Name",
  "icon": "icon.svg",
  "build": {
    "command": "npm run build"
  },
  "frontend": {
    "entry": "dist/index.html"
  },
  "window": {
    "mode": "both",
    "defaultMode": "floating",
    "defaultSize": { "width": 800, "height": 600 },
    "minSize": { "width": 400, "height": 300 },
    "resizable": true,
    "movable": true
  },
  "permissions": ["fs/*", "db/rw", "system/notifications"]
}
```

### Key Fields

- **`id`**: Unique identifier (reverse domain notation recommended).
- **`frontend.entry`**: Path to the built HTML file relative to the app root.
- **`backend.entry`** (Optional): Path to the compiled backend JavaScript file.
- **`window.mode`**: Supported window modes: `floating`, `tiled`, or `both`.
- **`window.defaultMode`** (Optional): Initial mode to use when `window.mode` is `both`.
- **`window.overlayPriority`** (Optional): Stacking priority for overlay apps. Higher values render above lower values; defaults to `0`.
- **`permissions`**: Array of permissions the app requires.
  - `fs/*`: Full filesystem access. See [Filesystem Access](filesystem.md).
  - `db/rw`: Read/write access to the app's database.

## interacting with Eden (`window.edenAPI`)

Eden apps run in a sandboxed environment but can interact with the system via the global `edenAPI` object. This API provides secure access to system features based on the requested permissions.

### Shell Commands

The primary way to interact is `edenAPI.shellCommand`.

```typescript
// Example: Writing to a database
await window.edenAPI.shellCommand("db/set", {
  key: "preferences",
  value: JSON.stringify({ theme: "dark" }),
});
```

For virtual paths, filesystem commands, opening files, and directory watching,
see [Filesystem Access](filesystem.md).

## Styling

Eden provides a set of CSS variables and utility classes to ensure your app fits the system theme. For detailed usage instructions and a full list of available tokens, please refer to the [EdenCSS Documentation](../packages/sdk/edencss/README.md).

These are available automatically in the environment, but you should adhere to using the variables for colors, spacing, and typography to support theming (light/dark mode).

Example CSS usage:

```css
.my-container {
  background: var(--eden-color-bg-secondary);
  color: var(--eden-color-text-primary);
  padding: var(--eden-space-md);
  border-radius: var(--eden-radius-lg);
}
```

## Building

Your app should include a build script (specified in `manifest.json`) that compiles your source code into the entry points defined in the manifest.

For example, if you use simple static HTML/JS:

1.  Ensure `dist/index.html` exists.
2.  Set `"build": { "command": "echo 'No build needed'" }` or similar if pre-built, or standard `npm run build`.

The Eden build system (`genesis build`) will look for this command and execute it when bundling the system.

Apps build alongside one another by default when Eden bundles multiple apps. If
an app's build command already uses the machine's available parallelism, declare
`"concurrent": false` in its build configuration so it runs alone:

```json
{
  "build": {
    "command": "npm run build",
    "concurrent": false
  }
}
```

## Settings Panels

An app can publish ordinary persisted controls through the unchanged
`settings` array in its manifest. Eden creates one `app.<appId>` panel and
filters each field with the active-user grant
`settings/<appId>/<setting.grant-or-key>`. See [Adding
Settings](settings.md) for the schema and authorization model.

## DLC extension points

Apps can expose named, SemVer-versioned extension points for app-bound data
packages. See [App-bound DLC packages](dlc-packages.md) for manifest examples,
packaging, scoped JavaScript module resources, and lifecycle restrictions.

## Running an app from source

Apps scaffolded for consumer projects include a standalone development command:

```bash
npm run dev:eden
```

This runs `eden-build dev` in a cached, version-matched Eden host. 
Pass another directory as the first argument, or use `--reset` to 
clear only that project's `.eden-dev/` profile.

The first run downloads `@edenapp/dev-host`, including with
`--offline`. Eden contributors can use a built local host with
`--host-path <path-to-packages/sdk>`.

By default the command uses `scripts.dev` in the app root, then in `frontend/`.
For a backend it uses `backend/scripts.dev`, then root `scripts.dev:backend`.
Commands can be made explicit in `manifest.json`:

```json
{
  "development": {
    "frontend": {
      "command": "npm run dev -- --port {port}",
      "url": "http://127.0.0.1:{port}"
    },
    "backend": {
      "command": "npm run dev:backend"
    }
  }
}
```

Both development commands are trusted local repository commands. Vite handles
renderer HMR; manifest and compiled backend-entry changes restart the app while
preserving its window bounds. Changing the app ID or development commands
requires restarting `eden-build dev`.
