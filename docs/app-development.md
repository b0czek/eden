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
- **`permissions`**: Array of permissions the app requires.
  - `fs/*`: Full filesystem access.
  - `db/rw`: Read/write access to the app's database.

## interacting with Eden (`window.edenAPI`)

Eden apps run in a sandboxed environment but can interact with the system via the global `edenAPI` object. This API provides secure access to system features based on the requested permissions.

### Shell Commands

The primary way to interact is `edenAPI.shellCommand`.

```typescript
// Example: Reading a directory
const files = await window.edenAPI.shellCommand("fs/readdir", {
  path: "/home/user/Documents",
});

// Example: Writing to a database
await window.edenAPI.shellCommand("db/set", {
  key: "preferences",
  value: JSON.stringify({ theme: "dark" }),
});
```

### Opening Files

To open a file with the default associated app:

```typescript
await window.edenAPI.shellCommand("file/open", {
  path: "/path/to/file.txt",
});
```

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
