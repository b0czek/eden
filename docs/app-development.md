# Create an Eden app

[Handbook](README.md) · Next: [APIs and messages](ipc-architecture.md)

An Eden app is a web frontend, a Node.js backend, or both.
Its `manifest.json` declares the entry files and system permissions.
This chapter starts with a Solid frontend. Other web frameworks can use the same APIs.

## Generate a project

Run this command from the directory that will contain your app:

```bash
npx --package @edenapp/scripts eden-build scaffold-solid com.example.notes ./notes --mode consumer --name Notes
cd notes
npm install
npm run dev:eden
```

The generator creates a Solid and Vite project with a manifest.
`--mode consumer` selects a project with published package dependencies.
SDK contributors use `--mode sdk` inside this workspace.

`dev:eden` runs the app in a version-matched Eden development host.
The first run downloads that host. Later runs reuse the cache.
You should see the generated app inside Eden, with its window frame and theme.
Edit `src/App.tsx` to check renderer reload.

A browser running only `npm run dev` does not supply Eden's injected APIs.
Use `npm run dev:eden` when testing system commands or app communication.

## Know the project files

```text
notes/
├── manifest.json
├── icon.svg              # add this icon below
├── package.json
├── index.html
├── vite.config.mts
├── tsconfig.json
└── src/
    ├── index.tsx
    └── App.tsx
```

Vite writes the frontend to `dist/` during a production build.
The generated Vite config uses `base: "./"` so built asset paths work inside Eden.
Keep that setting if you change the build configuration.

## Add an icon and configure the manifest

Create `icon.svg` in the app root:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect x="8" y="4" width="48" height="56" rx="8" fill="#4968b8" />
  <path d="M20 20h24M20 32h24M20 44h16" stroke="white" stroke-width="4" />
</svg>
```

Use this manifest for a Notes app that stores a draft in its app database:

```json
{
  "id": "com.example.notes",
  "name": "Notes",
  "version": "1.0.0",
  "icon": "icon.svg",
  "frontend": { "entry": "dist/index.html" },
  "build": { "command": "npm run build" },
  "window": {
    "mode": "both",
    "defaultMode": "floating",
    "defaultSize": { "width": 800, "height": 600 },
    "minSize": { "width": 400, "height": 300 }
  },
  "permissions": ["db/rw"]
}
```

Entry and icon paths are relative to the app root.
Use a stable reverse-domain ID. Other apps and user grants refer to that ID.

`window.mode` accepts `floating`, `tiled`, or `both`.
For `both`, `defaultMode` selects the initial mode.
Without it, Eden prefers tiled mode when desktop tiling is enabled.
Eden injects the window frame and EdenCSS by default.

The [manifest types](../packages/types/AppManifest.d.ts) list all fields.
Add [file handlers](filesystem.md#opening-files-and-picking-locations),
[settings](settings.md#app-manifest-settings), or [DLC extension points](dlc-packages.md) as needed.

## Save a draft through the client

Install the typed client:

```bash
npm install @edenapp/client
```

Replace `src/App.tsx` with this component:

```tsx
import { db } from "@edenapp/client";
import { createSignal, onMount } from "solid-js";

export default function App() {
  const [text, setText] = createSignal("");
  const [status, setStatus] = createSignal("Loading draft…");
  const [ready, setReady] = createSignal(false);

  onMount(() => {
    void db.get("draft").then(({ value }) => {
      setText(value ?? "");
      setReady(true);
      setStatus("Ready");
    }).catch((error) => setStatus(String(error)));
  });

  async function save() {
    try {
      await db.set("draft", text());
      setStatus("Saved");
    } catch (error) {
      setStatus(String(error));
    }
  }

  return (
    <main class="eden-flex-col eden-gap-md eden-p-md">
      <label for="draft">Draft</label>
      <textarea class="eden-textarea" id="draft" value={text()} disabled={!ready()}
        onInput={(event) => setText(event.currentTarget.value)} />
      <button class="eden-btn eden-btn-primary" disabled={!ready()} onClick={() => void save()}>Save</button>
      <p role="status">{status()}</p>
    </main>
  );
}
```

Type text, save it, and reopen the app. The draft should return.
Database commands store values under the calling app's namespace.
Use [filesystem commands](filesystem.md) when users need named files on a volume.

The client returns Promises and uses the host's injected API.
The app needs each command's permission in its manifest.
Some commands also check the active user's grants.
See [client arguments and subscriptions](../packages/client/README.md).

## Build the UI

Use [EdenCSS](../packages/sdk/edencss/README.md) for layout, controls, colors, and spacing.
Its styles are available inside Eden without an app import.
Prefer its tokens and components before adding custom CSS.
Test the UI in both light and dark themes and at narrow window sizes.

Add `@edenapp/types/global` to the frontend's TypeScript `types` array when configuring a project yourself.
The generated project already includes it.
For Solid helpers, see [Solid Kit](../packages/solid-kit/README.md).

## Add a backend when needed

Declare a compiled Node.js entry alongside the frontend:

```json
{
  "backend": { "entry": "backend/dist/index.js" },
  "frontend": { "entry": "dist/index.html" }
}
```

Bundle backend dependencies into that entry.
For a source file at `backend/src/index.ts`, one build command is:

```bash
npm install --save-dev esbuild @types/node
npx esbuild backend/src/index.ts --bundle --platform=node --format=esm --outfile=backend/dist/index.js
```

Include this backend build in the app's build script alongside the frontend build.
Use `worker.edenAPI` or the same `@edenapp/client` imports for Eden commands.
Use [AppAPI](ipc-architecture.md#connect-a-frontend-to-its-backend) for frontend/backend requests.
A backend is trusted Node.js code and can use host Node APIs directly.
Eden permissions govern Eden commands; they do not sandbox Node APIs.

A backend-only app can run as a [daemon](processes-and-daemons.md).

## Control development startup

`eden-build dev` finds the root `scripts.dev`, then `frontend/scripts.dev` for the frontend.
For a backend, it checks `backend/scripts.dev`, then root `scripts.dev:backend`.
Set explicit commands when your layout differs:

```json
{
  "development": {
    "frontend": {
      "command": "npm run dev -- --port {port}",
      "url": "http://127.0.0.1:{port}"
    },
    "backend": { "command": "npm run dev:backend" }
  }
}
```

These commands run as trusted local repository commands.
Renderer changes use Vite HMR.
Manifest and compiled backend changes restart the app and preserve its window bounds.
Restart `eden-build dev` after changing the app ID or development commands.

Use `eden-build dev --reset` to clear this app's `.eden-dev/` profile.
Use `--host-path <built-host-directory>` to select a local built host.
`--offline` requires a cached host. If it is missing, run once without `--offline` to download it.
Ignore `.eden-dev/` in version control.

## Package and distribute

Install Genesis as a development tool:

```bash
npm install --save-dev @edenapp/genesis
npm run build
npx genesis validate .
npx genesis build . -o ../notes.edenite
```

Genesis also executes the app's `build.command` when bundling.
Keep output archives outside the app source directory.
A manifest version takes precedence over the version in a sibling `package.json`.

App builds run concurrently when a consumer builds several apps.
Set `build.concurrent` to `false` if this app's build needs to run alone.

Open the archive with Eden's Installer, or let a consumer include the app at build time.
Stop the installed app before replacing or removing it.
Test the installed archive as well as the development source.
See [Genesis](../packages/genesis/README.md) for archive commands.
