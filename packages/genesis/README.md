# @edenapp/genesis

Genesis packages Eden apps and DLCs as `.edenite` archives.
It validates manifests, runs app builds, and writes compressed archives with SHA256 integrity checks.

See the [Eden handbook](../../docs/README.md) for app and consumer development.

## Install

Install in the project that packages the app:

```bash
npm install --save-dev @edenapp/genesis
```

## Build an archive

Build the app's entry files before validation:

```bash
npm --prefix ./my-app run build
npx genesis validate ./my-app
npx genesis build ./my-app -o ./dist/my-app.edenite
```

The app root must contain `manifest.json`.
Paths in the manifest are relative to that root.
An app needs at least one frontend or backend entry.
If the manifest declares `build.command`, Genesis runs it before collecting files.
DLC payloads must be built separately before packaging.

Use `-v` for verbose output and `-c <level>` for compression levels from 1 to 22.
The default level is 11.
`--dry-run` validates without creating an archive.
Keep archive outputs outside the input package directory.

## Define an app

```json
{
  "id": "com.example.notes",
  "name": "Notes",
  "version": "1.0.0",
  "frontend": { "entry": "dist/index.html" },
  "build": { "command": "npm run build" }
}
```

A sibling `package.json` can supply the version when it is omitted from the manifest.
An explicit manifest version takes precedence.
See [app development](../../docs/app-development.md) and [DLC packages](../../docs/dlc-packages.md)
for complete package workflows.

## Inspect or extract

```bash
npx genesis info ./dist/my-app.edenite
npx genesis extract ./dist/my-app.edenite ./extracted-app
```

Extraction verifies the checksum by default.
Use `info` to inspect a package before installing it.

## Use the library

```ts
import { bundle, extract, getInfo } from "@edenapp/genesis";

const result = await bundle({
  appDirectory: "./my-app",
  outputPath: "./dist/my-app.edenite",
  compressionLevel: 11,
});
if (!result.success) throw new Error(result.error);

const info = await getInfo("./dist/my-app.edenite");
console.info(info.manifest);

const extracted = await extract({
  edenitePath: "./dist/my-app.edenite",
  outputDirectory: "./extracted-app",
  verifyChecksum: true,
});
if (!extracted.success) throw new Error(extracted.error);
```

## Archive format

An archive contains a four-byte metadata length, metadata JSON, and a Zstandard-compressed TAR payload.
Metadata includes the format version, manifest, creation time, and checksum.
