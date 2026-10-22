# Create an Eden consumer

[Handbook](README.md) · Next: [Host API](main-process-api.md)

This chapter creates a small Electron desktop with the built-in shell and apps.
The consumer owns the Electron entry point. Eden owns the desktop and app lifetimes.

## Prepare the project

Use Node.js 24.15 or later and Electron 43 or later for the current source tree.
The commands below use npm. You can use pnpm instead.

```bash
mkdir my-desktop
cd my-desktop
npm init -y
npm install @edenapp/sdk
npm install --save-dev @edenapp/scripts electron@^43 typescript @types/node
```

Use matching SDK and build-tool release versions.
For a complete repository example, see [packages/example](../packages/example).

## Define the build

Set these fields in `package.json`. Keep the dependencies added during installation.

```json
{
  "private": true,
  "main": "dist/main.js",
  "scripts": {
    "build": "eden-build copy-assets && eden-build apps && tsc",
    "start": "electron .",
    "dev": "npm run build && electron .",
    "dev:watch": "eden-build watch"
  }
}
```

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "dist",
    "rootDir": ".",
    "strict": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["main.ts"]
}
```

## Select apps and initial data

Create `eden.config.json` in the project root:

```json
{
  "apps": [
    { "id": "com.eden.eveshell", "source": "builtin" },
    { "id": "com.eden.login", "source": "builtin" },
    { "id": "com.eden.toaster", "source": "builtin" },
    { "id": "com.eden.context-menu", "source": "builtin" },
    { "id": "com.eden.files", "source": "builtin" },
    { "id": "com.eden.editor", "source": "builtin" },
    { "id": "com.eden.settings", "source": "builtin" }
  ],
  "settings": {
    "com.eden": {
      "autostart.com.eden.eveshell": "true",
      "autostart.com.eden.toaster": "true",
      "autostart.com.eden.context-menu": "true"
    }
  },
  "users": [
    {
      "username": "demo",
      "name": "Demo",
      "role": "standard",
      "password": "local-demo-only",
      "grants": ["*"]
    }
  ],
  "defaultUsername": "demo",
  "hotReload": { "enabled": true, "debounce": 300 }
}
```

This development account logs in automatically and can use all included apps.
Choose deployment accounts and passwords before distributing the product.
See [users and grants](users.md) for restricted accounts and vendor administration.

`eden.config.json` is build configuration. `eden-build` reads it to select apps
and generate `dist/eden-seed.json`. Passwords are hashed in the generated seed.
Eden applies seed data once. Rebuilding the seed does not overwrite existing user choices.

## Create the Electron entry point

Create `main.ts`:

```ts
import { createEden } from "@edenapp/sdk";
import { app } from "electron";

const eden = createEden({
  development: !app.isPackaged,
  branding: { name: "My Desktop" },
  window: { width: 1280, height: 800 },
  tiling: { mode: "smart", gap: 8, padding: 8 },
  coreApps: ["com.eden.eveshell", "com.eden.toaster", "com.eden.context-menu"],
  restrictedApps: ["com.eden.login", "com.eden.users"],
});

eden.whenReady().then(() => {
  console.info("Desktop ready:", eden.packages.list().length, "packages");
}).catch((error) => {
  console.error("Desktop startup failed:", error);
});
```

Call `createEden()` at module startup, before Electron becomes ready.
Eden registers its resource protocol and starts when Electron is ready.
It also handles application quit and runtime cleanup.

The object passed to `createEden()` is runtime configuration.
It controls the window, paths, branding, tiling, and host providers.
It does not replace the build configuration.

## Build and run

```bash
npm run dev
```

The build copies runtime assets, builds the selected apps, and compiles `main.ts`.
The desktop should show the shell under the Demo account.
Open Files or Settings from the launcher to confirm the app build.

Keep this output with the Electron application:

```text
dist/
├── main.js
├── app-runtime/
├── app-frame/
├── edencss/
├── foundation/
├── apps/prebuilt/
└── eden-seed.json
```

Eden reads runtime assets from `dist/` under the process working directory.
Run Electron from the project root during development.
Arrange the packaged application's working directory so that the same path exists.

By default, installed packages and account data use `eden-apps` under Electron's `userData` directory.
The shared Home volume uses `eden-user` there.
Set `appsDirectory` and `userDirectory` to absolute writable paths when your product needs another location.

## Add your own app

Create an app with the [app guide](app-development.md).
Then add a local source to the `apps` array:

```json
{ "id": "com.example.notes", "source": "local", "path": "apps/notes" }
```

Local paths resolve from the directory where you run `eden-build`.
The configured ID must match the app manifest.
Run `npm run build` again to include it.

An installed npm package can also supply an app root:

```json
{ "id": "com.example.notes", "source": "npm", "package": "my-eden-notes" }
```

Install that package before running the build.
Built-in sources use the apps shipped with the SDK.

## Develop with reload

Start `npm run dev:watch` in a second terminal after the first build.
The watcher starts app development servers and writes their connection state.
The running consumer must have `development: true` or hot reload enabled.
Renderer changes use the app's development server.
For backend development with automatic restart, use the app's standalone `dev:eden` command.
Restart Electron after changing the consumer's compiled main-process code.

## Prepare a release

Run `npm run build` before your Electron packaging step.
Include the runtime assets, selected apps, seed, and branding files in the package.
Keep the application data directories outside read-only installation files.
Set Electron's product name and platform icons in your packaging configuration.

Test a fresh profile to check seeding, login, and app launch.
Test an existing profile to check that saved settings remain intact.
See [branding](branding.md), [host integrations](main-process-api.md), and
[power management](power-management.md) for the remaining product setup.
