# @edenapp/genesis

📦 **Genesis** - Package and bundle Eden applications.

## Overview

Genesis is the official bundler for Eden apps. It packages your Eden applications into `.edenite` format using modern Zstandard (zstd) compression - ready to be planted in any Eden environment.

## Features

- 🗜️ **High-Performance Compression**: Uses Zstandard compression for superior compression ratios
- 🔒 **Integrity Verification**: Built-in SHA256 checksums for archive verification
- 🎯 **Metadata Support**: Archive format versioning for forward compatibility

## Installation

```bash
npm install -g @edenapp/genesis
```

## Usage

### Build an App

Bundle your app into `.edenite` format:

```bash
genesis build ./my-app
```

With custom output path:

```bash
genesis build ./my-app -o ./dist/my-app.edenite
```

With custom compression level (1-22, default 11):

```bash
genesis build ./my-app -c 9
```

Verbose output:

```bash
genesis build ./my-app -v
```

Dry run (validate without creating files):

```bash
genesis build ./my-app --dry-run
```

### Extract an App

Extract an `.edenite` file to a directory:

```bash
genesis extract my-app.edenite ./output-dir
```

With verbose output:

```bash
genesis extract my-app.edenite ./output-dir -v
```

Skip checksum verification (not recommended):

```bash
genesis extract my-app.edenite ./output-dir --no-verify
```

### Validate an App

Check if your app manifest and files are valid:

```bash
genesis validate ./my-app
```

### Get Info

Display information about an `.edenite` file:

```bash
genesis info my-app-1.0.0.edenite
```

## App Structure

Your Eden app directory should contain:

```
my-app/
├── manifest.json     # Required: App metadata
├── index.html        # Optional: Frontend entry point (can be remote URL)
├── backend.js        # Optional: Backend entry point (app can be frontend-only)
├── app.js            # Optional: Frontend logic
├── icon.png          # Optional: App icon
└── ...               # Any other app files
```

## manifest.json

```json
{
  "id": "com.example.myapp",
  "name": "My App",
  "version": "1.0.0",
  "description": "My awesome Eden app",
  "author": "Your Name",
  "backend": {
    "entry": "backend.js"
  },
  "frontend": {
    "entry": "index.html"
  },
  "icon": "icon.png"
}
```

`version` may be omitted when a sibling `package.json` provides a non-empty
string version. An explicit manifest version takes precedence.

## .edenite Format

An `.edenite` file is a Zstandard-compressed TAR archive with the following structure:

- **Format**: `[4 bytes metadata length][metadata JSON][zstd-compressed TAR]`
- **Metadata**: Includes format version, SHA256 checksum, creation time, and app manifest
- **Compression**: Zstandard (zstd) compression with configurable levels (1-22)
- **Integrity**: SHA256 checksum verification on extraction

## Programmatic API

```typescript
import * as genesisBundler from '@edenapp/genesis';

// Bundle an app
const result = await genesisBundler.bundle({
  appDirectory: './my-app',
  outputPath: './output/my-app.edenite',
  verbose: true,
  compressionLevel: 9, // Optional: 1-22, default 3
  dryRun: false, // Optional: validate only
});

// Extract an app
const extractResult = await genesisBundler.extract({
  edenitePath: './my-app.edenite',
  outputDirectory: './extracted',
  verbose: true,
  verifyChecksum: true, // Optional: verify integrity
});

// Get archive info
const info = await genesisBundler.getInfo('./my-app.edenite');
console.log(info.manifest);
console.log(info.checksum);
```

## License

MIT
