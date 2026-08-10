# App-bound DLC packages

DLC packages add files and app-defined JSON metadata to extension points exposed
by one installed host app. Eden validates, stores, and scopes the package but
does not execute or interpret its payload.

## Declaring extension points

An app opts in by adding strictly-versioned extension points to its manifest:

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

Extension-point versions are strict SemVer.

## DLC manifests and packaging

```json
{
  "kind": "dlc",
  "id": "com.example.editor.night-theme",
  "name": "Night Theme",
  "version": "1.0.0",
  "hostAppId": "com.example.editor",
  "icon": "icon.svg",
  "contributions": [
    {
      "extensionPoint": "themes",
      "requires": "^2.0.0",
      "metadata": { "label": "Night", "file": "payload/theme.json" }
    }
  ]
}
```

A DLC must contribute to at least one point. It cannot declare frontend or
backend entries, permissions, services, settings, grants, or build identity.
Metadata must be JSON and remains opaque to Eden. Package the directory with
the same `.edenite` format used by apps:

```bash
genesis validate ./night-theme
genesis build ./night-theme -o ./night-theme.edenite
```

### Extending host file handlers

A DLC that adds support for new file types can advertise those types on behalf
of its host:

```json
{
  "kind": "dlc",
  "hostAppId": "com.example.editor",
  "fileHandlers": [
    {
      "name": "Diagram files",
      "extensions": ["diagram"]
    }
  ]
}
```

These handlers resolve to the host app and are available only while the DLC is
installed and compatible. The host does not need to advertise support for an
optional DLC's file types in its own manifest.

To ship a DLC with Eden, place its source package under `packages/sdk/dlcs/`.
The SDK package build discovers app and DLC source roots separately and emits
both as built-in packages. A built-in DLC must target a compatible app included
in the same runtime. It is reported with `isPrebuilt: true` and cannot be
replaced or removed at runtime.

## Scoped module consumption

The host identifies itself and discovers its packages through `package/self`.
The command does not accept an app ID because Eden derives it from the
authenticated caller. It returns the host's runtime manifest and a `dlcs` array.
Each DLC contains its package manifest and an ephemeral `rootUrl`; contribution
paths are resolved relative to that URL. Eden treats those paths as opaque
host-defined metadata.

Package-management callers with `package/read` can inspect any installed
package with `package/get` and an explicit `packageId`. App package results
include their `dlcs` resources.

```ts
const { manifest, dlcs } = await window.edenAPI.shellCommand("package/self", {});
for (const resource of dlcs) {
  for (const contribution of resource.manifest.contributions) {
    if (contribution.extensionPoint !== "syntax") continue;
    const entry = (contribution.metadata as { entry: string }).entry;
    const module = await import(new URL(entry, resource.rootUrl).href);
    registerHighlighter(module);
  }
}
```

Renderer and backend roots both use Eden's `eden-dlc:` resource URLs. The same
URL operations work in both runtimes: hosts can compose relative URLs, import
ES modules, and fetch assets. A module's `import.meta.url` remains an
`eden-dlc:` URL, so its relative imports and asset reads behave identically.
Renderer requests are served by Electron's host- and view-scoped protocol;
backend requests are securely resolved by Eden's backend runtime. The host
validates imported exports against its own contract before registering them.
Multiple DLCs may contribute independent implementations to the same extension
point.

For the text editor's public `language-highlighters` contract, see
[Editor language-highlighter DLCs](editor-highlighter-dlcs.md).

Direct filesystem access is intentionally not part of the portable DLC resource
contract because it has no renderer equivalent. Use `fetch()` for opaque files.

HTTP and HTTPS frontend entries are supported for development. A development
server that sends Content Security Policy headers must allow `eden-dlc:` in its
script and connection policies. Eden does not bypass the page's CSP.

## Lifecycle

DLCs use the same package lifecycle commands as apps. `package/install`
inspects the archive manifest to select the correct installation behavior, and
`package/uninstall` accepts the ID of either an app or a DLC.

DLC installation, replacement, and removal require the host to be stopped.
Replacing or removing an app also requires that app to be stopped. Replacing a
host removes DLCs that no longer match its extension points as part of the same
confirmed transaction; removing a host removes all of its DLCs. Prebuilt and
development apps cannot be replaced, and a development manifest reload is
rejected if it would invalidate installed DLCs.

The Installer prompts explicitly for upgrades, same-version reinstalls, and
downgrades. Distribution remains local and file-based; DLC support does not add
a catalog or network source.
