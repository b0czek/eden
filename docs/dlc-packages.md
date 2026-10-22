# Extend an app with DLC packages

[Handbook](README.md) · Related: [App packaging](app-development.md#package-and-distribute)

A DLC supplies files and JSON metadata to one app's versioned extension points.
The app defines the contribution format and decides how to load it.
Eden validates compatibility, installs the package, and gives that app scoped resource URLs.

## Declare an extension point

Add extension points to the host app's manifest:

```json
{
  "id": "com.example.editor",
  "name": "Editor",
  "version": "1.0.0",
  "frontend": { "entry": "index.html" },
  "dlc": {
    "extensionPoints": [
      { "id": "themes", "version": "2.1.0" },
      { "id": "syntax", "version": "1.0.0" }
    ]
  }
}
```

Use a strict SemVer version for each point.
Version its contract when changing the metadata or module interface that DLCs must provide.

## Create the DLC manifest

A theme package might contain this `manifest.json` and a `payload/theme.json` file:

```json
{
  "kind": "dlc",
  "id": "com.example.editor.night-theme",
  "name": "Night Theme",
  "version": "1.0.0",
  "hostAppId": "com.example.editor",
  "contributions": [{
    "extensionPoint": "themes",
    "requires": "^2.0.0",
    "metadata": { "label": "Night", "file": "payload/theme.json" }
  }]
}
```

`requires` is a SemVer range for the extension point, not the host app version.
A DLC must have at least one contribution.
It has no frontend, backend, permissions, services, settings, or grants of its own.
Eden stores metadata as JSON; the host app validates its meaning.

## Load contributions in the host app

Use `package/self` to discover the calling app's installed DLCs.
Each resource has a manifest and an ephemeral `rootUrl`:

```ts
import * as eden from "@edenapp/client";

const { dlcs } = await eden.package.self();
for (const resource of dlcs) {
  for (const contribution of resource.manifest.contributions) {
    if (contribution.extensionPoint !== "themes") continue;
    const metadata = contribution.metadata as { label: string; file: string };
    const response = await fetch(new URL(metadata.file, resource.rootUrl));
    if (!response.ok) throw new Error("Theme resource could not be loaded");
    const theme: unknown = await response.json();
    // Validate theme against your extension contract before applying it.
  }
}
```

For a module contribution, use `import(new URL(entry, resource.rootUrl).href)`.
Bundle runtime dependencies into that module.
Validate its exports before registration.

Both frontend and backend roots use `eden-dlc:` URLs.
Relative imports, `import.meta.url`, and asset fetches use the same URL model.
Use `fetch()` for opaque resources so the DLC works in both runtimes.
Do not persist resource roots across launches.

For an HTTP development frontend with CSP headers, allow `eden-dlc:` in script and connection policies.
Eden respects the page's CSP.

Package-management apps with `package/read` can inspect other packages through `package/get`.
App package results also include their DLC resources.

## Advertise added file types

A DLC can add file handlers for its host:

```json
{
  "fileHandlers": [{ "name": "Diagram files", "extensions": ["diagram"] }]
}
```

These types route to the host while the DLC is installed and compatible.
The host need not advertise optional DLC file types in its own manifest.
For working contracts, see Editor's [highlighters](editor-highlighter-dlcs.md)
and [document handlers](editor-document-handler-dlcs.md).

## Build and install

Compile module payloads before packaging. DLC manifests do not execute build commands.
Then run Genesis:

```bash
npx genesis validate ./night-theme
npx genesis build ./night-theme -o ./night-theme.edenite
```

Install through the same Installer or package commands used for apps.
Stop the host before installing, replacing, or removing one of its DLCs.
Reopen the host so it can discover the updated resources.

Replacing a host removes DLCs that no longer match its extension points.
Removing a host removes all its DLCs.
Built-in packages cannot be replaced or removed at runtime.
A development manifest reload is rejected if it would invalidate installed DLCs.
The Installer asks for confirmation before upgrades, same-version reinstalls, and downgrades.

## Recover a failed package change

If a package change and its rollback both fail, Eden reports both failures and a recovery directory:
`<appsDirectory>/.package-transactions`.
Leave the directory intact. Correct the filesystem problem, then restart Eden to retry recovery.

If the change commits but temporary cleanup fails, the new package remains installed.
Eden logs the retained directory and retries cleanup on startup.
