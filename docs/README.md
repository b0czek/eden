# Eden SDK handbook

Use this handbook to build an Electron product with Eden or an app that runs inside it.

A **consumer** is the Electron application that embeds `@edenapp/sdk`.
It selects the apps, configures the desktop, and connects host resources.
An **app** runs inside that desktop. It uses `@edenapp/client` to request system work.

## Build a consumer

Read these chapters in order for your first product:

1. [Create a consumer](consumer-development.md). Install the SDK, select apps, build assets, and start Electron.
2. [Use the host API](main-process-api.md). Wait for startup and run host operations.
3. [Configure users](users.md). Seed accounts, set grants, and limit folder access.
4. [Set product branding](branding.md). Supply the product name, logo, and window icon.

Add [mounted drives](filesystem.md#registering-mounted-drives),
[host Settings panels](settings.md#host-registered-panels), or
[power controls](power-management.md) when your product needs them.

## Build an app

1. [Create and run an app](app-development.md). Generate a project and test it in an Eden host.
2. [Call APIs and exchange messages](ipc-architecture.md). Use system commands, a backend, or another app's service.
3. [Work with files](filesystem.md). Read, save, copy, and watch files through virtual addresses.
4. [Add settings](settings.md#app-manifest-settings) and [translations](localizing-apps.md).
5. [Package the app](app-development.md#package-and-distribute). Build an `.edenite` archive for installation.

For the UI, use [EdenCSS](../packages/sdk/edencss/README.md).
For Solid components, see [Solid Kit](../packages/solid-kit/README.md).
For background work, see [processes and daemons](processes-and-daemons.md).

## Extend an app with DLCs

[DLC packages](dlc-packages.md) add resources to an app's versioned extension points.
Editor supports [language highlighters](editor-highlighter-dlcs.md) and
[document handlers](editor-document-handler-dlcs.md).

## Choose the API for your code

| Code location | API | Execution |
| --- | --- | --- |
| Electron main process | Host returned by `createEden()` | Synchronous reads and lazy Effects |
| App frontend | `@edenapp/client`, `window.edenAPI` | Promises |
| App backend | `@edenapp/client`, `worker.edenAPI` | Promises |
| Frontend to its backend | `getAppAPI()` | Messages and Promise requests |
| App to another app | `appBus` | Messages and Promise requests |

Host code uses `eden.runPromise(work)` to execute an Effect returned by the SDK.

## Terms

| Term | Meaning |
| --- | --- |
| Manifest | `manifest.json`: a package's identity, entries, and declared capabilities |
| Permission | A system capability requested by an app, such as `fs/read` |
| Grant | Access assigned to an Eden user, such as `apps/launch/com.example.notes` |
| Session | One interactive login lifetime |
| Daemon | A backend-only app managed as a background service |
| Operation | Accepted work with retained status, progress, and a completion result |
| Volume | A named filesystem root, such as `home` or a consumer-registered drive |
| DLC | A package of resources and metadata for one host app |

## Contribute to the SDK

The [controller and service guide](controllers.md) covers SDK implementation work.
The [testing guide](testing.md) covers repository test ownership and checks.
Consumer projects can use their own test tools and release process.
